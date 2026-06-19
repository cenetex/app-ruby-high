import { describe, expect, it } from "vitest";
import { validateCurriculumCandidateQuestions } from "../services/ruby-high/curriculum-candidate-validation.js";
import type { BankedQuestion } from "../types.js";

function candidate(input: Partial<BankedQuestion> = {}): BankedQuestion {
  return {
    id: "draft-ruby-1",
    type: "multiple-choice",
    prompt: "Which habit helps Ruby prevent repetition before a weak pool turns stale?",
    options: {
      A: "Checking coverage before generating more questions",
      B: "Reusing the same prompt with different punctuation",
      C: "Removing source cards from the review draft",
      D: "Ignoring minGrade until after publishing",
    },
    correct: "A",
    explanation: "Coverage checks reveal weak pools before the same idea repeats across the class.",
    subject: "ai-literacy",
    stat: "head",
    difficulty: "easy",
    faculty: "ruby",
    minGrade: "10",
    ...input,
  };
}

describe("curriculum candidate validation", () => {
  it("accepts reviewed multiple-choice candidates that match the target teacher and grade", () => {
    expect(validateCurriculumCandidateQuestions({
      facultyId: "ruby",
      targetMinGrade: "10",
      questions: [candidate()],
      existingQuestions: [],
    })).toEqual({ ok: true, errors: [] });
  });

  it("rejects duplicate prompts against existing and draft candidates", () => {
    const result = validateCurriculumCandidateQuestions({
      facultyId: "ruby",
      targetMinGrade: "10",
      questions: [
        candidate({ id: "draft-ruby-1" }),
        candidate({ id: "draft-ruby-2", prompt: "Which habit helps Ruby prevent repetition before a weak pool turns stale?" }),
      ],
      existingQuestions: [
        candidate({
          id: "ruby-existing-1",
          prompt: "Why should curriculum generation check coverage before writing?",
        }),
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("candidate draft-ruby-2: duplicates draft question draft-ruby-1");
  });

  it("rejects malformed generated candidates before promotion", () => {
    const result = validateCurriculumCandidateQuestions({
      facultyId: "ruby",
      targetMinGrade: "10",
      questions: [
        candidate({
          prompt: "This is not finished",
          options: {
            A: "All of the above",
            B: "A repeated option",
            C: "A repeated option",
            D: "",
          },
          correct: "Z" as BankedQuestion["correct"],
          explanation: "",
          stat: "luck" as BankedQuestion["stat"],
          minGrade: "12",
        }),
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "candidate draft-ruby-1: prompt should end as a complete sentence/question",
      "candidate draft-ruby-1: minGrade=12, expected 10",
      "candidate draft-ruby-1: invalid stat luck",
      "candidate draft-ruby-1: invalid correct choice Z",
      "candidate draft-ruby-1: options.A uses meta-answer wording",
      "candidate draft-ruby-1: duplicate option text: A repeated option",
      "candidate draft-ruby-1: options.D missing",
      "candidate draft-ruby-1: explanation missing",
    ]));
  });
});
