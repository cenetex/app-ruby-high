import { randomBytes } from "node:crypto";
import { AuthService, type AuthRecord } from "./services/auth-service.js";
import { RubyHighService } from "./services/ruby-high-service.js";
import { log } from "./services/logger.js";
import {
  availablePacksForSession,
  coursesForPack,
  getPackByIdForSession,
  registerPack,
} from "./content/registry.js";
import type { ContentPack } from "./content/types.js";
import type { BankedQuestion } from "./types.js";
import {
  connectedTeacherChannelName,
  generateConnectedTeacherQuestionBankFromMaterials,
  packForConnectedTeacher,
  type ConnectedTeacherCandidate,
} from "./services/teacher-providers.js";
import {
  getDefaultRatiTeacherAvatarProvider,
  normalizeWalletAddress,
  ratiAvatarToConnectedTeacherCandidate,
  type RatiTeacherAvatarProvider,
  type RatiUserAvatar,
} from "./services/rati-avatar-provider.js";
import type { StoredTeacherRecord } from "./services/state-store.js";

export interface TeacherCatalogRouteContext {
  method: string;
  pathname: string;
  url?: URL;
  res: unknown;
  cookieHeader?: string | null;
  authorizationHeader?: string | string[] | null;
  walletAddressHeader?: string | string[] | null;
  error: (response: unknown, message: string, status?: number) => void;
  json: (response: unknown, data: unknown, status?: number) => void;
  readJsonBody: () => Promise<unknown>;
}

export interface TeacherCatalogRouteDeps {
  auth: AuthService;
  ruby: RubyHighService;
  sessionIdFor: (cookieHeader?: string | null) => string;
  avatarProvider?: RatiTeacherAvatarProvider;
  generateQuestions?: (
    candidate: ConnectedTeacherCandidate,
    materials: string,
    opts: { questionCount?: number },
  ) => Promise<BankedQuestion[]>;
}

const TEACHER_PREFIX = "/api/apps/ruby-high/teachers";
const DEFAULT_QUESTION_COUNT = 18;
const MAX_MATERIAL_CHARS = 80_000;

export async function handleTeacherCatalogRoutes(
  ctx: TeacherCatalogRouteContext,
  deps: TeacherCatalogRouteDeps,
): Promise<boolean> {
  if (!ctx.pathname.startsWith(TEACHER_PREFIX)) return false;
  const sub = ctx.pathname.slice(TEACHER_PREFIX.length) || "/";
  const provider = deps.avatarProvider ?? getDefaultRatiTeacherAvatarProvider();
  const generateQuestions = deps.generateQuestions ?? generateConnectedTeacherQuestionBankFromMaterials;
  const token = deps.auth.parseSessionToken(ctx.cookieHeader);
  const authRecord = deps.auth.resolve(token);
  const sessionId = deps.sessionIdFor(ctx.cookieHeader);

  if (ctx.method === "GET" && sub === "/") {
    const teachers = await deps.ruby.listTeacherRecords();
    ctx.json(ctx.res, {
      teachers: teachers
        .filter((teacher) => isPublicTeacher(teacher) || isOwner(teacher, authRecord))
        .sort((a, b) => (b.publishedAt ?? b.updatedAt) - (a.publishedAt ?? a.updatedAt))
        .map((teacher) => teacherSummary(teacher, authRecord)),
    });
    return true;
  }

  if (ctx.method === "GET" && sub === "/mine") {
    const record = requireAuth(ctx, authRecord, token);
    if (!record) return true;
    const teachers = await deps.ruby.listTeacherRecords();
    ctx.json(ctx.res, {
      teachers: teachers
        .filter((teacher) => teacher.creatorUserId === record.userId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((teacher) => teacherSummary(teacher, record)),
    });
    return true;
  }

  if (ctx.method === "GET" && sub === "/me/avatars") {
    const record = requireAuth(ctx, authRecord, token);
    if (!record) return true;
    if (!provider.configured()) {
      ctx.error(ctx.res, "RATi avatar provider is not configured.", 503);
      return true;
    }
    try {
      const walletAddress = walletAddressFromRequest(ctx, null);
      const avatars = await provider.listUserAvatars(walletAddress);
      ctx.json(ctx.res, {
        walletAddress,
        avatars: avatars.map(avatarSummary),
      });
    } catch (err) {
      log.error("teacher-catalog.avatars-failed", err, { userId: record.userId });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 400);
    }
    return true;
  }

  if (ctx.method === "POST" && sub === "/drafts") {
    const record = requireAuth(ctx, authRecord, token);
    if (!record) return true;
    if (!provider.configured()) {
      ctx.error(ctx.res, "RATi avatar provider is not configured.", 503);
      return true;
    }
    const body = await readBody(ctx);
    try {
      const walletAddress = walletAddressFromRequest(ctx, body);
      const materials = bodyString(body, "materials") || bodyString(body, "courseMaterials") || bodyString(body, "markdown") || bodyString(body, "text");
      if (!materials.trim()) {
        ctx.error(ctx.res, "Course materials are required.", 400);
        return true;
      }
      if (materials.length > MAX_MATERIAL_CHARS) {
        ctx.error(ctx.res, `Course materials must be ${MAX_MATERIAL_CHARS} characters or less.`, 413);
        return true;
      }
      const avatar = await avatarForDraft(provider, walletAddress, body);
      const teacherId = newTeacherId();
      const questionCount = questionCountFrom(bodyValue(body, "questionCount"));
      const candidate = candidateWithDraftOverrides(ratiAvatarToConnectedTeacherCandidate(avatar), body);
      const questions = await generateQuestions(candidate, materials, { questionCount });
      const pack = teacherPackFromCandidate(candidate, questions, {
        teacherId,
        description: bodyString(body, "description") || candidate.description,
        channelName: bodyString(body, "channelName"),
        materials,
      });
      registerPack(pack, sessionId);
      await deps.ruby.persistImportedPack(sessionId, pack);
      deps.ruby.setActivePackForSession(sessionId, pack.id);

      const now = Date.now();
      let teacher: StoredTeacherRecord = {
        id: teacherId,
        creatorUserId: record.userId,
        creatorSessionId: sessionId,
        creatorWallet: walletAddress,
        ratiAvatarId: avatar.id,
        ratiModel: avatar.model,
        displayName: candidate.name,
        description: bodyString(body, "description") || candidate.description,
        ...(candidate.profileImage ? { profileImageUrl: candidate.profileImage } : {}),
        ...(cleanHttpUrl(bodyString(body, "socialsUrl")) ? { socialsUrl: cleanHttpUrl(bodyString(body, "socialsUrl")) } : {}),
        materials,
        subjects: subjectsFromQuestions(questions),
        questionCount: questions.length,
        packId: pack.id,
        visibility: "private",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        pack,
      };

      const publish = bodyValue(body, "publish") === true;
      if (publish) {
        teacher = await publishTeacher({
          teacher,
          visibility: visibilityFrom(bodyValue(body, "visibility"), "public"),
          provider,
          ruby: deps.ruby,
        });
      } else {
        await deps.ruby.saveTeacherRecord(teacher);
      }

      await deps.ruby.flushSession(sessionId);
      log.event("teacher-catalog.draft-created", {
        sessionId,
        userId: record.userId,
        teacherId,
        packId: pack.id,
        questionCount: questions.length,
        published: publish,
      });
      ctx.json(ctx.res, {
        ok: true,
        teacher: teacherSummary(teacher, record),
        pack: packSummary(pack),
      }, 201);
    } catch (err) {
      log.error("teacher-catalog.create-failed", err, { sessionId, userId: record.userId });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err) ?? 502);
    }
    return true;
  }

  const publishMatch = sub.match(/^\/([^/]+)\/publish$/);
  if (ctx.method === "POST" && publishMatch?.[1]) {
    const record = requireAuth(ctx, authRecord, token);
    if (!record) return true;
    if (!provider.configured()) {
      ctx.error(ctx.res, "RATi avatar provider is not configured.", 503);
      return true;
    }
    const body = await readBody(ctx);
    const teacher = await findTeacher(deps.ruby, publishMatch[1]);
    if (!teacher) {
      ctx.error(ctx.res, "Unknown teacher.", 404);
      return true;
    }
    if (teacher.creatorUserId !== record.userId) {
      ctx.error(ctx.res, "Only the creator can publish this teacher.", 403);
      return true;
    }
    try {
      const published = await publishTeacher({
        teacher,
        visibility: visibilityFrom(bodyValue(body, "visibility"), "public"),
        provider,
        ruby: deps.ruby,
      });
      log.event("teacher-catalog.published", {
        userId: record.userId,
        teacherId: teacher.id,
        visibility: published.visibility,
      });
      ctx.json(ctx.res, {
        ok: true,
        teacher: teacherSummary(published, record),
        pack: packSummary(published.pack),
      });
    } catch (err) {
      log.error("teacher-catalog.publish-failed", err, { userId: record.userId, teacherId: teacher.id });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err) ?? 502);
    }
    return true;
  }

  const activateMatch = sub.match(/^\/([^/]+)\/activate$/);
  if (ctx.method === "POST" && activateMatch?.[1]) {
    const record = requireAuth(ctx, authRecord, token);
    if (!record) return true;
    const teacher = await findTeacher(deps.ruby, activateMatch[1]);
    if (!teacher) {
      ctx.error(ctx.res, "Unknown teacher.", 404);
      return true;
    }
    if (!isUsableTeacher(teacher, record)) {
      ctx.error(ctx.res, "This teacher is not published.", 403);
      return true;
    }
    try {
      if (teacher.status === "published") {
        await deps.ruby.persistPublicTeacherPack(teacher.pack);
      } else {
        registerPack(teacher.pack, sessionId);
        await deps.ruby.persistImportedPack(sessionId, teacher.pack);
      }
      const target = getPackByIdForSession(teacher.packId, sessionId);
      if (!target) throw new Error(`Teacher pack ${teacher.packId} is not available.`);
      deps.ruby.setActivePackForSession(sessionId, teacher.packId);
      await deps.ruby.flushSession(sessionId);
      log.event("teacher-catalog.activated", {
        sessionId,
        userId: record.userId,
        teacherId: teacher.id,
        packId: teacher.packId,
      });
      ctx.json(ctx.res, {
        ok: true,
        teacher: teacherSummary(teacher, record),
        pack: packSummary(target),
        available_packs: availablePacksForSession(sessionId).map(packSummary),
      });
    } catch (err) {
      log.error("teacher-catalog.activate-failed", err, { userId: record.userId, teacherId: teacher.id });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 500);
    }
    return true;
  }

  return false;
}

async function publishTeacher(args: {
  teacher: StoredTeacherRecord;
  visibility: "public" | "unlisted";
  provider: RatiTeacherAvatarProvider;
  ruby: RubyHighService;
}): Promise<StoredTeacherRecord> {
  if (!args.teacher.creatorWallet) throw new Error("Teacher is missing creator wallet.");
  await args.provider.createTeacherGrant({
    walletAddress: args.teacher.creatorWallet,
    avatarId: args.teacher.ratiAvatarId,
    visibility: args.visibility,
  });
  const now = Date.now();
  const published: StoredTeacherRecord = {
    ...args.teacher,
    visibility: args.visibility,
    status: "published",
    updatedAt: now,
    publishedAt: args.teacher.publishedAt ?? now,
  };
  await args.ruby.persistPublicTeacherPack(published.pack, {
    previousOwnerSessionId: args.teacher.creatorSessionId,
  });
  await args.ruby.saveTeacherRecord(published);
  return published;
}

async function avatarForDraft(
  provider: RatiTeacherAvatarProvider,
  walletAddress: string,
  body: Record<string, unknown>,
): Promise<RatiUserAvatar> {
  const avatarId = bodyString(body, "avatarId") || bodyString(body, "ratiAvatarId");
  if (avatarId) {
    const avatars = await provider.listUserAvatars(walletAddress);
    const avatar = avatars.find((entry) => entry.id === avatarId || entry.model === avatarId);
    if (!avatar) throw new Error("That RATi avatar is not linked to this wallet.");
    return avatar;
  }

  const name = bodyString(body, "name") || bodyString(body, "displayName");
  if (!name) throw new Error("Teacher name is required when creating a new avatar.");
  return provider.createTeacherAvatar({
    walletAddress,
    name,
    description: bodyString(body, "description"),
    persona: bodyString(body, "persona") || bodyString(body, "systemPrompt"),
    profileImageUrl: cleanHttpUrl(bodyString(body, "profileImageUrl")) || null,
  });
}

function teacherPackFromCandidate(
  candidate: ConnectedTeacherCandidate,
  questions: BankedQuestion[],
  opts: { teacherId: string; description: string; channelName?: string; materials: string },
): ContentPack {
  const pack = packForConnectedTeacher(candidate, questions, {
    channelName: opts.channelName || connectedTeacherChannelName(null, candidate.name || candidate.root || candidate.model),
  });
  const courseMaterials = opts.materials.trim().slice(0, 6000);
  return {
    ...pack,
    id: `teacher:${opts.teacherId}`,
    description: opts.description || pack.description,
    version: "1.0.0",
    faculty: pack.faculty.map((faculty) => ({
      ...faculty,
      systemPrompt: courseMaterials
        ? [
            faculty.systemPrompt,
            "Course materials for this Ruby High teacher:",
            courseMaterials,
          ].join("\n\n")
        : faculty.systemPrompt,
    })),
  };
}

function candidateWithDraftOverrides(
  candidate: ConnectedTeacherCandidate,
  body: Record<string, unknown>,
): ConnectedTeacherCandidate {
  const displayName = bodyString(body, "displayName") || bodyString(body, "name");
  const description = bodyString(body, "description");
  const profileImageUrl = cleanHttpUrl(bodyString(body, "profileImageUrl"));
  return {
    ...candidate,
    ...(displayName ? { name: displayName } : {}),
    ...(description ? { description } : {}),
    ...(profileImageUrl ? { profileImage: profileImageUrl } : {}),
  };
}

function requireAuth(
  ctx: TeacherCatalogRouteContext,
  record: AuthRecord | null,
  token: string | null,
): AuthRecord | null {
  if (!record || !token) {
    ctx.error(ctx.res, "Sign in to manage teachers.", 401);
    return null;
  }
  return record;
}

async function readBody(ctx: TeacherCatalogRouteContext): Promise<Record<string, unknown>> {
  const body = await ctx.readJsonBody().catch(() => ({}));
  return body && typeof body === "object" ? body as Record<string, unknown> : {};
}

async function findTeacher(ruby: RubyHighService, teacherId: string): Promise<StoredTeacherRecord | null> {
  return (await ruby.listTeacherRecords()).find((teacher) => teacher.id === teacherId) ?? null;
}

function teacherSummary(teacher: StoredTeacherRecord, viewer: AuthRecord | null) {
  const owner = isOwner(teacher, viewer);
  return {
    id: teacher.id,
    displayName: teacher.displayName,
    description: teacher.description,
    ...(teacher.profileImageUrl ? { profileImageUrl: teacher.profileImageUrl } : {}),
    ...(teacher.socialsUrl ? { socialsUrl: teacher.socialsUrl } : {}),
    subjects: teacher.subjects,
    questionCount: teacher.questionCount,
    packId: teacher.packId,
    ratiAvatarId: teacher.ratiAvatarId,
    ratiModel: teacher.ratiModel,
    status: teacher.status,
    visibility: teacher.visibility,
    createdAt: teacher.createdAt,
    updatedAt: teacher.updatedAt,
    ...(teacher.publishedAt ? { publishedAt: teacher.publishedAt } : {}),
    owner,
  };
}

function avatarSummary(avatar: RatiUserAvatar) {
  return {
    id: avatar.id,
    model: avatar.model,
    name: avatar.name,
    description: avatar.description,
    ...(avatar.profileImage ? { profileImageUrl: avatar.profileImage } : {}),
    supportsTools: avatar.supportsTools,
  };
}

function packSummary(pack: ContentPack) {
  const countFacultyCards = (f: ContentPack["faculty"][number]) =>
    (f.sourceCards?.length ?? 0) + f.questions.filter((q) => !q.sourceCardId).length;
  const questionCount = pack.faculty.reduce((s, f) => s + countFacultyCards(f), 0);
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    version: pack.version,
    faculty_count: pack.faculty.length,
    question_count: questionCount,
    courses: coursesForPack(pack),
    faculty: pack.faculty.map((f) => ({
      id: f.id,
      displayName: f.displayName,
      shortName: f.shortName,
      ...(f.assetTeacherId ? { assetTeacherId: f.assetTeacherId } : {}),
      ...(f.profileImageUrl ? { profileImageUrl: f.profileImageUrl } : {}),
      subjects: f.subjects,
      questionCount: countFacultyCards(f),
    })),
  };
}

function walletAddressFromRequest(ctx: TeacherCatalogRouteContext, body: Record<string, unknown> | null): string {
  const header = firstHeader(ctx.walletAddressHeader);
  const raw =
    header ||
    bodyString(body, "walletAddress") ||
    bodyString(body, "wallet") ||
    ctx.url?.searchParams.get("walletAddress") ||
    ctx.url?.searchParams.get("wallet") ||
    "";
  return normalizeWalletAddress(raw);
}

function firstHeader(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

function bodyValue(body: Record<string, unknown> | null, key: string): unknown {
  return body ? body[key] : undefined;
}

function bodyString(body: Record<string, unknown> | null, key: string): string {
  const value = bodyValue(body, key);
  return typeof value === "string" ? value.trim() : "";
}

function cleanHttpUrl(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function questionCountFrom(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_QUESTION_COUNT;
  return Math.max(0, Math.min(40, Math.floor(n)));
}

function visibilityFrom(value: unknown, fallback: "public" | "unlisted"): "public" | "unlisted" {
  return value === "unlisted" ? "unlisted" : value === "public" ? "public" : fallback;
}

function subjectsFromQuestions(questions: BankedQuestion[]): string[] {
  const subjects = Array.from(new Set(questions.map((q) => q.subject).filter(Boolean)));
  return subjects.length > 0 ? subjects : ["open study"];
}

function isPublicTeacher(teacher: StoredTeacherRecord): boolean {
  return teacher.status === "published" && teacher.visibility === "public";
}

function isUsableTeacher(teacher: StoredTeacherRecord, viewer: AuthRecord): boolean {
  return teacher.creatorUserId === viewer.userId || (teacher.status === "published" && teacher.visibility !== "private");
}

function isOwner(teacher: StoredTeacherRecord, viewer: AuthRecord | null): boolean {
  return !!viewer && teacher.creatorUserId === viewer.userId;
}

function newTeacherId(): string {
  return `teacher_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function clientErrorStatus(err: unknown): number | null {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("valid wallet address") ||
    message.includes("Teacher name is required") ||
    message.includes("Course materials are required")
  ) {
    return 400;
  }
  if (message.includes("not linked to this wallet") || message.includes("missing creator wallet")) return 403;
  return null;
}
