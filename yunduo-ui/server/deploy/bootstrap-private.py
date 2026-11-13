"""Run on the server as root; creates independent private state, prints no secrets."""
import grp
import os
from pathlib import Path
import pwd
import secrets
import subprocess

base = Path('/opt/lingtu-kefu')
if base.is_symlink():
    raise SystemExit('Refusing symlink deployment root')
try:
    owner = pwd.getpwnam('lingtu-kefu')
except KeyError:
    subprocess.run(['useradd', '--system', '--home-dir', str(base), '--shell', '/usr/sbin/nologin', 'lingtu-kefu'], check=True)
    owner = pwd.getpwnam('lingtu-kefu')
base.mkdir(mode=0o755, exist_ok=True)
(base/'releases').mkdir(mode=0o755, exist_ok=True)
(base/'backups').mkdir(mode=0o700, exist_ok=True)
shared = base/'shared'
if shared.is_symlink():
    raise SystemExit('Refusing symlink state directory')
shared.mkdir(mode=0o700, exist_ok=True)
os.chown(shared, owner.pw_uid, owner.pw_gid)
master = shared/'master.key'
if not master.exists():
    fd = os.open(master, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(secrets.token_bytes(32))
    os.chown(master, owner.pw_uid, owner.pw_gid)
env = shared/'service.env'
if not env.exists():
    template = Path(__file__).with_name('service.env.example').read_text()
    fd = os.open(env, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(template+'\nSESSION_SECRET='+secrets.token_urlsafe(48)+'\n')
    os.chown(env, owner.pw_uid, owner.pw_gid)
print('Independent private state ready; existing state preserved.')
