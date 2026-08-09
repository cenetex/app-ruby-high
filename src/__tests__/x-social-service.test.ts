import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  XSocialService,
  generatePkce,
  type XTokenRecord,
  type XMilestoneContext,
} from "../services/x-social-service.js";
import type { TeacherCharacter } from "../characters/teachers.js";
import type { ScheduledSchoolUpdateContext } from "../services/ruby-high/post-types.js";
import { fetchSafeImageBuffer } from "../services/safe-url.js";

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
  vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "");
  vi.stubEnv("RUBY_HIGH_LLM_API_KEY", "");
  vi.stubEnv("RUBY_HIGH_LOCAL_LLM_API_KEY", "");
  vi.stubEnv("RUBY_HIGH_LLM_BASE_URL", "");
  mockFetch.mockReset();
});

const RUBY_TEACHER: TeacherCharacter = {
  id: "ruby",
  displayName: "Ruby",
  shortName: "Ruby",
  defaultModel: "test-model",
  systemPrompt: "You are Ruby, a warm and mischievous teacher.",
};

const PNG_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

const SCHOOL_UPDATE_CONTEXT: ScheduledSchoolUpdateContext = {
  date: "2026-07-22",
  updatedSessionsLast24h: 12,
  activeStudents: 3,
  activeRooms: [{ area: "classroom", grade: "9", activeStudents: 3, goalProgress: 2, goalTarget: 3 }],
  highlights: { newStudents: 2, classesPassed: 1, gradesAdvanced: 0, graduations: 0 },
  recentEvents: { roomGoalProgress: 2, relationshipMoments: 3, futuresResolved: 0, comicPagesUnlocked: 0 },
};

const FEATURED_GUEST_CONTEXT: ScheduledSchoolUpdateContext = {
  ...SCHOOL_UPDATE_CONTEXT,
  featuredGuest: {
    weekKey: "2026-W30",
    packId: "teacher:eliza-elizaos-systems-lab",
    facultyId: "eliza",
    displayName: "Eliza",
    courseTitle: "elizaOS Systems Lab",
    bio: "Guest systems teacher.",
    xHandle: "elizaOS",
    imageUrl: "/api/apps/ruby-high/assets/teachers/eliza-full.png",
  },
};

function withImage(ctx: XMilestoneContext): XMilestoneContext {
  return { imageUrl: PNG_URL, ...ctx };
}

function mockMediaUpload(mediaId = "media-test"): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: { id: mediaId } }),
  });
}

async function connectRuby(svc: XSocialService, scope = "tweet.read tweet.write users.read offline.access media.write"): Promise<void> {
  const { state } = svc.beginConnect("ruby");
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "tok",
        refresh_token: "ref",
        expires_in: 7200,
        scope,
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "1", username: "ruby" } }),
    });
  await svc.handleCallback("code", state);
  mockFetch.mockClear();
}

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

  it("stores OAuth tokens with owner-only filesystem permissions", async () => {
    await connectRuby(svc);

    expect((await stat(join(TEST_STATE_DIR, "x-tokens.json"))).mode & 0o777).toBe(0o600);
  });

  it("rejects oversized inline images before upload", async () => {
    const oversized = `data:image/png;base64,${Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64")}`;
    const resolveImage = (svc as unknown as { resolveImageToBuffer: (url: string) => Promise<Buffer> })
      .resolveImageToBuffer.bind(svc);

    await expect(resolveImage(oversized)).rejects.toThrow("Image is too large.");
  });

  it("revalidates image redirect destinations before fetching them", async () => {
    const requester = vi.fn(async (_url: URL, _address: unknown, _signal: AbortSignal) => new Response(null, {
      status: 302,
      headers: { location: "https://private.example/private-image.png" },
    }));
    const resolver = vi.fn(async (hostname: string) => hostname === "private.example"
      ? [{ address: "127.0.0.1", family: 4 as const }]
      : [{ address: "1.1.1.1", family: 4 as const }]);

    await expect(fetchSafeImageBuffer("https://public.example/image.png", {
      lookup: resolver,
      request: requester,
    })).rejects.toThrow("private or reserved");
    expect(requester).toHaveBeenCalledTimes(1);
    expect(requester.mock.calls[0]?.[1]).toEqual({ address: "1.1.1.1", family: 4 });
  });

  it("stops reading remote images at the configured byte limit", async () => {
    const requester = vi.fn(async (_url: URL, _address: unknown, _signal: AbortSignal) => (
      new Response(new Uint8Array(11), { status: 200 })
    ));

    await expect(fetchSafeImageBuffer("https://public.example/image.png", {
      maxBytes: 10,
      lookup: async () => [{ address: "1.1.1.1", family: 4 }],
      request: requester,
    })).rejects.toThrow("Remote image is too large.");
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

      mockMediaUpload();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-123" } }),
      });

      const result = await svc.maybePostMilestone(RUBY_TEACHER, withImage({
        kind: "graduated",
        characterName: "Valedictorian",
        arcAnswer: "To prove them wrong",
      }));
      expect(result).toBe("tweet-123");
    });

    it("replaces a passed-class portrait with the actual class composition", async () => {
      vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "sk-test");
      vi.stubEnv("RUBY_HIGH_PUBLIC_BASE", "https://ruby-high.ai");
      await connectRuby(svc);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                images: [{
                  image_url: { url: PNG_URL },
                }],
              },
            }],
          }),
        });
      mockMediaUpload("media-class-composition");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-class-composition" } }),
      });

      const result = await svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "class-passed",
        characterName: "Theo",
        teacherName: "Sally Science",
        teacherFacultyId: "sally-science",
        className: "Science Lab",
        classSubjects: ["physics", "chemistry"],
        grade: "10",
        letterGrade: "C",
        imageUrl: "/api/apps/ruby-high/assets/students/indra-full.png",
        studentImageUrl: "/api/apps/ruby-high/assets/students/indra-full.png",
        teacherImageUrl: "/api/apps/ruby-high/assets/teachers/sally-science-full.png",
      });

      expect(result).toBe("tweet-class-composition");
      const imageRequest = mockFetch.mock.calls.find(
        (call: unknown[]) => String((call as string[])[0]).includes("openrouter.ai"),
      );
      expect(imageRequest).toBeDefined();
      const imageBody = JSON.parse(String((imageRequest?.[1] as RequestInit)?.body || "{}"));
      const prompt = imageBody.messages?.[0]?.content
        ?.filter((part: any) => part.type === "text")
        .map((part: any) => String(part.text ?? ""))
        .join("\n");
      expect(prompt).toContain("ACTUAL CLASS: Science Lab");
      expect(prompt).toContain("Sally Science");
      const tweetCall = mockFetch.mock.calls.find(
        (call: unknown[]) => String((call as string[])[0]).includes("/tweets"),
      );
      expect(JSON.parse(String((tweetCall?.[1] as RequestInit)?.body))).toMatchObject({
        media: { media_ids: ["media-class-composition"] },
      });
    });

    it("does not fall back to a standalone portrait when class composition is unavailable", async () => {
      await connectRuby(svc);

      const result = await svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "class-passed",
        characterName: "Theo",
        teacherName: "Ruby",
        teacherFacultyId: "ruby",
        className: "Homeroom",
        classSubjects: ["ai-literacy"],
        letterGrade: "B",
        imageUrl: PNG_URL,
        studentImageUrl: PNG_URL,
        teacherImageUrl: PNG_URL,
      });

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("pauses future posts after X rejects a teacher token", async () => {
      await connectRuby(svc);

      mockMediaUpload();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ title: "Forbidden", detail: "Client is not permitted to post tweets." }),
      });

      const result = await svc.maybePostMilestone(RUBY_TEACHER, withImage({
        kind: "class-passed",
        characterName: "Reach Kid",
        letterGrade: "A",
      }));
      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(svc.getStatus("ruby")).toMatchObject({
        connected: true,
        hasTweetWrite: true,
        postPausedReason: "forbidden",
        lastPostFailureStatus: 403,
      });

      const restarted = new XSocialService();
      await restarted.start();
      expect(restarted.getStatus("ruby")).toMatchObject({
        connected: true,
        postPausedReason: "forbidden",
        lastPostFailureStatus: 403,
      });

      const second = await restarted.maybePostMilestone(RUBY_TEACHER, withImage({
        kind: "class-passed",
        characterName: "Second Reach Kid",
        letterGrade: "B",
      }));
      expect(second).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect((restarted as any).postCounts.get("ruby")).toBeUndefined();
    });

    it("backs off repeated posts while X rate limits the account", async () => {
      await connectRuby(svc);

      mockMediaUpload();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: (name: string) => name.toLowerCase() === "retry-after" ? "120" : null },
        text: async () => "Too Many Requests",
      });

      const result = await svc.maybePostMilestone(RUBY_TEACHER, withImage({
        kind: "class-passed",
        characterName: "Rate Limit Kid",
        letterGrade: "A",
      }));
      expect(result).toBeNull();
      const status = svc.getStatus("ruby");
      expect(status).toMatchObject({
        postPausedReason: "rate-limited",
        lastPostFailureStatus: 429,
      });
      expect(status.postPausedUntil).toBeGreaterThan(Date.now() + 100_000);
      expect(status.postPausedUntil).toBeLessThan(Date.now() + 130_000);

      const callsAfterRateLimit = mockFetch.mock.calls.length;
      const second = await svc.maybePostMilestone(RUBY_TEACHER, withImage({
        kind: "class-passed",
        characterName: "Still Rate Limited",
        letterGrade: "B",
      }));
      expect(second).toBeNull();
      expect(mockFetch.mock.calls).toHaveLength(callsAfterRateLimit);
      expect((svc as any).postCounts.get("ruby")).toBeUndefined();
    });

    it("does not pause all future posts for duplicate-content rejections", async () => {
      await connectRuby(svc);

      mockMediaUpload();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "You are not allowed to create a Tweet with duplicate content.",
      });

      await expect(svc.maybePostMilestone(RUBY_TEACHER, withImage({
        kind: "class-passed",
        characterName: "Duplicate Kid",
        letterGrade: "A",
      }))).resolves.toBeNull();
      expect(svc.getStatus("ruby").postPausedReason).toBeUndefined();

      mockMediaUpload();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-after-duplicate" } }),
      });
      await expect(svc.maybePostMilestone(RUBY_TEACHER, withImage({
        kind: "class-passed",
        characterName: "Fresh Copy Kid",
        letterGrade: "A",
      }))).resolves.toBe("tweet-after-duplicate");
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
            scope: "tweet.read tweet.write users.read offline.access media.write",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "1", username: "r" } }),
        });
      await svc.handleCallback("code", state);

      for (let i = 0; i < 50; i++) {
        mockMediaUpload(`media-${i}`);
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: `tweet-${i}` } }),
        });
      }
      for (let i = 0; i < 50; i++) {
        const result = await svc.maybePostMilestone(RUBY_TEACHER, withImage({
          kind: "class-passed",
          characterName: `Student ${i}`,
          letterGrade: "B",
        }));
        expect(result).toBe(`tweet-${i}`);
      }

      const result = await svc.maybePostMilestone(RUBY_TEACHER, withImage({
        kind: "class-passed",
        characterName: "Student 51",
        letterGrade: "B",
      }));
      expect(result).toBeNull();
    });

    it("does not spend post quota when a photo is already posted today", async () => {
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

      const today = new Date().toISOString().slice(0, 10);
      (svc as any).lastPhotoDate.set("ruby", today);

      for (let i = 0; i < 55; i++) {
        const result = await svc.maybePostMilestone(RUBY_TEACHER, {
          kind: "class-photo",
          characterName: `Student ${i}`,
          imageUrl: "data:image/png;base64,aW1hZ2U=",
        });
        expect(result).toBeNull();
      }

      expect((svc as any).postCounts.get("ruby")).toBeUndefined();

      mockMediaUpload();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-after-photo-deferrals" } }),
      });

      const result = await svc.maybePostMilestone(RUBY_TEACHER, withImage({
        kind: "class-passed",
        characterName: "Still Can Post",
        letterGrade: "A",
      }));
      expect(result).toBe("tweet-after-photo-deferrals");
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
            scope: "tweet.read tweet.write users.read offline.access media.write",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "1", username: "r" } }),
        });
      await svc.handleCallback("code", state);

      mockMediaUpload();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-fallback" } }),
      });

      const result = await svc.maybePostMilestone(RUBY_TEACHER, withImage({
        kind: "class-passed",
        characterName: "Lyra",
        teacherName: "Professor Edward",
        letterGrade: "A",
      }));
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

    it("persists the daily image slot across service restarts", async () => {
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

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "media-durable-slot" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "tweet-durable-slot" } }),
        });

      const pngUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
      await expect(svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "portrait-set",
        characterName: "Durable Photo Kid",
        portraitUrl: pngUrl,
      })).resolves.toBe("tweet-durable-slot");

      const fetchCallsAfterFirstPhoto = mockFetch.mock.calls.length;
      const restarted = new XSocialService();
      await restarted.start();
      expect(restarted.getStatus("ruby")).toMatchObject({ connected: true, hasMediaWrite: true });

      await expect(restarted.maybePostMilestone(RUBY_TEACHER, {
        kind: "class-photo",
        characterName: "Same Day Homeroom",
        imageUrl: pngUrl,
      })).resolves.toBeNull();
      expect(mockFetch.mock.calls).toHaveLength(fetchCallsAfterFirstPhoto);

      mockMediaUpload("media-text-after-photo-slot");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-text-after-photo-slot" } }),
      });
      await expect(restarted.maybePostMilestone(RUBY_TEACHER, withImage({
        kind: "class-passed",
        characterName: "Still Can Text",
        letterGrade: "A",
      }))).resolves.toBe("tweet-text-after-photo-slot");
    });

    it("keeps the durable image slot when the access token refreshes during posting", async () => {
      const { state } = svc.beginConnect("ruby");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "old-access", refresh_token: "refresh-me", expires_in: 7200,
            scope: "tweet.read tweet.write users.read offline.access media.write",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "1", username: "ruby" } }),
        });
      await svc.handleCallback("code", state);
      const token = (svc as any).tokens.get("ruby") as XTokenRecord;
      token.expiresAt = Date.now();

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            expires_in: 7200,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "media-after-refresh" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "tweet-after-refresh" } }),
        });

      const pngUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
      await expect(svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "portrait-set",
        characterName: "Refresh Photo Kid",
        portraitUrl: pngUrl,
      })).resolves.toBe("tweet-after-refresh");

      const refreshCall = mockFetch.mock.calls.find(
        (c: unknown[]) => String((c as string[])[0]).includes("/oauth2/token"),
      );
      expect(refreshCall).toBeDefined();
      const tweetCall = mockFetch.mock.calls.find(
        (c: unknown[]) => String((c as string[])[0]).includes("/tweets"),
      );
      expect((tweetCall?.[1] as RequestInit).headers).toMatchObject({
        Authorization: "Bearer fresh-access",
      });

      const fetchCallsAfterFirstPhoto = mockFetch.mock.calls.length;
      const restarted = new XSocialService();
      await restarted.start();
      await expect(restarted.maybePostMilestone(RUBY_TEACHER, {
        kind: "class-photo",
        characterName: "Refresh Same Day Homeroom",
        imageUrl: pngUrl,
      })).resolves.toBeNull();
      expect(mockFetch.mock.calls).toHaveLength(fetchCallsAfterFirstPhoto);
    });

    it("uses the daily photo slot for explicitly reserved graduation reveals", async () => {
      await connectRuby(svc);

      mockMediaUpload("media-graduation-photo");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-graduation-photo" } }),
      });

      await expect(svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "graduated",
        characterName: "Photo Graduate",
        imageUrl: PNG_URL,
        reserveDailyPhotoSlot: true,
      })).resolves.toBe("tweet-graduation-photo");

      const fetchCallsAfterGraduationPhoto = mockFetch.mock.calls.length;
      await expect(svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "class-photo",
        characterName: "Same Day Homeroom",
        imageUrl: PNG_URL,
      })).resolves.toBeNull();
      expect(mockFetch.mock.calls).toHaveLength(fetchCallsAfterGraduationPhoto);
    });

    it("attaches generic imageUrl media for class-photo tweets", async () => {
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
        json: async () => ({ data: { id: "media-class-photo" } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-class-photo" } }),
      });

      const pngUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
      const result = await svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "class-photo",
        characterName: "Homeroom",
        imageUrl: pngUrl,
      });

      expect(result).toBe("tweet-class-photo");
      const tweetCall = mockFetch.mock.calls.find(
        (c: unknown[]) => String((c as string[])[0]).includes("/tweets"),
      );
      const body = JSON.parse((tweetCall![1] as RequestInit).body as string);
      expect(body.media.media_ids).toEqual(["media-class-photo"]);
    });

    it("does not tweet image milestones when media upload fails", async () => {
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
      const pngUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

      const result = await svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "portrait-set",
        characterName: "Fallback Kid",
        portraitUrl: pngUrl,
      });
      expect(result).toBeNull();

      const tweetCall = mockFetch.mock.calls.find(
        (c: unknown[]) => String((c as string[])[0]).includes("/tweets"),
      );
      expect(tweetCall).toBeUndefined();
    });

    it("does not tweet image milestones when media scope is missing", async () => {
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

      const pngUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
      const result = await svc.maybePostMilestone(RUBY_TEACHER, {
        kind: "portrait-set",
        characterName: "Old Token Kid",
        portraitUrl: pngUrl,
      });

      expect(result).toBeNull();
      const mediaCalls = mockFetch.mock.calls.filter(
        (c: unknown[]) => String((c as string[])[0]).includes("media/upload"),
      );
      expect(mediaCalls).toHaveLength(0);
      const tweetCall = mockFetch.mock.calls.find(
        (c: unknown[]) => String((c as string[])[0]).includes("/tweets"),
      );
      expect(tweetCall).toBeUndefined();
    });

    it("does not tweet when no image URL is provided", async () => {
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
        kind: "class-passed",
        characterName: "No Pic",
        teacherName: "Ruby",
        letterGrade: "B",
      });
      expect(result).toBeNull();

      const mediaCalls = mockFetch.mock.calls.filter(
        (c: unknown[]) => String((c as string[])[0]).includes("media/upload"),
      );
      expect(mediaCalls).toHaveLength(0);
      const tweetCall = mockFetch.mock.calls.find(
        (c: unknown[]) => String((c as string[])[0]).includes("/tweets"),
      );
      expect(tweetCall).toBeUndefined();
    });

    it("attaches media to reflection posts", async () => {
      await connectRuby(svc);

      mockMediaUpload("media-reflection");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-reflection" } }),
      });

      const result = await svc.postReflection(
        RUBY_TEACHER,
        {
          date: "2026-06-21",
          charactersCreated: ["Mika"],
          classesPassed: [],
          gradesAdvanced: [],
          graduations: [],
          totalStudents: 1,
          totalQuestionsAnswered: 4,
        },
        { imageUrl: PNG_URL },
      );
      expect(result).toBe("tweet-reflection");

      const tweetCall = mockFetch.mock.calls.find(
        (c: unknown[]) => String((c as string[])[0]).includes("/tweets"),
      );
      const body = JSON.parse((tweetCall![1] as RequestInit).body as string);
      expect(body.media.media_ids).toEqual(["media-reflection"]);
    });

    it("posts the exact LLM-written scheduled school update with media", async () => {
      await connectRuby(svc);
      vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "test-key");
      vi.stubEnv("RUBY_HIGH_PUBLIC_BASE", "https://ruby-high.ai");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ choices: [{ message: { content: "The classrooms are moving, and the lounge has plenty to talk about. #RubyHigh" } }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ choices: [{ message: { images: [{ image_url: { url: PNG_URL } }] } }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "media-school-update" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "tweet-school-update" } }),
        });

      const result = await svc.postScheduledSchoolUpdate(
        RUBY_TEACHER,
        SCHOOL_UPDATE_CONTEXT,
        { imageUrl: PNG_URL },
      );
      expect(result).toBe("tweet-school-update");

      const tweetCall = mockFetch.mock.calls.find(
        (call: unknown[]) => String((call as string[])[0]).includes("api.x.com/2/tweets"),
      );
      const body = JSON.parse((tweetCall![1] as RequestInit).body as string);
      expect(body).toEqual({
        text: "The classrooms are moving, and the lounge has plenty to talk about. #RubyHigh https://ruby-high.ai/api/apps/ruby-high/viewer?ref=activation-x-school-update",
        media: { media_ids: ["media-school-update"] },
      });
      const llmCall = mockFetch.mock.calls.find((call: unknown[]) => {
        const bodyText = String((call[1] as RequestInit | undefined)?.body ?? "");
        return bodyText.includes("concrete invitation to take today's class");
      });
      expect(llmCall).toBeDefined();
      expect(String((llmCall![1] as RequestInit).body)).toContain("under 180 characters");
      const imageCall = mockFetch.mock.calls.find((call: unknown[]) => {
        const bodyText = String((call[1] as RequestInit | undefined)?.body ?? "");
        return bodyText.includes('"modalities":["image","text"]');
      });
      expect(imageCall).toBeDefined();
      expect(String((imageCall![1] as RequestInit).body)).toContain("IDENTITY LOCK");
      expect(String((imageCall![1] as RequestInit).body)).toContain("STORY BEAT");
    });

    it("grounds featured-guest insight copy in the guest's recent X posts", async () => {
      await connectRuby(svc);
      vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "test-key");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "guest-user-1" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{
              id: "guest-post-1",
              created_at: "2026-07-21T18:00:00.000Z",
              text: "Agent systems are easier to trust when authority and tool boundaries are explicit.",
            }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: "Insights from @elizaOS: explicit authority and tool boundaries make agent systems easier to trust. #RubyHigh",
              },
            }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ choices: [{ message: { images: [{ image_url: { url: PNG_URL } }] } }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "media-guest-insight" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "tweet-guest-insight" } }),
        });

      await expect(svc.postScheduledSchoolUpdate(
        RUBY_TEACHER,
        FEATURED_GUEST_CONTEXT,
        { imageUrl: PNG_URL, editorialMode: "guest-insights" },
      )).resolves.toBe("tweet-guest-insight");

      const llmCall = mockFetch.mock.calls.find((call: unknown[]) => {
        const bodyText = String((call[1] as RequestInit | undefined)?.body ?? "");
        return bodyText.includes("x-social-scheduled-school-update") ||
          bodyText.includes("Agent systems are easier to trust");
      });
      expect(llmCall).toBeDefined();
      expect(String((llmCall![1] as RequestInit).body)).toContain("recent X posts");
      expect(String((llmCall![1] as RequestInit).body)).toContain("Agent systems are easier to trust");
      const imageCall = mockFetch.mock.calls.find((call: unknown[]) => {
        const bodyText = String((call[1] as RequestInit | undefined)?.body ?? "");
        return bodyText.includes('"modalities":["image","text"]');
      });
      expect(String((imageCall![1] as RequestInit).body)).toContain("Eliza - teacher");

      const tweetCall = mockFetch.mock.calls.find(
        (call: unknown[]) => String((call as string[])[0]) === "https://api.x.com/2/tweets",
      );
      const body = JSON.parse((tweetCall![1] as RequestInit).body as string);
      expect(body.text).toContain("Insights from @elizaOS");
      expect(body.text).toContain("ref=activation-x-guest-insights");
      expect(body.media.media_ids).toEqual(["media-guest-insight"]);
    });

    it("falls back to the configured static image when scheduled composition fails", async () => {
      await connectRuby(svc);
      vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "test-key");
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ choices: [{ message: { content: "Class is moving with purpose today. #RubyHigh" } }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ choices: [{ message: {} }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "media-static-fallback" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "tweet-static-fallback" } }),
        });

      await expect(svc.postScheduledSchoolUpdate(
        RUBY_TEACHER,
        SCHOOL_UPDATE_CONTEXT,
        { imageUrl: PNG_URL },
      )).resolves.toBe("tweet-static-fallback");
    });

    it("skips scheduled school updates when no LLM credential is configured", async () => {
      await connectRuby(svc);
      await expect(svc.postScheduledSchoolUpdate(
        RUBY_TEACHER,
        SCHOOL_UPDATE_CONTEXT,
        { imageUrl: PNG_URL },
      )).resolves.toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("attaches media to report-card posts", async () => {
      await connectRuby(svc);

      mockMediaUpload("media-report-card");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tweet-report-card" } }),
      });

      const result = await svc.postReportCard(RUBY_TEACHER, {
        name: "Noor",
        playbookId: "outsider",
        grade: "10",
        stats: { head: 3, heart: 2, hustle: 1, honor: 0 },
        classGrades: { ruby: "A" },
        yearbookCount: 1,
        portraitUrl: PNG_URL,
      });
      expect(result).toBe("tweet-report-card");

      const tweetCall = mockFetch.mock.calls.find(
        (c: unknown[]) => String((c as string[])[0]).includes("/tweets"),
      );
      const body = JSON.parse((tweetCall![1] as RequestInit).body as string);
      expect(body.media.media_ids).toEqual(["media-report-card"]);
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
