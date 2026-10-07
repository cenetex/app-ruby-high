import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getActivePack } from "../content/registry.js";
import { AuthService } from "../services/auth-service.js";
import { ChatService } from "../services/chat-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import { createStateStore } from "../services/state-store-factory.js";
import { SqliteStateStore } from "../services/sqlite-state-store.js";
import { deletePlayerData, purgeInactiveAccounts } from "../services/privacy-maintenance.js";
import { handlePrivacyDeletion, PRIVACY_DELETE_PATH } from "../routes/privacy-delete.js";
import type { RouteContext } from "../routes/context.js";

let dir: string;
let store: StateStore;
let auth: AuthService;
let ruby: RubyHighService;
let chat: ChatService;
beforeEach(async () => {
  await getActivePack();
  dir = await mkdtemp(join(tmpdir(), "ruby-high-privacy-"));
  store = new StateStore(join(dir, "state.json"));
  auth = await AuthService.start({} as never, store);
  ruby = new RubyHighService({} as never, store);
  await (ruby as any).hydrate();
  chat = new ChatService({} as never);
  chat.setRubyHighService(ruby);
  await chat.ready();
});
afterEach(async () => {
  await chat.stop(); await auth.stop(); await ruby.stop();
  await store.flush();
  await rm(dir, { recursive: true, force: true });
  vi.unstubAllEnvs(); vi.restoreAllMocks();
});

describe("privacy cleanup", () => {
  it("keeps sharing choices when a completed student is archived and reloaded", async () => {
    const state = ruby.createCharacter("archive:privacy", { name: "Mika", playbookId: "overachiever", stats: { head: 2, heart: 0, hustle: -1, honor: 1 }, arcAnswer: "Learn together.", personality: "Curious." });
    const student = state.character!;
    student.yearbook = ["9", "10", "11", "12"].map(grade => ({ grade, completedAt: Date.now(), name: student.name })) as any;
    (ruby as any).archiveCompletedCharacter(state, student);
    expect(state.studentPool?.[0]).toMatchObject({ socialPostingConsent: false, publicWorldVisible: false });
    await ruby.flushSession(state.sessionId);
    const restored = new RubyHighService({} as never, new StateStore(join(dir, "state.json")));
    await (restored as any).hydrate();
    expect(restored.getOrCreate(state.sessionId).studentPool?.[0]).toMatchObject({ socialPostingConsent: false, publicWorldVisible: false });
    await restored.stop();
  });

  it("removes summaries linked to already compacted account messages after a reload", async () => {
    const a = await auth.createGuestSession(); const b = await auth.createGuestSession();
    const aId = auth.stateKeyForRecord(a.record); const bId = auth.stateKeyForRecord(b.record);
    for (let i = 0; i < 51; i++) chat.appendPlayerMessage({ sessionToken: i === 0 ? a.token : b.token,
      accountId: i === 0 ? aId : bId, faculty: "lounge" }, `Generated line ${i}`);
    expect(chat.roomSummary({ sessionToken: b.token, faculty: "lounge" })).toContain("Generated line 0");
    await chat.stop();
    chat = new ChatService({} as never); chat.setRubyHighService(ruby); await chat.ready();
    await deletePlayerData({ auth, ruby, chat }, auth.accountDeletionTargetForToken(a.token)!);
    expect(chat.roomSummary({ sessionToken: b.token, faculty: "lounge" })).toBeNull();
    expect(chat.history({ sessionToken: b.token, faculty: "lounge" })).toHaveLength(20);
    expect(await readFile(join(dir, "state.json"), "utf8")).not.toContain("Generated line 0");
  });

  it("expires summary sources even when the room keeps being updated", async () => {
    const start = Date.now(); const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    for (let i = 0; i < 51; i++) chat.appendPlayerMessage({ sessionToken: "first", faculty: "lounge" }, `First line ${i}`);
    clock.mockReturnValue(start + 89 * 86400000);
    for (let i = 0; i < 32; i++) chat.appendPlayerMessage({ sessionToken: "later", faculty: "lounge" }, `Later line ${i}`);
    expect(chat.roomSummary({ sessionToken: "later", faculty: "lounge" })).toContain("First line");
    clock.mockReturnValue(start + 91 * 86400000);
    expect(chat.roomSummary({ sessionToken: "later", faculty: "lounge" })).toBeNull();
    expect(chat.history({ sessionToken: "later", faculty: "lounge" }).every(message => message.content.startsWith("Later line"))).toBe(true);
    clock.mockRestore();
  });

  it.each(["json", "sqlite"])("removes account-bound passkey challenges in %s storage", async (backend) => {
    const pendingStore = backend === "json" ? new StateStore(join(dir, "pending.json")) : new SqliteStateStore({ path: join(dir, "pending.db") });
    const pendingAuth = await AuthService.start({} as never, pendingStore);
    try {
      const guest = await pendingAuth.createGuestSession();
      const pending = await pendingAuth.beginPasskeyRegistration(guest.token, { id: "localhost", name: "Ruby High", origin: "http://localhost:3000" });
      await pendingStore.deleteAccountData(pendingAuth.accountDeletionTargetForToken(guest.token)!);
      pendingAuth.forgetDeletedAccount({ userId: guest.record.userId, sessionId: pendingAuth.stateKeyForRecord(guest.record) });
      expect(await pendingStore.loadServiceState(`auth:passkey:${pending.flowId}`)).toBeNull();
      await expect(pendingAuth.completePasskeyRegistration(pending.flowId, {}, guest.token)).rejects.toThrow("expired");
    } finally { await pendingAuth.stop(); if (pendingStore instanceof SqliteStateStore) pendingStore.close(); }
  });

  it("deletes linked dialogue while preserving another player's record with the same name", async () => {
    const a = await auth.createGuestSession(); const b = await auth.createGuestSession();
    const aId = auth.stateKeyForRecord(a.record); const bId = auth.stateKeyForRecord(b.record);
    ruby.getOrCreate(aId); ruby.getOrCreate(bId);
    await ruby.flushSession(aId); await ruby.flushSession(bId);
    chat.appendPlayerMessage({ sessionToken: a.token, accountId: aId, faculty: "ruby", authorName: "Avery" }, "Own generated line");
    chat.appendPlayerMessage({ sessionToken: b.token, accountId: bId, faculty: "ruby", authorName: "Avery" }, "Other generated line");
    chat.appendEvent({ sessionToken: a.token, accountId: aId, faculty: "ruby" }, { kind: "note", text: "Own event" });
    chat.appendEvent({ sessionToken: b.token, accountId: bId, faculty: "ruby" }, { kind: "note", text: "Other event" });
    await deletePlayerData({ auth, ruby, chat }, auth.accountDeletionTargetForToken(a.token)!);
    expect(auth.resolve(a.token)).toBeNull(); expect(auth.resolve(b.token)).not.toBeNull();
    expect(chat.history({ sessionToken: b.token, faculty: "ruby" }).map(message => message.content)).toEqual(["Other generated line"]);
    expect(chat.events_for_test({ sessionToken: b.token, faculty: "ruby" }).map(event => event.text)).toEqual(["Other event"]);
    const saved = await readFile(join(dir, "state.json"), "utf8");
    expect(saved).not.toContain(a.token); expect(saved).not.toContain(aId); expect(saved).not.toContain("Own generated line");
    expect(saved).toContain("Other generated line");
    const restarted = new StateStore(join(dir, "state.json"));
    expect((await restarted.load()).has(aId)).toBe(false); expect((await restarted.load()).has(bId)).toBe(true);
  });

  it("limits an admin deletion request to the verified account", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "test-admin");
    const a = await auth.createGuestSession(); const b = await auth.createGuestSession();
    const body = vi.fn(async () => ({ userId: a.record.userId, confirm: "DELETE" }));
    const res = { statusCode: 0, body: "" };
    const ctx = {
      pathname: PRIVACY_DELETE_PATH, method: "POST", res, authorizationHeader: "Bearer wrong", readJsonBody: body,
      runtime: { getService(type: string) { return type === AuthService.serviceType ? auth : type === RubyHighService.serviceType ? ruby : type === ChatService.serviceType ? chat : null; } },
      error(_res: unknown, message: string, status = 500) { res.statusCode = status; res.body = message; },
      json(_res: unknown, value: unknown, status = 200) { res.statusCode = status; res.body = JSON.stringify(value); },
    } as unknown as RouteContext;
    await handlePrivacyDeletion(ctx); expect(res.statusCode).toBe(401); expect(body).not.toHaveBeenCalled();
    ctx.authorizationHeader = "Bearer test-admin";
    await handlePrivacyDeletion(ctx); expect(res.statusCode).toBe(200);
    expect(auth.resolve(a.token)).toBeNull(); expect(auth.resolve(b.token)).not.toBeNull();
  });

  it("expires old JSON data on disk and retains recent records", async () => {
    const path = join(dir, "retention.json");
    const aged = new StateStore(path);
    const now = Date.now();
    await aged.saveAuthUser({ userId: "old", provider: "guest", providerUserHash: "old", createdAt: now - 100000, lastLoginAt: now - 100000 });
    await aged.saveAuthUser({ userId: "recent", provider: "guest", providerUserHash: "recent", createdAt: now, lastLoginAt: now });
    const bounded = await createStateStore({ backend: "json", jsonPath: path, ttlSeconds: 60 });
    expect((await bounded.loadAuth()).users.map(user => user.userId)).toEqual(["recent"]);
    await bounded.flush?.();
    expect(await readFile(path, "utf8")).not.toContain('"userId": "old"');
  });

  it("backfills expiration for old SQLite account rows", async () => {
    const path = join(dir, "retention.db"); const now = Date.now();
    const legacy = new SqliteStateStore({ path, ttlSeconds: 0 });
    await legacy.saveAuthUser({ userId: "old", provider: "guest", providerUserHash: "old", createdAt: now - 100000, lastLoginAt: now - 100000 });
    legacy.close();
    const bounded = new SqliteStateStore({ path, ttlSeconds: 60 });
    try { expect((await bounded.loadAuth()).users).toEqual([]); } finally { bounded.close(); }
  });

  it("removes expired linked account data through the retention job", async () => {
    const a = await auth.createGuestSession(); const aId = auth.stateKeyForRecord(a.record);
    ruby.getOrCreate(aId); await ruby.flushSession(aId);
    expect(await purgeInactiveAccounts({ auth, ruby, chat }, Date.now() + 91 * 86400000)).toBe(1);
    expect(auth.resolve(a.token)).toBeNull(); expect((await store.loadAuth()).users).toEqual([]);
  });
});
