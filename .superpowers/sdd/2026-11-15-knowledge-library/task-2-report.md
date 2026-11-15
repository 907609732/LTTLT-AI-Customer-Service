# Task 2 delivery report — runtime, independent manager, reply resolver

Status: implemented and self-reviewed; ready for root's independent review. Base: `377b52e`. Work performed only in the assigned `knowledge-library-refactor/client` worktree. No production data, real store operation, paid model, release, push or restart of another app.

## Completed scope

- Construct account SQLite before vendor product/intent services; optional compatible port injection prevents old JSON constructor writes. Old saves/imports remain drafts, and the existing provenance-validated, explicitly confirmed manual correction path remains available. Persistent legacy compatibility fingerprints block old saves/imports/removes after newer manager edits, publication, withdrawal, source changes or shared reassociation.
- Replace the runtime platform-detail JSON writer with a typed SQLite get/upsert adapter. Existing verified collection only records original material and SKU bindings, not approved answers. New collected products establish their binding before storing raw source. The old collector's product-list projection includes manager-created root bindings, avoiding duplicate physical identities.
- Independent trusted `#/knowledge` window, reused/focused by StoreSidebarCard.importKnowledge and configuration ShopsListPanel.view-products with clicked-store context. Window selection does not navigate or mutate reception selection. Window bounds fit the work area; close requests save before hiding; failure leaves the draft available.
- Dark gray/blue, normal14px manager with product/general-QA tabs, always-visible shop selector, search, root-card pagination, lazy52px registered-asset thumbnails, metadata/actions, draft editor, source/version comparison, explicit review/publication with affected shops, trial workspace, public templates and separate store overrides, tasks/misses/settings, JSON export and consistent backup. Product cards, editor and review dialog are separate components; root view composes them and local orchestration lives in manager-controller.ts.
- Autosave is independent of publication. Normal snapshot refresh retains drafts. Switching shop/window context saves the previous draft and clears its product/SKU identity and trial/source state. Stale conflicts retain text. Explicit review can exclude entries. Cross-page selection displays shop/filter/count; batch review loads selected roots across pages and deduplicates shared entries.
- Root product and all its active same-store SKUs inherit one shared family. Reassociation previews the whole SKU set/target/shared shops, then submits every expected binding revision and the target canonical revision. The main process revalidates the complete set and changes all canonicalIds in one repository transaction. Any changed SKU or membership rejects everything. Physical IDs, raw sources, binding-scoped knowledge and dynamic values remain. Single-SKU cross-family redirection is refused; SKU knowledge overrides remain editable.
- Actual replies and old training use repository context before serialization; trial uses the same scope/TTL resolver and SKU identity rules. Raw platform facts never enter the model. Unknown product cannot borrow other products; a product with SKUs but no verified SKU cannot borrow root price. Injected evidence preserves complete entries without the old16000-character slice, then uses the existing expression references and16K/8K compression.
- Citations correlate resolutionID to the exact formal traceID returned by AiClient and carried by the worker into the existing send gate. Withdrawal/unlink/source/scope/TTL changes reject approval with a knowledge-specific reason. The proposal current guard continues through adapter typing/clicks and retains send-mode, buyer/page-baseline, throttle and receipt checks.
- Only real `purpose: reply` contexts with uid record misses; old training and trial do not pollute the queue. Migration-readonly failure explicitly stops reply context/trial instead of pretending the library is empty. Account/source changes abort knowledge completions and reject late results. Disposal closes tasks, model requests and the repository.
- Old cross-store product copy/rollback cannot confirm physical mapping, so runtime refuses those writes. Sync UI disables the product checkbox, links the source shop to the knowledge manager, and preserves welcome/vision/handoff configuration synchronization.

## Stable interfaces for Tasks3/4/5

### Runtime assembly / lease

`LocalRuntime.knowledge(): KnowledgeRuntime` is forwarded by workspace-runtime only while available. `local-runtime.ts` creates the repository immediately after `managed.dataDir` and before vendor construction. All manager IPC resolves the current runtime per call, validates workspace/store/scope, and rechecks lease after asynchronous results. Long pipeline work bypasses workspace-runtime's business command tail.

Main-only methods in `electron/knowledge-runtime.ts`:

- `repository`: the Task1 `KnowledgeRepository`, same account writer. Background collectors/parsers must still check their current account/store/job lease before each write.
- `complete({messages,maxTokens?,timeoutMs?,signal?,isCurrent?,traceId?}): Promise<string>`: usable current model completion port, registered during backend assembly by optional `onKnowledgeModel`. Uses existing config, encrypted secret reader or managed chat accounting; AbortSignal and disposal abort requests, late/account-changed results reject. Image capability uses the current model/account, independently of buyer vision or AI reception switches. No key, send or publication capability is exposed. Managed output-budget policy remains owned by the existing server transport; this port does not change it.
- `setPipeline(port: KnowledgePipelinePort)`: exactly one coordinator/dispatcher registration. Call in local-runtime after required providers/learning services are assembled; later pipeline components should be installed behind that one dispatcher, not register a second port.
- `cancelCompletions()`, `removeStore(storeId)`, `dispose()` integrate cancellation. The pipeline port must provide `removeStore` and `dispose`; repository store unbinding still runs if pipeline cancellation reports an error.
- `context({thread,goodsTitle?,reviewContext?})`, `captureTrace(traceId,knowledge)`, `citationsCurrent(traceId)`, `guardProposal(proposal)` are already connected to actual backend/AiClient/worker/review. `reviewContext.purpose` distinguishes reply/training/trial; only explicit reply+uid records real misses.

### Pipeline contract

`src/shared/contracts/knowledge-pipeline.ts` supplies strict `knowledgePipelineInputSchema`, `KnowledgePipelineInput`, `KnowledgePipelineResults`, capabilities/catalog/estimate DTOs. `KnowledgePipelinePort.request<T>(input:T): Promise<KnowledgePipelineResults[T['action']]>` dispatches:

- capabilities(storeId): honest booleans for catalog/collect/import/learn/dailyCheck and a reason.
- catalog(storeId,search,cursor): `identityVersion`, `scopeToken`, item physical productIds/title/optional registered thumbnail, nextCursor, total|null, complete and actual range.
- choose-sources(storeId,bindingId?): main-owned chooser creates registered sourceIds. Paths never cross this IPC.
- estimate(storeId,bindingIds,sourceIds): estimateId, sources/images/characters/estimatedTokens/message.
- start(storeId,kind,bindingIds,sourceIds,catalog?,estimateId?): first collection can have no bindingIds. Catalog selection carries identityVersion/scopeToken, explicit productIds or allMatching and total|null. Existing refresh/learning uses bindingIds/sourceIds; learning uses the estimateId.
- pause/resume/cancel(storeId,jobId): distinct actions. start/resume must persist and immediately return `{jobId}` before worker I/O/model execution. Existing job checkpoints/revisions stay in the same repository.

The host checks current registered shop and supplied binding/source/job ownership before dispatch and again on return. The coordinator must validate catalog identity/scope, model-result schema, job revision/cancellation and source versions before background writes. No concrete collector/parser/model worker/daily scheduler is registered in Task2: capabilities return false and UI clearly disables those actions until subsequent tasks connect them.

### SQLite platform-detail compatibility

`createKnowledgePlatformProducts({repository,assertActive,assertStore})` in `electron/knowledge-platform-products.ts` exposes existing `get(storeId,productId): PlatformProductDetail|null` and `upsert(storeId,input): void`. Input uses the existing exact platform schema. Upsert requires an established root binding, rejects older capturedAt, persists raw source revisions and missing SKU identities atomically, preserves existing SKU mappings and invalidates dependent publication through saveSource. It creates no JSON files and never publishes raw material. Its assembly replaces createPlatformProductStore in local-runtime; `createCollectedProductWriter` and productCatalog reuse this port.

**Task3 must split static and dynamic material into stable source identities.** The compatibility snapshot intentionally retains full original JSON, including capturedAt and dynamic fields; changing these currently changes that source revision and conservatively withdraws all entries tied to it. Do not use this complete snapshot as every static answer's sole dependency. Image URLs are retained as raw original evidence; Task3/4 must register actual assets before native image preview/model use, not claim the URLs were already understood.

### Renderer / publication / family reassociation

`KnowledgeBridge` in shared/contracts/knowledge-client.ts is exposed as optional DesktopApi.knowledge; preload fixes request/open/context/hide/onContext/onCloseRequest channels. Module consumers use `createKnowledgeClient(workspaceId)` and `openKnowledgeManager(storeId)` via the public knowledge index. Components never access Electron, filesystem or network.

Query/command retain Task1's strict unions. Extra fixed operations are general-entries, trial, asset, source-history, backup, pipeline and reassociate-product. Reassociation input is `{rootBindingId,canonicalId,expectedCanonicalRevision,bindings:[{id,expectedRevision}]}`. Public ordinary bind-product rejects any existing binding's cross-family redirect; SKU creation must inherit its root family. New editable inputs are constructed from allowed fields, not output DTO spreads. Public templates are browsable even when not applied to the current shop; only explicit approved application participates in replies.

## RED / GREEN evidence

1. Initial boundary/window/UI tests first failed because the new modules did not exist; after implementation, actual SQLite, trusted request, single-window and draft workflows passed. This initial import failure is not represented as behavioral proof.
2. SQLite platform-detail adapter was temporarily scaffolded with no writes. After correcting the synthetic fixture to the real strict schema, its test failed with missing source (`Cannot read properties of undefined (reading id)`); implemented persistence then passed and source-linked approval became stale on refresh. Existing collector6 cases remained green.
3. Legacy-compatible guard test first used the unguarded old ports and failed `expected function to throw`: old save silently reassociated the root back to its historical canonical. Persistent compatibility fingerprints fixed this and retained the newly confirmed association.
4. Whole-family operation regression first failed because no reassociation dispatcher existed; implemented complete-set/version validation and one transaction. Success preserves SKU price; stale one-SKU preview rejects with unchanged root/canonical relationships.
5. Actual existing ReviewConsole approval test cites an exact runtime trace, withdraws it, then rejects approve with the knowledge-specific reason and resolves false. Unknown product and unresolved-SKU price cases, phantom-shop writes, unapplied template discoverability, migration-failure explicit stop, and account-late completion rejection are covered.
6. UI tests verify clicked shop entries, reception-selection independence, draft-only save, stale-conflict text retention, ordinary snapshots preserving the draft, explicit affected-shop review before publish and explicit new-window context using the target shop. Self-review also fixed nested busy handling after pipeline start and clearing previous detailBinding/source/trial state on context changes.

## Commands and results

All commands ran from assigned client root, with temp data/local model only.

- `npx vitest run tests/knowledge-runtime.test.ts tests/knowledge-manager.test.ts tests/knowledge-window.test.ts tests/review-console.test.ts tests/workspace-runtime.test.ts tests/collected-products.test.ts tests/context-compression.test.ts tests/send-mode-authorizations.test.ts tests/main-sidebar.test.ts tests/shops-list.test.ts tests/store-sync-view.test.ts tests/knowledge-repository.test.ts tests/knowledge-migration.test.ts tests/knowledge-learning.test.ts tests/knowledge-learning-service.test.ts tests/knowledge-learning-ui.test.ts`: **16 files,118/118 passed**. The subsequent unresolved-SKU addition was verified separately with `npx vitest run tests/knowledge-runtime.test.ts`: **11/11 passed**. These are overlapping checks, not129 distinct tests.
- `node --test vendor/lingtu-runtime/tests/backend-integration.test.mjs vendor/lingtu-runtime/tests/managed-backend.test.mjs vendor/lingtu-runtime/desk-v1/test/reply-engine.test.js`: **87/87 passed**. No full upstream suite.
- `npx vue-tsc --noEmit`; `npx tsc -p tsconfig.electron.json --pretty false`: **exit0** on final source.
- `npm run build:desktop`: **exit0**, production main/preload CJS bundle.
- `node scripts/verify-knowledge-manager.mjs`: **exit0**, isolated production Vite renderer + real preload/native runtime + hidden/offscreen Electron. **9 actual checks**: route/SQLite cards; same window with two shops and no reception mutation; autosave draft; trial/current loopback model and no misses; actual old training serializing reviewed knowledge;1366×768 at150% no document horizontal overflow; close retains/hides window; old JSON constructors no writes; compatibility draft and withdrawal invalidation.
- Native evidence: `artifacts/knowledge-manager-check/evidence/report.json`, `manager-1280.png`, `manager-review.png`, `manager-150-percent.png`. The supplied reference screenshot was viewed before implementation; actual native1280/150% captures were also opened and inspected. Synthetic source thumbnail uses an existing project image asset; no real shop photos. Root independently inspected these screenshots too.
- Owned ESLint: enumerate `git diff --name-only` plus `git ls-files --others --exclude-standard`, select changed `.ts/.vue/.mjs` excluding vendor, then `npx eslint <owned files>`: **exit0**; latest runtime/test additions also checked explicitly.
- Scoped Prettier on changed non-vendor source/docs: corrected one native-check formatting warning, then final check. `git diff --check`: final exit0. `node scripts/check-boundaries.mjs`: **passed**. `node scripts/check-vendor.mjs`: **80 client +92 server source records passed**, upstream hashes retained and only three actual vendor patch hashes updated.

The renderer build retained existing Rollup Zod pure-comment and large-chunk warnings. Windows emitted an existing WSALookupServiceBegin diagnostic in hidden Electron; native checks still passed. One initial native run completed checks but attempted cleanup before Electron released userData and got EPERM; the runner now validates the exact temp path and cleans it only after its child exits. Successful reruns cleaned their own temp account/profile.

## Remaining external limits / self-review disposition

- Actual catalog collection, selected detail collection, file/source chooser, PDF/DOCX/XLSX/CSV/TXT/image/scan parsing, model-learn worker, job execution/pause/resume and daily checks are intentionally for Tasks3/4. Task2 provides typed host and UI integration only, with false capability until registered.
- Real-store read-only acceptance and paid/current-provider semantic/image quality were not performed. All model results are loopback fixtures, proving transport and wiring rather than factual quality. No buyer messages or store changes were made.
- Native actual send was not exercised in this check, because it would open the reply monitor and is outside hidden manager acceptance. The exact citation approval gate is tested with the actual ReviewConsole; existing send-mode authorization and directly affected upstream engine/managed backend checks passed. Tasks5/root should validate the composed simulator send path and real platform read-only identity separately.
- Complete platform snapshots conservatively invalidate their source dependents; static/dynamic separation and efficient richer source cards are the next collector integration seam, not claimed done.
- Backup uses the existing consistent main-process API; restore remains Task1's stopped-writer API and has no new manager restore UI. Secondary tasks/misses currently request up to100 rows; larger history pagination is a follow-up integration consideration.
- No full `npm run check`, release packaging, cloud builds, deployment or push was run. User's other working app/browser was not controlled or stopped.

Ready for independent root review. Do not represent this Task2 handoff as completion of the later collector/parser/daily-job implementation.
