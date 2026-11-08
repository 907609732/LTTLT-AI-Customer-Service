# Frontend/backend integration implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. User approved design and requested continuous execution.

**Goal:** Deliver the existing Figma client connected to the latest desk-v1 backend in one cloud-built Electron application.
**Architecture:** Compose reusable desk services in the existing main process. A guarded command/snapshot/event IPC boundary feeds React state and native Figma layer overrides. Platform sessions use separate controlled windows.
**Tech Stack:** Electron45, React19, TypeScript, existing desk-v1 CommonJS, zod, node:test, Playwright.
**Spec:** docs/superpowers/specs/2026-11-08-backend-frontend-integration-design.md

## Global constraints
- Preserve Figma source geometry, responsive baseline1440×900 and auxiliary width300.
- Production build/package only on GitHub. No real platform sending or AI network calls during tests.
- AI off on each application launch; secrets remain main-process encrypted storage.
- Existing unsupported business capabilities must fail honestly, not return demo success.

## Review focus
- Stop/pause during AI generation/jitter must block later sends (Task1).
- Foreign renderer cannot call management IPC and invalid store/conversation must reject (Task2).
- Event during snapshot load and auxiliary reload must not lose state (Task3).
- Native platform pages must not cover configuration or modal controls (Task2).
- Save failure and store switch must retain independent drafts without stale success (Task3).

### Task1: Backend baseline and safe cancellation
Files: desk-v1/src/main/reply-engine.js, desk-v1/test/reply-engine.test.js, package.json/lock.
- [x] Merge latest backend, install zod using existing npm, run original backend tests.
- [x] Add failing in-flight generation and jitter cancellation tests; run RED.
- [x] Guard async work by run generation and paused/stopped state before sends; run backend GREEN.
- [x] Commit focused backend fix.

### Task2: Service host and guarded IPC
Files: electron/backend.cjs, electron/main.cjs, electron/preload.cjs, tests/backend-integration.test.mjs.
Interfaces: createBackend({dataDir,onEvent,adapterFactory?,manager?,aiClient?}) -> {snapshot(),execute(command),dispose()}; snapshot includes stores/config/engine/conversations/selection/capabilities, never plaintext keys. Commands {action,storeId?,conversationId?,values?}. backend:execute,backend:snapshot,backend:event are guarded by current trusted sender check.
- [x] Failing tests for real disk stores/config and restart, AI initial off, unsupported commands, selected-store/session validation and sends, cancellation, history hydration, redaction.
- [x] Implement service composition using existing desk modules and bounded event/history state, separate platform host BrowserWindow and ShopWindowManager, no standalone desk entrypoint.
- [x] Register guarded IPC and event broadcast to both application windows; preload exposes only named methods.
- [x] Run unit and Electron dev checks; commit.

### Task3: Real data in existing Figma interface
Files: src/services/backend.ts, src/features/BackendProvider.tsx, src/features/BackendLayers.tsx, src/features/FrontendControls.tsx, src/App.tsx, src/design/FigmaCanvas.tsx, src/styles.css, src/design/types.ts, tests/e2e/backend.spec.ts.
Interfaces: window.lingtu.backendSnapshot/backendExecute/onBackendEvent; BackendProvider owns refresh/selected store/conversation and events, BackendLayers provides source-layer overrides for actual lists and counters. FrontendServices executes backend command for current real store and scoped config.
- [x] Failing E2E for empty actual stores, add/store selection, failures, initial loading, actual messages/selection/reply, independent store drafts and encrypted settings without key readback.
- [x] Preserve source art/geometry, override only business data regions; add store naming/platform selection and endpoint setup only as necessary source-styled dialogs.
- [x] Map real config drafts, reception/AI buttons and source menu confirmations to backend commands; missing capabilities explicit unavailable.
- [x] Run typecheck/unit/browser/Electron integration; visually compare affected screens; commit.

### Task4: Cloud and runtime delivery
Files: .github/workflows/verify.yml, package.json/lock, docs/IMPLEMENTATION.md, docs/FRONTEND_HANDOFF.md.
- [ ] Add backend tests/package files and integration checks to existing CI; bump version.
- [ ] Independent review, resolve important findings and required checks.
- [ ] Push feature branch and PR; cloud build/test/package; inspect failures and repair.
- [ ] Download same-run artifact, hash-check and actual local isolated-data acceptance; main merge only verified tree.
- [ ] Update DingTalk delivery/capability matrix and open new app for user.


Progress: independent code review findings resolved with7 backend integration tests. Backend127 tests pass; root41 before collection-state addition (expected42 after final full run);107 browser checks passed; actual Electron cross-window/restart/IPC checks passed. Cloud build and artifact acceptance pending.
