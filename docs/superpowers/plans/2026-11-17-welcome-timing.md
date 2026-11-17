# Welcome timing implementation plan

User requests seconds-based random welcome delay, remove ordinary reload button and explanatory paragraph, move enable switch to title right. Keep the current first AI reply + text welcome behavior. Default proposed 1–3 seconds, configurable integer 1..3600 with ordered bounds. Independent visitor/media rules stay unchanged.

- [ ] Add failing targeted tests for welcome delay storage compatibility, CAS, sampling/approval/cancellation, synchronization, and requested layout.
- [ ] Extend vendor welcome storage only with declarative optional/default fields, same atomic record/version. Keep new logic in TypeScript.
- [ ] Propagate actual welcome attachment metadata and version from claim/decorate to SendProposal through the minimal factory hook; never infer by prefix.
- [ ] Implement own TypeScript one-sample welcome delay, after approval before send; check current proposal + configuration/version + AI state throughout and on completion. Use existing timer facilities. Random wait starts after approval for clear send semantics. No delay for nonwelcome messages. Dispose/reject cancels.
- [ ] Extend shared DTO/draft/sync fields compatibly. Ensure save reads no runtime-only enabledAt field into strict command; preserve existing boundary behavior.
- [ ] Simplify welcome header/controls per requested layout using RuntimePanel actions slot and ElementPlus. Keep reload solely as conflict recovery action. Validate click and Enter submit.
- [ ] Update provenance/hashes and relevant docs, increment package/lock to1.0.52 once. Run only targeted tests, typecheck/lint/format/vendor/build and native welcome check. No real sends, no release/deployment.
- [ ] Codex independently reviews, merges preserving drift, pushes, checks CI, restarts latest source preserving existing account data and verifies actual version/UI.

Reuse existing ElementPlus components, vendor welcome atomic storage and approval/send pipeline. Node standard timers rather than adding delay library: existing timers support cancellation/guarding and avoid unnecessary dependency. Upstream sources: https://github.com/sindresorhus/delay and https://nodejs.org/api/timers.html . No copied external implementation.
