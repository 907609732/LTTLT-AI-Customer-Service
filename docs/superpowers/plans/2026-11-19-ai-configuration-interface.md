# AI configuration interface implementation plan

> For agentic workers: execute with subagent-driven-development or executing-plans, following the existing authorized DeepSeek implementer / Codex acceptance workflow.

**Goal:** Let local AI clients inspect and safely edit reply pacing, store welcome and store vision enabled settings through MCP and CLI.
**Architecture:** Both adapters invoke the current authenticated loopback agent service. Configuration tools use a fixed allowlist, current workspace/store identity, expected content version and existing runtime commands; never forward arbitrary commands.
**Tech Stack:** TypeScript, Zod 4, existing official MCP server/client 2.4.0, Node 24, Electron 43.
**Spec:** docs/superpowers/specs/2026-11-19-ai-configuration-interface-design.md (user approved 2026-11-19).

## Global constraints

Preserve existing tools; no dependency or vendor changes. Do not use real business data in tests or alter real settings. Version 1.0.68 advances once to 1.0.69, with lockfile synchronized. Keep credentials, login, AI enable/send mode, debug terminals and arbitrary commands inaccessible. Keep other work and untracked vision design files intact. Source restart is owned by supervising Codex after integration.

## Review focus

Unknown fields must fail without writing. Old workspace/store/version must fail. A preview must never mutate settings. Store settings with absent/default records must work without replacing neighboring fields. A simultaneous UI save must not be lost between version check and persistent save; use the existing native CAS fields. Repeat request IDs must not duplicate or change writes. CLI timeouts must not retry uncertain writes or print secrets.

### Task 1: Configuration contract and service

Files: src/shared/contracts/agent.ts; new src/shared/contracts/agent-settings.ts; new electron/agent/settings.ts; electron/agent/service.ts; tests/agent-settings.test.ts; existing tests/agent-interface.test.ts.

- [x] Write failing tests for schema/read/preview/apply on `reply-pacing`, `welcome`, `vision`; verify RED.
- [x] Add fixed tools `lingtu_config_schema`, `lingtu_get_config`, `lingtu_preview_config`, `lingtu_apply_config`. Except schema/status all carry current workspaceId; store groups carry storeId. Apply carries requestId and expectedVersion returned by get/preview. Preview/apply accept a strict partial patch; reject empty/unknown fields. Expose only vision.enabled (not profiles/credentials).
- [x] Implement getAgentConfig/preview/apply helpers with typed input and fixed outputs: group, scope, version, current/effective settings, plus changes for preview; content hash is acceptable for expectedVersion. Preserve unpatched fields. Reuse save-config REPLY_PACING/save-welcome/save-vision-settings and their native CAS expected values; inspect the actual handlers before mapping.
- [x] Run targeted tests for persistence, preview, stale/unknown identity, concurrent changes, duplicate request ID and no sensitive output. Verify GREEN; record RED/GREEN evidence in artifacts/ai-configuration.

### Task 2: MCP and CLI adapters

Files: electron/agent/mcp-server.ts; new electron/agent/cli.ts and connection helper if useful; scripts/build-electron.mjs; config/electron-builder.json; package.json; package-lock.json; tests/agent-config-cli.test.ts; tests/agent-interface.test.ts.

- [x] Add failing standard MCP client tests for new tools including readOnlyHint=false on apply and destructiveHint=true for replacing configuration. Add CLI subprocess tests for help/status/config schema/get/preview/apply, malformed input, failures and connection-file override.
- [x] Build `lingtu-cli.cjs` separately from stdio; use node:util parseArgs (built-in mature parser) and existing callLocalAgent. CLI `config schema/get/preview/apply --json <JSON>` accepts JSON via argument or stdin, supports --connection-file and --help, emits structured JSON and nonzero exit on failure. Never automatically retries writes. Publish source npm `ai` convenience script and ship connector in resources/ai-interface alongside MCP.
- [x] Run both adapter test files plus unchanged agent-interface baseline; build affected entry points and typecheck. Update patch version once.

### Task 3: Documentation and acceptance

Files: docs/AI_INTERFACE.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/HANDOFF.md, docs/VALIDATION.md.

- [x] Document exact CLI/MCP invocation, field discovery, version/requestId semantics, defaults, failures and running-app prerequisite. Remove old statement claiming no config changes allowed and replace with precise allowlist.
- [x] Run targeted tests, affected ESLint/Prettier and build. Record actual coverage and limits. Commit only task files after tests pass, no push/deploy/restart by worker.
- [x] Codex independently review output and run targeted verification, resolve material findings, integrate branch and reopen latest project source. Preserve real profile and do no live config writes for testing.

## Progress

- Completed: main integration accbcc3/1.0.70; 50 focused tests and full typecheck/build passed before and after integration. Full cloud run 44350540091 succeeded; exact manifest/checksums, downloaded package smoke (10 checks), bundled connector equality and live source MCP/CLI readonly acceptance passed. Two stores and AI-off state preserved, zero real config writes. Later main 1.0.71 retains this feature; its separate delivery remains with its owner.

- Integration ruling: main advanced to be1755c with the separately accepted keyword autosave feature at 1.0.69. Merge that committed baseline into this isolated branch, preserve both handoff records, and deliver these AI interfaces at 1.0.70 to avoid a version collision. No uncommitted work from another task is moved or changed.

- Baseline: existing agent-interface.test.ts 8/8 passed on 2026-11-19. System Node v24.18.0 and installed MCP dependency available.
- Design and scope approved by user; routine implementation decisions delegated. Execution follows that authorization without another planning approval.
- 2026-11-19 worker: Task 1/2 and Task 3 docs/verification complete in isolated worktree; focused suite 35/35, typecheck/lint/format/boundaries/build exit 0. Commit recorded in artifacts/ai-configuration/worker-report.md. Codex review/integration remains.
