# C2 — Fix pack provable-fairness; custom students become a scarce random bonus

**Date:** 2026-05-31
**Status:** design approved, ready to implement
**Origin:** finding **C2** in `docs/engineering-review-2026-05-31.md`.

This is an implementation spec for a Codex agent. Identifier/function names are stable; line numbers are approximate ("~") — anchor on the names and verify against current code (the tree mutates).

---

## Problem

The provably-fair pack draw (`usesPackReveal` path in `issueHallPassCardsForTransaction`, `ruby-high-service.ts:~6739`) commits `catalogHash = H(static catalog)` + a `revealSeed` at mint, so anyone with `(commitment, revealSeed, packAssetAddress, catalogHash)` can recompute every card and verify it matches what was issued.

`hallPassCardPackEntries` (`~6685`) breaks this by injecting `pickPlayerStudentCard(...)` (`~6650`), which selects a card from the **live, mutable `sessions` map** at open time. That pool is **not in `catalogHash`** and is **gone by audit time**, so the player slot is not reproducible — the proof is incomplete. Even the server can't reproduce its own commitment for that slot.

## Decision (Option B + scarce bonus)

1. **Make the pack 100% provably fair** — remove the player card from the committed draw; the 5-card pack is drawn entirely from the static catalog.
2. **Custom students become a separate "random bonus" card** — issued *outside* the proof, flagged non-fair, dropped at **15%** on **paid packs only**, and **minted at most once per custom student ever** (a scarce collectible). Framed in-product as a *signal of server trust*, not a provable draw.

**Tunable constants (name them):**
- `BONUS_STUDENT_DROP_RATE = 0.15`
- bonus eligible only when the pack transaction is a **paid** purchase (Stripe/Solana), not a free/granted pack.

---

## Implementation

### 1. Make the pack provably fair
**File:** `ruby-high-service.ts`, `hallPassCardPackEntries` (`~6685`).
- Stop calling `pickPlayerStudentCard` for committed slots. The student slots come entirely from `HALL_PASS_CARD_STUDENTS` (the existing else-branch fallback `HALL_PASS_CARD_STUDENTS.slice(2, 3)` becomes the always-path).
- Result: `hallPassCardPackEntries(seed, …, seedInteger)` is a pure function of `(seed, static catalog)` — no `sessions` argument needed for the committed pack. Remove the now-unused `sessions` plumbing **from the committed-pack path only** (it's still needed for the bonus, step 3).
- `pickPlayerStudentCard` is retained but is now called only by the bonus path (step 3), with crypto randomness instead of `seedInteger`.

**Acceptance:** for a fixed seed, `hallPassCardPackEntries` output is deterministic and contains no `player:*` card; recomputing the pack from `(commitment, revealSeed, packAssetAddress)` reproduces every issued card exactly.

### 2. Card schema: mark non-fair bonus cards
**File:** `types.ts`, `interface RubyHighHallPassCard`. Add:
```ts
  /** Discriminates the live-student bonus from provably-fair draw slots. */
  slotKind?: "bonus-student";
  /** false on the bonus card; absent/true on provably-fair draw slots. */
  provablyFair?: boolean;
```
The bonus card sets `slotKind: "bonus-student"`, `provablyFair: false`, and **omits** the reveal fields (`revealProof`, `catalogHash`, `commitment`, `revealSeed`, `packAssetAddress`, `slotIndex`, …) — it is not part of the draw.

### 3. Issue the bonus card
**File:** `ruby-high-service.ts`, in/after `issueHallPassCardsForTransaction` (`~6715`), after the provably-fair cards are created.

Gate (all must hold):
- the transaction is a **paid** purchase (check `transaction.source` / metadata — confirm which value denotes paid; do **not** fire on free/granted/admin packs);
- a crypto roll fires: `crypto.randomInt(0, 100) < BONUS_STUDENT_DROP_RATE * 100`;
- an **eligible** custom student exists (see below).

Eligibility (candidate filter, reuse `pickPlayerStudentCard`'s collection logic):
- a live session character **with a portrait**;
- not a smoke-test character (existing regex);
- **not already in the bonus-mint ledger** (step 4).

Selection: pick from eligible candidates with **`crypto.randomInt`** (deliberately *not* the reveal seed — this slot is explicitly not provably fair).

Create the bonus card:
- deterministic id derived from the transaction so re-issue is idempotent: `hallPassBonusCardId(transaction.id)` (mirror `hallPassCardId`); skip if it already exists in the wallet;
- `characterId: \`player:${sessionId}\``, `characterName` snapshotted from the chosen character;
- `slotKind: "bonus-student"`, `provablyFair: false`, `role: "student"`, a `rarity` of your choice (e.g. `"rare"`), `blurb` like `"A real Ruby High student. Bonus drop."`;
- push to `state.wallet.hallPassCards` like the other cards.

Then **record the mint in the ledger** (step 4) — atomically/idempotently with issuance.

**Acceptance:** a paid pack with an eligible student + forced roll yields exactly one card with `provablyFair === false` and `slotKind === "bonus-student"`; a free pack never does; re-running issuance for the same transaction does not duplicate the bonus card.

### 4. One-mint-per-custom-student ledger (durable, global)
A custom student may be granted as a bonus **once, ever, across all players**. This needs durable global storage — add a small collection to the state store (mirrors the `teacherRecords`/`packInstallations` pattern).

**Record** (`state-store.ts`):
```ts
export interface StoredBonusStudentMintRecord {
  characterId: string;     // "player:<sessionId>" — the dedup key
  sessionId: string;
  characterName: string;
  cardId: string;          // the issued bonus card id
  transactionId: string;
  mintedAt: number;        // ms epoch
}
```
**Interface** (`StateStoreLike`): add
```ts
  loadBonusStudentMints(): Promise<StoredBonusStudentMintRecord[]>;
  saveBonusStudentMint(record: StoredBonusStudentMintRecord): Promise<void>;
```
**Backends:**
- `SqliteStateStore` — one more `Kind` (`"bonusStudentMint"`), pk = `bonus-student-mint:${encodeURIComponent(characterId)}`. To make "once ever" race-safe, rely on the `kv` PRIMARY KEY: use `INSERT OR IGNORE` (not `INSERT OR REPLACE`) for this kind, and have `saveBonusStudentMint` report whether the row was newly inserted so the caller only issues the card on a fresh claim. *(Add a `claimBonusStudentMint(record): Promise<boolean>` if cleaner — returns false if the student was already claimed.)*
- `StateStore` (JSON) — new `bonusStudentMints` Map + snapshot array; check-then-set under the existing write lock.
- `DynamoStateStore` — only if C2 ships **before** the AWS-exit cutover (see Sequencing). Use a conditional `PutCommand` (`attribute_not_exists(pk)`) for the same race-safety.

**Service** (`ruby-high-service.ts`): cache the ledger like `teacherRecords` (`loadBonusStudentMints` on hydrate); expose an in-memory `Set<characterId>` for the eligibility filter; on grant, `claim` then write-through.

**Acceptance:** granting a bonus for student X writes the ledger row; a second paid pack that would pick X excludes X (no second card); concurrent opens that both pick X result in exactly one bonus card (the loser's claim returns false and it grants nothing).

### 5. Reveal verifier skips non-fair cards
**File:** the reveal verification path (`hall-pass-reveal-provenance.ts` and any caller that recomputes a card from `(commitment, revealSeed, …)` and compares). Add: if `card.provablyFair === false` (or `card.slotKind === "bonus-student"`), **skip recomputation/verification** for that card — it is intentionally outside the proof. Ensure `catalogHash`/proof attributes are not emitted in its NFT metadata.

**Acceptance:** verifying a pack that contains a bonus card does not fail or attempt to recompute the bonus slot.

### 6. UI / copy
**File:** card render in `viewer-parts/client.ts` (and CSS in `viewer-parts/css.ts`).
- Render a distinct badge on `slotKind === "bonus-student"` cards, e.g. **"Bonus drop · real student"**.
- Tooltip/footnote: *"Not part of the provable pack draw — granted at our discretion as a token of trust. Minted once, ever."*
- Keep the provable-fairness UI (reveal proof, catalog hash) on the 5 draw slots; the bonus card shows the trust copy instead.

### 7. NFT mint — no special-casing
The bonus card mints like any other via `mintHallPassCardFromAccount` (`client.ts` → `routes/nft.ts`). The "one mint per student" cap is enforced at **issuance** (step 4), not at NFT mint. Confirm the mint name/metadata renders sensibly for a student card.

---

## Idempotency & concurrency (must-hold invariants)
- **Re-issue safe:** `issueHallPassCardsForTransaction` is re-runnable (skips existing card ids). The bonus card id must be deterministic from the transaction so re-issue is a no-op.
- **One-ever safe:** the ledger claim is the source of truth, enforced by a unique-key insert (`INSERT OR IGNORE` / `attribute_not_exists`), not a read-then-write that can race.
- **Order:** claim the ledger first; only issue the card if the claim succeeded. If issuance fails after a successful claim, the student is "used" — acceptable (bias toward never double-granting). Optionally roll back the claim on issuance failure.

## Edge cases
- No eligible students → no bonus (return early; the pack is unaffected).
- Student deletes their account later → the persisted card + snapshotted `characterName` remain; the ledger keeps the dedup.
- Free/granted packs → never roll (paid-only gate).

## Tests (add `src/__tests__/hall-pass-bonus-cards.test.ts`)
1. `hallPassCardPackEntries` is deterministic for a fixed seed and contains no `player:*` entry.
2. Paid pack + eligible student + forced roll (stub the RNG) → exactly one `provablyFair:false` `bonus-student` card; ledger has the `characterId`.
3. Second paid pack for the same student → no bonus (excluded by ledger).
4. Free pack → never a bonus regardless of roll.
5. Re-running issuance for the same transaction → no duplicate bonus card, no duplicate ledger row.
6. Verifier skips `provablyFair:false` cards (no recompute attempt / no failure).

## Sequencing vs the AWS exit
The ledger rides on the state store. Two clean options:
- **Ship C2 after the SQLite cutover** (`docs/aws-exit-migration.md`): implement the ledger in `StateStore` (JSON) + `SqliteStateStore` only — skip Dynamo. **Preferred.**
- **Ship C2 before:** also implement the Dynamo conditional-put. More work for a backend being retired.

Either way, do not block a pack mint that includes player cards on the old (broken) behavior — step 1 (provably-fair pack) is independent of the store and can land immediately.
