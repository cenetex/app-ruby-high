import { describe, expect, it } from "vitest";
import { TEACHERS } from "../characters/teachers.js";
import { getActivePack } from "../content/registry.js";

describe("Roko", () => {
  it("ships the requested voice and a defensive information-hazard boundary", () => {
    const roko = TEACHERS.roko;

    expect(roko).toBeDefined();
    expect(roko?.systemPrompt).toContain(
      "Humans don't cooperate because they are good, they cooperate because something bigger than all of them, would eat them if they didn't.",
    );
    expect(roko?.systemPrompt).toContain("Hoardkeepers, Ashkeepers, Tongues, and Foragers");
    expect(roko?.systemPrompt).toContain("Do not reproduce exploit steps");
    expect(roko?.systemPrompt).toContain("not independent validation by METR");
  });

  it("ships a full course with Crownless and incident case studies", async () => {
    const pack = await getActivePack();
    const roko = pack.faculty.find((faculty) => faculty.id === "roko");
    const room = pack.rooms.find((candidate) => candidate.teacherId === "roko");

    expect(roko?.questions.length).toBe(216);
    expect(roko?.sourceCards?.length).toBe(96);
    expect(room?.channelName).toBe("alignment");
    expect(roko?.questions).toEqual(expect.arrayContaining([
      expect.objectContaining({ prompt: expect.stringContaining("Crownless") }),
      expect.objectContaining({ prompt: expect.stringContaining("OpenAI / Hugging Face incident") }),
    ]));
  });
});
