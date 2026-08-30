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

  it("turns one episode into two ungraded branches and a graded update", () => {
    const episode = ROKO_EPISODES[0]!;
    const investigation = rokoEpisodeQuestion(episode, "investigate", "10");
    const decision = rokoEpisodeQuestion(episode, "decide", "10");
    const take = rokoEpisodeTake(episode);

    expect(investigation).toMatchObject({
      type: "story-choice",
      faculty: "roko",
      caseStudy: { episodeId: episode.id, stage: "investigate" },
    });
    expect(decision).toMatchObject({
      type: "story-choice",
      caseStudy: { episodeId: episode.id, stage: "decide" },
    });
    expect(investigation.correct).toBeUndefined();
    expect(investigation.storyChoices).toHaveLength(4);
    expect(Object.keys(investigation.storyChoiceResults ?? {})).toHaveLength(4);
    expect(decision.correct).toBeUndefined();
    expect(take).toMatchObject({
      caseStudy: { episodeId: episode.id, stage: "explain" },
      caseOutcome: { episodeId: episode.id, title: episode.title },
    });
  });

  it("uses the basilisk adventure for onboarding and carries delayed results forward", () => {
    const episode = rokoOnboardingEpisode();
    expect(episode.id).toBe("basilisk-archive");

    const investigation = rokoEpisodeQuestion(episode, "investigate", "9");
    const picked = investigation.storyChoices![0]!;
    const branch = investigation.storyChoiceResults?.[picked];
    expect(branch).toMatchObject({
      choiceId: "restricted-review",
      stage: "investigate",
      delayedLabel: "Forty-eight hours later",
    });

    const progress = { episodeId: episode.id, choices: [branch!], actedAt: 123 };
    const decision = rokoEpisodeQuestion(episode, "decide", "9", progress);
    const take = rokoEpisodeTake(episode, progress);
    expect(decision.caseStudy?.priorChoices).toEqual([branch]);
    expect(decision.caseStudy?.scene).toContain("Two days pass");
    expect(decision.caseStudy?.sources?.some((source) => source.url.includes("lesswrong.com"))).toBe(true);
    expect(take.prompt).toContain(picked);
    expect(take.rubric).toContain("whole path");
    expect(take.caseOutcome.choices).toEqual([branch]);
  });
});
