import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RubyHighService, WELCOME_HALL_PASS_GRANT_ID } from "../services/ruby-high-service.js";
import { SqliteStateStore } from "../services/sqlite-state-store.js";
import { FacultyService } from "../services/faculty-service.js";
import { resetActivePack } from "../content/registry.js";

const DAY_MS = 24 * 60 * 60 * 1000;

let tmpDir: string;
let dbPath: string;
const stores: SqliteStateStore[] = [];

function openStore(): SqliteStateStore {
  const store = new SqliteStateStore({ path: dbPath, ttlSeconds: 0 });
  stores.push(store);
  return store;
}

async function seed(): Promise<void> {
  const writer = new RubyHighService({} as never, openStore());
  await writer["hydrate"]();
  writer.setFacultyService(await FacultyService.start({} as never));
  const old = writer.getOrCreate("rh:old");
  writer.claimWelcomeHallPasses("rh:old");
  old.score.correct = 5;
  old.updatedAt = Date.now() - 90 * DAY_MS;
  const recent = writer.getOrCreate("rh:recent");
  recent.updatedAt = Date.now();
  await writer["persistAll"]();
}

async function reader(): Promise<RubyHighService> {
  const ruby = new RubyHighService({} as never, openStore());
  await ruby["hydrate"]();
  ruby.setFacultyService(await FacultyService.start({} as never));
  return ruby;
}

beforeEach(async () => {
  resetActivePack();
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-fault-in-"));
  dbPath = join(tmpDir, "state.db");
  await seed();
});

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("session fault-in", () => {
  it("loads only recent sessions at startup", async () => {
    const ruby = await reader();
    const sessions = ruby["sessions"] as Map<string, unknown>;
    expect(sessions.has("rh:recent")).toBe(true);
    expect(sessions.has("rh:old")).toBe(false);
  });

  it("faults in an old session instead of creating a blank one", async () => {
    const ruby = await reader();
    expect(ruby.getOrCreate("rh:old").score.correct).toBe(5);
    expect((ruby["sessions"] as Map<string, unknown>).has("rh:old")).toBe(true);
  });

  it("still resets an old session", async () => {
    const ruby = await reader();
    expect(ruby.resetSession("rh:old").score.correct).toBe(0);
  });

  it("finds wallet transactions in sessions that are not in memory", async () => {
    const ruby = await reader();
    expect(ruby.walletTransactionOwner(WELCOME_HALL_PASS_GRANT_ID)?.sessionId).toBe("rh:old");
    expect((ruby["sessions"] as Map<string, unknown>).has("rh:old")).toBe(false);
  });
});
