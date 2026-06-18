import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TelegramService } from "../services/telegram-service.js";

const srcPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../routes/x-social.ts",
);
const src = readFileSync(srcPath, "utf8");
const adminSrc = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../routes/admin.ts"), "utf8");

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

describe("Telegram config GET — bot token isolation", () => {
  it("GET /x/telegram handler does not reference botToken", () => {
    const getHandlerMatch = src.match(
      /ctx\.method === "GET".*?telegram[\s\S]*?return true;/m,
    );
    expect(getHandlerMatch).toBeTruthy();
    const getHandler = getHandlerMatch![0];

    const hasBotTokenInGet = /botToken/i.test(getHandler);
    expect(hasBotTokenInGet).toBe(false);
  });

  it("getConfig does not return botToken in the source", () => {
    const getConfigLines = src.split("\n").filter(
      (l) => /getConfig/.test(l) && /botToken/i.test(l),
    );
    expect(getConfigLines).toHaveLength(0);
  });

  it("Telegram chat lookup never accepts bot tokens in query strings", () => {
    expect(src).toContain('ctx.method === "POST" && pathname === `${X_SOCIAL_PREFIX}/telegram/find-chat`');
    expect(src).not.toContain("telegram/find-chat?token");
    expect(src).not.toContain('searchParams.get("token")');
    expect(adminSrc).not.toContain("find-chat?token");
  });

  it("preserves an existing token when only the chat id changes", async () => {
    const service = new TelegramService();
    service.updateConfig("123:secret-token", "-100old");
    service.updateConfig(null, "-100new");

    mockFetch.mockResolvedValueOnce({ ok: true });

    await expect(service.sendMessage("hello")).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0][0])).toContain("bot123:secret-token/sendMessage");
    expect(JSON.parse(String(mockFetch.mock.calls[0][1]?.body)).chat_id).toBe("-100new");
  });

  it("admin Telegram buttons are dispatched only through their data-action", () => {
    expect(adminSrc).not.toContain('e.target.id === "tg-save"');
    expect(adminSrc).not.toContain('e.target.id === "tg-post"');
  });

  it("admin report cards and class photos use the selected X teacher", () => {
    expect(adminSrc).toContain('id="social-teacher-select"');
    expect(adminSrc).toContain("async function selectedSocialTeacherId(token)");
    expect(adminSrc).toContain('xSocialPrefix + "/post-report/" + teacherId');
    expect(adminSrc).toContain('xSocialPrefix + "/class-photo/" + teacherId');
    expect(adminSrc).not.toContain("teachers[0]");
  });

  it("admin class-photo button distinguishes generated, posted, and deferred outcomes", () => {
    expect(adminSrc).toContain('res.status === 409 ? "Not queued" : "Failed"');
    expect(adminSrc).toContain("if (data.error) btn.title = data.error");
    expect(adminSrc).toContain("data.posted && data.tweetId");
    expect(adminSrc).toContain('btn.textContent = "Tweeted!"');
    expect(adminSrc).toContain("data.deferredUntil");
    expect(adminSrc).toContain('btn.textContent = "Queued retry"');
    expect(adminSrc).toContain('btn.textContent = "Queued"');
    expect(adminSrc).toContain('btn.title = ""');
  });

  it("admin class-photo history includes queued and completed photos", () => {
    expect(adminSrc).toContain("data.classPhotoHistory");
    expect(adminSrc).toContain('status: "queued"');
    expect(adminSrc).toContain('p.status === "posted" ? "tweeted"');
    expect(adminSrc).toContain('p.status === "revealed" ? "revealed" : "queued"');
  });
});
