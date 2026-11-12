# Conversation quality inspection implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task.

**Goal:** Daily automatic reception continues across conversations; manual quality inspection lives in existing UX21 with an eye/detail dialog.
**Architecture:** Reuse account-scoped backend snapshots, conversation archive and atomic JSON persistence. Keep quality decisions distinct from delivery confirmation and explicit AI control. No new runtime dependencies.
**Spec:** User-approved design in this chat, 2026-11-12: software-internal manual review, no automatic scoring, platform history modification or knowledge-base writes.

## Constraints
- Never send to real buyers in tests. Unknown delivery is never automatically retried.
- Conversation-local generation/delivery problems must not stop other conversations or disable store AI.
- Authentication/quota/configuration failures may stop all reception; do not auto-enable AI.
- Replace large live-chat review overlay with UX21 records; keep account errors discoverable.
- Migrate legacy delivery issues idempotently, preserving original records.

## Tasks
- [x] Add validated account-local quality records, optimistic review version checks, failure/migration and persistence tests.
- [x] Change generation/delivery handling to suppress only affected conversation; keep engine alive, test another buyer succeeds. Separate throttling before send from true uncertain delivery.
- [x] Correct PDD echo confirmation with controlled DOM/stream tests: matching newly observed seller message in same conversation; reject old text, wrong buyer, empty editor alone.
- [x] Implement UX21 filters/table/detail dialog, source data only, eye action, review status and note persistence. Reviewing never sends or resumes AI.
- [x] Remove interrupting delivery overlay, add compact link to quality records and global account error status. Verify keyboard, scroll, delayed snapshots and account isolation.
- [x] Typecheck, unit/engine, relevant browser and Electron tests, independent review, rebuild and source runtime acceptance. Update existing PR with limitations.

## Review focus
- A previously reviewed conversation changes while a reviewer has it open: reject stale review, preserve draft note.
- Manual takeover or account switch during queued generation must not spend another request.
- Matching old/historical seller text must not confirm a new send.
- Confirmed send plus local disk error must never invite duplicate sending.
- Old issue migration must neither erase data nor globally reblock startup.

## Execution record
- Reused the existing UX21 configuration entry, React/lucide, guarded IPC, account-local JSON and conversation archive. No new dependency.
- PDD confirmation: added a controlled DOM-baseline fallback, verified buyer identity, removed double-click and click-then-Enter resend paths. Original hook fails the four regression cases; updated hook passes all four.
- Conversation-local failures suppress only that conversation. Global authentication/quota/configuration/storage failures retain a discoverable account status. Unknown send is discarded even when quality persistence fails.
- Legacy issue migration preserves the original JSON and puts affected archived conversations into handoff; repeated migration is idempotent.
- Validation: 173 root unit tests, 130 engine tests, build/typecheck, native IPC quality persistence and native embedded-platform/no-overlay checks passed. Final reviewer found the persistence/discard risk; it was fixed and rechecked.
- Source app restarted; real archived conversations are visible in the quality table and eye/detail dialog. No real buyer messages were sent and no AI switch was enabled during acceptance.
- Manual quality review is independent of delivery resolution. It does not clear manual suppression, resend a message or alter the knowledge base. Platform-wide history and automatic scoring are out of scope.
