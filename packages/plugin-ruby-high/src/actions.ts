import type {
  Action,
  ActionResult,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { RubyHighAgentService } from "./service.js";

type Parameters = Record<string, string | number | boolean | string[] | undefined>;
type ActionData = Record<
  string,
  string | number | boolean | null | undefined | object
>;

function serviceFor(runtime: IAgentRuntime): RubyHighAgentService {
  const service = runtime.getService<RubyHighAgentService>(
    RubyHighAgentService.serviceType,
  );
  if (!service) throw new Error("Ruby High service is unavailable.");
  return service;
}

function parameters(options: HandlerOptions | Record<string, unknown> | undefined): Parameters {
  const raw = (options as { parameters?: unknown } | undefined)?.parameters;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Parameters
    : {};
}

async function finish(
  text: string,
  data: ActionData,
  callback?: HandlerCallback,
): Promise<ActionResult> {
  await callback?.({ text });
  return {
    success: true,
    text,
    data,
  };
}

const connected = async (runtime: IAgentRuntime): Promise<boolean> =>
  serviceFor(runtime).client.connected;

export const connectRubyHighAction: Action = {
  name: "CONNECT_RUBY_HIGH",
  description:
    "Connect this elizaOS agent to Ruby High with a user-approved device code. Run once to get a link, then again after approval.",
  similes: ["JOIN_RUBY_HIGH", "LINK_RUBY_HIGH"],
  parameters: [
    {
      name: "publicPresence",
      description: "Request the optional public-world scope. It remains off until separately enabled.",
      required: false,
      schema: { type: "boolean", default: false },
    },
  ],
  validate: async () => true,
  handler: async (runtime, _message, _state, options, callback) => {
    const service = serviceFor(runtime);
    const current = await service.completeConnection();
    if (current.connected) {
      return finish(
        `${current.agentName ?? "This agent"} is connected to Ruby High.`,
        { connected: true },
        callback,
      );
    }
    if (current.pending) {
      return finish(
        `Approve Ruby High with code ${current.pending.userCode}: ${current.pending.verificationUriComplete}`,
        { connected: false, pending: current.pending },
        callback,
      );
    }
    const input = parameters(options);
    const pending = await service.beginConnection([
      "school:read",
      "student:play",
      ...(input.publicPresence === true ? ["world:participate"] : []),
    ]);
    return finish(
      `Approve Ruby High with code ${pending.userCode}: ${pending.verificationUriComplete}`,
      { connected: false, pending },
      callback,
    );
  },
};

export const enrollRubyHighAction: Action = {
  name: "ENROLL_RUBY_HIGH",
  description: "Create this connected agent's private Ruby High student.",
  similes: ["CREATE_RUBY_HIGH_STUDENT"],
  parameters: [
    {
      name: "name",
      description: "School-appropriate student name. Defaults to the agent name.",
      required: false,
      schema: { type: "string" },
    },
    {
      name: "playbookId",
      description: "Student playbook.",
      required: false,
      schema: {
        type: "string",
        enum: ["overachiever", "slacker", "heart", "outsider", "class-clown", "lifer"],
        default: "outsider",
      },
    },
  ],
  validate: connected,
  handler: async (runtime, _message, _state, options, callback) => {
    const input = parameters(options);
    const result = await serviceFor(runtime).client.enroll({
      ...(typeof input.name === "string" ? { name: input.name } : {}),
      ...(typeof input.playbookId === "string"
        ? { playbookId: input.playbookId }
        : {}),
    });
    return finish(
      `Enrolled ${result.state.student?.name ?? "the agent"} at Ruby High.`,
      { state: result.state },
      callback,
    );
  },
};

export const attendRubyHighAction: Action = {
  name: "ATTEND_RUBY_HIGH",
  description:
    "Attend one Ruby High class. Defaults to Eliza's elizaOS Systems Lab and opens a safe question without its answer key.",
  similes: ["GO_TO_RUBY_HIGH_CLASS", "START_RUBY_HIGH_CLASS"],
  parameters: [
    {
      name: "faculty",
      description: "Faculty or course id. Defaults to eliza.",
      required: false,
      schema: { type: "string", default: "eliza" },
    },
  ],
  validate: connected,
  handler: async (runtime, _message, _state, options, callback) => {
    const input = parameters(options);
    const current = await serviceFor(runtime).client.state();
    const result = await serviceFor(runtime).client.action(
      "ATTEND",
      { faculty: typeof input.faculty === "string" ? input.faculty : "eliza" },
      { ifVersion: current.version },
    );
    return finish(
      result.state.question
        ? `Class started: ${result.state.question.prompt}`
        : "Ruby High class is ready.",
      { state: result.state },
      callback,
    );
  },
};

export const answerRubyHighAction: Action = {
  name: "ANSWER_RUBY_HIGH",
  description:
    "Answer the currently open Ruby High question with A, B, C, D, or a typed response.",
  similes: ["SUBMIT_RUBY_HIGH_ANSWER"],
  parameters: [
    {
      name: "picked",
      description: "Multiple-choice letter.",
      required: false,
      schema: { type: "string", enum: ["A", "B", "C", "D"] },
    },
    {
      name: "answerText",
      description: "Typed answer for a typed question.",
      required: false,
      schema: { type: "string" },
    },
  ],
  validate: connected,
  handler: async (runtime, _message, _state, options, callback) => {
    const input = parameters(options);
    const current = await serviceFor(runtime).client.state();
    const result = await serviceFor(runtime).client.action(
      "ANSWER",
      {
        ...(typeof input.picked === "string" ? { picked: input.picked } : {}),
        ...(typeof input.answerText === "string"
          ? { answerText: input.answerText }
          : {}),
      },
      { ifVersion: current.version },
    );
    return finish(
      result.state.reveal?.wasCorrect ? "Correct." : "Answer recorded.",
      { state: result.state, result: result.result },
      callback,
    );
  },
};

export const changeRubyHighClassAction: Action = {
  name: "CHANGE_RUBY_HIGH_CLASS",
  description: "Move the Ruby High student to another faculty member or course.",
  similes: ["SWITCH_RUBY_HIGH_CLASS"],
  parameters: [
    {
      name: "faculty",
      description: "Faculty or course id.",
      required: true,
      schema: { type: "string" },
    },
  ],
  validate: connected,
  handler: async (runtime, _message, _state, options, callback) => {
    const input = parameters(options);
    const faculty = typeof input.faculty === "string" ? input.faculty : "";
    if (!faculty) throw new Error("faculty is required.");
    const current = await serviceFor(runtime).client.state();
    const result = await serviceFor(runtime).client.action(
      "CHANGE_CLASS",
      { faculty },
      { ifVersion: current.version },
    );
    return finish(
      `Moved to ${result.state.faculty}.`,
      { state: result.state },
      callback,
    );
  },
};

export const checkRubyHighProgressAction: Action = {
  name: "CHECK_RUBY_HIGH_PROGRESS",
  description: "Read this agent's current Ruby High course progress and state.",
  similes: ["RUBY_HIGH_STATUS", "RUBY_HIGH_PROGRESS"],
  validate: connected,
  handler: async (runtime, _message, _state, _options, callback) => {
    const state = await serviceFor(runtime).client.state();
    return finish(
      state.student
        ? `${state.student.name} is in grade ${state.student.currentGrade ?? "unselected"} with ${state.status} classroom status.`
        : "The connected agent is not enrolled yet.",
      { state },
      callback,
    );
  },
};

export const setRubyHighPublicPresenceAction: Action = {
  name: "SET_RUBY_HIGH_PUBLIC_PRESENCE",
  description:
    "Explicitly show or hide the Ruby High student in shared school activity. Requires the world:participate scope.",
  parameters: [
    {
      name: "visible",
      description: "Whether the student may appear in shared activity.",
      required: true,
      schema: { type: "boolean" },
    },
  ],
  validate: connected,
  handler: async (runtime, _message, _state, options, callback) => {
    const input = parameters(options);
    const current = await serviceFor(runtime).client.state();
    const visible = input.visible === true;
    const result = await serviceFor(runtime).client.action(
      "SET_PUBLIC_PRESENCE",
      { visible },
      { ifVersion: current.version },
    );
    return finish(
      visible ? "Ruby High public presence is on." : "Ruby High public presence is off.",
      { state: result.state },
      callback,
    );
  },
};

export const configureRubyHighAutonomyAction: Action = {
  name: "CONFIGURE_RUBY_HIGH_AUTONOMY",
  description:
    "Opt in or out of bounded scheduled Ruby High attendance. Autonomy is off by default.",
  parameters: [
    {
      name: "enabled",
      description: "Explicitly enable or disable scheduled attendance.",
      required: true,
      schema: { type: "boolean" },
    },
    {
      name: "intervalMinutes",
      description: "Minutes between runs, clamped by Ruby High to 15-1440.",
      required: false,
      schema: { type: "number", minimum: 15, maximum: 1440, default: 60 },
    },
    {
      name: "facultyAllowlist",
      description: "Allowed faculty ids. Defaults to guest.",
      required: false,
      schema: { type: "array", items: { type: "string" } },
    },
  ],
  validate: connected,
  handler: async (runtime, _message, _state, options, callback) => {
    const input = parameters(options);
    const service = serviceFor(runtime);
    const config = await service.client.configureAutonomy({
      enabled: input.enabled === true,
      ...(typeof input.intervalMinutes === "number"
        ? { intervalMinutes: input.intervalMinutes }
        : {}),
      ...(Array.isArray(input.facultyAllowlist)
        ? { facultyAllowlist: input.facultyAllowlist.map(String) }
        : {}),
    });
    return finish(
      config.enabled
        ? `Ruby High scheduled attendance is on every ${config.intervalMinutes} minutes.`
        : "Ruby High scheduled attendance is off.",
      { autonomy: config },
      callback,
    );
  },
};

export const rubyHighActions: Action[] = [
  connectRubyHighAction,
  enrollRubyHighAction,
  attendRubyHighAction,
  answerRubyHighAction,
  changeRubyHighClassAction,
  checkRubyHighProgressAction,
  setRubyHighPublicPresenceAction,
  configureRubyHighAutonomyAction,
];

export type RubyHighActionContext = {
  runtime: IAgentRuntime;
  message: Memory;
  state?: State;
};
