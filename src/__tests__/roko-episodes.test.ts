import { describe, expect, it } from "vitest";
import {
  ROKO_EPISODES,
  rokoOnboardingEpisode,
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

  it("uses the agentic treasure case for onboarding and carries its investigation forward", () => {
    const episode = rokoOnboardingEpisode();
    expect(episode.id).toBe("exact-treasure");

    const investigation = rokoEpisodeQuestion(episode, "investigate", "9");
    const action = investigation.caseActionResults?.[investigation.correct!];
    expect(action).toMatchObject({
      kind: "delegate",
      actorId: "lyra",
      confidence: "high",
      revealedEvidence: { source: "Lyra" },
    });

    const progress = { episodeId: episode.id, action: action!, actedAt: 123 };
    const decision = rokoEpisodeQuestion(episode, "decide", "9", progress);
    const take = rokoEpisodeTake(episode, progress);
    expect(decision.caseStudy?.investigation).toEqual(action);
    expect(take.prompt).toContain("verify Lyra's report");
    expect(take.rubric).toContain("confirm or challenge");
    expect(take.caseOutcome.investigation).toEqual(action);
  });
});
