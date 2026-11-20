#!/usr/bin/env python3
"""Stage, validate and atomically cut over the 2026.11.21-quota.1 service.

This script is intentionally production-only. It never restores an old database:
the latest SQLite ledger is retained through both success and rollback. It
leaves the production database, master key, env files, systemd unit and Nginx
configuration on the server and verifies their hashes before any switch.

Usage on the server:
  python3 deploy-quota.py stage <release.tar.gz> <archive-sha256>
  python3 deploy-quota.py recheck <archive-sha256>
  python3 deploy-quota.py cutover

`cutover` is refused unless incoming/<name>/accepted-validation.json records
Codex's independent review and hashes matching this exact release.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import pwd
import re
import secrets
import shutil
import sqlite3
import subprocess
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(os.environ.get("LINGTU_ROOT", "/opt/lingtu-kefu"))
NAME = "20261121-quota.1"
VERSION = "2026.11.21-quota.1"
PRODUCTION_VERSION = "2026.11.19-learning.1"
PRODUCTION_SOURCE_SHA256 = "7f3366d0d0c2f1081d13e1924c788bb31f9707202754fa74fb44d196e86c3f0d"
PRODUCTION_BINARY_SHA256 = "a6cbb15bf6c4d7fa4b23bcdf7797c6da6b26548f7ec43fd4fe99a7def22c606c"
IN = ROOT / "incoming" / NAME
BACK = ROOT / "backups" / NAME
REL = ROOT / "releases" / NAME
CURRENT = ROOT / "current"
CONFIG_FILES = {
    "service.env": ROOT / "shared/service.env",
    "wechat-payment.env": ROOT / "shared/wechat-payment.env",
    "master.key": ROOT / "shared/master.key",
    "unit": Path("/etc/systemd/system/lingtu-kefu.service"),
    "unit-dropin": Path("/etc/systemd/system/lingtu-kefu.service.d/40-wechat-payments.conf"),
    "nginx": Path("/etc/nginx/conf.d/lingtu-kefu.conf"),
}
ALLOWED_PACKAGE_TOP = {
    "lingtu-managed",
    "SOURCE.tar.gz",
    "release.json",
    "NEW-API-LICENSE",
    "LTTLT-LICENSE",
    "THIRD-PARTY-LICENSES.md",
    "web",
}
VOLATILE_FIELDS = {
    "system_instances": {"info", "last_seen_at", "started_at", "updated_at"},
    "casbin_rule": {"id"},
    "lingtu_trial_limit_gate": {"version"},
}


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for part in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(part)
    return digest.hexdigest()


def tree_sha(folder: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(Path(folder).rglob("*"), key=lambda item: item.relative_to(folder).as_posix()):
        assert not path.is_symlink(), "unexpected release web symlink"
        if path.is_file():
            digest.update((path.relative_to(folder).as_posix() + ":" + sha(path) + "\n").encode())
    return digest.hexdigest()


def save(path: Path, value: object, mode: int = 0o600) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    path.chmod(mode)


def request(path: str, body: bytes | None = None, port: int = 3212) -> tuple[int, object]:
    request_object = urllib.request.Request(
        "http://127.0.0.1:" + str(port) + path,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request_object, timeout=8) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        try:
            data = json.loads(error.read())
        except Exception:
            data = {}
        return error.code, data


def health(port: int, expected: str = VERSION, manifest: dict | None = None) -> dict:
    last_error = "no response"
    for _ in range(90):
        try:
            code, data = request("/api/lingtu/service", port=port)
            if code == 200 and isinstance(data, dict) and data.get("version") == expected:
                if manifest is not None:
                    capabilities = set(data.get("capabilities") or [])
                    required = set(manifest.get("capabilities") or [])
                    assert required <= capabilities, "candidate capability set regressed"
                    assert "admin-batch-trial-quota" in capabilities, "batch quota capability missing"
                return data
            last_error = f"unexpected health response: {code} {data!r}"
        except Exception as error:
            last_error = repr(error)
        time.sleep(1)
    raise RuntimeError("candidate health timeout: " + last_error)


def schema_signature(path: Path) -> str:
    with contextlib.closing(sqlite3.connect("file:" + str(path) + "?mode=ro", uri=True)) as database:
        assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        digest = hashlib.sha256()
        rows = database.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master "
            "WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
        )
        for row in rows:
            digest.update(repr(tuple(row)).encode() + b"\n")
        return digest.hexdigest()


def fingerprint(path: Path, columns: dict[str, list[str]] | None = None) -> tuple[dict, dict[str, list[str]]]:
    with contextlib.closing(sqlite3.connect("file:" + str(path) + "?mode=ro", uri=True)) as database:
        assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        metadata = "__model_update_task_watermark"
        names = [name for name in columns if name != metadata] if columns else [
            row[0]
            for row in database.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        watermark = (
            columns[metadata]
            if columns
            else database.execute("SELECT COALESCE(MAX(id),0) FROM system_tasks").fetchone()[0]
        )
        result: dict[str, dict] = {}
        selected_columns: dict[str, list[str]] = {metadata: watermark}
        for name in names:
            current = [row[1] for row in database.execute('PRAGMA table_info("' + name + '")')]
            selected = (
                columns[name]
                if columns
                else [column for column in current if column not in VOLATILE_FIELDS.get(name, set())]
            )
            if any(column not in current for column in selected):
                raise AssertionError("protected column disappeared from " + name)
            selected_columns[name] = selected
            digest = hashlib.sha256()
            count = 0
            quoted = ",".join('"' + column + '"' for column in selected)
            extra = (
                " WHERE NOT (type='model_update' AND id>" + str(int(watermark)) + ")"
                if name == "system_tasks"
                else ""
            )
            order = quoted if name == "casbin_rule" else "rowid"
            for row in database.execute(
                "SELECT " + quoted + ' FROM "' + name + '"' + extra + " ORDER BY " + order
            ):
                digest.update(repr(tuple(row)).encode())
                count += 1
            result[name] = {"rows": count, "sha256": digest.hexdigest()}
        return result, selected_columns


def snapshot(source: Path, destination: Path) -> None:
    with sqlite3.connect("file:" + str(source) + "?mode=ro", uri=True) as source_db:
        with sqlite3.connect(destination) as destination_db:
            source_db.backup(destination_db)
            assert destination_db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    destination.chmod(0o600)


def switch(target: Path) -> None:
    temporary = ROOT / "current.quota-next"
    if temporary.exists() or temporary.is_symlink():
        temporary.unlink()
    temporary.symlink_to(target)
    os.replace(temporary, CURRENT)


def verify_release(manifest: dict) -> None:
    assert manifest["version"] == VERSION, "release version mismatch"
    assert manifest["release_name"] == NAME, "release name mismatch"
    assert manifest["production_release"] == PRODUCTION_VERSION, "production baseline mismatch"
    assert manifest["production_source_sha256"] == PRODUCTION_SOURCE_SHA256, "production source baseline mismatch"
    assert manifest["production_binary_sha256"] == PRODUCTION_BINARY_SHA256, "production binary baseline mismatch"
    assert manifest["schema_migration"] is False, "candidate unexpectedly declares schema migration"
    assert manifest["permanent_quota_feature"] is False, "permanent quota must not be deployed"
    assert sha(REL / "lingtu-managed") == manifest["binary_sha256"], "release binary changed"
    assert sha(REL / "SOURCE.tar.gz") == manifest["source_sha256"], "release source changed"
    assert sha(REL / "web/index.html") == manifest["web_index_sha256"], "release web index changed"
    assert tree_sha(REL / "web") == manifest["web_tree_sha256"], "release web tree changed"


def extract_package(package: Path) -> None:
    assert package.is_file(), "release archive missing: " + str(package)
    with tarfile.open(package, "r:gz") as archive:
        for item in archive.getmembers():
            name = Path(item.name)
            assert not name.is_absolute() and ".." not in name.parts, "unsafe archive path"
            assert not item.issym() and not item.islnk(), "archive links are not allowed"
            assert name.parts and name.parts[0] in ALLOWED_PACKAGE_TOP, "unexpected package entry: " + item.name
            destination = REL / name
            if item.isdir():
                destination.mkdir(parents=True, exist_ok=True)
                destination.chmod(0o755)
            else:
                assert item.isfile(), "unexpected package member type"
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(item) as source, destination.open("wb") as output:
                    shutil.copyfileobj(source, output)
                destination.chmod(0o755 if item.name == "lingtu-managed" else 0o644)


def without_html_comments(value: bytes) -> bytes:
    # The native server injects analytics vendor comments into its embedded
    # index at runtime. Compare the actual document and asset references while
    # ignoring comments so the exact release index remains the source of truth.
    return re.sub(rb"<!--.*?-->", b"", value, flags=re.S)


def checks(port: int, manifest: dict) -> dict:
    for path in [
        "/api/client/me",
        "/api/client/billing",
        "/api/client/billing/orders",
        "/api/lingtu/admin/config",
        "/api/lingtu/admin/accounts",
        "/api/lingtu/admin/audit",
        "/api/lingtu/admin/usage",
        "/api/lingtu/admin/usage-summary",
        "/api/lingtu/admin/usage-daily",
        "/api/lingtu/admin/billing",
    ]:
        code, _ = request(path, port=port)
        assert code == 401, path + " must remain restricted"
    code, data = request("/api/lingtu/billing/wechat/webhook", b"{}", port)
    assert code == 400 and isinstance(data, dict) and data.get("error") == "invalid_webhook", "wechat signature guard"

    with urllib.request.urlopen("http://127.0.0.1:" + str(port) + "/", timeout=8) as response:
        served_index = response.read()
    release_index = (REL / "web/index.html").read_bytes()
    assert without_html_comments(served_index) == without_html_comments(release_index), "served web index differs from release"
    assert hashlib.sha256(release_index).hexdigest() == manifest["web_index_sha256"], "release web index hash mismatch"

    asset = None
    for candidate in (REL / "web").rglob("*.js"):
        content = candidate.read_bytes()
        if b"batch_quota" in content:
            asset = candidate
            break
    assert asset is not None, "batch quota admin asset missing"
    route = "/" + asset.relative_to(REL / "web").as_posix()
    with urllib.request.urlopen("http://127.0.0.1:" + str(port) + route, timeout=12) as response:
        served = response.read()
    assert hashlib.sha256(served).digest() == hashlib.sha256(asset.read_bytes()).digest(), "served admin asset differs"
    return {"admin_asset": route, "admin_asset_sha256": sha(asset), "admin_web_present": True}


def isolated_run(mode: str, state: dict, manifest: dict) -> dict:
    test = IN / ("isolated" if mode == "stage" else "isolated-recheck")
    if test.exists():
        raise AssertionError("isolated test directory already exists")
    test.mkdir(mode=0o700)
    shutil.copy2(BACK / "managed-online.db", test / "isolated.db")
    shutil.copy2(BACK / "master.key", test / "master.key")
    (test / "isolated.db").chmod(0o600)
    (test / "master.key").chmod(0o600)
    environment = {
        "LINGTU_LISTEN_HOST": "127.0.0.1",
        "LINGTU_API_ORIGIN": "http://127.0.0.1:3212",
        "LINGTU_PORTAL_ORIGIN": "http://127.0.0.1:3212",
        "LINGTU_LOCAL_HTTP": "1",
        "SESSION_COOKIE_SECURE": "false",
        "SESSION_SECRET": secrets.token_urlsafe(48),
        "LINGTU_MASTER_KEY_FILE": str(test / "master.key"),
        "SQLITE_PATH": str(test / "isolated.db"),
        "GOMEMLIMIT": "128MiB",
        "GOGC": "50",
        "GIN_MODE": "release",
        "CHANNEL_UPSTREAM_MODEL_UPDATE_TASK_ENABLED": "false",
        "UPDATE_TASK": "false",
        "SQL_MAX_IDLE_CONNS": "1",
        "SQL_MAX_OPEN_CONNS": "2",
        "TMPDIR": str(test),
    }
    runtime_env = test / "runtime.env"
    runtime_env.write_text(
        "\n".join(key + "=" + value for key, value in environment.items())
        + "\n"
        + (BACK / "wechat-payment.env").read_text()
    )
    runtime_env.chmod(0o600)

    IN.chmod(0o711)
    owner = pwd.getpwnam("lingtu-kefu")
    for path in [test, *test.iterdir()]:
        os.chown(path, owner.pw_uid, owner.pw_gid)
        path.chmod(0o700 if path.is_dir() else 0o600)

    before, columns = fingerprint(test / "isolated.db")
    before_schema = schema_signature(test / "isolated.db")
    unit = "lingtu-quota-candidate"
    command = [
        "systemd-run",
        "--quiet",
        "--collect",
        "--unit=" + unit,
        "-p",
        "User=lingtu-kefu",
        "-p",
        "Group=lingtu-kefu",
        "-p",
        "WorkingDirectory=" + str(test),
        "-p",
        "EnvironmentFile=" + str(runtime_env),
        "-p",
        "UnsetEnvironment=SQL_DSN LOG_SQL_DSN REDIS_CONN_STRING",
        "-p",
        "MemoryMax=256M",
        "-p",
        "NoNewPrivileges=true",
        "-p",
        "IPAddressDeny=any",
        "-p",
        "IPAddressAllow=localhost",
        str(REL / "lingtu-managed"),
        "--port",
        "3212",
        "--log-dir",
        str(test / "logs"),
    ]
    subprocess.run(command, check=True)
    try:
        info = health(3212, VERSION, manifest)
        web = checks(3212, manifest)
        after, _ = fingerprint(test / "isolated.db", columns)
        after_schema = schema_signature(test / "isolated.db")
        assert before == after, "existing protected fields changed in candidate startup"
        assert before_schema == after_schema, "candidate startup changed the schema"
        result = {
            "passed": True,
            "service": info,
            "manifest": manifest,
            "columns": columns,
            "protected_rows_sha256": hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest(),
            "schema_sha256": before_schema,
            "web": web,
        }
        save(BACK / "candidate-check.json", result)
        return result
    finally:
        subprocess.run(["systemctl", "stop", unit], check=False)


def require_baseline_current() -> tuple[Path, dict]:
    old = CURRENT.resolve()
    assert old.is_dir(), "current release is missing"
    assert sha(old / "SOURCE.tar.gz") == PRODUCTION_SOURCE_SHA256, "production source baseline changed"
    assert sha(old / "lingtu-managed") == PRODUCTION_BINARY_SHA256, "production binary baseline changed"
    code, service = request("/api/lingtu/service", port=3211)
    assert code == 200 and service.get("version") == PRODUCTION_VERSION, "unexpected production service version"
    return old, service


def stage(package_path: Path, archive_sha: str) -> None:
    package = Path(package_path)
    assert sha(package) == archive_sha, "uploaded archive hash mismatch"
    assert not REL.exists() and not BACK.exists(), "release or backup already exists"
    old, previous_service = require_baseline_current()
    IN.mkdir(mode=0o700, parents=True, exist_ok=True)
    BACK.mkdir(mode=0o700)
    REL.mkdir(mode=0o755)
    state = {
        "previous_release": str(old),
        "previous_service": previous_service,
        "files": {name: sha(path) for name, path in CONFIG_FILES.items()},
        "package_sha256": archive_sha,
        "created_at": int(time.time()),
    }
    for name, path in CONFIG_FILES.items():
        shutil.copy2(path, BACK / name)
        (BACK / name).chmod(0o600)
    snapshot(ROOT / "shared/managed.db", BACK / "managed-online.db")
    save(BACK / "state.json", state)
    extract_package(package)
    manifest = json.loads((REL / "release.json").read_text())
    verify_release(manifest)
    result = isolated_run("stage", state, manifest)
    print(json.dumps({
        "candidate_passed": True,
        "version": VERSION,
        "release": str(REL),
        "backup": str(BACK),
        "archive_sha256": archive_sha,
        "binary_sha256": manifest["binary_sha256"],
        "source_sha256": manifest["source_sha256"],
        "protected_data_unchanged": True,
        "schema_unchanged": True,
        "admin_batch_capability": True,
    }))


def recheck(archive_sha: str) -> None:
    state = json.loads((BACK / "state.json").read_text())
    assert state["package_sha256"] == archive_sha, "archive hash does not match staged release"
    manifest = json.loads((REL / "release.json").read_text())
    verify_release(manifest)
    result = isolated_run("recheck", state, manifest)
    print(json.dumps({"recheck_passed": True, "schema_sha256": result["schema_sha256"]}))


def cutover() -> None:
    state = json.loads((BACK / "state.json").read_text())
    candidate = json.loads((BACK / "candidate-check.json").read_text())
    accepted = json.loads((IN / "accepted-validation.json").read_text())
    manifest = json.loads((REL / "release.json").read_text())
    old = Path(state["previous_release"])
    assert CURRENT.resolve() == old, "current release changed after stage"
    assert accepted["candidate_version"] == VERSION
    assert accepted["source_sha256"] == manifest["source_sha256"]
    assert accepted["binary_sha256"] == manifest["binary_sha256"]
    assert accepted["patch_sha256"] == manifest["patch_sha256"]
    assert accepted["baseline_source_sha256"] == PRODUCTION_SOURCE_SHA256
    assert accepted["independent_deploy_review"] == "passed"
    assert accepted["local"]["status"] == "passed"
    assert accepted["local"]["go_test_exit"] == 0
    assert accepted["local"]["admin_ui_exit"] == 0
    assert accepted["local"]["linux_build_exit"] == 0
    assert accepted["local"]["schema_changes"] is False
    assert candidate["passed"] is True and candidate["manifest"] == manifest
    for name, path in CONFIG_FILES.items():
        assert sha(path) == state["files"][name], name + " changed after stage"
    verify_release(manifest)
    with sqlite3.connect("file:" + str(ROOT / "shared/managed.db") + "?mode=ro", uri=True) as database:
        pending = database.execute(
            "SELECT COUNT(*) FROM lingtu_trial_requests WHERE state='pending'"
        ).fetchone()[0]
    assert pending == 0, "active model requests exist; wait before cutover"

    switched = False
    started = time.monotonic()
    try:
        # The symlink target and accepted hashes are not enough: prove the
        # baseline release files are still the recorded production bytes
        # immediately before the service is stopped.
        assert sha(old / "SOURCE.tar.gz") == PRODUCTION_SOURCE_SHA256, "production source baseline changed before cutover"
        assert sha(old / "lingtu-managed") == PRODUCTION_BINARY_SHA256, "production binary baseline changed before cutover"
        subprocess.run(["systemctl", "stop", "lingtu-kefu"], check=True)
        snapshot(ROOT / "shared/managed.db", BACK / "managed-final-before-cutover.db")
        before, columns = fingerprint(ROOT / "shared/managed.db")
        before_schema = schema_signature(ROOT / "shared/managed.db")
        save(BACK / "protected-before.json", {
            "rows": before,
            "columns": columns,
            "schema_sha256": before_schema,
        })
        switch(REL)
        switched = True
        subprocess.run(["systemctl", "start", "lingtu-kefu"], check=True)
        info = health(3211, VERSION, manifest)
        web = checks(3211, manifest)
        after, _ = fingerprint(ROOT / "shared/managed.db", columns)
        after_schema = schema_signature(ROOT / "shared/managed.db")
        assert before == after, "protected business fields changed during cutover"
        assert before_schema == after_schema, "candidate changed the production schema"
        for name, path in CONFIG_FILES.items():
            assert sha(path) == state["files"][name], name + " changed during cutover"
        pid = subprocess.check_output(
            ["systemctl", "show", "lingtu-kefu", "-p", "MainPID", "--value"], text=True
        ).strip()
        assert Path("/proc/" + pid + "/exe").resolve() == REL / "lingtu-managed", "running binary mismatch"
        subprocess.run(["nginx", "-t"], check=True, stdout=subprocess.DEVNULL)
        result = {
            "passed": True,
            "version": VERSION,
            "release": str(REL),
            "previous_release": str(old),
            "backup": str(BACK),
            "service": info,
            "web": web,
            "protected_data_unchanged": True,
            "schema_unchanged": True,
            "credentials_config_unchanged": True,
            "latest_database_retained": True,
            "downtime_seconds": round(time.monotonic() - started, 2),
            "charged": False,
            "created_order": False,
        }
        save(BACK / "deployment-result.json", result)
        print(json.dumps(result))
    except Exception as deployment_error:
        try:
            subprocess.run(["systemctl", "stop", "lingtu-kefu"], check=True)
            if switched:
                switch(old)
            subprocess.run(["systemctl", "start", "lingtu-kefu"], check=True)
            old_info = health(3211, PRODUCTION_VERSION)
            old_pid = subprocess.check_output(
                ["systemctl", "show", "lingtu-kefu", "-p", "MainPID", "--value"], text=True
            ).strip()
            assert Path("/proc/" + old_pid + "/exe").resolve() == old / "lingtu-managed", "rollback process mismatch"
            save(BACK / "rollback-result.json", {
                "restored": True,
                "service": old_info,
                "latest_database_retained": True,
                "deployment_error_type": type(deployment_error).__name__,
            })
        except Exception as rollback_error:
            save(BACK / "rollback-result.json", {
                "rollback_failed": True,
                "latest_database_retained": True,
                "deployment_error_type": type(deployment_error).__name__,
                "rollback_error_type": type(rollback_error).__name__,
            })
            raise RuntimeError("Deployment failed and rollback health could not be verified") from rollback_error
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["stage", "recheck", "cutover"])
    parser.add_argument("archive", nargs="?")
    parser.add_argument("sha256", nargs="?")
    args = parser.parse_args()
    lock = (ROOT / "shared/.billing-deploy.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if args.mode == "stage":
        if not args.archive or not args.sha256:
            parser.error("stage requires <release.tar.gz> <archive-sha256>")
        stage(Path(args.archive), args.sha256)
    elif args.mode == "recheck":
        # `recheck <archive-sha256>` occupies args.archive; it has no second
        # positional argument. Accept args.sha256 only as a compatibility alias.
        digest = args.archive or args.sha256
        if not digest:
            parser.error("recheck requires <archive-sha256>")
        recheck(digest)
    else:
        cutover()


if __name__ == "__main__":
    main()
