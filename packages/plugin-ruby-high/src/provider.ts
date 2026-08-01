import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from "@elizaos/core";
import { RubyHighAgentService } from "./service.js";

export const rubyHighStateProvider: Provider = {
  name: "RUBY_HIGH_STATE",
  description:
    "Current safe Ruby High student, classroom, question, guest-teacher, and autonomy state.",
  dynamic: true,
  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const service = runtime.getService<RubyHighAgentService>(
      RubyHighAgentService.serviceType,
    );
    if (!service) {
      return { text: "Ruby High is unavailable.", data: { connected: false } };
    }
    const status = await service.status();
    if (!status.connection.connected) {
      return {
        text: status.connection.pending
          ? `Ruby High connection is waiting for approval. Code: ${status.connection.pending.userCode}`
          : "Ruby High is not connected.",
        data: {
          connected: false,
          pending: status.connection.pending ?? undefined,
        },
      };
    }
    const state = status.state;
    const lines = [
      "Ruby High is connected.",
      state?.student
        ? `Student: ${state.student.name}, grade ${state.student.currentGrade ?? "unselected"}.`
        : "No student is enrolled yet.",
      state?.activeGuest
        ? `Guest teacher course: ${state.activeGuest.name}.`
        : "No guest course is active.",
      state?.question
        ? `Open question (${state.question.difficulty ?? "unrated"}): ${state.question.prompt}`
        : "No question is currently open.",
      `Autonomy: ${status.autonomy?.enabled ? "enabled" : "off"}.`,
    ];
    return {
      text: lines.join("\n"),
      values: {
        rubyHighConnected: true,
        rubyHighStudent: state?.student?.name,
        rubyHighFaculty: state?.faculty,
        rubyHighQuestionOpen: !!state?.question,
        rubyHighAutonomyEnabled: status.autonomy?.enabled === true,
      },
      data: {
        connected: true,
        state: state ?? undefined,
        autonomy: status.autonomy ?? undefined,
      },
    };
  },
};
