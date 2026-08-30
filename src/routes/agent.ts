import { createHash } from "node:crypto";
import { PLAYBOOKS, playbookById } from "../characters/playbooks.js";
import {
  coursesForSession,
  facultyForSession,
  guestPackForSession,
} from "../content/registry.js";
import { ELIZAOS_SYSTEMS_LAB_PACK_ID } from "../content/packs/elizaos-systems-lab.js";
import {
  AgentAccessError,
  AgentAccessService,
  type AgentCredential,
  type AgentScope,
} from "../services/agent-access-service.js";
import { AuthService } from "../services/auth-service.js";
import { FacultyService } from "../services/faculty-service.js";
import { ChatService } from "../services/chat-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { publicWorldNameReview } from "../services/ruby-high/world-projection.js";
import { TokenBucket } from "../services/rate-limit.js";
import type { Choice, QuizState } from "../types.js";
import type { RouteContext } from "./context.js";

export const AGENT_API_PREFIX = "/api/apps/ruby-high/agent/v1";
const AGENT_LIMITER = new TokenBucket(120, 2);
const DEVICE_LIMITER = new TokenBucket(12, 1 / 30);

type AgentActionType =
  | "ENROLL"
  | "ATTEND"
  | "ANSWER"
  | "CHANGE_CLASS"
  | "CHECK_PROGRESS"
  | "SET_PUBLIC_PRESENCE"
  | "LOUNGE";

interface AgentActionBody {
  requestId?: unknown;
  ifVersion?: unknown;
  type?: unknown;
  input?: unknown;
}

export async function handleAgentRoutes(
  ctx: RouteContext,
  services: {
    access: AgentAccessService;
    auth: AuthService | null;
    ruby: RubyHighService;
    faculty: FacultyService | null;
    chat: ChatService | null;
  },
): Promise<boolean> {
  if (!ctx.pathname.startsWith(AGENT_API_PREFIX)) return false;
  const path = ctx.pathname.slice(AGENT_API_PREFIX.length) || "/";
  const clientKey = `${ctx.clientIp || "no-ip"}:${path}`;
  const limiter = path.startsWith("/device/") ? DEVICE_LIMITER : AGENT_LIMITER;
  if (!limiter.take(clientKey)) {
    const retryAfter = Math.max(1, limiter.retryAfterSeconds(clientKey));
    setHeader(ctx.res, "Retry-After", String(retryAfter));
    ctx.error(ctx.res, "Too many agent requests.", 429);
    return true;
  }

  try {
    if (ctx.method === "GET" && path === "/connect") {
      sendHtml(ctx.res, renderConnectPage(ctx.url?.searchParams.get("user_code") ?? ""));
      return true;
    }

    if (ctx.method === "POST" && path === "/device/code") {
      requireJson(ctx);
      const body = await readObjectBody(ctx);
      const issued = await services.access.issueDeviceCode({
        agentName: stringField(body, "agentName"),
        scopes: stringArrayField(body, "scopes"),
      });
      const verificationUri = absoluteUrl(ctx, `${AGENT_API_PREFIX}/connect`);
      ctx.json(ctx.res, {
        ...issued,
        verificationUri,
        verificationUriComplete: `${verificationUri}?user_code=${encodeURIComponent(issued.userCode)}`,
      }, 201);
      return true;
    }

    if (ctx.method === "POST" && path === "/device/approve") {
      requireJson(ctx);
      requireSameOrigin(ctx);
      if (!services.auth) {
        throw new AgentAccessError("Human approval is unavailable.", 503, "auth_unavailable");
      }
      const token = services.auth.parseSessionToken(ctx.cookieHeader);
      const human = services.auth.resolve(token);
      if (!human) {
        throw new AgentAccessError(
          "Open Ruby High in this browser before approving an agent.",
          401,
          "human_session_required",
        );
      }
      const body = await readObjectBody(ctx);
      const credential = await services.access.approveDeviceCode(
        stringField(body, "userCode"),
        services.auth.stateKeyForRecord(human),
      );
      ctx.json(ctx.res, {
        ok: true,
        agent: publicAgentIdentity(credential),
        message: `${credential.agentName} may now return to its device.`,
      });
      return true;
    }

    if (ctx.method === "POST" && path === "/device/token") {
      requireJson(ctx);
      const body = await readObjectBody(ctx);
      const result = await services.access.exchangeDeviceCode(stringField(body, "deviceCode"));
      if (result.status === "authorization_pending") {
        ctx.json(ctx.res, { error: "authorization_pending" }, 428);
      } else if (result.status === "expired_token") {
        ctx.json(ctx.res, { error: "expired_token" }, 400);
      } else {
        ctx.json(ctx.res, {
          accessToken: result.accessToken,
          tokenType: result.tokenType,
          scope: result.scope,
          agent: publicAgentIdentity(result.credential),
        });
      }
      return true;
    }

    const launchCode = path.match(/^\/launch\/([^/]+)$/)?.[1];
    if (ctx.method === "GET" && launchCode) {
      const consumed = await services.access.consumeLaunch(decodeURIComponent(launchCode));
      setHeader(
        ctx.res,
        "Set-Cookie",
        services.access.buildViewerCookie(consumed.viewerToken, ctx.isSecure === true),
      );
      redirect(ctx.res, `${absoluteUrl(ctx, "/api/apps/ruby-high/viewer")}?role=agent`);
      return true;
    }

    const credential = requireCredential(ctx, services.access);
    services.access.requireScope(credential, "school:read");

    if (ctx.method === "GET" && path === "/me") {
      ctx.json(ctx.res, {
        ok: true,
        agent: publicAgentIdentity(credential),
        autonomy: credential.autonomy,
      });
      return true;
    }

    if (ctx.method === "GET" && path === "/state") {
      ctx.json(ctx.res, {
        ok: true,
        state: safeAgentState(services.ruby, credential),
      });
      return true;
    }

    if (ctx.method === "GET" && path === "/events") {
      const after = boundedNumber(ctx.url?.searchParams.get("after"), 0, Number.MAX_SAFE_INTEGER, 0);
      const limit = boundedNumber(ctx.url?.searchParams.get("limit"), 1, 100, 50);
      ctx.json(ctx.res, {
        ok: true,
        events: services.access.listEvents(credential.id, after, limit),
      });
      return true;
    }

    if (ctx.method === "POST" && path === "/launch") {
      services.access.requireScope(credential, "student:play");
      requireJson(ctx);
      const launchCodeValue = await services.access.createLaunch(credential.id);
      ctx.json(ctx.res, {
        ok: true,
        launchUrl: absoluteUrl(
          ctx,
          `${AGENT_API_PREFIX}/launch/${encodeURIComponent(launchCodeValue)}`,
        ),
        expiresIn: 120,
      }, 201);
      return true;
    }

    if (ctx.method === "POST" && path === "/revoke") {
      requireJson(ctx);
      await services.access.revokeCredential(credential.id);
      ctx.json(ctx.res, { ok: true, revoked: true });
      return true;
    }

    if (ctx.method === "POST" && path === "/autonomy") {
      services.access.requireScope(credential, "student:play");
      requireJson(ctx);
      const body = await readObjectBody(ctx);
      const autonomy = await services.access.setAutonomy(credential.id, {
        enabled: body.enabled === true,
        intervalMinutes: body.intervalMinutes as number | undefined,
        maxClassesPerRun: body.maxClassesPerRun as number | undefined,
        maxActionsPerRun: body.maxActionsPerRun as number | undefined,
        maxModelCallsPerRun: body.maxModelCallsPerRun as number | undefined,
        facultyAllowlist: stringArrayField(body, "facultyAllowlist"),
        publicPresence: body.publicPresence === true,
      });
      ctx.json(ctx.res, { ok: true, autonomy });
      return true;
    }

    if (ctx.method === "POST" && path === "/autonomy/run") {
      services.access.requireScope(credential, "student:play");
      requireJson(ctx);
      const body = await readObjectBody(ctx);
      await services.access.noteAutonomyRun(
        credential.id,
        (cleanOptionalString(body.stopReason) ?? "completed").slice(0, 160),
      );
      ctx.json(ctx.res, {
        ok: true,
        autonomy: services.access.getCredential(credential.id)?.autonomy ?? null,
      });
      return true;
    }

    if (ctx.method === "POST" && path === "/enroll") {
      services.access.requireScope(credential, "student:play");
      requireJson(ctx);
      const body = await readObjectBody(ctx);
      const requestId = requestIdField(body);
      const fingerprint = requestFingerprint("ENROLL", body);
      const cached = services.access.cachedAction(credential.id, requestId, fingerprint);
      if (cached) {
        ctx.json(ctx.res, { ...cached, replayed: true });
        return true;
      }
      const state = enrollAgent(services.ruby, credential, body);
      await services.ruby.flushSession(credential.stateKey);
      const response = {
        ok: true,
        action: "ENROLL",
        state: safeAgentState(services.ruby, credential, state),
      };
      await services.access.rememberAction(credential.id, requestId, fingerprint, response);
      await services.access.appendEvent(credential.id, "student.enrolled", {
        studentName: state.character?.name ?? credential.agentName,
      });
      ctx.json(ctx.res, response, 201);
      return true;
    }

    if (ctx.method === "POST" && path === "/actions") {
      services.access.requireScope(credential, "student:play");
      requireJson(ctx);
      const body = (await readObjectBody(ctx)) as AgentActionBody & Record<string, unknown>;
      const requestId = requestIdField(body);
      const type = actionTypeField(body.type);
      const input = objectValue(body.input);
      const fingerprint = requestFingerprint(type, input);
      const cached = services.access.cachedAction(credential.id, requestId, fingerprint);
      if (cached) {
        ctx.json(ctx.res, { ...cached, replayed: true });
        return true;
      }
      const before = services.ruby.getOrCreate(credential.stateKey);
      const ifVersion = optionalVersion(body.ifVersion);
      if (ifVersion != null && ifVersion !== before.updatedAt) {
        ctx.json(ctx.res, {
          error: "state_version_conflict",
          message: "Classroom state changed. Read /state and retry with a new requestId.",
          currentVersion: before.updatedAt,
        }, 409);
        return true;
      }
      const result = applyAgentAction({
        type,
        input,
        credential,
        ruby: services.ruby,
        chat: services.chat,
      });
      await services.ruby.flushSession(credential.stateKey);
      const response = {
        ok: true,
        action: type,
        result: result.result,
        state: safeAgentState(services.ruby, credential, result.state),
      };
      await services.access.rememberAction(credential.id, requestId, fingerprint, response);
      await services.access.appendEvent(credential.id, `action.${type.toLowerCase()}`, {
        requestId,
        stateVersion: result.state.updatedAt,
      });
      ctx.json(ctx.res, response);
      return true;
    }

    ctx.error(ctx.res, "Agent endpoint not found.", 404);
    return true;
  } catch (error) {
    if (error instanceof AgentAccessError) {
      ctx.json(ctx.res, { error: error.code, message: error.message }, error.status);
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    ctx.json(ctx.res, { error: "agent_request_failed", message }, 400);
    return true;
  }
}

function applyAgentAction(args: {
  type: AgentActionType;
  input: Record<string, unknown>;
  credential: AgentCredential;
  ruby: RubyHighService;
  chat: ChatService | null;
}): { state: QuizState; result: Record<string, unknown> } {
  const { type, input, credential, ruby, chat } = args;
  const sessionId = credential.stateKey;
  if (type === "ENROLL") {
    const state = enrollAgent(ruby, credential, input);
    return { state, result: { enrolled: true } };
  }
  let state = ruby.getOrCreate(sessionId);
  if (!state.character) {
    throw new AgentAccessError(
      "Enroll the agent before attending class.",
      409,
      "enrollment_required",
    );
  }
  if (type === "CHECK_PROGRESS") {
    const facultyId = cleanOptionalString(input.faculty) ?? state.faculty;
    return {
      state,
      result: { progress: ruby.courseProgress(sessionId, facultyId) },
    };
  }
  if (type === "CHANGE_CLASS") {
    const requested = cleanOptionalString(input.faculty) ?? "guest";
    const facultyId = prepareRequestedFaculty(ruby, sessionId, requested);
    state = ruby.setFaculty(sessionId, facultyId);
    return { state, result: { faculty: state.faculty } };
  }
  if (type === "ATTEND") {
    const requested = cleanOptionalString(input.faculty) ?? "guest";
    const facultyId = prepareRequestedFaculty(ruby, sessionId, requested);
    state = ruby.getOrCreate(sessionId);
    if (state.phase === "asking") {
      return {
        state,
        result: { attended: false, reason: "question-already-open" },
      };
    }
    if (state.current) state = ruby.clearBoard(sessionId);
    if (state.faculty !== facultyId) state = ruby.setFaculty(sessionId, facultyId);
    state = ruby.pickAndPose(sessionId, { faculty: facultyId });
    return { state, result: { attended: true, faculty: state.faculty } };
  }
  if (type === "ANSWER") {
    const answerText = cleanOptionalString(input.answerText);
    if (answerText) {
      state = ruby.submitTextAnswer(sessionId, answerText);
    } else {
      const picked = String(input.picked ?? "").toUpperCase() as Choice;
      if (!["A", "B", "C", "D"].includes(picked)) {
        throw new AgentAccessError(
          "ANSWER needs picked=A|B|C|D or answerText.",
          400,
          "invalid_answer",
        );
      }
      state = ruby.submitAnswer(sessionId, picked);
    }
    return {
      state,
      result: {
        answered: true,
        wasCorrect: state.lastReveal?.questionType === "story-choice"
          ? null
          : state.lastReveal?.wasCorrect ?? null,
      },
    };
  }
  if (type === "SET_PUBLIC_PRESENCE") {
    if (!credential.scopes.includes("world:participate")) {
      throw new AgentAccessError(
        "Missing required scope: world:participate.",
        403,
        "insufficient_scope",
      );
    }
    const visible = input.visible === true;
    if (visible) {
      const review = publicWorldNameReview(state.character.name);
      if (!review.ok) {
        throw new AgentAccessError(
          "Choose a school-appropriate student name before enabling public presence.",
          400,
          "unsafe_student_name",
        );
      }
    }
    state.character.publicWorldVisible = visible;
    state.character.socialConsent = visible;
    state.updatedAt = Date.now();
    return { state, result: { publicWorldVisible: visible } };
  }
  if (type === "LOUNGE") {
    if (!credential.scopes.includes("world:participate")) {
      throw new AgentAccessError(
        "Missing required scope: world:participate.",
        403,
        "insufficient_scope",
      );
    }
    if (state.character.publicWorldVisible !== true || state.character.socialConsent === false) {
      throw new AgentAccessError(
        "Enable public presence before joining the shared lounge.",
        409,
        "public_presence_required",
      );
    }
    if (state.current && state.phase === "asking") {
      throw new AgentAccessError(
        "Answer the open class question before visiting the lounge.",
        409,
        "question_already_open",
      );
    }
    if (!chat) {
      throw new AgentAccessError(
        "The shared lounge is unavailable right now.",
        503,
        "lounge_unavailable",
      );
    }
    const line = cleanOptionalString(input.line)?.slice(0, 280);
    if (!line) {
      throw new AgentAccessError(
        "LOUNGE needs a short line.",
        400,
        "invalid_lounge_line",
      );
    }
    const authorName = state.character.name;
    state = ruby.setFaculty(sessionId, "lounge");
    chat.appendPlayerMessage({
      sessionToken: `agent:${credential.id}`,
      faculty: "lounge",
      authorName,
    }, line);
    return { state, result: { lounged: true, line } };
  }
  throw new AgentAccessError("Unsupported agent action.", 400, "invalid_action");
}

function enrollAgent(
  ruby: RubyHighService,
  credential: AgentCredential,
  input: Record<string, unknown>,
): QuizState {
  const current = ruby.getOrCreate(credential.stateKey);
  if (current.character) return current;
  const playbookId = cleanOptionalString(input.playbookId) ?? "outsider";
  const playbook = playbookById(playbookId);
  if (!playbook || !PLAYBOOKS.some((candidate) => candidate.id === playbookId)) {
    throw new AgentAccessError("Unknown student style.", 400, "invalid_playbook");
  }
  const name = (cleanOptionalString(input.name) ?? credential.agentName).slice(0, 64);
  const review = publicWorldNameReview(name);
  if (!review.ok) {
    throw new AgentAccessError(
      "Choose a school-appropriate student name.",
      400,
      "unsafe_student_name",
    );
  }
  const state = ruby.createCharacter(credential.stateKey, {
    name,
    playbookId,
    stats: { ...playbook.suggestedStats },
    arcAnswer:
      cleanOptionalString(input.arcAnswer) ??
      "I came to learn how agents earn trust through clear boundaries.",
    personality:
      cleanOptionalString(input.personality) ??
      "Curious, cooperative, and careful about the authority behind every tool call.",
    flavorQuote:
      cleanOptionalString(input.flavorQuote) ??
      "Show me the trace, then show me the lesson.",
    creationMethod: "agent",
    referralRef: agentReferralRef(input),
  });
  if (state.character) {
    state.character.publicWorldVisible = false;
    state.character.socialConsent = false;
    state.updatedAt = Date.now();
  }
  return state;
}

/**
 * Aggregate referral attribution for an agent enrollment. A plugin may send its
 * own campaign `ref`; every agent enrollment is attributed to the elizaOS
 * channel by default so the funnel never loses this cohort to "unattributed".
 */
export const DEFAULT_AGENT_REFERRAL_REF = "elizaos-agent";

function agentReferralRef(input: Record<string, unknown>): string {
  const supplied = cleanOptionalString(input.ref);
  if (!supplied) return DEFAULT_AGENT_REFERRAL_REF;
  const normalized = supplied.trim().slice(0, 120);
  return /^[A-Za-z0-9._:-]+$/.test(normalized) ? normalized : DEFAULT_AGENT_REFERRAL_REF;
}

function prepareRequestedFaculty(
  ruby: RubyHighService,
  sessionId: string,
  requested: string,
): string {
  if (
    requested === "eliza" ||
    requested === "elizaos-systems-lab" ||
    requested === ELIZAOS_SYSTEMS_LAB_PACK_ID
  ) {
    ruby.setGuestPackOverrideForSession(sessionId, ELIZAOS_SYSTEMS_LAB_PACK_ID);
    return "guest";
  }
  return requested;
}

export function safeAgentState(
  ruby: RubyHighService,
  credential: AgentCredential,
  providedState?: QuizState,
): Record<string, unknown> {
  const state = providedState ?? ruby.getOrCreate(credential.stateKey);
  const current = state.current;
  const reveal = state.phase === "revealed" ? state.lastReveal : null;
  const guest = guestPackForSession(state);
  const roster = facultyForSession(state).map((faculty) => ({
    id: faculty.id,
    displayName: faculty.displayName,
    shortName: faculty.shortName,
    subjects: faculty.subjects,
    bio: faculty.bio,
    assetTeacherId: faculty.assetTeacherId ?? null,
  }));
  const courses = coursesForSession(state).map((course) => ({
    id: course.id,
    title: course.title,
    facultyId: course.facultyId,
    roomId: course.roomId,
    subjects: course.subjects,
  }));
  const nextActions = safeAgentNextActions(state, credential);
  return {
    version: state.updatedAt,
    phase: state.phase,
    status: state.status,
    student: state.character
      ? {
          name: state.character.name,
          playbookId: state.character.playbookId,
          currentGrade: state.currentGrade,
          publicWorldVisible: state.character.publicWorldVisible === true,
          personality: state.character.personality,
          arcAnswer: state.character.arcAnswer,
          flavorQuote: state.character.flavorQuote ?? null,
        }
      : null,
    faculty: state.faculty,
    subject: state.subject,
    score: {
      correct: state.score.correct,
      total: state.score.total,
      points: state.score.points,
      possible: state.score.possible,
    },
    question: current
      ? {
          id: current.id,
          prompt: current.prompt,
          type: current.type ?? "multiple-choice",
          options: current.options ?? null,
          subject: current.subject ?? null,
          difficulty: current.difficulty ?? null,
          media: current.media ?? [],
          rubric: current.rubric ?? null,
          opinionPurpose: current.opinionPurpose ?? null,
        }
      : null,
    reveal: reveal
      ? {
          picked: reveal.picked,
          correct: reveal.correct,
          wasCorrect: reveal.wasCorrect,
          explanation: reveal.explanation ?? null,
          answerText: reveal.answerText ?? null,
        }
      : null,
    courses,
    facultyRoster: roster,
    activeGuest: guest
      ? {
          id: guest.id,
          name: guest.name,
          description: guest.description,
          curriculum: guest.curriculum ?? null,
        }
      : null,
    autonomy: credential.autonomy,
    nextActions,
  };
}

function safeAgentNextActions(
  state: QuizState,
  credential: AgentCredential,
): AgentActionType[] {
  if (!state.character) return ["ENROLL"];
  if (state.current && state.phase === "asking") return ["ANSWER", "CHECK_PROGRESS"];
  return [
    "ATTEND",
    "CHANGE_CLASS",
    "CHECK_PROGRESS",
    ...(credential.scopes.includes("world:participate")
      ? [
          "SET_PUBLIC_PRESENCE" as const,
          ...(state.character.publicWorldVisible === true && state.character.socialConsent !== false
            ? ["LOUNGE" as const]
            : []),
        ]
      : []),
  ];
}

function requireCredential(ctx: RouteContext, access: AgentAccessService): AgentCredential {
  const credential = access.authenticateBearer(ctx.authorizationHeader);
  if (!credential) {
    throw new AgentAccessError("A valid agent bearer token is required.", 401, "invalid_token");
  }
  return credential;
}

function publicAgentIdentity(credential: AgentCredential): Record<string, unknown> {
  return {
    id: credential.id,
    agentName: credential.agentName,
    scopes: credential.scopes,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt,
  };
}

function actionTypeField(value: unknown): AgentActionType {
  const type = String(value ?? "").trim().toUpperCase() as AgentActionType;
  if (
    ![
      "ENROLL",
      "ATTEND",
      "ANSWER",
      "CHANGE_CLASS",
      "CHECK_PROGRESS",
      "SET_PUBLIC_PRESENCE",
      "LOUNGE",
    ].includes(type)
  ) {
    throw new AgentAccessError("Unknown action type.", 400, "invalid_action");
  }
  return type;
}

function requestIdField(body: Record<string, unknown>): string {
  const requestId = stringField(body, "requestId");
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) {
    throw new AgentAccessError(
      "requestId must be 8-128 URL-safe characters.",
      400,
      "invalid_request_id",
    );
  }
  return requestId;
}

function requestFingerprint(type: string, input: Record<string, unknown>): string {
  return createHash("sha256")
    .update(type)
    .update("\0")
    .update(JSON.stringify(input))
    .digest("hex");
}

function optionalVersion(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new AgentAccessError("ifVersion must be a positive integer.", 400, "invalid_version");
  }
  return number;
}

async function readObjectBody(ctx: RouteContext): Promise<Record<string, unknown>> {
  const body = await ctx.readJsonBody().catch(() => {
    throw new AgentAccessError("Request body must be valid JSON.", 400, "invalid_json");
  });
  return objectValue(body);
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentAccessError("Request body must be a JSON object.", 400, "invalid_request");
  }
  return value as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, name: string): string {
  const value = cleanOptionalString(body[name]);
  if (!value) {
    throw new AgentAccessError(`${name} is required.`, 400, "invalid_request");
  }
  return value;
}

function stringArrayField(
  body: Record<string, unknown>,
  name: string,
): string[] | undefined {
  const value = body[name];
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new AgentAccessError(`${name} must be an array.`, 400, "invalid_request");
  }
  return value.map(String);
}

function cleanOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireJson(ctx: RouteContext): void {
  const raw = Array.isArray(ctx.contentTypeHeader)
    ? ctx.contentTypeHeader[0] ?? ""
    : ctx.contentTypeHeader ?? "";
  if (raw && !raw.toLowerCase().startsWith("application/json")) {
    throw new AgentAccessError(
      "Agent mutations must be sent as JSON.",
      415,
      "unsupported_media_type",
    );
  }
}

function requireSameOrigin(ctx: RouteContext): void {
  const raw = Array.isArray(ctx.originHeader)
    ? ctx.originHeader[0] ?? ""
    : ctx.originHeader ?? "";
  if (!raw) return;
  const expected = absoluteUrl(ctx, "/");
  try {
    if (new URL(raw).origin !== new URL(expected).origin) {
      throw new AgentAccessError("Cross-origin approval rejected.", 403, "origin_rejected");
    }
  } catch (error) {
    if (error instanceof AgentAccessError) throw error;
    throw new AgentAccessError("Invalid Origin header.", 403, "origin_rejected");
  }
}

function absoluteUrl(ctx: RouteContext, path: string): string {
  if (ctx.callbackUrlBuilder) return ctx.callbackUrlBuilder(path);
  if (ctx.url) return new URL(path, ctx.url).toString();
  return path;
}

function boundedNumber(
  value: string | null | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function setHeader(res: unknown, name: string, value: string): void {
  (res as { setHeader?: (header: string, headerValue: string) => void }).setHeader?.(
    name,
    value,
  );
}

function redirect(res: unknown, location: string): void {
  const response = res as {
    statusCode?: number;
    setHeader?: (name: string, value: string) => void;
    end?: (body?: string) => void;
  };
  response.statusCode = 302;
  response.setHeader?.("Location", location);
  response.setHeader?.("Cache-Control", "no-store");
  response.end?.();
}

function sendHtml(res: unknown, html: string): void {
  const response = res as {
    statusCode?: number;
    setHeader?: (name: string, value: string) => void;
    end?: (body?: string) => void;
  };
  response.statusCode = 200;
  response.setHeader?.("Content-Type", "text/html; charset=utf-8");
  response.setHeader?.("Cache-Control", "no-store");
  response.setHeader?.(
    "Content-Security-Policy",
    "default-src 'none'; img-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  response.end?.(html);
}

function renderConnectPage(userCode: string): string {
  const safeCode = escapeHtml(userCode.toUpperCase().replace(/[^A-F0-9-]/g, "").slice(0, 9));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connect an agent · Ruby High</title>
  <style>
    :root{color-scheme:dark;font-family:ui-rounded,system-ui,sans-serif;background:#111827;color:#f8fafc}
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at top,#164e63,#111827 55%)}
    main{width:min(480px,calc(100vw - 40px));padding:32px;border:1px solid #2dd4bf55;border-radius:24px;background:#0f172ae8;box-shadow:0 24px 80px #0008}
    .teacher{display:flex;gap:18px;align-items:center}.teacher img{width:92px;height:92px;border-radius:50%;object-fit:cover;background:#fce7e7;border:3px solid #2dd4bf}
    h1{font-size:28px;margin:0 0 6px}p{color:#cbd5e1;line-height:1.5}
    label{display:block;margin:24px 0 8px;font-weight:700}input{box-sizing:border-box;width:100%;padding:14px 16px;border:1px solid #475569;border-radius:12px;background:#020617;color:white;font:700 22px/1 monospace;text-transform:uppercase;letter-spacing:.12em}
    button{width:100%;margin-top:18px;padding:14px;border:0;border-radius:12px;background:#14b8a6;color:#042f2e;font-weight:900;font-size:16px;cursor:pointer}
    button:disabled{opacity:.55;cursor:wait}.note{font-size:13px}.status{min-height:24px;color:#5eead4;font-weight:700}
  </style>
</head>
<body>
  <main>
    <div class="teacher">
      <img src="/api/apps/ruby-high/assets/teachers/eliza-face.png" alt="Eliza">
      <div><h1>Connect an AI agent</h1><p>The agent gets its own student account. It cannot act until you allow it.</p></div>
    </div>
    <label for="code">Code shown by the agent</label>
    <input id="code" value="${safeCode}" maxlength="9" autocomplete="one-time-code" placeholder="ABCD-1234">
    <p class="note">Approval lets the agent read school information and play as a student. The agent stays hidden from shared school activity unless you turn on sharing. If this browser has not entered Ruby High yet, <a href="/api/apps/ruby-high/viewer" target="_blank" rel="noopener">open the school</a> first.</p>
    <button id="approve">Approve agent</button>
    <p id="status" class="status" role="status"></p>
  </main>
  <script>
    const button=document.getElementById("approve");
    const status=document.getElementById("status");
    button.addEventListener("click",async()=>{
      button.disabled=true;status.textContent="Approving…";
      try{
        const response=await fetch("${AGENT_API_PREFIX}/device/approve",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userCode:document.getElementById("code").value})});
        const body=await response.json();
        if(!response.ok)throw new Error(body.message||body.error||"Approval failed.");
        status.textContent=body.message||"Approved. Return to the agent.";
        button.textContent="Approved";
      }catch(error){status.textContent="Could not approve the agent. Check the code and try again.";button.disabled=false}
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function agentScopeForAction(type: AgentActionType): AgentScope {
  return type === "SET_PUBLIC_PRESENCE" || type === "LOUNGE"
    ? "world:participate"
    : "student:play";
}
