// Pure helpers + constants for the inline viewer client.
// Each export is stringified into the inline <script> IIFE by
// viewer-parts/script.ts so it ends up as a sibling of runViewerClient.
// "Pure" here means: no closures over runViewerClient's outer state
// (lastTelemetry, els, authed, etc.). Helpers that take state via
// parameter are fine. Helpers may freely reference other helpers or
// VIEWER_CONSTANTS — both are in the same IIFE scope at runtime.

type LooseRecord = Record<string, any>;
type NullableRecord = LooseRecord | null | undefined;
type MarkdownRenderOptions = { inline?: boolean };
type LegacyCryptoWindow = Window & { msCrypto?: Crypto };
type WorldFeedEvent = LooseRecord & { id?: unknown; at?: unknown };
type WorldFeedRoomView = { title: string; meta: string };
type WorldFeedEventView = { id?: string; label: string; age: string };
type QuestionPromptImageView = { src: string; alt: string };
type LeaderboardGradeChipView = { className: string; text: string };
type LeaderboardRowView = {
  rank: string;
  rankClass: string;
  name: string;
  portraitUrl: string;
  avatarText: string;
  playbookName: string;
  gradeChips: LeaderboardGradeChipView[];
};
type RaceStripCardView = {
  kind: "player" | "student";
  id: string;
  name: string;
  avatarText: string;
  color: string;
  isLocked: boolean;
  isTimedOut: boolean;
  isCorrect: boolean | null;
  isFirstCorrect: boolean;
  pickText: string;
  showThinking: boolean;
};
type ArcIndicatorView = {
  hidden: boolean;
  graduated: boolean;
  yearText: string;
  streakText: string;
  streakMet: boolean;
  subjectText: string;
  subjectMet: boolean;
  scoreText: string;
};
export type AccountPublicWorldView = {
  hasCharacter: boolean;
  hasPublicName: boolean;
  blockedBySocialConsent: boolean;
  visible: boolean;
  summaryText: string;
  statusText: string;
  statusClass: string;
  toggleText: string;
  toggleDisabled: boolean;
  toggleTitle: string;
  nextVisible: boolean;
};
type ClassmateArcProgress = { value: number; total: number };
type RoomCompletionProgress = { value: number; total: number };
export type RoomChannelStudentView = { id: string; name: string };
export type RoomChannelRowView = {
  roomId: string;
  facultyId: string;
  channelName: string;
  isActive: boolean;
  completionProgress: RoomCompletionProgress | null;
  completionLabel: string;
  students: RoomChannelStudentView[];
};

export const VIEWER_CONSTANTS = {
  VISITOR_ID_KEY: "ruby-high:visitor-id",
  GRADE_LABELS: { "9": "Freshman", "10": "Sophomore", "11": "Junior", "12": "Senior" },
  GRADE_SHORT_LABELS: { "9": "Fresh", "10": "Soph", "11": "Junior", "12": "Senior" },
  GRADE_ORDER: ["9", "10", "11", "12"],
  WALLET_ACTION_TIMEOUT_MS: 120000,
  STREAK_REQUIRED: { "9": 1, "10": 2, "11": 3, "12": 4 },
  TEACHING_FACULTY_IDS: ["ruby", "sally-science", "professor-edward"],
  TEACHING_FACULTY_LABELS: { ruby: "Homeroom", "sally-science": "Science", "professor-edward": "Literature" },
  LOUNGE_ID: "lounge",
  FIRST_BELL_PAGE_COUNT: 12,
  FIRST_BELL_PAGE_TITLES: {
    1: "Ruby High: Book One - First Bell",
    2: "First-Day Survival Kit",
    3: "Release Notes: New Faces on Campus",
    4: "A Normal First Day",
    5: "New School, New People",
    6: "New Rooms, New Faces",
    7: "Lunch Table Theory",
    8: "First Day Debrief",
    9: "End-of-Day Debrief",
    10: "Captain Null: The Star That Cast a Shadow",
    11: "Ruby's Locker Notes",
    12: "Ruby High Student Cards",
  },
  STAT_META: {
    head:   { emoji: "🧠", label: "Head" },
    heart:  { emoji: "💗", label: "Heart" },
    hustle: { emoji: "⚡", label: "Hustle" },
    honor:  { emoji: "🛡️", label: "Honor" },
  },
  HALL_PASS_CARDS_PER_PACK: 5,
} as const;

// ── grading + score formatting ─────────────────────────────────────
export function statLabel(stat: unknown): string {
  const meta = (VIEWER_CONSTANTS.STAT_META as Record<string, { emoji: string; label: string }>)[String(stat || "").toLowerCase()];
  return meta ? meta.emoji + " " + meta.label : "🧠 Head";
}
export function scoreAwardLabel(award: NullableRecord): string {
  if (!award) return "";
  const points = Math.max(0, Math.round(Number(award.points || 0)));
  const mult = Math.max(1, Math.round(Number(award.multiplier || 1)));
  if (mult >= 5) return "+" + points + " Merit Stars · Daily Class ×5";
  return "+" + points + " Merit Stars" + (mult > 1 ? " · ×" + mult : "");
}
export function letterGradePasses(grade: unknown): boolean {
  return /^[ABC]/.test(String(grade || ""));
}
export function letterGradeForScore(score: unknown): string {
  const n = Number(score);
  if (!Number.isFinite(n)) return "—";
  if (n >= 90) return "A";
  if (n >= 80) return "B";
  if (n >= 67) return "C";
  if (n > 0) return "D";
  return "F";
}
export function streakScoreMultiplier(count: unknown): number {
  const n = Math.max(0, Math.floor(Number(count || 0)));
  if (n >= 4) return 5;
  if (n >= 3) return 3;
  if (n >= 2) return 2;
  return 1;
}
export function formatClassScore(score: unknown): string {
  const n = Number(score);
  return Number.isFinite(n) ? Math.round(n) + "%" : "—";
}
export function todayCorrectSummary(today: NullableRecord): { value: string; detail: string; met: boolean } {
  const answered = Math.max(0, Math.floor(Number(today && today.questionCount || 0)));
  const total = Math.max(answered, Math.floor(Number(today && today.totalQuestions || 3)));
  const correct = Math.max(0, Math.min(answered, Math.floor(Number(today && today.correctCount || 0))));
  const answeredText = answered === 1 ? "1 of " + total + " answered" : answered + " of " + total + " answered";
  return {
    value: correct + "/" + answered,
    detail: answered > 0 ? answeredText : "class not started",
    met: answered > 0 && correct === answered,
  };
}

// ── visitor id ─────────────────────────────────────────────────────
export function makeVisitorId(): string {
  const cryptoObj = window.crypto || (window as LegacyCryptoWindow).msCrypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") return "rhv_" + cryptoObj.randomUUID();
  const random = Math.random().toString(36).slice(2, 12);
  return "rhv_" + Date.now().toString(36) + "_" + random;
}
export function getVisitorId(): string {
  try {
    const existing = localStorage.getItem(VIEWER_CONSTANTS.VISITOR_ID_KEY);
    if (existing && /^rhv_[A-Za-z0-9._:-]{4,124}$/.test(existing)) return existing;
    const next = makeVisitorId();
    localStorage.setItem(VIEWER_CONSTANTS.VISITOR_ID_KEY, next);
    return next;
  } catch (_err) {
    return "";
  }
}
export function attachVisitorHeader<T extends Headers>(headers: T): T {
  const visitorId = getVisitorId();
  if (visitorId) headers.set("X-Ruby-High-Visitor", visitorId);
  return headers;
}

// ── subject progress (takes progress object as input) ──────────────
export function teacherShortName(faculty: NullableRecord, fallback?: string): string {
  return (faculty && (faculty.shortName || faculty.displayName)) || fallback || "Teacher";
}
export function earnedCourseGrade(progress: NullableRecord): string {
  if (!progress) return "";
  const grade = progress.courseGrade || progress.grade || "";
  if (!grade || grade === "—") return "";
  const completed = Number(progress.completedClasses || 0);
  const required = Number(progress.requiredClasses || 0);
  if (required > 0 && completed < required) return "";
  return grade;
}
export function subjectProgressShortLabel(progress: NullableRecord): string {
  if (!progress) return "—";
  const required = Math.max(0, Math.floor(Number(progress.requiredClasses || 0)));
  const completed = Math.max(0, Math.floor(Number(progress.completedClasses || 0)));
  if (required > 0) return Math.min(completed, required) + "/" + required;
  return earnedCourseGrade(progress) || "—";
}
export function subjectProgressLongLabel(progress: NullableRecord): string {
  if (!progress) return "course pending";
  const required = Math.max(0, Math.floor(Number(progress.requiredClasses || 0)));
  if (required > 0) return "📚 " + subjectProgressShortLabel(progress);
  return "course pending";
}
export function subjectStandingLabel(progress: NullableRecord): string {
  return earnedCourseGrade(progress) || subjectProgressLongLabel(progress);
}
export function subjectStatusText(progress: NullableRecord): string {
  if (!progress) return "settling in";
  const standing = subjectStandingLabel(progress);
  const done = Number(progress.completedClasses || 0);
  const required = Number(progress.requiredClasses || 0);
  const today = progress.today || {};
  if (today.status === "complete") {
    return "✅ done" + (today.letterGrade ? " · " + today.letterGrade : "") + " · " + standing;
  }
  if (today.status === "active") {
    return questionsLeftText(today) + " · " + standing;
  }
  if (required > 0) return "📚 " + Math.min(done, required) + "/" + required;
  return standing;
}
export function questionsLeftInClass(today: NullableRecord): number {
  const total = Number(today && today.totalQuestions || 3);
  const done = Number(today && today.questionCount || 0);
  return Math.max(0, total - done);
}
export function questionsLeftText(today: NullableRecord): string {
  const left = questionsLeftInClass(today);
  if (left <= 0) return "✅ done";
  return left + " " + (left === 1 ? "question" : "questions") + " left";
}
export function questionsLeftSentence(today: NullableRecord): string {
  const left = questionsLeftInClass(today);
  if (left <= 0) return "Daily class complete";
  return (left === 1 ? "There is " : "There are ") + questionsLeftText(today);
}

// ── number / money / token / duration formatting ───────────────────
export function formatWholeNumber(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
export function formatMoney(cents: unknown, currency?: unknown): string {
  const amount = Number(cents || 0) / 100;
  const code = String(currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(amount);
  } catch (_e) {
    return code + " " + amount.toFixed(2);
  }
}
export function formatTokenAmount(amount: unknown, symbol?: unknown): string {
  const numeric = Number(amount);
  const text = Number.isFinite(numeric)
    ? numeric.toLocaleString(undefined, { maximumFractionDigits: 9 })
    : String(amount || "0");
  return text + " $" + String(symbol || "RUBY").toUpperCase();
}
export function formatTokenDisplayAmount(value: unknown): string {
  const raw = String(value || "").trim();
  const parsed = Number(raw);
  if (!raw) return "?";
  if (!Number.isFinite(parsed) || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return raw;
  if (Number.isInteger(parsed)) return formatWholeNumber(parsed);
  return parsed.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
export function formatDuration(ms: unknown): string {
  const hours = Math.max(1, Math.round(Number(ms || 0) / 3600000));
  if (hours % 24 === 0) {
    const days = Math.max(1, Math.round(hours / 24));
    if (days % 7 === 0) {
      const weeks = Math.max(1, Math.round(days / 7));
      return weeks + " week" + (weeks === 1 ? "" : "s");
    }
    return days + " day" + (days === 1 ? "" : "s");
  }
  return hours + " hour" + (hours === 1 ? "" : "s");
}
export function formatRelativeExpiry(expiresAt: unknown): string {
  const ms = Math.max(0, Number(expiresAt || 0) - Date.now());
  if (ms <= 0) return "";
  const hours = Math.ceil(ms / 3600000);
  if (hours >= 24) return Math.ceil(hours / 24) + "d";
  return hours + "h";
}

// ── short string / number utilities ────────────────────────────────
export function positiveWholeNumber(value: unknown, fallback: number): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
export function hallPassCostLabel(cost: unknown): string {
  const normalized = positiveWholeNumber(cost, 1);
  return formatWholeNumber(normalized) + " Hall Pass" + (normalized === 1 ? "" : "es");
}
export function clipPlayerContext(text: unknown, max?: number): string {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const limit = max || 150;
  return raw.length > limit ? raw.slice(0, limit - 1) + "…" : raw;
}
export function imageRequestId(prefix?: unknown): string {
  const cryptoObj = window.crypto || (window as LegacyCryptoWindow).msCrypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return String(prefix || "image") + "-" + cryptoObj.randomUUID();
  }
  return String(prefix || "image") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
export function shortWallet(address: unknown): string {
  const raw = String(address || "");
  return raw.length > 12 ? raw.slice(0, 6) + "..." + raw.slice(-4) : raw;
}
export function walletPreviewAddress(address: unknown): string {
  const raw = String(address || "").trim();
  return raw ? shortWallet(raw) : "Not connected";
}
export function walletPreviewLine(label: string, value: unknown): string {
  const text = String(value || "").trim();
  return label + ": " + (text || "Unavailable");
}

// ── account public-world visibility ────────────────────────────────
export function accountPublicWorldView(character: unknown, opts?: { authed?: unknown; busy?: unknown }): AccountPublicWorldView {
  const c = character && typeof character === "object" ? character as LooseRecord : null;
  const hasCharacter = !!c;
  const hasPublicName = !!(c && typeof c.name === "string" && c.name.trim());
  const blockedBySocialConsent = !!(c && c.socialConsent === false);
  const visible = !!(c && hasPublicName && !blockedBySocialConsent && c.publicWorldVisible !== false);
  const authed = !!(opts && opts.authed);
  const busy = !!(opts && opts.busy);
  const nextVisible = !visible;
  const summaryText = !hasCharacter
    ? "Create a student before joining the shared school map."
    : visible
    ? "Your active student can appear in public rooms and activity."
    : blockedBySocialConsent
    ? "A legacy privacy setting is hiding this student from public rooms and activity."
    : hasPublicName
    ? "Your active student is hidden from public rooms and activity."
    : "Name your student before they can appear publicly.";
  const toggleTitle = !hasCharacter
    ? "Create a student first"
    : !hasPublicName
    ? "Public world requires a real student name"
    : blockedBySocialConsent
    ? "Legacy social sharing is off, so public world stays hidden"
    : visible
    ? "Hide this student from public rooms and activity"
    : "Allow this student to appear in public rooms and activity";
  return {
    hasCharacter,
    hasPublicName,
    blockedBySocialConsent,
    visible,
    summaryText,
    statusText: visible ? "Visible in the public world" : "Hidden from the public world",
    statusClass: visible ? "is-visible" : "",
    toggleText: visible ? "Hide" : "Show",
    toggleDisabled: !authed || busy || !hasCharacter || !hasPublicName || blockedBySocialConsent,
    toggleTitle,
    nextVisible,
  };
}

// ── date formatters ────────────────────────────────────────────────
export function formatAccountDate(ts: unknown): string {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return "unknown date";
  try {
    return new Date(n).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch (_err) {
    return "unknown date";
  }
}
export function formatSealedDate(ts: unknown): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts as string | number | Date);
    const m = d.toLocaleDateString(undefined, { month: "short" });
    return m + " " + d.getFullYear();
  } catch { return "—"; }
}

// ── ceremony / essay helpers ───────────────────────────────────────
export function nextGradeAfterClient(grade: unknown): string | null {
  const order = ["9", "10", "11", "12"];
  const idx = order.indexOf(String(grade));
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
}
export function fmtStat(n: number): string { return (n >= 0 ? "+" : "") + n; }
export function fmtRewardStat(stat: string, value: number): string {
  return stat.toUpperCase() + " " + fmtStat(value) + " → " + fmtStat(Math.min(3, value + 1));
}
export function seededShuffle<T>(arr: T[], seedInput: unknown): T[] {
  const out = arr.slice();
  let s = (Number(seedInput) | 0) || 1;
  const rand = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
export function hashCeremonySeed(s: string): number {
  let h = 2166136261 | 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
export function essayScoreText(score: unknown): string {
  if (score === null || score === undefined || score === "") return "—";
  const n = Number(score);
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 10) / 10;
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + "/10";
}
export function essayLetter(score: unknown): string {
  const n = Number(score);
  return Number.isFinite(n) ? letterGradeForScore(n * 10) : "—";
}
export function clipEssayText(value: unknown, max: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trim() + "…";
}

// ── public world feed helpers ──────────────────────────────────────
// This is the first typed extraction from the MMO-facing viewer surface.
// Keep replay/cursor/event-list math here so the giant serialized client only
// owns DOM state and rendering.
export const WORLD_FEED_EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizedWorldFeedEventAt(value: unknown): number {
  const at = Number(value || 0);
  return Number.isFinite(at) && at > 0 ? at : 0;
}

export function pruneWorldFeedEventList(events: unknown, now: unknown, maxAgeMs = 7 * 24 * 60 * 60 * 1000): { events: WorldFeedEvent[]; lastEventAt: number } {
  const cutoff = Math.max(0, Number(now || Date.now()) - maxAgeMs);
  const kept = (Array.isArray(events) ? events : [])
    .filter((event): event is WorldFeedEvent => {
      if (!event || typeof event !== "object") return false;
      const at = normalizedWorldFeedEventAt((event as WorldFeedEvent).at);
      return at >= cutoff;
    });
  const lastEventAt = kept.reduce((max, event) => Math.max(max, normalizedWorldFeedEventAt(event.at)), 0);
  return { events: kept, lastEventAt };
}

export function mergeWorldFeedEventList(events: unknown, event: unknown, now: unknown, maxEvents = 8): { events: WorldFeedEvent[]; lastEventAt: number } {
  if (!event || typeof event !== "object" || !(event as WorldFeedEvent).id) {
    return pruneWorldFeedEventList(events, now);
  }
  const normalized = { ...(event as WorldFeedEvent), at: normalizedWorldFeedEventAt((event as WorldFeedEvent).at) };
  const existing = (Array.isArray(events) ? events : []).filter((entry): entry is WorldFeedEvent => (
      !!entry && typeof entry === "object" && (entry as WorldFeedEvent).id !== normalized.id
  ));
  const next = [normalized, ...existing]
    .filter((entry) => entry && entry.id)
    .sort((a, b) => Number(b.at || 0) - Number(a.at || 0) || String(b.id).localeCompare(String(a.id)))
    .slice(0, Math.max(1, Math.floor(Number(maxEvents) || 8)));
  return pruneWorldFeedEventList(next, now);
}

export function worldFeedEventDisplayLabel(event: unknown): string {
  if (!event || typeof event !== "object") return "World event";
  const record = event as WorldFeedEvent;
  if (record.kind === "room.goal-progress" && record.complete && record.rewardLabel) return String(record.rewardLabel);
  if (record.label) return String(record.label);
  if (record.kind === "room.goal-progress") return "Live class progress";
  if (record.kind === "comic.page-unlocked") return "Comic page unlocked";
  if (record.kind === "relationship.ticked") return "Classmate bond shifted";
  if (record.kind === "mash.axis-resolved") return "Classmate profile sharpened";
  return "School world changed";
}

export function worldFeedEventAgeLabel(at: unknown, now: unknown = Date.now()): string {
  const ms = Math.max(0, Number(now || 0) - Number(at || 0));
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return mins + "m";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h";
  return Math.floor(hours / 24) + "d";
}

export function worldFeedGradeLabel(grade: unknown): string {
  const key = String(grade || "");
  const labels = VIEWER_CONSTANTS.GRADE_LABELS as Record<string, string>;
  return labels[key] || (key ? "Grade " + key : "Grade");
}

export function worldFeedFacultyLabel(facultyId: unknown, roster: unknown): string {
  const id = String(facultyId || "");
  const found = (Array.isArray(roster) ? roster : []).find((faculty) => (
    !!faculty && typeof faculty === "object" && (faculty as LooseRecord).id === id
  )) as LooseRecord | undefined;
  return String((found && (found.displayName || found.name)) || id || "Class");
}

export function worldFeedRoomTitle(room: unknown, roster: unknown): string {
  const record = room && typeof room === "object" ? room as LooseRecord : {};
  return worldFeedGradeLabel(record.grade) + " · " + worldFeedFacultyLabel(record.facultyId, roster);
}

export function worldFeedSummaryLabel(activeStudents: unknown, activeRooms: unknown, error?: unknown, summary?: unknown): string {
  if (error) return "World feed paused";
  const students = Math.max(0, Math.floor(Number(activeStudents || 0)));
  const roomCount = Array.isArray(activeRooms) ? activeRooms.length : Math.max(0, Math.floor(Number(activeRooms || 0)));
  const studentText = students === 1 ? "1 student" : students + " students";
  const roomText = roomCount === 1 ? "1 room" : roomCount + " rooms";
  const record = summary && typeof summary === "object" ? summary as LooseRecord : {};
  const sparks = Math.max(0, Math.floor(Number(record.studySparks && typeof record.studySparks === "object" ? (record.studySparks as LooseRecord).total : 0)));
  const sparkText = sparks > 0 ? " · " + sparks + " Study " + (sparks === 1 ? "Spark" : "Sparks") : "";
  return studentText + " live · " + roomText + sparkText;
}

export function worldFeedRoomViews(rooms: unknown, roster: unknown, limit = 5): WorldFeedRoomView[] {
  return (Array.isArray(rooms) ? rooms : [])
    .slice(0, Math.max(0, Math.floor(Number(limit) || 5)))
    .map((room) => {
      const record = room && typeof room === "object" ? room as LooseRecord : {};
      const activeStudents = Math.max(0, Math.floor(Number(record.activeStudents || 0)));
      const goal = record.goal && typeof record.goal === "object" ? record.goal as LooseRecord : null;
      const goalLabel = goal && goal.label ? String(goal.label) : "";
      return {
        title: worldFeedRoomTitle(record, roster),
        meta: goalLabel || (activeStudents === 1 ? "1 student active" : activeStudents + " students active"),
      };
    });
}

export function worldFeedEventViews(events: unknown, now: unknown, limit = 3): WorldFeedEventView[] {
  return (Array.isArray(events) ? events : [])
    .slice(0, Math.max(0, Math.floor(Number(limit) || 3)))
    .map((event) => {
      const record = event && typeof event === "object" ? event as WorldFeedEvent : {};
      const id = typeof record.id === "string" && record.id ? record.id : "";
      const view: WorldFeedEventView = {
        label: worldFeedEventDisplayLabel(event),
        age: worldFeedEventAgeLabel(record.at, now),
      };
      if (id) view.id = id;
      return view;
    });
}

export function worldFeedPanelView(state: unknown, roster: unknown, now: unknown): {
  summary: string;
  rooms: WorldFeedRoomView[];
  events: WorldFeedEventView[];
} {
  const record = state && typeof state === "object" ? state as LooseRecord : {};
  const rooms = Array.isArray(record.activeRooms) ? record.activeRooms : [];
  return {
    summary: worldFeedSummaryLabel(record.activeStudents, rooms, record.error, record.summary),
    rooms: worldFeedRoomViews(rooms, roster, 5),
    events: worldFeedEventViews(record.events, now, 3),
  };
}

export function worldFeedEventsUrl(apiBase: unknown, opts: { force?: boolean; lastEventAt?: unknown; lastCursor?: unknown } = {}): string {
  const force = !!opts.force;
  const since = force ? 0 : Math.max(0, Number(opts.lastEventAt || 0) - 1);
  const cursor = !force && typeof opts.lastCursor === "string" && opts.lastCursor
    ? "&cursor=" + encodeURIComponent(opts.lastCursor)
    : "";
  const sinceQuery = !cursor && since > 0 ? "&since=" + encodeURIComponent(String(since)) : "";
  const liveQuery = force ? "" : "&live=1&streamMs=25000&heartbeatMs=5000";
  return String(apiBase || "") + "/world/events?limit=8" + cursor + sinceQuery + liveQuery;
}

// ── race strip view helpers ─────────────────────────────────────────
export function raceStripView(t: unknown, students: unknown, visibleStudentIds: unknown, playerName: unknown): {
  timer: { label: string; warn: boolean; danger: boolean; locked: boolean };
  cards: RaceStripCardView[];
} | null {
  const telemetry = t && typeof t === "object" ? t as LooseRecord : {};
  const round = telemetry.active_round && typeof telemetry.active_round === "object" ? telemetry.active_round as LooseRecord : null;
  const current = telemetry.current && typeof telemetry.current === "object" ? telemetry.current as LooseRecord : null;
  if (!round || !current || round.questionId !== current.id) return null;
  const remainingS = Math.max(0, Math.ceil(Number(round.remainingMs ?? 0) / 1000));
  const resolved = !!round.resolved;
  const visibleIds = new Set((Array.isArray(visibleStudentIds) ? visibleStudentIds : []).map((id) => String(id)));
  const studentList = Array.isArray(students) ? students : [];
  const studentById = new Map(studentList
    .filter((entry) => entry && typeof entry === "object" && (entry as LooseRecord).id)
    .map((entry) => [String((entry as LooseRecord).id), entry as LooseRecord]));
  const correct = telemetry.lastReveal && typeof telemetry.lastReveal === "object"
    ? String((telemetry.lastReveal as LooseRecord).correct || "")
    : "";
  const player = round.player && typeof round.player === "object" ? round.player as LooseRecord : {};
  const cards: RaceStripCardView[] = [{
    kind: "player",
    id: "player",
    name: String(playerName || "You"),
    avatarText: "U",
    color: "var(--accent)",
    isLocked: !!player.isLocked,
    isTimedOut: !!player.timedOut,
    isCorrect: resolved && player.picked ? String(player.picked) === correct : null,
    isFirstCorrect: resolved && round.firstCorrect === "player",
    pickText: raceStripPickText(player.picked, !!player.isLocked, !!player.timedOut, resolved),
    showThinking: !player.isLocked,
  }];
  (Array.isArray(round.npcs) ? round.npcs : [])
    .filter((npc) => npc && typeof npc === "object")
    .forEach((npc) => {
      const record = npc as LooseRecord;
      const id = String(record.studentId || "");
      if (!id || !visibleIds.has(id)) return;
      const student = studentById.get(id);
      const name = String((student && (student.shortName || student.name)) || id);
      cards.push({
        kind: "student",
        id,
        name,
        avatarText: (name || "?").charAt(0).toUpperCase(),
        color: String((student && student.color) || "#888"),
        isLocked: !!record.isLocked,
        isTimedOut: false,
        isCorrect: resolved ? (record.isCorrect === true ? true : record.isCorrect === false ? false : null) : null,
        isFirstCorrect: resolved && round.firstCorrect === id,
        pickText: raceStripPickText(record.pick, !!record.isLocked, false, resolved),
        showThinking: !record.isLocked,
      });
    });
  return {
    timer: {
      label: resolved ? "done" : remainingS + "s",
      warn: !resolved && remainingS <= 10 && remainingS > 5,
      danger: !resolved && remainingS <= 5,
      locked: resolved,
    },
    cards,
  };
}

export function raceStripPickText(pick: unknown, locked: unknown, timedOut: unknown, resolved: unknown): string {
  if (!locked) return "";
  if (resolved && timedOut) return "⏱";
  if (resolved && pick) return String(pick);
  if (!resolved) return "✓";
  return "";
}

// ── blackboard question prompt view helpers ────────────────────────
export function questionPromptView(question: unknown): { images: QuestionPromptImageView[]; prompt: string } {
  const record = question && typeof question === "object" ? question as LooseRecord : {};
  const media = Array.isArray(record.media) ? record.media : [];
  const images = media
    .filter((asset) => asset && typeof asset === "object" && typeof (asset as LooseRecord).dataUrl === "string" && (asset as LooseRecord).dataUrl.indexOf("data:image/") === 0)
    .slice(0, 3)
    .map((asset) => ({
      src: String((asset as LooseRecord).dataUrl),
      alt: String((asset as LooseRecord).name || "Source card image"),
    }));
  return {
    images,
    prompt: String(record.prompt || ""),
  };
}

// ── leaderboard view helpers ───────────────────────────────────────
export function leaderboardView(data: unknown, playbooks: unknown): {
  empty: boolean;
  gradeLabel: string;
  count: number;
  rows: LeaderboardRowView[];
} {
  const record = data && typeof data === "object" ? data as LooseRecord : {};
  const students = Array.isArray(record.students) ? record.students : [];
  const grade = String(record.grade || "9");
  return {
    empty: students.length === 0,
    gradeLabel: worldFeedGradeLabel(grade),
    count: students.length,
    rows: students.map((student, index) => leaderboardRowView(student, index, playbooks)),
  };
}

export function leaderboardRowView(student: unknown, index: unknown, playbooks: unknown): LeaderboardRowView {
  const record = student && typeof student === "object" ? student as LooseRecord : {};
  const rank = Math.max(1, Math.floor(Number(index || 0)) + 1);
  const name = String(record.name || "—");
  return {
    rank: String(rank),
    rankClass: "leaderboard-rank rank-" + (rank <= 3 ? rank : "n"),
    name,
    portraitUrl: typeof record.portraitUrl === "string" ? record.portraitUrl : "",
    avatarText: (name || "?").slice(0, 1).toUpperCase(),
    playbookName: leaderboardPlaybookName(record.playbookId, playbooks),
    gradeChips: leaderboardGradeChips(record.classGrades),
  };
}

export function leaderboardPlaybookName(playbookId: unknown, playbooks: unknown): string {
  const id = String(playbookId || "");
  const found = (Array.isArray(playbooks) ? playbooks : []).find((playbook) => (
    !!playbook && typeof playbook === "object" && (playbook as LooseRecord).id === id
  )) as LooseRecord | undefined;
  return String((found && found.name) || id || "—");
}

export function leaderboardGradeChips(classGrades: unknown): LeaderboardGradeChipView[] {
  if (!classGrades || typeof classGrades !== "object") return [];
  return Object.entries(classGrades as LooseRecord).slice(0, 3).map(([facultyId, grade]) => {
    const text = leaderboardFacultyLabel(facultyId) + " " + String(grade);
    return {
      className: "leaderboard-grade-chip is-" + String(grade).charAt(0),
      text,
    };
  });
}

export function leaderboardFacultyLabel(facultyId: unknown): string {
  const labels: Record<string, string> = {
    ruby: "Ruby",
    "sally-science": "Sally",
    "professor-edward": "Edward",
  };
  const id = String(facultyId || "");
  return labels[id] || id;
}

// ── top-bar arc indicator helpers ─────────────────────────────────
export function arcIndicatorView(t: unknown, subjects: unknown, walletText: unknown): ArcIndicatorView {
  const telemetry = t && typeof t === "object" ? t as LooseRecord : {};
  const character = telemetry.character && typeof telemetry.character === "object" ? telemetry.character as LooseRecord : null;
  const grade = String(telemetry.current_grade || "");
  if (!character || !grade) {
    return {
      hidden: true,
      graduated: false,
      yearText: "",
      streakText: "",
      streakMet: false,
      subjectText: "",
      subjectMet: false,
      scoreText: "",
    };
  }
  const graduated = Array.isArray(character.yearbook) && character.yearbook.length >= 4;
  if (graduated) {
    return {
      hidden: false,
      graduated: true,
      yearText: "Graduated",
      streakText: "🎓",
      streakMet: false,
      subjectText: "✅",
      subjectMet: false,
      scoreText: String(walletText || ""),
    };
  }
  const streak = character.streak && typeof character.streak === "object" ? character.streak as LooseRecord : {};
  const streakCount = streak.grade === grade ? Math.max(0, Math.floor(Number(streak.count || 0))) : 0;
  const streakReq = (VIEWER_CONSTANTS.STREAK_REQUIRED as Record<string, number>)[grade] || 1;
  const subjectRecord = subjects && typeof subjects === "object" ? subjects as LooseRecord : {};
  const subjectMet = Math.max(0, Math.floor(Number(subjectRecord.met || 0)));
  const subjectTotal = Math.max(0, Math.floor(Number(subjectRecord.total || 0)));
  return {
    hidden: false,
    graduated: false,
    yearText: worldFeedGradeLabel(grade),
    streakText: "📚 " + streakCount + "/" + streakReq,
    streakMet: streakCount >= streakReq,
    subjectText: "✅ " + subjectMet + "/" + subjectTotal,
    subjectMet: subjectTotal > 0 && subjectMet >= subjectTotal,
    scoreText: String(walletText || ""),
  };
}

// ── classmate arc helpers ──────────────────────────────────────────
export function classmateArcStanding(entry: unknown, currentGrade: unknown, roomLabel?: unknown): string {
  const record = entry && typeof entry === "object" ? entry as LooseRecord : {};
  const arc = record.arc && typeof record.arc === "object" ? record.arc as LooseRecord : null;
  if (arc && arc.graduated) return "alumni";
  const grade = String(currentGrade || "");
  const rosterGrade = String(record.rosterGrade || "");
  if (!grade || !rosterGrade) return "";
  const gradeOrder = VIEWER_CONSTANTS.GRADE_ORDER as readonly string[];
  const currentIdx = gradeOrder.indexOf(grade);
  const studentIdx = gradeOrder.indexOf(rosterGrade);
  if (studentIdx < 0 || currentIdx < 0) return "";
  if (studentIdx > currentIdx) return "ahead of you";
  if (studentIdx < currentIdx) return "behind you";
  return roomLabel ? "#" + String(roomLabel) : "in your year";
}

export function classmateArcSubtitle(entry: unknown, currentGrade: unknown, roomLabel?: unknown): string {
  const record = entry && typeof entry === "object" ? entry as LooseRecord : {};
  const arc = record.arc && typeof record.arc === "object" ? record.arc as LooseRecord : null;
  const bits: string[] = [];
  const standing = classmateArcStanding(record, currentGrade, roomLabel);
  if (standing) bits.push(standing);
  if (arc && arc.graduated) {
    const years = Array.isArray(arc.completedGrades) ? arc.completedGrades.length : 0;
    bits.push(years + " years");
  }
  return bits.join(" · ");
}

export function classmateArcProgress(entry: unknown): ClassmateArcProgress | null {
  const record = entry && typeof entry === "object" ? entry as LooseRecord : {};
  const arc = record.arc && typeof record.arc === "object" ? record.arc as LooseRecord : null;
  if (!arc || arc.graduated || !arc.streak || typeof arc.streak !== "object") return null;
  const rosterGrade = String(record.rosterGrade || "");
  const total = (VIEWER_CONSTANTS.STREAK_REQUIRED as Record<string, number>)[rosterGrade] || 1;
  const value = Math.max(0, Math.min(Math.floor(Number((arc.streak as LooseRecord).count || 0)), total));
  return { value, total };
}

export function classmateArcProgressLabel(progress: unknown): string {
  const record = progress && typeof progress === "object" ? progress as LooseRecord : null;
  if (!record) return "";
  return "Year progress " + Math.max(0, Math.floor(Number(record.value || 0))) + " of " + Math.max(0, Math.floor(Number(record.total || 0)));
}

export function roomCompletionProgressView(faculty: unknown): RoomCompletionProgress | null {
  const record = faculty && typeof faculty === "object" ? faculty as LooseRecord : null;
  if (!record) return null;
  const total = Math.max(0, Math.floor(Number(record.requiredClasses || 0)));
  if (total <= 0) return null;
  const value = Math.max(0, Math.min(Math.floor(Number(record.completedClasses || 0)), total));
  return { value, total };
}

export function roomCompletionProgressLabel(faculty: unknown, progress: unknown): string {
  const room = faculty && typeof faculty === "object" ? faculty as LooseRecord : {};
  const record = progress && typeof progress === "object" ? progress as LooseRecord : {};
  const roomName = String((room && (room.shortName || room.displayName)) || "Room");
  const value = Math.max(0, Math.floor(Number(record.value || 0)));
  const total = Math.max(0, Math.floor(Number(record.total || 0)));
  return roomName + " daily classes " + value + " of " + total;
}

export function roomChannelRowViews(
  rooms: unknown,
  roster: unknown,
  cohort: unknown,
  activeFacultyId: unknown,
  students: unknown,
  visibleStudentIds: unknown,
): RoomChannelRowView[] {
  const roomList = Array.isArray(rooms) ? rooms : [];
  const facultyList = Array.isArray(roster) ? roster : [];
  const cohortRecord = cohort && typeof cohort === "object" ? cohort as LooseRecord : {};
  const studentList = Array.isArray(students) ? students : [];
  const visibleIds = new Set(Array.isArray(visibleStudentIds)
    ? visibleStudentIds.map((id) => String(id || "")).filter(Boolean)
    : studentList.map((student) => String((student && typeof student === "object" ? (student as LooseRecord).id : "") || "")).filter(Boolean));
  const studentNames = new Map<string, string>();
  studentList.forEach((student) => {
    const record = student && typeof student === "object" ? student as LooseRecord : null;
    if (!record) return;
    const id = record.id != null ? String(record.id) : "";
    if (!id) return;
    studentNames.set(id, String(record.name || id));
  });

  return roomList
    .filter((room) => !!(room && typeof room === "object" && (room as LooseRecord).teaches))
    .map((room) => {
      const roomRecord = room as LooseRecord;
      const roomId = String(roomRecord.id || "");
      const facultyId = String(roomRecord.teacherId || "");
      const faculty = facultyList.find((entry) => !!(entry && typeof entry === "object" && String((entry as LooseRecord).id || "") === facultyId)) || null;
      const completionProgress = faculty ? roomCompletionProgressView(faculty) : null;
      const cohortIds = Array.isArray(cohortRecord[roomId]) ? cohortRecord[roomId] : [];
      return {
        roomId,
        facultyId,
        channelName: String(roomRecord.channelName || roomId || "Room"),
        isActive: !!(faculty && String(activeFacultyId || "") === facultyId),
        completionProgress,
        completionLabel: completionProgress ? roomCompletionProgressLabel(faculty, completionProgress) : "",
        students: cohortIds
          .map((id) => String(id || ""))
          .filter((id) => id && visibleIds.has(id))
          .map((id) => ({ id, name: studentNames.get(id) || id })),
      };
    });
}

// ── pack pricing labels (take product + solana config as inputs) ───
export function packCountLabel(count: unknown): string {
  const n = Number.isFinite(Number(count)) && Number(count) > 0 ? Math.floor(Number(count)) : 1;
  return formatWholeNumber(n) + " Pack" + (n === 1 ? "" : "s");
}
export function cardPackTokenSymbol(product: NullableRecord, solana: NullableRecord): string {
  return String((product && product.tokenSymbol) || (solana && solana.symbol) || "RUBY").trim() || "RUBY";
}
export function cardPackDebitLabel(product: NullableRecord, solana: NullableRecord): string {
  const amount = product && product.tokenAmount != null ? product.tokenAmount : solana && solana.tokenAmount;
  return "-" + formatTokenDisplayAmount(amount) + " " + cardPackTokenSymbol(product, solana);
}
export function cardPackCreditLabel(product: NullableRecord): string {
  const count = product && Number.isFinite(Number(product.packCount)) ? Number(product.packCount) : 1;
  return "+" + packCountLabel(count) + " NFT";
}
export function cardPackPaymentDeltaLabel(product: NullableRecord, solana: NullableRecord): string {
  return cardPackDebitLabel(product, solana) + " · " + cardPackCreditLabel(product);
}
export function cardPackProductMeta(product: NullableRecord, solana: NullableRecord): string {
  const cardCount = Math.max(1, Math.floor(Number(product && product.cardCount || VIEWER_CONSTANTS.HALL_PASS_CARDS_PER_PACK)));
  return cardPackPaymentDeltaLabel(product, solana) + " · " + formatWholeNumber(cardCount) + " cards";
}

// ── HTML / markdown helpers (DOM-only, no app state) ───────────────
export function escapeHtml(value: unknown): string {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => map[c as keyof typeof map]);
}
export function escape(s: unknown): string { return escapeHtml(s); }
export function safeMarkdownHref(href: unknown): string | null {
  const raw = String(href || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.href);
    return (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") ? raw : null;
  } catch (_e) {
    return null;
  }
}
export function sanitizeVisibleChatText(value: unknown): string {
  let text = String(value == null ? "" : value);
  const tags = "pick_from_bank|pose_question|pose_opinion|clear_board|handoff_faculty";
  text = text.replace(new RegExp("<\\s*(" + tags + ")\\b[^>]*>[\\s\\S]*?<\\s*/\\s*\\1\\s*>", "gi"), "");
  text = text.replace(new RegExp("<\\s*/?\\s*(?:" + tags + ")\\b[^>]*\\/?>", "gi"), "");
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function markdownInlineHtml(value: unknown): string {
  const start = String.fromCharCode(0xe000);
  const end = String.fromCharCode(0xe001);
  const tick = String.fromCharCode(96);
  const placeholders: string[] = [];
  let text = sanitizeVisibleChatText(value);
  const stash = (html: string): string => {
    const key = start + placeholders.length + end;
    placeholders.push(html);
    return key;
  };
  const codePattern = new RegExp(tick + "([^" + tick + "\n]+)" + tick, "g");
  text = text.replace(codePattern, (_match, code) => stash("<code>" + escapeHtml(code) + "</code>"));
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    const safeHref = safeMarkdownHref(href);
    if (!safeHref) return match;
    return stash('<a href="' + escapeHtml(safeHref) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + "</a>");
  });
  let html = escapeHtml(text);
  html = html
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^\w])\*([^*\n]+)\*(?=$|[^\w])/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\n]+)_(?=$|[^\w])/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>");
  const placeholderPattern = new RegExp(start + "(\\d+)" + end, "g");
  return html.replace(placeholderPattern, (_match, index) => placeholders[Number(index)] || "");
}
export function appendMarkdownInline(parent: Node, text: unknown): void {
  const span = document.createElement("span");
  span.innerHTML = markdownInlineHtml(text);
  while (span.firstChild) parent.appendChild(span.firstChild);
}
export function renderMarkdownInto(el: HTMLElement | null, source: unknown, options?: MarkdownRenderOptions): void {
  if (!el) return;
  const opts = options || {};
  el.classList.add("markdown");
  el.classList.toggle("markdown-inline", !!opts.inline);
  el.replaceChildren();
  const text = sanitizeVisibleChatText(source).replace(/\r\n?/g, "\n");
  if (!text) return;
  if (opts.inline) {
    appendMarkdownInline(el, text);
    return;
  }
  const lines = text.split("\n");
  const fence = String.fromCharCode(96).repeat(3);
  const startsBlock = (line: string): boolean =>
    /^\s{0,3}#{1,4}\s+/.test(line) ||
    /^\s{0,3}>\s?/.test(line) ||
    /^\s{0,3}[-*+]\s+/.test(line) ||
    /^\s{0,3}\d+[.)]\s+/.test(line) ||
    line.trim().slice(0, 3) === fence;
  const appendParagraph = (chunk: string): void => {
    const p = document.createElement("p");
    appendMarkdownInline(p, chunk);
    el.appendChild(p);
  };
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i += 1; continue; }
    if (lines[i].trim().slice(0, 3) === fence) {
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && lines[i].trim().slice(0, 3) !== fence) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      el.appendChild(pre);
      continue;
    }
    if (/^\s{0,3}#{1,4}\s+/.test(lines[i])) {
      const raw = lines[i].replace(/^\s{0,3}/, "");
      const depth = Math.min(4, raw.match(/^#+/)?.[0].length ?? 1);
      const heading = document.createElement("h" + depth);
      appendMarkdownInline(heading, raw.replace(/^#{1,4}\s+/, ""));
      el.appendChild(heading);
      i += 1;
      continue;
    }
    if (/^\s{0,3}>\s?/.test(lines[i])) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i += 1;
      }
      const quote = document.createElement("blockquote");
      renderMarkdownInto(quote, quoteLines.join("\n"));
      el.appendChild(quote);
      continue;
    }
    if (/^\s{0,3}[-*+]\s+/.test(lines[i])) {
      const list = document.createElement("ul");
      while (i < lines.length && /^\s{0,3}[-*+]\s+/.test(lines[i])) {
        const li = document.createElement("li");
        appendMarkdownInline(li, lines[i].replace(/^\s{0,3}[-*+]\s+/, ""));
        list.appendChild(li);
        i += 1;
      }
      el.appendChild(list);
      continue;
    }
    if (/^\s{0,3}\d+[.)]\s+/.test(lines[i])) {
      const list = document.createElement("ol");
      while (i < lines.length && /^\s{0,3}\d+[.)]\s+/.test(lines[i])) {
        const li = document.createElement("li");
        appendMarkdownInline(li, lines[i].replace(/^\s{0,3}\d+[.)]\s+/, ""));
        list.appendChild(li);
        i += 1;
      }
      el.appendChild(list);
      continue;
    }
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      paraLines.push(lines[i]);
      i += 1;
    }
    appendParagraph(paraLines.join("\n"));
  }
}
