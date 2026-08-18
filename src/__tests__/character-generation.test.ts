import { describe, it, expect, vi, afterEach } from "vitest";

const GENERATED_PHOTO_HASH = "e68eb7327208097ea3088baab551269c";

describe("generated portrait asset URLs", () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(process.env)) {
      if (!(k in OLD_ENV)) delete process.env[k];
    }
    for (const [k, v] of Object.entries(OLD_ENV)) {
      process.env[k] = v;
    }
    vi.resetModules();
  });

  it("builds app-hosted URLs for generated portrait objects", async () => {
    vi.stubEnv("RUBY_HIGH_PUBLIC_BASE", "https://ruby-high.ai/");
    const { generatedPortraitAssetPath, generatedPortraitAssetUrl } = await import("../services/generated-portrait-assets.js");

    expect(generatedPortraitAssetPath("graduation-photo", GENERATED_PHOTO_HASH, "png")).toBe(
      `/api/apps/ruby-high/assets/generated/graduation-photo/${GENERATED_PHOTO_HASH}.png`,
    );
    expect(generatedPortraitAssetUrl("graduation-photo", GENERATED_PHOTO_HASH, "png")).toBe(
      `https://ruby-high.ai/api/apps/ruby-high/assets/generated/graduation-photo/${GENERATED_PHOTO_HASH}.png`,
    );
    expect(generatedPortraitAssetPath("yearbook-card", GENERATED_PHOTO_HASH, "webp")).toBe(
      `/api/apps/ruby-high/assets/generated/yearbook-card/${GENERATED_PHOTO_HASH}.webp`,
    );
  });

  it("rewrites private S3 generated portrait URLs to the app asset route", async () => {
    vi.stubEnv("RUBY_HIGH_PORTRAITS_BUCKET", "ruby-high-portraits");
    const {
      rewriteGeneratedPortraitS3Url,
    } = await import("../services/generated-portrait-assets.js");

    expect(rewriteGeneratedPortraitS3Url(
      `https://ruby-high-portraits.s3.us-east-1.amazonaws.com/graduation-photo/${GENERATED_PHOTO_HASH}.png`,
    )).toBe(
      `/api/apps/ruby-high/assets/generated/graduation-photo/${GENERATED_PHOTO_HASH}.png`,
    );
    expect(rewriteGeneratedPortraitS3Url("https://cdn.example.test/graduation-photo/elsewhere.png")).toBeNull();
    expect(rewriteGeneratedPortraitS3Url(
      `https://ruby-high-portraits.s3.us-east-1.amazonaws.com/yearbook-card/${GENERATED_PHOTO_HASH}.webp`,
    )).toBe(
      `/api/apps/ruby-high/assets/generated/yearbook-card/${GENERATED_PHOTO_HASH}.webp`,
    );
  });

  it("normalizes stored private S3 generated portrait URLs", async () => {
    const { normalizeStoredImageRef } = await import("../services/ruby-high/helpers.js");

    expect(normalizeStoredImageRef(
      `https://ruby-high-portraits.s3.us-east-1.amazonaws.com/graduation-photo/${GENERATED_PHOTO_HASH}.png`,
      "graduationPhotoImageUrl",
    )).toBe(
      `/api/apps/ruby-high/assets/generated/graduation-photo/${GENERATED_PHOTO_HASH}.png`,
    );
    expect(() => normalizeStoredImageRef(
      `data:image/png;base64,${"A".repeat(280_001)}`,
      "yearbookImageUrl",
    )).toThrow(/yearbookImageUrl too large/);
  });
});

describe("graduation photo prompts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  function textResponse(content: string): Response {
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  function imageResponse(url: string): Response {
    return new Response(JSON.stringify({
      choices: [{
        message: {
          images: [{ image_url: { url } }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  it("asks each character for an action and consolidates the final graduation prompt", async () => {
    const requests: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      requests.push(body);
      if (Array.isArray(body.modalities) && body.modalities.includes("image")) {
        return imageResponse("data:image/png;base64,PHOTO");
      }
      const bodyText = JSON.stringify(body);
      if (bodyText.includes("Consolidate these in-character action proposals")) {
        return textResponse("Mina vaults off a courtyard step while Ruby frames the moment with a proud half-smile and Lyra flings ribbon streamers through the sunlight.");
      }
      if (bodyText.includes("Character: Mina")) return textResponse("vaults off a low courtyard step, grinning like the bell just rang");
      if (bodyText.includes("Character: Ruby")) return textResponse("leans against the bench with a proud, unsentimental half-smile");
      if (bodyText.includes("Character: Lyra")) return textResponse("throws ribbon streamers upward while trying not to look nervous");
      return textResponse("stands with lively graduation energy");
    }));

    const { renderGraduationPhoto } = await import("../services/character-generation.js");
    const url = await renderGraduationPhoto({
      apiKey: "sk-test",
      gradeLabel: "9th Grade",
      player: {
        name: "Mina",
        imageUrl: "https://ruby.test/mina.png",
        personality: "Restless, bright, and trying to look less proud than she is.",
        playbookName: "outsider",
      },
      teacher: {
        id: "ruby",
        name: "Ruby",
        imageUrl: "https://ruby.test/ruby.png",
      },
      classmate: {
        id: "lyra",
        name: "Lyra",
        imageUrl: "https://ruby.test/lyra.png",
      },
    });

    expect(url).toBe("data:image/png;base64,PHOTO");
    expect(requests.filter((body) => !Array.isArray(body.modalities))).toHaveLength(4);
    const imageBody = requests.find((body) => Array.isArray(body.modalities) && body.modalities.includes("image"));
    const content = imageBody?.messages?.[0]?.content;
    const prompt = Array.isArray(content)
      ? content.filter((part: any) => part.type === "text").map((part: any) => String(part.text ?? "")).join("\n")
      : "";
    const imageParts = Array.isArray(content) ? content.filter((part: any) => part.type === "image_url") : [];
    expect(imageParts.map((part: any) => part.image_url?.url)).toEqual([
      "https://ruby.test/mina.png",
      "https://ruby.test/ruby.png",
      "https://ruby.test/lyra.png",
    ]);
    expect(prompt).toContain("REFERENCE IMAGE 1: Mina - graduating student");
    expect(prompt).toContain("IDENTITY LOCK");
    expect(prompt).toContain("Ruby High courtyard");
    expect(prompt).toContain("Mina vaults off a courtyard step");
    expect(prompt).toContain("INDIVIDUAL INTENTIONS");
    expect(prompt).toContain("AVOID: formal photo-day backdrop");
    expect(prompt).not.toContain("teacher stands centered slightly behind");
  });

  it("prompts yearbook card images as dynamic campus scenes", async () => {
    vi.stubEnv("RUBY_HIGH_PUBLIC_BASE", "https://ruby-high.ai");
    const requests: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body || "{}")));
      return imageResponse("data:image/png;base64,YEARBOOK");
    }));

    const { renderYearbookCard } = await import("../services/yearbook-image.js");
    const url = await renderYearbookCard({
      apiKey: "sk-test",
      card: {
        characterName: "Mina",
        grade: "11",
        playbookName: "Outsider",
        portraitDataUrl: "/api/apps/ruby-high/assets/students/indra-full.png",
        classmateName: "Noor",
        classmateImageUrl: "https://ruby.test/noor.png",
        teacherName: "Professor Edward",
        teacherImageUrl: "https://ruby.test/edward.png",
      },
    });

    expect(url).toBe("data:image/png;base64,YEARBOOK");
    const content = requests[0]?.messages?.[0]?.content;
    const prompt = Array.isArray(content)
      ? content.filter((part: any) => part.type === "text").map((part: any) => String(part.text ?? "")).join("\n")
      : "";
    const imageParts = Array.isArray(content) ? content.filter((part: any) => part.type === "image_url") : [];
    expect(imageParts.map((part: any) => part.image_url?.url)).toEqual([
      "https://ruby-high.ai/api/apps/ruby-high/assets/students/indra-full.png",
      "https://ruby.test/noor.png",
      "https://ruby.test/edward.png",
    ]);
    expect(prompt).toContain("REFERENCE IMAGE 1: Mina - graduating student");
    expect(prompt).toContain("IDENTITY LOCK");
    expect(prompt).toContain("Ruby High library");
    expect(prompt).toContain("distinct fun poses");
    expect(prompt).toContain("AVOID: plain homeroom");
    expect(prompt).not.toContain("CLASSROOM SCENE");
  });

  it("composes passed-class posts from the actual student, teacher, and class", async () => {
    vi.stubEnv("RUBY_HIGH_PUBLIC_BASE", "https://ruby-high.ai");
    const requests: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body || "{}")));
      return imageResponse("data:image/png;base64,CLASSPASSED");
    }));

    const { renderClassPassedPhoto } = await import("../services/character-generation.js");
    const url = await renderClassPassedPhoto({
      apiKey: "sk-test",
      student: {
        name: "Theo",
        imageUrl: "/api/apps/ruby-high/assets/students/indra-full.png",
      },
      teacher: {
        name: "Sally Science",
        imageUrl: "/api/apps/ruby-high/assets/teachers/sally-science-full.png",
      },
      className: "Science Lab",
      subjects: ["physics", "chemistry", "biology"],
      grade: "10",
      letterGrade: "C",
    });

    expect(url).toBe("data:image/png;base64,CLASSPASSED");
    const content = requests[0]?.messages?.[0]?.content;
    const prompt = Array.isArray(content)
      ? content.filter((part: any) => part.type === "text").map((part: any) => String(part.text ?? "")).join("\n")
      : "";
    const imageParts = Array.isArray(content) ? content.filter((part: any) => part.type === "image_url") : [];
    expect(imageParts.map((part: any) => part.image_url?.url)).toEqual([
      "https://ruby-high.ai/api/apps/ruby-high/assets/students/indra-full.png",
      "https://ruby-high.ai/api/apps/ruby-high/assets/teachers/sally-science-full.png",
    ]);
    expect(prompt).toContain("REFERENCE IMAGE 1: Theo - the student who passed");
    expect(prompt).toContain("REFERENCE IMAGE 2: Sally Science - the teacher of Science Lab");
    expect(prompt).toContain("ACTUAL CLASS: Science Lab");
    expect(prompt).toContain("SUBJECTS: physics, chemistry, biology");
    expect(prompt).toContain("LOCATION: Ruby High science lab");
    expect(prompt).toContain("source portraits are identity references only");
    expect(prompt).toContain("immediately after Theo passed Science Lab with a C");
    expect(prompt).toContain("wide horizontal editorial school photo, 16:9");
    expect(prompt).toContain("AVOID: solo portraits");
  });

  it("composes scheduled updates as identity-locked dynamic school photos", async () => {
    vi.stubEnv("RUBY_HIGH_PUBLIC_BASE", "https://ruby-high.ai");
    const requests: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body || "{}")));
      return imageResponse("data:image/png;base64,SCHOOLUPDATE");
    }));

    const { renderScheduledSchoolUpdatePhoto } = await import("../services/character-generation.js");
    const url = await renderScheduledSchoolUpdatePhoto({
      apiKey: "sk-test",
      postText: "The lab tables are lively today. #RubyHigh",
      context: {
        date: "2026-07-23",
        updatedSessionsLast24h: 12,
        activeStudents: 3,
        activeRooms: [{ area: "classroom", grade: "10", activeStudents: 3, goalProgress: 2, goalTarget: 3 }],
        highlights: { newStudents: 1, classesPassed: 2, gradesAdvanced: 0, graduations: 0 },
        recentEvents: { roomGoalProgress: 2, relationshipMoments: 0, futuresResolved: 0, comicPagesUnlocked: 0 },
      },
      participants: [
        { role: "teacher", id: "ruby", name: "Ruby", imageUrl: "/api/apps/ruby-high/assets/teachers/ruby-full.png" },
        { role: "student", id: "mika", name: "Mika", imageUrl: "/api/apps/ruby-high/assets/students/mika-full.png" },
        { role: "student", id: "ravi", name: "Ravi", imageUrl: "/api/apps/ruby-high/assets/students/ravi-full.png" },
      ],
    });

    expect(url).toBe("data:image/png;base64,SCHOOLUPDATE");
    const content = requests[0]?.messages?.[0]?.content;
    const prompt = Array.isArray(content)
      ? content.filter((part: any) => part.type === "text").map((part: any) => String(part.text ?? "")).join("\n")
      : "";
    const imageParts = Array.isArray(content) ? content.filter((part: any) => part.type === "image_url") : [];
    expect(imageParts.map((part: any) => part.image_url?.url)).toEqual([
      "https://ruby-high.ai/api/apps/ruby-high/assets/teachers/ruby-full.png",
      "https://ruby-high.ai/api/apps/ruby-high/assets/students/mika-full.png",
      "https://ruby-high.ai/api/apps/ruby-high/assets/students/ravi-full.png",
    ]);
    expect(prompt).toContain("REFERENCE IMAGE 1: Ruby - teacher");
    expect(prompt).toContain("IDENTITY LOCK");
    expect(prompt).toContain("Ruby High science lab");
    expect(prompt).toContain("STORY BEAT: The lab tables are lively today. #RubyHigh");
    expect(prompt).toContain("wide horizontal editorial school photo, 16:9");
    expect(prompt).toContain("not a graduation ceremony");
    expect(prompt).toContain("No text, no logos, no captions");
  });

  it("turns social reference art into a new named Ruby High location scene", async () => {
    vi.stubEnv("RUBY_HIGH_PUBLIC_BASE", "https://ruby-high.ai");
    const requests: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body || "{}")));
      return imageResponse("data:image/png;base64,GENERATEDLOCATION");
    }));

    const { renderRubyHighSocialPhoto } = await import("../services/character-generation.js");
    const result = await renderRubyHighSocialPhoto({
      apiKey: "sk-test",
      kind: "grade-advanced",
      storyBeat: "Tariq advanced from grade 10 to grade 11.",
      grade: "11",
      references: [
        { role: "student", id: "tariq", name: "Tariq", imageUrl: "/api/apps/ruby-high/assets/portrait/tariq.png" },
        { role: "teacher", id: "ruby", name: "Ruby", imageUrl: "/api/apps/ruby-high/assets/teachers/ruby-full.png" },
      ],
    });

    expect(result).toEqual({
      imageUrl: "data:image/png;base64,GENERATEDLOCATION",
      sceneId: "library",
      roomName: "Ruby High library",
    });
    const content = requests[0]?.messages?.[0]?.content;
    const prompt = Array.isArray(content)
      ? content.filter((part: any) => part.type === "text").map((part: any) => String(part.text ?? "")).join("\n")
      : "";
    expect(prompt).toContain("REFERENCE IMAGE 1: Tariq - student");
    expect(prompt).toContain("REFERENCE-ONLY RULE");
    expect(prompt).toContain("LOCATION: Ruby High library");
    expect(prompt).toContain("plain, gradient, transparent, or portrait-studio background is a failed result");
    expect(prompt).toContain("Do not copy, crop, frame, or return a source image unchanged");
  });

  it("rejects an image model response that echoes a reference unchanged", async () => {
    const referenceUrl = "https://ruby.test/tariq.png";
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(referenceUrl)));
    const { renderRubyHighSocialPhoto } = await import("../services/character-generation.js");

    await expect(renderRubyHighSocialPhoto({
      apiKey: "sk-test",
      kind: "grade-advanced",
      storyBeat: "Tariq advanced a grade.",
      grade: "11",
      references: [
        { role: "student", id: "tariq", name: "Tariq", imageUrl: referenceUrl },
      ],
    })).rejects.toThrow("unchanged reference image");
  });

  it("uses the dedicated teacher lounge scene for lounge updates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse("data:image/png;base64,LOUNGE")));
    const { renderScheduledSchoolUpdatePhoto } = await import("../services/character-generation.js");
    await renderScheduledSchoolUpdatePhoto({
      apiKey: "sk-test",
      postText: "The lounge debate survived the bell. #RubyHigh",
      context: {
        date: "2026-07-23",
        updatedSessionsLast24h: 3,
        activeStudents: 1,
        activeRooms: [{ area: "teacher-lounge", grade: "11", activeStudents: 1, goalProgress: 1, goalTarget: 3 }],
        highlights: { newStudents: 0, classesPassed: 0, gradesAdvanced: 0, graduations: 0 },
        recentEvents: { roomGoalProgress: 0, relationshipMoments: 2, futuresResolved: 0, comicPagesUnlocked: 0 },
      },
      participants: [
        { role: "teacher", id: "ruby", name: "Ruby", imageUrl: "https://ruby.test/ruby.png" },
        { role: "teacher", id: "sally-science", name: "Sally Science", imageUrl: "https://ruby.test/sally.png" },
        { role: "teacher", id: "professor-edward", name: "Professor Edward", imageUrl: "https://ruby.test/edward.png" },
      ],
    });
    const request = (fetch as any).mock.calls[0];
    const body = JSON.parse(String(request?.[1]?.body || "{}"));
    expect(JSON.stringify(body)).toContain("Ruby High teacher's lounge");
    expect(JSON.stringify(body)).toContain("lively social energy");
  });

  it("ages a student portrait up one grade using the current portrait as identity", async () => {
    vi.stubEnv("RUBY_HIGH_PUBLIC_BASE", "https://ruby-high.ai");
    const requests: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body || "{}")));
      return imageResponse("data:image/png;base64,AGEDUP");
    }));

    const { renderCharacterPortraitAgeUp } = await import("../services/character-generation.js");
    const url = await renderCharacterPortraitAgeUp({
      apiKey: "sk-test",
      name: "Mina",
      personality: "Restless, bright, and trying to look less proud than she is.",
      referenceImageUrl: "/api/apps/ruby-high/assets/students/indra-full.png",
      gradeLabel: "Sophomore",
    });

    expect(url).toBe("data:image/png;base64,AGEDUP");
    const content = requests[0]?.messages?.[0]?.content;
    const prompt = Array.isArray(content)
      ? content.filter((part: any) => part.type === "text").map((part: any) => String(part.text ?? "")).join("\n")
      : "";
    const imageParts = Array.isArray(content) ? content.filter((part: any) => part.type === "image_url") : [];
    expect(imageParts.map((part: any) => part.image_url?.url)).toEqual([
      "https://ruby-high.ai/api/apps/ruby-high/assets/students/indra-full.png",
    ]);
    expect(prompt).toContain("REFERENCE IMAGE: Mina's current student portrait");
    expect(prompt).toContain("IDENTITY LOCK");
    expect(prompt).toContain("one grade older");
    expect(prompt).toContain("now a Sophomore");
    expect(prompt).toContain("SOLID FLAT pale lavender background");
  });
});
