import { describe, expect, it } from "vitest";
import { PLAYBOOKS } from "../characters/playbooks.js";
import { STUDENTS } from "../characters/students.js";
import { TEACHERS } from "../characters/teachers.js";
import { getElizaOsSystemsLab } from "../content/packs/elizaos-systems-lab.js";
import { getProject89SignalTimelineLab } from "../content/packs/project89-signal-timeline-lab.js";
import { getRubyHighOriginal } from "../content/packs/ruby-high-original.js";

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

describe("Ruby High youth-writing contract", () => {
  it("gives every built-in course a distinct teen-facing writing guide", async () => {
    const packs = await Promise.all([
      getRubyHighOriginal(),
      getElizaOsSystemsLab(),
      getProject89SignalTimelineLab(),
    ]);
    const courses = packs.flatMap((pack) => pack.courses ?? []);
    expect(courses).toHaveLength(6);
    expect(new Set(courses.map((course) => course.writingGuide?.hook)).size).toBe(6);
    for (const course of courses) {
      expect(course.writingGuide, `${course.title} needs a writing guide`).toBeTruthy();
      expect(course.writingGuide?.audience).toBe("teens-13-18");
      expect(course.writingGuide?.promise.length).toBeGreaterThan(30);
      expect(course.writingGuide?.action.length).toBeGreaterThan(30);
      expect(course.writingGuide?.avoid.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("keeps every built-in question readable and removes stale worksheet openings", async () => {
    const packs = await Promise.all([
      getRubyHighOriginal(),
      getElizaOsSystemsLab(),
      getProject89SignalTimelineLab(),
    ]);
    const questions = packs.flatMap((pack) => pack.faculty.flatMap((faculty) => faculty.questions));
    expect(questions.length).toBeGreaterThan(900);
    for (const question of questions) {
      expect(wordCount(question.prompt), `${question.id} prompt is too long`).toBeLessThanOrEqual(70);
      expect(question.explanation, `${question.id} needs an explanation`).toBeTruthy();
      expect(wordCount(question.explanation ?? ""), `${question.id} explanation is too long`).toBeLessThanOrEqual(100);
      expect(question.prompt, `${question.id} uses a stale worksheet opening`).not.toMatch(
        /\b(?:Which of the following|Imagine you're|Imagine you are)\b/i,
      );
    }
  });

  it("gives every classmate more than a single comic trait", () => {
    const students = Object.values(STUDENTS);
    expect(students).toHaveLength(6);
    expect(new Set(students.map((student) => student.classroomWant)).size).toBe(6);
    expect(new Set(students.map((student) => student.notices)).size).toBe(6);
    expect(new Set(students.map((student) => student.blindSpot)).size).toBe(6);
    for (const student of students) {
      expect(student.systemPrompt).toContain("What you want in class:");
      expect(student.systemPrompt).toContain("Your blind spot:");
      expect(student.systemPrompt).toContain("React to the latest moment");
      expect(student.systemPrompt).toContain("Never mock a learner");
    }
  });

  it("keeps teachers distinct and player moves free from required authored text", () => {
    expect(TEACHERS.ruby?.systemPrompt).toContain("school-sized problem");
    expect(TEACHERS["sally-science"]?.systemPrompt).toContain("odd thing on the bench");
    expect(TEACHERS["professor-edward"]?.systemPrompt).toContain("line on the page");
    expect(TEACHERS.roko?.systemPrompt).toContain("alignment labyrinth");
    for (const playbook of PLAYBOOKS) {
      expect(playbook.startingMove.description).not.toMatch(/\b(?:write|type|chat)\b/i);
    }
  });
});
