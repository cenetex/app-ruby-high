import { describe, expect, it } from "vitest";
import { raceStripPickText, raceStripView } from "../viewer-parts/client-pure.js";

const students = [
  { id: "lyra", name: "Lyra", color: "#ff6f91" },
  { id: "sami", shortName: "Sam", name: "Sami", color: "#36c2cc" },
  { id: "ravi", name: "Ravi", color: "#ffb05a" },
];

describe("viewer race strip pure helpers", () => {
  it("returns null when the active round does not match the current question", () => {
    expect(raceStripView({
      current: { id: "q-live" },
      active_round: { questionId: "q-other", remainingMs: 9000, player: {} },
    }, students, ["lyra"], "Mina")).toBeNull();
  });

  it("builds live race timer and participant cards without reveal classes", () => {
    const view = raceStripView({
      current: { id: "q-live" },
      active_round: {
        questionId: "q-live",
        remainingMs: 6200,
        resolved: false,
        firstCorrect: "lyra",
        player: { isLocked: true, picked: "A" },
        npcs: [
          { studentId: "lyra", isLocked: false, pick: null, isCorrect: true },
          { studentId: "ravi", isLocked: true, pick: "B", isCorrect: false },
        ],
      },
      lastReveal: { correct: "A" },
    }, students, ["lyra"], "Mina");

    expect(view?.timer).toEqual({ label: "7s", warn: true, danger: false, locked: false });
    expect(view?.cards).toEqual([
      {
        kind: "player",
        id: "player",
        name: "Mina",
        avatarText: "U",
        color: "var(--accent)",
        isLocked: true,
        isTimedOut: false,
        isCorrect: null,
        isFirstCorrect: false,
        pickText: "✓",
        showThinking: false,
      },
      {
        kind: "student",
        id: "lyra",
        name: "Lyra",
        avatarText: "L",
        color: "#ff6f91",
        isLocked: false,
        isTimedOut: false,
        isCorrect: null,
        isFirstCorrect: false,
        pickText: "",
        showThinking: true,
      },
    ]);
  });

  it("shows an open soft timer after the idle window without timing out the player", () => {
    const view = raceStripView({
      current: { id: "q-live" },
      active_round: {
        questionId: "q-live",
        remainingMs: 0,
        idleTriggered: true,
        resolved: false,
        player: { isLocked: false, picked: null, timedOut: false },
        npcs: [
          { studentId: "lyra", isLocked: true, pick: "A", isCorrect: null },
        ],
      },
      lastReveal: null,
    }, students, ["lyra"], "Mina");

    expect(view?.timer).toEqual({ label: "open", warn: false, danger: false, locked: false, soft: true });
    expect(view?.cards[0]).toMatchObject({
      id: "player",
      isLocked: false,
      isTimedOut: false,
      pickText: "",
      showThinking: true,
    });
    expect(view?.cards[1]).toMatchObject({
      id: "lyra",
      isLocked: true,
      pickText: "✓",
      showThinking: false,
    });
  });

  it("builds resolved race cards with pick, correctness, and timeout display", () => {
    const view = raceStripView({
      current: { id: "q-live" },
      active_round: {
        questionId: "q-live",
        remainingMs: 0,
        resolved: true,
        firstCorrect: "sami",
        player: { isLocked: true, picked: null, timedOut: true },
        npcs: [
          { studentId: "sami", isLocked: true, pick: "C", isCorrect: true },
          { studentId: "unknown", isLocked: true, pick: "A", isCorrect: false },
        ],
      },
      lastReveal: { correct: "C" },
    }, students, ["sami", "unknown"], "You");

    expect(view?.timer).toEqual({ label: "done", warn: false, danger: false, locked: true });
    expect(view?.cards.map((card) => ({
      id: card.id,
      name: card.name,
      color: card.color,
      pickText: card.pickText,
      isCorrect: card.isCorrect,
      isFirstCorrect: card.isFirstCorrect,
      isTimedOut: card.isTimedOut,
    }))).toEqual([
      { id: "player", name: "You", color: "var(--accent)", pickText: "⏱", isCorrect: null, isFirstCorrect: false, isTimedOut: true },
      { id: "sami", name: "Sam", color: "#36c2cc", pickText: "C", isCorrect: true, isFirstCorrect: true, isTimedOut: false },
      { id: "unknown", name: "unknown", color: "#888", pickText: "A", isCorrect: false, isFirstCorrect: false, isTimedOut: false },
    ]);
  });

  it("shows story branches without winner or correctness styling", () => {
    const view = raceStripView({
      current: { id: "q-story" },
      active_round: {
        type: "story-choice",
        questionId: "q-story",
        remainingMs: 0,
        resolved: true,
        firstCorrect: null,
        player: { isLocked: true, picked: "B", timedOut: false },
        npcs: [{ studentId: "lyra", isLocked: true, pick: "C", isCorrect: null }],
      },
      lastReveal: { correct: "B", questionType: "story-choice" },
    }, students, ["lyra"], "Mina");

    expect(view?.cards.map((card) => ({
      id: card.id,
      pickText: card.pickText,
      isCorrect: card.isCorrect,
      isFirstCorrect: card.isFirstCorrect,
    }))).toEqual([
      { id: "player", pickText: "B", isCorrect: null, isFirstCorrect: false },
      { id: "lyra", pickText: "C", isCorrect: null, isFirstCorrect: false },
    ]);
  });

  it("formats race pick badges from lock and reveal state", () => {
    expect(raceStripPickText("A", false, false, false)).toBe("");
    expect(raceStripPickText("A", true, false, false)).toBe("✓");
    expect(raceStripPickText("B", true, false, true)).toBe("B");
    expect(raceStripPickText("", true, true, true)).toBe("⏱");
  });
});
