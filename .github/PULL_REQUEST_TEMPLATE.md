## Summary

<!-- one or two sentences -->

## Verification (issue #45)

This block exists because four user-blocking regressions shipped to prod in the same week and were detected only by accident. Pick the boxes that apply.

- [ ] **Smoke covers this.** `npm run smoke:prod` would catch a regression of the user-facing behavior changed here. (Run it against your branch deploy if you can.)
- [ ] **Manually verified end-to-end.** I clicked through the affected flow on a deployed build (Fly preview, local dev with HTTPS proxy, or prod after merge). Note which.
- [ ] **Not user-facing.** Doc-only / refactor / internals — verification gate doesn't apply.

If none of the above can be checked, this PR should NOT merge until one of them can.

## Test plan

<!-- bulleted checklist for the reviewer -->
