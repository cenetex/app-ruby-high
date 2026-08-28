import type { Action, ActionResult, IAgentRuntime, Memory } from "../runtime.js";
import { errorText, getService, getSessionId } from "./_helpers.js";

export const handoffFacultyAction: Action = {
  name: "HANDOFF_FACULTY",
  description:
    "Hand the lesson off to a specialist faculty member. The faculty roster is: ruby (host, general/lore), sally-science (physics/chem/bio/earth-sci), professor-edward (literature/literary-theory/mid-century), and roko (AI alignment/infohazards/coordination). New questions will be drawn from that faculty's question bank.",
  similes: ["BRING_IN_TEACHER", "CALL_FACULTY", "SWITCH_TEACHER"],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state,
    options,
  ): Promise<ActionResult> => {
    const params = (options?.parameters ?? options ?? {}) as Record<string, unknown>;
    try {
      const facultyId = String(params.faculty ?? "ruby").trim();
      const state = getService(runtime).setFaculty(getSessionId(runtime), facultyId);
      return { success: true, text: `Now teaching: ${state.faculty}.` };
    } catch (err) {
      return { success: false, error: errorText(err) };
    }
  },
  parameters: [
    { name: "faculty", description: "Faculty id: ruby | sally-science | professor-edward | roko.", required: true, schema: { type: "string" } },
  ],
};
