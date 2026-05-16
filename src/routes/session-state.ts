import type {
  IAgentRuntime,
  PluginAppSessionState,
} from "@elizaos/core";
import {
  RubyHighService,
  advantageRollsForState,
  dailyStatusForState,
  type CourseProgress,
} from "../services/ruby-high-service.js";
import { FacultyService, toFacultyMember } from "../services/faculty-service.js";
import {
  type CharacterStats,
  type Choice,
  type Difficulty,
  type EssayReport,
  type FacultyMember,
  type Grade,
  type NpcStudentState,
  type PlayerCharacter,
  type QuizState,
  type RubyHighWallet,
  type StudentPoolEntry,
} from "../types.js";
import { PLAYBOOKS } from "../characters/playbooks.js";
import { getSessionId, tryGetService } from "../services/session-identity.js";
import {
  availablePacksForSession,
  courseForFacultyForSession,
  coursesForSession,
  facultyForSession,
  packForSession,
  roomsForSession,
  roomsWithLoungeForSession,
} from "../content/registry.js";
import type { PackCourse, PackRoom } from "../content/types.js";
import { publicProviderForFaculty, type PublicTeacherProvider } from "../services/teacher-providers.js";
import {
  hostedEntitlementStatus,
  type HostedEntitlementStatus,
} from "../hosted-entitlements.js";
import { APP_DISPLAY_NAME, APP_NAME } from "./constants.js";

interface FacultyTelemetry extends FacultyMember {
  questionCount: number;
  subjects: string[];
  assetTeacherId?: string;
  profileImageUrl?: string;
  teacherProvider: PublicTeacherProvider;
  courseGrade?: string;
  completedClasses?: number;
  requiredClasses?: number;
  averageScore?: number;
  todayClass?: CourseProgress["today"];
  readyCount?: number;
  masteredCount?: number;
  learningCount?: number;
  shakyCount?: number;
  newCount?: number;
}

interface SessionTelemetry extends Record<string, unknown> {
  faculty: string;
  facultyDisplayName: string;
  facultyAccent: string;
  subject: string | null;
  difficulty: Difficulty | null;
  scoreCorrect: number;
  scoreTotal: number;
  scorePoints: number;
  scorePossible: number;
  meritStars: number;
  hallPasses: number;
  wallet: RubyHighWallet;
  hosted_ai: HostedEntitlementStatus["hosted_ai"];
  entitlements: HostedEntitlementStatus;
  status: QuizState["status"];
  phase: QuizState["phase"];
  phaseToken: number;
  current: {
    id: string;
    prompt: string;
    type: "multiple-choice" | "typed-answer" | "image-occlusion" | "opinion";
    options: Record<Choice, string>;
    subject: string | null;
    stat: keyof CharacterStats | null;
    difficulty: Difficulty | null;
    sourceCardId: string | null;
    canGenerateMc: boolean;
    media: Array<{ name: string; mimeType: string; dataUrl: string }>;
  } | null;
  lastReveal: QuizState["lastReveal"];
  faculty_roster: FacultyTelemetry[];
  asked_count: number;
  store_path: string | null;
  current_grade: Grade | null;
  completed_grades: Grade[];
  has_seen_intro: boolean;
  active_pack: { id: string; name: string; description: string };
  active_teacher_provider: PublicTeacherProvider;
  active_course: PackCourse | null;
  active_course_progress: CourseProgress | null;
  courses: PackCourse[];
  available_packs: Array<{
    id: string;
    name: string;
    description: string;
    faculty_count: number;
    question_count: number;
  }>;
  rooms: PackRoom[];
  room_cohort: Record<string, string[]>;
  npc_roster: NpcStudentState[];
  active_round: ReturnType<typeof deriveActiveRound>;
  is_opinion: boolean;
  character: PlayerCharacter | null;
  student_pool: StudentPoolEntry[];
  comic_collection: QuizState["comicCollection"];
  school_events: QuizState["schoolEvents"];
  essay_reports: EssayReport[];
  playbooks: typeof PLAYBOOKS;
  npc_cohort: Array<{
    id: string;
    grade: Grade;
    streak: { grade: Grade; count: number };
    completedGrades: Grade[];
    graduated: boolean;
  }>;
  mentor_offer: PlayerCharacter["inheritedFrom"] | null;
  daily: {
    available: boolean;
    reason?: "completed" | "no-grade" | "no-character";
    facultyId: string;
    dailyKey: string;
  };
  advantage_rolls: { used: number; cap: number; remaining: number };
  graduation_ready: PlayerCharacter["pendingGraduation"] | null;
}

export function getCharacterName(runtime: IAgentRuntime | null): string {
  const character = (runtime as { character?: { name?: string } } | null)?.character;
  return character?.name ?? "Ruby";
}

function facultyForState(state: QuizState, id: string): FacultyMember {
  const pack = facultyForSession(state);
  const hit = pack.find((f) => f.id === id) ?? pack[0];
  if (!hit) throw new Error("Active pack has no faculty - cannot resolve facultyForState.");
  return toFacultyMember(hit);
}

function deriveActiveRound(state: QuizState) {
  const round = state.activeRound;
  if (!round) return null;
  const now = Date.now();
  const elapsedMs = Math.max(0, now - round.startedAt);
  const remainingMs = Math.max(0, round.expiresAt - now);
  const reveal = round.resolved;
  const isOpinion = round.type === "opinion";
  return {
    type: round.type,
    questionId: round.questionId,
    rarity: round.rarity ?? state.current?.rarity,
    stat: round.stat ?? state.current?.stat,
    isBonus: !!round.isBonus,
    classSession: round.classSession,
    cardRole: round.cardRole ?? (round.classSession?.mode === "class" ? "class" : isOpinion ? "social" : "practice"),
    startedAt: round.startedAt,
    durationMs: round.durationMs,
    expiresAt: round.expiresAt,
    elapsedMs,
    remainingMs,
    npcs: round.npcs.map((n) => {
      const isLocked = n.answeredAt != null;
      return {
        studentId: n.studentId,
        delayMs: n.delayMs,
        answeredAt: n.answeredAt,
        isLocked,
        pick: !isOpinion && reveal && isLocked ? n.plannedPick : null,
        isCorrect: !isOpinion && reveal && isLocked && state.current ? n.plannedPick === state.current.correct : null,
      };
    }),
    player: {
      picked: !isOpinion && reveal && !state.lastReveal?.forfeit ? round.player.picked : null,
      answerText: reveal ? round.player.answerText ?? null : null,
      answeredAt: round.player.answeredAt,
      isLocked: round.player.answeredAt != null || (!isOpinion && reveal && !!state.lastReveal?.forfeit),
      timedOut: !isOpinion && reveal && !!state.lastReveal?.forfeit,
    },
    resolved: round.resolved,
    idleTriggered: !!round.idleTriggered,
    firstCorrect: !isOpinion && reveal ? round.firstCorrect : null,
    opinionResponses: round.opinionResponses,
    opinionGrades: round.opinionGrades,
    bestResponder: round.bestResponder,
    advantage: round.advantage
      ? {
          rolled: round.advantage.rolled,
          stat: round.advantage.stat,
          dice: round.advantage.dice,
          total: round.advantage.total,
          outcome: round.advantage.outcome,
          eliminated: round.advantage.eliminated,
        }
      : null,
  };
}

function deriveRoomCohort(roster: NpcStudentState[], state: QuizState): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const room of roomsForSession(state)) {
    if (room.teaches) out[room.id] = [];
  }
  for (const npc of roster) {
    if (!npcIsSeatedWithPlayer(state, npc.id)) continue;
    if (npc.currentRoom && out[npc.currentRoom]) out[npc.currentRoom]!.push(npc.id);
  }
  return out;
}

function npcIsSeatedWithPlayer(state: QuizState, studentId: string): boolean {
  const grade = state.currentGrade;
  if (!grade) return true;
  const arc = state.npcCohort?.find((n) => n.id === studentId);
  if (!arc) return true;
  return !arc.graduated && arc.grade === grade;
}

function buildFacultyRoster(
  faculty: FacultyService | null,
  state: QuizState,
  ruby: RubyHighService | null,
  sessionId: string,
): FacultyTelemetry[] {
  const pack = packForSession(state);
  const countFacultyCards = (f: typeof pack.faculty[number]) =>
    (f.sourceCards?.length ?? 0) + f.questions.filter((q) => !q.sourceCardId).length;
  return facultyForSession(state).map((f) => {
    const bank = faculty?.bank(f.id, pack);
    const progress = ruby?.courseProgress(sessionId, f.id) ?? null;
    const subjects = Array.from(new Set([
      ...(bank ? bank.questions.map((q) => q.subject) : []),
      ...(f.sourceCards ?? []).map((card) => card.subject),
      ...f.subjects,
    ].filter(Boolean))).sort();
    return {
      id: f.id,
      displayName: f.displayName,
      shortName: f.shortName,
      bio: f.bio,
      available: true,
      accent: f.accent,
      ...(f.assetTeacherId ? { assetTeacherId: f.assetTeacherId } : {}),
      ...(f.profileImageUrl ? { profileImageUrl: f.profileImageUrl } : {}),
      ...(f.stats ? { stats: f.stats } : {}),
      teacherProvider: publicProviderForFaculty(f),
      questionCount: countFacultyCards(f),
      ...(progress?.grade ? { courseGrade: progress.grade } : {}),
      ...(progress ? {
        completedClasses: progress.completedClasses,
        requiredClasses: progress.requiredClasses,
        ...(progress.averageScore != null ? { averageScore: progress.averageScore } : {}),
        todayClass: progress.today,
        readyCount: progress.ready,
        masteredCount: progress.mastered,
        learningCount: progress.learning,
        shakyCount: progress.shaky,
        newCount: progress.new,
      } : {}),
      subjects,
    };
  });
}

export function buildSessionState(args: {
  runtime: IAgentRuntime | null;
  state: QuizState;
  faculty: FacultyService | null;
  cookieHeader?: string | null;
}): PluginAppSessionState {
  const { runtime, state, faculty } = args;
  const sessionId = getSessionId(runtime, args.cookieHeader);
  const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
  const fac = facultyForState(state, state.faculty);
  const activePackFaculty = facultyForSession(state).find((f) => f.id === state.faculty)
    ?? facultyForSession(state)[0]
    ?? null;
  const wallet = normalizeWalletForTelemetry(state);
  const entitlements = hostedEntitlementStatus({ ruby, sessionId, state });

  const telemetry: SessionTelemetry = {
    faculty: state.faculty,
    facultyDisplayName: fac.displayName,
    facultyAccent: fac.accent,
    subject: state.subject,
    difficulty: state.current?.difficulty ?? null,
    scoreCorrect: state.score.correct,
    scoreTotal: state.score.total,
    scorePoints: state.score.points ?? 0,
    scorePossible: state.score.possible ?? 0,
    meritStars: wallet.meritStars,
    hallPasses: wallet.hallPasses,
    wallet,
    hosted_ai: entitlements.hosted_ai,
    entitlements,
    status: state.status,
    phase: state.phase,
    phaseToken: state.phaseToken,
    current: state.current
      ? {
          id: state.current.id,
          prompt: state.current.prompt,
          type: state.current.type ?? "multiple-choice",
          options: (state.current.options ?? { A: "", B: "", C: "", D: "" }) as Record<Choice, string>,
          subject: state.current.subject ?? null,
          stat: state.current.stat ?? null,
          difficulty: state.current.difficulty ?? null,
          sourceCardId: state.current.sourceCardId ?? null,
          canGenerateMc: !!state.current.canGenerateMc,
          media: state.current.media ?? [],
        }
      : null,
    lastReveal: state.lastReveal,
    faculty_roster: buildFacultyRoster(faculty, state, ruby, sessionId),
    asked_count: state.askedQuestionIds.length,
    store_path: null,
    current_grade: state.currentGrade,
    completed_grades: state.completedGrades,
    has_seen_intro: state.hasSeenIntro,
    active_pack: (() => {
      const p = packForSession(state);
      return { id: p.id, name: p.name, description: p.description };
    })(),
    active_teacher_provider: publicProviderForFaculty(activePackFaculty),
    active_course: courseForFacultyForSession(state, state.faculty),
    active_course_progress: ruby?.courseProgress(sessionId, state.faculty) ?? null,
    courses: coursesForSession(state),
    available_packs: availablePacksForSession(sessionId).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      faculty_count: p.faculty.length,
      question_count: p.faculty.reduce((s, f) =>
        s + (f.sourceCards?.length ?? 0) + f.questions.filter((q) => !q.sourceCardId).length, 0),
    })),
    rooms: roomsWithLoungeForSession(state),
    npc_roster: state.currentGrade ? (state.npcRosters[state.currentGrade] ?? []) : [],
    room_cohort: state.currentGrade
      ? deriveRoomCohort(state.npcRosters[state.currentGrade] ?? [], state)
      : {},
    active_round: deriveActiveRound(state),
    is_opinion: state.current?.type === "opinion",
    character: state.character,
    student_pool: state.studentPool ?? [],
    comic_collection: state.comicCollection,
    school_events: (state.schoolEvents ?? []).slice(-30),
    essay_reports: (state.essayReports ?? []).slice(-30),
    playbooks: PLAYBOOKS,
    daily: dailyStatusForState(state),
    npc_cohort: state.npcCohort ?? [],
    mentor_offer: state.mentorOffer ?? null,
    advantage_rolls: advantageRollsForState(state),
    graduation_ready: state.character?.pendingGraduation ?? null,
  };

  const summary = state.current
    ? `${fac.displayName} · ${state.current.subject ?? "open"} · ${state.current.difficulty ?? "?"} · awaiting answer`
    : `${fac.displayName} on the floor · ${state.score.correct}/${state.score.total} · ${wallet.meritStars} Merit Stars`;

  const suggested = state.current
    ? [
        "Wait for the student to pick A, B, C, or D.",
        "Riff in character while they think.",
        "If they're stuck, narrow it down without giving the answer.",
      ]
    : [
        "Pick the next question with PICK_QUESTION (filter by subject or difficulty).",
        "Hand off with HANDOFF_FACULTY when the topic shifts.",
        "Stay in character — Ruby is the host, faculty are the experts.",
      ];

  return {
    sessionId,
    appName: APP_NAME,
    mode: "spectate-and-steer",
    status: "running",
    displayName: APP_DISPLAY_NAME,
    agentId: (runtime as { agentId?: string } | null)?.agentId,
    canSendCommands: true,
    controls: ["pause", "resume"],
    summary,
    goalLabel: state.subject ? `Ruby High · ${state.subject}` : "Ruby High",
    suggestedPrompts: suggested,
    telemetry: telemetry as PluginAppSessionState["telemetry"],
  };
}

function normalizeWalletForTelemetry(state: QuizState): RubyHighWallet {
  return {
    meritStars: Math.max(0, Math.floor(Number(state.wallet?.meritStars ?? state.score.points ?? 0))),
    hallPasses: Math.max(0, Math.floor(Number(state.wallet?.hallPasses ?? 0))),
    ...(Number.isFinite(Number(state.wallet?.hostedAiAccessExpiresAt))
      ? { hostedAiAccessExpiresAt: Math.max(0, Math.floor(Number(state.wallet?.hostedAiAccessExpiresAt))) }
      : {}),
  };
}
