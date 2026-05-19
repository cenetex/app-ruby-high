export interface IAgentRuntime {
  agentId?: string;
  character?: { name?: string };
  getService<T = unknown>(type: string): T | null | undefined;
  getSetting?(key: string): string | null | undefined;
}

export class Service {
  static readonly serviceType: string = "service";
  readonly capabilityDescription: string = "";

  constructor(protected readonly runtime?: IAgentRuntime | null) {}

  async stop?(): Promise<void>;
}

export type ServiceConstructor = typeof Service;

export interface ActionResult {
  success: boolean;
  text?: string;
  error?: string;
  data?: unknown;
}

export interface ActionParameter {
  name: string;
  description: string;
  required?: boolean;
  schema?: Record<string, unknown>;
}

export interface Action {
  name: string;
  description: string;
  similes?: string[];
  validate?: (...args: unknown[]) => boolean | Promise<boolean>;
  handler?: (
    runtime: IAgentRuntime,
    message: Memory,
    state?: unknown,
    options?: { parameters?: Record<string, unknown> } | Record<string, unknown>,
  ) => ActionResult | Promise<ActionResult>;
  parameters?: ActionParameter[];
}

export interface Memory extends Record<string, unknown> {}

export interface AppBridgeLaunchContext {
  runtime: unknown;
}

export interface AppBridgeRunContext {
  runtime: unknown;
}

export interface AppLaunchDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface AppSessionState {
  sessionId: string;
  appName: string;
  mode: string;
  status: string;
  displayName: string;
  agentId?: string;
  canSendCommands: boolean;
  controls: string[];
  summary: string;
  goalLabel: string;
  suggestedPrompts: string[];
  telemetry: Record<string, unknown>;
}

export interface RubyHighAppModule {
  name: string;
  description: string;
  services: ServiceConstructor[];
  actions: Action[];
  app: {
    displayName: string;
    category: string;
    launchType: string;
    launchUrl: string | null;
    capabilities: string[];
    viewer: {
      url: string;
      sandbox: string;
    };
    session: {
      mode: string;
      features: string[];
    };
  };
  appBridge: {
    handleAppRoutes: (ctx: unknown) => Promise<boolean>;
    resolveLaunchSession: (ctx: AppBridgeLaunchContext) => Promise<AppSessionState | null>;
    refreshRunSession: (ctx: AppBridgeRunContext) => Promise<AppSessionState | null>;
    collectLaunchDiagnostics: (ctx: AppBridgeRunContext) => Promise<AppLaunchDiagnostic[]>;
  };
}
