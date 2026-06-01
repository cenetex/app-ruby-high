import { describe, it, expect } from "vitest";
import { SqliteStateStore } from "../services/sqlite-state-store.js";
import type { QuizState } from "../types.js";

function store(ttlSeconds = 0): SqliteStateStore {
  return new SqliteStateStore({ path: ":memory:", ttlSeconds });
}

const session = (id: string, updatedAt = 1): QuizState =>
  ({ sessionId: id, updatedAt } as unknown as QuizState);

// Test #6: Expired rows are physically purged, not just filtered.
//
// sqlite-state-store.ts only calls purgeExpired() at construction and
// every 15 minutes. Expired rows remain physically in the table between
// purge cycles.
describe("SqliteStateStore — expired row physical purge", () => {
  it("expired rows are physically deleted from the table, not just filtered from reads", async () => {
    const s = store(1); // 1-second TTL
    await s.saveSession(session("rh:user:ephemeral"));

    // Wait for the row to expire.
    await new Promise((r) => setTimeout(r, 1100));

    // load() filters by expires_at, so the row won't appear.
    const loaded = await s.load();
    expect(loaded.has("rh:user:ephemeral")).toBe(false);

    // But the physical row still exists — purgeExpired hasn't run yet.
    // FAILS: row is still in the table.
    const db = (s as any).db;
    const count = db.prepare(
      "SELECT COUNT(*) as cnt FROM kv WHERE pk = ?",
    ).get("rh:user:ephemeral");
    expect(count.cnt).toBe(0);
    s.close();
  });
});
