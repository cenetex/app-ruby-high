import { describe, expect, it } from "vitest";
import {
  ROKO_EPISODES,
  rokoAssignmentCount,
  rokoOnboardingEpisode,
  rokoEpisodeAssignment,
  rokoEpisodeForClass,
  rokoEpisodeQuestion,
  rokoEpisodeTake,
  resolveRokoLabyrinthAction,
} from "../content/roko-episodes.js";
import type { CaseStudyProgress } from "../types.js";

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

  it("uses attribute moves, free navigation, and three completed rooms for the basilisk labyrinth", () => {
    const episode = rokoOnboardingEpisode();
    expect(episode.id).toBe("basilisk-archive");
    expect(rokoAssignmentCount(episode)).toBe(3);
    expect(episode.assignmentGraph?.nodes).toHaveLength(9);
    expect(episode.assignmentGraph?.interactionMode).toBe("osr");

    const investigation = rokoEpisodeAssignment(episode, "9")!;
    expect(investigation).toMatchObject({
      type: "story-action",
      caseStudy: {
        nodeId: "hall-of-four-doors",
        labyrinth: { completedRooms: 0, requiredRooms: 3, requiredHumans: 1 },
      },
    });
    expect(investigation.storyChoices).toBeUndefined();
    expect(investigation.caseStudy).toMatchObject({
      tour: {
        backgroundAsset: expect.stringContaining("roko-labyrinth-hall.webp"),
        guideAsset: expect.stringContaining("roko-full-sticker.png"),
        discussion: expect.arrayContaining([
          expect.objectContaining({ speakerName: "Roko", text: expect.any(String) }),
          expect.objectContaining({ speakerName: expect.stringContaining("goblin"), text: expect.any(String) }),
        ]),
      },
    });
    const sources = investigation.caseStudy!.sources ?? [];
    expect(sources.some((source) => source.url.includes("lesswrong.com"))).toBe(true);
    expect(sources.some((source) => source.url.includes("nickbostrom.com"))).toBe(true);
    expect(sources.some((source) => source.url.includes("metr.org"))).toBe(true);

    let progress: CaseStudyProgress = {
      episodeId: episode.id,
      choices: [],
      currentNodeId: "hall-of-four-doors",
      visitedNodeIds: [],
      events: [],
      actedAt: 1,
    };
    const apply = (command: string, presentHumans = 1, collaboratorRoles: string[] = []) => {
      const resolution = resolveRokoLabyrinthAction(episode, progress, command, { presentHumans, collaboratorRoles });
      progress = {
        ...progress,
        choices: [...progress.choices, resolution.result],
        currentNodeId: resolution.currentNodeId,
        visitedNodeIds: [...new Set([...(progress.visitedNodeIds ?? []), resolution.result.nodeId!, ...(resolution.currentNodeId ? [resolution.currentNodeId] : [])])],
        events: [...(progress.events ?? []), resolution.result.event],
        labyrinth: resolution.labyrinth,
      };
      return resolution;
    };

    const head = apply("head");
    expect(head).toMatchObject({ roomCompleted: true, labyrinth: { completedNodeIds: ["hall-of-four-doors"] } });
    const nextRoom = head.currentNodeId!;
    const move = apply("go hall-of-four-doors");
    expect(move).toMatchObject({ roomCompleted: false, currentNodeId: "hall-of-four-doors" });
    expect(move.labyrinth.completedNodeIds).toEqual(["hall-of-four-doors"]);
    apply(`go ${nextRoom}`);
    const second = apply("heart", 4);
    expect(second.roomCompleted).toBe(true);
    const third = apply("hustle", 4, ["evidence", "care", "dissent"]);
    expect(third).toMatchObject({ roomCompleted: true, currentNodeId: null });
    expect(third.labyrinth.completedNodeIds).toHaveLength(3);
    expect(rokoEpisodeAssignment(episode, "9", progress)).toBeNull();

    const take = rokoEpisodeTake(episode, progress);
    expect(take.prompt).toContain("HEAD · Study the mechanism");
    expect(take.rubric).toContain("whole route");
    expect(take.caseOutcome.choices?.length).toBeGreaterThanOrEqual(3);
    expect(take.caseStudy).toMatchObject({ storyFunction: "return", nodeTitle: "Council Chamber" });
  });

  it("turns an under-filled optional room into an asynchronous handprint", () => {
    const episode = rokoOnboardingEpisode();
    const progress: CaseStudyProgress = {
      episodeId: episode.id,
      choices: [],
      currentNodeId: "mirror-gallery",
      visitedNodeIds: ["mirror-gallery"],
      events: [],
      actedAt: 1,
    };
    const blocked = resolveRokoLabyrinthAction(episode, progress, "honor", { presentHumans: 1 });
    expect(blocked).toMatchObject({
      roomCompleted: false,
      currentNodeId: "mirror-gallery",
      labyrinth: { contributions: [{ nodeId: "mirror-gallery", role: "dissent" }] },
    });
    expect(blocked.result.event.detail).toContain("needs 1 more distinct human role");
  });
});
