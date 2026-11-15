# Task 1 delivery report — repository, contracts, migration

Status: implementation complete; ready for independent review and Task 2 integration. Base: a2dbead (rebased by root onto main f2193fc). No production data, real stores or paid models were accessed.

## Owned changes

- `src/shared/contracts/knowledge.ts`: strict Zod command/query/editable-input schemas and DTOs for canonical products, store/SKU bindings, sources/locators/assets, immutable knowledge versions, explicit publication, citations, jobs/settings/misses and backup/migration manifests.
- `electron/knowledge/index.ts`: public exports `createKnowledgeRepository`, `KnowledgeRepository`, `KnowledgeRepositoryOptions`, `restoreKnowledgeBackup`, `tokenizeKnowledge`, `LegacyIntentPack`.
- `repository.ts`: account-directory SQLite writer, version history/review records, scope-aware retrieval, durable application state and consistent backups.
- `resolver.ts`: existing MiniSearch 7.2.0 and Chinese Intl.Segmenter; scope before search, explicit product identity, store/SKU overrides, complete evidence snippets and a character budget without slicing entries.
- `legacy.ts` / `migration.ts`: original product/intent constructor-compatible ports and transaction migration, including independent audit and existing platform-products sources.
- `backup.ts` / `lifecycle.ts` / `node-loader.ts`: verified stopped-writer restore, one live writer per account directory in the process, and CJS/ESM-compatible loading of Node SQLite and existing PapaParse.
- Two owned test files. Package files, vendor, runtime/preload/windows, UI and common documentation were not modified.

Reuse: project-pinned MiniSearch, PapaParse 5.7.1 and Zod 4.6.7; Node 24 `node:sqlite`; exact existing vendor Product/Intent constructor behavior and platform-product schema were inspected. No new dependency or copied third-party implementation was introduced. References: https://github.com/lucaong/minisearch ; https://github.com/mholt/PapaParse ; https://nodejs.org/api/sqlite.html .

## Stable public interfaces for consumers

All methods are synchronous, except caller-owned collection/model work, which must run outside the repository. Factory:

```ts
createKnowledgeRepository({ directory: managed.dataDir, workspaceId, now?: () => number })
```

`workspaceId` is accepted as a runtime lease and never used in filenames or persistent keys. Each account's `directory/knowledge.sqlite` is authoritative. The factory exposes `.products`, `.intents`, `.readOnly`, `.revision`, `.directory`, `.dispose()` and the following methods:

- Canonical/binding: `saveCanonical(CanonicalProductInput)`, `getCanonical(id)`, `listCanonicals(KnowledgePageInput = {})`, `bindProduct(ProductBindingInput)`, `getBinding(id)`, `listBindings(canonicalId?)`, `unlinkBinding(id, expectedRevision)`, `removeStore(storeId)`.
- Management: `summary(storeId?)`, `listProducts({storeId,search?,offset?,limit?})`, `detail(canonicalId,storeId?)`, `listEntries({storeId?,search?,offset?,limit?,status?})`, `getEntry(id)`, `entryVersions(id)`.
- Raw materials: `saveSource(KnowledgeSourceInput)`, `getSource(id)`, `listSources({storeId?,bindingId?} = {})`, `sourceVersions(id)`, `addAsset(bytes,{name,mimeType})`, `readAsset(id)`.
- Editing/review: `saveDraft(KnowledgeDraftInput) -> KnowledgeVersion`; `publish({entryId,expectedDraftRevision,expectedSourceRevisions}) -> KnowledgeEntry & {affectedBindings}`; `withdraw(entryId,expectedRevision)`.
- Retrieval: `resolveKnowledge({storeId,productId?,skuId?,query,limit?,maxCharacters?}) -> KnowledgeResolution`; `validateCitations(citations) -> {valid,invalidEntryIds}`.
- Settings: `getSettings()`, `saveSettings(Partial<KnowledgeSettings>)`. Defaults: 60-minute dynamic TTL, 09:00 Asia/Shanghai daily check, enabled. These are persistence APIs, not a scheduler implementation.
- Durable jobs: `createJob({kind,storeId,payload})`, `getJob(id)`, `updateJob(id,{expectedRevision,status?,checkpoint?,progress?,error?})`, `listJobs(page = {})`. `kind`: collect / learn / daily-check / import. Status: queued / running / paused / needs-confirmation / succeeded / failed / cancelled. On reopen, running jobs and queued learning jobs become paused with checkpoints retained; no model calls occur.
- Misses: `recordMiss({storeId,productId?,skuId?,question,conversationId?})`, `updateMiss(id,status)`, `listMisses(page = {})`. Normalized question/store/product/SKU deduplicate, counts accumulate, up to 100 distinct recent conversation IDs are retained.
- Backup: `createBackup(destination) -> KnowledgeBackupManifest & {directory}`; `getLastBackupDirectory()`; module-level `restoreKnowledgeBackup({directory,backupDirectory}) -> KnowledgeBackupManifest`. Paths are main-process APIs only and are absent from renderer command schemas.
- Migration: `getMigrationState() -> {status,error,backupDirectory,inputHashes,idMap}`.

`query(KnowledgeQuery)` discriminates summary / canonicals / products / detail / entries / resolve / jobs / misses / settings. `execute(KnowledgeCommand)` discriminates save-canonical / bind-product / save-draft / publish / withdraw / unlink / save-settings / cancel-job / update-miss. Both parse strict shared schemas, including the outer discriminant. Other direct maintenance methods are main-process APIs and must not be spread into IPC.

Use `expectedRevision` from the current entity for edits; `saveDraft` returns the actual draft revision. `publish` requires that revision and the exact source-ID→revision set. No input accepts reviewer identity or filesystem locators. Editable inputs deliberately reject output-only `revision`, `updatedAt` and source `hash`; consumers construct editable objects rather than spreading DTO metadata.

Canonical lists are account-wide (including unlinked retained entities). Product cards are root product bindings only, not one card per SKU. Product search/count/pagination use SQL; card source counts/kinds/thumbnailAssetId load only metadata for the current page. Source bytes/full text are fetched for detail or explicit preview. Resolver SQL scopes approved material by current store/product before constructing MiniSearch; raw sources never enter retrieval.

## Safety and lifecycle behavior

- Raw sources, drafts and legacy audit are distinct from approved answers. Editing retains the old approved version until explicit publication, unless its source changes.
- Dynamic price/stock/activity cannot be stored on canonical or shared-template scopes. Store/SKU binding overrides win by explicit conflictKey (default question); an expired winning override is excluded without fallback. Unknown product identity cannot draw arbitrary same-store products. Unknown requested SKU cannot borrow a base product dynamic value.
- Citations contain entry revision, binding revision, source revisions, expiry and a scope fingerprint. Withdrawal, unlink, source change, reviewed override changes or expiry invalidate old candidates. The integration must retain these citations in main-process pending state and invoke validation inside the existing approval gate; no sending behavior was changed here.
- Shared publication returns active affected bindings. Shared canonical content survives unlinking one store. Removing a store cancels its jobs, unlinks its bindings and revokes its template applications with a store tombstone, retaining templates for other stores.
- Source revisions are immutable; a changed referenced source withdraws dependent publication to stale. Human additions without that source dependency remain usable. Daily dynamic snapshots should be separate from static sources in the collector so price changes do not invalidate unrelated static knowledge.
- One active repository per resolved account directory is enforced within the application process. The existing Electron single-instance boundary remains responsible for preventing separate application processes.

## Migration and compatibility

- Before parsing/mutation, original product-knowledge.json, intent-knowledge.json and platform-products JSON files are copied to a unique knowledge-migration-backups directory. Migration parses the backed-up bytes, records SHA-256 hashes/ID mappings, checks originals did not change before commit, and leaves all originals byte-for-byte untouched.
- One transaction imports entities, knowledge versions, bindings, source audit, raw platform details and SKU bindings; checks old counts and product enabled state; records completion and original revisions. Old products each get their own canonical entity and are never merged by platform ID/title.
- Old enabled knowledge remains approved; disabled packs/entries/products remain inactive. Price lifetime is based on original product.updatedAt, so migration does not refresh an old price snapshot. Expired migrated prices remain excluded by the resolver while preserving legacy enabled metadata.
- The old disabled learning-audit entry remains present in the legacy export/display shape, is forced disabled, and also becomes an independent raw legacy-audit source. It is never searchable knowledge.
- Existing platform-products snapshots retain their complete validated JSON (original text, image URLs, SKU IDs, merchant codes, independent barcodes, prices/stock and timestamps) as raw source versions associated with the root binding. They do not publish facts or dynamic values. Unknown nonempty hashed store archives fail closed rather than guessing identity.
- Completed migration is idempotent and ignores leftover originals on subsequent starts. Failure rolls back imported entities, persists failure diagnostics and enters a read-only guard. Valid original products/intents remain readable through old ports; a corrupt specific original still reports its parse error. Every old write command and normal repository mutation rejects read-only mode. Existing backup copies remain available.
- `.products`: summary, identifyTitle, getByProductId, list, save, remove, search, previewImport, importCsv, exportCsv.
- `.intents`: list, summary, save, learnCorrection, remove, search, previewImport, importJson, exportJson.
- Signatures match the inspected vendor constructors, including revision/confirmed import options and Product/Intent version guards. New saves/imports through these ports create disabled drafts. The existing explicit, user-confirmed learnCorrection path validates the full quality provenance, deduplicates and records manual-correction review/publication. Never call this port for model output. Ordinary save strips caller-supplied quality source.
- Ports persist only to SQLite. Root must inject them before vendor JSON constructors run; Task 1 alone does not change app assembly, and must not be represented as already eliminating the app's old constructor writes.

## Backup and restore

Backup uses SQLite `VACUUM INTO`, not live DB/WAL file copying. It verifies/copies all registered content-addressed assets and emits hashes, sizes, DB revision and a manifest; metadata, bindings, versions, reviews, jobs and settings are in the same DB snapshot. Main-process callers receive the exact resulting directory.

Restore refuses an active writer, rejects duplicate/traversing/missing paths, checks every file hash/size, validates SQLite integrity/foreign keys/schema and registered attachment coverage before replacement. It stages the DB, preserves the previous closed SQLite/WAL/SHM files in knowledge-pre-restore-<id>, copies content-addressed assets and switches the DB. The caller must stop running tasks and dispose the repository first. Old attachment objects are retained for rollback; restore does not delete business folders or other services' files. No in-app restore UI/chooser was implemented in this task.

## Verification evidence

1. Initial repository RED: real temp SQLite opened, 6/6 new behavior tests failed against minimal scaffolding (canonical persistence / missing jobs etc.). Vite's unsupported static node:sqlite import was resolved before this RED by native createRequire; tests exercised the actual SQLite engine.
2. Migration RED: 4/4 tests failed (missing legacy ports, missing read-only guard, missing migration rows).
3. Additional lifecycle RED: four failures exposed shared-template removal affecting the other store, missing card summaries, missing stopped-writer restore, and duplicate writer admission. Fixed and green. A scoped unknown-SKU dynamic test exposed an unsafe base-price fallback, then passed after the guard.
4. CJS RED: esbuild format:cjs emitted import.meta warnings and Node require failed with ERR_INVALID_ARG_VALUE/createRequire(undefined). Fixed using node-loader.ts and the CJS/ESM-compatible filename fallback.
5. Current owned suite: `npx vitest run tests/knowledge-repository.test.ts tests/knowledge-migration.test.ts` — 15/15 passed (11 repository, 4 migration). Covers review revisions, store/SKU scope, unknown products/SKUs, stale/expired references, source invalidation, shared unlink, interrupted jobs, assets, consistent backup/restore, raw actual platform schema, migration idempotence/audit/read-only and original preservation.
6. Existing directly affected baseline: `npx vitest run tests/knowledge-learning.test.ts tests/knowledge-learning-service.test.ts tests/knowledge-learning-ui.test.ts` — 14/14 passed.
7. `npx tsc -p tsconfig.electron.json --pretty false` — passed.
8. Owned tests + imports strict TS command (`--noEmit --strict --target es2022 --module esnext --moduleResolution bundler --lib ES2022,DOM,DOM.Iterable --esModuleInterop --skipLibCheck --types node,vitest/globals`) — passed, without source suppressions or any.
9. Limited ESLint and Prettier checks on owned files — passed.
10. esbuild probe of `electron/knowledge/index.ts` with platform:node / target:node20 / format:cjs — builds without warning; Node 24 successfully ran a real temporary SQLite lifecycle: draft excluded → publish → Chinese resolve → Papa CSV import creates disabled draft → backup → close → restore → different workspaceId reopen, with actual SQLite file header checked. Probe output is ignored at artifacts/knowledge-task1/index.cjs.

Only directly affected checks were run. No full release verification, real Electron UI/platform acceptance, vendor test suite, app packaging, git push, production deployment or real-store/model operation was performed.

## Integration cautions / next work

- Task 2 owns current-workspace runtime assembly, narrow trusted IPC, main-process-only path/asset chooser and source preview isolation. Inject ports before old constructors and close the repository on workspace/account disposal.
- Task 3/4 owns collectors, model-result validation and job scheduling. Never feed model/tool JSON to execute/publish/learnCorrection; model results only enter saveDraft with caller-owned scope/source revisions. Raw original sources remain untrusted data.
- UI should use direct typed methods or narrow result mapping for generic query/execute unions. Use the independent publish action for review, not old enabled saves. Explicit unlink is the current removal method; no whole-library canonical deletion command is introduced in Task 1.
- listEntries currently returns correct filtered pagination by slicing parsed entry records; product-card and canonical lists use SQL pagination. At materially larger question counts, move entry-management filtering/pagination into SQL. No 1000-product throughput benchmark was run.
- Rebinding an inactive store/product/SKU requires its existing binding ID and revision; uniqueness prevents silently creating a second physical binding. listBindings exposes active bindings; main-process maintenance can retain the ID from the unlink result or getBinding for explicit reattachment.
- SQLite native runtime was tested on Node 24 and CJS output. Full Electron assembly/approval-gate acceptance remains root's subsequent integration validation.

## Fix round 1 — review of FIX_BASE 0c93d3f

Scope: only the three Important findings in task-1-review.md and their direct lifecycle consequences. No shared contracts, UI, runtime, packages, vendor or other task sources changed.

1. **Orphan product-scoped intents / migration ordering.** `ingestLegacyIntent` now preserves the legacy predicate's explicit cartesian set of distinct store IDs and product IDs. Missing root identities receive separate canonical/binding entities identified by the literal product ID; no title guessing, cross-store merge or broader/global scope is introduced. Existing bindings are reused. Platform snapshots now establish their actual root/SKU identities before intents are imported, so intent-only packs reuse real platform titles/bindings when available. Migration checks the actual mapped non-audit entry count, existence and expected approved count in the transaction, in addition to old compatibility-row counts.
2. **Physical identity transfer.** Existing binding `storeId`, `productId` and `skuId` are immutable. An attempted replacement is rejected before mutation, retaining the original approved facts on the original identity. Reassigning `canonicalId` for the same physical identity remains supported with the existing expectedRevision guard. Old Product saves that attempt to change their physical product ID now receive this explicit identity error rather than transferring approvals.
3. **Root/SKU unlink.** Unlinking a root binding atomically deactivates the selected store/product's root and every active SKU binding; unlinking a SKU alone remains limited to that SKU. Other stores retain their bindings and shared facts. The legacy product removal port inherits the same cascade. `removeStore` rereads each candidate binding and skips children already deactivated by an earlier root cascade, avoiding stale revision errors and transaction rollback.

Regression evidence:

- Before the production fixes, `npx vitest run tests/knowledge-repository.test.ts tests/knowledge-migration.test.ts` produced **5 failed / 16 passed (21 total)**: orphan product-scoped intent had 0 approved entries instead of 1; available platform snapshot had the same dropped answer; physical identity replacement did not throw; root unlink retained an active SKU; legacy remove retained an active SKU. The additional removeStore(root+SKU) regression passed on the baseline and protects against the new cascade's stale-revision consequence.
- After the fixes, the same command produced **21/21 passed**: 14 repository tests and 7 migration tests. The six added cases check both missing-product and platform-source migrations, wrong-store/wrong-product/unspecified-product exclusion, all three immutable identity fields, permitted canonical reassociation plus stale revision guard, root/SKU unlink with other-store preservation and citation invalidation, legacy remove, and removeStore cancellation without stale child revisions.
- Rebuilt the owned bundle with `npx esbuild electron/knowledge/index.ts --bundle --platform=node --format=cjs --target=node20 --outfile=artifacts/knowledge-task1/index.cjs`: **exit 0, no warnings**. A fresh Node 24 temporary-SQLite CJS probe printed: `Fix1 CJS real-SQLite probe passed: platform-before-intent migration, explicit scope, immutable physical identity, root/SKU cascade and stale citations`. It used only synthetic snapshots/intent packs, closed the writer and removed its checked temporary directory.
- Final restricted checks: `npx tsc -p tsconfig.electron.json --pretty false` **exit 0**; the strict owned-tests/import command listed above **exit 0**; `npx eslint electron/knowledge src/shared/contracts/knowledge.ts tests/knowledge-repository.test.ts tests/knowledge-migration.test.ts` **exit 0**; `npx prettier --check electron/knowledge src/shared/contracts/knowledge.ts tests/knowledge-repository.test.ts tests/knowledge-migration.test.ts .superpowers/sdd/2026-11-15-knowledge-library/task-1-report.md` reported **All matched files use Prettier code style**; the three directly affected baseline knowledge test files **14/14 passed**; `git diff --check` **exit 0**. No full release checks or real store/model actions were run.

No new public methods or DTO shape changes are required by these fixes. The previous API list remains valid; the identity restriction and root unlink cascade are the corrected semantics.
