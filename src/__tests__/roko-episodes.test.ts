import { describe, expect, it } from "vitest";
import {
  ROKO_EPISODES,
  rokoAssignmentCount,
  rokoOnboardingEpisode,
  rokoEpisodeAssignment,
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

  it("turns a legacy episode into two ungraded event branches and a graded return", () => {
    const episode = ROKO_EPISODES[1]!;
    const investigation = rokoEpisodeQuestion(episode, "investigate", "10");
    const firstBranch = investigation.storyChoiceResults![investigation.storyChoices![0]!]!;
    const progress = { episodeId: episode.id, choices: [firstBranch], actedAt: 1 };
    const decision = rokoEpisodeQuestion(episode, "decide", "10", progress);
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

  it("uses an event-driven 64-route basilisk labyrinth for onboarding", () => {
    const episode = rokoOnboardingEpisode();
    expect(episode.id).toBe("basilisk-archive");
    expect(rokoAssignmentCount(episode)).toBe(3);
    expect(episode.assignmentGraph?.nodes).toHaveLength(9);

    const investigation = rokoEpisodeAssignment(episode, "9")!;
    const picked = investigation.storyChoices![0]!;
    const branch = investigation.storyChoiceResults?.[picked];
    expect(branch).toMatchObject({
      choiceId: "restricted-review",
      stage: "investigate",
      nodeId: "hall-of-four-doors",
      nextNodeId: "sealed-reading-cell",
      event: { eventId: "review-circle-convened" },
    });
    expect(investigation.caseStudy).toMatchObject({
      tour: {
        backgroundAsset: expect.stringContaining("roko-labyrinth-hall.webp"),
        guideAsset: expect.stringContaining("roko-full-sticker.png"),
        discussion: expect.arrayContaining([
          expect.objectContaining({ speakerName: "Roko", text: expect.any(String) }),
          expect.objectContaining({ speakerName: expect.stringContaining("goblin"), text: expect.any(String) }),
        ]),
      },
      passages: expect.arrayContaining([
        expect.objectContaining({ choiceId: "restricted-review", destination: "Sealed Reading Cell", gateId: "three-hand-archive-door" }),
      ]),
      sharedGate: {
        gatedChoiceId: "restricted-review",
        roles: expect.arrayContaining([
          expect.objectContaining({ id: "witness" }),
          expect.objectContaining({ id: "skeptic" }),
          expect.objectContaining({ id: "steward" }),
        ]),
      },
    });

    const progress = {
      episodeId: episode.id,
      choices: [branch!],
      currentNodeId: branch!.nextNodeId,
      visitedNodeIds: [branch!.nodeId!],
      events: [branch!.event],
      actedAt: 123,
    };
    const decision = rokoEpisodeAssignment(episode, "9", progress)!;
    expect(decision.caseStudy?.priorChoices).toEqual([branch]);
    expect(decision.caseStudy).toMatchObject({
      nodeId: "sealed-reading-cell",
      nodeTitle: "Sealed Reading Cell",
      storyFunction: "challenge",
      route: [
        { nodeId: "hall-of-four-doors" },
        { nodeId: "sealed-reading-cell" },
      ],
    });
    expect(decision.caseStudy?.sources?.some((source) => source.url.includes("lesswrong.com"))).toBe(true);
    expect(decision.caseStudy?.sources?.some((source) => source.url.includes("metr.org"))).toBe(true);
    const secondBranch = decision.storyChoiceResults![decision.storyChoices![0]!]!;
    expect(secondBranch.nextNodeId).toBe("evidence-well");
    const secondProgress = {
      ...progress,
      choices: [branch!, secondBranch],
      currentNodeId: secondBranch.nextNodeId,
      visitedNodeIds: [branch!.nodeId!, secondBranch.nodeId!],
      events: [branch!.event, secondBranch.event],
    };
    const navigate = rokoEpisodeAssignment(episode, "9", secondProgress)!;
    expect(navigate.caseStudy).toMatchObject({
      stage: "navigate",
      nodeId: "evidence-well",
      storyFunction: "discover",
    });
    const finalBranch = navigate.storyChoiceResults![navigate.storyChoices![0]!]!;
    expect(finalBranch.nextNodeId).toBeUndefined();
    const finalProgress = {
      ...secondProgress,
      choices: [branch!, secondBranch, finalBranch],
      currentNodeId: null,
      visitedNodeIds: [branch!.nodeId!, secondBranch.nodeId!, finalBranch.nodeId!],
      events: [branch!.event, secondBranch.event, finalBranch.event],
    };
    expect(rokoEpisodeAssignment(episode, "9", finalProgress)).toBeNull();
    const take = rokoEpisodeTake(episode, finalProgress);
    expect(take.prompt).toContain(picked);
    expect(take.prompt).toContain(branch!.event.label);
    expect(take.rubric).toContain("whole route");
    expect(take.caseOutcome.choices).toHaveLength(3);
    expect(take.caseStudy).toMatchObject({ storyFunction: "return", nodeTitle: "Council Chamber" });

    const routes = episode.assignmentGraph!.nodes
      .filter((node) => node.id === episode.assignmentGraph!.entryNodeId)
      .flatMap((entry) => entry.choices)
      .flatMap((first) => episode.assignmentGraph!.nodes.find((node) => node.id === first.nextNodeId)!.choices)
      .flatMap((second) => episode.assignmentGraph!.nodes.find((node) => node.id === second.nextNodeId)!.choices);
    expect(routes).toHaveLength(64);
  });
});
