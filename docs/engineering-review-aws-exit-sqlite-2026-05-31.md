# Engineering Review — AWS-exit SQLite state store (working tree)

**Date:** 2026-05-31
**Reviewer:** Claude (Opus 4.8)
**Branch:** `main` (even with `origin/main`) + uncommitted working tree
**Scope:** The uncommitted AWS-exit migration only — `SqliteStateStore` and its wiring. The recent committed work (X/Twitter social, Telegram, admin dashboard, SSRF guard) is already covered by `docs/engineering-review-2026-05-31.md`; this report deliberately does **not** re-review it.

> ⚠️ A live Codex agent mutates this tree. Line numbers verified at review time; re-check before applying.

**Files reviewed (all uncommitted):**
- `src/services/sqlite-state-store.ts` (new, untracked) — `SqliteStateStore implements StateStoreLike`
- `src/__tests__/sqlite-state-store.test.ts` (new, untracked) — 6 round-trip tests
- `src/services/state-store-factory.ts` (modified) — adds `sqlite` backend
- `Dockerfile` (modified) — `node:22-slim` → `node:24-slim`
- `docs/aws-exit-migration.md` (new, untracked) — runbook

---

## Executive summary

The SQLite store is a genuinely solid piece of work: parameterized queries throughout (no injection surface), WAL + `busy_timeout`, defensive `undefined`/`NaN` coercion before binds, `:memory:` test support, and per-`kind` load validation that mirrors `DynamoStateStore` field-for-field. The factory wiring and Dockerfile bump are correct and well-commented.

Two issues are worth resolving before this is committed/deployed, plus a few lower-severity notes.

| Severity | Finding |
|---|---|
| 🟠 High | Teacher records cannot be persisted via the store on **any** backend; SQLite inherits the gap and its `loadTeachers()` always returns `[]`. The "key-for-key mirror" claim is untested for teachers. |
| 🟠 High | Static `node:sqlite` import couples **all** backends (json/dynamo too) to Node ≥ 22.5 / 24 — a non-node-24 dev/CI host crashes the factory import on startup, not just sqlite mode. |
| 🟡 Medium | Expired rows are only physically purged at process open; they accumulate on a long-running Fly machine. |
| ⚪ Low | A few parity/robustness nits (bulk-save isolation level, describe() path in logs). |

---

## 🟠 High — Teacher persistence is a dead path, and SQLite doesn't fix it

`StateStoreLike` exposes `loadTeachers()` and `deleteTeacher()` but **no `saveTeacher`** (`state-store.ts:190`). Tracing all three backends:

- **JSON store:** `this.teachers` is populated *only* during `load()` deserialization (`state-store.ts:412`); `writeCurrentSnapshot()` round-trips it (`:633`). There is no public method that ever adds a teacher.
- **Dynamo store:** `loadTeachers()` scans for items carrying a `teacherRecord` attribute (`dynamo-state-store.ts:192`); no store method ever writes one (only `deleteTeacher` touches the `teacher:<id>` key). The only `teacherRecord` write in the repo is in `dynamo-state-store.test.ts`.
- **SQLite store:** `loadTeachers()` reads `kind="teacherRecord"` (`sqlite-state-store.ts:174`) and `deleteTeacher()` deletes pk `teacher:<id>` (`:322`) — but **no `put(..., "teacherRecord", ...)` exists in the class.** So `loadTeachers()` is guaranteed to return `[]`.

The migration runbook explicitly lists *"session/auth/pack/**teacher**/metric state"* as living in the state store (`docs/aws-exit-migration.md:17`), and the service caches `teacherRecords` from `store.loadTeachers()` (`ruby-high-service.ts:2406, 2539`). So either:

1. **Teacher creation is intentionally routed through pack records** (`persistPublicTeacherPack` → `savePack`, `ruby-high-service.ts:2614`) and the `loadTeachers`/`deleteTeacher`/teachers-map trio is partial/legacy scaffolding — in which case SQLite *matches* the other backends and the real bug is dead code + a misleading runbook line; **or**
2. **There is a genuinely missing `saveTeacher` across all backends**, in which case teacher records never persist anywhere.

Either way this needs an explicit decision, because the new store advertises a "key-for-key mirror of the Dynamo single-table schema" while the teacher path is the one place it can't be exercised — and the new test sidesteps it (`sqlite-state-store.test.ts:68` sets `teachers: []`, with no teacher round-trip case).

**Action:**
- Confirm how a teacher record is *meant* to be created and persisted, then either (a) add a `saveTeacher` to the interface + all three stores, or (b) delete the load/delete teacher trio and the runbook's "teacher state" claim if teachers ride inside packs.
- Add a teacher round-trip test (save → reopen → `loadTeachers`) so the mirror claim is actually verified for every record kind.

## 🟠 High — Static `node:sqlite` import couples every backend to Node ≥ 22.5

`state-store-factory.ts` now does a **static** `import { SqliteStateStore } from "./sqlite-state-store.js"`, which in turn statically `import { DatabaseSync } from "node:sqlite"`. Module imports are eager, so merely importing the factory loads `node:sqlite` **regardless of the selected backend**. On a Node that lacks the stable builtin (anything below 24 without the `--experimental-sqlite` flag — e.g. the previous `node:22` base, or a contributor's local/CI Node), that import throws at startup and takes down the whole app, even for `json`/`dynamodb` deployments.

Production is safe (Dockerfile is now `node:24-slim`), but local dev, CI, and any test importing the factory inherit the coupling.

**Action:** make the SQLite backend a lazy `await import("./sqlite-state-store.js")` inside the `backend === "sqlite"` branch so json/dynamo paths never touch `node:sqlite`. Also confirm the test runner and CI run on Node ≥ 24 (or pass `--experimental-sqlite`).

## 🟡 Medium — Expired rows only purged at open

`purgeExpired()` runs once in the constructor (`sqlite-state-store.ts:96`). Reads correctly filter on `expires_at` (`rowsOfKind`, `:104`), so expired data is never *served* — but it is never *deleted* on a long-lived Fly machine until the next deploy/restart. Sessions and metric events (90-day TTL) will accumulate on the Volume indefinitely between deploys.

**Action:** run `purgeExpired()` periodically (e.g. a `setInterval(...).unref()` hourly, or piggyback on writes every N puts). The `kv_expires` index already makes it cheap.

## ⚪ Low / parity notes

- **Bulk `save()` transaction** uses `db.exec("BEGIN")` (deferred). For a write-only batch, `BEGIN IMMEDIATE` avoids a deferred→write lock upgrade under WAL contention. Minor; node:sqlite is synchronous so practical risk is low.
- **`describe()` returns `sqlite://<full path>`** (`:355`) — fine, but it surfaces the absolute DB path wherever `describe()` is logged. Path isn't secret; just noting.
- **`saveAuthUser` / `savePackInstallation` pass `null` expiry** (never expire) — looks intentional and matches the no-TTL semantics for durable records; confirm it mirrors Dynamo's attribute set.
- **`mkdirSync` swallow** (`:75`) is fine, but a genuinely un-creatable dir will surface as a less clear `DatabaseSync` open error rather than the mkdir error. Acceptable.
- **No Dynamo→SQLite data-copy in this changeset.** The runbook references `scripts/migrate-dynamo-to-sqlite.mjs` (`aws-exit-migration.md:45`) as a *pending* step — confirm that script exists and round-trips before flipping `RUBY_HIGH_STORE_BACKEND` in prod, or existing user state is silently abandoned.

---

## What's good

- **No SQL-injection surface** — every statement is parameterized; `kind`/pk are code-controlled enums/derived keys.
- **Correct TTL units** — all `expires_at` comparisons are in **seconds** (`rowsOfKind`, `defaultExpiry`, `purgeExpired`, `saveAuthSession`'s `expiresAt/1000`); `updated_at` in ms. Consistent.
- **Load-time validation per kind** faithfully mirrors `DynamoStateStore`'s discriminator checks, so a corrupt/partial row is skipped rather than crashing a load.
- **Defensive binds** — `put()` coerces non-finite `updatedAt`/`expiresAt` because `node:sqlite` rejects `undefined`/`NaN`; a real footgun handled correctly.
- **Operationally sound** — WAL (Litestream-friendly), `busy_timeout`, `INSERT OR REPLACE` idempotency, `:memory:` for tests, and the hard requirement that the path live on a mounted Volume is documented both in code and the runbook.

## Recommended action order

1. Resolve the **teacher persistence** question (interface decision) and add a teacher round-trip test.
2. Switch the SQLite import to **lazy `await import`** so json/dynamo hosts don't require Node 24; confirm CI Node version.
3. Add **periodic `purgeExpired`**.
4. Verify the **Dynamo→SQLite migration script** exists and round-trips before the prod backend flip.
