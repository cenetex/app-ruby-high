import { describe, expect, it } from "vitest";
import {
  constructedResponseClaimsForState,
  constructedResponseText,
  parseConstructedResponseSelection,
} from "../services/constructed-response.js";
import type { QuizState } from "../types.js";

describe("constructed response cards", () => {
  it("accepts one known option from every step and builds connected grading text", () => {
    const selection = parseConstructedResponseSelection({
      claimId: "q-2:200",
      stance: "conditional",
      evidence: "source",
      impact: "systems",
    });

    expect(selection).toEqual({
      claimId: "q-2:200",
      stance: "conditional",
      evidence: "source",
      impact: "systems",
    });
    expect(constructedResponseText(selection!, {
      id: "q-2:200",
      prompt: "Which policy changed the system?",
      answer: "The open access rule",
    })).toBe(
      "Whether “The open access rule” holds depends on the context and who is affected. "
      + "I would check the source and look for missing evidence, then judge it by the wider system and its rules.",
    );
  });

  it("rejects missing or unknown player values", () => {
    expect(parseConstructedResponseSelection(null)).toBeNull();
    expect(parseConstructedResponseSelection({ claimId: "q-1:100", stance: "support", evidence: "source" })).toBeNull();
    expect(parseConstructedResponseSelection({
      claimId: "q-1:100",
      stance: "my private prose",
      evidence: "source",
      impact: "people",
    })).toBeNull();
  });

  it("shows the two authored choices from today's class and excludes typed answers", () => {
    const state = {
      faculty: "sally-science",
      activeRound: {
        classSession: { mode: "class", facultyId: "sally-science", date: "2026-08-29" },
      },
      history: [
        {
          questionId: "old",
          faculty: "sally-science",
          picked: "A",
          correct: "A",
          wasCorrect: true,
          at: 50,
          questionPrompt: "Old question",
          answerText: "Old answer",
          answerKind: "choice",
          classMode: "class",
          classDate: "2026-08-28",
        },
        {
          questionId: "q-1",
          faculty: "sally-science",
          picked: "B",
          correct: "A",
          wasCorrect: false,
          at: 100,
          questionPrompt: "What made the result change?",
          answerText: "A larger sample",
          answerKind: "choice",
          classMode: "class",
          classDate: "2026-08-29",
        },
        {
          questionId: "private",
          faculty: "sally-science",
          picked: "A",
          correct: "A",
          wasCorrect: true,
          at: 150,
          questionPrompt: "Write a reflection",
          answerText: "player-written text",
          answerKind: "typed",
          classMode: "class",
          classDate: "2026-08-29",
        },
        {
          questionId: "q-2",
          faculty: "sally-science",
          picked: "C",
          correct: "C",
          wasCorrect: true,
          at: 200,
          questionPrompt: "Which evidence is strongest?",
          answerText: "The repeated trial",
          answerKind: "choice",
          classMode: "class",
          classDate: "2026-08-29",
        },
      ],
    } as QuizState;

    expect(constructedResponseClaimsForState(state)).toEqual([
      { id: "q-1:100", prompt: "What made the result change?", answer: "A larger sample" },
      { id: "q-2:200", prompt: "Which evidence is strongest?", answer: "The repeated trial" },
    ]);
  });

  it("uses completed Roko route events instead of unrelated choice history", () => {
    const state = {
      faculty: "roko",
      current: {
        type: "opinion",
        caseStudy: {
          episodeId: "sealed-note",
          priorChoices: [
            {
              choiceId: "first-room",
              stage: "investigate",
              choiceLabel: "HEAD · Study the mechanism",
              lockedText: "The ward map can be checked.",
              event: {
                eventId: "map-audited",
                label: "The repair route becomes verifiable",
                detail: "Ward keepers can now test the proposed repair against the seal.",
              },
              reflection: "Verification makes the repair possible.",
              roomCompleted: true,
            },
            {
              choiceId: "open-passage",
              stage: "navigate",
              choiceLabel: "go market-square",
              lockedText: "The route stays open.",
              event: {
                eventId: "passage-opened",
                label: "You reach the market square",
                detail: "Moving rooms did not settle the evidence.",
              },
              reflection: "Movement is not a conclusion.",
              roomCompleted: false,
            },
            {
              choiceId: "final-room",
              stage: "navigate",
              choiceLabel: "HONOR · Make or defend a rule",
              lockedText: "The full map stays controlled.",
              event: {
                eventId: "release-limited",
                label: "The ward keepers receive a limited copy",
                detail: "The repair team gets enough detail without posting the exploit publicly.",
              },
              reflection: "Access can be limited without hiding the repair.",
              roomCompleted: true,
            },
          ],
        },
      },
      history: [{
        questionId: "old-roko-quiz",
        faculty: "roko",
        picked: "A",
        correct: "A",
        wasCorrect: true,
        at: 50,
        questionPrompt: "What is an old alignment term?",
        answerText: "An old quiz answer",
        answerKind: "choice",
      }],
    } as unknown as QuizState;

    expect(constructedResponseClaimsForState(state)).toEqual([
      {
        id: "case:sealed-note:first-room",
        prompt: "HEAD · Study the mechanism — Ward keepers can now test the proposed repair against the seal.",
        answer: "The repair route becomes verifiable",
      },
      {
        id: "case:sealed-note:final-room",
        prompt: "HONOR · Make or defend a rule — The repair team gets enough detail without posting the exploit publicly.",
        answer: "The ward keepers receive a limited copy",
      },
    ]);
  });
});
