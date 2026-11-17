# Remember Store AI State Implementation Plan

> For agentic workers: use subagent-driven-development and test each behavior before implementation.

**Goal:** Persist each store's explicit AI on/off preference and restore previously enabled stores after the same platform identity is verified on the next account/workspace login.

**Architecture:** Keep upstream startup-off unchanged. Use an atomic preference file in the existing account/source data directory and a TypeScript restore coordinator. Restore through the ordinary open-store and set-ai commands, preserving send modes and all model/conversation checks.

**Tech Stack:** Existing Electron, TypeScript, Zod and Vitest. No new packages or vendor edits.

**Spec:** User request in this chat; product interpretation and UX handoff below.

## Behavior

- New stores and missing/corrupt preferences default off. No migration guesses from shutdown-reset flags.
- Record successful explicit enables and explicit off/stop-all/close; lifecycle stops do not overwrite intent.
- After managed initialization and host readiness, open only remembered enabled stores through existing paths. Verify logged-in platform identity, mall and operator before enabling; do not infer readiness from online alone.
- Wait while not logged in; restore once per verified session, without an error retry loop. Manual off, logout, removal and disposal invalidate queued/in-flight restoration.
- Keep previous review/automatic-send mode. Never recover old approval decisions, candidates or queued sends.
- Use existing sidebar status/tooltip for waiting/restoring/failure, with actual AI switch reflecting actual running state. Clicking a waiting restore can cancel it. No new settings page.

## Tasks

1. Add failing persistence/coordinator tests: perstore and account directory isolation, corrupt/absent records, login readiness and identity mismatch, stop-all/partial batch, failure latch and late cancellation.
2. Implement atomic preference storage following existing StoreSendModes pattern in a separate file; do not modify send-mode persistence format.
3. Integrate coordinator into local-runtime startup, platform events, explicit commands and disposal; preserve backend set-ai checks and managed access/restart gates.
4. Add narrow optional snapshot restore status, sidebar display/cancel behavior, and accurate workspace activation wording. Verify existing consumers remain compatible.
5. Run targeted unit/integration checks, Vue and desktop types, lint and build. Request independent review before completion. Record actual validation and limits; real shop auto-enable is not tested by synthetic fixtures.

## Reuse decision

Existing StoreSendModes atomic per-account persistence is the closest fit. electron-store was inspected on GitHub: its current package is native ESM and duplicates existing small-preference storage. Reuse the project's file-write pattern without adding a dependency.

## Delivery

Local reviewable implementation and restart after checks. No publication or deployment. Do not manually change real store preferences or send messages during testing.
