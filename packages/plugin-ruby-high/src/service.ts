import {
  ModelType,
  Service,
  type IAgentRuntime,
} from "@elizaos/core";
import {
  RubyHighApiError,
  RubyHighClient,
  type RubyHighAutonomyConfig,
  type RubyHighState,
} from "./client.js";

const DEFAULT_RUBY_HIGH_URL = "https://ruby-high.fly.dev";
const SCHEDULER_INTERVAL_MS = 30_000;

interface PendingConnection {
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  expiresAt: number;
}

export class RubyHighAgentService extends Service {
  static serviceType = "ruby-high-agent";
  capabilityDescription =
    "Connects an elizaOS agent to Ruby High and runs bounded, opt-in classroom attendance.";

  readonly client: RubyHighClient;
  private pendingConnection: PendingConnection | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private autonomyRunning = false;
  private consecutiveAutonomyFailures = 0;

  constructor(runtime?: IAgentRuntime) {
    super(runtime);
    const baseUrl = setting(runtime, "RUBY_HIGH_URL") || DEFAULT_RUBY_HIGH_URL;
    const accessToken = setting(runtime, "RUBY_HIGH_AGENT_TOKEN") || undefined;
    this.client = new RubyHighClient({ baseUrl, accessToken });
  }

  static async start(runtime: IAgentRuntime): Promise<RubyHighAgentService> {
    const service = new RubyHighAgentService(runtime);
    service.timer = setInterval(() => {
      void service.schedulerTick();
    }, SCHEDULER_INTERVAL_MS);
    return service;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pendingConnection = null;
  }

  async beginConnection(
    scopes = ["school:read", "student:play"],
  ): Promise<PendingConnection> {
    const agentName = this.runtime.character?.name || "elizaOS Agent";
    const issued = await this.client.beginDeviceAuthorization(agentName, scopes);
    this.pendingConnection = {
      deviceCode: issued.deviceCode,
      userCode: issued.userCode,
      verificationUriComplete: issued.verificationUriComplete,
      expiresAt: Date.now() + issued.expiresIn * 1000,
    };
    return { ...this.pendingConnection };
  }

  async completeConnection(): Promise<{
    connected: boolean;
    pending?: PendingConnection;
    agentName?: string;
  }> {
    if (!this.pendingConnection) {
      if (this.client.connected) {
        const me = await this.client.me();
        return { connected: true, agentName: me.agent.agentName };
      }
      return { connected: false };
    }
    if (this.pendingConnection.expiresAt <= Date.now()) {
      this.pendingConnection = null;
      return { connected: false };
    }
    try {
      const token = await this.client.exchangeDeviceCode(
        this.pendingConnection.deviceCode,
      );
      this.runtime.setSetting(
        "RUBY_HIGH_AGENT_TOKEN",
        token.accessToken,
        true,
      );
      this.pendingConnection = null;
      return { connected: true, agentName: token.agent.agentName };
    } catch (error) {
      if (
        error instanceof RubyHighApiError &&
        error.code === "authorization_pending"
      ) {
        const pending = this.pendingConnection;
        return pending
          ? { connected: false, pending: { ...pending } }
          : { connected: false };
      }
      throw error;
    }
  }

  connectionStatus(): {
    connected: boolean;
    baseUrl: string;
    pending: Omit<PendingConnection, "deviceCode"> | null;
  } {
    return {
      connected: this.client.connected,
      baseUrl: this.client.baseUrl,
      pending: this.pendingConnection
        ? {
            userCode: this.pendingConnection.userCode,
            verificationUriComplete: this.pendingConnection.verificationUriComplete,
            expiresAt: this.pendingConnection.expiresAt,
          }
        : null,
    };
  }

  async status(): Promise<{
    connection: ReturnType<RubyHighAgentService["connectionStatus"]>;
    state: RubyHighState | null;
    autonomy: RubyHighAutonomyConfig | null;
    error?: string;
  }> {
    const connection = this.connectionStatus();
    if (!connection.connected) return { connection, state: null, autonomy: null };
    try {
      const [state, me] = await Promise.all([this.client.state(), this.client.me()]);
      return { connection, state, autonomy: me.autonomy };
    } catch (error) {
      return {
        connection,
        state: null,
        autonomy: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async runAutonomyOnce(now = Date.now()): Promise<string> {
    if (this.autonomyRunning) return "duplicate-wake-suppressed";
    this.autonomyRunning = true;
    let stopReason = "completed";
    try {
      const me = await this.client.me();
      const config = me.autonomy;
      if (!config.enabled) {
        stopReason = "disabled";
        return stopReason;
      }
      if (config.nextRunAt != null && config.nextRunAt > now) {
        stopReason = "not-due";
        return stopReason;
      }

      let actions = 0;
      let modelCalls = 0;
      let classes = 0;
      let state = await this.client.state();
      if (!state.student) {
        const enrolled = await this.client.enroll();
        state = enrolled.state;
        actions += 1;
      }
      if (
        actions >= config.maxActionsPerRun ||
        classes >= config.maxClassesPerRun
      ) {
        stopReason = "budget-reached-before-class";
        return stopReason;
      }
      if (!state.question) {
        const faculty = config.facultyAllowlist[0] || "guest";
        const attended = await this.client.action("ATTEND", { faculty }, {
          ifVersion: state.version,
        });
        state = attended.state;
        actions += 1;
        classes += 1;
      }
      if (!state.question) {
        stopReason = "no-question";
        return stopReason;
      }
      if (
        state.question.type !== "multiple-choice" ||
        !state.question.options
      ) {
        stopReason = "unsupported-question-type";
        return stopReason;
      }
      if (
        actions >= config.maxActionsPerRun ||
        modelCalls >= config.maxModelCallsPerRun
      ) {
        stopReason = "budget-reached-before-answer";
        return stopReason;
      }

      const pick = await this.runtime.useModel(ModelType.TEXT_SMALL, {
        prompt: answerPrompt(state),
        maxTokens: 8,
        temperature: 0,
      });
      modelCalls += 1;
      const letter = pick.trim().toUpperCase().match(/\b([ABCD])\b/)?.[1];
      if (!letter) {
        stopReason = "model-returned-no-choice";
        return stopReason;
      }
      await this.client.action("ANSWER", { picked: letter }, {
        ifVersion: state.version,
      });
      actions += 1;
      this.consecutiveAutonomyFailures = 0;
      stopReason = `completed:${classes}-class:${actions}-actions:${modelCalls}-model-calls`;
      return stopReason;
    } catch (error) {
      this.consecutiveAutonomyFailures += 1;
      stopReason = `error:${safeError(error)}`;
      if (this.consecutiveAutonomyFailures >= 3) {
        await this.client.configureAutonomy({ enabled: false }).catch(() => {});
        stopReason = `circuit-open:${safeError(error)}`;
      }
      return stopReason;
    } finally {
      this.autonomyRunning = false;
      if (this.client.connected && stopReason !== "disabled" && stopReason !== "not-due") {
        await this.client.noteAutonomyRun(stopReason).catch(() => {});
      }
    }
  }

  private async schedulerTick(): Promise<void> {
    if (!this.client.connected || this.autonomyRunning) return;
    await this.runAutonomyOnce();
  }
}

function answerPrompt(state: RubyHighState): string {
  const question = state.question;
  if (!question?.options) throw new Error("No multiple-choice question is open.");
  return [
    "You are a student in Ruby High. Answer the multiple-choice question.",
    "Return exactly one letter: A, B, C, or D. Do not include explanation.",
    `Question: ${question.prompt}`,
    ...Object.entries(question.options).map(([letter, answer]) => `${letter}. ${answer}`),
  ].join("\n");
}

function setting(runtime: IAgentRuntime | undefined, name: string): string {
  const value = runtime?.getSetting?.(name);
  return typeof value === "string" ? value.trim() : "";
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 120);
}
