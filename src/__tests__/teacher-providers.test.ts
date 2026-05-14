import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("connected teacher provider configuration", () => {
  it("lets RUBY_HIGH_CONNECTED_TEACHER_QUESTION_COUNT=0 skip seed-bank generation", async () => {
    process.env = { ...ORIGINAL_ENV, RUBY_HIGH_CONNECTED_TEACHER_QUESTION_COUNT: "0" };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { generateConnectedTeacherQuestionBank } = await import("../services/teacher-providers.js");

    await expect(generateConnectedTeacherQuestionBank({
      id: "rati:test-teacher",
      model: "test-teacher",
      root: "test-teacher",
      name: "Test Teacher",
      description: "A connected teacher used for tests.",
      provider: "rati-openai-compatible",
      supportsTools: true,
    })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a sanitized custom classroom channel name for connected teacher packs", async () => {
    const { packForConnectedTeacher } = await import("../services/teacher-providers.js");

    const pack = packForConnectedTeacher({
      id: "avatar:opus",
      model: "avatar:opus",
      root: "agent-1-8yan",
      name: "Opus",
      description: "A reasoning teacher.",
      provider: "rati-openai-compatible",
      supportsTools: true,
    }, [], { channelName: "Opus Lab!" });

    expect(pack.rooms[0]?.channelName).toBe("opus-lab");
  });
});
