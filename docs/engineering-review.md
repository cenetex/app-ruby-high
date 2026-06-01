# Ruby High — Engineering Review (consolidated)

**Date:** 2026-05-31 · **Reviewer:** Claude (Opus 4.8)
**Branch:** `main` (clean, even with `origin/main`)

> ⚠️ **Volatility / audit-trail note.** A live Codex agent is actively committing here. Two prior review docs (`engineering-review-2026-05-31.md` covering the X-social/admin work, and `engineering-review-aws-exit-sqlite-2026-05-31.md` covering the SQLite migration) were **deleted by the agent in commit `0cc94fc`** after it acted on some of their findings. This consolidated report replaces both. It may itself be swept — treat it as a snapshot, and re-confirm against HEAD before relying on it.

---

## Higher-level take

Ruby High is the project that's both **on-mission** (the one funded, revenue-first product) and **the most carefully engineered** of the work I've reviewed across the repos. That is not a coincidence — focus and quality track together here. The SQLite state store is the cleanest single piece of code in any of the three repos: parameterized throughout, correct TTL units, defensive binds, load-time validation that mirrors the Dynamo store field-for-field.

The closing discipline is also visibly working: the agent read the prior reviews and **fixed the criticals** (provable-fairness player cards, SSRF hardening with DNS resolution, node:sqlite bundling). The one process wrinkle is that it then **deleted the reviews** — which destroys the audit trail and makes "is this actually closed?" harder to answer later. Worth keeping review docs as durable artifacts, not scratch files.

Net: keep Ruby High the focus. The two repos with the dangerous open findings (trebuchet's seed-as-private-key, AutoForwarder's distribution trust) are the off-mission ones. That contrast is the whole argument.

---

## ✅ Resolved by the agent (confirmed by commit)
- **C2 — player cards leaking into provably-fair pack draws** → `cf7cfd2 "Fix C2: keep player cards out of provably-fair pack draws"`.
- **SSRF in image resolution** → `7226dac` extracts `assertSafeImageUrl` into `safe-url.ts`, resolves hostnames via DNS, and blocks private/loopback/link-local — closing the DNS-rebinding vector the old static-suffix filter missed.
- **node:sqlite bundling** → `0cc94fc` marks it external in `tsup.config.ts`.

## ⚠️ From the deleted X-social/admin review — RE-CONFIRM against HEAD
The prior review flagged (besides C2, now fixed): an **admin-dashboard syntax error (C1)**, a **secret/token leak (C3)**, **predictable OAuth state**, an **unauthenticated status route**, and **transient-failure disconnects**. C2 and SSRF are confirmed closed; the rest were not re-verified in this pass because their report was deleted. **Action:** re-confirm C1/C3 and the OAuth/status-auth items are closed on current HEAD before deploy — the absence of the review doc is not evidence the fixes landed.

## 🟠 AWS-exit SQLite store — OPEN (verified this pass)

### Teacher persistence is a dead path; SQLite inherits it
`StateStoreLike` exposes `loadTeachers()` + `deleteTeacher()` but **no `saveTeacher`**. SQLite's `loadTeachers()` reads `kind="teacherRecord"` (`sqlite-state-store.ts:174`) and nothing in the class ever writes that kind → it always returns `[]`. The JSON and Dynamo stores have the same shape (teachers populated only on load / scanned-for but never written via the store API). The migration runbook lists "teacher state" as living in the store, so this asymmetry must be resolved: either add `saveTeacher` across the interface + all three backends, or delete the load/delete teacher trio if teachers ride inside pack records (`persistPublicTeacherPack` → `savePack`). Add a teacher round-trip test — the current SQLite test sets `teachers: []` and skips it.

### Static `node:sqlite` import couples all backends to Node ≥24
`state-store-factory.ts:3` still **statically** imports `SqliteStateStore` → `node:sqlite`. Importing the factory loads `node:sqlite` regardless of backend, so any non-node-24 dev/CI host crashes the factory import even for `json`/`dynamodb`. (The `tsup` external change addresses bundling, not this eager runtime import.) **Fix:** lazy `await import("./sqlite-state-store.js")` inside the `backend === "sqlite"` branch; confirm CI runs Node ≥24.

### Lower severity
- **Expired rows purged only at process open** — reads filter correctly, but data accumulates on a long-lived Fly machine. Add a periodic `purgeExpired()` (the `kv_expires` index makes it cheap).
- **No Dynamo→SQLite data-copy in this changeset** — the runbook references a *pending* `scripts/migrate-dynamo-to-sqlite.mjs`. Confirm it exists and round-trips before flipping `RUBY_HIGH_STORE_BACKEND` in prod, or existing user state is silently abandoned.

## What's good (SQLite store)
No SQL-injection surface (parameterized; pk/kind code-controlled); correct seconds-based TTL throughout; per-kind load validation mirrors Dynamo; defensive `undefined`/`NaN` bind coercion; WAL + busy_timeout (Litestream-friendly); `:memory:` test support; the Volume requirement documented in code and runbook.

## Action order
1. **Re-confirm the deleted review's C1/C3/OAuth/status items** are actually closed on HEAD.
2. Resolve **teacher persistence** (interface decision) + add a round-trip test.
3. **Lazy-import** the SQLite backend; confirm CI Node version.
4. Periodic `purgeExpired`; verify the **migration script** before the prod backend flip.
5. **Keep review docs as durable artifacts** — don't delete them on fix.
