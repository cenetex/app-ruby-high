import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { errorText, getService, getSessionId } from "./_helpers.js";

export const clearBoardAction: Action = {
  name: "CLEAR_BOARD",
  description: "Wipe the chalkboard. Use after revealing an answer or when changing topics.",
  similes: ["WIPE_BOARD", "RESET_QUESTION"],
  validate: async () => true,
  handler: async (runtime: IAgentRuntime, _message: Memory): Promise<ActionResult> => {
    try {
      getService(runtime).clearBoard(getSessionId(runtime));
      return { success: true, text: "Board cleared." };
    } catch (err) {
      return { success: false, error: errorText(err) };
    }
  },
  parameters: [],
};
