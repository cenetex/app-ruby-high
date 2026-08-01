# AWS Exit — Consolidate onto Fly

**Date:** 2026-05-31
**Goal:** close the AWS account. Today the stack is split AWS (DynamoDB + S3) ↔ Fly (app), which doubles the ops load. Target: **everything on Fly**, with Arweave/Solana for the permanent NFT/provenance pipeline (those aren't AWS and add no admin burden).

**Decisions (locked):**
- **State store:** DynamoDB → **SQLite on a Fly Volume** (`node:sqlite`, no native dependency).
- **Portrait images:** S3 → **Tigris** (Fly's S3-compatible object store; the existing S3 client just gets a new endpoint).
- **NFT art / metadata / (later) character NFTs:** continue through **Arweave/Irys** (already wired). Portraits will be filtered through this pipeline as character NFTs ship.

---

## The full AWS footprint (everything to remove)

| AWS service | Used by | Replacement |
|---|---|---|
| **DynamoDB** — session/auth/pack/teacher/metric state | `dynamo-state-store.ts` (prod: `RUBY_HIGH_STORE_BACKEND=dynamodb`) | SQLite on Fly Volume |
| **DynamoDB** — X OAuth tokens | `x-social-service.ts` `DynamoXTokenStore` (same backend flag) | `JsonXTokenStore` on the Volume (or a SQLite token store) |
| **S3** — generated portraits | `character-generation.ts` `uploadPortraitToS3` | Tigris (S3-compatible) |

Every AWS path already has a non-AWS fallback, so this is a config-and-storage migration, not a rewrite.

---

## ⚠️ The one hard rule: state MUST live on a Fly Volume

A Fly machine's **root filesystem is wiped on every deploy/restart**. Putting `ruby-high.db` on the machine's local disk with no Volume = **total state loss (wallets, NFTs) on the next deploy.** A persistent **Fly Volume** mounted at `/data` is mandatory. The Dockerfile already sets `RUBY_HIGH_DATA_DIR=/data` and `mkdir -p /data` in anticipation.

Tradeoff accepted: one Volume = one machine, one region (`iad`), single point of failure. Mitigations: Fly's automatic daily volume snapshots (5-day retention) **plus** Litestream streaming WAL backups to Tigris (below).

---

## Status (updated 2026-07-12)

### ✅ Complete
- Production uses `SqliteStateStore` on the `/data` Fly Volume; `fly.toml` sets `RUBY_HIGH_STORE_BACKEND=sqlite` and mounts `ruby_high_data`.
- `scripts/migrate-dynamo-to-sqlite.mjs` ships in the image and has migration coverage.
- X OAuth tokens use `JsonXTokenStore` on the Volume when the backend is SQLite; the database-file path handling is fixed.
- Node 24, periodic SQLite expiry purging, and the lazy SQLite import are in place.

### ⬜ Remaining
1. Move the configured `ruby-high-portraits` S3 bucket to Tigris or another non-AWS S3-compatible provider.
2. Verify the current backup/restore path operationally.
3. Decide when the manual App Runner/Dynamo rollback path can be deleted, then remove its runtime backend, workflow, IAM policy, and AWS dependencies.
4. Decommission the remaining AWS resources only after portrait migration and a verified backup.

---

## Historical cutover runbook

The state cutover below has already happened. Keep these steps for recovery and audit context; do not rerun them against production without a fresh backup and row-count plan.

### Step 1 — Tigris for portraits  (code)
**File:** `src/services/character-generation.ts`, `getPortraitS3Client()` (~line 49).
1. `fly storage create` → provisions a Tigris bucket and sets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `BUCKET_NAME` as app secrets.
2. Add the Tigris endpoint to the `S3Client` (Tigris is S3-API-compatible, so this is the only code change):
   ```ts
   portraitS3Client = new S3Client({
     region: process.env.RUBY_HIGH_PORTRAITS_REGION ?? process.env.AWS_REGION ?? "auto",
     ...(process.env.AWS_ENDPOINT_URL_S3
       ? { endpoint: process.env.AWS_ENDPOINT_URL_S3, forcePathStyle: true }
       : {}),
   });
   ```
   Keeping the `endpoint` optional means local/dev (no endpoint set) still talks to real S3 or no-ops; prod uses Tigris.
3. Set `RUBY_HIGH_PORTRAITS_BUCKET` to the Tigris bucket name and `RUBY_HIGH_PORTRAITS_PUBLIC_BASE` to its public base URL (Tigris public URLs differ from the `https://<bucket>.s3.<region>.amazonaws.com` default the code falls back to, so this env is **required**).

**Acceptance:** generating a portrait writes an object to the Tigris bucket and `setPortrait` stores a working public URL; no `*.amazonaws.com` host appears in stored portrait URLs.

### Step 1b — X token store off Dynamo  (code)
**File:** `src/services/x-social-service.ts`. The X token store follows the same `isDynamoBackend()` check, so once `RUBY_HIGH_STORE_BACKEND=sqlite` it automatically falls back to `JsonXTokenStore`. **No new backend needed** — but there's a path bug to fix:

⚠️ **Gotcha:** `JsonXTokenStore` builds its path as `resolve(process.env.RUBY_HIGH_STATE_PATH ?? "~/.ruby-high", "x-tokens.json")` — it treats `RUBY_HIGH_STATE_PATH` as a **directory**. For SQLite, `RUBY_HIGH_STATE_PATH` is a **file** (`/data/ruby-high.db`), so this would try to write `/data/ruby-high.db/x-tokens.json` (a path *inside* the db file) and fail.

**Fix:** point the token store at the data **directory**, not the db file:
```ts
// JsonXTokenStore constructor:
const dir = process.env.RUBY_HIGH_DATA_DIR
  ?? (process.env.RUBY_HIGH_STATE_PATH ? dirname(process.env.RUBY_HIGH_STATE_PATH) : resolve(homedir(), ".ruby-high"));
this.filePath = resolve(dir, "x-tokens.json");
```
`RUBY_HIGH_DATA_DIR=/data` is already set in the Dockerfile, so the token file lands at `/data/x-tokens.json` on the Volume. `isDynamoBackend()` must also return `false` for `sqlite`/`json` (verify it keys off `RUBY_HIGH_STORE_BACKEND === "dynamodb"`, not "is the value set").

**Acceptance:** with `RUBY_HIGH_STORE_BACKEND=sqlite`, connecting an X account writes `/data/x-tokens.json` (not under the db path), and tokens survive a restart.

### Step 2 — Provision the Volume
```sh
fly volumes create ruby_high_data --region iad --size 3   # GB; size to current Dynamo footprint + headroom
```
Add to `fly.toml`:
```toml
[[mounts]]
  source = "ruby_high_data"
  destination = "/data"
```

### Step 3 — Migrate data (Dynamo → SQLite)  🔒 IRREVERSIBLE GATE  (code)
**File:** `scripts/migrate-dynamo-to-sqlite.mjs` (run against the built `dist/`). Construct a `DynamoStateStore` (read) and a `SqliteStateStore` (write), copy every collection via the existing interface methods, and assert counts.

```js
// node scripts/migrate-dynamo-to-sqlite.mjs --table ruby-high-state --out /tmp/ruby-high.db
import { DynamoStateStore } from "../dist/services/dynamo-state-store.js";
import { SqliteStateStore } from "../dist/services/sqlite-state-store.js";

const src = new DynamoStateStore({ tableName: TABLE, region: REGION });
// ttlSeconds: 0 so the migration never drops not-yet-expired rows on write.
const dst = new SqliteStateStore({ path: OUT, ttlSeconds: 0 });

const sessions = await src.load();            await dst.save(sessions.values());
const auth = await src.loadAuth();
for (const u of auth.users)    await dst.saveAuthUser(u);
for (const s of auth.sessions) await dst.saveAuthSession(s);
for (const p of await src.loadPacks())             await dst.savePack(p);
for (const d of await src.loadDraftPacks())        await dst.saveDraftPack(d);
for (const i of await src.loadPackInstallations()) await dst.savePackInstallation(i);
for (const m of await src.loadMetricEvents())      await dst.saveMetricEvent(m);

// Per-collection row-count assertions (fail loudly on mismatch):
assertEqual((await dst.load()).size, sessions.size, "sessions");
assertEqual((await dst.loadPacks()).length, (await src.loadPacks()).length, "packs");
// …repeat for auth users/sessions, draftPacks, packInstallations, metricEvents.
```

Teachers have **no write path** in either backend (read-from-snapshot + delete only), so `loadTeachers()` is normally empty in prod; if it returns rows, insert them as `kind='teacherRecord'` directly via a one-off (the SQLite store can expose a small `importTeacher()` helper, or write the row in the script).

**Before running:**
- [ ] **Back up DynamoDB** (on-demand backup or full export to S3) — point-in-time safety net.
- [ ] Run the script against a **local** `ruby-high.db`, then assert **row counts match** per collection (`load*().length` Dynamo == SQLite). Spot-check a few wallets with NFTs.
- [ ] Keep Dynamo intact and untouched through the next two steps.

### Step 4 — Cutover
1. Upload the migrated `ruby-high.db` onto the Volume (one-off `fly ssh`/`fly sftp`, or run the migration script as a one-off Fly machine that reads Dynamo and writes to the mounted Volume).
2. Flip secrets/env:
   ```
   RUBY_HIGH_STORE_BACKEND=sqlite
   RUBY_HIGH_STATE_PATH=/data/ruby-high.db
   ```
   Remove `RUBY_HIGH_DYNAMO_TABLE`, `AWS_REGION`, AWS keys (keep the Tigris ones).
3. Deploy. **Verify in prod:** existing players load with wallets/NFTs intact, a new answer persists, a portrait uploads to Tigris, `/health` green. The store logs `describe()` → `sqlite:///data/ruby-high.db`.

### Step 5 — Backups (Litestream)
Run Litestream as a sidecar/process streaming `/data/ruby-high.db` (WAL) to a Tigris bucket. Verify a restore into a scratch file before trusting it. (Fly volume snapshots are the second line of defense.)

### Step 6 — Decommission AWS
Only after several days of healthy SQLite operation **and** a verified Litestream restore:
- [ ] Delete the DynamoDB table(s).
- [ ] Delete the S3 portraits bucket.
- [ ] Delete the IAM user/keys the app used.
- [ ] Close the AWS account.

---

## Rollback
Until Step 6, rollback is instant: set `RUBY_HIGH_STORE_BACKEND=dynamodb` (+ restore the Dynamo env) and redeploy. Dynamo is untouched until decommission, so no data is at risk during the transition.

## Future
- If you ever need multi-machine, SQLite-on-one-Volume won't scale horizontally → LiteFS (replicated SQLite) or Fly Postgres. Not needed at current scale.
- The C2 "one-mint-per-custom-student" ledger (paused; 15% drop, paid packs only) lands as a small collection in this SQLite store — or as an Arweave append-log if we want it permanent/verifiable.
