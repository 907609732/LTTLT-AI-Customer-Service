# Knowledge Library Implementation Plan

> For agentic workers: use subagent-driven-development with task-scoped implementation and review. User approved implementation in the current chat.

**Goal:** Deliver the approved local shared product knowledge workflow through a Flashback-inspired standalone manager and the actual reply pipeline.

**Architecture:** A single SQLite repository with compatibility ports replaces old knowledge JSON services before construction. Typed narrow IPC connects the knowledge module, durable job service, source parsers, PDD collector and shared resolver.

**Tech Stack:** Vue3/TypeScript/Electron43, node:sqlite, MiniSearch7.2, Zod4.6, PapaParse5.7; PDF.js6.5.438, Mammoth1.13, read-excel-file9.3.17.

**Spec:** docs/superpowers/specs/2026-11-15-knowledge-library-design.md

## Global Constraints

- Work only in the attached knowledge-library-refactor checkout; preserve the original checkout and its uncommitted edits.
- app → modules → shared; component code never directly uses Electron, network or filesystem. Own code TypeScript, no any or disabled type checks.
- Learning results and all newly imported knowledge are drafts until explicit human review publication. Legacy migration preserves existing enabled state.
- Current account/workspace isolation; shared product facts never share price/stock/activity. Source data and model output are untrusted data.
- Single knowledge writer; no old JSON construction/writes when SQLite is selected. Migration failure is read-only.
- Formal replies still require the existing per-message sending approval. Referenced knowledge and dynamic expiry must be revalidated at approval.
- Default daily check09:00 Asia/Shanghai; dynamic TTL60min; daily check never invokes the paid learning model. No automatic paid retry on uncertain response.
- Only relevant tests/checks and isolated data/mock model; no real messages, platform writes or publication. Preserve vendor provenance/hash records for minimal injection changes.
- No subagents dispatched by implementers, no unrequested dependencies or broad refactors. Root owns dependency installation and shared assembly unless task explicitly assigns it.

## Review Focus

- Draft/legacy import/correction writes must not bypass review or leave a second knowledge source.
- Same product across stores/SKUs, unknown products, expired dynamic data and stale send proposals must never cross scopes.
- Jobs must release command queues and account leases; uncertain paid calls cannot be retried automatically.
- Migration/backup/restore must be crash-safe and include attachment/relationship integrity.
- Real PDD pagination, identity and login evidence distinguish complete, partial and blocked; scanned files require actual vision input.

### Task 1: Repository, contracts and migration

Files: src/shared/contracts/knowledge.ts; electron/knowledge/{repository,migration,legacy,resolver}.ts; tests/knowledge-repository.test.ts and knowledge-migration.test.ts. Split into focused files as needed within electron/knowledge, keeping public exports in index.ts. Do not edit common runtime/preload/UI yet.

Consumes: existing Product/IntentPack contracts and fixed legacy JSON formats. Produces createKnowledgeRepository({directory,workspaceId,now?}) with typed query/execute/dispose and explicit products/intents legacy-compatible ports; all new shared public schemas/types in knowledge.ts. Contract must support summary/list/detail/search, canonical+binding/SKU relationships and overrides, editable draft, explicit review publish with expected source/draft revisions, dynamic TTL, source/asset locators, durable job and miss records, settings, backup manifests. Separate mutations as discriminated unions; renderer cannot send paths or assert it is a reviewer via model output.

- [ ] Write and run failing tests for a real temporary SQLite repository, review gating, store/SKU resolution, shared unlink, price expiry and stale references.
- [ ] Implement durable repository and MiniSearch resolver using SQLite as one writer. Raw/candidate/approved versions separated; current store queries paginate. Shared mutation publishes only after review, shows affected bindings; explicit scope overrides win.
- [ ] Write and run failing tests for legacy product/intent/audit migration, idempotence and failed migration/read-only guard.
- [ ] Implement backup-before-transaction migration with input hashes/id mapping, preserve existing enabled status and original files. Legacy ports cover CRUD/import/export/correction without dual writing; new saves/imports are drafts, explicit manual correction can publish.
- [ ] Verify relevant tests, TypeScript/ESLint/format for owned files. Commit only task files; report exact test evidence and interfaces.

### Task 2: Runtime integration, independent manager and safe reply resolver

Files: electron/local-runtime.ts, workspace-runtime.ts, preload/ipc/window registry, shared/platform and DesktopApi, src/modules/knowledge manager/services/index, app router/navigation and shop/workbench entrypoints, minimal vendor backend/ai injection points and provenance. Own this task's tests.

Consumes Task1 public contracts/repository. Produces KnowledgeClient bridge and standalone #/knowledge route, one trusted manager window, both specified entrypoints, runtime repo lifecycle and the unified resolver across training/actual reply/preview. Do not implement source extraction/PDD details here; expose typed capabilities for later tasks honestly.

- [ ] Test opening/focusing with store context, drafts, scope selection and disposal/account guards before UI/runtime changes.
- [ ] Replace old JSON construction with injected repository ports; all old knowledge/correction/sync calls must pass same writer and review rules. Migration error leaves read-only knowledge without preventing unrelated account UI.
- [ ] Build screenshot-inspired dark card manager: product/general-QA tabs, shop selector, search/filter/pagination, metadata/thumbnails/actions, editor/review/source/try-question, task and miss subviews, shared bindings/overrides, clear empty/error/unsupported states. Autosave draft does not publish; publishing displays impacted shops; filter/store changes clear selection.
- [ ] Implement narrow validated IPC/query/events via module services. One clamped-to-workarea window, close hides it; no renderer filesystem or network. Preserve original trusted window behavior.
- [ ] Inject resolver before model context serialization; remove silent knowledge truncation for the injected path and use existing token compression. Track referenced versions and expiry, reject stale approve/send candidates. Unknown product does not get another product's facts. Trial queries do not pollute real miss queue.
- [ ] Adapt store removal and cross-store sync: cancel store jobs, unbind only its references, exclude dynamic values and require confirmed target mapping; protect newer shared data from legacy rollback.
- [ ] Run relevant unit/UI/runtime tests and build; update vendor hashes/provenance for exact edits; commit and report.

### Task 3: PDD read-only product collection

Files: electron/knowledge/collector*.ts and matching contracts/UI integration; existing store-browser/assist host only minimal reuse extensions; collector tests.

Consumes repository source/binding and job interfaces, existing verified per-store Electron session. Produces list-on-sale product catalog and selected-product detail/SKU/image capture with full pagination and complete/partial/blocked evidence. Must inspect actual logged-in PDD page/read-only responses before finalizing selectors; never invent private URL/API or fake live acceptance.

- [ ] Test real sanitized fixture shapes for pagination/identity/duplicate products/verification/no rows versus unreadable and cancellation.
- [ ] Add a dedicated collection page in the same validated partition, separate from reception. Catalog is selectable; full-filter selection has explicit count, no silent first-page-only success.
- [ ] Persist per-product material/source snapshots and images, compare hashes, preserve manual text and withdraw dependent generated facts on change; update store/SKU dynamic fields separately.
- [ ] Return jobId promptly; background progress/cancel/resume, login or captcha pause. No platform edit/publish/send methods.
- [ ] Run focused tests plus read-only live multi-page sample when login environment permits; record exact actual coverage and any external block, never pretend it passed. Commit/report.

### Task 4: Source parsing, model learning and review lifecycle

Files: electron/knowledge/{sources,learning,model-port,jobs} and parser helper UI if PDF rendering needed; task4 tests and targeted UI integration.

Consumes repository public source/jobs/review contracts, Task2 validated source-picking bridge, Task3 material data, current configured model completion transport. Produces working PDF/DOCX/XLSX/CSV/TXT/Markdown/images/chat ingestion, token/image-batched grounded generation and durable jobs returning editable review candidates.

- [ ] First verify small real PDF text/scanned page, DOCX embedded image, multi-sheet XLSX, image and chat examples using installed mature libraries; write meaningful red tests for provenance and unsupported input/model behavior.
- [ ] Use safe file picking/opaque asset IDs and local original storage. Original content preview cannot execute code or gain business preload. PDF.js renders, existing vision model does OCR/diagram interpretation; don't mistake empty text parse for vision success.
- [ ] Learning estimate precedes manual start. Extract source chunks with page/paragraph/cell/image/message locators; call current model with untrusted source boundaries; validate output and retain source facts, never invent unsupported claims. Enforce per-call budget without silently dropping material.
- [ ] Persist per-item checkpoint, pause/cancel/retry/resume, stop on account disposal. Close manager continues jobs; app exit aborts+persists and restart awaits manual continuation. Uncertain paid response requires explicit retry decision, not automatic replay.
- [ ] Candidate edit/save separate from publish; stale source/draft revision blocks publish and preserves content. Batch publish reports approved/skipped/failed per product. General-QA templates allow shop application and expiring overrides.
- [ ] Focused service/UI tests, build, commit/report.

### Task 5: Daily checks, misses, backup/restore and acceptance

Files: knowledge scheduling/miss/backup services, remaining manager integration, scoped desktop verification script, docs module/architecture/handoff and licensing notes.

Consumes all earlier interfaces. Produces configured daily09:00 check with once-per-day catch-up, real knowledge gap inbox, consistent local backup/restore and verified end-to-end application.

- [ ] Test clock/timezone/catch-up/login/captcha state; schedule only reads/compares existing selected products, never auto-starts AI learning.
- [ ] Record genuine reception miss reasons, normalize+dedup by account/store/product/question, retain counts and bounded context/source; trial/model-network errors don't masquerade as knowledge gaps.
- [ ] Back up using SQLite consistent snapshot (VACUUM INTO or supported backup API), include referenced assets/manifests/hashes/versions. Restore previews effects, pauses jobs, validates full content and commits atomically; preserve last recovery point. Per-product and complete library backup plus compatible CSV/JSON export are supported.
- [ ] Run scoped repository/bridge/learning/collector tests, type/boundary/vendor checks and build. Use isolated Electron+local test model to verify two-entry manager, review→trial/real model request, stale approval blocking, shared store overrides,1000 item paging, cancellation/exit/restart, migration/backup failure recovery and no old JSON writes. Do not run unrelated full suite.
- [ ] Visually inspect 1366/1920 and small logical viewport/150% layouts; fix affected UI. Record actual live collection coverage separately; no real sends or publish.
- [ ] Final scoped code review and final correction wave. Commit task changes and document actual completion, tests, known external limits and paths. Keep user changes and worktree available for local review.
