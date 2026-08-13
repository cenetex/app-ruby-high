import { createHash, randomUUID } from "node:crypto";
import {
  fetchLlmChatCompletions,
  hasConfiguredLlmCredential,
  llmProviderName,
  resolveCourseModel,
  throwLlmResponseError,
} from "../services/llm-provider.js";
import { log, logMetricsSnapshot } from "../services/logger.js";
import { validateCurriculumCandidateQuestions } from "../services/ruby-high/curriculum-candidate-validation.js";
import type { AuthAnalyticsSnapshot, AuthService } from "../services/auth-service.js";
import type { PublicWorldTeacherAgendaRecord, RubyHighAnalyticsSnapshot, RubyHighService } from "../services/ruby-high-service.js";
import type { StoredDraftContentPackRecord, StoredDraftTeacherRecord } from "../services/state-store.js";
import { getActivePack } from "../content/registry.js";
import type { ContentPack, PackSourceCard } from "../content/types.js";
import { APP_ROUTE_PREFIX, X_SOCIAL_PREFIX } from "./constants.js";
import { requireAdminAuth } from "./admin-auth.js";
import type { RouteContext } from "./context.js";
import type { BankedQuestion, Grade } from "../types.js";
import { multipleChoiceDefinition } from "../question-choices.js";

export const ADMIN_PATH = `${APP_ROUTE_PREFIX}/admin`;
export const ADMIN_METRICS_PATH = `${APP_ROUTE_PREFIX}/admin/metrics`;
export const ADMIN_METRICS_SCHEMA_PATH = `${APP_ROUTE_PREFIX}/admin/metrics/schema`;
export const ADMIN_OVERVIEW_PATH = `${APP_ROUTE_PREFIX}/admin/overview`;
export const ADMIN_CURRICULUM_REPLENISHMENT_PATH = `${APP_ROUTE_PREFIX}/admin/curriculum/replenishment`;
export const ADMIN_WORLD_MODERATION_PATH = `${APP_ROUTE_PREFIX}/admin/world/moderation`;
export const ADMIN_METRICS_SCHEMA_VERSION = "ruby-high-admin-metrics.v8";
const ADMIN_METRICS_SCHEMA_PUBLISHED_AT = "2026-08-09";
const ADMIN_METRICS_DEFAULT_TRUST_START = "2026-07-26";
const BUILT_IN_GENERATOR_FACULTY_IDS = new Set(["ruby", "sally-science", "professor-edward"]);
const BUILT_IN_QUESTION_FILES: Record<string, string> = {
  ruby: "assets/questions/ruby.json",
  "sally-science": "assets/questions/sally-science.json",
  "professor-edward": "assets/questions/professor-edward.json",
};

interface AdminDeps {
  auth: AuthService;
  ruby: RubyHighService;
  ops?: AdminOpsSnapshot;
}

export interface AdminOpsSnapshot {
  publicReadLimiter: {
    trackedKeys: number;
    gcIntervalMs: number;
    lastGcAt: number | null;
  };
  worldLiveStreams: {
    active: number;
    clients: number;
    limitPerClient: number;
    saturatedClients: number;
    maxClientStreams: number;
    accepted: number;
    rejected: number;
    closed: number;
    closedByClient: number;
    closedByFinish: number;
    closedByTimeout: number;
    closedByWriteFailure: number;
    handlerErrors: number;
    writeFailures: number;
    initialWriteFailures: number;
    snapshotWriteFailures: number;
    eventWriteFailures: number;
    heartbeatWriteFailures: number;
    endWriteFailures: number;
  };
}

interface AdminMetricsSnapshot {
  ok: true;
  schemaVersion: typeof ADMIN_METRICS_SCHEMA_VERSION;
  schemaPath: typeof ADMIN_METRICS_SCHEMA_PATH;
  generatedAt: string;
  auth: AuthAnalyticsSnapshot;
  ruby: RubyHighAnalyticsSnapshot;
  ops: AdminOpsSnapshot;
  logs: ReturnType<typeof logMetricsSnapshot>;
  quality: AdminMetricsQuality;
}

interface AdminOverview {
  headline: string;
  summary: string;
  highlights: string[];
  risks: string[];
  actions: string[];
}

interface AdminCurriculumReplenishmentStep {
  grade: string;
  facultyId: string;
  displayName: string;
  mode: "manual-curation" | "generate";
  lowPoolSessions: number;
  exhaustedSessions: number;
  repeatedAnswers: number;
  repeatedAnswerSessions: number;
  averageRepeatedAnswers: number;
  repetitionPressure: number;
  weakSubjects: string[];
  recentConcepts: string[];
  targetNewQuestions: number;
  targetDifficulty: string;
  targetMinGrade: string;
  focusSubjects: string[];
  sourceCardIds: string[];
  corpusId: string | null;
  corpusTitle: string | null;
  corpusPath: string | null;
  researchInterests: string[];
  researchLanes: string[];
  readingList: string[];
  canonicalMisconceptions: string[];
  sourcePackets: Array<{
    id: string;
    title: string;
    anchor: string;
    summary: string;
    grades: string[];
    subjects: string[];
    questionSeeds: string[];
  }>;
  gradeBrief: string | null;
  researchDirective: string;
  promptSeed: string;
  command: string[] | null;
  displayCommand: string | null;
  reason: string;
  teacherAgenda: AdminCurriculumTeacherAgendaSummary | null;
}

interface AdminCurriculumTeacherAgendaSummary {
  id: string;
  executionStatus: PublicWorldTeacherAgendaRecord["executionStatus"];
  executionReason: PublicWorldTeacherAgendaRecord["executionReason"];
  nextAction: PublicWorldTeacherAgendaRecord["nextAction"];
  priorityScore: number;
  updatedAt: number;
  termRuleLabel: string | null;
  termRuleTarget: number | null;
  draftId: string | null;
  draftStatus: PublicWorldTeacherAgendaRecord["draftStatus"] | null;
  draftQuestionCount: number | null;
  draftUpdatedAt: number | null;
  draftApprovedAt: number | null;
  draftPromotedAt: number | null;
  promotedQuestionCount: number | null;
}

interface AdminCurriculumReplenishmentSnapshot {
  ok: true;
  generatedAt: string;
  source: typeof ADMIN_METRICS_PATH;
  dryRun: true;
  planCount: number;
  steps: AdminCurriculumReplenishmentStep[];
  generationQueue: AdminCurriculumGenerationProposal[];
  reviewQueue: AdminCurriculumReviewDraftSummary[];
}

interface AdminCurriculumGenerationProposal extends AdminCurriculumReplenishmentStep {
  requestId: string;
  priority: number;
  status: "ready" | "queued" | "satisfied" | "manual-curation" | "unsupported";
  draftId: string | null;
  action: "create-draft" | "review-draft" | "monitor-coverage" | "curate-manually" | "unsupported";
  autoEligible: boolean;
  autoReason: string;
}

interface AdminCurriculumReviewDraftSummary {
  id: string;
  name: string;
  facultyId: string;
  grade: string;
  requestDay: string;
  teacherCount: number;
  sourceCardCount: number;
  questionCount: number;
  updatedAt: number;
  validation: {
    ok: boolean;
    errors: string[];
  };
  approval: {
    approved: boolean;
    approvedAt: number | null;
    approvedBy: string | null;
    stale: boolean;
    required: boolean;
  };
}

interface AdminCurriculumDraftResult {
  ok: true;
  generatedAt: string;
  dryRun: false;
  trigger: "manual" | "coverage-exhaustion";
  created: number;
  reused: number;
  drafts: Array<{
    id: string;
    name: string;
    facultyId: string;
    grade: string;
    mode: AdminCurriculumReplenishmentStep["mode"];
    status: "created" | "existing";
    teacherCount: number;
    sourceCardCount: number;
    questionCount: number;
    generationSource: "deterministic" | "llm" | "llm-fallback";
    generationModel: string | null;
  }>;
}

interface AdminCurriculumDraftExport {
  ok: true;
  generatedAt: string;
  dryRun: true;
  draftId: string;
  facultyId: string;
  grade: Grade;
  requestDay: string;
  targetFile: string;
  questionCount: number;
  questions: BankedQuestion[];
  sourceQuestionIds: string[];
}

interface AdminCurriculumDraftApproval {
  ok: true;
  dryRun: false;
  draftId: string;
  facultyId: string;
  grade: string;
  approvedAt: number;
  approvedBy: string;
  questionCount: number;
  fingerprint: string;
}

interface AdminCurriculumDraftPromotion extends Omit<AdminCurriculumDraftExport, "dryRun"> {
  dryRun: false;
  promoted: {
    packId: string;
    inserted: number;
    skipped: number;
    totalQuestions: number;
  };
}

interface AdminMetricsQualityIssue {
  field: string;
  severity: "info" | "warning";
  issue: string;
  recommendedUse: string;
}

interface AdminMetricsQuality {
  trustStart: string | null;
  issues: AdminMetricsQualityIssue[];
}

interface AdminMetricFieldSchema {
  path: string;
  label: string;
  source: string;
  semantics: string;
  reliability: "authoritative" | "proxy" | "legacy" | "volatile" | "missing";
  caveat?: string;
}

function buildAdminMetricsSnapshot(deps: AdminDeps): AdminMetricsSnapshot {
  const ruby = deps.ruby.analyticsSnapshot();
  const auth = deps.auth.analyticsSnapshot(Date.now(), deps.ruby.syntheticAuthUserIds());
  const logs = logMetricsSnapshot();
  const ops = deps.ops ?? {
    publicReadLimiter: {
      trackedKeys: 0,
      gcIntervalMs: 0,
      lastGcAt: null,
    },
    worldLiveStreams: {
      active: 0,
      clients: 0,
      limitPerClient: 0,
      saturatedClients: 0,
      maxClientStreams: 0,
      accepted: 0,
      rejected: 0,
      closed: 0,
      closedByClient: 0,
      closedByFinish: 0,
      closedByTimeout: 0,
      closedByWriteFailure: 0,
      handlerErrors: 0,
      writeFailures: 0,
      initialWriteFailures: 0,
      snapshotWriteFailures: 0,
      eventWriteFailures: 0,
      heartbeatWriteFailures: 0,
      endWriteFailures: 0,
    },
  };
  return {
    ok: true,
    schemaVersion: ADMIN_METRICS_SCHEMA_VERSION,
    schemaPath: ADMIN_METRICS_SCHEMA_PATH,
    generatedAt: new Date().toISOString(),
    auth,
    ruby,
    ops,
    logs,
    quality: buildAdminMetricsQuality({ auth, ruby, logs }),
  };
}

function buildAdminCurriculumReplenishmentSteps(deps: AdminDeps): AdminCurriculumReplenishmentStep[] {
  const curriculum = deps.ruby.curriculumCoverageSnapshot();
  const agendas = deps.ruby.publicWorldTeacherAgendas();
  return (curriculum.lowPools ?? [])
    .map((row): AdminCurriculumReplenishmentStep | null => {
      const plan = row.replenishment;
      if (!plan) return null;
      const canRunBuiltInGenerator = plan.mode === "generate" && BUILT_IN_GENERATOR_FACULTY_IDS.has(row.facultyId);
      const target = Math.max(row.totalEligibleMax, 0) + Math.max(plan.targetNewQuestions, 0);
      const command = canRunBuiltInGenerator
        ? [
            "node",
            "scripts/generate-built-in-question-bank.mjs",
            `--faculty=${row.facultyId}`,
            `--target=${target}`,
          ]
        : null;
      return {
        grade: row.grade,
        facultyId: row.facultyId,
        displayName: row.displayName,
        mode: plan.mode,
        lowPoolSessions: row.lowPoolSessions,
        exhaustedSessions: row.exhaustedSessions,
        repeatedAnswers: row.repeatedAnswers,
        repeatedAnswerSessions: row.repeatedAnswerSessions,
        averageRepeatedAnswers: row.averageRepeatedAnswers,
        repetitionPressure: row.repetitionPressure,
        weakSubjects: row.weakSubjects,
        recentConcepts: row.recentConcepts,
        targetNewQuestions: plan.targetNewQuestions,
        targetDifficulty: plan.targetDifficulty,
        targetMinGrade: plan.targetMinGrade,
        focusSubjects: plan.focusSubjects,
        sourceCardIds: plan.sourceCardIds,
        corpusId: plan.corpusId,
        corpusTitle: plan.corpusTitle,
        corpusPath: plan.corpusPath,
        researchInterests: plan.researchInterests,
        researchLanes: plan.researchLanes,
        readingList: plan.readingList,
        canonicalMisconceptions: plan.canonicalMisconceptions,
        sourcePackets: plan.sourcePackets,
        gradeBrief: plan.gradeBrief,
        researchDirective: plan.researchDirective,
        promptSeed: plan.promptSeed,
        command,
        displayCommand: command ? command.map(shellWord).join(" ") : null,
        reason: plan.mode === "manual-curation"
          ? "Freshman starter pools are intentionally hand-curated; review this row before adding cards."
          : canRunBuiltInGenerator
            ? "Built-in teacher pool can be expanded with the corpus-backed generator."
            : "This low pool belongs to a non-built-in pack; replenish it through the pack editor.",
        teacherAgenda: adminCurriculumTeacherAgendaForStep({ grade: row.grade, facultyId: row.facultyId }, agendas),
      };
    })
    .filter((step): step is AdminCurriculumReplenishmentStep => !!step);
}

function adminCurriculumTeacherAgendaForStep(
  step: Pick<AdminCurriculumReplenishmentStep, "grade" | "facultyId">,
  agendas: readonly PublicWorldTeacherAgendaRecord[],
): AdminCurriculumTeacherAgendaSummary | null {
  const agenda = agendas
    .filter((entry) => entry.grade === step.grade && entry.facultyId === step.facultyId)
    .sort((a, b) =>
      b.priorityScore - a.priorityScore ||
      b.updatedAt - a.updatedAt
    )[0];
  if (!agenda) return null;
  return {
    id: agenda.id,
    executionStatus: agenda.executionStatus,
    executionReason: agenda.executionReason,
    nextAction: agenda.nextAction,
    priorityScore: agenda.priorityScore,
    updatedAt: agenda.updatedAt,
    termRuleLabel: agenda.termRuleLabel ?? null,
    termRuleTarget: agenda.termRuleTarget ?? null,
    draftId: agenda.draftId ?? null,
    draftStatus: agenda.draftStatus ?? null,
    draftQuestionCount: agenda.draftQuestionCount ?? null,
    draftUpdatedAt: agenda.draftUpdatedAt ?? null,
    draftApprovedAt: agenda.draftApprovedAt ?? null,
    draftPromotedAt: agenda.draftPromotedAt ?? null,
    promotedQuestionCount: agenda.promotedQuestionCount ?? null,
  };
}

async function buildAdminCurriculumReplenishmentSnapshot(deps: AdminDeps): Promise<AdminCurriculumReplenishmentSnapshot> {
  const steps = buildAdminCurriculumReplenishmentSteps(deps);
  const pack = await getActivePack();
  const draftRecords = await deps.ruby.listDraftPackRecords();
  const reviewQueue = draftRecords
    .map((draft) => adminCurriculumReviewDraftSummary(draft, pack))
    .filter((draft): draft is AdminCurriculumReviewDraftSummary => !!draft)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
  const generationQueue = buildAdminCurriculumGenerationQueue(steps, draftRecords);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: ADMIN_METRICS_PATH,
    dryRun: true,
    planCount: steps.length,
    steps,
    generationQueue,
    reviewQueue,
  };
}

function buildAdminCurriculumGenerationQueue(
  steps: readonly AdminCurriculumReplenishmentStep[],
  drafts: readonly StoredDraftContentPackRecord[],
  now = Date.now(),
): AdminCurriculumGenerationProposal[] {
  const day = new Date(now).toISOString().slice(0, 10);
  return steps
    .map((step) => {
      const requestId = adminCurriculumRequestId(step, day);
      const existing = drafts.find((draft) =>
        draft.teachers.some((teacher) => teacher.clientRequestId === requestId)
      );
      const status: AdminCurriculumGenerationProposal["status"] = step.teacherAgenda?.draftStatus === "questions-promoted"
        ? "satisfied"
        : existing
          ? "queued"
          : step.mode === "manual-curation"
          ? "manual-curation"
          : step.command
            ? "ready"
            : "unsupported";
      const action: AdminCurriculumGenerationProposal["action"] = status === "ready"
        ? "create-draft"
        : status === "queued"
          ? "review-draft"
          : status === "satisfied"
            ? "monitor-coverage"
          : status === "manual-curation"
            ? "curate-manually"
            : "unsupported";
      return {
        ...step,
        requestId,
        priority: adminCurriculumGenerationPriority(step),
        status,
        draftId: existing?.id ?? null,
        action,
        autoEligible: adminCurriculumAutoEnqueueEligible(step, status),
        autoReason: adminCurriculumAutoEnqueueReason(step, status),
      };
    })
    .sort((a, b) =>
      b.priority - a.priority ||
      statusRank(a.status) - statusRank(b.status) ||
      Number(a.grade) - Number(b.grade) ||
      a.displayName.localeCompare(b.displayName) ||
      a.facultyId.localeCompare(b.facultyId)
    );
}

function adminCurriculumAutoEnqueueEligible(
  step: AdminCurriculumReplenishmentStep,
  status: AdminCurriculumGenerationProposal["status"],
): boolean {
  return status === "ready"
    && step.mode === "generate"
    && !!step.command
    && (step.exhaustedSessions > 0 || adminCurriculumAgendaCanAutoEnqueue(step));
}

function adminCurriculumAutoEnqueueReason(
  step: AdminCurriculumReplenishmentStep,
  status: AdminCurriculumGenerationProposal["status"],
): string {
  if (status === "queued") return "A replenishment draft is already queued for review.";
  if (status === "satisfied") return "Reviewed questions were promoted; monitor coverage before creating another draft.";
  if (status === "manual-curation") return "Freshman starter pools require manual curation.";
  if (status !== "ready") return "This pool is not ready for automatic replenishment.";
  if (step.mode !== "generate") return "Only generated-mode pools can be auto-enqueued.";
  if (!step.command) return "Only built-in teacher pools with a generator command can be auto-enqueued.";
  if (step.exhaustedSessions > 0) return "Coverage exhaustion can auto-create a review draft.";
  if (adminCurriculumAgendaCanAutoEnqueue(step)) {
    return step.teacherAgenda?.termRuleLabel
      ? `Teacher agenda is ready from ${step.teacherAgenda.termRuleLabel}.`
      : "Teacher agenda is ready for draft generation.";
  }
  if (step.exhaustedSessions <= 0) return "Automatic replenishment waits for at least one exhausted active session.";
  return "Coverage exhaustion can auto-create a review draft.";
}

function adminCurriculumAgendaCanAutoEnqueue(step: AdminCurriculumReplenishmentStep): boolean {
  return step.teacherAgenda?.executionStatus === "ready"
    && step.teacherAgenda.nextAction === "generate-draft";
}

function adminCurriculumRequestId(step: Pick<AdminCurriculumReplenishmentStep, "grade" | "facultyId">, day: string): string {
  return `curriculum-replenishment:${day}:${step.grade}:${step.facultyId}`;
}

function adminCurriculumGenerationPriority(step: AdminCurriculumReplenishmentStep): number {
  return step.exhaustedSessions * 100
    + step.lowPoolSessions * 10
    + Math.round(step.repetitionPressure * 25)
    + (step.teacherAgenda?.executionStatus === "ready" ? step.teacherAgenda.priorityScore : 0)
    + step.targetNewQuestions;
}

function statusRank(status: AdminCurriculumGenerationProposal["status"]): number {
  if (status === "ready") return 0;
  if (status === "queued") return 1;
  if (status === "satisfied") return 2;
  if (status === "manual-curation") return 3;
  return 4;
}

async function createAdminCurriculumReplenishmentDrafts(
  deps: AdminDeps,
  opts: { limit?: number; useLlm?: boolean; trigger?: "manual" | "coverage-exhaustion" } = {},
): Promise<AdminCurriculumDraftResult> {
  const steps = buildAdminCurriculumReplenishmentSteps(deps);
  const existingDrafts = await deps.ruby.listDraftPackRecords();
  const queue = buildAdminCurriculumGenerationQueue(steps, existingDrafts);
  const trigger = opts.trigger ?? "manual";
  const runnableSteps = trigger === "coverage-exhaustion"
    ? queue.filter((step) => step.autoEligible)
    : queue.filter((step) => (step.status === "ready" || step.status === "queued") && step.command);
  const defaultLimit = runnableSteps.length || 1;
  const requestedLimit = Math.floor(Number(opts.limit));
  const limitSource = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : defaultLimit;
  const limit = Math.max(1, Math.min(12, limitSource));
  const selected = runnableSteps.slice(0, limit);
  const pack = await getActivePack();
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const drafts: AdminCurriculumDraftResult["drafts"] = [];
  let created = 0;
  let reused = 0;

  for (const step of selected) {
    const requestId = adminCurriculumRequestId(step, day);
    const existing = existingDrafts.find((draft) =>
      draft.teachers.some((teacher) => teacher.clientRequestId === requestId)
    );
    if (existing) {
      reused += 1;
      drafts.push(adminCurriculumDraftSummary(existing, step, "existing"));
      continue;
    }

    const faculty = pack.faculty.find((entry) => entry.id === step.facultyId);
    const teacherId = `teacher_curriculum_${slugForAdminId(`${step.grade}-${step.facultyId}-${randomUUID()}`).slice(0, 40)}`;
    const draftFacultyId = draftFacultyIdForAdminTeacher(teacherId);
    const sourceCards = selectCurriculumSourceCards(faculty?.sourceCards ?? [], step)
      .map((card) => ({ ...card, faculty: draftFacultyId }));
    const generated = await generateAdminCurriculumDraftQuestions(step, sourceCards, draftFacultyId, opts);
    const teacher: StoredDraftTeacherRecord = {
      id: teacherId,
      clientRequestId: requestId,
      displayName: step.displayName,
      subject: step.focusSubjects[0] ?? faculty?.subjects[0] ?? step.targetDifficulty,
      description: faculty?.bio || `Curriculum replenishment queue for ${step.displayName}.`,
      quote: "Research the gap before you write the card.",
      ...(faculty?.assetTeacherId ? { assetTeacherId: faculty.assetTeacherId } : {}),
      ...(faculty?.profileImageUrl ? { profileImageUrl: faculty.profileImageUrl } : {}),
      ...(faculty?.stats ? { stats: faculty.stats } : {}),
      materials: curriculumDraftMaterials(step, sourceCards, generated),
      sourceCards,
      questions: generated.questions,
      generationCount: 0,
      generationDay: day,
      generatedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const draft: StoredDraftContentPackRecord = {
      id: `draft_curriculum_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      ownerUserId: "admin:curriculum",
      ownerSessionId: "admin:curriculum",
      name: `Curriculum Replenishment: ${step.displayName} Grade ${step.grade}`,
      description: [
        `Pending review draft for ${step.displayName}'s grade ${step.grade} curriculum.`,
        step.promptSeed,
      ].join("\n\n"),
      visibility: "private",
      derivedFrom: pack.id,
      teachers: [teacher],
      createdAt: now,
      updatedAt: now,
    };
    await deps.ruby.saveDraftPackRecord(draft);
    deps.ruby.recordPublicWorldTeacherAgendaDraftOutcome({
      grade: step.grade as Grade,
      facultyId: step.facultyId,
      draftId: draft.id,
      draftStatus: "review-draft-created",
      draftQuestionCount: generated.questions.length,
      now,
    });
    existingDrafts.push(draft);
    created += 1;
    drafts.push(adminCurriculumDraftSummary(draft, step, "created", generated.source, generated.model));
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    dryRun: false,
    trigger,
    created,
    reused,
    drafts,
  };
}

function selectCurriculumSourceCards(cards: readonly PackSourceCard[], step: AdminCurriculumReplenishmentStep): PackSourceCard[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const selected = step.sourceCardIds
    .map((id) => byId.get(id))
    .filter((card): card is PackSourceCard => !!card);
  if (selected.length > 0) return selected;
  const focus = new Set(step.focusSubjects);
  return cards.filter((card) => focus.size === 0 || focus.has(card.subject)).slice(0, 12);
}

async function generateAdminCurriculumDraftQuestions(
  step: AdminCurriculumReplenishmentStep,
  sourceCards: readonly PackSourceCard[],
  draftFacultyId: string,
  opts: { useLlm?: boolean },
): Promise<{ questions: BankedQuestion[]; source: "deterministic" | "llm" | "llm-fallback"; model: string | null }> {
  if (!opts.useLlm || !hasConfiguredLlmCredential()) {
    return {
      questions: buildAdminCurriculumCandidateQuestions(step, sourceCards, draftFacultyId),
      source: "deterministic",
      model: null,
    };
  }
  const model = resolveCourseModel();
  try {
    const questions = await generateAdminCurriculumDraftQuestionsWithLlm(step, sourceCards, draftFacultyId, model);
    if (questions.length > 0) return { questions, source: "llm", model };
  } catch (err) {
    log.error("admin.curriculum-llm-draft-failed", err);
  }
  return {
    questions: buildAdminCurriculumCandidateQuestions(step, sourceCards, draftFacultyId),
    source: "llm-fallback",
    model,
  };
}

async function generateAdminCurriculumDraftQuestionsWithLlm(
  step: AdminCurriculumReplenishmentStep,
  sourceCards: readonly PackSourceCard[],
  draftFacultyId: string,
  model: string,
): Promise<BankedQuestion[]> {
  const count = adminCurriculumCandidateCount(step, sourceCards);
  const r = await fetchLlmChatCompletions({
    label: "admin-curriculum-draft",
    title: "Ruby High Curriculum",
    timeoutMs: 45_000,
    body: {
      model,
      temperature: 0.45,
      max_tokens: 2600,
      messages: [
        {
          role: "system",
          content: [
            "You are Ruby High's curriculum editor.",
            "Return JSON only.",
            "Write review-ready multiple-choice candidate questions from the teacher research corpus.",
            "Do not copy existing prompts. Avoid blind expansion and repeated concepts.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Return JSON: {"questions":[...]}. Create ${count} questions.`,
            `Faculty: ${step.displayName} (${step.facultyId})`,
            `Draft faculty id: ${draftFacultyId}`,
            `Grade/minGrade: ${step.targetMinGrade}`,
            `Difficulty: ${step.targetDifficulty}`,
            `Weak subjects: ${step.weakSubjects.join(", ") || "none"}`,
            `Focus subjects: ${step.focusSubjects.join(", ") || "teacher corpus"}`,
            `Recent concepts to avoid: ${step.recentConcepts.join(", ") || "none"}`,
            `Repetition pressure: ${Math.round(step.repetitionPressure * 100)}%`,
            `Teacher agenda: ${adminCurriculumTeacherAgendaPrompt(step)}`,
            `Research directive: ${step.researchDirective}`,
            `Research lanes: ${step.researchLanes.join(" | ") || "none"}`,
            `Reading list: ${step.readingList.join(" | ") || "none"}`,
            `Canonical misconceptions: ${step.canonicalMisconceptions.join(" | ") || "none"}`,
            `Grade brief: ${step.gradeBrief ?? "none"}`,
            `Primary source packets: ${adminCurriculumSourcePacketPrompt(step)}`,
            `Source cards: ${sourceCards.slice(0, 8).map((card) => `[${card.id} ${card.subject}/${card.difficulty}] ${card.front} => ${card.back}`).join(" | ") || "none"}`,
            "Each question must include: id, type='multiple-choice', prompt, correct answer text, decoys (array of at least 3 plausible wrong answers), explanation, subject, difficulty, minGrade, faculty, stat.",
            "Use faculty as the draft faculty id. Use stat one of head, heart, hustle, honor.",
          ].join("\n"),
        },
      ],
    },
  });
  if (!r.ok) await throwLlmResponseError(r, "admin-curriculum-draft");
  const body = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content?.trim() ?? "";
  const parsed = parseJsonObject(content);
  if (!parsed) throw new Error("Generated curriculum draft returned no JSON object.");
  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
  const questions = rawQuestions
    .map((entry, index) => normalizeAdminCurriculumLlmQuestion(entry, index, step, draftFacultyId))
    .filter((question): question is BankedQuestion => !!question)
    .slice(0, count);
  const validation = validateCurriculumCandidateQuestions({
    facultyId: step.facultyId,
    targetMinGrade: step.targetMinGrade as Grade,
    questions,
  });
  if (!validation.ok) throw new Error(`Generated curriculum draft failed validation: ${validation.errors.join("; ")}`);
  return questions;
}

function normalizeAdminCurriculumLlmQuestion(
  entry: unknown,
  index: number,
  step: AdminCurriculumReplenishmentStep,
  draftFacultyId: string,
): BankedQuestion | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const options = record.options && typeof record.options === "object" ? record.options as Record<string, unknown> : null;
  const definition = multipleChoiceDefinition({
    correct: typeof record.correct === "string" ? record.correct : undefined,
    decoys: Array.isArray(record.decoys)
      ? record.decoys.filter((value): value is string => typeof value === "string")
      : undefined,
    options: options
      ? {
          A: String(options.A ?? ""),
          B: String(options.B ?? ""),
          C: String(options.C ?? ""),
          D: String(options.D ?? ""),
        }
      : undefined,
  });
  if (!definition) return null;
  const id = String(record.id || `draft-${slugForAdminId(`${step.facultyId}-${step.grade}-llm-${index + 1}`)}`).trim();
  const question: BankedQuestion = {
    id: slugForAdminId(id).startsWith("draft-") ? slugForAdminId(id) : `draft-${slugForAdminId(id)}`,
    type: "multiple-choice",
    prompt: String(record.prompt || "").trim(),
    correct: definition.correct,
    decoys: definition.decoys,
    explanation: String(record.explanation || "").trim(),
    subject: slugForAdminId(String(record.subject || step.focusSubjects[0] || step.weakSubjects[0] || "teacher-research")).slice(0, 48) || "teacher-research",
    difficulty: step.targetDifficulty as BankedQuestion["difficulty"],
    minGrade: step.targetMinGrade as Grade,
    faculty: draftFacultyId,
    stat: ["head", "heart", "hustle", "honor"].includes(String(record.stat)) ? String(record.stat) as NonNullable<BankedQuestion["stat"]> : "head",
  };
  return question;
}

function curriculumDraftMaterials(
  step: AdminCurriculumReplenishmentStep,
  sourceCards: readonly PackSourceCard[],
  generated: { source: "deterministic" | "llm" | "llm-fallback"; model: string | null },
): string {
  const cardRows = sourceCards.length
    ? sourceCards.map((card, index) => `${index + 1}. [${card.subject}/${card.difficulty}] ${card.front} => ${card.back}`).join("\n")
    : "No source cards were matched; use the teacher corpus before generating.";
  const candidateTopics = adminCurriculumCandidateTopics(step, sourceCards)
    .slice(0, adminCurriculumCandidateCount(step, sourceCards))
    .map((topic, index) => `${index + 1}. ${topic.label} — ${topic.lane}`)
    .join("\n");
  return [
    `# Curriculum Replenishment Request`,
    `Faculty: ${step.displayName} (${step.facultyId})`,
    `Grade: ${step.grade}`,
    `Mode: ${step.mode}`,
    `Generation source: ${generated.source}`,
    `Generation model: ${generated.model ?? "none"}`,
    `Target: ${step.targetNewQuestions} ${step.targetDifficulty} questions with minGrade ${step.targetMinGrade}`,
    `Focus subjects: ${step.focusSubjects.join(", ") || "teacher corpus"}`,
    `Weak subjects: ${step.weakSubjects.join(", ") || "none detected"}`,
    `Recent concepts to avoid: ${step.recentConcepts.join(", ") || "none detected"}`,
    `Repetition pressure: ${Math.round(step.repetitionPressure * 100)}% (${step.repeatedAnswers} repeated answers across ${step.repeatedAnswerSessions} sessions)`,
    `Teacher agenda: ${adminCurriculumTeacherAgendaPrompt(step)}`,
    `Corpus: ${step.corpusTitle ? `${step.corpusTitle} (${step.corpusPath ?? "unknown path"})` : "source-card corpus only"}`,
    `Research interests: ${step.researchInterests.join(", ") || "derived from source cards"}`,
    `Grade brief: ${step.gradeBrief ?? "none"}`,
    ``,
    `## Research Directive`,
    step.researchDirective,
    ``,
    ...(step.readingList.length
      ? [
          `## Reading List`,
          ...step.readingList.map((entry, index) => `${index + 1}. ${entry}`),
          ``,
        ]
      : []),
    ...(step.canonicalMisconceptions.length
      ? [
          `## Canonical Misconceptions`,
          ...step.canonicalMisconceptions.map((entry, index) => `${index + 1}. ${entry}`),
          ``,
        ]
      : []),
    ...(step.researchLanes.length
      ? [
          `## Research Lanes`,
          ...step.researchLanes.map((lane, index) => `${index + 1}. ${lane}`),
          ``,
        ]
      : []),
    ...(step.sourcePackets.length
      ? [
          `## Primary Source Packets`,
          ...step.sourcePackets.map((packet, index) => [
            `${index + 1}. ${packet.title} (${packet.id})`,
            `   Anchor: ${packet.anchor}`,
            `   Summary: ${packet.summary}`,
            `   Question seeds: ${packet.questionSeeds.join(" | ")}`,
          ].join("\n")),
          ``,
        ]
      : []),
    `## Prompt Seed`,
    step.promptSeed,
    ``,
    `## Automatic Candidate Drafts`,
    candidateTopics || "No automatic candidate topics were available; review the corpus manually.",
    ``,
    `## Source Cards`,
    cardRows,
  ].join("\n");
}

function adminCurriculumTeacherAgendaPrompt(step: Pick<AdminCurriculumReplenishmentStep, "teacherAgenda">): string {
  const agenda = step.teacherAgenda;
  if (!agenda) return "none";
  const rule = agenda.termRuleLabel
    ? `; term rule ${agenda.termRuleLabel}${agenda.termRuleTarget ? ` target ${agenda.termRuleTarget}` : ""}`
    : "";
  const draft = agenda.draftStatus
    ? `; draft ${agenda.draftStatus}${agenda.draftQuestionCount != null ? ` (${agenda.draftQuestionCount} questions)` : ""}`
    : "";
  return `${agenda.executionStatus}/${agenda.executionReason}; next ${agenda.nextAction}; priority ${agenda.priorityScore}${rule}${draft}`;
}

function adminCurriculumSourcePacketPrompt(step: AdminCurriculumReplenishmentStep): string {
  if (!step.sourcePackets.length) return "none";
  return step.sourcePackets
    .slice(0, 4)
    .map((packet) => [
      `[${packet.id}] ${packet.title}`,
      `anchor=${packet.anchor}`,
      `summary=${packet.summary}`,
      `seeds=${packet.questionSeeds.slice(0, 2).join(" / ")}`,
    ].join(" :: "))
    .join(" | ");
}

function buildAdminCurriculumCandidateQuestions(
  step: AdminCurriculumReplenishmentStep,
  sourceCards: readonly PackSourceCard[],
  draftFacultyId: string,
): BankedQuestion[] {
  const topics = adminCurriculumCandidateTopics(step, sourceCards);
  const count = adminCurriculumCandidateCount(step, sourceCards);
  return topics.slice(0, count).map((topic, index): BankedQuestion => {
    const n = index + 1;
    const answers = adminCurriculumCandidateOptions(step, topic);
    return {
      id: `draft-${slugForAdminId(`${step.facultyId}-${step.grade}-${topic.label}-${n}`)}`,
      type: "multiple-choice",
      prompt: adminCurriculumCandidatePrompt(step, topic),
      correct: answers.A,
      decoys: [answers.B, answers.C, answers.D],
      explanation: adminCurriculumCandidateExplanation(step, topic),
      subject: topic.subject,
      difficulty: step.targetDifficulty as BankedQuestion["difficulty"],
      minGrade: step.targetMinGrade as Grade,
      faculty: draftFacultyId,
      stat: adminCurriculumCandidateStat(step, topic),
      ...(topic.sourceCardId ? { sourceCardId: topic.sourceCardId } : {}),
    };
  });
}

function adminCurriculumCandidateCount(
  step: AdminCurriculumReplenishmentStep,
  sourceCards: readonly PackSourceCard[],
): number {
  const topicCount = Math.max(
    sourceCards.length,
    step.weakSubjects.length,
    step.focusSubjects.length,
    step.researchLanes.length,
    1,
  );
  return Math.max(1, Math.min(6, step.targetNewQuestions, topicCount));
}

function adminCurriculumCandidateTopics(
  step: AdminCurriculumReplenishmentStep,
  sourceCards: readonly PackSourceCard[],
): Array<{ label: string; subject: string; lane: string; sourceCardId?: string; sourcePrompt?: string }> {
  const topics: Array<{ label: string; subject: string; lane: string; sourceCardId?: string; sourcePrompt?: string }> = [];
  const seen = new Set<string>();
  function pushTopic(label: string, lane: string, sourceCard?: PackSourceCard): void {
    const cleanLabel = cleanCurriculumTopic(label) || cleanCurriculumTopic(sourceCard?.subject) || "teacher research";
    const key = cleanLabel.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    topics.push({
      label: cleanLabel,
      subject: slugForAdminId(sourceCard?.subject || cleanLabel).slice(0, 48) || "teacher-research",
      lane: lane.trim() || step.researchDirective,
      ...(sourceCard?.id ? { sourceCardId: sourceCard.id } : {}),
      ...(sourceCard?.front ? { sourcePrompt: sourceCard.front } : {}),
    });
  }
  for (const subject of step.weakSubjects) {
    const lane = step.researchLanes.find((entry) => entry.toLowerCase().includes(subject.toLowerCase())) ?? step.researchLanes[0] ?? step.researchDirective;
    const card = sourceCards.find((entry) => entry.subject === subject);
    pushTopic(subject, lane, card);
  }
  for (const subject of step.focusSubjects) {
    const lane = step.researchLanes.find((entry) => entry.toLowerCase().includes(subject.toLowerCase())) ?? step.researchLanes[topics.length % Math.max(1, step.researchLanes.length)] ?? step.researchDirective;
    const card = sourceCards.find((entry) => entry.subject === subject);
    pushTopic(subject, lane, card);
  }
  for (const card of sourceCards) {
    pushTopic(card.subject || card.id, step.researchLanes[topics.length % Math.max(1, step.researchLanes.length)] ?? step.researchDirective, card);
  }
  for (const lane of step.researchLanes) {
    const label = lane.split(":")[0] || lane;
    pushTopic(label, lane);
  }
  if (topics.length === 0) pushTopic(step.researchInterests[0] ?? "teacher research", step.researchDirective);
  return topics;
}

function cleanCurriculumTopic(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[^\w .:/+-]+/g, "")
    .trim()
    .slice(0, 72);
}

function adminCurriculumCandidatePrompt(
  step: AdminCurriculumReplenishmentStep,
  topic: { label: string; lane: string; sourcePrompt?: string },
): string {
  const label = topic.label || "the research lane";
  if (step.facultyId === "sally-science") {
    return `Sally Science is rebuilding a grade ${step.grade} ${label} pool. Which move makes the next lab question scientifically trustworthy?`;
  }
  if (step.facultyId === "professor-edward") {
    return `Professor Edward is rebuilding a grade ${step.grade} ${label} seminar pool. Which move makes the next question responsible literary analysis?`;
  }
  return `Ruby is rebuilding a grade ${step.grade} ${label} pool. Which move makes the next classroom question useful without repeating the old deck?`;
}

function adminCurriculumCandidateOptions(
  step: AdminCurriculumReplenishmentStep,
  topic: { label: string; sourcePrompt?: string },
): NonNullable<BankedQuestion["options"]> {
  if (step.facultyId === "sally-science") {
    return {
      A: `Use a concrete ${topic.label} scenario with variables, evidence, and one tested misconception`,
      B: "Change the vocabulary while keeping the same hidden assumption",
      C: "Ask for a memorized slogan without units, controls, or observations",
      D: "Reward the answer that sounds confident before checking the evidence",
    };
  }
  if (step.facultyId === "professor-edward") {
    return {
      A: `Anchor the ${topic.label} question in a precise textual choice and a plausible misreading`,
      B: "Treat the narrator and author as the same voice in every passage",
      C: "Ask for plot recall while pretending it is interpretation",
      D: "Reward a fashionable theory label without evidence from the text",
    };
  }
  return {
    A: `Turn ${topic.label} into a small classroom scenario with one clear operational judgment`,
    B: "Reuse the closest old card and swap only the names",
    C: "Make the answer depend on private classmate data",
    D: "Prefer the flashiest wording even when the behavior is unsafe",
  };
}

function adminCurriculumCandidateExplanation(
  step: AdminCurriculumReplenishmentStep,
  topic: { label: string; lane: string },
): string {
  const source = step.corpusTitle ? ` from ${step.corpusTitle}` : "";
  return [
    `The replenishment loop should repair ${topic.label}${source} by asking a fresh, concrete question.`,
    `This follows the lane: ${topic.lane}`,
  ].join(" ");
}

function adminCurriculumCandidateStat(
  step: AdminCurriculumReplenishmentStep,
  topic: { label: string },
): NonNullable<BankedQuestion["stat"]> {
  const haystack = `${step.facultyId} ${topic.label}`.toLowerCase();
  if (haystack.includes("ethic") || haystack.includes("seminar") || haystack.includes("literary")) return "heart";
  if (haystack.includes("lab") || haystack.includes("safety") || haystack.includes("systems")) return "hustle";
  if (haystack.includes("authority") || haystack.includes("fairness") || haystack.includes("evidence")) return "honor";
  return "head";
}

function adminCurriculumDraftSummary(
  draft: StoredDraftContentPackRecord,
  step: AdminCurriculumReplenishmentStep,
  status: "created" | "existing",
  generationSource?: AdminCurriculumDraftResult["drafts"][number]["generationSource"],
  generationModel?: string | null,
): AdminCurriculumDraftResult["drafts"][number] {
  const teacher = draft.teachers.find((entry) => entry.clientRequestId?.startsWith("curriculum-replenishment:"));
  return {
    id: draft.id,
    name: draft.name,
    facultyId: step.facultyId,
    grade: step.grade,
    mode: step.mode,
    status,
    teacherCount: draft.teachers.length,
    sourceCardCount: draft.teachers.reduce((sum, teacher) => sum + teacher.sourceCards.length, 0),
    questionCount: draft.teachers.reduce((sum, teacher) => sum + teacher.questions.length, 0),
    generationSource: generationSource ?? generationSourceFromTeacher(teacher),
    generationModel: generationModel ?? generationModelFromTeacher(teacher),
  };
}

function generationSourceFromTeacher(
  teacher: StoredDraftTeacherRecord | undefined,
): AdminCurriculumDraftResult["drafts"][number]["generationSource"] {
  const raw = teacher?.materials.match(/^Generation source:\s*(.+)$/m)?.[1]?.trim();
  if (raw === "llm" || raw === "llm-fallback" || raw === "deterministic") return raw;
  return "deterministic";
}

function generationModelFromTeacher(teacher: StoredDraftTeacherRecord | undefined): string | null {
  const raw = teacher?.materials.match(/^Generation model:\s*(.+)$/m)?.[1]?.trim();
  return raw && raw !== "none" ? raw : null;
}

function adminCurriculumReviewDraftSummary(
  draft: StoredDraftContentPackRecord,
  pack: ContentPack,
): AdminCurriculumReviewDraftSummary | null {
  if (draft.ownerUserId !== "admin:curriculum" || draft.ownerSessionId !== "admin:curriculum") return null;
  const teacher = draft.teachers.find((entry) => entry.clientRequestId?.startsWith("curriculum-replenishment:"));
  if (!teacher?.clientRequestId) return null;
  const [, requestDay, grade, facultyId] = teacher.clientRequestId.split(":");
  if (!requestDay || !grade || !facultyId) return null;
  return {
    id: draft.id,
    name: draft.name,
    facultyId,
    grade,
    requestDay,
    teacherCount: draft.teachers.length,
    sourceCardCount: draft.teachers.reduce((sum, entry) => sum + entry.sourceCards.length, 0),
    questionCount: draft.teachers.reduce((sum, entry) => sum + entry.questions.length, 0),
    updatedAt: draft.updatedAt,
    validation: adminCurriculumReviewDraftValidation(teacher, grade, facultyId, pack),
    approval: adminCurriculumReviewApprovalStatus(draft, teacher, grade, facultyId),
  };
}

function adminCurriculumReviewApprovalStatus(
  draft: StoredDraftContentPackRecord,
  teacher: StoredDraftTeacherRecord,
  grade: string,
  facultyId: string,
): AdminCurriculumReviewDraftSummary["approval"] {
  const approval = draft.curriculumReviewApproval;
  const fingerprint = adminCurriculumReviewFingerprint(teacher, grade, facultyId);
  const stale = !!approval && approval.fingerprint !== fingerprint;
  return {
    approved: !!approval && !stale,
    approvedAt: approval && !stale ? approval.approvedAt : null,
    approvedBy: approval && !stale ? approval.approvedBy : null,
    stale,
    required: true,
  };
}

function adminCurriculumReviewFingerprint(
  teacher: StoredDraftTeacherRecord,
  grade: string,
  facultyId: string,
): string {
  const payload = {
    facultyId,
    grade,
    questions: teacher.questions.map((question) => ({
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      options: question.options,
      correct: question.correct,
      decoys: question.decoys,
      expectedAnswer: question.expectedAnswer,
      acceptedAnswers: question.acceptedAnswers,
      explanation: question.explanation,
      difficulty: question.difficulty,
      stat: question.stat,
      minGrade: question.minGrade,
      sourceCardId: question.sourceCardId,
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function adminCurriculumReviewDraftValidation(
  teacher: StoredDraftTeacherRecord,
  grade: string,
  facultyId: string,
  pack: ContentPack,
): AdminCurriculumReviewDraftSummary["validation"] {
  const targetFile = BUILT_IN_QUESTION_FILES[facultyId];
  if (!targetFile || !BUILT_IN_GENERATOR_FACULTY_IDS.has(facultyId)) {
    return { ok: false, errors: ["Only built-in teacher curriculum drafts can be exported."] };
  }
  if (!isGrade(grade)) return { ok: false, errors: ["Draft curriculum request id is invalid."] };
  if (teacher.questions.length === 0) {
    return { ok: false, errors: ["Review and generate questions in the draft before exporting."] };
  }
  const faculty = pack.faculty.find((entry) => entry.id === facultyId);
  if (!faculty) return { ok: false, errors: ["Built-in teacher was not found."] };
  return validateCurriculumCandidateQuestions({
    facultyId,
    targetMinGrade: grade,
    questions: teacher.questions,
    existingQuestions: faculty.questions,
  });
}

async function exportAdminCurriculumDraft(
  deps: AdminDeps,
  draftId: string,
): Promise<AdminCurriculumDraftExport> {
  const draft = (await deps.ruby.listDraftPackRecords()).find((entry) => entry.id === draftId);
  if (!draft) throw new Error("Unknown curriculum draft.");
  if (draft.ownerUserId !== "admin:curriculum" || draft.ownerSessionId !== "admin:curriculum") {
    throw new Error("Draft is not an admin curriculum draft.");
  }
  const teacher = draft.teachers.find((entry) => entry.clientRequestId?.startsWith("curriculum-replenishment:"));
  if (!teacher?.clientRequestId) throw new Error("Draft is missing its curriculum request id.");
  const [, requestDay, grade, facultyId] = teacher.clientRequestId.split(":");
  if (!requestDay || !isGrade(grade) || !facultyId) throw new Error("Draft curriculum request id is invalid.");
  const targetFile = BUILT_IN_QUESTION_FILES[facultyId];
  if (!targetFile || !BUILT_IN_GENERATOR_FACULTY_IDS.has(facultyId)) {
    throw new Error("Only built-in teacher curriculum drafts can be exported.");
  }
  if (teacher.questions.length === 0) {
    throw new Error("Review and generate questions in the draft before exporting.");
  }
  const pack = await getActivePack();
  const faculty = pack.faculty.find((entry) => entry.id === facultyId);
  if (!faculty) throw new Error("Built-in teacher was not found.");
  const validation = validateCurriculumCandidateQuestions({
    facultyId,
    targetMinGrade: grade,
    questions: teacher.questions,
    existingQuestions: faculty.questions,
  });
  if (!validation.ok) {
    throw new Error(`Reviewed curriculum draft failed validation: ${validation.errors.join("; ")}`);
  }
  const slugDay = requestDay.replace(/[^0-9]/g, "") || new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const questions = teacher.questions.map((question, index) => ({
    ...question,
    id: `${facultyId}-review-${slugDay}-${String(index + 1).padStart(3, "0")}`,
    faculty: facultyId,
    minGrade: grade,
  }));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    dryRun: true,
    draftId: draft.id,
    facultyId,
    grade,
    requestDay,
    targetFile,
    questionCount: questions.length,
    questions,
    sourceQuestionIds: teacher.questions.map((question) => question.id),
  };
}

async function approveAdminCurriculumDraft(
  deps: AdminDeps,
  draftId: string,
  approvedBy = "admin",
  now = Date.now(),
): Promise<AdminCurriculumDraftApproval> {
  const draft = (await deps.ruby.listDraftPackRecords()).find((entry) => entry.id === draftId);
  if (!draft) throw new Error("Unknown curriculum draft.");
  if (draft.ownerUserId !== "admin:curriculum" || draft.ownerSessionId !== "admin:curriculum") {
    throw new Error("Draft is not an admin curriculum draft.");
  }
  const teacher = draft.teachers.find((entry) => entry.clientRequestId?.startsWith("curriculum-replenishment:"));
  if (!teacher?.clientRequestId) throw new Error("Draft is missing its curriculum request id.");
  const [, , grade, facultyId] = teacher.clientRequestId.split(":");
  if (!isGrade(grade) || !facultyId) throw new Error("Draft curriculum request id is invalid.");
  const pack = await getActivePack();
  const validation = adminCurriculumReviewDraftValidation(teacher, grade, facultyId, pack);
  if (!validation.ok) {
    throw new Error(`Reviewed curriculum draft failed validation: ${validation.errors.join("; ")}`);
  }
  const fingerprint = adminCurriculumReviewFingerprint(teacher, grade, facultyId);
  const safeApprovedBy = approvedBy.replace(/\s+/g, " ").trim().slice(0, 80) || "admin";
  const approvedDraft: StoredDraftContentPackRecord = {
    ...draft,
    curriculumReviewApproval: {
      approvedAt: now,
      approvedBy: safeApprovedBy,
      questionCount: teacher.questions.length,
      fingerprint,
    },
    updatedAt: now,
  };
  await deps.ruby.saveDraftPackRecord(approvedDraft);
  deps.ruby.recordPublicWorldTeacherAgendaDraftOutcome({
    grade,
    facultyId,
    draftId: draft.id,
    draftStatus: "review-approved",
    draftQuestionCount: teacher.questions.length,
    approvedAt: now,
    now,
  });
  return {
    ok: true,
    dryRun: false,
    draftId: draft.id,
    facultyId,
    grade,
    approvedAt: now,
    approvedBy: safeApprovedBy,
    questionCount: teacher.questions.length,
    fingerprint,
  };
}

async function promoteAdminCurriculumDraft(
  deps: AdminDeps,
  draftId: string,
): Promise<AdminCurriculumDraftPromotion> {
  const draft = (await deps.ruby.listDraftPackRecords()).find((entry) => entry.id === draftId);
  if (!draft) throw new Error("Unknown curriculum draft.");
  const teacher = draft.teachers.find((entry) => entry.clientRequestId?.startsWith("curriculum-replenishment:"));
  if (!teacher?.clientRequestId) throw new Error("Draft is missing its curriculum request id.");
  const [, , grade, facultyId] = teacher.clientRequestId.split(":");
  if (!isGrade(grade) || !facultyId) throw new Error("Draft curriculum request id is invalid.");
  const approval = adminCurriculumReviewApprovalStatus(draft, teacher, grade, facultyId);
  if (!approval.approved) {
    throw new Error(approval.stale
      ? "Reviewed curriculum draft approval is stale; approve the latest questions before promotion."
      : "Approve the reviewed curriculum draft before promotion.");
  }
  const exported = await exportAdminCurriculumDraft(deps, draftId);
  const promoted = await deps.ruby.promoteBuiltInCurriculumQuestions(
    exported.facultyId,
    exported.questions,
  );
  deps.ruby.recordPublicWorldTeacherAgendaDraftOutcome({
    grade: exported.grade,
    facultyId: exported.facultyId,
    draftId: draft.id,
    draftStatus: "questions-promoted",
    draftQuestionCount: exported.questionCount,
    promotedAt: Date.now(),
    promotedQuestionCount: promoted.inserted,
  });
  return {
    ...exported,
    dryRun: false,
    promoted: {
      packId: promoted.packId,
      inserted: promoted.inserted,
      skipped: promoted.skipped,
      totalQuestions: promoted.totalQuestions,
    },
  };
}

function draftFacultyIdForAdminTeacher(teacherId: string): string {
  return `draft-${slugForAdminId(teacherId)}`;
}

function isGrade(value: string | undefined): value is Grade {
  return value === "9" || value === "10" || value === "11" || value === "12";
}

function slugForAdminId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56) || "curriculum";
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

function metricsTrustStart(): string | null {
  const raw = process.env.RUBY_HIGH_METRICS_TRUST_START?.trim();
  return raw || ADMIN_METRICS_DEFAULT_TRUST_START;
}

function buildAdminMetricsQuality(metrics: {
  auth: AuthAnalyticsSnapshot;
  ruby: RubyHighAnalyticsSnapshot;
  logs: ReturnType<typeof logMetricsSnapshot>;
}): AdminMetricsQuality {
  const issues: AdminMetricsQualityIssue[] = [
    {
      field: "auth.users",
      severity: "warning",
      issue: "Counts auth identity records, not deduped people. Guest records can include legacy cookie-bound identities.",
      recommendedUse: "Use only as identity-record volume; use auth.visitors and ruby.retention.visitorD1 for visitor traffic/retention.",
    },
    {
      field: "auth.daily.signedInUsers",
      severity: "warning",
      issue: "Derived from each identity's current lastLoginAt. Historical buckets can move when a user returns.",
      recommendedUse: "Use as a last-seen snapshot, not a durable daily sign-in event count.",
    },
    {
      field: "auth.unexpiredAuthSessions",
      severity: "warning",
      issue: "Counts unexpired cookie sessions, not currently active users.",
      recommendedUse: "Use for cookie/session inventory, not real-time concurrency.",
    },
    {
      field: "logs.counters",
      severity: "info",
      issue: "In-memory process counters reset on deploy, restart, and machine replacement.",
      recommendedUse: "Use for current-process smoke signals only; production trend analysis should use ruby.events.",
    },
  ];
  const guestRecords = metrics.auth.providers.guest;
  const totalRecords = Math.max(1, metrics.auth.users);
  if (guestRecords / totalRecords > 0.8) {
    issues.push({
      field: "auth.providers.guest",
      severity: "warning",
      issue: `${guestRecords} of ${metrics.auth.users} identity records are guest records.`,
      recommendedUse: "Treat legacy acquisition and identity retention as suspect; use auth.visitors and ruby.events visitor-backed app_open/session_resume after the trust start date.",
    });
  }
  if (metrics.ruby.characters > 0 && metrics.ruby.completedGrades === 0) {
    issues.push({
      field: "ruby.completedGrades",
      severity: "info",
      issue: "No completed grades among existing characters.",
      recommendedUse: "Prioritize progression funnel instrumentation and first-grade completion tuning.",
    });
  }
  if (metrics.ruby.events.total === 0) {
    issues.push({
      field: "ruby.events",
      severity: "info",
      issue: "No durable metric events have been recorded yet. The v4 streams start accumulating from deployment.",
      recommendedUse: "Use product-state snapshots until v4 event volume exists; set RUBY_HIGH_METRICS_TRUST_START on deploy.",
    });
  }
  return {
    trustStart: metricsTrustStart(),
    issues,
  };
}

function buildAdminMetricsSchema(): {
  ok: true;
  schemaVersion: typeof ADMIN_METRICS_SCHEMA_VERSION;
  publishedAt: string;
  endpoint: typeof ADMIN_METRICS_PATH;
  schemaPath: typeof ADMIN_METRICS_SCHEMA_PATH;
  bucketTimezone: "UTC";
  trustStart: string | null;
  trustModel: string[];
  fields: AdminMetricFieldSchema[];
  missingEvents: AdminMetricFieldSchema[];
} {
  return {
    ok: true,
    schemaVersion: ADMIN_METRICS_SCHEMA_VERSION,
    publishedAt: ADMIN_METRICS_SCHEMA_PUBLISHED_AT,
    endpoint: ADMIN_METRICS_PATH,
    schemaPath: ADMIN_METRICS_SCHEMA_PATH,
    bucketTimezone: "UTC",
    trustStart: metricsTrustStart(),
    trustModel: [
      "Durable product-state metrics are authoritative for current state.",
      "Auth users are identity records. Visitor metrics use the browser-local visitor id after server-side hashing.",
      "Scheduled smoke identities, sessions, characters, and events are retained operationally but excluded from product metrics.",
      "Daily buckets are UTC day buckets derived from current records unless a field explicitly says it is event-backed.",
      "In-process log counters are operational smoke signals only.",
    ],
    fields: [
      {
        path: "auth.excludedSynthetic",
        label: "Excluded synthetic auth records",
        source: "AuthUserRecord/AuthSessionRecord clientSurface plus synthetic QuizState ownership",
        semantics: "Scheduled smoke users and cookie sessions removed from every auth product metric in this snapshot.",
        reliability: "authoritative",
      },
      {
        path: "auth.users",
        label: "Identity records",
        source: "AuthUserRecord store",
        semantics: "Total stored auth identity records across guest, BYOK OpenRouter, and Privy providers.",
        reliability: "legacy",
        caveat: "Legacy guest records can be cookie-bound; v4 visitor metrics are the traffic source.",
      },
      {
        path: "auth.visitors",
        label: "Visitors",
        source: "AuthUserRecord visitorHash, visitorFirstSeenAt, visitorLastSeenAt",
        semantics: "Privacy-preserving browser visitor ids deduped after server-side hashing. Includes total, newLast24h, returningLast24h, and D1 retention.",
        reliability: "authoritative",
        caveat: "Only public-web browsers that can persist localStorage send the visitor id. Does not fingerprint or infer identity from IP/user-agent.",
      },
      {
        path: "auth.newVisitors",
        label: "New visitors in 24h",
        source: "AuthUserRecord visitorFirstSeenAt",
        semantics: "Alias for auth.visitors.newLast24h.",
        reliability: "authoritative",
      },
      {
        path: "auth.returningVisitors",
        label: "Returning visitors in 24h",
        source: "AuthUserRecord visitorLastSeenAt",
        semantics: "Alias for auth.visitors.returningLast24h.",
        reliability: "authoritative",
        caveat: "Requires a later auth touch from the same local visitor id.",
      },
      {
        path: "auth.providers",
        label: "Provider mix",
        source: "AuthUserRecord.provider",
        semantics: "Counts identity records by guest, BYOK OpenRouter, and Privy.",
        reliability: "authoritative",
        caveat: "Authoritative for records, not people.",
      },
      {
        path: "auth.createdLast24h",
        label: "New identity records in 24h",
        source: "AuthUserRecord.createdAt",
        semantics: "Identity records created in the last rolling 24 hours.",
        reliability: "legacy",
        caveat: "Guest records can represent returning people if their cookie was missing.",
      },
      {
        path: "auth.signedInLast24h",
        label: "Seen identity records in 24h",
        source: "AuthUserRecord.lastLoginAt",
        semantics: "Identity records with lastLoginAt in the last rolling 24 hours.",
        reliability: "proxy",
        caveat: "The timestamp is mutable and throttled for returning guest cookies.",
      },
      {
        path: "auth.unexpiredAuthSessions",
        label: "Unexpired cookie sessions",
        source: "AuthSessionRecord store",
        semantics: "Cookie sessions not expired by the 30-day TTL.",
        reliability: "proxy",
        caveat: "Not a real-time active-user count.",
      },
      {
        path: "auth.d1Retention",
        label: "Identity D1 retention",
        source: "AuthUserRecord.createdAt and lastLoginAt",
        semantics: "Identity records older than 24h whose lastLoginAt is at least 24h after creation.",
        reliability: "legacy",
        caveat: "Guest-heavy populations make this a weak people-retention metric.",
      },
      {
        path: "auth.daily",
        label: "Auth daily buckets",
        source: "AuthUserRecord and AuthSessionRecord timestamps",
        semantics: "14 UTC day buckets for new identity records, last-seen identity records, and cookie session starts.",
        reliability: "proxy",
        caveat: "Last-seen buckets are derived from current mutable records, not durable event history.",
      },
      {
        path: "ruby.sessions",
        label: "Saved game sessions",
        source: "QuizState store",
        semantics: "Persisted Ruby High state buckets keyed by Ruby High session id.",
        reliability: "authoritative",
        caveat: "One human can still own multiple saved sessions after cookie loss.",
      },
      {
        path: "ruby.excludedSynthetic",
        label: "Excluded synthetic product state",
        source: "QuizState.synthetic, legacy smoke fingerprints, and StoredMetricEventRecord.clientSurface",
        semantics: "Counts smoke sessions, characters, and durable events excluded from product-state and event metrics.",
        reliability: "authoritative",
        caveat: "Legacy detection is intentionally limited to the scheduled smoke test's exact character fingerprints.",
      },
      {
        path: "ruby.updatedLast24h",
        label: "Saved game sessions updated in 24h",
        source: "QuizState.updatedAt",
        semantics: "Saved game sessions whose current updatedAt is in the last rolling 24 hours.",
        reliability: "proxy",
        caveat: "Captures current last update only, not all visits.",
      },
      {
        path: "ruby.characterSessionsUpdatedLast24h",
        label: "Active character sessions in 24h",
        source: "QuizState.updatedAt plus PlayerCharacter presence",
        semantics: "Saved game sessions with a character and an update in the last rolling 24 hours.",
        reliability: "proxy",
        caveat: "Use as a product-state proxy; prefer visitor-backed ruby.events.appOpen and ruby.events.sessionResume for traffic and return-visit claims after schema v4 deployment.",
      },
      {
        path: "ruby.characterD1Retention",
        label: "Character-session D1 retention",
        source: "PlayerCharacter.createdAt and QuizState.updatedAt",
        semantics: "Character sessions older than 24h whose saved game was updated at least 24h after character creation.",
        reliability: "proxy",
        caveat: "Better than guest identity retention, but still uses last update rather than explicit return events.",
      },
      {
        path: "ruby.retention.characterD1",
        label: "Event-backed character D1 retention",
        source: "StoredMetricEventRecord funnel_step plus app_open/session_resume",
        semantics: "Sessions with first_character_created and later durable activity at least 24h after creation.",
        reliability: "authoritative",
        caveat: "Falls back to product-state characterD1Retention until event history exists.",
      },
      {
        path: "ruby.retention.visitorD1",
        label: "Event-backed visitor D1 retention",
        source: "StoredMetricEventRecord visitor_seen/app_open/session_resume visitorHash",
        semantics: "Visitors first seen at least 24h ago who later returned with durable activity at least 24h after first seen.",
        reliability: "authoritative",
        caveat: "Begins only after v4 visitor headers are deployed.",
      },
      {
        path: "ruby.characters",
        label: "Current characters",
        source: "QuizState.character",
        semantics: "Saved game sessions with an active player character.",
        reliability: "authoritative",
      },
      {
        path: "ruby.completedGrades",
        label: "Completed grades",
        source: "PlayerCharacter.yearbook and StudentPoolEntry.yearbook",
        semantics: "Sealed grade entries across current and pooled characters.",
        reliability: "authoritative",
      },
      {
        path: "ruby.graduatedCharacters",
        label: "Graduated characters",
        source: "PlayerCharacter.yearbook length",
        semantics: "Current characters with all Ruby High grades sealed.",
        reliability: "authoritative",
      },
      {
        path: "ruby.questions",
        label: "Question performance",
        source: "QuizState.score",
        semantics: "Aggregate answered-question correct, total, and accuracy.",
        reliability: "authoritative",
        caveat: "No per-day historical answer counts until answer events are persisted.",
      },
      {
        path: "ruby.curriculum",
        label: "Curriculum coverage",
        source: "QuizState askedQuestionIds plus per-grade questionBankStatus",
        semantics: "Active-character coverage by grade and teacher: eligible bank size, average seen/remaining cards, low/exhausted pool counts, and replenishment proposals.",
        reliability: "authoritative",
        caveat: "Aggregates current saved sessions, not anonymous traffic that has no active character.",
      },
      {
        path: "ruby.photoPosts",
        label: "Photo post scheduler",
        source: "RubyHighService pending photo queue and in-memory post retry state",
        semantics: "Scheduler active/running state, current pending photo count, in-flight post count, deferred retry count, next retry time, and last photo-post attempt result.",
        reliability: "proxy",
        caveat: "Retry and last-attempt state is in memory; queue size comes from saved game state.",
      },
      {
        path: "ruby.scheduledPosts",
        label: "Scheduled school updates",
        source: "RubyHighService aggregate world context and durable scheduled-post service state",
        semantics: "Whether the aggregate LLM-to-X text-and-composed-photo job is enabled, its daily/retry cadence, last attempt/post, posting teacher, context fingerprint, and latest skip reason.",
        reliability: "authoritative",
        caveat: "Fly scale-to-zero means overdue work runs on the next service cold start rather than at an exact wall-clock minute.",
      },
      {
        path: "ruby.essayReports",
        label: "Essay reports",
        source: "QuizState.essayReports",
        semantics: "Durable graded essay reports stored on saved game sessions.",
        reliability: "authoritative",
      },
      {
        path: "ruby.daily",
        label: "Play daily buckets",
        source: "QuizState, PlayerCharacter, yearbook entries, and EssayReport timestamps",
        semantics: "14 UTC day buckets for saved-session updates, character creation, grade completion, essays graded, and v4 metric events.",
        reliability: "proxy",
        caveat: "Good for durable milestones; appOpens/sessionResumes are event-backed only after schema v4 deployment.",
      },
      {
        path: "ruby.events.appOpen",
        label: "App opens",
        source: "StoredMetricEventRecord app_open",
        semantics: "Durable viewer boot events with session identity from the Ruby High cookie.",
        reliability: "authoritative",
        caveat: "Begins only after schema v4 deployment; uniqueVisitors dedupes only browsers retaining ruby-high:visitor-id.",
      },
      {
        path: "ruby.events.sessionResume",
        label: "Session resumes",
        source: "StoredMetricEventRecord session_resume",
        semantics: "Durable viewer-visible events after the tab returns from at least five minutes inactive.",
        reliability: "authoritative",
        caveat: "Browser lifecycle quirks can undercount if the tab is killed before sending.",
      },
      {
        path: "ruby.events.funnel",
        label: "Activation funnel",
        source: "StoredMetricEventRecord funnel_step",
        semantics: "First character created, first question answered, first essay submitted, first daily class passed, and first grade completed.",
        reliability: "authoritative",
        caveat: "Dedupe is per Ruby High session id.",
      },
      {
        path: "ruby.events.activationFunnel",
        label: "Trustworthy activation funnel",
        source: "StoredMetricEventRecord app_open, funnel_step, and daily class ritual events",
        semantics: "Ordered, session-deduped activation steps with explicit open denominators, previous-step rates, window, and sample sizes.",
        reliability: "authoritative",
        caveat: "humanViewer includes only visitor-backed viewer app opens after trustStart; raw includes non-smoke agent, API, viewer, and unknown surfaces.",
      },
      {
        path: "ruby.events.onboardingFunnel",
        label: "First-visit onboarding funnel",
        source: "StoredMetricEventRecord app_open, viewer onboarding funnel_step, and gameplay milestones",
        semantics: "Ordered, visitor-backed steps from app open through student creator, candidate, enrollment, character creation, and first class start.",
        reliability: "authoritative",
        caveat: "Begins at instrumentationStart in schema v8; earlier visits are intentionally excluded because the intermediate client events did not exist.",
      },
      {
        path: "ruby.events.byClientSurface",
        label: "Metric events by client surface",
        source: "StoredMetricEventRecord.clientSurface",
        semantics: "Bounded viewer, agent, api, and unknown classification for included product events. Excluded smoke volume is reported under ruby.events.excludedSynthetic.",
        reliability: "authoritative",
      },
      {
        path: "ruby.funnel.first10m",
        label: "First 10 minute funnel",
        source: "StoredMetricEventRecord app_open plus funnel_step",
        semantics: "Counts first activation milestones reached within ten minutes of a session's first durable app_open.",
        reliability: "authoritative",
        caveat: "Requires app_open to fire before the funnel step.",
      },
      {
        path: "ruby.events.referral",
        label: "Share loop",
        source: "StoredMetricEventRecord share_artifact_created, share_initiated, share_link_visited, and funnel_step first_character_created",
        semantics: "Shareable artifact creation, outbound share starts, inbound link visits, unique referred visitors, click-through rates, and bounded per-ref visit/visitor/enrollment attribution.",
        reliability: "authoritative",
        caveat: "Link visits are recorded when a referred visitor reaches the viewer with a ref parameter; visits to static share pages alone are not counted. byRef enrollments count attributed character creations and are not limited to refs that also produced a link visit, so an agent-channel ref can report enrollments with zero visits.",
      },
      {
        path: "ruby.guestSpotlight",
        label: "Guest spotlight",
        source: "StoredMetricEventRecord guest_spotlight_seen, guest_spotlight_started, guest_pack_override_set",
        semantics: "Weekly guest-teacher spotlight impressions, starts, manual overrides, and start rate.",
        reliability: "authoritative",
      },
      {
        path: "ruby.balance.repeatRate",
        label: "Question repeat rate",
        source: "QuizState.answerStats plus balance_sample",
        semantics: "Cumulative repeated-answer counters from gameplay. Simulation samples are reported separately under ruby.balance.",
        reliability: "proxy",
        caveat: "Gameplay counters are compact per-session state, not a normalized event stream yet.",
      },
      {
        path: "ruby.events.commerce",
        label: "Commerce events",
        source: "StoredMetricEventRecord commerce plus wallet mutation path",
        semantics: "Durable wallet and entitlement mutations with currency deltas and transaction ids.",
        reliability: "authoritative",
        caveat: "payingSessions requires a positive amountCents event; creditedSessions separately counts non-payment Hall Pass grants. Revenue is not accounting-grade financial reporting.",
      },
      {
        path: "ruby.events.llm",
        label: "LLM usage",
        source: "StoredMetricEventRecord llm_usage plus LLM client wrappers",
        semantics: "Durable provider/model/status/latency events for server-side text, stream, and image-generation calls.",
        reliability: "authoritative",
        caveat: "Browser-owned direct client calls are visible only when they route through the Ruby High server.",
      },
      {
        path: "ruby.events.errors",
        label: "Durable errors",
        source: "StoredMetricEventRecord error plus structured logger sink",
        semantics: "Durable operational error events grouped by feature.",
        reliability: "authoritative",
        caveat: "Stores clipped messages and feature names, not full stack traces.",
      },
      {
        path: "ruby.world",
        label: "School activity health",
        source: "RubyHighService shared school activity projection, durable event cache, and school activity service state",
        semantics: "Current School Presence participants, recent visible event count/newest event time, durable event cache pressure, durable room/outcome counts, teacher-agenda ready/queued/watching counts, live-room goal state count, suppressed-event count, and last external-store refresh age.",
        reliability: "proxy",
        caveat: "Refresh age is process-local and reflects the most recent shared activity store hydration in this app instance.",
      },
      {
        path: "ops.publicReadLimiter",
        label: "School activity read limiter",
        source: "In-process /world, /world/events, and /cohort token bucket",
        semantics: "Currently tracked school activity read rate-limit buckets and the periodic GC cadence for visitor/IP keys.",
        reliability: "volatile",
        caveat: "Resets on deploy or restart and is per process. IDs are not exposed; use tracked key count to spot visitor-key churn.",
      },
      {
        path: "ops.worldLiveStreams",
        label: "School activity streams",
        source: "In-process /world/events?live=1 reservation map",
        semantics: "Currently open shared school activity SSE streams, per-client pressure, cumulative accepted/rejected streams, close reasons, handler errors, and write-failure phase counts.",
        reliability: "volatile",
        caveat: "Resets on deploy or restart and is per process. Use it for capacity smoke checks, not historical traffic reporting.",
      },
      {
        path: "logs.counters",
        label: "Process log counters",
        source: "In-memory logger map",
        semantics: "Event/error counts since current process start.",
        reliability: "volatile",
        caveat: "Resets on deploy or restart.",
      },
    ],
    missingEvents: [],
  };
}

export async function handleAdminMetricsRoute(ctx: RouteContext, deps: AdminDeps): Promise<boolean> {
  if (ctx.pathname !== ADMIN_METRICS_PATH) return false;
  if (ctx.method !== "GET" && ctx.method !== "HEAD") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  if (!requireAdminAuth(ctx)) return true;
  ctx.json(ctx.res, buildAdminMetricsSnapshot(deps));
  return true;
}

export async function handleAdminMetricsSchemaRoute(ctx: RouteContext): Promise<boolean> {
  if (ctx.pathname !== ADMIN_METRICS_SCHEMA_PATH) return false;
  if (ctx.method !== "GET" && ctx.method !== "HEAD") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  if (!requireAdminAuth(ctx)) return true;
  ctx.json(ctx.res, buildAdminMetricsSchema());
  return true;
}

export async function handleAdminCurriculumReplenishmentRoute(ctx: RouteContext, deps: AdminDeps): Promise<boolean> {
  if (ctx.pathname !== ADMIN_CURRICULUM_REPLENISHMENT_PATH) return false;
  if (ctx.method !== "GET" && ctx.method !== "HEAD" && ctx.method !== "POST") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  if (!requireAdminAuth(ctx)) return true;
  if (ctx.method === "POST") {
    const body = await ctx.readJsonBody?.().catch(() => ({})) ?? {};
    const action = typeof body === "object" && body ? String((body as { action?: unknown }).action ?? "") : "";
    if (action === "export-reviewed") {
      const draftId = typeof body === "object" && body ? String((body as { draftId?: unknown }).draftId ?? "").trim() : "";
      if (!draftId) {
        ctx.error(ctx.res, "draftId is required.", 400);
        return true;
      }
      try {
        ctx.json(ctx.res, await exportAdminCurriculumDraft(deps, draftId));
      } catch (err) {
        ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 400);
      }
      return true;
    }
    if (action === "approve-reviewed") {
      const draftId = typeof body === "object" && body ? String((body as { draftId?: unknown }).draftId ?? "").trim() : "";
      const approvedBy = typeof body === "object" && body ? String((body as { approvedBy?: unknown }).approvedBy ?? "admin") : "admin";
      if (!draftId) {
        ctx.error(ctx.res, "draftId is required.", 400);
        return true;
      }
      try {
        ctx.json(ctx.res, await approveAdminCurriculumDraft(deps, draftId, approvedBy));
      } catch (err) {
        ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 400);
      }
      return true;
    }
    if (action === "promote-reviewed") {
      const draftId = typeof body === "object" && body ? String((body as { draftId?: unknown }).draftId ?? "").trim() : "";
      if (!draftId) {
        ctx.error(ctx.res, "draftId is required.", 400);
        return true;
      }
      try {
        ctx.json(ctx.res, await promoteAdminCurriculumDraft(deps, draftId));
      } catch (err) {
        ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 400);
      }
      return true;
    }
    const limit = typeof body === "object" && body && "limit" in body ? Number((body as { limit?: unknown }).limit) : undefined;
    const provider = typeof body === "object" && body ? String((body as { provider?: unknown }).provider ?? "") : "";
    const useLlm = provider === "llm" || !!(typeof body === "object" && body && (body as { useLlm?: unknown }).useLlm);
    const trigger = action === "auto-enqueue" ? "coverage-exhaustion" : "manual";
    ctx.json(ctx.res, await createAdminCurriculumReplenishmentDrafts(deps, { limit, useLlm, trigger }));
    return true;
  }
  ctx.json(ctx.res, await buildAdminCurriculumReplenishmentSnapshot(deps));
  return true;
}

export async function handleAdminWorldModerationRoute(ctx: RouteContext, deps: AdminDeps): Promise<boolean> {
  if (ctx.pathname !== ADMIN_WORLD_MODERATION_PATH) return false;
  if (ctx.method !== "GET" && ctx.method !== "HEAD" && ctx.method !== "POST") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  if (!requireAdminAuth(ctx)) return true;
  if (ctx.method === "POST") {
    const body = await ctx.readJsonBody?.().catch(() => ({})) ?? {};
    const action = typeof body === "object" && body ? String((body as { action?: unknown }).action ?? "") : "";
    if (action === "dismiss-report") {
      const reportId = typeof body === "object" && body ? String((body as { reportId?: unknown }).reportId ?? "").trim() : "";
      try {
        ctx.json(ctx.res, await deps.ruby.dismissPublicWorldModerationReport(reportId));
      } catch (err) {
        ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 400);
      }
      return true;
    }
    if (action === "suppress-event") {
      const eventId = typeof body === "object" && body ? String((body as { eventId?: unknown }).eventId ?? "").trim() : "";
      const reason = typeof body === "object" && body ? String((body as { reason?: unknown }).reason ?? "") : "";
      try {
        ctx.json(ctx.res, await deps.ruby.suppressPublicWorldEvent(eventId, reason));
      } catch (err) {
        ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 400);
      }
      return true;
    }
    if (action === "note-event") {
      const eventId = typeof body === "object" && body ? String((body as { eventId?: unknown }).eventId ?? "").trim() : "";
      const note = typeof body === "object" && body ? String((body as { note?: unknown }).note ?? "") : "";
      try {
        ctx.json(ctx.res, await deps.ruby.notePublicWorldModerationEvent(eventId, note));
      } catch (err) {
        ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 400);
      }
      return true;
    }
    ctx.error(ctx.res, "Unknown moderation action.", 400);
    return true;
  }
  const rawLimit = ctx.url?.searchParams.get("limit");
  const limit = rawLimit ? Number(rawLimit) : 100;
  ctx.json(ctx.res, await deps.ruby.getPublicWorldModerationSnapshot(limit));
  return true;
}

export async function handleAdminOverviewRoute(ctx: RouteContext, deps: AdminDeps): Promise<boolean> {
  if (ctx.pathname !== ADMIN_OVERVIEW_PATH) return false;
  if (ctx.method !== "GET" && ctx.method !== "HEAD") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  if (!requireAdminAuth(ctx)) return true;
  if (!hasConfiguredLlmCredential()) {
    ctx.error(ctx.res, "Admin overview needs an LLM credential.", 503);
    return true;
  }
  const metrics = buildAdminMetricsSnapshot(deps);
  try {
    const overview = await generateAdminOverview(metrics);
    ctx.json(ctx.res, {
      ok: true,
      generatedAt: new Date().toISOString(),
      provider: llmProviderName(),
      overview,
    });
  } catch (err) {
    log.error("admin.overview-failed", err);
    ctx.error(ctx.res, "Admin overview generation failed.", 502);
  }
  return true;
}

async function generateAdminOverview(metrics: AdminMetricsSnapshot): Promise<AdminOverview> {
  const r = await fetchLlmChatCompletions({
    label: "admin-overview",
    title: "Ruby High Admin",
    timeoutMs: 30_000,
    body: {
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content: [
            "You are Ruby High's operator analyst.",
            "Read aggregate product metrics and return compact JSON only.",
            "Do not mention secrets, implementation details, or that you are an AI.",
            "Keep it useful for a product owner deciding what to fix next.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            "Return JSON with keys headline, summary, highlights, risks, actions.",
            "highlights, risks, and actions must be short string arrays with 2 to 4 items.",
            "Use these aggregate metrics:",
            JSON.stringify(compactMetricsForOverview(metrics)),
          ].join("\n"),
        },
      ],
    },
  });
  if (!r.ok) await throwLlmResponseError(r, "admin-overview");
  const body = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content?.trim() ?? "";
  return parseAdminOverview(content);
}

function compactMetricsForOverview(metrics: AdminMetricsSnapshot): Record<string, unknown> {
  return {
    schemaVersion: metrics.schemaVersion,
    generatedAt: metrics.generatedAt,
    quality: metrics.quality,
    interpretationRules: [
      "Do not call auth identity records unique users.",
      "Use auth.visitors and visitor-backed ruby.events.appOpen/sessionResume for traffic and return-visit claims after the trustStart date.",
      "Use ruby.retention.characterD1 and ruby.retention.visitorD1 before identity D1 retention.",
    ],
    ops: metrics.ops,
    auth: {
      identityRecords: metrics.auth.users,
      guestIdentityRecords: metrics.auth.providers.guest,
      verifiedIdentityRecords: metrics.auth.providers.openrouter + metrics.auth.providers.privy,
      visitorMetrics: metrics.auth.visitors,
      newVisitorsLast24h: metrics.auth.newVisitors,
      returningVisitorsLast24h: metrics.auth.returningVisitors,
      identityCaveat: "Auth identity records are not deduped people. Use visitor metrics for public-web traffic when localStorage persists.",
      unexpiredAuthSessions: metrics.auth.unexpiredAuthSessions,
      pendingAuth: metrics.auth.pendingAuth,
      newIdentityRecordsLast24h: metrics.auth.createdLast24h,
      seenIdentityRecordsLast24h: metrics.auth.signedInLast24h,
      returningUsers: metrics.auth.returningUsers,
      identityD1Retention: metrics.auth.d1Retention,
      providers: metrics.auth.providers,
      daily: metrics.auth.daily,
      excludedSynthetic: metrics.auth.excludedSynthetic,
    },
    play: {
      store: metrics.ruby.store,
      sessions: metrics.ruby.sessions,
      excludedSynthetic: metrics.ruby.excludedSynthetic,
      updatedLast24h: metrics.ruby.updatedLast24h,
      characterSessionsUpdatedLast24h: metrics.ruby.characterSessionsUpdatedLast24h,
      characterD1Retention: metrics.ruby.characterD1Retention,
      retention: metrics.ruby.retention,
      characters: metrics.ruby.characters,
      graduatedCharacters: metrics.ruby.graduatedCharacters,
      activeRounds: metrics.ruby.activeRounds,
      completedGrades: metrics.ruby.completedGrades,
      essayReports: metrics.ruby.essayReports,
      questions: metrics.ruby.questions,
      curriculum: metrics.ruby.curriculum,
      wallet: metrics.ruby.wallet,
      events: metrics.ruby.events,
      funnel: metrics.ruby.funnel,
      guestSpotlight: metrics.ruby.guestSpotlight,
      balance: metrics.ruby.balance,
      daily: metrics.ruby.daily,
    },
    logs: {
      build: metrics.logs.build,
      counters: metrics.logs.counters.slice(0, 12),
    },
  };
}

function parseAdminOverview(content: string): AdminOverview {
  const parsed = parseJsonObject(content);
  return {
    headline: cleanOverviewText(parsed?.headline, "Ruby High usage overview"),
    summary: cleanOverviewText(parsed?.summary, content || "No overview returned."),
    highlights: cleanOverviewList(parsed?.highlights),
    risks: cleanOverviewList(parsed?.risks),
    actions: cleanOverviewList(parsed?.actions),
  };
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {}
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function cleanOverviewText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 800) : fallback;
}

function cleanOverviewList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter(Boolean)
    .slice(0, 4);
}

export function renderAdminDashboardHtml(): string {
  const metricsPath = JSON.stringify(ADMIN_METRICS_PATH);
  const schemaPath = JSON.stringify(ADMIN_METRICS_SCHEMA_PATH);
  const overviewPath = JSON.stringify(ADMIN_OVERVIEW_PATH);
  const replenishmentPath = JSON.stringify(ADMIN_CURRICULUM_REPLENISHMENT_PATH);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ruby High Admin</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #1c1721;
      --muted: #665c6d;
      --line: #ded7e5;
      --surface: #fffaf6;
      --panel: #ffffff;
      --accent: #9f2338;
      --accent-2: #0f6f68;
      --warn: #a56a00;
      --bad: #a12b2b;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background: var(--surface);
    }
    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 44px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }
    h1, h2 {
      margin: 0;
      letter-spacing: 0;
    }
    h1 {
      font-size: clamp(28px, 4vw, 42px);
      line-height: 1;
    }
    h2 {
      font-size: 16px;
      text-transform: uppercase;
      color: var(--muted);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand img {
      width: 46px;
      height: 46px;
      object-fit: contain;
    }
    .controls {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 8px;
    }
    input[type="password"] {
      width: min(360px, 100%);
      height: 38px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      padding: 0 12px;
      border-radius: 6px;
      font: inherit;
    }
    button {
      height: 38px;
      border: 1px solid var(--accent);
      background: var(--accent);
      color: white;
      padding: 0 14px;
      border-radius: 6px;
      font: 700 14px/1 ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    }
    button.secondary {
      background: var(--panel);
      color: var(--accent);
    }
    button:disabled {
      opacity: .6;
      cursor: wait;
    }
    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--muted);
      font-size: 14px;
      white-space: nowrap;
    }
    .status {
      min-height: 28px;
      margin: 16px 0;
      color: var(--muted);
      font-size: 14px;
    }
    .status strong { color: var(--ink); }
    .status.is-error { color: var(--bad); }
    .status.is-warn { color: var(--warn); }
	    .section {
	      padding: 22px 0 0;
	    }
	    .section-head {
	      display: flex;
	      align-items: center;
	      justify-content: space-between;
	      gap: 12px;
	      flex-wrap: wrap;
	    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(280px, .7fr);
      gap: 14px;
      margin-top: 16px;
    }
    .overview {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 18px;
      min-height: 170px;
    }
    .overview h2 {
      color: var(--ink);
      font-size: 22px;
      text-transform: none;
    }
    .overview p {
      margin: 10px 0 0;
      color: var(--muted);
      line-height: 1.45;
    }
    .overview-list {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-top: 14px;
    }
    .overview-list h3 {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }
    .overview-list ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 7px;
    }
    .overview-list li {
      color: var(--ink);
      font-size: 13px;
      line-height: 1.35;
    }
    .quick-stack {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }
    .metric {
      min-height: 92px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 14px;
    }
    .metric.is-wide {
      grid-column: span 2;
    }
    .label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .value {
      display: block;
      margin-top: 8px;
      font-size: 30px;
      line-height: 1;
      font-weight: 800;
    }
    .sub {
      margin-top: 8px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
    }
    .value.good { color: var(--accent-2); }
    .tables {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 14px;
      margin-top: 12px;
    }
    .charts {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-top: 12px;
    }
    .chart {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 14px;
      min-height: 250px;
    }
    .chart-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .chart-title {
      font-weight: 800;
      font-size: 15px;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: var(--muted);
      font-size: 12px;
    }
    .legend i {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: -1px;
    }
    .chart svg {
      width: 100%;
      height: 180px;
      display: block;
      overflow: visible;
    }
    .axis {
      color: var(--muted);
      font-size: 11px;
      display: flex;
      justify-content: space-between;
      margin-top: 6px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      font-size: 14px;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      background: #f8f1f4;
    }
    tr:last-child td { border-bottom: 0; }
    td:last-child {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .empty {
      border: 1px dashed var(--line);
      border-radius: 8px;
      background: rgba(255,255,255,.6);
      padding: 18px;
      color: var(--muted);
    }
    @media (max-width: 860px) {
      header { align-items: flex-start; flex-direction: column; }
      .controls { justify-content: flex-start; width: 100%; }
      input[type="password"] { flex: 1 1 260px; }
      .hero-grid { grid-template-columns: 1fr; }
      .overview-list { grid-template-columns: 1fr; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .metric.is-wide { grid-column: span 1; }
      .charts { grid-template-columns: 1fr; }
      .tables { grid-template-columns: 1fr; }
    }
    @media (max-width: 520px) {
      main { width: min(100vw - 20px, 1180px); padding-top: 18px; }
      .grid { grid-template-columns: 1fr; }
      button { flex: 1 1 auto; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="brand">
        <img src="${APP_ROUTE_PREFIX}/assets/logo.png" alt="">
        <h1>Ruby High Admin</h1>
        <p class="sub">JSON: <code>${ADMIN_METRICS_PATH}</code> · <code>${ADMIN_METRICS_SCHEMA_PATH}</code> · <code>${ADMIN_OVERVIEW_PATH}</code> · <code>${ADMIN_CURRICULUM_REPLENISHMENT_PATH}</code> · <code>${ADMIN_WORLD_MODERATION_PATH}</code></p>
      </div>
      <form class="controls" id="admin-form">
        <input id="token" type="password" autocomplete="current-password" placeholder="Admin token">
        <button id="refresh" type="submit">Refresh</button>
        <button class="secondary" id="overview-refresh" type="button">Overview</button>
        <button class="secondary" id="clear-token" type="button">Clear</button>
        <label class="toggle"><input id="auto-refresh" type="checkbox"> Auto</label>
      </form>
    </header>
    <div class="status" id="status">Locked.</div>
    <section class="hero-grid">
      <div class="overview" id="overview">
        <h2>Overview</h2>
        <p id="overview-summary">Waiting for metrics.</p>
        <div class="overview-list" id="overview-list"></div>
      </div>
      <div class="quick-stack" id="quick-stack"></div>
    </section>
    <section class="section">
      <h2>Trends</h2>
      <div class="charts" id="charts"></div>
    </section>
    <section class="section">
      <h2>Identity</h2>
      <div class="grid" id="auth-grid"></div>
    </section>
    <section class="section">
      <h2>Classroom</h2>
      <div class="grid" id="play-grid"></div>
    </section>
    <section class="section">
      <h2>Economy</h2>
      <div class="grid" id="economy-grid"></div>
    </section>
    <section class="section">
      <h2>Operations</h2>
      <div class="grid" id="ops-grid"></div>
    </section>
    <section class="section">
      <h2>X Social</h2>
      <div id="x-social-panel" style="margin-top:12px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;">
        <div class="empty" style="grid-column:1/-1;">Loading teacher connections…</div>
      </div>
    </section>
    <section class="section">
      <h2>Telegram</h2>
      <div id="telegram-panel" style="margin-top:12px;">
        <div class="metric" style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div class="label">Bot Token</div>
            <input id="tg-token" type="password" placeholder="123:abc..." style="width:100%;height:38px;border:1px solid var(--line);border-radius:6px;padding:0 12px;font:inherit;background:var(--panel);color:var(--ink);">
          </div>
          <div style="flex:1;min-width:200px;">
            <div class="label">Chat ID</div>
            <input id="tg-chat" type="text" placeholder="-100123..." style="width:100%;height:38px;border:1px solid var(--line);border-radius:6px;padding:0 12px;font:inherit;background:var(--panel);color:var(--ink);">
          </div>
          <button id="tg-save" class="x-social-btn" style="height:38px;" data-action="telegram-save">Save</button>
          <button id="tg-post" class="secondary x-social-btn" style="height:38px;" data-action="telegram-post">Post Snapshot</button>
        </div>
        <div id="tg-status" class="sub" style="margin-top:8px;"></div>
      </div>
    </section>
    <section class="section">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <h2>Students</h2>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
          <select id="social-teacher-select" style="height:34px;border:1px solid var(--line);border-radius:6px;padding:0 8px;font:inherit;background:var(--panel);color:var(--ink);font-size:13px;"></select>
          <button class="secondary x-social-btn" data-action="class-photo" style="font-size:13px;">Class Photo</button>
          <button class="secondary x-social-btn" data-action="class-photo-history" style="font-size:13px;">History</button>
        </div>
      </div>
      <div id="students-panel" style="margin-top:12px;">
        <div class="empty">Loading recently active students…</div>
      </div>
    </section>
	    <section class="section">
	      <div class="section-head">
	        <h2>Logs</h2>
	        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
	          <button class="secondary" id="curriculum-drafts-auto" type="button" disabled>Auto enqueue exhausted</button>
	          <button class="secondary" id="curriculum-drafts-create" type="button" disabled>Create review drafts</button>
	        </div>
	      </div>
	      <div class="tables" id="tables"></div>
	    </section>
  </main>
  <script>
    const xSocialPrefix = ${JSON.stringify(X_SOCIAL_PREFIX)};
    async function saveTelegramConfig() {
      const token = sessionStorage.getItem(tokenKey);
      if (!token) return;
      tgSave.disabled = true;
      tgSave.textContent = "Saving…";
      try {
        const res = await fetch(xSocialPrefix + "/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ botToken: tgToken.value.trim(), chatId: tgChat.value.trim() }),
        });
        const data = await res.json();
        if (data.ok) {
          if (data.chatId) tgChat.value = data.chatId;
          tgStatus.textContent = data.chatId ? "Connected to " + data.chatId : "Connected";
        } else {
          tgStatus.textContent = "Error: " + (data.error || "unknown");
        }
      } catch { tgStatus.textContent = "Failed to save"; }
      tgSave.disabled = false;
      tgSave.textContent = "Save";
    };

async function postTelegramSnapshot() {
      const token = sessionStorage.getItem(tokenKey);
      if (!token) return;
      tgPost.disabled = true;
      tgPost.textContent = "Posting…";
      try {
        const res = await fetch(xSocialPrefix + "/telegram/post", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
        });
        const data = await res.json();
        tgStatus.textContent = data.ok ? "Snapshot posted!" : "Failed to post";
      } catch { tgStatus.textContent = "Post failed"; }
      tgPost.disabled = false;
      tgPost.textContent = "Post Snapshot";
    };

    const metricsPath = ${metricsPath};
    const schemaPath = ${schemaPath};
    const overviewPath = ${overviewPath};
    const replenishmentPath = ${replenishmentPath};
    const tokenKey = "ruby-high-admin-token";
    const tokenEl = document.getElementById("token");
    const formEl = document.getElementById("admin-form");
    const refreshEl = document.getElementById("refresh");
    const overviewRefreshEl = document.getElementById("overview-refresh");
    const clearEl = document.getElementById("clear-token");
    const curriculumDraftsCreateEl = document.getElementById("curriculum-drafts-create");
    const curriculumDraftsAutoEl = document.getElementById("curriculum-drafts-auto");
    const autoEl = document.getElementById("auto-refresh");
    const statusEl = document.getElementById("status");
    const overviewSummaryEl = document.getElementById("overview-summary");
    const overviewListEl = document.getElementById("overview-list");
    const quickStackEl = document.getElementById("quick-stack");
    const chartsEl = document.getElementById("charts");
    const authGrid = document.getElementById("auth-grid");
    const playGrid = document.getElementById("play-grid");
    const economyGrid = document.getElementById("economy-grid");
    const opsGrid = document.getElementById("ops-grid");
    const tablesEl = document.getElementById("tables");
    let timer = null;
    let latestMetrics = null;
    let latestReplenishment = null;

    tokenEl.value = sessionStorage.getItem(tokenKey) || "";
    if (tokenEl.value) refresh();

    formEl.addEventListener("submit", (event) => {
      event.preventDefault();
      refresh();
    });
    clearEl.addEventListener("click", () => {
      sessionStorage.removeItem(tokenKey);
      tokenEl.value = "";
      latestMetrics = null;
      latestReplenishment = null;
      curriculumDraftsCreateEl.disabled = true;
      curriculumDraftsAutoEl.disabled = true;
      status("Locked.", "");
      overviewSummaryEl.textContent = "Waiting for metrics.";
      overviewListEl.innerHTML = "";
      quickStackEl.innerHTML = "";
      chartsEl.innerHTML = "";
      authGrid.innerHTML = "";
      playGrid.innerHTML = "";
      economyGrid.innerHTML = "";
      opsGrid.innerHTML = "";
      tablesEl.innerHTML = "";
      connectedTeachers = [];
      renderSocialTeacherSelect();
      xPanel.innerHTML = '<div class="empty" style="grid-column:1/-1;">Unlock to manage X connections.</div>';
      studentsPanel.innerHTML = '<div class="empty">Unlock to see students.</div>';
    });
    overviewRefreshEl.addEventListener("click", () => {
      generateOverview();
    });
    curriculumDraftsCreateEl.addEventListener("click", () => {
      createCurriculumDrafts();
    });
    curriculumDraftsAutoEl.addEventListener("click", () => {
      autoEnqueueCurriculumDrafts();
    });
    document.addEventListener("click", (event) => {
      const btn = event.target.closest(".curriculum-export-btn");
      if (!btn) return;
      exportCurriculumDraft(btn.dataset.draftId || "", btn);
    });
    document.addEventListener("click", (event) => {
      const btn = event.target.closest(".curriculum-approve-btn");
      if (!btn) return;
      approveCurriculumDraft(btn.dataset.draftId || "", btn);
    });
    document.addEventListener("click", (event) => {
      const btn = event.target.closest(".curriculum-promote-btn");
      if (!btn) return;
      promoteCurriculumDraft(btn.dataset.draftId || "", btn);
    });
    autoEl.addEventListener("change", () => {
      if (timer) clearInterval(timer);
      timer = autoEl.checked ? setInterval(refresh, 60000) : null;
    });

    async function refresh() {
      const token = tokenEl.value.trim();
      if (!token) {
        status("Locked.", "");
        return;
      }
      refreshEl.disabled = true;
      status("Refreshing...", "");
      try {
        const response = await fetch(metricsPath, {
          headers: { "Authorization": "Bearer " + token },
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Metrics request failed.");
        }
        sessionStorage.setItem(tokenKey, token);
        latestMetrics = data;
        latestReplenishment = await loadReplenishment(token);
        render(data);
        refreshXSocial();
      } catch (err) {
        status(err && err.message ? err.message : String(err), "is-error");
      } finally {
        refreshEl.disabled = false;
      }
    }

    async function loadReplenishment(token) {
      try {
        const response = await fetch(replenishmentPath, {
          headers: { "Authorization": "Bearer " + token },
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return null;
        return data;
      } catch {
        return null;
      }
    }

    async function createCurriculumDrafts() {
      const token = tokenEl.value.trim();
      if (!token) {
        status("Locked.", "");
        return;
      }
      curriculumDraftsCreateEl.disabled = true;
      curriculumDraftsCreateEl.textContent = "Creating...";
      try {
        const response = await fetch(replenishmentPath, {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ limit: 3, provider: "llm" }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Draft creation failed.");
        }
        const sources = Array.from(new Set((data.drafts || []).map((draft) => draft.generationSource).filter(Boolean))).join(", ");
        status("Curriculum drafts: " + n(data.created) + " created, " + n(data.reused) + " already queued" + (sources ? " · " + sources : "") + ".", "");
        latestReplenishment = await loadReplenishment(token);
        if (latestMetrics) render(latestMetrics);
      } catch (err) {
        status(err && err.message ? err.message : String(err), "is-error");
      } finally {
        curriculumDraftsCreateEl.textContent = "Create review drafts";
        curriculumDraftsCreateEl.disabled = false;
      }
    }

    async function autoEnqueueCurriculumDrafts() {
      const token = tokenEl.value.trim();
      if (!token) {
        status("Locked.", "");
        return;
      }
      curriculumDraftsAutoEl.disabled = true;
      curriculumDraftsAutoEl.textContent = "Enqueuing...";
      try {
        const response = await fetch(replenishmentPath, {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "auto-enqueue", limit: 3 }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Auto enqueue failed.");
        }
        status("Auto-enqueued " + n(data.created) + " exhausted curriculum drafts.", "");
        latestReplenishment = await loadReplenishment(token);
        if (latestMetrics) render(latestMetrics);
      } catch (err) {
        status(err && err.message ? err.message : String(err), "is-error");
      } finally {
        curriculumDraftsAutoEl.textContent = "Auto enqueue exhausted";
        const generationQueue = (latestReplenishment && latestReplenishment.generationQueue) || [];
        curriculumDraftsAutoEl.disabled = generationQueue.filter((step) => step.autoEligible).length === 0;
      }
    }

    async function exportCurriculumDraft(draftId, btn) {
      const token = tokenEl.value.trim();
      if (!token || !draftId) {
        status("Locked.", "");
        return;
      }
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Exporting...";
      try {
        const response = await fetch(replenishmentPath, {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "export-reviewed", draftId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || "Export failed.");
        const payload = JSON.stringify(data.questions || [], null, 2);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(payload).catch(() => {});
        }
        status("Exported " + n(data.questionCount) + " reviewed questions for " + (data.targetFile || "question bank") + ".", "");
      } catch (err) {
        status(err && err.message ? err.message : String(err), "is-error");
      } finally {
        btn.textContent = original || "Export";
        btn.disabled = false;
      }
    }

    async function approveCurriculumDraft(draftId, btn) {
      const token = tokenEl.value.trim();
      if (!token || !draftId) {
        status("Locked.", "");
        return;
      }
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Approving...";
      try {
        const response = await fetch(replenishmentPath, {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "approve-reviewed", draftId, approvedBy: "admin-dashboard" }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || "Approval failed.");
        status("Approved " + n(data.questionCount) + " reviewed questions for promotion.", "");
        latestReplenishment = await loadReplenishment(token);
        if (latestMetrics) render(latestMetrics);
      } catch (err) {
        status(err && err.message ? err.message : String(err), "is-error");
      } finally {
        btn.textContent = original || "Approve";
        btn.disabled = false;
      }
    }

    async function promoteCurriculumDraft(draftId, btn) {
      const token = tokenEl.value.trim();
      if (!token || !draftId) {
        status("Locked.", "");
        return;
      }
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Promoting...";
      try {
        const response = await fetch(replenishmentPath, {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "promote-reviewed", draftId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || "Promotion failed.");
        status("Promoted " + n(data.promoted && data.promoted.inserted) + " reviewed questions into " + (data.promoted && data.promoted.packId || "the active bank") + ".", "");
        latestReplenishment = await loadReplenishment(token);
        if (latestMetrics) render(latestMetrics);
      } catch (err) {
        status(err && err.message ? err.message : String(err), "is-error");
      } finally {
        btn.textContent = original || "Promote";
        btn.disabled = false;
      }
    }

    async function generateOverview() {
      const token = tokenEl.value.trim();
      if (!token) {
        status("Locked.", "");
        return;
      }
      overviewRefreshEl.disabled = true;
      overviewSummaryEl.textContent = "Generating overview...";
      try {
        const response = await fetch(overviewPath, {
          headers: { "Authorization": "Bearer " + token },
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Overview request failed.");
        }
        renderOverview(data.overview || {}, data.provider);
      } catch (err) {
        overviewSummaryEl.textContent = err && err.message ? err.message : String(err);
      } finally {
        overviewRefreshEl.disabled = false;
      }
    }

    function render(data) {
      const auth = data.auth || {};
      const ruby = data.ruby || {};
      const events = ruby.events || {};
      const referral = events.referral || {};
      const humanActivation = events.activationFunnel && events.activationFunnel.humanViewer || {};
      const humanActivationSteps = Array.isArray(humanActivation.steps) ? humanActivation.steps : [];
      const humanCharacterStep = humanActivationSteps.find(function(step) { return step && step.key === "character_created"; }) || {};
      const humanResultStep = humanActivationSteps.find(function(step) { return step && step.key === "result_viewed"; }) || {};
      const onboarding = events.onboardingFunnel && events.onboardingFunnel.humanViewer || {};
      const onboardingSteps = Array.isArray(onboarding.steps) ? onboarding.steps : [];
      const creatorOpenedStep = onboardingSteps.find(function(step) { return step && step.key === "creation_opened"; }) || {};
      const enrollmentStep = onboardingSteps.find(function(step) { return step && step.key === "enrollment_started"; }) || {};
      const ops = data.ops || {};
      const logs = data.logs || {};
      status("Updated " + time(data.generatedAt) + " - build " + (logs.build || "unknown") + " - " + (data.schemaVersion || "legacy schema"), "");
      renderQuick(data);
      renderCharts(data);
      renderOverview(localOverview(data), "local");
      authGrid.innerHTML = [
        metric("Identity records", n(auth.users), n(auth.createdLast24h) + " new records - not unique people"),
        metric("Unexpired auth sessions", n(auth.unexpiredAuthSessions), n(auth.pendingAuth) + " pending auth"),
        metric("Identity D1", pct(auth.d1Retention && auth.d1Retention.rate), n(auth.d1Retention && auth.d1Retention.returnedUsers) + " / " + n(auth.d1Retention && auth.d1Retention.eligibleUsers) + " cookie-bound"),
        metric("Providers", n(auth.providers && auth.providers.guest) + " / " + n(auth.providers && auth.providers.openrouter) + " / " + n(auth.providers && auth.providers.privy), "guest / BYOK OpenRouter / Privy"),
      ].join("");
      playGrid.innerHTML = [
        metric("Saved sessions", n(ruby.sessions), n(ruby.updatedLast24h) + " updated in 24h"),
        metric("Character D1 / D7", pct(ruby.characterD1Retention && ruby.characterD1Retention.rate) + " / " + pct(ruby.retention && ruby.retention.characterD7 && ruby.retention.characterD7.rate), n(ruby.characterD1Retention && ruby.characterD1Retention.returnedSessions) + " / " + n(ruby.characterD1Retention && ruby.characterD1Retention.eligibleSessions)),
        metric("App opens", n(events.appOpen && events.appOpen.total), n(events.sessionResume && events.sessionResume.total) + " resumes"),
        metric("Human activation", n(humanActivation.eligibleSessions) + " opens", pct(humanCharacterStep.rateFromOpen) + " character · " + pct(humanResultStep.rateFromOpen) + " result viewed"),
        metric("First-visit journey", n(onboarding.eligibleSessions) + " opens", pct(creatorOpenedStep.rateFromOpen) + " creator · " + pct(enrollmentStep.rateFromOpen) + " enroll click"),
        metric("Characters", n(ruby.characters), n(ruby.graduatedCharacters) + " graduated - " + n(ruby.completedGrades) + " grades sealed"),
        metric("Questions", n(ruby.questions && ruby.questions.total), n(ruby.questions && ruby.questions.correct) + " correct - " + pct(ruby.questions && ruby.questions.accuracy) + " accuracy"),
        metric("Curriculum", n(ruby.curriculum && ruby.curriculum.lowPools && ruby.curriculum.lowPools.length), n(ruby.curriculum && ruby.curriculum.rows && ruby.curriculum.rows.length) + " grade/teacher pools"),
        metric("Active rounds", n(ruby.activeRounds), n(ruby.essayReports) + " essay reports"),
        metric("Share CTR", pct(referral.uniqueShareClickThroughRate), n(referral.uniqueReferredVisitors) + " unique - " + n(referral.linkVisits) + " visits / " + n(referral.sharesInitiated) + " shares"),
        metric("Photo posts", photoPostMetricValue(ruby.photoPosts), photoPostMetricSub(ruby.photoPosts)),
      ].join("");
      const commerce = events.commerce || {};
      const funnel = events.conversionFunnel || {};
      const wallet = ruby.wallet || {};
      const llm = events.llm || {};
      const revenueStr = commerce.amountCents != null ? "\$" + (commerce.amountCents / 100).toFixed(2) : "n/a";
      economyGrid.innerHTML = [
        metric("Merit Stars", n(wallet.meritStars), signedNumber(commerce.meritStarsDelta) + " net Merit Stars · chat spends"),
        metric("Hall Passes", n(wallet.hallPasses), signedNumber(commerce.hallPassesDelta) + " net Hall Passes · images, cards, tools"),
        metric("Revenue", revenueStr, n(commerce.payingSessions) + " payers - " + n(commerce.events) + " txns"),
        metric("Solana packs", solanaMetricValue(commerce), solanaMetricSub(commerce)),
        metric("Funnel V→C→P", n(funnel.totalVisitors) + "→" + n(funnel.charactersCreated) + "→" + n(funnel.payers), pct(funnel.visitorToCharacterRate) + " / " + pct(funnel.characterToPayerRate)),
      ].join("");
      opsGrid.innerHTML = [
        metric("School activity", schoolActivityMetricValue(ruby.world), schoolActivityMetricSub(ruby.world), "is-wide"),
        metric("Activity reads", publicReadMetricValue(ops.publicReadLimiter), publicReadMetricSub(ops.publicReadLimiter)),
        metric("Activity streams", worldStreamMetricValue(ops.worldLiveStreams), worldStreamMetricSub(ops.worldLiveStreams)),
        metric("Sponsored LLM", n(llm.calls), n(llm.successes) + " ok · " + n(llm.errors) + " errors · text sponsored, images metered"),
        metric("Durable errors", n(events.errors && events.errors.total), n((logs.counters || []).length) + " process counters"),
      ].join("");
      const commerceTbl = events.commerce || {};
      const revenueBySource = commerceTbl.revenueBySource || {};
      const revenueTable = Object.keys(revenueBySource).length > 0
        ? moneyTable("Commerce by Source", revenueBySource)
        : "";
      const generationQueue = (latestReplenishment && latestReplenishment.generationQueue) || [];
      curriculumDraftsCreateEl.disabled = generationQueue.filter((step) => step.status === "ready").length === 0;
      curriculumDraftsAutoEl.disabled = generationQueue.filter((step) => step.autoEligible).length === 0;
      tablesEl.innerHTML = [
        revenueTable,
        curriculumTable(ruby.curriculum),
        curriculumGenerationQueueTable(generationQueue),
        curriculumReviewQueueTable(latestReplenishment && latestReplenishment.reviewQueue),
        table("Provider Records", auth.providers || {}),
        table("Durable Events", events.byName || {}),
        logTable(logs.counters || []),
      ].filter(Boolean).join("");
    }

    function renderQuick(data) {
      const auth = data.auth || {};
      const ruby = data.ruby || {};
      const events = ruby.events || {};
      quickStackEl.innerHTML = [
        metric("App opens", n(events.appOpen && events.appOpen.total), n(events.sessionResume && events.sessionResume.total) + " resumes"),
        metric("24h play", n(ruby.characterSessionsUpdatedLast24h || ruby.updatedLast24h), n(ruby.sessions) + " saved sessions"),
        metric("Question accuracy", pct(ruby.questions && ruby.questions.accuracy), n(ruby.questions && ruby.questions.total) + " answered"),
      ].join("");
    }

    function renderOverview(overview, provider) {
      const headline = overview.headline || "Ruby High usage overview";
      const summary = overview.summary || "Metrics loaded.";
      overviewSummaryEl.innerHTML = "<strong>" + esc(headline) + "</strong><br>" + esc(summary) + (provider && provider !== "local" ? "<br><span class=\\"sub\\">" + esc(provider) + "</span>" : "");
      overviewListEl.innerHTML = [
        overviewColumn("Highlights", overview.highlights || []),
        overviewColumn("Risks", overview.risks || []),
        overviewColumn("Actions", overview.actions || []),
      ].join("");
    }

    function localOverview(data) {
      const auth = data.auth || {};
      const ruby = data.ruby || {};
      const events = ruby.events || {};
      const retention = ruby.retention || {};
      const characterD1 = retention.characterD1 || ruby.characterD1Retention || {};
      const visitorD1 = retention.visitorD1 || {};
      const characterD7 = retention.characterD7 || {};
      const visitorD7 = retention.visitorD7 || {};
      const d1 = characterD1.rate != null ? pct(characterD1.rate) : "n/a";
      const d7 = characterD7.rate != null ? pct(characterD7.rate) : "n/a";
      const activeShare = ruby.sessions ? Math.round((Number(ruby.updatedLast24h || 0) / Number(ruby.sessions || 1)) * 100) : 0;
      const commerce = events.commerce || {};
      const funnel = events.conversionFunnel || {};
      const revenue = commerce.amountCents != null ? "\$" + (commerce.amountCents / 100).toFixed(2) : "n/a";
      return {
        headline: n(auth.visitors && auth.visitors.total) + " visitor ids recorded",
        summary: "The current loop has " + n(ruby.characters) + " characters, " + n(ruby.completedGrades) + " sealed grades, and " + pct(ruby.questions && ruby.questions.accuracy) + " answer accuracy.",
        highlights: [
          n(events.appOpen && events.appOpen.total) + " durable app opens",
          n(events.sessionResume && events.sessionResume.total) + " durable session resumes",
          n(auth.visitors && auth.visitors.returningLast24h) + " returning visitors in 24h",
          n(ruby.updatedLast24h) + " saved sessions updated in 24h",
          n(ruby.essayReports) + " essay reports generated",
          revenue + " total revenue from " + n(commerce.payingSessions) + " payers",
        ],
        risks: [
          d1 + " character-session D1 retention",
          d7 + " character-session D7 retention",
          (visitorD1.rate == null ? "n/a" : pct(visitorD1.rate)) + " visitor D1 (" + (visitorD7.rate == null ? "n/a" : pct(visitorD7.rate)) + " D7)",
          n(auth.providers && auth.providers.guest) + " guest identity records are not unique people",
          activeShare + "% of saved sessions were active in 24h",
        ],
        actions: [
          "Visitor→character: " + (funnel.visitorToCharacterRate != null ? pct(funnel.visitorToCharacterRate) : "n/a") + " (" + n(funnel.charactersCreated) + "/" + n(funnel.totalVisitors) + ")",
          "Character→payer: " + (funnel.characterToPayerRate != null ? pct(funnel.characterToPayerRate) : "n/a") + " (" + n(funnel.payers) + "/" + n(funnel.charactersCreated) + ")",
        ],
      };
    }

    function overviewColumn(title, rows) {
      const list = rows.length ? rows : ["No signal yet."];
      return "<div><h3>" + esc(title) + "</h3><ul>" + list.map((row) => "<li>" + esc(row) + "</li>").join("") + "</ul></div>";
    }

    function renderCharts(data) {
      const authDaily = (data.auth && data.auth.daily) || [];
      const rubyDaily = (data.ruby && data.ruby.daily) || [];
      chartsEl.innerHTML = [
        chartCard("Auth", authDaily, [
          { key: "newUsers", label: "New records", color: "#9f2338", mode: "bar" },
          { key: "signedInUsers", label: "Seen records", color: "#0f6f68", mode: "line" },
          { key: "newVisitors", label: "New visitors", color: "#2f5f91", mode: "bar" },
          { key: "returningVisitors", label: "Returning", color: "#7a4f2a", mode: "line" },
          { key: "sessionStarts", label: "Starts", color: "#665c6d", mode: "line" },
        ]),
        chartCard("Play", rubyDaily, [
          { key: "appOpens", label: "Opens", color: "#665c6d", mode: "bar" },
          { key: "sessionResumes", label: "Resumes", color: "#0f6f68", mode: "line" },
          { key: "updatedSessions", label: "Updated", color: "#9f2338", mode: "bar" },
          { key: "charactersCreated", label: "Characters", color: "#2f5f91", mode: "line" },
          { key: "gradesCompleted", label: "Grades", color: "#0f6f68", mode: "line" },
        ]),
        chartCard("Essay Flow", rubyDaily, [
          { key: "essaysGraded", label: "Essays", color: "#9f2338", mode: "bar" },
          { key: "gradesCompleted", label: "Grades", color: "#0f6f68", mode: "line" },
        ]),
        chartCard("Events", rubyDaily, [
          { key: "funnelSteps", label: "Funnel", color: "#9f2338", mode: "bar" },
          { key: "visitorSeen", label: "Visitors", color: "#2f5f91", mode: "line" },
          { key: "commerceEvents", label: "Commerce", color: "#665c6d", mode: "line" },
          { key: "llmCalls", label: "LLM", color: "#2f5f91", mode: "line" },
          { key: "durableErrors", label: "Errors", color: "#0f6f68", mode: "line" },
        ]),
        chartCard("Activation", mergeDaily(authDaily, rubyDaily), [
          { key: "returningVisitors", label: "Returning", color: "#0f6f68", mode: "line" },
          { key: "updatedSessions", label: "Updated", color: "#9f2338", mode: "bar" },
        ]),
      ].join("");
    }

    function mergeDaily(a, b) {
      const byDate = new Map();
      for (const row of a || []) byDate.set(row.date, Object.assign({}, row));
      for (const row of b || []) byDate.set(row.date, Object.assign({}, byDate.get(row.date) || { date: row.date }, row));
      return Array.from(byDate.values()).sort((x, y) => String(x.date).localeCompare(String(y.date)));
    }

    function chartCard(title, rows, specs) {
      if (!rows.length) return "<div class=\\"chart\\"><div class=\\"chart-head\\"><div class=\\"chart-title\\">" + esc(title) + "</div></div><div class=\\"empty\\">No trend data.</div></div>";
      const width = 720;
      const height = 180;
      const pad = 22;
      const max = Math.max(1, ...rows.flatMap((row) => specs.map((spec) => Number(row[spec.key] || 0))));
      const step = rows.length > 1 ? (width - pad * 2) / (rows.length - 1) : 0;
      const barSpecs = specs.filter((spec) => spec.mode === "bar");
      const lineSpecs = specs.filter((spec) => spec.mode !== "bar");
      let svg = "<svg viewBox=\\"0 0 " + width + " " + height + "\\" role=\\"img\\">";
      svg += "<line x1=\\"" + pad + "\\" y1=\\"" + (height - pad) + "\\" x2=\\"" + (width - pad) + "\\" y2=\\"" + (height - pad) + "\\" stroke=\\"#ded7e5\\"/>";
      svg += "<line x1=\\"" + pad + "\\" y1=\\"" + pad + "\\" x2=\\"" + pad + "\\" y2=\\"" + (height - pad) + "\\" stroke=\\"#ded7e5\\"/>";
      rows.forEach((row, index) => {
        const x = pad + step * index;
        const groupWidth = Math.max(5, Math.min(18, (width - pad * 2) / Math.max(rows.length, 1) * 0.52));
        barSpecs.forEach((spec, specIndex) => {
          const value = Number(row[spec.key] || 0);
          const barWidth = groupWidth / Math.max(barSpecs.length, 1);
          const h = Math.max(0, (value / max) * (height - pad * 2));
          const bx = x - groupWidth / 2 + specIndex * barWidth;
          const by = height - pad - h;
          svg += "<rect x=\\"" + bx.toFixed(2) + "\\" y=\\"" + by.toFixed(2) + "\\" width=\\"" + Math.max(2, barWidth - 1).toFixed(2) + "\\" height=\\"" + h.toFixed(2) + "\\" fill=\\"" + spec.color + "\\" opacity=\\"0.78\\"><title>" + esc(spec.label + " " + row.date + ": " + value) + "</title></rect>";
        });
      });
      for (const spec of lineSpecs) {
        const points = rows.map((row, index) => {
          const x = pad + step * index;
          const y = height - pad - (Number(row[spec.key] || 0) / max) * (height - pad * 2);
          return x.toFixed(2) + "," + y.toFixed(2);
        }).join(" ");
        svg += "<polyline points=\\"" + points + "\\" fill=\\"none\\" stroke=\\"" + spec.color + "\\" stroke-width=\\"3\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/>";
        rows.forEach((row, index) => {
          const x = pad + step * index;
          const y = height - pad - (Number(row[spec.key] || 0) / max) * (height - pad * 2);
          const value = Number(row[spec.key] || 0);
          svg += "<circle cx=\\"" + x.toFixed(2) + "\\" cy=\\"" + y.toFixed(2) + "\\" r=\\"3.5\\" fill=\\"" + spec.color + "\\"><title>" + esc(spec.label + " " + row.date + ": " + value) + "</title></circle>";
        });
      }
      svg += "<text x=\\"" + (pad + 2) + "\\" y=\\"16\\" fill=\\"#665c6d\\" font-size=\\"11\\">max " + n(max) + "</text>";
      svg += "</svg>";
      const legend = specs.map((spec) => "<span><i style=\\"background:" + esc(spec.color) + "\\"></i>" + esc(spec.label) + "</span>").join("");
      const first = rows[0] && rows[0].date ? shortDate(rows[0].date) : "";
      const last = rows[rows.length - 1] && rows[rows.length - 1].date ? shortDate(rows[rows.length - 1].date) : "";
      return "<div class=\\"chart\\"><div class=\\"chart-head\\"><div class=\\"chart-title\\">" + esc(title) + "</div><div class=\\"legend\\">" + legend + "</div></div>" + svg + "<div class=\\"axis\\"><span>" + esc(first) + "</span><span>" + esc(last) + "</span></div></div>";
    }

    function metric(label, value, sub, className) {
      return "<div class=\\"metric" + (className ? " " + esc(className) : "") + "\\"><div class=\\"label\\">" + esc(label) + "</div><span class=\\"value\\">" + esc(String(value)) + "</span><div class=\\"sub\\">" + esc(String(sub || "")) + "</div></div>";
    }
    function photoPostMetricValue(photoPosts) {
      photoPosts = photoPosts || {};
      return n(photoPosts.pendingPhotos) + " / " + n(photoPosts.inFlightPosts) + " / " + n(photoPosts.deferredPosts);
    }
    function photoPostMetricSub(photoPosts) {
      photoPosts = photoPosts || {};
      const result = photoPosts.lastResult || null;
      const scheduler = photoPosts.schedulerActive ? photoPosts.schedulerRunning ? "scheduler posting" : "scheduler ready" : "scheduler off";
      const last = result
        ? result.posted ? "last tweeted"
          : result.fallback ? "last revealed locally"
          : result.deferredUntil ? "last deferred"
          : "last queued"
        : "no attempts yet";
      const retry = photoPosts.nextRetryAt ? " · retry " + time(photoPosts.nextRetryAt) : "";
      return "pending / active / deferred · " + scheduler + " · " + last + retry;
    }
    function worldStreamMetricValue(streams) {
      streams = streams || {};
      return n(streams.active) + " / " + n(streams.clients);
    }
    function worldStreamMetricSub(streams) {
      streams = streams || {};
      return "active / clients · cap " + n(streams.limitPerClient) + " · accepted " + n(streams.accepted) + " · rejected " + n(streams.rejected) + " · write fails " + n(streams.writeFailures);
    }
    function schoolActivityMetricValue(world) {
      world = world || {};
      return n(world.activeStudents) + " / " + n(world.recentEvents);
    }
    function schoolActivityMetricSub(world) {
      world = world || {};
      const refresh = world.lastRefreshAt ? "refresh " + time(world.lastRefreshAt) : "not refreshed";
      const newest = world.newestEventAt ? " · newest " + time(world.newestEventAt) : "";
      const summary = world.summary || {};
      const latestOutcome = Array.isArray(world.recentRoomOutcomes) && world.recentRoomOutcomes[0] ? " · latest outcome " + esc(world.recentRoomOutcomes[0].summaryLabel || world.recentRoomOutcomes[0].rewardLabel || "recorded") : "";
      const agendaExec = world.teacherAgendaExecution || {};
      const latestAgenda = Array.isArray(world.recentTeacherAgendas) && world.recentTeacherAgendas[0] ? " · latest agenda " + esc(world.recentTeacherAgendas[0].nextAction || "monitor-coverage") + " p" + n(world.recentTeacherAgendas[0].priorityScore) : "";
      const latestTerm = Array.isArray(world.recentTerms) && world.recentTerms[0] ? " · latest term " + esc(world.recentTerms[0].label || "recorded") + (Array.isArray(world.recentTerms[0].activeRuleLabels) && world.recentTerms[0].activeRuleLabels.length ? " rules " + esc(world.recentTerms[0].activeRuleLabels.join(", ")) : "") : "";
      return "students / events · year " + esc(summary.schoolYear || "n/a") + " · rooms " + n(world.activeRooms) + " · durable rooms " + n(world.durableRoomRecords) + "/" + n(world.durableRoomRecordLimit) + " · outcomes " + n(world.durableRoomOutcomes) + "/" + n(world.durableRoomOutcomeLimit) + latestOutcome + " · terms " + n(world.durableTermRecords) + "/" + n(world.durableTermRecordLimit) + " · cohort terms " + n(world.durableCohortTerms) + latestTerm + " · agendas " + n(world.durableTeacherAgendas) + "/" + n(world.durableTeacherAgendaLimit) + " ready " + n(agendaExec.ready) + " queued " + n(agendaExec.queued) + " watching " + n(agendaExec.watching) + latestAgenda + " · curriculum loops " + n(summary.curriculumLoops && summary.curriculumLoops.promoted) + " promoted/" + n(summary.curriculumLoops && summary.curriculumLoops.inReview) + " review · goals " + n(world.liveRoomGoals) + " · sparks " + n(summary.studySparks && summary.studySparks.total) + " · replay " + n(world.publicEventLogSize) + "/" + n(world.publicEventLogLimit) + " · suppressed " + n(world.suppressedEvents) + " · cache " + n(world.durableEventCacheSize) + "/" + n(world.durableEventCacheLimit) + " · summary " + n(summary.eventCount) + " · " + refresh + newest;
    }
    function publicReadMetricValue(limiter) {
      limiter = limiter || {};
      return n(limiter.trackedKeys);
    }
    function publicReadMetricSub(limiter) {
      limiter = limiter || {};
      const gc = limiter.lastGcAt ? "last GC " + time(limiter.lastGcAt) : "GC pending";
      return "tracked visitor/IP buckets · " + gc + " · every " + n(limiter.gcIntervalMs) + "ms";
    }
    function solanaMetricValue(commerce) {
      const bySource = (commerce && commerce.revenueBySource) || {};
      const hasSolana = Object.prototype.hasOwnProperty.call(bySource, "solana");
      const cents = Number(bySource.solana || 0);
      if (cents > 0) return money(cents);
      return hasSolana ? "tracked" : "none";
    }
    function solanaMetricSub(commerce) {
      commerce = commerce || {};
      const bySource = commerce.revenueBySource || {};
      const sources = Object.keys(bySource).filter(Boolean).sort();
      const sourceText = sources.length ? "sources " + sources.slice(0, 4).join(", ") : "no source totals yet";
      return "Solana pack checkout source · token settlement on-chain · " + sourceText;
    }
    function table(title, rows) {
      const entries = Object.entries(rows);
      if (!entries.length) return "<div class=\\"empty\\">" + esc(title) + "</div>";
      return "<table><thead><tr><th>" + esc(title) + "</th><th>Count</th></tr></thead><tbody>" + entries.map(([key, value]) => "<tr><td>" + esc(key) + "</td><td>" + n(value) + "</td></tr>").join("") + "</tbody></table>";
    }
    function moneyTable(title, rows) {
      const entries = Object.entries(rows);
      if (!entries.length) return "<div class=\\"empty\\">" + esc(title) + "</div>";
      return "<table><thead><tr><th>" + esc(title) + "</th><th>USD value</th></tr></thead><tbody>" + entries.map(([key, value]) => "<tr><td>" + esc(key) + "</td><td>" + money(value) + "</td></tr>").join("") + "</tbody></table>";
    }
    function curriculumTable(curriculum) {
      const rows = (curriculum && curriculum.lowPools) || [];
      if (!rows.length) return "";
      return "<table><thead><tr><th>Low Curriculum Pools</th><th>Remaining</th><th>Next</th></tr></thead><tbody>" + rows.map((row) => {
        const label = "Grade " + esc(row.grade) + " · " + esc(row.displayName || row.facultyId);
        const repeated = row.repetitionPressure ? " · " + n(Math.round(row.repetitionPressure * 100)) + "% repeat pressure" : "";
        const sub = n(row.sessions) + " sessions · " + n(row.lowPoolSessions) + " low · " + n(row.exhaustedSessions) + " exhausted" + repeated;
        const remaining = n(row.averageRemaining) + " / " + n(row.totalEligibleMax);
        const plan = row.replenishment || null;
        const planSubjects = plan ? ((plan.weakSubjects && plan.weakSubjects.length ? plan.weakSubjects : plan.focusSubjects) || []) : [];
        const next = plan
          ? esc(plan.mode + " · " + n(plan.targetNewQuestions) + " " + plan.targetDifficulty) + "<div class=\\"sub\\">" + esc(planSubjects.slice(0, 3).join(", ") || "teacher corpus") + "</div>"
          : "";
        return "<tr><td>" + label + "<div class=\\"sub\\">" + esc(sub) + "</div></td><td>" + esc(remaining) + "</td><td>" + next + "</td></tr>";
      }).join("") + "</tbody></table>";
    }
    function curriculumGenerationQueueTable(rows) {
      rows = rows || [];
      if (!rows.length) return "";
      return "<table><thead><tr><th>Curriculum Generation Queue</th><th>Pressure</th><th>Status</th></tr></thead><tbody>" + rows.map((row) => {
        const label = "Grade " + esc(row.grade) + " · " + esc(row.displayName || row.facultyId);
        const agenda = row.teacherAgenda || null;
        const agendaText = agenda ? " · agenda " + esc(agenda.executionReason || "ready") + (agenda.termRuleLabel ? " / " + esc(agenda.termRuleLabel) : "") + (agenda.draftStatus ? " / " + esc(agenda.draftStatus) : "") : "";
        const sub = esc((row.focusSubjects || []).slice(0, 3).join(", ") || row.corpusTitle || "teacher corpus") + agendaText;
        const pressure = n(row.priority) + "<div class=\\"sub\\">" + n(row.lowPoolSessions) + " low · " + n(row.exhaustedSessions) + " exhausted</div>";
        const auto = row.autoEligible ? " · auto" : "";
        const reason = row.autoReason ? "<div class=\\"sub\\">" + esc(row.autoReason) + "</div>" : "";
        const status = esc(row.status || "unknown") + auto + "<div class=\\"sub\\">" + esc(row.action || "review") + (row.draftId ? " · " + esc(row.draftId) : "") + "</div>" + reason;
        return "<tr><td>" + label + "<div class=\\"sub\\">" + sub + "</div></td><td>" + pressure + "</td><td>" + status + "</td></tr>";
      }).join("") + "</tbody></table>";
    }
    function curriculumReviewQueueTable(rows) {
      rows = rows || [];
      if (!rows.length) return "";
      return "<table><thead><tr><th>Curriculum Review Queue</th><th>Cards</th><th>Status</th><th>Action</th></tr></thead><tbody>" + rows.map((row) => {
        const label = "Grade " + esc(row.grade) + " · " + esc(row.facultyId);
        const sub = esc(row.name || row.id) + "<div class=\\"sub\\">request " + esc(row.requestDay || "unknown") + "</div>";
        const validation = row.validation || { ok: row.questionCount > 0, errors: [] };
        const approval = row.approval || { approved: false, stale: false, approvedAt: null, approvedBy: null };
        const errors = (validation.errors || []).slice(0, 2);
        const status = validation.ok
          ? approval.approved
            ? "Approved<div class=\\"sub\\">" + esc(approval.approvedBy || "admin") + " · " + esc(time(approval.approvedAt)) + "</div>"
            : approval.stale
              ? "Re-approval needed<div class=\\"sub\\">questions changed after approval</div>"
              : "Ready<div class=\\"sub\\">validation passed; approval required</div>"
          : "Needs review" + (errors.length ? "<div class=\\"sub\\">" + errors.map(esc).join("<br>") + "</div>" : "");
        const action = validation.ok && approval.approved
          ? "<button class=\\"secondary curriculum-export-btn\\" type=\\"button\\" data-draft-id=\\"" + esc(row.id) + "\\">Export</button> <button class=\\"secondary curriculum-promote-btn\\" type=\\"button\\" data-draft-id=\\"" + esc(row.id) + "\\">Promote</button><div class=\\"sub\\">" + esc(time(row.updatedAt)) + "</div>"
          : validation.ok
            ? "<button class=\\"secondary curriculum-export-btn\\" type=\\"button\\" data-draft-id=\\"" + esc(row.id) + "\\">Export</button> <button class=\\"secondary curriculum-approve-btn\\" type=\\"button\\" data-draft-id=\\"" + esc(row.id) + "\\">Approve</button><div class=\\"sub\\">approval required before promotion</div>"
          : "<span class=\\"sub\\">" + (row.questionCount > 0 ? "Fix validation first" : "Generate questions first") + "</span><div class=\\"sub\\">" + esc(time(row.updatedAt)) + "</div>";
        return "<tr><td>" + label + "<div class=\\"sub\\">" + sub + "</div></td><td>" + n(row.questionCount) + " q / " + n(row.sourceCardCount) + " src</td><td>" + status + "</td><td>" + action + "</td></tr>";
      }).join("") + "</tbody></table>";
    }
    function logTable(rows) {
      if (!rows.length) return "<div class=\\"empty\\">No log counters.</div>";
      const sorted = rows.slice().sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
      return "<table><thead><tr><th>Log</th><th>Count</th></tr></thead><tbody>" + sorted.map((row) => "<tr><td>" + esc((row.level || "event") + ":" + (row.name || "unknown")) + "<div class=\\"sub\\">" + esc(time(row.lastAt)) + "</div></td><td>" + n(row.count) + "</td></tr>").join("") + "</tbody></table>";
    }
    function n(value) {
      const number = Number(value || 0);
      return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : "0";
    }
    function signedNumber(value) {
      const number = Number(value || 0);
      if (!Number.isFinite(number) || number === 0) return "0";
      return (number > 0 ? "+" : "-") + n(Math.abs(number));
    }
    function money(value) {
      const cents = Number(value || 0);
      return Number.isFinite(cents) ? "$" + (cents / 100).toFixed(2) : "$0.00";
    }
    function pct(value) {
      if (value === null || value === undefined) return "n/a";
      const number = Number(value);
      return Number.isFinite(number) ? (number * 100).toFixed(1) + "%" : "n/a";
    }
    function time(value) {
      const date = value ? new Date(value) : null;
      return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : "unknown";
    }
    function shortDate(value) {
      const date = value ? new Date(value + "T00:00:00Z") : null;
      return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    }
    function esc(value) {
      return String(value).replace(/[&<>"']/g, (ch) => {
        if (ch === "&") return "&amp;";
        if (ch === "<") return "&lt;";
        if (ch === ">") return "&gt;";
        if (ch === '"') return "&quot;";
        return "&#39;";
      });
    }
    function status(text, className) {
      statusEl.textContent = text;
      statusEl.className = "status " + (className || "");
    }

    function xPostStatusCopy(connection) {
      if (!connection) return "";
      if (connection.postPausedReason) {
        const suffix = connection.postPausedUntil
          ? " until " + new Date(connection.postPausedUntil).toLocaleString()
          : " - reconnect required";
        return "Posting paused: " + connection.postPausedReason + suffix;
      }
      if (connection.hasTweetWrite === false) return "Reconnect for text posts - missing tweet.write";
      return "Text posts enabled";
    }

    // ── X Social ──────────────────────────────────────────────────────────
    const xPanel = document.getElementById("x-social-panel");
    const socialTeacherSelect = document.getElementById("social-teacher-select");
    const FACULTY_IDS = ["ruby", "sally-science", "professor-edward"];
    let connectedTeachers = [];

    function renderSocialTeacherSelect() {
      if (!socialTeacherSelect) return;
      const previous = socialTeacherSelect.value;
      socialTeacherSelect.innerHTML = connectedTeachers.length
        ? connectedTeachers.map((t) => '<option value="' + escHtml(t.teacherId) + '">' + escHtml(t.teacherId) + (t.xScreenName ? " @" + escHtml(t.xScreenName) : "") + (t.postPausedReason ? " - posting paused" : t.hasTweetWrite === false ? " - reconnect for posts" : t.hasMediaWrite === false ? " - reconnect for images" : "") + '</option>').join("")
        : '<option value="">No X teacher</option>';
      if (previous && connectedTeachers.some((t) => t.teacherId === previous)) {
        socialTeacherSelect.value = previous;
      }
      socialTeacherSelect.disabled = connectedTeachers.length === 0;
    }

    async function loadConnectedTeachers(token) {
      const res = await fetch(xSocialPrefix + "/connected", {
        headers: { Authorization: "Bearer " + token },
      });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      connectedTeachers = Array.isArray(data.teachers) ? data.teachers : [];
      renderSocialTeacherSelect();
      return connectedTeachers;
    }

    async function selectedSocialTeacherId(token) {
      if (!connectedTeachers.length) {
        await loadConnectedTeachers(token);
      }
      const selected = socialTeacherSelect && socialTeacherSelect.value ? socialTeacherSelect.value : "";
      if (selected && connectedTeachers.some((t) => t.teacherId === selected)) return selected;
      return "";
    }

    async function refreshXSocial() {
      const token = sessionStorage.getItem(tokenKey);
      if (!token) {
        connectedTeachers = [];
        renderSocialTeacherSelect();
        xPanel.innerHTML = '<div class="empty" style="grid-column:1/-1;">Unlock to manage X connections.</div>';
        return;
      }
      try {
        const teachers = await loadConnectedTeachers(token);
        const connected = new Map(teachers.map(t => [t.teacherId, t]));
        xPanel.innerHTML = FACULTY_IDS.map(id => {
          const c = connected.get(id);
          if (c) {
            const mediaCopy = c.hasMediaWrite === false ? "Reconnect for image posts - missing media.write" : "Image posts enabled";
            const mediaClass = c.hasMediaWrite === false ? "bad" : "good";
            const postCopy = xPostStatusCopy(c);
            const postClass = c.postPausedReason || c.hasTweetWrite === false ? "bad" : "good";
            return '<div class="metric"><div class="label">' + id + '</div><div class="value good" style="font-size:18px;">\u2714 Connected</div><div class="sub">@' + escHtml(c.xScreenName || "") + '</div><div class="sub ' + postClass + '">' + escHtml(postCopy) + '</div><div class="sub ' + mediaClass + '">' + mediaCopy + '</div><div style="display:flex;gap:6px;margin-top:8px;"><button class="x-social-btn" style="flex:1;" data-action="post" data-teacher="' + id + '">Post</button><button class="secondary x-social-btn" style="flex:1;" data-action="disconnect" data-teacher="' + id + '">Disconnect</button></div></div>';
          }
          return '<div class="metric"><div class="label">' + id + '</div><div class="value" style="font-size:18px;color:var(--muted);">\u2014</div><div class="sub">Not connected</div><button style="margin-top:8px;width:100%;" class="x-social-btn" data-action="connect" data-teacher="' + id + '">Connect</button></div>';
        }).join("");
      } catch {
        xPanel.innerHTML = '<div class="empty" style="grid-column:1/-1;">Failed to load X connection status.</div>';
      }
    }

    async function connectX(teacherId) {
      const token = sessionStorage.getItem(tokenKey);
      if (!token) return;
      try {
        const res = await fetch(xSocialPrefix + "/connect/" + teacherId, {
          headers: { Authorization: "Bearer " + token },
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
      } catch { /* best effort */ }
    }

    async function disconnectX(teacherId) {
      const token = sessionStorage.getItem(tokenKey);
      if (!token) return;
      try {
        await fetch(xSocialPrefix + "/disconnect/" + teacherId, {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
        });
        refreshXSocial();
      } catch { /* best effort */ }
    }


    // ── Student Report Cards ────────────────────────────────────────────
    const studentsPanel = document.getElementById("students-panel");

    async function refreshStudents() {
      const token = sessionStorage.getItem(tokenKey);
      if (!token) { studentsPanel.innerHTML = '<div class="empty">Unlock to see students.</div>'; return; }
      try {
        const res = await fetch(xSocialPrefix + "/students", {
          headers: { Authorization: "Bearer " + token },
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        if (!data.students || data.students.length === 0) {
          studentsPanel.innerHTML = '<div class="empty">No recently active students.</div>';
          return;
        }
        const gradeLabels = { "9":"Freshman","10":"Sophomore","11":"Junior","12":"Senior" };
        const shortGrade = { "9":"FR","10":"SO","11":"JR","12":"SR" };
        let lastGrade = "";
        let html = "";
        for (const s of data.students) {
          const gl = gradeLabels[s.grade] || ("Grade " + s.grade);
          if (gl !== lastGrade) {
            lastGrade = gl;
            html += '<div class="label" style="margin-top:16px;margin-bottom:6px;font-size:14px;">' + gl + ' — top 3</div>';
          }
          const sg = shortGrade[s.grade] || s.grade;
          const grades = Object.entries(s.classGrades || {}).map(([f,g]) => f + ":" + g).join(" ") || "no grades";
          const stats = ["head","heart","hustle","honor"].map(k => k + ":" + (s.stats && s.stats[k] >= 0 ? "+" : "") + (s.stats ? s.stats[k] : 0)).join(" ");
          const portraitImg = s.portraitUrl ? '<span style="width:40px;height:40px;border-radius:50%;overflow:hidden;border:2px solid var(--line);flex-shrink:0;display:block;"><img src="' + escHtml(s.portraitUrl) + '" style="width:40px;height:40px;object-fit:cover;object-position:50% 15%;transform:scale(2.5);transform-origin:top center;display:block;" alt=""></span>' : '<span style="width:40px;height:40px;border-radius:50%;background:var(--line);flex-shrink:0;display:flex;border:2px solid var(--line);align-items:center;justify-content:center;font-size:16px;color:var(--muted);">' + escHtml(s.name.charAt(0).toUpperCase()) + '</span>';
          html += '<div class="metric" style="display:flex;align-items:center;gap:12px;"><div>' + portraitImg + '</div><div style="flex:1;min-width:0;"><div class="label">' + escHtml(s.name) + ' <span style="color:var(--muted);font-weight:400;">' + sg + ' · ' + escHtml(s.playbookId) + '</span></div><div class="sub">' + escHtml(stats) + '</div><div class="sub">' + escHtml(grades) + ' · ' + (s.yearbookCount||0) + '/4 sealed</div></div><button class="x-social-btn" style="white-space:nowrap;flex-shrink:0;" data-action="post-report" data-session="' + s.sessionId + '">Post Report</button></div>';
        }
        studentsPanel.innerHTML = html;
      } catch {
        studentsPanel.innerHTML = '<div class="empty">Failed to load students.</div>';
      }
    }

    async function postReportCard(sessionId, btn) {
      const token = sessionStorage.getItem(tokenKey);
      if (!token) return;
      btn.disabled = true;
      const origText = btn.textContent;
      btn.textContent = "Posting…";
      try {
        const teacherId = await selectedSocialTeacherId(token);
        if (!teacherId) { btn.textContent = "No teacher"; setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000); return; }

        const res = await fetch(xSocialPrefix + "/post-report/" + teacherId, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ sessionId }),
        });
        const data = await res.json();
        if (data.ok) {
          btn.textContent = "Posted!";
          setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 3000);
        } else {
          btn.textContent = "Failed";
          setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
        }
      } catch {
        btn.textContent = "Error";
        setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
      }
    }

    async function postClassPhoto(btn) {
      const token = sessionStorage.getItem(tokenKey);
      if (!token) return;
      btn.disabled = true;
      const origText = btn.textContent;
      btn.textContent = "Generating…";
      try {
        const teacherId = await selectedSocialTeacherId(token);
        if (!teacherId) { btn.textContent = "No teacher"; setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000); return; }
        const res = await fetch(xSocialPrefix + "/class-photo/" + teacherId, {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
        });
        const data = await res.json();
        if (!data.ok) {
          btn.textContent = res.status === 409 ? "Not queued" : "Failed";
          if (data.error) btn.title = data.error;
        } else if (data.posted && data.tweetId) {
          btn.textContent = "Tweeted!";
        } else if (data.fallback || data.revealed) {
          btn.textContent = "Revealed";
        } else if (data.deferredUntil) {
          btn.textContent = "Queued retry";
        } else {
          btn.textContent = "Queued";
        }
      } catch {
        btn.textContent = "Error";
      }
      setTimeout(() => { btn.textContent = origText; btn.title = ""; btn.disabled = false; }, 3000);
    }

    // ── Telegram ───────────────────────────────────────────────────────
    const tgToken = document.getElementById("tg-token");
    const tgChat = document.getElementById("tg-chat");
    const tgSave = document.getElementById("tg-save");
    const tgPost = document.getElementById("tg-post");
    const tgStatus = document.getElementById("tg-status");

    // Find chat ID from recent updates
    async function refreshTelegram() {
      const token = sessionStorage.getItem(tokenKey);
      if (!token) return;
      try {
        const res = await fetch(xSocialPrefix + "/telegram", {
          headers: { Authorization: "Bearer " + token },
        });
        if (!res.ok) return;
        const data = await res.json();
        tgToken.value = data.hasToken ? "(already set)" : "";
        tgChat.value = data.chatId || "";
        tgStatus.textContent = data.enabled ? "Connected" : "Not configured";
      } catch { tgStatus.textContent = "Failed to load"; }
    }

    // Save handler via document delegation
    
    
    async function showClassPhotoHistory() {
      const token = sessionStorage.getItem(tokenKey);
      if (!token) return;
      const panel = document.getElementById("students-panel");
      panel.innerHTML = '<div class="empty">Loading class photos…</div>';
      try {
        const res = await fetch(xSocialPrefix + "/snapshot", {
          headers: { Authorization: "Bearer " + token },
        });
        const data = await res.json();
        const queued = (data.photoPool || []).filter(p => p.kind === "class-photo").map(p => Object.assign({}, p, { status: "queued", sortAt: p.earnedAt }));
        const posted = (data.classPhotoHistory || []).map(p => Object.assign({}, p, { sortAt: p.revealedAt || p.earnedAt }));
        const photos = queued.concat(posted).sort((a, b) => (b.sortAt || 0) - (a.sortAt || 0));
        if (photos.length === 0) {
          panel.innerHTML = '<div class="empty">No class photos yet. Generate one first.</div>';
          return;
        }
        panel.innerHTML = photos.map(p => {
          const date = new Date(p.revealedAt || p.earnedAt).toLocaleDateString();
          const status = p.status === "posted" ? "tweeted" : p.status === "revealed" ? "revealed" : "queued";
          return '<div class="metric" style="display:flex;align-items:center;justify-content:space-between;"><div><div class="label">Class Photo</div><div class="sub">' + date + ' · ' + p.studentName + '</div></div><span class="sub" style="color:var(--muted);">' + status + '</span></div>';
        }).join("");
        panel.innerHTML += '<div style="margin-top:8px;"><button class="secondary x-social-btn" data-action="refresh-students" style="font-size:12px;">Back to Students</button></div>';
      } catch { panel.innerHTML = '<div class="empty">Failed to load class photos.</div>'; }
    }
    refreshTelegram();
    refreshStudents();
    async function postX(teacherId, btn) {
      const token = sessionStorage.getItem(tokenKey);
      if (!token) return;
      btn.disabled = true;
      const origText = btn.textContent;
      btn.textContent = "Posting…";
      try {
        const res = await fetch(xSocialPrefix + "/post/" + teacherId, {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
        });
        const data = await res.json();
        if (data.ok) {
          btn.textContent = "Posted!";
          setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 3000);
        } else {
          btn.textContent = "Failed";
          setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
        }
      } catch {
        btn.textContent = "Error";
        setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
      }
    }

    function escHtml(s) {
      return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    refreshXSocial();

    // Delegated click handler for X Social and Students buttons.
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".x-social-btn");
      if (!btn) return;
      const action = btn.dataset.action;
      const teacherId = btn.dataset.teacher;
      if (action === "connect") connectX(teacherId);
      else if (action === "disconnect") disconnectX(teacherId);
      else if (action === "post") postX(teacherId, btn);
      else if (action === "telegram-save") saveTelegramConfig();
      else if (action === "telegram-post") postTelegramSnapshot();
      else if (action === "class-photo") postClassPhoto(btn);
      else if (action === "class-photo-history") showClassPhotoHistory();
      else if (action === "refresh-students") refreshStudents();
    });
  </script>
</body>
</html>`;
}
// cache bust 1780230737
