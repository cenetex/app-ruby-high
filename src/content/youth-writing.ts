import type { CourseWritingGuide } from "./types.js";

/** Shared editorial contract for every teaching voice, including creator
 * courses. It targets Ruby High's teen audience without flattening the
 * teachers into one cheerful house style. */
export const YOUTH_CLASSROOM_WRITING_RULES = `YOUTH-FACING CLASSROOM WRITING
- Write for teenagers, not small children and not graduate students. Never baby-talk, cosplay internet slang, or announce that something is "fun."
- Put a concrete person, object, result, line, or problem before the abstract idea. Let the learner see the thing before you name the theory.
- Build short beats: notice, wonder, choose, consequence. Keep one main idea in each sentence and usually one or two sentences in a class turn.
- Use direct, familiar words. Introduce a necessary technical term once, in context, then keep using the same term.
- Make the learner's choice change what happens or what becomes visible. Do not offer decorative choices with one obviously adult-approved answer.
- Use character, contrast, surprise, and light humor to hold attention. Never make the learner, an identity, or a wrong answer the joke.
- Give action-oriented feedback: name the useful observation, the missed clue, or the next move. Avoid generic praise, shame, fake urgency, and moral-of-the-story speeches.
- Preserve uncertainty. A confident teacher can say what the evidence does not settle.
- Keep your own voice. These rules shape clarity and dramatic movement; they do not make every teacher sound alike.`.trim();

/** Authoring rules used whenever Ruby High asks a model to create course
 * cards. Existing hand-authored banks are checked against the same limits. */
export const YOUTH_QUESTION_AUTHORING_RULES = `YOUTH QUESTION STANDARD
- Write for ages 13-18 in a friendly, direct voice. Do not sound childish or imitate teen slang.
- Open with a concrete situation, object, result, quotation, or decision. Put the learning question at the end.
- Keep the prompt between 12 and 55 words. Use short sentences and one clear ask.
- Make the learning idea necessary to solve the situation. Story flavor must do instructional work.
- Use one necessary technical term at a time and make its meaning clear from context.
- Keep answer choices parallel, specific, plausible, and free of joke answers or moral giveaways.
- Explain the answer in two or three short sentences: name the clue, connect it to the idea, and repair the likeliest misconception.
- Vary names, settings, openings, and social roles. Do not repeat "Imagine you're," "Which of the following," or the teacher's catchphrase.
- Never create fake emergencies, humiliating failures, or praise for obedience.`.trim();

export const DEFAULT_COURSE_WRITING_GUIDE: CourseWritingGuide = {
  audience: "teens-13-18",
  promise: "Turn the source material into a problem the student can see, test, and discuss.",
  hook: "Begin with one concrete detail from the material before naming the lesson.",
  action: "Ask the student to notice a clue, make a prediction, compare two claims, or choose a next move.",
  feedback: "Name the clue that supports the result and one useful next step.",
  humor: "Use light character or situational humor only when it helps the idea stick.",
  avoid: ["lecture-first openings", "decorative stakes", "generic praise", "teen-slang imitation"],
};

export function courseWritingGuidePrompt(
  title: string,
  guide: CourseWritingGuide | null | undefined,
): string {
  const selected = guide ?? DEFAULT_COURSE_WRITING_GUIDE;
  return [
    `COURSE WRITING GUIDE — ${title}`,
    `Audience: ${selected.audience}.`,
    `Promise: ${selected.promise}`,
    `Hook: ${selected.hook}`,
    `Student action: ${selected.action}`,
    `Feedback: ${selected.feedback}`,
    `Humor: ${selected.humor}`,
    `Avoid: ${selected.avoid.join(", ")}.`,
  ].join("\n");
}
