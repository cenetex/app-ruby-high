import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DEFAULT_CREATOR_MODEL } from "./model-defaults.js";
import { AuthService, type AuthRecord } from "./services/auth-service.js";
import { RubyHighService } from "./services/ruby-high-service.js";
import { log } from "./services/logger.js";
import { TokenBucket } from "./services/rate-limit.js";
import {
  courseSlotCost,
  hostedEntitlementStatus,
  hostedOpenRouterApiKey,
  moreQuestionsCount,
  questionGenerationCost,
} from "./hosted-entitlements.js";
import {
  ORIGINAL_PACK_ID,
  availablePacksForSession,
  coursesForPack,
  getActivePack,
  getPackByIdForSession,
  guestPackForSession,
  guestWeekKey,
  weeklyAutoGuestPack,
} from "./content/registry.js";
import type { ContentPack, PackSourceCard } from "./content/types.js";
import type { BankedQuestion, CharacterStats, Choice, Difficulty } from "./types.js";
import type {
  StoredCourseSlotRecord,
  StoredDraftContentPackRecord,
  StoredDraftTeacherRecord,
  StoredPackVisibility,
} from "./services/state-store.js";
import {
  resolveTextLlmCredential,
  openRouterGenerationRequiredMessage,
} from "./openrouter-generation-access.js";
import {
  fetchLlmChatCompletions,
  llmProviderName,
  resolveStudentModel,
} from "./services/llm-provider.js";
import {
  maybeUploadPortrait,
  renderTeacherPortrait,
} from "./services/character-generation.js";
import { classifyQuestionStat, normalizeQuestionStat, type QuestionStat } from "./question-stats.js";

export interface PackLibraryRouteContext {
  method: string;
  pathname: string;
  url?: URL;
  res: unknown;
  cookieHeader?: string | null;
  apiKeyHeader?: string | null;
  clientIp?: string | null;
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
const COURSE_SLOT_HALL_PASS_COST = courseSlotCost();
const QUESTION_GENERATION_HALL_PASS_COST = questionGenerationCost();
const COURSE_GENERATION_QUESTION_COUNT = readPositiveInt(process.env.RUBY_HIGH_COURSE_GENERATION_QUESTION_COUNT, 18);
const COURSE_GENERATION_QUESTION_BATCH_SIZE = Math.max(2, Math.min(6, readPositiveInt(process.env.RUBY_HIGH_COURSE_GENERATION_QUESTION_BATCH_SIZE, 6)));
const MORE_QUESTIONS_COUNT = moreQuestionsCount();
const PACK_SEARCH_LIMIT = 24;
const MATERIALS_URL_LIMITER = new TokenBucket(12, 1 / 10);
const MAX_MATERIAL_URL_REDIRECTS = 5;
const DEFAULT_MATERIAL_URL_HOSTS = ["raw.githubusercontent.com", "gist.githubusercontent.com"] as const;
type PackLibrarySource = "official" | "creator" | "imported";
const GENERATED_DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"] as const;
const GENERATED_STATS: readonly QuestionStat[] = ["head", "heart", "hustle", "honor"] as const;

interface QuestionBalanceTarget {
  difficulty: Difficulty;
  stat: QuestionStat;
}

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
      ctx.json(ctx.res, await libraryPayload(deps.ruby, record, sessionId));
      return true;
    }

    if (ctx.method === "GET" && sub === "/search") {
      const query = ctx.url?.searchParams.get("q") ?? "";
      ctx.json(ctx.res, await creatorPackSearchPayload(deps.ruby, record, sessionId, query));
      return true;
    }

    if (ctx.method === "POST" && sub === "/guest/auto") {
      try {
        await setGuestAuto({ ruby: deps.ruby, sessionId });
        ctx.json(ctx.res, await libraryPayload(deps.ruby, record, sessionId));
      } catch (err) {
        log.error("pack-library.guest-auto-failed", err, { userId: record.userId });
        ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err));
      }
      return true;
    }

    const editDraftMatch = sub.match(/^\/([^/]+)\/edit-draft$/);
    if (ctx.method === "POST" && editDraftMatch?.[1]) {
      const packId = decodeURIComponent(editDraftMatch[1]);
      try {
        const draft = await ensurePublishedEditDraft({ ruby: deps.ruby, record, sessionId, packId });
        ctx.json(ctx.res, { ok: true, draft: draftDetail(draft) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes("Only the owner") ? 403 : clientErrorStatus(err);
        ctx.error(ctx.res, message, status);
      }
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

    const uninstallMatch = sub.match(/^\/([^/]+)\/uninstall$/);
    if ((ctx.method === "POST" || ctx.method === "DELETE") && uninstallMatch?.[1]) {
      const packId = decodeURIComponent(uninstallMatch[1]);
      try {
        await uninstallPack({ ruby: deps.ruby, userId: record.userId, sessionId, packId });
        ctx.json(ctx.res, await libraryPayload(deps.ruby, record, sessionId));
      } catch (err) {
        log.error("pack-library.uninstall-failed", err, { userId: record.userId, packId });
        ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err));
      }
      return true;
    }

    const activeMatch = sub.match(/^\/([^/]+)\/active$/);
    if (ctx.method === "POST" && activeMatch?.[1]) {
      const packId = decodeURIComponent(activeMatch[1]);
      try {
        await setGuestOverride({ ruby: deps.ruby, userId: record.userId, sessionId, packId });
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
      const clientRequestId = cleanClientRequestId(bodyString(body, "clientRequestId"));
      if (clientRequestId) {
        const existing = draft.teachers.find((entry) => entry.clientRequestId === clientRequestId);
        if (existing) {
          ctx.json(ctx.res, { ok: true, draft: draftDetail(draft), teacher: teacherDetail(existing) }, 200);
          return true;
        }
      }
      const assetTeacherId = cleanTeacherAssetId(bodyString(body, "assetTeacherId"));
      const profileImageUrl = cleanImageRef(bodyString(body, "profileImageUrl"));
      const stats = cleanTeacherStats(bodyValue(body, "stats"));
      const socialsUrl = cleanHttpUrl(bodyString(body, "socialsUrl"));
      const teacher: StoredDraftTeacherRecord = {
        id: newTeacherId(),
        ...(clientRequestId ? { clientRequestId } : {}),
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
      ctx.json(ctx.res, { ok: true, draft: draftDetail(updated), teacher: teacherDetail(teacher) }, 201);
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err));
    }
    return true;
  }

  const courseGeneratePath = sub.match(/^\/([^/]+)\/course\/generate$/);
  if (ctx.method === "POST" && courseGeneratePath?.[1]) {
    const draft = await requireDraft(deps.ruby, record, decodeURIComponent(courseGeneratePath[1]), ctx);
    if (!draft) return true;
    const body = await readBody(ctx);
    const materials = bodyString(body, "materials") || bodyString(body, "courseMaterials") || bodyString(body, "markdown") || bodyString(body, "text");
    if (!materials.trim()) {
      ctx.error(ctx.res, "Course materials are required.", 400);
      return true;
    }
    if (materials.length > MAX_MATERIAL_CHARS) {
      ctx.error(ctx.res, `Course materials must be ${MAX_MATERIAL_CHARS} characters or less.`, 413);
      return true;
    }
    const credential = resolveCourseGenerationCredential(ctx, deps.ruby, sessionId);
    if (!credential.apiKey) {
      ctx.error(ctx.res, openRouterGenerationRequiredMessage("generating a course"), 401);
      return true;
    }
    if (!credential.imageApiKey) {
      ctx.error(ctx.res, "Course generation needs hosted image generation for the teacher portrait.", 503);
      return true;
    }
    const targetTeacherId = bodyString(body, "teacherId");
    const targetTeacher = targetTeacherId ? draft.teachers.find((entry) => entry.id === targetTeacherId) ?? null : null;
    if (targetTeacherId && !targetTeacher) {
      ctx.error(ctx.res, "Unknown teacher.", 400);
      return true;
    }
    if (targetTeacher && generationCountToday(targetTeacher) >= MAX_GENERATIONS_PER_DAY) {
      ctx.error(ctx.res, `Question generation is limited to ${MAX_GENERATIONS_PER_DAY} runs per teacher per day.`, 400);
      return true;
    }
    try {
      const generated = await generateCourseSpecWithAi({
        apiKey: credential.apiKey,
        draft,
        teacher: targetTeacher,
        materials,
        questionCount: questionCountFrom(bodyValue(body, "questionCount")),
      });
      const profileImageUrl = await generateCourseTeacherPortrait({
        apiKey: credential.imageApiKey,
        generated,
      });
      const updated = applyGeneratedCourseSpec(draft, {
        teacherId: targetTeacherId,
        materials,
        materialSourceUrl: bodyString(body, "materialSourceUrl"),
        generated,
        profileImageUrl,
      });
      await deps.ruby.saveDraftPackRecord(updated);
      const teacher = updated.teachers.find((entry) => entry.id === generated.teacherId);
      ctx.json(ctx.res, {
        ok: true,
        draft: draftDetail(updated),
        teacher: teacher ? teacherDetail(teacher) : null,
        hallPassCost: 0,
        hallPasses: deps.ruby.hallPassBalance(sessionId),
        entitlements: hostedEntitlementStatus({ ruby: deps.ruby, sessionId }),
      });
    } catch (err) {
      const status = clientErrorStatus(err);
      if (status >= 500) log.error("pack-draft.course-generate-failed", err, { userId: record.userId, draftId: draft.id });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), status);
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
      ctx.json(ctx.res, { ok: true, draft: draftDetail(updated), teacher: teacher ? teacherDetail(teacher) : null });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err));
    }
    return true;
  }

  if (ctx.method === "DELETE" && teacherPath?.[1] && teacherPath?.[2]) {
    const draft = await requireDraft(deps.ruby, record, decodeURIComponent(teacherPath[1]), ctx);
    if (!draft) return true;
    try {
      const updated = deleteDraftTeacher(draft, decodeURIComponent(teacherPath[2]));
      await deps.ruby.saveDraftPackRecord(updated);
      ctx.json(ctx.res, { ok: true, draft: draftDetail(updated) });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), clientErrorStatus(err));
    }
    return true;
  }

  const materialsUrlPath = sub.match(/^\/([^/]+)\/teachers\/([^/]+)\/materials\/from-url$/);
  if (ctx.method === "POST" && materialsUrlPath?.[1] && materialsUrlPath?.[2]) {
    const draft = await requireDraft(deps.ruby, record, decodeURIComponent(materialsUrlPath[1]), ctx);
    if (!draft) return true;
    const rlKey = packLibraryRateKey(ctx, token);
    if (!MATERIALS_URL_LIMITER.take(rlKey)) {
      reject429(ctx, MATERIALS_URL_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
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
      ctx.json(ctx.res, { ok: true, draft: draftDetail(updated), teacher: teacher ? teacherDetail(teacher) : null });
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
    const body = await readBody(ctx);
    const credential = resolveQuestionGenerationCredential(ctx, deps.ruby, sessionId);
    if (!credential.apiKey) {
      ctx.error(ctx.res, openRouterGenerationRequiredMessage("generating questions"), 401);
      return true;
    }
    const teacherId = decodeURIComponent(generatePath[2]);
    const hallPassCost = credential.hosted ? QUESTION_GENERATION_HALL_PASS_COST : 0;
    const requestId = cleanClientRequestId(bodyString(body, "requestId")) || String(Date.now());
    const spendKey = `question-generation:${sessionId}:${draft.id}:${teacherId}:${requestId}`;
    try {
      const teacher = draft.teachers.find((entry) => entry.id === teacherId);
      if (!teacher) throw new Error("Unknown teacher.");
      let spend: ReturnType<RubyHighService["spendHallPasses"]> | null = null;
      if (hallPassCost > 0) {
        const existing = deps.ruby.walletTransaction(sessionId, spendKey);
        if (existing) {
          const metadata = existing.metadata ?? {};
          if (
            metadata.route !== "question-generation" ||
            metadata.requestId !== requestId ||
            metadata.draftId !== draft.id ||
            metadata.teacherId !== teacherId
          ) {
            ctx.error(ctx.res, "Question generation request id was already used for different inputs.", 409);
            return true;
          }
          if (metadata.status === "completed") {
            ctx.json(ctx.res, {
              ok: true,
              draft: draftDetail(draft),
              teacher: teacherDetail(teacher),
              hallPassCost,
              hallPasses: deps.ruby.hallPassBalance(sessionId),
              entitlements: hostedEntitlementStatus({ ruby: deps.ruby, sessionId }),
              replay: true,
            });
            return true;
          }
          if (metadata.status === "failed") {
            ctx.error(ctx.res, "Question generation request failed previously. Start a new request.", 409);
            return true;
          }
          ctx.error(ctx.res, "Question generation request is already in progress. Try again in a moment.", 409);
          return true;
        }
        if (deps.ruby.hallPassBalance(sessionId) < hallPassCost) {
          ctx.error(ctx.res, `Not enough Hall Passes. Need ${hallPassCost}, have ${deps.ruby.hallPassBalance(sessionId)}.`, 402);
          return true;
        }
        spend = deps.ruby.spendHallPasses(sessionId, {
          amount: hallPassCost,
          idempotencyKey: spendKey,
          source: "question-generation",
          description: "Generate more questions",
          metadata: {
            route: "question-generation",
            status: "pending",
            requestId,
            draftId: draft.id,
            teacherId,
          },
        });
        await deps.ruby.flushSession(sessionId);
      }
      const questions = await generateAdditionalQuestionsWithAi({
        apiKey: credential.apiKey,
        draft,
        teacher,
        questionCount: questionCountFrom(bodyValue(body, "questionCount"), MORE_QUESTIONS_COUNT),
      });
      const updated = appendGeneratedQuestionsForTeacher(draft, teacherId, questions);
      try {
        await deps.ruby.saveDraftPackRecord(updated);
        if (spend?.transaction) {
          deps.ruby.annotateWalletTransaction(sessionId, spendKey, {
            status: "completed",
            questionCount: questions.length,
          });
          await deps.ruby.flushSession(sessionId);
        }
      } catch (err) {
        if (spend?.applied) {
          const reason = err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160);
          deps.ruby.annotateWalletTransaction(sessionId, spendKey, {
            status: "failed",
            error: reason,
          });
          deps.ruby.refundHallPasses(sessionId, {
            amount: hallPassCost,
            idempotencyKey: `${spendKey}:refund`,
            source: "question-generation",
            description: "Generate more questions refund",
            metadata: {
              spendKey,
              draftId: draft.id,
              teacherId,
              reason,
            },
          });
          await deps.ruby.flushSession(sessionId);
        }
        throw err;
      }
      const updatedTeacher = updated.teachers.find((entry) => entry.id === teacherId);
      ctx.json(ctx.res, {
        ok: true,
        draft: draftDetail(updated),
        teacher: updatedTeacher ? teacherDetail(updatedTeacher) : null,
        hallPassCost,
        hallPasses: deps.ruby.hallPassBalance(sessionId),
        entitlements: hostedEntitlementStatus({ ruby: deps.ruby, sessionId }),
      });
    } catch (err) {
      // If the external generator failed after a hosted charge was reserved,
      // refund here. Save failures are refunded in the narrower block above.
      const tx = hallPassCost > 0 ? deps.ruby.walletTransaction(sessionId, spendKey) : null;
      if (tx?.metadata?.status === "pending" && Number(tx.hallPasses ?? 0) < 0) {
        const reason = err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160);
        deps.ruby.annotateWalletTransaction(sessionId, spendKey, { status: "failed", error: reason });
        deps.ruby.refundHallPasses(sessionId, {
          amount: hallPassCost,
          idempotencyKey: `${spendKey}:refund`,
          source: "question-generation",
          description: "Generate more questions refund",
          metadata: { spendKey, draftId: draft.id, teacherId, reason },
        });
        await deps.ruby.flushSession(sessionId);
      }
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
      ctx.json(ctx.res, { ok: true, draft: draftDetail(updated), teacher: teacher ? teacherDetail(teacher) : null });
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
      const reserved = await reserveCourseSlotForPublish({
        ruby: deps.ruby,
        record,
        sessionId,
        draft,
        packId: pack.id,
      });
      const publishedSlot = publishCourseSlot(reserved.slot, pack.id);
      await deps.ruby.persistPublicTeacherPack(pack, {
        creatorUserId: record.userId,
        courseSlot: publishedSlot,
        allowGlobalOverwrite: !!draft.derivedFrom,
      });
      const publishedDraft = touchDraft({ ...reserved.draft, derivedFrom: pack.id, courseSlot: publishedSlot });
      await deps.ruby.saveDraftPackRecord(publishedDraft);
      deps.ruby.annotateWalletTransaction(sessionId, publishedSlot.walletTransactionId, {
        status: "completed",
        route: "course-publish",
        draftId: publishedDraft.id,
        packId: pack.id,
      });
      await deps.ruby.flushSession(sessionId);
      await saveInstallationSet(deps.ruby, record.userId, [{
        packId: pack.id,
        enabled: true,
        active: false,
      }]);
      ctx.json(ctx.res, {
        ok: true,
        pack: packLibrarySummary(pack, {
          enabled: true,
          active: false,
          owner: true,
          readOnly: false,
          editDraftId: publishedDraft.id,
          source: "creator",
          installed: true,
        }),
        draft: draftDetail(publishedDraft),
        courseSlot: courseSlotDetail(publishedSlot),
        hallPassCost: reserved.created ? COURSE_SLOT_HALL_PASS_COST : 0,
        hallPasses: deps.ruby.hallPassBalance(sessionId),
        entitlements: hostedEntitlementStatus({ ruby: deps.ruby, sessionId }),
      });
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
  const state = ruby.getOrCreate(sessionId);
  const autoGuest = weeklyAutoGuestPack();
  const activeGuest = guestPackForSession(state);
  const activeGuestPackId = activeGuest?.id ?? null;
  const installs = await ruby.listPackInstallationRecords();
  const userInstalls = installs.filter((install) => install.userId === record.userId);
  const installByPack = new Map(userInstalls.map((install) => [install.packId, install]));
  const persistedPackRecords = await ruby.listPersistedPackRecords();
  const teacherRecords = await ruby.listTeacherRecords();
  const ownedPersistedPacks = persistedPackRecords
    .filter((entry) => entry.creatorUserId === record.userId || entry.ownerSessionId === sessionId)
    .map((entry) => entry.pack);
  const legacyOwnedPacks = teacherRecords
    .filter((teacher) => teacher.creatorUserId === record.userId && teacher.status === "published")
    .map((teacher) => teacher.pack);
  const visiblePacks = uniquePacks([
    await getActivePack(),
    ...availablePacksForSession(sessionId),
    ...ownedPersistedPacks,
    ...legacyOwnedPacks,
  ]);
  const userDrafts = (await ruby.listDraftPackRecords())
    .filter((draft) => draft.ownerUserId === record.userId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const publishedOwnedPackIds = new Set(
    teacherRecords
      .filter((teacher) => teacher.creatorUserId === record.userId && teacher.status === "published")
      .map((teacher) => teacher.packId),
  );
  const packs = visiblePacks.flatMap((pack) => {
    const install = installByPack.get(pack.id);
    const builtIn = pack.id === ORIGINAL_PACK_ID;
    const persistedRecords = persistedPackRecords.filter((entry) => entry.pack.id === pack.id);
    const source = packLibrarySource(pack, persistedRecords);
    const owner = publishedOwnedPackIds.has(pack.id) || persistedRecords.some((entry) =>
      entry.creatorUserId === record.userId || entry.ownerSessionId === sessionId);
    if (!builtIn && !owner && !install && source === "creator") return [];
    const backingDraft = owner ? backingDraftForPack(userDrafts, pack.id) : null;
    return [packLibrarySummary(pack, {
      enabled: install ? install.enabled : builtIn,
      active: builtIn || pack.id === activeGuestPackId,
      owner,
      readOnly: builtIn,
      editDraftId: backingDraft?.id,
      source,
      installed: !!install || builtIn || pack.id === activeGuestPackId,
    })];
  });
  const visiblePackIds = new Set(visiblePacks.map((pack) => pack.id));
  const drafts = userDrafts
    .filter((draft) => !isPublishedBackingDraft(draft, visiblePackIds))
    .map(draftSummary);
  return {
    activePackId,
    guest: guestPayload(state, autoGuest, activeGuest),
    packs: packs.sort((a, b) => Number(b.active) - Number(a.active) || Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)),
    drafts,
  };
}

async function creatorPackSearchPayload(
  ruby: RubyHighService,
  record: AuthRecord,
  sessionId: string,
  rawQuery: string,
) {
  const query = rawQuery.trim();
  const normalized = normalizeSearchQuery(query);
  const state = ruby.getOrCreate(sessionId);
  const activeGuestPackId = guestPackForSession(state)?.id ?? null;
  const installs = await ruby.listPackInstallationRecords();
  const userInstalls = installs.filter((install) => install.userId === record.userId);
  const installByPack = new Map(userInstalls.map((install) => [install.packId, install]));
  const userDrafts = (await ruby.listDraftPackRecords())
    .filter((draft) => draft.ownerUserId === record.userId);
  const records = uniquePackRecords(await ruby.listPersistedPackRecords())
    .filter((entry) => entry.ownerSessionId === null && packLibrarySource(entry.pack, [entry]) === "creator");

  const packs = records
    .map((entry) => ({
      entry,
      rank: packSearchRank(entry.pack, normalized),
    }))
    .sort((a, b) =>
      b.rank - a.rank ||
      b.entry.touchedAt - a.entry.touchedAt ||
      a.entry.pack.name.localeCompare(b.entry.pack.name)
    )
    .slice(0, PACK_SEARCH_LIMIT)
    .map(({ entry }) => {
      const install = installByPack.get(entry.pack.id);
      const owner = entry.creatorUserId === record.userId || entry.ownerSessionId === sessionId;
      const backingDraft = owner ? backingDraftForPack(userDrafts, entry.pack.id) : null;
      return packLibrarySummary(entry.pack, {
        enabled: !!install?.enabled,
        active: entry.pack.id === activeGuestPackId,
        owner,
        readOnly: false,
        editDraftId: backingDraft?.id,
        source: "creator",
        installed: !!install || entry.pack.id === activeGuestPackId,
      });
    });

  return {
    query,
    packs,
    limit: PACK_SEARCH_LIMIT,
  };
}

async function setPackEnabled(args: {
  ruby: RubyHighService;
  userId: string;
  sessionId: string;
  packId: string;
  enabled: boolean;
}): Promise<void> {
  if (args.packId === ORIGINAL_PACK_ID) {
    await setGuestAuto({ ruby: args.ruby, sessionId: args.sessionId });
    return;
  }
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
  if (!args.enabled && guestPackForSession(args.ruby.getOrCreate(args.sessionId))?.id === args.packId) {
    await setGuestAuto({ ruby: args.ruby, sessionId: args.sessionId });
  }
}

async function uninstallPack(args: {
  ruby: RubyHighService;
  userId: string;
  sessionId: string;
  packId: string;
}): Promise<void> {
  if (args.packId === ORIGINAL_PACK_ID) throw new Error("Ruby High Original cannot be uninstalled.");
  const installs = await args.ruby.listPackInstallationRecords();
  const existing = installs.find((entry) => entry.userId === args.userId && entry.packId === args.packId);
  const target = getPackByIdForSession(args.packId, args.sessionId);
  if (!target && !existing) throw new Error("Unknown pack.");
  if (existing) await args.ruby.deletePackInstallationRecord(args.userId, args.packId);
  if (guestPackForSession(args.ruby.getOrCreate(args.sessionId))?.id === args.packId) {
    await setGuestAuto({ ruby: args.ruby, sessionId: args.sessionId });
  }
}

async function setGuestAuto(args: {
  ruby: RubyHighService;
  sessionId: string;
}): Promise<void> {
  args.ruby.setGuestPackAutoForSession(args.sessionId);
  await args.ruby.flushSession(args.sessionId);
}

async function setGuestOverride(args: {
  ruby: RubyHighService;
  userId: string;
  sessionId: string;
  packId: string;
}): Promise<void> {
  if (args.packId === ORIGINAL_PACK_ID) {
    await setGuestAuto({ ruby: args.ruby, sessionId: args.sessionId });
    return;
  }
  const target = getPackByIdForSession(args.packId, args.sessionId);
  if (!target) throw new Error("Unknown pack.");
  const guestCandidate = guestPackForSession({
    activePackId: null,
    guestPackMode: "override",
    guestPackOverrideId: args.packId,
  });
  if (!guestCandidate || guestCandidate.id !== args.packId) throw new Error("Unknown creator pack.");
  args.ruby.setGuestPackOverrideForSession(args.sessionId, args.packId);
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
  const backingDrafts = (await args.ruby.listDraftPackRecords()).filter((draft) =>
    draft.ownerUserId === args.record.userId && draftBacksPack(draft, args.packId));
  await Promise.all(backingDrafts.map((draft) => args.ruby.deleteDraftPackRecord(draft.id)));
  await Promise.all(ownedLegacyTeachers.map((teacher) => args.ruby.deleteTeacherRecord(teacher.id)));
  const installs = await args.ruby.listPackInstallationRecords();
  await Promise.all(installs
    .filter((install) => install.packId === args.packId)
    .map((install) => args.ruby.deletePackInstallationRecord(install.userId, install.packId)));

  if (guestPackForSession(args.ruby.getOrCreate(args.sessionId))?.id === args.packId) {
    await setGuestAuto({ ruby: args.ruby, sessionId: args.sessionId });
  }
}

async function ensurePublishedEditDraft(args: {
  ruby: RubyHighService;
  record: AuthRecord;
  sessionId: string;
  packId: string;
}): Promise<StoredDraftContentPackRecord> {
  if (args.packId === ORIGINAL_PACK_ID) throw new Error("Ruby High Original is read only.");
  const userDrafts = (await args.ruby.listDraftPackRecords())
    .filter((draft) => draft.ownerUserId === args.record.userId);
  const existingDraft = backingDraftForPack(userDrafts, args.packId);
  if (existingDraft) return existingDraft;

  const persisted = (await args.ruby.listPersistedPackRecords()).filter((entry) => entry.pack.id === args.packId);
  const ownedPersisted = persisted.find((entry) =>
    entry.creatorUserId === args.record.userId || entry.ownerSessionId === args.sessionId);
  const ownedLegacyTeacher = (await args.ruby.listTeacherRecords())
    .find((teacher) => teacher.creatorUserId === args.record.userId && teacher.packId === args.packId);
  const pack = ownedPersisted?.pack ?? ownedLegacyTeacher?.pack ?? getPackByIdForSession(args.packId, args.sessionId);
  if (!pack) throw new Error("Unknown pack.");
  if (!ownedPersisted && !ownedLegacyTeacher) throw new Error("Only the owner can edit this pack.");

  const draft = draftFromPublishedPack(pack, {
    record: args.record,
    sessionId: args.sessionId,
    courseSlot: ownedPersisted?.courseSlot,
  });
  await args.ruby.saveDraftPackRecord(draft);
  return draft;
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

function guestPayload(
  state: ReturnType<RubyHighService["getOrCreate"]>,
  autoGuest: ContentPack | null,
  activeGuest: ContentPack | null,
) {
  const summary = (pack: ContentPack | null) => pack
    ? packLibrarySummary(pack, {
        enabled: true,
        active: activeGuest?.id === pack.id,
        owner: false,
        readOnly: false,
        source: "creator",
        installed: true,
      })
    : null;
  return {
    mode: state.guestPackMode ?? "auto",
    weekKey: guestWeekKey(),
    overridePackId: state.guestPackOverrideId ?? null,
    autoPackId: autoGuest?.id ?? null,
    activePackId: activeGuest?.id ?? null,
    auto: summary(autoGuest),
    active: summary(activeGuest),
  };
}

function packLibrarySummary(
  pack: ContentPack,
  opts: {
    enabled: boolean;
    active: boolean;
    owner: boolean;
    readOnly: boolean;
    editDraftId?: string;
    source: PackLibrarySource;
    installed?: boolean;
  },
) {
  const questionCount = countPackQuestions(pack);
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    source: opts.source,
    readOnly: opts.readOnly,
    builtIn: pack.id === ORIGINAL_PACK_ID,
    owner: opts.owner,
    installed: !!opts.installed,
    enabled: opts.enabled,
    active: opts.active,
    canEdit: opts.owner && !opts.readOnly,
    ...(opts.editDraftId ? { draftId: opts.editDraftId } : {}),
    canDelete: opts.owner && !opts.readOnly,
    canUninstall: !opts.readOnly && !!opts.installed,
    status: "published",
    facultyCount: pack.faculty.length,
    questionCount,
    courses: coursesForPack(pack),
  };
}

function packLibrarySource(pack: ContentPack, records: Array<{ creatorUserId?: string; courseSlot?: StoredCourseSlotRecord }>): PackLibrarySource {
  if (pack.id === ORIGINAL_PACK_ID) return "official";
  if (records.some((entry) => entry.creatorUserId || entry.courseSlot) || pack.id.startsWith("pack:") || pack.id.startsWith("teacher:")) {
    return "creator";
  }
  return "imported";
}

function uniquePackRecords(records: Awaited<ReturnType<RubyHighService["listPersistedPackRecords"]>>) {
  const out = new Map<string, (typeof records)[number]>();
  for (const record of records) {
    if (!out.has(record.pack.id) || (out.get(record.pack.id)?.touchedAt ?? 0) < record.touchedAt) {
      out.set(record.pack.id, record);
    }
  }
  return Array.from(out.values());
}

function normalizeSearchQuery(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).map((part) => part.trim()).filter(Boolean).slice(0, 8);
}

function packSearchRank(pack: ContentPack, terms: string[]): number {
  if (terms.length === 0) return 0;
  const fields = searchablePackFields(pack);
  let matchedTerms = 0;
  const score = terms.reduce((total, term) => {
    let termScore = 0;
    for (const field of fields) {
      if (field.text === term) termScore += field.weight * 2;
      else if (field.text.includes(term)) termScore += field.weight;
    }
    if (termScore > 0) matchedTerms += 1;
    return total + termScore;
  }, 0);
  return score + matchedTerms * 50 + (matchedTerms === terms.length ? 250 : 0);
}

function searchablePackFields(pack: ContentPack): Array<{ text: string; weight: number }> {
  const fields: Array<{ text: string; weight: number }> = [];
  const add = (weight: number, ...values: unknown[]) => {
    const text = values
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .filter((value) => value != null && String(value).trim())
      .map((value) => String(value).toLowerCase())
      .join(" ");
    if (text) fields.push({ text, weight });
  };
  add(80, pack.name);
  add(35, pack.description);
  for (const course of pack.courses ?? []) {
    add(55, course.title, course.subjects);
  }
  for (const room of pack.rooms ?? []) {
    add(20, room.name, room.channelName, room.description);
  }
  for (const faculty of pack.faculty) {
    add(50, faculty.displayName, faculty.shortName);
    add(30, faculty.subjects, faculty.bio);
    add(10, faculty.systemPrompt);
    for (const question of faculty.questions) {
      add(25, question.prompt, question.subject, question.explanation, question.rubric, question.acceptedAnswers);
      add(15, Object.values(question.options ?? {}));
    }
    for (const card of faculty.sourceCards ?? []) {
      add(25, card.front, card.back, card.subject);
      add(15, card.deckName, card.tags, card.acceptedAnswers);
    }
  }
  return fields;
}

function backingDraftForPack(
  drafts: StoredDraftContentPackRecord[],
  packId: string,
): StoredDraftContentPackRecord | null {
  return drafts.find((draft) => draftBacksPack(draft, packId)) ?? null;
}

function isPublishedBackingDraft(draft: StoredDraftContentPackRecord, visiblePackIds: Set<string>): boolean {
  if (draft.derivedFrom && visiblePackIds.has(draft.derivedFrom)) return true;
  return visiblePackIds.has(`pack:${draft.id}`);
}

function draftBacksPack(draft: StoredDraftContentPackRecord, packId: string): boolean {
  return draft.derivedFrom === packId || `pack:${draft.id}` === packId;
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
    ...(draft.derivedFrom ? { derivedFrom: draft.derivedFrom } : {}),
    ...(draft.courseSlot ? { courseSlot: courseSlotDetail(draft.courseSlot) } : {}),
    teacherCount: draft.teachers.length,
    questionCount: draft.teachers.reduce((sum, teacher) => sum + teacher.sourceCards.length + teacher.questions.length, 0),
    updatedAt: draft.updatedAt,
  };
}

function draftDetail(draft: StoredDraftContentPackRecord) {
  return {
    ...draftSummary(draft),
    teachers: draft.teachers.map((teacher) => teacherDetail(teacher)),
  };
}

function draftFromPublishedPack(
  pack: ContentPack,
  opts: { record: AuthRecord; sessionId: string; courseSlot?: StoredCourseSlotRecord },
): StoredDraftContentPackRecord {
  const now = Date.now();
  const draftId = newDraftId();
  const teachers = pack.faculty.map((faculty) => {
    const teacherId = newTeacherId();
    const draftFacultyId = draftTeacherFacultyIdForId(teacherId);
    return {
      id: teacherId,
      displayName: faculty.displayName,
      subject: faculty.subjects[0] ?? "",
      description: faculty.bio || "A custom Ruby High teacher.",
      quote: "",
      ...(faculty.assetTeacherId ? { assetTeacherId: faculty.assetTeacherId } : {}),
      ...(faculty.profileImageUrl ? { profileImageUrl: faculty.profileImageUrl } : {}),
      ...(faculty.stats ? { stats: faculty.stats } : {}),
      materials: materialsFromPublishedFaculty(faculty),
      sourceCards: (faculty.sourceCards ?? []).map((card) => ({ ...card, faculty: draftFacultyId })),
      questions: faculty.questions.map((question) => ({ ...question, faculty: draftFacultyId })),
      generationCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  });
  const visibility = opts.courseSlot?.visibility ?? "public";
  return {
    id: draftId,
    ownerUserId: opts.record.userId,
    ownerSessionId: opts.sessionId,
    name: pack.name,
    description: pack.description,
    visibility,
    derivedFrom: pack.id,
    courseSlot: editCourseSlotForPublishedDraft(pack, {
      draftId,
      record: opts.record,
      sessionId: opts.sessionId,
      courseSlot: opts.courseSlot,
      visibility,
      now,
    }),
    teachers,
    createdAt: now,
    updatedAt: now,
  };
}

function editCourseSlotForPublishedDraft(
  pack: ContentPack,
  opts: {
    draftId: string;
    record: AuthRecord;
    sessionId: string;
    courseSlot?: StoredCourseSlotRecord;
    visibility: StoredPackVisibility;
    now: number;
  },
): StoredCourseSlotRecord {
  if (opts.courseSlot) {
    return {
      ...opts.courseSlot,
      ownerUserId: opts.record.userId,
      ownerSessionId: opts.sessionId,
      draftId: opts.draftId,
      packId: pack.id,
      status: "published",
      visibility: opts.visibility,
      updatedAt: opts.now,
      publishedAt: opts.courseSlot.publishedAt ?? opts.now,
    };
  }
  const title = slugForText(pack.name || "course");
  const suffix = slugForText(opts.draftId).slice(-10);
  return {
    id: courseSlotId(opts.draftId),
    ownerUserId: opts.record.userId,
    ownerSessionId: opts.sessionId,
    draftId: opts.draftId,
    packId: pack.id,
    shareSlug: `${title}-${suffix}`,
    visibility: opts.visibility,
    status: "published",
    walletTransactionId: `published-edit:${slugForText(pack.id)}`,
    createdAt: opts.now,
    updatedAt: opts.now,
    publishedAt: opts.now,
  };
}

function materialsFromPublishedFaculty(faculty: ContentPack["faculty"][number]): string {
  const sourceCards = (faculty.sourceCards ?? []).map((card) =>
    [`## ${card.front}`, card.back].filter(Boolean).join("\n\n"));
  const questions = faculty.questions.map((question) => {
    const correct = question.correct && question.options ? question.options[question.correct] : "";
    return [
      `## ${question.prompt}`,
      correct ? `Correct answer: ${correct}` : "",
      question.explanation,
    ].filter(Boolean).join("\n\n");
  });
  return [
    faculty.bio,
    faculty.systemPrompt,
    ...sourceCards,
    ...questions,
  ].filter(Boolean).join("\n\n").slice(0, MAX_MATERIAL_CHARS);
}

function teacherDetail(teacher: StoredDraftTeacherRecord) {
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
        stat: classifyQuestionStat({
          prompt: card.front,
          subject: card.subject,
          explanation: card.back,
          correctAnswer: card.back,
        }),
        type: "source-card",
      })),
      ...teacher.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        answer: question.explanation ?? "",
        subject: question.subject,
        difficulty: question.difficulty,
        stat: normalizeQuestionStat(question.stat) ?? classifyQuestionStat({
          prompt: question.prompt,
          subject: question.subject,
          explanation: question.explanation,
          correctAnswer: question.correct && question.options ? question.options[question.correct] : undefined,
        }),
        type: question.type ?? "multiple-choice",
      })),
    ],
    facultyId,
  };
}

function courseSlotDetail(slot: StoredCourseSlotRecord) {
  return {
    id: slot.id,
    draftId: slot.draftId,
    shareSlug: slot.shareSlug,
    visibility: slot.visibility,
    status: slot.status,
    ...(slot.packId ? { packId: slot.packId } : {}),
    createdAt: slot.createdAt,
    updatedAt: slot.updatedAt,
    ...(slot.publishedAt ? { publishedAt: slot.publishedAt } : {}),
  };
}

interface CourseSlotReservation {
  draft: StoredDraftContentPackRecord;
  slot: StoredCourseSlotRecord;
  created: boolean;
}

async function reserveCourseSlotForPublish(args: {
  ruby: RubyHighService;
  record: AuthRecord;
  sessionId: string;
  draft: StoredDraftContentPackRecord;
  packId: string;
}): Promise<CourseSlotReservation> {
  const existing = args.draft.courseSlot;
  if (existing) {
    const slot: StoredCourseSlotRecord = {
      ...existing,
      ownerUserId: args.record.userId,
      ownerSessionId: args.sessionId,
      draftId: args.draft.id,
      packId: existing.packId ?? args.packId,
      visibility: args.draft.visibility,
      updatedAt: Date.now(),
    };
    const updatedDraft = slot === existing ? args.draft : touchDraft({ ...args.draft, courseSlot: slot });
    if (updatedDraft !== args.draft) await args.ruby.saveDraftPackRecord(updatedDraft);
    return { draft: updatedDraft, slot, created: false };
  }

  const now = Date.now();
  const baseSpendKey = courseSlotSpendKey(args.draft.id);
  const prior = args.ruby.walletTransaction(args.sessionId, baseSpendKey);
  const priorUsable = !!prior && prior.metadata?.status !== "failed";
  const spendKey = priorUsable
    ? baseSpendKey
    : prior
      ? courseSlotSpendKey(args.draft.id, `${now}-${randomBytes(4).toString("hex")}`)
      : baseSpendKey;
  const spend = priorUsable ? null : args.ruby.spendHallPasses(args.sessionId, {
    amount: COURSE_SLOT_HALL_PASS_COST,
    idempotencyKey: spendKey,
    source: "course-slot",
    description: "Course slot",
    metadata: {
      status: "reserved",
      route: "course-publish",
      draftId: args.draft.id,
      packId: args.packId,
    },
  });
  const slot: StoredCourseSlotRecord = {
    id: courseSlotId(args.draft.id),
    ownerUserId: args.record.userId,
    ownerSessionId: args.sessionId,
    draftId: args.draft.id,
    packId: args.packId,
    shareSlug: courseSlotShareSlug(args.draft),
    visibility: args.draft.visibility,
    status: "reserved",
    walletTransactionId: spendKey,
    createdAt: priorUsable ? prior.at : now,
    updatedAt: now,
  };
  const updatedDraft = touchDraft({ ...args.draft, courseSlot: slot });
  try {
    await args.ruby.saveDraftPackRecord(updatedDraft);
    await args.ruby.flushSession(args.sessionId);
  } catch (err) {
    if (spend?.applied) {
      args.ruby.annotateWalletTransaction(args.sessionId, spendKey, {
        status: "failed",
        error: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160),
      });
      args.ruby.refundHallPasses(args.sessionId, {
        amount: COURSE_SLOT_HALL_PASS_COST,
        idempotencyKey: `${spendKey}:refund`,
        source: "course-slot",
        description: "Course slot refund",
        metadata: {
          spendKey,
          draftId: args.draft.id,
          reason: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160),
        },
      });
      await args.ruby.flushSession(args.sessionId);
    }
    throw err;
  }
  return { draft: updatedDraft, slot, created: !!spend?.applied };
}

function publishCourseSlot(slot: StoredCourseSlotRecord, packId: string): StoredCourseSlotRecord {
  const now = Date.now();
  return {
    ...slot,
    packId,
    status: "published",
    updatedAt: now,
    publishedAt: slot.publishedAt ?? now,
  };
}

function courseSlotId(draftId: string): string {
  return `course-slot:${slugForText(draftId)}`;
}

function courseSlotSpendKey(draftId: string, attemptId?: string): string {
  const base = `course-slot:${slugForText(draftId)}`;
  return attemptId ? `${base}:${slugForText(attemptId).slice(0, 24)}` : base;
}

function courseSlotShareSlug(draft: StoredDraftContentPackRecord): string {
  const title = slugForText(draft.name || "course");
  const suffix = slugForText(draft.id).slice(-10);
  return `${title}-${suffix}`;
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

interface CourseGenerationCredential {
  apiKey: string | null;
  imageApiKey: string | null;
}

interface QuestionGenerationCredential {
  apiKey: string | null;
  hosted: boolean;
}

interface GeneratedCourseSpec {
  teacherId: string;
  displayName: string;
  subject: string;
  description: string;
  quote: string;
  courseTitle: string;
  courseDescription: string;
  questions: BankedQuestion[];
}

type GeneratedCourseMetadata = Omit<GeneratedCourseSpec, "questions">;

function resolveCourseGenerationCredential(
  ctx: Pick<PackLibraryRouteContext, "apiKeyHeader">,
  ruby: RubyHighService,
  sessionId: string,
): CourseGenerationCredential {
  const textCredential = resolveTextLlmCredential({
    apiKeyHeader: ctx.apiKeyHeader,
    ruby,
    sessionId,
  });
  const browserImageApiKey = ctx.apiKeyHeader?.trim() || null;
  if (textCredential.apiKey) {
    return {
      apiKey: textCredential.apiKey,
      imageApiKey: browserImageApiKey || (textCredential.source === "hosted" ? textCredential.apiKey : null),
    };
  }
  return { apiKey: null, imageApiKey: null };
}

function resolveQuestionGenerationCredential(
  ctx: Pick<PackLibraryRouteContext, "apiKeyHeader">,
  ruby: RubyHighService,
  sessionId: string,
): QuestionGenerationCredential {
  const textCredential = resolveTextLlmCredential({
    apiKeyHeader: ctx.apiKeyHeader,
    ruby,
    sessionId,
  });
  if (textCredential.apiKey && textCredential.source !== "hosted") {
    return { apiKey: textCredential.apiKey, hosted: false };
  }
  const hostedKey = hostedOpenRouterApiKey();
  if (hostedKey) return { apiKey: hostedKey, hosted: true };
  return { apiKey: null, hosted: false };
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

function appendGeneratedQuestionsForTeacher(
  draft: StoredDraftContentPackRecord,
  teacherId: string,
  questions: BankedQuestion[],
): StoredDraftContentPackRecord {
  const teacher = draft.teachers.find((entry) => entry.id === teacherId);
  if (!teacher) throw new Error("Unknown teacher.");
  if (questions.length === 0) throw new Error("Question generator did not return usable questions.");
  const day = new Date().toISOString().slice(0, 10);
  const countToday = teacher.generationDay === day ? teacher.generationCount : 0;
  if (countToday >= MAX_GENERATIONS_PER_DAY) {
    throw new Error(`Question generation is limited to ${MAX_GENERATIONS_PER_DAY} runs per teacher per day.`);
  }
  const updatedTeacher: StoredDraftTeacherRecord = {
    ...teacher,
    questions: [...teacher.questions, ...questions],
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

async function generateCourseSpecWithAi(args: {
  apiKey: string;
  draft: StoredDraftContentPackRecord;
  teacher: StoredDraftTeacherRecord | null;
  materials: string;
  questionCount: number;
}): Promise<GeneratedCourseSpec> {
  const teacherId = args.teacher?.id ?? newTeacherId();
  const requestedCount = Math.max(4, Math.min(24, args.questionCount || COURSE_GENERATION_QUESTION_COUNT));
  const materials = args.materials.trim();
  const prompt = [
    `Draft pack: ${args.draft.name || "Untitled Content Pack"}`,
    args.draft.description ? `Draft description: ${args.draft.description}` : "",
    args.teacher ? `Existing teacher name: ${args.teacher.displayName}` : "Create one teacher for this course.",
    args.teacher?.description ? `Existing teacher style: ${args.teacher.description}` : "",
    "Create a Ruby High course title and teacher from the course materials.",
    "Return only JSON. Do not include markdown fences.",
    "Use this exact shape:",
    `{"courseTitle":"...","courseDescription":"...","teacher":{"displayName":"...","subject":"...","description":"...","quote":"..."}}`,
    "If you mention quoted titles or phrases inside a JSON string, use single quotes or escaped double quotes so the JSON remains valid.",
    "Do not generate questions in this response.",
    "Course materials:",
    materials.slice(0, 24_000),
  ].filter(Boolean).join("\n\n");
  const response = await fetchLlmChatCompletions({
    apiKey: args.apiKey,
    title: "Ruby High Course Generator",
    timeoutMs: 45_000,
    body: {
      model: resolveStudentModel(),
      messages: [
        {
          role: "system",
          content: "You design concise Ruby High course packs. You always return valid JSON and no prose.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 900,
      temperature: 0.45,
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${llmProviderName()} ${response.status}: ${detail || response.statusText}`);
  }
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("Course generator returned an empty response.");
  const fallbackSubject = subjectFromHeading(args.draft.name || args.teacher?.displayName || firstMarkdownHeading(materials) || "course");
  const metadata = normalizeGeneratedCourseMetadataLenient(text, {
    teacherId,
    existingTeacher: args.teacher,
    fallbackSubject,
    fallbackTitle: cleanGeneratedText(args.draft.name || firstMarkdownHeading(materials), 80) || `${fallbackSubject} Course`,
    fallbackDescription: courseDescriptionFromMaterials(materials, fallbackSubject),
  });
  const questions = await generateCourseQuestionsWithAi({
    apiKey: args.apiKey,
    draft: args.draft,
    generated: metadata,
    materials,
    questionCount: requestedCount,
  });
  return { ...metadata, questions };
}

function normalizeGeneratedCourseMetadataLenient(
  text: string,
  opts: {
    teacherId: string;
    existingTeacher: StoredDraftTeacherRecord | null;
    fallbackSubject: string;
    fallbackTitle: string;
    fallbackDescription: string;
  },
): GeneratedCourseMetadata {
  try {
    return normalizeGeneratedCourseMetadata(parseJsonObject(text, "Course generator"), opts);
  } catch (err) {
    log.error("pack-draft.course-metadata-fallback", err, { teacherId: opts.teacherId });
    return fallbackGeneratedCourseMetadata(opts);
  }
}

function fallbackGeneratedCourseMetadata(opts: {
  teacherId: string;
  existingTeacher: StoredDraftTeacherRecord | null;
  fallbackSubject: string;
  fallbackTitle: string;
  fallbackDescription: string;
}): GeneratedCourseMetadata {
  const subject = cleanGeneratedText(opts.existingTeacher?.subject || opts.fallbackSubject, 80) || "open study";
  return {
    teacherId: opts.teacherId,
    displayName: cleanGeneratedText(opts.existingTeacher?.displayName, 64) || teacherNameFromSubject(subject),
    subject,
    description: cleanGeneratedText(opts.existingTeacher?.description, 700) ||
      `A focused Ruby High teacher who turns ${subject} materials into clear study questions.`,
    quote: cleanGeneratedText(opts.existingTeacher?.quote, 160) || "Read closely, answer carefully.",
    courseTitle: cleanGeneratedText(opts.fallbackTitle, 80) || `${subject} Course`,
    courseDescription: cleanGeneratedText(opts.fallbackDescription, 180) || `Generated course on ${subject}.`,
  };
}

async function generateCourseQuestionsWithAi(args: {
  apiKey: string;
  draft: StoredDraftContentPackRecord;
  generated: GeneratedCourseMetadata;
  materials: string;
  questionCount: number;
}): Promise<BankedQuestion[]> {
  const requestedCount = Math.max(4, Math.min(24, args.questionCount || COURSE_GENERATION_QUESTION_COUNT));
  const balanceTargets = questionBalanceTargets([], requestedCount);
  const questions: BankedQuestion[] = [];
  const maxBatches = Math.ceil(requestedCount / COURSE_GENERATION_QUESTION_BATCH_SIZE) + 2;
  for (let batchIndex = 0; questions.length < requestedCount && batchIndex < maxBatches; batchIndex += 1) {
    const batchCount = Math.min(COURSE_GENERATION_QUESTION_BATCH_SIZE, requestedCount - questions.length);
    const batch = await generateCourseQuestionBatchWithAi({
      ...args,
      questionCount: batchCount,
      startIndex: questions.length,
      existingQuestions: questions,
      balanceTargets: balanceTargets.slice(questions.length, questions.length + batchCount),
    });
    questions.push(...batch);
    if (batch.length < batchCount) break;
  }
  if (questions.length === 0) throw new Error("Course generator did not return usable questions.");
  return questions.slice(0, requestedCount);
}

async function generateCourseQuestionBatchWithAi(args: {
  apiKey: string;
  draft: StoredDraftContentPackRecord;
  generated: GeneratedCourseMetadata;
  materials: string;
  questionCount: number;
  startIndex: number;
  existingQuestions: BankedQuestion[];
  balanceTargets: readonly QuestionBalanceTarget[];
}): Promise<BankedQuestion[]> {
  const prompt = [
    `Draft pack: ${args.draft.name || "Untitled Content Pack"}`,
    `Teacher: ${args.generated.displayName}`,
    args.generated.subject ? `Subject: ${args.generated.subject}` : "",
    args.generated.description ? `Teacher style: ${args.generated.description}` : "",
    `Write exactly ${args.questionCount} multiple-choice study questions from the course materials.`,
    "Return only JSON. Do not include markdown fences.",
    "Use this exact shape:",
    `{"questions":[{"prompt":"...","subject":"...","difficulty":"easy","stat":"head","options":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A","explanation":"..."}]}`,
    "If you mention quoted titles or phrases inside a JSON string, use single quotes or escaped double quotes so the JSON remains valid.",
    "Questions must be answerable from the materials. Avoid duplicating existing cards. Difficulty must be easy, medium, or hard. Stat must be head, heart, hustle, or honor. correct must be A, B, C, or D.",
    existingQuestionPrompt(args.existingQuestions),
    questionBalanceStatusPrompt(args.existingQuestions.map((question) => ({
      difficulty: question.difficulty,
      stat: normalizeQuestionStat(question.stat) ?? "head",
    }))),
    questionBalancePrompt(args.balanceTargets),
    "Course materials:",
    args.materials.slice(0, 24_000),
  ].filter(Boolean).join("\n\n");
  const response = await fetchLlmChatCompletions({
    apiKey: args.apiKey,
    title: "Ruby High Course Question Generator",
    timeoutMs: 45_000,
    body: {
      model: resolveStudentModel(),
      messages: [
        {
          role: "system",
          content: "You write concise Ruby High multiple-choice study questions. You always return valid JSON and no prose.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: Math.max(1800, Math.min(4200, args.questionCount * 600)),
      temperature: 0.45,
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${llmProviderName()} ${response.status}: ${detail || response.statusText}`);
  }
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("Course question generator returned an empty response.");
  const parsed = parseJsonObject(text, "Course question generator");
  const root = asRecord(parsed);
  const rawQuestions = root?.questions ?? parsed;
  const questions = normalizeGeneratedQuestions(rawQuestions, {
    facultyId: draftTeacherFacultyIdForId(args.generated.teacherId),
    subject: args.generated.subject || subjectFromHeading(args.generated.displayName),
    limit: args.questionCount,
    startIndex: args.startIndex,
    balanceTargets: args.balanceTargets,
  });
  if (questions.length === 0) throw new Error("Course question generator did not return usable questions.");
  return questions;
}

function existingQuestionPrompt(questions: readonly BankedQuestion[]): string {
  if (questions.length === 0) return "";
  return [
    "Existing generated question prompts to avoid:",
    ...questions.slice(-12).map((question, index) => `${index + 1}. ${question.prompt}`),
  ].join("\n");
}

function firstMarkdownHeading(text: string): string {
  const line = text.split(/\r?\n/).find((entry) => /^#{1,3}\s+\S/.test(entry.trim()));
  return line ? line.replace(/^#{1,3}\s+/, "").trim() : "";
}

function courseDescriptionFromMaterials(materials: string, subject: string): string {
  const firstUsefulLine = materials
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
    .find((line) => line.length >= 24 && !/^\[[0-9]+\]/.test(line));
  return cleanGeneratedText(firstUsefulLine, 180) || `Generated course on ${subject}.`;
}

function teacherNameFromSubject(subject: string): string {
  const words = subject
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const last = words.find((word) => word.length > 3) ?? "Course";
  return `Professor ${last[0]!.toUpperCase()}${last.slice(1)}`;
}

async function generateAdditionalQuestionsWithAi(args: {
  apiKey: string;
  draft: StoredDraftContentPackRecord;
  teacher: StoredDraftTeacherRecord;
  questionCount: number;
}): Promise<BankedQuestion[]> {
  const materials = args.teacher.materials.trim();
  if (!materials) throw new Error("Course materials are required before generating questions.");
  const facultyId = draftTeacherFacultyId(args.teacher);
  const requestedCount = Math.max(2, Math.min(12, args.questionCount || MORE_QUESTIONS_COUNT));
  const existingCount = args.teacher.questions.length + args.teacher.sourceCards.length;
  const existingBalance = balanceItemsForTeacher(args.teacher);
  const balanceTargets = questionBalanceTargets(existingBalance, requestedCount);
  const prompt = [
    `Draft pack: ${args.draft.name || "Untitled Content Pack"}`,
    `Teacher: ${args.teacher.displayName}`,
    args.teacher.subject ? `Subject: ${args.teacher.subject}` : "",
    args.teacher.description ? `Teacher style: ${args.teacher.description}` : "",
    `Write exactly ${requestedCount} new multiple-choice study questions from the course materials.`,
    "Return only JSON. Do not include markdown fences.",
    "Use this exact shape:",
    `{"questions":[{"prompt":"...","subject":"...","difficulty":"easy","stat":"head","options":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A","explanation":"..."}]}`,
    "If you mention quoted titles or phrases inside a JSON string, use single quotes or escaped double quotes so the JSON remains valid.",
    "Questions must be answerable from the materials. Avoid duplicating existing cards. Difficulty must be easy, medium, or hard. Stat must be head, heart, hustle, or honor. correct must be A, B, C, or D.",
    questionBalanceStatusPrompt(existingBalance),
    questionBalancePrompt(balanceTargets),
    "Course materials:",
    materials.slice(0, 24_000),
  ].filter(Boolean).join("\n\n");
  const response = await fetchLlmChatCompletions({
    apiKey: args.apiKey,
    title: "Ruby High Question Generator",
    timeoutMs: 45_000,
    body: {
      model: resolveStudentModel(),
      messages: [
        {
          role: "system",
          content: "You write concise Ruby High multiple-choice study questions. You always return valid JSON and no prose.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 2600,
      temperature: 0.45,
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${llmProviderName()} ${response.status}: ${detail || response.statusText}`);
  }
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("Question generator returned an empty response.");
  const parsed = parseJsonObject(text, "Question generator");
  const root = asRecord(parsed);
  const rawQuestions = root?.questions ?? parsed;
  const questions = normalizeGeneratedQuestions(rawQuestions, {
    facultyId,
    subject: args.teacher.subject || subjectFromHeading(args.teacher.displayName),
    limit: requestedCount,
    startIndex: existingCount,
    balanceTargets,
  });
  if (questions.length === 0) throw new Error("Question generator did not return usable questions.");
  return questions;
}

async function generateCourseTeacherPortrait(args: {
  apiKey: string;
  generated: GeneratedCourseSpec;
}): Promise<string> {
  const personality = [
    args.generated.subject,
    args.generated.description,
    args.generated.quote,
    args.generated.courseTitle ? `Course: ${args.generated.courseTitle}` : "",
  ].filter(Boolean).join(" ");
  const dataUrl = await renderTeacherPortrait({
    apiKey: args.apiKey,
    name: args.generated.displayName,
    personality,
  });
  return cleanImageRef(await maybeUploadPortrait(dataUrl, "portrait"));
}

function applyGeneratedCourseSpec(
  draft: StoredDraftContentPackRecord,
  args: {
    teacherId: string;
    materials: string;
    materialSourceUrl: string;
    generated: GeneratedCourseSpec;
    profileImageUrl: string;
  },
): StoredDraftContentPackRecord {
  const existing = args.teacherId ? draft.teachers.find((entry) => entry.id === args.teacherId) ?? null : null;
  if (args.teacherId && !existing) throw new Error("Unknown teacher.");
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const countToday = existing && existing.generationDay === day ? existing.generationCount : 0;
  if (existing && countToday >= MAX_GENERATIONS_PER_DAY) {
    throw new Error(`Question generation is limited to ${MAX_GENERATIONS_PER_DAY} runs per teacher per day.`);
  }
  const generatedTeacher: StoredDraftTeacherRecord = {
    ...(existing ?? {
      id: args.generated.teacherId,
      displayName: args.generated.displayName,
      description: args.generated.description,
      materials: "",
      sourceCards: [],
      questions: [],
      generationCount: 0,
      createdAt: now,
      updatedAt: now,
    }),
    displayName: args.generated.displayName,
    subject: args.generated.subject,
    description: args.generated.description,
    quote: args.generated.quote,
    profileImageUrl: args.profileImageUrl || existing?.profileImageUrl,
    materials: args.materials.trim(),
    ...(args.materialSourceUrl ? { materialSourceUrl: args.materialSourceUrl } : {}),
    sourceCards: [],
    questions: args.generated.questions,
    generationDay: day,
    generationCount: countToday + 1,
    generatedAt: now,
    updatedAt: now,
  };
  if (!generatedTeacher.materialSourceUrl) delete generatedTeacher.materialSourceUrl;
  if (!generatedTeacher.profileImageUrl) delete generatedTeacher.profileImageUrl;
  const teachers = existing
    ? draft.teachers.map((entry) => entry.id === existing.id ? generatedTeacher : entry)
    : [...draft.teachers, generatedTeacher];
  const defaultDraftName = !draft.name || /^Untitled Content Pack$/i.test(draft.name.trim());
  return touchDraft({
    ...draft,
    name: defaultDraftName ? (args.generated.courseTitle || `${args.generated.displayName} Course`) : draft.name,
    description: draft.description || args.generated.courseDescription || args.generated.description,
    teachers,
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

function deleteDraftTeacher(
  draft: StoredDraftContentPackRecord,
  teacherId: string,
): StoredDraftContentPackRecord {
  if (!draft.teachers.some((entry) => entry.id === teacherId)) throw new Error("Unknown teacher.");
  return touchDraft({
    ...draft,
    teachers: draft.teachers.filter((entry) => entry.id !== teacherId),
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
      defaultModel: process.env.RUBY_HIGH_CREATOR_DEFAULT_MODEL || DEFAULT_CREATOR_MODEL,
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
    id: draft.derivedFrom || `pack:${draft.id}`,
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

function balanceItemsForTeacher(teacher: StoredDraftTeacherRecord): QuestionBalanceTarget[] {
  const fromQuestions = teacher.questions.map((question) => ({
    difficulty: question.difficulty,
    stat: normalizeQuestionStat(question.stat) ?? classifyQuestionStat({
      prompt: question.prompt,
      subject: question.subject,
      explanation: question.explanation,
      correctAnswer: question.correct && question.options ? question.options[question.correct] : undefined,
    }),
  }));
  const fromSourceCards = teacher.sourceCards.map((card) => ({
    difficulty: card.difficulty,
    stat: classifyQuestionStat({
      prompt: card.front,
      subject: card.subject,
      explanation: card.back,
      correctAnswer: card.back,
    }),
  }));
  return [...fromSourceCards, ...fromQuestions];
}

function questionBalanceTargets(
  existing: readonly QuestionBalanceTarget[],
  count: number,
): QuestionBalanceTarget[] {
  const difficultyCounts = countBy(GENERATED_DIFFICULTIES, existing.map((item) => item.difficulty));
  const statCounts = countBy(GENERATED_STATS, existing.map((item) => item.stat));
  const pairCounts = new Map<string, number>();
  for (const item of existing) {
    const key = balancePairKey(item.difficulty, item.stat);
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  const targets: QuestionBalanceTarget[] = [];
  for (let i = 0; i < Math.max(0, count); i += 1) {
    let best: QuestionBalanceTarget | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const difficulty of GENERATED_DIFFICULTIES) {
      for (const stat of GENERATED_STATS) {
        const key = balancePairKey(difficulty, stat);
        const score =
          (difficultyCounts[difficulty] * 4) +
          (statCounts[stat] * 3) +
          (pairCounts.get(key) ?? 0);
        if (
          score < bestScore ||
          (score === bestScore && best && balanceTieBreak(difficulty, stat, best) < 0)
        ) {
          best = { difficulty, stat };
          bestScore = score;
        }
      }
    }
    if (!best) break;
    targets.push(best);
    difficultyCounts[best.difficulty] += 1;
    statCounts[best.stat] += 1;
    const key = balancePairKey(best.difficulty, best.stat);
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  return targets;
}

function questionBalancePrompt(targets: readonly QuestionBalanceTarget[]): string {
  if (targets.length === 0) return "";
  const targetLines = targets
    .map((target, index) => `${index + 1}. difficulty=${target.difficulty}, stat=${target.stat}`)
    .join("\n");
  return [
    "Balance requirements:",
    "Use these target buckets in order. Each returned question must include the matching difficulty and stat.",
    "Stat meanings: head=facts/concepts/interpretation, heart=people/voice/audience/relationships, hustle=procedures/application/calculation/action, honor=evidence/safety/responsibility/rules.",
    targetLines,
  ].join("\n");
}

function questionBalanceStatusPrompt(existing: readonly QuestionBalanceTarget[]): string {
  if (existing.length === 0) return "Current teacher balance: no existing cards.";
  const difficultyCounts = countBy(GENERATED_DIFFICULTIES, existing.map((item) => item.difficulty));
  const statCounts = countBy(GENERATED_STATS, existing.map((item) => item.stat));
  return [
    `Current teacher balance: ${existing.length} existing cards.`,
    `Difficulty counts: ${GENERATED_DIFFICULTIES.map((difficulty) => `${difficulty}=${difficultyCounts[difficulty]}`).join(", ")}.`,
    `Stat counts: ${GENERATED_STATS.map((stat) => `${stat}=${statCounts[stat]}`).join(", ")}.`,
  ].join("\n");
}

function countBy<const T extends string>(keys: readonly T[], values: readonly T[]): Record<T, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
  for (const value of values) {
    if (Object.prototype.hasOwnProperty.call(counts, value)) counts[value] += 1;
  }
  return counts;
}

function balancePairKey(difficulty: Difficulty, stat: QuestionStat): string {
  return `${difficulty}:${stat}`;
}

function balanceTieBreak(difficulty: Difficulty, stat: QuestionStat, best: QuestionBalanceTarget): number {
  const difficultyDelta = GENERATED_DIFFICULTIES.indexOf(difficulty) - GENERATED_DIFFICULTIES.indexOf(best.difficulty);
  if (difficultyDelta !== 0) return difficultyDelta;
  return GENERATED_STATS.indexOf(stat) - GENERATED_STATS.indexOf(best.stat);
}

function normalizeGeneratedCourseMetadata(
  value: unknown,
  opts: {
    teacherId: string;
    existingTeacher: StoredDraftTeacherRecord | null;
    fallbackSubject: string;
  },
): GeneratedCourseMetadata {
  const root = asRecord(value);
  if (!root) throw new Error("Course generator response was not a JSON object.");
  const teacher = asRecord(root.teacher) ?? root;
  const displayName = cleanGeneratedText(
    firstString(teacher, ["displayName", "name", "teacherName"]) || opts.existingTeacher?.displayName || "Ruby High Teacher",
    64,
  ) || "Ruby High Teacher";
  const subject = cleanGeneratedText(
    firstString(teacher, ["subject", "class", "courseSubject"]) || firstString(root, ["subject"]) || opts.fallbackSubject,
    80,
  ) || "open study";
  const description = cleanGeneratedText(
    firstString(teacher, ["description", "persona", "bio"]) || opts.existingTeacher?.description || "A focused Ruby High teacher.",
    700,
  ) || "A focused Ruby High teacher.";
  const quote = cleanGeneratedText(firstString(teacher, ["quote", "signatureLine"]), 160);
  return {
    teacherId: opts.teacherId,
    displayName,
    subject,
    description,
    quote,
    courseTitle: cleanGeneratedText(firstString(root, ["courseTitle", "title", "packName"]), 80) || `${displayName} Course`,
    courseDescription: cleanGeneratedText(firstString(root, ["courseDescription", "description"]), 180) || description,
  };
}

function normalizeGeneratedQuestions(
  value: unknown,
  opts: {
    facultyId: string;
    subject: string;
    limit: number;
    startIndex?: number;
    balanceTargets?: readonly QuestionBalanceTarget[];
  },
): BankedQuestion[] {
  const rawQuestions = Array.isArray(value) ? value : [];
  const questions: BankedQuestion[] = [];
  const startIndex = Math.max(0, Math.floor(Number(opts.startIndex ?? 0)));
  rawQuestions.slice(0, Math.max(1, opts.limit)).forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) return;
    const prompt = cleanGeneratedText(firstString(record, ["prompt", "question"]), 420);
    const optionSet = generatedQuestionOptions(record);
    if (!prompt || !optionSet) return;
    const subject = cleanGeneratedText(firstString(record, ["subject", "topic"]), 80) || opts.subject || "open study";
    const target = opts.balanceTargets?.[questions.length] ?? null;
    const difficulty = target?.difficulty ?? cleanDifficulty(firstString(record, ["difficulty", "level"]));
    const explanation = cleanGeneratedText(
      firstString(record, ["explanation", "rationale", "answer"]),
      800,
    ) || optionSet.options[optionSet.correct];
    const stat = target?.stat ?? normalizeQuestionStat(firstString(record, ["stat", "trait", "attribute"])) ?? classifyQuestionStat({
      prompt,
      subject,
      correctAnswer: optionSet.options[optionSet.correct],
      explanation,
    });
    questions.push({
      id: `${opts.facultyId}-ai-${startIndex + index + 1}`,
      type: "multiple-choice",
      prompt,
      options: optionSet.options,
      correct: optionSet.correct,
      explanation,
      subject,
      difficulty,
      faculty: opts.facultyId,
      stat,
    });
  });
  return questions;
}

function generatedQuestionOptions(record: Record<string, unknown>): { options: Record<Choice, string>; correct: Choice } | null {
  const answer = cleanGeneratedText(firstString(record, ["answer", "correctAnswer"]), 220);
  const rawOptions = record.options;
  let values: string[] = [];
  if (Array.isArray(rawOptions)) {
    values = rawOptions.map((entry) => cleanGeneratedText(typeof entry === "string" ? entry : "", 220));
  } else {
    const optionRecord = asRecord(rawOptions);
    if (optionRecord) {
      values = ["A", "B", "C", "D"].map((key) => cleanGeneratedText(typeof optionRecord[key] === "string" ? optionRecord[key] : "", 220));
    }
  }
  if (values.filter(Boolean).length < 4 && answer) {
    const distractors = Array.isArray(record.distractors)
      ? record.distractors.map((entry) => cleanGeneratedText(typeof entry === "string" ? entry : "", 220)).filter(Boolean)
      : [];
    values = [answer, ...distractors].slice(0, 4);
  }
  values = values.slice(0, 4).map((entry) => cleanGeneratedText(entry, 220));
  if (values.length < 4 || values.some((entry) => !entry)) return null;
  const options: Record<Choice, string> = {
    A: values[0]!,
    B: values[1]!,
    C: values[2]!,
    D: values[3]!,
  };
  const correct = cleanChoice(record.correct)
    ?? correctChoiceFromAnswer(options, answer)
    ?? "A";
  return { options, correct };
}

function parseJsonObject(text: string, label = "Generator"): unknown {
  const cleaned = cleanGeneratedJsonText(text);
  const candidates = generatedJsonCandidates(cleaned);
  const errors: string[] = [];
  for (const candidate of candidates) {
    const direct = tryParseJson(candidate);
    if (direct.ok) return direct.value;
    errors.push(direct.error.message);

    const repaired = repairLooseGeneratedJson(candidate);
    if (repaired !== candidate) {
      const parsed = tryParseJson(repaired);
      if (parsed.ok) {
        log.event("pack-draft.generated-json-repaired", { label });
        return parsed.value;
      }
      errors.push(parsed.error.message);
    }
  }
  log.error("pack-draft.generated-json-invalid", new Error(errors[0] ?? "invalid JSON"), { label });
  throw new Error(`${label} returned invalid JSON.`);
}

function cleanGeneratedJsonText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function generatedJsonCandidates(cleaned: string): string[] {
  const candidates = [cleaned];
  const objectStart = cleaned.indexOf("{");
  const arrayStart = cleaned.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  if (start >= 0) {
    const end = cleaned.lastIndexOf(cleaned[start] === "{" ? "}" : "]");
    if (end > start) candidates.push(cleaned.slice(start, end + 1));
  }
  return Array.from(new Set(candidates.filter((candidate) => candidate.trim().length > 0)));
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: Error } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

function repairLooseGeneratedJson(text: string): string {
  return stripTrailingCommasOutsideStrings(escapeLooseJsonStringContent(text));
}

function escapeLooseJsonStringContent(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (!inString) {
      if (ch === "\"") inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      if (looseQuoteLooksTerminating(text, i)) {
        inString = false;
        out += ch;
      } else {
        out += "\\\"";
      }
      continue;
    }
    if (ch === "\n") {
      out += "\\n";
      continue;
    }
    if (ch === "\r") {
      out += "\\r";
      continue;
    }
    if (ch === "\t") {
      out += "\\t";
      continue;
    }
    out += ch;
  }
  return out;
}

function looseQuoteLooksTerminating(text: string, quoteIndex: number): boolean {
  const nextIndex = nextMeaningfulIndex(text, quoteIndex + 1);
  if (nextIndex < 0) return true;
  const next = text[nextIndex];
  if (next === ":" || next === "}" || next === "]") return true;
  if (next !== ",") return false;
  const afterCommaIndex = nextMeaningfulIndex(text, nextIndex + 1);
  if (afterCommaIndex < 0) return true;
  const afterComma = text[afterCommaIndex]!;
  return afterComma === "\"" ||
    afterComma === "{" ||
    afterComma === "[" ||
    afterComma === "}" ||
    afterComma === "]" ||
    afterComma === "-" ||
    /[0-9tfn]/.test(afterComma);
}

function stripTrailingCommasOutsideStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "," && ["]", "}"].includes(text[nextMeaningfulIndex(text, i + 1)] ?? "")) {
      continue;
    }
    out += ch;
  }
  return out;
}

function nextMeaningfulIndex(text: string, start: number): number {
  for (let i = start; i < text.length; i += 1) {
    if (!/\s/.test(text[i]!)) return i;
  }
  return -1;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function cleanGeneratedText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanChoice(value: unknown): Choice | null {
  if (typeof value === "number") return (["A", "B", "C", "D"] as Choice[])[value] ?? null;
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return upper === "A" || upper === "B" || upper === "C" || upper === "D" ? upper : null;
}

function correctChoiceFromAnswer(options: Record<Choice, string>, answer: string): Choice | null {
  const normalized = normalizeGeneratedAnswer(answer);
  if (!normalized) return null;
  return (["A", "B", "C", "D"] as Choice[]).find((choice) => normalizeGeneratedAnswer(options[choice]) === normalized) ?? null;
}

function normalizeGeneratedAnswer(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function cleanDifficulty(value: string): Difficulty {
  const normalized = value.trim().toLowerCase();
  return normalized === "easy" || normalized === "medium" || normalized === "hard" ? normalized : "medium";
}

function questionCountFrom(value: unknown, fallback = COURSE_GENERATION_QUESTION_COUNT): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(4, Math.min(24, Math.floor(n)));
}

function generationCountToday(teacher: StoredDraftTeacherRecord): number {
  const day = new Date().toISOString().slice(0, 10);
  return teacher.generationDay === day ? teacher.generationCount : 0;
}

async function fetchMarkdownMaterials(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  let currentUrl = url;
  try {
    for (let redirects = 0; redirects <= MAX_MATERIAL_URL_REDIRECTS; redirects++) {
      await assertSafeMaterialsUrl(currentUrl);
      const response = await fetch(currentUrl, {
        method: "GET",
        headers: { Accept: "text/markdown,text/plain,*/*" },
        redirect: "manual",
        signal: ctrl.signal,
      });
      if (isRedirectStatus(response.status)) {
        if (redirects >= MAX_MATERIAL_URL_REDIRECTS) {
          throw new Error("Materials URL redirected too many times.");
        }
        currentUrl = nextMaterialsRedirectUrl(currentUrl, response);
        continue;
      }
      if (!response.ok) throw new Error(`Could not fetch materials (${response.status}).`);
      const contentType = response.headers.get("content-type") || "";
      if (contentType && !/text|markdown|json|octet-stream/i.test(contentType)) {
        throw new Error("Materials URL must return markdown or plain text.");
      }
      const text = await readLimitedResponseText(response, MAX_MATERIAL_CHARS);
      if (text.length > MAX_MATERIAL_CHARS) {
        throw new Error(`Course materials must be ${MAX_MATERIAL_CHARS} characters or less.`);
      }
      return text;
    }
    throw new Error("Materials URL redirected too many times.");
  } finally {
    clearTimeout(timer);
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function nextMaterialsRedirectUrl(currentUrl: string, response: Response): string {
  const location = response.headers.get("location")?.trim();
  if (!location) throw new Error("Materials URL redirected without a location.");
  let next: URL;
  try {
    next = new URL(location, currentUrl);
  } catch {
    throw new Error("Materials URL redirect is invalid.");
  }
  return normalizeMarkdownSourceUrl(next.toString());
}

function normalizeMarkdownSourceUrl(raw: string): string {
  const input = raw.trim();
  if (!input) throw new Error("URL required.");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Materials URL is invalid.");
  }
  if (url.username || url.password) throw new Error("Materials URL must not contain credentials.");
  if (url.protocol === "http:" && process.env.RUBY_HIGH_ALLOW_HTTP_MATERIAL_URLS !== "true") {
    throw new Error("Materials URL must use https.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Materials URL must be http or https.");
  if (url.hostname.toLowerCase() === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const blobIndex = parts.indexOf("blob");
    if (parts.length >= 5 && blobIndex === 2) {
      const [owner, repo, , branch, ...path] = parts;
      url = new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.join("/")}`);
    } else {
      throw new Error("GitHub materials URL must point to a file blob.");
    }
  }
  assertAllowedMaterialsHost(url);
  return url.toString();
}

function assertAllowedMaterialsHost(url: URL): void {
  const hostname = url.hostname.toLowerCase();
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new Error("Materials URL host resolves to a private or reserved address.");
    throw new Error("Materials URL host is not allowed.");
  }
  if (allowedMaterialUrlHosts().has(hostname)) return;
  throw new Error(`Materials URL host is not allowed. Supported hosts: ${materialHostListLabel()}.`);
}

function allowedMaterialUrlHosts(): Set<string> {
  const hosts = new Set<string>(DEFAULT_MATERIAL_URL_HOSTS);
  const configured = process.env.RUBY_HIGH_ALLOWED_MATERIAL_HOSTS ?? "";
  for (const host of configured.split(",")) {
    const clean = host.trim().toLowerCase();
    if (clean) hosts.add(clean);
  }
  return hosts;
}

function materialHostListLabel(): string {
  return Array.from(allowedMaterialUrlHosts()).sort().join(", ");
}

async function assertSafeMaterialsUrl(raw: string): Promise<void> {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Materials URL host is not allowed.");
  }
  let addresses: string[];
  try {
    addresses = isIP(hostname)
      ? [hostname]
      : (await lookup(hostname, { all: true, verbatim: false })).map((entry) => entry.address);
  } catch {
    throw new Error("Materials URL host could not be resolved.");
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new Error("Materials URL host resolves to a private or reserved address.");
  }
}

function isBlockedAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const parts = address.split(".").map((part) => Number(part));
    const [a = 0, b = 0, c = 0] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (v === 6) {
    const normalized = address.toLowerCase();
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isBlockedAddress(mapped[1]);
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized === "2001:db8::" ||
      normalized.startsWith("2001:db8:")
    );
  }
  return true;
}

async function readLimitedResponseText(response: Response, maxChars: number): Promise<string> {
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await response.text();
    if (text.length > maxChars) throw new Error(`Course materials must be ${maxChars} characters or less.`);
    return text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > maxChars) {
        await reader.cancel().catch(() => {});
        throw new Error(`Course materials must be ${maxChars} characters or less.`);
      }
    }
    text += decoder.decode();
    if (text.length > maxChars) throw new Error(`Course materials must be ${maxChars} characters or less.`);
    return text;
  } finally {
    reader.releaseLock();
  }
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

function packLibraryRateKey(ctx: PackLibraryRouteContext, token: string): string {
  return `${ctx.clientIp || "no-ip"}:${token || "anon"}`;
}

function reject429(ctx: PackLibraryRouteContext, retryAfterSeconds: number): void {
  const res = ctx.res as { setHeader?: (name: string, value: string) => void };
  res.setHeader?.("Retry-After", String(Math.max(1, retryAfterSeconds)));
  ctx.error(ctx.res, "Too many requests - slow down a moment.", 429);
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

function cleanClientRequestId(value: string): string {
  return /^[A-Za-z0-9_-]{8,96}$/.test(value) ? value : "";
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
  return draftTeacherFacultyIdForId(teacher.id);
}

function draftTeacherFacultyIdForId(teacherId: string): string {
  return `draft-${slugForText(teacherId)}`;
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
    message.includes("Materials URL") ||
    message.includes("materials") ||
    message.includes("Course materials") ||
    message.includes("Generate questions") ||
    message.includes("Add at least") ||
    message.includes("read only") ||
    message.includes("limited") ||
    message.includes("usable questions")
  ) return 400;
  if ((message.startsWith("Need ") && (message.includes("Hall Pass") || message.includes("Card"))) || message.startsWith("Not enough Hall Passes") || message.startsWith("Not enough Cards")) return 402;
  return 500;
}
