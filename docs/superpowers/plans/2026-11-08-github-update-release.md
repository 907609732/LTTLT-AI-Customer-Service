# GitHub update and release plan

Goal: add startup/manual stable-release checks and publish v0.4.0 from cloud-only builds.
Spec: docs/superpowers/specs/2026-11-08-github-update-release-design.md

- [x] Add electron-updater6 dependency; test first an injected update controller for available/latest/missing/error/deadline/coalescing; implement main-process-only provider wrapper.
- [x] Guard snapshot/check/openRelease IPC with existing trusted-frame policy; schedule packaged startup check and disable network in automated test environments.
- [x] Wire both native Figma footer TEXT entries to manual check; show nonblocking update result/download panel and real current version. Test keyboard/click/status paths with controlled IPC.
- [x] Configure GitHub publishing metadata and NSIS artifactName; cloud workflow builds installer and uploads installer/latest.yml/blockmap while retaining packaged integration checks.
- [ ] Independent review; type/unit/browser/Electron checks; PR/cloud build and download same-run assets; verify metadata/hash/runtime before merge.
- [ ] Create draft firstRelease, upload verified assets + SHA256SUMS, validate draft then publish; validate public assets and startup/manual query against actual release; open final app and sync delivery record.
