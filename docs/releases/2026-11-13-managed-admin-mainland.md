# Managed admin mainland release — 2026-11-13

Mainland production: https://account-kefu.lttlt.top/lingtu/admin

## Published identities

- Backend source: `667b7e216c1ccf3a60a2b56110bf98be6e058d9c`, [successful build 43287326917](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/43287326917).
- Final frontend source: `223e923b73fbad1364395d675e86264637d0a8dc`, [successful build 43433295933](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/43433295933). SQLite, MySQL and PostgreSQL race/migration checks and web checks all succeeded.
- Current release: `/opt/lingtu-kefu/releases/223e923b73fb-web`.
- Frontend index SHA256: `bada132c9c2eddeaea56fb7d95d9f77239949e3d318ab01d8b38710932d6416c`.
- Running backend SHA256: `471c08a3636d0b0897911eb717ed8023b6740dfc0595ad6f444ab421cae742e7`.
- Initial backend activation: 2026-11-13 21:09:37 Asia/Shanghai. PID `3886503` remained unchanged during the final frontend-only update. The newer CI binary was downloaded and verified but intentionally not activated: subsequent changes are frontend-only.

## Delivered behavior

The approved white-sidebar admin UI consumes real authenticated APIs. It supports 28 native provider configurations, separate encrypted API connections, explicit default selection, saved-configuration tests, native verification and revision checks. The default and per-account model assignments are preserved. Login cards distinguish actual email/WeChat/DingTalk configuration and enabled states. Daily usage uses recorded requests/tokens and historical model/API snapshots, with 7/30-day periods and model filters; missing usage is not estimated.

Reused pinned [New API](https://github.com/QuantumNous/new-api) native adapters/encryption/authentication (AGPL-3.0-or-later), existing React/Base UI and Recharts dependencies. No client/reception code or new dependency was introduced. Existing source/license links remain in the UI.

## Actual acceptance

- SHA-verified same-run artifacts; initial Linux/web archive verified before extraction. An isolated `PrivateNetwork` systemd rehearsal ran against a private SQLite/key/environment backup; status returned 200 and unauthenticated daily admin access returned 401/403.
- Before/after rehearsal equality: users 1, managed accounts 1, grants 1, usage records 11, request records 11. Encrypted channel keys, SMTP/registration options, the complete trial policy, account assignments and grant values were preserved.
- Existing retained data: 11 successful client calls, 3,074 input tokens, 565 output tokens, total 3,639. Actual 7/30-day UI totals agree; today has zero calls. Historical rows without API snapshots show unknown API rather than reconstructed current configuration.
- Clone query measurements: 7-day 11 rows / 0.163 ms; 30-day 11 rows / 0.051 ms. Existing query scans request timestamps and joins through the usage unique index; these small-data timings do not establish large-ledger scalability.
- Final public API status 200, TLS verification result 0, unauthenticated daily admin endpoint 401. Final public index matches the final CI artifact.
- Authenticated browser: sidebar navigation, configured-first model cards, existing DeepSeek/default binding, independent unsaved API draft, 560px desktop detail dialog, email-enabled/registration-enabled/verification-enabled statuses, unconfigured WeChat/DingTalk, accounts and real usage data load. The existing device-confirmation page and switch-account action remain accessible; no device binding was submitted.
- Final chart geometry: desktop plot width 1,019px; 390px emulated viewport has document width 390px and plot width 326px. Temporary viewport override was cleared.
- Live acceptance found and fixed login autofill into configuration secret fields (`23f5da5`, `a4fe58b`); after the final artifact reload, model/SMTP/social secret fields remain blank and use `new-password`. No autofilled credential was read, logged or submitted. This follows [MDN guidance](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Turning_off_form_autocompletion).
- Live acceptance found and fixed a Recharts incompatibility (`223e923`): `max-width:100%` capped the chart against the library's zero-width overflow-visible intermediate container. Removing that override restored actual plot width; the existing responsive container remains responsible for sizing.
- Final frontend update transfers 5 changed files (1,613,936 bytes), retains old chunks, and verifies the complete 1,846-file new-CI manifest before switching. Missing/corrupt reused-file and identity-mismatch offline fixtures fail closed. Helper source/hash reviewed; no service restart or database write in this update.
- Public email verification request to the user-designated recipient returned `success:true` after backend activation. Inbox receipt was confirmed in the earlier SMTP setup session, not reconfirmed for this particular verification message.
- Local native frontend suite: 36 tests across 7 files; after shared-field refinement, 18 admin tests rerun. Native typecheck (1,428 files), focused lint and final build passed. Root typecheck, 219 tests and build passed. Prior full root E2E was interrupted at 84 passes and is not reported as a complete pass. Broad pre-existing native fixture/lint failures remain outside the bounded checks documented in task reports.

## Operational boundaries and rollback

- No whole-instance reboot, proxy, DNS, certificate, security-group or unrelated-site changes were made. Earlier connection failures recovered without a VM reboot.
- Private pre-migration backup: `/opt/lingtu-kefu/backups/20261113T130920Z-before-admin-667b7e216c1c`. Contains protected data; do not expose or commit it.
- Final frontend rollback target: `/opt/lingtu-kefu/releases/667b7e216c1c-admin`; initial backend rollback target: `/opt/lingtu-kefu/releases/31718e2-web`. Preserve release directories, backup and acceptance records. Hold `/opt/lingtu-kefu/.web-deploy.lock` before a rollback. Do not blindly restore the old database over current business data.
- Real credential acceptance for all 28 vendors is not claimed. Only the existing DeepSeek connection has production credentials. A new protected live provider probe still requires native administrator verification; no password/proof bypass was used. WeChat and DingTalk remain unconfigured until valid platform credentials are supplied.
- Browser screenshot capture timed out in both browser tool paths. Functional DOM and actual layout measurements are recorded; a screenshot-based visual-completion claim is not made.
- Existing certificate remains in place and public TLS validates. A forced automatic renewal was not executed/verified during this release.
- Overseas Sites writing remains unavailable with the connected account. The user explicitly chose mainland-first; the existing overseas site and permissions were preserved, with synchronization deferred.

PR: https://github.com/907609732/LTTLT-AI-Customer-Service/pull/21 — scoped ownership remains in Issue 20 until integration/release of that claim.
