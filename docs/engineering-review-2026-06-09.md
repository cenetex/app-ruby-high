# Ruby High — Engineering Report

**Date:** 2026-06-09 · **Reviewer:** Claude (Fable 5) · **Branch:** `main` @ `bf9110d` (clean)

Companion to `docs/engineering-review.md` (2026-05-31). Per that review's own recommendation, this is a durable dated artifact — do not delete on fix; add a follow-up doc instead.

---

## 1. Executive summary

Ruby High is a ~62k-LOC TypeScript Node service (plus ~20k LOC of tests) implementing an AI-taught school: server-rendered PWA viewer, multi-provider auth, SQLite persistence on Fly.io, LLM teaching/grading via OpenRouter or a local OpenAI-compatible endpoint, and a Solana/Metaplex commerce layer (Hall Passes, provably-fair NFT card packs).

**Verified health on HEAD:** `tsc --noEmit` green · 637/637 vitest tests green in ~3s · working tree clean · zero TODO/FIXME markers in `src/`.

**Headline finding (P0): CI is red on main and production deploys are blocked.** Every `deploy-fly` run since June 8 fails in <60s at `npm audit --omit=dev` (19 production-path vulnerabilities, 4 high — all in the Solana/Irys dependency tree: `bigint-buffer`, `elliptic`, etc.). Commit `c9ef776` (June 7) deliberately made the audit non-blocking (`|| true`, "Transitive vulns in @irys/upload should not gate deploys"); commit `a355478` ("stabilize ruby high viewer flow", June 8) silently reverted that one-line change inside a 34-file commit. Nothing merged since has deployed, and the verify job dies before typecheck/tests even run — so CI is currently providing zero signal on top of being a deploy blocker.

**Post-review status (2026-06-13 worktree):** the P0 audit regression and Node-version skew are addressed locally: `deploy-fly` now runs `npm audit --omit=dev || true`, all `setup-node` invocations use Node 24, and `package.json`/`package-lock.json` declare `engines.node >=24`. Verified locally on Node `v24.10.0` with `npm ci`, `npm run check:full`, and `npm run test:coverage` (637/637 tests).

Everything flagged OPEN in the 2026-05-31 review has since been fixed and verified on HEAD (§4).

The engineering culture here is unusually strong for a solo/agent-driven project: rationale-bearing comments throughout, regression tests tied to issue numbers, deploy rollback automation, scheduled production smoke. The main structural debt is concentration: three god-files (`viewer-parts/client.ts` 12.6k lines, `ruby-high-service.ts` 8.1k lines / ~140 methods, `chat-routes.ts` 3.7k lines) and a hot Solana mint-authority key on the web server.

---

## 2. System overview

**Shape.** The app is packaged as a host-agnostic "app module" (`src/index.ts` exports `rubyHighApp: RubyHighAppModule`) with services, actions, and an `appBridge` of route handlers. `src/runtime.ts` defines a minimal `IAgentRuntime`/`Service` shim so the same module runs standalone under `scripts/server.mjs` — a raw `node:http` server, no framework anywhere. Four core services (`FacultyService`, `RubyHighService`, `AuthService`, `ChatService`) plus `XSocialService`/`TelegramService`; circular service references are broken with a documented `queueMicrotask` deferral (`src/index.ts:27-47`).

**Routing.** Hand-rolled prefix dispatch in `src/routes.ts` (410 lines) fanning out to `src/routes/*` (admin, billing, NFT, yearbook, metrics, commands, assets, bug-report) and the larger `chat-routes.ts` / `pack-library-routes.ts`. Handlers receive a `RouteContext` with injected `json`/`error`/`readJsonBody` — consistent and testable, at the cost of every handler re-checking service availability (the 503 boilerplate repeats ~8×).

**Persistence.** Pluggable `StateStoreLike` (KV rows with a `kind` discriminator + TTL): JSON file (dev), `node:sqlite` on a Fly volume (prod), DynamoDB (archived legacy). SQLite store: WAL + busy_timeout, parameterized throughout, per-kind load validation, 90-day TTL with a 15-minute `purgeExpired` interval, `:memory:` test mode. A Dynamo→SQLite migration script ships in the Docker image and has its own test. Factory lazy-imports the SQLite backend (`state-store-factory.ts:44`) — enforced by a static-analysis test (`state-store-no-sqlite.test.ts`), a nice pattern.

**Auth.** Layered: anonymous guest sessions (`rh_session` cookie), OpenRouter PKCE for BYOK AI (key stays browser-side; sessionStorage by default, never held by the server), Privy login (app-secret verification with JWT-key fallback), X OAuth (per-teacher posting), Telegram. `AuthService` keeps sessions in memory, hydrated from the store, with provider-ranked identity merge and GC. Rate limiting is an in-process token bucket with an exemplary design-rationale header documenting every bucket, capacity, and deliberately-ungated endpoint (`src/services/rate-limit.ts:1-38`). In-process is correct for the current single-machine scale-to-zero topology — revisit only if `min_machines_running` ever exceeds 1.

**LLM layer.** `llm-provider.ts` switches between OpenRouter and any local OpenAI-compatible endpoint (`RUBY_HIGH_LLM_PROVIDER=local`, e.g. Ollama) for all text features; image generation (portraits/diplomas) remains OpenRouter-only and is metered by Hall Passes via `hosted-entitlements.ts`. Model defaults live in `model-defaults.ts`; `llm.usage` events are logged with provider/model/status/duration.

**Game systems.** Authoritative state lives server-side in `QuizState` with an explicit 5-value `phase` machine plus a monotonic `phaseToken` (legacy 3-value `status` derived for compatibility — a migration done carefully, `types.ts:180-215`). Actions (`pose-question`, `pick-question`, `grade-answer`, `clear-board`, `handoff-faculty`) are exposed both as host actions and HTTP commands. Content is a pack registry with a built-in "Ruby High Original" pack, creator packs, weekly guest-faculty rotation, LLM-generated distractors, and graded essays.

**Frontend.** Deliberately framework-less and bundler-less: the viewer is server-rendered HTML assembled from `viewer-parts/` (`html.ts`, `css.ts` 7.7k lines, `client.ts` 12.6k lines). The client is authored as a real JS function (`@ts-nocheck`) and serialized into the page with `Function#toString()`; pure helpers live in `client-pure.ts` (509 lines) where they're unit-testable. Custom build verifiers (`check-viewer-script.mjs` transpiles and syntax-checks the assembled script; `check-viewer-bundle.mjs`, `check-privy-client-bundle.mjs`) substitute for a bundler's guarantees. PWA service worker scoped to `/api/apps/ruby-high/`, network-only for auth/chat/state. A separate offline SPA build (`build-spa.mjs`) reuses the shell with a localStorage API shim. Playwright covers a full student journey plus viewer smoke.

**Commerce/web3.** Hall Passes purchasable via Stripe (cent prices from env) or Solana memecoin transfer to a treasury; Gumroad for content products. NFT layer: Metaplex Core collections on mainnet, images on Arweave via Irys, and a commit-reveal provable-fairness scheme for card packs (`hall-pass-reveal-provenance.ts`: versioned algorithm string, stable-JSON catalog hash, sha256(commitment + revealSeed + assetAddress + slotIndex), v1.1 after the C2 fix). The whole web3 surface degrades cleanly when env keys are absent ("configured/reason" status objects rather than crashes).

**Infra.** Fly.io `iad`, `shared-cpu-1x`/512MB, scale-to-zero with ~300-500ms cold start (a deliberate, documented cost call), volume-mounted SQLite, `/health` checks at both Fly and Docker layers. Deploy workflow: verify (audit/typecheck/tests/coverage/build) → `flyctl deploy` with 3× retry → production smoke (`scripts/smoke.mjs`, 9 checks mapped to real past regressions from issue #45) → **automatic rollback to the previous Fly image if smoke fails**. Scheduled smoke every 30 minutes. Lockfile-sync check on PRs. Dependabot grouped updates. Legacy App Runner workflow retained as manual-dispatch only.

---

## 3. Findings

### P0 — Deploys blocked: `npm audit` gate regression
`.github/workflows/deploy-fly.yml:26` is `npm audit --omit=dev` (blocking). `c9ef776` changed it to `|| true` with explicit rationale; `a355478` reverted it (almost certainly unintentionally — it was 1 line inside a 34-file "stabilize" commit). All pushes/PRs since June 8 fail in <60s; typecheck/tests never run; nothing deploys (verified: runs 27181648832, 27181607701, and three Dependabot PRs, all failed at the audit step; 19 vulns / 4 high, all in the Solana/Irys tree).
**Fix:** restore the non-blocking form, or better `npm audit --omit=dev --audit-level=critical || true` as a visible-but-soft gate, and move real vuln management to Dependabot (already configured) or an allowlist. Also consider moving the audit step *after* typecheck/tests so a gate trip never blinds CI entirely.
**Post-review status:** fixed in the 2026-06-13 worktree.

### P1 — Hot mint-authority key on the web server
`RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY` is parsed into a signing keypair inside the app process (`core-pack-nfts.ts:235,535,952`; same pattern in `hall-pass-nfts.ts`). Any RCE or env exfiltration = attacker controls the collection authority and treasury-adjacent operations. Acceptable at current scale, but: (a) keep this authority funded/scoped to the minimum (mint-only authority, separate from treasury — treasury is already a separate owner address, good); (b) document a key-rotation runbook; (c) alert on unexpected on-chain activity from the authority.

### P1 — Node version skew across CI / prod / docs
CI runs Node **22** (all four `setup-node` invocations); the Dockerfile pins **node:24** specifically for unflagged `node:sqlite`; the README demands **Node ≥24**. There is no `engines` field in package.json. Tests currently pass on 22.x only because `node:sqlite` was backported unflagged late in the 22 line — a quiet dependency on a patch-level behavior. **Fix:** bump workflows to `node-version: "24"` and add `"engines": { "node": ">=24" }`.
**Post-review status:** fixed in the 2026-06-13 worktree.

### P2 — God files
- `src/viewer-parts/client.ts` — 12,562 lines, `@ts-nocheck`, one function. The serialization constraint ("no imports, Function#toString") explains the shape but not the size; the constraint allows splitting into multiple serialized functions or concatenated sections with the same no-import rule. This file is where maintainability goes to die first.
- `src/services/ruby-high-service.ts` — 8,099 lines, ~140 methods, one class: game state, leaderboards, metrics, hall-pass balances, yearbook, school snapshot. The `ruby-high/helpers.ts` extraction has started; continue it (metrics/analytics and commerce balances are the cleanest seams).
- `src/chat-routes.ts` — 3,682 lines mixing auth endpoints, chat, character generation, portraits. The `routes/` directory split worked well for everything else; finish the job here.
- `src/viewer-parts/css.ts` — 7,656 lines of CSS-in-template-literal; fine functionally, but no linting/dead-rule detection applies to it.

### P2 — Stale infra documentation (doc rot contradicting the AWS exit)
- `fly.toml` header: "The app reaches DynamoDB in us-east-1 for state, so we deploy to iad…" — false since the SQLite migration; the region rationale should now cite the S3 portraits bucket (still us-east-1) or be rewritten.
- `Dockerfile` comment: "Production uses DynamoDB; the path is retained for local/container fallback" — false.
- `fly.toml` still ships `AWS_REGION` and S3 portrait-bucket env. If portraits genuinely still ride S3, say so where the Dynamo comment was; `docs/aws-exit-migration.md` and these comments currently disagree.

### P3 — Smaller items
- **Default treasury/mint addresses baked into code** (`routes/billing.ts:156-158`, mirrored in `client.ts`): env-overridable, but a typo'd env var silently sells against the hardcoded default. Consider requiring them explicitly in production mode.
- **503-boilerplate repetition in `routes.ts`** — a small `requireServices(ctx, ["auth","ruby"])` helper would remove ~40 lines.
- **`coverage/` directory committed-adjacent**: gitignored but present locally with stale May data; harmless, worth a `npm run clean` addition.
- **Repo carries three codebases**: the production Node service, the `ruby2/` C rewrite wedge (deterministic engine + SDL + local-Ollama slice, with its own tests/Makefile — genuinely interesting work), and a vestigial `src-tauri/`. Fine for now; decide deliberately when `ruby2` graduates whether it forks out, because CI, Dependabot, and reviews currently see only the Node app.

---

## 4. Prior-review follow-up (2026-05-31 → HEAD)

| Finding | Status on HEAD |
|---|---|
| Teacher persistence dead path (no `saveTeacher`) | **Fixed** — `state-store.ts:218` interface + `sqlite-state-store.ts:290` impl |
| Static `node:sqlite` import in factory | **Fixed** — lazy `await import` at `state-store-factory.ts:44`, locked by static-analysis test |
| Expired rows purged only at open | **Fixed** — 15-minute interval, `sqlite-state-store.ts:356-363`, plus `sqlite-expired-purge.test.ts` |
| Dynamo→SQLite migration script missing | **Fixed** — `scripts/migrate-dynamo-to-sqlite.mjs` + test, copied into the Docker image |
| "Keep review docs durable" | **Honored** — `docs/engineering-review.md` survived; this report follows the dated-artifact convention |

The deleted-review items (admin C1, secret-leak C3, OAuth state, status-route auth) could not be re-derived from history in this pass either; spot-checks found OAuth nonce handling now has a dedicated test (`oauth-nonce.test.ts`) and admin routes are token-gated and disabled until `RUBY_HIGH_ADMIN_TOKEN` is set.

---

## 5. What's notably good

- **Comment culture**: comments explain *why*, with cost/tradeoff math (`fly.toml` scale-to-zero economics, rate-limit bucket table, App Runner pipefail note, iOS gesture workarounds). This is rare and worth protecting.
- **Test discipline**: 637 tests / 52 files running in ~3s; regression tests cite issue numbers; tests encode architectural rules (the no-static-sqlite-import test); smoke checks map 1:1 to previously shipped user-facing breakages.
- **Operational maturity**: deploy retry, post-deploy smoke, automatic image rollback, 30-minute scheduled prod smoke, lockfile gate, grouped Dependabot.
- **Security posture**: `.env` gitignored and never committed; secrets via `flyctl secrets` only; SSRF-hardened image fetching with DNS resolution (`safe-url.ts`); parameterized SQL throughout; BYOK keys never touch the server; admin surface dark until a token is provisioned; provable-fairness scheme is versioned and hash-committed.
- **Graceful degradation**: every optional integration (Privy, Solana, S3, X, Telegram, GitHub issues) reports `configured:false` + reason instead of crashing.

## 6. Recommended action order

1. **Unblock deploys**: restore the non-blocking audit (re-land `c9ef776`), bump CI to Node 24, add `engines`. (~15 min, restores all CI signal.) **Post-review status:** done in the 2026-06-13 worktree.
2. Decide the audit policy properly: `--audit-level=critical` soft gate + Dependabot as the real mechanism.
3. Carve the next seam out of `client.ts` (it grows with every feature; the cost compounds fastest there) and continue the `ruby-high-service.ts` extraction.
4. Fix the Dynamo-era comments in `fly.toml`/`Dockerfile` while the AWS exit is still fresh.
5. Write the mint-authority rotation runbook; verify the authority key is mint-scoped only.
6. When `ruby2` becomes the focus, split it out (or give it CI) so quality signal covers it.
