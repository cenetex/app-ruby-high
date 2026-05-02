import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import type { Difficulty } from "../types.js";
import { errorText, getService, getSessionId } from "./_helpers.js";

export const pickQuestionAction: Action = {
  name: "PICK_QUESTION",
  description:
    "Draw the next question from the current faculty's question pack and put it on the board. Use this in normal classroom play (instead of POSE_QUESTION) so questions come from a vetted bank, the student never sees the same question twice in a session, and difficulty/subject filters work.",
  similes: ["DRAW_QUESTION", "NEXT_QUESTION", "PULL_FROM_BANK"],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state,
    options,
  ): Promise<ActionResult> => {
    const params = (options?.parameters ?? options ?? {}) as Record<string, unknown>;
    try {
      const faculty = params.faculty ? String(params.faculty) : undefined;
      const subject = params.subject ? String(params.subject) : undefined;
      const difficulty = params.difficulty
        ? (String(params.difficulty).toLowerCase() as Difficulty)
        : undefined;

      const state = getService(runtime).pickAndPose(getSessionId(runtime), {
        faculty,
        subject,
        difficulty,
      });
      const q = state.current!;
      return {
        success: true,
        text: `${state.faculty} drew a ${q.difficulty ?? "?"} ${q.subject ?? "open"}: ${q.prompt}`,
      };
    } catch (err) {
      return { success: false, error: errorText(err) };
    }
  },
  parameters: [
    { name: "faculty", description: "Which faculty bank to draw from. Defaults to the current faculty.", required: false, schema: { type: "string" } },
    { name: "subject", description: "Optional subject filter, e.g. 'physics', 'mid-century'.", required: false, schema: { type: "string" } },
    { name: "difficulty", description: "Optional difficulty filter: easy / medium / hard.", required: false, schema: { type: "string", enum: ["easy", "medium", "hard"] } },
  ],
};
