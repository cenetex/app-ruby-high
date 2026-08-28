import { describe, expect, it } from "vitest";
import {
  ROKO_EPISODES,
  rokoEpisodeForClass,
  rokoEpisodeQuestion,
  rokoEpisodeTake,
} from "../content/roko-episodes.js";

describe("Roko case episodes", () => {
  it("ships a varied, deterministic authored episode set", () => {
    expect(ROKO_EPISODES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(ROKO_EPISODES.map((episode) => episode.id)).size).toBe(ROKO_EPISODES.length);
    expect(rokoEpisodeForClass("2026-08-28", "10")).toEqual(rokoEpisodeForClass("2026-08-28", "10"));
    expect(ROKO_EPISODES.some((episode) => episode.scene.toLowerCase().includes("goblin"))).toBe(true);
  });

  it("turns one episode into investigate, decide, and explain cards", () => {
    const episode = ROKO_EPISODES[0]!;
    const investigation = rokoEpisodeQuestion(episode, "investigate", "10");
    const decision = rokoEpisodeQuestion(episode, "decide", "10");
    const take = rokoEpisodeTake(episode);

    expect(investigation).toMatchObject({
      type: "multiple-choice",
      faculty: "roko",
      caseStudy: { episodeId: episode.id, stage: "investigate" },
    });
    expect(decision).toMatchObject({
      type: "multiple-choice",
      caseStudy: { episodeId: episode.id, stage: "decide" },
    });
    expect(decision.answerConsequences?.[decision.correct!]).toBeTruthy();
    expect(take).toMatchObject({
      caseStudy: { episodeId: episode.id, stage: "explain" },
      caseOutcome: { episodeId: episode.id, title: episode.title },
    });
  });
});
