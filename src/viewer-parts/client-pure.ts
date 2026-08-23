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
type QuestionPromptImageView = { src: string; alt: string };
export type LeaderboardGradeChipView = { className: string; text: string };
export type LeaderboardRowView = {
  rank: string;
  rankClass: string;
  name: string;
  portraitUrl: string;
  avatarText: string;
  playbookName: string;
  gradeChips: LeaderboardGradeChipView[];
};
export type RaceStripCardView = {
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
export type ArcIndicatorView = {
  hidden: boolean;
  graduated: boolean;
  yearText: string;
  streakText: string;
  streakMet: boolean;
  subjectText: string;
  subjectMet: boolean;
  essayVisible: boolean;
  essayText: string;
  essayMet: boolean;
};
export type GuestSpotlightView = {
  visible: boolean;
  packId: string;
  titleText: string;
  metaText: string;
  actionText: string;
  actionDisabled: boolean;
};
export type DailyClassProgressStepView = {
  key: "evidence-1" | "evidence-2" | "take" | "result";
  label: string;
  state: "complete" | "current" | "upcoming";
};
export type DailyClassProgressView = {
  visible: boolean;
  steps: DailyClassProgressStepView[];
  continuationLabel: string;
};
export type SubjectGradeChipView = {
  className: string;
  title: string;
  ariaLabel: string;
  iconText: string;
  gradeText: string;
};

export function dailyClassProgressView(telemetry: NullableRecord): DailyClassProgressView {
  const progress = telemetry && telemetry.active_course_progress;
  const today = progress && progress.today;
  const classSession = telemetry && telemetry.active_round && telemetry.active_round.classSession;
  const activeRoundIsPractice = classSession && classSession.mode === "practice";
  const hasContext = !!(
    telemetry
    && telemetry.character
    && Number(progress && progress.requiredClasses) > 0
    && !(telemetry.current && telemetry.current.opinionPurpose === "grade-essay")
    && !activeRoundIsPractice
    && today
    && (
      today.status === "active"
      || today.status === "complete"
      || (classSession && classSession.mode === "class")
    )
  );
  const count = Math.max(0, Math.min(3, Math.floor(Number(today && today.questionCount) || 0)));
  const complete = !!(today && today.status === "complete");
  const offlineStatic = telemetry && telemetry.store_path === "localStorage";
  const currentIndex = complete ? 3 : Math.min(2, count);
  const definitions: Array<{ key: DailyClassProgressStepView["key"]; label: string }> = [
    { key: "evidence-1", label: "Question 1" },
    { key: "evidence-2", label: "Question 2" },
    { key: "take", label: offlineStatic ? "Question 3" : "Your View" },
    { key: "result", label: "Result" },
  ];
  const steps = definitions.map((definition, index): DailyClassProgressStepView => ({
    ...definition,
    state: index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming",
  }));
  return {
    visible: hasContext,
    steps,
    continuationLabel: currentIndex === 1
      ? "Next: Question 2"
      : currentIndex === 2
        ? offlineStatic ? "Next: Question 3" : "Next: Your View"
        : currentIndex === 3
          ? "View Result"
          : "Start Question 1",
  };
}
export type AccountPublicWorldView = {
  hasCharacter: boolean;
  hasPublicName: boolean;
  publicNameReviewOk: boolean;
  publicNameReviewReason: string | null;
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
export type AccountHistoryRowView = {
  className: string;
  title: string;
  meta: string;
  delta: string;
};
export type AccountCharacterCardView = {
  className: string;
  accent: string;
  name: string;
  meta: string;
  portraitUrl: string;
  portraitInitial: string;
  isActive: boolean;
};
export type AccountEmptyCharacterSlotView = {
  tagName: "button" | "div";
  type: "button" | "";
  className: string;
  name: string;
  meta: string;
  canCreate: boolean;
};
export type AccountCharacterPanelView = {
  displaySlots: number;
  emptySlots: number;
  canCreateCharacter: boolean;
  summaryText: string;
  createHidden: boolean;
  createDisabled: boolean;
  unlockText: string;
  unlockDisabled: boolean;
  unlockTitle: string;
};
export type AccountAiPanelView = {
  status: string;
  meta: string;
  primaryLabel: string;
  primaryTitle: string;
  primaryDisabled: boolean;
  secondaryLabel: string;
  secondaryDisabled: boolean;
};
export type AccountWalletPanelView = {
  balanceText: string;
  metaText: string;
  buyPassesText: string;
  buyPassesTitle: string;
  buyPassesDisabled: boolean;
};
export type AccountPaneId = "account" | "wallet" | "cards" | "library" | "receipts" | "trust";
export type AccountPaneItemView = {
  id: AccountPaneId;
  selected: boolean;
  classActive: boolean;
  ariaSelected: "true" | "false";
  tabIndex: 0 | -1;
  hidden: boolean;
};
export type AccountTrustRowView = {
  label: string;
  value: string;
  href: string;
};
export type AccountTrustPanelView = {
  rows: AccountTrustRowView[];
  note: string;
};
export type AccountHallPassCardsPanelView = {
  summaryText: string;
  buyText: string;
  buyTitle: string;
  buyDisabled: boolean;
  mintHidden: boolean;
  mintDisabled: boolean;
  mintText: string;
  mintTitle: string;
  needsWalletConnection: boolean;
};
export type AccountHallPassPackTileView = {
  className: string;
  status: string;
  packCount: number;
  cardCount: number;
  imageAlt: string;
  imageKind: "active" | "opened";
  title: string;
  detail: string;
  proofLabel: string;
  openVisible: boolean;
  openText: string;
  openDisabled: boolean;
  openTitle: string;
  walletReady: boolean;
};
export type PackLibraryCardActionKind = "search-primary" | "edit" | "uninstall" | "delete";
export type PackLibraryCardActionView = {
  kind: PackLibraryCardActionKind;
  className: string;
  text: string;
  disabled: boolean;
};
export type PackLibraryCardView = {
  className: string;
  interactive: boolean;
  tabIndex: 0 | -1;
  ariaLabel: string;
  name: string;
  description: string;
  chips: string[];
  stateText: string;
  actions: PackLibraryCardActionView[];
};
export type PackTeacherRowView = {
  className: string;
  selectDisabled: boolean;
  avatarUrl: string;
  avatarText: string;
  titleText: string;
  subtitleText: string;
  editDisabled: boolean;
  deleteDisabled: boolean;
};
export type PackTeacherDetailView = {
  nameText: string;
  metaText: string;
  descriptionText: string;
};
export type PackQuestionRowView = {
  id: string;
  promptText: string;
  detailText: string;
  deleteText: string;
};
export type PackQuestionListView = {
  emptyText: string;
  rows: PackQuestionRowView[];
};
export type AccountHallPassCardTileView = {
  className: string;
  faceDown: boolean;
  title: string;
  detail: string;
  ariaLabel: string;
  imageAlt: string;
  fallbackInitial: string;
};
export type AccountHallPassCardProfile = {
  subtitle: string;
  teaches?: string;
  stats?: {
    head: number;
    heart: number;
    hustle: number;
    honor: number;
  };
  quote?: string;
};
export type AccountHallPassCardReaderView = {
  panelClassName: string;
  artClassName: string;
  faceDown: boolean;
  title: string;
  detail: string;
  artAlt: string;
  fallbackInitial: string;
  proofAddress: string;
  teachesVisible: boolean;
  teachesLabel: string;
  teachesText: string;
  quoteText: string;
  noteText: string;
  revealVisible: boolean;
  revealText: string;
  revealDisabled: boolean;
  revealTitle: string;
};
export type BillingCardBurnChoiceView = {
  titleText: string;
  metaText: string;
  buttonText: string;
  buttonDisabled: boolean;
  buttonTitle: string;
};
export type BillingCardPackPaymentChoiceView = {
  titleText: string;
  metaText: string;
  buttonText: string;
  buttonDisabled: boolean;
  buttonTitle: string;
  noteText: string;
  showGetRubyLink: boolean;
};
export type BillingHallPassPaymentChoiceView = {
  titleText: string;
  metaText: string;
  buttonText: string;
  buttonDisabled: boolean;
  buttonTitle: string;
};
export type BillingProductRowView = {
  titleText: string;
  metaText: string;
  buttonText: string;
  buttonDisabled: boolean;
  selected: boolean;
};
export type BillingProductsPanelView = {
  titleText: string;
  subtitleText: string;
  cardPackCostLabels: string[];
  showGetRubyCostLink: boolean;
  emptyStatusText: string;
  checkoutStatusText: string;
  checkoutStatusError: boolean;
};
export type AccountComicPageTileView = {
  pageNumber: number;
  title: string;
  unlocked: boolean;
  ariaLabel: string;
  unlock: LooseRecord | null;
};
export type AccountComicPanelView = {
  issueId: string;
  title: string;
  pageCount: number;
  unlockedCount: number;
  summaryText: string;
  progressText: string;
  tiles: AccountComicPageTileView[];
};
export type WelcomeHallPassPopupView = {
  titleText: string;
  bodyText: string;
  showLater: boolean;
  primaryText: string;
};
export type ClassmateArcProgress = { value: number; total: number };
type RoomCompletionProgress = { value: number; total: number };
export type RoomChannelStudentView = {
  id: string;
  name: string;
  portraitUrl?: string;
  kind?: "npc" | "human";
  facultyId?: string;
  grade?: string;
  playbookId?: string;
  stats?: unknown;
  classGrades?: unknown;
  yearbookCount?: unknown;
  lastActive?: unknown;
};
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
export function boardSubjectGradesTitleView(currentGradeInput: unknown, summaryInput: NullableRecord): string {
  const grade = String(currentGradeInput || "");
  const summary = summaryInput && typeof summaryInput === "object" ? summaryInput : {};
  const met = Math.max(0, Math.floor(Number(summary.met || 0)));
  const total = Math.max(0, Math.floor(Number(summary.total || 0)));
  const labels = VIEWER_CONSTANTS.GRADE_LABELS as Record<string, string>;
  return (labels[grade] || (grade ? "Grade " + grade : "Current year")) + " · " + met + "/" + total + " subjects passed";
}
export function subjectGradeChipView(specInput: NullableRecord): SubjectGradeChipView {
  const spec = specInput && typeof specInput === "object" ? specInput : {};
  const label = String(spec.label || "Subject");
  const icon = String(spec.icon || "□");
  const grade = String(spec.grade || "—");
  const met = spec.met !== undefined ? !!spec.met : (grade === "✓" || letterGradePasses(grade));
  const pending = !!spec.pending && !met;
  const title = pending
    ? label + ": " + grade + " daily classes toward course grade"
    : grade === "—"
      ? label + ": no subject grade yet"
      : label + ": " + grade + (met ? " subject passed" : " needs a C and the required daily classes");
  return {
    className: "subject-grade-chip" + (met ? " is-met" : "") + (pending ? " is-pending" : ""),
    title,
    ariaLabel: title,
    iconText: icon,
    gradeText: grade,
  };
}
export function guestSpotlightView(guestInput: NullableRecord): GuestSpotlightView {
  const guest = guestInput && typeof guestInput === "object" ? guestInput : {};
  const pack = guest.auto && typeof guest.auto === "object" ? guest.auto : null;
  if (!pack || !pack.id) {
    return {
      visible: false,
      packId: "",
      titleText: "",
      metaText: "",
      actionText: "",
      actionDisabled: true,
    };
  }
  const packId = String(pack.id);
  const teacher = String(pack.teacher_name || "Guest teacher");
  const subject = String(pack.subject || "guest class");
  const count = Math.max(0, Math.floor(Number(pack.question_count || 0)));
  const active = guest.active && typeof guest.active === "object" && guest.active.id === pack.id && guest.mode === "auto";
  return {
    visible: true,
    packId,
    titleText: "This week's guest teacher",
    metaText: String(pack.name || "Guest course") + " · " + teacher + " · " + subject + " · " + formatWholeNumber(count) + " questions",
    actionText: active ? "Current guest" : "Try this guest",
    actionDisabled: !!active,
  };
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
export function formatSolDisplayAmount(value: unknown): string {
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
export function billingHallPassPaymentChoiceView(
  payloadInput: NullableRecord,
  productInput: NullableRecord,
  opts?: NullableRecord,
): BillingHallPassPaymentChoiceView {
  const payload = payloadInput && typeof payloadInput === "object" ? payloadInput : {};
  const product = productInput && typeof productInput === "object" ? productInput : {};
  const explicit = Number(product.hallPasses);
  const hallPasses = Number.isFinite(explicit) && explicit > 0 ? Math.floor(explicit) : 1;
  const configured = !!payload.configured;
  const billingBusy = !!(opts && opts.billingBusy);
  return {
    titleText: "Buy " + hallPassCostLabel(hallPasses),
    metaText: formatMoney(product.unitAmount, product.currency),
    buttonText: "Checkout",
    buttonDisabled: !configured || billingBusy,
    buttonTitle: configured ? "Pay by card." : "Card payment is not available.",
  };
}
export function welcomeHallPassPopupView(
  grantInput: NullableRecord,
  opts?: { fromBilling?: unknown; portraitConfigured?: unknown; hasCharacter?: unknown },
): WelcomeHallPassPopupView {
  const amount = Math.max(1, Math.floor(Number(grantInput && grantInput.amount || 5)));
  const fromBilling = !!(opts && opts.fromBilling);
  const portraitConfigured = !!(opts && opts.portraitConfigured);
  const hasCharacter = !!(opts && opts.hasCharacter);
  return {
    titleText: formatWholeNumber(amount) + " Hall Passes added",
    bodyText: fromBilling
      ? "Your starter Hall Passes are ready. Use them for images, extra students, and collectible cards, or keep playing classes for free."
      : portraitConfigured
        ? "Create your first student and try a custom portrait, or save your Hall Passes for an extra student slot."
        : "Create your first student now, or save your Hall Passes for images, collectible cards, and extra student slots.",
    showLater: !fromBilling,
    primaryText: fromBilling ? "Continue" : hasCharacter ? "Open Account" : "Create Student",
  };
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
export function officialRubyHighWebsite(): string {
  return "https://ruby-high.ai/";
}
export function solanaAccountLink(address: unknown): string {
  const raw = String(address || "").trim();
  if (!raw) return "";
  return "https://solscan.io/account/" + encodeURIComponent(raw);
}

// ── account public-world visibility ────────────────────────────────
export function accountPublicWorldNameReview(raw: unknown): { ok: boolean; reason: string | null } {
  const displayName = String(raw || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!displayName) return { ok: false, reason: "empty" };
  if (/^(admin|administrator|moderator|mod|ruby high|support|staff|teacher|principal)$/i.test(displayName)) return { ok: false, reason: "reserved" };
  if (/@/.test(displayName) || /\b(?:https?:\/\/|www\.)/i.test(displayName)) return { ok: false, reason: "contact" };
  if (/\b(?:fuck|shit|bitch|cunt|dick|pussy|slut|whore|nazi)\b/i.test(displayName.toLowerCase())) return { ok: false, reason: "unsafe" };
  return { ok: true, reason: null };
}

export function accountPublicWorldView(character: unknown, opts?: { authed?: unknown; busy?: unknown }): AccountPublicWorldView {
  const c = character && typeof character === "object" ? character as LooseRecord : null;
  const hasCharacter = !!c;
  const hasPublicName = !!(c && typeof c.name === "string" && c.name.trim());
  const nameReview = accountPublicWorldNameReview(c && c.name);
  const publicNameReviewOk = hasPublicName && nameReview.ok;
  const blockedBySocialConsent = !!(c && c.socialConsent === false);
  const visible = !!(c && publicNameReviewOk && !blockedBySocialConsent && c.publicWorldVisible !== false);
  const authed = !!(opts && opts.authed);
  const busy = !!(opts && opts.busy);
  const nextVisible = !visible;
  const summaryText = !hasCharacter
    ? "Create a student before showing them in shared school activity."
    : visible
    ? "Your active student appears in shared school activity."
    : blockedBySocialConsent
    ? "An older privacy setting is keeping this student out of shared school activity."
    : hasPublicName && !publicNameReviewOk
    ? nameReview.reason === "reserved"
      ? "Choose a student name that is not a staff or system name before showing them in school rooms."
      : nameReview.reason === "contact"
        ? "Remove contact details, usernames, or links from this student name before showing them in school rooms."
        : "Choose a school-appropriate student name before showing them in school rooms."
    : hasPublicName
    ? "Your active student is hidden from shared school activity."
    : "Name your student before showing them in shared school activity.";
  const toggleTitle = !hasCharacter
    ? "Create a student first"
    : !hasPublicName
    ? "Add a student name first"
    : !publicNameReviewOk
    ? "Review this student name before showing it in school rooms"
    : blockedBySocialConsent
    ? "An older privacy setting is hiding this student"
    : visible
    ? "Hide this student from shared school activity"
    : "Show this student in shared school activity";
  return {
    hasCharacter,
    hasPublicName,
    publicNameReviewOk,
    publicNameReviewReason: nameReview.reason,
    blockedBySocialConsent,
    visible,
    summaryText,
    statusText: visible ? "Shown in shared school activity" : "Hidden from shared school activity",
    statusClass: visible ? "is-visible" : "",
    toggleText: visible ? "Hide" : "Show",
    toggleDisabled: !authed || busy || !hasCharacter || !hasPublicName || !publicNameReviewOk || blockedBySocialConsent,
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

export function walletTransactionCardCount(tx: NullableRecord): number {
  const metadata = tx && tx.metadata && typeof tx.metadata === "object" ? tx.metadata : {};
  const rawCount = Math.max(0, Math.floor(Number(metadata.hallPassCardCount || metadata.cardCount || 0)));
  const packCount = Math.max(0, Math.floor(Number(metadata.packCount || 0)));
  const count = tx && tx.kind === "hall-pass-pack-mint" && packCount > 0
    ? Math.max(rawCount, packCount * VIEWER_CONSTANTS.HALL_PASS_CARDS_PER_PACK)
    : rawCount;
  if (count <= 0) return 0;
  return tx && (tx.kind === "hall-pass-spend" || tx.kind === "hall-pass-revoke") ? -count : count;
}

export function walletTransactionTitle(tx: NullableRecord): string {
  if (!tx || !tx.kind) return "Wallet update";
  if (tx.kind === "merit-star-grant") return "Merit Star grant";
  if (tx.kind === "merit-star-spend") return "Chat message";
  if (tx.kind === "hall-pass-grant") return walletTransactionCardCount(tx) > 0 ? "Pack opened" : "Hall Pass grant";
  if (tx.kind === "hall-pass-spend") return walletTransactionCardCount(tx) < 0 ? "Collectible card permanently destroyed" : "Hall Pass used";
  if (tx.kind === "hall-pass-refund") return "Hall Pass refund";
  if (tx.kind === "hall-pass-revoke") return "Hall Pass reversal";
  if (tx.kind === "hall-pass-card-burn") return "Collectible card exchanged for Hall Passes";
  if (tx.kind === "hall-pass-pack-mint") return "Collectible pack created";
  if (tx.kind === "hall-pass-pack-open") return "Pack opened";
  if (tx.kind === "hall-pass-card-mint") return "Collectible card created";
  if (tx.kind === "photo-day-spend") return "Photo Day credit";
  if (tx.kind === "photo-day-refund") return "Photo Day refund";
  return "Wallet update";
}

export function walletTransactionDescription(tx: NullableRecord): string {
  return tx && typeof tx.description === "string" && tx.description.trim()
    ? tx.description.trim()
    : walletTransactionTitle(tx);
}

export function walletTransactionPackDeltaText(tx: NullableRecord): string {
  const metadata = tx && tx.metadata && typeof tx.metadata === "object" ? tx.metadata : {};
  const packCount = Math.max(1, Math.floor(Number(metadata.packCount || 1)));
  const amount = metadata.solanaAmountSol || "";
  return "-" + formatSolDisplayAmount(amount) + " SOL · +" + formatWholeNumber(packCount) + " Collectible Pack" + (packCount === 1 ? "" : "s");
}

export function walletTransactionSource(tx: NullableRecord): string {
  const source = String((tx && tx.source) || "system").replace(/-/g, " ");
  return source.charAt(0).toUpperCase() + source.slice(1);
}

export function accountHistoryRowView(tx: NullableRecord): AccountHistoryRowView {
  const meritStarAmount = Number((tx && tx.meritStars) || 0);
  const amount = Number((tx && tx.hallPasses) || 0);
  const photoDayAmount = Number((tx && tx.photoDayCredits) || 0);
  const cardAmount = walletTransactionCardCount(tx);
  const isPackPurchase = !!(tx && tx.kind === "hall-pass-pack-mint");
  const visibleAmount = meritStarAmount || amount || photoDayAmount || cardAmount;
  const className = "account-history-row"
    + (isPackPurchase ? " is-swap" : visibleAmount > 0 ? " is-credit" : visibleAmount < 0 ? " is-debit" : "");
  const delta = isPackPurchase
    ? walletTransactionPackDeltaText(tx)
    : cardAmount !== 0
    ? (cardAmount > 0 ? "+" : "") + formatWholeNumber(cardAmount) + " Collectible Card" + (Math.abs(cardAmount) === 1 ? "" : "s")
    : meritStarAmount !== 0
      ? (meritStarAmount > 0 ? "+" : "") + formatWholeNumber(meritStarAmount) + " Merit Star" + (Math.abs(meritStarAmount) === 1 ? "" : "s")
    : amount !== 0
      ? (amount > 0 ? "+" : "") + formatWholeNumber(amount) + " Hall Pass" + (Math.abs(amount) === 1 ? "" : "es")
      : photoDayAmount !== 0
        ? (photoDayAmount > 0 ? "+" : "") + formatWholeNumber(photoDayAmount) + " Photo Day"
        : "0";
  return {
    className,
    title: walletTransactionDescription(tx),
    meta: walletTransactionSource(tx) + " · " + formatAccountDate(tx && tx.at),
    delta,
  };
}

export function accountCharacterCardView(
  entry: NullableRecord,
  slotNumber: unknown,
  playbooks: unknown,
  currentGrade: unknown,
  fallbackPortraitUrl?: unknown,
): AccountCharacterCardView {
  const cleanEntry = entry && typeof entry === "object" ? entry : {};
  const character = cleanEntry.character && typeof cleanEntry.character === "object" ? cleanEntry.character : {};
  const playbookId = String(character.playbookId || "");
  const roster = Array.isArray(playbooks) ? playbooks : [];
  const playbook = roster.find((p) => p && typeof p === "object" && (p as LooseRecord).id === playbookId) as NullableRecord;
  const kind = cleanEntry.kind === "graduated" ? "graduated" : "active";
  const name = typeof character.name === "string" && character.name.trim() ? character.name.trim() : "Student";
  const yearbookCount = Array.isArray(character.yearbook) ? character.yearbook.length : 0;
  const gradeLabel = (VIEWER_CONSTANTS.GRADE_LABELS as Record<string, string>)[String(currentGrade || "")] || "Freshman";
  const portraitUrl = String(character.diplomaImageDataUrl || character.portraitDataUrl || fallbackPortraitUrl || "");
  return {
    className: "account-character-card is-" + kind,
    accent: String((playbook && playbook.accent) || "var(--accent)"),
    name,
    meta: kind === "active"
      ? "Slot " + slotNumber + " · active · " + gradeLabel
      : "Slot " + slotNumber + " · graduated · " + yearbookCount + "/4 years",
    portraitUrl,
    portraitInitial: name.slice(0, 1).toUpperCase() || "?",
    isActive: kind === "active",
  };
}

export function accountEmptyCharacterSlotView(slotNumber: unknown, canCreateCharacter: unknown): AccountEmptyCharacterSlotView {
  const canCreate = !!canCreateCharacter;
  return {
    tagName: canCreate ? "button" : "div",
    type: canCreate ? "button" : "",
    className: "account-character-card is-empty" + (canCreate ? " is-create" : ""),
    name: canCreate ? "Create Student" : "Empty Slot",
    meta: canCreate
      ? "Slot " + slotNumber + " · start today's class"
      : "Slot " + slotNumber + " · ready for a future student",
    canCreate,
  };
}

export function accountCharacterPanelView(slotsInput: NullableRecord, walletInput: NullableRecord, opts?: NullableRecord): AccountCharacterPanelView {
  const slots = slotsInput || {};
  const wallet = walletInput || {};
  const unlockedSlots = Math.max(1, Math.floor(Number(slots.unlockedSlots || 1)));
  const photoDayCredits = Math.max(0, Math.floor(Number(slots.photoDayCredits || 0)));
  const costHallPasses = Math.max(1, Math.floor(Number(slots.costHallPasses || 1)));
  const photoDayCreditsPerSlot = Math.max(0, Math.floor(Number(slots.photoDayCreditsPerSlot || 1)));
  const entryCount = Math.max(0, Math.floor(Number((opts && opts.entryCount) || 0)));
  const displaySlots = Math.max(unlockedSlots, entryCount, 1);
  const emptySlots = Math.max(0, displaySlots - entryCount);
  const authed = !!(opts && opts.authed);
  const hasActiveCharacter = !!(opts && opts.hasActiveCharacter);
  const billingBusy = !!(opts && opts.billingBusy);
  const hallPasses = Math.max(0, Math.round(Number(wallet.hallPasses || 0)));
  const canCreateCharacter = authed && !hasActiveCharacter && entryCount < displaySlots;
  return {
    displaySlots,
    emptySlots,
    canCreateCharacter,
    summaryText: entryCount === 0
      ? "Create your first student to start class."
      : displaySlots + " unlocked "
        + (displaySlots === 1 ? "slot" : "slots") + " · "
        + photoDayCredits + " Photo Day "
        + (photoDayCredits === 1 ? "credit" : "credits"),
    createHidden: !canCreateCharacter,
    createDisabled: !canCreateCharacter,
    unlockText: "Add Student Slot (" + costHallPasses + " Hall Pass" + (costHallPasses === 1 ? "" : "es") + ")",
    unlockDisabled: !authed || hallPasses < costHallPasses || billingBusy,
    unlockTitle: hallPasses < costHallPasses
      ? "Need " + costHallPasses + " Hall Pass" + (costHallPasses === 1 ? "" : "es")
      : "Adds one student slot and " + photoDayCreditsPerSlot + " Photo Day credit",
  };
}

export function accountAiPanelView(aiInput: NullableRecord, opts?: NullableRecord): AccountAiPanelView {
  const ai = aiInput || {};
  const cost = positiveWholeNumber(ai.cost || 1, 1);
  const costLabel = hallPassCostLabel(cost);
  const authed = !!(opts && opts.authed);
  const billingBusy = !!(opts && opts.billingBusy);
  const localAiEnabled = !!(opts && opts.localAiEnabled);
  const hostedAiActive = !!(opts && opts.hostedAiActive);
  const hasBrowserKey = !!(opts && opts.hasBrowserKey);
  const aiEnabled = !!(opts && opts.aiEnabled);
  const canUseHallPass = !!(opts && opts.canUseHallPass);
  const teacherServerAi = !!(opts && opts.teacherServerAi);
  let status = "AI is off";
  let meta = "Ruby High AI is included when available. Teacher chat still uses Merit Stars.";
  let primaryLabel = "Use Ruby High AI";
  let primaryTitle = canUseHallPass
    ? "Hall Passes are used for images, collectible cards, and course tools."
    : "Need " + costLabel + ". Buy Hall Passes or permanently destroy a collectible card first.";
  const aiActive = !!ai.active;
  let primaryDisabled = !authed || billingBusy || localAiEnabled || aiActive || !ai.configured || !canUseHallPass;
  let secondaryLabel = hasBrowserKey && aiEnabled ? "Disconnect my AI key" : "Use my AI key";
  const secondaryDisabled = !authed || localAiEnabled;
  if (localAiEnabled) {
    status = "On-device AI is ready";
    meta = "This device is providing the text AI.";
    primaryLabel = "On-device AI";
    primaryTitle = "";
    secondaryLabel = "Use my AI key";
  } else if (hasBrowserKey && aiEnabled) {
    status = "Your AI key is connected";
    meta = "Teacher chat and student text use your AI key. Hall Passes still pay for images, collectible cards, and course tools.";
  } else if (aiActive || hostedAiActive) {
    status = "Ruby High AI is ready";
    meta = "Ruby High provides the AI. Teacher chat uses Merit Stars.";
    primaryLabel = "Active";
    primaryTitle = "";
  } else if (teacherServerAi) {
    status = "Teacher AI is ready";
    meta = "Teachers can reply. Use your own AI key for personal AI features.";
  } else if (!ai.configured) {
    meta = "Ruby High AI is not available here. Use your own AI key instead.";
    primaryTitle = "Ruby High AI is not available here.";
  }
  return {
    status,
    meta,
    primaryLabel,
    primaryTitle,
    primaryDisabled,
    secondaryLabel,
    secondaryDisabled,
  };
}

export function accountWalletPanelView(walletInput: NullableRecord, slotsInput?: NullableRecord, opts?: NullableRecord): AccountWalletPanelView {
  const wallet = walletInput || {};
  const slots = slotsInput || {};
  const meritStars = Math.max(0, Math.round(Number(wallet.meritStars || 0)));
  const hallPasses = Math.max(0, Math.round(Number(wallet.hallPasses || 0)));
  const photoDayCredits = Math.max(0, Math.floor(Number(slots.photoDayCredits || 0)));
  const billingBusy = !!(opts && opts.billingBusy);
  const billingMode = String((opts && opts.billingMode) || "");
  return {
    balanceText: "⭐ " + formatWholeNumber(meritStars) + " · 🎫 " + formatWholeNumber(hallPasses),
    metaText: photoDayCredits > 0
      ? photoDayCredits + " Photo Day " + (photoDayCredits === 1 ? "credit" : "credits")
      : "Use Hall Passes for images, course tools, collectible cards, and extra student slots. Buy more or permanently destroy a collectible card on the Buy Hall Passes page.",
    buyPassesText: billingBusy && billingMode === "hall-passes" ? "Loading..." : "Buy Hall Passes",
    buyPassesTitle: "Buy Hall Passes for images, course tools, collectible cards, and extra student slots.",
    buyPassesDisabled: !(opts && opts.authed) || billingBusy,
  };
}

export function normalizeAccountPane(pane: unknown): AccountPaneId {
  const value = String(pane || "account");
  return value === "wallet" || value === "cards" || value === "library" || value === "receipts" || value === "trust"
    ? value
    : "account";
}

export function accountPaneItemView(id: unknown, activePane: unknown): AccountPaneItemView {
  const normalizedId = normalizeAccountPane(id);
  const selected = normalizedId === normalizeAccountPane(activePane);
  return {
    id: normalizedId,
    selected,
    classActive: selected,
    ariaSelected: selected ? "true" : "false",
    tabIndex: selected ? 0 : -1,
    hidden: !selected,
  };
}

export function accountPaneKeyTarget(key: unknown, currentIndex: unknown, tabCount: unknown): number | null {
  const count = Math.max(0, Math.floor(Number(tabCount)));
  const index = Math.floor(Number(currentIndex));
  if (count < 1 || !Number.isFinite(index) || index < 0 || index >= count) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index - 1 + count) % count;
  return null;
}

export function accountTrustPanelView(payloadInput: NullableRecord, connectedWalletInput: unknown, buildIdInput: unknown): AccountTrustPanelView {
  const payload = payloadInput && typeof payloadInput === "object" ? payloadInput : null;
  const solana = payload && payload.solana && typeof payload.solana === "object" ? payload.solana as LooseRecord : null;
  const nfts = payload && payload.nfts && typeof payload.nfts === "object" ? payload.nfts as LooseRecord : null;
  const corePacks = nfts && nfts.corePacks && typeof nfts.corePacks === "object"
    ? nfts.corePacks as LooseRecord
    : solana && solana.packNfts && typeof solana.packNfts === "object"
      ? solana.packNfts as LooseRecord
      : null;
  const connectedWallet = String(connectedWalletInput || "").trim();
  const buildId = String(buildIdInput || "dev");
  const treasury = solana && solana.recipient;
  const packCollection = corePacks && corePacks.collectionAddress;
  const cardCollection = nfts && nfts.collectionAddress;
  return {
    rows: [
      { label: "Official website", value: officialRubyHighWebsite(), href: officialRubyHighWebsite() },
      { label: "Current build", value: buildId, href: "" },
      {
        label: "Connected wallet",
        value: connectedWallet ? shortWallet(connectedWallet) : "Not connected",
        href: solanaAccountLink(connectedWallet),
      },
      {
        label: "Treasury",
        value: treasury ? shortWallet(treasury) : "Shown before wallet payment",
        href: solanaAccountLink(treasury),
      },
      {
        label: "Pack payment",
        value: "Native SOL",
        href: "",
      },
      {
        label: "Pack collection",
        value: packCollection ? shortWallet(packCollection) : "Loading configuration",
        href: solanaAccountLink(packCollection),
      },
      {
        label: "Card collection",
        value: cardCollection ? shortWallet(cardCollection) : "Loading configuration",
        href: solanaAccountLink(cardCollection),
      },
    ],
    note: "Ruby High never asks for your seed phrase. A wallet request should only ask you to sign in, pay for or open a pack, create a collectible card on Solana, or permanently destroy a collectible card.",
  };
}

export function accountHallPassCardsPanelView(
  packsInput: unknown,
  cardsInput: unknown,
  pendingMintsInput: unknown,
  opts?: NullableRecord,
): AccountHallPassCardsPanelView {
  const packs = Array.isArray(packsInput) ? packsInput.filter((pack) => pack && typeof pack === "object") as LooseRecord[] : [];
  const cards = Array.isArray(cardsInput) ? cardsInput.filter((card) => card && typeof card === "object") as LooseRecord[] : [];
  const pendingMints = Array.isArray(pendingMintsInput)
    ? pendingMintsInput.filter((card) => card && typeof card === "object") as LooseRecord[]
    : [];
  const activePacks = packs.filter((pack) => pack.status === "active");
  const activeCards = cards.filter((card) => card.status === "active");
  const mintedCards = cards.filter((card) => card.mintAddress && card.mintSignature);
  const hasSolanaWallet = !!(opts && opts.hasSolanaWallet);
  const needsWalletConnection = !hasSolanaWallet && (activePacks.length > 0 || pendingMints.length > 0);
  const pieces: string[] = [];
  if (packs.length > 0) pieces.push(activePacks.length + " unopened collectible pack" + (activePacks.length === 1 ? "" : "s"));
  if (cards.length > 0) {
    pieces.push(activeCards.length + " active collectible card" + (activeCards.length === 1 ? "" : "s"));
    if (mintedCards.length > 0) pieces.push(mintedCards.length + " collectible card" + (mintedCards.length === 1 ? "" : "s") + " on Solana");
    if (pendingMints.length > 0) {
      pieces.push(pendingMints.length + " face-down collectible card" + (pendingMints.length === 1 ? "" : "s") + " to reveal");
    }
  }
  let summaryText = needsWalletConnection
    ? "Connect a Solana wallet to open packs and reveal collectible cards."
    : pieces.length === 0
      ? "No collectible packs or cards in this wallet yet."
      : pieces.join(" · ");
  const checkout = opts && opts.checkout && typeof opts.checkout === "object" ? opts.checkout as LooseRecord : {};
  const checkoutBlocked = !!(checkout.loaded && !checkout.ready);
  const checkoutReason = String(checkout.reason || "");
  if (checkoutBlocked && checkoutReason) summaryText += " · " + checkoutReason;
  const authed = !!(opts && opts.authed);
  const billingBusy = !!(opts && opts.billingBusy);
  const billingMode = String((opts && opts.billingMode) || "");
  let mintText = "Reveal Collectible";
  let mintTitle = "No face-down collectible cards are ready to reveal.";
  if (needsWalletConnection) {
    mintText = billingBusy ? "Connecting..." : "Connect Wallet";
    mintTitle = "Connect a Solana wallet before opening packs or revealing collectible cards.";
  } else if (pendingMints.length > 0) {
    mintText = billingBusy ? "Revealing..." : "Reveal Collectible";
    mintTitle = "Create the next collectible card on Solana to reveal it.";
  }
  return {
    summaryText,
    buyText: billingBusy && billingMode === "card-packs" ? "Loading..." : "Buy Collectible Packs",
    buyTitle: !authed
      ? "Sign in to buy Ruby High collectible packs."
      : checkoutBlocked
        ? checkoutReason || "Collectible-pack checkout is unavailable right now."
        : "Buy Ruby High collectible packs.",
    buyDisabled: !authed || billingBusy || checkoutBlocked,
    mintHidden: !needsWalletConnection && pendingMints.length === 0,
    mintDisabled: !authed || billingBusy,
    mintText,
    mintTitle,
    needsWalletConnection,
  };
}

export function accountHallPassPackTileView(packInput: NullableRecord, opts?: NullableRecord): AccountHallPassPackTileView {
  const pack = packInput || {};
  const status = String(pack.status || "active");
  const packCount = Math.max(1, Math.floor(Number(pack.packCount || 1)));
  const cardCount = Math.max(packCount * VIEWER_CONSTANTS.HALL_PASS_CARDS_PER_PACK, Math.floor(Number(pack.cardCount || 0)));
  const walletReady = !!(opts && opts.walletReady);
  const authed = !!(opts && opts.authed);
  const billingBusy = !!(opts && opts.billingBusy);
  return {
    className: "account-pack-tile is-" + status,
    status,
    packCount,
    cardCount,
    imageAlt: status === "active" ? "Ruby High Pack" : "Opened Ruby High Pack",
    imageKind: status === "active" ? "active" : "opened",
    title: packCount === 1 ? "Ruby High Pack" : "Ruby High " + packCount + "-Pack",
    detail: (status === "active" ? "Collectible pack on Solana" : "Opened collectible pack")
      + " · " + formatWholeNumber(cardCount)
      + " cards · #" + String(pack.serial || "").padStart(6, "0"),
    proofLabel: status === "active" ? "View pack on Solscan" : "View pack record",
    openVisible: status === "active",
    openText: walletReady
      ? (billingBusy ? "Opening..." : "Open Pack")
      : (billingBusy ? "Connecting..." : "Connect Wallet"),
    openDisabled: !authed || billingBusy,
    openTitle: walletReady
      ? "Open this Ruby High pack and get its collectible cards."
      : "Connect a Solana wallet before opening this Ruby High pack.",
    walletReady,
  };
}

export function packLibraryCardView(packInput: NullableRecord, opts?: NullableRecord): PackLibraryCardView {
  const pack = packInput || {};
  const isDraft = !!(opts && opts.draft);
  const isSearch = !!(opts && opts.search);
  const busy = !!(opts && opts.busy);
  const active = !!pack.active;
  const canSwitch = !isDraft && !isSearch && !active;
  const name = String(pack.name || "Untitled Course");
  const source = String(pack.source || "");
  const teacherCount = Math.floor(Number(pack.facultyCount || pack.teacherCount || 0)) || 0;
  const questionCount = Math.floor(Number(pack.questionCount || 0)) || 0;
  const chips = [
    source === "official" ? "official" : source === "creator" ? "community" : pack.builtIn ? "included" : String(pack.status || "course"),
    pack.readOnly ? "view only" : pack.owner ? "yours" : "",
    isSearch && pack.installed ? "installed" : "",
    teacherCount + " teachers",
    questionCount + " questions",
  ].filter(Boolean) as string[];
  const actions: PackLibraryCardActionView[] = [];
  if (isSearch) {
    actions.push({
      kind: "search-primary",
      className: "pack-action",
      text: pack.installed ? (active ? "Current Guest" : "Choose Guest") : "Add Course",
      disabled: busy || active,
    });
  }
  if (isDraft || pack.canEdit) {
    actions.push({ kind: "edit", className: "pack-action", text: "Edit", disabled: busy });
  }
  if (!isDraft && pack.canUninstall) {
    actions.push({ kind: "uninstall", className: "pack-action", text: "Uninstall", disabled: busy });
  }
  if (pack.canDelete) {
    actions.push({ kind: "delete", className: "pack-action danger", text: "Delete", disabled: busy });
  }
  return {
    className: "pack-card-item" + (active ? " is-active" : "") + (canSwitch ? " is-clickable" : ""),
    interactive: canSwitch,
    tabIndex: busy ? -1 : 0,
    ariaLabel: (active ? "Current guest: " : "Choose as guest: ") + name,
    name,
    description: String(pack.description || (isDraft ? "Draft course." : "Ruby High course.")),
    chips,
    stateText: isDraft
      ? ""
      : isSearch
        ? active ? "Current guest" : pack.installed ? "Added" : "Not added"
        : pack.builtIn ? "Always available" : active ? "Current guest" : "Choose guest",
    actions,
  };
}

export function packTeacherRowView(teacherInput: NullableRecord, opts?: NullableRecord): PackTeacherRowView {
  const teacher = teacherInput || {};
  const busy = !!(opts && opts.busy);
  const selected = !!(opts && opts.selected);
  const titleText = String(teacher.displayName || teacher.id || "Untitled teacher");
  const initialSource = String(teacher.shortName || teacher.displayName || teacher.id || "?");
  const count = typeof teacher.questionCount === "number" ? teacher.questionCount : 0;
  const subject = String(teacher.subject || "");
  return {
    className: "pack-teacher-row" + (selected ? " is-selected" : ""),
    selectDisabled: busy,
    avatarUrl: String((opts && opts.avatarUrl) || ""),
    avatarText: initialSource.charAt(0).toUpperCase(),
    titleText,
    subtitleText: count + " question" + (count === 1 ? "" : "s") + (subject ? " · " + subject : ""),
    editDisabled: busy,
    deleteDisabled: busy,
  };
}

export function packTeacherDetailView(teacherInput: NullableRecord): PackTeacherDetailView {
  const teacher = teacherInput || null;
  if (!teacher) {
    return {
      nameText: "No teacher selected",
      metaText: "Add a teacher to set up this course.",
      descriptionText: "",
    };
  }
  const count = typeof teacher.questionCount === "number" ? teacher.questionCount : 0;
  return {
    nameText: String(teacher.displayName || teacher.id || "No teacher selected"),
    metaText: count + " questions" + (teacher.materialSourceUrl ? " · linked materials" : ""),
    descriptionText: String(teacher.description || ""),
  };
}

export function packQuestionRowView(questionInput: NullableRecord): PackQuestionRowView {
  const question = questionInput || {};
  return {
    id: String(question.id || ""),
    promptText: String(question.prompt || "Untitled question"),
    detailText: String(question.subject || "open study")
      + " · "
      + String(question.difficulty || "medium")
      + (question.answer ? " · " + String(question.answer) : ""),
    deleteText: "Delete",
  };
}

export function packQuestionListView(teacherInput: NullableRecord): PackQuestionListView {
  const teacher = teacherInput || null;
  if (!teacher) return { emptyText: "Select or add a teacher.", rows: [] };
  const questions = Array.isArray(teacher.questions) ? teacher.questions : [];
  if (questions.length === 0) return { emptyText: "No generated questions yet.", rows: [] };
  return {
    emptyText: "",
    rows: questions.map((question) => packQuestionRowView(question)),
  };
}

export function hallPassCardIsFaceDown(card: NullableRecord): boolean {
  return !card || !card.mintAddress || !card.mintSignature || card.characterId === "card-back";
}

export function hallPassCardTitle(card: NullableRecord, faceDown?: unknown): string {
  const hidden = faceDown === undefined ? hallPassCardIsFaceDown(card) : !!faceDown;
  return hidden ? "Mystery Card" : card && card.characterName ? String(card.characterName) : "Ruby High Card";
}

export function hallPassCardStatus(card: NullableRecord): string {
  if (!card) return "active";
  return card.status === "redeemed" ? "permanently destroyed" : card.status === "void" ? "unavailable" : "active";
}

export function hallPassCardDetail(card: NullableRecord, faceDown?: unknown): string {
  const hidden = faceDown === undefined ? hallPassCardIsFaceDown(card) : !!faceDown;
  if (hidden) return "Face-down collectible · reveal on Solana · #" + String(card && (card.serial || card.id) || "").slice(-6);
  const chain = card && card.mintAddress && card.mintSignature ? "Collectible on Solana" : "In-app collectible";
  return chain + " · " + String(card && card.rarity || "common") + " · " + hallPassCardStatus(card) + " · #" + String(card && (card.serial || card.id) || "").slice(-6);
}

export function accountHallPassCardTileView(cardInput: NullableRecord): AccountHallPassCardTileView {
  const card = cardInput || {};
  const faceDown = hallPassCardIsFaceDown(card);
  const title = hallPassCardTitle(card, faceDown);
  const rarity = String(card.rarity || "common").replace(/[^a-z0-9-]/gi, "");
  return {
    className: "account-card-tile is-" + String(card.status || "active")
      + " is-" + String(card.role || "student")
      + " rarity-" + rarity
      + (faceDown ? " is-face-down" : ""),
    faceDown,
    title,
    detail: hallPassCardDetail(card, faceDown),
    ariaLabel: "Open " + title,
    imageAlt: faceDown
      ? "Face-down Ruby High card"
      : card.characterName ? String(card.characterName) + " Ruby High card" : "Ruby High card",
    fallbackInitial: String(card.characterName || "R").slice(0, 1).toUpperCase(),
  };
}

export function hallPassCardDetailLabel(card: NullableRecord): string {
  if (!card) return "DETAIL";
  if (card.role === "student") return "HANGS OUT";
  if (card.role === "item") return "ITEM";
  if (card.role === "location") return "LOCATION";
  if (card.role === "special") return "SPECIAL";
  return "TEACHES";
}

export function hallPassCardProfile(cardInput: NullableRecord): AccountHallPassCardProfile | null {
  const id = String(cardInput && cardInput.characterId || "");
  const profiles: Record<string, AccountHallPassCardProfile> = {
    ruby: {
      subtitle: "Homeroom Teacher",
      teaches: "Homeroom · General Knowledge · AI Literacy · School Meta",
      stats: { head: 1, heart: 3, hustle: 2, honor: 2 },
      quote: "Let's learn together. Ask hard questions. Be kind. Have fun.",
    },
    "sally-science": {
      subtitle: "STEM Teacher",
      teaches: "Physics · Chemistry · Biology · Earth Science · Lab Thinking",
      stats: { head: 5, heart: 3, hustle: 3, honor: 4 },
      quote: "The universe doesn't hide the answer. It just asks better questions.",
    },
    "professor-edward": {
      subtitle: "Literature Teacher",
      teaches: "Postwar Literature · Literary Theory · Critical Thinking",
      stats: { head: 5, heart: 3, hustle: 1, honor: 4 },
      quote: "Context changes meaning. Curiosity finds truth.",
    },
    "captain-null": {
      subtitle: "Observatory",
      teaches: "Void Theory · Impossible Engines · Page 10",
      stats: { head: 5, heart: 2, hustle: 3, honor: 4 },
      quote: "There are stars that watch. Learn to look back.",
    },
    eliza: {
      subtitle: "Systems Lab",
      teaches: "Agents · Networks · Coordination",
      stats: { head: 5, heart: 3, hustle: 4, honor: 2 },
      quote: "Make the system legible, then make it sing.",
    },
    rati: {
      subtitle: "Signal Studies",
      teaches: "Myth · Tokens · Strange Economics",
      stats: { head: 4, heart: 3, hustle: 4, honor: 2 },
      quote: "Hold the signal. Build the world.",
    },
    lyra: {
      subtitle: "Junior · #literature",
      stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
      quote: "wait what - i KNEW it was c. ok im rewriting my notes.",
    },
    sami: {
      subtitle: "Sophomore · #homeroom",
      stats: { head: 0, heart: 1, hustle: 2, honor: -1 },
      quote: "respectfully, ouch. couldve been you.",
    },
    ravi: {
      subtitle: "Sophomore · #science",
      stats: { head: 1, heart: 1, hustle: 1, honor: -1 },
      quote: "OK so technically - wait, sorry, am i shouting again",
    },
    indra: {
      subtitle: "Junior · #literature",
      stats: { head: 2, heart: -1, hustle: 0, honor: 1 },
      quote: "the answer was always c.",
    },
    mika: {
      subtitle: "Sophomore · #science",
      stats: { head: -1, heart: 2, hustle: 1, honor: 0 },
      quote: "you cooked. for real.",
    },
    noor: {
      subtitle: "Sophomore · #homeroom",
      stats: { head: 1, heart: 1, hustle: -1, honor: 1 },
      quote: "the test designer is in this room and is laughing.",
    },
    "item-hall-pass": {
      subtitle: "Front Office",
      teaches: "Reset · grace · second chances",
      stats: { head: 0, heart: 1, hustle: 2, honor: 1 },
      quote: "Sometimes the smartest move is stepping out and coming back better.",
    },
    "item-flashcards": {
      subtitle: "Study Kit",
      teaches: "Memory · revision · exam prep",
      stats: { head: 2, heart: 0, hustle: 1, honor: 0 },
      quote: "Shuffle. Repeat. Survive.",
    },
    "item-library-card": {
      subtitle: "Quiet Wing",
      teaches: "Access · research · borrowed wisdom",
      stats: { head: 2, heart: 1, hustle: 0, honor: 1 },
      quote: "If the answer exists, this helps you find it.",
    },
    "item-lab-flask": {
      subtitle: "Science Lab",
      teaches: "Experiments · evidence · clean explanations",
      stats: { head: 1, heart: 0, hustle: 1, honor: 0 },
      quote: "Observe first. Guess later.",
    },
    "item-lunch-tray": {
      subtitle: "Commons",
      teaches: "Fuel · gossip · lunchtime diplomacy",
      stats: { head: 0, heart: 2, hustle: 1, honor: -1 },
      quote: "Half the social game happens between bites.",
    },
    "item-notebook": {
      subtitle: "Daily Carry",
      teaches: "Plans · panic · ideas in progress",
      stats: { head: 1, heart: 1, hustle: 2, honor: 0 },
      quote: "Messy notes still count as evidence of life.",
    },
    "location-homeroom": {
      subtitle: "Front Door",
      teaches: "Orientation · check-ins · general knowledge",
      stats: { head: 1, heart: 2, hustle: 0, honor: 1 },
      quote: "Where every day begins, and every question gets a room.",
    },
    "location-science-lab": {
      subtitle: "STEM Wing",
      teaches: "Physics · chemistry · biology",
      stats: { head: 2, heart: 0, hustle: 1, honor: 0 },
      quote: "Observe. Test. Explain. Repeat.",
    },
    "location-library": {
      subtitle: "Quiet Wing",
      teaches: "Literature · theory · deep reading",
      stats: { head: 2, heart: 1, hustle: -1, honor: 1 },
      quote: "If it matters, someone wrote it down.",
    },
    "location-cafeteria": {
      subtitle: "Commons",
      teaches: "Lunch · gossip · social reactions",
      stats: { head: 0, heart: 2, hustle: 1, honor: -1 },
      quote: "Half the school day happens between bites.",
    },
    "location-greenhouse": {
      subtitle: "Garden Annex",
      teaches: "Growth · reflection · biology",
      stats: { head: 1, heart: 2, hustle: 0, honor: 1 },
      quote: "Some lessons grow slowly.",
    },
    "location-courtyard": {
      subtitle: "Central Grounds",
      teaches: "Breaks · crossroads · chance encounters",
      stats: { head: 0, heart: 1, hustle: 1, honor: 1 },
      quote: "Every hallway leads somewhere. Every path leads to someone.",
    },
  };
  const profile = profiles[id];
  if (!profile) return null;
  return {
    ...profile,
    ...(profile.stats ? { stats: { ...profile.stats } } : {}),
  };
}

export function accountHallPassCardReaderView(cardInput: NullableRecord, opts?: NullableRecord): AccountHallPassCardReaderView {
  const card = cardInput || {};
  const profile = opts && opts.profile && typeof opts.profile === "object" ? opts.profile as LooseRecord : null;
  const faceDown = hallPassCardIsFaceDown(card);
  const title = hallPassCardTitle(card, faceDown);
  const billingBusy = !!(opts && opts.billingBusy);
  const authed = !!(opts && opts.authed);
  const revealed = !!(opts && opts.revealed);
  const flip = !!(opts && opts.flip);
  const revealVisible = faceDown && card.status === "active";
  return {
    panelClassName: "account-card-reader-panel" + (revealed ? " is-revealed" : ""),
    artClassName: "account-card-reader-art" + (flip ? " is-flipped" : ""),
    faceDown,
    title,
    detail: hallPassCardDetail(card, faceDown),
    artAlt: title,
    fallbackInitial: title.slice(0, 1).toUpperCase(),
    proofAddress: !faceDown && card.mintAddress ? String(card.mintAddress) : "",
    teachesVisible: !faceDown && !!profile,
    teachesLabel: hallPassCardDetailLabel(card),
    teachesText: profile ? String(profile.teaches || profile.subtitle || "Ruby High") : "",
    quoteText: !faceDown && profile && profile.quote ? "\"" + String(profile.quote) + "\"" : "",
    noteText: faceDown ? "Create this collectible card on Solana to reveal it." : "",
    revealVisible,
    revealText: billingBusy ? "Revealing..." : "Reveal on Solana",
    revealDisabled: !authed || billingBusy,
    revealTitle: "Create this collectible card with your Solana wallet to reveal it.",
  };
}

export function billingCardBurnChoiceView(opts?: NullableRecord): BillingCardBurnChoiceView {
  const hasWallet = !!(opts && opts.hasWallet);
  const burnableCards = Math.max(0, Math.floor(Number(opts && opts.burnableCards || 0)));
  const hallPassesPerBurnedCard = positiveWholeNumber(opts && opts.hallPassesPerBurnedCard, 5);
  const authed = !!(opts && opts.authed);
  const billingBusy = !!(opts && opts.billingBusy);
  const creditLabel = hallPassCostLabel(hallPassesPerBurnedCard);
  return {
    titleText: "Exchange a Collectible Card",
    metaText: hasWallet
      ? burnableCards > 0
        ? formatWholeNumber(burnableCards) + " collectible card" + (burnableCards === 1 ? "" : "s") + " can be permanently destroyed · +" + creditLabel
        : "No collectible cards on Solana can be exchanged from this wallet."
      : "Connect your Solana wallet to permanently destroy a collectible card for " + creditLabel + ".",
    buttonText: billingBusy ? "Exchanging..." : hasWallet ? "Choose Collectible Card" : "Connect Wallet",
    buttonDisabled: !authed || billingBusy || (hasWallet && burnableCards <= 0),
    buttonTitle: hasWallet
      ? burnableCards > 0
        ? "Permanently destroy one collectible card for " + creditLabel + "."
        : "No collectible cards on Solana are available to exchange."
      : "Connect a Solana wallet before exchanging a collectible card.",
  };
}

export function comicPageTitle(pageNumber: unknown): string {
  const n = Math.max(1, Math.floor(Number(pageNumber || 1)));
  return (VIEWER_CONSTANTS.FIRST_BELL_PAGE_TITLES as Record<number, string>)[n] || "First Bell";
}

export function accountComicPanelView(collectionInput: NullableRecord): AccountComicPanelView {
  const collection = collectionInput && typeof collectionInput === "object" ? collectionInput : null;
  const issueId = String((collection && collection.issueId) || "first-bell");
  const title = String((collection && collection.title) || "Ruby High: Book One - First Bell");
  const rawPageCount = Math.max(1, Math.floor(Number(collection && collection.pageCount || VIEWER_CONSTANTS.FIRST_BELL_PAGE_COUNT)));
  const pageCount = Math.min(VIEWER_CONSTANTS.FIRST_BELL_PAGE_COUNT, rawPageCount);
  const rawUnlockedPages: unknown[] = collection && Array.isArray(collection.unlockedPages) ? collection.unlockedPages : [];
  const unlockedPages = rawUnlockedPages.length > 0
    ? rawUnlockedPages
      .filter((page) => page && typeof page === "object" && Number.isFinite(Number((page as LooseRecord).pageNumber)))
      .map((page) => ({
        ...(page as LooseRecord),
        pageNumber: Math.floor(Number((page as LooseRecord).pageNumber)),
      }))
    : [];
  const byPage = new Map<number, LooseRecord>();
  unlockedPages.forEach((page) => {
    if (page.pageNumber >= 1 && page.pageNumber <= pageCount) byPage.set(page.pageNumber, page);
  });
  const unlockedCount = byPage.size;
  const tiles: AccountComicPageTileView[] = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const unlock = byPage.get(pageNumber) || null;
    const pageTitle = comicPageTitle(pageNumber);
    tiles.push({
      pageNumber,
      title: pageTitle,
      unlocked: !!unlock,
      ariaLabel: unlock ? "Open " + pageTitle : "Comic page " + pageNumber + " locked",
      unlock,
    });
  }
  return {
    issueId,
    title,
    pageCount,
    unlockedCount,
    summaryText: unlockedCount + "/" + pageCount + " pages found",
    progressText: unlockedCount + "/" + pageCount + " pages",
    tiles,
  };
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

export function worldFeedGradeLabel(grade: unknown): string {
  const key = String(grade || "");
  const labels = VIEWER_CONSTANTS.GRADE_LABELS as Record<string, string>;
  return labels[key] || (key ? "Grade " + key : "Grade");
}

// ── race strip view helpers ─────────────────────────────────────────
export function raceStripView(t: unknown, students: unknown, visibleStudentIds: unknown, playerName: unknown): {
  timer: { label: string; warn: boolean; danger: boolean; locked: boolean; soft?: boolean };
  cards: RaceStripCardView[];
} | null {
  const telemetry = t && typeof t === "object" ? t as LooseRecord : {};
  const round = telemetry.active_round && typeof telemetry.active_round === "object" ? telemetry.active_round as LooseRecord : null;
  const current = telemetry.current && typeof telemetry.current === "object" ? telemetry.current as LooseRecord : null;
  if (!round || !current || round.questionId !== current.id) return null;
  const resolved = !!round.resolved;
  const remainingMs = Math.max(0, Number(round.remainingMs ?? 0));
  const remainingS = Math.ceil(remainingMs / 1000);
  const softExpired = !resolved && (!!round.idleTriggered || remainingMs <= 0);
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
      label: resolved ? "done" : softExpired ? "open" : remainingS + "s",
      warn: !resolved && !softExpired && remainingS <= 10 && remainingS > 5,
      danger: !resolved && !softExpired && remainingS <= 5,
      locked: resolved,
      ...(softExpired ? { soft: true } : {}),
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
export function arcIndicatorView(t: unknown, subjects: unknown): ArcIndicatorView {
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
      essayVisible: false,
      essayText: "",
      essayMet: false,
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
      essayVisible: false,
      essayText: "",
      essayMet: false,
    };
  }
  const streak = character.streak && typeof character.streak === "object" ? character.streak as LooseRecord : {};
  const streakCount = streak.grade === grade ? Math.max(0, Math.floor(Number(streak.count || 0))) : 0;
  const gate = telemetry.graduation_gate && typeof telemetry.graduation_gate === "object"
    ? telemetry.graduation_gate as LooseRecord
    : {};
  const gateRequiredDays = Math.floor(Number(gate.requiredDays) || 0);
  const streakReq = gateRequiredDays > 0
    ? gateRequiredDays
    : (VIEWER_CONSTANTS.STREAK_REQUIRED as Record<string, number>)[grade] || 1;
  const subjectRecord = subjects && typeof subjects === "object" ? subjects as LooseRecord : {};
  const subjectMet = Math.max(0, Math.floor(Number(subjectRecord.met || 0)));
  const subjectTotal = Math.max(0, Math.floor(Number(subjectRecord.total || 0)));
  const essayVisible = gate.essayRequired === true;
  const essayMet = gate.essayCompleted === true;
  return {
    hidden: false,
    graduated: false,
    yearText: worldFeedGradeLabel(grade),
    streakText: "📚 " + streakCount + "/" + streakReq,
    streakMet: streakCount >= streakReq,
    subjectText: "✅ " + subjectMet + "/" + subjectTotal,
    subjectMet: subjectTotal > 0 && subjectMet >= subjectTotal,
    essayVisible,
    essayText: essayVisible ? (essayMet ? "✍️ ✓" : "✍️ due") : "",
    essayMet,
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
  publicRoomStudents?: unknown,
): RoomChannelRowView[] {
  const roomList = Array.isArray(rooms) ? rooms : [];
  const facultyList = Array.isArray(roster) ? roster : [];
  const cohortRecord = cohort && typeof cohort === "object" ? cohort as LooseRecord : {};
  const studentList = Array.isArray(students) ? students : [];
  const humanList = Array.isArray(publicRoomStudents) ? publicRoomStudents : [];
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
  const humansByFaculty = new Map<string, RoomChannelStudentView[]>();
  humanList.forEach((student) => {
    const record = student && typeof student === "object" ? student as LooseRecord : null;
    if (!record) return;
    const id = String(record.id || "");
    const name = String(record.name || "Student").trim() || "Student";
    const facultyId = String(record.facultyId || "");
    const portraitUrl = String(record.portraitUrl || "").trim();
    if (!id || !facultyId || !portraitUrl) return;
    if (!humansByFaculty.has(facultyId)) humansByFaculty.set(facultyId, []);
    humansByFaculty.get(facultyId)!.push({ ...record, id, name, facultyId, portraitUrl, kind: "human" });
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
      const npcStudents = cohortIds
        .map((id) => String(id || ""))
        .filter((id) => id && visibleIds.has(id))
        .map((id) => ({ id, name: studentNames.get(id) || id }));
      const seen = new Set(npcStudents.map((student) => student.id));
      const humanStudents = (humansByFaculty.get(facultyId) || [])
        .filter((student) => {
          if (seen.has(student.id)) return false;
          seen.add(student.id);
          return true;
        });
      return {
        roomId,
        facultyId,
        channelName: String(roomRecord.channelName || roomId || "Room"),
        isActive: !!(faculty && String(activeFacultyId || "") === facultyId),
        completionProgress,
        completionLabel: completionProgress ? roomCompletionProgressLabel(faculty, completionProgress) : "",
        students: [...npcStudents, ...humanStudents],
      };
    });
}

// ── pack pricing labels (take product + solana config as inputs) ───
export function packCountLabel(count: unknown): string {
  const n = Number.isFinite(Number(count)) && Number(count) > 0 ? Math.floor(Number(count)) : 1;
  return formatWholeNumber(n) + " Pack" + (n === 1 ? "" : "s");
}
export function cardPackDebitLabel(product: NullableRecord, solana: NullableRecord): string {
  const amount = product && product.solAmount != null
    ? product.solAmount
    : solana && solana.solAmount;
  return "Solana payment: " + formatSolDisplayAmount(amount) + " SOL";
}
export function cardPackCreditLabel(product: NullableRecord): string {
  const count = product && Number.isFinite(Number(product.packCount)) ? Number(product.packCount) : 1;
  return "+" + packCountLabel(count);
}
export function cardPackPaymentDeltaLabel(product: NullableRecord, solana: NullableRecord): string {
  return cardPackDebitLabel(product, solana) + " · " + cardPackCreditLabel(product);
}
export function cardPackProductMeta(product: NullableRecord, solana: NullableRecord): string {
  const cardCount = Math.max(1, Math.floor(Number(product && product.cardCount || VIEWER_CONSTANTS.HALL_PASS_CARDS_PER_PACK)));
  return cardPackPaymentDeltaLabel(product, solana) + " · " + formatWholeNumber(cardCount) + " cards";
}
export function billingCardPackPaymentChoiceView(
  solanaInput: NullableRecord,
  productInput: NullableRecord,
  opts?: NullableRecord,
): BillingCardPackPaymentChoiceView {
  const solana = solanaInput && typeof solanaInput === "object" ? solanaInput : {};
  const product = productInput && typeof productInput === "object" ? productInput : {};
  const cryptoUnavailable = !!(opts && opts.cryptoUnavailable);
  const canPackCheckout = !!(opts && opts.canPackCheckout);
  const billingBusy = !!(opts && opts.billingBusy);
  return {
    titleText: "Buy " + (product.name || packCountLabel(product.packCount)),
    metaText: cardPackProductMeta(product, solana),
    buttonText: cryptoUnavailable ? "Wallet checkout unavailable" : "Buy Collectible Pack",
    buttonDisabled: billingBusy || cryptoUnavailable || !canPackCheckout,
    buttonTitle: cryptoUnavailable
      ? "Collectible-pack checkout needs wallet support."
      : !canPackCheckout
        ? "Collectible-pack checkout is unavailable. Try again later."
        : "Pay with Solana wallet.",
    noteText: cryptoUnavailable
      ? "Collectible-pack checkout is not available in this preview."
      : !canPackCheckout
        ? "Collectible-pack checkout is unavailable. Try again later."
        : "",
    showGetRubyLink: false,
  };
}
export function billingProductRowView(
  modeInput: unknown,
  productInput: NullableRecord,
  solanaInput?: NullableRecord,
  opts?: NullableRecord,
): BillingProductRowView {
  const mode = modeInput === "card-packs" ? "card-packs" : "hall-passes";
  const product = productInput && typeof productInput === "object" ? productInput : {};
  const solana = solanaInput && typeof solanaInput === "object" ? solanaInput : {};
  const explicitHallPasses = Number(product.hallPasses);
  const hallPasses = Number.isFinite(explicitHallPasses) && explicitHallPasses > 0 ? Math.floor(explicitHallPasses) : 1;
  const selected = !!(opts && opts.selected);
  const billingBusy = !!(opts && opts.billingBusy);
  return {
    titleText: mode === "card-packs"
      ? String(product.name || packCountLabel(product.packCount))
      : String(product.name || hallPassCostLabel(hallPasses)),
    metaText: mode === "card-packs"
      ? cardPackProductMeta(product, solana)
      : formatMoney(product.unitAmount, product.currency) + " · " + hallPassCostLabel(hallPasses),
    buttonText: selected ? "Selected" : "Choose",
    buttonDisabled: billingBusy,
    selected,
  };
}
export function billingProductsPanelView(
  modeInput: unknown,
  payloadInput: NullableRecord,
  solanaInput?: NullableRecord,
  opts?: NullableRecord,
): BillingProductsPanelView {
  const mode = modeInput === "card-packs" ? "card-packs" : "hall-passes";
  const payload = payloadInput && typeof payloadInput === "object" ? payloadInput : {};
  const solana = solanaInput && typeof solanaInput === "object" ? solanaInput : null;
  const hallPassesPerBurnedCard = Math.max(1, Math.floor(Number(opts && opts.hallPassesPerBurnedCard || 5)));
  const isCardPacks = mode === "card-packs";
  return {
    titleText: isCardPacks ? "Buy Collectible Packs" : "Buy Hall Passes",
    subtitleText: isCardPacks
      ? "These collectible packs are stored on Solana. Open one to get five face-down Ruby High cards."
      : "Buy Hall Passes or permanently destroy one collectible card to get 5.",
    cardPackCostLabels: isCardPacks
      ? [
        "Each collectible pack: " + VIEWER_CONSTANTS.HALL_PASS_CARDS_PER_PACK + " cards",
        "Permanently destroy 1 collectible card: get " + hallPassCostLabel(hallPassesPerBurnedCard),
      ]
      : [],
    showGetRubyCostLink: false,
    emptyStatusText: isCardPacks ? "No collectible packs are available." : "No Hall Passes are available.",
    checkoutStatusText: isCardPacks
      ? (solana && solana.configured ? "" : "Collectible-pack checkout is not available here.")
      : (payload.configured ? "" : "Card payment is not available here."),
    checkoutStatusError: isCardPacks
      ? !(solana && solana.configured)
      : !payload.configured,
  };
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
export function normalizeScientificNotationForDisplay(value: unknown): string {
  const text = String(value == null ? "" : value);
  const superscript: Record<string, string> = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "+": "⁺", "-": "⁻", "−": "⁻",
  };
  const subscript: Record<string, string> = {
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
    "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
    "+": "₊", "-": "₋", "−": "₋",
  };
  const scriptText = (raw: string, chars: Record<string, string>, fallback: string): string => {
    const compact = raw.replace(/\s+/g, "");
    if (!compact || Array.from(compact).some((char) => !chars[char])) return fallback;
    return Array.from(compact).map((char) => chars[char]).join("");
  };
  const readableMath = (raw: string): string => {
    let math = raw.trim();
    math = math.replace(/\^\s*\\circ(?![A-Za-z])/g, "°");
    math = math.replace(/\\(?:text|mathrm|operatorname)\{([^{}]*)\}/g, "$1");
    math = math.replace(/\\(?:times|cdot)(?![A-Za-z])/g, " × ");
    math = math.replace(/\\pm(?![A-Za-z])/g, "±").replace(/\\(?:leq|le)(?![A-Za-z])/g, "≤").replace(/\\(?:geq|ge)(?![A-Za-z])/g, "≥");
    math = math.replace(/\\(?:left|right)(?![A-Za-z])/g, "");
    math = math.replace(/\\[,;:]\s*/g, " ").replace(/\\!\s*/g, "");
    math = math.replace(/\^\{([^{}]+)\}/g, (match, exponent) => scriptText(exponent, superscript, match));
    math = math.replace(/\^([+\-−0-9])/g, (match, exponent) => scriptText(exponent, superscript, match));
    math = math.replace(/_\{([^{}]+)\}/g, (match, index) => scriptText(index, subscript, match));
    math = math.replace(/_([+\-−0-9])/g, (match, index) => scriptText(index, subscript, match));
    math = math.replace(/\s*=\s*/g, " = ").replace(/\s*×\s*/g, " × ");
    return math.replace(/\s+/g, " ").trim();
  };

  // Leave examples inside Markdown code spans/fences untouched. Generated
  // teacher prose commonly uses TeX delimiters, while code samples may be
  // intentionally showing that syntax to the student.
  return text.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, index) => {
    if (index % 2 === 1) return part;
    return part.replace(/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g, (_match, inline, block) => {
      return readableMath(inline ?? block ?? "");
    });
  }).join("");
}
export function sanitizeVisibleChatText(value: unknown): string {
  let text = normalizeScientificNotationForDisplay(value);
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
