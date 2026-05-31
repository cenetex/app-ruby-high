# Engineering Review — Ruby High

**Date:** 2026-05-31
**Reviewer:** Claude (Opus 4.8), multi-agent review + manual verification
**Snapshot reviewed:**
- Last commit `f4d7ca3` ("Commit in-progress working-tree changes", 2026-05-30 06:06) — the new **X (Twitter) social integration** (~1,900 lines).
- **Uncommitted working tree** as of 2026-05-31 ~14:00 (~1,400 lines of further changes to admin, x-social, ruby-high-service) + untracked `src/services/telegram-service.ts` and Solana Core-vector scripts.

> ⚠️ A live Codex agent is actively mutating this working tree. Line numbers below were verified against the snapshot at review time and may have drifted. Re-check before applying fixes. Findings marked **[verified]** were confirmed by reading the current code directly; **[reported]** were surfaced by review agents but not independently traced — confirm before acting.

---

## Executive summary

The recent work adds a substantial **X/Twitter auto-posting integration** (OAuth2 + PKCE, milestone tweets, media upload), a new **Telegram broadcast service**, and an expanded **admin dashboard**. The architecture is reasonable and the happy paths are tested (`x-social-service.test.ts`, +479 lines). However, the change set carries **one ship-blocking bug** and a cluster of **security issues concentrated in the externally-facing social/admin surface** that should be resolved before this is committed/deployed.

| Severity | Count | Theme |
|---|---|---|
| 🔴 Critical | 3 | Admin dashboard dead (syntax error); NFT provable-fairness broken; secret leak |
| 🟠 High | 4 | SSRF, predictable OAuth state, unauth status route, transient-failure disconnect |
| 🟡 Medium | ~7 | Missing timeouts, rate-limit/photo races, non-atomic token write, `as any` reach-ins |
| ⚪ Low | ~8 | Dead code, weakened test, MIME edge cases, HTML-escaping gaps |

**Fix before commit:** C1 (admin syntax error) — it's a one-block deletion and the whole admin panel is currently non-functional in the working tree.
**Fix before deploy:** C3 (token leak), H1 (SSRF), H2 (OAuth state), H3 (status auth).
**Needs product/author decision:** C2 (player cards vs. provable-fairness commitment).

---

## 🔴 Critical

### C1. Admin dashboard is completely dead — duplicate top-level `const` in one `<script>` scope **[verified]**
**File:** `src/routes/admin.ts` (working tree, uncommitted)
`admin.ts` renders a single inline `<script>` (confirmed: exactly one `<script` tag in the file). The working-tree changes duplicate these top-level declarations **within that one scope**:

| Identifier | First | Second |
|---|---|---|
| `const studentsPanel` | 1458 | 1649 |
| `refreshStudents` | 1460 | 1651 |
| `const origHandler` | 1496 | 1687 |
| `postReportCard` | 1505 | 1696 |
| `postClassPhoto` | 1539 | 1730 |

Two `const studentsPanel` in the same scope throws `SyntaxError: Identifier 'studentsPanel' has already been declared` at **parse time**, which aborts the entire script. Every admin panel (metrics, X-social, Telegram, students) stops working. The first copy is also spliced into `disconnectX`'s `try` block, corrupting that function too.
**Fix:** Delete the duplicated second block (≈1649–1735) — it's a copy-paste artifact. Also remove the trailing `// cache bust <ts>` dev marker. This is uncommitted, so fix before the next commit.

### C2. Player cards break the pack provable-fairness commitment **[reported — confirm before acting]**
**File:** `src/services/ruby-high-service.ts:~6656–6697` + `hall-pass-reveal-provenance.ts:~43`
`hallPassCardPackEntries` now injects `pickPlayerStudentCard(...)` (a live student picked from mutable `sessions` state) into a pack, but the committed `catalogHash` is computed only over the static `HALL_PASS_CARD_CATALOG`. The reveal commitment is published up front, yet the actual card identity is now derived from live state at open time. Consequences:
- An auditor recomputing the reveal from the published commitment + catalog gets a **different card** than was issued → the pack is no longer provably fair.
- `pickPlayerStudentCard` indexes `Map` insertion order of `sessions`, so re-issuing/re-opening the same transaction can yield a **different player** (and `artPosition` points into a sprite sheet by an index unrelated to the chosen player). If `sessions` is empty at reissue (e.g. post-restart before hydration), it silently falls back to a different catalog card.
**Fix:** Either (a) snapshot the eligible-player set at mint and include it in the committed `catalogHash`, or (b) keep player cards out of the `usesPackReveal` provably-fair path entirely. Resolve the player slot to a **stable** `characterId` captured at issue time and persist it on the card rather than recomputing from live sessions.

### C3. Telegram bot token round-trips to the browser **[verified]**
**File:** `src/routes/x-social.ts:290–296` → `src/services/telegram-service.ts:33–36`
`GET /x/telegram` returns `telegram.getConfig()`, and `getConfig()` returns the full config object including the plaintext **`botToken`** (the admin dashboard loads it into an input). A Telegram bot token grants full control of the bot. It's admin-gated, but secrets should never be sent to a browser (it lands in DOM, memory, possibly logs/extensions).
**Fix:** Return `{ chatId, enabled, hasToken: !!botToken }` — never the token itself. Same for the `POST /x/telegram` response (`:325`).

---

## 🟠 High

### H1. SSRF — `resolveImageToBuffer` fetches arbitrary URLs, bypassing the existing guard **[verified]**
**File:** `src/services/x-social-service.ts:622` (called from `:520`)
`resolveImageToBuffer` does `fetch(url)` on any non-`data:` URL (portrait/diploma/image refs) with no host or IP validation. The repo **already has** `assertSafeMaterialsUrl` (`src/pack-library-routes.ts:2870`, with DNS resolution + private-IP blocking) for exactly this SSRF class — it is simply not applied here. A crafted image ref (`http://169.254.169.254/...`, `http://localhost:.../`) would be fetched server-side and its bytes uploaded to X.
**Fix:** Route this fetch through `assertSafeMaterialsUrl` (or equivalent), restrict to `https:` + allow-listed hosts, reject private/link-local IPs, and cap response size before buffering.

### H2. OAuth `state` is a predictable counter, not cryptographically random **[verified]**
**File:** `src/services/x-social-service.ts:327` — `state = \`rh-x-${++this.stateCounter}-${teacherId}\``
`state` is a monotonic in-process counter + known teacherId — fully guessable, and resets to 0 on restart. `state` is the CSRF defense for the (intentionally unauthenticated) callback. A predictable state weakens login-CSRF protection (an attacker could attempt to bind their own X account to a teacher). `randomBytes` is **already imported** and used for PKCE — just not for state.
**Fix:** `const state = \`rh-x-${base64UrlEncode(randomBytes(16))}-${teacherId}\``. Continue looking up teacherId from the stored `pendingVerifiers` entry so the random value is the only proof.

### H3. Transient X API failure permanently disconnects a teacher **[reported]**
**File:** `src/services/x-social-service.ts:~697`
On any non-OK refresh response, `ensureFreshToken` calls `disconnect(teacherId)`, deleting the token. A momentary X outage or `429`/`5xx` thus permanently drops the connection and forces a full re-OAuth.
**Fix:** Only `disconnect` on `400/401` (`invalid_grant`); on `5xx`/`429` return `null` without deleting so it retries later.

### H4. `/x/status/:teacherId` is unauthenticated **[verified]**
**File:** `src/routes/x-social.ts:97–103`
Every other `/x/*` route gates on `requireAdminAuth`; this one does not. It returns `getStatus()` (`xScreenName`, `connectedAt`) to any caller. Low data-sensitivity, but inconsistent and an unintended public endpoint.
**Fix:** Add `requireAdminAuth`, or deliberately document it as public and strip `xScreenName`/`connectedAt`.

---

## 🟡 Medium

- **M1. No timeouts on X/Telegram `fetch` calls** (`x-social-service.ts` token exchange/refresh/revoke/`fetchXUser`/`uploadMedia`/`postTweet`; `x-social.ts:280,308` Telegram proxies). Only LLM calls pass `timeoutMs`. If X hangs, `handleCallback` blocks the OAuth response and fire-and-forget milestone posters leak. **Fix:** `signal: AbortSignal.timeout(10_000)` on each.
- **M2. `find-chat` interpolates the bot token unencoded into the URL path** (`x-social.ts:280`). Token in a GET query string lands in access logs; unencoded `${token}` allows path traversal within `api.telegram.org`. **Fix:** validate `^\d+:[A-Za-z0-9_-]+$`, `encodeURIComponent`, prefer POST body — or drop the endpoint (the POST handler already auto-detects).
- **M3. Rate-limit + daily-photo races.** `recordPost` increments only on success, and `checkPostRateLimit` doesn't reserve a slot — concurrent un-awaited `maybePostMilestone` calls can both pass before either records (TOCTOU > 50/24h). `maybePostDailyPhoto` (fired on every viewer load) selects + posts without reserving, relying on the in-memory `lastPhotoDate` guard that resets on deploy. **Fix:** reserve/increment on attempt; set an in-flight flag (or set `lastPhotoDate` optimistically before the await); persist `lastPhotoDate`.
- **M4. `import-token` reaches into private internals via `(xSocial as any).tokenStore/.tokens/.fetchXUser`** (`x-social.ts:123–151`) and persists unvalidated attacker-supplied tokens, bypassing OAuth/PKCE. Admin-gated. **Fix:** expose a public `importToken()` on the service; confirm this debug endpoint is intended for production.
- **M5. `JsonXTokenStore.write` is not atomic** (`x-social-service.ts:~121`): writes a tmp file, then writes the real file, then unlinks tmp — the tmp is never `rename`d into place, so a crash mid-write truncates the live token file. **Fix:** `writeFile(tmp); rename(tmp, filePath)`.
- **M6. `nft-metadata-storage.ts:~996` image-upload override path** conflates raw-image and metadata-JSON storage contracts, and returns the bare gateway root on a missing receipt id (a silent non-erroring "success") on the NFT data-integrity path. **Fix:** make the override image-aware or skip it for images; throw on empty `receipt.id`.
- **M7. Two divergent `requireAdminAuth` implementations** (`admin.ts:81` returns `string|null`, 503-on-unconfigured, handles array headers; `x-social.ts:5` returns `bool`, silent 401, and `typeof auth !== "string"` rejects valid array-form headers). Token compared with `===` (timing-attackable) in both. **Fix:** consolidate into one shared helper using `crypto.timingSafeEqual`.

---

## ⚪ Low

- **L1.** `yearbook.ts:206` — `gradeLabel` fallback interpolates raw `student.grade` unescaped into an `image/svg+xml` response (latent XSS). Function (`renderReportCardSvg`) currently has **no callers**, so latent. **Fix:** escape it; or remove the dead renderer.
- **L2.** Dead code introduced: `renderReportCardSvg` + its duplicate `escapeXml` (`yearbook.ts:177–223`, unwired); `buildYearbookShareActions` (`client.ts:~8171`, orphaned after share-control removal); `.paper-archive-pending` CSS (`css.ts:6038`, never applied); unused `llmProviderName` import (`x-social-service.ts:18`).
- **L3.** `viewer-regression.test.ts:472` — "sealed yearbook share controls" test was reduced from 5 assertions to a single substring (`paper-archive-portrait`) check. Consistent with the feature swap but materially weaker; the `it(...)` name no longer matches behavior. **Fix:** rename and assert the portrait `img` wiring.
- **L4.** `telegram-service.ts:~120` — `postSchoolSnapshot` interpolates student names into `parse_mode: "HTML"` Telegram messages without escaping; a crafted name could break parsing or inject markup. **Fix:** HTML-escape interpolated names.
- **L5.** `detectImageMime` (`x-social-service.ts:~2062`) reads `bytes[8..11]` after only guarding `length < 4` — truncated buffers misdetect as PNG. **Fix:** guard `< 12` before the WebP check.
- **L6.** `gradeScore` letter math (`ruby-high-service.ts:~1356`) silently clamps any non-A–F first char to F/A, skewing leaderboards. **Fix:** guard for the A–F set.
- **L7.** `handleCallback` returns HTTP 400 for all OAuth errors including internal/network failures (`x-social.ts:64`), and the success-page `<h1>` has a stray leading space / dropped emoji (`:57`).

---

## ✅ What's solid (no action)

- **PKCE** generation is correct (S256, random 32-byte verifier).
- **Access/refresh tokens are never logged** — log events carry only `teacherId`/`xScreenName`/`status`.
- **Admin auth is consistently applied** to every mutating/listing `/x/*` route except `/x/callback` (correctly public) and the `/x/status` gap noted in H4.
- **Media upload falls back to text-only** on failure, and the milestone path tolerates it; covered by tests.
- **The Core-vector scripts** (`scripts/generate-core-vectors.mjs`, `inspect-core.mjs`, `core-vectors.json`) are offline test-vector generators against `localhost:8899` with throwaway signers — no key-handling risk, don't touch the live mint path. Fine as untracked dev tooling.
- **The dev/prod server-script changes** (`dev-server.mjs`, `server.mjs`) only register `TelegramService` in the fake-runtime map, wrapped in try/catch so a missing token won't block boot. Reliability fine.
- **`setPortrait`/`setDiplomaImage` → enqueue refactor** and `PendingPhotoReveal` typing are coherent; tests updated to match.

---

## Recommended fix order

1. **C1** — delete the duplicated admin `<script>` block (unblocks the admin dashboard; do before next commit).
2. **C3, H1, H2, H4** — secret leak, SSRF, OAuth state, status auth (before deploy).
3. **C2** — decide player-card vs. provable-fairness (product call; gates any pack mint that includes player cards).
4. **H3, M1–M3** — transient-disconnect, timeouts, rate-limit/photo races (resilience under real X traffic).
5. **M4–M7, Low items** — cleanup pass.

---
*Generated by automated multi-agent review (4 parallel reviewers across X-social, NFT/core-service, admin/telegram, and viewer/scripts subsystems) with manual verification of all Critical/High findings against the working tree.*
