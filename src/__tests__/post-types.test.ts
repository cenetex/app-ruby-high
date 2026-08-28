import { afterEach, describe, it, expect, vi } from "vitest";
import {
  appendScheduledSchoolUpdateLink,
  buildDeterministicPostText,
  isLowSignalMilestone,
  buildFallbackPostText,
  buildScheduledGuestWelcomeText,
  generateScheduledSchoolUpdateText,
  hasMeaningfulScheduledSchoolActivity,
  normalizeScheduledSchoolUpdateText,
  scheduledSchoolUpdateFingerprint,
} from "../services/ruby-high/post-types.js";
import type { TeacherCharacter } from "../characters/teachers.js";

const WARM_TEACHER: TeacherCharacter = {
  id: "ruby",
  displayName: "Ruby",
  shortName: "Ruby",
  defaultModel: "test-model",
  systemPrompt: "You are Ruby, a warm and mischievous teacher who loves her students. You are playful and encouraging.",
};

const STRICT_TEACHER: TeacherCharacter = {
  id: "professor-edward",
  displayName: "Professor Edward",
  shortName: "Edward",
  defaultModel: "test-model",
  systemPrompt: "You are Professor Edward, a strict and demanding teacher who expects excellence. No shortcuts.",
};

const PLAYFUL_TEACHER: TeacherCharacter = {
  id: "sally-science",
  displayName: "Sally Science",
  shortName: "Sally",
  defaultModel: "test-model",
  systemPrompt: "You are Sally Science, a playful trickster who loves chaos and experiments gone wrong.",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isLowSignalMilestone", () => {
  it("returns true for character-created, class-passed, grade-advanced", () => {
    expect(isLowSignalMilestone("character-created")).toBe(true);
    expect(isLowSignalMilestone("class-passed")).toBe(true);
    expect(isLowSignalMilestone("grade-advanced")).toBe(true);
  });

  it("returns false for graduated, portrait-set, diploma-earned, class-photo", () => {
    expect(isLowSignalMilestone("graduated")).toBe(false);
    expect(isLowSignalMilestone("portrait-set")).toBe(false);
    expect(isLowSignalMilestone("diploma-earned")).toBe(false);
    expect(isLowSignalMilestone("class-photo")).toBe(false);
  });
});

describe("buildDeterministicPostText", () => {
  it("uses playful template for Ruby (mischievous in prompt)", () => {
    const text = buildDeterministicPostText(WARM_TEACHER, {
      kind: "character-created",
      characterName: "Lyra",
    });
    expect(text).toContain("hallways");
    expect(text).toContain("Lyra");
    expect(text).toContain("#RubyHigh");
  });

  it("uses strict template for Professor Edward", () => {
    const text = buildDeterministicPostText(STRICT_TEACHER, {
      kind: "class-passed",
      characterName: "Sami",
      teacherName: "Ruby",
      letterGrade: "A",
    });
    expect(text).toContain("Acceptable");
    expect(text).toContain("Sami");
    expect(text).toContain("A");
  });

  it("uses playful template for Sally Science", () => {
    const text = buildDeterministicPostText(PLAYFUL_TEACHER, {
      kind: "grade-advanced",
      characterName: "Noor",
      fromGrade: "9",
      toGrade: "10",
    });
    expect(text).toContain("Noor");
    expect(text).toContain("chaos");
  });

  it("includes student name in every template", () => {
    const teachers = [WARM_TEACHER, STRICT_TEACHER, PLAYFUL_TEACHER];
    for (const teacher of teachers) {
      expect(
        buildDeterministicPostText(teacher, {
          kind: "character-created",
          characterName: "Indra",
        }),
      ).toContain("Indra");
    }
  });

  it("fits tweets within 280 characters", () => {
    const longName = "A".repeat(50);
    const text = buildDeterministicPostText(WARM_TEACHER, {
      kind: "character-created",
      characterName: longName,
    });
    expect(text.length).toBeLessThanOrEqual(280);
  });
});

describe("buildFallbackPostText", () => {
  it("generates text for every milestone kind", () => {
    const kinds = [
      "character-created",
      "class-passed",
      "grade-advanced",
      "graduated",
      "portrait-set",
      "diploma-earned",
      "class-photo",
    ] as const;
    for (const kind of kinds) {
      const text = buildFallbackPostText({ kind, characterName: "Test Student" });
      expect(text).toBeTruthy();
      expect(text.length).toBeLessThanOrEqual(280);
    }
  });
});

describe("scheduled school update safety", () => {
  const context = {
    date: "2026-07-22",
    updatedSessionsLast24h: 8,
    activeStudents: 3,
    activeRooms: [{ area: "classroom" as const, grade: "9", activeStudents: 3, goalProgress: 2, goalTarget: 3 }],
    highlights: { newStudents: 1, classesPassed: 2, gradesAdvanced: 0, graduations: 0 },
    recentEvents: { roomGoalProgress: 2, relationshipMoments: 1, futuresResolved: 0, comicPagesUnlocked: 0 },
  };

  it("recognizes aggregate activity and fingerprints context deterministically", () => {
    expect(hasMeaningfulScheduledSchoolActivity(context)).toBe(true);
    expect(scheduledSchoolUpdateFingerprint(context)).toBe(scheduledSchoolUpdateFingerprint({ ...context }));
    expect(scheduledSchoolUpdateFingerprint({ ...context, activeStudents: 4 })).not.toBe(
      scheduledSchoolUpdateFingerprint(context),
    );
  });

  it("normalizes model wrappers and adds the campaign tag", () => {
    expect(normalizeScheduledSchoolUpdateText('```text\nTweet: "The lounge is buzzing after a strong class day."\n```'))
      .toBe("The lounge is buzzing after a strong class day. #RubyHigh");
  });

  it("builds a bounded welcome from verified guest-roster metadata", () => {
    expect(buildScheduledGuestWelcomeText({
      ...context,
      featuredGuest: {
        weekKey: "2026-W30",
        packId: "teacher:eliza-elizaos-systems-lab",
        facultyId: "eliza",
        displayName: "Eliza",
        courseTitle: "elizaOS Systems Lab",
        bio: "Guest systems teacher.",
        xHandle: "elizaOS",
      },
    })).toBe(
      "Welcome this week's featured guest teacher, Eliza (@elizaOS), to Ruby High! This week's course: elizaOS Systems Lab. #RubyHigh",
    );
  });

  it("can announce a verified guest flip without a text model", async () => {
    vi.stubEnv("RUBY_HIGH_LLM_PROVIDER", "openrouter");
    vi.stubEnv("RUBY_HIGH_LLM_BASE_URL", "");
    vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "");
    const guestContext = {
      ...context,
      featuredGuest: {
        weekKey: "2026-W30",
        packId: "teacher:eliza-elizaos-systems-lab",
        facultyId: "eliza",
        displayName: "Eliza",
        courseTitle: "elizaOS Systems Lab",
        bio: "Guest systems teacher.",
        xHandle: "elizaOS",
      },
    };

    await expect(generateScheduledSchoolUpdateText(
      WARM_TEACHER,
      guestContext,
      { editorialMode: "guest-welcome" },
    )).resolves.toBe(
      "Welcome this week's featured guest teacher, Eliza (@elizaOS), to Ruby High! This week's course: elizaOS Systems Lab. #RubyHigh",
    );
  });

  it("rejects handles and links, and keeps long copy within X's limit", () => {
    expect(normalizeScheduledSchoolUpdateText("Thanks @student! #RubyHigh")).toBeNull();
    expect(normalizeScheduledSchoolUpdateText(
      "Insights from @elizaOS: boundaries make agents easier to trust. #RubyHigh",
      { allowedHandle: "elizaOS" },
    )).toBe("Insights from @elizaOS: boundaries make agents easier to trust. #RubyHigh");
    expect(normalizeScheduledSchoolUpdateText(
      "Insights from @someoneElse: hello. #RubyHigh",
      { allowedHandle: "elizaOS" },
    )).toBeNull();
    expect(normalizeScheduledSchoolUpdateText("Read https://example.com #RubyHigh")).toBeNull();
    expect(normalizeScheduledSchoolUpdateText("A".repeat(400))).toMatch(/^A+\.\.\. #RubyHigh$/);
    expect(normalizeScheduledSchoolUpdateText("A".repeat(400))!.length).toBeLessThanOrEqual(280);
  });

  it("appends only a bounded HTTPS activation link after generated copy is validated", () => {
    const url = "https://ruby-high.ai/api/apps/ruby-high/viewer?ref=activation-x-school-update";
    expect(appendScheduledSchoolUpdateLink("Take today's class. #RubyHigh", url)).toBe(
      `Take today's class. #RubyHigh ${url}`,
    );
    expect(appendScheduledSchoolUpdateLink("A".repeat(260) + " #RubyHigh", url)).toMatch(
      new RegExp(`^A+\\.\\.\\. #RubyHigh ${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    );
    expect(appendScheduledSchoolUpdateLink("A".repeat(260) + " #RubyHigh", url)!.length).toBeLessThanOrEqual(280);
    expect(appendScheduledSchoolUpdateLink("Take class", "http://example.com")).toBeNull();
  });
});
