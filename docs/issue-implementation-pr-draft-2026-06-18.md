# Issue Implementation PR Draft — 2026-06-18

Branch: `codex-issue-implementation-roadmap`

## Summary

Implements the current GitHub issue runway for MMO-readiness:

- #122: unknown viewer command types now fail closed with `400` before state mutation.
- #121: creator material URL ingestion is constrained by allowlisted hosts, GitHub raw URL normalization, private-network rejection, redirect checks, and response-size limits.
- #120: versioned Privy browser bundle requests are immutable-cacheable and the bundle-size guard covers the lazy account widget payload.
- #119: browser-owned OpenRouter keys default to `sessionStorage`; legacy local keys migrate down unless persistence is explicit; viewer CSP uses inline script hashes instead of broad `unsafe-inline`.
- #118: Playwright browser smoke exists locally and in `.github/workflows/browser-smoke.yml`.
- #117: the inline viewer client now has typed/tested helper seams for public world feed loading/rendering, race strip models, question prompts, Honor Roll rows, arc indicators, and classmate/channel-rail progress labels.

This branch also contains the ongoing MMO/world/curriculum work that motivated the tracker pass: expanded built-in teacher question banks, public world projection/streaming, deploy smoke coverage for the world feed, and roadmap updates.

## Verification

- [x] **Smoke covers this.** `npm run test:browser` covers guest boot, full grade 9-12 journey, public world-feed stream rollover, comic unlock modal, and desktop/mobile framing.
- [x] **Manually verified end-to-end.** Local Playwright browser smoke passed against the local dev server on `127.0.0.1:3100`.
- [ ] **Not user-facing.** Not applicable; this touches viewer behavior and public routes.

## Test Plan

- [x] `npm run check:full`
  - `tsc --noEmit`
  - question bank check
  - viewer script syntax check
  - Vitest: 68 files / 847 tests
  - build, Privy bundle guard, viewer bundle guard
  - SPA build
- [x] `npm run test:browser`
  - 6/6 Playwright tests

## Suggested Review Grouping

1. Deploy/security tracker fixes: #119, #120, #121, #122.
2. Browser smoke workflow and README test docs: #118.
3. Inline viewer typed extraction: #117.
4. MMO/world/curriculum groundwork: world projection/streaming, expanded teacher question banks, admin/replenishment support, roadmap.

## Follow-Up After Merge

- Close #118 after CI proves the browser-smoke workflow.
- Close #119-#122 after the PR lands and CI passes.
- Keep #117 open for continued extraction of larger viewer surfaces.
- Close or replace stale #65 after confirming the current deploy-fly history is no longer actionable.
