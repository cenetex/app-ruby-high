import type { Action, ActionResult, IAgentRuntime, Memory } from "../runtime.js";
import type { CharacterStats, Choice } from "../types.js";
import { errorText, getService, getSessionId } from "./_helpers.js";

export const poseQuestionAction: Action = {
  name: "POSE_QUESTION",
  description:
    "Put a multiple-choice question on the Ruby High chalkboard. Supply the correct answer text and at least three plausible decoys; Ruby High randomly builds the A/B/C/D board.",
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

      const rawCorrect = String(params.correct ?? "").trim();
      const correct = params.options && /^[a-d]$/i.test(rawCorrect)
        ? rawCorrect.toUpperCase()
        : rawCorrect;
      if (!correct) return { success: false, error: "POSE_QUESTION requires a 'correct' answer" };
      const decoys = Array.isArray(params.decoys)
        ? params.decoys.map((value) => String(value).trim()).filter(Boolean)
        : undefined;
      const rawOptions = params.options as Partial<Record<Choice, string>> | undefined;
      if (!decoys && !rawOptions) {
        return { success: false, error: "POSE_QUESTION requires at least three 'decoys'" };
      }
      const explanation = params.explanation ? String(params.explanation) : undefined;
      const subject = params.subject ? String(params.subject) : undefined;
      const stat = params.stat ? String(params.stat) as keyof CharacterStats : undefined;
      const faculty = params.faculty ? String(params.faculty) : undefined;

      const state = getService(runtime).pose(getSessionId(runtime), {
        prompt,
        correct,
        ...(decoys ? { decoys } : {}),
        ...(rawOptions ? {
          options: {
            A: String(rawOptions.A ?? ""),
            B: String(rawOptions.B ?? ""),
            C: String(rawOptions.C ?? ""),
            D: String(rawOptions.D ?? ""),
          },
        } : {}),
        explanation,
        subject,
        stat,
        faculty,
        persistToBank: true,
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
    { name: "correct", description: "The correct answer text.", required: true, schema: { type: "string" } },
    {
      name: "decoys",
      description: "At least three plausible wrong answers. Ruby High randomly selects three and shuffles all four choices.",
      required: true,
      schema: { type: "array", minItems: 3, items: { type: "string" } },
    },
    { name: "explanation", description: "What to say when revealing the answer.", required: false, schema: { type: "string" } },
    { name: "subject", description: "Subject tag, e.g. 'physics', 'literature'.", required: false, schema: { type: "string" } },
    { name: "stat", description: "Optional roll stat for the card. One of head, heart, hustle, honor.", required: false, schema: { type: "string", enum: ["head", "heart", "hustle", "honor"] } },
    { name: "faculty", description: "Which faculty member is asking. Defaults to current.", required: false, schema: { type: "string" } },
  ],
};
