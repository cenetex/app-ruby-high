import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import type { Choice } from "../types.js";
import { errorText, getService, getSessionId } from "./_helpers.js";

export const poseQuestionAction: Action = {
  name: "POSE_QUESTION",
  description:
    "Put a multiple-choice question on the Ruby High chalkboard. Use this when teaching, quizzing, or stress-testing the student's understanding of a topic. Always fill in all four options A/B/C/D and mark exactly one correct.",
  similes: ["ASK_QUESTION", "QUIZ_STUDENT", "WRITE_ON_BOARD"],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state,
    options,
  ): Promise<ActionResult> => {
    const params = (options?.parameters ?? options ?? {}) as Record<string, unknown>;
    try {
      const prompt = String(params.prompt ?? "").trim();
      if (!prompt) return { success: false, error: "POSE_QUESTION requires a 'prompt'" };

      const rawOptions = params.options as Partial<Record<Choice, string>> | undefined;
      if (!rawOptions) return { success: false, error: "POSE_QUESTION requires 'options' (A/B/C/D)" };

      const correct = String(params.correct ?? "").trim().toUpperCase() as Choice;
      const explanation = params.explanation ? String(params.explanation) : undefined;
      const subject = params.subject ? String(params.subject) : undefined;
      const faculty = params.faculty ? String(params.faculty) : undefined;

      const state = getService(runtime).pose(getSessionId(runtime), {
        prompt,
        options: {
          A: String(rawOptions.A ?? ""),
          B: String(rawOptions.B ?? ""),
          C: String(rawOptions.C ?? ""),
          D: String(rawOptions.D ?? ""),
        },
        correct,
        explanation,
        subject,
        faculty,
      });
      return {
        success: true,
        text: `Posted question on the board (${state.faculty}/${state.subject ?? "open"}): ${state.current?.prompt}`,
      };
    } catch (err) {
      return { success: false, error: errorText(err) };
    }
  },
  parameters: [
    { name: "prompt", description: "The question Ruby (or faculty) writes on the chalkboard.", required: true, schema: { type: "string" } },
    {
      name: "options",
      description: "Object with keys A, B, C, D — each a non-empty answer choice.",
      required: true,
      schema: {
        type: "object",
        properties: { A: { type: "string" }, B: { type: "string" }, C: { type: "string" }, D: { type: "string" } },
      },
    },
    { name: "correct", description: "Which option is correct: A, B, C, or D.", required: true, schema: { type: "string", enum: ["A", "B", "C", "D"] } },
    { name: "explanation", description: "What to say when revealing the answer.", required: false, schema: { type: "string" } },
    { name: "subject", description: "Subject tag, e.g. 'physics', 'literature'.", required: false, schema: { type: "string" } },
    { name: "faculty", description: "Which faculty member is asking. Defaults to current.", required: false, schema: { type: "string" } },
  ],
};
