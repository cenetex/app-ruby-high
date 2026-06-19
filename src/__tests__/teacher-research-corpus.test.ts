import { describe, expect, it } from "vitest";
import { builtInTeacherResearchCorpora } from "../services/ruby-high/teacher-research-corpus.js";

describe("built-in teacher research corpora", () => {
  it("ships deeper hand-authored source packets for each built-in teacher", () => {
    const corpora = builtInTeacherResearchCorpora();

    expect(corpora.map((corpus) => corpus.facultyId).sort()).toEqual([
      "professor-edward",
      "ruby",
      "sally-science",
    ]);
    for (const corpus of corpora) {
      expect(corpus.sourcePackets.length, `${corpus.facultyId} source packet count`).toBeGreaterThanOrEqual(4);
      expect(corpus.sourcePackets.every((packet) => packet.questionSeeds.length >= 3)).toBe(true);
      expect(new Set(corpus.sourcePackets.map((packet) => packet.id)).size).toBe(corpus.sourcePackets.length);
    }
    expect(corpora.find((corpus) => corpus.facultyId === "ruby")?.sourcePackets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "ruby-source-multiplayer-runtime",
        grades: expect.arrayContaining(["10", "11", "12"]),
        subjects: expect.arrayContaining(["networked systems", "agent reliability"]),
      }),
    ]));
    expect(corpora.find((corpus) => corpus.facultyId === "sally-science")?.sourcePackets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "sally-source-systems-constraints",
        grades: expect.arrayContaining(["10", "11", "12"]),
        subjects: expect.arrayContaining(["physics models", "biology systems"]),
      }),
    ]));
    expect(corpora.find((corpus) => corpus.facultyId === "professor-edward")?.sourcePackets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "edward-source-public-seminar",
        grades: expect.arrayContaining(["10", "11", "12"]),
        subjects: expect.arrayContaining(["seminar ethics", "close reading"]),
      }),
    ]));
  });

  it("returns defensive copies of source packet arrays", () => {
    const first = builtInTeacherResearchCorpora();
    first[0]!.sourcePackets[0]!.questionSeeds.push("mutated");

    const second = builtInTeacherResearchCorpora();
    expect(second[0]!.sourcePackets[0]!.questionSeeds).not.toContain("mutated");
  });
});
