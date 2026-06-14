import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import {
  XSocialService,
  generatePkce,
  type XTokenRecord,
  type XMilestoneContext,
} from "../services/x-social-service.js";
import type { TeacherCharacter } from "../characters/teachers.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const TEST_STATE_DIR = "/tmp/ruby-high-x-test";

beforeAll(async () => {
  await mkdir(TEST_STATE_DIR, { recursive: true });
});

beforeEach(async () => {
  // Wipe token store between tests to prevent cross-test leakage.
  await rm(TEST_STATE_DIR, { recursive: true, force: true });
  await mkdir(TEST_STATE_DIR, { recursive: true });
  vi.stubEnv("RUBY_HIGH_X_CLIENT_ID", "test-client-id");
  vi.stubEnv("RUBY_HIGH_X_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("RUBY_HIGH_PUBLIC_BASE", "http://127.0.0.1:3000");
  vi.stubEnv("RUBY_HIGH_X_DRY_RUN", "0");
  vi.stubEnv("RUBY_HIGH_X_CONSUMER_KEY", "");
  vi.stubEnv("RUBY_HIGH_X_CONSUMER_SECRET", "");
  vi.stubEnv("RUBY_HIGH_X_ACCESS_TOKEN", "");
  vi.stubEnv("RUBY_HIGH_X_ACCESS_SECRET", "");
  vi.stubEnv("RUBY_HIGH_STATE_PATH", TEST_STATE_DIR);
  mockFetch.mockReset();
});

const RUBY_TEACHER: TeacherCharacter = {
  id: "ruby",
  displayName: "Ruby",
  shortName: "Ruby",
  defaultModel: "test-model",
  systemPrompt: "You are Ruby, a warm and mischievous teacher.",
};

describe("generatePkce", () => {
  it("produces verifier and challenge", () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier).toBeTruthy();
    expect(challenge).toBeTruthy();
    expect(challenge).not.toBe(verifier);
  });

  it("produces unique values each call", () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe("XSocialService", () => {
  let svc: XSocialService;

  beforeEach(async () => {
    svc = new XSocialService();
    await svc.start();
  });

  it("starts with no connected teachers", () => {
    expect(svc.listConnected()).toEqual([]);
  });

  it("reports disconnected status", () => {
    expect(svc.getStatus("ruby")).toEqual({
      connected: false,
      teacherId: "ruby",
    });
  });

  describe("beginConnect", () => {
    it("returns an OAuth URL and state", () => {
      const { url, state } = svc.beginConnect("ruby");
      expect(url).toContain("https://x.com/i/oauth2/authorize");
      expect(url).toContain("client_id=test-client-id");
      expect(url).toContain("code_challenge_method=S256");
      expect(decodeURIComponent(url)).toContain("media.write");
      expect(state).toContain("ruby");
    });

    it("throws if X_CLIENT_ID is not set", () => {
      vi.stubEnv("RUBY_HIGH_X_CLIENT_ID", "");
      const badSvc = new XSocialService();
      expect(() => badSvc.beginConnect("ruby")).toThrow("RUBY_HIGH_X_CLIENT_ID");
    });
  });

  describe("handleCallback", () => {
    it("rejects unknown state", async () => {
      await expect(
        svc.handleCallback("test-code", "unknown-state"),
      ).rejects.toThrow("Unknown or expired OAuth state");
    });

    it("exchanges code for token and stores it", async () => {
      const { state } = svc.beginConnect("ruby");

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "test-access-token",
            refresh_token: "test-refresh-token",
            expires_in: 7200,
            scope: "tweet.read tweet.write users.read offline.access media.write",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "12345", username: "ruby_high_ruby" } }),
        });

      const record = await svc.handleCallback("test-code", state);
      expect(record.teacherId).toBe("ruby");
      expect(record.accessToken).toBe("test-access-token");
      expect(record.refreshToken).toBe("test-refresh-token");
      expect(record.xScreenName).toBe("ruby_high_ruby");

      expect(svc.getStatus("ruby")).toMatchObject({
        connected: true,
        xScreenName: "ruby_high_ruby",
        hasMediaWrite: true,
      });
    });

    it("throws on token exchange failure", async () => {
      const { state } = svc.beginConnect("ruby");
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "invalid_grant",
      });

      await expect(
        svc.handleCallback("bad-code", state),
      ).rejects.toThrow(/rejected the authorization/);
    });
  });

  describe("disconnect", () => {
    it("removes a connected teacher", async () => {
      const { state } = svc.beginConnect("ruby");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "tok", refresh_token: "ref", expires_in: 7200,
            scope: "tweet.read tweet.write users.read offline.access media.write",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "1", username: "ruby" } }),
        });

      await svc.handleCallback("code", state);
      expect(svc.getStatus("ruby").connected).toBe(true);

      mockFetch.mockResolvedValueOnce({ ok: true });
      await svc.disconnect("ruby");
      expect(svc.getStatus("ruby").connected).toBe(false);
    });
  });

  describe("maybePostMilestone", () => {
    it("returns null for unconnected teacher", async () => {
      const result = await svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "class-passed",
        characterName: "Test Student",
        teacherName: "Ruby",
        letterGrade: "A",
      });
      expect(result).toBeNull();
    });

    it("returns dry-run id when RUBY_HIGH_X_DRY_RUN is set", async () => {
      vi.stubEnv("RUBY_HIGH_X_DRY_RUN", "1");
      const { state } = svc.beginConnect("ruby");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "tok", refresh_token: "ref", expires_in: 7200,
            scope: "tweet.read tweet.write users.read offline.access media.write",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "1", username: "ruby" } }),
        });
      await svc.handleCallback("code", state);

      const result = await svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "character-created",
        characterName: "New Kid",
      });
      expect(result).toBe("dry-run:character-created");
    });

    it("posts a tweet for a connected teacher", async () => {
      const { state } = svc.beginConnect("ruby");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "tok", refresh_token: "ref", expires_in: 7200,
            scope: "tweet.read tweet.write users.read offline.access media.write",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "1", username: "ruby" } }),
        });
      await svc.handleCallback("code", state);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-123" } }),
      });

      const result = await svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "graduated",
        characterName: "Valedictorian",
        arcAnswer: "To prove them wrong",
      });
      expect(result).toBe("tweet-123");
    });
  });

  describe("rate limiting", () => {
    it("blocks posts after 50 in 24 hours", async () => {
      const { state } = svc.beginConnect("ruby");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "tok", expires_in: 7200,
            scope: "tweet.read tweet.write",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "1", username: "r" } }),
        });
      await svc.handleCallback("code", state);

      for (let i = 0; i < 50; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: `tweet-${i}` } }),
        });
      }
      for (let i = 0; i < 50; i++) {
        const result = await svc.maybePostMilestone(RUBY_TEACHER, {
          kind: "class-passed",
          characterName: `Student ${i}`,
          letterGrade: "B",
        });
        expect(result).toBe(`tweet-${i}`);
      }

      const result = await svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "class-passed",
        characterName: "Student 51",
        letterGrade: "B",
      });
      expect(result).toBeNull();
    });
  });

  describe("fallback post text", () => {
    it("generates text without LLM for class-passed", async () => {
      const { state } = svc.beginConnect("ruby");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "tok", expires_in: 7200,
            scope: "tweet.read tweet.write",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "1", username: "r" } }),
        });
      await svc.handleCallback("code", state);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-fallback" } }),
      });

      const result = await svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "class-passed",
        characterName: "Lyra",
        teacherName: "Professor Edward",
        letterGrade: "A",
      });
      expect(result).toBe("tweet-fallback");
    });
  });

  describe("media upload", () => {
    it("attaches portrait image to tweet when portraitUrl is provided", async () => {
      const { state } = svc.beginConnect("ruby");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "tok", refresh_token: "ref", expires_in: 7200,
            scope: "tweet.read tweet.write users.read offline.access media.write",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "1", username: "ruby" } }),
        });
      await svc.handleCallback("code", state);

      // Mock the media upload response.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "media-abc-123" } }),
      });
      // Mock the tweet post response.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-with-pic" } }),
      });

      // Small 1x1 red PNG as data URL.
      const pngUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

      const result = await svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "portrait-set",
        characterName: "Photo Kid",
        portraitUrl: pngUrl,
      });
      expect(result).toBe("tweet-with-pic");

      // Verify media upload was called.
      const mediaCall = mockFetch.mock.calls.find(
        (c: unknown[]) => String((c as string[])[0]).includes("media/upload"),
      );
      expect(mediaCall).toBeDefined();
      expect(String((mediaCall as unknown[])[0])).toBe("https://api.x.com/2/media/upload");
      const uploadBody = JSON.parse((mediaCall![1] as RequestInit).body as string);
      expect(uploadBody).toMatchObject({
        media_category: "tweet_image",
        media_type: "image/png",
        shared: false,
      });
      expect(typeof uploadBody.media).toBe("string");

      // Verify tweet body includes media_ids.
      const tweetCall = mockFetch.mock.calls.find(
        (c: unknown[]) => String((c as string[])[0]).includes("/tweets"),
      );
      const body = JSON.parse((tweetCall![1] as RequestInit).body as string);
      expect(body.media).toBeDefined();
      expect(body.media.media_ids).toEqual(["media-abc-123"]);
    });

    it("falls back to text-only tweet when media upload fails", async () => {
      const { state } = svc.beginConnect("ruby");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "tok", refresh_token: "ref", expires_in: 7200,
            scope: "tweet.read tweet.write users.read offline.access media.write",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "1", username: "ruby" } }),
        });
      await svc.handleCallback("code", state);

      // Media upload fails.
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });
      // Tweet still posts (text-only).
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-text-only" } }),
      });

      const pngUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

      const result = await svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "portrait-set",
        characterName: "Fallback Kid",
        portraitUrl: pngUrl,
      });
      expect(result).toBe("tweet-text-only");

      // Verify tweet body does NOT include media.
      const tweetCall = mockFetch.mock.calls.find(
        (c: unknown[]) => String((c as string[])[0]).includes("/tweets"),
      );
      const body = JSON.parse((tweetCall![1] as RequestInit).body as string);
      expect(body.media).toBeUndefined();
    });

    it("posts text-only and reports missing media scope for older OAuth tokens", async () => {
      const { state } = svc.beginConnect("ruby");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "tok", refresh_token: "ref", expires_in: 7200,
            scope: "tweet.read tweet.write users.read offline.access",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "1", username: "ruby" } }),
        });
      await svc.handleCallback("code", state);
      expect(svc.getStatus("ruby")).toMatchObject({ connected: true, hasMediaWrite: false });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-without-media-scope" } }),
      });

      const pngUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
      const result = await svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "portrait-set",
        characterName: "Old Token Kid",
        portraitUrl: pngUrl,
      });

      expect(result).toBe("tweet-without-media-scope");
      const mediaCalls = mockFetch.mock.calls.filter(
        (c: unknown[]) => String((c as string[])[0]).includes("media/upload"),
      );
      expect(mediaCalls).toHaveLength(0);
      const tweetCall = mockFetch.mock.calls.find(
        (c: unknown[]) => String((c as string[])[0]).includes("/tweets"),
      );
      const body = JSON.parse((tweetCall![1] as RequestInit).body as string);
      expect(body.media).toBeUndefined();
    });

    it("skips media when no image URL is provided", async () => {
      const { state } = svc.beginConnect("ruby");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "tok", refresh_token: "ref", expires_in: 7200,
            scope: "tweet.read tweet.write users.read offline.access media.write",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "1", username: "ruby" } }),
        });
      await svc.handleCallback("code", state);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-no-media" } }),
      });

      const result = await svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "class-passed",
        characterName: "No Pic",
        teacherName: "Ruby",
        letterGrade: "B",
      });
      expect(result).toBe("tweet-no-media");

      // No media upload call should have been made.
      const mediaCalls = mockFetch.mock.calls.filter(
        (c: unknown[]) => String((c as string[])[0]).includes("media/upload"),
      );
      expect(mediaCalls).toHaveLength(0);
    });
  });

  describe("multiple teachers", () => {
    it("tracks connections independently", async () => {
      const { state: rState } = svc.beginConnect("ruby");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "ruby-tok", expires_in: 7200,
            scope: "tweet.read tweet.write",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "r1", username: "ruby_x" } }),
        });
      await svc.handleCallback("code1", rState);

      const { state: sState } = svc.beginConnect("sally-science");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "sally-tok", expires_in: 7200,
            scope: "tweet.read tweet.write",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "s1", username: "sally_x" } }),
        });
      await svc.handleCallback("code2", sState);

      const connected = svc.listConnected();
      expect(connected).toHaveLength(2);

      mockFetch.mockResolvedValueOnce({ ok: true });
      await svc.disconnect("ruby");
      expect(svc.listConnected()).toHaveLength(1);
    });
  });
});
