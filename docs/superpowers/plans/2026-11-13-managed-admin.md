# Managed administration implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Ship the approved clear admin interface with actual multi API models, login settings and daily usage.
**Architecture:** Extend the pinned New API overlay, reuse native channels/adapters/encrypted fields/security proof. Stable managed logical models map to explicitly chosen native channels; daily statistics aggregate managed request records.
**Tech Stack:** Go/Gin/GORM, React 19, existing UI primitives and chart dependencies, Bun/Vitest/Rsbuild, GitHub Actions.
**Spec:** docs/superpowers/specs/2026-11-13-managed-admin.md

## Global Constraints
- Edit overlay and patches source, never generated .upstream as authoritative source.
- Preserve existing multimodal behavior and legacy model IDs; no automatic retry/fallback.
- No secrets in responses, logs, commits or test artifacts. Maintain request-hash proof and audits.
- Branch only, no client code scope. No buyer messaging. Keep deployment rollback and data.

## Review Focus
- Existing installations with three legacy channels migrate without losing keys or assignments (Task 1).
- Concurrent changes cannot enable a configuration tested under another key/endpoint (Task 1).
- UTC+8 midnight boundaries and missing/zero usage have truthful separate totals (Task 2).
- Modal navigation preserves drafts and never submits another API's key (Task 3).
- SMTP and disabled social providers survive deployment, mobile layout remains usable (Task 3/4).

### Task 1: Real managed model catalog and independent API channels
**Files:** managed-server/overlay/{lingtu,lingtuhost}/ model-related Go files/tests; managed-server/patches.json only when necessary; controller native integration helpers only when necessary. Do not edit admin_usage.go or frontend.
**Interfaces:** Extend GET /api/lingtu/admin/config with model_catalog and model_connections sanitized arrays. Keep model_providers/policy/login_providers/smtp legacy fields. POST /config section=model_connection uses provider, connection_id (0 new), name, secret, clear_secret, base_url, upstream_model, enabled, make_default, action (save/test/delete/select). Return saved response plus sanitized state, tests never expose provider secrets. Exact DTO/interface documented in docs/MANAGED_MODEL_API.md for next implementer. Use existing exact security proof wrapper.
- [ ] Write failing migration, independent channel CRUD/routing, secret-retention/non-disclosure, stale test, default selection and invalid URL tests.
- [ ] Run targeted tests RED. Prepare via node scripts/prepare-managed-server.mjs (reference existing pinned checkout to avoid unnecessary transfer).
- [ ] Implement native catalog (28 providers from approved prototype, actual adapter types/credential requirements), managed metadata, legacy migration and explicit selection. Preserve native encryption, transaction abilities and no-retry token restrictions; generic models supported in trial/account validation and chat routing. Selfhost URL is administrator-controlled, validate URL scheme/userinfo; public providers reject private endpoints. Specialized adapter fields must be clear and validated. Keep save vs test failure truthful; no silent default switch.
- [ ] Run Go targeted tests GREEN, document DTO/security/migration, self-review and commit only owned files.

### Task 2: Daily actual usage aggregation
**Files:** managed-server/overlay/lingtuhost/admin_usage*.go, admin.go route registration; usage snapshots lingtu/token_usage.go and chat.go if Task1 did not already add them.
**Interfaces:** GET /api/lingtu/admin/usage-daily?days=7|30&model=optional returns timezone Asia/Shanghai, days, today, totals, items date/model/input_tokens/output_tokens/total_tokens/requests/unknown_usage, model options. Empty days zero-filled; unknown usage separate. Native admin auth retained. Contract documented docs/MANAGED_USAGE_API.md.
- [ ] Write failing tests UTC+8 midnight, range/model filtering, zero vs missing usage, empty days and rejected params.
- [ ] Implement cross SQLite/MySQL/Postgres portable aggregation, query only bounded requested range, no all-history load. Preserve existing summary/details API.
- [ ] Run targeted Go tests GREEN; review query/totals and commit.

### Task 3: Approved clear React UI wired to real APIs
**Files:** managed-server/overlay/web/src/features/lingtu/{admin-page,admin-usage,admin-light.css} and focused new components/tests; managed-server/translations.json.
**Interfaces:** Consume docs/MANAGED_MODEL_API.md and docs/MANAGED_USAGE_API.md and existing secure save callback; no fake statuses or stats. Reuse existing chart library, native dialog/inputs, no new heavyweight dependencies.
- [ ] Write behavior tests independent API editing, drafts, secret omission, defaults, login card status, usage days/model filters, errors/empty states and navigation.
- [ ] Port v10 clear sidebar/cards/modal and overview to React with real config/status; preserve account/trial/reconcile/audit functionality and translations. General fields dark/readable 14px; model names 19px, titles 26px; mobile no page overflow.
- [ ] Run frontend typecheck, Vitest, build and route/browser checks. Self-review and commit owned files.

### Task 4: Integration, CI artifact acceptance and deployment
**Files:** scoped workflow if branch dispatch needed; docs delivery record.
- [ ] Review full branch, fix findings, run required relevant local/root checks and CI full build/database matrix. Push scoped feature branch and Draft PR associated with claim.
- [ ] Download and verify same-run Linux/web artifacts, run isolated actual browser/API acceptance and migration rehearsal; preserve rollback and encrypted production secrets.
- [ ] Deploy independent release on existing mainland service, restart and verify health/pages/auth/statistics and existing actual model path. Try existing Sites project account access and publish same-build frontend when permitted; never replace inaccessible private site.
- [ ] Record actual results, limitations and release claim; final concise Chinese outcome with real URLs and remaining blockers.
