import { describe, it, expect } from "vitest";
import {
  buildDeterministicPostText,
  isLowSignalMilestone,
  weightedPickPostKind,
  DEFAULT_POST_TYPE_WEIGHTS,
  buildFallbackPostText,
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

describe("weightedPickPostKind", () => {
  it("returns a valid post kind when all are eligible", () => {
    const result = weightedPickPostKind(DEFAULT_POST_TYPE_WEIGHTS, () => true);
    expect(result).toBeDefined();
    expect(["milestone", "reflection", "question", "engagement"]).toContain(result);
  });

  it("returns null when nothing is eligible", () => {
    const result = weightedPickPostKind(DEFAULT_POST_TYPE_WEIGHTS, () => false);
    expect(result).toBeNull();
  });

  it("respects the cooldown filter", () => {
    const results: string[] = [];
    for (let i = 0; i < 100; i++) {
      const result = weightedPickPostKind(
        DEFAULT_POST_TYPE_WEIGHTS,
        (kind) => kind === "milestone",
      );
      if (result) results.push(result);
    }
    expect(results.every((r) => r === "milestone")).toBe(true);
  });

  it("distributes picks according to weights", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 500; i++) {
      const result = weightedPickPostKind(DEFAULT_POST_TYPE_WEIGHTS, () => true);
      if (result) counts[result] = (counts[result] ?? 0) + 1;
    }
    expect(counts.milestone).toBeGreaterThan(counts.reflection ?? 0);
    expect(counts.milestone).toBeGreaterThan(counts.question ?? 0);
    expect(counts.milestone).toBeGreaterThan(counts.engagement ?? 0);
  });
});
