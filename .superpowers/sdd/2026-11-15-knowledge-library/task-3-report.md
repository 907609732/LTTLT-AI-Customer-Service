# Task 3 — Catalog-first PDD read-only collection

Status: implemented, self-reviewed, committed locally; real-store multi-page and live CDN acceptance remain unverified because user desktop control is physically stopped by Escape. Base `846ace9`, branch `codex/knowledge-library-refactor-20261115`, assigned worktree only. No push, release, platform edit, real buyer message, paid model, visible test window or other worktree restart.

## Completed scope

- Reused `electron/pdd-learning-provider.ts` instead of duplicating its DOM/native response reader. Existing semantic goods list/on-sale filter, fixed native query observation, page cursor verification, per-store partition, identity checks, native detail-entry click, SKU viewport/native response merge, and exact 900009 handling remain the owners. Added typed optional `catalogOnly`, `productIds` and `quiet` paths; old `collectProducts` defaults retain their semantics. Chat behavior is unchanged.
- Catalog-only inspection opens only the independent collection WebContents in the already registered store partition/UA, without detail reads or reception navigation. Missing adapter/login is an explicit capability reason; assembly uses the provider directly, bypassing the old `platformLearning.identity` wrapper that opens reception.
- Main-owned 30-minute catalog snapshots retain identity, search, native cursor and verified physical IDs. Search covers actually read title/ID rows. Cross-page selection preserves count and original filter; all-filter selection requires all pages, no duplicates, consistent declared total and complete range. Unknown totals, partial pagination, caps or duplicate pages never enable it. The selected IDs are checked again against the actual native page before detail reads.
- Dedicated `KnowledgeCatalogDialog.vue` keeps business UI focused: shop/filter/count, unknown-scope reason, disabled full-filter selection, explicit IDs, next page and selected count. No component network/filesystem/Electron access. Product/SKU family mapping boundary now accepts root + all 1000 schema-supported SKUs (1001 identities), while rejecting 1002; no native reader limit was expanded.
- Persisted per-product catalog snapshots, full raw platform details, actual page scope/cursor, detail limitations and per-image status. Raw capture metadata stays separate from static dependencies. Existing root/SKU mappings are reused; newly collected products establish bindings and original sources only. Nothing is published or added to approved answer retrieval.
- Stable static material excludes capture time, price, stock and request metadata. SKU identity/spec/code/barcode stay independent. Known ephemeral image signature parameters normalize only in stable materials, preserving original URLs in raw/capture sources. Actual text/static or registered-image-byte changes invalidate dependent publication through the repository; manual entries without those source dependencies survive.
- Store/SKU dynamic sources preserve original capturedAt, price and stock separately. A complete new snapshot which omits a previously recorded SKU marks its dynamic source `availability: not-listed`, withdrawing prior dependent dynamic facts without deleting or remapping the binding. Partial snapshots do not infer absence.
- Image bytes use the same verified Electron Session, only URLs registered from a current native detail and only HTTPS pddpic.com/yangkeduo.com domains. Credentials remain Session-owned. Redirects, arbitrary renderer/import URLs, SVG/unknown MIME, mislabeled bytes and oversized responses are rejected. 10 MiB per image and 50 MiB cumulative per product; bounded stream, deadline, cancellation and identity checks. Successful bytes become SHA256 assets, failed/unsupported counts and original URLs remain visible. A failed refresh retains previously captured bytes plus explicit failure provenance rather than silently erasing them.
- Durable collect jobs return jobId before platform I/O. Each product material/asset/checkpoint commit is atomic in SQLite. Pause/cancel are independent of pending reads; task status/controller, current account/store and the complete root/SKU binding set are checked after awaits and immediately before writes. New bindings appearing during a read also reject it. Checkpoints include bindings first created by this job, so subsequent items/resume do not misclassify the job's own SKUs as external changes.
- Login/captcha/unknown platform errors pause. Native restricted detail and image gaps are `needs-confirmation`, never false succeeded; explicit resume retries partial items while keeping already successful products/source versions. Cancelled jobs cannot resume. Queued collect jobs become paused on repository reopen, just as running jobs do; there is no automatic platform resume.
- A single registered dispatcher owns future source/learn/daily extension seams. Removing a shop/disposal runs every handler's cancellation even if an earlier handler reports a cleanup error. Migration read-only state exposes collect=false rather than advertising a writable task.

## Files and reuse

New business modules: `electron/knowledge/collector.ts`, `collector-materials.ts`, `pipeline.ts`. New focused component: `src/modules/knowledge/components/KnowledgeCatalogDialog.vue`. Existing provider and `local-runtime.ts` receive narrow reuse/assembly changes; manager controller/view only receive catalog behavior/props. Repository change is limited to queued collect recovery, shared knowledge-client change to the 1001 family boundary. Tests: new `tests/knowledge-collector.test.ts`; directly affected provider/manager/runtime test files extended. Documentation: KNOWLEDGE_LIBRARY.md, ARCHITECTURE.md and module README.

Reuse decision: inspect and extend the project-owned reader, verified source docs (`PRODUCT_KNOWLEDGE.md`, `PLATFORM_PRODUCT_DETAILS.md`) and sanitized fixtures. Existing Electron43, Zod, Node24 SQLite, repository asset/version/job facilities and Vue3 are sufficient. No new dependency, package-lock change, external implementation copy, private endpoint replay or vendor edit. Prior documented SDK comparisons remain references, not a claim that their maintenance or coverage was revalidated this turn: https://github.com/asialong/pinduoduo-sdk ; https://github.com/dtapps/pinduoduo . Existing native Electron Session API: https://www.electronjs.org/docs/latest/api/session . No new external search received private code/customer material.

## Stable APIs / assembly for Task4 and Task5

`electron/knowledge/pipeline.ts` exports:

```ts
interface KnowledgePipelineHandler {
  handles(input: KnowledgePipelineInput): boolean
  request(input: KnowledgePipelineInput): Promise<KnowledgePipelineResults[keyof KnowledgePipelineResults]>
  capabilities(storeId: string): Promise<Partial<KnowledgePipelineCapabilities>>
  removeStore(storeId: string): void
  dispose(): void
}
createKnowledgePipelineCoordinator(): KnowledgePipelinePort & {
  register(handler: KnowledgePipelineHandler): void
}
```

`local-runtime.ts` now constructs `knowledgePipeline` after `learningProvider`, registers the collector and calls `knowledge.setPipeline(knowledgePipeline)` **once**. Task4 should register source/import/estimate/learn handlers on this same object after its required services are assembled. Task5 registers its daily handler there. Do not call setPipeline again. Each handler routes controls by its own persisted job kind; collector claims catalog, start(kind=collect), and pause/resume/cancel only for collect jobs. Capabilities are OR-merged by field; only actual installed features return true. Lifecycle cleanup invokes all registered handlers; failures aggregate after cancellation attempts. Request parameters remain the existing strict shared schema, with no new IPC.

Collector factory:

```ts
createKnowledgeCollector({
  repository,
  provider: Pick<ReturnType<typeof createPddLearningProvider>, 'identity' | 'collectProducts'>,
  readImage?: (input: {identity; url; signal}) => Promise<{bytes: Uint8Array; mimeType: string}>,
  assertActive, getStore, changed?,
}): KnowledgePipelineHandler
```

This factory owns explicit collect jobs only, not a scheduler or a generic import/model executor. `readImage` is wired to `learningProvider.readProductImage`. All factory APIs are main-only. Daily logic can reuse the existing provider's quiet catalog/selected paths and the synchronous material writer below, with its own current-job/account/store/binding lease checks; it must not invoke the old reception-opening identity wrapper or treat a prior expired catalog token as current.

Provider stable additions:

```ts
type PddProductCollectInput = PlatformLearningCollectInput & {
  catalogOnly?: boolean
  productIds?: readonly string[]
  quiet?: boolean
}
collectProducts(input: PddProductCollectInput): Promise<PlatformLearningPage<PlatformLearningProduct>>
readProductImage({identity, url, signal}): Promise<{bytes: Uint8Array; mimeType: string}>
```

Use the returned provider cursor for a page's selected IDs; no guessed detail URL. Image URLs are accepted only after this provider has seen them in the verified detail for that identity. Read-only images on unsupported hosts remain a recorded unsupported source, not a general main-process proxy. Daily calls should set quiet=true.

`collector-materials.ts` exports `createCollectorMaterials(repository)` and `collectorMaterialLabels`:

- `static`: 平台静态资料 — static product content/spec/code/barcode, no time/price/stock.
- `images`: 平台图片资料 — stable image lineage and registered assetIds. Actual byte changes revise this source.
- `dynamic`: 平台动态快照 — each store/SKU binding only, original capturedAt; missing-in-complete snapshot can be not-listed.
- `capture`: 平台采集范围 — latest actual capture time, scope/cursor, detailStatus/note and image capture failures. Original signed URLs retained here.
- `catalog`: 平台目录快照 — raw actually visible list material, capture time and scope/cursor. Contains list price/status and is **not** a static-answer dependency.

Synchronous writer methods (caller must validate current main-process job/account/store/binding lease immediately before calling):

```ts
write(storeId, platformDetail, images: CollectedImage[] = [], coverage?: {scope: string; pageCursor: string|null})
  -> {binding, staticSource, imageSource}
writeList(storeId, {id,title,description,specifications,sourceUrl}, capturedAt, coverage?) -> binding
interface CollectedImage { url: string; assetId?: string; error?: string }
```

Writer reuses the existing full-detail SQLite adapter for raw lineage/SKU identities and repository.saveSource for immutable revisions/invalidation. It is synchronous and participates in an outer repository.transaction. Collector wraps source/asset writes and job checkpoint together. Task4 must choose static/image sources deliberately, keep exact source revisions, treat raw/capture/catalog as provenance, and handle each SKU dynamic source with capture-based expiry and its actual binding. Do not use the complete raw snapshot as every static draft's dependency. No parser/model results may call publish/learnCorrection here.

Persisted collect payload version1: identity, records[{item,cursor}], explicit productIds, initial binding leases, human scope. Checkpoint: completedIds, issues, bindingLeases, lastBindingId. Successful/partial source commits and checkpoints occur in one transaction. Resume uses this durable state, not renderer-echoed scope. Existing-binding refresh can use bindingIds after an explicit current catalog established its identity; the worker locates IDs through verified native catalog pages. First collection uses catalog selection without bindings. New daily jobs should own their separate payload/checkpoint format/kind.

## RED / GREEN evidence

1. Provider regression first produced **2 failed / 13 passed**: catalog-only incorrectly entered detail and failed `detail must remain unopened`; an absent selected product incorrectly resolved. Factored optional paths then **15/15**. This was behavioral RED against the original provider.
2. Material split tests first produced **2/2 failed** because only the previous complete raw snapshot existed. After static/image/SKU sources: both passed, including approved static citations surviving price/time-only updates and manual knowledge surviving static invalidation.
3. Initial job scaffold **3 failed / 2 passed**, with `采集尚未接入`; implemented dispatcher/collector then **5/5**. Subsequent real-SQLite tests cover prompt start while I/O blocked, independent cancellation/late result exclusion, all-scope validation, duplicate native pages, unknown total, partial/image evidence, binding removal, pause/resume, per-product checkpoint/duplicate revision and cleanup.
4. UI regression failed because unknown all-selection silently proceeded; fixed local guard and pinned filter. A later test assertion was narrowed to catalog calls because normal search refresh legitimately also requests capabilities. Actual final component test verifies disabled unknown shortcut, cross-page count and enabling only complete scope.
5. Four additional real behavioral REDs: image-signature capture changed static source revision2 instead of1; queued collect reopened as queued instead of paused; partial resume stayed needs-confirmation; family schema rejected 1001. All fixed and the same two files **23/23** at that checkpoint.
6. Binding-set RED: new SKU inserted during awaited detail produced succeeded. Added complete membership lease; then the existing two-product success test exposed stale local checkpoint bookkeeping. Fixed by rereading the durable checkpoint; both newly created own SKUs and external membership changes now distinguish correctly.
7. Cleanup RED stopped after first handler; changed dispatcher to attempt every handler. Removed-SKU RED retained approved old dynamic facts; complete-snapshot not-listed source now stales them. Scope-provenance RED had undefined scope; capture/list layer now retains exact actual page scope/cursor, outside static hash.
8. Final read-only RED advertised collect=true against an actually migration-failed SQLite repository. Capability now exposes collect=false; final collector **16/16**. Final context regression also exposed an old-shop catalog surviving a manager shop/context switch; closeEditor now clears catalog scope/selection before switching, and manager16/16 passes. No unresolved test failure is omitted.
9. Added image API initially failed as a missing function (scaffolding/API absence, not claimed as behavioral security proof). Final tests exercise registered current detail image bytes, arbitrary URL rejection, identity change, SVG/oversized/mislabeled responses, verified zero versus unreadable rows and quiet failures.

## Commands and actual results

All from assigned client root; no full npm check/full upstream/release suite.

- `npx vitest run tests/platform-learning-provider.test.ts tests/knowledge-collector.test.ts tests/knowledge-manager.test.ts tests/knowledge-runtime.test.ts tests/knowledge-repository.test.ts tests/knowledge-migration.test.ts tests/collected-products.test.ts tests/workspace-runtime.test.ts` — **8 files,95/95 passed** before the final read-only capability and context-clearing regressions. Final changed manager rerun `npx vitest run tests/knowledge-manager.test.ts` — **16/16 passed**. Final changed collector rerun `npx vitest run tests/knowledge-collector.test.ts` — **16/16 passed** (overlapping tests, not127 distinct; two added cases in total).
- `npx vue-tsc --noEmit`; `npx tsc -p tsconfig.electron.json --pretty false` — exit0. Strict standalone owned backend-test imports command with es2022/esnext/bundler, DOM+DOM.Iterable, node+vitest types — exit0. Final restricted lint/Prettier, `node scripts/check-boundaries.mjs`, `npm run build:desktop` and `git diff --check` all exit0; Prettier reports all matched files use its style.
- Restricted ESLint on collector/materials/dispatcher/repository/provider/local-runtime, changed shared contract, manager/component files and four changed test files — exit0.
- `npm run build:desktop` — exit0; existing production main/preload bundle.
- `node scripts/verify-knowledge-manager.mjs` — exit0; **9 actual hidden/offscreen checks**, temporary real SQLite/runtime/preload, loopback model, no real platform. This verifies existing manager route/assembly, independent shops, draft autosave, reviewed trial/training resolver, 150% overflow, hide/close, no old JSON constructor writes and citation withdrawal. It is integration regression evidence, not live collection acceptance. Evidence `artifacts/knowledge-manager-check/evidence/report.json`, `manager-1280.png`, `manager-review.png`, `manager-150-percent.png`.
- `node artifacts/knowledge-catalog-check/run.mjs` — exit0; actual compiled KnowledgeCatalogDialog/Vue in an isolated hidden/offscreen Electron, **3 checks**: unknown full-selection disabled, cross-page count visible, complete full-selection enabled/no document overflow. Inspected actual `catalog-incomplete.png`; dark panel, all rows/controls/counts readable and no horizontal clipping. Evidence also `catalog-complete.png`, `report.json`. The first probe capture failed UnknownVizError; software rendering/backgroundThrottling=false fixed the isolated probe only. No production graphics setting was changed.
- Native runs emitted Windows `WSALookupServiceBegin 10108`; renderer build retained existing Zod annotation and large-chunk warnings, with successful exit/checks. No visible test window or desktop automation tool was used.

## Limitations / next work / acceptance

- **Unverified live:** new actual multi-page PDD catalog+selected capture, current live image CDN/format behavior and real login/captcha recovery. Existing source docs/fixtures were reused, not presented as a new live run. Desktop/browser control remained Esc-stopped throughout; no SKY/CUA/Ego operations or visible apps were launched.
- No parser/source chooser/model extraction, estimate/model billing, OCR/scanned documents, daily scheduler or publication implementation (Tasks4/5). Import/learn/daily capabilities stay false. Existing approved knowledge remains the only reply material.
- Images may be restricted by CDN host, redirect, format, size, deadline or session; failures preserve provenance/counts and partial state. MIME/signature validation is not a claim that all image contents were visually understood. Static facts from image bytes need Task4 model handling plus review.
- 1000-product throughput and 1000-SKU native extraction performance were not benchmarked. Contract mapping accepts root+1000; no claim of a new live maximal-SKU sample. Catalog bounded to1000 pages/10000 rows; each task1–1000 selected products. All shortcut disabled beyond task capacity; explicit batching required.
- Search is verified-page filtering until all native pages have been read, with unknown filtered total beforehand. Catalog tokens are volatile for30min; jobs persist copied exact records/identity/checkpoints. New collection requires a refreshed catalog after restart; existing paused jobs keep their durable scope but still reverify native identity/pages before writes.
- Paused/in-flight tasks cannot resume until the old worker observes cancellation and stops; the response says it is still stopping. This prevents simultaneous old/new provider work from sharing a window. Account disposal can prevent a final paused write; repository reopen normalizes both running and queued collect to paused.
- Root controller should independently review this commit before Task4. Task4 attaches a source/learn handler to the existing dispatcher and consumes stable source revisions/assets; Task5 adds quiet capture-based daily dynamic checks without broadening reply, send or publish authority. Real-store acceptance must wait for actual resumed user-control capability and should record exact native pages/counts/unsupported images.

## Fix round 1 — Important I1, base `5ee7e7f`

Scope: only the blocking lease-loss defect from `task-3-review.md`. M1 image registry capacity and M2 known validation warnings remain deferred minors for the controller's final acceptance. No Task4/5 work, user desktop/browser/visible window, real service or model, dependency, public contract or unrelated suite change.

Root cause confirmed in the actual collector: resume removes partial product IDs from `done`, and each successful retry rebuilt `checkpoint.bindingLeases` from that reduced completion set. With two newly collected partial products A/B, both families initially existed only in the checkpoint ledger (four bindings, with no preexisting payload leases). Retrying A discarded B's two previously owned identities, so the unchanged membership guard thereafter treated B as an external insertion.

The checkpoint ledger now accumulates independently of retry completion: retain every exact prior persisted `{id, revision}` and merge only the current synchronous transaction's product family after source writes. Other products' revisions are not refreshed from the current repository. Existing pre-write lease and full-membership checks still reject external changes. No new checkpoint key, schema/payload version or consumer API is required.

Added three actual temporary-SQLite variants in `tests/knowledge-collector.test.ts`: two previously unbound products both partial → four committed root/SKU leases → resume complete A and block B → verify all four exact leases remain → explicit pause → dispose/reopen the real repository and construct a new coordinator → resume. Unchanged B completes with progress2/2 and no duplicate static source revision; externally adding a B SKU or changing B's root binding revision instead pauses and preserves B's prior partial capture and all original ledger entries.

RED command: `npx vitest run tests/knowledge-collector.test.ts`. Before the production fix: **3 failed / 16 passed (19 total)**. All three new variants failed at the checkpoint invariant: actual2 leases versus original4. GREEN, same command after the fix: **19/19 passed**, 1 file, exit0. This is behavioral reproduction against the real collector/dispatcher/SQLite, not a mocked lease-map assertion alone.

Final restricted checks, all exit0:

- `npx tsc -p tsconfig.electron.json --pretty false`.
- `npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --lib ES2022,DOM,DOM.Iterable --esModuleInterop --skipLibCheck --types node,vitest/globals tests/knowledge-collector.test.ts`.
- `npx eslint electron/knowledge/collector.ts tests/knowledge-collector.test.ts`.
- `npx prettier --check electron/knowledge/collector.ts tests/knowledge-collector.test.ts` — All matched files use Prettier code style. Report formatted and checked separately.
- `git diff --check`.

Only collector.ts, its owned test file and this report changed. No broad unchanged test suite, renderer/desktop build or native/live acceptance was rerun for this focused fix. The original real-platform and throughput limits remain unchanged. This prevents new ledger loss; it does not silently adopt already missing identities from an older corrupted checkpoint, because doing so would also accept indistinguishable external bindings. Such a previously corrupted local test job remains fail-closed and requires a fresh explicit collection scope.
