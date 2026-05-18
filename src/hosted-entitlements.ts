import type { RubyHighService } from "./services/ruby-high-service.js";
import type { QuizState } from "./types.js";

export type HostedImageKind = "portrait" | "diploma";

export interface HostedAiEntitlementStatus {
  configured: boolean;
  active: boolean;
  expiresAt: number | null;
  remainingMs: number;
  cost: number;
  durationMs: number;
  affordable: boolean;
  canActivate: boolean;
}

export interface HostedImageEntitlementStatus {
  configured: boolean;
  cost: number;
  affordable: boolean;
  canUseHosted: boolean;
}

export interface HostedEntitlementStatus {
  hallPasses: number;
  hosted_ai: HostedAiEntitlementStatus;
  hosted_images: Record<HostedImageKind, HostedImageEntitlementStatus>;
  creator: {
    courseSlotCost: number;
    questionGenerationCost: number;
    moreQuestionsCount: number;
  };
}

type EntitlementInput = {
  ruby?: Pick<RubyHighService, "hallPassBalance" | "hostedAiAccessExpiresAt"> | null;
  sessionId?: string | null;
  state?: QuizState | null;
  now?: number;
};

function envTrim(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = envTrim(name);
  if (!raw) return fallback;
  const parsed = Math.floor(Number(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function hostedOpenRouterApiKey(): string | null {
  return envTrim("RUBY_HIGH_OPENROUTER_API_KEY");
}

export function hostedOpenRouterConfigured(): boolean {
  return !!hostedOpenRouterApiKey();
}

export function hostedImageCost(kind: HostedImageKind): number {
  return readPositiveIntEnv(
    kind === "portrait" ? "RUBY_HIGH_PORTRAIT_HALL_PASS_COST" : "RUBY_HIGH_DIPLOMA_HALL_PASS_COST",
    kind === "portrait" ? 1 : 3,
  );
}

export function courseSlotCost(): number {
  const explicit = readPositiveIntEnv("RUBY_HIGH_COURSE_SLOT_HALL_PASS_COST", 0);
  if (explicit > 0) return explicit;
  return readPositiveIntEnv("RUBY_HIGH_COURSE_GENERATION_HALL_PASS_COST", 3);
}

export function questionGenerationCost(): number {
  return readPositiveIntEnv("RUBY_HIGH_QUESTION_GENERATION_HALL_PASS_COST", 1);
}

export function moreQuestionsCount(): number {
  return readPositiveIntEnv("RUBY_HIGH_MORE_QUESTIONS_COUNT", 6);
}

export function hostedAiAccessCost(): number {
  return readPositiveIntEnv("RUBY_HIGH_HOSTED_AI_HALL_PASS_COST", 1);
}

export function hostedAiAccessDurationMs(): number {
  const explicitMs = readPositiveIntEnv("RUBY_HIGH_HOSTED_AI_DURATION_MS", 0);
  if (explicitMs > 0) return explicitMs;
  return readPositiveIntEnv("RUBY_HIGH_HOSTED_AI_DURATION_HOURS", 168) * 60 * 60 * 1000;
}

function stateHallPassBalance(state: QuizState | null | undefined): number {
  return Math.max(0, Math.floor(Number(state?.wallet?.hallPasses ?? 0)));
}

function hallPassBalance(input: EntitlementInput): number {
  if (input.ruby && input.sessionId) return input.ruby.hallPassBalance(input.sessionId);
  return stateHallPassBalance(input.state);
}

function hostedAiExpiresAt(input: EntitlementInput, now: number): number | null {
  if (input.ruby && input.sessionId) return input.ruby.hostedAiAccessExpiresAt(input.sessionId, now);
  const expiresAt = Math.floor(Number(input.state?.wallet?.hostedAiAccessExpiresAt ?? 0));
  return Number.isFinite(expiresAt) && expiresAt > now ? expiresAt : null;
}

export function hostedAiEntitlementStatus(input: EntitlementInput = {}): HostedAiEntitlementStatus {
  const now = typeof input.now === "number" && Number.isFinite(input.now) ? input.now : Date.now();
  const cost = hostedAiAccessCost();
  const expiresAt = hostedAiExpiresAt(input, now);
  const remainingMs = expiresAt ? Math.max(0, expiresAt - now) : 0;
  const configured = hostedOpenRouterConfigured();
  const active = remainingMs > 0;
  const affordable = hallPassBalance(input) >= cost;
  return {
    configured,
    active,
    expiresAt: active ? expiresAt : null,
    remainingMs,
    cost,
    durationMs: hostedAiAccessDurationMs(),
    affordable,
    canActivate: configured && !active && affordable,
  };
}

export function hostedImageEntitlementStatus(
  input: EntitlementInput = {},
  kind: HostedImageKind,
): HostedImageEntitlementStatus {
  const configured = hostedOpenRouterConfigured();
  const cost = hostedImageCost(kind);
  const affordable = hallPassBalance(input) >= cost;
  return {
    configured,
    cost,
    affordable,
    canUseHosted: configured && affordable,
  };
}

export function hostedEntitlementStatus(input: EntitlementInput = {}): HostedEntitlementStatus {
  return {
    hallPasses: hallPassBalance(input),
    hosted_ai: hostedAiEntitlementStatus(input),
    hosted_images: {
      portrait: hostedImageEntitlementStatus(input, "portrait"),
      diploma: hostedImageEntitlementStatus(input, "diploma"),
    },
    creator: {
      courseSlotCost: courseSlotCost(),
      questionGenerationCost: questionGenerationCost(),
      moreQuestionsCount: moreQuestionsCount(),
    },
  };
}
