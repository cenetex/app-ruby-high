import type { Action, ActionResult, IAgentRuntime, Memory } from "../runtime.js";
import type { Choice } from "../types.js";
import { errorText, getService, getSessionId } from "./_helpers.js";

export const gradeAnswerAction: Action = {
  name: "GRADE_ANSWER",
  description:
    "Submit the student's pick (A/B/C/D). Quiz cards reveal correctness; story cards commit a move whose event opens another assignment.",
  similes: ["REVEAL_ANSWER", "CHECK_ANSWER", "MARK_RESPONSE"],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state,
    options,
  ): Promise<ActionResult> => {
    const params = (options?.parameters ?? options ?? {}) as Record<string, unknown>;
    try {
      const picked = String(params.picked ?? "").trim().toUpperCase() as Choice;
      const state = getService(runtime).submitAnswer(getSessionId(runtime), picked);
      const reveal = state.lastReveal!;
      return {
        success: true,
        text: reveal.questionType === "story-choice"
          ? `Choice locked: ${reveal.caseChoice?.choiceLabel ?? reveal.picked}. Follow the event it causes.`
          : reveal.wasCorrect
          ? `Correct! (${reveal.picked}) Record now ${state.score.correct}/${state.score.total}.`
          : `That was ${reveal.picked}. The answer was ${reveal.correct}. Record ${state.score.correct}/${state.score.total}.`,
      };
    } catch (err) {
      return { success: false, error: errorText(err) };
    }
  },
  parameters: [
    { name: "picked", description: "The student's pick: A, B, C, or D.", required: true, schema: { type: "string", enum: ["A", "B", "C", "D"] } },
  ],
};
