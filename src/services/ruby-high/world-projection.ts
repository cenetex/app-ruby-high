import { createHash } from "node:crypto";
import type {
  CharacterStats,
  ComicPageUnlockReason,
  Grade,
  MashAxis,
  MashTickReason,
  SchoolEvent,
} from "../../types.js";
import { GRADES } from "../../types.js";

const COMIC_PAGE_UNLOCK_REASONS: readonly ComicPageUnlockReason[] = [
  "teacher-class-aced",
  "teacher-year-completed",
  "student-befriended",
  "legacy",
];
const MASH_TICK_REASONS: readonly MashTickReason[] = [
  "best-responder",
  "applauder",
  "rub",
  "pep-talk",
];
const MASH_AXES: readonly MashAxis[] = [
  "crush",
  "job",
  "lives",
  "pet",
  "money",
  "lucky",
];

export interface PublicWorldStudent {
  name: string;
  playbookId: string;
  grade: Grade;
  stats: CharacterStats;
  classGrades: Record<string, string>;
  yearbookCount: number;
  lastActive: number;
  portraitUrl?: string;
}

export interface PublicWorldRoomGoal {
  kind: "live-class";
  label: string;
  progress: number;
  target: number;
  complete: boolean;
  updatedAt: number;
  ruleLabel?: string;
}

export interface PublicWorldRoom {
  grade: Grade;
  facultyId: string;
  displayName: string;
  activeStudents: number;
  goal: PublicWorldRoomGoal;
  students: PublicWorldStudent[];
}

export interface PublicWorldPresenceEntry {
  sessionId: string;
  grade: Grade;
  facultyId: string;
  displayName: string;
  name: string;
  playbookId: string;
  stats: CharacterStats;
  classGrades: Record<string, string>;
  yearbookCount: number;
  lastActive: number;
  portraitUrl?: string;
}

export interface PublicWorldRoomGoalContribution {
  grade: Grade;
  facultyId: string;
  amount: number;
  target?: number;
  updatedAt: number;
  ruleLabel?: string;
}

export interface PublicWorldRoomBuildResult {
  activeStudents: number;
  activeRooms: PublicWorldRoom[];
  publicSessionIds: Set<string>;
}

export interface PublicWorldNameReview {
  ok: boolean;
  displayName: string;
  reason: "empty" | "reserved" | "contact" | "unsafe" | null;
}

export type PublicWorldEvent =
  | {
      id: string;
      kind: "room.goal-progress";
      at: number;
      faculty?: string;
      grade: Grade | null;
      roomTitle: string;
      goalKind: PublicWorldRoomGoal["kind"];
      progress: number;
      target: number;
      complete: boolean;
      label: string;
      ruleLabel?: string;
      rewardLabel?: string;
    }
  | {
      id: string;
      kind: "relationship.ticked";
      at: number;
      faculty?: string;
      grade: Grade | null;
      studentId: string;
      delta: -1 | 0 | 1;
      reason: MashTickReason;
      affinity: number;
      circled: boolean;
      scratched: boolean;
    }
  | {
      id: string;
      kind: "mash.axis-resolved";
      at: number;
      faculty?: string;
      grade: Grade | null;
      studentId: string;
      axis: MashAxis;
      value: string;
    }
  | {
      id: string;
      kind: "comic.page-unlocked";
      at: number;
      faculty?: string;
      grade: Grade | null;
      issueId: string;
      pageId: string;
      pageNumber: number;
      reason: ComicPageUnlockReason;
      label: string;
    };

export function publicWorldPortraitUrl(raw: string | null | undefined): string | undefined {
  const value = String(raw ?? "").trim();
  if (!value || value.startsWith("//") || /[\r\n]/.test(value)) return undefined;
  if (value.startsWith("/")) return value;
  return undefined;
}

function publicWorldText(raw: string | null | undefined, fallback: string, maxLength: number): string {
  const value = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const label = value || fallback;
  if (label.length <= maxLength) return label;
  return `${label.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function publicWorldDisplayName(raw: string | null | undefined, fallback = "Student"): string {
  return publicWorldText(raw, fallback, 48);
}

export function publicWorldNameReview(raw: string | null | undefined): PublicWorldNameReview {
  const displayName = publicWorldDisplayName(raw, "");
  const folded = displayName.toLowerCase();
  if (!displayName) return { ok: false, displayName, reason: "empty" };
  if (/^(admin|administrator|moderator|mod|ruby high|support|staff|teacher|principal)$/i.test(displayName)) {
    return { ok: false, displayName, reason: "reserved" };
  }
  if (/@/.test(displayName) || /\b(?:https?:\/\/|www\.)/i.test(displayName)) {
    return { ok: false, displayName, reason: "contact" };
  }
  if (/\b(?:fuck|shit|bitch|cunt|dick|pussy|slut|whore|nazi)\b/i.test(folded)) {
    return { ok: false, displayName, reason: "unsafe" };
  }
  return { ok: true, displayName, reason: null };
}

export function publicWorldPlaybookId(raw: string | null | undefined): string {
  return publicWorldText(raw, "student", 64);
}

export function publicWorldEventLabel(raw: string | null | undefined, fallback = "School world changed"): string {
  return publicWorldText(raw, fallback, 96);
}

function publicWorldEventIdFragment(raw: string | null | undefined, fallback: string): string {
  return publicWorldText(raw, fallback, 64);
}

export function publicWorldRoomId(raw: string | null | undefined): string {
  return publicWorldText(raw, "class", 64);
}

export function publicWorldEventFaculty(raw: string | null | undefined): string | undefined {
  const value = publicWorldText(raw, "", 64);
  return value || undefined;
}

export function publicWorldRoomDisplayName(raw: string | null | undefined, fallback = "Class"): string {
  return publicWorldText(raw, fallback, 48);
}

export function publicWorldSessionId(raw: string | null | undefined): string | undefined {
  const value = String(raw ?? "").trim();
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

export function publicWorldGrade(raw: unknown, fallback: Grade | null = "9"): Grade | null {
  return typeof raw === "string" && (GRADES as string[]).includes(raw) ? raw as Grade : fallback;
}

function publicWorldNonNegativeInteger(raw: unknown): number {
  return Math.max(0, publicWorldInteger(raw));
}

function publicWorldInteger(raw: unknown): number {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) ? value : 0;
}

function publicWorldRelationshipDelta(raw: unknown): -1 | 0 | 1 {
  return raw === -1 || raw === 0 || raw === 1 ? raw : 0;
}

function publicWorldRoomGoalFor(room: Pick<PublicWorldRoom, "grade" | "displayName" | "activeStudents" | "students">): PublicWorldRoomGoal {
  const target = 3;
  const progress = Math.min(target, publicWorldNonNegativeInteger(room.activeStudents));
  const updatedAt = room.students.reduce((max, student) => Math.max(max, publicWorldNonNegativeInteger(student.lastActive)), 0);
  const roomName = publicWorldRoomDisplayName(room.displayName, "Class");
  return {
    kind: "live-class",
    label: `${roomName} live class ${progress}/${target}`,
    progress,
    target,
    complete: progress >= target,
    updatedAt,
  };
}

function publicWorldComicUnlockReason(raw: unknown): ComicPageUnlockReason {
  return COMIC_PAGE_UNLOCK_REASONS.includes(raw as ComicPageUnlockReason) ? raw as ComicPageUnlockReason : "legacy";
}

function publicWorldMashTickReason(raw: unknown): MashTickReason {
  return MASH_TICK_REASONS.includes(raw as MashTickReason) ? raw as MashTickReason : "pep-talk";
}

function publicWorldMashAxis(raw: unknown): MashAxis {
  return MASH_AXES.includes(raw as MashAxis) ? raw as MashAxis : "lucky";
}

function publicWorldStats(stats: unknown): CharacterStats {
  const source = stats && typeof stats === "object" ? stats as Partial<CharacterStats> : {};
  return {
    head: publicWorldNonNegativeInteger(source.head),
    heart: publicWorldNonNegativeInteger(source.heart),
    hustle: publicWorldNonNegativeInteger(source.hustle),
    honor: publicWorldNonNegativeInteger(source.honor),
  };
}

function publicWorldClassGrades(classGrades: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!classGrades || typeof classGrades !== "object" || Array.isArray(classGrades)) return out;
  for (const [key, value] of Object.entries(classGrades)) {
    const cleanKey = publicWorldText(key, "", 48);
    const cleanValue = publicWorldText(typeof value === "string" ? value : "", "", 8);
    if (cleanKey && cleanValue) out[cleanKey] = cleanValue;
  }
  return out;
}

export function publicWorldStudentFromPresence(entry: PublicWorldPresenceEntry): PublicWorldStudent {
  const portraitUrl = publicWorldPortraitUrl(entry.portraitUrl);
  return {
    name: publicWorldDisplayName(entry.name),
    playbookId: publicWorldPlaybookId(entry.playbookId),
    grade: publicWorldGrade(entry.grade, "9") ?? "9",
    stats: publicWorldStats(entry.stats),
    classGrades: publicWorldClassGrades(entry.classGrades),
    yearbookCount: publicWorldNonNegativeInteger(entry.yearbookCount),
    lastActive: publicWorldNonNegativeInteger(entry.lastActive),
    ...(portraitUrl ? { portraitUrl } : {}),
  };
}

export function buildPublicWorldRooms(
  entries: Iterable<PublicWorldPresenceEntry>,
  maxStudentsPerRoom = 5,
  maxRooms = 24,
  goalContributions: Iterable<PublicWorldRoomGoalContribution> = [],
): PublicWorldRoomBuildResult {
  const roomRows = new Map<string, PublicWorldRoom>();
  const publicSessionIds = new Set<string>();
  const studentLimit = Math.max(0, Math.floor(Number(maxStudentsPerRoom) || 0));
  const roomLimit = Math.max(0, Math.floor(Number(maxRooms) || 0));
  for (const entry of entries) {
    const publicSessionId = publicWorldSessionId(entry.sessionId);
    if (!publicSessionId) continue;
    publicSessionIds.add(publicSessionId);
    const grade = publicWorldGrade(entry.grade, "9") ?? "9";
    const facultyId = publicWorldRoomId(entry.facultyId);
    const displayName = publicWorldRoomDisplayName(entry.displayName, facultyId);
    const key = `${grade}:${facultyId}`;
    let room = roomRows.get(key);
    if (!room) {
      room = {
        grade,
        facultyId,
        displayName,
        activeStudents: 0,
        goal: {
          kind: "live-class",
          label: `${displayName} live class 0/3`,
          progress: 0,
          target: 3,
          complete: false,
          updatedAt: 0,
        },
        students: [],
      };
      roomRows.set(key, room);
    }
    room.activeStudents += 1;
    room.students.push(publicWorldStudentFromPresence(entry));
    room.students.sort((a, b) =>
      b.lastActive - a.lastActive ||
      b.yearbookCount - a.yearbookCount ||
      a.name.localeCompare(b.name) ||
      a.playbookId.localeCompare(b.playbookId)
    );
    room.goal = publicWorldRoomGoalFor(room);
    if (room.students.length > studentLimit) room.students.length = studentLimit;
  }
  for (const contribution of goalContributions) {
    const grade = publicWorldGrade(contribution.grade, "9") ?? "9";
    const facultyId = publicWorldRoomId(contribution.facultyId);
    const room = roomRows.get(`${grade}:${facultyId}`);
    if (!room) continue;
    const target = Math.max(1, publicWorldNonNegativeInteger(contribution.target) || publicWorldNonNegativeInteger(room.goal.target));
    const progress = Math.min(target, publicWorldNonNegativeInteger(contribution.amount));
    const updatedAt = publicWorldNonNegativeInteger(contribution.updatedAt);
    const roomName = publicWorldRoomDisplayName(room.displayName, "Class");
    const ruleLabel = publicWorldText(contribution.ruleLabel, "", 80);
    room.goal = {
      kind: "live-class",
      label: `${roomName} live class ${progress}/${target}${ruleLabel ? ` · ${ruleLabel}` : ""}`,
      progress,
      target,
      complete: progress >= target,
      updatedAt,
      ...(ruleLabel ? { ruleLabel } : {}),
    };
  }
  const sortedRooms = Array.from(roomRows.values()).sort((a, b) =>
    Number(a.grade) - Number(b.grade) ||
    b.activeStudents - a.activeStudents ||
    a.displayName.localeCompare(b.displayName) ||
    a.facultyId.localeCompare(b.facultyId)
  );
  return {
    activeStudents: sortedRooms.reduce((sum, room) => sum + room.activeStudents, 0),
    activeRooms: sortedRooms.slice(0, roomLimit),
    publicSessionIds,
  };
}

export function buildPublicWorldCohorts(
  students: Iterable<PublicWorldPresenceEntry>,
): Record<string, PublicWorldStudent[]> {
  const cohorts: Record<string, PublicWorldStudent[]> = {};
  for (const student of students) {
    if (!publicWorldSessionId(student.sessionId)) continue;
    const grade = publicWorldGrade(student.grade, "9") ?? "9";
    if (!cohorts[grade]) cohorts[grade] = [];
    cohorts[grade]!.push(publicWorldStudentFromPresence({ ...student, grade }));
  }
  return cohorts;
}

export function publicSchoolWorldEvent(event: SchoolEvent): PublicWorldEvent {
  const publicId = publicSchoolWorldEventId(event);
  const at = publicWorldNonNegativeInteger(event.at);
  const faculty = publicWorldEventFaculty(event.faculty);
  if (event.kind === "relationship.ticked") {
    return {
      id: publicId,
      kind: event.kind,
      at,
      ...(faculty ? { faculty } : {}),
      grade: publicWorldGrade(event.grade, null),
      studentId: publicSchoolWorldActorId(event.studentId),
      delta: publicWorldRelationshipDelta(event.delta),
      reason: publicWorldMashTickReason(event.reason),
      affinity: publicWorldInteger(event.affinity),
      circled: event.circled === true,
      scratched: event.scratched === true,
    };
  }
  if (event.kind === "mash.axis-resolved") {
    return {
      id: publicId,
      kind: event.kind,
      at,
      ...(faculty ? { faculty } : {}),
      grade: publicWorldGrade(event.grade, null),
      studentId: publicSchoolWorldActorId(event.studentId),
      axis: publicWorldMashAxis(event.axis),
      value: publicWorldEventLabel(event.value, "Classmate detail"),
    };
  }
  return {
    id: publicId,
    kind: event.kind,
    at,
    ...(faculty ? { faculty } : {}),
    grade: publicWorldGrade(event.grade, null),
    issueId: publicWorldEventIdFragment(event.issueId, "comic"),
    pageId: publicWorldEventIdFragment(event.pageId, "page"),
    pageNumber: publicWorldNonNegativeInteger(event.pageNumber),
    reason: publicWorldComicUnlockReason(event.reason),
    label: publicWorldEventLabel(event.label, "Comic page unlocked"),
  };
}

export function publicWorldRoomGoalEvents(rooms: readonly PublicWorldRoom[]): PublicWorldEvent[] {
  return rooms
    .filter((room) => room.goal.progress > 0 && room.goal.updatedAt > 0)
    .map((room) => {
      const faculty = publicWorldEventFaculty(room.facultyId);
      const roomTitle = publicWorldEventLabel(`${room.displayName} room`, "Class room");
      const label = publicWorldEventLabel(room.goal.complete
        ? `${room.displayName} filled a live class goal`
        : `${room.displayName} live class is ${room.goal.progress}/${room.goal.target}`);
      const rewardLabel = room.goal.complete
        ? publicWorldEventLabel(`${room.displayName} earned a class-wide Study Spark`, "Class reward unlocked")
        : "";
      const event = {
        kind: "room.goal-progress" as const,
        at: publicWorldNonNegativeInteger(room.goal.updatedAt),
        grade: publicWorldGrade(room.grade, null),
        ...(faculty ? { faculty } : {}),
        roomTitle,
        goalKind: room.goal.kind,
        progress: publicWorldNonNegativeInteger(room.goal.progress),
        target: Math.max(1, publicWorldNonNegativeInteger(room.goal.target)),
        complete: room.goal.complete === true,
        label,
        ...(room.goal.ruleLabel ? { ruleLabel: publicWorldEventLabel(room.goal.ruleLabel, "Room rule") } : {}),
        ...(rewardLabel ? { rewardLabel } : {}),
      };
      return {
        id: publicWorldRoomGoalEventId(event),
        ...event,
      };
    });
}

function publicWorldRoomGoalEventId(event: Omit<Extract<PublicWorldEvent, { kind: "room.goal-progress" }>, "id">): string {
  const hash = createHash("sha256")
    .update(`${event.kind}:${event.at}:${event.grade ?? ""}:${event.faculty ?? ""}:${event.progress}:${event.target}`)
    .digest("hex")
    .slice(0, 16);
  return `world:event:${hash}`;
}

export function publicSchoolWorldEventId(event: SchoolEvent): string {
  const hash = createHash("sha256")
    .update(`${event.kind}:${publicWorldNonNegativeInteger(event.at)}:${event.id}`)
    .digest("hex")
    .slice(0, 16);
  return `world:event:${hash}`;
}

export function publicSchoolWorldActorId(studentId: string): string {
  const hash = createHash("sha256")
    .update(`world:actor:${studentId}`)
    .digest("hex")
    .slice(0, 12);
  return `world:actor:${hash}`;
}
