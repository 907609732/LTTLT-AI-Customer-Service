# Window adaptation repair plan

> Execute inline using executing-plans. User explicitly requested Figma first, then re-import and repair software.

Keep design baseline 1440×900 and auxiliary300×900. At larger main-window sizes, expand layout containers and maintain edge anchors/center alignment; keep typography and icons at source size. Small windows retain scroll access. No backend changes.

- [ ] Audit and back up native Figma constraints, fix nested width/height and trailing/center anchors; validate temporary resized clones at1920×1080 and2560×1440, remove clones, retain baseline roots and reference images.
- [ ] Re-export current native source after Figma verification. Add failing runtime/browser tests for viewport expansion and fixed typography, then implement recursive Figma constraint interpretation and dynamic product canvas dimensions. Inspector remains source-sized.
- [ ] Verify browser layouts and interactions, native maximize/restore, final review. Build/package only through GitHub; download and verify artifact, update main and reopen corrected program for user.
