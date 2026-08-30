import { describe, expect, it } from "vitest";
import { detectGenericPraise, offlineOpinionContentScore, parseTeacherGrades } from "../grading.js";

describe("offlineOpinionContentScore", () => {
  const question = "When a classmate answers confidently, what should you trust and what should you check?";
  const rubric = "Names one concrete trust signal and one concrete reason to verify.";

  it("passes a concise, relevant answer with evidence and a verification step", () => {
    expect(offlineOpinionContentScore({
      question,
      rubric,
      response: "I trust a clear trail of evidence and check the source behind the confidence.",
    })).toBeGreaterThanOrEqual(7.5);
  });

  it("does not pass a non-answer", () => {
    expect(offlineOpinionContentScore({ question, rubric, response: "I don't know." })).toBeLessThan(7);
  });
});

describe("parseTeacherGrades", () => {
  it("parses a well-formed teacher response", () => {
    const text = [
      "GRADE responder=player score=8 comment=measured, even where the second sentence wobbles",
      "GRADE responder=lyra score=6 comment=anxious in your prose; ease up",
      "GRADE responder=sami score=7 comment=dry but actually thinking",
      "BEST: player",
      "",
      "Honor — measured, even where the second sentence wobbles. Lyra,",
      "you're still over-correcting. Sami, give yourself permission to commit.",
    ].join("\n");
    const r = parseTeacherGrades(text);
    expect(r.grades).toHaveLength(3);
    expect(r.grades[0]).toEqual({
      responder: "player",
      score: 8,
      comment: "measured, even where the second sentence wobbles",
    });
    expect(r.grades[1]?.responder).toBe("lyra");
    expect(r.grades[2]?.responder).toBe("sami");
    expect(r.bestResponder).toBe("player");
    expect(r.narrativeText).toContain("Honor —");
    expect(r.narrativeText).toContain("Sami, give yourself permission");
    // Narrative should NOT contain the GRADE / BEST lines.
    expect(r.narrativeText).not.toContain("GRADE");
    expect(r.narrativeText).not.toContain("BEST:");
  });

  it("extracts the AI-built player response without leaking it into teacher narration", () => {
    const text = [
      "PLAYER_RESPONSE: I would challenge the claim because the source is unclear. I would compare examples, then judge the effect on people.",
      "GRADE responder=player score=8 comment=the source check makes the challenge concrete",
      "BEST: player",
      "That source check is the part worth keeping.",
    ].join("\n");
    const result = parseTeacherGrades(text);

    expect(result.playerResponse).toBe(
      "I would challenge the claim because the source is unclear. I would compare examples, then judge the effect on people.",
    );
    expect(result.narrativeText).toBe("That source check is the part worth keeping.");
  });

  it("clamps scores to [0, 10]", () => {
    const text = [
      "GRADE responder=a score=15 comment=overshoot",
      "GRADE responder=b score=-3 comment=undershoot",
      "GRADE responder=c score=10 comment=ceiling exact",
      "GRADE responder=d score=0 comment=floor exact",
    ].join("\n");
    const r = parseTeacherGrades(text);
    expect(r.grades.map((g) => g.score)).toEqual([10, 0, 10, 0]);
  });

  it("preserves decimal scores", () => {
    const text = "GRADE responder=player score=7.5 comment=close";
    const r = parseTeacherGrades(text);
    expect(r.grades[0]?.score).toBe(7.5);
  });

  it("is case-insensitive on the GRADE/BEST keywords", () => {
    const text = [
      "grade responder=alice score=8 comment=fine",
      "Grade Responder=bob Score=9 Comment=ok",
      "best: alice",
    ].join("\n");
    const r = parseTeacherGrades(text);
    expect(r.grades).toHaveLength(2);
    expect(r.grades[0]?.responder).toBe("alice");
    expect(r.grades[1]?.responder).toBe("bob");
    expect(r.bestResponder).toBe("alice");
  });

  it("returns nulls/empties for an empty input", () => {
    expect(parseTeacherGrades("")).toEqual({ grades: [], bestResponder: null, narrativeText: "" });
  });

  it("returns nulls/empties for a non-string input (defensive)", () => {
    // @ts-expect-error — the runtime guard is intentional.
    expect(parseTeacherGrades(null)).toEqual({ grades: [], bestResponder: null, narrativeText: "" });
    // @ts-expect-error
    expect(parseTeacherGrades(undefined)).toEqual({ grades: [], bestResponder: null, narrativeText: "" });
  });

  it("captures comments containing equals signs and commas verbatim", () => {
    const text = "GRADE responder=alice score=7 comment=x = y, plus also z";
    const r = parseTeacherGrades(text);
    expect(r.grades[0]?.comment).toBe("x = y, plus also z");
  });

  it("treats lines with no GRADE/BEST as narrative", () => {
    const text = [
      "Class — settle down.",
      "GRADE responder=alice score=8 comment=fine",
      "Two more minutes on the next one.",
      "BEST: alice",
      "Pencils up.",
    ].join("\n");
    const r = parseTeacherGrades(text);
    expect(r.grades).toHaveLength(1);
    expect(r.bestResponder).toBe("alice");
    expect(r.narrativeText).toBe(["Class — settle down.", "Two more minutes on the next one.", "Pencils up."].join("\n"));
  });

  it("first BEST: line wins; subsequent ones are ignored", () => {
    const text = [
      "BEST: alice",
      "BEST: bob",
      "BEST: charlie",
    ].join("\n");
    const r = parseTeacherGrades(text);
    expect(r.bestResponder).toBe("alice");
  });

  it("missing BEST line leaves bestResponder null", () => {
    const text = "GRADE responder=alice score=8 comment=ok";
    const r = parseTeacherGrades(text);
    expect(r.bestResponder).toBeNull();
  });

  it("preserves grade order even when interleaved with narrative", () => {
    const text = [
      "Settling in.",
      "GRADE responder=z score=1 comment=last",
      "GRADE responder=a score=10 comment=first",
      "GRADE responder=m score=5 comment=middle",
    ].join("\n");
    const r = parseTeacherGrades(text);
    expect(r.grades.map((g) => g.responder)).toEqual(["z", "a", "m"]);
  });

  it("tolerates hyphenated responder ids (e.g., professor-edward)", () => {
    const text = "GRADE responder=professor-edward score=9 comment=he carries the room";
    const r = parseTeacherGrades(text);
    expect(r.grades[0]?.responder).toBe("professor-edward");
  });

  it("ignores GRADE lines missing required fields", () => {
    const text = [
      "GRADE score=8 responder=missing-comment",  // no comment=
      "GRADE responder=alice score=NaN comment=invalid score",  // not a number
      "GRADE responder=valid score=7 comment=valid",
    ].join("\n");
    const r = parseTeacherGrades(text);
    // Only the well-formed line should make it through. Malformed lines
    // fall through to the narrative bucket.
    expect(r.grades).toHaveLength(1);
    expect(r.grades[0]?.responder).toBe("valid");
  });

  it("treats trailing whitespace and CRLF line endings consistently", () => {
    const text = "GRADE responder=alice score=8 comment=ok\r\nBEST: alice\r\n";
    const r = parseTeacherGrades(text);
    expect(r.grades).toHaveLength(1);
    expect(r.bestResponder).toBe("alice");
  });

  it("trims comment whitespace", () => {
    const text = "GRADE responder=alice score=8 comment=   leading and trailing spaces   ";
    const r = parseTeacherGrades(text);
    expect(r.grades[0]?.comment).toBe("leading and trailing spaces");
  });

  it("returns trimmed narrative even when only narrative is present", () => {
    const text = "\n\n  Just commentary, no grades at all.  \n\n";
    const r = parseTeacherGrades(text);
    expect(r.grades).toEqual([]);
    expect(r.bestResponder).toBeNull();
    expect(r.narrativeText).toBe("Just commentary, no grades at all.");
  });
});

describe("detectGenericPraise", () => {
  it("rejects 'good job' in a comment", () => {
    const response = parseTeacherGrades(
      "GRADE responder=player score=7 comment=good job thinking about the prompt\nBEST: player\nNice work everyone."
    );
    expect(detectGenericPraise(response)).toBeTruthy();
  });

  it("rejects 'nice effort' in narrative", () => {
    const response = parseTeacherGrades(
      "GRADE responder=player score=8 comment=you connected two ideas that don't normally touch\nBEST: player\nNice effort from the room today."
    );
    expect(detectGenericPraise(response)).toBeTruthy();
  });

  it("rejects 'well done' in a comment", () => {
    const response = parseTeacherGrades(
      "GRADE responder=player score=7 comment=well done on the structure\nBEST: player"
    );
    expect(detectGenericPraise(response)).toBeTruthy();
  });

  it("accepts specific, pointed commentary", () => {
    const response = parseTeacherGrades(
      [
        "GRADE responder=player score=8 comment=measured, even where the second sentence wobbles",
        "GRADE responder=lyra score=6 comment=anxious in your prose; ease up",
        "GRADE responder=sami score=7 comment=dry but actually thinking",
        "BEST: player",
        "",
        "Honor — you found the tension most of the room missed. Lyra,",
        "you're still over-correcting. Sami, give yourself permission to commit.",
      ].join("\n")
    );
    expect(detectGenericPraise(response)).toBeNull();
  });

  it("accepts earned sting", () => {
    const response = parseTeacherGrades(
      [
        "GRADE responder=player score=9 comment=saw the paradox the prompt was built around",
        "GRADE responder=ravi score=4 comment=you summarized the question, then answered a different one",
        "BEST: player",
        "",
        "Ravi, read the board again — you answered a question nobody asked.",
        "The rest of you: the player saw the trap in the prompt. That is the",
        "difference between showing up and showing you can think.",
      ].join("\n")
    );
    expect(detectGenericPraise(response)).toBeNull();
  });

  it("rejects 'keep it up'", () => {
    const response = parseTeacherGrades(
      "GRADE responder=player score=7 comment=keep it up, you're getting there\nBEST: player"
    );
    expect(detectGenericPraise(response)).toBeTruthy();
  });

  it("rejects 'great work' in narrative", () => {
    const response = parseTeacherGrades(
      "GRADE responder=player score=8 comment=sharp take\nBEST: player\nGreat work from everyone today."
    );
    expect(detectGenericPraise(response)).toBeTruthy();
  });

  it("rejects 'amazing job'", () => {
    const response = parseTeacherGrades(
      "GRADE responder=player score=9 comment=amazing job connecting those ideas\nBEST: player"
    );
    expect(detectGenericPraise(response)).toBeTruthy();
  });
});
