import type { ViewerRenderOptions } from "../viewer.js";
import { createViewerApiClient, withViewerTimeoutSignal } from "./api.js";
import { consumeViewerSseStream, parseViewerSseFrames } from "./sse.js";
import { createViewerTurnController } from "./turn-controller.js";

// Returns the SPA viewer's inline JS as a string. Threads only the
// per-session opts that bootstrap the client (apiBase, sessionId, role) —
// everything else is plain client code that talks to the server via
// /session/<id> and /command. Kept as a single string so the whole
// thing remains a no-build viewer (no bundler step needed for a quick
// edit).
//
// The body is split: a tiny per-request prefix that pins the bootstrap
// constants, and a static suffix (~4k LOC) that's identical for every
// caller. The suffix is built once when this module is first imported
// (VIEWER_SCRIPT_SUFFIX) instead of being re-allocated per request.
export function viewerScript(opts: ViewerRenderOptions): string {
  const safeSession = encodeURIComponent(opts.sessionId);
  const safeApiBase = encodeURIComponent(opts.apiBase);
  const role = opts.role === "agent" ? "agent" : "human";
  return `
(() => {
  const apiBase = decodeURIComponent("${safeApiBase}");
  const sessionId = decodeURIComponent("${safeSession}");
  const role = "${role}";
  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register(apiBase + "/service-worker.js", { scope: apiBase + "/" })
        .catch(() => {});
    });
  }` + VIEWER_SCRIPT_SUFFIX;
}

// Everything below `const role = ...` in the original IIFE — invariant
// across requests. Built once at module load.
const VIEWER_SCRIPT_SUFFIX = `
  // iOS Safari ignores user-scalable=no in the viewport meta (Apple removed
  // it for accessibility, and maximum-scale=1 also gets ignored on some
  // versions). Cancel the gesture* events explicitly to keep pinch-zoom
  // from happening on the app surface — when the viewport is wider than
  // the layout expects, zoom-in makes the overflow worse, not better.
  // Pan and tap still work; only the pinch-zoom gesture is suppressed.
  document.addEventListener("gesturestart", (e) => { e.preventDefault(); }, { passive: false });
  document.addEventListener("gesturechange", (e) => { e.preventDefault(); }, { passive: false });
  document.addEventListener("gestureend", (e) => { e.preventDefault(); }, { passive: false });
  // Block double-tap zoom on iOS without disabling double-click in JS.
  document.addEventListener("dblclick", (e) => {
    const el = e.target;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
    e.preventDefault();
  }, { passive: false });

  const sessionUrl = apiBase + "/session/" + encodeURIComponent(sessionId);
  const commandUrl = sessionUrl + "/command";
  const GRADE_LABELS = { "9": "Freshman", "10": "Sophomore", "11": "Junior", "12": "Senior" };
  const GRADE_SHORT_LABELS = { "9": "Fresh", "10": "Soph", "11": "Junior", "12": "Senior" };
  const GRADE_ORDER = ["9", "10", "11", "12"];
  // Mirrored from types.ts: passed-daily-class gates by year.
  const STREAK_REQUIRED       = { "9": 1, "10": 2, "11": 3, "12": 4 };
  const TEACHING_FACULTY_IDS  = ["ruby", "sally-science", "professor-edward"];
  const TEACHING_FACULTY_LABELS = { ruby: "Homeroom", "sally-science": "Science", "professor-edward": "Literature" };
  const LOUNGE_ID = "lounge";
  const STAT_META = {
    head:   { emoji: "🧠", label: "Head" },
    heart:  { emoji: "💗", label: "Heart" },
    hustle: { emoji: "⚡", label: "Hustle" },
    honor:  { emoji: "🛡️", label: "Honor" },
  };
  function statLabel(stat) {
    const meta = STAT_META[String(stat || "").toLowerCase()];
    return meta ? meta.emoji + " " + meta.label : "🧠 Head";
  }
  function scoreAwardLabel(award) {
    if (!award) return "";
    const points = Math.max(0, Math.round(Number(award.points || 0)));
    const mult = Math.max(1, Math.round(Number(award.multiplier || 1)));
    if (mult >= 5) return "+" + points + " Merit Stars · Daily Class ×5";
    return "+" + points + " Merit Stars" + (mult > 1 ? " · ×" + mult : "");
  }
  function letterGradePasses(grade) {
    return /^[ABC]/.test(String(grade || ""));
  }
  function letterGradeForScore(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return "—";
    if (n >= 90) return "A";
    if (n >= 80) return "B";
    if (n >= 70) return "C";
    if (n >= 60) return "D";
    return "F";
  }
  function streakScoreMultiplier(count) {
    const n = Math.max(0, Math.floor(Number(count || 0)));
    if (n >= 4) return 5;
    if (n >= 3) return 3;
    if (n >= 2) return 2;
    return 1;
  }
  function subjectProgressForFaculty(fid) {
    const roster = (lastTelemetry && lastTelemetry.faculty_roster) || [];
    return roster.find((f) => f.id === fid) || null;
  }
  function teacherShortName(faculty, fallback) {
    return (faculty && (faculty.shortName || faculty.displayName)) || fallback || "Teacher";
  }
  function questionsLeftInClass(today) {
    const total = Number(today && today.totalQuestions || 3);
    const done = Number(today && today.questionCount || 0);
    return Math.max(0, total - done);
  }
  function questionsLeftText(today) {
    const left = questionsLeftInClass(today);
    if (left <= 0) return "daily class complete";
    return left + " " + (left === 1 ? "question" : "questions") + " left";
  }
  function questionsLeftSentence(today) {
    const left = questionsLeftInClass(today);
    if (left <= 0) return "Daily class complete";
    return (left === 1 ? "There is " : "There are ") + questionsLeftText(today);
  }
  function classGradeForFaculty(fid) {
    const progress = subjectProgressForFaculty(fid);
    return (progress && progress.courseGrade) || "—";
  }
  function subjectStatusText(progress) {
    if (!progress) return "settling in";
    const grade = progress.grade || "—";
    const done = Number(progress.completedClasses || 0);
    const required = Number(progress.requiredClasses || 0);
    const today = progress.today || {};
    if (today.status === "complete") {
      return "daily class complete" + (today.letterGrade ? " · " + today.letterGrade : "") + " · " + grade;
    }
    if (today.status === "active") {
      return questionsLeftText(today) + " · " + grade;
    }
    return done + "/" + required + " daily classes · " + grade;
  }
  function postClassState(t) {
    const progress = t && t.active_course_progress;
    const report = !!(t && activeDailyClassIsComplete(t) && !t.current && !t.graduation_ready);
    const nextRole = (progress && progress.nextCardRole) || "";
    const canPick = scheduledCanPick(t);
    return {
      report,
      nextRole,
      canPick,
      socialReady: report && canPick && nextRole === "social",
      practiceReady: report && canPick && nextRole !== "social",
    };
  }
  function nextQuestionButtonLabel(t) {
    t = t || lastTelemetry;
    if (t && t.graduation_ready && !t.current) return "Ceremony";
    const round = t && t.active_round;
    const cur = t && t.current;
    if (round && !round.resolved && cur) return "Chat";
    if (cur && (currentRevealMatches(t) || t.status === "revealed")) return "Continue";
    const postClass = postClassState(t);
    if (postClass.socialReady) return "Start Social Card";
    if (postClass.report) return "Practice";
    return "Chat";
  }
  function updateChatAction(mode) {
    if (!els.nextBtn) return;
    const available = !!authed && mode !== "needs-auth" && mode !== "needs-character" && mode !== "checking-auth";
    // When the player is in an active typed/opinion round, the typed-answer
    // host has its own SEND button — hide the bottom Chat action so the
    // player sees one button, not two side-by-side.
    const t = lastTelemetry;
    const round = t && t.active_round;
    const cur = t && t.current;
    const ceremonyReady = !!(t && t.graduation_ready && !cur);
    const inFreeformRound = !!(
      round && !round.resolved && cur
      && (t.is_opinion || cur.type === "typed-answer" || cur.type === "image-occlusion")
    );
    els.nextBtn.hidden = !available || inFreeformRound || ceremonyReady;
    els.nextBtn.textContent = nextQuestionButtonLabel(t);
    const live = !!(round && !round.resolved && cur);
    const postClass = postClassState(t);
    els.nextBtn.title = live
      ? "Ask for a hint"
      : cur && currentRevealCompletedClass(t)
        ? "Show the class report"
        : cur
        ? "Continue"
      : postClass.socialReady
        ? "Start the next social card"
        : postClass.report
        ? "Start practice"
        : t && t.graduation_ready && !cur
        ? "Open the graduation ceremony"
        : "Advance the room";
  }
  function teachingFacultyIdsForSummary() {
    const roster = (lastTelemetry && lastTelemetry.faculty_roster) || [];
    const ids = roster
      .filter((f) => f && f.id !== LOUNGE_ID && (
        f.courseGrade || f.todayClass || f.completedClasses !== undefined || f.requiredClasses !== undefined
      ))
      .map((f) => f.id);
    return ids.length > 0 ? ids : TEACHING_FACULTY_IDS;
  }
  function subjectClearSummary() {
    const grades = teachingFacultyIdsForSummary().map((fid) => ({
      facultyId: fid,
      grade: classGradeForFaculty(fid),
      progress: subjectProgressForFaculty(fid),
    }));
    const met = grades.filter((g) => {
      const p = g.progress || {};
      const completed = Number(p.completedClasses || 0);
      const required = Number(p.requiredClasses || 0);
      return required > 0 && completed >= required && letterGradePasses(g.grade);
    }).length;
    return { grades, met, total: grades.length };
  }
  function finalGradeSummary() {
    const rows = teachingFacultyIdsForSummary().map((fid) => {
      const progress = subjectProgressForFaculty(fid) || {};
      const score = Number(progress.averageScore);
      return {
        facultyId: fid,
        score: Number.isFinite(score) ? score : null,
        grade: progress.courseGrade || progress.grade || classGradeForFaculty(fid),
      };
    });
    const scored = rows.filter((row) => row.score != null);
    const averageScore = scored.length > 0
      ? Math.round(scored.reduce((sum, row) => sum + row.score, 0) / scored.length)
      : null;
    return {
      rows,
      scored: scored.length,
      total: rows.length,
      averageScore,
      letter: averageScore == null ? "—" : letterGradeForScore(averageScore),
    };
  }
  function activeDailyClassIsComplete(t) {
    const today = t && t.active_course_progress && t.active_course_progress.today;
    return !!(today && today.status === "complete");
  }
  function classReportKey(t) {
    const progress = t && t.active_course_progress;
    const today = progress && progress.today;
    if (!progress || !today || today.status !== "complete") return "";
    return [
      progress.facultyId || t.faculty || "",
      t.current_grade || "",
      today.date || "",
      progress.completedClasses || 0,
      today.letterGrade || "",
      today.score == null ? "" : Math.round(Number(today.score)),
    ].join(":");
  }
  function shouldShowClassReport(t) {
    const key = classReportKey(t);
    return !!(key && !t.current && !t.graduation_ready && key !== shownClassReportKey);
  }
  function currentRevealMatches(t) {
    return !!(t && t.current && t.lastReveal && t.lastReveal.questionId === t.current.id);
  }
  function currentRevealCompletedClass(t) {
    if (!currentRevealMatches(t)) return false;
    const cp = t.lastReveal && t.lastReveal.classProgress;
    return !!(cp && cp.mode === "class" && cp.completed);
  }
  function telemetryPhase(t) {
    if (!t) return "in-room";
    if (t.phase) return t.phase;
    if (t.faculty === LOUNGE_ID) return "lounge";
    if (t.current && t.active_round && !t.active_round.resolved) return "asking";
    if (currentRevealMatches(t) || t.status === "revealed") return "revealed";
    return "in-room";
  }
  function formatClassScore(score) {
    const n = Number(score);
    return Number.isFinite(n) ? Math.round(n) + "%" : "—";
  }
  function formatWholeNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
  }

  // Build the chalkboard's subject-grade row — three pills (Homeroom /
  // Science / Literature) showing the player's letter standing in each
  // subject for the active grade. Rendered into the empty-board state so
  // the player can see where they stand without opening the School Career
  // sheet. SUBJECT_GATE_META and makeSubjectGradeChip are defined further
  // down (function declarations are hoisted within the IIFE).
  function buildBoardSubjectGrades() {
    const t = lastTelemetry;
    if (!t || !t.character || !t.current_grade) return null;
    const summary = subjectClearSummary();
    const wrap = document.createElement("div");
    wrap.className = "board-subject-grades";
    const heading = document.createElement("div");
    heading.className = "board-subject-grades-title";
    heading.textContent = (GRADE_LABELS[t.current_grade] || ("Grade " + t.current_grade)) + " · " + summary.met + "/" + summary.total + " subjects cleared";
    wrap.appendChild(heading);
    const row = document.createElement("div");
    row.className = "board-subject-grades-row";
    for (const g of summary.grades) {
      const meta = SUBJECT_GATE_META.find((m) => m.facultyId === g.facultyId)
        || { facultyId: g.facultyId, label: (g.progress && g.progress.displayName) || g.facultyId, icon: "□" };
      const p = g.progress || {};
      const completed = Number(p.completedClasses || 0);
      const required = Number(p.requiredClasses || 0);
      const met = required > 0 && completed >= required && letterGradePasses(g.grade);
      row.appendChild(makeSubjectGradeChip({
        label: meta.label,
        icon: meta.icon,
        grade: g.grade || "—",
        met,
      }));
    }
    wrap.appendChild(row);
    return wrap;
  }

  // ── auth credential (client-owned) ───────────────────────────────────────
  // The OpenRouter API key lives ONLY in localStorage. The OAuth callback
  // tab writes it; same-origin storage events fan it out to other tabs;
  // every API call attaches it via the X-Openrouter-Key header. The server
  // never persists it; server-side auth stores only an opaque app session.
  const AUTH_KEY = "rh_openrouter_key";
  const AUTH_LABEL = "rh_openrouter_label";
  function getStoredApiKey() {
    try { return localStorage.getItem(AUTH_KEY) || null; } catch (e) { return null; }
  }
  function getStoredAuthLabel() {
    try { return localStorage.getItem(AUTH_LABEL) || null; } catch (e) { return null; }
  }
  function clearStoredAuth() {
    try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
    try { localStorage.removeItem(AUTH_LABEL); } catch (e) {}
    try { localStorage.removeItem("rh_openrouter_at"); } catch (e) {}
  }
  const COMMAND_TIMEOUT_MS = 15000;
  const PLAYER_LINE_TIMEOUT_MS = 12000;
  const STREAM_CONNECT_TIMEOUT_MS = 15000;
  const SESSION_REFRESH_TIMEOUT_MS = 8000;

  ${withViewerTimeoutSignal.toString()}
  ${createViewerApiClient.toString()}

  // ── AI students ──────────────────────────────────────────────────────────
  const STUDENTS = [
    { id: "lyra",  name: "Lyra",   color: "#ff6f91" },
    { id: "sami",  name: "Sami",   color: "#36c2cc" },
    { id: "ravi",  name: "Ravi",   color: "#ffb05a" },
    { id: "indra", name: "Indra",  color: "#a06bff" },
    { id: "mika",  name: "Mika",   color: "#52c673" },
    { id: "noor",  name: "Noor",   color: "#ec4f9e" },
  ];
  const STUDENT_LINES_RIGHT = ["nice","yo same","easy","ok smart kid","first try??","atta way","lock in","bro really did that","fr"];
  const STUDENT_LINES_WRONG = ["ouch","i picked the same","tricky","happens","hated that one","next time fr","ngl me too"];
  const STUDENT_LINES_GREET = ["yo","hey","what's up","let's go","first one easy plz","ready"];
  const pickRandom = (a) => a[Math.floor(Math.random() * a.length)];
  function studentNameById(id) {
    const s = STUDENTS.find((entry) => entry.id === id);
    return s ? s.name : id;
  }
  // Pick the 2 students currently in the active room (driven by the server's
  // (grade, room) cohort pairing). Falls back to a deterministic subset when
  // we don't yet have telemetry.
  function studentsInRoom() {
    if (lastTelemetry && lastTelemetry.room_cohort && lastTelemetry.faculty) {
      const room = (lastTelemetry.rooms || []).find((r) => r.teacherId === lastTelemetry.faculty);
      const ids = (room && lastTelemetry.room_cohort[room.id]) || [];
      const found = ids
        .map((sid) => STUDENTS.find((s) => s.id === sid))
        .filter(Boolean)
        .filter((s) => shouldShowStudentId(s.id));
      if (found.length > 0) return found;
    }
    return STUDENTS.filter((s) => shouldShowStudentId(s.id)).slice(0, 2);
  }
  function studentsForGrade(_grade) { return studentsInRoom(); }

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const els = {
    shell: $("shell"),
    serversRail: $("servers-rail"),
    channelsRail: $("channels-rail"),
    homeBtn: $("home-btn"),
    gradeTitle: $("grade-title"),
    channelsList: $("channels-list"),
    youAvatar: $("you-avatar"),
    youName: $("you-name"),
    youState: $("you-state"),
    footerAction: $("footer-action"),
    hamburger: $("hamburger"),
    channelTitle: $("channel-title"),
    channelSub: $("channel-sub"),
    arcIndicator: $("arc-indicator"),
    arcYear: $("arc-year"),
    arcStreak: $("arc-streak"),
    arcXp: $("arc-xp"),
    arcScore: $("arc-score"),
    hallPassBtn: $("hall-pass-btn"),
    packBtn: $("pack-btn"),
    stream: $("stream"),
    blackboardPanel: $("blackboard-panel"),
    loungeStage: $("lounge-stage"),
    loungeFigures: $("lounge-figures"),
    teacherFigure: $("teacher-figure"),
    blackboardEmpty: $("blackboard-empty"),
    blackboardEmptyText: $("blackboard-empty-text"),
    // (Today's-challenge banner removed — bonus path is no longer
    //  surfaced as a chrome banner. The bonus endpoint stays alive
    //  on the server for future re-introduction.)
    reportBugLink: $("report-bug-link"),
    bugReportOverlay: $("bug-report-overlay"),
    bugReportClose: $("bug-report-close"),
    bugReportCancel: $("bug-report-cancel"),
    bugReportForm: $("bug-report-form"),
    bugReportText: $("bug-report-text"),
    bugReportSubmit: $("bug-report-submit"),
    bugReportStatus: $("bug-report-status"),
    blackboardMeta: $("blackboard-meta"),
    boardFrameHost: $("board-frame-host"),
    boardPrompt: $("board-prompt"),
    boardReveal: $("board-reveal"),
    answersHost: $("answers-host"),
    answers: Array.from(document.querySelectorAll(".answer")),
    typedAnswerHost: $("typed-answer-host"),
    typedAnswerForm: $("typed-answer-form"),
    typedAnswerInput: $("typed-answer-input"),
    typedSubmitBtn: $("typed-submit-btn"),
    generateMcBtn: $("generate-mc-btn"),
    advantageBar: $("advantage-bar"),
    advantageBtn: $("advantage-btn"),
    advantageResult: $("advantage-result"),
    blackboardFoot: $("blackboard-foot"),
    nextBtn: $("next-btn"),
    raceStrip: $("race-strip"),
    raceRow: $("race-row"),
    timerPill: $("timer-pill"),
    timerLabel: $("timer-label"),
    composerZone: $("composer-zone"),
    chatForm: $("chat-form"),
    chatInput: $("chat-input"),
    chatSend: $("chat-send"),
    signinGuest: $("signin-guest"),
    signinStatus: $("signin-status"),
    checking: $("checking"),
    scrim: $("scrim"),
    congrats: $("congrats-toast"),
    billingOverlay: $("billing-overlay"),
    billingClose: $("billing-close"),
    billingWallet: $("billing-wallet"),
    billingCosts: $("billing-costs"),
    billingProducts: $("billing-products"),
    billingStatus: $("billing-status"),
  };

  // ── view state ────────────────────────────────────────────────────────────
  let lastTelemetry = null;
  let lastRosterSig = "";
  let lastRevealId = null;
  let lastAnswerGradedTriggerId = null;
  let lastIdleTriggerId = null;
  let authed = null; // app-owned Ruby High session ready
  let aiEnabled = false; // Local/OpenRouter text AI + Ruby High session present
  let localAiEnabled = false;
  function activeTeacherUsesServerAi() {
    const provider = lastTelemetry && lastTelemetry.active_teacher_provider;
    return !!(provider && provider.requiresBrowserKey === false);
  }
  function teacherChatEnabled() {
    return !!authed && (aiEnabled || activeTeacherUsesServerAi());
  }
  let lockedFor = null;
  let renderedHistorySig = null;
  let activeQuestionId = null; // currently displayed question id on the blackboard
  let questionCounter = 0;     // session-local question count for "Question N" label
  let lastShownGrade = null;
  let shownClassReportKey = null;
  // Tracks the yearbook's length on the previous telemetry tick so we
  // can detect Senior completion (the only grade transition that
  // doesn't change current_grade). null on first boot — same suppress-
  // toast-on-first-tick semantics as lastShownGrade.
  let lastYearbookLen = null;
  let lastShownFaculty = null;
  let lastChatButtonAt = 0;
  let lastAgentTrigger = null; // dedupe key so we don't re-fire on poll
  let lastSocialSummaryId = null;
  let billingProductsCache = null;
  let billingBusy = false;
  let chatViewSeq = 0;         // bumps on room/lounges switches; invalidates stale history/SSE work
  function setNextButtonDisabled(disabled) {
    if (els.nextBtn) els.nextBtn.disabled = !!disabled;
  }
  function setChatComposerDisabled(disabled) {
    els.chatInput.disabled = !!disabled;
    els.chatSend.disabled = !!disabled;
  }
  ${createViewerTurnController.toString()}
  ${parseViewerSseFrames.toString()}
  ${consumeViewerSseStream.toString()}
  const turnController = createViewerTurnController({
    setNextButtonDisabled,
    setChatComposerDisabled,
    teacherChatEnabled,
    currentViewSeq() { return chatViewSeq; },
    currentFaculty() { return lastTelemetry && lastTelemetry.faculty; },
  });
  function syncNextButtonDisabled() {
    turnController.syncControls();
  }
  // Auto-start guard: when the player lands in a teaching room with an
  // empty board (no current question, no live round), kick off the next
  // class question without waiting for the AI to call pose_question via a
  // tool call. Works in both AI and offline mode — in AI mode the teacher's
  // chat reaction still runs (and its tool call no-ops when a board is
  // already live). lastAutoPickKey tracks (faculty|grade|today) so we
  // don't retry within the same context until something changes.
  let autoPickInFlight = false;
  let autoPickLastKey = null;
  // One-shot hint when the bank runs dry and AI is off — saves the player
  // from staring at an empty chalkboard with no signal that the system is
  // working as intended. Reset on context change.
  let emptyBoardHintShown = false;
  function scheduledReadyCount(t) {
    const progress = t && t.active_course_progress;
    return Number(progress && progress.ready || 0);
  }
  function scheduledCanPick(t) {
    const progress = t && t.active_course_progress;
    if (!progress) return scheduledReadyCount(t) > 0;
    if (typeof progress.canPick === "boolean") return progress.canPick;
    return scheduledReadyCount(t) > 0;
  }
  function showNoScheduledQuestionReadyHint() {
    if (emptyBoardHintShown) return;
    appendSystem("No scheduled question is ready. Connect AI to continue with custom questions, or come back tomorrow.");
    emptyBoardHintShown = true;
  }
  // Reset the guards above whenever the player walks into a new context
  // (faculty change, lounge entry, grade selection). Without this, the
  // dedupe key from a prior visit silently blocks channel-enter on revisit:
  // "I went back to Ruby's room and she didn't greet me."
  function resetAgentGuards() {
    lastAgentTrigger = null;
    lastRevealId = null;
    lastSocialSummaryId = null;
    lastAnswerGradedTriggerId = null;
    lastIdleTriggerId = null;
    autoPickLastKey = null;
    emptyBoardHintShown = false;
  }

  // True when the player is sitting in a teaching room with an empty
  // board, ready for a question to land. Excludes lounge, graduation
  // states, completed daily classes, and any time a question is already
  // up. Used by the auto-start logic so the player isn't stuck waiting
  // for the AI in offline mode.
  function shouldAutoStartClass(t) {
    if (!t || !t.character) return false;
    if (graduatedFor(t.character)) return false;
    if (t.character.pendingGraduation) return false;
    if (t.graduation_ready) return false;
    if (t.faculty === LOUNGE_ID) return false;
    if (t.current) return false;
    if (t.active_round && !t.active_round.resolved) return false;
    const today = t.active_course_progress && t.active_course_progress.today;
    if (today && today.status === "complete") return false;
    return true;
  }
  function hasCompletedAnyClass(t) {
    if (!t || !t.character) return false;
    const character = t.character;
    if (Array.isArray(character.yearbook) && character.yearbook.length > 0) return true;
    const dailyRecords = Object.values(character.dailyClasses || {});
    if (dailyRecords.some((record) => record && record.status === "complete")) return true;
    const roster = Array.isArray(t.faculty_roster) ? t.faculty_roster : [];
    return roster.some((f) =>
      Number(f.completedClasses || 0) > 0
      || !!(f.todayClass && f.todayClass.status === "complete")
    );
  }
  function secondarySurfacesUnlocked(t) {
    if (!t || !t.character) return false;
    if (graduatedFor(t.character)) return true;
    if (t.character.pendingGraduation || t.graduation_ready) return true;
    return hasCompletedAnyClass(t);
  }
  function packStoreUnlocked(t) {
    if (!t || !t.character) return false;
    return true;
  }
  async function maybeAutoStartClass(t) {
    if (autoPickInFlight) return;
    if (!shouldAutoStartClass(t)) return;
    const progress = t.active_course_progress || {};
    const today = progress.today || {};
    const ready = scheduledReadyCount(t);
    const canPick = scheduledCanPick(t);
    const questionCount = Number(today.questionCount || 0);
    const todayKey = (t.daily && t.daily.dailyKey) || today.dailyKey || "";
    const phaseToken = t.phaseToken == null ? "legacy" : t.phaseToken;
    const key = (t.faculty || "") + "|" + (t.current_grade || "") + "|" + todayKey + "|" + phaseToken + "|" + questionCount + "|" + ready + "|" + canPick + "|" + (progress.nextCardRole || "");
    if (key === autoPickLastKey) return;
    // Scheduler state: the deterministic path can post banked cards and
    // generated Ruby social cards. When it cannot post, auto-pick would only
    // hit the service's "No scheduled question is due" guard.
    //   - AI on  → fire a manual chat turn so the teacher can pose_question.
    //   - AI off → sit on the empty board and surface the offline hint once.
    if (!canPick) {
      autoPickLastKey = key;
      if (teacherChatEnabled()) {
        runAgentTurn("manual", { grade: t.current_grade }, { force: true });
      } else {
        showNoScheduledQuestionReadyHint();
      }
      return;
    }
    autoPickLastKey = key;
    autoPickInFlight = true;
    try {
      const data = await command({ type: "pick" });
      if (data && data.noQuestionDue) {
        if (teacherChatEnabled()) runAgentTurn("manual", { grade: t.current_grade }, { force: true });
        else showNoScheduledQuestionReadyHint();
      }
    }
    catch { /* errors already surface via appendSystem in command() */ }
    finally { autoPickInFlight = false; }
  }
  let opinionSubmitted = false; // player's text has been recorded for current round
  let opinionSubmittedQuestionId = null;
  let opinionGradeFired = false; // grading has been triggered for current round
  let typedSubmitting = false;
  let generatingMc = false;
  const renderedOpinionIds = new Set(); // responder ids whose text we've appended to chat
  const gradedResponderIds = new Set(); // responders whose grade-tag we've stamped on
  let sheetOverlayOpen = false;
  let sheetAutoShown = false;

  // Track scroll-to-bottom intent: only auto-scroll if user is near bottom.
  // The player's display name in chat + race UI. Falls back to "You" only
  // when there's no character yet (rare — the welcome modal auto-rolls one).
  function playerDisplayName() {
    const fullName = lastTelemetry && lastTelemetry.character && lastTelemetry.character.name;
    if (!fullName) return "You";
    const first = String(fullName).trim().split(/\\s+/)[0];
    return first || "You";
  }
  function playerOpinionRecorded(round) {
    return !!(
      round
      && round.type === "opinion"
      && (round.opinionResponses || []).some((r) => r.responder === "player")
    );
  }
  function markOpinionSubmitted(questionId) {
    opinionSubmitted = true;
    opinionSubmittedQuestionId = questionId || null;
  }
  function clearOpinionSubmitted() {
    opinionSubmitted = false;
    opinionSubmittedQuestionId = null;
  }
  function playerMessageIdentitySig() {
    const ch = lastTelemetry && lastTelemetry.character;
    return playerDisplayName() + ":" + (ch && ch.portraitDataUrl ? ch.portraitDataUrl.length : 0);
  }
  function clipPlayerContext(text, max) {
    const raw = String(text || "").replace(/\\s+/g, " ").trim();
    if (!raw) return "";
    const limit = max || 150;
    return raw.length > limit ? raw.slice(0, limit - 1) + "…" : raw;
  }
  function facultyDisplayName(facultyId) {
    const fid = facultyId || (lastTelemetry && lastTelemetry.faculty);
    const fac = (lastTelemetry && lastTelemetry.faculty_roster || []).find((f) => f.id === fid);
    return fac ? fac.displayName : (fid || "class").replace(/-/g, " ");
  }
  function revealAnswerText(reveal, choice) {
    if (!reveal || !choice) return "";
    const options = reveal.questionOptions || ((lastTelemetry && lastTelemetry.current && lastTelemetry.current.options) || null);
    const value = options && options[choice];
    return value ? choice + ") " + value : String(choice);
  }
  function latestConversationLine() {
    if (!els.stream) return "";
    const nodes = Array.from(els.stream.querySelectorAll(".msg.teacher .body, .msg.student .body"));
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const text = node && (node.dataset.markdownRaw || node.textContent || "");
      const clipped = clipPlayerContext(text, 120);
      if (clipped) return clipped;
    }
    return "";
  }
  function playerLoungeLine() {
    const recent = latestConversationLine();
    if (recent) return "I heard that: " + recent + " What should I understand about it?";
    return "What are you all noticing about subjects today?";
  }
  function playerClassLine(intent) {
    const t = lastTelemetry || {};
    const current = t.current || null;
    const reveal = t.lastReveal || null;
    const facultyName = facultyDisplayName(t.faculty);
    if (intent === "hint") {
      const prompt = current ? clipPlayerContext(current.prompt, 150) : "";
      if (prompt) return "I'm looking at this board: " + prompt + " What clue should I use first without getting the answer?";
      return "What clue should I use first without getting the answer?";
    }
    if (intent === "report") {
      if (reveal) {
        const prompt = clipPlayerContext(reveal.questionPrompt || (current && current.prompt) || "", 110);
        const result = reveal.forfeit
          ? "I timed out"
          : reveal.wasCorrect
            ? "I got it right"
            : "I missed it";
        const answer = reveal.answerText
          ? clipPlayerContext(reveal.answerText, 70)
          : revealAnswerText(reveal, reveal.picked);
        const correct = reveal.expectedAnswer
          ? clipPlayerContext(reveal.expectedAnswer, 70)
          : revealAnswerText(reveal, reveal.correct);
        const answerLine = answer && !reveal.forfeit ? " My answer was " + answer + "." : "";
        const correctLine = correct ? " The correct answer was " + correct + "." : "";
        return result + (prompt ? " on " + prompt : "") + "." + answerLine + correctLine + " What should I take from that?";
      }
      const progress = t.active_course_progress && t.active_course_progress.today;
      if (progress && progress.status === "complete") {
        return "I'm looking at the " + facultyName + " class report" + (progress.letterGrade ? " with a " + progress.letterGrade : "") + ". What should I work on next?";
      }
      return "What does the latest class result say I should work on next?";
    }
    const progress = t.active_course_progress && t.active_course_progress.today;
    if (progress && progress.status === "active") {
      return "I'm ready for the next " + facultyName + " card. " + questionsLeftSentence(progress) + " in today's class.";
    }
    return "I'm ready for the next " + facultyName + " card.";
  }
  function playerChatLine(intent) {
    return intent === "lounge" ? playerLoungeLine() : playerClassLine(intent);
  }
  function playerChatFallbackLine(intent) {
    if (intent === "hint") return "Can someone give me the first clue without saying it outright?";
    if (intent === "report") return "Okay, I need a second with that one. What did everyone notice?";
    if (intent === "lounge") return "Wait, what did you mean by that?";
    return "I'm ready. What's the room looking at next?";
  }
  async function generatePlayerChatLine(intent) {
    if (!aiEnabled) return playerChatLine(intent);
    try {
      const r = await apiFetch("/api/apps/ruby-high/chat/player-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: PLAYER_LINE_TIMEOUT_MS,
        body: JSON.stringify({
          faculty: lastTelemetry && lastTelemetry.faculty,
          context: { intent: playerChatIntentForServer(intent) },
        }),
      });
      if (!r.ok) throw new Error("player-line " + r.status);
      const data = await r.json();
      const line = data && data.line ? String(data.line).trim() : "";
      return line || playerChatFallbackLine(intent);
    } catch (err) {
      return playerChatFallbackLine(intent);
    }
  }
  function playerChatIntentForServer(intent) {
    if (intent === "hint") return "hint";
    if (intent === "report") return "report";
    if (intent === "class") return "advance";
    if (intent === "lounge") return "lounge";
    return "player-chat";
  }
  function pickChatResponder() {
    const students = studentsForGrade(lastTelemetry && lastTelemetry.current_grade);
    if (students.length > 0 && Math.random() < 0.5) {
      return { kind: "student", student: pickRandom(students) };
    }
    return { kind: "teacher" };
  }
  function playerChatNote(intent, playerLine) {
    const current = lastTelemetry && lastTelemetry.current;
    const reveal = lastTelemetry && lastTelemetry.lastReveal;
    const contextBits = [];
    if (current && current.prompt) contextBits.push("board: " + clipPlayerContext(current.prompt, 140));
    if (reveal && reveal.questionPrompt) {
      contextBits.push("recent result: " + (reveal.wasCorrect ? "correct" : reveal.forfeit ? "timeout" : "missed") + " on " + clipPlayerContext(reveal.questionPrompt, 100));
    }
    const contextLine = contextBits.length ? " Context: " + contextBits.join(" | ") + "." : "";
    if (intent === "hint" && current) {
      return "The player said: " + playerLine + contextLine + " Respond in 1 short in-character line with a helpful hint for the current board question, but do not reveal the answer or exact choice.";
    }
    if (intent === "report") {
      return "The player said: " + playerLine + contextLine + " Respond in 1 short in-character line about the class report or recent class.";
    }
    if (intent === "lounge") {
      return "The player said: " + playerLine + contextLine + " Respond in 1 short in-character line as part of the lounge conversation.";
    }
    return "The player said: " + playerLine + contextLine + " Respond in 1 short in-character line and keep the room moving.";
  }
  async function runPlayerChatTurn(intent, extraContext) {
    const manualTurn = turnController.beginManual();
    if (!manualTurn) return;
    try {
      const playerLine = await generatePlayerChatLine(intent);
      appendMsg({ kind: "you", name: playerDisplayName(), body: playerLine, color: "var(--accent)" });
      const responder = pickChatResponder();
      const context = Object.assign({}, extraContext || {}, {
        grade: lastTelemetry && lastTelemetry.current_grade,
        intent: playerChatIntentForServer(intent),
        playerLine,
      });
      if (aiEnabled && responder.kind === "student") {
        await fireStudentChime({
          situation: intent === "hint" ? "player-asked-hint" : "player-chat",
          note: playerChatNote(intent, playerLine),
          playerText: playerLine,
          grade: lastTelemetry && lastTelemetry.current_grade,
          faculty: lastTelemetry && lastTelemetry.faculty,
          delayMs: 500,
          studentId: responder.student.id,
          bypassCooldown: true,
          recordPlayerText: intent !== "class",
        });
        if (intent !== "class") return;
      }
      if (teacherChatEnabled()) {
        await runAgentTurn("manual", context, { force: true });
      } else {
        appendSystem(intent === "hint" ? "Answer the board to continue. Enable AI for teacher hints." : "Enable AI for teacher replies.");
      }
    } finally {
      manualTurn.finish();
    }
  }
  function syncPlayerMessageHeaders() {
    if (!els.stream) return;
    const displayName = playerDisplayName();
    const ch = lastTelemetry && lastTelemetry.character;
    const portraitSrc = ch && ch.portraitDataUrl ? ch.portraitDataUrl : null;
    const initial = displayName ? displayName.slice(0, 1).toUpperCase() : "U";
    els.stream.querySelectorAll(".msg.you").forEach((node) => {
      const nameEl = node.querySelector(".head .name");
      if (nameEl && nameEl.textContent !== displayName) nameEl.textContent = displayName;
      const avatar = node.querySelector(".avatar");
      if (!avatar) return;
      const img = avatar.querySelector("img");
      if (portraitSrc) {
        avatar.style.background = "#fff";
        if (img) {
          if (img.src !== portraitSrc) img.src = portraitSrc;
          if (img.alt !== displayName) img.alt = displayName;
        } else {
          avatar.textContent = "";
          const nextImg = document.createElement("img");
          nextImg.src = portraitSrc;
          nextImg.alt = displayName;
          avatar.appendChild(nextImg);
        }
      } else {
        avatar.style.background = "var(--accent)";
        if (img) avatar.replaceChildren();
        if (avatar.textContent !== initial) avatar.textContent = initial;
      }
    });
  }

  function isNearBottom() {
    const { scrollTop, scrollHeight, clientHeight } = els.stream;
    return scrollHeight - (scrollTop + clientHeight) < 80;
  }
  function scrollIfPinned(force) {
    if (force || isNearBottom()) {
      requestAnimationFrame(() => {
        els.stream.scrollTop = els.stream.scrollHeight;
      });
    }
  }

  function clearStream() {
    chatViewSeq++;
    els.stream.innerHTML = "";
    renderedHistorySig = null;
    lastSocialSummaryId = null;
  }
  function resetBlackboard() {
    activeQuestionId = null;
    questionCounter = 0;
    showBlackboardEmpty(true);
  }
  function isActiveBoardCommandError(msg) {
    return /Question already (on|posted by).*board|wait for the student answer|Cannot (post another question|clear the board) while a question is live/i.test(String(msg || ""));
  }

  // ── API helper ────────────────────────────────────────────────────────────
  const apiClient = createViewerApiClient({
    sessionUrl,
    commandUrl,
    commandTimeoutMs: COMMAND_TIMEOUT_MS,
    sessionRefreshTimeoutMs: SESSION_REFRESH_TIMEOUT_MS,
    getApiKey: getStoredApiKey,
    clearAuth: clearStoredAuth,
    onAuthCleared() {
      try { deriveAuth(); } catch (_e) { /* deriveAuth not yet defined on boot */ }
    },
    onCommandSession(session) {
      render(session);
    },
    onCommandError(message) {
      appendSystem("error · " + message);
    },
    onCommandFailed(message) {
      appendSystem("submit failed · " + message);
    },
    onNoScheduledQuestion() {
      autoPickLastKey = null;
    },
    isActiveBoardCommandError(payload, message) {
      return payload && payload.type === "pick" && isActiveBoardCommandError(message);
    },
    onActiveBoardRace() {
      fetchSession();
    },
    onSessionData(session) {
      render(session);
    },
    onSessionUnavailable() {
      if (!lastTelemetry && els.blackboardEmptyText) {
        els.blackboardEmptyText.textContent = navigator.onLine === false
          ? "Ruby High is offline. Reconnect to resume class."
          : "Ruby High is unavailable. Retrying...";
      }
    },
  });

  function apiFetch(url, init) {
    return apiClient.apiFetch(url, init);
  }

  async function command(payload) {
    return apiClient.command(payload);
  }

  // ── message factories ────────────────────────────────────────────────────
  function knownTeacherAssetId(faculty) {
    const haystack = [
      faculty && faculty.id,
      faculty && faculty.displayName,
      faculty && faculty.shortName,
    ].filter(Boolean).join(" ").toLowerCase();
    if (haystack.includes("sally")) return "sally-science";
    if (haystack.includes("edward")) return "professor-edward";
    if (haystack.includes("ruby")) return "ruby";
    return "";
  }
  const BUILTIN_TEACHER_ASSET_IDS = new Set(["ruby", "sally-science", "professor-edward"]);
  function teacherInitial(facultyOrName) {
    if (!facultyOrName) return "?";
    if (typeof facultyOrName === "string") return facultyOrName.charAt(0).toUpperCase();
    return String(facultyOrName.shortName || facultyOrName.displayName || facultyOrName.id || "?").charAt(0).toUpperCase();
  }
  function facultyAssetId(facultyOrId) {
    if (!facultyOrId) return "";
    if (typeof facultyOrId === "object") {
      const explicit = facultyOrId.assetTeacherId || knownTeacherAssetId(facultyOrId);
      if (explicit) return explicit;
      return BUILTIN_TEACHER_ASSET_IDS.has(facultyOrId.id) ? facultyOrId.id : "";
    }
    const roster = (lastTelemetry && lastTelemetry.faculty_roster) || [];
    const fac = roster.find((f) => f.id === facultyOrId);
    if (fac) return facultyAssetId(fac);
    return BUILTIN_TEACHER_ASSET_IDS.has(facultyOrId) ? facultyOrId : "";
  }
  function facultyProfileImageUrl(facultyOrId) {
    if (!facultyOrId) return "";
    if (typeof facultyOrId === "object") {
      const url = typeof facultyOrId.profileImageUrl === "string" ? facultyOrId.profileImageUrl.trim() : "";
      return isUsableProfileImageUrl(url) ? url : "";
    }
    const roster = (lastTelemetry && lastTelemetry.faculty_roster) || [];
    const fac = roster.find((f) => f.id === facultyOrId);
    return fac ? facultyProfileImageUrl(fac) : "";
  }
  function isUsableProfileImageUrl(raw) {
    if (!raw) return false;
    if (/^data:image\\//i.test(raw) || (raw.startsWith("/") && !raw.startsWith("//"))) return true;
    if (!/^https?:\\/\\//i.test(raw)) return false;
    try {
      const url = new URL(raw);
      return !/\\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(url.hostname);
    } catch (_err) {
      return false;
    }
  }
  function teacherAssetUrl(facultyOrId, variant) {
    const assetId = facultyAssetId(facultyOrId);
    if (!assetId) return null;
    const suffix = variant ? "-" + variant : "";
    return apiBase + "/assets/teachers/" + encodeURIComponent(assetId) + suffix + ".png";
  }
  function teacherPortraitUrl(facultyOrId, variant) {
    return teacherAssetUrl(facultyOrId, variant) || facultyProfileImageUrl(facultyOrId) || null;
  }
  function teacherStickerUrl(facultyId) {
    if (!facultyId) return null;
    return teacherPortraitUrl(facultyId, "");
  }
  function studentStickerUrl(studentId) {
    if (!studentId) return null;
    return apiBase + "/assets/students/" + encodeURIComponent(studentId) + "-face.png";
  }
  function appendMsg({ kind, name, body, color, facultyId, studentId }) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + (kind || "bot");
    const avatar = document.createElement("div");
    avatar.className = "avatar" + (kind === "teacher" ? " is-teacher" : "");
    let avatarImgSrc = null;
    if (kind === "teacher" && facultyId) avatarImgSrc = teacherStickerUrl(facultyId);
    else if (kind === "student" && studentId) avatarImgSrc = studentStickerUrl(studentId);
    else if (kind === "you" && lastTelemetry?.character?.portraitDataUrl) avatarImgSrc = lastTelemetry.character.portraitDataUrl;
    if (avatarImgSrc) {
      avatar.style.background = "#fff";
      const img = document.createElement("img");
      img.src = avatarImgSrc;
      img.alt = name || "";
      img.onerror = () => {
        avatar.removeChild(img);
        avatar.style.background = color || "var(--bg-elev)";
        avatar.textContent = name ? name.slice(0, 1).toUpperCase() : "?";
      };
      avatar.appendChild(img);
    } else {
      avatar.style.background = color || "var(--bg-elev)";
      avatar.textContent = name ? name.slice(0, 1).toUpperCase() : "?";
    }
    const head = document.createElement("div");
    head.className = "head";
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = name || "—";
    head.appendChild(nameEl);
    if (kind === "teacher") {
      const tag = document.createElement("span"); tag.className = "role-tag bot"; tag.textContent = "Teacher"; head.appendChild(tag);
    } else if (kind === "you") {
      const tag = document.createElement("span"); tag.className = "role-tag you"; tag.textContent = "you"; head.appendChild(tag);
    } else if (kind === "student") {
      const tag = document.createElement("span"); tag.className = "role-tag student"; tag.textContent = "Student"; head.appendChild(tag);
    }
    const stamp = document.createElement("span");
    stamp.className = "stamp";
    stamp.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    head.appendChild(stamp);
    const bodyEl = document.createElement("div");
    bodyEl.className = "body";
    bodyEl.dataset.markdownRaw = body || "";
    renderMarkdownInto(bodyEl, body || "");
    wrap.appendChild(avatar);
    wrap.appendChild(head);
    wrap.appendChild(bodyEl);
    els.stream.appendChild(wrap);
    // The player should always see their own words land — force the scroll
    // even if they were peeking up the log when they hit Send. Other roles
    // only scroll if the user is already pinned.
    scrollIfPinned(kind === "you");
    return bodyEl;
  }
  function appendSystem(text) {
    const wrap = document.createElement("div");
    wrap.className = "msg system";
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = text;
    wrap.appendChild(body);
    els.stream.appendChild(wrap);
    scrollIfPinned();
  }
  function appendTool(text) {
    const wrap = document.createElement("div");
    wrap.className = "msg tool";
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = text;
    wrap.appendChild(body);
    els.stream.appendChild(wrap);
    scrollIfPinned();
  }
  function appendEmptyState({ title, body, ctaLabel, ctaAction, facultyId }) {
    const wrap = document.createElement("div");
    wrap.className = "empty-state";
    const heroSrc = (facultyId && teacherAssetUrl(facultyId, "full")) || teacherAssetUrl("ruby", "full");
    wrap.innerHTML =
      '<img class="logo" src="' + heroSrc + '" alt=""/>' +
      '<h2>' + escape(title) + '</h2>' +
      '<p>' + escape(body) + '</p>';
    if (ctaLabel) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cta";
      btn.textContent = ctaLabel;
      btn.addEventListener("click", ctaAction);
      wrap.appendChild(btn);
    }
    els.stream.appendChild(wrap);
  }
  function escape(s) { return escapeHtml(s); }
  function escapeHtml(value) {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => map[c]);
  }
  function safeMarkdownHref(href) {
    const raw = String(href || "").trim();
    if (!raw) return null;
    try {
      const url = new URL(raw, window.location.href);
      return (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") ? raw : null;
    } catch (_e) {
      return null;
    }
  }
  function markdownInlineHtml(value) {
    const start = String.fromCharCode(0xe000);
    const end = String.fromCharCode(0xe001);
    const tick = String.fromCharCode(96);
    const placeholders = [];
    let text = String(value == null ? "" : value);
    const stash = (html) => {
      const key = start + placeholders.length + end;
      placeholders.push(html);
      return key;
    };
    const codePattern = new RegExp(tick + "([^" + tick + "\\n]+)" + tick, "g");
    text = text.replace(codePattern, (_match, code) => stash("<code>" + escapeHtml(code) + "</code>"));
    text = text.replace(/\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)/g, (match, label, href) => {
      const safeHref = safeMarkdownHref(href);
      if (!safeHref) return match;
      return stash('<a href="' + escapeHtml(safeHref) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + "</a>");
    });
    let html = escapeHtml(text);
    html = html
      .replace(/\\*\\*([^*\\n]+)\\*\\*/g, "<strong>$1</strong>")
      .replace(/__([^_\\n]+)__/g, "<strong>$1</strong>")
      .replace(/~~([^~\\n]+)~~/g, "<del>$1</del>")
      .replace(/(^|[^\\w])\\*([^*\\n]+)\\*(?=$|[^\\w])/g, "$1<em>$2</em>")
      .replace(/(^|[^\\w])_([^_\\n]+)_(?=$|[^\\w])/g, "$1<em>$2</em>")
      .replace(/\\n/g, "<br>");
    const placeholderPattern = new RegExp(start + "(\\d+)" + end, "g");
    return html.replace(placeholderPattern, (_match, index) => placeholders[Number(index)] || "");
  }
  function appendMarkdownInline(parent, text) {
    const span = document.createElement("span");
    span.innerHTML = markdownInlineHtml(text);
    while (span.firstChild) parent.appendChild(span.firstChild);
  }
  function renderMarkdownInto(el, source, options) {
    if (!el) return;
    const opts = options || {};
    el.classList.add("markdown");
    el.classList.toggle("markdown-inline", !!opts.inline);
    el.replaceChildren();
    const text = String(source == null ? "" : source).replace(/\\r\\n?/g, "\\n");
    if (!text) return;
    if (opts.inline) {
      appendMarkdownInline(el, text);
      return;
    }
    const lines = text.split("\\n");
    const fence = String.fromCharCode(96).repeat(3);
    const startsBlock = (line) =>
      /^\\s{0,3}#{1,4}\\s+/.test(line) ||
      /^\\s{0,3}>\\s?/.test(line) ||
      /^\\s{0,3}[-*+]\\s+/.test(line) ||
      /^\\s{0,3}\\d+[.)]\\s+/.test(line) ||
      line.trim().slice(0, 3) === fence;
    const appendParagraph = (chunk) => {
      const p = document.createElement("p");
      appendMarkdownInline(p, chunk);
      el.appendChild(p);
    };
    let i = 0;
    while (i < lines.length) {
      if (!lines[i].trim()) { i += 1; continue; }
      if (lines[i].trim().slice(0, 3) === fence) {
        i += 1;
        const codeLines = [];
        while (i < lines.length && lines[i].trim().slice(0, 3) !== fence) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = codeLines.join("\\n");
        pre.appendChild(code);
        el.appendChild(pre);
        continue;
      }
      if (/^\\s{0,3}#{1,4}\\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\\s{0,3}/, "");
        const depth = Math.min(4, raw.match(/^#+/)[0].length);
        const heading = document.createElement("h" + depth);
        appendMarkdownInline(heading, raw.replace(/^#{1,4}\\s+/, ""));
        el.appendChild(heading);
        i += 1;
        continue;
      }
      if (/^\\s{0,3}>\\s?/.test(lines[i])) {
        const quoteLines = [];
        while (i < lines.length && /^\\s{0,3}>\\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^\\s{0,3}>\\s?/, ""));
          i += 1;
        }
        const quote = document.createElement("blockquote");
        renderMarkdownInto(quote, quoteLines.join("\\n"));
        el.appendChild(quote);
        continue;
      }
      if (/^\\s{0,3}[-*+]\\s+/.test(lines[i])) {
        const list = document.createElement("ul");
        while (i < lines.length && /^\\s{0,3}[-*+]\\s+/.test(lines[i])) {
          const li = document.createElement("li");
          appendMarkdownInline(li, lines[i].replace(/^\\s{0,3}[-*+]\\s+/, ""));
          list.appendChild(li);
          i += 1;
        }
        el.appendChild(list);
        continue;
      }
      if (/^\\s{0,3}\\d+[.)]\\s+/.test(lines[i])) {
        const list = document.createElement("ol");
        while (i < lines.length && /^\\s{0,3}\\d+[.)]\\s+/.test(lines[i])) {
          const li = document.createElement("li");
          appendMarkdownInline(li, lines[i].replace(/^\\s{0,3}\\d+[.)]\\s+/, ""));
          list.appendChild(li);
          i += 1;
        }
        el.appendChild(list);
        continue;
      }
      const paraLines = [];
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
        paraLines.push(lines[i]);
        i += 1;
      }
      appendParagraph(paraLines.join("\\n"));
    }
  }

  // ── blackboard panel (single, persistent, updates in place) ─────────────
  function showBlackboardEmpty(reset) {
    els.blackboardPanel.classList.add("is-empty");
    els.blackboardEmpty.hidden = false;
    els.blackboardMeta.hidden = true;
    els.boardFrameHost.hidden = true;
    els.answersHost.hidden = true;
    els.typedAnswerHost.hidden = true;
    els.blackboardFoot.hidden = true;
    els.blackboardFoot.replaceChildren();
    els.blackboardPanel.dataset.opinion = "false";
    els.blackboardPanel.dataset.typedAnswer = "false";
    els.blackboardPanel.dataset.questionType = "";
    els.blackboardPanel.dataset.cardRole = "";
    if (reset) {
      els.boardPrompt.textContent = "";
      els.boardReveal.hidden = true;
      els.boardReveal.textContent = "";
    }
  }
  function showBlackboardLoaded(isOpinion, isTypedAnswer) {
    // Visibility of the blackboard pieces (panel, answers host, footer) is
    // governed by applyViewMode via data-mode CSS rules. This function
    // just paints the live state: clear the empty placeholder, mark
    // opinion mode so the answers grid hides for opinion rounds, and
    // populate meta/board contents.
    els.blackboardPanel.classList.remove("is-empty");
    els.blackboardEmpty.hidden = true;
    els.blackboardMeta.hidden = false;
    els.boardFrameHost.hidden = false;
    // showBlackboardEmpty sets the answers-host hidden attribute; clear it
    // here so the data-mode CSS rules can take over for round-live.
    els.answersHost.hidden = false;
    els.typedAnswerHost.hidden = false;
    els.blackboardFoot.hidden = true;
    els.blackboardFoot.replaceChildren();
    els.blackboardPanel.dataset.opinion = String(!!isOpinion);
    els.blackboardPanel.dataset.typedAnswer = String(!!isTypedAnswer);
  }
  function showBlackboardCeremony(faculty, currentGrade) {
    const t = lastTelemetry;
    const ceremony = t && t.character ? buildGraduationCeremony(t.character, currentGrade, { surface: "board" }) : null;
    if (!ceremony) {
      showBlackboardEmpty(true);
      return;
    }
    els.blackboardPanel.classList.remove("is-empty", "is-long-prompt", "is-essay-prompt");
    els.blackboardEmpty.hidden = true;
    els.blackboardMeta.hidden = false;
    els.boardFrameHost.hidden = false;
    els.answersHost.hidden = true;
    els.typedAnswerHost.hidden = true;
    els.blackboardFoot.hidden = true;
    els.blackboardFoot.replaceChildren();
    els.blackboardPanel.dataset.opinion = "false";
    els.blackboardPanel.dataset.typedAnswer = "false";
    els.blackboardPanel.dataset.questionType = "graduation";
    els.blackboardPanel.dataset.cardRole = "";
    activeQuestionId = null;

    els.blackboardMeta.replaceChildren();
    if (faculty) {
      const f = document.createElement("span");
      f.className = "pill faculty";
      f.textContent = faculty.displayName || "Teacher";
      els.blackboardMeta.appendChild(f);
    }
    const g = document.createElement("span");
    g.className = "pill difficulty hard";
    g.textContent = (currentGrade && GRADE_LABELS[currentGrade]) || "Ceremony";
    els.blackboardMeta.appendChild(g);
    const mode = document.createElement("span");
    mode.className = "pill subject";
    mode.textContent = "graduation";
    els.blackboardMeta.appendChild(mode);

    els.boardPrompt.replaceChildren(ceremony);
    els.boardReveal.hidden = true;
    els.boardReveal.replaceChildren();
    // Keep the reward choices clear of the corner portrait; the teacher can
    // react in chat, but the ceremony itself owns the board.
    els.teacherFigure.hidden = true;
  }
  function buildClassReportCard(faculty, currentGrade) {
    const progress = lastTelemetry && lastTelemetry.active_course_progress;
    const today = progress && progress.today;
    if (!progress || !today || today.status !== "complete") return null;
    const teacherName = teacherShortName(faculty, progress.displayName);
    const classLetter = today.letterGrade || letterGradeForScore(today.score);
    const passedToday = letterGradePasses(today.letterGrade) || Number(today.score || 0) >= 70;
    const wrap = document.createElement("section");
    wrap.className = "class-report-card" + (passedToday ? " is-passed" : " needs-work");

    const main = document.createElement("div");
    main.className = "class-report-main";
    const badge = document.createElement("div");
    badge.className = "class-report-letter";
    badge.textContent = classLetter;
    const titleWrap = document.createElement("div");
    titleWrap.className = "class-report-heading";
    const title = document.createElement("div");
    title.className = "class-report-title";
    title.textContent = "Teacher " + teacherName;
    const subtitle = document.createElement("div");
    subtitle.className = "class-report-subtitle";
    subtitle.textContent = passedToday ? "daily class passed" : "practice open";
    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);
    main.appendChild(badge);
    main.appendChild(titleWrap);

    const artAssetId = faculty && (faculty.assetTeacherId || knownTeacherAssetId(faculty));
    if (artAssetId) {
      const art = document.createElement("div");
      art.className = "class-report-teacher-art";
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.loading = "lazy";
      img.src = teacherAssetUrl(artAssetId, "full-sticker");
      img.onerror = () => art.remove();
      art.appendChild(img);
      main.appendChild(art);
    }

    wrap.appendChild(main);

    const metrics = document.createElement("div");
    metrics.className = "class-report-metrics";
    const addMetric = (label, value, detail) => {
      const item = document.createElement("div");
      item.className = "class-report-metric";
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = label;
      const v = document.createElement("span");
      v.className = "v";
      if (value instanceof Node) v.appendChild(value);
      else v.textContent = value;
      const d = document.createElement("span");
      d.className = "d";
      d.textContent = detail;
      item.appendChild(k);
      item.appendChild(v);
      item.appendChild(d);
      metrics.appendChild(item);
    };
    addMetric("score", formatClassScore(today.score), "average");
    wrap.appendChild(metrics);
    return wrap;
  }
  function buildClassReportNextStep() {
    const state = postClassState(lastTelemetry);
    const wrap = document.createElement("div");
    wrap.className = "class-report-next" + (state.socialReady ? " is-social" : state.practiceReady ? " is-practice" : "");
    const mark = document.createElement("span");
    mark.className = "class-report-next-mark";
    wrap.appendChild(mark);
    const copy = document.createElement("div");
    copy.className = "class-report-next-copy";
    const title = document.createElement("div");
    title.className = "class-report-next-title";
    const body = document.createElement("div");
    body.className = "class-report-next-body";
    if (state.socialReady) {
      title.textContent = "Social card ready";
      body.textContent = "One homeroom question before the next class.";
    } else if (state.practiceReady) {
      title.textContent = "Practice open";
      body.textContent = "Extra review, no change to today's grade.";
    } else {
      title.textContent = "Daily class complete";
    }
    copy.appendChild(title);
    if (body.textContent) copy.appendChild(body);
    wrap.appendChild(copy);
    return wrap;
  }
  function showBlackboardClassReport(faculty, currentGrade) {
    const report = buildClassReportCard(faculty, currentGrade);
    if (!report) {
      showBlackboardEmpty(true);
      return;
    }
    els.blackboardPanel.classList.remove("is-empty", "is-long-prompt", "is-essay-prompt");
    els.blackboardEmpty.hidden = true;
    els.blackboardMeta.hidden = false;
    els.boardFrameHost.hidden = false;
    els.answersHost.hidden = true;
    els.typedAnswerHost.hidden = true;
    els.blackboardFoot.hidden = !authed;
    els.blackboardPanel.dataset.opinion = "false";
    els.blackboardPanel.dataset.typedAnswer = "false";
    els.blackboardPanel.dataset.questionType = "class-report";
    els.blackboardPanel.dataset.cardRole = "report";
    activeQuestionId = null;
    shownClassReportKey = classReportKey(lastTelemetry) || shownClassReportKey;

    els.blackboardMeta.replaceChildren();
    if (faculty) {
      const f = document.createElement("span");
      f.className = "pill faculty";
      f.textContent = faculty.displayName || "Teacher";
      els.blackboardMeta.appendChild(f);
    }
    const g = document.createElement("span");
    g.className = "pill difficulty medium";
    g.textContent = (currentGrade && GRADE_LABELS[currentGrade]) || "Class";
    els.blackboardMeta.appendChild(g);
    const mode = document.createElement("span");
    mode.className = "pill class-mode";
    mode.textContent = "REPORT CARD";
    els.blackboardMeta.appendChild(mode);

    els.boardPrompt.replaceChildren(report);
    els.blackboardFoot.replaceChildren(buildClassReportNextStep());
    els.boardReveal.hidden = true;
    els.boardReveal.replaceChildren();
    syncNextButtonDisabled();
    els.nextBtn.textContent = nextQuestionButtonLabel(lastTelemetry);
    els.teacherFigure.hidden = true;
  }

  // ── top-bar arc indicator (live progress through the 4-year arc) ────────
  // Shape: "Junior · 2/3 daily classes · 2/3 subjects cleared". Hidden until a character
  // exists. Daily/subject progress turns accent-colored once the gate is met (player's
  // sitting on the threshold, waiting for the other gate to land). After
  // graduation the year flips to "Graduated" and the gate hints drop.
  function renderArcIndicator(t) {
    const ch = t.character;
    const grade = t.current_grade;
    if (!ch || !grade) {
      els.arcIndicator.hidden = true;
      return;
    }
    els.arcIndicator.hidden = false;
    const graduated = Array.isArray(ch.yearbook) && ch.yearbook.length >= 4;
    els.arcIndicator.classList.toggle("is-graduated", graduated);
    if (graduated) {
      els.arcYear.textContent = "Graduated";
      els.arcStreak.textContent = "diploma earned";
      els.arcStreak.classList.remove("is-met");
      els.arcXp.textContent = "subjects cleared";
      els.arcXp.classList.remove("is-met");
      els.arcScore.textContent = walletSummaryText(t);
      return;
    }
    const yearLabel = GRADE_LABELS[grade] || ("Grade " + grade);
    els.arcYear.textContent = yearLabel;
    const streakCount = ch.streak && ch.streak.grade === grade ? ch.streak.count : 0;
    const streakReq   = STREAK_REQUIRED[grade] || 1;
    els.arcStreak.textContent = streakCount + "/" + streakReq + " daily classes";
    els.arcStreak.classList.toggle("is-met", streakCount >= streakReq);
    const subjects = subjectClearSummary();
    els.arcXp.textContent = subjects.met + "/" + subjects.total + " subjects cleared";
    els.arcXp.classList.toggle("is-met", subjects.met >= subjects.total);
    els.arcScore.textContent = walletSummaryText(t);
  }

  function walletSummaryText(t) {
    const wallet = walletNumbers(t);
    return formatWholeNumber(wallet.meritStars) + " Merit Stars · " + formatWholeNumber(wallet.hallPasses) + " Hall Passes";
  }

  function walletNumbers(t) {
    const wallet = t && t.wallet && typeof t.wallet === "object" ? t.wallet : null;
    const meritStars = wallet && wallet.meritStars != null ? wallet.meritStars : (t && t.meritStars != null ? t.meritStars : t && t.scorePoints);
    const hallPasses = wallet && wallet.hallPasses != null ? wallet.hallPasses : (t && t.hallPasses);
    return {
      meritStars: Math.max(0, Math.round(Number(meritStars || 0))),
      hallPasses: Math.max(0, Math.round(Number(hallPasses || 0))),
    };
  }

  function syncBillingWallet(t) {
    if (!els.billingWallet) return;
    const wallet = walletNumbers(t || lastTelemetry);
    const ai = hostedAiTelemetry(t || lastTelemetry);
    els.billingWallet.textContent = formatWholeNumber(wallet.hallPasses) + " Hall Passes"
      + (ai.active ? " · AI active " + formatRelativeExpiry(ai.expiresAt) : "");
  }

  function setBillingStatus(text, invalid) {
    if (!els.billingStatus) return;
    els.billingStatus.textContent = text || "";
    els.billingStatus.classList.toggle("is-invalid", !!invalid);
  }

  function formatMoney(cents, currency) {
    const amount = Number(cents || 0) / 100;
    const code = String(currency || "usd").toUpperCase();
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(amount);
    } catch (_e) {
      return code + " " + amount.toFixed(2);
    }
  }

  function hostedAiTelemetry(t) {
    const ai = t && t.hosted_ai && typeof t.hosted_ai === "object" ? t.hosted_ai : null;
    const expiresAt = ai && ai.expiresAt != null ? Number(ai.expiresAt) : 0;
    return {
      active: !!(ai && ai.active && expiresAt > Date.now()),
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    };
  }

  function formatDuration(ms) {
    const hours = Math.max(1, Math.round(Number(ms || 0) / 3600000));
    if (hours % 24 === 0) {
      const days = Math.max(1, Math.round(hours / 24));
      return days + " day" + (days === 1 ? "" : "s");
    }
    return hours + " hour" + (hours === 1 ? "" : "s");
  }

  function formatRelativeExpiry(expiresAt) {
    const ms = Math.max(0, Number(expiresAt || 0) - Date.now());
    if (ms <= 0) return "";
    const hours = Math.ceil(ms / 3600000);
    if (hours >= 24) return Math.ceil(hours / 24) + "d";
    return hours + "h";
  }

  function renderBillingProducts(payload) {
    if (!els.billingProducts) return;
    els.billingProducts.replaceChildren();
    syncBillingWallet(lastTelemetry);
    const costs = payload && payload.imageCosts ? payload.imageCosts : {};
    const hostedAi = payload && payload.hostedAiAccess ? payload.hostedAiAccess : {};
    const activeAi = hostedAiTelemetry(lastTelemetry);
    if (els.billingCosts) {
      els.billingCosts.replaceChildren();
      [
        ["AI Day Pass", hostedAi.cost],
        ["Portrait", costs.portrait],
        ["Diploma art", costs.diploma],
      ].forEach(([label, cost]) => {
        const chip = document.createElement("span");
        chip.className = "cost-chip";
        chip.textContent = label + ": " + formatWholeNumber(cost || 0) + " Hall Pass" + (Number(cost || 0) === 1 ? "" : "es");
        els.billingCosts.appendChild(chip);
      });
    }
    const aiRow = document.createElement("div");
    aiRow.className = "billing-product";
    const aiBody = document.createElement("div");
    const aiTitle = document.createElement("div");
    aiTitle.className = "billing-product-title";
    aiTitle.textContent = "AI Day Pass";
    const aiMeta = document.createElement("div");
    aiMeta.className = "billing-product-meta";
    aiMeta.textContent = activeAi.active
      ? "Hosted AI active for " + formatRelativeExpiry(activeAi.expiresAt)
      : formatDuration(hostedAi.durationMs || 86_400_000) + " of hosted AI chat and character rerolls";
    aiBody.appendChild(aiTitle);
    aiBody.appendChild(aiMeta);
    const aiBuy = document.createElement("button");
    aiBuy.type = "button";
    aiBuy.className = "billing-buy";
    aiBuy.textContent = activeAi.active ? "Active" : "Use " + formatWholeNumber(hostedAi.cost || 1);
    aiBuy.disabled = activeAi.active || !hostedAi.configured || billingBusy;
    aiBuy.addEventListener("click", activateAiPass);
    aiRow.appendChild(aiBody);
    aiRow.appendChild(aiBuy);
    els.billingProducts.appendChild(aiRow);
    const products = Array.isArray(payload && payload.products) ? payload.products : [];
    if (products.length === 0) {
      setBillingStatus("No Hall Pass packs are available.", true);
      return;
    }
    products.forEach((product) => {
      const row = document.createElement("div");
      row.className = "billing-product";
      const body = document.createElement("div");
      const title = document.createElement("div");
      title.className = "billing-product-title";
      title.textContent = product.name || "Hall Pass pack";
      const meta = document.createElement("div");
      meta.className = "billing-product-meta";
      meta.textContent = formatWholeNumber(product.hallPasses || 0) + " Hall Passes · " + formatMoney(product.unitAmount, product.currency);
      body.appendChild(title);
      body.appendChild(meta);
      const buy = document.createElement("button");
      buy.type = "button";
      buy.className = "billing-buy";
      buy.textContent = "Buy";
      buy.disabled = !payload.configured || billingBusy;
      buy.addEventListener("click", () => startCheckout(product.id));
      row.appendChild(body);
      row.appendChild(buy);
      els.billingProducts.appendChild(row);
    });
    setBillingStatus(
      payload.configured ? "" : "Web checkout is not configured on this server.",
      !payload.configured && !hostedAi.configured,
    );
  }

  async function loadBillingProducts() {
    setBillingStatus("Loading Hall Pass packs…", false);
    try {
      const r = await apiFetch(apiBase + "/billing/products", { timeoutMs: 8000 });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data || !data.ok) throw new Error(data.error || "billing " + r.status);
      billingProductsCache = data;
      renderBillingProducts(data);
    } catch (err) {
      setBillingStatus("Couldn't load packs · " + (err && err.message ? err.message : "error"), true);
    }
  }

  function openBilling() {
    if (!authed || !els.billingOverlay) return;
    syncBillingWallet(lastTelemetry);
    els.billingOverlay.classList.add("is-open");
    els.billingOverlay.setAttribute("aria-hidden", "false");
    if (billingProductsCache) renderBillingProducts(billingProductsCache);
    void loadBillingProducts();
  }

  function closeBilling() {
    if (!els.billingOverlay || billingBusy) return;
    els.billingOverlay.classList.remove("is-open");
    els.billingOverlay.setAttribute("aria-hidden", "true");
  }

  async function startCheckout(productId) {
    if (!productId || billingBusy) return;
    billingBusy = true;
    if (billingProductsCache) renderBillingProducts(billingProductsCache);
    setBillingStatus("Opening checkout…", false);
    try {
      const r = await apiFetch(apiBase + "/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 12000,
        body: JSON.stringify({
          productId,
          successUrl: apiBase + "/viewer?billing=success",
          cancelUrl: apiBase + "/viewer?billing=cancel",
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data || !data.url) throw new Error(data.error || "checkout " + r.status);
      window.location.href = data.url;
    } catch (err) {
      billingBusy = false;
      if (billingProductsCache) renderBillingProducts(billingProductsCache);
      setBillingStatus("Checkout failed · " + (err && err.message ? err.message : "error"), true);
    }
  }

  async function activateAiPass() {
    if (billingBusy) return;
    billingBusy = true;
    if (billingProductsCache) renderBillingProducts(billingProductsCache);
    setBillingStatus("Turning on hosted AI…", false);
    try {
      const r = await apiFetch(apiBase + "/billing/ai-pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 12000,
        body: JSON.stringify({}),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data || !data.ok) throw new Error(data.error || "AI pass " + r.status);
      setBillingStatus(data.applied ? "AI is on for the day." : "AI is already active.", false);
      await fetchSession();
      await deriveAuth();
      if (billingProductsCache) renderBillingProducts(billingProductsCache);
    } catch (err) {
      setBillingStatus("AI pass failed · " + (err && err.message ? err.message : "error"), true);
    } finally {
      billingBusy = false;
      if (billingProductsCache) renderBillingProducts(billingProductsCache);
    }
  }

  function consumeBillingReturnFlag() {
    try {
      const url = new URL(window.location.href);
      const result = url.searchParams.get("billing");
      if (result === "success") {
        showCongrats("Hall Pass checkout complete.", true);
      } else if (result === "cancel") {
        showCongrats("Checkout cancelled.", false);
      } else {
        return;
      }
      url.searchParams.delete("billing");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    } catch (_e) {
      // Ignore URL cleanup failures.
    }
  }

  // ── race strip (timer + per-NPC thinking/locked indicators) ─────────────
  function renderRaceStrip(t) {
    const round = t.active_round;
    // Visibility is owned by applyViewMode/CSS via data-mode. We bail
    // here only when there's NO content to paint — applyViewMode has
    // already hidden the strip if mode != round-live.
    if (!round || !t.current || round.questionId !== t.current.id) {
      els.raceRow.innerHTML = "";
      return;
    }
    // Timer label (uses server-derived remainingMs as the source of truth).
    const remainingS = Math.max(0, Math.ceil((round.remainingMs ?? 0) / 1000));
    els.timerLabel.textContent = round.resolved ? "done" : remainingS + "s";
    els.timerPill.classList.toggle("is-warn", !round.resolved && remainingS <= 10 && remainingS > 5);
    els.timerPill.classList.toggle("is-danger", !round.resolved && remainingS <= 5);
    els.timerPill.classList.toggle("is-locked", !!round.resolved);

    // Per-participant cards (player + NPCs).
    const cards = [];
    cards.push({
      kind: "player",
      id: "player",
      name: playerDisplayName(),
      faceUrl: null,
      isLocked: round.player.isLocked,
      isTimedOut: !!round.player.timedOut,
      pick: round.player.picked, // null until reveal
      isCorrect: round.resolved && round.player.picked && t.current ? round.player.picked === t.lastReveal?.correct : null,
      isFirstCorrect: round.firstCorrect === "player",
      color: "var(--accent)",
    });
    (round.npcs || []).filter((n) => shouldShowStudentId(n.studentId)).forEach((n) => {
      const s = STUDENTS.find((x) => x.id === n.studentId);
      cards.push({
        kind: "student",
        id: n.studentId,
        name: s ? s.shortName || s.name : n.studentId,
        faceUrl: null,
        isLocked: n.isLocked,
        isTimedOut: false,
        pick: n.pick,
        isCorrect: n.isCorrect,
        isFirstCorrect: round.firstCorrect === n.studentId,
        color: s ? s.color : "#888",
      });
    });
    els.raceRow.innerHTML = "";
    for (const c of cards) {
      const card = document.createElement("span");
      card.className = "race-card" + (c.isLocked ? " is-locked" : "");
      if (round.resolved) {
        if (c.isCorrect === true) card.classList.add("is-correct");
        else if (c.isCorrect === false) card.classList.add("is-wrong");
        if (c.isFirstCorrect) card.classList.add("is-first-correct");
      }
      const av = document.createElement("span");
      av.className = "race-avatar";
      if (c.kind === "student") {
        // Students don't have face stickers yet — fall back to colored circle with initial.
        av.style.background = c.color;
        av.style.color = "#fff";
        av.textContent = (c.name || "?").charAt(0).toUpperCase();
      } else {
        av.style.background = c.color;
        av.style.color = "#fff";
        av.textContent = "U";
      }
      card.appendChild(av);
      const nameEl = document.createElement("span");
      nameEl.textContent = c.name;
      card.appendChild(nameEl);
      if (c.isLocked) {
        if (round.resolved && c.isTimedOut) {
          const lt = document.createElement("span");
          lt.className = "pick-letter";
          lt.textContent = "⏱";
          lt.title = "Timed out";
          card.appendChild(lt);
        } else if (round.resolved && c.pick) {
          const lt = document.createElement("span");
          lt.className = "pick-letter";
          lt.textContent = c.pick;
          card.appendChild(lt);
        } else if (!round.resolved) {
          const lock = document.createElement("span");
          lock.className = "pick-letter";
          lock.textContent = "✓";
          card.appendChild(lock);
        }
      } else {
        const dots = document.createElement("span");
        dots.className = "thinking-dots";
        dots.appendChild(document.createElement("span"));
        dots.appendChild(document.createElement("span"));
        dots.appendChild(document.createElement("span"));
        card.appendChild(dots);
      }
      els.raceRow.appendChild(card);
    }
  }
  function renderTeacherFigure(faculty) {
    if (!faculty || faculty.id === LOUNGE_ID) {
      // Hide AND clear src so we never carry a stale image into the next room.
      els.teacherFigure.hidden = true;
      els.teacherFigure.removeAttribute("src");
      els.teacherFigure.dataset.facultyId = "";
      els.teacherFigure.dataset.assetId = "";
      return;
    }
    // Use the -face crop for the corner badge — cleaner head/shoulders fit.
    const assetId = facultyAssetId(faculty);
    const profileUrl = facultyProfileImageUrl(faculty);
    const url = teacherPortraitUrl(faculty, "face");
    if (!url) {
      els.teacherFigure.hidden = true;
      els.teacherFigure.removeAttribute("src");
      els.teacherFigure.dataset.facultyId = faculty.id;
      els.teacherFigure.dataset.assetId = "";
      return;
    }
    const imageKey = assetId || profileUrl;
    if (els.teacherFigure.dataset.facultyId !== faculty.id || els.teacherFigure.dataset.assetId !== imageKey) {
      // Clear first so the browser repaints even if the URL is cached, and
      // restart the entry animation so the speaker change reads visually.
      els.teacherFigure.dataset.facultyId = faculty.id;
      els.teacherFigure.dataset.assetId = imageKey;
      els.teacherFigure.style.borderColor = faculty.accent || "var(--accent)";
      els.teacherFigure.removeAttribute("src");
      // Force reflow so the animation actually re-runs.
      void els.teacherFigure.offsetWidth;
      els.teacherFigure.setAttribute("src", url);
    }
    els.teacherFigure.hidden = false;
  }
  function setLoungeMode(on) {
    els.loungeStage.classList.toggle("is-open", !!on);
    els.blackboardPanel.style.display = on ? "none" : "";
    if (on) renderLoungeFigures();
  }
  // Lounge figures come from the ACTIVE PACK's faculty roster — for the
  // original pack that's Ruby/Sally/Edward; for a connected/generated pack
  // it's that pack's teacher roster. Without this the lounge
  // would always show the original-pack portraits regardless of which
  // pack the player is on. Teachers without portrait assets fall back
  // to a deterministic accent-tinted initial placeholder on the 404.
  let lastLoungeSig = "";
  function renderLoungeFigures() {
    const t = lastTelemetry || {};
    const roster = t.faculty_roster || [];
    const sig = roster.map((f) => f.id).join("|");
    if (sig === lastLoungeSig && els.loungeFigures.children.length) return;
    lastLoungeSig = sig;
    els.loungeFigures.innerHTML = "";
    for (const f of roster) {
      const url = teacherPortraitUrl(f, "full");
      if (!url) {
        els.loungeFigures.appendChild(loungePlaceholder(f));
        continue;
      }
      const img = document.createElement("img");
      img.src = url;
      img.alt = f.displayName || f.id;
      img.addEventListener("error", () => {
        img.replaceWith(loungePlaceholder(f));
      }, { once: true });
      els.loungeFigures.appendChild(img);
    }
  }
  function loungePlaceholder(faculty) {
    const div = document.createElement("div");
    div.className = "lounge-placeholder";
    div.style.background = faculty.accent || "#3aa3e0";
    div.textContent = (faculty.shortName || faculty.displayName || faculty.id || "?").charAt(0).toUpperCase();
    return div;
  }
  // Today's-challenge banner is gone. Class flow moves through normal
  // teacher-picked questions; the /chat/play-bonus endpoint stays available
  // server-side if we ever want a separate daily warm-up affordance.

  function renderQuestionPrompt(question) {
    els.boardPrompt.replaceChildren();
    const media = (question && Array.isArray(question.media)) ? question.media : [];
    const images = media.filter((asset) =>
      asset && typeof asset.dataUrl === "string" && asset.dataUrl.indexOf("data:image/") === 0
    );
    if (images.length > 0) {
      const wrap = document.createElement("div");
      wrap.className = "anki-media-grid";
      images.slice(0, 3).forEach((asset) => {
        const img = document.createElement("img");
        img.src = asset.dataUrl;
        img.alt = asset.name || "Source card image";
        wrap.appendChild(img);
      });
      els.boardPrompt.appendChild(wrap);
    }
    const text = document.createElement("div");
    text.className = "prompt-text";
    renderMarkdownInto(text, (question && question.prompt) || "");
    els.boardPrompt.appendChild(text);
  }

  function renderBlackboard(question, faculty, currentGrade) {
    if (faculty && faculty.id === LOUNGE_ID) {
      // Lounge mode: hide blackboard, show lounge stage with all three figures.
      setLoungeMode(true);
      renderTeacherFigure(null);
      activeQuestionId = null;
      return;
    }
    setLoungeMode(false);
    renderTeacherFigure(faculty);
    els.blackboardPanel.dataset.faculty = faculty ? faculty.id : "";
    if (!question) {
      if (authed && lastTelemetry && lastTelemetry.character && lastTelemetry.graduation_ready) {
        showBlackboardCeremony(faculty, currentGrade);
        return;
      }
      if (authed && lastTelemetry && lastTelemetry.character && shouldShowClassReport(lastTelemetry)) {
        showBlackboardClassReport(faculty, currentGrade);
        return;
      }
      showBlackboardEmpty(true);
      els.blackboardPanel.classList.remove("is-long-prompt", "is-essay-prompt");
      activeQuestionId = null;
      // The empty-board message is just text; the teacher/chat loop decides
      // when to write the next question.
      if (!authed) {
        els.blackboardEmptyText.textContent = "Starting Ruby High…";
      } else if (!lastTelemetry?.character) {
        els.blackboardEmptyText.textContent = "Roll your character to start today's class.";
      } else if (faculty && faculty.id === LOUNGE_ID) {
        els.blackboardEmptyText.textContent = "You're in the teachers' lounge. No questions here — eavesdrop on the faculty.";
      } else if (lastTelemetry && lastTelemetry.graduation_ready) {
        els.blackboardEmptyText.textContent = "Requirements complete. Pick a level-up reward to seal the year.";
      } else {
        // Surface the "what you need" hint here too so the empty board
        // is informative instead of "the teacher will be with you in a
        // moment" forever. The hint comes second — the lead is still
        // the room's status, the hint is the actionable detail.
        const hint = lastTelemetry && lastTelemetry.character ? buildNextStepHint(lastTelemetry.character) : "";
        const progress = lastTelemetry && lastTelemetry.active_course_progress;
        const todayDone = progress && progress.today && progress.today.status === "complete";
        const todayActive = progress && progress.today && progress.today.status === "active";
        const lead = todayDone
          ? "Today's graded class is complete. Practice is open."
          : todayActive
            ? "Continue today's class — tap Chat to start."
            : "Start today's graded class — tap Chat to start.";
        els.blackboardEmptyText.textContent = hint ? lead + " " + hint : lead;
      }
      // Below the lead text: a sleeker on-board subject-grade chip row, so the
      // player can read class standing without opening the sheet.
      let extras = els.blackboardEmpty.querySelector(".blackboard-empty-extras");
      if (!extras) {
        extras = document.createElement("div");
        extras.className = "blackboard-empty-extras";
        els.blackboardEmpty.appendChild(extras);
      }
      extras.innerHTML = "";
      const t = lastTelemetry;
      const inLounge = !!(faculty && faculty.id === LOUNGE_ID);
      if (authed && t && t.character && !inLounge) {
        if (t.current_grade) {
          const grades = buildBoardSubjectGrades();
          if (grades) extras.appendChild(grades);
        }
      }
      return;
    }

    const isNewQuestion = question.id !== activeQuestionId;
    if (isNewQuestion) {
      activeQuestionId = question.id;
      questionCounter += 1;
    }

    const isOpinion = (lastTelemetry && lastTelemetry.is_opinion) || question.type === "opinion";
    const isTypedAnswer = question.type === "typed-answer" || question.type === "image-occlusion";
    const isFreeformAnswer = isTypedAnswer || isOpinion;
    if (isNewQuestion) {
      clearOpinionSubmitted();
      opinionGradeFired = false;
      renderedOpinionIds.clear();
      gradedResponderIds.clear();
    }
    const ar = lastTelemetry && lastTelemetry.active_round;
    const cardRole = (ar && ar.cardRole) || (isOpinion ? "social" : (ar && ar.classSession && ar.classSession.mode === "class" ? "class" : "practice"));
    els.blackboardPanel.dataset.questionType = question.type || "multiple-choice";
    els.blackboardPanel.dataset.cardRole = cardRole || "";
    const promptText = String(question.prompt || "");
    const promptLines = promptText.split(/\\n/).length;
    const longPrompt = promptText.length > 120 || promptLines > 2;
    const essayPrompt = promptText.length > 220 || promptLines > 4;
    els.blackboardPanel.classList.toggle("is-long-prompt", longPrompt);
    els.blackboardPanel.classList.toggle("is-essay-prompt", essayPrompt);
    showBlackboardLoaded(isOpinion, isFreeformAnswer);

    // Meta pills
    els.blackboardMeta.innerHTML = "";
    if (faculty) {
      const f = document.createElement("span"); f.className = "pill faculty"; f.textContent = faculty.displayName || "Teacher"; els.blackboardMeta.appendChild(f);
    }
    if (question.subject) { const s = document.createElement("span"); s.className = "pill subject"; s.textContent = question.subject; els.blackboardMeta.appendChild(s); }
    if (question.difficulty) { const d = document.createElement("span"); d.className = "pill difficulty " + question.difficulty; d.textContent = question.difficulty; els.blackboardMeta.appendChild(d); }
    const stat = (ar && ar.stat) || (question && question.stat);
    const statPill = document.createElement("span");
    statPill.className = "pill stat " + (stat || "head");
    statPill.textContent = statLabel(stat);
    els.blackboardMeta.appendChild(statPill);
    if (ar && ar.isBonus) {
      const bonus = document.createElement("span");
      bonus.className = "pill bonus";
      bonus.textContent = "★ DAILY";
      els.blackboardMeta.appendChild(bonus);
    }
    if (ar && ar.classSession) {
      const cls = document.createElement("span");
      cls.className = "pill class-mode";
      cls.textContent = cardRole === "social"
        ? "SOCIAL"
        : ar.classSession.mode === "class"
        ? "GRADED " + (ar.classSession.index || "?") + "/" + (ar.classSession.total || 3)
        : "PRACTICE";
      els.blackboardMeta.appendChild(cls);
    }

    // Prompt — always wipe + rewrite on new question (chalkboard re-erasing).
    if (isNewQuestion) {
      renderQuestionPrompt(question);
      els.boardReveal.hidden = true;
      els.boardReveal.textContent = "";
      els.boardReveal.classList.remove("correct", "wrong");
      if (els.typedAnswerInput) els.typedAnswerInput.value = "";
    }

    // Answer buttons
    let maxLen = 0;
    let hasLineBreakAnswer = false;
    els.answers.forEach((btn) => {
      const pick = btn.dataset.pick;
      const label = btn.querySelector(".label");
      const text = (question.options && question.options[pick]) || "—";
      renderMarkdownInto(label, text, { inline: true });
      if (text.length > maxLen) maxLen = text.length;
      if (String(text).includes("\\n")) hasLineBreakAnswer = true;
      if (isNewQuestion) {
        btn.classList.remove("is-correct", "is-wrong");
      }
      btn.disabled = role === "agent";
    });
    const round = lastTelemetry && lastTelemetry.active_round;
    const playerLocked = !!(round && round.player && round.player.isLocked);
    const serverPlayerOpinionRecorded = isOpinion && playerOpinionRecorded(round);
    if (serverPlayerOpinionRecorded) markOpinionSubmitted(question.id);
    const localOpinionSubmitted = !!(isOpinion && opinionSubmitted && opinionSubmittedQuestionId === question.id);
    const typedDisabled = role === "agent"
      || !isFreeformAnswer
      || !!(round && round.resolved)
      || (isOpinion ? (serverPlayerOpinionRecorded || localOpinionSubmitted) : playerLocked);
    els.typedAnswerInput.placeholder = isOpinion ? "Type your response" : "Type the answer";
    els.typedSubmitBtn.textContent = isOpinion ? "Send" : "Check";
    els.typedAnswerInput.disabled = typedDisabled;
    els.typedSubmitBtn.disabled = typedDisabled;
    els.generateMcBtn.hidden = !(isTypedAnswer && question.canGenerateMc);
    els.generateMcBtn.disabled = role === "agent" || playerLocked || !!(round && round.resolved) || generatingMc || !aiEnabled;
    els.generateMcBtn.title = aiEnabled
      ? "Generate multiple-choice distractors for this card"
      : "Enable AI to generate multiple-choice distractors";
    // Long-answer mode flips the grid to single-column on narrow
    // viewports (handled in CSS). Threshold tuned so a 4-line
    // explanation-style answer triggers it but a regular MC option
    // ("the mitochondria is the powerhouse of the cell") doesn't.
    const answersGrid = document.getElementById("answers");
    if (answersGrid) {
      answersGrid.classList.toggle("is-long", maxLen > 34 || hasLineBreakAnswer);
      answersGrid.classList.toggle("is-very-long", maxLen > 72 || hasLineBreakAnswer);
    }

    // The bottom Chat action is always available during play. It advances an
    // empty/revealed board and asks for a hint while a challenge is live.
    syncNextButtonDisabled();
    els.nextBtn.textContent = nextQuestionButtonLabel();
    els.blackboardFoot.hidden = !authed;

  }

  function applyOpinionRevealToBlackboard(round) {
    // Opinion rounds don't have a picked letter / correct letter — the MC
    // reveal pipeline leaks "✗ You picked A — answer was A" + the raw rubric
    // when reused. Paint the board with the player's grade + the teacher's
    // per-responder comment instead.
    if (!round) return;
    const grades = round.opinionGrades || [];
    const playerGrade = grades.find((g) => g.responder === "player");
    if (!playerGrade) return;
    const passed = playerGrade.score >= 7;
    els.boardReveal.hidden = false;
    els.boardReveal.classList.toggle("correct", passed);
    els.boardReveal.classList.toggle("wrong", !passed);
    els.boardReveal.replaceChildren();
    const verdict = document.createElement("span");
    verdict.className = "reveal-verdict";
    const isBest = round.bestResponder === "player";
    verdict.textContent = (isBest ? "★ " : "") + "Your grade: " + playerGrade.score.toFixed(1) + "/10";
    els.boardReveal.appendChild(verdict);
    if (playerGrade.comment) {
      const expl = document.createElement("div");
      expl.className = "reveal-explanation";
      renderMarkdownInto(expl, playerGrade.comment);
      els.boardReveal.appendChild(expl);
    }
    // Show the 2d6+stat chip if the round was resolved by dice (offline
    // grading). Same chip the MC + typed-answer reveals use, so the
    // player gets the familiar dice-notifier moment for opinion cards too.
    const reveal = lastTelemetry && lastTelemetry.lastReveal;
    if (reveal && reveal.playerRoll) {
      const r = reveal.playerRoll;
      const fmt = (n) => (n >= 0 ? "+" : "") + n;
      const mod = r.total - (r.dice[0] + r.dice[1]);
      const chip = document.createElement("span");
      chip.className = "roll-chip " + r.outcome;
      chip.textContent = "🎲 " + r.dice[0] + "+" + r.dice[1] + fmt(mod) + " " + statLabel(r.stat) + " = " + r.total;
      els.boardReveal.appendChild(chip);
    }
    els.nextBtn.textContent = nextQuestionButtonLabel();
    els.nextBtn.focus();
  }

  function applyRevealToBlackboard(reveal) {
    if (!reveal) return;
    const isTypedReveal = reveal.answerText != null || reveal.expectedAnswer != null || reveal.answerJudge != null;
    els.answers.forEach((btn) => {
      btn.disabled = true;
      if (btn.dataset.pick === reveal.correct) btn.classList.add("is-correct");
      if (!reveal.forfeit && btn.dataset.pick === reveal.picked && !reveal.wasCorrect) btn.classList.add("is-wrong");
    });
    els.typedAnswerInput.disabled = true;
    els.typedSubmitBtn.disabled = true;
    els.generateMcBtn.disabled = true;
    // The wrong-answer "hide A/B/C/D for chat space" rule lives in
    // showBlackboardLoaded so it survives re-renders driven by the
    // telemetry poll. Don't duplicate it here.
    els.boardReveal.hidden = false;
    els.boardReveal.classList.toggle("correct", !!reveal.wasCorrect);
    els.boardReveal.classList.toggle("wrong", !reveal.wasCorrect);
    // Build the reveal block by parts so the dice render alongside the verdict.
    els.boardReveal.replaceChildren();
    const verdict = document.createElement("span");
    verdict.className = "reveal-verdict";
    verdict.textContent = reveal.forfeit
      ? "⏱ Time's up — answer was " + (isTypedReveal ? (reveal.expectedAnswer || reveal.correct) : reveal.correct)
      : isTypedReveal
      ? (reveal.wasCorrect ? "✓ Correct" : "✗ Not quite")
      : reveal.affinitySave
      ? "✓ Class affinity saved " + reveal.picked + " — answer was " + reveal.correct
      : reveal.wasCorrect
      ? "✓ Correct (" + reveal.picked + ")"
      : "✗ You picked " + reveal.picked + " — answer was " + reveal.correct;
    els.boardReveal.appendChild(verdict);
    if (isTypedReveal) {
      const answerBlock = document.createElement("div");
      answerBlock.className = "typed-reveal";
      const you = document.createElement("div");
      you.textContent = reveal.forfeit ? "You: no answer" : "You: " + (reveal.answerText || "—");
      answerBlock.appendChild(you);
      if (reveal.expectedAnswer) {
        const expected = document.createElement("div");
        expected.textContent = "Answer: " + reveal.expectedAnswer;
        answerBlock.appendChild(expected);
      }
      if (reveal.answerJudge && Number.isFinite(Number(reveal.answerJudge.score))) {
        const judge = document.createElement("div");
        judge.className = "typed-judge";
        judge.textContent = Math.round(Number(reveal.answerJudge.score) * 100) + "% word match";
        answerBlock.appendChild(judge);
      }
      els.boardReveal.appendChild(answerBlock);
    }
    if (reveal.playerRoll) {
      const r = reveal.playerRoll;
      const fmt = (n) => (n >= 0 ? "+" : "") + n;
      const mod = r.total - (r.dice[0] + r.dice[1]);
      const chip = document.createElement("span");
      chip.className = "roll-chip " + r.outcome;
      chip.textContent = "🎲 " + r.dice[0] + "+" + r.dice[1] + fmt(mod) + " " + statLabel(r.stat) + " = " + r.total;
      els.boardReveal.appendChild(chip);
    }
    if (reveal.scoreAward || Number(reveal.scoreMultiplier || 1) > 1) {
      const mult = document.createElement("span");
      mult.className = "score-multiplier-chip";
      const scoreMult = Number(reveal.scoreMultiplier || 1);
      mult.textContent = reveal.scoreAward
        ? scoreAwardLabel(reveal.scoreAward)
        : (scoreMult >= 5 ? "◆ Daily Class Bonus ×5" : "◆ ×" + scoreMult + " Merit Stars");
      els.boardReveal.appendChild(mult);
    }
    if (reveal.explanation) {
      const expl = document.createElement("div");
      expl.className = "reveal-explanation";
      renderMarkdownInto(expl, reveal.explanation);
      els.boardReveal.appendChild(expl);
    }
    els.nextBtn.focus();
  }

  function maybeRunAnswerGraded(t, delayMs) {
    const reveal = t && t.lastReveal;
    if (!reveal) return;
    const triggerId = reveal.questionId + ":" + reveal.picked + ":" + reveal.correct;
    if (triggerId === lastAnswerGradedTriggerId) return;
    const ceremonyReady = !!(t.graduation_ready || (t.character && t.character.pendingGraduation));
    const arcFinished = t.character && graduatedFor(t.character);
    if (!teacherChatEnabled() || t.faculty === LOUNGE_ID || arcFinished || ceremonyReady) return;
    lastAnswerGradedTriggerId = triggerId;
    setTimeout(() => {
      // If the player switches rooms before the delayed reaction fires,
      // don't let an old answer wake the wrong teacher.
      if (!lastTelemetry || lastTelemetry.faculty !== t.faculty) return;
      const liveReveal = lastTelemetry && lastTelemetry.lastReveal;
      if (!liveReveal || liveReveal.questionId !== reveal.questionId || liveReveal.picked !== reveal.picked || liveReveal.correct !== reveal.correct) return;
      const q = t.current && t.current.id === reveal.questionId ? t.current : null;
      const type = (q && q.type) || reveal.questionType || (reveal.expectedAnswer != null ? "typed-answer" : "multiple-choice");
      const options = type === "multiple-choice" && q && q.options ? q.options : (reveal.questionOptions || null);
      const optionAnswer = (letter) => {
        if (!letter || !options) return null;
        const text = options[letter];
        return text ? letter + ") " + text : letter;
      };
      runAgentTurn("answer-graded", {
        grade: t.current_grade,
        questionId: reveal.questionId,
        prompt: (q && q.prompt) || reveal.questionPrompt || null,
        type,
        subject: (q && q.subject) || reveal.questionSubject || null,
        difficulty: (q && q.difficulty) || reveal.questionDifficulty || null,
        options,
        forfeit: !!reveal.forfeit,
        picked: reveal.forfeit ? null : reveal.picked,
        correct: reveal.correct,
        pickedAnswer: reveal.forfeit ? null : (reveal.answerText || optionAnswer(reveal.picked)),
        correctAnswer: reveal.expectedAnswer || optionAnswer(reveal.correct),
        answerText: reveal.forfeit ? null : (reveal.answerText || null),
        expectedAnswer: reveal.expectedAnswer || null,
        answerJudge: reveal.answerJudge || null,
        explanation: reveal.explanation || null,
        wasCorrect: reveal.wasCorrect,
      }, { force: true });
    }, Math.max(0, delayMs || 0));
  }

  function maybeRunRoomIdle(t) {
    const round = t && t.active_round;
    if (!round || round.resolved || !round.idleTriggered) return;
    const triggerId = round.questionId;
    if (triggerId === lastIdleTriggerId) return;
    if (!teacherChatEnabled() || t.faculty === LOUNGE_ID) return;
    const ceremonyReady = !!(t.graduation_ready || (t.character && t.character.pendingGraduation));
    const arcFinished = t.character && graduatedFor(t.character);
    if (arcFinished || ceremonyReady) return;
    lastIdleTriggerId = triggerId;
    runAgentTurn("room-idle", { grade: t.current_grade, questionId: round.questionId }, { force: true });
  }

  async function clearResolvedBoardAfterTeacherTurn(trigger, streamGuard) {
    if (trigger !== "answer-graded" && trigger !== "room-idle") return;
    if (!chatStreamStillCurrent(streamGuard)) return;
    const t = lastTelemetry;
    if (!t || t.faculty === LOUNGE_ID) return;
    if (t.graduation_ready || (t.character && t.character.pendingGraduation) || (t.character && graduatedFor(t.character))) return;
    if (!currentRevealMatches(t)) return;
    if (currentRevealCompletedClass(t)) return;
    await command({ type: "clear" });
    lockedFor = null;
  }

  function recentRelationshipEvents() {
    const events = (lastTelemetry && Array.isArray(lastTelemetry.school_events))
      ? lastTelemetry.school_events
      : [];
    return events.filter((event) => event && event.kind === "relationship.ticked");
  }

  function relationshipEventsForQuestion(questionId) {
    if (!questionId) return [];
    return recentRelationshipEvents()
      .filter((event) => event.questionId === questionId)
      .slice(-3);
  }
  function studentColorById(id) {
    const s = STUDENTS.find((entry) => entry.id === id);
    return s ? s.color : "#888";
  }

  function mashTickLabel(event) {
    const name = studentNameById(event.studentId);
    if (event.reason === "pep-talk") return name + " steady";
    const delta = Number(event.delta || 0);
    const sign = delta > 0 ? "+" + delta : String(delta);
    return "Social " + sign + " " + name;
  }
  // Story-style version of a relationship tick. Used in the Social card
  // recent-activity list so the player sees what happened, not "+1/-2"
  // numerics that are meaningless out of context.
  function mashTickStory(event) {
    const name = studentNameById(event.studentId);
    const tail = event.scratched ? " (scratched off)"
      : event.circled ? " (circled)"
      : "";
    switch (event.reason) {
      case "best-responder":
        return "The teacher singled out " + name + "'s essay; you took notice." + tail;
      case "applauder":
        return name + " caught your eye while you nailed it." + tail;
      case "pep-talk":
        return name + " talked you back from a stumble." + tail;
      case "rub":
        return name + " made the miss sting." + tail;
      default: {
        const delta = Number(event.delta || 0);
        if (delta > 0) return "You and " + name + " grew a little closer." + tail;
        if (delta < 0) return "You and " + name + " drifted a step apart." + tail;
        return "Things stayed even with " + name + "." + tail;
      }
    }
  }

  function appendMashTickChips(body, reveal) {
    const events = relationshipEventsForQuestion(reveal && reveal.questionId);
    events.forEach((event) => {
      const chip = document.createElement("span");
      chip.className = "mash-tick-chip " + (event.delta > 0 ? "up" : event.delta < 0 ? "down" : "steady");
      chip.textContent = mashTickLabel(event);
      if (event.circled) chip.title = studentNameById(event.studentId) + " is circled on your Social card.";
      else if (event.scratched) chip.title = studentNameById(event.studentId) + " is scratched on your Social card.";
      body.appendChild(chip);
    });
  }
  function revealCardRole(t, reveal) {
    const round = t && t.active_round;
    return (round && round.cardRole)
      || (reveal && reveal.classProgress && reveal.classProgress.cardRole)
      || "";
  }
  function appendSocialSummary(reveal, t) {
    if (!reveal || revealCardRole(t || lastTelemetry, reveal) !== "social") return;
    const events = relationshipEventsForQuestion(reveal.questionId);
    if (events.length === 0) return;
    if (lastSocialSummaryId === reveal.questionId) return;
    lastSocialSummaryId = reveal.questionId;

    const wrap = document.createElement("div");
    wrap.className = "msg social-summary";
    const avatar = document.createElement("div");
    avatar.className = "avatar social-summary-avatar";
    avatar.textContent = "S";
    const head = document.createElement("div");
    head.className = "head";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = "Social Shift";
    head.appendChild(name);
    const stamp = document.createElement("span");
    stamp.className = "stamp";
    stamp.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    head.appendChild(stamp);

    const body = document.createElement("div");
    body.className = "body";
    const list = document.createElement("div");
    list.className = "social-summary-list";
    events.forEach((event) => {
      const row = document.createElement("div");
      row.className = "social-summary-row " + (event.delta > 0 ? "is-up" : event.delta < 0 ? "is-down" : "is-steady");
      const dot = document.createElement("span");
      dot.className = "social-summary-dot";
      dot.style.background = studentColorById(event.studentId);
      row.appendChild(dot);
      const story = document.createElement("span");
      story.className = "social-summary-story";
      story.textContent = mashTickStory(event);
      row.appendChild(story);
      const delta = document.createElement("span");
      delta.className = "social-summary-delta";
      const n = Number(event.delta || 0);
      delta.textContent = n > 0 ? "+" + n : String(n);
      row.appendChild(delta);
      list.appendChild(row);
    });
    body.appendChild(list);
    wrap.appendChild(avatar);
    wrap.appendChild(head);
    wrap.appendChild(body);
    els.stream.appendChild(wrap);
    scrollIfPinned();
  }

  function appendResultChip(reveal) {
    const wrap = document.createElement("div");
    wrap.className = "msg result";
    const body = document.createElement("div");
    body.className = "body";
    const badge = document.createElement("span");
    badge.className = "badge-mini " + (reveal.wasCorrect ? "ok" : "bad");
    const isTypedReveal = reveal.answerText != null || reveal.expectedAnswer != null || reveal.answerJudge != null;
    badge.textContent = isTypedReveal
      ? (reveal.forfeit ? "⏱ timeout" : reveal.wasCorrect ? "✓ typed" : "✗ typed")
      : reveal.forfeit ? "⏱ timeout"
      : reveal.wasCorrect ? "✓ " + reveal.picked : "✗ " + reveal.picked + " · " + reveal.correct;
    body.appendChild(badge);
    body.appendChild(document.createTextNode("Q" + questionCounter + " — " + (reveal.forfeit ? "timed out" : reveal.wasCorrect ? "correct" : "missed")));
    if (reveal.playerRoll) {
      const r = reveal.playerRoll;
      const chip = document.createElement("span");
      chip.className = "roll-chip " + r.outcome;
      const fmt = (n) => (n >= 0 ? "+" : "") + n;
      // Recover the stat modifier from total - dice sum so we don't carry it.
      const mod = r.total - (r.dice[0] + r.dice[1]);
      chip.textContent = "🎲 " + r.dice[0] + "+" + r.dice[1] + fmt(mod) + " " + statLabel(r.stat) + " = " + r.total;
      body.appendChild(chip);
    }
    if (reveal.scoreAward || Number(reveal.scoreMultiplier || 1) > 1) {
      const mult = document.createElement("span");
      mult.className = "score-multiplier-chip";
      const scoreMult = Number(reveal.scoreMultiplier || 1);
      mult.textContent = reveal.scoreAward
        ? scoreAwardLabel(reveal.scoreAward)
        : (scoreMult >= 5 ? "◆ Daily Class ×5" : "◆ ×" + scoreMult + " Merit Stars");
      body.appendChild(mult);
    }
    appendMashTickChips(body, reveal);
    wrap.appendChild(body);
    els.stream.appendChild(wrap);
    scrollIfPinned();
  }

  // ── server rail (just the brand button now — no grade picker) ───────────
  function rebuildServersRail() {
    // Strip stale year/lounge buttons and dividers from earlier versions.
    els.serversRail.querySelectorAll(".server-btn[data-grade]:not(.is-home)").forEach((n) => n.remove());
    els.serversRail.querySelectorAll(".server-btn[data-lounge]").forEach((n) => n.remove());
    els.serversRail.querySelectorAll(".servers-divider").forEach((n) => n.remove());
  }

  // ── channels rail ─────────────────────────────────────────────────────────
  function studentArcFor(id, t) {
    const cohort = t && Array.isArray(t.npc_cohort) ? t.npc_cohort : [];
    return cohort.find((n) => n.id === id) || null;
  }
  function studentSocialCellFor(id, t) {
    const cells = t && t.character && t.character.mashCard && t.character.mashCard.cells;
    return cells ? cells[id] || null : null;
  }
  function studentRailSignature(t) {
    const roster = Array.isArray(t && t.npc_roster) ? t.npc_roster : [];
    const cohort = Array.isArray(t && t.npc_cohort) ? t.npc_cohort : [];
    const cells = t && t.character && t.character.mashCard && t.character.mashCard.cells;
    const rosterSig = roster.map((n) => n.id + ":" + (n.currentRoom || "")).join(",");
    const cohortSig = cohort.map((n) =>
      n.id + ":" + n.grade + ":" + (n.graduated ? "1" : "0") + ":" + ((n.streak && n.streak.count) || 0)
    ).join(",");
    const socialSig = STUDENTS.map((s) => {
      const cell = cells && cells[s.id];
      return s.id + ":" + (cell ? [cell.affinity || 0, cell.circled ? 1 : 0, cell.scratched ? 1 : 0].join("/") : "");
    }).join(",");
    return rosterSig + "::" + cohortSig + "::" + socialSig + "::hidden=" + (hiddenNpcStudentId() || "");
  }
  function studentCohortKey(entry) {
    if (entry.arc && entry.arc.graduated) return "graduated";
    return String(entry.rosterGrade || "");
  }
  function studentCohortSortValue(key) {
    if (key === "graduated") return GRADE_ORDER.length + 1;
    const idx = GRADE_ORDER.indexOf(String(key));
    return idx >= 0 ? idx : GRADE_ORDER.length;
  }
  function studentCohortLabel(key) {
    if (key === "graduated") return "Alumni";
    const label = GRADE_LABELS[key] || ("Grade " + key);
    return label + " class";
  }
  function studentRelativeStanding(entry, currentGrade) {
    if (entry.arc && entry.arc.graduated) return "alumni";
    if (!currentGrade || !entry.rosterGrade) return "";
    const currentIdx = GRADE_ORDER.indexOf(String(currentGrade));
    const studentIdx = GRADE_ORDER.indexOf(String(entry.rosterGrade));
    if (studentIdx < 0 || currentIdx < 0) return "";
    if (studentIdx > currentIdx) return "ahead of you";
    if (studentIdx < currentIdx) return "behind you";
    return entry.npc.currentRoom ? "#" + roomLabelFor(entry.npc.currentRoom) : "in your year";
  }
  function studentArcSubtitle(entry, currentGrade) {
    const bits = [];
    const standing = studentRelativeStanding(entry, currentGrade);
    if (standing) bits.push(standing);
    if (entry.arc && entry.arc.graduated) {
      bits.push(entry.arc.completedGrades.length + " years");
    }
    return bits.join(" · ");
  }
  function studentArcProgress(entry) {
    if (!entry.arc || entry.arc.graduated || !entry.arc.streak) return null;
    const total = STREAK_REQUIRED[entry.rosterGrade] || 1;
    const value = Math.max(0, Math.min(Number(entry.arc.streak.count || 0), total));
    return { value, total };
  }
  function studentArcProgressLabel(progress) {
    if (!progress) return "";
    return "Year progress " + progress.value + " of " + progress.total;
  }
  function buildStudentArcMeter(entry) {
    const progress = studentArcProgress(entry);
    if (!progress) return null;
    const meter = document.createElement("span");
    meter.className = "student-year-meter";
    const label = studentArcProgressLabel(progress);
    meter.title = label;
    meter.setAttribute("aria-label", label);
    for (let i = 0; i < progress.total; i += 1) {
      const segment = document.createElement("span");
      segment.className = "student-year-segment" + (i < progress.value ? " is-filled" : "");
      meter.appendChild(segment);
    }
    return meter;
  }
  function buildStudentFaceChip(studentId, className) {
    const s = STUDENTS.find((x) => x.id === studentId);
    const chip = document.createElement("span");
    chip.className = className || "student-face-chip";
    chip.style.setProperty("--student-accent", s ? s.color : "#888");
    chip.title = s ? s.name : studentId;
    chip.setAttribute("aria-label", chip.title);
    const img = document.createElement("img");
    img.src = apiBase + "/assets/students/" + encodeURIComponent(studentId) + "-face.png";
    img.alt = "";
    img.onerror = () => {
      chip.classList.add("is-fallback");
      chip.textContent = s ? s.name.slice(0, 1) : "?";
    };
    chip.appendChild(img);
    return chip;
  }
  function studentSocialTitle(cell) {
    if (!cell) return "No Social Card yet";
    const affinity = Number(cell.affinity || 0);
    const signed = affinity > 0 ? "+" + affinity : String(affinity);
    if (cell.scratched) return "Social Card: " + signed + " affinity, scratched";
    if (cell.circled) return "Social Card: " + signed + " affinity, circled";
    return "Social Card: " + signed + " affinity";
  }
  function buildStudentSocialMark(cell) {
    if (!cell) return null;
    const affinity = Number(cell.affinity || 0);
    if (affinity === 0 && !cell.circled && !cell.scratched) return null;
    const mark = document.createElement("span");
    mark.className = "student-social-mark"
      + (cell.scratched ? " is-scratched" : cell.circled ? " is-circled" : affinity > 0 ? " is-warm" : affinity < 0 ? " is-cool" : " is-neutral");
    mark.title = studentSocialTitle(cell);
    mark.setAttribute("aria-label", mark.title);
    mark.textContent = affinity > 0 ? "+" + affinity : String(affinity);
    return mark;
  }
  function rebuildChannelsRail() {
    const t = lastTelemetry || {};
    const grade = t.current_grade;
    const roster = t.faculty_roster || [];
    const unlocked = secondarySurfacesUnlocked(t);
    const roomsSig = (t.rooms || []).map((r) => r.id + ":" + r.channelName + ":" + (r.teacherId || "")).join("|");
    const sig = (grade ?? "?") + "::" + roster.map((f) =>
      f.id + ":" + f.available + ":" + f.questionCount + ":" + (f.courseGrade || "")
        + ":" + (f.completedClasses ?? "") + "/" + (f.requiredClasses ?? "")
        + ":" + ((f.todayClass && f.todayClass.status) || "")
    ).join("|") + "::rooms=" + roomsSig + "::" + t.faculty + "::" + (!!t.character ? "1" : "0") + "::" + (unlocked ? "1" : "0")
      + "::students=" + studentRailSignature(t);
    if (sig === lastRosterSig) return;
    lastRosterSig = sig;

    if (t.faculty === LOUNGE_ID) {
      els.gradeTitle.textContent = (grade ? (GRADE_LABELS[grade] || grade) + " · " : "") + "Lounge";
    } else if (grade) {
      els.gradeTitle.textContent = (GRADE_LABELS[grade] || grade) + " year";
    } else {
      els.gradeTitle.textContent = "Ruby High";
    }

    els.channelsList.innerHTML = "";
    // Note: in earlier versions the lounge mode would replace the entire
    // channel list with a "in the lounge" panel, which trapped the user.
    // The list is now uniform — the lounge is just one of 4 rows below,
    // highlighted when active. The lounge stage above the chat shows the
    // teacher figures.
    if (!grade) {
      const empty = document.createElement("div");
      empty.className = "channel-section-title";
      empty.textContent = "Loading…";
      els.channelsList.appendChild(empty);
      return;
    }
    // Fixed rooms — homeroom / science / literature — driven by t.rooms.
    const rooms = (t.rooms || []).filter((r) => r.teaches);
    const cohort = t.room_cohort || {};
    rooms.forEach((room) => {
      const fac = roster.find((f) => f.id === room.teacherId);
      const row = document.createElement("button");
      const isActive = !!(fac && t.faculty === fac.id);
      row.className = "channel-row" + (isActive ? " is-active" : "");
      row.dataset.faculty = fac ? fac.id : "";
      if (fac) {
        const thumb = document.createElement("span");
        thumb.className = "teacher-thumb";
        thumb.title = "Open " + fac.displayName + "'s card";
        thumb.style.cursor = "pointer";
        thumb.addEventListener("click", (e) => { e.stopPropagation(); openTeacherProfile(fac.id); });
        const thumbUrl = teacherAssetUrl(fac, "face");
        if (thumbUrl) {
          const img = document.createElement("img");
          img.src = thumbUrl;
          img.alt = "";
          img.onerror = () => {
            thumb.style.background = fac.accent || "#444";
            thumb.textContent = teacherInitial(fac);
            if (img.parentNode === thumb) thumb.removeChild(img);
          };
          thumb.appendChild(img);
        } else {
          thumb.style.background = fac.accent || "#444";
          thumb.textContent = teacherInitial(fac);
        }
        row.appendChild(thumb);
      }
      const hash = document.createElement("span");
      hash.className = "hash";
      hash.textContent = "#";
      row.appendChild(hash);
      const name = document.createElement("span");
      name.style.flex = "1 1 auto";
      name.textContent = room.channelName;
      row.appendChild(name);
      const cohortIds = (cohort[room.id] || []).filter((sid) => shouldShowStudentId(sid));
      if (cohortIds.length > 0) {
        const students = document.createElement("span");
        students.className = "room-student-stack";
        const studentNames = cohortIds
          .map((sid) => {
            const s = STUDENTS.find((x) => x.id === sid);
            return s ? s.name : sid;
          })
          .join(", ");
        students.title = "Students here: " + studentNames;
        students.setAttribute("aria-label", students.title);
        cohortIds.forEach((sid) => {
          students.appendChild(buildStudentFaceChip(sid, "room-student-chip"));
        });
        row.appendChild(students);
      }
      if (fac && fac.courseGrade) {
        const subjectMark = document.createElement("span");
        subjectMark.className = "subject-status-pill";
        const done = Number(fac.completedClasses || 0);
        const required = Number(fac.requiredClasses || 0);
        subjectMark.title = done + "/" + required + " daily classes passed";
        subjectMark.textContent = fac.courseGrade;
        row.appendChild(subjectMark);
      }
      row.addEventListener("click", () => fac && setFaculty(fac.id));
      els.channelsList.appendChild(row);
    });

    // The Teachers' Lounge and class roster stay out of the first-session
    // path until the player has completed at least one daily class.
    if (unlocked) {
      const row = document.createElement("button");
      const isActive = t.faculty === LOUNGE_ID;
      row.className = "channel-row" + (isActive ? " is-active" : "");
      const thumb = document.createElement("span");
      thumb.className = "teacher-thumb";
      thumb.style.background = "#9b6dff";
      thumb.style.display = "grid";
      thumb.style.placeItems = "center";
      thumb.style.color = "#fff";
      thumb.style.fontSize = "13px";
      thumb.textContent = "🛋";
      row.appendChild(thumb);
      const hash = document.createElement("span");
      hash.className = "hash";
      hash.textContent = "#";
      row.appendChild(hash);
      const name = document.createElement("span");
      name.style.flex = "1 1 auto";
      name.textContent = "lounge";
      row.appendChild(name);
      row.addEventListener("click", () => enterLounge());
      els.channelsList.appendChild(row);
    }

    // Students — group the cohort by the year they are actually living in,
    // then use the row body for room/arc/social-card state instead of
    // repeating the same grade chip six times.
    if (!unlocked) return;
    const studentsTitle = document.createElement("div");
    studentsTitle.className = "channel-section-title";
    studentsTitle.textContent = "Students";
    els.channelsList.appendChild(studentsTitle);
    const npcRoster = (t.npc_roster || [])
      .map((npc) => {
        const s = STUDENTS.find((x) => x.id === npc.id);
        if (!s || !shouldShowStudentId(npc.id)) return null;
        const arc = studentArcFor(npc.id, t);
        const rosterGrade = arc && !arc.graduated ? arc.grade : npc.grade;
        const gradeIdx = GRADE_ORDER.indexOf(String(rosterGrade));
        return {
          npc,
          s,
          arc,
          rosterGrade,
          socialCell: studentSocialCellFor(npc.id, t),
          sortGrade: arc && arc.graduated ? GRADE_ORDER.length : (gradeIdx >= 0 ? gradeIdx : GRADE_ORDER.length + 1),
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.sortGrade !== b.sortGrade) return a.sortGrade - b.sortGrade;
        return String(a.s.name).localeCompare(String(b.s.name));
      });
    const groups = new Map();
    npcRoster.forEach((entry) => {
      const key = studentCohortKey(entry);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
    Array.from(groups.entries())
      .sort((a, b) => studentCohortSortValue(a[0]) - studentCohortSortValue(b[0]))
      .forEach(([key, entries]) => {
        const group = document.createElement("div");
        group.className = "student-cohort-group";

        const header = document.createElement("div");
        header.className = "student-cohort-header";
        const headerLabel = document.createElement("span");
        headerLabel.textContent = studentCohortLabel(key);
        const count = document.createElement("span");
        count.className = "student-cohort-count";
        count.textContent = String(entries.length);
        header.appendChild(headerLabel);
        header.appendChild(count);
        group.appendChild(header);

        entries.forEach((entry) => {
          const { npc, s, arc, rosterGrade, socialCell } = entry;
          const gradeTitle = arc && arc.graduated
            ? "Graduated"
            : (GRADE_LABELS[rosterGrade] || ("Grade " + rosterGrade));
          const row = document.createElement("button");
          row.className = "channel-row student-row";
          row.type = "button";
          const progress = studentArcProgress(entry);
          row.setAttribute("aria-label", s.name + ", " + gradeTitle + (progress ? ", " + studentArcProgressLabel(progress) : ""));

          const thumb = document.createElement("span");
          thumb.className = "teacher-thumb student-thumb";
          thumb.style.setProperty("--student-accent", s.color);
          thumb.style.background = "#222";
          const img = document.createElement("img");
          img.src = apiBase + "/assets/students/" + encodeURIComponent(npc.id) + "-face.png";
          img.alt = "";
          img.onerror = () => { thumb.style.background = s.color; thumb.removeChild(img); };
          thumb.appendChild(img);
          row.appendChild(thumb);

          const meta = document.createElement("span");
          meta.className = "student-row-meta";
          const name = document.createElement("span");
          name.className = "student-row-name";
          name.textContent = s.name;
          meta.appendChild(name);
          const detail = document.createElement("span");
          detail.className = "student-row-detail";
          const subtitleText = studentArcSubtitle(entry, grade);
          if (subtitleText) {
            const sub = document.createElement("span");
            sub.className = "student-row-subtitle";
            sub.textContent = subtitleText;
            detail.appendChild(sub);
          }
          const meter = buildStudentArcMeter(entry);
          if (meter) detail.appendChild(meter);
          if (detail.children.length > 0) meta.appendChild(detail);
          row.appendChild(meta);

          const social = buildStudentSocialMark(socialCell);
          if (social) row.appendChild(social);
          row.addEventListener("click", () => openStudentProfile(npc, s));
          group.appendChild(row);
        });

        els.channelsList.appendChild(group);
      });
  }
  function channelNameFor(f) {
    if (!f) return "channel";
    if (f.id === "ruby") return "homeroom";
    if (f.id === "sally-science") return "science";
    if (f.id === "professor-edward") return "literature";
    if (f.id === LOUNGE_ID) return "lounge";
    return f.id;
  }
  function roomForTeacher(facultyId, rooms) {
    return (rooms || []).find((r) => r.teacherId === facultyId) || null;
  }
  function channelTitleFor(t, fac) {
    const room = fac ? roomForTeacher(fac.id, t.rooms) : null;
    return room && room.channelName ? room.channelName : (fac ? channelNameFor(fac) : "lounge");
  }

  // ── primary actions ──────────────────────────────────────────────────────
  function greetingFor(fac, grade) {
    const g = grade ? "Grade " + grade : "class";
    if (fac.id === "ruby") return "Welcome to " + g + ". I'll put something on the board.";
    if (fac.id === "sally-science") return "Sally here. " + g + " STEM — let's see what you've got.";
    if (fac.id === "professor-edward") return "You've found my " + g + " literature room. Take a seat.";
    return "Class is in session. The teacher will put something on the board.";
  }
  async function setFaculty(facultyId) {
    const prev = lastTelemetry && lastTelemetry.faculty;
    if (facultyId === prev) { closeRails(); return; }
    const data = await command({ type: "set-faculty", faculty: facultyId });
    if (data && data.session) {
      clearStream();
      resetBlackboard();
      resetAgentGuards();
      const actualFaculty = data.session.telemetry.faculty || facultyId;
      const fac = (data.session.telemetry.faculty_roster || []).find((f) => f.id === actualFaculty);
      const grade = data.session.telemetry.current_grade;
      if (teacherChatEnabled()) {
        loadHistory(actualFaculty);
        runAgentTurn("channel-enter", { grade }, { force: true });
      } else if (fac) {
        appendMsg({ kind: "teacher", name: fac.displayName, body: greetingFor(fac, grade), color: fac.accent, facultyId: fac.id });
      }
    }
    closeRails();
  }
  async function enterLounge() {
    const prev = lastTelemetry && lastTelemetry.faculty;
    if (prev === LOUNGE_ID) { closeRails(); return; }
    const data = await command({ type: "set-faculty", faculty: LOUNGE_ID });
    if (data && data.session) {
      clearStream();
      resetBlackboard();
      resetAgentGuards();
      appendSystem("— You walk into the teachers' lounge —");
      if (aiEnabled) {
        runAgentTurn("lounge-enter", { }, { force: true });
      } else {
        appendSystem("Enable AI to eavesdrop on the faculty.");
      }
    }
    closeRails();
  }
  async function startPostClassPractice(postClass) {
    if (!postClass || !postClass.report) return false;
    const manualTurn = turnController.beginManual();
    if (!manualTurn) return true;
    try {
      if (postClass.canPick) {
        const data = await command({ type: "pick", mode: "practice" });
        if (data && !data.noQuestionDue) {
          lockedFor = null;
          return true;
        }
      }
      if (teacherChatEnabled()) {
        await runAgentTurn("manual", {
          grade: lastTelemetry && lastTelemetry.current_grade,
          intent: "advance",
        }, { force: true });
      } else {
        showNoScheduledQuestionReadyHint();
      }
      lockedFor = null;
      return true;
    } finally {
      manualTurn.finish();
    }
  }
  async function pickNext() {
    // Graduation ceremony is always accessible — bypass the agent turn guard so
    // the Ceremony button works even while a teacher SSE turn is in flight.
    if (lastTelemetry && lastTelemetry.graduation_ready && !lastTelemetry.current) {
      openSheet();
      return;
    }
    const postClass = postClassState(lastTelemetry);
    if (postClass.report) {
      const now = Date.now();
      if (now - lastChatButtonAt < 900) return;
      lastChatButtonAt = now;
      await startPostClassPractice(postClass);
      return;
    }
    // When the round clock expired but the room-idle DM turn hasn't resolved
    // the board yet, suppress extra chat turns — the teacher is already on it.
    if (lastTelemetry && lastTelemetry.active_round && lastTelemetry.active_round.idleTriggered && !lastTelemetry.active_round.resolved) return;
    if (turnController.isBusy()) return;
    const now = Date.now();
    if (now - lastChatButtonAt < 900) return;
    lastChatButtonAt = now;
    const buttonTurn = turnController.beginButtonAction();
    if (!buttonTurn) return;
    try {
      const phase = telemetryPhase(lastTelemetry);
      if (!teacherChatEnabled()) {
        if (phase === "asking") {
          appendSystem("Answer the board to continue. Connect or enable AI for hints.");
          return;
        }
        if (phase === "lounge") {
          appendSystem("Enable AI to hear the lounge conversation continue.");
          return;
        }
        if (lastTelemetry && lastTelemetry.graduation_ready) {
          if (currentRevealMatches(lastTelemetry)) {
            await command({ type: "clear" });
            lockedFor = null;
            return;
          }
          const firstChoice = els.blackboardPanel.querySelector(".graduation-choice");
          if (firstChoice && typeof firstChoice.focus === "function") firstChoice.focus();
          return;
        }
        if (phase === "revealed") {
          await command({ type: "clear" });
          lockedFor = null;
          return;
        }
        if (!scheduledCanPick(lastTelemetry)) {
          showNoScheduledQuestionReadyHint();
          return;
        }
        const data = await command({ type: "pick" });
        if (data && data.noQuestionDue) showNoScheduledQuestionReadyHint();
        lockedFor = null;
        return;
      }
      if (phase === "asking") {
        await runPlayerChatTurn("hint", { questionId: lastTelemetry.current && lastTelemetry.current.id });
        return;
      }
      if (phase === "lounge") {
        await runPlayerChatTurn("lounge");
        return;
      }
      if (lastTelemetry && lastTelemetry.graduation_ready) {
        if (currentRevealMatches(lastTelemetry)) {
          await command({ type: "clear" });
          lockedFor = null;
          return;
        }
        const firstChoice = els.blackboardPanel.querySelector(".graduation-choice");
        if (firstChoice && typeof firstChoice.focus === "function") firstChoice.focus();
        return;
      }
      if (phase === "revealed") {
        if (currentRevealCompletedClass(lastTelemetry)) {
          await command({ type: "clear" });
          lockedFor = null;
          await runPlayerChatTurn("report");
          return;
        }
        await runPlayerChatTurn("report");
        return;
      }
      await runPlayerChatTurn("class");
    } finally {
      buttonTurn.finish();
    }
  }
  async function pickAnswer(choice, btn) {
    if (!btn || btn.disabled) return;
    els.answers.forEach((b) => (b.disabled = true));
    const data = await command({ type: "answer", picked: choice, role });
    lockedFor = data && data.session && data.session.telemetry && data.session.telemetry.current
      ? data.session.telemetry.current.id : null;
    if (data && data.session && data.session.telemetry) {
      maybeRunAnswerGraded(data.session.telemetry, 0);
    }
    // The command response contains the resolved round. render() normally
    // schedules the teacher reaction; this direct call is the fallback that
    // keeps clicked answers from waiting for a later chat message.
  }

  async function submitTypedAnswer(event) {
    if (event) event.preventDefault();
    if (typedSubmitting || !els.typedAnswerInput || els.typedSubmitBtn.disabled) return;
    const answerText = els.typedAnswerInput.value || "";
    if (!answerText.trim()) return;
    const opinionQuestionId = lastTelemetry && lastTelemetry.current ? lastTelemetry.current.id : null;
    const roundAtSubmit = lastTelemetry && lastTelemetry.active_round;
    const inOpinion = !!(
      lastTelemetry
      && lastTelemetry.is_opinion
      && roundAtSubmit
      && !roundAtSubmit.resolved
      && !playerOpinionRecorded(roundAtSubmit)
      && !(opinionSubmitted && opinionSubmittedQuestionId === opinionQuestionId)
    );
    typedSubmitting = true;
    els.typedSubmitBtn.disabled = true;
    els.typedAnswerInput.disabled = true;
    try {
      if (inOpinion) {
        markOpinionSubmitted(opinionQuestionId);
        appendMsg({ kind: "you", name: playerDisplayName(), body: answerText, color: "var(--accent)" });
        els.typedAnswerInput.value = "";
        const targetFaculty = (lastTelemetry && lastTelemetry.faculty) || "ruby";
        // In offline mode submit with force=true so the server fills any
        // missing NPC slots and resolves the round; without that flag a
        // non-AI session would just sit on "waiting" forever (NPCs never
        // chime in without the LLM turn).
        const streamGuard = turnController.nextStreamGuard(targetFaculty);
        const r = await apiFetch("/api/apps/ruby-high/chat/opinion-submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          timeoutMs: STREAM_CONNECT_TIMEOUT_MS,
          body: JSON.stringify(aiEnabled ? { text: answerText } : { text: answerText, force: true }),
        });
        await consumeSseStream(r, streamGuard);
      } else {
        const data = await command({ type: "answer-text", answerText, role });
        lockedFor = data && data.session && data.session.telemetry && data.session.telemetry.current
          ? data.session.telemetry.current.id : null;
        if (data && data.session && data.session.telemetry) {
          maybeRunAnswerGraded(data.session.telemetry, 0);
        }
      }
    } catch (err) {
      if (inOpinion) clearOpinionSubmitted();
      appendSystem("submit failed · " + (err && err.message ? err.message : "error"));
    } finally {
      typedSubmitting = false;
      const round = lastTelemetry && lastTelemetry.active_round;
      const locked = !!(round && round.player && round.player.isLocked);
      const opinionLocked = !!(
        inOpinion
        && (playerOpinionRecorded(round) || (opinionSubmitted && opinionSubmittedQuestionId === opinionQuestionId))
      );
      els.typedAnswerInput.disabled = role === "agent" || (inOpinion ? opinionLocked : locked);
      els.typedSubmitBtn.disabled = role === "agent" || (inOpinion ? opinionLocked : locked);
    }
  }

  async function generateMultipleChoice() {
    if (generatingMc || !els.generateMcBtn || els.generateMcBtn.disabled) return;
    generatingMc = true;
    els.generateMcBtn.disabled = true;
    els.generateMcBtn.textContent = "MC...";
    try {
      await command({ type: "generate-mc" });
    } finally {
      generatingMc = false;
      els.generateMcBtn.textContent = "MC";
    }
  }

  // ── advantage roll ──────────────────────────────────────────────────────
  let rollingAdvantage = false;
  function renderAdvantageBar(t) {
    const round = t && t.active_round;
    // Visibility (the bar itself) is owned by applyViewMode/CSS via
    // data-mode. We only paint contents when there's a live round to
    // describe; otherwise clear stale eliminated-button styling so it
    // doesn't survive into the next round.
    if (!round || !t || !t.current) {
      els.answers.forEach((btn) => btn.classList.remove("is-eliminated"));
      return;
    }
    const adv = round.advantage;
    const playerLocked = round.player.isLocked;
    if (adv && adv.rolled) {
      els.advantageBtn.disabled = true;
      els.advantageBtn.textContent = "🎲 Rolled";
      els.advantageResult.hidden = false;
      els.advantageResult.className = "advantage-result " + adv.outcome;
      const fmt = (n) => (n >= 0 ? "+" : "") + n;
      const mod = adv.total - (adv.dice[0] + adv.dice[1]);
      const tail = adv.outcome === "miss"
        ? "no penalty"
        : adv.outcome === "mixed"
          ? "crossed out " + (adv.eliminated[0] || "—")
          : "crossed out " + adv.eliminated.join(" & ");
      els.advantageResult.textContent =
        adv.dice[0] + "+" + adv.dice[1] + fmt(mod) + " " + adv.stat.toUpperCase()
        + " = " + adv.total + " · " + adv.outcome + " · " + tail;
      // Cross out the eliminated answer buttons.
      els.answers.forEach((btn) => {
        const elim = (adv.eliminated || []).includes(btn.dataset.pick);
        btn.classList.toggle("is-eliminated", elim);
        if (elim) btn.disabled = true;
      });
    } else {
      // Per-grade cap: when remaining=0, button reads "out of rolls" and
      // is disabled. Otherwise label includes the remaining count so the
      // player can budget across the rest of the grade.
      const budget = (t && t.advantage_rolls) || { remaining: 3, cap: 3 };
      const exhausted = budget.remaining <= 0;
      els.advantageBtn.disabled = playerLocked || rollingAdvantage || exhausted;
      els.advantageBtn.textContent = exhausted
        ? "🎲 Out of rolls this grade"
        : "🎲 Roll for advantage (" + budget.remaining + "/" + budget.cap + " left)";
      els.advantageResult.hidden = true;
      els.answers.forEach((btn) => btn.classList.remove("is-eliminated"));
    }
  }
  async function rollAdvantage() {
    if (rollingAdvantage) return;
    rollingAdvantage = true;
    els.advantageBtn.disabled = true;
    try {
      await command({ type: "roll-advantage" });
    } finally {
      rollingAdvantage = false;
    }
  }
  els.advantageBtn.addEventListener("click", rollAdvantage);

  // ── render (the master apply-telemetry-to-DOM function) ──────────────────
  function setAccent(color) {
    document.documentElement.style.setProperty("--accent", color || "#d22a2a");
  }
  // ── view-mode state machine ─────────────────────────────────────────────
  // Single source of truth for "what should be visible right now". Every
  // visibility flag in the UI is derived from the mode + telemetry, so the
  // states can't drift out of sync (the bug from the obsolete-UI screenshot).
  function deriveViewMode(t) {
    if (authed === null) return "checking-auth";
    if (!authed) return "needs-auth";
    if (!t || !t.character) return "needs-character";
    if (t.faculty === LOUNGE_ID) return "in-lounge";
    if (t.active_round && !t.active_round.resolved && t.current) return "round-live";
    if (t.current) return "round-revealed";
    return "between-rounds";
  }
  function applyViewMode(mode) {
    // The single authority for "what should be visible right now". Sets
    // a data-mode attribute on the blackboard panel + on the shell, and
    // CSS hides per mode (see the .blackboard-panel[data-mode=...] rules).
    // Sub-renderers below (renderRaceStrip, renderAdvantageBar) only paint
    // CONTENT — they no longer fight over visibility.
    els.blackboardPanel.dataset.mode = mode;
    els.shell.dataset.mode = mode;
    updateChatAction(mode);
    els.chatForm.hidden = true;
    setChatComposerDisabled(true);
    // Race strip + answers + advantage + footer-filter all hide via CSS now.
    // We still null out the race-row contents on mode exit so the next
    // round-live paint doesn't double-render stale cards.
    if (mode !== "round-live" && els.raceRow) els.raceRow.innerHTML = "";
  }

  function render(s) {
    if (!s || !s.telemetry) return;
    const t = s.telemetry;
    lastTelemetry = t;
    syncBillingWallet(t);
    if (teacherChatEnabled() && t.faculty && (!renderedHistorySig || !renderedHistorySig.startsWith(t.faculty + ":"))) {
      loadHistory(t.faculty);
    }
    applyViewMode(deriveViewMode(t));
    if (els.packBtn) els.packBtn.hidden = !packStoreUnlocked(t);

    setAccent(t.facultyAccent);
    rebuildServersRail();
    rebuildChannelsRail();

    // If the character just graduated and has no diploma image yet, kick off
    // generation. This is fire-and-forget — the server stamps the URL onto
    // the character; the next telemetry tick brings it back and the sheet
    // renders the cap-and-gown image instead of the standing portrait.
    if (t.character && graduatedFor(t.character) && !t.character.diplomaImageDataUrl) {
      void maybeFireDiplomaGen(t.character);
    }

    // Grade-advancement celebration. Fires when current_grade ticks up
    // OR when the yearbook grows (catches Senior→graduated, where
    // current_grade may not change). lastShownGrade is null on the
    // first tick; we suppress the toast then so re-opening the app
    // mid-Sophomore doesn't say "You're a Sophomore now!" every time.
    if (
      t.character && t.current_grade
      && lastShownGrade !== null
      && t.current_grade !== lastShownGrade
    ) {
      const label = (typeof GRADE_LABELS !== "undefined" && GRADE_LABELS[t.current_grade]) || ("Grade " + t.current_grade);
      showCongrats("You're a " + label + " now!", true);
      // Open the sheet so the new year's "what you need" hint is the
      // first thing the player sees post-advance. Timeout matches the
      // congrats-toast cadence so the modal doesn't land on top of it.
      setTimeout(() => { if (!sheetOverlayOpen) openSheet(); }, 900);
    }
    if (
      t.character && Array.isArray(t.character.yearbook)
      && lastYearbookLen !== null
      && t.character.yearbook.length > lastYearbookLen
      && graduatedFor(t.character)
    ) {
      // Senior completion. The diploma modal handles the bigger beat;
      // the toast just marks the moment.
      showCongrats("You graduated.", true);
      setTimeout(() => { if (!sheetOverlayOpen) openSheet(); }, 900);
    }
    lastYearbookLen = t.character && Array.isArray(t.character.yearbook) ? t.character.yearbook.length : 0;

    // Header
    const fac = (t.faculty_roster || []).find((f) => f.id === t.faculty);
    els.channelTitle.textContent = channelTitleFor(t, fac);
    const subjectProgress = t.active_course_progress;
    const subjectStatus = subjectProgress
      ? subjectStatusText(subjectProgress)
      : (t.current_grade ? "Grade " + t.current_grade : "settling in");
    els.channelSub.textContent = fac
      ? fac.displayName + " · " + subjectStatus
      : "loading…";
    renderArcIndicator(t);

    // Render blackboard panel (single, in-place updates).
    renderBlackboard(t.current || null, fac || null, t.current_grade);
    renderRaceStrip(t);
    renderAdvantageBar(t);
    if (t.is_opinion && t.active_round) {
      renderOpinionsIntoChat(t.active_round);
      maybeAutoTriggerGrading(t);
    }

    // Reveal — apply to blackboard + log a result chip in the chat once.
    // ALSO fire the teacher's reaction here (not in pickAnswer) so they
    // react to the full round outcome, not the bare click.
    if (t.lastReveal) {
      const revealId = t.lastReveal.questionId + ":" + t.lastReveal.picked;
      const revealMatchesCurrent = activeQuestionId === t.lastReveal.questionId;
      if (revealMatchesCurrent && revealId !== lastRevealId) {
        lastRevealId = revealId;
        if (t.is_opinion) {
          applyOpinionRevealToBlackboard(t.active_round);
          appendSocialSummary(t.lastReveal, t);
        } else {
          applyRevealToBlackboard(t.lastReveal);
          appendResultChip(t.lastReveal);
        }
        showCongrats(t.lastReveal.encouragement, t.lastReveal.wasCorrect);
        // Teacher reacts + queues next question. Fire immediately so the
        // teacher's response starts streaming first; the student chime
        // (scheduled below) lands later as a follow-up reaction, not as
        // the only voice in the room while the teacher is still loading.
        // force=true: bypass the current agent turn. If a prior turn's SSE
        // stream stuck (network drop, server hang), the old busy flag stayed true
        // and answer-graded gets silently dropped — leaving the player
        // staring at a revealed answer with no next question. The teacher
        // reaction is the thing that unsticks the flow; never gate it.
        maybeRunAnswerGraded(t, 0);
        // Student chime lands AFTER the teacher's response window so the
        // room doesn't feel like the students are doing all the talking
        // before the teacher catches up. Long delay; the cooldown still
        // suppresses pile-ons.
        scheduleStudentChime(t.lastReveal.wasCorrect, t.current_grade, 4500);
      }
    } else if (t.active_round && !t.active_round.resolved && t.active_round.idleTriggered) {
      maybeRunRoomIdle(t);
    } else if (!t.current && lastRevealId) {
      lastRevealId = null;
      lastAnswerGradedTriggerId = null;
      lastIdleTriggerId = null;
    }

    // Empty-stream welcome (only if no chat yet). New sessions are born
    // with a grade set, so the !current_grade branch only fires for legacy
    // state files mid-migration.
    if (els.stream.children.length === 0) {
      if (!t.current_grade) {
        appendEmptyState({
          title: "Welcome to Ruby High",
          body: "Settling you in — your teacher will be with you in a moment.",
          facultyId: "ruby",
        });
      } else {
        const f = (t.faculty_roster || []).find((x) => x.id === t.faculty);
        if (f) appendMsg({ kind: "teacher", name: f.displayName, body: greetingFor(f, t.current_grade), color: f.accent, facultyId: f.id });
      }
    }

    // First-launch character creation: open sheet overlay automatically once
    // the player has a Ruby High session. Offline mode can roll locally.
    if (authed === true && !t.character && !sheetAutoShown && !sheetOverlayOpen) {
      sheetAutoShown = true;
      openSheet();
    }
    if (t.character) {
      const youName = els.youName;
      if (youName && youName.textContent !== t.character.name) youName.textContent = t.character.name;
      const youAvatar = els.youAvatar;
      if (youAvatar) {
        if (t.character.portraitDataUrl) {
          // Replace letter with portrait img.
          if (!youAvatar.querySelector("img")) {
            youAvatar.innerHTML = "";
            const img = document.createElement("img");
            img.src = t.character.portraitDataUrl;
            img.alt = "";
            img.style.cssText = "width:100%;height:100%;object-fit:cover;object-position:center top;";
            youAvatar.appendChild(img);
          } else {
            const img = youAvatar.querySelector("img");
            if (img.src !== t.character.portraitDataUrl) img.src = t.character.portraitDataUrl;
          }
        } else {
          if (youAvatar.querySelector("img")) {
            youAvatar.innerHTML = "";
          }
          if (youAvatar.textContent !== (t.character.name || "U").slice(0, 1).toUpperCase()) {
            youAvatar.textContent = (t.character.name || "U").slice(0, 1).toUpperCase();
          }
        }
      }
      syncPlayerMessageHeaders();
    }

    lastShownGrade = t.current_grade;
    lastShownFaculty = t.faculty;

    // Auto-start the next class question when the board is empty. Without
    // this, offline mode sits forever on an empty board (no AI tool call
    // to fire pose_question), and AI mode just gets a faster start. If a
    // race produces a double-pose, the server's assertBoardMutationAllowed
    // makes the second one no-op.
    void maybeAutoStartClass(t);
  }

  // The post-acceptance background portrait gen path is GONE in this
  // PR. Portrait selection happens entirely at character creation now:
  // the player either keeps the playbook's default portrait or hits
  // "✨ Generate AI portrait" and confirms the AI image before
  // accepting. Mid-game avatar regeneration is deliberately NOT a
  // surface — the only place a post-creation regenerate exists is the
  // graduation flow (diploma image with a "try a different look"
  // button), which is its own self-contained path on
  // /chat/character/diploma.

  // ── unified CCG-style character card ────────────────────────────────────
  // One renderer for player, student, AND teacher cards. Big art on top,
  // name banner, stats line, body text, optional quote, optional footer.
  // Actions (when present) render as a footer strip INSIDE the card —
  // not as a separate sibling row underneath. The "two stacked cards"
  // visual the player complained about is the legacy of the prior
  // append-trailing-row pattern; it's gone now.
  function buildCharacterCard(spec) {
    // spec: { role, name, subtitle, portraitUrl, accent, stats?, bodyText, quote?, nextStepHint?, footer?, actions? }
    const card = document.createElement("div");
    card.className = "ccg-card";
    if (spec.accent) card.style.borderColor = spec.accent;
    const role = document.createElement("span");
    role.className = "ccg-role " + spec.role;
    if (spec.accent) role.style.background = spec.accent;
    role.textContent = spec.role;
    card.appendChild(role);
    const art = document.createElement("div");
    art.className = "ccg-art";
    if (spec.portraitUrl) {
      const img = document.createElement("img");
      img.src = spec.portraitUrl;
      img.alt = "";
      img.onerror = () => { art.innerHTML = ""; art.style.display = "grid"; art.style.placeItems = "center"; art.textContent = (spec.name || "?").slice(0, 1).toUpperCase(); };
      art.appendChild(img);
    } else {
      art.style.display = "grid";
      art.style.placeItems = "center";
      art.style.fontSize = "72px";
      art.style.color = "var(--text-mute)";
      art.textContent = (spec.name || "?").slice(0, 1).toUpperCase();
    }
    card.appendChild(art);
    const body = document.createElement("div");
    body.className = "ccg-body";
    const nameEl = document.createElement("div");
    nameEl.className = "ccg-name";
    nameEl.textContent = spec.name || "—";
    body.appendChild(nameEl);
    if (spec.subtitle) {
      const sub = document.createElement("div");
      sub.className = "ccg-subtitle";
      sub.textContent = spec.subtitle;
      body.appendChild(sub);
    }
    if (spec.stats) {
      const stats = document.createElement("div");
      stats.className = "ccg-stats";
      const fmt = (n) => (n >= 0 ? "+" : "") + n;
      ["head", "heart", "hustle", "honor"].forEach((k) => {
        const wrap = document.createElement("span");
        wrap.className = "stat";
        const ke = document.createElement("span"); ke.className = "k"; ke.textContent = k;
        const ve = document.createElement("span");
        const v = spec.stats[k];
        ve.className = "v" + (v > 0 ? " pos" : v < 0 ? " neg" : "");
        ve.textContent = fmt(v);
        wrap.appendChild(ke); wrap.appendChild(ve);
        stats.appendChild(wrap);
      });
      body.appendChild(stats);
    }
    if (spec.quote) {
      const q = document.createElement("blockquote");
      q.className = "ccg-quote";
      renderMarkdownInto(q, "“" + spec.quote + "”", { inline: true });
      body.appendChild(q);
    }
    if (spec.nextStepHint) {
      const ns = document.createElement("div");
      ns.className = "ccg-next-step";
      ns.textContent = spec.nextStepHint;
      body.appendChild(ns);
    }
    appendProgression(body, spec.progression);
    if (spec.footer) {
      const ft = document.createElement("div");
      ft.className = "ccg-footer";
      const title = document.createElement("strong");
      title.textContent = spec.footer.title;
      ft.appendChild(title);
      const content = document.createElement("span");
      content.className = "ccg-footer-content";
      renderMarkdownInto(content, spec.footer.content || "", { inline: true });
      ft.appendChild(content);
      body.appendChild(ft);
    }
    if (spec.actions && spec.actions.length) {
      const actionsRow = document.createElement("div");
      actionsRow.className = "ccg-card-actions";
      for (const a of spec.actions) {
        const btn = document.createElement("button");
        btn.type = "button";
        if (a.secondary) btn.className = "secondary";
        btn.textContent = a.label;
        btn.addEventListener("click", a.onClick);
        actionsRow.appendChild(btn);
      }
      // Actions render as the LAST element inside .ccg-body — keeps the
      // card a single rectangle. The teacher/student profile cards still
      // use this for their Close button until the X-corner pattern lands.
      body.appendChild(actionsRow);
    }
    card.appendChild(body);
    return card;
  }

  // Lifted out of appendProgression so the same chip + metadata are reusable
  // by the on-board subject-grade row that renders when the chalkboard is empty.
  const SUBJECT_GATE_META = [
    { facultyId: "ruby", label: "Homeroom", icon: "⌂" },
    { facultyId: "sally-science", label: "Science", icon: "⚗" },
    { facultyId: "professor-edward", label: "Literature", icon: "✎" },
  ];
  function makeSubjectGradeChip(spec) {
    const grade = spec.grade || "F";
    const met = spec.met !== undefined ? !!spec.met : (grade === "✓" || letterGradePasses(grade));
    const chip = document.createElement("span");
    chip.className = "subject-grade-chip" + (met ? " is-met" : "");
    chip.title = grade === "—"
      ? spec.label + ": no subject grade yet"
      : spec.label + ": " + grade + (met ? " subject cleared" : " needs C and daily classes");
    chip.setAttribute("aria-label", chip.title);
    const icon = document.createElement("span");
    icon.className = "subject-grade-icon";
    icon.textContent = spec.icon;
    const letter = document.createElement("span");
    letter.className = "subject-grade-letter";
    letter.textContent = grade;
    chip.appendChild(icon);
    chip.appendChild(letter);
    return chip;
  }
  function appendProgression(parent, progression) {
    if (!progression || !Array.isArray(progression.rungs)) return;
    const ROW_GRADE_LABELS = {
      "9": "Fresh",
      "10": "Soph",
      "11": "Junior",
      "12": "Senior",
    };
    const makeGradeChip = makeSubjectGradeChip;
    const makeStreakMark = (r) => {
      const need = Math.max(1, Number((r.streakProgress && r.streakProgress.need) || r.streakReq || 1));
      const have = Math.max(0, Number((r.streakProgress && r.streakProgress.have) || 0));
      const mark = document.createElement("span");
      mark.className = "rung-streak";
      mark.title = r.state === "current"
        ? "Daily classes: " + Math.min(have, need) + "/" + need
        : need + " daily " + (need === 1 ? "class" : "classes") + " needed";
      mark.setAttribute("aria-label", mark.title);
      for (let i = 0; i < need; i++) {
        const diamond = document.createElement("span");
        diamond.className = "rung-streak-diamond";
        diamond.textContent = "◆";
        mark.appendChild(diamond);
      }
      return mark;
    };
    const makeFutureReq = (spec) => {
      const req = document.createElement("span");
      req.className = "future-req";
      req.title = spec.title;
      req.setAttribute("aria-label", spec.title);
      const icon = document.createElement("span");
      icon.className = "future-req-icon";
      icon.textContent = spec.icon;
      req.appendChild(icon);
      if (spec.count !== undefined && spec.count !== null) {
        const count = document.createElement("span");
        count.className = "future-req-count";
        count.textContent = String(spec.count);
        req.appendChild(count);
      }
      return req;
    };
    const wrap = document.createElement("div");
    wrap.className = "ccg-progression";
    const head = document.createElement("div");
    head.className = "ccg-progression-title";
    head.textContent = progression.graduated ? "Yearbook" : "Year Requirements";
    wrap.appendChild(head);
    const list = document.createElement("ol");
    list.className = "rungs";
    for (const r of progression.rungs) {
      const li = document.createElement("li");
      li.className = "rung is-" + r.state;
      const streak = makeStreakMark(r);
      const label = document.createElement("span");
      label.className = "rung-label";
      label.textContent = ROW_GRADE_LABELS[r.grade] || r.label;
      const gates = document.createElement("span");
      gates.className = "rung-gates";
      if (r.state === "current" && r.streakProgress) {
        if (Array.isArray(r.classProgress)) {
          for (const cp of r.classProgress) {
            const meta = SUBJECT_GATE_META.find((m) => m.facultyId === cp.facultyId)
              || { label: cp.facultyId, icon: "□" };
            gates.appendChild(makeGradeChip({
              label: meta.label,
              icon: meta.icon,
              grade: cp.grade,
              met: cp.progress
                ? Number(cp.progress.completedClasses || 0) >= Number(cp.progress.requiredClasses || 0) && letterGradePasses(cp.grade)
                : letterGradePasses(cp.grade),
            }));
          }
        } else {
          for (const meta of SUBJECT_GATE_META) {
            gates.appendChild(makeGradeChip({
              label: meta.label,
              icon: meta.icon,
              grade: "—",
            }));
          }
        }
      } else {
        if (r.state === "completed") {
          for (const meta of SUBJECT_GATE_META) {
            gates.appendChild(makeGradeChip({
              label: meta.label,
              icon: meta.icon,
              grade: "✓",
            }));
          }
        } else {
          for (const meta of SUBJECT_GATE_META) {
            gates.appendChild(makeFutureReq({
              icon: meta.icon,
              title: meta.label + ": C required",
            }));
          }
        }
      }
      li.appendChild(streak);
      li.appendChild(label);
      li.appendChild(gates);
      list.appendChild(li);
    }
    wrap.appendChild(list);
    parent.appendChild(wrap);
  }
  function appendCard(spec) {
    sheetCard.classList.remove("is-card-deck-sheet");
    sheetCard.classList.remove("is-two-card-deck");
    sheetCard.classList.remove("is-creation-sheet");
    sheetCard.innerHTML = "";
    const card = buildCharacterCard(spec);
    if (card) sheetCard.appendChild(card);
  }

  function renderCardDeck(cardNodes) {
    sheetCard.classList.add("is-card-deck-sheet");
    sheetCard.classList.remove("is-creation-sheet");
    sheetCard.classList.toggle("is-two-card-deck", cardNodes.length === 2);
    sheetCard.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "card-deck is-count-" + cardNodes.length;
    sheetCard.appendChild(wrap);

    const track = document.createElement("div");
    track.className = "card-deck-track";
    wrap.appendChild(track);

    cardNodes.forEach((card) => track.appendChild(card));

    // Carousel controls only render when there's more than one card.
    if (cardNodes.length > 1) {
      const dots = document.createElement("div");
      dots.className = "card-deck-dots";
      const cards = Array.from(track.children);
      cards.forEach((_, i) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "card-deck-dot" + (i === 0 ? " is-active" : "");
        dot.setAttribute("aria-label", "Show card " + (i + 1));
        dot.addEventListener("click", () => scrollToCard(i));
        dots.appendChild(dot);
      });
      wrap.appendChild(dots);

      const prev = document.createElement("button");
      prev.type = "button";
      prev.className = "card-deck-nav prev";
      prev.setAttribute("aria-label", "Previous card");
      prev.textContent = "‹";
      const next = document.createElement("button");
      next.type = "button";
      next.className = "card-deck-nav next";
      next.setAttribute("aria-label", "Next card");
      next.textContent = "›";
      wrap.appendChild(prev);
      wrap.appendChild(next);

      const scrollToCard = (i) => {
        const target = cards[Math.max(0, Math.min(cards.length - 1, i))];
        if (target && track.scrollTo) {
          const maxLeft = Math.max(0, track.scrollWidth - track.clientWidth);
          const left = Math.max(0, Math.min(
            maxLeft,
            target.offsetLeft + target.offsetWidth / 2 - track.clientWidth / 2,
          ));
          track.scrollTo({ left, behavior: "smooth" });
        }
      };
      const activeIndex = () => {
        let best = 0;
        let bestDist = Infinity;
        const wrapMid = track.scrollLeft + track.clientWidth / 2;
        cards.forEach((el, i) => {
          const mid = el.offsetLeft + el.offsetWidth / 2;
          const d = Math.abs(mid - wrapMid);
          if (d < bestDist) { bestDist = d; best = i; }
        });
        return best;
      };
      const refreshControls = () => {
        const i = activeIndex();
        Array.from(dots.children).forEach((d, idx) => {
          d.classList.toggle("is-active", idx === i);
        });
        prev.hidden = i <= 0;
        next.hidden = i >= cards.length - 1;
      };
      track.addEventListener("scroll", () => requestAnimationFrame(refreshControls), { passive: true });
      prev.addEventListener("click", () => scrollToCard(activeIndex() - 1));
      next.addEventListener("click", () => scrollToCard(activeIndex() + 1));
      requestAnimationFrame(refreshControls);
    }
  }

  // ── teacher profile (click teacher thumb in channel rail to open) ───────
  function openTeacherProfile(facultyId) {
    const t = lastTelemetry;
    const fac = (t && t.faculty_roster || []).find((f) => f.id === facultyId);
    if (!fac) return;
    sheetOverlayOpen = true;
    sheetEl.classList.add("is-open");
    renderCardDeck([
      buildTeacherProfileCard(fac),
      buildTeacherCareerCard(fac),
    ]);
  }

  // ── student profile card ─────────────────────────────────────────────────
  function openStudentProfile(npc, s) {
    sheetOverlayOpen = true;
    sheetEl.classList.add("is-open");
    // Pull this NPC's parallel-arc state from the cohort. That's the
    // rivalry surface — what year they're on, what their daily-class count looks
    // like, whether they've already graduated past you.
    const arc = (lastTelemetry && lastTelemetry.npc_cohort)
      ? lastTelemetry.npc_cohort.find((n) => n.id === npc.id)
      : null;
    const arcLine = !arc
      ? (GRADE_LABELS[npc.grade] || npc.grade)
      : arc.graduated
        ? "Graduated · " + arc.completedGrades.length + " years"
        : (GRADE_LABELS[arc.grade] || arc.grade) + " · " + arc.streak.count + " daily classes";
    renderCardDeck([
      buildCharacterCard({
        role: "student",
        name: s.name,
        subtitle: arcLine + (npc.currentRoom ? " · #" + roomLabelFor(npc.currentRoom) : ""),
        portraitUrl: studentFullPortraitUrl(npc.id),
        accent: s.color,
        stats: npc.stats,
        quote: studentVibe(npc.id),
        // Close lives in the overlay corner now (X), so no per-card button.
      }),
      buildStudentCareerCard(npc, s, arc),
    ]);
  }

  const TEACHER_STATS = {
    ruby: { head: 1, heart: 2, hustle: 1, honor: 0 },
    "sally-science": { head: 3, heart: 0, hustle: 1, honor: 1 },
    "professor-edward": { head: 3, heart: 1, hustle: -1, honor: 2 },
  };
  const TEACHER_SUBJECT_LINE = {
    ruby: "Homeroom · school lore + general",
    "sally-science": "Science Lab · physics, chem, bio, earth-sci",
    "professor-edward": "Library · postwar literature & literary theory",
  };
  const TEACHER_SIGNATURE = {
    ruby: "My job's the door. The teaching happens in the rooms.",
    "sally-science": "I'd rather you be wrong with reasons than right by accident.",
    "professor-edward": "Every wrong answer has a half-truth folded inside it. We start there.",
  };

  function teacherStatsFor(facultyId) {
    if (facultyId && typeof facultyId === "object" && facultyId.stats) return facultyId.stats;
    const id = typeof facultyId === "object" ? facultyId.id : facultyId;
    return TEACHER_STATS[id] || { head: 2, heart: 1, hustle: 1, honor: 1 };
  }
  function roomLabelFor(roomId) {
    return ({
      homeroom: "homeroom",
      science: "science",
      literature: "literature",
      lounge: "lounge",
    })[roomId] || roomId || "class";
  }
  function teacherFullPortraitUrl(facultyId) {
    return teacherPortraitUrl(facultyId, "full");
  }
  function buildTeacherProfileCard(fac) {
    const subjectLine = TEACHER_SUBJECT_LINE[fac.id] || (Array.isArray(fac.subjects) ? fac.subjects.join(", ") : fac.bio);
    return buildCharacterCard({
      role: "teacher",
      name: fac.displayName,
      subtitle: subjectLine,
      portraitUrl: teacherFullPortraitUrl(fac.id),
      accent: fac.accent,
      stats: teacherStatsFor(fac),
      quote: TEACHER_SIGNATURE[fac.id] || fac.bio,
      footer: { title: "Teaches", content: subjectLine },
      // Close lives in the overlay corner now (X), so no per-card button.
    });
  }
  function buildTeacherCareerCard(fac) {
    const subjectLine = TEACHER_SUBJECT_LINE[fac.id] || (Array.isArray(fac.subjects) ? fac.subjects.join(", ") : fac.bio);
    return buildProfileCareerCard({
      badgeLabel: "faculty",
      name: "Faculty Card",
      subtitle: subjectLine,
      metrics: [
        { label: "role", value: "Teacher", detail: "faculty", met: true },
        { label: "subject", value: TEACHING_FACULTY_LABELS[fac.id] || "Faculty", detail: "room", met: true },
        { label: "questions", value: String(fac.questionCount || 0), detail: "question bank", met: false },
      ],
    });
  }
  function buildStudentCareerCard(npc, _s, arc) {
    const grade = String((arc && arc.grade) || npc.grade || lastTelemetry?.current_grade || "9");
    const gradeLabel = GRADE_LABELS[grade] || ("Grade " + grade);
    const graduated = !!(arc && arc.graduated);
    const streakReq = STREAK_REQUIRED[grade] || 1;
    const streakHere = arc && arc.streak && arc.streak.grade === grade ? arc.streak.count : 0;
    return buildProfileCareerCard({
      badgeLabel: graduated ? "graduated" : gradeLabel,
      subtitle: graduated ? "Graduated · classmate" : gradeLabel + " · classmate",
      metrics: graduated
        ? [
            { label: "status", value: "graduated", detail: "four-year arc complete", met: true },
            { label: "yearbook", value: ((arc && arc.completedGrades && arc.completedGrades.length) || 4) + "/4", detail: "paper cards sealed", met: true },
            { label: "room", value: roomLabelFor(npc.currentRoom), detail: "last seen", met: false },
          ]
        : [
            { label: "year", value: gradeLabel, detail: "active grade", met: false },
            { label: "daily", value: streakHere + "/" + streakReq, detail: "classes passed", met: streakHere >= streakReq },
            { label: "room", value: roomLabelFor(npc.currentRoom), detail: "current room", met: false },
          ],
      progression: buildProgressionForNpcArc(arc, grade),
    });
  }
  function buildProfileCareerCard(spec) {
    const card = document.createElement("div");
    card.className = "ccg-card is-career-card";

    const role = document.createElement("span");
    role.className = "ccg-role career";
    role.textContent = spec.badgeLabel || "career";
    card.appendChild(role);

    const body = document.createElement("div");
    body.className = "ccg-body";

    const nameEl = document.createElement("div");
    nameEl.className = "ccg-name";
    nameEl.textContent = spec.name || "School Career";
    body.appendChild(nameEl);

    const sub = document.createElement("div");
    sub.className = "ccg-subtitle";
    sub.textContent = spec.subtitle || "";
    body.appendChild(sub);

    body.appendChild(buildCareerMetrics(spec.metrics || []));
    appendProgression(body, spec.progression);
    card.appendChild(body);
    return card;
  }
  function buildCareerMetrics(rows) {
    const metrics = document.createElement("div");
    metrics.className = "career-metrics";
    rows.forEach((m) => {
      const row = document.createElement("div");
      row.className = "career-metric" + (m.met ? " is-met" : "");
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = m.label;
      const v = document.createElement("span");
      v.className = "v";
      v.textContent = m.value;
      const d = document.createElement("span");
      d.className = "detail";
      d.textContent = m.detail;
      row.appendChild(k);
      row.appendChild(v);
      row.appendChild(d);
      metrics.appendChild(row);
    });
    return metrics;
  }
  function buildCareerTokens(spec) {
    const wrap = document.createElement("div");
    wrap.className = "career-token-strip";

    const streak = document.createElement("div");
    streak.className = "career-token-lane";
    const streakLabel = document.createElement("span");
    streakLabel.className = "career-token-label";
    streakLabel.textContent = "Daily classes";
    streak.appendChild(streakLabel);
    const streakTrack = document.createElement("span");
    streakTrack.className = "career-streak-track";
    // Daily-class track: cap visible diamonds at STREAK_TRACK_VISIBLE_CAP (3)
    // so the highest bonus tier is a surprise reveal, not a spoiled preview.
    // The underlying gameplay still uses spec.streakReq for advancement.
    const STREAK_TRACK_VISIBLE_CAP = 3;
    const streakReq = Math.max(0, spec.streakReq || 0);
    const streakCap = Math.min(STREAK_TRACK_VISIBLE_CAP, streakReq);
    const currentStreak = Math.max(0, spec.streakHere || 0);
    const scoreStreak = spec.streakLastDate && spec.todayKey && spec.streakLastDate === spec.todayKey
      ? Math.max(0, currentStreak - 1)
      : currentStreak;
    const streakFilled = Math.max(0, Math.min(streakCap, currentStreak));
    const liveMult = streakScoreMultiplier(scoreStreak);
    const bonusActive = liveMult >= 2;
    // Once the bonus tier kicks in, the diamonds + count are redundant —
    // the bonus pill IS the live state. Show only the pill so the lane
    // reads as one strong signal, not three competing ones.
    if (bonusActive) {
      streakTrack.classList.add("is-bonus-only");
      const chip = document.createElement("span");
      chip.className = "career-multiplier is-live is-bonus";
      chip.textContent = "×" + liveMult + " Bonus!";
      chip.setAttribute("aria-label", "×" + liveMult + " score bonus active");
      streakTrack.appendChild(chip);
      streak.appendChild(streakTrack);
    } else {
      const diamonds = document.createElement("span");
      diamonds.className = "career-diamonds";
      for (let i = 0; i < streakCap; i++) {
        const diamond = document.createElement("span");
        diamond.className = "career-diamond" + (i < streakFilled ? " is-filled" : "");
        diamond.setAttribute("aria-label", i < streakFilled ? "Daily class passed" : "Daily class needed");
        diamonds.appendChild(diamond);
      }
      streakTrack.appendChild(diamonds);
      streak.appendChild(streakTrack);
      const streakCount = document.createElement("span");
      streakCount.className = "career-token-count";
      streakCount.textContent = streakFilled + "/" + streakCap;
      streak.appendChild(streakCount);
    }
    wrap.appendChild(streak);

    const advantage = document.createElement("div");
    advantage.className = "career-token-lane";
    const advantageLabel = document.createElement("span");
    advantageLabel.className = "career-token-label";
    advantageLabel.textContent = "Advantage";
    advantage.appendChild(advantageLabel);
    const dice = document.createElement("span");
    dice.className = "career-dice";
    const dieCap = Math.max(0, spec.advantageCap || 0);
    const remaining = Math.max(0, Math.min(dieCap, spec.advantageRemaining || 0));
    for (let i = 0; i < dieCap; i++) {
      const die = document.createElement("span");
      die.className = "career-die" + (i < remaining ? " is-live" : "");
      die.setAttribute("aria-label", i < remaining ? "Advantage die available" : "Advantage die spent");
      for (let p = 0; p < 5; p++) die.appendChild(document.createElement("span"));
      dice.appendChild(die);
    }
    advantage.appendChild(dice);
    const advantageCount = document.createElement("span");
    advantageCount.className = "career-token-count";
    // "0/4" reads as a defeat. When the dice are spent, say "Spent" instead.
    advantageCount.textContent = dieCap === 0
      ? "—"
      : remaining === 0
        ? "Spent"
        : remaining + "/" + dieCap;
    advantage.appendChild(advantageCount);
    wrap.appendChild(advantage);

    return wrap;
  }
  function buildCompletedHighSchoolProgression() {
    return {
      graduated: true,
      rungs: ["9", "10", "11", "12"].map((g) => ({
        grade: g,
        label: GRADE_LABELS[g],
        streakReq: STREAK_REQUIRED[g] || 1,
        state: "completed",
      })),
    };
  }
  function buildProgressionForNpcArc(arc, fallbackGrade) {
    if (arc && arc.graduated) return buildCompletedHighSchoolProgression();
    const completed = new Set((arc && Array.isArray(arc.completedGrades) ? arc.completedGrades : []));
    const currentGrade = String((arc && arc.grade) || fallbackGrade || lastTelemetry?.current_grade || "9");
    const streakHere = arc && arc.streak && arc.streak.grade === currentGrade ? arc.streak.count : 0;
    const rungs = ["9", "10", "11", "12"].map((g) => {
      const streakReq = STREAK_REQUIRED[g] || 1;
      let state = "future";
      let streakProgress;
      if (completed.has(g)) {
        state = "completed";
      } else if (g === currentGrade) {
        state = "current";
        streakProgress = { have: streakHere, need: streakReq };
      }
      return { grade: g, label: GRADE_LABELS[g], streakReq, state, streakProgress };
    });
    return { rungs, graduated: false };
  }
  function studentVibe(id) {
    // In-voice one-liners — what each student would actually say. MTG-style
    // flavor text where the line itself characterizes the speaker.
    return ({
      lyra: "wait what — i KNEW it was c. ok im rewriting my notes.",
      sami: "respectfully, ouch. couldve been you.",
      ravi: "OK so technically — wait, sorry, am i shouting again",
      indra: "the answer was always c.",
      mika: "you cooked. for real.",
      noor: "the test designer is in this room and is laughing.",
    })[id] || "—";
  }

  // ── character sheet UI ──────────────────────────────────────────────────
  const sheetEl = $("sheet-overlay");
  const sheetCard = $("sheet-card");
  // Sign-in fallback surface. Normal boot creates a guest session and hides
  // this; it only opens if the app cannot establish a playable Ruby High
  // session.
  const signinEl = $("signin-overlay");
  function openSheet() {
    sheetOverlayOpen = true;
    sheetEl.classList.add("is-open");
    renderSheet();
  }
  function closeSheet() {
    sheetOverlayOpen = false;
    sheetEl.classList.remove("is-open");
  }
  function renderSheet() {
    const t = lastTelemetry || {};
    const playbooks = t.playbooks || [];
    if (t.character) {
      renderSheetReadonly(t.character, playbooks);
    } else {
      renderSheetCreation(playbooks);
    }
  }
  // Has the character finished their 4-year arc? Yearbook holds one entry
  // per completed grade; 4 means Senior is done.
  function graduatedFor(c) {
    return !!(c && Array.isArray(c.yearbook) && c.yearbook.length >= 4);
  }

  // Diploma generation is fire-and-forget — we trigger it once on graduation
  // detection. The server stamps character.diplomaImageDataUrl when done;
  // the next render picks it up. The flag here is just a per-tab dedupe
  // so we don't fire it twice while the first call is still in flight.
  let diplomaInFlight = false;
  async function maybeFireDiplomaGen(c) {
    if (!c || !graduatedFor(c) || c.diplomaImageDataUrl || diplomaInFlight) return;
    diplomaInFlight = true;
    try {
      const r = await apiFetch("/api/apps/ruby-high/chat/character/diploma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) return;
      // Server stamps the data URL onto the character; next session
      // refresh picks it up. No need to render here.
      await fetchSession();
    } catch { /* ignore */ } finally {
      diplomaInFlight = false;
    }
  }

  // ── "What you need" hint ───────────────────────────────────────────────
  // Gates:
  //   1. Daily class — one passed graded session counts toward the year.
  //   2. Daily-class count — later years require more passed daily classes.
  //   3. Subject grades — each teaching room must be brought to C or better.
  // The hint surfaces the most-blocking gate as one short sentence.
  function buildNextStepHint(c) {
    if (!c) return "";
    if (graduatedFor(c)) return "You graduated. Keep playing if you want; the arc is done.";
    const t = lastTelemetry || {};
    if (t.graduation_ready || c.pendingGraduation) {
      return "Requirements complete — the graduation ceremony is on the blackboard.";
    }
    const grade = String(t.current_grade ?? "9");
    const streakReq = STREAK_REQUIRED[grade] || 1;
    const streakHere = c.streak && c.streak.grade === grade ? c.streak.count : 0;
    const streakLastDate = c.streak && c.streak.grade === grade ? c.streak.lastDate : "";
    const todayKey = (t.daily && t.daily.dailyKey) || "";
    const todayDone = !!(c.streak && c.streak.grade === grade && c.streak.lastDate === todayKey);
    const ROOM_LABEL = { ruby: "Homeroom", "sally-science": "Science", "professor-edward": "Literature" };

    const streakNeeded = Math.max(0, streakReq - streakHere);
    const subjectGaps = subjectClearSummary().grades
      .filter((x) => !letterGradePasses(x.grade));

    const parts = [];
    if (streakNeeded > 0 && !todayDone) {
      parts.push("Pass today's daily class at C or better (" + streakHere + "/" + streakReq + " daily classes)");
    } else if (streakNeeded > 0) {
      parts.push("Daily class counted — " + streakHere + "/" + streakReq + ", come back tomorrow");
    }
    if (subjectGaps.length > 0) {
      const segs = subjectGaps.map((cg) => (ROOM_LABEL[cg.facultyId] || cg.facultyId) + " (" + cg.grade + ")");
      parts.push("Clear each subject at C or better: " + segs.join(", "));
    }

    if (parts.length === 0) {
      return grade === "12"
        ? "Ready to graduate — your diploma is available now."
        : "Ready to advance — your year is complete.";
    }
    let hint = parts.join(" · ");
    return hint;
  }

  // Build the four-rung "Freshman → Sophomore → Junior → Senior" ladder for
  // the character sheet. Each rung names the gates (daily classes + subject grades) so the
  // player can see what unlocks each year. The current rung shows live
  // progress; completed rungs show a check; future rungs show targets.
  function buildProgressionForCharacter(c) {
    if (!c) return null;
    const completed = new Set((Array.isArray(c.yearbook) ? c.yearbook : []).map((y) => y.grade));
    const currentGrade = String(lastTelemetry?.current_grade ?? "9");
    const streakHere = c.streak && c.streak.grade === currentGrade ? c.streak.count : 0;
    const rungs = ["9", "10", "11", "12"].map((g) => {
      const streakReq = STREAK_REQUIRED[g] || 1;
      let state, streakProgress, classProgress;
      if (completed.has(g)) {
        state = "completed";
      } else if (g === currentGrade && !graduatedFor(c)) {
        state = "current";
        streakProgress = { have: streakHere, need: streakReq };
        classProgress = subjectClearSummary().grades;
      } else {
        state = "future";
      }
      return { grade: g, label: GRADE_LABELS[g], streakReq, state, streakProgress, classProgress };
    });
    return { rungs, graduated: graduatedFor(c) };
  }

  function nextGradeAfterClient(grade) {
    const order = ["9", "10", "11", "12"];
    const idx = order.indexOf(String(grade));
    return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  }
  function facultyLabel(fid) {
    const fac = ((lastTelemetry && lastTelemetry.faculty_roster) || []).find((f) => f.id === fid);
    return fac ? (fac.shortName || fac.displayName || fid) : (TEACHING_FACULTY_LABELS[fid] || fid);
  }
  function fmtRewardStat(stat, value) {
    return stat.toUpperCase() + " " + fmtStat(value) + " → " + fmtStat(Math.min(3, value + 1));
  }
  function buildGraduationCeremony(c, grade, opts) {
      const ready = (lastTelemetry && lastTelemetry.graduation_ready) || c.pendingGraduation;
      if (!ready) return null;
      const onBoard = !!(opts && opts.surface === "board");
      const completedGrade = ready.grade || grade;
      const next = nextGradeAfterClient(completedGrade);
      const targetLabel = next ? (GRADE_LABELS[next] || ("Grade " + next)) : "graduate";
      const finalGrade = finalGradeSummary();
      const wrap = document.createElement(onBoard ? "section" : "div");
      wrap.className = onBoard
        ? "graduation-board-card"
        : "graduation-ceremony";
      const status = document.createElement("div");
      status.className = "graduation-status";
      let row;

      if (onBoard) {
        const gradeLabel = completedGrade ? (GRADE_LABELS[completedGrade] || ("Grade " + completedGrade)) : "Ruby High";
        const hero = document.createElement("div");
        hero.className = "graduation-board-hero";

        const badge = document.createElement("div");
        badge.className = "graduation-board-letter";
        badge.textContent = finalGrade.letter;

        const copy = document.createElement("div");
        copy.className = "graduation-board-copy";
        const title = document.createElement("div");
        title.className = "graduation-board-title";
        title.textContent = gradeLabel + " complete";
        const subtitle = document.createElement("div");
        subtitle.className = "graduation-board-subtitle";
        const scoreText = finalGrade.averageScore == null ? "Final grade ready" : "Final grade " + finalGrade.letter + " · " + formatClassScore(finalGrade.averageScore);
        subtitle.textContent = scoreText + (next ? " · next: " + targetLabel : " · diploma ceremony");
        copy.appendChild(title);
        copy.appendChild(subtitle);

        hero.appendChild(badge);
        hero.appendChild(copy);
        wrap.appendChild(hero);

        const prompt = document.createElement("div");
        prompt.className = "graduation-board-prompt";
        prompt.textContent = "Choose one yearbook reward.";
        wrap.appendChild(prompt);

        row = document.createElement("div");
        row.className = "graduation-choice-row";
        wrap.appendChild(row);
        wrap.appendChild(status);
      } else {
        const title = document.createElement("div");
        title.className = "graduation-title";
        title.textContent = next ? "Advance to " + targetLabel : "Graduation Ceremony";
        wrap.appendChild(title);

        const note = document.createElement("div");
        note.className = "graduation-note";
        note.textContent = "Three rewards drawn from the wider set — pick one to seal the yearbook.";
        wrap.appendChild(note);

        wrap.appendChild(status);
        row = document.createElement("div");
        row.className = "graduation-choice-row";
        wrap.appendChild(row);
      }

      const allButtons = [];
      const setBusy = (btn, text) => {
        allButtons.forEach((b) => { b.disabled = true; });
        btn.textContent = text;
        status.textContent = "Ceremony in progress…";
        status.classList.remove("is-invalid");
      };
      const submitReward = async (reward, btn) => {
        setBusy(btn, "Sealing…");
        const data = await command({ type: "complete-graduation", reward });
        if (data && data.session) {
          showCongrats(next ? "You're a " + targetLabel + " now!" : "You graduated.", true);
          await fetchSession();
          if (sheetOverlayOpen) renderSheet();
          return;
        }
        status.textContent = "Ceremony failed — pick again.";
        status.classList.add("is-invalid");
        allButtons.forEach((b) => { b.disabled = false; });
      };
      const addChoice = (label, detail, reward) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "graduation-choice";
        const main = document.createElement("span");
        main.className = "main";
        main.textContent = label;
        const sub = document.createElement("span");
        sub.className = "sub";
        sub.textContent = detail;
        btn.appendChild(main);
        btn.appendChild(sub);
        btn.addEventListener("click", () => submitReward(reward, btn));
        row.appendChild(btn);
        allButtons.push(btn);
      };

      // Build the eligible pool. Stats already at the +3 cap are excluded
      // from the draw (no point offering "already capped"). Advantage and
      // class affinity always qualify. Then take a stable random three —
      // seeded by readyAt so the modal doesn't reshuffle every poll tick.
      const pool = [];
      ["head", "heart", "hustle", "honor"].forEach((stat) => {
        const value = (c.stats && typeof c.stats[stat] === "number") ? c.stats[stat] : 0;
        if (value < 3) {
          pool.push({
            label: stat[0].toUpperCase() + stat.slice(1) + ": " + fmtStat(value) + " → " + fmtStat(Math.min(3, value + 1)),
            detail: "+1 stat (cap +3)",
            reward: { kind: "stat", stat },
          });
        }
      });
      pool.push({
        label: "Extra Advantage",
        detail: next ? "for " + targetLabel + " year" : "for post-grad play",
        reward: { kind: "advantage" },
      });
      TEACHING_FACULTY_IDS.forEach((fid) => {
        const name = facultyLabel(fid);
        pool.push({
          label: name + " Affinity",
          detail: "First miss in " + name + "'s class becomes a pass.",
          reward: { kind: "affinity", facultyId: fid },
        });
      });

      const seed = (c.pendingGraduation && c.pendingGraduation.readyAt)
        || (ready && ready.readyAt)
        || hashCeremonySeed((c.name || "") + ":" + grade);
      const picked = seededShuffle(pool, seed).slice(0, 3);
      picked.forEach(({ label, detail, reward }) => addChoice(label, detail, reward));
      return wrap;
    }

  // Fisher-Yates with a deterministic mulberry32 PRNG so the same ceremony
  // (same readyAt) draws the same three rewards every time it re-renders.
  // Without this, polling re-renders would reshuffle the modal under the
  // player's cursor.
  function seededShuffle(arr, seedInput) {
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
  function hashCeremonySeed(s) {
    let h = 2166136261 | 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h | 0;
  }

  function renderSheetReadonly(c, playbooks) {
    // Current character-sheet model:
    //   CHARACTER CARD — stable identity: portrait/diploma, playbook,
    //     stats, quote, and starting move. It upgrades at graduation.
    //   SCHOOL CAREER CARD — live dashboard: grade, daily-class counter,
    //     subject gates, advantage budget, and next-step hint.
    //   REPORT CARD — durable essay artifacts: teacher notes, average, and
    //     recent class winner comparison.
    //   SEALED YEARS — frozen snapshots of past years. They sit behind the
    //     current character card as a collapsed yearbook stack, then accordion
    //     open when clicked.
    //
    // Layout: the carousel carries the active surfaces: Character Card, School
    // Career Card, and Report Card. Sealed prior years live inside the Character
    // Card so they read as history behind the current year instead of crowding
    // the active surfaces.
    const pb = playbooks.find((p) => p.id === c.playbookId)
      || { name: c.playbookId, blurb: "", startingMove: { name: "—", description: "" } };
    const portraitFallback = defaultPortraitFor(c.playbookId);
    const liveGrade = String(lastTelemetry?.current_grade ?? "9");
    const yearbook = Array.isArray(c.yearbook) ? c.yearbook : [];
    const grad = graduatedFor(c);

    const papers = yearbook.slice()
      .sort((a, b) => Number(a.grade) - Number(b.grade))
      .filter((y) => !(grad && y.grade === "12") && !(!grad && y.grade === liveGrade));

    const cards = [
      buildCurrentCharacterCard(c, pb, portraitFallback, grad, papers, playbooks),
      buildCareerCard(c, grad),
      buildReportCard(),
    ];
    renderCardDeck(cards);
  }

  // ── Current Character Card builder ──────────────────────────────────────
  // Stable identity for the current school career. The card does not carry live
  // counters; graduation upgrades the art to the diploma when available.
  function buildCurrentCharacterCard(c, pb, portraitFallback, graduated, paperEntries, playbooks) {
    const grade = graduated ? "12" : String(lastTelemetry?.current_grade ?? "9");
    const gradeLabel = GRADE_LABELS[grade] || ("Grade " + grade);
    const portraitUrl = (graduated && c.diplomaImageDataUrl) || c.portraitDataUrl || portraitFallback;
    const subtitle = graduated
      ? "Graduated · " + pb.name
      : pb.name + " · " + gradeLabel + " character";

    const actions = [];
    if (graduated) {
      actions.push({
        label: "✨ Try a different look",
        secondary: true,
        onClick: async (e) => {
          const btn = e && e.currentTarget;
          if (btn) { btn.disabled = true; btn.textContent = "✨ Generating…"; }
          try {
            const r = await apiFetch("/api/apps/ruby-high/chat/character/diploma", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            if (!r.ok) throw new Error("diploma " + r.status);
            await fetchSession();
            if (sheetOverlayOpen) renderSheet();
          } catch {
            if (btn) { btn.disabled = false; btn.textContent = "✨ Try a different look"; }
          }
        },
      });
    }

    const card = buildCharacterCard({
      role: "player",
      name: c.name,
      subtitle,
      portraitUrl,
      accent: pb.accent,
      stats: c.stats,
      quote: c.flavorQuote || c.arcAnswer,
      footer: pb.startingMove ? { title: pb.startingMove.name, content: pb.startingMove.description } : undefined,
      actions: actions.length > 0 ? actions : undefined,
    });
    const archive = buildYearbookArchive(paperEntries, c, pb, playbooks);
    if (archive) {
      const body = card.querySelector(".ccg-body");
      if (body) body.appendChild(archive);
    }
    // Social Card lives on the School Career side now — it's live state that
    // ticks over the arc, so it belongs with the dynamic card, not the
    // stable identity card.
    card.classList.add("is-character-card");
    if (graduated) card.classList.add("is-graduated");
    return card;
  }

  // ── Social card grid (relationship layer) ───────────────────────────────
  // Six classmates × six fortune axes resolve over 4 years. Cells tick
  // up/down per essay; circle at +2; scratch at -3. Resolved axes become
  // superlatives on the diploma. This is the player-facing slice — a
  // compact 2x3 of cells plus the resolved axis lines underneath.
  function buildMashGrid(c, graduated) {
    if (!c || !c.mashCard || !c.mashCard.cells) return null;
    const card = c.mashCard;
    const wrap = document.createElement("div");
    wrap.className = "mash-grid-wrap";

    const heading = document.createElement("div");
    heading.className = "mash-grid-heading";
    heading.textContent = graduated ? "Social Card · sealed" : "Social Card";
    wrap.appendChild(heading);

    const grid = document.createElement("div");
    grid.className = "mash-grid";
    STUDENTS.forEach((s) => {
      const cell = card.cells[s.id];
      const tile = document.createElement("div");
      tile.className = "mash-tile";
      const aff = (cell && typeof cell.affinity === "number") ? cell.affinity : 0;
      if (cell && cell.scratched) tile.classList.add("is-scratched");
      else if (cell && cell.circled) tile.classList.add("is-circled");
      else if (aff > 0) tile.classList.add("is-warm");
      else if (aff < 0) tile.classList.add("is-cool");
      tile.style.setProperty("--mash-accent", s.color);

      const dot = document.createElement("span");
      dot.className = "mash-tile-dot";
      tile.appendChild(dot);

      const name = document.createElement("span");
      name.className = "mash-tile-name";
      name.textContent = s.name;
      tile.appendChild(name);

      const meter = document.createElement("span");
      meter.className = "mash-tile-meter";
      meter.setAttribute("aria-label", "affinity " + aff);
      meter.textContent = cell && cell.scratched
        ? "✗"
        : cell && cell.circled
        ? "○"
        : aff > 0
        ? "+" + aff
        : aff < 0
        ? String(aff)
        : "·";
      tile.appendChild(meter);

      grid.appendChild(tile);
    });
    wrap.appendChild(grid);

    const recentTicks = recentRelationshipEvents().slice(-3);
    if (recentTicks.length > 0) {
      const recent = document.createElement("ul");
      recent.className = "mash-recent";
      recentTicks.forEach((event) => {
        const li = document.createElement("li");
        li.textContent = mashTickStory(event);
        recent.appendChild(li);
      });
      wrap.appendChild(recent);
    }

    const resolved = card.resolved || {};
    const lines = [];
    const order = ["crush", "job", "lives", "pet", "money", "lucky"];
    order.forEach((axis) => {
      const r = resolved[axis];
      if (!r) return;
      const who = (STUDENTS.find((s) => s.id === r.studentId) || {}).name || r.studentId;
      lines.push({ axis, who, value: r.value });
    });
    if (lines.length > 0) {
      const list = document.createElement("ul");
      list.className = "mash-resolved";
      lines.forEach((l) => {
        const li = document.createElement("li");
        const tag = document.createElement("span");
        tag.className = "mash-resolved-axis";
        tag.textContent = l.axis;
        const body = document.createElement("span");
        body.className = "mash-resolved-body";
        body.textContent = l.who + " — " + l.value;
        li.appendChild(tag);
        li.appendChild(body);
        list.appendChild(li);
      });
      wrap.appendChild(list);
    }
    return wrap;
  }

  function essayReportsForCard() {
    const reports = lastTelemetry && Array.isArray(lastTelemetry.essay_reports) ? lastTelemetry.essay_reports : [];
    return reports
      .filter((r) => r && typeof r === "object")
      .slice()
      .sort((a, b) => Number(a.gradedAt || 0) - Number(b.gradedAt || 0));
  }
  function essayScoreText(score) {
    if (score === null || score === undefined || score === "") return "—";
    const n = Number(score);
    if (!Number.isFinite(n)) return "—";
    const rounded = Math.round(n * 10) / 10;
    return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + "/10";
  }
  function essayLetter(score) {
    const n = Number(score);
    return Number.isFinite(n) ? letterGradeForScore(n * 10) : "—";
  }
  function essayAverage(reports) {
    const scores = reports
      .map((r) => Number(r.score))
      .filter((n) => Number.isFinite(n));
    if (scores.length === 0) return null;
    return scores.reduce((sum, n) => sum + n, 0) / scores.length;
  }
  function essayResponderName(id) {
    if (!id) return "—";
    if (id === "player") return playerDisplayName();
    return studentNameById(id);
  }
  function clipEssayText(value, max) {
    const text = String(value || "").replace(/\\s+/g, " ").trim();
    if (text.length <= max) return text;
    return text.slice(0, Math.max(0, max - 1)).trim() + "…";
  }
  function essayRivalryText(recent) {
    if (!recent.length) return "No essay results yet.";
    let playerWins = 0;
    const rivals = {};
    recent.forEach((r) => {
      const winner = r.bestResponder;
      if (!winner) return;
      if (winner === "player") playerWins += 1;
      else rivals[winner] = (rivals[winner] || 0) + 1;
    });
    let rivalId = null;
    let rivalCount = 0;
    Object.keys(rivals).forEach((id) => {
      if (rivals[id] > rivalCount) {
        rivalId = id;
        rivalCount = rivals[id];
      }
    });
    if (rivalId) {
      return essayResponderName(rivalId) + " out-essayed you " + rivalCount + " of the last " + recent.length + ".";
    }
    if (playerWins > 0) {
      return "You held the top essay " + playerWins + " of the last " + recent.length + ".";
    }
    return "No classroom winner recorded yet.";
  }
  function buildReportEntry(report) {
    const row = document.createElement("article");
    row.className = "report-entry" + (report.passed ? " is-passed" : "");

    const grade = document.createElement("div");
    grade.className = "report-entry-grade";
    grade.textContent = essayLetter(report.score);
    row.appendChild(grade);

    const body = document.createElement("div");
    body.className = "report-entry-body";

    const title = document.createElement("div");
    title.className = "report-entry-title";
    title.textContent = clipEssayText(report.prompt, 72) || "Essay";
    body.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "report-entry-meta";
    const subject = report.subject ? " · " + report.subject : "";
    meta.textContent = facultyLabel(report.faculty) + subject + " · " + essayScoreText(report.score) + " · " + formatSealedDate(report.gradedAt);
    body.appendChild(meta);

    if (report.comment) {
      const comment = document.createElement("div");
      comment.className = "report-entry-comment";
      comment.textContent = clipEssayText(report.comment, 104);
      body.appendChild(comment);
    }

    const foot = document.createElement("div");
    foot.className = "report-entry-foot";
    if (report.bestResponder) {
      const best = document.createElement("span");
      best.textContent = "Best: " + essayResponderName(report.bestResponder)
        + (Number.isFinite(Number(report.bestResponderScore)) ? " " + essayScoreText(report.bestResponderScore) : "");
      foot.appendChild(best);
    }
    if (report.response) {
      const yours = document.createElement("span");
      yours.textContent = "You: " + clipEssayText(report.response, 58);
      foot.appendChild(yours);
    }
    if (foot.children.length > 0) body.appendChild(foot);

    row.appendChild(body);
    return row;
  }
  function buildReportCard() {
    const reports = essayReportsForCard();
    const recent = reports.slice(-5).reverse();
    const visible = recent.slice(0, 3);
    const avg = essayAverage(reports);
    const playerWins = reports.filter((r) => r.bestResponder === "player").length;
    const topScore = reports
      .map((r) => Number(r.score))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a)[0];

    const card = document.createElement("div");
    card.className = "ccg-card is-report-card";

    const role = document.createElement("span");
    role.className = "ccg-role report";
    role.textContent = "report";
    card.appendChild(role);

    const body = document.createElement("div");
    body.className = "ccg-body";

    const nameEl = document.createElement("div");
    nameEl.className = "ccg-name";
    nameEl.textContent = "Report Card";
    body.appendChild(nameEl);

    const sub = document.createElement("div");
    sub.className = "ccg-subtitle";
    sub.textContent = reports.length
      ? reports.length + " essays · average " + essayScoreText(avg)
      : "No graded essays yet";
    body.appendChild(sub);

    body.appendChild(buildCareerMetrics([
      { label: "essays", value: String(reports.length), detail: "graded", met: reports.length > 0 },
      { label: "average", value: essayScoreText(avg), detail: "teacher score", met: Number(avg) >= 7 },
      { label: "top", value: Number.isFinite(Number(topScore)) ? essayScoreText(topScore) : "—", detail: playerWins + " class wins", met: playerWins > 0 },
    ]));

    if (reports.length === 0) {
      const empty = document.createElement("div");
      empty.className = "report-empty";
      empty.textContent = "Your first graded essay will land here.";
      body.appendChild(empty);
    } else {
      const rivalry = document.createElement("div");
      rivalry.className = "report-rivalry";
      rivalry.textContent = essayRivalryText(recent);
      body.appendChild(rivalry);

      const list = document.createElement("div");
      list.className = "report-list";
      visible.forEach((report) => list.appendChild(buildReportEntry(report)));
      body.appendChild(list);
    }

    card.appendChild(body);
    return card;
  }

  // ── School Career Card builder ──────────────────────────────────────────
  // Dynamic state for the current school career. Everything here can move after a
  // question resolves; keep it separate from the identity card above.
  function buildCareerCard(c, graduated) {
    const t = lastTelemetry || {};
    const grade = graduated ? "12" : String(t.current_grade ?? "9");
    const gradeLabel = GRADE_LABELS[grade] || ("Grade " + grade);
    const streakReq = STREAK_REQUIRED[grade] || 1;
    const streakHere = c.streak && c.streak.grade === grade ? c.streak.count : 0;
    const streakLastDate = c.streak && c.streak.grade === grade ? c.streak.lastDate : "";
    const todayKey = (t.daily && t.daily.dailyKey) || "";
    const budget = t.advantage_rolls || { used: 0, cap: 3, remaining: 3 };
    const yearbookCount = Array.isArray(c.yearbook) ? c.yearbook.length : 0;

    const card = document.createElement("div");
    card.className = "ccg-card is-career-card" + (graduated ? " is-graduated" : "");

    const role = document.createElement("span");
    role.className = "ccg-role career";
    role.textContent = graduated ? "graduated" : gradeLabel;
    card.appendChild(role);

    const body = document.createElement("div");
    body.className = "ccg-body";

    const nameEl = document.createElement("div");
    nameEl.className = "ccg-name";
    nameEl.textContent = "School Career";
    body.appendChild(nameEl);

    const sub = document.createElement("div");
    sub.className = "ccg-subtitle";
    const subjects = subjectClearSummary();
    const gradeLine = subjects.grades.map((g) => g.grade).join(" ");
    sub.textContent = graduated ? "Arc complete" : gradeLabel + " · " + gradeLine;
    body.appendChild(sub);

    const metrics = document.createElement("div");
    metrics.className = "career-metrics";
    const addMetric = (label, value, detail, met) => {
      const row = document.createElement("div");
      row.className = "career-metric" + (met ? " is-met" : "");
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = label;
      const v = document.createElement("span");
      v.className = "v";
      v.textContent = value;
      const d = document.createElement("span");
      d.className = "detail";
      d.textContent = detail;
      row.appendChild(k);
      row.appendChild(v);
      row.appendChild(d);
      metrics.appendChild(row);
    };

    if (graduated) {
      addMetric("status", "graduated", "four-year arc complete", true);
      addMetric("yearbook", yearbookCount + "/4", "paper cards sealed", yearbookCount >= 4);
    } else {
      // The active standing already lives in the subtitle + badge. Keep the
      // live gates compact: diamonds for daily classes, boost chips for
      // scoring bonuses, and dice for advantage.
    }
    if (metrics.children.length > 0) body.appendChild(metrics);
    if (!graduated) {
      body.appendChild(buildCareerTokens({
        streakHere,
        streakReq,
        streakLastDate,
        todayKey,
        advantageRemaining: budget.remaining,
        advantageCap: budget.cap,
      }));
    }

    const ceremonyReady = !!(t.graduation_ready || c.pendingGraduation);
    if (ceremonyReady) {
      const ceremony = buildGraduationCeremony(c, grade, {});
      if (ceremony) body.appendChild(ceremony);
    } else {
      const hint = buildNextStepHint(c);
      if (hint) {
        const ns = document.createElement("div");
        ns.className = "ccg-next-step";
        ns.textContent = hint;
        body.appendChild(ns);
      }
    }

    appendProgression(body, buildProgressionForCharacter(c));
    const mash = buildMashGrid(c, graduated);
    if (mash) body.appendChild(mash);
    card.appendChild(body);
    return card;
  }

  function buildYearbookArchive(entries, liveChar, livePb, playbooks) {
    if (!Array.isArray(entries) || entries.length === 0) return null;
    const archive = document.createElement("details");
    archive.className = "paper-archive";

    const summary = document.createElement("summary");
    summary.className = "paper-archive-summary";
    const stack = document.createElement("span");
    stack.className = "paper-archive-stack";
    for (let i = 0; i < Math.min(3, entries.length); i++) {
      const sheet = document.createElement("span");
      sheet.className = "paper-archive-sheet";
      stack.appendChild(sheet);
    }
    const label = document.createElement("span");
    label.className = "paper-archive-label";
    label.textContent = entries.length === 1 ? "1 sealed year" : entries.length + " sealed years";
    const hint = document.createElement("span");
    hint.className = "paper-archive-hint";
    hint.textContent = "open yearbook";
    summary.appendChild(stack);
    summary.appendChild(label);
    summary.appendChild(hint);
    archive.appendChild(summary);

    const list = document.createElement("div");
    list.className = "paper-archive-list";
    entries.forEach((entry) => list.appendChild(buildYearbookArchiveEntry(entry, liveChar, livePb, playbooks)));
    archive.appendChild(list);
    return archive;
  }

  function buildYearbookArchiveEntry(entry, liveChar, livePb, playbooks) {
    const gradeLabel = GRADE_LABELS[entry.grade] || ("Grade " + entry.grade);
    const shortGrade = GRADE_SHORT_LABELS[entry.grade] || gradeLabel;
    const playbookId = entry.playbookId || liveChar.playbookId;
    const pb = (Array.isArray(playbooks) && playbooks.find((p) => p.id === playbookId)) || livePb;
    const stats = entry.stats || liveChar.stats || {};
    const quote = entry.flavorQuote || entry.arcAnswer || "";
    const summary = entry.summary || { correct: 0, total: 0 };
    const gradeIdx = GRADE_ORDER.indexOf(String(entry.grade));
    const diamondCount = Math.max(1, gradeIdx + 1);

    const item = document.createElement("div");
    item.className = "paper-archive-entry";
    if (pb && pb.accent) item.style.setProperty("--paper-accent", pb.accent);

    const top = document.createElement("div");
    top.className = "paper-archive-entry-top";
    const grade = document.createElement("span");
    grade.className = "paper-archive-grade";
    const diamonds = document.createElement("span");
    diamonds.className = "paper-archive-diamonds";
    for (let i = 0; i < diamondCount; i++) {
      const diamond = document.createElement("span");
      diamond.textContent = "◆";
      diamonds.appendChild(diamond);
    }
    const gradeText = document.createElement("span");
    gradeText.textContent = shortGrade;
    grade.appendChild(diamonds);
    grade.appendChild(gradeText);
    const meta = document.createElement("span");
    meta.className = "paper-archive-meta";
    meta.textContent = "sealed " + formatSealedDate(entry.completedAt) + " · " + summary.correct + "/" + summary.total;
    top.appendChild(grade);
    top.appendChild(meta);
    item.appendChild(top);

    const statsLine = document.createElement("div");
    statsLine.className = "paper-archive-stats";
    ["head", "heart", "hustle", "honor"].forEach((k) => {
      const stat = document.createElement("span");
      stat.innerHTML = "<b>" + k + "</b> " + fmtStat(Number(stats[k] || 0));
      statsLine.appendChild(stat);
    });
    item.appendChild(statsLine);

    if (quote) {
      const quoteEl = document.createElement("div");
      quoteEl.className = "paper-archive-quote";
      renderMarkdownInto(quoteEl, "“" + quote + "”", { inline: true });
      item.appendChild(quoteEl);
    }
    return item;
  }

  // ── Paper Card builder ──────────────────────────────────────────────────
  // Frozen at the moment the year closed. Identity comes from the snapshot
  // on the yearbook entry — never from the live character. The backfill
  // path in normalizeLoaded() guarantees these fields exist even on
  // pre-snapshot saves.
  function buildPaperCard(entry, liveChar, livePb, playbooks) {
    const gradeLabel = GRADE_LABELS[entry.grade] || ("Grade " + entry.grade);
    const playbookId = entry.playbookId || liveChar.playbookId;
    const pb = (Array.isArray(playbooks) && playbooks.find((p) => p.id === playbookId)) || livePb;
    const name = entry.name || liveChar.name;
    const stats = entry.stats || liveChar.stats;
    const portraitUrl = entry.portraitDataUrl
      || liveChar.portraitDataUrl
      || defaultPortraitFor(playbookId);
    const quote = entry.flavorQuote || entry.arcAnswer || "";
    const summary = entry.summary || { correct: 0, total: 0 };
    const sealedSubtitle = "✓ " + gradeLabel + " · sealed " + formatSealedDate(entry.completedAt)
      + " · " + summary.correct + "/" + summary.total + " correct";

    const card = buildCharacterCard({
      role: "player",
      name,
      subtitle: sealedSubtitle,
      portraitUrl,
      accent: pb.accent,
      stats,
      quote,
      // No progression, no next-step hint, no move footer. A paper card
      // is a record, not a dashboard.
    });
    card.classList.add("is-paper-card");
    // Sealed badge in the corner (CSS-driven via pseudo-element on the class).
    return card;
  }

  function formatSealedDate(ts) {
    if (!ts) return "—";
    try {
      const d = new Date(ts);
      const m = d.toLocaleDateString(undefined, { month: "short" });
      return m + " " + d.getFullYear();
    } catch { return "—"; }
  }
  function fmtStat(n) { return (n >= 0 ? "+" : "") + n; }

  // ── default-pack portraits ──────────────────────────────────────────────
  // Every playbook owns one of the six unused student portraits in
  // assets/students/. The player picks a portrait by playbook before
  // ever paying for AI gen. If they upgrade ("✨ Generate AI portrait")
  // and it succeeds, that data URL replaces the default in the create-
  // character command. If they don't, the default ships with the
  // character and the post-acceptance "background portrait gen" path is
  // gone entirely — what you saw at creation is what you get.
  const PLAYBOOK_DEFAULT_PORTRAIT = {
    overachiever: "indra",
    slacker: "sami",
    heart: "mika",
    outsider: "noor",
    "class-clown": "ravi",
    lifer: "lyra",
  };
  function defaultPortraitStudentIdFor(playbookId) {
    return PLAYBOOK_DEFAULT_PORTRAIT[playbookId] || "indra";
  }
  function studentFullPortraitUrl(studentId) {
    return apiBase + "/assets/students/" + encodeURIComponent(studentId) + "-full.png";
  }
  function defaultPortraitFor(playbookId) {
    return studentFullPortraitUrl(defaultPortraitStudentIdFor(playbookId));
  }
  function isUsingDefaultStudentPortrait(c) {
    if (!c) return false;
    const portrait = typeof c.portraitDataUrl === "string" ? c.portraitDataUrl : "";
    const defaultId = defaultPortraitStudentIdFor(c.playbookId);
    return !portrait
      || portrait === defaultPortraitFor(c.playbookId)
      || portrait.endsWith("/assets/students/" + defaultId + "-full.png");
  }
  function hiddenNpcStudentIdFor(c) {
    return isUsingDefaultStudentPortrait(c) ? defaultPortraitStudentIdFor(c.playbookId) : null;
  }
  function hiddenNpcStudentId() {
    return hiddenNpcStudentIdFor(lastTelemetry && lastTelemetry.character);
  }
  function shouldShowStudentId(studentId) {
    const hidden = hiddenNpcStudentId();
    return !hidden || studentId !== hidden;
  }

  // Random-roll character creation. The player INHABITS a Ruby High student
  // rather than building one. Offline mode rolls locally; AI mode can ask the
  // LLM for voice text and an optional custom portrait. Each component has a
  // small ↻ reroll button so the player can lock in the parts they like and
  // cycle the rest.
  //
  // Auth invariant: this function only runs when authed === true. A guest
  // Ruby High session is enough; OpenRouter is optional.
  function renderSheetCreation(playbooks) {
    sheetCard.classList.remove("is-card-deck-sheet");
    sheetCard.classList.remove("is-two-card-deck");
    sheetCard.classList.add("is-creation-sheet");
    sheetCard.innerHTML = "";

    // Full-pane loading state — covers the sheet while the initial
    // roll is in flight so the player isn't staring at empty form
    // rows wondering why nothing's there. Hidden once the rolled
    // payload lands; re-shown if the player triggers a full reroll
    // later. (No literal backticks — script.ts is wrapped in an
    // outer template literal at compose time.)
    const loading = document.createElement("div");
    loading.className = "creation-loading";
    loading.innerHTML =
      '<div class="creation-loading-spinner" aria-hidden="true"></div>'
      + '<div class="creation-loading-title">Rolling…</div>'
      + '<div class="creation-loading-sub">Drawing your character. Please wait.</div>';
    sheetCard.appendChild(loading);

    // Creation now uses the same two-card deck surface as profile sheets:
    // a playable character card beside a roll-control card.
    const candidateCard = document.createElement("div");
    candidateCard.className = "ccg-card is-character-card is-creation-candidate-card";
    const candidateRole = document.createElement("span");
    candidateRole.className = "ccg-role player";
    candidateRole.textContent = "player";
    candidateCard.appendChild(candidateRole);
    const candidateArt = document.createElement("div");
    candidateArt.className = "ccg-art";
    const portraitImg = document.createElement("img");
    portraitImg.alt = "";
    candidateArt.appendChild(portraitImg);
    candidateCard.appendChild(candidateArt);
    const candidateBody = document.createElement("div");
    candidateBody.className = "ccg-body";
    candidateCard.appendChild(candidateBody);
    const candidateName = document.createElement("div");
    candidateName.className = "ccg-name";
    candidateBody.appendChild(candidateName);
    const candidateSubtitle = document.createElement("div");
    candidateSubtitle.className = "ccg-subtitle";
    candidateBody.appendChild(candidateSubtitle);
    const candidateStats = document.createElement("div");
    candidateStats.className = "ccg-stats";
    candidateBody.appendChild(candidateStats);
    const candidateQuote = document.createElement("blockquote");
    candidateQuote.className = "ccg-quote";
    candidateBody.appendChild(candidateQuote);
    const candidateMove = document.createElement("div");
    candidateMove.className = "ccg-footer";
    const candidateMoveTitle = document.createElement("strong");
    const candidateMoveContent = document.createElement("span");
    candidateMoveContent.className = "ccg-footer-content";
    candidateMove.appendChild(candidateMoveTitle);
    candidateMove.appendChild(candidateMoveContent);
    candidateBody.appendChild(candidateMove);
    const candidateHint = document.createElement("div");
    candidateHint.className = "ccg-next-step";
    candidateHint.textContent = "Lock this student in to start today's class.";
    candidateBody.appendChild(candidateHint);
    const portraitStatus = document.createElement("div");
    portraitStatus.className = "creation-portrait-status";
    candidateBody.appendChild(portraitStatus);
    const candidateActions = document.createElement("div");
    candidateActions.className = "ccg-card-actions";
    const portraitBtn = document.createElement("button");
    portraitBtn.type = "button";
    portraitBtn.className = "secondary";
    portraitBtn.textContent = "✨ Generate AI portrait";
    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "primary";
    acceptBtn.textContent = "Lock it in";
    acceptBtn.disabled = true;
    candidateActions.appendChild(portraitBtn);
    candidateActions.appendChild(acceptBtn);
    candidateBody.appendChild(candidateActions);

    const controlsCard = document.createElement("div");
    controlsCard.className = "ccg-card is-career-card is-creation-control-card";
    const controlsRole = document.createElement("span");
    controlsRole.className = "ccg-role career";
    controlsRole.textContent = "roll";
    controlsCard.appendChild(controlsRole);
    const controlsBody = document.createElement("div");
    controlsBody.className = "ccg-body";
    controlsCard.appendChild(controlsBody);
    const controlsName = document.createElement("div");
    controlsName.className = "ccg-name";
    controlsName.textContent = "Character Roll";
    controlsBody.appendChild(controlsName);
    const controlsSub = document.createElement("div");
    controlsSub.className = "ccg-subtitle";
    controlsSub.textContent = localAiEnabled
      ? "Reroll any field. Local AI can refresh the voice."
      : aiEnabled
        ? "Reroll any field. AI can refresh the voice and portrait."
        : "Reroll any field. Enable AI later for a custom portrait.";
    controlsBody.appendChild(controlsSub);

    // Control rows: one per component. Each row has a reroll button that
    // re-fires /chat/character/generate with regen=[<field>], keep=<rest>.
    const fields = document.createElement("div");
    fields.className = "creation-fields";
    controlsBody.appendChild(fields);

    function makeRow(label, key) {
      const row = document.createElement("div");
      row.className = "creation-row";
      const lab = document.createElement("div");
      lab.className = "creation-row-label";
      lab.textContent = label;
      const val = document.createElement("div");
      val.className = "creation-row-value";
      val.dataset.key = key;
      const reroll = document.createElement("button");
      reroll.type = "button";
      reroll.className = "creation-reroll";
      reroll.title = "Reroll " + label.toLowerCase();
      reroll.textContent = "↻";
      reroll.dataset.key = key;
      row.appendChild(lab);
      row.appendChild(val);
      row.appendChild(reroll);
      fields.appendChild(row);
      return { val, reroll };
    }
    const nameRow = makeRow("Name", "name");
    const playbookRow = makeRow("Playbook", "playbook");
    const statsRow = makeRow("Stats", "stats");
    const personalityRow = makeRow("Voice", "personality");
    const quoteRow = makeRow("Quote", "flavorQuote");

    // Status line for in-flight rolls / errors.
    const status = document.createElement("div");
    status.className = "stat-budget";
    controlsBody.appendChild(status);

    let deckRendered = false;

    // Reveal the form (and hide the loading state) once the first
    // roll lands. Subsequent component-rerolls don't re-trigger this.
    function revealForm() {
      if (deckRendered) return;
      deckRendered = true;
      renderCardDeck([candidateCard, controlsCard]);
      sheetCard.classList.add("is-creation-sheet");
    }

    let rolled = null;
    // Per-component in-flight flags so the user can mash multiple rerolls
    // and the buttons disable independently. Module-scope portraitInFlight
    // is gone in this PR.
    const inFlight = { all: false, name: false, personality: false, arcAnswer: false, flavorQuote: false, stats: false, playbook: false, portrait: false };
    let aiPortraitDataUrl = null; // when set, replaces the default at accept-time

    const OFFLINE_NAMES = ["Iris", "Nova", "Vee", "Mara", "Jules", "Theo", "Rin", "Cass", "Ari", "Nico", "Sol", "Mina"];
    const OFFLINE_VOICES = [
      "Quietly intense, observant, and allergic to obvious answers.",
      "Fast-talking, curious, and always one foot into trouble.",
      "Dry, focused, and more competitive than they admit.",
      "Warm, chaotic, and very sure the room is improv.",
      "Careful, sharp, and tracking everyone else's tells.",
      "Brave in theory, dramatic in practice, loyal by default.",
    ];
    const OFFLINE_QUOTES = [
      "you guys don't see the exit signs are all wrong, do you",
      "i am not lost, i'm collecting evidence",
      "if this is extra credit, i am morally required to overdo it",
      "the answer is probably hiding in the part nobody wants to read",
      "i brought a pencil, a theory, and one terrible backup plan",
      "school spirit is just pattern recognition with banners",
    ];
    const OFFLINE_ARCS = {
      outsider: "I want to find the hidden pattern without becoming part of it.",
      overachiever: "I want proof that being excellent is not the same as being safe.",
      classclown: "I want to see what happens when everyone stops pretending this is normal.",
      mystic: "I want to know which rules are real and which ones only scare people.",
      rebel: "I want a reason to trust the room before the room gets my loyalty.",
      lifer: "I want to make this place better without letting it own me.",
    };

    function offlineStats() {
      const values = [2, 1, 0, -1];
      for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = values[i];
        values[i] = values[j];
        values[j] = tmp;
      }
      return { head: values[0], heart: values[1], hustle: values[2], honor: values[3] };
    }
    function offlinePlaybook(current, regen) {
      if (!regen.has("playbook") && current && current.playbookId) {
        const kept = playbooks.find((p) => p.id === current.playbookId);
        if (kept) return kept;
      }
      return pickRandom(playbooks) || { id: "outsider", name: "Outsider", startingMove: { name: "Move", description: "" } };
    }
    function offlineCharacterRoll(components) {
      const isFullRoll = !components || components.length === 0;
      const regen = new Set(isFullRoll ? ["name", "personality", "arcAnswer", "flavorQuote", "stats", "playbook"] : components);
      const prev = rolled || {};
      const pb = offlinePlaybook(prev, regen);
      const stats = regen.has("stats") || !prev.stats ? offlineStats() : prev.stats;
      const name = regen.has("name") || !prev.name ? pickRandom(OFFLINE_NAMES) : prev.name;
      const personality = regen.has("personality") || !prev.personality ? pickRandom(OFFLINE_VOICES) : prev.personality;
      const arcAnswer = regen.has("arcAnswer") || !prev.arcAnswer ? (OFFLINE_ARCS[pb.id] || "I want to figure out what kind of student this place makes me.") : prev.arcAnswer;
      const flavorQuote = regen.has("flavorQuote") || !prev.flavorQuote ? pickRandom(OFFLINE_QUOTES) : prev.flavorQuote;
      return { name, playbookId: pb.id, stats, personality, arcAnswer, flavorQuote };
    }

    function setStatus(text, invalid) {
      status.textContent = text || "";
      status.classList.toggle("is-invalid", !!invalid);
    }
    function applyDisabled() {
      acceptBtn.disabled = !rolled || inFlight.all;
      [nameRow, playbookRow, statsRow, personalityRow, quoteRow].forEach(({ reroll }) => {
        const k = reroll.dataset.key;
        reroll.disabled = !rolled || inFlight.all || !!inFlight[k];
      });
      portraitBtn.hidden = !aiEnabled || localAiEnabled;
      portraitBtn.disabled = !rolled || !aiEnabled || localAiEnabled || inFlight.portrait;
    }

    function renderCreationStatsInto(parent, stats) {
      parent.replaceChildren();
      const fmt = (n) => (n >= 0 ? "+" : "") + n;
      ["head", "heart", "hustle", "honor"].forEach((k) => {
        const wrap = document.createElement("span");
        wrap.className = "stat";
        const ke = document.createElement("span");
        ke.className = "k";
        ke.textContent = k;
        const ve = document.createElement("span");
        const v = Number(stats && stats[k] || 0);
        ve.className = "v" + (v > 0 ? " pos" : v < 0 ? " neg" : "");
        ve.textContent = fmt(v);
        wrap.appendChild(ke);
        wrap.appendChild(ve);
        parent.appendChild(wrap);
      });
    }

    function renderRolled(c) {
      const pb = playbooks.find((p) => p.id === c.playbookId) || { name: c.playbookId, startingMove: { name: "—", description: "" } };
      candidateName.textContent = c.name || "—";
      candidateSubtitle.textContent = (pb.name || c.playbookId || "Student") + " · Freshman candidate";
      if (pb.accent) {
        candidateCard.style.borderColor = pb.accent;
        candidateRole.style.background = pb.accent;
      }
      renderCreationStatsInto(candidateStats, c.stats);
      renderMarkdownInto(candidateQuote, c.flavorQuote ? "“" + c.flavorQuote + "”" : (c.arcAnswer ? "“" + c.arcAnswer + "”" : "—"), { inline: true });
      candidateMoveTitle.textContent = pb.startingMove && pb.startingMove.name ? pb.startingMove.name : "Starting Move";
      renderMarkdownInto(candidateMoveContent, pb.startingMove && pb.startingMove.description ? pb.startingMove.description : "No move text yet.", { inline: true });
      nameRow.val.textContent = c.name;
      playbookRow.val.textContent = pb.name;
      const fmt = (n) => (n >= 0 ? "+" : "") + n;
      statsRow.val.textContent = "HEAD " + fmt(c.stats.head) + " · HEART " + fmt(c.stats.heart) + " · HUSTLE " + fmt(c.stats.hustle) + " · HONOR " + fmt(c.stats.honor);
      personalityRow.val.textContent = c.personality;
      renderMarkdownInto(quoteRow.val, c.flavorQuote ? "“" + c.flavorQuote + "”" : (c.arcAnswer ? "“" + c.arcAnswer + "”" : "—"), { inline: true });
      // Default portrait swaps with playbook unless the player has opted
      // in to AI gen. AI portrait is keyed to the rolled identity — if
      // they reroll the playbook AFTER generating an AI portrait, the
      // AI image probably no longer matches; we drop it back to default.
      // (The player can always click ✨ again.)
      if (!aiPortraitDataUrl) {
        portraitImg.src = defaultPortraitFor(c.playbookId);
      }
    }

    async function rollComponents(components) {
      if (inFlight.all) return;
      // Mark per-component flags so individual button states track.
      const isFullRoll = !components || components.length === 0;
      if (isFullRoll) {
        inFlight.all = true;
      } else {
        for (const c of components) inFlight[c] = true;
      }
      applyDisabled();
      setStatus(isFullRoll ? "Rolling…" : "Rerolling " + components.join(", ") + "…");
      try {
        // If the player reroll-cycles the playbook OR the name AFTER
        // generating an AI portrait, the AI image no longer matches —
        // drop it so the default takes over. The player can re-fire ✨
        // if they want a new AI portrait against the new identity.
        if (!isFullRoll && (components.includes("playbook") || components.includes("name"))) {
          aiPortraitDataUrl = null;
        }
        if (!aiEnabled) {
          rolled = offlineCharacterRoll(components);
          renderRolled(rolled);
          revealForm();
          setStatus("Offline mode — AI chat and custom portrait are disabled until you enable AI.");
          return;
        }
        const body = isFullRoll
          ? {}
          : { regen: components, keep: rolled || {} };
        const r = await apiFetch("/api/apps/ruby-high/chat/character/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({ error: r.status }));
          throw new Error(err.error || "request " + r.status);
        }
        const data = await r.json();
        rolled = data.character;
        renderRolled(rolled);
        // First roll lands → swap from loading-state to form.
        revealForm();
        setStatus("");
      } catch (err) {
        if (status.isConnected) {
          setStatus(err && err.message ? err.message : "Roll failed — try again.", true);
        }
      } finally {
        if (isFullRoll) {
          inFlight.all = false;
        } else {
          for (const c of components) inFlight[c] = false;
        }
        applyDisabled();
      }
    }

    // Wire per-row reroll buttons.
    [nameRow, playbookRow, statsRow, personalityRow, quoteRow].forEach(({ reroll }) => {
      reroll.addEventListener("click", () => {
        const key = reroll.dataset.key;
        // arcAnswer doesn't render as its own row (the quote shows
        // flavorQuote || arcAnswer); we still expose the reroll
        // implicitly via the quote row, but the LLM may not always
        // touch arcAnswer — fine. The visible field is what matters.
        rollComponents([key]);
      });
    });

    // ✨ Generate AI portrait — fires /chat/character/portrait. On
    // success, replaces the default img and stashes the data URL so it
    // ships with the create-character command. On failure, leaves the
    // default in place and shows an inline error.
    portraitBtn.addEventListener("click", async () => {
      if (!aiEnabled || localAiEnabled) {
        portraitStatus.textContent = localAiEnabled ? "Custom portraits require OpenRouter." : "Enable AI for a custom portrait.";
        portraitStatus.classList.add("is-invalid");
        return;
      }
      if (!rolled || inFlight.portrait) return;
      inFlight.portrait = true;
      portraitBtn.textContent = "✨ Generating…";
      portraitStatus.textContent = "";
      portraitStatus.classList.remove("is-invalid");
      applyDisabled();
      try {
        const r = await apiFetch("/api/apps/ruby-high/chat/character/portrait", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: rolled.name, playbookId: rolled.playbookId, personality: rolled.personality, stats: rolled.stats }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({ error: r.status }));
          throw new Error(err.error || "portrait " + r.status);
        }
        const data = await r.json();
        if (!data || !data.portraitDataUrl) throw new Error("no image returned");
        aiPortraitDataUrl = data.portraitDataUrl;
        portraitImg.src = aiPortraitDataUrl;
        portraitBtn.textContent = "✨ Try again";
        portraitStatus.textContent = "AI portrait ready.";
      } catch (err) {
        portraitStatus.textContent = "Couldn't generate — keeping the default.";
        portraitStatus.classList.add("is-invalid");
        portraitBtn.textContent = "✨ Generate AI portrait";
      } finally {
        inFlight.portrait = false;
        applyDisabled();
      }
    });

    acceptBtn.addEventListener("click", async () => {
      if (!rolled || inFlight.all) return;
      acceptBtn.disabled = true;
      setStatus("Saving character…");
      // Lock-in shape: ship the rolled character + whichever portrait
      // is currently visible (AI if generated, default otherwise). The
      // post-acceptance background portrait gen path that used to live
      // here is GONE — what you see is what you get.
      const portraitUrl = aiPortraitDataUrl || defaultPortraitFor(rolled.playbookId);
      const data = await command({
        type: "create-character",
        ...rolled,
        portraitDataUrl: portraitUrl,
      });
      if (data && data.session) {
        closeSheet();
      } else {
        applyDisabled();
        setStatus("Save failed — try again.", true);
      }
    });

    // Auto-roll on first open. A guest Ruby High session is enough; AI is
    // only needed for LLM-backed rerolls and custom portraits.
    rollComponents();
  }
  sheetEl.addEventListener("click", (e) => { if (e.target === sheetEl) closeSheet(); });
  // Universal close affordance — replaces every per-card "Close" button.
  // The X is absolutely positioned in the overlay corner (CSS), so it
  // tracks the overlay rather than any individual card variant.
  const sheetCloseBtn = $("sheet-close");
  if (sheetCloseBtn) sheetCloseBtn.addEventListener("click", closeSheet);

  // ── pack library + draft editor ─────────────────────────────────────────
  const packEl = $("pack-overlay");
  const packListEl = $("pack-list");
  const packDraftListEl = $("pack-draft-list");
  const packCreateBtn = $("pack-create-btn");
  const packEditEl = $("pack-edit-overlay");
  const packEditTitleEl = $("pack-edit-title");
  const packEditSubtitleEl = $("pack-edit-subtitle");
  const packNameInputEl = $("pack-name-input");
  const packDescriptionInputEl = $("pack-description-input");
  const packTeacherListEl = $("pack-teacher-list");
  const packTeacherDetailEl = $("pack-teacher-detail");
  const packAddTeacherBtn = $("pack-add-teacher-btn");
  const teacherMaterialUrlInputEl = $("teacher-material-url-input");
  const teacherLoadUrlBtn = $("teacher-load-url-btn");
  const teacherGenerateQuestionsBtn = $("teacher-generate-questions-btn");
  const teacherGenerationStatusEl = $("teacher-generation-status");
  const teacherQuestionListEl = $("teacher-question-list");
  const teacherDisplayNameInputEl = $("teacher-display-name-input");
  const teacherSocialsInputEl = $("teacher-socials-input");
  const teacherProfileImageInputEl = $("teacher-profile-image-input");
  const teacherPersonaInputEl = $("teacher-persona-input");
  const teacherMaterialsInputEl = $("teacher-materials-input");
  const packCloseBtn = $("pack-close-btn");
  const packEditCloseBtn = $("pack-edit-close-btn");
  const packPublishBtn = $("pack-publish-btn");
  const packStatusEl = $("pack-status");
  const packEditStatusEl = $("pack-edit-status");
  const packImportPanelEl = $("pack-import-panel");
  const packImportTitleEl = $("pack-import-title");
  const packImportDetailEl = $("pack-import-detail");
  const packProgressFillEl = $("pack-progress-fill");
  const packBtn = els.packBtn;
  let packImportBusy = false;
  let packImportTimer = null;
  let packLibraryState = null;
  let currentDraft = null;
  let selectedPackTeacherId = null;
  let selectedPackTab = "materials";
  let packTeacherCreateMode = false;
  let pendingTeacherRoll = null;
  let pendingTeacherImageStatus = "";
  let pendingTeacherImageInvalid = false;
  let pendingTeacherImageBusy = false;
  let packAutosaveTimer = null;
  let teacherAutosaveTimer = null;
  const PREGENERATED_TEACHER_ASSETS = [
    { id: "ruby", name: "Ruby", subject: "Homeroom", description: "Warm, direct, and good at turning scattered questions into a useful classroom thread.", quote: "We start where the room actually is." },
    { id: "sally-science", name: "Sally Science", subject: "Science Lab", description: "Evidence-first, experimental, and happiest when a wrong answer exposes a better hypothesis.", quote: "Be wrong with reasons. Then we can work." },
    { id: "professor-edward", name: "Professor Edward", subject: "Literature", description: "Precise, patient, and tuned to the half-truth inside every messy interpretation.", quote: "Read the sentence again. It has not finished with you." },
  ];
  const TEACHER_ROLL_NAMES = ["Ruby", "Sally Science", "Professor Edward", "Mara Vale", "Dr. Mina Quill", "Theo Signal", "Cass Vector", "Nico Frame"];
  const TEACHER_ROLL_STYLES = [
    { subject: "Critical Systems", description: "Calm, surgical, and excellent at turning abstract systems into questions students can actually answer.", quote: "A system is only invisible until it breaks." },
    { subject: "Media Lab", description: "Fast, funny, and tuned to how tools change the way students think, write, and argue.", quote: "The medium is doing homework too." },
    { subject: "Research Seminar", description: "Skeptical but kind; pushes students to separate evidence, inference, and vibes before they commit.", quote: "Show me what would change your mind." },
    { subject: "Ethics Studio", description: "Warm, direct, and focused on consequences, incentives, and the choices hiding inside defaults.", quote: "A default is still a decision." },
    { subject: "Postwar Literature", description: "Quietly intense and careful with ambiguity; treats every answer as a draft worth revising.", quote: "The hard part is knowing what the question protects." },
  ];
  const TEACHER_STAT_ROLLS = [
    { head: 3, heart: 1, hustle: 0, honor: 2 },
    { head: 2, heart: 3, hustle: 1, honor: 0 },
    { head: 1, heart: 2, hustle: 3, honor: 0 },
    { head: 2, heart: 0, hustle: 1, honor: 3 },
    { head: 3, heart: 0, hustle: 2, honor: -1 },
  ];
  const PACK_IMPORT_STEPS = [
    { pct: 18, title: "Saving draft", detail: "Persisting the content pack." },
    { pct: 42, title: "Preparing materials", detail: "Checking markdown and size limits." },
    { pct: 68, title: "Generating cards", detail: "Building the teacher question set." },
    { pct: 88, title: "Updating library", detail: "Refreshing pack availability." },
  ];

  const packStudioClient = {
    async listPacks() {
      const r = await apiFetch("/api/apps/ruby-high/pack-library");
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "pack library " + r.status);
      return data;
    },
    async createDraftPack() {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled Content Pack" }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "create draft " + r.status);
      return data.draft;
    },
    async loadDraftPack(draftId) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts/" + encodeURIComponent(draftId));
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "draft " + r.status);
      return data.draft;
    },
    async updateDraftPack(draftId, patch) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts/" + encodeURIComponent(draftId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "save draft " + r.status);
      return data.draft;
    },
    async addTeacherToDraft(draftId, teacher) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts/" + encodeURIComponent(draftId) + "/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(teacher || { displayName: "New Teacher" }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "add teacher " + r.status);
      return data.draft;
    },
    async updateTeacher(draftId, teacherId, patch) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts/" + encodeURIComponent(draftId) + "/teachers/" + encodeURIComponent(teacherId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "save teacher " + r.status);
      return data.draft;
    },
    async loadMaterialsFromUrl(draftId, teacherId, url) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts/" + encodeURIComponent(draftId) + "/teachers/" + encodeURIComponent(teacherId) + "/materials/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "load materials " + r.status);
      return data.draft;
    },
    async generateQuestionsForDraftTeacher(draftId, teacherId) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts/" + encodeURIComponent(draftId) + "/teachers/" + encodeURIComponent(teacherId) + "/questions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "generate " + r.status);
      return data.draft;
    },
    async deleteQuestion(draftId, teacherId, questionId) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts/" + encodeURIComponent(draftId) + "/teachers/" + encodeURIComponent(teacherId) + "/questions/" + encodeURIComponent(questionId), {
        method: "DELETE",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "delete question " + r.status);
      return data.draft;
    },
    async publishDraft(draftId) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts/" + encodeURIComponent(draftId) + "/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "publish " + r.status);
      return data.pack;
    },
    async installPack(packId, enabled) {
      const r = await apiFetch("/api/apps/ruby-high/pack-library/" + encodeURIComponent(packId) + "/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "install " + r.status);
      return data;
    },
    async setActivePack(packId) {
      const r = await apiFetch("/api/apps/ruby-high/pack-library/" + encodeURIComponent(packId) + "/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "activate " + r.status);
      return data;
    },
  };

  function openPackStore() {
    packEl.classList.add("is-open");
    refreshPackLibrary();
  }
  function closePackStore() {
    if (packImportBusy) {
      packStatusEl.textContent = "Finish this library update before closing.";
      packStatusEl.classList.remove("is-invalid");
      return;
    }
    packEl.classList.remove("is-open");
    packStatusEl.textContent = "";
    packStatusEl.classList.remove("is-invalid");
    resetPackImportProgress();
  }
  function openPackEditor(draft) {
    currentDraft = draft;
    selectedPackTeacherId = draft && Array.isArray(draft.teachers) && draft.teachers[0] ? draft.teachers[0].id : null;
    selectedPackTab = "materials";
    packTeacherCreateMode = false;
    pendingTeacherRoll = null;
    pendingTeacherImageStatus = "";
    pendingTeacherImageInvalid = false;
    pendingTeacherImageBusy = false;
    packEditEl.classList.add("is-open");
    renderPackEditor();
  }
  function closePackEditor() {
    clearTimeout(packAutosaveTimer);
    clearTimeout(teacherAutosaveTimer);
    packEditEl.classList.remove("is-open");
    currentDraft = null;
    selectedPackTeacherId = null;
    packTeacherCreateMode = false;
    pendingTeacherRoll = null;
    pendingTeacherImageStatus = "";
    pendingTeacherImageInvalid = false;
    pendingTeacherImageBusy = false;
    if (packEditStatusEl) {
      packEditStatusEl.textContent = "";
      packEditStatusEl.classList.remove("is-invalid");
    }
    refreshPackLibrary();
  }
  function setPackBusy(busy) {
    packImportBusy = !!busy;
    packEl.classList.toggle("is-busy", packImportBusy);
    if (packEditEl) packEditEl.classList.toggle("is-busy", packImportBusy);
    if (packCloseBtn) packCloseBtn.disabled = packImportBusy;
    if (packEditCloseBtn) packEditCloseBtn.disabled = packImportBusy;
    if (packBtn) packBtn.disabled = packImportBusy;
    packEl.querySelectorAll("button.pack-action").forEach((btn) => { btn.disabled = packImportBusy; });
    packEditEl.querySelectorAll("button.pack-action, button.secondary").forEach((btn) => { btn.disabled = packImportBusy; });
    if (packCreateBtn) packCreateBtn.disabled = packImportBusy;
    if (packAddTeacherBtn) packAddTeacherBtn.disabled = packImportBusy;
    packEditEl.querySelectorAll("input, textarea").forEach((field) => {
      field.disabled = packImportBusy;
    });
  }
  function updatePackImportProgress(pct, title, detail, isError) {
    if (!packImportPanelEl) return;
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    packImportPanelEl.hidden = false;
    packImportPanelEl.classList.toggle("is-error", !!isError);
    if (packImportTitleEl) packImportTitleEl.textContent = title;
    if (packImportDetailEl) packImportDetailEl.textContent = detail;
    const progress = packImportPanelEl.querySelector(".pack-progress");
    if (progress) progress.setAttribute("aria-valuenow", String(clamped));
    if (packProgressFillEl) packProgressFillEl.style.width = clamped + "%";
  }
  function startPackImportProgress(teacherName) {
    clearInterval(packImportTimer);
    setPackBusy(true);
    packStatusEl.textContent = "Do not close this panel while Ruby High imports the teacher.";
    packStatusEl.classList.remove("is-invalid");
    const startedAt = Date.now();
    updatePackImportProgress(4, "Starting import", "Ruby High is preparing " + (teacherName || "this teacher") + ".", false);
    packImportTimer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const pct = Math.min(94, 4 + Math.floor(elapsed / 650) * 6);
      const step = PACK_IMPORT_STEPS.reduce((best, entry) => entry.pct <= pct ? entry : best, PACK_IMPORT_STEPS[0]);
      updatePackImportProgress(pct, step.title, step.detail, false);
    }, 650);
  }
  function finishPackImportProgress(title, detail) {
    clearInterval(packImportTimer);
    packImportTimer = null;
    updatePackImportProgress(100, title, detail, false);
    setPackBusy(false);
  }
  function failPackImportProgress(message) {
    clearInterval(packImportTimer);
    packImportTimer = null;
    updatePackImportProgress(100, "Import failed", message, true);
    setPackBusy(false);
  }
  function resetPackImportProgress() {
    clearInterval(packImportTimer);
    packImportTimer = null;
    if (packImportPanelEl) {
      packImportPanelEl.hidden = true;
      packImportPanelEl.classList.remove("is-error");
    }
    if (packProgressFillEl) packProgressFillEl.style.width = "0%";
  }
  window.addEventListener("beforeunload", (e) => {
    if (!packImportBusy) return;
    e.preventDefault();
    e.returnValue = "";
  });

  async function refreshPackLibrary() {
    if (!packListEl || !packDraftListEl) return;
    packListEl.innerHTML = '<div class="sub">Loading packs...</div>';
    packDraftListEl.innerHTML = "";
    packStatusEl.textContent = "";
    packStatusEl.classList.remove("is-invalid");
    try {
      packLibraryState = await packStudioClient.listPacks();
      renderPackList();
      renderDraftPackList();
    } catch (err) {
      packListEl.innerHTML = "";
      packStatusEl.textContent = "Could not load packs · " + (err && err.message ? err.message : "error");
      packStatusEl.classList.add("is-invalid");
    }
  }

  function renderPackList() {
    const packs = packLibraryState && Array.isArray(packLibraryState.packs) ? packLibraryState.packs : [];
    packListEl.innerHTML = "";
    if (packs.length === 0) {
      packListEl.innerHTML = '<div class="sub">No packs available.</div>';
      return;
    }
    packs.forEach((pack) => {
      packListEl.appendChild(packCard(pack, { draft: false }));
    });
  }

  function renderDraftPackList() {
    const drafts = packLibraryState && Array.isArray(packLibraryState.drafts) ? packLibraryState.drafts : [];
    packDraftListEl.innerHTML = "";
    if (drafts.length === 0) {
      packDraftListEl.innerHTML = '<div class="sub">No draft packs yet.</div>';
      return;
    }
    drafts.forEach((draft) => {
      packDraftListEl.appendChild(packCard(draft, { draft: true }));
    });
  }

  function packCard(pack, opts) {
    const card = document.createElement("div");
    const isDraft = !!opts.draft;
    const canSwitch = !isDraft && !pack.active;
    card.className = "pack-card-item" + (pack.active ? " is-active" : "") + (!isDraft ? " is-clickable" : "");
    if (!isDraft) {
      card.setAttribute("role", "button");
      card.tabIndex = packImportBusy ? -1 : 0;
      card.setAttribute("aria-label", (pack.active ? "Using " : "Use ") + (pack.name || "Untitled Pack"));
      card.addEventListener("click", () => {
        if (canSwitch) activateLibraryPack(pack);
      });
      card.addEventListener("keydown", (event) => {
        if (!canSwitch || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        activateLibraryPack(pack);
      });
    }
    const head = document.createElement("div");
    head.className = "pack-card-head";
    const titleWrap = document.createElement("div");
    const name = document.createElement("div");
    name.className = "pack-card-name";
    name.textContent = pack.name || "Untitled Pack";
    const desc = document.createElement("div");
    desc.className = "pack-card-desc";
    desc.textContent = pack.description || (opts.draft ? "Draft content pack." : "Ruby High content pack.");
    titleWrap.appendChild(name);
    titleWrap.appendChild(desc);
    head.appendChild(titleWrap);
    card.appendChild(head);

    const meta = document.createElement("div");
    meta.className = "pack-card-meta";
    [
      pack.builtIn ? "built-in" : pack.status || "pack",
      pack.readOnly ? "read only" : pack.owner ? "yours" : "",
      (pack.facultyCount || pack.teacherCount || 0) + " teachers",
      (pack.questionCount || 0) + " cards",
    ].filter(Boolean).forEach((text) => {
      const chip = document.createElement("span");
      chip.className = "pack-chip";
      chip.textContent = text;
      meta.appendChild(chip);
    });
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "pack-card-actions";
    if (!isDraft) {
      const state = document.createElement("div");
      state.className = "pack-row-state";
      state.textContent = pack.active ? "Using now" : "Use";
      actions.appendChild(state);
    }

    if (isDraft || pack.canEdit) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "pack-action";
      editBtn.textContent = "Edit";
      editBtn.disabled = packImportBusy;
      editBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        editDraftPack(pack.id);
      });
      actions.appendChild(editBtn);
    }
    card.appendChild(actions);
    return card;
  }

  async function activateLibraryPack(pack) {
    if (!pack || packImportBusy) return;
    setPackBusy(true);
    packStatusEl.textContent = "Switching classroom pack...";
    packStatusEl.classList.remove("is-invalid");
    try {
      packLibraryState = await packStudioClient.setActivePack(pack.id);
      renderPackList();
      renderDraftPackList();
      packStatusEl.textContent = "Pack switched. Reloading...";
      setTimeout(() => window.location.reload(), 300);
    } catch (err) {
      packStatusEl.textContent = "Could not switch pack · " + (err && err.message ? err.message : "error");
      packStatusEl.classList.add("is-invalid");
    } finally {
      setPackBusy(false);
    }
  }

  async function createDraftPack() {
    setPackBusy(true);
    packStatusEl.textContent = "Creating draft pack...";
    packStatusEl.classList.remove("is-invalid");
    try {
      const draft = await packStudioClient.createDraftPack();
      packStatusEl.textContent = "";
      openPackEditor(await packStudioClient.loadDraftPack(draft.id));
    } catch (err) {
      packStatusEl.textContent = "Could not create draft · " + (err && err.message ? err.message : "error");
      packStatusEl.classList.add("is-invalid");
    } finally {
      setPackBusy(false);
    }
  }

  async function editDraftPack(draftId) {
    setPackBusy(true);
    packStatusEl.textContent = "Opening draft...";
    packStatusEl.classList.remove("is-invalid");
    try {
      openPackEditor(await packStudioClient.loadDraftPack(draftId));
      packStatusEl.textContent = "";
    } catch (err) {
      packStatusEl.textContent = "Could not open draft · " + (err && err.message ? err.message : "error");
      packStatusEl.classList.add("is-invalid");
    } finally {
      setPackBusy(false);
    }
  }

  function packTeacherAssetUrl(assetId, variant) {
    if (!assetId) return null;
    const suffix = variant ? "-" + variant : "";
    return apiBase + "/assets/teachers/" + encodeURIComponent(assetId) + suffix + ".png";
  }
  function draftTeacherImageUrl(teacher, variant) {
    if (!teacher) return null;
    if (teacher.profileImageUrl) return teacher.profileImageUrl;
    if (teacher.assetTeacherId) return packTeacherAssetUrl(teacher.assetTeacherId, variant || "full");
    return null;
  }
  function teacherRollAccent(assetId) {
    return assetId === "sally-science" ? "#4cb555" : assetId === "professor-edward" ? "#5865f2" : "#d22a2a";
  }
  function randomTeacherStats() {
    const stats = pickRandom(TEACHER_STAT_ROLLS);
    return { head: stats.head, heart: stats.heart, hustle: stats.hustle, honor: stats.honor };
  }
  function teacherStatsLine(stats) {
    const s = stats || { head: 0, heart: 0, hustle: 0, honor: 0 };
    return "HEAD " + fmtStat(Number(s.head || 0))
      + " · HEART " + fmtStat(Number(s.heart || 0))
      + " · HUSTLE " + fmtStat(Number(s.hustle || 0))
      + " · HONOR " + fmtStat(Number(s.honor || 0));
  }
  function differentTeacherAsset(currentAssetId) {
    const choices = PREGENERATED_TEACHER_ASSETS.filter((asset) => asset.id !== currentAssetId);
    return pickRandom(choices.length ? choices : PREGENERATED_TEACHER_ASSETS);
  }
  function rollTeacherCandidate(components) {
    const isFullRoll = !components || components.length === 0;
    const regen = new Set(isFullRoll ? ["name", "style", "image", "stats", "quote"] : components);
    const prev = pendingTeacherRoll || {};
    const asset = regen.has("image")
      ? differentTeacherAsset(prev.assetTeacherId)
      : PREGENERATED_TEACHER_ASSETS.find((entry) => entry.id === prev.assetTeacherId) || pickRandom(PREGENERATED_TEACHER_ASSETS);
    const style = regen.has("style")
      ? pickRandom(TEACHER_ROLL_STYLES)
      : { subject: prev.subject, description: prev.description, quote: prev.quote };
    const displayName = regen.has("name")
      ? (isFullRoll ? asset.name : pickRandom(TEACHER_ROLL_NAMES))
      : (prev.displayName || asset.name);
    const stats = regen.has("stats") || !prev.stats ? randomTeacherStats() : prev.stats;
    const quote = regen.has("quote")
      ? pickRandom(TEACHER_ROLL_STYLES).quote
      : (style.quote || prev.quote || asset.quote);
    const profileImageUrl = (regen.has("name") || regen.has("style") || regen.has("image"))
      ? ""
      : (prev.profileImageUrl || "");
    pendingTeacherRoll = {
      displayName,
      subject: style.subject || asset.subject,
      description: style.description || asset.description,
      quote,
      assetTeacherId: asset.id,
      profileImageUrl,
      stats,
    };
    pendingTeacherImageStatus = "";
    pendingTeacherImageInvalid = false;
    return pendingTeacherRoll;
  }
  function startDraftTeacherCreation() {
    if (!currentDraft || packImportBusy) return;
    packTeacherCreateMode = true;
    selectedPackTeacherId = null;
    selectedPackTab = "settings";
    pendingTeacherImageStatus = "";
    pendingTeacherImageInvalid = false;
    pendingTeacherImageBusy = false;
    rollTeacherCandidate();
    renderPackTeacherEditor();
  }
  function setPackEditorTabsHidden(hidden) {
    const tabs = packEditEl.querySelector(".pack-editor-tabs");
    if (tabs) tabs.hidden = !!hidden;
    ["materials", "questions", "settings"].forEach((key) => {
      const panel = $("pack-tab-" + key);
      if (panel) panel.hidden = !!hidden;
    });
  }
  function buildTeacherRollControls() {
    const controlsCard = document.createElement("div");
    controlsCard.className = "ccg-card is-career-card is-creation-control-card";
    const controlsRole = document.createElement("span");
    controlsRole.className = "ccg-role career";
    controlsRole.textContent = "roll";
    controlsCard.appendChild(controlsRole);
    const controlsBody = document.createElement("div");
    controlsBody.className = "ccg-body";
    controlsCard.appendChild(controlsBody);
    const controlsName = document.createElement("div");
    controlsName.className = "ccg-name";
    controlsName.textContent = "Teacher Roll";
    controlsBody.appendChild(controlsName);
    const controlsSub = document.createElement("div");
    controlsSub.className = "ccg-subtitle";
    controlsSub.textContent = "Start with a pregenerated Ruby High teacher, then reroll the parts that should change.";
    controlsBody.appendChild(controlsSub);
    const fields = document.createElement("div");
    fields.className = "creation-fields";
    controlsBody.appendChild(fields);
    const makeRow = (label, key, value) => {
      const row = document.createElement("div");
      row.className = "creation-row";
      const lab = document.createElement("div");
      lab.className = "creation-row-label";
      lab.textContent = label;
      const val = document.createElement("div");
      val.className = "creation-row-value";
      val.textContent = value || "";
      const reroll = document.createElement("button");
      reroll.type = "button";
      reroll.className = "creation-reroll";
      reroll.title = "Reroll " + label.toLowerCase();
      reroll.textContent = "↻";
      reroll.disabled = packImportBusy || pendingTeacherImageBusy;
      reroll.addEventListener("click", () => {
        rollTeacherCandidate([key]);
        renderPackTeacherEditor();
      });
      row.appendChild(lab);
      row.appendChild(val);
      row.appendChild(reroll);
      fields.appendChild(row);
    };
    const roll = pendingTeacherRoll || rollTeacherCandidate();
    const asset = PREGENERATED_TEACHER_ASSETS.find((entry) => entry.id === roll.assetTeacherId);
    makeRow("Name", "name", roll.displayName);
    makeRow("Style", "style", roll.subject);
    makeRow("Image", "image", roll.profileImageUrl ? "Generated teacher image" : ((asset && asset.name) || "Pregenerated teacher"));
    makeRow("Stats", "stats", teacherStatsLine(roll.stats));
    makeRow("Quote", "quote", roll.quote);
    return controlsCard;
  }
  function renderNewTeacherCreation() {
    const roll = pendingTeacherRoll || rollTeacherCandidate();
    const portraitUrl = roll.profileImageUrl || packTeacherAssetUrl(roll.assetTeacherId, "full");
    const candidateCard = buildCharacterCard({
      role: "teacher",
      name: roll.displayName,
      subtitle: roll.subject + " · teacher candidate",
      portraitUrl,
      accent: teacherRollAccent(roll.assetTeacherId),
      stats: roll.stats,
      quote: roll.quote,
      nextStepHint: "Add this teacher to the pack, then paste materials or generate questions.",
      footer: { title: "Teaching Style", content: roll.description },
    });
    candidateCard.classList.add("is-creation-candidate-card");
    const body = candidateCard.querySelector(".ccg-body");
    const status = document.createElement("div");
    status.className = "creation-portrait-status" + (pendingTeacherImageInvalid ? " is-invalid" : "");
    status.textContent = pendingTeacherImageStatus;
    const actionsRow = document.createElement("div");
    actionsRow.className = "ccg-card-actions";
    const imageBtn = document.createElement("button");
    imageBtn.type = "button";
    imageBtn.className = "secondary";
    imageBtn.textContent = pendingTeacherImageBusy ? "Generating..." : "Generate teacher image";
    imageBtn.disabled = packImportBusy || pendingTeacherImageBusy;
    imageBtn.addEventListener("click", generateTeacherImageForPendingRoll);
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.disabled = packImportBusy || pendingTeacherImageBusy;
    cancelBtn.addEventListener("click", () => {
      packTeacherCreateMode = false;
      pendingTeacherRoll = null;
      pendingTeacherImageStatus = "";
      renderPackTeacherEditor();
    });
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "primary";
    addBtn.textContent = "Add Teacher";
    addBtn.disabled = packImportBusy || pendingTeacherImageBusy;
    addBtn.addEventListener("click", savePendingTeacherRoll);
    actionsRow.appendChild(imageBtn);
    actionsRow.appendChild(cancelBtn);
    actionsRow.appendChild(addBtn);
    if (body) {
      body.appendChild(status);
      body.appendChild(actionsRow);
    }
    const wrap = document.createElement("div");
    wrap.className = "pack-teacher-roll-deck";
    wrap.appendChild(candidateCard);
    wrap.appendChild(buildTeacherRollControls());
    packTeacherDetailEl.appendChild(wrap);
  }
  async function generateTeacherImageForPendingRoll() {
    if (!pendingTeacherRoll || pendingTeacherImageBusy) return;
    if (!aiEnabled || localAiEnabled) {
      pendingTeacherImageStatus = localAiEnabled ? "Teacher image generation requires OpenRouter." : "Enable AI for a generated teacher image.";
      pendingTeacherImageInvalid = true;
      renderPackTeacherEditor();
      return;
    }
    pendingTeacherImageBusy = true;
    pendingTeacherImageStatus = "Generating teacher image...";
    pendingTeacherImageInvalid = false;
    renderPackTeacherEditor();
    try {
      const r = await apiFetch("/api/apps/ruby-high/chat/teacher/portrait", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: pendingTeacherRoll.displayName,
          personality: pendingTeacherRoll.description,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "teacher image " + r.status);
      if (!data.profileImageUrl) throw new Error("no image returned");
      pendingTeacherRoll = {
        ...pendingTeacherRoll,
        assetTeacherId: "",
        profileImageUrl: data.profileImageUrl,
      };
      pendingTeacherImageStatus = "Teacher image ready.";
      pendingTeacherImageInvalid = false;
    } catch (_err) {
      pendingTeacherImageStatus = "Couldn't generate - keeping the pregenerated teacher image.";
      pendingTeacherImageInvalid = true;
    } finally {
      pendingTeacherImageBusy = false;
      renderPackTeacherEditor();
    }
  }
  async function savePendingTeacherRoll() {
    if (!currentDraft || !pendingTeacherRoll || packImportBusy || pendingTeacherImageBusy) return;
    setPackBusy(true);
    if (packEditStatusEl) packEditStatusEl.textContent = "Adding teacher...";
    try {
      currentDraft = await packStudioClient.addTeacherToDraft(currentDraft.id, {
        displayName: pendingTeacherRoll.displayName,
        description: pendingTeacherRoll.description,
        assetTeacherId: pendingTeacherRoll.assetTeacherId,
        profileImageUrl: pendingTeacherRoll.profileImageUrl,
        stats: pendingTeacherRoll.stats,
      });
      selectedPackTeacherId = currentDraft.teachers[currentDraft.teachers.length - 1].id;
      packTeacherCreateMode = false;
      pendingTeacherRoll = null;
      pendingTeacherImageStatus = "";
      pendingTeacherImageInvalid = false;
      renderPackEditor();
      if (packEditStatusEl) packEditStatusEl.textContent = "Teacher added.";
    } catch (err) {
      if (packEditStatusEl) {
        packEditStatusEl.textContent = "Could not add teacher · " + (err && err.message ? err.message : "error");
        packEditStatusEl.classList.add("is-invalid");
      }
    } finally {
      setPackBusy(false);
    }
  }
  function packTeacherInitial(teacher) {
    return String((teacher && (teacher.shortName || teacher.displayName || teacher.id)) || "?").charAt(0).toUpperCase();
  }
  function packTeacherSubjectsText(teacher) {
    const count = teacher && typeof teacher.questionCount === "number" ? teacher.questionCount : 0;
    return count + " card" + (count === 1 ? "" : "s");
  }
  function renderPackTeacherEditor() {
    if (!packTeacherListEl || !packTeacherDetailEl) return;
    const teachers = currentDraft && Array.isArray(currentDraft.teachers) ? currentDraft.teachers : [];
    if (!packTeacherCreateMode && !selectedPackTeacherId && teachers[0]) selectedPackTeacherId = teachers[0].id;
    if (!packTeacherCreateMode && !teachers.some((teacher) => teacher.id === selectedPackTeacherId)) {
      selectedPackTeacherId = teachers[0] ? teachers[0].id : null;
    }
    packTeacherListEl.innerHTML = "";
    if (teachers.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sub";
      empty.textContent = "No teachers in this pack.";
      packTeacherListEl.appendChild(empty);
    } else {
      teachers.forEach((teacher) => {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "pack-teacher-tab" + (teacher.id === selectedPackTeacherId ? " is-selected" : "");
        tab.disabled = packImportBusy;
        const avatar = document.createElement("span");
        avatar.className = "pack-teacher-avatar";
        const avatarUrl = draftTeacherImageUrl(teacher, "face");
        if (avatarUrl) {
          const img = document.createElement("img");
          img.src = avatarUrl;
          img.alt = "";
          avatar.appendChild(img);
        } else {
          avatar.textContent = packTeacherInitial(teacher);
        }
        const copy = document.createElement("span");
        copy.className = "pack-teacher-copy";
        const title = document.createElement("span");
        title.className = "pack-teacher-title";
        title.textContent = teacher.displayName || teacher.id;
        const subtitle = document.createElement("span");
        subtitle.className = "pack-teacher-subtitle";
        subtitle.textContent = (teacher.questionCount || 0) + " cards · " + packTeacherSubjectsText(teacher);
        copy.appendChild(title);
        copy.appendChild(subtitle);
        tab.appendChild(avatar);
        tab.appendChild(copy);
        tab.addEventListener("click", () => {
          if (packImportBusy) return;
          packTeacherCreateMode = false;
          pendingTeacherRoll = null;
          pendingTeacherImageStatus = "";
          selectedPackTeacherId = teacher.id;
          renderPackTeacherEditor();
        });
        packTeacherListEl.appendChild(tab);
      });
    }
    renderSelectedPackTeacher(teachers);
  }
  function renderSelectedPackTeacher(teachers) {
    if (!packTeacherDetailEl) return;
    packTeacherDetailEl.innerHTML = "";
    if (packTeacherCreateMode) {
      setPackEditorTabsHidden(true);
      renderNewTeacherCreation();
      return;
    }
    setPackEditorTabsHidden(false);
    const selected = teachers.find((teacher) => teacher.id === selectedPackTeacherId) || null;
    const head = document.createElement("div");
    head.className = "pack-teacher-detail-head";
    const copy = document.createElement("div");
    const name = document.createElement("div");
    name.className = "pack-teacher-detail-name";
    name.textContent = selected ? (selected.displayName || selected.id) : "No teacher selected";
    const meta = document.createElement("div");
    meta.className = "pack-teacher-detail-meta";
    if (selected) {
      meta.textContent = (selected.questionCount || 0) + " cards" + (selected.materialSourceUrl ? " · linked source" : "");
    } else {
      meta.textContent = "Add a teacher to configure this pack.";
    }
    copy.appendChild(name);
    copy.appendChild(meta);
    head.appendChild(copy);
    packTeacherDetailEl.appendChild(head);
    if (selected && selected.description) {
      const bio = document.createElement("div");
      bio.className = "pack-teacher-detail-meta";
      bio.textContent = selected.description;
      packTeacherDetailEl.appendChild(bio);
    }
    fillTeacherDraftForm(selected);
    renderQuestionList(selected);
    renderPackTabs();
  }
  function fillTeacherDraftForm(teacher) {
    if (teacherDisplayNameInputEl) teacherDisplayNameInputEl.value = teacher && teacher.displayName ? teacher.displayName : "";
    if (teacherSocialsInputEl) teacherSocialsInputEl.value = teacher && teacher.socialsUrl ? teacher.socialsUrl : "";
    if (teacherProfileImageInputEl) teacherProfileImageInputEl.value = teacher && teacher.profileImageUrl ? teacher.profileImageUrl : "";
    if (teacherPersonaInputEl) teacherPersonaInputEl.value = teacher && teacher.description ? teacher.description : "";
    if (teacherMaterialsInputEl) teacherMaterialsInputEl.value = teacher && teacher.materials ? teacher.materials : "";
    if (teacherMaterialUrlInputEl) teacherMaterialUrlInputEl.value = teacher && teacher.materialSourceUrl ? teacher.materialSourceUrl : "";
    if (teacherGenerationStatusEl) {
      teacherGenerationStatusEl.textContent = teacher
        ? "Generated " + (teacher.generationCount || 0) + " time" + ((teacher.generationCount || 0) === 1 ? "" : "s") + " today"
        : "";
    }
  }

  function renderPackEditor() {
    if (!currentDraft) return;
    if (packEditTitleEl) packEditTitleEl.textContent = "Edit pack";
    if (packEditSubtitleEl) packEditSubtitleEl.textContent = currentDraft.name || "Draft content pack";
    if (packNameInputEl) packNameInputEl.value = currentDraft.name || "";
    if (packDescriptionInputEl) packDescriptionInputEl.value = currentDraft.description || "";
    renderPackTeacherEditor();
  }

  function renderPackTabs() {
    packEditEl.querySelectorAll(".pack-editor-tab").forEach((btn) => {
      const key = btn.getAttribute("data-pack-tab") || "";
      btn.classList.toggle("is-active", key === selectedPackTab);
    });
    ["materials", "questions", "settings"].forEach((key) => {
      const panel = $("pack-tab-" + key);
      if (panel) panel.classList.toggle("is-active", key === selectedPackTab);
    });
  }

  function selectedDraftTeacher() {
    return currentDraft && Array.isArray(currentDraft.teachers)
      ? currentDraft.teachers.find((teacher) => teacher.id === selectedPackTeacherId) || null
      : null;
  }

  function renderQuestionList(teacher) {
    if (!teacherQuestionListEl) return;
    teacherQuestionListEl.innerHTML = "";
    const questions = teacher && Array.isArray(teacher.questions) ? teacher.questions : [];
    if (!teacher) {
      teacherQuestionListEl.innerHTML = '<div class="sub">Select or add a teacher.</div>';
      return;
    }
    if (questions.length === 0) {
      teacherQuestionListEl.innerHTML = '<div class="sub">No generated questions yet.</div>';
      return;
    }
    questions.forEach((question) => {
      const row = document.createElement("div");
      row.className = "pack-question-row";
      const body = document.createElement("div");
      const prompt = document.createElement("div");
      prompt.className = "pack-question-prompt";
      prompt.textContent = question.prompt || "Untitled question";
      const answer = document.createElement("div");
      answer.className = "pack-question-answer";
      answer.textContent = (question.subject || "open study") + " · " + (question.difficulty || "medium") + (question.answer ? " · " + question.answer : "");
      body.appendChild(prompt);
      body.appendChild(answer);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "pack-action";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteDraftQuestion(question.id));
      row.appendChild(body);
      row.appendChild(del);
      teacherQuestionListEl.appendChild(row);
    });
  }

  function schedulePackAutosave() {
    if (!currentDraft) return;
    clearTimeout(packAutosaveTimer);
    packAutosaveTimer = setTimeout(saveDraftPackFields, 450);
  }

  async function saveDraftPackFields() {
    if (!currentDraft) return;
    try {
      currentDraft = await packStudioClient.updateDraftPack(currentDraft.id, {
        name: String((packNameInputEl && packNameInputEl.value) || "").trim(),
        description: String((packDescriptionInputEl && packDescriptionInputEl.value) || "").trim(),
      });
      if (packEditStatusEl) {
        packEditStatusEl.textContent = "Draft saved.";
        packEditStatusEl.classList.remove("is-invalid");
      }
    } catch (err) {
      if (packEditStatusEl) {
        packEditStatusEl.textContent = "Could not save draft · " + (err && err.message ? err.message : "error");
        packEditStatusEl.classList.add("is-invalid");
      }
    }
  }

  function scheduleTeacherAutosave() {
    if (!currentDraft || !selectedPackTeacherId) return;
    clearTimeout(teacherAutosaveTimer);
    teacherAutosaveTimer = setTimeout(saveSelectedTeacher, 550);
  }

  async function saveSelectedTeacher() {
    if (!currentDraft || !selectedPackTeacherId) return;
    try {
      currentDraft = await packStudioClient.updateTeacher(currentDraft.id, selectedPackTeacherId, {
        displayName: String((teacherDisplayNameInputEl && teacherDisplayNameInputEl.value) || "").trim(),
        description: String((teacherPersonaInputEl && teacherPersonaInputEl.value) || "").trim(),
        socialsUrl: String((teacherSocialsInputEl && teacherSocialsInputEl.value) || "").trim(),
        profileImageUrl: String((teacherProfileImageInputEl && teacherProfileImageInputEl.value) || "").trim(),
        materials: String((teacherMaterialsInputEl && teacherMaterialsInputEl.value) || "").trim(),
      });
      renderPackTeacherEditor();
      if (packEditStatusEl) {
        packEditStatusEl.textContent = "Teacher saved.";
        packEditStatusEl.classList.remove("is-invalid");
      }
    } catch (err) {
      if (packEditStatusEl) {
        packEditStatusEl.textContent = "Could not save teacher · " + (err && err.message ? err.message : "error");
        packEditStatusEl.classList.add("is-invalid");
      }
    }
  }

  function addDraftTeacher() {
    startDraftTeacherCreation();
  }

  async function loadTeacherMaterialsFromUrl() {
    const teacher = selectedDraftTeacher();
    if (!currentDraft || !teacher) return;
    const url = String((teacherMaterialUrlInputEl && teacherMaterialUrlInputEl.value) || "").trim();
    if (!url) return;
    setPackBusy(true);
    if (packEditStatusEl) packEditStatusEl.textContent = "Loading materials...";
    try {
      currentDraft = await packStudioClient.loadMaterialsFromUrl(currentDraft.id, teacher.id, url);
      renderPackEditor();
      if (packEditStatusEl) packEditStatusEl.textContent = "Materials loaded.";
    } catch (err) {
      if (packEditStatusEl) {
        packEditStatusEl.textContent = "Could not load materials · " + (err && err.message ? err.message : "error");
        packEditStatusEl.classList.add("is-invalid");
      }
    } finally {
      setPackBusy(false);
    }
  }

  async function generateDraftQuestions() {
    const teacher = selectedDraftTeacher();
    if (!currentDraft || !teacher) return;
    await saveSelectedTeacher();
    setPackBusy(true);
    if (packEditStatusEl) packEditStatusEl.textContent = "Generating questions...";
    try {
      currentDraft = await packStudioClient.generateQuestionsForDraftTeacher(currentDraft.id, teacher.id);
      selectedPackTab = "questions";
      renderPackEditor();
      if (packEditStatusEl) packEditStatusEl.textContent = "Questions generated.";
    } catch (err) {
      if (packEditStatusEl) {
        packEditStatusEl.textContent = "Could not generate questions · " + (err && err.message ? err.message : "error");
        packEditStatusEl.classList.add("is-invalid");
      }
    } finally {
      setPackBusy(false);
    }
  }

  async function deleteDraftQuestion(questionId) {
    const teacher = selectedDraftTeacher();
    if (!currentDraft || !teacher || !questionId) return;
    try {
      currentDraft = await packStudioClient.deleteQuestion(currentDraft.id, teacher.id, questionId);
      renderPackEditor();
    } catch (err) {
      if (packEditStatusEl) {
        packEditStatusEl.textContent = "Could not delete question · " + (err && err.message ? err.message : "error");
        packEditStatusEl.classList.add("is-invalid");
      }
    }
  }

  async function publishCurrentDraft() {
    if (!currentDraft) return;
    await saveDraftPackFields();
    await saveSelectedTeacher();
    setPackBusy(true);
    if (packEditStatusEl) packEditStatusEl.textContent = "Publishing pack...";
    try {
      await packStudioClient.publishDraft(currentDraft.id);
      if (packEditStatusEl) packEditStatusEl.textContent = "Pack published.";
      await refreshPackLibrary();
    } catch (err) {
      if (packEditStatusEl) {
        packEditStatusEl.textContent = "Could not publish pack · " + (err && err.message ? err.message : "error");
        packEditStatusEl.classList.add("is-invalid");
      }
    } finally {
      setPackBusy(false);
    }
  }

  packCloseBtn.addEventListener("click", closePackStore);
  packEl.addEventListener("click", (e) => { if (e.target === packEl) closePackStore(); });
  if (packEditCloseBtn) packEditCloseBtn.addEventListener("click", closePackEditor);
  if (packEditEl) packEditEl.addEventListener("click", (e) => { if (e.target === packEditEl) closePackEditor(); });
  packBtn.addEventListener("click", openPackStore);
  if (packCreateBtn) packCreateBtn.addEventListener("click", createDraftPack);
  if (packAddTeacherBtn) packAddTeacherBtn.addEventListener("click", addDraftTeacher);
  if (packPublishBtn) packPublishBtn.addEventListener("click", publishCurrentDraft);
  if (teacherLoadUrlBtn) teacherLoadUrlBtn.addEventListener("click", loadTeacherMaterialsFromUrl);
  if (teacherGenerateQuestionsBtn) teacherGenerateQuestionsBtn.addEventListener("click", generateDraftQuestions);
  if (packNameInputEl) packNameInputEl.addEventListener("input", schedulePackAutosave);
  if (packDescriptionInputEl) packDescriptionInputEl.addEventListener("input", schedulePackAutosave);
  [teacherDisplayNameInputEl, teacherSocialsInputEl, teacherProfileImageInputEl, teacherPersonaInputEl, teacherMaterialsInputEl].forEach((field) => {
    if (field) field.addEventListener("input", scheduleTeacherAutosave);
  });
  packEditEl.querySelectorAll(".pack-editor-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedPackTab = btn.getAttribute("data-pack-tab") || "materials";
      renderPackTabs();
    });
  });

  // ── student chime ─────────────────────────────────────────────────────────
  // When AI is enabled, fire the LLM-backed /chat/student-chime endpoint so
  // students respond in their own voice. Offline mode uses canned lines.
  let lastChimeAt = 0;
  function studentChimeAllowed() {
    const now = Date.now();
    if (now - lastChimeAt < 5000) return false;
    lastChimeAt = now;
    return true;
  }
  async function fireStudentChime({ situation, note, grade, faculty, delayMs, studentId, bypassCooldown, playerText, recordPlayerText }) {
    if (!bypassCooldown && !studentChimeAllowed()) return false;
    const chimeSeq = chatViewSeq;
    function chimeStillCurrent() {
      return chimeSeq === chatViewSeq && (!faculty || (lastTelemetry && lastTelemetry.faculty === faculty));
    }
    // If a specific studentId is requested (e.g. a @-mention), use them
    // when they're actually in the active room. Otherwise pick a random
    // in-room student.
    const inRoom = studentsForGrade(grade);
    const explicit = studentId ? inRoom.find((s) => s.id === studentId) : null;
    const who = explicit || pickRandom(inRoom);
    if (!who) return false;
    const wait = delayMs ?? (700 + Math.random() * 800);
    await new Promise((resolve) => setTimeout(resolve, wait));
    if (!aiEnabled) {
      const fallback = situation === "answer-correct"
        ? pickRandom(STUDENT_LINES_RIGHT)
        : situation === "answer-wrong"
          ? pickRandom(STUDENT_LINES_WRONG)
          : pickRandom(STUDENT_LINES_GREET);
      if (chimeStillCurrent()) appendMsg({ kind: "student", name: who.name, body: fallback, color: who.color, studentId: who.id });
      return true;
    }
    try {
      const r = await apiFetch("/api/apps/ruby-high/chat/student-chime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: who.id, situation, note, faculty, playerText, recordPlayerText }),
      });
      if (!r.ok) throw new Error("student " + r.status);
      const data = await r.json();
      const line = (data && data.line) || pickRandom(STUDENT_LINES_GREET);
      if (chimeStillCurrent()) appendMsg({ kind: "student", name: who.name, body: line, color: who.color, studentId: who.id });
      return true;
    } catch (err) {
      // Fallback to canned line if the API call fails.
      const fallback = situation === "answer-correct"
        ? pickRandom(STUDENT_LINES_RIGHT)
        : situation === "answer-wrong"
          ? pickRandom(STUDENT_LINES_WRONG)
          : pickRandom(STUDENT_LINES_GREET);
      if (chimeStillCurrent()) appendMsg({ kind: "student", name: who.name, body: fallback, color: who.color, studentId: who.id });
      return false;
    }
  }
  function scheduleStudentChime(wasCorrect, grade, delayMs) {
    fireStudentChime({
      situation: wasCorrect ? "answer-correct" : "answer-wrong",
      note: wasCorrect
        ? "Player just got the question right."
        : "Player just got the question wrong.",
      grade,
      faculty: lastTelemetry && lastTelemetry.faculty,
      delayMs,
    });
  }

  // ── congrats toast ───────────────────────────────────────────────────────
  let toastHideTimer = null;
  function showCongrats(text, wasCorrect) {
    if (!text) return;
    els.congrats.textContent = text;
    els.congrats.classList.remove("is-correct", "is-wrong", "is-visible");
    void els.congrats.offsetWidth;
    els.congrats.classList.add(wasCorrect ? "is-correct" : "is-wrong", "is-visible");
    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => els.congrats.classList.remove("is-visible"), 2400);
  }

  // ── auth ─────────────────────────────────────────────────────────────────
  let lastAuthState = null;
  let authCheckSeq = 0;
  function setSigninStatus(text, invalid) {
    if (!els.signinStatus) return;
    els.signinStatus.textContent = text || "";
    els.signinStatus.classList.toggle("is-invalid", !!invalid);
  }
  function setAuthState(next, opts) {
    const nextAi = !!(opts && opts.ai);
    const nextLocalAi = !!(opts && opts.local_ai);
    if (next === lastAuthState && nextAi === aiEnabled && nextLocalAi === localAiEnabled) return;
    const wasSignedIn = lastAuthState === true;
    lastAuthState = next;
    authed = next;
    aiEnabled = nextAi;
    localAiEnabled = nextLocalAi;
    applyAuthUI();
    // OpenRouter is optional. The overlay is now only a fallback if the app
    // cannot establish even a guest Ruby High session.
    if (authed === false) {
      signinEl.classList.add("is-open");
      signinEl.setAttribute("aria-hidden", "false");
      setSigninStatus("Local session unavailable. Retry, or use OpenRouter.", true);
      if (sheetOverlayOpen) closeSheet();
    } else {
      signinEl.classList.remove("is-open");
      signinEl.setAttribute("aria-hidden", "true");
      setSigninStatus("", false);
    }
    if (teacherChatEnabled() && lastTelemetry) loadHistory(lastTelemetry.faculty);
    if (sheetOverlayOpen) renderSheet();
    if (authed && !wasSignedIn && lastTelemetry && !lastTelemetry.character && !sheetOverlayOpen) {
      sheetAutoShown = true;
      openSheet();
    }
  }
  // Auth is split: the OpenRouter key stays in localStorage, while the
  // server owns an opaque Ruby High session cookie that maps to the
  // persistent character. Verify both on boot and whenever OAuth state may
  // have changed.
  async function ensureGuestSession() {
    const headers = new Headers();
    const key = getStoredApiKey();
    if (key) headers.set("X-Openrouter-Key", key);
    const r = await fetch("/api/apps/ruby-high/auth/guest", {
      method: "POST",
      credentials: "same-origin",
      headers,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data || !data.session) throw new Error("guest session failed");
    setAuthState(true, { ai: !!data.ai, local_ai: !!data.local_ai });
  }
  async function retryGuestSession() {
    if (els.signinGuest) els.signinGuest.disabled = true;
    setSigninStatus("Starting local session…", false);
    try {
      await ensureGuestSession();
      await fetchSession();
    } catch (err) {
      setSigninStatus("Could not reach Ruby High. Make sure the local server is running.", true);
    } finally {
      if (els.signinGuest) els.signinGuest.disabled = false;
    }
  }
  async function deriveAuth() {
    const key = getStoredApiKey();
    const seq = ++authCheckSeq;
    try {
      const headers = new Headers();
      if (key) headers.set("X-Openrouter-Key", key);
      const r = await fetch("/api/apps/ruby-high/auth/me", {
        credentials: "same-origin",
        headers,
      });
      const data = await r.json().catch(() => ({}));
      if (seq !== authCheckSeq) return;
      if (r.ok && data && data.session) {
        setAuthState(true, { ai: !!data.ai, local_ai: !!data.local_ai });
      } else {
        await ensureGuestSession();
      }
    } catch (_e) {
      if (seq !== authCheckSeq) return;
      try {
        await ensureGuestSession();
      } catch {
        if (lastAuthState === null) setAuthState(false, { ai: false, local_ai: false });
      }
    }
  }
  function applyAuthUI() {
    els.checking.hidden = authed !== null;
    if (authed === null) {
      els.chatForm.hidden = true;
      if (els.nextBtn) els.nextBtn.hidden = true;
      if (els.hallPassBtn) els.hallPassBtn.hidden = true;
      els.checking.hidden = false;
      els.youState.textContent = "checking…";
      els.footerAction.hidden = true;
      return;
    }
    if (authed) {
      els.youState.textContent = aiEnabled ? (localAiEnabled ? "local AI" : "AI enabled") : activeTeacherUsesServerAi() ? "teacher connected" : "offline mode";
      els.footerAction.textContent = aiEnabled ? "Sign out" : "Enable AI";
      els.footerAction.hidden = localAiEnabled;
      if (els.hallPassBtn) els.hallPassBtn.hidden = false;
      els.chatForm.hidden = true;
      setChatComposerDisabled(true);
    } else {
      // Unauthed means even guest-session creation failed; the fallback
      // sign-in overlay is the only thing the user can see.
      els.youState.textContent = "signed out";
      els.footerAction.hidden = true;
      if (els.hallPassBtn) els.hallPassBtn.hidden = true;
      els.chatForm.hidden = true;
      setChatComposerDisabled(true);
      if (els.nextBtn) els.nextBtn.hidden = true;
    }
    // Re-render the blackboard so its visibility flips with auth state.
    if (lastTelemetry) {
      const fac = (lastTelemetry.faculty_roster || []).find((f) => f.id === lastTelemetry.faculty);
      updateChatAction(deriveViewMode(lastTelemetry));
      renderBlackboard(lastTelemetry.current || null, fac || null, lastTelemetry.current_grade);
      renderRaceStrip(lastTelemetry);
    }
  }
  async function logout() {
    // Clear the credential first so any in-flight refresh sees us as
    // signed out, then ask the server to drop the cookie that bucketed
    // our state.
    clearStoredAuth();
    try {
      await fetch("/api/apps/ruby-high/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch (e) { /* network failure is fine — local state is what matters */ }
    authed = null;
    aiEnabled = false;
    localAiEnabled = false;
    lastAuthState = null;
    await deriveAuth();
    applyAuthUI();
    if (teacherChatEnabled() && lastTelemetry) loadHistory(lastTelemetry.faculty);
  }
  async function loadHistory(facultyId) {
    if (!teacherChatEnabled() || !facultyId) return;
    const requestSeq = chatViewSeq;
    try {
      const r = await apiFetch("/api/apps/ruby-high/chat/history?faculty=" + encodeURIComponent(facultyId));
      const data = await r.json();
      if (requestSeq !== chatViewSeq || !lastTelemetry || lastTelemetry.faculty !== facultyId) return;
      aiEnabled = !!data.authed;
      localAiEnabled = !!data.local_ai;
      const msgs = data.history || [];
      const sig = facultyId + ":" + playerMessageIdentitySig() + ":" + msgs.length;
      if (sig === renderedHistorySig) return;
      renderedHistorySig = sig;
      els.stream.innerHTML = "";
      const fac = (lastTelemetry && lastTelemetry.faculty_roster || []).find((f) => f.id === facultyId);
      const teacherName = fac ? fac.displayName : facultyId;
      const teacherAccent = fac ? fac.accent : "#d22a2a";
      msgs.forEach((m) => {
        if (m.role === "user") appendMsg({ kind: "you", name: playerDisplayName(), body: m.content, color: "var(--accent)" });
        else if (m.role === "assistant" && m.content) {
          const info = teacherInfo(m.faculty || facultyId);
          appendMsg({ kind: "teacher", name: info.name || teacherName, body: m.content, color: info.accent || teacherAccent, facultyId: info.facultyId || facultyId });
        }
        else if (m.role === "tool") {
          const info = teacherInfo(m.faculty || facultyId);
          appendTool(toolSummary(m, info.name));
        }
      });
      syncPlayerMessageHeaders();
      scrollIfPinned(true);
      applyAuthUI();
    } catch (err) { /* ignore */ }
  }
  // Shared SSE consumer — used for /chat (user-initiated) and /chat/event
  // (teacher-driven turns AND lounge multi-teacher turns). Tracks the current
  // "speaker" via the speaker event so each new bubble is attributed correctly.
  function teacherInfo(facultyId) {
    const fac = (lastTelemetry && lastTelemetry.faculty_roster || []).find((f) => f.id === facultyId);
    return {
      name: fac ? fac.displayName : "Teacher",
      accent: fac ? fac.accent : "#d22a2a",
      facultyId: fac ? fac.id : facultyId,
    };
  }
  function toolSummary(parsed, teacherName) {
    const ok = !!(parsed.result && parsed.result.ok);
    const errorText = parsed.result && parsed.result.error ? String(parsed.result.error) : "";
    const blockedByActiveBoard = /Question already (on|posted by).*board|wait for the student answer|Cannot (post another question|clear the board) while a question is live/i.test(errorText);
    if (!ok && blockedByActiveBoard) return teacherName + " waited — a card is already up";
    switch (parsed.tool) {
      case "pick_from_bank": {
        const srs = lastTelemetry && lastTelemetry.active_course_progress && lastTelemetry.active_course_progress.mode === "srs";
        return ok ? "🎲 " + teacherName + " drew a board" : teacherName + (srs ? " has no scheduled card" : " reached for the bank — empty");
      }
      case "pose_question": return ok ? "✍️ " + teacherName + " wrote a custom question" : teacherName + " tried to write a question — failed";
      case "pose_opinion":  return ok ? "💭 " + teacherName + " asked for opinions" : teacherName + " tried to ask for opinions — failed";
      case "clear_board":   return ok ? "✨ " + teacherName + " cleared the board" : teacherName + " tried to clear the board — failed";
      case "handoff_faculty": {
        const target = (parsed.args && parsed.args.faculty) || "another teacher";
        return ok ? "↪ " + teacherName + " handed class off to " + target : teacherName + " tried to hand off — failed";
      }
      default: return ok ? teacherName + " did a thing (" + parsed.tool + ")" : teacherName + " tried " + parsed.tool + " — failed";
    }
  }
  function chatStreamStillCurrent(opts) {
    return turnController.streamStillCurrent(opts);
  }
  async function consumeSseStream(response, opts) {
    // Default speaker = current channel's teacher; overridden by speaker events.
    let speaker = teacherInfo(lastTelemetry && lastTelemetry.faculty);
    let streamMsgEl = null;
    await consumeViewerSseStream(response, {
      isCurrent() {
        return chatStreamStillCurrent(opts);
      },
      onErrorResponse(error) {
        appendSystem("chat error · " + (error || response.status));
      },
      onEvent(event, parsed) {
        if (event === "speaker") {
          speaker = teacherInfo(parsed.facultyId);
          streamMsgEl = null; // force a new bubble for the new speaker
        } else if (event === "delta") {
          if (!streamMsgEl) {
            streamMsgEl = appendMsg({ kind: "teacher", name: speaker.name, body: "", color: speaker.accent, facultyId: speaker.facultyId });
          }
          streamMsgEl.dataset.markdownRaw = (streamMsgEl.dataset.markdownRaw || "") + (parsed.text || "");
          renderMarkdownInto(streamMsgEl, streamMsgEl.dataset.markdownRaw);
          scrollIfPinned();
        } else if (event === "tool") {
          // Flavor-string the tool call instead of raw args — args for
          // pose_question include the correct-choice field, leaking the
          // answer straight into the visible chat. Keep the same dice
          // and emoji language as the answer-reveal chips so the row
          // reads as "the teacher is doing a thing" not "here is a
          // JSON dump." (NB: do not write literal backticks inside
          // this script — the whole file is inside an outer template
          // literal and a stray backtick closes it.)
          const teacherName = (speaker && speaker.name) || "Teacher";
          // String concatenation, NOT template literals — see the
          // big comment above; this whole script.ts body is wrapped
          // in an outer template literal at compose time and any
          // backtick here closes it prematurely.
          appendTool(toolSummary(parsed, teacherName));
          refreshSessionAfterStreamEvent();
          streamMsgEl = null;
        } else if (event === "error") {
          appendSystem("error · " + (parsed.message || "unknown"));
          refreshSessionAfterStreamEvent();
          streamMsgEl = null;
        } else if (event === "waiting" || event === "opinion-graded") {
          refreshSessionAfterStreamEvent();
          streamMsgEl = null;
        } else if (event === "done" || event === "end") {
          refreshSessionAfterStreamEvent();
          streamMsgEl = null;
        }
      },
      watchdogMs: 45000,
    });
  }

  async function sendChatMessage(text) {
    if (!teacherChatEnabled() || !text.trim()) return;
    const agentTurn = turnController.beginAgent(false);
    if (!agentTurn) return;
    // While the room-idle DM turn is in progress (clock expired, round not
    // yet resolved), hold player chat so it doesn't race the teacher.
    if (lastTelemetry && lastTelemetry.active_round && lastTelemetry.active_round.idleTriggered && !lastTelemetry.active_round.resolved) {
      agentTurn.finish();
      return;
    }
    const targetFaculty = (lastTelemetry && lastTelemetry.faculty) || "ruby";

    // If an opinion question is active and the player hasn't submitted their
    // response yet, route this chat message to /chat/opinion-submit instead
    // of the regular agent loop.
    const opinionQuestionId = lastTelemetry && lastTelemetry.current ? lastTelemetry.current.id : null;
    const roundAtSubmit = lastTelemetry && lastTelemetry.active_round;
    const inOpinion = !!(
      lastTelemetry
      && lastTelemetry.is_opinion
      && roundAtSubmit
      && !roundAtSubmit.resolved
      && !playerOpinionRecorded(roundAtSubmit)
      && !(opinionSubmitted && opinionSubmittedQuestionId === opinionQuestionId)
    );

    const streamGuard = turnController.nextStreamGuard(targetFaculty);
    try {
      appendMsg({ kind: "you", name: playerDisplayName(), body: text, color: "var(--accent)" });

      // @-mention: if the player named an in-room classmate, that student
      // chimes in directly. Each mention bypasses the 5s cooldown and a
      // small per-student delay keeps overlapping mentions from stomping
      // each other. Out-of-room mentions are silently ignored.
      const inRoomStudents = studentsForGrade(lastTelemetry && lastTelemetry.current_grade);
      const mentionedIds = new Set();
      for (const s of inRoomStudents) {
        const re = new RegExp("\\b" + s.name + "\\b", "i");
        if (re.test(text)) mentionedIds.add(s.id);
      }
      let mentionDelayBase = 600;
      for (const sid of mentionedIds) {
        fireStudentChime({
          situation: "mention",
          note: "The player addressed you directly. Respond in 1 sentence — react to what they actually said, in your voice.",
          playerText: text,
          grade: lastTelemetry && lastTelemetry.current_grade,
          faculty: lastTelemetry && lastTelemetry.faculty,
          delayMs: mentionDelayBase,
          studentId: sid,
          bypassCooldown: true,
        });
        mentionDelayBase += 800 + Math.random() * 600;
      }

      els.chatInput.value = "";
      els.chatInput.style.height = "40px";
      setChatComposerDisabled(true);
      let r;
      if (inOpinion) {
        markOpinionSubmitted(opinionQuestionId);
        r = await apiFetch("/api/apps/ruby-high/chat/opinion-submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          timeoutMs: STREAM_CONNECT_TIMEOUT_MS,
          body: JSON.stringify({ text }),
        });
      } else {
        r = await apiFetch("/api/apps/ruby-high/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          timeoutMs: STREAM_CONNECT_TIMEOUT_MS,
          body: JSON.stringify({ faculty: targetFaculty, message: text }),
        });
      }
      await consumeSseStream(r, streamGuard);
    } catch (err) {
      if (inOpinion) clearOpinionSubmitted();
      if (chatStreamStillCurrent(streamGuard)) appendSystem("chat failed · " + (err && err.message ? err.message : "error"));
    } finally {
      agentTurn.finish();
      syncChatComposerDisabled();
      if (!els.chatInput.disabled) els.chatInput.focus();
    }
  }

  // Teacher-driven turn — fires when a state event happens (channel enter,
  // answer graded). The teacher decides what to say and whether to put a new
  // question on the board via tool calls.
  // opts.force = true bypasses the current agent-turn guard. Used for user-initiated
  // transitions (room switch, lounge entry, grade selection) — blocking the
  // user while the previous teacher is still streaming is the antipattern
  // we're stepping away from. Eventually the busy concept moves chat-side
  // (group-chat semantics — multiple speakers, no global lock); this flag
  // is the transitional shape.
  async function runAgentTurn(trigger, context, opts) {
    if (!teacherChatEnabled()) return;
    const force = !!(opts && opts.force);
    const targetFaculty = (lastTelemetry && lastTelemetry.faculty) || "ruby";
    const triggerKey = trigger + "::" + targetFaculty + "::" + ((context && context.grade) || "?");
    // Channel-enter dedupes per (grade, faculty); answer-graded fires every time.
    if (trigger === "channel-enter" && triggerKey === lastAgentTrigger) return;
    const agentTurn = turnController.beginAgent(force);
    if (!agentTurn) return;
    lastAgentTrigger = triggerKey;
    const streamGuard = turnController.nextStreamGuard(targetFaculty);
    try {
      const r = await apiFetch("/api/apps/ruby-high/chat/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: STREAM_CONNECT_TIMEOUT_MS,
        body: JSON.stringify({ faculty: targetFaculty, trigger, context: context || {}, clientTurnSeq: streamGuard.streamSeq }),
      });
      await consumeSseStream(r, streamGuard);
    } catch (err) {
      if (chatStreamStillCurrent(streamGuard)) appendSystem("teacher offline · " + (err && err.message ? err.message : "error"));
    } finally {
      agentTurn.finish();
      await clearResolvedBoardAfterTeacherTurn(trigger, streamGuard);
    }
  }

  function refreshSessionAfterStreamEvent() {
    void fetchSession({ timeoutMs: SESSION_REFRESH_TIMEOUT_MS });
  }

  async function fetchSession(opts) {
    await apiClient.fetchSession(opts || {});
  }

  // ── rails toggling ────────────────────────────────────────────────────────
  function openRails() { els.shell.classList.add("is-rails-open"); }
  function closeRails() { els.shell.classList.remove("is-rails-open"); }
  function toggleRails() { els.shell.classList.toggle("is-rails-open"); }

  // ── opinion-mode helpers ────────────────────────────────────────────────
  // The player's opinion submission is just a regular chat message routed to
  // the opinion endpoint. NPC responses appear as chat messages too. The
  // teacher's verdict streams as a normal chat reply when grading fires.
  function renderOpinionsIntoChat(round) {
    if (!round || round.type !== "opinion") return;
    // Render any new NPC responses (deduped by responder id) as student
    // chat messages.
    for (const r of (round.opinionResponses || [])) {
      if (r.responder === "player") continue;
      if (renderedOpinionIds.has(r.responder)) continue;
      renderedOpinionIds.add(r.responder);
      const s = STUDENTS.find((x) => x.id === r.responder);
      if (!s) continue;
      appendMsg({ kind: "student", name: s.name, body: r.text, color: s.color, studentId: s.id });
    }
    // Stamp grade tags onto the matching past chat messages once grades land.
    for (const g of (round.opinionGrades || [])) {
      if (gradedResponderIds.has(g.responder)) continue;
      gradedResponderIds.add(g.responder);
      stampGradeOnLatestMessage(g, round.bestResponder === g.responder);
    }
  }

  function stampGradeOnLatestMessage(grade, isBest) {
    // Walk the chat log backwards and stamp the most recent body that came
    // from this responder. Cheap heuristic — acceptable for v1.
    const nodes = Array.from(els.stream.querySelectorAll(".msg"));
    // Player messages render under playerDisplayName() (character first name,
    // or "You" when no character exists yet). Match either so the player's
    // grade-tag actually lands on their nametag.
    const playerNames = grade.responder === "player"
      ? new Set(["You", playerDisplayName()].filter(Boolean))
      : null;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const nameEl = node.querySelector(".head .name");
      if (!nameEl) continue;
      const name = (nameEl.textContent || "").trim();
      if (playerNames) {
        if (!playerNames.has(name)) continue;
      } else {
        const target = STUDENTS.find((s) => s.id === grade.responder)?.name || grade.responder;
        if (name !== target) continue;
      }
      // Avoid double-stamping.
      if (node.querySelector(".grade-tag")) continue;
      const tag = document.createElement("span");
      tag.className = "grade-tag" + (grade.score < 7 ? " bad" : "") + (isBest ? " best" : "");
      tag.title = grade.comment || "";
      tag.textContent = (isBest ? "★ " : "") + grade.score.toFixed(1) + "/10";
      const head = node.querySelector(".head");
      if (head) head.appendChild(tag);
      break;
    }
  }

  async function maybeAutoTriggerGrading(t) {
    if (!t.active_round || t.active_round.type !== "opinion") return;
    if (opinionGradeFired || t.active_round.resolved) return;
    const responseCount = (t.active_round.opinionResponses || []).length;
    const expected = 1 + (t.active_round.npcs || []).length;
    const allIn = responseCount >= expected;
    const expired = (t.active_round.remainingMs ?? 1) <= 0;
    if (!allIn && !expired) return;
    opinionGradeFired = true;
    const targetFaculty = (lastTelemetry && lastTelemetry.faculty) || null;
    const streamGuard = turnController.nextStreamGuard(targetFaculty);
    try {
      const r = await apiFetch("/api/apps/ruby-high/chat/opinion-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: STREAM_CONNECT_TIMEOUT_MS,
        body: JSON.stringify({ force: true }),
      });
      await consumeSseStream(r, streamGuard);
    } catch (err) {
      opinionGradeFired = false;
      if (chatStreamStillCurrent(streamGuard)) appendSystem("grading failed · " + (err && err.message ? err.message : "error"));
    }
  }

  // ── wire ─────────────────────────────────────────────────────────────────
  els.answers.forEach((btn) => {
    btn.addEventListener("click", () => pickAnswer(btn.dataset.pick, btn));
  });
  els.typedAnswerForm.addEventListener("submit", submitTypedAnswer);
  els.generateMcBtn.addEventListener("click", generateMultipleChoice);
  els.nextBtn.addEventListener("click", pickNext);
  els.hamburger.addEventListener("click", toggleRails);
  els.scrim.addEventListener("click", closeRails);
  els.homeBtn.addEventListener("click", openRails);
  els.footerAction.addEventListener("click", () => {
    if (!authed) return;
    if (localAiEnabled) return;
    if (aiEnabled) {
      logout();
    } else {
      window.location.href = "/api/apps/ruby-high/auth/start";
    }
  });

  // ── bug-report surface ─────────────────────────────────────────────────
  // Capture the last few console errors + unhandled rejections so the
  // bug-report prefill includes them. Limit to a small ring buffer
  // so a chatty page doesn't bloat the URL we end up encoding.
  const RECENT_ERRORS = [];
  const ERROR_LIMIT = 5;
  function recordError(label, msg) {
    if (!msg) return;
    const stamp = new Date().toISOString().slice(11, 19);
    const line = stamp + " " + label + ": " + String(msg).slice(0, 240);
    RECENT_ERRORS.push(line);
    if (RECENT_ERRORS.length > ERROR_LIMIT) RECENT_ERRORS.shift();
  }
  window.addEventListener("error", (e) => {
    recordError("error", (e && (e.message || (e.error && e.error.message))) || "unknown");
  });
  window.addEventListener("unhandledrejection", (e) => {
    recordError("unhandledrejection", (e && e.reason && (e.reason.message || e.reason)) || "unknown");
  });
  // Wrap console.error so anything we deliberately log lands in the
  // ring buffer too. The original is preserved.
  const origConsoleError = console.error.bind(console);
  console.error = function (...args) {
    try { recordError("console.error", args.map((a) => a && a.message ? a.message : String(a)).join(" ")); }
    catch { /* ignore */ }
    origConsoleError(...args);
  };

  function collectBugReportContext() {
    const ch = lastTelemetry && lastTelemetry.character;
    const grade = lastTelemetry && lastTelemetry.current_grade;
    const faculty = lastTelemetry && lastTelemetry.faculty;
    return {
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      session: authed,
      aiEnabled,
      character: ch ? ch.name + " (" + (ch.playbookId || "?") + ")" : "none",
      grade: grade || "—",
      faculty: faculty || "—",
      viewport: window.innerWidth + "×" + window.innerHeight,
      recentErrors: RECENT_ERRORS.slice(),
    };
  }
  function setBugReportBusy(busy) {
    els.bugReportOverlay && els.bugReportOverlay.classList.toggle("is-busy", !!busy);
    if (els.bugReportSubmit) els.bugReportSubmit.disabled = !!busy;
    if (els.bugReportCancel) els.bugReportCancel.disabled = !!busy;
    if (els.bugReportClose) els.bugReportClose.disabled = !!busy;
    if (els.bugReportText) els.bugReportText.disabled = !!busy;
  }
  function setBugReportStatus(text, invalid) {
    if (!els.bugReportStatus) return;
    els.bugReportStatus.textContent = text || "";
    els.bugReportStatus.classList.toggle("is-invalid", !!invalid);
  }
  function openBugReport() {
    if (!els.bugReportOverlay) return;
    setBugReportStatus("", false);
    els.bugReportOverlay.classList.add("is-open");
    setTimeout(() => { if (els.bugReportText) els.bugReportText.focus(); }, 0);
  }
  function closeBugReport() {
    if (!els.bugReportOverlay) return;
    if (els.bugReportOverlay.classList.contains("is-busy")) return;
    els.bugReportOverlay.classList.remove("is-open");
    setBugReportBusy(false);
    setBugReportStatus("", false);
  }
  async function submitBugReport(e) {
    if (e) e.preventDefault();
    const description = els.bugReportText ? els.bugReportText.value.trim() : "";
    setBugReportBusy(true);
    setBugReportStatus("Sending report…", false);
    try {
      const r = await apiFetch(apiBase + "/bug-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, context: collectBugReportContext() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.success) {
        throw new Error(data.error || "report " + r.status);
      }
      setBugReportStatus("Report sent.", false);
      if (els.bugReportText) els.bugReportText.value = "";
      setBugReportBusy(false);
      setTimeout(closeBugReport, 900);
    } catch (err) {
      setBugReportStatus("Couldn't send · " + (err && err.message ? err.message : "error"), true);
      setBugReportBusy(false);
    }
  }

  els.reportBugLink.addEventListener("click", openBugReport);
  if (els.bugReportForm) els.bugReportForm.addEventListener("submit", submitBugReport);
  if (els.bugReportClose) els.bugReportClose.addEventListener("click", closeBugReport);
  if (els.bugReportCancel) els.bugReportCancel.addEventListener("click", closeBugReport);
  if (els.bugReportOverlay) els.bugReportOverlay.addEventListener("click", (e) => {
    if (e.target === els.bugReportOverlay) closeBugReport();
  });
  if (els.hallPassBtn) els.hallPassBtn.addEventListener("click", openBilling);
  if (els.billingClose) els.billingClose.addEventListener("click", closeBilling);
  if (els.billingOverlay) els.billingOverlay.addEventListener("click", (e) => {
    if (e.target === els.billingOverlay) closeBilling();
  });
  if (els.signinGuest) els.signinGuest.addEventListener("click", retryGuestSession);

  // Click your name/avatar to open the character sheet.
  const youCardBlock = document.querySelector(".channels-footer .you-meta");
  if (youCardBlock) youCardBlock.addEventListener("click", () => { if (authed) openSheet(); });
  const youAvatarEl = document.querySelector(".channels-footer .you-avatar");
  if (youAvatarEl) youAvatarEl.addEventListener("click", () => { if (authed) openSheet(); });
  els.chatForm.addEventListener("submit", (e) => { e.preventDefault(); sendChatMessage(els.chatInput.value); });
  els.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(els.chatInput.value); }
  });
  els.chatInput.addEventListener("input", () => {
    els.chatInput.style.height = "40px";
    els.chatInput.style.height = Math.min(140, els.chatInput.scrollHeight) + "px";
  });

  // First boot: open rails on desktop only.
  if (window.matchMedia("(min-width: 1100px)").matches) {
    els.shell.classList.add("is-rails-open");
  } else if (window.matchMedia("(min-width: 720px)").matches) {
    // Tablet: servers rail visible, channels closed.
  }

  applyAuthUI();
  consumeBillingReturnFlag();
  // The session is born already enrolled at Freshman year (server-side
  // default). The player progresses Freshman → Sophomore → Junior → Senior
  // → graduate as they clear per-grade daily-class and subject-grade gates. There is no year
  // picker — they walk in, get started, and advance by playing.
  fetchSession();
  // Auth is checked once on boot and again whenever the OAuth tab writes
  // the key (storage event fires in every other tab) or the user returns
  // to this tab from elsewhere (focus). No periodic polling: the only
  // server state we need here is the session cookie's current validity.
  deriveAuth();
  window.addEventListener("storage", (e) => {
    if (e.key === AUTH_KEY || e.key === null) deriveAuth();
  });
  // Belt-and-braces wake-up triggers. The OAuth flow is now same-tab so
  // none of these are load-bearing on the happy path, but they cover any
  // edge where the user returns from a separate-tab flow (a stray
  // target=_blank link, a back-forward cache hit, a tab-switch on iOS
  // Safari which does not fire focus reliably between same-window tabs).
  window.addEventListener("focus", deriveAuth);
  window.addEventListener("pageshow", deriveAuth);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") deriveAuth();
  });
  // Adaptive poll: tick every second during an active race so NPC picks
  // land in real time; back off to 4s when idle to save bandwidth.
  let sessionPollHandle = null;
  function adaptiveSchedule() {
    clearTimeout(sessionPollHandle);
    const round = lastTelemetry && lastTelemetry.active_round;
    const fast = round && !round.resolved;
    sessionPollHandle = setTimeout(async () => {
      await fetchSession();
      adaptiveSchedule();
    }, fast ? 750 : 4000);
  }
  adaptiveSchedule();
})();
`;
