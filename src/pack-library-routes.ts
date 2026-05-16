import { randomBytes } from "node:crypto";
import { AuthService, type AuthRecord } from "./services/auth-service.js";
import { RubyHighService } from "./services/ruby-high-service.js";
import { log } from "./services/logger.js";
import {
  ORIGINAL_PACK_ID,
  availablePacksForSession,
  coursesForPack,
  getActivePack,
  getPackByIdForSession,
} from "./content/registry.js";
import type { ContentPack, PackSourceCard } from "./content/types.js";
import type { BankedQuestion, CharacterStats, Difficulty } from "./types.js";
import type {
  StoredDraftContentPackRecord,
  StoredDraftTeacherRecord,
  StoredPackInstallationRecord,
  StoredPackVisibility,
} from "./services/state-store.js";
import {
  hasOpenRouterGenerationAccess,
  openRouterGenerationRequiredMessage,
} from "./openrouter-generation-access.js";

export interface PackLibraryRouteContext {
  method: string;
  pathname: string;
  url?: URL;
  res: unknown;
  cookieHeader?: string | null;
  apiKeyHeader?: string | null;
  error: (response: unknown, message: string, status?: number) => void;
  json: (response: unknown, data: unknown, status?: number) => void;
  readJsonBody: () => Promise<unknown>;
}

export interface PackLibraryRouteDeps {
  auth: AuthService;
  ruby: RubyHighService;
  sessionIdFor: (cookieHeader?: string | null) => string;
}

const PREFIX = "/api/apps/ruby-high/pack-library";
const DRAFT_PREFIX = "/api/apps/ruby-high/pack-drafts";
const MAX_MATERIAL_CHARS = 80_000;
const MAX_GENERATIONS_PER_DAY = readPositiveInt(process.env.RUBY_HIGH_DRAFT_GENERATIONS_PER_DAY, 5);

export async function handlePackLibraryRoutes(
  ctx: PackLibraryRouteContext,
  deps: PackLibraryRouteDeps,
): Promise<boolean> {
  const isLibrary = ctx.pathname.startsWith(PREFIX);
  const isDraft = ctx.pathname.startsWith(DRAFT_PREFIX);
  if (!isLibrary && !isDraft) return false;

  const token = deps.auth.parseSessionToken(ctx.cookieHeader);
  const record = deps.auth.resolve(token);
  if (!record || !token) {
    ctx.error(ctx.res, "Sign in to manage content packs.", 401);
    return true;
  }
  const sessionId = deps.sessionIdFor(ctx.cookieHeader);

  if (isLibrary) {
    const sub = ctx.pathname.slice(PREFIX.length) || "/";
    if (ctx.method === "GET" && sub === "/") {
      await migrateExistingTeacherInstalls(deps.ruby, record);
      ctx.json(ctx.res, await libraryPayload(deps.ruby, record, sessionId));
      return true;
    }

    const installMatch = sub.match(/^\/([^/]+)\/install$/);
    if (ctx.method === "POST" && installMatch?.[1]) {
      const packId = decodeURIComponent(installMatch[1]);
      const body = await readBody(ctx);
      try {
        const enabled = bodyValue(body, "enabled") !== false;
        await setPackEnabled({ ruby: deps.ruby, userId: record.userId, sessionId, packId, enabled });
        ctx.json(ctx.res, await libraryPayload(deps.ruby, record, sessionId));
      } catch (err) {
        log.error("pack-library.install-failed", err, { userId: record.userId, packId });
        ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err));
      }
      return true;
    }

    const activeMatch = sub.match(/^\/([^/]+)\/active$/);
    if (ctx.method === "POST" && activeMatch?.[1]) {
      const packId = decodeURIComponent(activeMatch[1]);
      try {
        await setActivePack({ ruby: deps.ruby, userId: record.userId, sessionId, packId });
        ctx.json(ctx.res, await libraryPayload(deps.ruby, record, sessionId));
      } catch (err) {
        log.error("pack-library.activate-failed", err, { userId: record.userId, packId });
        ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err));
      }
      return true;
    }

    const deletePackMatch = sub.match(/^\/([^/]+)$/);
    if (ctx.method === "DELETE" && deletePackMatch?.[1]) {
      const packId = decodeURIComponent(deletePackMatch[1]);
      try {
        await deleteOwnedPublishedPack({ ruby: deps.ruby, record, sessionId, packId });
        ctx.json(ctx.res, await libraryPayload(deps.ruby, record, sessionId));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes("Only the owner") ? 403 : clientErrorStatus(err);
        if (status >= 500) log.error("pack-library.delete-failed", err, { userId: record.userId, packId });
        ctx.error(ctx.res, message, status);
      }
      return true;
    }
  }

  const sub = ctx.pathname.slice(DRAFT_PREFIX.length) || "/";
  if (ctx.method === "POST" && sub === "/") {
    const body = await readBody(ctx);
    const now = Date.now();
    const draft: StoredDraftContentPackRecord = {
      id: newDraftId(),
      ownerUserId: record.userId,
      ownerSessionId: sessionId,
      name: bodyString(body, "name") || "Untitled Content Pack",
      description: bodyString(body, "description"),
      visibility: visibilityFrom(bodyValue(body, "visibility"), "private"),
      teachers: [],
      createdAt: now,
      updatedAt: now,
    };
    await deps.ruby.saveDraftPackRecord(draft);
    ctx.json(ctx.res, { ok: true, draft: draftSummary(draft) }, 201);
    return true;
  }

  const draftIdMatch = sub.match(/^\/([^/]+)$/);
  if (ctx.method === "GET" && draftIdMatch?.[1]) {
    const draft = await requireDraft(deps.ruby, record, decodeURIComponent(draftIdMatch[1]), ctx);
    if (!draft) return true;
    ctx.json(ctx.res, { draft: draftDetail(draft) });
    return true;
  }

  if (ctx.method === "PATCH" && draftIdMatch?.[1]) {
    const draft = await requireDraft(deps.ruby, record, decodeURIComponent(draftIdMatch[1]), ctx);
    if (!draft) return true;
    const body = await readBody(ctx);
    const updated: StoredDraftContentPackRecord = {
      ...draft,
      ...(hasOwn(body, "name") ? { name: bodyString(body, "name") || "Untitled Content Pack" } : {}),
      ...(hasOwn(body, "description") ? { description: bodyString(body, "description") } : {}),
      visibility: visibilityFrom(bodyValue(body, "visibility"), draft.visibility),
      updatedAt: Date.now(),
    };
    await deps.ruby.saveDraftPackRecord(updated);
    ctx.json(ctx.res, { ok: true, draft: draftDetail(updated) });
    return true;
  }

  if (ctx.method === "DELETE" && draftIdMatch?.[1]) {
    const draft = await requireDraft(deps.ruby, record, decodeURIComponent(draftIdMatch[1]), ctx);
    if (!draft) return true;
    await deps.ruby.deleteDraftPackRecord(draft.id);
    ctx.json(ctx.res, await libraryPayload(deps.ruby, record, sessionId));
    return true;
  }

  const teachersPath = sub.match(/^\/([^/]+)\/teachers$/);
  if (ctx.method === "POST" && teachersPath?.[1]) {
    const draft = await requireDraft(deps.ruby, record, decodeURIComponent(teachersPath[1]), ctx);
    if (!draft) return true;
    const body = await readBody(ctx);
    try {
      const now = Date.now();
      const assetTeacherId = cleanTeacherAssetId(bodyString(body, "assetTeacherId"));
      const profileImageUrl = cleanImageRef(bodyString(body, "profileImageUrl"));
      const stats = cleanTeacherStats(bodyValue(body, "stats"));
      const socialsUrl = cleanHttpUrl(bodyString(body, "socialsUrl"));
      const teacher: StoredDraftTeacherRecord = {
        id: newTeacherId(),
        displayName: bodyString(body, "displayName") || bodyString(body, "name") || "New Teacher",
        subject: bodyString(body, "subject"),
        description: bodyString(body, "description"),
        quote: bodyString(body, "quote"),
        ...(assetTeacherId ? { assetTeacherId } : {}),
        ...(profileImageUrl ? { profileImageUrl } : {}),
        ...(stats ? { stats } : {}),
        ...(socialsUrl ? { socialsUrl } : {}),
        materials: "",
        sourceCards: [],
        questions: [],
        generationCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      const updated = touchDraft({ ...draft, teachers: [...draft.teachers, teacher] });
      await deps.ruby.saveDraftPackRecord(updated);
      ctx.json(ctx.res, { ok: true, draft: draftDetail(updated), teacher: teacherDetail(updated, teacher) }, 201);
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err));
    }
    return true;
  }

  const teacherPath = sub.match(/^\/([^/]+)\/teachers\/([^/]+)$/);
  if (ctx.method === "PATCH" && teacherPath?.[1] && teacherPath?.[2]) {
    const draft = await requireDraft(deps.ruby, record, decodeURIComponent(teacherPath[1]), ctx);
    if (!draft) return true;
    const body = await readBody(ctx);
    try {
      const updated = updateDraftTeacher(draft, decodeURIComponent(teacherPath[2]), body);
      await deps.ruby.saveDraftPackRecord(updated);
      const teacher = updated.teachers.find((entry) => entry.id === decodeURIComponent(teacherPath[2]));
      ctx.json(ctx.res, { ok: true, draft: draftDetail(updated), teacher: teacher ? teacherDetail(updated, teacher) : null });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err));
    }
    return true;
  }

  const materialsUrlPath = sub.match(/^\/([^/]+)\/teachers\/([^/]+)\/materials\/from-url$/);
  if (ctx.method === "POST" && materialsUrlPath?.[1] && materialsUrlPath?.[2]) {
    const draft = await requireDraft(deps.ruby, record, decodeURIComponent(materialsUrlPath[1]), ctx);
    if (!draft) return true;
    const body = await readBody(ctx);
    try {
      const sourceUrl = normalizeMarkdownSourceUrl(bodyString(body, "url"));
      const materials = await fetchMarkdownMaterials(sourceUrl);
      const updated = updateDraftTeacher(draft, decodeURIComponent(materialsUrlPath[2]), {
        materials,
        materialSourceUrl: sourceUrl,
      });
      await deps.ruby.saveDraftPackRecord(updated);
      const teacher = updated.teachers.find((entry) => entry.id === decodeURIComponent(materialsUrlPath[2]));
      ctx.json(ctx.res, { ok: true, draft: draftDetail(updated), teacher: teacher ? teacherDetail(updated, teacher) : null });
    } catch (err) {
      log.error("pack-draft.materials-from-url-failed", err, { userId: record.userId });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err));
    }
    return true;
  }

  const generatePath = sub.match(/^\/([^/]+)\/teachers\/([^/]+)\/questions\/generate$/);
  if (ctx.method === "POST" && generatePath?.[1] && generatePath?.[2]) {
    const draft = await requireDraft(deps.ruby, record, decodeURIComponent(generatePath[1]), ctx);
    if (!draft) return true;
    if (!hasOpenRouterGenerationAccess({ apiKeyHeader: ctx.apiKeyHeader, ruby: deps.ruby, sessionId })) {
      ctx.error(ctx.res, openRouterGenerationRequiredMessage("generating questions"), 401);
      return true;
    }
    const teacherId = decodeURIComponent(generatePath[2]);
    try {
      const updated = generateQuestionsForTeacher(draft, teacherId);
      await deps.ruby.saveDraftPackRecord(updated);
      const teacher = updated.teachers.find((entry) => entry.id === teacherId);
      ctx.json(ctx.res, { ok: true, draft: draftDetail(updated), teacher: teacher ? teacherDetail(updated, teacher) : null });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err));
    }
    return true;
  }

  const questionDeletePath = sub.match(/^\/([^/]+)\/teachers\/([^/]+)\/questions\/([^/]+)$/);
  if (ctx.method === "DELETE" && questionDeletePath?.[1] && questionDeletePath?.[2] && questionDeletePath?.[3]) {
    const draft = await requireDraft(deps.ruby, record, decodeURIComponent(questionDeletePath[1]), ctx);
    if (!draft) return true;
    try {
      const updated = deleteDraftQuestion(
        draft,
        decodeURIComponent(questionDeletePath[2]),
        decodeURIComponent(questionDeletePath[3]),
      );
      await deps.ruby.saveDraftPackRecord(updated);
      const teacher = updated.teachers.find((entry) => entry.id === decodeURIComponent(questionDeletePath[2]));
      ctx.json(ctx.res, { ok: true, draft: draftDetail(updated), teacher: teacher ? teacherDetail(updated, teacher) : null });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err));
    }
    return true;
  }

  const publishPath = sub.match(/^\/([^/]+)\/publish$/);
  if (ctx.method === "POST" && publishPath?.[1]) {
    const draft = await requireDraft(deps.ruby, record, decodeURIComponent(publishPath[1]), ctx);
    if (!draft) return true;
    try {
      const pack = packFromDraft(draft);
      await deps.ruby.persistPublicTeacherPack(pack, { creatorUserId: record.userId });
      await saveInstallationSet(deps.ruby, record.userId, [{
        packId: pack.id,
        enabled: true,
        active: false,
      }]);
      ctx.json(ctx.res, { ok: true, pack: packLibrarySummary(pack, { enabled: true, active: false, owner: true, readOnly: false }) });
    } catch (err) {
      log.error("pack-draft.publish-failed", err, { userId: record.userId, draftId: draft.id });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err));
    }
    return true;
  }

  return false;
}

async function libraryPayload(ruby: RubyHighService, record: AuthRecord, sessionId: string) {
  const activePackId = currentActivePackId(ruby, sessionId);
  const installs = await ruby.listPackInstallationRecords();
  const userInstalls = installs.filter((install) => install.userId === record.userId);
  const installByPack = new Map(userInstalls.map((install) => [install.packId, install]));
  const persistedPackRecords = await ruby.listPersistedPackRecords();
  const visiblePacks = uniquePacks([
    await getActivePack(),
    ...availablePacksForSession(sessionId),
  ]);
  const publishedOwnedPackIds = new Set(
    (await ruby.listTeacherRecords())
      .filter((teacher) => teacher.creatorUserId === record.userId && teacher.status === "published")
      .map((teacher) => teacher.packId),
  );
  const packs = visiblePacks.map((pack) => {
    const install = installByPack.get(pack.id);
    const builtIn = pack.id === ORIGINAL_PACK_ID;
    const persistedRecords = persistedPackRecords.filter((entry) => entry.pack.id === pack.id);
    const owner = publishedOwnedPackIds.has(pack.id) || persistedRecords.some((entry) =>
      entry.creatorUserId === record.userId || entry.ownerSessionId === sessionId);
    return packLibrarySummary(pack, {
      enabled: install ? install.enabled : builtIn,
      active: pack.id === activePackId || !!install?.active,
      owner,
      readOnly: builtIn,
    });
  });
  const drafts = (await ruby.listDraftPackRecords())
    .filter((draft) => draft.ownerUserId === record.userId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(draftSummary);
  return {
    activePackId,
    packs: packs.sort((a, b) => Number(b.active) - Number(a.active) || Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)),
    drafts,
  };
}

async function migrateExistingTeacherInstalls(ruby: RubyHighService, record: AuthRecord): Promise<void> {
  const installs = await ruby.listPackInstallationRecords();
  const installed = new Set(installs.filter((entry) => entry.userId === record.userId).map((entry) => entry.packId));
  const now = Date.now();
  for (const teacher of await ruby.listTeacherRecords()) {
    if (teacher.creatorUserId !== record.userId || teacher.status !== "published" || installed.has(teacher.packId)) continue;
    await ruby.savePackInstallationRecord({
      userId: record.userId,
      packId: teacher.packId,
      enabled: true,
      active: false,
      installedAt: now,
      updatedAt: now,
    });
  }
}

async function setPackEnabled(args: {
  ruby: RubyHighService;
  userId: string;
  sessionId: string;
  packId: string;
  enabled: boolean;
}): Promise<void> {
  const target = getPackByIdForSession(args.packId, args.sessionId);
  if (!target) throw new Error("Unknown pack.");
  const now = Date.now();
  const installs = await args.ruby.listPackInstallationRecords();
  const existing = installs.find((entry) => entry.userId === args.userId && entry.packId === args.packId);
  await args.ruby.savePackInstallationRecord({
    userId: args.userId,
    packId: args.packId,
    enabled: args.enabled,
    active: args.enabled ? !!existing?.active : false,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
  });
  if (!args.enabled && currentActivePackId(args.ruby, args.sessionId) === args.packId && args.packId !== ORIGINAL_PACK_ID) {
    await setActivePack({ ruby: args.ruby, userId: args.userId, sessionId: args.sessionId, packId: ORIGINAL_PACK_ID });
  }
}

async function setActivePack(args: {
  ruby: RubyHighService;
  userId: string;
  sessionId: string;
  packId: string;
}): Promise<void> {
  const target = getPackByIdForSession(args.packId, args.sessionId);
  if (!target) throw new Error("Unknown pack.");
  args.ruby.setActivePackForSession(args.sessionId, args.packId);
  await args.ruby.flushSession(args.sessionId);
  const installs = await args.ruby.listPackInstallationRecords();
  const now = Date.now();
  const next = installs
    .filter((entry) => entry.userId === args.userId)
    .map((entry) => ({
      ...entry,
      active: entry.packId === args.packId,
      enabled: entry.packId === args.packId ? true : entry.enabled,
      updatedAt: now,
    }));
  if (!next.some((entry) => entry.packId === args.packId)) {
    next.push({
      userId: args.userId,
      packId: args.packId,
      enabled: true,
      active: true,
      installedAt: now,
      updatedAt: now,
    });
  }
  await Promise.all(next.map((entry) => args.ruby.savePackInstallationRecord(entry)));
}

async function deleteOwnedPublishedPack(args: {
  ruby: RubyHighService;
  record: AuthRecord;
  sessionId: string;
  packId: string;
}): Promise<void> {
  if (args.packId === ORIGINAL_PACK_ID) throw new Error("Ruby High Original is read only.");
  const persisted = (await args.ruby.listPersistedPackRecords()).filter((entry) => entry.pack.id === args.packId);
  const ownedLegacyTeachers = (await args.ruby.listTeacherRecords())
    .filter((teacher) => teacher.creatorUserId === args.record.userId && teacher.packId === args.packId);
  const ownsPersisted = persisted.some((entry) =>
    entry.creatorUserId === args.record.userId || entry.ownerSessionId === args.sessionId);
  if (persisted.length === 0 && ownedLegacyTeachers.length === 0) throw new Error("Unknown pack.");
  if (!ownsPersisted && ownedLegacyTeachers.length === 0) throw new Error("Only the owner can delete this pack.");

  await Promise.all(persisted.map((entry) => args.ruby.deletePersistedPackRecord(entry.ownerSessionId, args.packId)));
  if (persisted.length === 0 && ownedLegacyTeachers.length > 0) {
    await args.ruby.deletePersistedPackRecord(null, args.packId);
  }
  await Promise.all(ownedLegacyTeachers.map((teacher) => args.ruby.deleteTeacherRecord(teacher.id)));
  const installs = await args.ruby.listPackInstallationRecords();
  await Promise.all(installs
    .filter((install) => install.packId === args.packId)
    .map((install) => args.ruby.deletePackInstallationRecord(install.userId, install.packId)));

  if (currentActivePackId(args.ruby, args.sessionId) === args.packId) {
    args.ruby.setActivePackForSession(args.sessionId, ORIGINAL_PACK_ID);
    await args.ruby.flushSession(args.sessionId);
  }
}

async function saveInstallationSet(
  ruby: RubyHighService,
  userId: string,
  updates: Array<{ packId: string; enabled: boolean; active: boolean }>,
): Promise<void> {
  const installs = await ruby.listPackInstallationRecords();
  const now = Date.now();
  await Promise.all(updates.map((update) => {
    const existing = installs.find((entry) => entry.userId === userId && entry.packId === update.packId);
    return ruby.savePackInstallationRecord({
      userId,
      packId: update.packId,
      enabled: update.enabled,
      active: update.active,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
    });
  }));
}

function currentActivePackId(ruby: RubyHighService, sessionId: string): string {
  const state = ruby.getOrCreate(sessionId);
  return state.activePackId || ORIGINAL_PACK_ID;
}

function packLibrarySummary(
  pack: ContentPack,
  opts: { enabled: boolean; active: boolean; owner: boolean; readOnly: boolean },
) {
  const questionCount = countPackQuestions(pack);
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    readOnly: opts.readOnly,
    builtIn: pack.id === ORIGINAL_PACK_ID,
    owner: opts.owner,
    enabled: opts.enabled,
    active: opts.active,
    canEdit: false,
    canDelete: opts.owner && !opts.readOnly,
    status: "published",
    facultyCount: pack.faculty.length,
    questionCount,
    courses: coursesForPack(pack),
  };
}

function countPackQuestions(pack: ContentPack): number {
  return pack.faculty.reduce((sum, faculty) =>
    sum + (faculty.sourceCards?.length ?? 0) + faculty.questions.filter((q) => !q.sourceCardId).length, 0);
}

function draftSummary(draft: StoredDraftContentPackRecord) {
  return {
    id: draft.id,
    name: draft.name,
    description: draft.description,
    visibility: draft.visibility,
    status: "draft",
    owner: true,
    enabled: false,
    active: false,
    canEdit: true,
    canDelete: true,
    readOnly: false,
    teacherCount: draft.teachers.length,
    questionCount: draft.teachers.reduce((sum, teacher) => sum + teacher.sourceCards.length + teacher.questions.length, 0),
    updatedAt: draft.updatedAt,
  };
}

function draftDetail(draft: StoredDraftContentPackRecord) {
  return {
    ...draftSummary(draft),
    teachers: draft.teachers.map((teacher) => teacherDetail(draft, teacher)),
  };
}

function teacherDetail(draft: StoredDraftContentPackRecord, teacher: StoredDraftTeacherRecord) {
  const facultyId = draftTeacherFacultyId(teacher);
  return {
    id: teacher.id,
    displayName: teacher.displayName,
    subject: teacher.subject ?? "",
    description: teacher.description,
    quote: teacher.quote ?? "",
    assetTeacherId: teacher.assetTeacherId ?? "",
    profileImageUrl: teacher.profileImageUrl ?? "",
    stats: teacher.stats ?? null,
    socialsUrl: teacher.socialsUrl ?? "",
    materials: teacher.materials,
    materialSourceUrl: teacher.materialSourceUrl ?? "",
    generationCount: teacher.generationCount,
    generationDay: teacher.generationDay ?? "",
    generatedAt: teacher.generatedAt ?? null,
    questionCount: teacher.sourceCards.length + teacher.questions.length,
    questions: [
      ...teacher.sourceCards.map((card) => ({
        id: card.id,
        prompt: card.front,
        answer: card.back,
        subject: card.subject,
        difficulty: card.difficulty,
        type: "source-card",
      })),
      ...teacher.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        answer: question.explanation ?? "",
        subject: question.subject,
        difficulty: question.difficulty,
        type: question.type ?? "multiple-choice",
      })),
    ],
    facultyId,
  };
}

async function requireDraft(
  ruby: RubyHighService,
  record: AuthRecord,
  draftId: string,
  ctx: PackLibraryRouteContext,
): Promise<StoredDraftContentPackRecord | null> {
  const draft = (await ruby.listDraftPackRecords()).find((entry) => entry.id === draftId);
  if (!draft) {
    ctx.error(ctx.res, "Unknown draft pack.", 404);
    return null;
  }
  if (draft.ownerUserId !== record.userId) {
    ctx.error(ctx.res, "Only the owner can edit this draft pack.", 403);
    return null;
  }
  return draft;
}

function updateDraftTeacher(
  draft: StoredDraftContentPackRecord,
  teacherId: string,
  body: Record<string, unknown>,
): StoredDraftContentPackRecord {
  const teacher = draft.teachers.find((entry) => entry.id === teacherId);
  if (!teacher) throw new Error("Unknown teacher.");
  const materials = bodyString(body, "materials");
  if (materials && materials.length > MAX_MATERIAL_CHARS) {
    throw new Error(`Course materials must be ${MAX_MATERIAL_CHARS} characters or less.`);
  }
  const updatedTeacher: StoredDraftTeacherRecord = {
    ...teacher,
    ...(hasOwn(body, "displayName") ? { displayName: bodyString(body, "displayName") || "New Teacher" } : {}),
    ...(hasOwn(body, "subject") ? { subject: bodyString(body, "subject") } : {}),
    ...(hasOwn(body, "description") ? { description: bodyString(body, "description") } : {}),
    ...(hasOwn(body, "quote") ? { quote: bodyString(body, "quote") } : {}),
    ...(hasOwn(body, "assetTeacherId") ? { assetTeacherId: cleanTeacherAssetId(bodyString(body, "assetTeacherId")) || undefined } : {}),
    ...(hasOwn(body, "profileImageUrl") ? cleanOptionalImageField(bodyString(body, "profileImageUrl")) : {}),
    ...(hasOwn(body, "stats") ? { stats: cleanTeacherStats(bodyValue(body, "stats")) || undefined } : {}),
    ...(hasOwn(body, "socialsUrl") ? cleanOptionalUrlField(bodyString(body, "socialsUrl"), "socialsUrl") : {}),
    ...(hasOwn(body, "materials") ? { materials } : {}),
    ...(hasOwn(body, "materialSourceUrl") ? { materialSourceUrl: bodyString(body, "materialSourceUrl") } : {}),
    updatedAt: Date.now(),
  };
  if (hasOwn(body, "assetTeacherId") && !updatedTeacher.assetTeacherId) delete updatedTeacher.assetTeacherId;
  if (hasOwn(body, "profileImageUrl") && !updatedTeacher.profileImageUrl) delete updatedTeacher.profileImageUrl;
  if (hasOwn(body, "stats") && !updatedTeacher.stats) delete updatedTeacher.stats;
  if (hasOwn(body, "socialsUrl") && !updatedTeacher.socialsUrl) delete updatedTeacher.socialsUrl;
  return touchDraft({
    ...draft,
    teachers: draft.teachers.map((entry) => entry.id === teacherId ? updatedTeacher : entry),
  });
}

function generateQuestionsForTeacher(draft: StoredDraftContentPackRecord, teacherId: string): StoredDraftContentPackRecord {
  const teacher = draft.teachers.find((entry) => entry.id === teacherId);
  if (!teacher) throw new Error("Unknown teacher.");
  if (!teacher.materials.trim()) throw new Error("Course materials are required before generating questions.");
  const day = new Date().toISOString().slice(0, 10);
  const countToday = teacher.generationDay === day ? teacher.generationCount : 0;
  if (countToday >= MAX_GENERATIONS_PER_DAY) {
    throw new Error(`Question generation is limited to ${MAX_GENERATIONS_PER_DAY} runs per teacher per day.`);
  }
  const facultyId = draftTeacherFacultyId(teacher);
  const sourceCards = sourceCardsFromMaterials(teacher.materials, {
    facultyId,
    teacherName: teacher.displayName,
    questionCount: 18,
  });
  const updatedTeacher: StoredDraftTeacherRecord = {
    ...teacher,
    sourceCards,
    questions: [],
    generationDay: day,
    generationCount: countToday + 1,
    generatedAt: Date.now(),
    updatedAt: Date.now(),
  };
  return touchDraft({
    ...draft,
    teachers: draft.teachers.map((entry) => entry.id === teacherId ? updatedTeacher : entry),
  });
}

function deleteDraftQuestion(
  draft: StoredDraftContentPackRecord,
  teacherId: string,
  questionId: string,
): StoredDraftContentPackRecord {
  const teacher = draft.teachers.find((entry) => entry.id === teacherId);
  if (!teacher) throw new Error("Unknown teacher.");
  const updatedTeacher: StoredDraftTeacherRecord = {
    ...teacher,
    sourceCards: teacher.sourceCards.filter((card) => card.id !== questionId),
    questions: teacher.questions.filter((question) => question.id !== questionId),
    updatedAt: Date.now(),
  };
  return touchDraft({
    ...draft,
    teachers: draft.teachers.map((entry) => entry.id === teacherId ? updatedTeacher : entry),
  });
}

function packFromDraft(draft: StoredDraftContentPackRecord): ContentPack {
  if (draft.teachers.length === 0) throw new Error("Add at least one teacher before publishing.");
  const faculty = draft.teachers.map((teacher) => {
    if (teacher.sourceCards.length + teacher.questions.length === 0) {
      throw new Error(`Generate questions for ${teacher.displayName} before publishing.`);
    }
    const facultyId = draftTeacherFacultyId(teacher);
    const sourceCards = teacher.sourceCards.map((card) => ({ ...card, faculty: facultyId }));
    const questions = teacher.questions.map((question) => ({ ...question, faculty: facultyId }));
    const subjects = subjectsFromSourceCards(sourceCards, questions);
    const teacherBio = [
      teacher.subject ? `Class style: ${teacher.subject}` : "",
      teacher.description,
      teacher.quote ? `Signature line: "${teacher.quote}"` : "",
    ].filter(Boolean).join(" ");
    return {
      id: facultyId,
      displayName: teacher.displayName,
      shortName: teacher.displayName.split(/\s+/)[0] || "Teacher",
      ...(teacher.assetTeacherId ? { assetTeacherId: teacher.assetTeacherId } : {}),
      ...(teacher.profileImageUrl ? { profileImageUrl: teacher.profileImageUrl } : {}),
      ...(teacher.stats ? { stats: teacher.stats } : {}),
      subjects,
      bio: teacherBio || "A custom Ruby High teacher.",
      accent: colorForString(teacher.displayName),
      systemPrompt: [
        `You are ${teacher.displayName}, a custom Ruby High teacher.`,
        teacher.subject ? `Class style: ${teacher.subject}.` : "",
        teacher.description,
        teacher.quote ? `Signature line: "${teacher.quote}"` : "",
        "Teach from these course materials when relevant:",
        teacher.materials.slice(0, 6000),
      ].filter(Boolean).join("\n\n"),
      defaultModel: process.env.RUBY_HIGH_CREATOR_DEFAULT_MODEL || "anthropic/claude-haiku-4.5",
      provider: { kind: "openrouter" as const, supportsTools: true },
      questions,
      sourceCards,
    };
  });
  const rooms = faculty.map((entry) => ({
    id: `${entry.id}-room`,
    name: `${entry.displayName} Seminar`,
    channelName: slugForText(entry.displayName),
    teacherId: entry.id,
    description: entry.bio,
    teaches: true,
  }));
  return {
    id: `pack:${draft.id}`,
    name: draft.name,
    description: draft.description || "Custom Ruby High content pack.",
    version: "1.0.0",
    faculty,
    courses: faculty.map((entry) => ({
      id: entry.id,
      title: `${entry.displayName} Seminar`,
      facultyId: entry.id,
      roomId: `${entry.id}-room`,
      subjects: entry.subjects,
    })),
    rooms,
  };
}

function sourceCardsFromMaterials(
  materials: string,
  opts: { facultyId: string; teacherName: string; questionCount: number },
): PackSourceCard[] {
  const chunks = materialChunks(materials);
  const limit = Math.max(0, Math.min(40, opts.questionCount));
  return chunks.slice(0, limit).map((chunk, index) => {
    const subject = subjectFromHeading(chunk.heading || opts.teacherName);
    const back = chunk.text.slice(0, 1200);
    return {
      id: `${opts.facultyId}-source-${index + 1}`,
      kind: "basic",
      front: chunk.heading ? `What matters in ${chunk.heading}?` : `Review card ${index + 1}: ${chunk.text.split(/\s+/).slice(0, 8).join(" ")}`,
      back,
      acceptedAnswers: [back],
      deckName: `${opts.teacherName} materials`,
      tags: ["creator-pack", slugForText(subject)],
      subject,
      difficulty: difficultyForText(chunk.text),
      faculty: opts.facultyId,
    };
  });
}

function materialChunks(materials: string): Array<{ heading: string; text: string }> {
  const lines = materials.replace(/\r/g, "").split("\n");
  const chunks: Array<{ heading: string; text: string }> = [];
  let heading = "";
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (text) chunks.push({ heading, text });
    buffer = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch?.[1]) {
      flush();
      heading = cleanMarkdownText(headingMatch[1]);
      continue;
    }
    if (!line) {
      flush();
      continue;
    }
    buffer.push(cleanMarkdownText(line));
  }
  flush();
  if (chunks.length > 0) return chunks;
  const compact = cleanMarkdownText(materials).replace(/\s+/g, " ").trim();
  if (!compact) return [];
  return compact
    .split(/(?<=[.!?])\s+/)
    .filter((part) => part.trim().length > 0)
    .map((text) => ({ heading: "", text: text.trim() }));
}

function cleanMarkdownText(value: string): string {
  return value
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_`>~-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function subjectFromHeading(value: string): string {
  const words = cleanMarkdownText(value).split(/\s+/).filter(Boolean);
  return words.slice(0, 3).join(" ").toLowerCase() || "open study";
}

function difficultyForText(value: string): Difficulty {
  const wordCount = value.split(/\s+/).filter(Boolean).length;
  if (wordCount > 95) return "hard";
  if (wordCount > 45) return "medium";
  return "easy";
}

async function fetchMarkdownMaterials(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/markdown,text/plain,*/*" },
      signal: ctrl.signal,
    });
    if (!response.ok) throw new Error(`Could not fetch materials (${response.status}).`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/text|markdown|json|octet-stream/i.test(contentType)) {
      throw new Error("Materials URL must return markdown or plain text.");
    }
    const text = await response.text();
    if (text.length > MAX_MATERIAL_CHARS) {
      throw new Error(`Course materials must be ${MAX_MATERIAL_CHARS} characters or less.`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeMarkdownSourceUrl(raw: string): string {
  if (!raw) throw new Error("URL required.");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Materials URL must be http or https.");
  if (url.hostname === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const blobIndex = parts.indexOf("blob");
    if (parts.length >= 5 && blobIndex === 2) {
      const [owner, repo, , branch, ...path] = parts;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.join("/")}`;
    }
  }
  return url.toString();
}

function uniquePacks(packs: ContentPack[]): ContentPack[] {
  const seen = new Set<string>();
  const out: ContentPack[] = [];
  for (const pack of packs) {
    if (seen.has(pack.id)) continue;
    seen.add(pack.id);
    out.push(pack);
  }
  return out;
}

function touchDraft(draft: StoredDraftContentPackRecord): StoredDraftContentPackRecord {
  return { ...draft, updatedAt: Date.now() };
}

async function readBody(ctx: PackLibraryRouteContext): Promise<Record<string, unknown>> {
  const body = await ctx.readJsonBody().catch(() => ({}));
  return body && typeof body === "object" ? body as Record<string, unknown> : {};
}

function bodyValue(body: Record<string, unknown> | null, key: string): unknown {
  return body ? body[key] : undefined;
}

function bodyString(body: Record<string, unknown> | null, key: string): string {
  const value = bodyValue(body, key);
  return typeof value === "string" ? value.trim() : "";
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function cleanOptionalUrlField(bodyValue: string, key: "socialsUrl"): Partial<StoredDraftTeacherRecord> {
  const clean = cleanHttpUrl(bodyValue);
  return clean ? { [key]: clean } : { [key]: undefined };
}

function cleanOptionalImageField(bodyValue: string): Partial<StoredDraftTeacherRecord> {
  const clean = cleanImageRef(bodyValue);
  return clean ? { profileImageUrl: clean } : { profileImageUrl: undefined };
}

function cleanTeacherAssetId(value: string): string {
  return value === "ruby" || value === "sally-science" || value === "professor-edward" ? value : "";
}

function cleanTeacherStats(value: unknown): CharacterStats | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const out = {
    head: cleanStatValue(raw.head),
    heart: cleanStatValue(raw.heart),
    hustle: cleanStatValue(raw.hustle),
    honor: cleanStatValue(raw.honor),
  };
  return Object.values(out).every((n) => Number.isFinite(n)) ? out : undefined;
}

function cleanStatValue(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return NaN;
  return Math.max(-1, Math.min(3, Math.round(n)));
}

function visibilityFrom(value: unknown, fallback: StoredPackVisibility): StoredPackVisibility {
  return value === "public" || value === "unlisted" || value === "private" ? value : fallback;
}

function subjectsFromSourceCards(cards: PackSourceCard[], questions: BankedQuestion[] = []): string[] {
  const subjects = Array.from(new Set([
    ...cards.map((card) => card.subject),
    ...questions.map((question) => question.subject),
  ].filter(Boolean)));
  return subjects.length > 0 ? subjects : ["open study"];
}

function draftTeacherFacultyId(teacher: StoredDraftTeacherRecord): string {
  return `draft-${slugForText(teacher.id)}`;
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

function cleanImageRef(value: string): string {
  if (!value) return "";
  const text = value.trim();
  if (!text) return "";
  if (text.length > 280_000) {
    throw new Error("profileImageUrl too large. Store the image externally before saving.");
  }
  if (/^data:image\//i.test(text)) return text;
  if (text.startsWith("/api/apps/ruby-high/assets/")) return text;
  return cleanHttpUrl(text);
}

function slugForText(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/^avatar:/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "teacher";
}

function colorForString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  const palette = ["#d22a2a", "#2e8f7b", "#6f5fc7", "#c27a2c", "#2f76b7", "#b04782"];
  return palette[Math.abs(hash) % palette.length]!;
}

function newDraftId(): string {
  return `draft_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function newTeacherId(): string {
  return `teacher_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function clientErrorStatus(err: unknown): number {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("Unknown") ||
    message.includes("URL required") ||
    message.includes("materials") ||
    message.includes("Generate questions") ||
    message.includes("Add at least") ||
    message.includes("read only") ||
    message.includes("limited")
  ) return 400;
  return 500;
}
