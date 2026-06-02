// @ts-nocheck
// Browser client body for the inline Ruby High viewer. This is real JavaScript
// now, not a template-string blob; keep imports out of this file because
// viewerScript serializes runViewerClient with Function#toString().
export function runViewerClient(bootstrap) {
  const apiBase = bootstrap.apiBase;
  const sessionId = bootstrap.sessionId;
  const role = bootstrap.role;
  const buildId = bootstrap.build || "dev";
  const privyConfig = bootstrap.privyConfig;
  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      const isLocalDev = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
      if (isLocalDev) {
        navigator.serviceWorker.getRegistrations()
          .then((regs) => regs.forEach((reg) => {
            if (reg.scope.indexOf("/api/apps/ruby-high/") !== -1) reg.unregister().catch(() => {});
          }))
          .catch(() => {});
        return;
      }
      navigator.serviceWorker.register(apiBase + "/service-worker.js", { scope: apiBase + "/" })
        .then((reg) => { reg.update().catch(() => {}); })
        .catch(() => {});
    });
  }
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
  const metricsEventUrl = apiBase + "/metrics/event";
  // VIEWER_CONSTANTS (VISITOR_ID_KEY, GRADE_LABELS, STAT_META, …) and pure
  // helpers (statLabel, letterGradeForScore, makeVisitorId, getVisitorId,
  // attachVisitorHeader, …) are declared in the surrounding IIFE by
  // viewer-parts/script.ts → client-pure.ts. They're in scope here.
  const DEFAULT_RUBY_TOKEN_MINT = "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump";
  const JUPITER_SOL_TO_RUBY_SWAP_PREFIX = "https://jup.ag/swap/SOL-";
  function subjectProgressForFaculty(fid) {
    const roster = (lastTelemetry && lastTelemetry.faculty_roster) || [];
    return roster.find((f) => f.id === fid) || null;
  }
  function subjectDisplayName(fid, progress) {
    const known = { ruby: "Homeroom", "sally-science": "Science", "professor-edward": "Literature" };
    if (known[fid]) return known[fid];
    const p = progress || subjectProgressForFaculty(fid);
    return (p && (p.displayName || p.shortName)) || fid || "Subject";
  }
  function classGradeForFaculty(fid) {
    const progress = subjectProgressForFaculty(fid);
    return earnedCourseGrade(progress) || "—";
  }
  // Return the name of the faculty teaching tomorrow, if known.
  function getNextFacultyName(t) {
    if (!t || !t.faculty_rotation) return null;
    const rotation = t.faculty_rotation;
    const tomorrow = rotation.tomorrow;
    if (tomorrow && tomorrow.name) {
      if (tomorrow.name === "Ruby") return "Ruby";
      if (tomorrow.name === "Sally Science" || tomorrow.name === "sally-science") return "Sally Science";
      if (tomorrow.name === "Professor Edward" || tomorrow.name === "professor-edward") return "Professor Edward";
      return tomorrow.name;
    }
    return null;
  }

  function postClassState(t) {
    const progress = t && t.active_course_progress;
    const report = !!(t && activeDailyClassIsComplete(t) && !t.current && !t.graduation_ready);
    const nextRole = (progress && progress.nextCardRole) || "";
    const canPick = scheduledCanPick(t);
    const hasBank = Number(progress && progress.total || 0) > 0;
    return {
      report,
      nextRole,
      canPick,
      socialReady: report && canPick && nextRole === "social",
      practiceReady: report && nextRole !== "social" && (canPick || hasBank),
    };
  }
  function guestSignupRequired(t) {
    const access = t && t.guest_access;
    return !!(access && access.requiresSignup);
  }
  function guestSignupMessage(t) {
    const access = t && t.guest_access;
    return access && access.message
      ? access.message
      : "Today's class is done. Sign up to keep your character, earn Merit Stars, and unlock all classrooms. It just takes a moment.";
  }
  function nextQuestionButtonLabel(t) {
    t = t || lastTelemetry;
    if (t && t.graduation_ready && !t.current) return "Ceremony";
    const round = t && t.active_round;
    const cur = t && t.current;
    const offlineClassroom = !!(authed && !teacherChatEnabled() && t && t.character && t.faculty !== LOUNGE_ID);
    if (round && !round.resolved && cur) return offlineClassroom ? "Continue" : "Chat";
    if (cur && (currentRevealMatches(t) || t.status === "revealed")) return "Continue";
    const postClass = postClassState(t);
    if (postClass.report && guestSignupRequired(t)) return "Sign up";
    if (postClass.socialReady) return "Start Social Card";
    if (postClass.report) return "Practice";
    return offlineClassroom ? "Continue" : "Chat";
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
      ? (teacherChatEnabled() ? "Ask for a hint" : "Answer the board to continue")
      : postClass.report && guestSignupRequired(t)
        ? "Sign up to continue past today's class"
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
    const gateIds = lastTelemetry && lastTelemetry.graduation_gate && Array.isArray(lastTelemetry.graduation_gate.requiredFacultyIds)
      ? lastTelemetry.graduation_gate.requiredFacultyIds.filter(Boolean)
      : [];
    if (gateIds.length > 0) return gateIds;
    const roster = (lastTelemetry && lastTelemetry.faculty_roster) || [];
    const ids = roster
      .filter((f) => f && f.id !== LOUNGE_ID && Number(f.requiredClasses || 0) > 0)
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
        grade: earnedCourseGrade(progress) || classGradeForFaculty(fid),
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
    return !!(key && !t.current && !t.graduation_ready && key !== dismissedClassReportKey);
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
  // formatClassScore, todayCorrectSummary, formatWholeNumber are in client-pure.

  // Build compact empty-board status from the active course roster.
  // subjectGateMetaFor and makeSubjectGradeChip are defined further down
  // (function declarations are hoisted within the IIFE).
  function buildBoardSubjectGrades() {
    const t = lastTelemetry;
    if (!t || !t.character || !t.current_grade) return null;
    const summary = subjectClearSummary();
    const wrap = document.createElement("div");
    wrap.className = "board-subject-grades";
    const heading = document.createElement("div");
    heading.className = "board-subject-grades-title";
    heading.textContent = boardSubjectGradesTitle(summary);
    wrap.appendChild(heading);
    wrap.appendChild(buildBoardSubjectGradesRow(summary));
    return wrap;
  }

  function boardSubjectGradesTitle(summary) {
    const t = lastTelemetry;
    const grade = t && t.current_grade ? t.current_grade : "";
    return (GRADE_LABELS[grade] || (grade ? "Grade " + grade : "Current year"))
      + " · " + summary.met + "/" + summary.total + " subjects cleared";
  }

  function buildBoardSubjectGradesRow(summary) {
    const row = document.createElement("div");
    row.className = "board-subject-grades-row";
    for (const g of summary.grades) {
      const meta = subjectGateMetaFor(g.facultyId, g.progress);
      const p = g.progress || {};
      const completed = Number(p.completedClasses || 0);
      const required = Number(p.requiredClasses || 0);
      const met = required > 0 && completed >= required && letterGradePasses(g.grade);
      row.appendChild(makeSubjectGradeChip({
        label: meta.label,
        icon: meta.icon,
        grade: met ? g.grade : subjectProgressShortLabel(p),
        met,
        pending: !met,
      }));
    }
    return row;
  }

  function buildBoardInfoButton(infoText) {
    const text = String(infoText || "").trim();
    if (!text) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "board-info-button";
    button.setAttribute("aria-label", "Class details");
    button.title = text;
    button.textContent = "i";
    const bubble = document.createElement("span");
    bubble.className = "board-info-popover";
    bubble.setAttribute("aria-hidden", "true");
    bubble.textContent = text;
    button.appendChild(bubble);
    return button;
  }

  function buildBoardClassStartHeader(statusText, infoText) {
    const summary = subjectClearSummary();
    const wrap = document.createElement("div");
    wrap.className = "board-empty-header";
    const top = document.createElement("div");
    top.className = "board-empty-topline";
    const grade = document.createElement("div");
    grade.className = "board-empty-grade";
    grade.textContent = boardSubjectGradesTitle(summary);
    top.appendChild(grade);
    const info = buildBoardInfoButton(infoText);
    if (info) top.appendChild(info);
    wrap.appendChild(top);
    const status = document.createElement("div");
    status.className = "board-empty-status";
    status.textContent = statusText || "Today's class ready";
    wrap.appendChild(status);
    wrap.appendChild(buildBoardSubjectGradesRow(summary));
    return wrap;
  }

  function buildGuestSpotlight(t) {
    if (!secondarySurfacesUnlocked(t)) return null;
    const guest = t.guest_pack || {};
    const pack = guest.auto || null;
    if (!pack || !pack.id) return null;
    const key = String(guest.weekKey || "") + ":" + String(pack.id);
    if (!guestSpotlightSeenKeys.has(key)) {
      guestSpotlightSeenKeys.add(key);
      postViewerMetricEvent("guest_spotlight_seen", { packId: pack.id });
    }
    const wrap = document.createElement("div");
    wrap.className = "guest-spotlight";
    const copy = document.createElement("div");
    copy.className = "guest-spotlight-copy";
    const title = document.createElement("div");
    title.className = "guest-spotlight-title";
    title.textContent = "This week's guest teacher";
    const meta = document.createElement("div");
    meta.className = "guest-spotlight-meta";
    const teacher = pack.teacher_name || "Guest Faculty";
    const subject = pack.subject || "guest class";
    const count = Math.max(0, Math.floor(Number(pack.question_count || 0)));
    meta.textContent = pack.name + " · " + teacher + " · " + subject + " · " + count + " questions";
    copy.appendChild(title);
    copy.appendChild(meta);
    const action = document.createElement("button");
    action.type = "button";
    action.className = "guest-spotlight-action";
    const isActive = guest.active && guest.active.id === pack.id && guest.mode === "auto";
    action.textContent = isActive ? "Guest Faculty active" : "Try Guest Faculty";
    action.disabled = !!isActive;
    action.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void startGuestSpotlight(pack);
    });
    wrap.appendChild(copy);
    wrap.appendChild(action);
    return wrap;
  }

  async function startGuestSpotlight(pack) {
    if (!pack || !pack.id) return;
    postViewerMetricEvent("guest_spotlight_started", { packId: pack.id });
    try {
      packLibraryState = await packStudioClient.setGuestAuto();
      syncGuestAutoButton();
      renderPackList();
      renderDraftPackList();
      await fetchSession();
    } catch (_err) {
      appendSystem("guest faculty unavailable");
    }
  }

  // ── auth credential (client-owned) ───────────────────────────────────────
  // The browser-owned AI key defaults to sessionStorage so a future script
  // injection bug has a smaller time window. localStorage is only honored
  // when the user has explicitly opted into persistent BYOK storage. The
  // server never persists it; server-side auth stores only an opaque app
  // session.
  const AUTH_KEY = "rh_openrouter_key";
  const AUTH_LABEL = "rh_openrouter_label";
  const AUTH_AT = "rh_openrouter_at";
  const AUTH_PERSIST = "rh_openrouter_persist";
  const LAST_SEEN_KEY = "ruby-high:last-seen";
  const WELCOME_HALL_PASS_GRANT_ID = "system:welcome-hall-passes:v1";
  const WELCOME_HALL_PASS_POPUP_KEY_PREFIX = "rh_welcome_hall_passes_seen:";
  const ANNOUNCEMENTS_LAST_KEY = "ruby-high:announcements-last-date";
  const ANNOUNCEMENTS_LOGO_URL = apiBase + "/assets/logo.png?v=baby-blue-20260504";
  let announcementsOverlay = null;
  let morningAnnouncementsShown = false;

  const WELCOME_HALL_PASS_ART_URL = apiBase + "/assets/welcome-hall-passes.png";
  const PACK_NFT_ART_URL = apiBase + "/assets/nft/ruby-high-pack.png?v=pack-nft-v2";
  const PACK_OPENED_NFT_ART_URL = apiBase + "/assets/nft/ruby-high-pack-opened.png?v=opened-v2";
  const CARD_BACK_ART_URL = apiBase + "/assets/nft/ruby-high-card-back.png?v=card-back-v1";
  const ITEM_CARD_SHEET_URL = apiBase + "/assets/nft/ruby-high-item-cards.png";
  const LOCATION_CARD_SHEET_URL = apiBase + "/assets/nft/ruby-high-location-cards.png";
  const CARD_NFT_ART_VERSION = "card-crop-v1";
  const CARD_NFT_IMAGE_IDS = [
    "lyra", "sami", "ravi", "indra", "mika", "noor",
    "ruby", "sally-science", "professor-edward", "captain-null", "eliza", "rati",
    "item-hall-pass", "item-flashcards", "item-library-card", "item-lab-flask", "item-lunch-tray", "item-notebook",
    "location-homeroom", "location-science-lab", "location-library", "location-cafeteria", "location-greenhouse", "location-courtyard",
  ];
  // HALL_PASS_CARDS_PER_PACK is in VIEWER_CONSTANTS.
  const HALL_PASS_CARD_BURN_HALL_PASS_VALUE = 5;
  const PACK_MINT_STATUS_LINES = [
    "Checking the attendance ledger...",
    "Stamping the front-office receipt...",
    "Printing the Ruby High wrapper...",
    "Asking Solana for a hallway pass...",
    "Filing the pack in your locker...",
  ];
  const CARD_MINT_STATUS_LINES = [
    "Preparing the card mint...",
    "Checking the card metadata...",
    "Waiting for wallet approval...",
    "Submitting the signed mint...",
    "Revealing the card...",
  ];
  function authStorage(kind) {
    try { return kind === "local" ? window.localStorage : window.sessionStorage; } catch (e) { return null; }
  }
  function storageGet(kind, key) {
    try {
      const store = authStorage(kind);
      return store ? store.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }
  function storageSet(kind, key, value) {
    try {
      const store = authStorage(kind);
      if (store) store.setItem(key, value);
    } catch (e) {}
  }
  function storageRemove(kind, key) {
    try {
      const store = authStorage(kind);
      if (store) store.removeItem(key);
    } catch (e) {}
  }
  function persistentApiKeyStorageEnabled() {
    return storageGet("local", AUTH_PERSIST) === "1";
  }
  function migrateLegacyLocalAuthToSession() {
    if (persistentApiKeyStorageEnabled()) return;
    const key = storageGet("local", AUTH_KEY);
    if (!key) return;
    storageSet("session", AUTH_KEY, key);
    const label = storageGet("local", AUTH_LABEL);
    if (label) storageSet("session", AUTH_LABEL, label);
    const seenAt = storageGet("local", AUTH_AT);
    if (seenAt) storageSet("session", AUTH_AT, seenAt);
    storageRemove("local", AUTH_KEY);
    storageRemove("local", AUTH_LABEL);
    storageRemove("local", AUTH_AT);
  }
  function getStoredApiKey() {
    migrateLegacyLocalAuthToSession();
    return storageGet("session", AUTH_KEY) || (persistentApiKeyStorageEnabled() ? storageGet("local", AUTH_KEY) : null);
  }
  function getStoredAuthLabel() {
    migrateLegacyLocalAuthToSession();
    return storageGet("session", AUTH_LABEL) || (persistentApiKeyStorageEnabled() ? storageGet("local", AUTH_LABEL) : null);
  }
  function clearStoredAuth() {
    storageRemove("session", AUTH_KEY);
    storageRemove("session", AUTH_LABEL);
    storageRemove("session", AUTH_AT);
    storageRemove("local", AUTH_KEY);
    storageRemove("local", AUTH_LABEL);
    storageRemove("local", AUTH_AT);
  }
  function markLocalAppOpen() {
    try {
      const now = Date.now();
      const previous = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
      localStorage.setItem(LAST_SEEN_KEY, String(now));
      return previous > 0 && now - previous >= 6 * 60 * 60 * 1000;
    } catch (_err) {
      return false;
    }
  }
  const PRIVY_CLIENT_URL = apiBase + "/assets/privy-client.global.js?v=" + encodeURIComponent(buildId);
  const PRIVY_CLIENT_GLOBAL = "RubyHighPrivyClientModule";
  const COMMAND_TIMEOUT_MS = 15000;
  const STREAM_CONNECT_TIMEOUT_MS = 15000;
  const SESSION_REFRESH_TIMEOUT_MS = 8000;


  // ── AI students ──────────────────────────────────────────────────────────
  const STUDENTS = [
    { id: "lyra",  name: "Lyra",   color: "#ff6f91" },
    { id: "sami",  name: "Sami",   color: "#36c2cc" },
    { id: "ravi",  name: "Ravi",   color: "#ffb05a" },
    { id: "indra", name: "Indra",  color: "#a06bff" },
    { id: "mika",  name: "Mika",   color: "#52c673" },
    { id: "noor",  name: "Noor",   color: "#ec4f9e" },
  ];
  const STUDENT_LINES_RIGHT = [
    "okay wait, nice one.",
    "nah, that was clean.",
    "you actually cooked there.",
    "all right, first try is nasty.",
    "okay, smart kid energy.",
  ];
  const STUDENT_LINES_WRONG = [
    "ugh, that one was mean.",
    "nah, i was about to miss that too.",
    "okay, that question was rude.",
    "happens - next one.",
    "wait, i hated that one too.",
  ];
  const STUDENT_LINES_GREET = [
    "okay, what are we doing.",
    "all right, first bell energy.",
    "im here - dont make it weird.",
    "ready when you are.",
    "okay wait, im listening.",
  ];
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
    privyAction: $("privy-action"),
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
    blackboardEmptyAction: $("blackboard-empty-action"),
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
    signinPrivy: $("signin-privy"),
    signinStatus: $("signin-status"),
    privyOverlay: $("privy-overlay"),
    privyClose: $("privy-close"),
    privyWallet: $("privy-wallet"),
    privyLoginWidget: $("privy-login-widget"),
    privySignout: $("privy-signout"),
    privyStatus: $("privy-status"),
    accountWorkspace: document.querySelector(".account-workspace"),
    accountTabs: Array.from(document.querySelectorAll("[data-account-tab]")),
    accountPanels: Array.from(document.querySelectorAll("[data-account-panel]")),
    accountAiStatus: $("account-ai-status"),
    accountAiMeta: $("account-ai-meta"),
    accountAiUsePass: $("account-ai-use-pass"),
    accountAiAction: $("account-ai-action"),
    accountWalletBalance: $("account-wallet-balance"),
    accountWalletMeta: $("account-wallet-meta"),
    accountBuyPasses: $("account-buy-passes"),
    accountBuyCardPacks: $("account-buy-card-packs"),
    accountGetRuby: $("account-get-ruby"),
    accountMintCards: $("account-mint-cards"),
    accountCardSummary: $("account-card-summary"),
    accountHallPassCards: $("account-hall-pass-cards"),
    accountCharacterSummary: $("account-character-summary"),
    accountCharacterGrid: $("account-character-grid"),
    accountCreateCharacter: $("account-create-character"),
    accountUnlockSlot: $("account-unlock-slot"),
    accountComicSummary: $("account-comic-summary"),
    accountComics: $("account-comics"),
    accountHistoryList: $("account-history-list"),
    accountTrustList: $("account-trust-list"),
    checking: $("checking"),
    scrim: $("scrim"),
    congrats: $("congrats-toast"),
    billingOverlay: $("billing-overlay"),
    billingClose: $("billing-close"),
    billingTitle: $("billing-title"),
    billingSub: $("billing-sub"),
    billingWallet: $("billing-wallet"),
    billingCosts: $("billing-costs"),
    billingProducts: $("billing-products"),
    billingStatus: $("billing-status"),
    appConfirmOverlay: $("app-confirm-overlay"),
    appConfirmKicker: $("app-confirm-kicker"),
    appConfirmTitle: $("app-confirm-title"),
    appConfirmCopy: $("app-confirm-copy"),
    appConfirmDetail: $("app-confirm-detail"),
    appConfirmCancel: $("app-confirm-cancel"),
    appConfirmOk: $("app-confirm-ok"),
  };

  let activeConfirmDialog = null;
  function confirmInApp(options) {
    const overlay = els.appConfirmOverlay;
    const okBtn = els.appConfirmOk;
    const cancelBtn = els.appConfirmCancel;
    if (!overlay || !okBtn || !cancelBtn) return Promise.resolve(false);
    if (activeConfirmDialog && activeConfirmDialog.resolve) activeConfirmDialog.resolve(false);

    const title = options && options.title ? options.title : "Continue?";
    const copy = options && options.copy ? options.copy : "";
    const detail = options && options.detail ? options.detail : "";
    const kicker = options && options.kicker ? options.kicker : "Confirm";
    const confirmText = options && options.confirmText ? options.confirmText : "Continue";
    const cancelText = options && options.cancelText ? options.cancelText : "Cancel";
    const tone = options && options.tone ? options.tone : "";
    const previousFocus = document.activeElement && typeof document.activeElement.focus === "function"
      ? document.activeElement
      : null;

    if (els.appConfirmKicker) els.appConfirmKicker.textContent = kicker;
    if (els.appConfirmTitle) els.appConfirmTitle.textContent = title;
    if (els.appConfirmCopy) els.appConfirmCopy.textContent = copy;
    if (els.appConfirmDetail) {
      els.appConfirmDetail.textContent = detail;
      els.appConfirmDetail.hidden = !detail;
    }
    okBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    overlay.classList.toggle("is-danger", tone === "danger");
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.add("is-open");

    return new Promise((resolve) => {
      function cleanup(result) {
        overlay.classList.remove("is-open", "is-danger");
        overlay.setAttribute("aria-hidden", "true");
        overlay.hidden = true;
        overlay.removeEventListener("click", onOverlayClick);
        overlay.removeEventListener("keydown", onKeyDown);
        okBtn.removeEventListener("click", onConfirm);
        cancelBtn.removeEventListener("click", onCancel);
        activeConfirmDialog = null;
        if (previousFocus && previousFocus.isConnected) {
          try { previousFocus.focus({ preventScroll: true }); } catch (_err) { try { previousFocus.focus(); } catch (_focusErr) {} }
        }
        resolve(result);
      }
      function onConfirm() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onOverlayClick(event) {
        if (event.target === overlay) cleanup(false);
      }
      function onKeyDown(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          cleanup(false);
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = Array.from(overlay.querySelectorAll("button:not(:disabled), [href], input, textarea, select, [tabindex]:not([tabindex='-1'])"));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      activeConfirmDialog = { resolve: cleanup };
      overlay.addEventListener("click", onOverlayClick);
      overlay.addEventListener("keydown", onKeyDown);
      okBtn.addEventListener("click", onConfirm);
      cancelBtn.addEventListener("click", onCancel);
      const focusTarget = options && options.focus === "confirm" ? okBtn : cancelBtn;
      setTimeout(() => { try { focusTarget.focus({ preventScroll: true }); } catch (_err) { focusTarget.focus(); } }, 0);
    });
  }

  // ── view state ────────────────────────────────────────────────────────────
  let lastTelemetry = null;
  let lastRosterSig = "";
  let lastRevealId = null;
  let lastAnswerGradedTriggerId = null;
  let lastIdleTriggerId = null;
  const guestSpotlightSeenKeys = new Set();
  let showWelcomeBackCopy = false;
  let firstRunCreationOpened = false;
  let lastPostClassToastShown = false;
  let authed = null; // app-owned Ruby High session ready
  let aiEnabled = false; // Browser/local/hosted text AI + Ruby High session present
  let localAiEnabled = false;
  let hostedAiActive = false;
  let privyClient = null;
  let privyClientPromise = null;
  let privyRefreshPromise = null;
  let lastPrivyRefreshAt = 0;
  let lastPrivyRateLimitedAt = 0;
  const PRIVY_REFRESH_MIN_INTERVAL_MS = 60 * 1000;
  const PRIVY_RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
  let privyState = {
    configured: !!privyConfig,
    authenticated: false,
    ready: !privyConfig,
    walletAddress: null,
    walletChainType: null,
    solanaWalletAddress: null,
    solanaAccountAddress: null,
    label: null,
  };
  function activeTeacherUsesServerAi() {
    const provider = lastTelemetry && lastTelemetry.active_teacher_provider;
    return !!(provider && provider.requiresBrowserKey === false);
  }
  function teacherChatEnabled() {
    return !!authed && (aiEnabled || activeTeacherUsesServerAi());
  }
  function openRouterAiEnabled() {
    return !!authed && (!!getStoredApiKey() || (!!aiEnabled && !localAiEnabled && hostedAiActive));
  }
  function openRouterGenerationMessage(action) {
    return "Connect AI before " + action + ".";
  }
  let lockedFor = null;
  let renderedHistorySig = null;
  let activeQuestionId = null; // currently displayed question id on the blackboard
  let questionCounter = 0;     // session-local question count for "Question N" label
  let lastShownGrade = null;
  let dismissedClassReportKey = null;
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
  let billingMode = "hall-passes";
  let billingBusy = false;
  let selectedBillingProductId = null;
  let activeAccountPane = "account";
  let accountHallPassCardsRenderSig = "";
  let packSyncBusy = false;
  let packSyncWalletAddress = "";
  let packSyncAt = 0;
  let packMintProgressEl = null;
  let packMintProgressTitleEl = null;
  let packMintProgressStatusEl = null;
  let packMintProgressTimer = null;
  let packMintProgressCloseTimer = null;
  let packMintProgressIndex = 0;
  let chatViewSeq = 0;         // bumps on room/lounges switches; invalidates stale history/SSE work
  function setNextButtonDisabled(disabled) {
    if (els.nextBtn) els.nextBtn.disabled = !!disabled;
  }
  function setChatComposerDisabled(disabled) {
    els.chatInput.disabled = !!disabled;
    els.chatSend.disabled = !!disabled;
  }
  function ensurePackMintProgressOverlay() {
    if (packMintProgressEl && document.body.contains(packMintProgressEl)) return packMintProgressEl;
    const overlay = document.createElement("div");
    overlay.className = "pack-mint-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-hidden", "true");

    const panel = document.createElement("div");
    panel.className = "pack-mint-panel";
    const spinner = document.createElement("div");
    spinner.className = "pack-mint-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    copy.className = "pack-mint-copy";
    const title = document.createElement("div");
    title.className = "pack-mint-title";
    title.textContent = "Please wait: minting pack";
    const status = document.createElement("div");
    status.className = "pack-mint-status";
    status.setAttribute("aria-live", "polite");
    status.textContent = PACK_MINT_STATUS_LINES[0];
    copy.appendChild(title);
    copy.appendChild(status);
    panel.appendChild(spinner);
    panel.appendChild(copy);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    packMintProgressEl = overlay;
    packMintProgressTitleEl = title;
    packMintProgressStatusEl = status;
    return overlay;
  }
  function updatePackMintProgress(message) {
    if (!packMintProgressStatusEl) return;
    const text = String(message || "").trim();
    if (text) packMintProgressStatusEl.textContent = text;
  }
  function showPackMintProgress(message, options) {
    const overlay = ensurePackMintProgressOverlay();
    if (packMintProgressCloseTimer) {
      clearTimeout(packMintProgressCloseTimer);
      packMintProgressCloseTimer = null;
    }
    const title = options && options.title ? String(options.title) : "Please wait: minting pack";
    const rotate = !options || options.rotate !== false;
    const lines = options && Array.isArray(options.lines) && options.lines.length > 0
      ? options.lines
      : PACK_MINT_STATUS_LINES;
    if (packMintProgressTitleEl) packMintProgressTitleEl.textContent = title;
    packMintProgressIndex = 0;
    updatePackMintProgress(message || lines[0]);
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    if (packMintProgressTimer) clearInterval(packMintProgressTimer);
    packMintProgressTimer = null;
    if (rotate) {
      packMintProgressTimer = setInterval(() => {
        packMintProgressIndex = (packMintProgressIndex + 1) % lines.length;
        updatePackMintProgress(lines[packMintProgressIndex]);
      }, 1600);
    }
  }
  function hidePackMintProgress(delayMs) {
    const close = () => {
      if (packMintProgressTimer) {
        clearInterval(packMintProgressTimer);
        packMintProgressTimer = null;
      }
      if (!packMintProgressEl) return;
      packMintProgressEl.classList.remove("is-open");
      packMintProgressEl.setAttribute("aria-hidden", "true");
    };
    if (packMintProgressCloseTimer) clearTimeout(packMintProgressCloseTimer);
    const delay = Math.max(0, Math.floor(Number(delayMs || 0)));
    if (delay > 0) {
      packMintProgressCloseTimer = setTimeout(() => {
        packMintProgressCloseTimer = null;
        close();
      }, delay);
      return;
    }
    packMintProgressCloseTimer = null;
    close();
  }
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
    return secondarySurfacesUnlocked(t);
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
  let returnToAccountAfterSheet = false;

  // Track scroll-to-bottom intent: only auto-scroll if user is near bottom.
  // The player's display name in chat + race UI. Falls back to "You" only
  // while the player is still creating their first character.
  function playerDisplayName() {
    const fullName = lastTelemetry && lastTelemetry.character && lastTelemetry.character.name;
    if (!fullName) return "You";
    const first = String(fullName).trim().split(/\s+/)[0];
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
  // clipPlayerContext is in client-pure.
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
  function playerChatIntentForServer(intent) {
    if (intent === "hint") return "hint";
    if (intent === "report") return "report";
    if (intent === "class") return "advance";
    if (intent === "lounge") return "lounge";
    return "player-chat";
  }
  async function runPlayerChatTurn(intent, extraContext) {
    const manualTurn = turnController.beginManual();
    if (!manualTurn) return;
    try {
      if (!teacherChatEnabled()) {
        const playerLine = playerChatLine(intent);
        appendMsg({ kind: "you", name: playerDisplayName(), body: playerLine, color: "var(--accent)" });
        appendSystem(intent === "hint" ? "Answer the board to continue. Connect AI for teacher hints." : "Connect AI for teacher replies.");
        return;
      }
      const targetFaculty = (lastTelemetry && lastTelemetry.faculty) || "ruby";
      const streamGuard = turnController.nextStreamGuard(targetFaculty);
      const context = Object.assign({}, extraContext || {}, {
        grade: lastTelemetry && lastTelemetry.current_grade,
        intent: playerChatIntentForServer(intent),
      });
      const r = await apiFetch("/api/apps/ruby-high/chat/room-turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: STREAM_CONNECT_TIMEOUT_MS,
        body: JSON.stringify({ faculty: targetFaculty, context, clientTurnSeq: streamGuard.streamSeq }),
      });
      await consumeSseStream(r, streamGuard);
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
  async function promptGuestSignup(message) {
    setAccountPane("account");
    await openPrivyAccount();
    setPrivyStatus(message || guestSignupMessage(lastTelemetry), false);
  }

  // ── API helper ────────────────────────────────────────────────────────────
  const apiClient = createViewerApiClient({
    sessionUrl,
    commandUrl,
    commandTimeoutMs: COMMAND_TIMEOUT_MS,
    sessionRefreshTimeoutMs: SESSION_REFRESH_TIMEOUT_MS,
    getApiKey: getStoredApiKey,
    getVisitorId,
    clearAuth: clearStoredAuth,
    onAuthCleared() {
      try { deriveAuth(); } catch (_e) { /* deriveAuth not yet defined on boot */ }
    },
    onCommandSession(session) {
      render(session);
    },
    onCommandError(message) {
      if (guestSignupRequired(lastTelemetry) || /guest lesson complete|sign up to continue/i.test(String(message || ""))) {
        void promptGuestSignup(message);
        return;
      }
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

  function postViewerMetricEvent(type, payload) {
    const body = Object.assign({ type: type }, payload || {});
    apiFetch(metricsEventUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      timeoutMs: 2500,
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  // imageRequestId is in client-pure.

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
    if (/^data:image\//i.test(raw) || (raw.startsWith("/") && !raw.startsWith("//"))) return true;
    if (!/^https?:\/\//i.test(raw)) return false;
    try {
      const url = new URL(raw);
      return !/\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(url.hostname);
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
  function teacherSmallAvatarUrl(facultyOrId) {
    return teacherPortraitUrl(facultyOrId, "face");
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
    if (kind === "teacher" && facultyId) avatarImgSrc = teacherSmallAvatarUrl(facultyId);
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
    bodyEl.dataset.markdownRaw = sanitizeVisibleChatText(body || "");
    renderMarkdownInto(bodyEl, bodyEl.dataset.markdownRaw);
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
  // escape, escapeHtml, safeMarkdownHref, sanitizeVisibleChatText,
  // markdownInlineHtml, appendMarkdownInline, renderMarkdownInto are
  // in client-pure.ts.

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
  function ensureBlackboardEmptyExtras() {
    let extras = els.blackboardEmpty.querySelector(".blackboard-empty-extras");
    if (!extras) {
      extras = document.createElement("div");
      extras.className = "blackboard-empty-extras";
      els.blackboardEmpty.appendChild(extras);
    }
    return extras;
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
    const correctSummary = todayCorrectSummary(today);
    addMetric("correct", correctSummary.value, correctSummary.detail);
    addMetric("score", formatClassScore(today.score), "grade score");
    wrap.appendChild(metrics);
    return wrap;
  }
  function buildClassReportNextStep() {
    const state = postClassState(lastTelemetry);
    const signupRequired = guestSignupRequired(lastTelemetry);
    const wrap = document.createElement("div");
    wrap.className = "class-report-next" + (signupRequired ? " is-signup" : state.socialReady ? " is-social" : state.practiceReady ? " is-practice" : "");
    const mark = document.createElement("span");
    mark.className = "class-report-next-mark";
    wrap.appendChild(mark);
    const copy = document.createElement("div");
    copy.className = "class-report-next-copy";
    const title = document.createElement("div");
    title.className = "class-report-next-title";
    const body = document.createElement("div");
    body.className = "class-report-next-body";
    if (signupRequired) {
      title.textContent = "Sign up to continue";
      body.textContent = "Your guest lesson is complete. Keep your student and unlock the rest of Ruby High.";
    } else if (state.socialReady) {
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
      els.arcStreak.textContent = "🎓";
      els.arcStreak.classList.remove("is-met");
      els.arcXp.textContent = "✅";
      els.arcXp.classList.remove("is-met");
      els.arcScore.textContent = walletSummaryText(t);
      return;
    }
    const yearLabel = GRADE_LABELS[grade] || ("Grade " + grade);
    els.arcYear.textContent = yearLabel;
    const streakCount = ch.streak && ch.streak.grade === grade ? ch.streak.count : 0;
    const streakReq   = STREAK_REQUIRED[grade] || 1;
    els.arcStreak.textContent = "📚 " + streakCount + "/" + streakReq;
    els.arcStreak.classList.toggle("is-met", streakCount >= streakReq);
    const subjects = subjectClearSummary();
    els.arcXp.textContent = "✅ " + subjects.met + "/" + subjects.total;
    els.arcXp.classList.toggle("is-met", subjects.met >= subjects.total);
    els.arcScore.textContent = walletSummaryText(t);
  }

  function walletSummaryText(t) {
    const wallet = walletNumbers(t);
    return "⭐ " + formatWholeNumber(wallet.meritStars) + " · 🎫 " + formatWholeNumber(wallet.hallPasses);
  }

  function walletCardCount(t) {
    return mintedCardCount(t);
  }

  function walletPackCount(t) {
    return hallPassPacksForTelemetry(t).filter((pack) => pack.status === "active").length;
  }

  function mintedCardCount(t) {
    return hallPassCardsForTelemetry(t).filter((card) => card.status === "active" && card.mintAddress && card.mintSignature).length;
  }

  function canSpendHallPasses(cost, t) {
    return walletNumbers(t || lastTelemetry).hallPasses >= positiveWholeNumber(cost, 1);
  }

  function hallPassBurnCardsRequired(hallPassCost) {
    return Math.max(1, Math.ceil(positiveWholeNumber(hallPassCost, 1) / HALL_PASS_CARD_BURN_HALL_PASS_VALUE));
  }

  function hallPassBurnCreditForCards(cardCount) {
    return Math.max(1, positiveWholeNumber(cardCount, 1)) * HALL_PASS_CARD_BURN_HALL_PASS_VALUE;
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

  function hostedEntitlements(t) {
    const src = t || lastTelemetry;
    return src && src.entitlements && typeof src.entitlements === "object" ? src.entitlements : null;
  }

  function hostedImageEntitlement(kind, t) {
    const entitlements = hostedEntitlements(t);
    const images = entitlements && entitlements.hosted_images && typeof entitlements.hosted_images === "object"
      ? entitlements.hosted_images
      : null;
    return images && images[kind] && typeof images[kind] === "object" ? images[kind] : null;
  }

  function usingHostedImageGeneration(kind) {
    const image = hostedImageEntitlement(kind);
    return !!authed && !getStoredApiKey() && !!(image && image.configured) && canSpendHallPasses(image.cost || 1);
  }

  function hostedImageCostLabel(kind) {
    const entitlement = hostedImageEntitlement(kind);
    const costs = billingProductsCache && billingProductsCache.imageCosts ? billingProductsCache.imageCosts : {};
    const raw = entitlement && entitlement.cost != null ? entitlement.cost : costs && costs[kind];
    const cost = Math.max(1, Math.round(Number(raw || 1)));
    return formatWholeNumber(cost) + " Hall Pass" + (cost === 1 ? "" : "es");
  }

  // positiveWholeNumber, hallPassCostLabel, walletPreviewAddress,
  // walletPreviewLine are in client-pure.

  function confirmWalletTransactionPreview(opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    const walletAddress = options.walletAddress || knownSolanaOwnerWalletAddress() || connectedSolanaWalletAddress();
    const lines = [
      walletPreviewLine("Action", options.action),
      walletPreviewLine("Wallet", walletPreviewAddress(walletAddress)),
      options.cost ? walletPreviewLine("Cost", options.cost) : "",
      options.credit ? walletPreviewLine("Credit", options.credit) : "",
      options.pack ? walletPreviewLine("Pack", options.pack) : "",
      options.card ? walletPreviewLine("Card", options.card) : "",
      options.recipient ? walletPreviewLine("Recipient", walletPreviewAddress(options.recipient)) : "",
      options.mint ? walletPreviewLine("Token", walletPreviewAddress(options.mint)) : "",
      options.reference ? walletPreviewLine("Reference", walletPreviewAddress(options.reference)) : "",
      walletPreviewLine("Wallet prompt", options.prompt || "Review the wallet prompt before signing."),
      "Ruby High never asks for a seed phrase.",
    ].filter(Boolean);
    return confirmInApp({
      kicker: "Wallet preview",
      title: options.title || "Open wallet?",
      copy: options.copy || "Review this action before Ruby High opens your wallet.",
      detail: lines.join("\n"),
      confirmText: options.confirmText || "Open wallet",
      cancelText: options.cancelText || "Cancel",
      tone: options.tone || "",
      focus: options.focus || "",
    });
  }

  function cardPackProductLabel(product) {
    if (!product) return "Ruby High Pack";
    return product.name || packCountLabel(product.packCount);
  }

  function responseErrorText(data) {
    return data && typeof data === "object" && data.error != null
      ? String(data.error).trim()
      : "";
  }

  function nftHttpErrorMessage(action, response, data, unchanged) {
    const serverMessage = responseErrorText(data);
    if (serverMessage) return serverMessage;
    const status = Number(response && response.status);
    const safeState = unchanged || "Try again in a minute.";
    if (status === 401) return "Sign in again before continuing.";
    if (status === 402) return action + " needs a funded wallet before it can continue.";
    if (status === 404) return action + " could not find that card or pack. Refresh Ruby High and try again.";
    if (status === 502 || status === 503 || status === 504) {
      return action + " is temporarily unavailable. " + safeState;
    }
    return action + (status ? " failed (" + status + "). " : " failed. ") + safeState;
  }

  function friendlySolanaActionError(err, unchanged) {
    const message = err && err.message ? String(err.message) : String(err || "error");
    if (/user rejected|rejected|canceled|cancelled/i.test(message)) return "Wallet request canceled.";
    if (/Need\s+[\d,.]+\s+RUBY|needs?\s+[\d,.]+\s+RUBY|not enough\s+RUBY/i.test(message)) {
      return message.replace(/^Card pack checkout\s*·\s*/i, "") + " Get $RUBY in the connected wallet, then try again.";
    }
    if (/needs more SOL|insufficient funds|insufficient lamports|Attempt to debit|0x1\b|needs at least|balance is .*needs/i.test(message)) {
      return "This mint needs more SOL for Solana rent and fees. Your card was not changed.";
    }
    if (/403|forbidden|Helius|RPC rejected/i.test(message)) {
      return "Ruby High's Solana RPC rejected the request. We need to refresh the RPC key; your NFT was not changed.";
    }
    if (/429|too many requests|rate.?limit/i.test(message)) {
      return "Privy is rate limiting wallet requests. Wait a minute, then try again.";
    }
    if (/not found yet|not found on-chain|confirmation/i.test(message)) {
      return "Solana has not indexed the transaction yet. Wait a few seconds and try again.";
    }
    if (/502|503|504|bad gateway|temporar|rpc|blockhash|preflight|simulation|timed out|timeout|failed to fetch|network/i.test(message)) {
      return "Ruby High could not reach Solana reliably. " + (unchanged || "Try again in a minute.");
    }
    return message || "error";
  }

  function isRetryableSolanaMintConfirm(status, message) {
    if ([425, 429, 500, 502, 503, 504].includes(Number(status || 0))) return true;
    return /not found yet|not found on-chain|confirmation|rpc|temporar|timed out|timeout|failed to fetch|network|blockhash|preflight|simulation|rate.?limit/i.test(String(message || ""));
  }

  function withWalletActionTimeout(promise, message) {
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error(message)), WALLET_ACTION_TIMEOUT_MS);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timeoutId) window.clearTimeout(timeoutId);
    });
  }

  function creatorPricing(t) {
    const entitlements = hostedEntitlements(t);
    const creator = entitlements && entitlements.creator && typeof entitlements.creator === "object"
      ? entitlements.creator
      : {};
    const products = billingProductsCache || {};
    return {
      courseSlotCost: positiveWholeNumber(creator.courseSlotCost ?? products.courseSlotCost, 3),
      questionGenerationCost: positiveWholeNumber(creator.questionGenerationCost ?? products.questionGenerationCost, 1),
      moreQuestionsCount: positiveWholeNumber(creator.moreQuestionsCount ?? products.moreQuestionsCount, 6),
    };
  }

  async function ensureBillingProductsForCreditWarning() {
    if (billingProductsCache && billingProductsCache.imageCosts) return billingProductsCache;
    try {
      const r = await apiFetch(apiBase + "/billing/products", { timeoutMs: 8000 });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data && data.ok) billingProductsCache = data;
    } catch (_err) {
      // The server still enforces the true price; the warning falls back to
      // the default one-pass portrait price if the product list is unavailable.
    }
    return billingProductsCache;
  }

  async function confirmHostedCreditSpend(action, kind, usePhotoDayCredit) {
    const entitlement = hostedImageEntitlement(kind);
    const hostedConfigured = !!authed && !getStoredApiKey() && !!(entitlement && entitlement.configured);
    if (!hostedConfigured && !usePhotoDayCredit) return true;
    await ensureBillingProductsForCreditWarning();
    const refreshedEntitlement = hostedImageEntitlement(kind);
    const cost = Math.max(1, Math.floor(Number(refreshedEntitlement && refreshedEntitlement.cost || entitlement && entitlement.cost || 1)));
    const usesHallPass = !usePhotoDayCredit && canSpendHallPasses(cost);
    if (!usePhotoDayCredit && !usesHallPass) {
      await promptForHallPasses({
        title: "No Hall Passes yet",
        copy: action + " needs " + hallPassCostLabel(cost) + ". Buy Hall Passes or burn a Card first.",
        detail: "Class questions and default character art still work for free.",
      });
      return false;
    }
    const spendLabel = usePhotoDayCredit ? "1 Photo Day credit" : hallPassCostLabel(cost);
    const spendKind = usePhotoDayCredit ? "photo-day credit" : "Hall Pass";
    const isCharacterPortrait = action === "Custom character portrait";
    const detail = isCharacterPortrait
      ? "Keep editing while it runs. “Lock it in” unlocks once the request finishes."
      : "Keep editing while it runs. Save and Close unlock once it finishes or you cancel.";
    const confirmText = isCharacterPortrait ? "Generate portrait" : "Generate image";
    if (usePhotoDayCredit) {
      return confirmInApp({
        kicker: "Hosted image",
        title: action + "?",
        copy: "If the image completes, Ruby High will spend " + spendLabel + ".",
        detail,
        confirmText,
        focus: "confirm",
      });
    }
    return confirmInApp({
      kicker: spendKind,
      title: action + "?",
      copy: "If the image completes, Ruby High will spend " + spendLabel + ".",
      detail,
      confirmText,
      focus: "confirm",
    });
  }

  async function promptForHallPasses(opts) {
    const open = await confirmInApp({
      kicker: "Hall Passes",
      title: opts && opts.title ? opts.title : "No Hall Passes yet",
      copy: opts && opts.copy ? opts.copy : "Hosted AI needs Hall Passes. Buy Hall Passes or burn a Card first.",
      detail: opts && opts.detail ? opts.detail : "The classroom loop still works without hosted AI.",
      confirmText: "Open Hall Passes",
      cancelText: "Keep playing",
      focus: "confirm",
    });
    if (open) {
      if (authed) {
        openBilling({ mode: "hall-passes" });
      } else {
        setAccountPane("wallet");
        void openPrivyAccount();
      }
    }
    return open;
  }

  function teacherImageGenerationStatusReason() {
    if (!authed) return "Sign in before generating teacher images.";
    if (getStoredApiKey()) return "";
    const entitlement = hostedImageEntitlement("portrait");
    if (entitlement && entitlement.configured) {
      return "";
    }
    return openRouterGenerationMessage("generating teacher images");
  }

  function teacherImageCreditHint() {
    const reason = teacherImageGenerationStatusReason();
    if (reason) return reason;
    const entitlement = hostedImageEntitlement("portrait") || {};
    const cost = entitlement.cost || 1;
    if (!getStoredApiKey()) return canSpendHallPasses(cost)
      ? "Hosted image generation spends a Hall Pass when it completes."
      : "No Hall Passes yet. Buy Hall Passes or burn a Card first.";
    return "Uses your AI key. No cards are burned.";
  }

  function applyHallPassBalance(hallPasses, entitlements, characterSlots) {
    if (typeof hallPasses !== "number" || !Number.isFinite(hallPasses)) return;
    if (!lastTelemetry) return;
    const wallet = lastTelemetry.wallet && typeof lastTelemetry.wallet === "object" ? lastTelemetry.wallet : {};
    const currentSlots = lastTelemetry.character_slots && typeof lastTelemetry.character_slots === "object"
      ? lastTelemetry.character_slots
      : {};
    lastTelemetry = {
      ...lastTelemetry,
      wallet: {
        ...wallet,
        hallPasses: Math.max(0, Math.round(hallPasses)),
      },
      ...(characterSlots && typeof characterSlots === "object" ? {
        character_slots: {
          ...currentSlots,
          ...characterSlots,
        },
      } : {}),
      ...(entitlements && typeof entitlements === "object" ? {
        entitlements,
        hosted_ai: entitlements.hosted_ai || lastTelemetry.hosted_ai,
      } : {}),
    };
    if (els.arcScore) els.arcScore.textContent = walletSummaryText(lastTelemetry);
    syncBillingWallet(lastTelemetry);
    renderAccountPage();
  }

  function syncBillingWallet(t) {
    if (!els.billingWallet) return;
    const cardCount = walletCardCount(t || lastTelemetry);
    const packCount = walletPackCount(t || lastTelemetry);
    const hallPasses = walletNumbers(t || lastTelemetry).hallPasses;
    const ai = hostedAiTelemetry(t || lastTelemetry);
    els.billingWallet.textContent = formatWholeNumber(hallPasses) + " Hall Pass" + (hallPasses === 1 ? "" : "es")
      + " · " + formatWholeNumber(packCount) + " Pack" + (packCount === 1 ? "" : "s")
      + " · " + formatWholeNumber(cardCount) + " Card" + (cardCount === 1 ? "" : "s")
      + (ai.active ? " · AI active " + formatRelativeExpiry(ai.expiresAt) : "");
    renderAccountWallet();
  }

  function setBillingStatus(text, invalid) {
    if (!els.billingStatus) return;
    els.billingStatus.textContent = text || "";
    els.billingStatus.classList.toggle("is-invalid", !!invalid);
  }

  // formatTokenDisplayAmount, cardPackTokenSymbol, cardPackDebitLabel,
  // cardPackCreditLabel, cardPackPaymentDeltaLabel, cardPackProductMeta,
  // formatMoney, formatTokenAmount are in client-pure.ts.
  function currentRubyTokenMintFromSolana(solana) {
    if (!solana || typeof solana !== "object") return "";
    const mint = typeof solana.mint === "string" ? solana.mint.trim() : "";
    return mint || "";
  }

  function cardPackCheckoutState() {
    const solana = billingProductsCache && billingProductsCache.solana && typeof billingProductsCache.solana === "object"
      ? billingProductsCache.solana
      : null;
    if (!solana) return { loaded: false, ready: true, reason: "" };
    if (!solana.configured) return { loaded: true, ready: false, reason: "Card pack checkout is not configured on this server." };
    const mint = currentRubyTokenMintFromSolana(solana);
    if (!mint) return { loaded: true, ready: false, reason: "RUBY mint configuration is missing." };
    return { loaded: true, ready: true, reason: "" };
  }

  function currentRubyTokenMint() {
    const solana = billingProductsCache && billingProductsCache.solana && typeof billingProductsCache.solana === "object"
      ? billingProductsCache.solana
      : null;
    const mint = solana && typeof solana.mint === "string" ? solana.mint.trim() : "";
    return mint || DEFAULT_RUBY_TOKEN_MINT;
  }

  function rubyTokenSwapLink() {
    return JUPITER_SOL_TO_RUBY_SWAP_PREFIX + encodeURIComponent(currentRubyTokenMint());
  }

  function configureGetRubyLink(link) {
    if (!link) return;
    link.href = rubyTokenSwapLink();
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Get $RUBY";
    link.title = "Get $RUBY on Jupiter before buying Ruby High card packs.";
  }

  function buildGetRubyLink(className) {
    const link = document.createElement("a");
    link.className = className || "get-ruby-link";
    configureGetRubyLink(link);
    return link;
  }

  function hostedAiTelemetry(t) {
    const entitlements = hostedEntitlements(t);
    const ai = entitlements && entitlements.hosted_ai && typeof entitlements.hosted_ai === "object"
      ? entitlements.hosted_ai
      : t && t.hosted_ai && typeof t.hosted_ai === "object" ? t.hosted_ai : null;
    const expiresAt = ai && ai.expiresAt != null ? Number(ai.expiresAt) : 0;
    const cost = ai && ai.cost != null ? Number(ai.cost) : 1;
    const durationMs = ai && ai.durationMs != null ? Number(ai.durationMs) : 604_800_000;
    return {
      active: !!(ai && ai.active && expiresAt > Date.now()),
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
      configured: !!(ai && ai.configured),
      affordable: !!(ai && ai.affordable),
      canActivate: !!(ai && ai.canActivate),
      cost: Number.isFinite(cost) && cost > 0 ? Math.floor(cost) : 1,
      durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.floor(durationMs) : 604_800_000,
    };
  }

  function syncAiStateFromTelemetry(t) {
    const ai = hostedAiTelemetry(t);
    hostedAiActive = !!ai.active;
    if (authed && !getStoredApiKey() && !localAiEnabled) {
      aiEnabled = hostedAiActive;
    }
  }

  // formatDuration, formatRelativeExpiry are in client-pure.ts.

  function normalizeAccountPane(pane) {
    const value = String(pane || "account");
    return ["account", "wallet", "cards", "library", "receipts", "trust"].includes(value) ? value : "account";
  }

  function setAccountPane(pane) {
    const next = normalizeAccountPane(pane);
    const changed = activeAccountPane !== next;
    activeAccountPane = next;
    renderAccountPaneState();
    if (changed && els.accountWorkspace) els.accountWorkspace.scrollTop = 0;
    if (activeAccountPane === "trust") void loadAccountTrustConfig();
  }

  function renderAccountPaneState() {
    const active = normalizeAccountPane(activeAccountPane);
    if (Array.isArray(els.accountTabs)) {
      els.accountTabs.forEach((tab) => {
        const selected = tab && tab.getAttribute("data-account-tab") === active;
        tab.classList.toggle("is-active", !!selected);
        tab.setAttribute("aria-selected", selected ? "true" : "false");
        tab.tabIndex = selected ? 0 : -1;
      });
    }
    if (Array.isArray(els.accountPanels)) {
      els.accountPanels.forEach((panel) => {
        const selected = panel && panel.getAttribute("data-account-panel") === active;
        panel.classList.toggle("is-active", !!selected);
        panel.hidden = !selected;
      });
    }
  }

  function renderAccountPage() {
    renderAccountPaneState();
    renderAccountAi();
    renderAccountWallet();
    renderAccountHallPassCards();
    renderAccountCharacters();
    renderAccountComics();
    renderAccountHistory();
    renderAccountTrust();
  }

  async function syncWalletPackNftsFromAccount(opts) {
    const ownerWalletAddress = knownSolanaOwnerWalletAddress();
    const force = !!(opts && opts.force);
    const quiet = !!(opts && opts.quiet);
    if (!authed || !ownerWalletAddress || packSyncBusy) return;
    const now = Date.now();
    if (!force && packSyncWalletAddress === ownerWalletAddress && now - packSyncAt < 60000) return;
    packSyncBusy = true;
    packSyncWalletAddress = ownerWalletAddress;
    packSyncAt = now;
    if (!quiet && els.accountCardSummary) els.accountCardSummary.textContent = "Checking wallet for pack NFTs...";
    try {
      const r = await apiFetch(apiBase + "/nft/sync-packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 30000,
        body: JSON.stringify({ ownerWalletAddress }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data || !data.ok) throw new Error(nftHttpErrorMessage("Pack sync", r, data, "Your packs were not changed; try again in a minute."));
      const importedCount = Math.max(0, Math.floor(Number(data.importedCount || 0)));
      const removedCount = Math.max(0, Math.floor(Number(data.removedCount || 0)));
      const restoredCount = Math.max(0, Math.floor(Number(data.restoredCount || 0)));
      if (importedCount > 0 || removedCount > 0 || restoredCount > 0) {
        if (!quiet) {
          const pieces = [];
          if (importedCount > 0) pieces.push("imported " + formatWholeNumber(importedCount));
          if (restoredCount > 0) pieces.push("restored " + formatWholeNumber(restoredCount));
          if (removedCount > 0) pieces.push("removed " + formatWholeNumber(removedCount));
          setPrivyStatus("Wallet pack sync " + pieces.join(", ") + " pack NFT" + (importedCount + removedCount + restoredCount === 1 ? "" : "s") + ".", false);
        }
        await fetchSession();
        renderAccountPage();
      } else if (force) {
        renderAccountHallPassCards();
      }
    } catch (err) {
      if (!quiet) setPrivyStatus("Pack sync failed · " + friendlySolanaActionError(err, "Your packs were not changed; try again in a minute."), true);
      renderAccountHallPassCards();
    } finally {
      packSyncBusy = false;
    }
  }

  function renderAccountAi() {
    if (!els.accountAiStatus || !els.accountAiUsePass || !els.accountAiAction) return;
    const ai = hostedAiTelemetry(lastTelemetry);
    const hasBrowserKey = !!getStoredApiKey();
    const durationLabel = formatDuration(ai.durationMs || 604_800_000);
    const cost = positiveWholeNumber(ai.cost || 1, 1);
    const costLabel = hallPassCostLabel(cost);
    const canUseHallPass = canSpendHallPasses(cost);
    let status = "Offline mode";
    let meta = "Spend " + costLabel + " for " + durationLabel + " of hosted AI, or connect your own AI key.";
    let primaryLabel = "Use Hall Pass";
    let primaryTitle = canUseHallPass
      ? "Spend " + costLabel + " for " + durationLabel + " of AI access."
      : "Need " + costLabel + ". Buy Hall Passes or burn a Card first.";
    let primaryDisabled = !authed || billingBusy || localAiEnabled || ai.active || !ai.configured || !canUseHallPass;
    let secondaryLabel = hasBrowserKey && aiEnabled ? "Disconnect" : "Connect AI key";
    let secondaryDisabled = !authed || localAiEnabled;
    if (localAiEnabled) {
      status = "Local AI active";
      meta = "This device is already providing text AI.";
      primaryLabel = "Local AI";
      primaryTitle = "";
      secondaryLabel = "Connect AI key";
    } else if (hasBrowserKey && aiEnabled) {
      status = "AI key connected";
      meta = "Teacher chat and character text rerolls use your browser key. Hall Passes are still available for hosted play.";
    } else if (ai.active || hostedAiActive) {
      status = "AI Access active";
      meta = "Hosted AI remains active for " + (formatRelativeExpiry(ai.expiresAt) || "this session") + ".";
      primaryLabel = "Active";
      primaryTitle = "";
    } else if (activeTeacherUsesServerAi()) {
      status = "Teacher AI connected";
      meta = "This server can speak for teachers. Use a Hall Pass or connect your own AI key for browser-owned AI features.";
    } else if (!ai.configured) {
      meta = "Hosted AI is not configured on this server. Connect your own AI key.";
      primaryTitle = "Hosted AI is not configured on this server.";
    }
    els.accountAiStatus.textContent = status;
    if (els.accountAiMeta) els.accountAiMeta.textContent = meta;
    els.accountAiUsePass.textContent = primaryLabel;
    els.accountAiUsePass.title = primaryTitle;
    els.accountAiUsePass.disabled = primaryDisabled;
    els.accountAiAction.textContent = secondaryLabel;
    els.accountAiAction.disabled = secondaryDisabled;
  }

  function renderAccountWallet() {
    if (!els.accountWalletBalance) return;
    const slots = characterSlotTelemetry();
    els.accountWalletBalance.textContent = walletSummaryText(lastTelemetry || {});
    if (els.accountBuyPasses) {
      els.accountBuyPasses.disabled = !authed || billingBusy;
      els.accountBuyPasses.textContent = billingBusy && billingMode === "hall-passes" ? "Loading..." : "Buy Hall Passes";
      els.accountBuyPasses.title = "Buy Hall Passes for hosted AI, creator slots, and image generation.";
    }
    if (els.accountWalletMeta) {
      els.accountWalletMeta.textContent = slots.photoDayCredits > 0
        ? slots.photoDayCredits + " Photo Day " + (slots.photoDayCredits === 1 ? "credit" : "credits")
        : "Use Hall Passes for AI, images, and slots. Buy more or burn a Card on the Buy Hall Passes page.";
    }
  }

  let accountTrustLoadInFlight = false;
  async function loadAccountTrustConfig() {
    if (accountTrustLoadInFlight || (billingProductsCache && billingProductsCache.nfts)) return;
    accountTrustLoadInFlight = true;
    try {
      await ensureBillingProductsForCreditWarning();
    } finally {
      accountTrustLoadInFlight = false;
      renderAccountTrust();
    }
  }

  function officialRubyHighWebsite() {
    return "https://ruby-high.ai/";
  }

  function solanaAccountLink(address) {
    const raw = String(address || "").trim();
    if (!raw) return "";
    return "https://solscan.io/account/" + encodeURIComponent(raw);
  }

  function appendSolanaProofLink(parent, address, label) {
    const href = solanaAccountLink(address);
    if (!parent || !href) return null;
    const link = document.createElement("a");
    link.className = "account-chain-link";
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label || "View on Solscan";
    link.addEventListener("click", (event) => event.stopPropagation());
    parent.appendChild(link);
    return link;
  }

  function appendAccountTrustRow(label, value, href) {
    if (!els.accountTrustList) return;
    const row = document.createElement("div");
    row.className = "account-trust-row";
    const key = document.createElement("div");
    key.className = "account-trust-key";
    key.textContent = label;
    const val = href ? document.createElement("a") : document.createElement("div");
    val.className = "account-trust-value";
    val.textContent = value || "Unavailable";
    if (href) {
      val.href = href;
      val.target = "_blank";
      val.rel = "noopener noreferrer";
    }
    row.appendChild(key);
    row.appendChild(val);
    els.accountTrustList.appendChild(row);
  }

  function appendAccountTrustNote(text) {
    if (!els.accountTrustList) return;
    const note = document.createElement("div");
    note.className = "account-trust-note";
    note.textContent = text;
    els.accountTrustList.appendChild(note);
  }

  function renderAccountTrust() {
    if (!els.accountTrustList) return;
    const payload = billingProductsCache && typeof billingProductsCache === "object" ? billingProductsCache : null;
    const solana = payload && payload.solana && typeof payload.solana === "object" ? payload.solana : null;
    const nfts = payload && payload.nfts && typeof payload.nfts === "object" ? payload.nfts : null;
    const corePacks = nfts && nfts.corePacks && typeof nfts.corePacks === "object" ? nfts.corePacks : solana && solana.packNfts;
    const connectedWallet = knownSolanaOwnerWalletAddress();
    els.accountTrustList.replaceChildren();
    appendAccountTrustRow("Official website", officialRubyHighWebsite(), officialRubyHighWebsite());
    appendAccountTrustRow("Current build", buildId || "dev");
    appendAccountTrustRow("Connected wallet", connectedWallet ? shortWallet(connectedWallet) : "Not connected", solanaAccountLink(connectedWallet));
    appendAccountTrustRow("Treasury", solana && solana.recipient ? shortWallet(solana.recipient) : "Shown before wallet payment", solana && solana.recipient ? solanaAccountLink(solana.recipient) : "");
    appendAccountTrustRow("RUBY token", solana && solana.mint ? shortWallet(solana.mint) : "Shown before wallet payment", solana && solana.mint ? solanaAccountLink(solana.mint) : "");
    appendAccountTrustRow("Pack collection", corePacks && corePacks.collectionAddress ? shortWallet(corePacks.collectionAddress) : "Loading configuration", corePacks && corePacks.collectionAddress ? solanaAccountLink(corePacks.collectionAddress) : "");
    appendAccountTrustRow("Card collection", nfts && nfts.collectionAddress ? shortWallet(nfts.collectionAddress) : "Loading configuration", nfts && nfts.collectionAddress ? solanaAccountLink(nfts.collectionAddress) : "");
    appendAccountTrustNote("Ruby High never asks for a seed phrase. Wallet prompts should be limited to sign-in, pack payment, pack opening, card minting, or card burning.");
  }

  function hallPassCardsForTelemetry(t) {
    const src = t || lastTelemetry;
    const wallet = src && src.wallet && typeof src.wallet === "object" ? src.wallet : {};
    const cards = Array.isArray(wallet.hallPassCards) ? wallet.hallPassCards.slice() : [];
    return cards.filter((card) => card && typeof card === "object" && card.id);
  }

  function pendingHallPassCardMintsForTelemetry(t) {
    return hallPassCardsForTelemetry(t)
      .filter((card) => card.status === "active" && (!card.mintAddress || !card.mintSignature));
  }

  function hallPassPacksForTelemetry(t) {
    const src = t || lastTelemetry;
    const wallet = src && src.wallet && typeof src.wallet === "object" ? src.wallet : {};
    const packs = Array.isArray(wallet.hallPassPacks) ? wallet.hallPassPacks.slice() : [];
    const byAsset = new Map();
    packs
      .filter((pack) => (
        pack &&
        typeof pack === "object" &&
        pack.status !== "void" &&
        pack.id &&
        pack.assetAddress &&
        pack.mintSignature
      ))
      .forEach((pack) => {
        const key = String(pack.assetAddress || pack.id);
        const current = byAsset.get(key);
        if (!current || Number(pack.updatedAt || pack.issuedAt || 0) >= Number(current.updatedAt || current.issuedAt || 0)) {
          byAsset.set(key, pack);
        }
      });
    return Array.from(byAsset.values()).sort((a, b) => Number(a.issuedAt || 0) - Number(b.issuedAt || 0));
  }

  function accountHallPassCardsRenderSignature(shownPacks, shown) {
    return JSON.stringify({
      authed: !!authed,
      billingBusy: !!billingBusy,
      billingMode,
      ownerWallet: knownSolanaOwnerWalletAddress() || "",
      packs: shownPacks.map((pack) => [
        pack.id,
        pack.assetAddress,
        pack.mintSignature,
        pack.status,
        pack.packCount,
        pack.cardCount,
        pack.serial,
        pack.issuedAt,
        pack.updatedAt,
      ]),
      cards: shown.map((card) => [
        card.id,
        card.characterId,
        card.characterName,
        card.role,
        card.rarity,
        card.status,
        card.serial,
        card.mintAddress,
        card.mintSignature,
        card.issuedAt,
        card.updatedAt,
      ]),
    });
  }

  function renderAccountHallPassCards() {
    if (!els.accountHallPassCards) return;
    const cards = hallPassCardsForTelemetry();
    const packs = hallPassPacksForTelemetry();
    const activePacks = packs.filter((pack) => pack.status === "active");
    const active = cards.filter((card) => card.status === "active");
    const minted = cards.filter((card) => card.mintAddress && card.mintSignature);
    const pendingMints = pendingHallPassCardMintsForTelemetry();
    const hasSolanaWallet = !!knownSolanaOwnerWalletAddress();
    const needsWalletConnection = !hasSolanaWallet && (activePacks.length > 0 || pendingMints.length > 0);
    let summaryText = "";
    const shown = cards
      .slice()
      .sort((a, b) => {
        const activeDelta = (b.status === "active" ? 1 : 0) - (a.status === "active" ? 1 : 0);
        if (activeDelta) return activeDelta;
        return Number(b.updatedAt || b.issuedAt || 0) - Number(a.updatedAt || a.issuedAt || 0);
      })
      .slice(0, 24);
    if (els.accountCardSummary) {
      const pieces = [];
      if (packs.length > 0) pieces.push(activePacks.length + " active pack" + (activePacks.length === 1 ? "" : "s"));
      if (cards.length > 0) {
        pieces.push(active.length + " active card" + (active.length === 1 ? "" : "s"));
        if (minted.length > 0) pieces.push(minted.length + " on-chain Card" + (minted.length === 1 ? "" : "s"));
        if (pendingMints.length > 0) pieces.push(pendingMints.length + " face-down Card" + (pendingMints.length === 1 ? "" : "s") + " to reveal");
      }
      summaryText = needsWalletConnection
        ? "Connect a Solana wallet to open packs and reveal Cards."
        : pieces.length === 0
        ? "No packs or Cards in this wallet yet."
        : pieces.join(" · ");
      els.accountCardSummary.textContent = summaryText;
    }
    if (els.accountBuyCardPacks) {
      const checkout = cardPackCheckoutState();
      const checkoutBlocked = checkout.loaded && !checkout.ready;
      els.accountBuyCardPacks.disabled = !authed || billingBusy || checkoutBlocked;
      els.accountBuyCardPacks.textContent = billingBusy && billingMode === "card-packs" ? "Loading..." : "Buy Card Packs";
      if (!authed) {
        els.accountBuyCardPacks.title = "Sign in to buy Ruby High card packs.";
      } else if (checkoutBlocked) {
        els.accountBuyCardPacks.title = checkout.reason || "Card pack checkout is unavailable right now.";
      } else {
        els.accountBuyCardPacks.title = "Buy Ruby High card packs.";
      }
      if (els.accountCardSummary && checkoutBlocked && checkout.reason) {
        els.accountCardSummary.textContent = summaryText + " · " + checkout.reason;
      }
    }
    configureGetRubyLink(els.accountGetRuby);
    if (els.accountMintCards) {
      els.accountMintCards.hidden = !needsWalletConnection && pendingMints.length === 0;
      els.accountMintCards.disabled = !authed || billingBusy;
      if (needsWalletConnection) {
        els.accountMintCards.textContent = billingBusy ? "Connecting..." : "Connect Wallet";
        els.accountMintCards.title = "Connect a Solana wallet before opening packs or revealing Cards.";
      } else if (pendingMints.length > 0) {
        els.accountMintCards.textContent = billingBusy ? "Minting..." : "Reveal Card";
        els.accountMintCards.title = "Mint the next face-down Ruby High Card to reveal it.";
      } else {
        els.accountMintCards.textContent = "Reveal Card";
        els.accountMintCards.title = "No face-down cards are ready to reveal.";
      }
    }
    const shownPacks = packs
      .slice()
      .sort((a, b) => {
        const activeDelta = (b.status === "active" ? 1 : 0) - (a.status === "active" ? 1 : 0);
        if (activeDelta) return activeDelta;
        return Number(b.updatedAt || b.issuedAt || 0) - Number(a.updatedAt || a.issuedAt || 0);
      })
      .slice(0, 12);
    const renderSig = accountHallPassCardsRenderSignature(shownPacks, shown);
    if (renderSig === accountHallPassCardsRenderSig && els.accountHallPassCards.childElementCount > 0) return;
    accountHallPassCardsRenderSig = renderSig;
    els.accountHallPassCards.replaceChildren();
    if (shownPacks.length === 0 && shown.length === 0) {
      const empty = document.createElement("div");
      empty.className = "account-empty";
      empty.textContent = "No packs or Cards in this wallet yet.";
      els.accountHallPassCards.appendChild(empty);
      return;
    }
    shownPacks.forEach((pack) => {
      els.accountHallPassCards.appendChild(buildHallPassPack(pack));
    });
    shown.forEach((card) => {
      els.accountHallPassCards.appendChild(buildHallPassCard(card));
    });
  }

  const HALL_PASS_CARD_PROFILES = {
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

  function buildHallPassPack(pack) {
    const item = document.createElement("article");
    item.className = "account-pack-tile is-" + String(pack.status || "active");
    const packs = Math.max(1, Math.floor(Number(pack.packCount || 1)));
    const cardCount = Math.max(packs * HALL_PASS_CARDS_PER_PACK, Math.floor(Number(pack.cardCount || 0)));
    const status = String(pack.status || "active");
    const img = document.createElement("img");
    img.className = "account-pack-tile-art";
    img.alt = status === "active" ? "Ruby High Pack" : "Opened Ruby High Pack";
    img.loading = "lazy";
    img.src = status === "active" ? PACK_NFT_ART_URL : PACK_OPENED_NFT_ART_URL;
    item.appendChild(img);
    const meta = document.createElement("div");
    meta.className = "account-pack-tile-meta";
    const copy = document.createElement("div");
    copy.className = "account-pack-tile-copy";
    const title = document.createElement("div");
    title.className = "account-pack-tile-title";
    title.textContent = packs === 1 ? "Ruby High Pack" : "Ruby High " + packs + "-Pack";
    const detail = document.createElement("div");
    detail.className = "account-pack-tile-detail";
    detail.textContent = (status === "active" ? "On-chain Core NFT" : "Opened pack record")
      + " · " + formatWholeNumber(cardCount)
      + " cards · #" + String(pack.serial || "").padStart(6, "0");
    copy.appendChild(title);
    copy.appendChild(detail);
    appendSolanaProofLink(copy, pack.assetAddress, status === "active" ? "View pack NFT" : "Pack proof");
    meta.appendChild(copy);
    if (pack.status === "active") {
      const walletReady = !!knownSolanaOwnerWalletAddress();
      const open = document.createElement("button");
      open.type = "button";
      open.className = "account-pack-tile-open";
      open.textContent = walletReady
        ? (billingBusy ? "Opening..." : "Open Pack")
        : (billingBusy ? "Connecting..." : "Connect Wallet");
      open.disabled = !authed || billingBusy;
      open.title = walletReady
        ? "Open this Ruby High pack and create its Cards."
        : "Connect a Solana wallet before opening this Ruby High pack.";
      open.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!walletReady) {
          void ensureSolanaWalletFromAccount();
          return;
        }
        void openHallPassPackFromAccount(pack.id);
      });
      meta.appendChild(open);
    }
    item.appendChild(meta);
    return item;
  }

  function buildHallPassCard(card) {
    const faceDown = hallPassCardIsFaceDown(card);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "account-card-tile is-" + String(card.status || "active")
      + " is-" + String(card.role || "student")
      + " rarity-" + String(card.rarity || "common").replace(/[^a-z0-9-]/gi, "")
      + (faceDown ? " is-face-down" : "");
    item.setAttribute("aria-label", "Open " + hallPassCardTitle(card, faceDown));
    const artUrl = faceDown ? CARD_BACK_ART_URL : hallPassCardArtUrl(card);
    if (artUrl) {
      const img = document.createElement("img");
      img.className = "account-card-tile-art";
      img.alt = faceDown
        ? "Face-down Ruby High card"
        : card.characterName ? card.characterName + " Ruby High card" : "Ruby High card";
      img.loading = "lazy";
      img.src = artUrl;
      item.appendChild(img);
    } else {
      const fallback = document.createElement("div");
      fallback.className = "account-card-tile-fallback";
      fallback.textContent = String(card.characterName || "R").slice(0, 1).toUpperCase();
      item.appendChild(fallback);
    }
    const meta = document.createElement("div");
    meta.className = "account-card-tile-meta";
    const title = document.createElement("div");
    title.className = "account-card-tile-title";
    title.textContent = hallPassCardTitle(card, faceDown);
    const detail = document.createElement("div");
    detail.className = "account-card-tile-detail";
    detail.textContent = hallPassCardDetail(card, faceDown);
    meta.appendChild(title);
    meta.appendChild(detail);
    item.appendChild(meta);
    item.addEventListener("click", () => showHallPassCardReader(card));
    return item;
  }

  function hallPassCardIsFaceDown(card) {
    return !card || !card.mintAddress || !card.mintSignature || card.characterId === "card-back";
  }

  function hallPassCardTitle(card, faceDown) {
    return faceDown ? "Mystery Card" : card && card.characterName ? card.characterName : "Ruby High Card";
  }

  function hallPassCardStatus(card) {
    if (!card) return "active";
    return card.status === "redeemed" ? "burned" : card.status === "void" ? "void" : "active";
  }

  function hallPassCardDetail(card, faceDown) {
    if (faceDown) return "Face-down Card · mint to reveal · #" + String(card && (card.serial || card.id) || "").slice(-6);
    const chain = card && card.mintAddress && card.mintSignature ? "On-chain Card" : "In-app Card";
    return chain + " · " + String(card && card.rarity || "common") + " · " + hallPassCardStatus(card) + " · #" + String(card && (card.serial || card.id) || "").slice(-6);
  }

  function hallPassCardProfile(card) {
    const id = String(card && card.characterId || "");
    return HALL_PASS_CARD_PROFILES[id] || null;
  }

  function showHallPassCardReader(card) {
    if (!card) return;
    let currentCard = card;
    const overlay = document.createElement("div");
    overlay.className = "account-card-reader";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    const panel = document.createElement("div");
    let closeButton = null;
    overlay.appendChild(panel);

    const remove = () => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    };
    const onKey = (event) => {
      if (event.key === "Escape") remove();
    };
    const render = (nextCard, opts) => {
      currentCard = nextCard || currentCard;
      const options = opts || {};
      const faceDown = hallPassCardIsFaceDown(currentCard);
      const profile = hallPassCardProfile(currentCard);
      panel.className = "account-card-reader-panel" + (options.revealed ? " is-revealed" : "");
      panel.replaceChildren();

      const top = document.createElement("div");
      top.className = "account-card-reader-top";
      const title = document.createElement("div");
      title.className = "account-card-reader-title";
      title.textContent = hallPassCardTitle(currentCard, faceDown);
      const close = document.createElement("button");
      close.type = "button";
      close.className = "account-card-reader-close";
      close.setAttribute("aria-label", "Close card");
      close.textContent = "X";
      close.addEventListener("click", remove);
      closeButton = close;
      top.appendChild(title);
      top.appendChild(close);
      panel.appendChild(top);

      const main = document.createElement("div");
      main.className = "account-card-reader-main";
      const artWrap = document.createElement("div");
      artWrap.className = "account-card-reader-art" + (options.flip ? " is-flipped" : "");
      const artUrl = faceDown ? CARD_BACK_ART_URL : hallPassCardArtUrl(currentCard);
      if (artUrl) {
        const img = document.createElement("img");
        img.alt = hallPassCardTitle(currentCard, faceDown);
        img.src = artUrl;
        artWrap.appendChild(img);
      } else {
        const fallback = document.createElement("div");
        fallback.className = "account-card-reader-fallback";
        fallback.textContent = hallPassCardTitle(currentCard, faceDown).slice(0, 1).toUpperCase();
        artWrap.appendChild(fallback);
      }
      main.appendChild(artWrap);

      const body = document.createElement("div");
      body.className = "account-card-reader-body";
      const detail = document.createElement("div");
      detail.className = "account-card-reader-detail";
      detail.textContent = hallPassCardDetail(currentCard, faceDown);
      body.appendChild(detail);
      if (!faceDown && currentCard.mintAddress) {
        appendSolanaProofLink(body, currentCard.mintAddress, "View Card on Solscan");
      }
      if (!faceDown && profile) {
        const teaches = document.createElement("div");
        teaches.className = "account-hall-pass-card-teaches";
        const detailLabel = document.createElement("span");
        detailLabel.textContent = hallPassCardDetailLabel(currentCard);
        const detailText = document.createElement("strong");
        detailText.textContent = profile.teaches || profile.subtitle || "Ruby High";
        teaches.appendChild(detailLabel);
        teaches.appendChild(detailText);
        body.appendChild(teaches);
        if (profile.stats) body.appendChild(buildHallPassStats(profile.stats));
        if (profile.quote) {
          const quote = document.createElement("div");
          quote.className = "account-hall-pass-card-quote";
          quote.textContent = "\"" + profile.quote + "\"";
          body.appendChild(quote);
        }
      } else if (faceDown) {
        const note = document.createElement("div");
        note.className = "account-card-reader-note";
        note.textContent = "Mint this Card to reveal the character.";
        body.appendChild(note);
      }

      const actions = document.createElement("div");
      actions.className = "account-card-reader-actions";
      if (faceDown && currentCard.status === "active") {
        const reveal = document.createElement("button");
        reveal.type = "button";
        reveal.className = "account-card-tile-reveal";
        reveal.textContent = billingBusy ? "Minting..." : "Mint to Reveal";
        reveal.disabled = !authed || billingBusy;
        reveal.title = "Mint this Card with your Solana wallet to reveal it.";
        reveal.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          reveal.disabled = true;
          reveal.textContent = "Minting...";
          panel.classList.add("is-minting");
          const revealedCard = await mintHallPassCardFromAccount(currentCard.id);
          if (revealedCard) {
            render(revealedCard, { flip: true, revealed: true });
            return;
          }
          render(currentCard);
        });
        actions.appendChild(reveal);
      }
      if (actions.childElementCount > 0) body.appendChild(actions);
      main.appendChild(body);
      panel.appendChild(main);
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) remove();
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    render(currentCard);
    if (closeButton) closeButton.focus({ preventScroll: true });
  }

  function hallPassCardById(cardId) {
    const cleanCardId = String(cardId || "").trim();
    if (!cleanCardId) return null;
    return hallPassCardsForTelemetry().find((card) => String(card.id || "") === cleanCardId) || null;
  }

  function hallPassCardArtUrl(card) {
    if (!card || !card.characterId) return "";
    const nftImage = hallPassCardNftImageUrl(card);
    if (nftImage) return nftImage;
    if (card.role === "student" && STUDENTS.some((s) => s.id === card.characterId)) {
      return studentFullPortraitUrl(card.characterId);
    }
    if (card.characterId === "ruby" || card.characterId === "sally-science" || card.characterId === "professor-edward") {
      return teacherFullPortraitUrl(card.characterId);
    }
    if (card.characterId === "captain-null") {
      return apiBase + "/assets/comics/first-bell/page-10.jpg";
    }
    return "";
  }

  function hallPassCardNftImageUrl(card) {
    const id = String(card && card.characterId ? card.characterId : "").trim().toLowerCase();
    if (!id || !CARD_NFT_IMAGE_IDS.includes(id)) return "";
    return apiBase + "/assets/nft/market-cards/" + encodeURIComponent(id) + ".png?v=" + encodeURIComponent(CARD_NFT_ART_VERSION);
  }

  function hallPassCardSheetUrl(card) {
    if (!card || !card.artSheet) return "";
    if (card.artSheet === "items") return ITEM_CARD_SHEET_URL;
    if (card.artSheet === "locations") return LOCATION_CARD_SHEET_URL;
    return "";
  }

  function hallPassCardDetailLabel(card) {
    if (!card) return "DETAIL";
    if (card.role === "student") return "HANGS OUT";
    if (card.role === "item") return "ITEM";
    if (card.role === "location") return "LOCATION";
    if (card.role === "special") return "SPECIAL";
    return "TEACHES";
  }

  function buildHallPassStats(stats) {
    const row = document.createElement("div");
    row.className = "account-hall-pass-card-stats";
    [
      ["HEAD", stats.head],
      ["HEART", stats.heart],
      ["HONOR", stats.honor],
      ["HUSTLE", stats.hustle],
    ].forEach(([label, raw]) => {
      const value = Number(raw || 0);
      const stat = document.createElement("div");
      stat.className = "account-hall-pass-card-stat" + (value < 0 ? " is-neg" : " is-pos");
      const text = document.createElement("span");
      text.className = "account-hall-pass-card-stat-label";
      text.textContent = label + " " + (value >= 0 ? "+" : "") + value;
      const dots = document.createElement("span");
      dots.className = "account-hall-pass-card-dots";
      const filled = Math.max(0, Math.min(5, Math.round(value) + 2));
      for (let i = 0; i < 5; i += 1) {
        const dot = document.createElement("i");
        if (i < filled) dot.className = "is-filled";
        dots.appendChild(dot);
      }
      stat.appendChild(text);
      stat.appendChild(dots);
      row.appendChild(stat);
    });
    return row;
  }

  function displayCardText(value, fallback) {
    const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
    return text.replace(/Hall Passes/g, "Cards").replace(/Hall Pass/g, "Card");
  }

  function characterSlotTelemetry() {
    const raw = lastTelemetry && lastTelemetry.character_slots && typeof lastTelemetry.character_slots === "object"
      ? lastTelemetry.character_slots
      : {};
    return {
      unlockedSlots: Math.max(1, Math.floor(Number(raw.unlockedSlots || 1))),
      photoDayCredits: Math.max(0, Math.floor(Number(raw.photoDayCredits || 0))),
      costHallPasses: Math.max(1, Math.floor(Number(raw.costHallPasses || 1))),
      photoDayCreditsPerSlot: Math.max(0, Math.floor(Number(raw.photoDayCreditsPerSlot || 1))),
    };
  }

  function ownedCharacterEntries() {
    const out = [];
    const current = lastTelemetry && lastTelemetry.character;
    if (current) {
      out.push({ kind: "active", character: current });
    }
    studentPoolEntries().forEach((entry) => out.push({ kind: "graduated", character: entry }));
    return out;
  }

  function renderAccountCharacters() {
    if (!els.accountCharacterGrid) return;
    const slots = characterSlotTelemetry();
    const wallet = walletNumbers(lastTelemetry);
    const entries = ownedCharacterEntries();
    const hasActiveCharacter = !!(lastTelemetry && lastTelemetry.character);
    const displaySlots = Math.max(slots.unlockedSlots, entries.length, 1);
    const emptySlots = Math.max(0, displaySlots - entries.length);
    const canCreateCharacter = !!authed && !hasActiveCharacter && entries.length < displaySlots;
    if (els.accountCharacterSummary) {
      els.accountCharacterSummary.textContent = entries.length === 0
        ? "Create your first student to start class."
        : displaySlots + " unlocked "
          + (displaySlots === 1 ? "slot" : "slots") + " · "
          + slots.photoDayCredits + " Photo Day "
          + (slots.photoDayCredits === 1 ? "credit" : "credits");
    }
    if (els.accountCreateCharacter) {
      els.accountCreateCharacter.hidden = !canCreateCharacter;
      els.accountCreateCharacter.disabled = !canCreateCharacter;
    }
    if (els.accountUnlockSlot) {
      els.accountUnlockSlot.textContent = "Unlock Slot (" + slots.costHallPasses + " Card" + (slots.costHallPasses === 1 ? "" : "s") + ")";
      els.accountUnlockSlot.disabled = !authed || wallet.hallPasses < slots.costHallPasses || billingBusy;
      els.accountUnlockSlot.title = wallet.hallPasses < slots.costHallPasses
        ? "Need " + slots.costHallPasses + " Card" + (slots.costHallPasses === 1 ? "" : "s")
        : "Adds one student slot and " + slots.photoDayCreditsPerSlot + " Photo Day credit";
    }
    els.accountCharacterGrid.replaceChildren();
    entries.forEach((entry, idx) => {
      els.accountCharacterGrid.appendChild(buildAccountCharacterCard(entry, idx + 1));
    });
    for (let i = 0; i < emptySlots; i++) {
      els.accountCharacterGrid.appendChild(buildEmptyCharacterSlot(entries.length + i + 1, canCreateCharacter));
    }
    if (entries.length === 0 && emptySlots === 0) {
      const empty = document.createElement("div");
      empty.className = "account-empty";
      empty.textContent = "Roll your first student to start filling your account.";
      els.accountCharacterGrid.appendChild(empty);
    }
  }

  function buildAccountCharacterCard(entry, slotNumber) {
    const c = entry.character || {};
    const pb = (lastTelemetry && Array.isArray(lastTelemetry.playbooks) ? lastTelemetry.playbooks : [])
      .find((p) => p.id === c.playbookId) || { name: c.playbookId || "Student", accent: "var(--accent)" };
    const card = document.createElement("button");
    card.type = "button";
    card.className = "account-character-card is-" + entry.kind;
    card.style.setProperty("--account-character-accent", pb.accent || "var(--accent)");
    const portrait = document.createElement("span");
    portrait.className = "account-character-portrait";
    const imgUrl = c.diplomaImageDataUrl || c.portraitDataUrl || defaultPortraitFor(c.playbookId);
    if (imgUrl) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = imgUrl;
      portrait.appendChild(img);
    } else {
      portrait.textContent = String(c.name || "?").slice(0, 1).toUpperCase();
    }
    card.appendChild(portrait);
    const copy = document.createElement("span");
    copy.className = "account-character-copy";
    const name = document.createElement("span");
    name.className = "account-character-name";
    name.textContent = c.name || "Student";
    copy.appendChild(name);
    const yearbookCount = Array.isArray(c.yearbook) ? c.yearbook.length : 0;
    const meta = document.createElement("span");
    meta.className = "account-character-meta";
    meta.textContent = entry.kind === "active"
      ? "Slot " + slotNumber + " · active · " + (GRADE_LABELS[lastTelemetry && lastTelemetry.current_grade] || "Freshman")
      : "Slot " + slotNumber + " · graduated · " + yearbookCount + "/4 years";
    copy.appendChild(meta);
    card.appendChild(copy);
    card.addEventListener("click", () => {
      if (entry.kind === "active") {
        openCharacterSheetFromAccount();
      }
    });
    return card;
  }

  function buildEmptyCharacterSlot(slotNumber, canCreateCharacter) {
    const card = document.createElement(canCreateCharacter ? "button" : "div");
    if (canCreateCharacter) card.type = "button";
    card.className = "account-character-card is-empty";
    if (canCreateCharacter) card.classList.add("is-create");
    const portrait = document.createElement("span");
    portrait.className = "account-character-portrait";
    portrait.textContent = "+";
    card.appendChild(portrait);
    const copy = document.createElement("span");
    copy.className = "account-character-copy";
    const name = document.createElement("span");
    name.className = "account-character-name";
    name.textContent = canCreateCharacter ? "Create Character" : "Empty Slot";
    const meta = document.createElement("span");
    meta.className = "account-character-meta";
    meta.textContent = canCreateCharacter
      ? "Slot " + slotNumber + " · start today's class"
      : "Slot " + slotNumber + " · ready for a future student";
    copy.appendChild(name);
    copy.appendChild(meta);
    card.appendChild(copy);
    if (canCreateCharacter) card.addEventListener("click", openCharacterCreationFromAccount);
    return card;
  }

  function openCharacterSheetFromAccount() {
    returnToAccountAfterSheet = true;
    closePrivyAccount();
    openSheet({ returnToAccount: true });
  }

  function openCharacterCreation() {
    closePrivyAccount();
    openSheet();
  }

  function openCharacterCreationFromAccount() {
    openCharacterSheetFromAccount();
  }

  function renderAccountComics() {
    if (!els.accountComics) return;
    const collection = comicCollectionForTelemetry();
    const unlocked = collection ? collection.unlockedPages.length : 0;
    const pageCount = collection ? collection.pageCount : FIRST_BELL_PAGE_COUNT;
    if (els.accountComicSummary) {
      els.accountComicSummary.textContent = unlocked + "/" + pageCount + " pages found";
    }
    els.accountComics.replaceChildren();
    els.accountComics.appendChild(buildComicLocker());
  }

  function renderAccountHistory() {
    if (!els.accountHistoryList) return;
    const wallet = lastTelemetry && lastTelemetry.wallet && typeof lastTelemetry.wallet === "object" ? lastTelemetry.wallet : {};
    const transactions = Array.isArray(wallet.transactions) ? wallet.transactions.slice() : [];
    transactions.sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
    els.accountHistoryList.replaceChildren();
    if (transactions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "account-empty";
      empty.textContent = "No wallet activity yet.";
      els.accountHistoryList.appendChild(empty);
      return;
    }
    transactions.slice(0, 18).forEach((tx) => {
      els.accountHistoryList.appendChild(buildAccountHistoryRow(tx));
    });
  }

  function buildAccountHistoryRow(tx) {
    const row = document.createElement("div");
    row.className = "account-history-row";
    const amount = Number(tx.hallPasses || 0);
    const photoDayAmount = Number(tx.photoDayCredits || 0);
    const cardAmount = walletTransactionCardCount(tx);
    const isPackPurchase = tx && tx.kind === "hall-pass-pack-mint";
    const visibleAmount = amount || photoDayAmount || cardAmount;
    if (isPackPurchase) row.classList.add("is-swap");
    else if (visibleAmount > 0) row.classList.add("is-credit");
    else if (visibleAmount < 0) row.classList.add("is-debit");
    const main = document.createElement("div");
    main.className = "account-history-main";
    const title = document.createElement("div");
    title.className = "account-history-title";
    title.textContent = walletTransactionDescription(tx);
    const meta = document.createElement("div");
    meta.className = "account-history-meta";
    meta.textContent = walletTransactionSource(tx) + " · " + formatAccountDate(tx.at);
    main.appendChild(title);
    main.appendChild(meta);
    const delta = document.createElement("div");
    delta.className = "account-history-delta";
    delta.textContent = isPackPurchase
      ? walletTransactionPackDeltaText(tx)
      : cardAmount !== 0
      ? (cardAmount > 0 ? "+" : "") + formatWholeNumber(cardAmount) + " Card" + (Math.abs(cardAmount) === 1 ? "" : "s")
      : amount !== 0
        ? (amount > 0 ? "+" : "") + formatWholeNumber(amount) + " Hall Pass" + (Math.abs(amount) === 1 ? "" : "es")
        : photoDayAmount !== 0
          ? (photoDayAmount > 0 ? "+" : "") + formatWholeNumber(photoDayAmount) + " Photo Day"
          : "0";
    row.appendChild(main);
    row.appendChild(delta);
    return row;
  }

  function walletTransactionTitle(tx) {
    if (!tx || !tx.kind) return "Wallet update";
    if (tx.kind === "hall-pass-grant") return walletTransactionCardCount(tx) > 0 ? "Pack opened" : "Hall Pass grant";
    if (tx.kind === "hall-pass-spend") return walletTransactionCardCount(tx) < 0 ? "Card burn" : "Hall Pass spend";
    if (tx.kind === "hall-pass-refund") return "Hall Pass refund";
    if (tx.kind === "hall-pass-revoke") return "Hall Pass reversal";
    if (tx.kind === "hall-pass-card-burn") return "Card burned for Hall Pass";
    if (tx.kind === "hall-pass-pack-mint") return "Pack minted";
    if (tx.kind === "hall-pass-pack-open") return "Pack opened";
    if (tx.kind === "hall-pass-card-mint") return "Card minted";
    if (tx.kind === "photo-day-spend") return "Photo Day credit";
    if (tx.kind === "photo-day-refund") return "Photo Day refund";
    return "Wallet update";
  }

  function walletTransactionDescription(tx) {
    const raw = tx && typeof tx.description === "string" && tx.description.trim()
      ? tx.description.trim()
      : walletTransactionTitle(tx);
    return raw;
  }

  function walletTransactionCardCount(tx) {
    const metadata = tx && tx.metadata && typeof tx.metadata === "object" ? tx.metadata : {};
    const rawCount = Math.max(0, Math.floor(Number(metadata.hallPassCardCount || metadata.cardCount || 0)));
    const packCount = Math.max(0, Math.floor(Number(metadata.packCount || 0)));
    const count = tx && tx.kind === "hall-pass-pack-mint" && packCount > 0
      ? Math.max(rawCount, packCount * HALL_PASS_CARDS_PER_PACK)
      : rawCount;
    if (count <= 0) return 0;
    return tx.kind === "hall-pass-spend" || tx.kind === "hall-pass-revoke" ? -count : count;
  }

  function walletTransactionPackDeltaText(tx) {
    const metadata = tx && tx.metadata && typeof tx.metadata === "object" ? tx.metadata : {};
    const packCount = Math.max(1, Math.floor(Number(metadata.packCount || 1)));
    const tokenAmount = metadata.solanaTokenAmount || "";
    const tokenSymbol = metadata.solanaTokenSymbol || "RUBY";
    return "-" + formatTokenDisplayAmount(tokenAmount) + " " + tokenSymbol + " · +" + packCountLabel(packCount);
  }

  function walletTransactionSource(tx) {
    const source = String((tx && tx.source) || "system").replace(/-/g, " ");
    return source.charAt(0).toUpperCase() + source.slice(1);
  }

  function welcomeHallPassGrant(t) {
    const wallet = t && t.wallet && typeof t.wallet === "object" ? t.wallet : null;
    if (!wallet) return null;
    const transactions = Array.isArray(wallet.transactions) ? wallet.transactions : [];
    const tx = transactions.find((entry) => entry && entry.id === WELCOME_HALL_PASS_GRANT_ID) || null;
    const grantedAt = Math.floor(Number(wallet.welcomeHallPassesGrantedAt || (tx && tx.at) || 0));
    if (!grantedAt) return null;
    const amount = Math.max(1, Math.floor(Number((tx && tx.hallPasses) || 5)));
    return { at: grantedAt, amount };
  }

  function welcomeHallPassSeenKey(grant) {
    return WELCOME_HALL_PASS_POPUP_KEY_PREFIX + sessionId + ":" + String(grant && grant.at || 0);
  }

  function hasSeenWelcomeHallPassPopup(grant) {
    try { return !!localStorage.getItem(welcomeHallPassSeenKey(grant)); } catch (_err) { return false; }
  }

  function markWelcomeHallPassPopupSeen(grant) {
    try { localStorage.setItem(welcomeHallPassSeenKey(grant), "1"); } catch (_err) {}
  }

  let welcomeHallPassPopupOpen = false;
  let welcomeHallPassClaimInFlight = false;
  function maybeShowWelcomeHallPassPopup(t) {
    const grant = welcomeHallPassGrant(t);
    if (!authed || !grant || welcomeHallPassPopupOpen || hasSeenWelcomeHallPassPopup(grant)) return;
    showWelcomeHallPassPopup(grant);
  }

  function showWelcomeHallPassPopup(grant, opts) {
    welcomeHallPassPopupOpen = true;
    const fromBilling = opts && opts.source === "billing";
    const overlay = document.createElement("div");
    overlay.className = "welcome-hall-pass-popup";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const panel = document.createElement("div");
    panel.className = "welcome-hall-pass-panel";
    const art = document.createElement("img");
    art.className = "welcome-hall-pass-art";
    art.alt = "";
    art.hidden = true;
    art.addEventListener("load", () => {
      art.hidden = false;
      panel.classList.add("has-art");
    });
    art.addEventListener("error", () => {
      art.remove();
    }, { once: true });
    art.src = WELCOME_HALL_PASS_ART_URL;
    const copy = document.createElement("div");
    copy.className = "welcome-hall-pass-copy";
    const title = document.createElement("h2");
    title.textContent = formatWholeNumber(grant.amount || 5) + " Hall Passes added";
    const body = document.createElement("p");
    const portraitEntitlement = hostedImageEntitlement("portrait");
    const portraitConfigured = !!getStoredApiKey() || !!(portraitEntitlement && portraitEntitlement.configured);
    body.textContent = fromBilling
      ? "The front office stamped your starter passes. Spend them on hosted AI or images, or keep playing classes free."
      : portraitConfigured
        ? "Roll your first student and try a custom portrait, or save your Hall Passes for AI Access and extra character slots."
        : "Roll your first student now, or save your Hall Passes for AI Access, images, and extra character slots.";
    const actions = document.createElement("div");
    actions.className = "welcome-hall-pass-actions";
    const later = document.createElement("button");
    later.type = "button";
    later.className = "secondary";
    later.textContent = "Later";
    const create = document.createElement("button");
    create.type = "button";
    create.textContent = fromBilling ? "Continue" : lastTelemetry && lastTelemetry.character ? "Open Account" : "Create Character";
    if (!fromBilling) actions.appendChild(later);
    actions.appendChild(create);
    copy.appendChild(title);
    copy.appendChild(body);
    copy.appendChild(actions);
    panel.appendChild(art);
    panel.appendChild(copy);
    overlay.appendChild(panel);

    const close = () => {
      markWelcomeHallPassPopupSeen(grant);
      welcomeHallPassPopupOpen = false;
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    later.addEventListener("click", close);
    create.addEventListener("click", () => {
      close();
      if (fromBilling) return;
      if (lastTelemetry && lastTelemetry.character) {
        void openPrivyAccount();
      } else {
        openCharacterCreation();
      }
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
  }

  // formatAccountDate is in client-pure.

  async function unlockCharacterSlotFromAccount() {
    if (!authed || billingBusy) return;
    billingBusy = true;
    renderAccountCharacters();
    setPrivyStatus("Unlocking character slot...", false);
    try {
      const data = await command({ type: "unlock-character-slot", requestId: imageRequestId("character-slot") });
      if (data && data.session) {
        setPrivyStatus("Character slot unlocked. Photo Day credit added.", false);
        renderAccountPage();
      } else {
        setPrivyStatus("Could not unlock slot.", true);
      }
    } finally {
      billingBusy = false;
      renderAccountCharacters();
    }
  }

  async function ensureSolanaWalletFromAccount() {
    if (knownSolanaOwnerWalletAddress()) return true;
    if (!privyConfig) {
      setPrivyStatus("Wallet connection is not configured.", true);
      return false;
    }
    if (billingBusy) return false;
    billingBusy = true;
    renderAccountPage();
    try {
      if (!privyState.authenticated) {
        setPrivyStatus("Sign in to connect a Solana wallet.", false);
        const loginSnapshot = await startPrivyLogin({ source: "account-wallet" });
        if (!loginSnapshot && !privyState.authenticated) return false;
      }
      if (knownSolanaOwnerWalletAddress()) {
        setPrivyStatus("Wallet ready.", false);
        return true;
      }
      setPrivyStatus("Connect a Solana wallet to continue.", false);
      const approved = await confirmWalletTransactionPreview({
        title: "Connect Solana wallet?",
        action: "Connect wallet",
        cost: "None",
        prompt: "Your wallet should ask to connect an address only.",
        copy: "Ruby High will ask Privy for a Solana wallet address. This is not a transaction.",
        confirmText: "Connect wallet",
      });
      if (!approved) {
        setPrivyStatus("Wallet connection canceled.", false);
        return false;
      }
      const walletSnapshot = await startSolanaWalletConnect({ source: "account-wallet" });
      if (!walletSnapshot || !knownSolanaOwnerWalletAddress()) return false;
      setPrivyStatus("Solana wallet connected.", false);
      return true;
    } catch (err) {
      setPrivyStatus("Wallet connection failed · " + (err && err.message ? err.message : "error"), true);
      return false;
    } finally {
      billingBusy = false;
      renderAccountPage();
    }
  }

  async function openHallPassPackFromAccount(packId) {
    const cleanPackId = String(packId || "").trim();
    if (!authed || !cleanPackId || billingBusy) return;
    if (!knownSolanaOwnerWalletAddress()) {
      const connected = await ensureSolanaWalletFromAccount();
      if (!connected) return;
    }
    const ownerWalletAddress = knownSolanaOwnerWalletAddress();
    const approved = await confirmWalletTransactionPreview({
      title: "Open this pack?",
      action: "Open pack",
      walletAddress: ownerWalletAddress,
      cost: "No wallet spend",
      pack: "Ruby High Pack",
      prompt: "No wallet signature is expected for pack opening.",
      copy: "Ruby High will open an owned pack and create five face-down cards in your locker.",
      confirmText: "Open pack",
    });
    if (!approved) {
      setPrivyStatus("Pack open canceled.", false);
      return;
    }
    billingBusy = true;
    renderAccountHallPassCards();
    showPackMintProgress("Opening pack. Laying out five face-down cards...");
    setPrivyStatus("Opening pack...", false);
    try {
      const r = await apiFetch(apiBase + "/nft/open-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 90000,
        body: JSON.stringify({
          packId: cleanPackId,
          ...(ownerWalletAddress ? { ownerWalletAddress } : {}),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data || !data.ok) throw new Error(nftHttpErrorMessage("Pack opening", r, data, "Your pack was not opened; try again in a minute."));
      const count = Math.max(0, Math.floor(Number(data.cardCount || (Array.isArray(data.cards) ? data.cards.length : 0))));
      const openedText = data.applied ? "Pack opened." : "Pack was already opened.";
      updatePackMintProgress("Pack opened. Updating your locker...");
      setPrivyStatus(openedText + " " + formatWholeNumber(count) + " face-down card" + (count === 1 ? "" : "s") + " ready to reveal.", false);
      await fetchSession();
      renderAccountPage();
    } catch (err) {
      hidePackMintProgress();
      setPrivyStatus("Open pack failed · " + friendlySolanaActionError(err, "Your pack was not opened; try again in a minute."), true);
    } finally {
      hidePackMintProgress(900);
      billingBusy = false;
      renderAccountHallPassCards();
    }
  }

  async function mintHallPassCardFromAccount(cardId) {
    const cleanCardId = String(cardId || "").trim();
    if (!authed || !cleanCardId || billingBusy) return null;
    if (!knownSolanaOwnerWalletAddress()) {
      const connected = await ensureSolanaWalletFromAccount();
      if (!connected) return null;
    }
    billingBusy = true;
    renderAccountHallPassCards();
    showPackMintProgress("Minting card on Solana...", {
      title: "Please wait: minting card",
      lines: CARD_MINT_STATUS_LINES,
      rotate: false,
    });
    setPrivyStatus("Minting Card reveal...", false);
    try {
      const ownerWalletAddress = knownSolanaOwnerWalletAddress();
      if (!ownerWalletAddress) throw new Error("Connect a Solana wallet before revealing Cards.");
      updatePackMintProgress("Preparing wallet transaction...");
      const prepared = await apiFetch(apiBase + "/nft/mint-card-prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 120000,
        body: JSON.stringify({ cardId: cleanCardId, ownerWalletAddress, clientBuild: buildId }),
      });
      const preparedData = await prepared.json().catch(() => ({}));
      if (!prepared.ok || !preparedData || !preparedData.ok || !preparedData.mint) {
        throw new Error(nftHttpErrorMessage("Card mint", prepared, preparedData, "Your card is still face-down; try again in a minute."));
      }
      if (preparedData.mint.serverMinted || !preparedData.mint.transactionBase64) {
        const name = preparedData.card && preparedData.card.characterName ? preparedData.card.characterName : "Card";
        updatePackMintProgress("Mint confirmed. Revealing card...");
        setPrivyStatus(name + " revealed.", false);
        await fetchSession();
        renderAccountPage();
        hidePackMintProgress(900);
        return hallPassCardById(cleanCardId) || preparedData.card || null;
      }
      const client = await getPrivyClient();
      if (!client || typeof client.signSolanaTransaction !== "function") {
        throw new Error("Solana card mint is unavailable.");
      }
      updatePackMintProgress("Review the mint transaction in your wallet...");
      setPrivyStatus("Review the card mint transaction in your wallet.", false);
      const signed = await withWalletActionTimeout(
        client.signSolanaTransaction(preparedData.mint),
        "Wallet approval timed out. Your card is still face-down; try again when your wallet is ready.",
      );
      updatePackMintProgress("Submitting mint to Solana...");
      const confirmed = await apiFetch(apiBase + "/nft/mint-card-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 90000,
        body: JSON.stringify({
          cardId: cleanCardId,
          ownerWalletAddress: signed.walletAddress || ownerWalletAddress,
          mintAddress: preparedData.mint.mintAddress,
          metadataUri: preparedData.mint.metadataUri,
          signedTransactionBase64: signed.signedTransactionBase64,
          clientBuild: buildId,
        }),
      });
      const data = await confirmed.json().catch(() => ({}));
      if (!confirmed.ok || !data || !data.ok) {
        throw new Error(nftHttpErrorMessage("Card mint confirmation", confirmed, data, "Your card reveal is not recorded yet; try again in a minute."));
      }
      const name = data.card && data.card.characterName ? data.card.characterName : "Card";
      setPrivyStatus(name + " revealed.", false);
      await fetchSession();
      renderAccountPage();
      return hallPassCardById(cleanCardId) || data.card || null;
    } catch (err) {
      hidePackMintProgress();
      setPrivyStatus("Card reveal failed · " + friendlySolanaActionError(err, "Your card is still face-down; try again in a minute."), true);
      return null;
    } finally {
      hidePackMintProgress(900);
      billingBusy = false;
      renderAccountHallPassCards();
    }
  }

  async function mintPendingCardNftsFromAccount() {
    if (!authed || billingBusy) return;
    const pending = pendingHallPassCardMintsForTelemetry();
    if (pending.length <= 0) {
      openBilling({ mode: "card-packs" });
      return;
    }
    await mintHallPassCardFromAccount(pending[0].id);
  }

  async function confirmHallPassCardMint(input) {
    const maxAttempts = 8;
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) {
        await waitForSolanaConfirmation(1200 + attempt * 500);
        updatePackMintProgress("Waiting for Solana confirmation...");
        setPrivyStatus("Waiting for card reveal confirmation...", false);
      }
      const confirmed = await apiFetch(apiBase + "/nft/mint-card-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 30000,
        body: JSON.stringify(input),
      });
      const data = await confirmed.json().catch(() => ({}));
      if (confirmed.ok && data && data.ok) return data;
      const errorMessage = nftHttpErrorMessage("Card mint confirmation", confirmed, data, "Your card reveal is not recorded yet; try again in a minute.");
      if (confirmed.status === 404 && /No face-down card matches this mint\./i.test(errorMessage)) {
        await fetchSession();
        const alreadyRevealed = hallPassCardById(input.cardId);
        if (alreadyRevealed && alreadyRevealed.mintAddress && alreadyRevealed.mintSignature) {
          return { ok: true, card: alreadyRevealed };
        }
      }
      lastError = new Error(errorMessage);
      if (!isRetryableSolanaMintConfirm(confirmed.status, errorMessage) || attempt + 1 >= maxAttempts) break;
    }
    throw lastError || new Error("Card mint confirmation failed.");
  }

  function handleAccountAiAction() {
    if (!authed || localAiEnabled) return;
    if (getStoredApiKey() && aiEnabled) {
      void logout();
      return;
    }
    window.location.href = "/api/apps/ruby-high/auth/start";
  }

  function renderBillingProducts(payload) {
    if (!els.billingProducts) return;
    els.billingProducts.replaceChildren();
    syncBillingWallet(lastTelemetry);
    const mode = billingMode === "card-packs" ? "card-packs" : "hall-passes";
    if (els.billingTitle) els.billingTitle.textContent = mode === "card-packs" ? "Buy Card Packs" : "Buy Hall Passes";
    if (els.billingSub) {
      els.billingSub.textContent = mode === "card-packs"
        ? "Card packs are Solana NFTs. Open a pack to create five face-down Ruby High cards."
        : "Buy Hall Passes or burn one Card for 5.";
    }
    const entitlements = payload && payload.entitlements && typeof payload.entitlements === "object" ? payload.entitlements : null;
    const hostedImages = entitlements && entitlements.hosted_images && typeof entitlements.hosted_images === "object"
      ? entitlements.hosted_images
      : null;
    const cardBurn = payload && payload.cardBurn && typeof payload.cardBurn === "object" ? payload.cardBurn : null;
    const hallPassesPerBurnedCard = positiveWholeNumber(cardBurn && cardBurn.hallPassesPerCard || HALL_PASS_CARD_BURN_HALL_PASS_VALUE, HALL_PASS_CARD_BURN_HALL_PASS_VALUE);
    const costs = {
      portrait: hostedImages && hostedImages.portrait ? hostedImages.portrait.cost : payload && payload.imageCosts ? payload.imageCosts.portrait : undefined,
      diploma: hostedImages && hostedImages.diploma ? hostedImages.diploma.cost : payload && payload.imageCosts ? payload.imageCosts.diploma : undefined,
    };
    const creator = creatorPricing(payload);
    if (els.billingCosts) {
      els.billingCosts.replaceChildren();
      [
        ["AI Access", payload && payload.hostedAiAccess ? payload.hostedAiAccess.cost : undefined],
        ["Portrait", costs.portrait],
        ["Diploma art", costs.diploma],
        ["Course publish", creator.courseSlotCost],
        ["More questions", creator.questionGenerationCost],
      ].forEach(([label, cost]) => {
        const chip = document.createElement("span");
        chip.className = "cost-chip";
        chip.textContent = label + ": " + billingHallPassCostLabel(cost);
        els.billingCosts.appendChild(chip);
      });
      if (mode === "card-packs") {
        els.billingCosts.replaceChildren();
        [
          "Pack NFT: " + HALL_PASS_CARDS_PER_PACK + " cards",
          "Burn rate: 1 Card = " + hallPassCostLabel(hallPassesPerBurnedCard),
        ].forEach((label) => {
        const chip = document.createElement("span");
        chip.className = "cost-chip";
        chip.textContent = label;
        els.billingCosts.appendChild(chip);
      });
      els.billingCosts.appendChild(buildGetRubyLink("cost-chip get-ruby-link billing-get-ruby-link"));
    }
    }
    const solana = payload && payload.solana && typeof payload.solana === "object" ? payload.solana : null;
    const solanaProducts = solana && Array.isArray(solana.products) ? solana.products : [];
    const products = Array.isArray(payload && payload.products) ? payload.products : [];
    const shownProducts = mode === "card-packs" ? solanaProducts : products;
    if (mode === "hall-passes") {
      els.billingProducts.appendChild(buildHallPassCardBurnChoice(hallPassesPerBurnedCard));
    }
    if (shownProducts.length === 0) {
      setBillingStatus(mode === "card-packs" ? "No card packs are available." : "No Hall Passes are available.", true);
      return;
    }
    if (selectedBillingProductId && !shownProducts.some((product) => product.id === selectedBillingProductId)) {
      selectedBillingProductId = null;
    }
    shownProducts.forEach((product) => {
      const row = document.createElement("div");
      row.className = "billing-product";
      if (product.id === selectedBillingProductId) row.classList.add("is-selected");
      const body = document.createElement("div");
      const title = document.createElement("div");
      title.className = "billing-product-title";
      title.textContent = mode === "card-packs" ? (product.name || packCountLabel(product.packCount)) : (product.name || hallPassCostLabel(productHallPassCount(product)));
      const meta = document.createElement("div");
      meta.className = "billing-product-meta";
      meta.textContent = mode === "card-packs"
        ? cardPackProductMeta(product, solana)
        : formatMoney(product.unitAmount, product.currency) + " · " + hallPassCostLabel(productHallPassCount(product));
      body.appendChild(title);
      body.appendChild(meta);
      const buy = document.createElement("button");
      buy.type = "button";
      buy.className = "billing-buy";
      buy.textContent = product.id === selectedBillingProductId ? "Selected" : "Choose";
      buy.disabled = billingBusy;
      buy.addEventListener("click", () => selectBillingProduct(product.id));
      row.appendChild(body);
      row.appendChild(buy);
      els.billingProducts.appendChild(row);
      if (product.id === selectedBillingProductId) {
        els.billingProducts.appendChild(mode === "card-packs"
          ? buildCardPackPaymentChoice(solana, product)
          : buildBillingPaymentChoice(payload, product));
      }
    });
    setBillingStatus(
      mode === "card-packs"
        ? (solana && !solana.configured
          ? "Card pack checkout is not configured on this server."
          : currentRubyTokenMintFromSolana(solana) ? "" : "RUBY mint configuration is missing for card packs.")
        : (payload.configured ? "" : "Stripe checkout is not configured on this server."),
      mode === "card-packs"
        ? !(solana && solana.configured && currentRubyTokenMintFromSolana(solana))
        : !payload.configured,
    );
  }

  function selectBillingProduct(productId) {
    selectedBillingProductId = selectedBillingProductId === productId ? null : productId;
    if (billingProductsCache) renderBillingProducts(billingProductsCache);
  }

  function billingHallPassCostLabel(cost) {
    const n = Math.floor(Number(cost));
    if (!Number.isFinite(n) || n <= 0) return "0 Hall Passes";
    return hallPassCostLabel(n);
  }

  function productHallPassCount(product) {
    const explicit = Number(product && product.hallPasses);
    if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
    return 1;
  }

  // packCountLabel is in client-pure.ts.

  function buildBillingPaymentChoice(payload, product) {
    const panel = document.createElement("div");
    panel.className = "billing-payment-choice";
    const title = document.createElement("div");
    title.className = "billing-payment-title";
    title.textContent = "Buy " + hallPassCostLabel(productHallPassCount(product));
    const meta = document.createElement("div");
    meta.className = "billing-product-meta";
    meta.textContent = formatMoney(product.unitAmount, product.currency);
    const actions = document.createElement("div");
    actions.className = "billing-payment-actions";
    const stripe = document.createElement("button");
    stripe.type = "button";
    stripe.className = "billing-buy";
    stripe.textContent = "Checkout";
    stripe.disabled = !payload.configured || billingBusy;
    stripe.title = payload.configured ? "Pay by card with Stripe." : "Stripe checkout is not configured.";
    stripe.addEventListener("click", () => startCheckout(product.id));
    actions.appendChild(stripe);
    panel.appendChild(title);
    panel.appendChild(meta);
    panel.appendChild(actions);
    return panel;
  }

  function buildHallPassCardBurnChoice(hallPassesPerBurnedCard) {
    const ownerWallet = knownSolanaOwnerWalletAddress() || connectedSolanaWalletAddress();
    const burnableCards = ownerWallet ? activeMintedHallPassCardsForWallet(ownerWallet).length : mintedCardCount(lastTelemetry);
    const row = document.createElement("div");
    row.className = "billing-product billing-card-burn";
    const body = document.createElement("div");
    const title = document.createElement("div");
    title.className = "billing-product-title";
    title.textContent = "Burn Card";
    const meta = document.createElement("div");
    meta.className = "billing-product-meta";
    meta.textContent = ownerWallet
      ? burnableCards > 0
        ? formatWholeNumber(burnableCards) + " burnable Card" + (burnableCards === 1 ? "" : "s") + " · +" + hallPassCostLabel(hallPassesPerBurnedCard)
        : "No active on-chain Cards in this wallet."
      : "Connect your Solana wallet to burn a Card for " + hallPassCostLabel(hallPassesPerBurnedCard) + ".";
    body.appendChild(title);
    body.appendChild(meta);
    const burn = document.createElement("button");
    burn.type = "button";
    burn.className = "billing-buy";
    burn.textContent = billingBusy ? "Burning..." : ownerWallet ? "Burn Card" : "Connect Wallet";
    burn.disabled = !authed || billingBusy || (!!ownerWallet && burnableCards <= 0);
    burn.title = ownerWallet
      ? burnableCards > 0
        ? "Burn one Card for " + hallPassCostLabel(hallPassesPerBurnedCard) + "."
        : "No active on-chain Cards are available to burn."
      : "Connect a Solana wallet before burning a Card.";
    burn.addEventListener("click", () => burnHallPassCardFromBilling());
    row.appendChild(body);
    row.appendChild(burn);
    return row;
  }

  function buildCardPackPaymentChoice(solana, product) {
    const panel = document.createElement("div");
    panel.className = "billing-payment-choice";
    const canPackCheckout = !!(solana && solana.configured && currentRubyTokenMintFromSolana(solana));
    const title = document.createElement("div");
    title.className = "billing-payment-title";
    title.textContent = "Buy " + (product.name || packCountLabel(product.packCount));
    const meta = document.createElement("div");
    meta.className = "billing-product-meta";
    meta.textContent = cardPackProductMeta(product, solana);
    const actions = document.createElement("div");
    actions.className = "billing-payment-actions";
    const cryptoUnavailable = !privyState.configured;
    const crypto = document.createElement("button");
    crypto.type = "button";
    crypto.className = "billing-buy";
    crypto.textContent = cryptoUnavailable ? "Crypto unavailable" : "Buy Pack";
    crypto.disabled = billingBusy || cryptoUnavailable || !canPackCheckout;
    crypto.title = cryptoUnavailable
      ? "Card pack checkout needs Privy wallet configuration."
      : !canPackCheckout
      ? "RUBY token setup is incomplete. Get $RUBY, then try again."
      : "Pay with " + (product.tokenSymbol || (solana && solana.symbol) || "RUBY") + " and mint a pack NFT.";
    crypto.addEventListener("click", () => startSolanaPayment(product.id));
    actions.appendChild(crypto);
    panel.appendChild(title);
    panel.appendChild(meta);
    panel.appendChild(actions);
    if (cryptoUnavailable) {
      const note = document.createElement("div");
      note.className = "billing-payment-note";
      note.textContent = "Card pack checkout is not configured in this preview.";
      panel.appendChild(note);
    } else if (!canPackCheckout) {
      const note = document.createElement("div");
      note.className = "billing-payment-note";
      note.textContent = "RUBY token setup is incomplete. Get $RUBY, then choose a pack.";
      panel.appendChild(note);
      panel.appendChild(buildGetRubyLink("billing-get-ruby-link billing-payment-note-link"));
    }
    return panel;
  }

  async function burnHallPassCardFromBilling() {
    if (billingBusy) return;
    billingBusy = true;
    renderAccountPage();
    if (billingProductsCache) renderBillingProducts(billingProductsCache);
    try {
      await convertHallPassCardsToHallPasses(1, {
        status: (message, invalid) => setBillingStatus(message, invalid),
      });
    } catch (err) {
      const message = err && err.message ? err.message : "error";
      if (/canceled/i.test(message)) {
        setBillingStatus("Card burn canceled.", false);
        return;
      }
      setBillingStatus("Card burn failed · " + friendlySolanaActionError(err, "Your card was not burned; try again in a minute."), true);
    } finally {
      billingBusy = false;
      renderAccountPage();
      if (billingProductsCache) renderBillingProducts(billingProductsCache);
    }
  }

  async function loadBillingProducts() {
    setBillingStatus(billingMode === "card-packs" ? "Loading card packs..." : "Loading Hall Passes...", false);
    try {
      const r = await apiFetch(apiBase + "/billing/products", { timeoutMs: 8000 });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data || !data.ok) throw new Error(data.error || "billing " + r.status);
      billingProductsCache = data;
      renderBillingProducts(data);
    } catch (err) {
      setBillingStatus((billingMode === "card-packs" ? "Couldn't load packs" : "Couldn't load Hall Passes") + " · " + (err && err.message ? err.message : "error"), true);
    }
  }

  async function claimWelcomeHallPassesFromBilling() {
    if (welcomeHallPassClaimInFlight || !authed) return;
    welcomeHallPassClaimInFlight = true;
    try {
      const r = await apiFetch(apiBase + "/billing/welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 8000,
        body: JSON.stringify({}),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data || !data.ok) throw new Error(data.error || "welcome " + r.status);
      if (typeof data.hallPasses === "number") applyHallPassBalance(data.hallPasses, data.entitlements, data.characterSlots);
      await fetchSession();
      if (data.applied) {
        showWelcomeHallPassPopup({
          at: Math.floor(Number(data.welcomeHallPassesGrantedAt || Date.now())),
          amount: Math.max(1, Math.floor(Number(data.amount || 5))),
        }, { source: "billing" });
      }
      if (billingProductsCache) renderBillingProducts(billingProductsCache);
    } catch (err) {
      setBillingStatus("Starter Hall Passes unavailable · " + (err && err.message ? err.message : "error"), true);
    } finally {
      welcomeHallPassClaimInFlight = false;
    }
  }

  function openBilling(opts) {
    if (!authed || !els.billingOverlay) return;
    billingMode = opts && opts.mode === "card-packs" ? "card-packs" : "hall-passes";
    selectedBillingProductId = null;
    syncBillingWallet(lastTelemetry);
    els.billingOverlay.classList.add("is-open");
    els.billingOverlay.setAttribute("aria-hidden", "false");
    if (billingProductsCache) renderBillingProducts(billingProductsCache);
    if (billingMode === "hall-passes") void claimWelcomeHallPassesFromBilling();
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

  async function startSolanaPayment(productId) {
    if (!productId || billingBusy) return;
    billingBusy = true;
    let finalBillingStatus = null;
    if (billingProductsCache) renderBillingProducts(billingProductsCache);
    setBillingStatus("Starting card pack checkout...", false);
    try {
      if (!connectedSolanaWalletAddress()) {
        const connected = await ensureSolanaWalletForBilling();
        if (!connected) {
          finalBillingStatus = ["Card pack checkout canceled.", false];
          setBillingStatus(finalBillingStatus[0], finalBillingStatus[1]);
          return;
        }
      }
      setBillingStatus("Preparing card pack payment...", false);
      const ownerWalletAddress = connectedSolanaWalletAddress();
      const r = await apiFetch(apiBase + "/billing/solana/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 12000,
        body: JSON.stringify({ productId, ownerWalletAddress }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data || !data.ok) {
        throw new Error(nftHttpErrorMessage("Card pack checkout", r, data, "No Ruby High pack was minted; try again in a minute."));
      }
      const client = await getPrivyClient();
      if (!client || typeof client.paySolanaQuote !== "function") throw new Error("Solana wallet checkout is unavailable.");
      const product = data.product || {};
      const approved = await confirmWalletTransactionPreview({
        title: "Confirm card pack payment?",
        action: "Buy " + cardPackProductLabel(product),
        walletAddress: ownerWalletAddress,
        cost: cardPackDebitLabel(product, data),
        credit: cardPackCreditLabel(product),
        pack: cardPackProductLabel(product) + " · " + formatWholeNumber(product.cardCount || HALL_PASS_CARDS_PER_PACK) + " cards",
        recipient: data.recipient,
        mint: data.mint,
        reference: data.reference,
        prompt: "Your wallet should show a RUBY debit and Ruby High pack NFT create. The network fee is paid by this wallet.",
        copy: "Ruby High will ask your wallet to pay RUBY and create one authorized pack NFT. This should not ask for broad approvals.",
        confirmText: "Open wallet",
      });
      if (!approved) {
        finalBillingStatus = ["Card pack checkout canceled.", false];
        setBillingStatus(finalBillingStatus[0], finalBillingStatus[1]);
        return;
      }
      setBillingStatus("Confirm the card pack payment in your wallet...", false);
      const payment = await client.paySolanaQuote(data);
      const signature = payment && payment.signature ? payment.signature : "";
      showPackMintProgress("Payment signed. Confirming your Ruby High pack...");
      setBillingStatus("Payment sent. Confirming pack...", false);
      await confirmSolanaPayment(productId, signature, payment && payment.walletAddress, data);
    } catch (err) {
      hidePackMintProgress();
      finalBillingStatus = ["Card pack checkout failed · " + friendlySolanaActionError(err, "If your wallet already signed, keep this wallet connected and try again in a minute."), true];
      setBillingStatus(finalBillingStatus[0], finalBillingStatus[1]);
      setPrivyStatus(finalBillingStatus[0], finalBillingStatus[1]);
    } finally {
      billingBusy = false;
      renderAccountPage();
      if (billingProductsCache) renderBillingProducts(billingProductsCache);
      if (finalBillingStatus) setBillingStatus(finalBillingStatus[0], finalBillingStatus[1]);
    }
  }

  async function ensureSolanaWalletForBilling() {
    if (connectedSolanaWalletAddress()) return true;
    if (!privyConfig) throw new Error("Card pack checkout is not configured.");
    if (!privyState.authenticated) {
      setBillingStatus("Opening sign-in for card pack checkout...", false);
      const loginSnapshot = await startPrivyLogin({ source: "billing" });
      if (!loginSnapshot && !privyState.authenticated) return false;
    }
    if (connectedSolanaWalletAddress()) return true;
    setBillingStatus("Opening wallet connection for card pack checkout...", false);
    const approved = await confirmWalletTransactionPreview({
      title: "Connect Solana wallet?",
      action: "Connect wallet",
      cost: "None",
      prompt: "Your wallet should ask to connect an address only.",
      copy: "Ruby High will ask Privy for a Solana wallet address. This is not a transaction.",
      confirmText: "Connect wallet",
    });
    if (!approved) return false;
    const walletSnapshot = await startSolanaWalletConnect({ source: "billing" });
    return !!walletSnapshot && !!connectedSolanaWalletAddress();
  }

  async function confirmSolanaPayment(productId, signature, ownerWalletAddress, quote) {
    const cleanSignature = String(signature || "").trim();
    if (!productId || !cleanSignature) throw new Error("Wallet did not return a Solana payment confirmation.");
    const maxAttempts = 10;
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) await waitForSolanaConfirmation(1500 + attempt * 500);
      const statusText = attempt === 0 ? "Checking Solana payment..." : "Waiting for Solana confirmation...";
      updatePackMintProgress(attempt === 0 ? "Checking the Solana receipt..." : "Waiting for block confirmation...");
      setBillingStatus(statusText, false);
      const r = await apiFetch(apiBase + "/billing/solana/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 30000,
        body: JSON.stringify({
          productId,
          signature: cleanSignature,
          ownerWalletAddress: ownerWalletAddress || null,
          packAssetAddress: quote && quote.assetAddress ? quote.assetAddress : null,
          packMetadataUri: quote && quote.metadataUri ? quote.metadataUri : null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data || !data.ok) {
        lastError = new Error(nftHttpErrorMessage("Card pack confirmation", r, data, "If your wallet already signed, keep this wallet connected and try again in a minute."));
        if ([400, 425, 502, 503].includes(r.status) && /not found yet|not found on-chain|try again|rpc|temporar|confirmation/i.test(lastError.message) && attempt + 1 < maxAttempts) continue;
        throw lastError;
      }
      const packText = data && Number(data.packCount || 0) > 0
        ? packCountLabel(Number(data.packCount || 0))
        : "Pack";
      const paidProduct = {
        ...((quote && quote.product) || {}),
        packCount: data.packCount || (quote && quote.product && quote.product.packCount),
        cardCount: data.cardCount || (quote && quote.product && quote.product.cardCount),
        tokenAmount: data.tokenAmount || (quote && quote.product && quote.product.tokenAmount),
        tokenSymbol: data.tokenSymbol || (quote && quote.product && quote.product.tokenSymbol) || (quote && quote.symbol),
      };
      setBillingStatus(
        (data.applied ? packText + " minted · " : packText + " already minted · ") + cardPackPaymentDeltaLabel(paidProduct, quote),
        false,
      );
      updatePackMintProgress(data.applied ? "Pack minted. Filing it in your locker..." : "Pack already minted. Updating your locker...");
      hidePackMintProgress(900);
      await fetchSession();
      await deriveAuth();
      await syncWalletPackNftsFromAccount({ force: true, quiet: true });
      if (billingProductsCache) await loadBillingProducts();
      return;
    }
    throw lastError || new Error("Solana verification failed.");
  }

  function waitForSolanaConfirmation(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function activeMintedHallPassCardsForWallet(ownerWalletAddress) {
    const owner = String(ownerWalletAddress || connectedSolanaWalletAddress() || "").trim();
    if (!owner) return [];
    return hallPassCardsForTelemetry()
      .filter((card) => (
        card.status === "active" &&
        card.mintAddress &&
        card.mintSignature &&
        card.ownerWalletAddress === owner
      ))
      .sort((a, b) => Number(a.issuedAt || 0) - Number(b.issuedAt || 0) || Number(a.serial || 0) - Number(b.serial || 0));
  }

  function selectHallPassCardsForBurn(cards, needed) {
    const choices = Array.isArray(cards) ? cards.slice() : [];
    const count = positiveWholeNumber(needed, 1);
    if (choices.length < count) return Promise.resolve(null);
    return new Promise((resolve) => {
      const previousFocus = document.activeElement && typeof document.activeElement.focus === "function"
        ? document.activeElement
        : null;
      const selectedIds = new Set();
      const overlay = document.createElement("div");
      overlay.className = "card-burn-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      const panel = document.createElement("div");
      panel.className = "card-burn-panel";
      const kicker = document.createElement("div");
      kicker.className = "card-burn-kicker";
      kicker.textContent = "Choose card burn";
      const title = document.createElement("h2");
      title.textContent = count === 1 ? "Pick a card to burn" : "Pick " + count + " cards to burn";
      const copy = document.createElement("p");
      copy.textContent = "Each selected card leaves your wallet and credits 5 Hall Passes.";
      const grid = document.createElement("div");
      grid.className = "card-burn-grid";
      const actions = document.createElement("div");
      actions.className = "card-burn-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "secondary";
      cancel.textContent = "Cancel";
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "primary";
      confirm.disabled = true;
      confirm.textContent = count === 1 ? "Burn Card" : "Burn " + count + " Cards";

      function escapedCardId(id) {
        if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(id || ""));
        return String(id || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      }
      function cleanup(result) {
        document.removeEventListener("keydown", onKeyDown);
        overlay.removeEventListener("click", onOverlayClick);
        overlay.remove();
        if (previousFocus && previousFocus.isConnected) {
          try { previousFocus.focus({ preventScroll: true }); } catch (_err) { try { previousFocus.focus(); } catch (_focusErr) {} }
        }
        resolve(result);
      }
      function updateConfirm() {
        confirm.disabled = selectedIds.size !== count;
      }
      function toggleCard(card, button) {
        if (selectedIds.has(card.id)) {
          selectedIds.delete(card.id);
          button.classList.remove("is-selected");
          button.setAttribute("aria-pressed", "false");
        } else {
          if (selectedIds.size >= count) {
            const first = selectedIds.values().next().value;
            selectedIds.delete(first);
            const firstButton = grid.querySelector("[data-card-id='" + escapedCardId(first) + "']");
            if (firstButton) {
              firstButton.classList.remove("is-selected");
              firstButton.setAttribute("aria-pressed", "false");
            }
          }
          selectedIds.add(card.id);
          button.classList.add("is-selected");
          button.setAttribute("aria-pressed", "true");
        }
        updateConfirm();
      }
      function onOverlayClick(event) {
        if (event.target === overlay) cleanup(null);
      }
      function onKeyDown(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          cleanup(null);
        }
      }

      choices.forEach((card) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "card-burn-choice";
        button.dataset.cardId = card.id;
        button.setAttribute("aria-pressed", "false");
        const thumb = document.createElement("span");
        thumb.className = "card-burn-thumb";
        const img = document.createElement("img");
        img.alt = "";
        img.src = hallPassCardArtUrl(card);
        thumb.appendChild(img);
        const text = document.createElement("span");
        text.className = "card-burn-choice-text";
        const name = document.createElement("strong");
        name.textContent = displayCardText(card.characterName || card.title, "Ruby High Card");
        const meta = document.createElement("span");
        meta.textContent = displayCardText(card.title, "Collectible Card");
        text.appendChild(name);
        text.appendChild(meta);
        button.appendChild(thumb);
        button.appendChild(text);
        button.addEventListener("click", () => toggleCard(card, button));
        grid.appendChild(button);
      });
      cancel.addEventListener("click", () => cleanup(null));
      confirm.addEventListener("click", () => {
        const selected = choices.filter((card) => selectedIds.has(card.id)).slice(0, count);
        cleanup(selected.length === count ? selected : null);
      });
      actions.appendChild(cancel);
      actions.appendChild(confirm);
      panel.appendChild(kicker);
      panel.appendChild(title);
      panel.appendChild(copy);
      panel.appendChild(grid);
      panel.appendChild(actions);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      overlay.addEventListener("click", onOverlayClick);
      document.addEventListener("keydown", onKeyDown);
      setTimeout(() => {
        const first = grid.querySelector("button");
        try { (first || cancel).focus({ preventScroll: true }); } catch (_err) { (first || cancel).focus(); }
      }, 0);
    });
  }

  async function burnHallPassCardsForSpend(count, opts) {
    const needed = positiveWholeNumber(count, 1);
    if (needed <= 0) return [];
    if (!connectedSolanaWalletAddress()) {
      const connected = await ensureSolanaWalletForBilling();
      if (!connected) throw new Error("Connect a Solana wallet before burning a card.");
    }
    const ownerWalletAddress = connectedSolanaWalletAddress();
    const cards = activeMintedHallPassCardsForWallet(ownerWalletAddress);
    if (cards.length < needed) {
      throw new Error("No minted card is available to burn from this wallet.");
    }
    const client = await getPrivyClient();
    if (!client || typeof client.signAndSendSolanaTransaction !== "function") {
      throw new Error("Solana card burn is unavailable.");
    }
    if (opts && typeof opts.status === "function") {
      opts.status("Choose " + (needed === 1 ? "a card" : needed + " cards") + " to burn...", false);
    }
    const presetCards = opts && Array.isArray(opts.presetCards) ? opts.presetCards.filter(Boolean).slice(0, needed) : [];
    const selectedCards = presetCards.length === needed
      ? presetCards
      : await selectHallPassCardsForBurn(cards, needed);
    if (!selectedCards) throw new Error("Card burn canceled.");
    if (opts && typeof opts.status === "function") {
      opts.status(
        "Opening wallet to burn " + needed + " card" + (needed === 1 ? "" : "s") + "...",
        false,
      );
    }
    const burns = [];
    for (let index = 0; index < selectedCards.length; index += 1) {
      const selectedCard = selectedCards[index];
      if (opts && typeof opts.status === "function") {
        opts.status(
          "Opening wallet to burn card " + (index + 1) + " of " + selectedCards.length + "...",
          false,
        );
      }
      const r = await apiFetch(apiBase + "/nft/burn-prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 15000,
        body: JSON.stringify({ cardIds: [selectedCard.id], ownerWalletAddress }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data || !data.ok || !data.burn) {
        throw new Error(nftHttpErrorMessage("Card burn", r, data, "Your card was not burned; try again in a minute."));
      }
      const preparedCard = Array.isArray(data.cards) && data.cards.length > 0
        ? data.cards[0]
        : {
          cardId: data.cardId || selectedCard.id,
          characterId: data.characterId || selectedCard.characterId,
          characterName: data.characterName || selectedCard.characterName,
          mintAddress: data.mintAddress || data.burn.mintAddress,
        };
      if (!preparedCard || !preparedCard.cardId || !preparedCard.mintAddress) {
        throw new Error("Card burn changed before signing.");
      }
      const approved = await confirmWalletTransactionPreview({
        title: selectedCards.length === 1 ? "Burn this card?" : "Burn card " + (index + 1) + " of " + selectedCards.length + "?",
        action: "Burn card for Hall Passes",
        walletAddress: ownerWalletAddress,
        cost: "Burn 1 minted card",
        credit: hallPassCostLabel(hallPassBurnCreditForCards(1)),
        card: preparedCard.characterName || selectedCard.characterName || "Ruby High Card",
        reference: preparedCard.mintAddress,
        prompt: "Your wallet should show one card-burn transaction.",
        copy: "This permanently burns the NFT card. Ruby High credits Hall Passes after the burn confirms.",
        confirmText: "Open wallet",
        tone: "danger",
      });
      if (!approved) {
        if (opts && typeof opts.status === "function") opts.status("Card burn canceled.", false);
        throw new Error("Card burn canceled.");
      }
      const payment = await client.signAndSendSolanaTransaction(data.burn);
      const burn = {
        cardId: preparedCard.cardId,
        ownerWalletAddress: payment.walletAddress || ownerWalletAddress,
        mintAddress: preparedCard.mintAddress,
        burnSignature: payment.signature,
      };
      await confirmHallPassCardBurn(burn);
      burns.push(burn);
    }
    return burns;
  }

  async function convertHallPassCardsToHallPasses(count, opts) {
    const hallPassesNeeded = positiveWholeNumber(count, 1);
    const needed = hallPassBurnCardsRequired(hallPassesNeeded);
    const expectedCredit = hallPassBurnCreditForCards(needed);
    const status = opts && typeof opts.status === "function" ? opts.status : setBillingStatus;
    status("Burning " + needed + " card" + (needed === 1 ? "" : "s") + " for " + hallPassCostLabel(expectedCredit) + "...", false);
    const burns = await burnHallPassCardsForSpend(needed, opts);
    let data = null;
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await waitForSolanaConfirmation(1200 + attempt * 500);
      const r = await apiFetch(apiBase + "/billing/card-burn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 15000,
        body: JSON.stringify({ hallPassBurns: burns }),
      });
      data = await r.json().catch(() => ({}));
      if (r.ok && data && data.ok) {
        const amount = Math.max(0, Math.floor(Number(data.amount || expectedCredit)));
        status("Added " + hallPassCostLabel(amount) + " from " + needed + " burned card" + (needed === 1 ? "" : "s") + ".", false);
        await fetchSession();
        await deriveAuth();
        renderAccountPage();
        if (billingProductsCache) renderBillingProducts(billingProductsCache);
        return data;
      }
      lastError = new Error(nftHttpErrorMessage("Card burn credit", r, data, "If your wallet already signed, keep this wallet connected and try again in a minute."));
      if (!/not found yet|confirmation|try again|rpc/i.test(lastError.message) || attempt === 3) throw lastError;
      status("Waiting for card burn confirmation...", false);
    }
    throw lastError || new Error("Card burn could not be credited.");
  }

  async function confirmHallPassCardBurn(burn) {
    let lastError = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (attempt > 0) await waitForSolanaConfirmation(1200 + attempt * 500);
      const r = await apiFetch(apiBase + "/nft/burn-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 15000,
        body: JSON.stringify(burn),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data && data.ok) return data;
      lastError = new Error(nftHttpErrorMessage("Card burn confirmation", r, data, "If your wallet already signed, keep this wallet connected and try again in a minute."));
      if (!/not found yet|confirmation|try again|rpc/i.test(lastError.message)) break;
    }
    throw lastError || new Error("Card burn could not be confirmed.");
  }

  function accountAiAccessSuccessText(data) {
    const hostedAi = data && data.hosted_ai && typeof data.hosted_ai === "object"
      ? data.hosted_ai
      : data && data.entitlements && data.entitlements.hosted_ai && typeof data.entitlements.hosted_ai === "object"
        ? data.entitlements.hosted_ai
        : null;
    return "AI access is on for " + formatDuration(hostedAi && hostedAi.durationMs || 604_800_000) + ".";
  }

  async function activateAiPass(opts) {
    if (billingBusy) return;
    const fromAccount = !!(opts && opts.source === "account");
    billingBusy = true;
    renderAccountPage();
    if (billingProductsCache) renderBillingProducts(billingProductsCache);
    try {
      const aiStatus = hostedAiTelemetry(lastTelemetry || {});
      if (aiStatus.active) {
        const message = "AI access is already active.";
        setBillingStatus(message, false);
        if (fromAccount) setPrivyStatus(message, false);
        return;
      }
      const aiCost = aiStatus.cost;
      const useHallPass = canSpendHallPasses(aiCost);
      if (!useHallPass) {
        await promptForHallPasses({
          title: "Need Hall Passes",
          copy: "AI Access needs " + hallPassCostLabel(aiCost) + ". Buy Hall Passes or burn a Card first.",
          detail: "Card burns now live on the Buy Hall Passes page.",
        });
        const message = "Buy Hall Passes or burn a Card first.";
        setBillingStatus(message, true);
        if (fromAccount) setPrivyStatus(message, true);
        return;
      }
      if (fromAccount) setPrivyStatus("Using Hall Pass for AI access...", false);
      setBillingStatus("Using Hall Pass for AI access...", false);
      let data = null;
      let lastError = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt > 0) await waitForSolanaConfirmation(1500 + attempt * 500);
        const r = await apiFetch(apiBase + "/billing/ai-pass", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          timeoutMs: 12000,
          body: JSON.stringify({}),
        });
        data = await r.json().catch(() => ({}));
        if (r.ok && data && data.ok) {
          lastError = null;
          break;
        }
        lastError = new Error(data.error || "AI pass " + r.status);
        if (!/not found yet|try again|rpc/i.test(lastError.message) || attempt === 3) throw lastError;
        setBillingStatus("Waiting for card burn confirmation...", false);
        if (fromAccount) setPrivyStatus("Waiting for card burn confirmation...", false);
      }
      if (lastError) throw lastError;
      const message = data.applied ? accountAiAccessSuccessText(data) : "AI access is already active.";
      setBillingStatus(message, false);
      if (fromAccount) setPrivyStatus(message, false);
      await fetchSession();
      await deriveAuth();
      renderAccountPage();
      if (billingProductsCache) renderBillingProducts(billingProductsCache);
    } catch (err) {
      const message = "AI access failed · " + (err && err.message ? err.message : "error");
      setBillingStatus(message, true);
      if (fromAccount) setPrivyStatus(message, true);
    } finally {
      billingBusy = false;
      renderAccountPage();
      if (billingProductsCache) renderBillingProducts(billingProductsCache);
    }
  }

  function consumeBillingReturnFlag() {
    try {
      const url = new URL(window.location.href);
      const result = url.searchParams.get("billing");
      if (result === "success") {
        showCongrats("Pack checkout complete.", true);
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

  // Inbound half of the share loop: a `?ref=` param means this visit arrived
  // from a shared artifact. Record the click, stash the ref so the app_open
  // event can attribute the session, then strip it from the URL.
  let referralRef = "";
  function consumeReferralFlag() {
    try {
      const url = new URL(window.location.href);
      const ref = url.searchParams.get("ref");
      if (!ref) return;
      referralRef = ref.slice(0, 120);
      postViewerMetricEvent("share_link_visited", { ref: referralRef, landing: url.pathname });
      url.searchParams.delete("ref");
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
  // original pack that's Ruby/Sally/Edward; for a generated/imported pack
  // it's that pack's teacher roster. Without this the lounge
  // would always show the original-pack portraits regardless of which
  // pack the player is on. Teachers without portrait assets fall back
  // to a deterministic accent-tinted initial placeholder on the 404.
  let lastLoungeSig = "";
  function renderLoungeFigures() {
    const t = lastTelemetry || {};
    const roster = (t.faculty_roster || []).filter((f) => f && f.id !== LOUNGE_ID);
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
    const isLounge = !!((faculty && faculty.id === LOUNGE_ID) || (!faculty && lastTelemetry && lastTelemetry.faculty === LOUNGE_ID));
    if (isLounge) {
      // Lounge mode: hide blackboard and show the faculty lounge roster.
      // Keep the compact guest-teacher panel and do not carry over
      // stale classroom start/progress chrome above it.
      setLoungeMode(true);
      renderTeacherFigure(null);
      els.blackboardPanel.dataset.faculty = LOUNGE_ID;
      showBlackboardEmpty(true);
      els.blackboardPanel.classList.remove("is-long-prompt", "is-essay-prompt");
      els.blackboardEmptyText.replaceChildren();
      if (els.blackboardEmptyAction) els.blackboardEmptyAction.hidden = true;
      const extras = ensureBlackboardEmptyExtras();
      extras.replaceChildren();
      const spotlight = buildGuestSpotlight(lastTelemetry);
      if (spotlight) {
        extras.appendChild(spotlight);
      } else {
        els.blackboardEmptyText.textContent = "No guest teacher is scheduled this week.";
      }
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
        if (els.blackboardEmptyAction) els.blackboardEmptyAction.hidden = true;
      } else if (!lastTelemetry?.character) {
        els.blackboardEmptyText.textContent = "Create your first Ruby High student.";
        if (els.blackboardEmptyAction) {
          els.blackboardEmptyAction.textContent = "Lock it in";
          els.blackboardEmptyAction.hidden = false;
        }
      } else if (lastTelemetry && lastTelemetry.graduation_ready) {
        els.blackboardEmptyText.textContent = "Requirements complete. Pick a level-up reward to seal the year.";
        if (els.blackboardEmptyAction) els.blackboardEmptyAction.hidden = true;
      } else if (guestSignupRequired(lastTelemetry)) {
        els.blackboardEmptyText.textContent = guestSignupMessage(lastTelemetry);
        if (els.blackboardEmptyAction) {
          els.blackboardEmptyAction.textContent = "Sign up";
          els.blackboardEmptyAction.hidden = false;
        }
      } else {
        // Surface the "what you need" hint here too so the empty board
        // is informative instead of "the teacher will be with you in a
        // moment" forever. The hint comes second — the lead is still
        // the room's status, the hint is the actionable detail.
        const hint = lastTelemetry && lastTelemetry.character ? buildNextStepHint(lastTelemetry.character) : "";
        const progress = lastTelemetry && lastTelemetry.active_course_progress;
        const todayDone = progress && progress.today && progress.today.status === "complete";
        const todayActive = progress && progress.today && progress.today.status === "active";
        const teacherName = faculty ? teacherShortName(faculty, "today's teacher") : "today's teacher";
        const advanceLabel = teacherChatEnabled() ? "Chat" : "Continue";
        const lead = todayDone
          ? "Today's graded class is complete. Practice is open."
          : todayActive
            ? "Continue today's class — tap " + advanceLabel + " to start."
            : "Start today's graded class — tap " + advanceLabel + " to start.";
        const welcome = showWelcomeBackCopy ? "Welcome back — " + teacherName + " is ready. " : "";
        const infoText = hint ? welcome + lead + " " + hint : welcome + lead;
        const statusText = todayDone
          ? "Class complete · practice open"
          : todayActive
            ? "Class in progress"
            : "Today's class ready";
        els.blackboardEmptyText.replaceChildren(buildBoardClassStartHeader(statusText, infoText));
        if (els.blackboardEmptyAction) {
          els.blackboardEmptyAction.textContent = todayActive ? "Continue today's class" : "Start today's class";
          els.blackboardEmptyAction.hidden = !!todayDone;
        }
      }
      // Drop any previous lounge/card extras; classroom status now lives in
      // the compact header above the start button.
      const extras = ensureBlackboardEmptyExtras();
      extras.replaceChildren();
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
    const promptLines = promptText.split(/\n/).length;
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
      if (String(text).includes("\n")) hasLineBreakAnswer = true;
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
      : "Connect AI to generate multiple-choice distractors";
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
  function roomCompletionProgress(fac) {
    if (!fac) return null;
    const total = Math.max(0, Math.floor(Number(fac.requiredClasses || 0)));
    if (total <= 0) return null;
    const value = Math.max(0, Math.min(Math.floor(Number(fac.completedClasses || 0)), total));
    return { value, total };
  }
  function roomCompletionLabel(fac, progress) {
    const roomName = (fac && (fac.shortName || fac.displayName)) || "Room";
    return roomName + " daily classes " + progress.value + " of " + progress.total;
  }
  function buildRoomCompletionMeter(fac) {
    const progress = roomCompletionProgress(fac);
    if (!progress) return null;
    const meter = document.createElement("span");
    meter.className = "student-year-meter room-completion-meter";
    const label = roomCompletionLabel(fac, progress);
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
        + ":" + (f.assetTeacherId || "") + ":" + (f.profileImageUrl || "")
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
      const isActive = !!(fac && t.faculty === fac.id);
      const row = document.createElement("button");
      row.className = "channel-row room-row" + (isActive ? " is-active" : "");
      row.dataset.faculty = fac ? fac.id : "";
      if (fac) {
        const thumb = document.createElement("span");
        thumb.className = "teacher-thumb";
        thumb.title = "Open " + fac.displayName + "'s card";
        thumb.style.cursor = "pointer";
        thumb.addEventListener("click", (e) => { e.stopPropagation(); openTeacherProfile(fac.id); });
        const thumbUrl = teacherSmallAvatarUrl(fac);
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
      const meta = document.createElement("span");
      meta.className = "room-row-meta";
      const name = document.createElement("span");
      name.className = "room-row-name";
      name.textContent = room.channelName;
      meta.appendChild(name);
      if (fac) {
        const meter = buildRoomCompletionMeter(fac);
        if (meter) meta.appendChild(meter);
      }
      row.appendChild(meta);
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
  function greetingFor(fac, grade, hasCharacter) {
    const year = grade ? (GRADE_LABELS[grade] || ("Grade " + grade)) : "Ruby High";
    if (!hasCharacter) {
      if (fac.id === "ruby") return "Welcome to Ruby High. Make your first student, then I’ll put the first question on the board.";
      if (fac.id === "sally-science") return "Science starts better with a lab partner. Create your student, then bring them by the lab.";
      if (fac.id === "professor-edward") return "No protagonist, no literature. Create your student first; then we can talk motives.";
      return "Create your first student, then class can begin.";
    }
    if (fac.id === "ruby") return "Welcome to " + year + " homeroom. First bell is simple: read the board, make the call, learn from the miss.";
    if (fac.id === "sally-science") return year + " science means evidence first. I’ll ask for the pattern; you bring the nerve.";
    if (fac.id === "professor-edward") return year + " literature starts with attention. The question is usually hiding in the sentence everyone skips.";
    return "Class is in session. Your teacher is ready when you are.";
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
        appendMsg({ kind: "teacher", name: fac.displayName, body: greetingFor(fac, grade, !!(lastTelemetry && lastTelemetry.character)), color: fac.accent, facultyId: fac.id });
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
        appendSystem("Connect AI to eavesdrop on the faculty.");
      }
    }
    closeRails();
  }
  async function startPostClassPractice(postClass) {
    if (!postClass || !postClass.report) return false;
    if (guestSignupRequired(lastTelemetry)) {
      await promptGuestSignup();
      return true;
    }
    const manualTurn = turnController.beginManual();
    if (!manualTurn) return true;
    const reportKey = classReportKey(lastTelemetry);
    if (reportKey) dismissedClassReportKey = reportKey;
    try {
      const data = await command({
        type: "pick",
        mode: "practice",
        faculty: lastTelemetry && lastTelemetry.faculty,
      });
      if (data && !data.noQuestionDue) {
        lockedFor = null;
        return true;
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
          if (!walletNumbers(lastTelemetry).hallPasses) {
            await promptForHallPasses({
              title: "No Hall Passes yet",
              copy: "Hints and teacher chat need AI access. Visit Hall Passes for the free starter grant, or answer the board and keep playing free.",
              detail: "Free play does not spend Hall Passes.",
            });
          } else {
            appendSystem("Answer the board to continue. Connect AI for hints.");
          }
          return;
        }
        if (phase === "lounge") {
          if (!walletNumbers(lastTelemetry).hallPasses) {
            await promptForHallPasses({
              title: "No Hall Passes yet",
              copy: "Lounge chat needs AI access. Visit Hall Passes for the free starter grant, or keep playing classes free.",
              detail: "The classroom loop stays available without AI chat.",
            });
          } else {
            appendSystem("Connect AI to hear the lounge conversation continue.");
          }
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
        await command({ type: "clear" });
        lockedFor = null;
        return;
      }
      await runPlayerChatTurn("class");
    } finally {
      buttonTurn.finish();
    }
  }

  function handleBlackboardEmptyAction() {
    if (!lastTelemetry || !lastTelemetry.character) {
      openCharacterCreation();
      return;
    }
    if (guestSignupRequired(lastTelemetry)) {
      void promptGuestSignup();
      return;
    }
    void pickNext();
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

  // ── morning announcements (PA system) ──────────────────────────────────
  function getTodayDateKey() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function shouldShowMorningAnnouncements() {
    try {
      const last = localStorage.getItem(ANNOUNCEMENTS_LAST_KEY);
      return last !== getTodayDateKey();
    } catch (_e) { return true; }
  }

  function markAnnouncementsSeen() {
    try { localStorage.setItem(ANNOUNCEMENTS_LAST_KEY, getTodayDateKey()); } catch (_e) {}
  }

  function showMorningAnnouncements(t) {
    if (morningAnnouncementsShown) return;
    if (!shouldShowMorningAnnouncements()) return;
    morningAnnouncementsShown = true;

    const overlay = document.getElementById("announcements-overlay");
    if (!overlay) return;
    announcementsOverlay = overlay;

    // Logo
    const logo = document.getElementById("announcements-logo");
    if (logo) logo.src = ANNOUNCEMENTS_LOGO_URL;

    // Date
    const dateEl = document.getElementById("announcements-date");
    if (dateEl) {
      const now = new Date();
      const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      dateEl.textContent = days[now.getDay()] + ", " + months[now.getMonth()] + " " + now.getDate();
    }

    // Title
    const titleEl = document.getElementById("announcements-title");
    const bodyEl = document.getElementById("announcements-body");
    const notesEl = document.getElementById("announcements-notes");

    const hasCharacter = !!(t && t.character);
    const streak = (t && t.streak) || 0;
    const todayFaculty = t && t.faculty_roster && Array.isArray(t.faculty_roster)
      ? t.faculty_roster.find(function(f) { return f.id === t.faculty; })
      : null;
    const facultyName = todayFaculty ? (todayFaculty.name || "Ruby") : "Ruby";
    const grade = t && t.current_grade;
    const gradeLabel = grade ? ("Grade " + grade) : "";

    // Notes: guest faculty, books, comic pages
    var notes = [];
    var guestPack = t && t.guest_pack && t.guest_pack.auto;
    if (guestPack && guestPack.teacher_name) {
      notes.push({ icon: "📚", text: "<strong>Guest Faculty:</strong> " + escapeHtml(guestPack.teacher_name) + " — " + escapeHtml(guestPack.name || guestPack.subject || "guest class") });
    }
    notes.push({ icon: "📖", text: "<strong>Books:</strong> <em>Qiao</em> and <em>Egregoregramming 101</em> on Gumroad" });

    if (!hasCharacter) {
      // First visit — welcome
      if (titleEl) titleEl.textContent = "Welcome to Ruby High";
      if (bodyEl) {
        bodyEl.innerHTML =
          "<p>A new question every day. Three teachers — Ruby, Sally Science, and Professor Edward — grade what you actually say.</p>" +
          "<p>Six classmates run their own arcs beside you. Every grade you finish goes in the yearbook. It takes four years to graduate.</p>" +
          "<p>Class starts at <strong>17:00 UTC</strong>. Today's teacher is <strong>" + escapeHtml(facultyName) + "</strong>. Roll a student and take your seat.</p>";
      }
      if (notesEl) notesEl.innerHTML = notes.map(function(n) {
        return "<div class=\"announcements-note\"><span class=\"announcements-note-icon\">" + n.icon + "</span><span>" + n.text + "</span></div>";
      }).join("");
    } else {
      // Returning student — daily briefing
      if (titleEl) titleEl.textContent = "Morning Announcements";
      var bodyParts = [];
      bodyParts.push("<p>Good morning, <strong>" + escapeHtml(t.character.name || "student") + "</strong>. Welcome back to Ruby High.</p>");
      if (facultyName) {
        bodyParts.push("<p>Today's class: <strong>" + escapeHtml(facultyName) + "</strong>" + (gradeLabel ? " · " + escapeHtml(gradeLabel) : "") + "</p>");
      }
      if (streak > 0) {
        bodyParts.push("<p>Your streak: <span class=\"announcement-streak\">" + streak + " day" + (streak !== 1 ? "s" : "") + "</span></p>");
      } else {
        bodyParts.push("<p>No active streak yet — today is a fresh start.</p>");
      }
      if (bodyEl) bodyEl.innerHTML = bodyParts.join("");
      if (notesEl) notesEl.innerHTML = notes.map(function(n) {
        return "<div class=\"announcements-note\"><span class=\"announcements-note-icon\">" + n.icon + "</span><span>" + n.text + "</span></div>";
      }).join("");
    }

    overlay.hidden = false;
  }

  function dismissAnnouncements() {
    markAnnouncementsSeen();
    if (announcementsOverlay) {
      announcementsOverlay.hidden = true;
    }
  }


  // ── onboarding / first-visit intro ──────────────────────────────────────
  let onboardingShown = false;
  function showOnboarding() {
    if (onboardingShown) return;
    onboardingShown = true;
    const actions = document.getElementById("onboarding-actions");
    if (actions) actions.hidden = false;
    // Hide the create-character fallback button — the onboarding
    // "Roll a student" button replaces it.
    const emptyAction = document.getElementById("blackboard-empty-action");
    if (emptyAction) emptyAction.hidden = true;
  }

  function render(s) {
    if (!s || !s.telemetry) return;
    const t = s.telemetry;
    lastTelemetry = t;
    syncAiStateFromTelemetry(t);
    syncBillingWallet(t);
    renderAccountPage();
    if (teacherChatEnabled() && t.faculty && (!renderedHistorySig || !renderedHistorySig.startsWith(t.faculty + ":"))) {
      loadHistory(t.faculty);
    }
    applyViewMode(deriveViewMode(t));
    // Morning announcements — shown once per day on first visit.
    // Fires after the first telemetry tick, before class content renders.
    showMorningAnnouncements(t);

    if (authed && !t.character && !firstRunCreationOpened) {
      firstRunCreationOpened = true;
      // If a class is already live, jump straight to character creation
      // so the teacher isn't hidden behind an intro screen.
      if (t.current || t.active_round || (t.daily && t.daily.available)) {
        setTimeout(() => openCharacterCreation(), 0);
      } else {
        showOnboarding();
      }
    }
    // Always show account/pack buttons so a visitor can support immediately.
    if (els.packBtn) els.packBtn.hidden = false;
    if (els.hallPassBtn) els.hallPassBtn.hidden = false;

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

    // Post-class continuation: if the player just completed their first daily
    // class and has no prior streak, show a "what now?" toast.
    if (
      t.character
      && t.post_class
      && t.post_class.report
      && t.post_class.report.score !== undefined
      && !lastPostClassToastShown
    ) {
      const streak = t.streak || 0;
      const facultyName = (t.faculty_roster || []).find((f) => f.id === t.faculty)?.name || "your teacher";
      const nextFaculty = getNextFacultyName(t);
      if (streak <= 1) {
        // First completed class — guide them.
        lastPostClassToastShown = true;
        const msg = nextFaculty
          ? "Class dismissed. " + facultyName + " graded your work. " + nextFaculty + " teaches tomorrow at 17:00 UTC. Come back for your streak."
          : "Class dismissed. " + facultyName + " graded your work. Come back tomorrow at 17:00 UTC.";
        showCongrats(msg, true, 9000);
      }
    }

    lastYearbookLen = t.character && Array.isArray(t.character.yearbook) ? t.character.yearbook.length : 0;

    // Header
    const fac = (t.faculty_roster || []).find((f) => f.id === t.faculty);
    els.channelTitle.textContent = channelTitleFor(t, fac);
    const subjectProgress = t.active_course_progress;
    const subjectStatus = subjectProgress
      ? subjectStatusText(subjectProgress)
      : (t.current_grade ? "Grade " + t.current_grade : "settling in");
    els.channelSub.textContent = t.faculty === LOUNGE_ID
      ? "teachers' lounge"
      : fac
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
        if (f) appendMsg({ kind: "teacher", name: f.displayName, body: greetingFor(f, t.current_grade, !!t.character), color: f.accent, facultyId: f.id });
      }
    }

    if (!t.character) {
      if (els.youName) els.youName.textContent = "Create character";
      if (els.youAvatar) {
        els.youAvatar.innerHTML = "";
        els.youAvatar.textContent = "+";
      }
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
  const SUBJECT_GATE_ICONS = { ruby: "⌂", "sally-science": "⚗", "professor-edward": "✎", guest: "☆" };
  function subjectGateMetaFor(fid, progress) {
    return {
      facultyId: fid,
      label: subjectDisplayName(fid, progress),
      icon: SUBJECT_GATE_ICONS[fid] || "□",
    };
  }
  function subjectGateMetaList() {
    return teachingFacultyIdsForSummary().map((fid) => subjectGateMetaFor(fid, subjectProgressForFaculty(fid)));
  }
  function makeSubjectGradeChip(spec) {
    const grade = spec.grade || "—";
    const met = spec.met !== undefined ? !!spec.met : (grade === "✓" || letterGradePasses(grade));
    const pending = !!spec.pending && !met;
    const chip = document.createElement("span");
    chip.className = "subject-grade-chip" + (met ? " is-met" : "") + (pending ? " is-pending" : "");
    chip.title = pending
      ? spec.label + ": " + grade + " daily classes toward course grade"
      : grade === "—"
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
            const meta = subjectGateMetaFor(cp.facultyId, cp.progress);
            const met = cp.progress
              ? Number(cp.progress.completedClasses || 0) >= Number(cp.progress.requiredClasses || 0) && letterGradePasses(cp.grade)
              : letterGradePasses(cp.grade);
            gates.appendChild(makeGradeChip({
              label: meta.label,
              icon: meta.icon,
              grade: met ? cp.grade : subjectProgressShortLabel(cp.progress),
              met,
              pending: !met,
            }));
          }
        } else {
          for (const meta of subjectGateMetaList()) {
            gates.appendChild(makeGradeChip({
              label: meta.label,
              icon: meta.icon,
              grade: "—",
            }));
          }
        }
      } else {
        if (r.state === "completed") {
          for (const meta of subjectGateMetaList()) {
            gates.appendChild(makeGradeChip({
              label: meta.label,
              icon: meta.icon,
              grade: "✓",
            }));
          }
        } else {
          for (const meta of subjectGateMetaList()) {
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
  function openSheet(options) {
    if (options && options.returnToAccount) returnToAccountAfterSheet = true;
    sheetOverlayOpen = true;
    sheetEl.classList.add("is-open");
    renderSheet();
  }
  function closeSheet() {
    const shouldReturnToAccount = returnToAccountAfterSheet;
    returnToAccountAfterSheet = false;
    sheetOverlayOpen = false;
    sheetEl.classList.remove("is-open");
    if (shouldReturnToAccount && authed) {
      setTimeout(() => { void openPrivyAccount(); }, 0);
    }
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
    if (!getStoredApiKey() && hostedImageEntitlement("diploma")?.configured) return;
    diplomaInFlight = true;
    try {
      const r = await apiFetch("/api/apps/ruby-high/chat/character/diploma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: imageRequestId("diploma") }),
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
  //   2. Daily-class days — later years require more passed school days.
  //   3. Classroom count — each year opens more graduation-counting rooms.
  // The hint surfaces the most-blocking gate as one short sentence.
  function buildNextStepHint(c) {
    if (!c) return "";
    if (graduatedFor(c)) return "You graduated. Keep playing if you want; the arc is done.";
    const t = lastTelemetry || {};
    if (t.graduation_ready || c.pendingGraduation) {
      return "Requirements complete — the graduation ceremony is on the blackboard.";
    }
    const grade = String(t.current_grade ?? "9");
    const gate = t.graduation_gate || {};
    const streakReq = Number(gate.requiredDays || STREAK_REQUIRED[grade] || 1);
    const streakHere = c.streak && c.streak.grade === grade ? c.streak.count : 0;
    const streakLastDate = c.streak && c.streak.grade === grade ? c.streak.lastDate : "";
    const todayKey = (t.daily && t.daily.dailyKey) || "";
    const todayDone = !!(c.streak && c.streak.grade === grade && c.streak.lastDate === todayKey);
    const streakNeeded = Math.max(0, streakReq - streakHere);
    const subjectGaps = subjectClearSummary().grades
      .filter((x) => !letterGradePasses(x.grade));

    const parts = [];
    if (streakNeeded > 0 && !todayDone) {
      parts.push("Pass today's daily class at C or better (" + streakHere + "/" + streakReq + " daily classes)");
    } else if (streakNeeded > 0) {
      parts.push("Daily class counted — " + streakHere + "/" + streakReq + ", come back tomorrow");
    }
    if (Number(gate.openElectiveSlots || 0) > 0) {
      parts.push("Pick " + gate.openElectiveSlots + " elective " + (gate.openElectiveSlots === 1 ? "room" : "rooms"));
    }
    if (subjectGaps.length > 0) {
      const segs = subjectGaps.map((cg) => subjectDisplayName(cg.facultyId, cg.progress) + " (" + subjectProgressShortLabel(cg.progress) + ")");
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
    const currentGate = (lastTelemetry && lastTelemetry.graduation_gate) || {};
    const rungs = ["9", "10", "11", "12"].map((g) => {
      const streakReq = g === currentGrade && currentGate.requiredDays ? Number(currentGate.requiredDays) : (STREAK_REQUIRED[g] || 1);
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

  // nextGradeAfterClient is in client-pure.
  function facultyLabel(fid) {
    const fac = ((lastTelemetry && lastTelemetry.faculty_roster) || []).find((f) => f.id === fid);
    return fac ? (fac.shortName || fac.displayName || fid) : (TEACHING_FACULTY_LABELS[fid] || fid);
  }
  // fmtRewardStat is in client-pure.
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
        note.textContent = "Pick one keepsake or reward to seal the yearbook.";
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

      const photoChoice = {
        label: "Photo",
        detail: "Snap with your top teacher and classmate.",
        reward: { kind: "photo" },
      };
      const seed = (c.pendingGraduation && c.pendingGraduation.readyAt)
        || (ready && ready.readyAt)
        || hashCeremonySeed((c.name || "") + ":" + grade);
      const picked = [photoChoice].concat(seededShuffle(pool, seed).slice(0, 2));
      picked.forEach(({ label, detail, reward }) => addChoice(label, detail, reward));
      return wrap;
    }

  // Fisher-Yates with a deterministic mulberry32 PRNG so the same ceremony
  // (same readyAt) draws the same three rewards every time it re-renders.
  // Without this, polling re-renders would reshuffle the modal under the
  // player's cursor.
  // seededShuffle, hashCeremonySeed are in client-pure.

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

  function studentPoolEntries() {
    const pool = lastTelemetry && Array.isArray(lastTelemetry.student_pool) ? lastTelemetry.student_pool : [];
    return pool
      .filter((entry) => entry && typeof entry === "object" && entry.name)
      .slice()
      .sort((a, b) => Number(b.completedAt || 0) - Number(a.completedAt || 0));
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
        label: "Start next student",
        onClick: async (e) => {
          const btn = e && e.currentTarget;
          if (btn) { btn.disabled = true; btn.textContent = "Starting…"; }
          try {
            const data = await command({ type: "clear-character" });
            if (data && data.session) {
              await fetchSession();
              renderSheet();
              return;
            }
          } catch { /* fall through to re-enable */ }
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Start next student";
          }
        },
      });
      actions.push({
        label: "✨ Try a different look",
        secondary: true,
        onClick: async (e) => {
          const btn = e && e.currentTarget;
          if (btn) { btn.disabled = true; btn.textContent = "✨ Generating…"; }
          try {
            if (!(await confirmHostedCreditSpend("Generate diploma image", "diploma"))) {
              if (btn) { btn.disabled = false; btn.textContent = "✨ Try a different look"; }
              return;
            }
            const diplomaEntitlement = hostedImageEntitlement("diploma") || {};
            const diplomaCost = diplomaEntitlement.cost || 3;
            if (usingHostedImageGeneration("diploma") && !canSpendHallPasses(diplomaCost)) return;
            const r = await apiFetch("/api/apps/ruby-high/chat/character/diploma", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                requestId: imageRequestId("diploma"),
              }),
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

  function buildStudentPoolCard(pool, playbooks) {
    const card = document.createElement("div");
    card.className = "ccg-card is-student-pool-card";
    const role = document.createElement("span");
    role.className = "ccg-role pool";
    role.textContent = "pool";
    card.appendChild(role);

    const body = document.createElement("div");
    body.className = "ccg-body";

    const nameEl = document.createElement("div");
    nameEl.className = "ccg-name";
    nameEl.textContent = "Student Pool";
    body.appendChild(nameEl);

    const sub = document.createElement("div");
    sub.className = "ccg-subtitle";
    sub.textContent = pool.length + " completed " + (pool.length === 1 ? "student" : "students");
    body.appendChild(sub);

    const list = document.createElement("div");
    list.className = "student-pool-list";
    pool.slice(0, 8).forEach((entry) => {
      const pb = playbooks.find((p) => p.id === entry.playbookId)
        || { name: entry.playbookId || "Student", accent: "var(--accent)" };
      const item = document.createElement("div");
      item.className = "student-pool-entry";
      if (pb.accent) item.style.setProperty("--pool-accent", pb.accent);

      const portrait = document.createElement("div");
      portrait.className = "student-pool-portrait";
      const imgUrl = entry.diplomaImageDataUrl || entry.portraitDataUrl || defaultPortraitFor(entry.playbookId);
      if (imgUrl) {
        const img = document.createElement("img");
        img.alt = "";
        img.src = imgUrl;
        portrait.appendChild(img);
      } else {
        portrait.textContent = String(entry.name || "?").slice(0, 1).toUpperCase();
      }
      item.appendChild(portrait);

      const copy = document.createElement("div");
      copy.className = "student-pool-copy";
      const title = document.createElement("div");
      title.className = "student-pool-name";
      title.textContent = entry.name || "Student";
      copy.appendChild(title);
      const meta = document.createElement("div");
      meta.className = "student-pool-meta";
      const yearbookCount = Array.isArray(entry.yearbook) ? entry.yearbook.length : 0;
      meta.textContent = (pb.name || entry.playbookId || "Student") + " · " + yearbookCount + "/4 years · " + formatSealedDate(entry.completedAt);
      copy.appendChild(meta);
      if (entry.flavorQuote || entry.arcAnswer) {
        const quote = document.createElement("div");
        quote.className = "student-pool-quote";
        quote.textContent = "“" + clipEssayText(entry.flavorQuote || entry.arcAnswer, 92) + "”";
        copy.appendChild(quote);
      }
      item.appendChild(copy);
      list.appendChild(item);
    });
    body.appendChild(list);

    if (pool.length > 8) {
      const more = document.createElement("div");
      more.className = "student-pool-more";
      more.textContent = "+" + (pool.length - 8) + " more";
      body.appendChild(more);
    }

    card.appendChild(body);
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
  // essayScoreText, essayLetter are in client-pure.
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
  // clipEssayText is in client-pure.
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
    const activeProgress = t.active_course_progress || {};
    const activeToday = activeProgress.today || {};
    const activeSubject = subjectDisplayName(activeProgress.facultyId || t.faculty, activeProgress);
    const todaySummary = todayCorrectSummary(activeToday);

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
    const gradeLine = subjects.grades
      .map((g) => letterGradePasses(g.grade) ? g.grade : subjectProgressShortLabel(g.progress))
      .join(" ");
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
      addMetric("today", todaySummary.value, activeSubject + " · " + todaySummary.detail, todaySummary.met);
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

  function comicCollectionForTelemetry() {
    const collection = lastTelemetry && lastTelemetry.comic_collection;
    if (!collection || typeof collection !== "object") return null;
    const pages = Array.isArray(collection.unlockedPages) ? collection.unlockedPages : [];
    return {
      issueId: collection.issueId || "first-bell",
      title: collection.title || "Ruby High: Book One - First Bell",
      pageCount: Math.max(1, Math.floor(Number(collection.pageCount || FIRST_BELL_PAGE_COUNT))),
      unlockedPages: pages
        .filter((page) => page && typeof page === "object" && Number.isFinite(Number(page.pageNumber)))
        .map((page) => ({
          ...page,
          pageNumber: Math.floor(Number(page.pageNumber)),
        })),
    };
  }

  function comicPageUrl(pageNumber) {
    const page = String(Math.max(1, Math.floor(Number(pageNumber || 1)))).padStart(2, "0");
    return apiBase + "/assets/comics/first-bell/page-" + page + ".jpg";
  }

  function comicPageTitle(pageNumber) {
    const n = Math.max(1, Math.floor(Number(pageNumber || 1)));
    return FIRST_BELL_PAGE_TITLES[n] || "First Bell";
  }

  function buildComicLocker() {
    const collection = comicCollectionForTelemetry();
    const pageCount = collection ? Math.min(FIRST_BELL_PAGE_COUNT, collection.pageCount) : FIRST_BELL_PAGE_COUNT;
    const unlocked = collection ? collection.unlockedPages : [];
    const byPage = new Map(unlocked.map((page) => [page.pageNumber, page]));
    const wrap = document.createElement("div");
    wrap.className = "comic-locker";

    const head = document.createElement("div");
    head.className = "comic-locker-head";
    const title = document.createElement("div");
    title.className = "comic-locker-title";
    title.textContent = "First Bell Comic";
    const progress = document.createElement("div");
    progress.className = "comic-locker-progress";
    progress.textContent = unlocked.length + "/" + pageCount + " pages";
    head.appendChild(title);
    head.appendChild(progress);
    wrap.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "comic-page-grid";
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const unlock = byPage.get(pageNumber);
      const pageTitle = comicPageTitle(pageNumber);
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "comic-page-tile" + (unlock ? " is-unlocked" : " is-locked");
      tile.setAttribute("aria-label", unlock ? "Open " + pageTitle : "Comic page " + pageNumber + " locked");
      if (!unlock) tile.disabled = true;

      if (unlock) {
        const img = document.createElement("img");
        img.loading = "lazy";
        img.alt = pageTitle;
        img.src = comicPageUrl(pageNumber);
        tile.appendChild(img);
        tile.addEventListener("click", () => showComicReader(collection, unlock));
      } else {
        const mark = document.createElement("span");
        mark.className = "comic-page-locked-mark";
        mark.textContent = "?";
        tile.appendChild(mark);
      }
      grid.appendChild(tile);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  function showComicReader(collection, unlock) {
    if (!unlock) return;
    const pageNumber = Math.floor(Number(unlock.pageNumber || 1));
    const overlay = document.createElement("div");
    overlay.className = "comic-reader";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const panel = document.createElement("div");
    panel.className = "comic-reader-panel";
    const top = document.createElement("div");
    top.className = "comic-reader-top";
    const title = document.createElement("div");
    title.className = "comic-reader-title";
    title.textContent = comicPageTitle(pageNumber);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "comic-reader-close";
    close.setAttribute("aria-label", "Close comic page");
    close.textContent = "X";
    top.appendChild(title);
    top.appendChild(close);
    panel.appendChild(top);

    const img = document.createElement("img");
    img.alt = comicPageTitle(pageNumber);
    img.src = comicPageUrl(pageNumber);
    panel.appendChild(img);
    overlay.appendChild(panel);

    const remove = () => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    };
    const onKey = (event) => {
      if (event.key === "Escape") remove();
    };
    close.addEventListener("click", remove);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) remove();
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    close.focus({ preventScroll: true });
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
    if (entry.diploma) {
      item.appendChild(buildDiplomaCollectible(entry.diploma));
    }
    if (entry.photo) {
      item.appendChild(buildGraduationPhotoCollectible(entry.photo));
    }
    // Show the character's portrait or diploma photo inline in the yearbook.
    const entryImgUrl = entry.diplomaImageDataUrl || entry.portraitDataUrl;
    if (entryImgUrl) {
      const photoWrap = document.createElement("div");
      photoWrap.className = "paper-archive-portrait";
      const img = document.createElement("img");
      img.alt = (entry.name || "Student") + " photo";
      img.loading = "lazy";
      img.src = entryImgUrl;
      photoWrap.appendChild(img);
      item.appendChild(photoWrap);
    }
    return item;
  }

  function buildDiplomaCollectible(diploma) {
    const wrap = document.createElement("div");
    wrap.className = "paper-archive-diploma";
    if (diploma.imageUrl) {
      const img = document.createElement("img");
      img.alt = diploma.title || "Ruby High diploma";
      img.loading = "lazy";
      img.src = diploma.imageUrl;
      wrap.appendChild(img);
    }
    const copy = document.createElement("div");
    copy.className = "paper-archive-diploma-copy";
    const title = document.createElement("div");
    title.className = "paper-archive-diploma-title";
    title.textContent = diploma.title || "Ruby High Diploma";
    const meta = document.createElement("div");
    meta.className = "paper-archive-diploma-meta";
    meta.textContent = "collectible · " + formatSealedDate(diploma.issuedAt);
    copy.appendChild(title);
    copy.appendChild(meta);
    wrap.appendChild(copy);
    return wrap;
  }

  function buildGraduationPhotoCollectible(photo) {
    const wrap = document.createElement("div");
    wrap.className = "paper-archive-photo";
    const faces = document.createElement("div");
    faces.className = "paper-archive-photo-faces";
    [photo.teacher, photo.student].forEach((person) => {
      const face = document.createElement("span");
      face.className = "paper-archive-photo-face";
      if (person && person.imageUrl) {
        const img = document.createElement("img");
        img.alt = person.name || "";
        img.loading = "lazy";
        img.src = person.imageUrl;
        face.appendChild(img);
      } else {
        face.textContent = String((person && person.name) || "?").slice(0, 1).toUpperCase();
      }
      faces.appendChild(face);
    });
    wrap.appendChild(faces);
    const copy = document.createElement("div");
    copy.className = "paper-archive-photo-copy";
    const title = document.createElement("div");
    title.className = "paper-archive-photo-title";
    title.textContent = photo.title || "Graduation Photo";
    const meta = document.createElement("div");
    meta.className = "paper-archive-photo-meta";
    const teacherName = photo.teacher && photo.teacher.name ? photo.teacher.name : "top teacher";
    const studentName = photo.student && photo.student.name ? photo.student.name : "top classmate";
    meta.textContent = teacherName + " · " + studentName;
    copy.appendChild(title);
    copy.appendChild(meta);
    wrap.appendChild(copy);
    return wrap;
  }


  function buildYearbookShareActions(share) {
    const actions = document.createElement("div");
    actions.className = "paper-archive-actions";
    const url = absoluteViewerUrl(share.url);

    const open = document.createElement("button");
    open.type = "button";
    open.className = "paper-archive-action";
    open.textContent = "Open";
    open.title = "Open yearbook card";
    open.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      postViewerMetricEvent("yearbook_open", { shareId: share.shareId || "", grade: share.grade || "" });
      window.open(url, "_blank", "noopener,noreferrer");
    });
    actions.appendChild(open);

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "paper-archive-action";
    copy.textContent = "Copy";
    copy.title = "Copy yearbook card link";
    copy.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const original = copy.textContent;
      try {
        await copyTextToClipboard(url);
        postViewerMetricEvent("yearbook_copy", { shareId: share.shareId || "", grade: share.grade || "" });
        postViewerMetricEvent("share_initiated", { shareId: share.shareId || "", destination: "copy", kind: "yearbook_card" });
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Failed";
      } finally {
        setTimeout(() => { copy.textContent = original; }, 1200);
      }
    });
    actions.appendChild(copy);

    return actions;
  }

  function absoluteViewerUrl(path) {
    try {
      return new URL(path, window.location.origin).toString();
    } catch {
      return String(path || "");
    }
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    try {
      if (!document.execCommand("copy")) throw new Error("copy failed");
    } finally {
      area.remove();
    }
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

  // formatSealedDate, fmtStat are in client-pure.

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
  // Ruby High session is enough; browser-owned AI is optional.
  function renderSheetCreation(playbooks) {
    sheetCard.classList.remove("is-card-deck-sheet");
    sheetCard.classList.remove("is-two-card-deck");
    sheetCard.classList.add("is-creation-sheet");
    sheetCard.innerHTML = "";

    // Full-pane loading state — covers the sheet while the initial
    // roll is in flight so the player isn't staring at empty form
    // rows wondering why nothing's there. Hidden once the rolled
    // payload lands; re-shown if the player triggers a full reroll later.
    const loading = document.createElement("div");
    loading.className = "creation-loading";
    const explanation = document.createElement("div");
    explanation.className = "creation-explanation";
    explanation.innerHTML =
      '<p>You are about to enroll at Ruby High as a student.</p>'
      + '<p>Your character gets a <strong>playbook</strong> — a personality template with stats (HEAD, HEART, HUSTLE, HONOR) and a unique move. Think of it as your role in the school story.</p>'
      + '<p>You can reroll anything you don\'t like. Your character sticks with you for all four years.</p>';
    sheetCard.appendChild(explanation);

    loading.innerHTML =
      '<div class="creation-loading-spinner" aria-hidden="true"></div>'
      + '<div class="creation-loading-title">Rolling your student…</div>'
      + '<div class="creation-loading-sub">Ruby is looking up your file. One moment.</div>';
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
    const hostedPortrait = hostedImageEntitlement("portrait");
    const hasPhotoDayCredit = characterSlotTelemetry().photoDayCredits > 0;
    const portraitCost = hostedPortrait && hostedPortrait.cost || 1;
    controlsSub.textContent = hostedPortrait && hostedPortrait.configured && (hasPhotoDayCredit || canSpendHallPasses(portraitCost))
      ? "Reroll any field. Photo Day credits or Hall Passes can make a custom portrait."
      : localAiEnabled
        ? "Reroll any field. Local AI can refresh the voice."
        : aiEnabled
          ? "Reroll any field. AI can refresh the voice and portrait."
          : "Reroll any field. Connect AI later for a custom portrait.";
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
      const portraitReason = portraitGenerationStatusReason();
      portraitBtn.hidden = !portraitGenerationVisible();
      portraitBtn.disabled = !rolled || inFlight.portrait || !!portraitReason;
      portraitBtn.title = portraitReason || "";
    }

    function portraitGenerationVisible() {
      const entitlement = hostedImageEntitlement("portrait");
      return !!getStoredApiKey() || !!(entitlement && entitlement.configured);
    }

    function portraitGenerationStatusReason() {
      if (getStoredApiKey()) return "";
      const entitlement = hostedImageEntitlement("portrait");
      if (entitlement && entitlement.configured) {
        return "";
      }
      return "Connect AI for a custom portrait.";
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
      const portraitReason = portraitGenerationStatusReason();
      if (portraitReason) {
        portraitStatus.textContent = portraitReason;
        portraitStatus.classList.add("is-invalid");
        return;
      }
      if (!rolled || inFlight.portrait) return;
      const usePhotoDayCredit = !getStoredApiKey() &&
        !!(hostedImageEntitlement("portrait") && hostedImageEntitlement("portrait").configured) &&
        characterSlotTelemetry().photoDayCredits > 0;
      if (!(await confirmHostedCreditSpend("Custom character portrait", "portrait", usePhotoDayCredit))) return;
      inFlight.portrait = true;
      portraitBtn.textContent = "✨ Generating…";
      portraitStatus.textContent = "";
      portraitStatus.classList.remove("is-invalid");
      applyDisabled();
      try {
        const portraitEntitlement = hostedImageEntitlement("portrait") || {};
        const portraitCost = portraitEntitlement.cost || 1;
        if (!usePhotoDayCredit && usingHostedImageGeneration("portrait") && !canSpendHallPasses(portraitCost)) return;
        const r = await apiFetch("/api/apps/ruby-high/chat/character/portrait", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: imageRequestId("character-portrait"),
            name: rolled.name,
            playbookId: rolled.playbookId,
            personality: rolled.personality,
            stats: rolled.stats,
          }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({ error: r.status }));
          throw new Error(err.error || "portrait " + r.status);
        }
        const data = await r.json();
        if (!data || !data.portraitDataUrl) throw new Error("no image returned");
        aiPortraitDataUrl = data.portraitDataUrl;
        portraitImg.src = aiPortraitDataUrl;
        if (typeof data.hallPasses === "number") applyHallPassBalance(data.hallPasses, data.entitlements, data.characterSlots);
        portraitBtn.textContent = "✨ Try again";
        portraitStatus.textContent = "AI portrait ready.";
      } catch (err) {
        portraitStatus.textContent = err && err.message ? err.message : "Couldn't generate — keeping the default.";
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
        setTimeout(() => {
          if (lastTelemetry && shouldAutoStartClass(lastTelemetry)) void pickNext();
        }, 0);
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
  const packSearchInputEl = $("pack-search-input");
  const packSearchBtn = $("pack-search-btn");
  const packSearchListEl = $("pack-search-list");
  const packAutoBtn = $("pack-auto-btn");
  const packCreateBtn = $("pack-create-btn");
  const packEditEl = $("pack-edit-overlay");
  const packEditTitleEl = $("pack-edit-title");
  const packEditSubtitleEl = $("pack-edit-subtitle");
  const packNameInputEl = $("pack-name-input");
  const packDescriptionInputEl = $("pack-description-input");
  const packCourseGeneratorEl = $("pack-course-generator");
  const courseMaterialsInputEl = $("course-materials-input");
  const courseGenerateBtn = $("course-generate-btn");
  const courseCancelGenerationBtn = $("course-cancel-generation-btn");
  const courseGenerationStatusEl = $("course-generation-status");
  const courseGenerationProgressEl = $("course-generation-progress");
  const courseProgressBarEl = $("course-progress-bar");
  const courseProgressFillEl = $("course-progress-fill");
  const courseGenerationChecklistEl = $("course-generation-checklist");
  const packTeacherListEl = $("pack-teacher-list");
  const packTeacherDetailEl = $("pack-teacher-detail");
  const teacherMaterialUrlInputEl = $("teacher-material-url-input");
  const teacherLoadUrlBtn = $("teacher-load-url-btn");
  const teacherGenerateQuestionsBtn = $("teacher-generate-questions-btn");
  const teacherCancelGenerationBtn = $("teacher-cancel-generation-btn");
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
  let packSearchState = { query: "", packs: [], searched: false };
  let packSearchRunId = 0;
  let currentDraft = null;
  let selectedPackTeacherId = null;
  let selectedPackTab = "materials";
  let packTeacherCreateMode = false;
  let pendingTeacherRoll = null;
  let pendingTeacherImageStatus = "";
  let pendingTeacherImageInvalid = false;
  let pendingTeacherImageBusy = false;
  let pendingTeacherImageAbortController = null;
  let pendingTeacherImageRunId = 0;
  let packQuestionGenerationBusy = false;
  let packQuestionGenerationAbortController = null;
  let packQuestionGenerationRunId = 0;
  let packQuestionGenerationKind = "";
  let courseGenerationProgressTimer = null;
  let packAutosaveTimer = null;
  let teacherAutosaveTimer = null;
  let teacherAutosaveRunId = 0;
  let teacherFormVersion = 0;
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
  const COURSE_GENERATION_STEPS = [
    { key: "materials", pct: 12, label: "Read course materials" },
    { key: "teacher", pct: 34, label: "Create teacher name and voice" },
    { key: "portrait", pct: 58, label: "Generate teacher portrait" },
    { key: "questions", pct: 78, label: "Write class questions" },
    { key: "saving", pct: 94, label: "Save the pack" },
  ];
  const INITIAL_COURSE_QUESTION_COUNT = 6;

  const packStudioClient = {
    async listPacks() {
      const r = await apiFetch("/api/apps/ruby-high/pack-library");
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "pack library " + r.status);
      return data;
    },
    async searchCreatorPacks(query) {
      const r = await apiFetch("/api/apps/ruby-high/pack-library/search?q=" + encodeURIComponent(query || ""));
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "pack search " + r.status);
      return data;
    },
    async createDraftPack(payload) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ name: "Untitled Content Pack" }, payload || {})),
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
    async deleteTeacher(draftId, teacherId) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts/" + encodeURIComponent(draftId) + "/teachers/" + encodeURIComponent(teacherId), {
        method: "DELETE",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "delete teacher " + r.status);
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
    async generateQuestionsForDraftTeacher(draftId, teacherId, options) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts/" + encodeURIComponent(draftId) + "/teachers/" + encodeURIComponent(teacherId) + "/questions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options && options.signal,
        body: JSON.stringify({
          requestId: newPackClientRequestId("questions"),
          questionCount: creatorPricing().moreQuestionsCount,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "generate " + r.status);
      return data;
    },
    async generateCourse(draftId, payload, options) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts/" + encodeURIComponent(draftId) + "/course/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options && options.signal,
        body: JSON.stringify(payload || {}),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "generate course " + r.status);
      return data;
    },
    async courseGenerationStatus(draftId, jobId, options) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts/" + encodeURIComponent(draftId) + "/course/generate/" + encodeURIComponent(jobId), {
        signal: options && options.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "course generation " + r.status);
      return data;
    },
    async deleteQuestion(draftId, teacherId, questionId) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts/" + encodeURIComponent(draftId) + "/teachers/" + encodeURIComponent(teacherId) + "/questions/" + encodeURIComponent(questionId), {
        method: "DELETE",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "delete question " + r.status);
      return data.draft;
    },
    async deleteDraftPack(draftId) {
      const r = await apiFetch("/api/apps/ruby-high/pack-drafts/" + encodeURIComponent(draftId), {
        method: "DELETE",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "delete draft " + r.status);
      return data;
    },
    async deletePublishedPack(packId) {
      const r = await apiFetch("/api/apps/ruby-high/pack-library/" + encodeURIComponent(packId), {
        method: "DELETE",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "delete pack " + r.status);
      return data;
    },
    async uninstallPack(packId) {
      const r = await apiFetch("/api/apps/ruby-high/pack-library/" + encodeURIComponent(packId) + "/uninstall", {
        method: "POST",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "uninstall pack " + r.status);
      return data;
    },
    async createEditDraftForPublishedPack(packId) {
      const r = await apiFetch("/api/apps/ruby-high/pack-library/" + encodeURIComponent(packId) + "/edit-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "edit published pack " + r.status);
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
      return data;
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
    async setGuestAuto() {
      const r = await apiFetch("/api/apps/ruby-high/pack-library/guest/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "guest auto " + r.status);
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
    pendingTeacherImageAbortController = null;
    packQuestionGenerationBusy = false;
    packQuestionGenerationAbortController = null;
    packQuestionGenerationKind = "";
    if (courseMaterialsInputEl) courseMaterialsInputEl.value = "";
    if (courseGenerationStatusEl) {
      courseGenerationStatusEl.textContent = "";
      courseGenerationStatusEl.classList.remove("is-invalid");
    }
    resetCourseGenerationProgress();
    packEditEl.classList.add("is-open");
    renderPackEditor();
  }
  function closePackEditor() {
    if (packGenerationInFlight()) {
      warnPackGenerationBlocks("closing");
      return;
    }
    const shouldRefreshLibrary = currentDraft && !isLocalDraftPack(currentDraft);
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
    pendingTeacherImageAbortController = null;
    packQuestionGenerationBusy = false;
    packQuestionGenerationAbortController = null;
    packQuestionGenerationKind = "";
    if (packEditStatusEl) {
      packEditStatusEl.textContent = "";
      packEditStatusEl.classList.remove("is-invalid");
    }
    if (courseGenerationStatusEl) {
      courseGenerationStatusEl.textContent = "";
      courseGenerationStatusEl.classList.remove("is-invalid");
    }
    resetCourseGenerationProgress();
    if (shouldRefreshLibrary) refreshPackLibrary();
  }
  function setPackBusy(busy) {
    packImportBusy = !!busy;
    packEl.classList.toggle("is-busy", packImportBusy);
    if (packEditEl) packEditEl.classList.toggle("is-busy", packImportBusy);
    if (packCloseBtn) packCloseBtn.disabled = packImportBusy;
    if (packEditCloseBtn) packEditCloseBtn.disabled = packImportBusy;
    if (packBtn) packBtn.disabled = packImportBusy;
    packEl.querySelectorAll("button.pack-action").forEach((btn) => { btn.disabled = packImportBusy; });
    packEditEl.querySelectorAll("button.pack-action, button.secondary, button.pack-teacher-row-action, button.pack-teacher-select").forEach((btn) => { btn.disabled = packImportBusy; });
    if (packCreateBtn) packCreateBtn.disabled = packImportBusy;
    if (packSearchInputEl) packSearchInputEl.disabled = packImportBusy;
    if (packSearchBtn) packSearchBtn.disabled = packImportBusy;
    syncGuestAutoButton();
    syncPackEditorGuardControls();
    packEditEl.querySelectorAll("input, textarea").forEach((field) => {
      field.disabled = packImportBusy;
    });
    syncPackGenerationControls();
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
  function renderCourseGenerationChecklist(pct, activeKey, isError) {
    if (!courseGenerationChecklistEl) return;
    courseGenerationChecklistEl.textContent = "";
    const activeIndex = Math.max(0, COURSE_GENERATION_STEPS.findIndex((step) => step.key === activeKey));
    COURSE_GENERATION_STEPS.forEach((step, index) => {
      const row = document.createElement("div");
      const isComplete = pct >= 100 || index < activeIndex;
      const isActive = !isError && !isComplete && step.key === activeKey;
      const isFailed = !!isError && step.key === activeKey;
      row.className = "course-generation-step"
        + (isComplete ? " is-complete" : "")
        + (isActive ? " is-active" : "")
        + (isFailed ? " is-error" : "");
      const state = document.createElement("span");
      state.className = "course-generation-step-state";
      state.textContent = isFailed ? "Error" : isComplete ? "Done" : isActive ? "Now" : "Waiting";
      const label = document.createElement("span");
      label.textContent = step.label;
      row.append(state, label);
      courseGenerationChecklistEl.append(row);
    });
  }
  function courseGenerationStepForPct(pct) {
    return COURSE_GENERATION_STEPS.reduce((best, entry) => entry.pct <= pct ? entry : best, COURSE_GENERATION_STEPS[0]);
  }
  function updateCourseGenerationProgress(pct, activeKey, isError) {
    if (!courseGenerationProgressEl) return;
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    const step = COURSE_GENERATION_STEPS.find((entry) => entry.key === activeKey) || courseGenerationStepForPct(clamped);
    courseGenerationProgressEl.hidden = false;
    courseGenerationProgressEl.classList.toggle("is-error", !!isError);
    if (courseProgressBarEl) courseProgressBarEl.setAttribute("aria-valuenow", String(clamped));
    if (courseProgressFillEl) courseProgressFillEl.style.width = clamped + "%";
    renderCourseGenerationChecklist(clamped, step.key, !!isError);
  }
  function startCourseGenerationProgress() {
    clearInterval(courseGenerationProgressTimer);
    const startedAt = Date.now();
    updateCourseGenerationProgress(4, "materials", false);
    courseGenerationProgressTimer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const pct = Math.min(92, 4 + Math.floor(elapsed / 800) * 5);
      updateCourseGenerationProgress(pct, courseGenerationStepForPct(pct).key, false);
    }, 800);
  }
  function finishCourseGenerationProgress() {
    clearInterval(courseGenerationProgressTimer);
    courseGenerationProgressTimer = null;
    updateCourseGenerationProgress(100, "saving", false);
  }
  function failCourseGenerationProgress() {
    clearInterval(courseGenerationProgressTimer);
    courseGenerationProgressTimer = null;
    const current = Number(courseProgressBarEl && courseProgressBarEl.getAttribute("aria-valuenow")) || 4;
    const pct = Math.max(4, Math.min(100, current));
    updateCourseGenerationProgress(pct, courseGenerationStepForPct(pct).key, true);
  }
  function resetCourseGenerationProgress() {
    clearInterval(courseGenerationProgressTimer);
    courseGenerationProgressTimer = null;
    if (courseGenerationProgressEl) {
      courseGenerationProgressEl.hidden = true;
      courseGenerationProgressEl.classList.remove("is-error");
    }
    if (courseProgressBarEl) courseProgressBarEl.setAttribute("aria-valuenow", "0");
    if (courseProgressFillEl) courseProgressFillEl.style.width = "0%";
    if (courseGenerationChecklistEl) courseGenerationChecklistEl.textContent = "";
  }
  function makeAbortError() {
    const err = new Error("aborted");
    err.name = "AbortError";
    return err;
  }
  function waitForCourseGenerationPoll(ms, signal) {
    if (signal && signal.aborted) return Promise.reject(makeAbortError());
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        fn();
      };
      const timer = window.setTimeout(() => finish(resolve), ms);
      const onAbort = () => finish(() => reject(makeAbortError()));
      if (!signal) return;
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  function updateCourseGenerationProgressFromJob(job) {
    if (!job || typeof job !== "object") return;
    const pct = Number(job.pct || 0);
    const step = String(job.step || courseGenerationStepForPct(pct).key);
    updateCourseGenerationProgress(pct > 0 ? pct : 4, step, job.status === "error");
    const message = String(job.message || "");
    if (message) {
      if (packEditStatusEl) {
        packEditStatusEl.textContent = message;
        packEditStatusEl.classList.toggle("is-invalid", job.status === "error");
      }
      if (courseGenerationStatusEl) {
        courseGenerationStatusEl.textContent = message;
        courseGenerationStatusEl.classList.toggle("is-invalid", job.status === "error");
      }
    }
  }
  async function waitForCourseGenerationJob(draftId, initialJob, signal) {
    let job = initialJob;
    for (;;) {
      if (signal && signal.aborted) throw makeAbortError();
      updateCourseGenerationProgressFromJob(job);
      if (job && job.status === "complete") return job;
      if (job && job.status === "error") throw new Error(job.error || job.message || "Course generation failed.");
      const jobId = job && job.jobId;
      if (!jobId) throw new Error("Course generation did not return a job id.");
      await waitForCourseGenerationPoll(1500, signal);
      job = await packStudioClient.courseGenerationStatus(draftId, jobId, { signal });
    }
  }
  function packGenerationInFlight() {
    return !!(pendingTeacherImageBusy || packQuestionGenerationBusy);
  }
  function packGenerationLabel() {
    if (pendingTeacherImageBusy) return "teacher image generation";
    if (packQuestionGenerationBusy && packQuestionGenerationKind === "course") return "course generation";
    if (packQuestionGenerationBusy) return "question generation";
    return "generation";
  }
  function warnPackGenerationBlocks(action) {
    if (!packEditStatusEl) return;
    packEditStatusEl.textContent = "Cancel " + packGenerationLabel() + " before " + action + ".";
    packEditStatusEl.classList.add("is-invalid");
  }
  function draftHasCourseSlot() {
    return !!(currentDraft && currentDraft.courseSlot && currentDraft.courseSlot.id);
  }
  function publishCourseSlotStatusReason() {
    if (!currentDraft || draftHasCourseSlot()) return "";
    const wallet = walletNumbers(lastTelemetry);
    const cost = creatorPricing().courseSlotCost;
    if (wallet.hallPasses < cost) {
      return "Need " + hallPassCostLabel(cost) + " to publish.";
    }
    return "";
  }
  function syncPackEditorGuardControls() {
    const generationBusy = packGenerationInFlight();
    if (packEditCloseBtn) {
      packEditCloseBtn.disabled = packImportBusy;
      packEditCloseBtn.title = generationBusy ? "Cancel generation before closing." : "";
    }
    if (packPublishBtn) {
      const publishReason = generationBusy ? "Cancel generation before publishing." : publishCourseSlotStatusReason();
      const cost = creatorPricing().courseSlotCost;
      packPublishBtn.textContent = draftHasCourseSlot() ? "Publish Course" : "Publish Course (" + hallPassCostLabel(cost) + ")";
      packPublishBtn.disabled = packImportBusy || generationBusy || !!publishReason;
      packPublishBtn.title = publishReason;
    }
  }
  window.addEventListener("beforeunload", (e) => {
    if (!packImportBusy && !packGenerationInFlight()) return;
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
      syncGuestAutoButton();
      renderPackList();
      renderPackSearchList();
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

  function syncGuestAutoButton() {
    if (!packAutoBtn) return;
    const guest = (packLibraryState && packLibraryState.guest) || {};
    const mode = guest.mode || "auto";
    const active = guest.active || null;
    packAutoBtn.textContent = mode === "auto"
      ? active ? "Auto: " + (active.name || "Guest") : "Auto Guest"
      : "Auto";
    packAutoBtn.disabled = packImportBusy || mode === "auto";
    packAutoBtn.title = active
      ? "This week's automatic guest is " + (active.name || "Guest Faculty") + "."
      : "Use Ruby High's weekly automatic guest teacher.";
  }

  function renderPackSearchList() {
    if (!packSearchListEl) return;
    const packs = packSearchState && Array.isArray(packSearchState.packs) ? packSearchState.packs : [];
    packSearchListEl.innerHTML = "";
    if (!packSearchState.searched) {
      packSearchListEl.innerHTML = '<div class="sub">Search or press Search to browse public creator packs.</div>';
      return;
    }
    if (packs.length === 0) {
      packSearchListEl.innerHTML = '<div class="sub">No public creator packs are available yet.</div>';
      return;
    }
    packs.forEach((pack) => {
      packSearchListEl.appendChild(packCard(pack, { draft: false, search: true }));
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
    const isSearch = !!opts.search;
    const canSwitch = !isDraft && !isSearch && !pack.active;
    card.className = "pack-card-item" + (pack.active ? " is-active" : "") + (canSwitch ? " is-clickable" : "");
    if (canSwitch) {
      card.setAttribute("role", "button");
      card.tabIndex = packImportBusy ? -1 : 0;
      card.setAttribute("aria-label", (pack.active ? "Guest " : "Set guest ") + (pack.name || "Untitled Pack"));
      card.addEventListener("click", () => {
        activateLibraryPack(pack);
      });
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
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
      pack.source === "official" ? "official" : pack.source === "creator" ? "creator" : pack.builtIn ? "built-in" : pack.status || "pack",
      pack.readOnly ? "read only" : pack.owner ? "yours" : "",
      isSearch && pack.installed ? "installed" : "",
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
      state.textContent = isSearch
        ? pack.active ? "Guest now" : pack.installed ? "Installed" : "Not installed"
        : pack.builtIn ? "Always on" : pack.active ? "Guest now" : "Set guest";
      actions.appendChild(state);
    }

    if (isSearch) {
      const installBtn = document.createElement("button");
      installBtn.type = "button";
      installBtn.className = "pack-action";
      installBtn.textContent = pack.installed ? (pack.active ? "Guest" : "Set Guest") : "Install";
      installBtn.disabled = packImportBusy || pack.active;
      installBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (pack.installed) {
          activateLibraryPack(pack);
        } else {
          installCreatorPack(pack);
        }
      });
      actions.appendChild(installBtn);
    }

    if (isDraft || pack.canEdit) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "pack-action";
      editBtn.textContent = "Edit";
      editBtn.disabled = packImportBusy;
      editBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (isDraft) editDraftPack(pack.id);
        else editPublishedPack(pack);
      });
      actions.appendChild(editBtn);
    }
    if (!isDraft && pack.canUninstall) {
      const uninstallBtn = document.createElement("button");
      uninstallBtn.type = "button";
      uninstallBtn.className = "pack-action";
      uninstallBtn.textContent = "Uninstall";
      uninstallBtn.disabled = packImportBusy;
      uninstallBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        uninstallLibraryPack(pack);
      });
      actions.appendChild(uninstallBtn);
    }
    if (pack.canDelete) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "pack-action danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.disabled = packImportBusy;
      deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteLibraryPack(pack, { draft: isDraft });
      });
      actions.appendChild(deleteBtn);
    }
    card.appendChild(actions);
    return card;
  }

  async function deleteLibraryPack(pack, opts) {
    if (!pack || packImportBusy) return;
    const name = pack.name || "Untitled Pack";
    const kind = opts && opts.draft ? "draft pack" : "pack";
    if (!(await confirmInApp({
      kicker: "Delete " + kind,
      title: "Delete " + name + "?",
      copy: "This removes the " + kind + " from your library.",
      confirmText: "Delete",
      tone: "danger",
    }))) return;
    setPackBusy(true);
    packStatusEl.textContent = "Deleting pack...";
    packStatusEl.classList.remove("is-invalid");
    try {
      const deleteResult = opts && opts.draft
        ? await packStudioClient.deleteDraftPack(pack.id)
        : await packStudioClient.deletePublishedPack(pack.id);
      applyPackDeletionResult(pack, opts, deleteResult);
      renderPackList();
      renderDraftPackList();
      packStatusEl.textContent = "Pack deleted.";
    } catch (err) {
      packStatusEl.textContent = "Could not delete pack · " + (err && err.message ? err.message : "error");
      packStatusEl.classList.add("is-invalid");
    } finally {
      setPackBusy(false);
    }
  }

  function applyPackDeletionResult(pack, opts, result) {
    if (result && Array.isArray(result.packs) && Array.isArray(result.drafts)) {
      packLibraryState = result;
      return;
    }
    const current = packLibraryState || { packs: [], drafts: [] };
    const next = Object.assign({}, current);
    const hasActivePackId = result && Object.prototype.hasOwnProperty.call(result, "activePackId");
    if (hasActivePackId) next.activePackId = result.activePackId;
    if (result && result.guest) next.guest = result.guest;
    if (opts && opts.draft) {
      const draftId = result && (result.draftId || (result.deleted && result.deleted.id)) || pack.id;
      next.drafts = (current.drafts || []).filter((draft) => draft.id !== draftId);
    } else {
      const packId = result && (result.packId || (result.deleted && result.deleted.id)) || pack.id;
      const removedDraftIds = new Set((result && result.removedDraftIds) || []);
      next.packs = (current.packs || []).filter((entry) => entry.id !== packId);
      next.drafts = (current.drafts || []).filter((draft) =>
        draft.derivedFrom !== packId && ("pack:" + draft.id) !== packId && !removedDraftIds.has(draft.id)
      );
    }
    packLibraryState = next;
  }

  async function uninstallLibraryPack(pack) {
    if (!pack || packImportBusy) return;
    const name = pack.name || "Untitled Pack";
    if (!(await confirmInApp({
      kicker: "Uninstall pack",
      title: "Uninstall " + name + "?",
      copy: "You can install it again from search or keep editing it if you own it.",
      confirmText: "Uninstall",
    }))) return;
    setPackBusy(true);
    packStatusEl.textContent = "Uninstalling pack...";
    packStatusEl.classList.remove("is-invalid");
    try {
      packLibraryState = await packStudioClient.uninstallPack(pack.id);
      renderPackList();
      renderDraftPackList();
      await refreshPackSearchResults();
      packStatusEl.textContent = "Pack uninstalled.";
      await fetchSession();
    } catch (err) {
      packStatusEl.textContent = "Could not uninstall pack · " + (err && err.message ? err.message : "error");
      packStatusEl.classList.add("is-invalid");
    } finally {
      setPackBusy(false);
    }
  }

  async function activateLibraryPack(pack) {
    if (!pack || packImportBusy) return;
    setPackBusy(true);
    packStatusEl.textContent = "Setting guest teacher...";
    packStatusEl.classList.remove("is-invalid");
    try {
      packLibraryState = await packStudioClient.setActivePack(pack.id);
      syncGuestAutoButton();
      renderPackList();
      renderDraftPackList();
      packStatusEl.textContent = "Guest teacher set.";
      await fetchSession();
    } catch (err) {
      packStatusEl.textContent = "Could not switch pack · " + (err && err.message ? err.message : "error");
      packStatusEl.classList.add("is-invalid");
    } finally {
      setPackBusy(false);
    }
  }

  async function searchCreatorPacks() {
    if (!packSearchInputEl || !packSearchListEl || packImportBusy) return;
    const query = packSearchInputEl.value.trim();
    const runId = ++packSearchRunId;
    packSearchState = { query, packs: [], searched: true };
    packSearchListEl.innerHTML = '<div class="sub">' + (query ? "Searching creator packs..." : "Loading creator packs...") + '</div>';
    packStatusEl.textContent = "";
    packStatusEl.classList.remove("is-invalid");
    try {
      const data = await packStudioClient.searchCreatorPacks(query);
      if (runId !== packSearchRunId) return;
      packSearchState = {
        query: data && typeof data.query === "string" ? data.query : query,
        packs: data && Array.isArray(data.packs) ? data.packs : [],
        searched: true,
      };
      renderPackSearchList();
    } catch (err) {
      if (runId !== packSearchRunId) return;
      packSearchListEl.innerHTML = "";
      packStatusEl.textContent = "Could not search packs · " + (err && err.message ? err.message : "error");
      packStatusEl.classList.add("is-invalid");
    }
  }

  async function refreshPackSearchResults() {
    if (!packSearchState.searched) {
      renderPackSearchList();
      return;
    }
    const query = packSearchState.query || "";
    const runId = ++packSearchRunId;
    const data = await packStudioClient.searchCreatorPacks(query);
    if (runId !== packSearchRunId) return;
    packSearchState = {
      query: data && typeof data.query === "string" ? data.query : query,
      packs: data && Array.isArray(data.packs) ? data.packs : [],
      searched: true,
    };
    renderPackSearchList();
  }

  async function installCreatorPack(pack) {
    if (!pack || packImportBusy) return;
    setPackBusy(true);
    packStatusEl.textContent = "Installing pack...";
    packStatusEl.classList.remove("is-invalid");
    try {
      packLibraryState = await packStudioClient.installPack(pack.id, true);
      syncGuestAutoButton();
      renderPackList();
      renderDraftPackList();
      await refreshPackSearchResults();
      packStatusEl.textContent = "Pack installed.";
    } catch (err) {
      packStatusEl.textContent = "Could not install pack · " + (err && err.message ? err.message : "error");
      packStatusEl.classList.add("is-invalid");
    } finally {
      setPackBusy(false);
    }
  }

  async function setGuestAutoMode() {
    if (packImportBusy) return;
    setPackBusy(true);
    packStatusEl.textContent = "Setting weekly auto guest...";
    packStatusEl.classList.remove("is-invalid");
    try {
      packLibraryState = await packStudioClient.setGuestAuto();
      syncGuestAutoButton();
      renderPackList();
      renderDraftPackList();
      await refreshPackSearchResults();
      packStatusEl.textContent = "Auto guest enabled.";
      await fetchSession();
    } catch (err) {
      packStatusEl.textContent = "Could not enable auto guest · " + (err && err.message ? err.message : "error");
      packStatusEl.classList.add("is-invalid");
    } finally {
      setPackBusy(false);
    }
  }

  async function createDraftPack() {
    if (packImportBusy) return;
    packStatusEl.textContent = "";
    packStatusEl.classList.remove("is-invalid");
    openPackEditor(newLocalDraftPack());
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

  async function editPublishedPack(pack) {
    if (!pack || packImportBusy) return;
    if (pack.draftId) {
      await editDraftPack(pack.draftId);
      return;
    }
    setPackBusy(true);
    packStatusEl.textContent = "Preparing published pack for editing...";
    packStatusEl.classList.remove("is-invalid");
    try {
      const draft = await packStudioClient.createEditDraftForPublishedPack(pack.id);
      packLibraryState = await packStudioClient.listPacks();
      renderPackList();
      renderDraftPackList();
      packStatusEl.textContent = "";
      openPackEditor(draft);
    } catch (err) {
      packStatusEl.textContent = "Could not edit published pack · " + (err && err.message ? err.message : "error");
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
  function newPackClientRequestId(prefix) {
    return String(prefix || "request") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  function newLocalDraftPack() {
    const now = Date.now();
    return {
      id: "",
      localDraft: true,
      name: "Untitled Content Pack",
      description: "",
      visibility: "private",
      status: "draft",
      owner: true,
      enabled: false,
      active: false,
      canEdit: true,
      canDelete: false,
      readOnly: false,
      teachers: [],
      teacherCount: 0,
      questionCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }
  function isLocalDraftPack(draft) {
    return !!draft && (!draft.id || draft.localDraft === true);
  }
  function currentDraftCreatePayload() {
    return {
      name: currentDraft && currentDraft.name ? currentDraft.name : "Untitled Content Pack",
      description: currentDraft && currentDraft.description ? currentDraft.description : "",
      visibility: currentDraft && currentDraft.visibility ? currentDraft.visibility : "private",
    };
  }
  async function ensureCurrentDraftSaved() {
    if (!currentDraft) return null;
    if (!isLocalDraftPack(currentDraft)) return currentDraft;
    const localDraft = currentDraft;
    const draft = await packStudioClient.createDraftPack(currentDraftCreatePayload());
    currentDraft = Object.assign({}, draft, {
      description: draft.description || localDraft.description || "",
      teachers: Array.isArray(localDraft.teachers) ? localDraft.teachers : [],
      localDraft: false,
    });
    return currentDraft;
  }
  function isLikelyFetchFailure(err) {
    const message = err && err.message ? String(err.message) : "";
    return /failed to fetch|load failed|networkerror|network error/i.test(message);
  }
  function friendlyFetchFailureMessage(err) {
    if (isLikelyFetchFailure(err)) return "Ruby High lost the connection while saving. The app retried once; reload if this keeps happening.";
    return err && err.message ? err.message : "error";
  }
  function waitForPackRetry(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function retryPackNetworkWrite(label, fn) {
    try {
      return await fn();
    } catch (err) {
      if (!isLikelyFetchFailure(err)) throw err;
      if (packEditStatusEl) {
        packEditStatusEl.textContent = label + " hit a connection hiccup. Retrying...";
        packEditStatusEl.classList.remove("is-invalid");
      }
      await waitForPackRetry(450);
      return fn();
    }
  }
  function buildTeacherStatPills(stats) {
    const s = stats || { head: 0, heart: 0, hustle: 0, honor: 0 };
    const wrap = document.createElement("div");
    wrap.className = "teacher-stat-pills";
    ["head", "heart", "hustle", "honor"].forEach((key) => {
      const pill = document.createElement("span");
      pill.className = "pill stat " + key;
      pill.textContent = statLabel(key) + " " + fmtStat(Number(s[key] || 0));
      wrap.appendChild(pill);
    });
    return wrap;
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
    const profileImageUrl = regen.has("image") ? "" : (prev.profileImageUrl || "");
    const imageChoice = regen.has("image")
      ? asset.id
      : (prev.imageChoice === "custom" || profileImageUrl ? "custom" : asset.id);
    pendingTeacherRoll = {
      clientRequestId: prev.clientRequestId || newPackClientRequestId("teacher"),
      displayName,
      subject: style.subject || asset.subject,
      description: style.description || asset.description,
      quote,
      assetTeacherId: asset.id,
      profileImageUrl,
      imageChoice,
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
  function chooseTeacherImage(choice) {
    if (!pendingTeacherRoll || pendingTeacherImageBusy) return;
    if (choice === "custom") {
      pendingTeacherRoll = {
        ...pendingTeacherRoll,
        imageChoice: "custom",
      };
      pendingTeacherImageStatus = pendingTeacherRoll.profileImageUrl ? "Custom teacher image ready." : "";
      pendingTeacherImageInvalid = false;
    } else {
      const asset = PREGENERATED_TEACHER_ASSETS.find((entry) => entry.id === choice);
      if (!asset) return;
      pendingTeacherRoll = {
        ...pendingTeacherRoll,
        assetTeacherId: asset.id,
        profileImageUrl: "",
        imageChoice: asset.id,
      };
      pendingTeacherImageStatus = "";
      pendingTeacherImageInvalid = false;
    }
    renderPackTeacherEditor();
  }
  function currentTeacherImageChoice(roll) {
    if (!roll) return "ruby";
    if (roll.imageChoice === "custom" || roll.profileImageUrl) return "custom";
    return roll.assetTeacherId || "ruby";
  }
  function updatePendingTeacherRollField(field, value) {
    if (!pendingTeacherRoll) return;
    const next = { ...pendingTeacherRoll };
    const text = String(value || "");
    if (field === "displayName") next.displayName = text;
    else if (field === "subject") next.subject = text;
    else if (field === "description") next.description = text;
    else if (field === "quote") next.quote = text;
    pendingTeacherRoll = next;
    refreshPendingTeacherPreview();
  }
  function refreshPendingTeacherPreview() {
    if (!pendingTeacherRoll || !packTeacherDetailEl) return;
    const card = packTeacherDetailEl.querySelector(".is-creation-candidate-card");
    if (!card) return;
    const nameEl = card.querySelector(".ccg-name");
    if (nameEl) nameEl.textContent = pendingTeacherRoll.displayName || "New Teacher";
    const subtitleEl = card.querySelector(".ccg-subtitle");
    if (subtitleEl) subtitleEl.textContent = (pendingTeacherRoll.subject || "Custom class") + " · teacher candidate";
    const quoteEl = card.querySelector(".ccg-quote");
    if (quoteEl) renderMarkdownInto(quoteEl, pendingTeacherRoll.quote ? "“" + pendingTeacherRoll.quote + "”" : "", { inline: true });
    const footerEl = card.querySelector(".ccg-footer-content");
    if (footerEl) renderMarkdownInto(footerEl, pendingTeacherRoll.description || "", { inline: true });
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
    const makeRow = (label, key, value, opts) => {
      const row = document.createElement("div");
      row.className = "creation-row" + (opts && opts.className ? " " + opts.className : "");
      const lab = document.createElement("div");
      lab.className = "creation-row-label";
      lab.textContent = label;
      const val = document.createElement("div");
      val.className = "creation-row-value";
      if (opts && opts.editField) {
        const input = document.createElement(opts.multiline ? "textarea" : "input");
        input.className = "creation-edit-input" + (opts.multiline ? " is-multiline" : "");
        if (!opts.multiline) input.type = "text";
        input.value = value || "";
        input.placeholder = opts.placeholder || "";
        if (opts.maxLength) input.maxLength = opts.maxLength;
        if (opts.multiline) input.rows = opts.rows || 2;
        input.disabled = packImportBusy;
        input.addEventListener("input", () => updatePendingTeacherRollField(opts.editField, input.value));
        val.appendChild(input);
      } else if (value && typeof value === "object" && value.nodeType) val.appendChild(value);
      else val.textContent = value || "";
      row.appendChild(lab);
      row.appendChild(val);
      if (!opts || opts.reroll !== false) {
        const reroll = document.createElement("button");
        reroll.type = "button";
        reroll.className = "creation-reroll";
        reroll.title = "Reroll " + label.toLowerCase();
        reroll.textContent = "↻";
        reroll.disabled = packImportBusy;
        reroll.addEventListener("click", () => {
          rollTeacherCandidate([key]);
          renderPackTeacherEditor();
        });
        row.appendChild(reroll);
      }
      fields.appendChild(row);
      return { row, val };
    };
    const roll = pendingTeacherRoll || rollTeacherCandidate();
    makeRow("Name", "name", roll.displayName, { editField: "displayName", maxLength: 64, placeholder: "Teacher name" });
    makeRow("Class", "style", roll.subject, { editField: "subject", maxLength: 80, placeholder: "Class or subject" });
    makeTeacherImageRow(fields, roll);
    makeRow("Stats", "stats", buildTeacherStatPills(roll.stats), { className: "is-compact-stats" });
    makeRow("Style", "style", roll.description, { editField: "description", multiline: true, maxLength: 220, placeholder: "Teaching style", reroll: false });
    makeRow("Quote", "quote", roll.quote, { editField: "quote", multiline: true, maxLength: 160, placeholder: "Teacher quote" });
    return controlsCard;
  }
  function makeTeacherImageRow(fields, roll) {
    const row = document.createElement("div");
    row.className = "creation-row teacher-image-row";
    const lab = document.createElement("div");
    lab.className = "creation-row-label";
    lab.textContent = "Image";
    const val = document.createElement("div");
    val.className = "creation-row-value teacher-image-control";
    const choices = document.createElement("div");
    choices.className = "teacher-image-presets";
    const current = currentTeacherImageChoice(roll);
    PREGENERATED_TEACHER_ASSETS.forEach((asset) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "teacher-image-preset" + (current === asset.id ? " is-selected" : "");
      btn.textContent = asset.name;
      btn.disabled = packImportBusy || pendingTeacherImageBusy;
      btn.addEventListener("click", () => chooseTeacherImage(asset.id));
      choices.appendChild(btn);
    });
    const customBtn = document.createElement("button");
    customBtn.type = "button";
    customBtn.className = "teacher-image-preset" + (current === "custom" ? " is-selected" : "");
    customBtn.textContent = "Custom";
    customBtn.disabled = packImportBusy || pendingTeacherImageBusy;
    customBtn.addEventListener("click", () => chooseTeacherImage("custom"));
    choices.appendChild(customBtn);
    val.appendChild(choices);
    if (current === "custom") {
      const custom = document.createElement("div");
      custom.className = "teacher-custom-image";
      const generateBtn = document.createElement("button");
      generateBtn.type = "button";
      generateBtn.className = "secondary teacher-custom-generate" + (pendingTeacherImageBusy ? " is-loading" : "");
      generateBtn.dataset.requiresOpenrouter = "teacher-image";
      generateBtn.setAttribute("aria-busy", pendingTeacherImageBusy ? "true" : "false");
      if (pendingTeacherImageBusy) {
        const spinner = document.createElement("span");
        spinner.className = "teacher-button-spinner";
        spinner.setAttribute("aria-hidden", "true");
        generateBtn.appendChild(spinner);
      }
      const generateLabel = document.createElement("span");
      generateLabel.textContent = pendingTeacherImageBusy ? "Generating" : (roll.profileImageUrl ? "Generate again" : "Generate");
      generateBtn.appendChild(generateLabel);
      const imageReason = teacherImageGenerationStatusReason();
      generateBtn.disabled = packImportBusy || pendingTeacherImageBusy || !!imageReason;
      generateBtn.title = imageReason;
      generateBtn.addEventListener("click", generateTeacherImageForPendingRoll);
      custom.appendChild(generateBtn);
      if (pendingTeacherImageBusy) {
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "secondary teacher-generation-cancel";
        cancelBtn.textContent = "Cancel generation";
        cancelBtn.disabled = packImportBusy;
        cancelBtn.addEventListener("click", cancelTeacherImageGeneration);
        custom.appendChild(cancelBtn);
      }
      const credit = document.createElement("div");
      credit.className = "creation-portrait-status is-credit-hint";
      credit.textContent = pendingTeacherImageBusy
        ? "Keep editing while the image generates. Save and Close unlock after it finishes or you cancel."
        : teacherImageCreditHint();
      custom.appendChild(credit);
      const statusText = pendingTeacherImageBusy ? "" : (pendingTeacherImageStatus || (roll.profileImageUrl ? "Custom teacher image ready." : ""));
      if (statusText) {
        const status = document.createElement("div");
        status.className = "creation-portrait-status" + (pendingTeacherImageInvalid ? " is-invalid" : "");
        status.textContent = statusText;
        custom.appendChild(status);
      }
      val.appendChild(custom);
    }
    row.appendChild(lab);
    row.appendChild(val);
    fields.appendChild(row);
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
    const actionsRow = document.createElement("div");
    actionsRow.className = "ccg-card-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "primary teacher-save-button";
    saveBtn.textContent = "Save";
    saveBtn.disabled = packImportBusy || pendingTeacherImageBusy || packQuestionGenerationBusy;
    saveBtn.title = pendingTeacherImageBusy ? "Cancel teacher image generation before saving." : "";
    saveBtn.addEventListener("click", savePendingTeacherRoll);
    actionsRow.appendChild(saveBtn);
    if (body) {
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
    const imageReason = teacherImageGenerationStatusReason();
    if (imageReason) {
      pendingTeacherImageStatus = imageReason;
      pendingTeacherImageInvalid = true;
      renderPackTeacherEditor();
      return;
    }
    if (!(await confirmHostedCreditSpend("Custom teacher image generation", "portrait"))) return;
    const runId = ++pendingTeacherImageRunId;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    pendingTeacherImageAbortController = controller;
    pendingTeacherImageBusy = true;
    pendingTeacherImageStatus = "";
    pendingTeacherImageInvalid = false;
    renderPackTeacherEditor();
    try {
      const portraitEntitlement = hostedImageEntitlement("portrait") || {};
      const portraitCost = portraitEntitlement.cost || 1;
      if (usingHostedImageGeneration("portrait") && !canSpendHallPasses(portraitCost)) return;
      const r = await apiFetch("/api/apps/ruby-high/chat/teacher/portrait", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({
          requestId: imageRequestId("teacher-portrait"),
          name: pendingTeacherRoll.displayName,
          personality: pendingTeacherRoll.description,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (runId !== pendingTeacherImageRunId) return;
      if (!r.ok) throw new Error(data.error || "teacher image " + r.status);
      if (!data.profileImageUrl) throw new Error("no image returned");
      pendingTeacherRoll = {
        ...pendingTeacherRoll,
        assetTeacherId: "",
        profileImageUrl: data.profileImageUrl,
        imageChoice: "custom",
      };
      applyHallPassBalance(data.hallPasses, data.entitlements);
      pendingTeacherImageStatus = "Teacher image ready.";
      pendingTeacherImageInvalid = false;
    } catch (err) {
      if (runId !== pendingTeacherImageRunId) return;
      const aborted = err && err.name === "AbortError";
      pendingTeacherImageStatus = aborted
        ? "Generation canceled. Custom image is unchanged."
        : (err && err.message ? err.message : "Couldn't generate - keeping the current teacher image.");
      pendingTeacherImageInvalid = !aborted;
    } finally {
      if (runId === pendingTeacherImageRunId) {
        pendingTeacherImageBusy = false;
        pendingTeacherImageAbortController = null;
        renderPackTeacherEditor();
      }
    }
  }
  function cancelTeacherImageGeneration() {
    if (!pendingTeacherImageBusy) return;
    pendingTeacherImageRunId += 1;
    try {
      if (pendingTeacherImageAbortController) pendingTeacherImageAbortController.abort();
    } catch (_err) {
      // Best-effort client-side cancellation.
    }
    pendingTeacherImageAbortController = null;
    pendingTeacherImageBusy = false;
    pendingTeacherImageStatus = "Generation canceled. Custom image is unchanged.";
    pendingTeacherImageInvalid = false;
    renderPackTeacherEditor();
  }
  async function savePendingTeacherRoll() {
    if (!currentDraft || !pendingTeacherRoll || packImportBusy || pendingTeacherImageBusy || packQuestionGenerationBusy) return;
    setPackBusy(true);
    if (packEditStatusEl) packEditStatusEl.textContent = "Adding teacher...";
    const clientRequestId = pendingTeacherRoll.clientRequestId || newPackClientRequestId("teacher");
    pendingTeacherRoll = { ...pendingTeacherRoll, clientRequestId };
    try {
      await saveDraftPackFields();
      await ensureCurrentDraftSaved();
      if (!currentDraft) return;
      currentDraft = await retryPackNetworkWrite("Adding teacher", () => packStudioClient.addTeacherToDraft(currentDraft.id, {
        clientRequestId,
        displayName: pendingTeacherRoll.displayName,
        subject: pendingTeacherRoll.subject,
        description: pendingTeacherRoll.description,
        quote: pendingTeacherRoll.quote,
        assetTeacherId: pendingTeacherRoll.assetTeacherId,
        profileImageUrl: pendingTeacherRoll.profileImageUrl,
        stats: pendingTeacherRoll.stats,
      }));
      selectedPackTeacherId = currentDraft.teachers[currentDraft.teachers.length - 1].id;
      packTeacherCreateMode = false;
      pendingTeacherRoll = null;
      pendingTeacherImageStatus = "";
      pendingTeacherImageInvalid = false;
      renderPackEditor();
      if (packEditStatusEl) packEditStatusEl.textContent = "Teacher added.";
    } catch (err) {
      if (packEditStatusEl) {
        packEditStatusEl.textContent = "Could not add teacher · " + friendlyFetchFailureMessage(err);
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
    teachers.forEach((teacher) => {
        const row = document.createElement("div");
        row.className = "pack-teacher-row" + (teacher.id === selectedPackTeacherId ? " is-selected" : "");
        const select = document.createElement("button");
        select.type = "button";
        select.className = "pack-teacher-select";
        select.disabled = packImportBusy;
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
        subtitle.textContent = packTeacherSubjectsText(teacher) + (teacher.subject ? " · " + teacher.subject : "");
        copy.appendChild(title);
        copy.appendChild(subtitle);
        select.appendChild(avatar);
        select.appendChild(copy);
        select.addEventListener("click", () => selectDraftTeacher(teacher.id));
        const actions = document.createElement("div");
        actions.className = "pack-teacher-actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "pack-teacher-row-action";
        edit.textContent = "Edit";
        edit.disabled = packImportBusy;
        edit.addEventListener("click", () => editDraftTeacher(teacher.id));
        const del = document.createElement("button");
        del.type = "button";
        del.className = "pack-teacher-row-action danger";
        del.textContent = "Delete";
        del.disabled = packImportBusy;
        del.addEventListener("click", () => deleteDraftTeacher(teacher.id));
        actions.appendChild(edit);
        actions.appendChild(del);
        row.appendChild(select);
        row.appendChild(actions);
        packTeacherListEl.appendChild(row);
      });
    renderSelectedPackTeacher(teachers);
  }
  function selectDraftTeacher(teacherId, opts) {
    if (packImportBusy) return;
    if (pendingTeacherImageBusy) cancelTeacherImageGeneration();
    packTeacherCreateMode = false;
    pendingTeacherRoll = null;
    pendingTeacherImageStatus = "";
    if (opts && opts.tab) selectedPackTab = opts.tab;
    selectedPackTeacherId = teacherId;
    renderPackTeacherEditor();
    if (opts && opts.focus) {
      setTimeout(() => {
        if (teacherDisplayNameInputEl && !teacherDisplayNameInputEl.disabled) teacherDisplayNameInputEl.focus();
      }, 0);
    }
  }
  function editDraftTeacher(teacherId) {
    selectDraftTeacher(teacherId, { tab: "settings", focus: true });
  }
  function renderSelectedPackTeacher(teachers) {
    if (!packTeacherDetailEl) return;
    packTeacherDetailEl.innerHTML = "";
    const emptyDraft = !packTeacherCreateMode && teachers.length === 0;
    const teacherSidebar = packTeacherListEl ? packTeacherListEl.closest(".pack-teacher-sidebar") : null;
    if (teacherSidebar) teacherSidebar.hidden = emptyDraft;
    if (packCourseGeneratorEl) packCourseGeneratorEl.hidden = !emptyDraft;
    if (packTeacherCreateMode) {
      if (packCourseGeneratorEl) packCourseGeneratorEl.hidden = true;
      if (teacherSidebar) teacherSidebar.hidden = false;
      packTeacherDetailEl.hidden = false;
      setPackEditorTabsHidden(true);
      renderNewTeacherCreation();
      return;
    }
    if (emptyDraft) {
      packTeacherDetailEl.hidden = true;
      setPackEditorTabsHidden(true);
      fillTeacherDraftForm(null);
      renderQuestionList(null);
      if (courseGenerationStatusEl) {
        const reason = courseGenerationStatusReason();
        courseGenerationStatusEl.textContent = reason;
        courseGenerationStatusEl.classList.toggle("is-invalid", !!reason);
      }
      syncPackGenerationControls();
      return;
    }
    packTeacherDetailEl.hidden = false;
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
      const reason = courseGenerationStatusReason();
      teacherGenerationStatusEl.textContent = teacher
        ? (packQuestionGenerationBusy
          ? "Generating course... You can keep editing, but cancel before closing or publishing."
          : !reason
          ? "Generated " + (teacher.generationCount || 0) + " time" + ((teacher.generationCount || 0) === 1 ? "" : "s") + " today"
          : reason)
        : "";
      teacherGenerationStatusEl.classList.toggle("is-invalid", !!teacher && !!reason);
    }
    syncPackGenerationControls();
  }

  function hostedCourseGenerationConfigured() {
    if (getStoredApiKey()) return true;
    const entitlements = hostedEntitlements();
    const hostedAi = entitlements && entitlements.hosted_ai && typeof entitlements.hosted_ai === "object"
      ? entitlements.hosted_ai
      : null;
    if (localAiEnabled) return !!(hostedAi && hostedAi.configured);
    return !!(hostedAi && hostedAi.active);
  }

  function courseGenerationStatusReason() {
    if (!authed) return "Sign in before generating a course.";
    if (!hostedCourseGenerationConfigured()) {
      return localAiEnabled
        ? "Hosted image generation is required for course portraits."
        : "Connect AI or activate AI Access before generating a course.";
    }
    return "";
  }

  function questionGenerationStatusReason() {
    if (!authed) return "Sign in before generating more questions.";
    if (getStoredApiKey() || localAiEnabled) return "";
    const entitlements = hostedEntitlements();
    const hostedAi = entitlements && entitlements.hosted_ai && typeof entitlements.hosted_ai === "object"
      ? entitlements.hosted_ai
      : null;
    if (!hostedAi || !hostedAi.configured) return "Connect AI before generating more questions.";
    const wallet = walletNumbers(lastTelemetry);
    const cost = creatorPricing().questionGenerationCost;
    return wallet.hallPasses >= cost ? "" : "Need " + hallPassCostLabel(cost) + " to generate more questions.";
  }

  function courseGenerationPayload(teacher) {
    const materials = teacher
      ? String((teacherMaterialsInputEl && teacherMaterialsInputEl.value) || teacher.materials || "").trim()
      : String((courseMaterialsInputEl && courseMaterialsInputEl.value) || "").trim();
    const payload = {
      requestId: newPackClientRequestId("course"),
      materials,
      questionCount: INITIAL_COURSE_QUESTION_COUNT,
    };
    if (teacher) {
      payload.teacherId = teacher.id;
      payload.materialSourceUrl = String((teacherMaterialUrlInputEl && teacherMaterialUrlInputEl.value) || teacher.materialSourceUrl || "").trim();
    }
    return payload;
  }

  function syncPackGenerationControls() {
    const canGenerateCourse = !courseGenerationStatusReason();
    const canGenerateQuestions = !questionGenerationStatusReason();
    syncPackEditorGuardControls();
    if (teacherGenerateQuestionsBtn) {
      teacherGenerateQuestionsBtn.replaceChildren();
      if (packQuestionGenerationBusy) {
        const spinner = document.createElement("span");
        spinner.className = "teacher-button-spinner";
        spinner.setAttribute("aria-hidden", "true");
        teacherGenerateQuestionsBtn.appendChild(spinner);
      }
      const label = document.createElement("span");
      const hostedQuestionCost = !getStoredApiKey() && !localAiEnabled;
      const questionCostLabel = hallPassCostLabel(creatorPricing().questionGenerationCost);
      label.textContent = packQuestionGenerationBusy
        ? "Generating"
        : hostedQuestionCost ? "Generate More Questions (" + questionCostLabel + ")" : "Generate More Questions";
      teacherGenerateQuestionsBtn.appendChild(label);
      teacherGenerateQuestionsBtn.classList.toggle("is-loading", packQuestionGenerationBusy);
      teacherGenerateQuestionsBtn.setAttribute("aria-busy", packQuestionGenerationBusy ? "true" : "false");
      teacherGenerateQuestionsBtn.disabled = packImportBusy || packQuestionGenerationBusy || !selectedDraftTeacher() || !canGenerateQuestions;
      teacherGenerateQuestionsBtn.title = canGenerateQuestions ? "" : questionGenerationStatusReason();
    }
    if (courseGenerateBtn) {
      courseGenerateBtn.replaceChildren();
      if (packQuestionGenerationBusy && packQuestionGenerationKind === "course") {
        const spinner = document.createElement("span");
        spinner.className = "teacher-button-spinner";
        spinner.setAttribute("aria-hidden", "true");
        courseGenerateBtn.appendChild(spinner);
      }
      const label = document.createElement("span");
      label.textContent = packQuestionGenerationBusy && packQuestionGenerationKind === "course" ? "Generating" : "Generate Course";
      courseGenerateBtn.appendChild(label);
      courseGenerateBtn.classList.toggle("is-loading", packQuestionGenerationBusy && packQuestionGenerationKind === "course");
      courseGenerateBtn.setAttribute("aria-busy", packQuestionGenerationBusy && packQuestionGenerationKind === "course" ? "true" : "false");
      courseGenerateBtn.disabled = packImportBusy || packQuestionGenerationBusy || !currentDraft || !canGenerateCourse;
      courseGenerateBtn.title = canGenerateCourse ? "" : courseGenerationStatusReason();
    }
    if (teacherCancelGenerationBtn) {
      teacherCancelGenerationBtn.hidden = !packQuestionGenerationBusy;
      teacherCancelGenerationBtn.disabled = packImportBusy;
    }
    if (courseCancelGenerationBtn) {
      courseCancelGenerationBtn.hidden = !(packQuestionGenerationBusy && packQuestionGenerationKind === "course");
      courseCancelGenerationBtn.disabled = packImportBusy;
    }
    packEditEl.querySelectorAll("[data-requires-openrouter]").forEach((btn) => {
      const imageReason = teacherImageGenerationStatusReason();
      const canGenerateImages = !imageReason;
      btn.disabled = packImportBusy || pendingTeacherImageBusy || !canGenerateImages;
      btn.title = canGenerateImages ? "" : imageReason;
    });
  }

  function renderPackEditor() {
    if (!currentDraft) return;
    const emptyDraft = Array.isArray(currentDraft.teachers) && currentDraft.teachers.length === 0;
    if (packEditTitleEl) packEditTitleEl.textContent = emptyDraft ? "Create content pack" : "Edit pack";
    if (packEditSubtitleEl) packEditSubtitleEl.textContent = emptyDraft ? "Add course materials here." : (currentDraft.name || "Draft content pack");
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

  function selectedTeacherFormPatch() {
    return {
      displayName: String((teacherDisplayNameInputEl && teacherDisplayNameInputEl.value) || "").trim(),
      description: String((teacherPersonaInputEl && teacherPersonaInputEl.value) || "").trim(),
      socialsUrl: String((teacherSocialsInputEl && teacherSocialsInputEl.value) || "").trim(),
      profileImageUrl: String((teacherProfileImageInputEl && teacherProfileImageInputEl.value) || "").trim(),
      materials: String((teacherMaterialsInputEl && teacherMaterialsInputEl.value) || "").trim(),
    };
  }

  function mergeTeacherPatchIntoDraft(draft, teacherId, patch) {
    if (!draft || !Array.isArray(draft.teachers) || !teacherId) return draft;
    return {
      ...draft,
      teachers: draft.teachers.map((teacher) => teacher.id === teacherId ? { ...teacher, ...patch } : teacher),
    };
  }

  function refreshSelectedTeacherLabels() {
    const teacher = selectedDraftTeacher();
    if (!teacher) return;
    const displayName = teacher.displayName || teacher.id;
    const selectedRowTitle = packTeacherListEl && packTeacherListEl.querySelector(".pack-teacher-row.is-selected .pack-teacher-title");
    if (selectedRowTitle) selectedRowTitle.textContent = displayName;
    const detailName = packTeacherDetailEl && packTeacherDetailEl.querySelector(".pack-teacher-detail-name");
    if (detailName) detailName.textContent = displayName;
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
    const patch = {};
    if (packNameInputEl) patch.name = String(packNameInputEl.value || "").trim();
    if (packDescriptionInputEl) patch.description = String(packDescriptionInputEl.value || "").trim();
    if (Object.keys(patch).length === 0) return;
    if (isLocalDraftPack(currentDraft)) {
      currentDraft = Object.assign({}, currentDraft, patch, { updatedAt: Date.now() });
      return;
    }
    try {
      currentDraft = await packStudioClient.updateDraftPack(currentDraft.id, patch);
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
    teacherFormVersion += 1;
    currentDraft = mergeTeacherPatchIntoDraft(currentDraft, selectedPackTeacherId, selectedTeacherFormPatch());
    refreshSelectedTeacherLabels();
    clearTimeout(teacherAutosaveTimer);
    teacherAutosaveTimer = setTimeout(saveSelectedTeacher, 550);
  }

  async function saveSelectedTeacher() {
    if (!currentDraft || !selectedPackTeacherId) return;
    const draftId = currentDraft.id;
    const teacherId = selectedPackTeacherId;
    const runId = ++teacherAutosaveRunId;
    const formVersion = teacherFormVersion;
    const patch = selectedTeacherFormPatch();
    currentDraft = mergeTeacherPatchIntoDraft(currentDraft, teacherId, patch);
    refreshSelectedTeacherLabels();
    try {
      const savedDraft = await packStudioClient.updateTeacher(draftId, teacherId, patch);
      if (
        runId !== teacherAutosaveRunId ||
        formVersion !== teacherFormVersion ||
        !currentDraft ||
        currentDraft.id !== draftId ||
        selectedPackTeacherId !== teacherId
      ) {
        return;
      }
      currentDraft = savedDraft;
      refreshSelectedTeacherLabels();
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
    if (!currentDraft || !teacher || packQuestionGenerationBusy) return;
    await saveSelectedTeacher();
    await runQuestionGeneration(teacher);
  }

  async function generateCourseFromMaterials() {
    if (!currentDraft || packQuestionGenerationBusy) return;
    await runCourseGeneration(null);
  }

  async function runQuestionGeneration(teacher) {
    if (!currentDraft || !teacher || packQuestionGenerationBusy) return;
    const reason = questionGenerationStatusReason();
    if (reason) {
      if (teacherGenerationStatusEl) {
        teacherGenerationStatusEl.textContent = reason;
        teacherGenerationStatusEl.classList.add("is-invalid");
      }
      if (packEditStatusEl) {
        packEditStatusEl.textContent = reason;
        packEditStatusEl.classList.add("is-invalid");
      }
      syncPackGenerationControls();
      return;
    }
    const materials = String((teacherMaterialsInputEl && teacherMaterialsInputEl.value) || teacher.materials || "").trim();
    if (!materials) {
      if (teacherGenerationStatusEl) {
        teacherGenerationStatusEl.textContent = "Course materials are required.";
        teacherGenerationStatusEl.classList.add("is-invalid");
      }
      if (packEditStatusEl) {
        packEditStatusEl.textContent = "Course materials are required.";
        packEditStatusEl.classList.add("is-invalid");
      }
      return;
    }
    const runId = ++packQuestionGenerationRunId;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    packQuestionGenerationAbortController = controller;
    packQuestionGenerationBusy = true;
    packQuestionGenerationKind = "questions";
    syncPackGenerationControls();
    if (packEditStatusEl) {
      packEditStatusEl.textContent = "Generating more questions...";
      packEditStatusEl.classList.remove("is-invalid");
    }
    if (teacherGenerationStatusEl) {
      teacherGenerationStatusEl.textContent = "Generating more questions...";
      teacherGenerationStatusEl.classList.remove("is-invalid");
    }
    try {
      const data = await packStudioClient.generateQuestionsForDraftTeacher(currentDraft.id, teacher.id, {
        signal: controller ? controller.signal : undefined,
      });
      if (runId !== packQuestionGenerationRunId) return;
      currentDraft = data.draft;
      if (data && typeof data.hallPasses === "number") applyHallPassBalance(data.hallPasses, data.entitlements);
      selectedPackTeacherId = teacher.id;
      selectedPackTab = "questions";
      renderPackEditor();
      if (packEditStatusEl) {
        const cost = Math.max(0, Math.round(Number(data.hallPassCost || 0)));
        packEditStatusEl.textContent = cost > 0
          ? "Generated more questions for " + cost + " Card" + (cost === 1 ? "" : "s") + "."
          : "Generated more questions.";
        packEditStatusEl.classList.remove("is-invalid");
      }
    } catch (err) {
      if (runId !== packQuestionGenerationRunId) return;
      const aborted = err && err.name === "AbortError";
      if (packEditStatusEl) {
        packEditStatusEl.textContent = aborted
          ? "Question generation canceled."
          : "Could not generate questions · " + (err && err.message ? err.message : "error");
        packEditStatusEl.classList.toggle("is-invalid", !aborted);
      }
      if (teacherGenerationStatusEl) {
        teacherGenerationStatusEl.textContent = aborted ? "Generation canceled." : "Could not generate questions.";
        teacherGenerationStatusEl.classList.toggle("is-invalid", !aborted);
      }
    } finally {
      if (runId === packQuestionGenerationRunId) {
        packQuestionGenerationBusy = false;
        packQuestionGenerationAbortController = null;
        packQuestionGenerationKind = "";
        syncPackGenerationControls();
      }
    }
  }

  async function runCourseGeneration(teacher) {
    if (!currentDraft || packQuestionGenerationBusy) return;
    const reason = courseGenerationStatusReason();
    if (reason) {
      const status = teacher ? teacherGenerationStatusEl : courseGenerationStatusEl;
      if (status) {
        status.textContent = reason;
        status.classList.add("is-invalid");
      }
      if (packEditStatusEl) {
        packEditStatusEl.textContent = reason;
        packEditStatusEl.classList.add("is-invalid");
      }
      syncPackGenerationControls();
      return;
    }
    const payload = courseGenerationPayload(teacher);
    if (!payload.materials) {
      const status = teacher ? teacherGenerationStatusEl : courseGenerationStatusEl;
      if (status) {
        status.textContent = "Course materials are required.";
        status.classList.add("is-invalid");
      }
      if (packEditStatusEl) {
        packEditStatusEl.textContent = "Course materials are required.";
        packEditStatusEl.classList.add("is-invalid");
      }
      return;
    }
    await saveDraftPackFields();
    await ensureCurrentDraftSaved();
    if (!currentDraft) return;
    const runId = ++packQuestionGenerationRunId;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    packQuestionGenerationAbortController = controller;
    packQuestionGenerationBusy = true;
    packQuestionGenerationKind = "course";
    startCourseGenerationProgress();
    syncPackGenerationControls();
    if (packEditStatusEl) {
      packEditStatusEl.textContent = "Generating course, teacher portrait, and questions. Keep editing, or cancel before closing/publishing.";
      packEditStatusEl.classList.remove("is-invalid");
    }
    const statusEl = teacher ? teacherGenerationStatusEl : courseGenerationStatusEl;
    if (statusEl) {
      statusEl.textContent = "Starting course generation...";
      statusEl.classList.remove("is-invalid");
    }
    try {
      const started = await packStudioClient.generateCourse(currentDraft.id, payload, {
        signal: controller ? controller.signal : undefined,
      });
      if (runId !== packQuestionGenerationRunId) return;
      const data = await waitForCourseGenerationJob(currentDraft.id, started, controller ? controller.signal : undefined);
      if (runId !== packQuestionGenerationRunId) return;
      currentDraft = data.draft;
      if (data && typeof data.hallPasses === "number") applyHallPassBalance(data.hallPasses, data.entitlements);
      selectedPackTeacherId = data.teacher && data.teacher.id ? data.teacher.id : (teacher ? teacher.id : selectedPackTeacherId);
      selectedPackTab = "questions";
      finishCourseGenerationProgress();
      renderPackEditor();
      if (packEditStatusEl) packEditStatusEl.textContent = "Course generated with teacher portrait.";
    } catch (err) {
      if (runId !== packQuestionGenerationRunId) return;
      const aborted = err && err.name === "AbortError";
      if (aborted) resetCourseGenerationProgress();
      else failCourseGenerationProgress();
      if (packEditStatusEl) {
        packEditStatusEl.textContent = aborted
          ? "Course generation canceled."
          : "Could not generate course · " + (err && err.message ? err.message : "error");
        packEditStatusEl.classList.toggle("is-invalid", !aborted);
      }
      if (statusEl) {
        statusEl.textContent = aborted ? "Generation canceled." : "Could not generate course.";
        statusEl.classList.toggle("is-invalid", !aborted);
      }
    } finally {
      if (runId === packQuestionGenerationRunId) {
        packQuestionGenerationBusy = false;
        packQuestionGenerationAbortController = null;
        packQuestionGenerationKind = "";
        syncPackGenerationControls();
      }
    }
  }

  function cancelQuestionGeneration() {
    if (!packQuestionGenerationBusy) return;
    const wasCourseGeneration = packQuestionGenerationKind === "course";
    packQuestionGenerationRunId += 1;
    try {
      if (packQuestionGenerationAbortController) packQuestionGenerationAbortController.abort();
    } catch (_err) {
      // Best-effort client-side cancellation.
    }
    packQuestionGenerationAbortController = null;
    packQuestionGenerationBusy = false;
    packQuestionGenerationKind = "";
    if (packEditStatusEl) {
      packEditStatusEl.textContent = wasCourseGeneration
        ? "Stopped watching course generation. Reopen the draft in a moment if it finishes."
        : "Question generation canceled.";
      packEditStatusEl.classList.remove("is-invalid");
    }
    if (wasCourseGeneration) resetCourseGenerationProgress();
    if (teacherGenerationStatusEl) {
      teacherGenerationStatusEl.textContent = "Generation canceled. Questions are unchanged.";
      teacherGenerationStatusEl.classList.remove("is-invalid");
    }
    if (courseGenerationStatusEl) {
      courseGenerationStatusEl.textContent = wasCourseGeneration
        ? "Stopped watching. The server may still save the course."
        : "Generation canceled.";
      courseGenerationStatusEl.classList.remove("is-invalid");
    }
    syncPackGenerationControls();
  }

  async function deleteDraftTeacher(teacherId) {
    if (!currentDraft || !teacherId || packImportBusy || packQuestionGenerationBusy) return;
    const teacher = currentDraft.teachers.find((entry) => entry.id === teacherId);
    const name = teacher ? (teacher.displayName || "this teacher") : "this teacher";
    if (!(await confirmInApp({
      kicker: "Delete teacher",
      title: "Delete " + name + "?",
      copy: "This removes the teacher and their cards from the draft.",
      confirmText: "Delete",
      tone: "danger",
    }))) return;
    setPackBusy(true);
    if (packEditStatusEl) {
      packEditStatusEl.textContent = "Deleting teacher...";
      packEditStatusEl.classList.remove("is-invalid");
    }
    try {
      currentDraft = await packStudioClient.deleteTeacher(currentDraft.id, teacherId);
      if (selectedPackTeacherId === teacherId) selectedPackTeacherId = currentDraft.teachers[0] ? currentDraft.teachers[0].id : null;
      packTeacherCreateMode = false;
      renderPackEditor();
      if (packEditStatusEl) packEditStatusEl.textContent = "Teacher deleted.";
    } catch (err) {
      if (packEditStatusEl) {
        packEditStatusEl.textContent = "Could not delete teacher · " + (err && err.message ? err.message : "error");
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
    if (packGenerationInFlight()) {
      warnPackGenerationBlocks("publishing");
      return;
    }
    const publishReason = publishCourseSlotStatusReason();
    if (publishReason) {
      if (packEditStatusEl) {
        packEditStatusEl.textContent = publishReason;
        packEditStatusEl.classList.add("is-invalid");
      }
      syncPackEditorGuardControls();
      return;
    }
    await saveDraftPackFields();
    if (isLocalDraftPack(currentDraft)) {
      if (packEditStatusEl) {
        packEditStatusEl.textContent = "Add course materials or a teacher before publishing.";
        packEditStatusEl.classList.add("is-invalid");
      }
      return;
    }
    await saveSelectedTeacher();
    setPackBusy(true);
    if (packEditStatusEl) packEditStatusEl.textContent = "Publishing pack...";
    try {
      const data = await packStudioClient.publishDraft(currentDraft.id);
      if (data && data.draft) currentDraft = data.draft;
      if (data && typeof data.hallPasses === "number") applyHallPassBalance(data.hallPasses, data.entitlements);
      if (packEditStatusEl) packEditStatusEl.textContent = "Course published.";
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
  if (packSearchBtn) packSearchBtn.addEventListener("click", searchCreatorPacks);
  if (packAutoBtn) packAutoBtn.addEventListener("click", setGuestAutoMode);
  if (packSearchInputEl) packSearchInputEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchCreatorPacks();
  });
  if (packPublishBtn) packPublishBtn.addEventListener("click", publishCurrentDraft);
  if (teacherLoadUrlBtn) teacherLoadUrlBtn.addEventListener("click", loadTeacherMaterialsFromUrl);
  if (teacherGenerateQuestionsBtn) teacherGenerateQuestionsBtn.addEventListener("click", generateDraftQuestions);
  if (teacherCancelGenerationBtn) teacherCancelGenerationBtn.addEventListener("click", cancelQuestionGeneration);
  if (courseGenerateBtn) courseGenerateBtn.addEventListener("click", generateCourseFromMaterials);
  if (courseCancelGenerationBtn) courseCancelGenerationBtn.addEventListener("click", cancelQuestionGeneration);
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
  // When AI is enabled, fire the LLM-backed streaming /chat/student-chime
  // endpoint so students respond in their own voice. Offline mode uses canned
  // lines.
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
    let streamedEl = null;
    try {
      const r = await apiFetch("/api/apps/ruby-high/chat/student-chime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: who.id, situation, note, faculty, playerText, recordPlayerText }),
      });
      let finalLine = "";
      await consumeViewerSseStream(r, {
        isCurrent: chimeStillCurrent,
        onErrorResponse(error) {
          throw new Error("student " + (error || r.status));
        },
        onEvent(event, parsed) {
          if (event === "student-delta") {
            if (!streamedEl) streamedEl = appendMsg({ kind: "student", name: who.name, body: "", color: who.color, studentId: who.id });
            streamedEl.dataset.markdownRaw = (streamedEl.dataset.markdownRaw || "") + ((parsed && parsed.text) || "");
            renderMarkdownInto(streamedEl, streamedEl.dataset.markdownRaw);
            scrollIfPinned();
          } else if (event === "student") {
            finalLine = (parsed && parsed.line) || finalLine;
            if (streamedEl && finalLine) {
              streamedEl.dataset.markdownRaw = sanitizeVisibleChatText(finalLine);
              renderMarkdownInto(streamedEl, streamedEl.dataset.markdownRaw);
              scrollIfPinned();
            } else if (finalLine && chimeStillCurrent()) {
              appendMsg({ kind: "student", name: who.name, body: finalLine, color: who.color, studentId: who.id });
            }
          } else if (event === "error") {
            throw new Error(parsed && parsed.message ? parsed.message : "student chime failed");
          }
        },
        watchdogMs: 45000,
      });
      if (!finalLine && !streamedEl && chimeStillCurrent()) {
        appendMsg({ kind: "student", name: who.name, body: pickRandom(STUDENT_LINES_GREET), color: who.color, studentId: who.id });
      }
      return true;
    } catch (err) {
      // Fallback to canned line if the API call fails.
      const fallback = situation === "answer-correct"
        ? pickRandom(STUDENT_LINES_RIGHT)
        : situation === "answer-wrong"
          ? pickRandom(STUDENT_LINES_WRONG)
          : pickRandom(STUDENT_LINES_GREET);
      if (chimeStillCurrent()) {
        if (streamedEl) {
          streamedEl.dataset.markdownRaw = sanitizeVisibleChatText(fallback);
          renderMarkdownInto(streamedEl, streamedEl.dataset.markdownRaw);
          scrollIfPinned();
        } else {
          appendMsg({ kind: "student", name: who.name, body: fallback, color: who.color, studentId: who.id });
        }
      }
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
  function showCongrats(text, wasCorrect, durationMs) {
    if (!text) return;
    els.congrats.textContent = text;
    els.congrats.classList.remove("is-correct", "is-wrong", "is-visible");
    void els.congrats.offsetWidth;
    els.congrats.classList.add(wasCorrect ? "is-correct" : "is-wrong", "is-visible");
    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => els.congrats.classList.remove("is-visible"), Number.isFinite(durationMs) ? durationMs : 2400);
  }

  // ── auth ─────────────────────────────────────────────────────────────────
  let lastAuthState = null;
  let authCheckSeq = 0;
  function setSigninStatus(text, invalid) {
    if (!els.signinStatus) return;
    els.signinStatus.textContent = text || "";
    els.signinStatus.classList.toggle("is-invalid", !!invalid);
  }
  function setPrivyStatus(text, invalid) {
    if (!els.privyStatus) return;
    els.privyStatus.textContent = text || "";
    els.privyStatus.classList.toggle("is-invalid", !!invalid);
  }
  // shortWallet is in client-pure.
  function connectedSolanaWalletAddress() {
    return privyState.solanaWalletAddress || null;
  }
  function knownSolanaOwnerWalletAddress() {
    return connectedSolanaWalletAddress()
      || privyState.solanaAccountAddress
      || (privyState.walletChainType === "solana" ? privyState.walletAddress : null)
      || null;
  }
  function sanitizePrivyDiagnostic(event) {
    const source = event && typeof event === "object" ? event : {};
    const payload = {};
    Object.keys(source).forEach((key) => {
      if (/token|secret|signature$|siws|messageText/i.test(key)) return;
      const value = source[key];
      if (value == null || typeof value === "boolean" || typeof value === "number") {
        payload[key] = value;
      } else if (typeof value === "string") {
        const compact = value.replace(/\s+/g, " ").trim();
        payload[key] = compact.length > 240 ? compact.slice(0, 239) + "..." : compact;
      }
    });
    payload.privyAuthenticated = !!privyState.authenticated;
    return payload;
  }
  function reportPrivyDiagnostic(event) {
    const payload = sanitizePrivyDiagnostic(event);
    const label = payload.type || "privy.diagnostic";
    if (payload.level === "error") {
      console.error("[ruby-high:privy]", label, payload);
      const metricPayload = Object.assign({ diagnosticType: label }, payload);
      delete metricPayload.type;
      postViewerMetricEvent("privy_auth_error", metricPayload);
    } else if (console.info) {
      console.info("[ruby-high:privy]", label, payload);
    }
  }
  function friendlyPrivyAccountError(err, fallback) {
    const message = err && err.message ? String(err.message) : String(err || "");
    if (/429|too many requests|rate.?limit/i.test(message)) {
      return "Privy is rate limiting wallet requests. Wait a minute, then try again.";
    }
    if (/disallowed_login_method/i.test(message)) {
      return "Privy blocked wallet sign-in. Enable wallet login in the Privy dashboard, then refresh Ruby High.";
    }
    if (/popup|modal|did not open/i.test(message)) {
      return "Privy sign-in did not open. Refresh Ruby High and try again.";
    }
    return message || fallback || "Privy sign-in failed";
  }
  function applyPrivyState(next) {
    if (next && typeof next === "object") {
      const authenticated = !!next.authenticated;
      const hasSolanaWallet = Object.prototype.hasOwnProperty.call(next, "solanaWalletAddress");
      const hasSolanaAccount = Object.prototype.hasOwnProperty.call(next, "solanaAccountAddress");
      const nextSolanaWalletAddress = next.solanaWalletAddress
        || (authenticated && !hasSolanaWallet ? privyState.solanaWalletAddress : null);
      const nextSolanaAccountAddress = next.solanaAccountAddress
        || nextSolanaWalletAddress
        || (next.walletChainType === "solana" ? next.walletAddress : null)
        || (authenticated && !hasSolanaAccount ? privyState.solanaAccountAddress : null);
      privyState = {
        configured: !!(next.configured != null ? next.configured : privyState.configured),
        authenticated,
        ready: next.ready != null ? !!next.ready : true,
        walletAddress: next.walletAddress || null,
        walletChainType: next.walletChainType || null,
        solanaWalletAddress: authenticated ? nextSolanaWalletAddress : null,
        solanaAccountAddress: authenticated ? nextSolanaAccountAddress : null,
        label: next.label || null,
      };
    }
    const solanaAddress = knownSolanaOwnerWalletAddress();
    if (els.privyWallet) {
      els.privyWallet.textContent = solanaAddress
        ? shortWallet(solanaAddress) + " · solana"
        : privyState.walletAddress
        ? shortWallet(privyState.walletAddress) + " · " + (privyState.walletChainType || "wallet")
        : privyState.authenticated
          ? "Privy account · no Solana wallet"
          : privyState.configured
            ? "Not connected"
            : "Privy not configured";
    }
    if (els.privyLoginWidget) {
      const needsWalletConnect = privyState.authenticated && !solanaAddress;
      els.privyLoginWidget.hidden = !privyState.configured || (privyState.authenticated && !needsWalletConnect);
      els.privyLoginWidget.textContent = needsWalletConnect ? "Connect Wallet" : "Sign in with Privy";
      els.privyLoginWidget.title = needsWalletConnect
        ? "Connect a Solana wallet to open packs and reveal Cards."
        : "Sign in with Privy";
    }
    if (els.privySignout) els.privySignout.hidden = !privyState.authenticated;
    if (els.signinPrivy) els.signinPrivy.hidden = !privyState.configured;
    applyAuthUI();
    renderAccountPage();
  }
  async function getPrivyClient() {
    if (!privyConfig) return null;
    if (privyClient) return privyClient;
    if (!privyClientPromise) {
      privyClientPromise = loadScriptGlobal(PRIVY_CLIENT_URL, PRIVY_CLIENT_GLOBAL)
        .then((mod) => mod.createRubyHighPrivyClient(privyConfig))
        .then((client) => {
          privyClient = client;
          if (typeof client.onSession === "function") {
            client.onSession((snapshot) => handlePrivySession(snapshot, { source: "event" }));
          }
          if (typeof client.onDiagnostic === "function") {
            client.onDiagnostic(reportPrivyDiagnostic);
          }
          return client;
        })
        .finally(() => {
          privyClientPromise = null;
        });
    }
    return privyClientPromise;
  }
  function loadScriptGlobal(url, globalName) {
    const existing = window[globalName];
    if (existing && typeof existing.createRubyHighPrivyClient === "function") return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.dataset.rubyHighPrivyClient = "true";
      script.onload = () => {
        const mod = window[globalName];
        if (mod && typeof mod.createRubyHighPrivyClient === "function") {
          resolve(mod);
          return;
        }
        reject(new Error("Privy account bundle loaded without a client."));
      };
      script.onerror = () => reject(new Error("Could not load the Privy account bundle."));
      document.head.appendChild(script);
    });
  }
  async function handlePrivySession(snapshot, opts) {
    if (!snapshot || !snapshot.authenticated) {
      applyPrivyState({ configured: !!privyConfig, authenticated: false, ready: true });
      return;
    }
    applyPrivyState({ ...snapshot, configured: true, ready: true });
    await syncPrivyServerSession(snapshot);
    if (opts && opts.source === "login") {
      setPrivyStatus("Account connected.", false);
      closePrivyAccount();
    }
    await fetchSession();
  }
  async function syncPrivyServerSession(snapshot) {
    const session = snapshot || (privyClient ? await privyClient.current() : null);
    if (!session || (!session.accessToken && !session.identityToken)) return null;
    const r = await fetch(apiBase + "/auth/privy", {
      method: "POST",
      credentials: "same-origin",
      headers: attachVisitorHeader(new Headers({ "Content-Type": "application/json" })),
      body: JSON.stringify({
        accessToken: session.accessToken || undefined,
        identityToken: session.identityToken || undefined,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.session) throw new Error(data.error || "Privy sign-in failed");
    if (data.privy) applyPrivyState({ ...data.privy, ready: true });
    setAuthState(true, { ai: !!data.ai, local_ai: !!data.local_ai, hosted_ai: data.hosted_ai, entitlements: data.entitlements, privy: data.privy });
    return data;
  }
  async function initializePrivyFromStoredSession() {
    if (!privyConfig) {
      applyPrivyState({ configured: false, authenticated: false, ready: true });
      return;
    }
    const now = Date.now();
    if (billingBusy) return privyRefreshPromise;
    if (privyRefreshPromise) return privyRefreshPromise;
    if (lastPrivyRateLimitedAt > 0 && now - lastPrivyRateLimitedAt < PRIVY_RATE_LIMIT_BACKOFF_MS) return null;
    if (lastPrivyRefreshAt > 0 && now - lastPrivyRefreshAt < PRIVY_REFRESH_MIN_INTERVAL_MS) return null;
    lastPrivyRefreshAt = now;
    privyRefreshPromise = (async () => {
      try {
        const client = await getPrivyClient();
        if (!client) return;
        const snapshot = await client.current();
        applyPrivyState({ ...snapshot, configured: true, ready: true });
        if (snapshot.authenticated) await syncPrivyServerSession(snapshot);
      } catch (err) {
        if (/429|too many requests|rate.?limit/i.test(err && err.message ? String(err.message) : String(err || ""))) {
          lastPrivyRateLimitedAt = Date.now();
        }
        if (!privyState.authenticated) applyPrivyState({ configured: true, authenticated: false, ready: true });
        if (els.privyOverlay && els.privyOverlay.classList.contains("is-open")) {
          setPrivyStatus("Privy unavailable · " + friendlyPrivyAccountError(err, "error"), true);
        }
      } finally {
        privyRefreshPromise = null;
      }
    })();
    return privyRefreshPromise;
  }
  async function startPrivyLogin(opts) {
    if (!privyConfig) return;
    const fromBilling = opts && opts.source === "billing";
    const reportStatus = fromBilling ? setBillingStatus : setPrivyStatus;
    setPrivyBusy(true);
    reportStatus("Opening Privy sign-in...", false);
    try {
      const client = await getPrivyClient();
      if (!client) throw new Error("Privy is not configured.");
      const snapshot = await client.login();
      if (!snapshot) {
        reportStatus("Privy sign-in closed.", false);
        return null;
      }
      await handlePrivySession(snapshot, { source: fromBilling ? "billing-login" : "login" });
      if (fromBilling) reportStatus("Account connected. Continue with card pack checkout.", false);
      return snapshot;
    } catch (err) {
      if (!fromBilling && els.privyOverlay) els.privyOverlay.classList.add("is-open");
      reportStatus(friendlyPrivyAccountError(err, "Privy sign-in failed"), true);
      return null;
    } finally {
      setPrivyBusy(false);
    }
  }
  async function startSolanaWalletConnect(opts) {
    if (!privyConfig) return;
    const fromBilling = opts && opts.source === "billing";
    const reportStatus = fromBilling ? setBillingStatus : setPrivyStatus;
    setPrivyBusy(true);
    reportStatus("Opening Solana wallet connection...", false);
    try {
      const client = await getPrivyClient();
      if (!client || typeof client.connectSolanaWallet !== "function") throw new Error("Solana wallet connection is unavailable.");
      const snapshot = await client.connectSolanaWallet();
      if (!snapshot) {
        reportStatus("Solana wallet connection closed.", false);
        return null;
      }
      await handlePrivySession(snapshot, { source: fromBilling ? "billing-wallet-connect" : "wallet-connect" });
      reportStatus(connectedSolanaWalletAddress() ? "Solana wallet connected." : "Account connected.", false);
      if (billingProductsCache) renderBillingProducts(billingProductsCache);
      if (!fromBilling) void syncWalletPackNftsFromAccount({ force: true });
      return snapshot;
    } catch (err) {
      reportStatus(friendlyPrivyAccountError(err, "Solana wallet connection failed"), true);
      return null;
    } finally {
      setPrivyBusy(false);
    }
  }
  async function openPrivyAccount() {
    setPrivyStatus("Checking account...", false);
    try {
      await initializePrivyFromStoredSession();
      if (els.privyOverlay) els.privyOverlay.classList.add("is-open");
      els.privyOverlay?.setAttribute("aria-hidden", "false");
      setPrivyStatus(privyState.authenticated
        ? knownSolanaOwnerWalletAddress()
          ? "Account connected."
          : "Connect a Solana wallet to open packs and reveal Cards."
        : "", false);
      renderAccountPage();
      if (els.accountWorkspace) els.accountWorkspace.scrollTop = 0;
      void syncWalletPackNftsFromAccount({ force: true });
    } catch (err) {
      if (els.privyOverlay) els.privyOverlay.classList.add("is-open");
      els.privyOverlay?.setAttribute("aria-hidden", "false");
      setPrivyStatus(friendlyPrivyAccountError(err, "Privy error"), true);
    }
  }
  function closePrivyAccount() {
    if (!els.privyOverlay) return;
    els.privyOverlay.classList.remove("is-open");
    els.privyOverlay.setAttribute("aria-hidden", "true");
    setPrivyStatus("", false);
  }
  function setPrivyBusy(busy) {
    if (els.privyLoginWidget) els.privyLoginWidget.disabled = !!busy;
    if (els.privySignout) els.privySignout.disabled = !!busy;
  }
  async function signOutPrivy() {
    setPrivyBusy(true);
    setPrivyStatus("Signing out...", false);
    try {
      const client = await getPrivyClient();
      if (client) await client.logout();
      applyPrivyState({ configured: !!privyConfig, authenticated: false, ready: true });
      await logout();
      setPrivyStatus("Signed out.", false);
    } catch (err) {
      setPrivyStatus(err && err.message ? err.message : "Could not sign out", true);
    } finally {
      setPrivyBusy(false);
    }
  }
  function setAuthState(next, opts) {
    const nextAi = !!(opts && opts.ai);
    const nextLocalAi = !!(opts && opts.local_ai);
    const hostedAi = opts && opts.entitlements && opts.entitlements.hosted_ai ? opts.entitlements.hosted_ai : opts && opts.hosted_ai;
    const nextHostedAiActive = !!(hostedAi && hostedAi.active);
    if (next === lastAuthState && nextAi === aiEnabled && nextLocalAi === localAiEnabled && nextHostedAiActive === hostedAiActive) {
      if (opts && opts.entitlements && typeof opts.entitlements === "object" && lastTelemetry) {
        lastTelemetry = {
          ...lastTelemetry,
          entitlements: opts.entitlements,
          hosted_ai: opts.entitlements.hosted_ai || lastTelemetry.hosted_ai,
        };
      }
      if (opts && opts.privy) applyPrivyState({ ...opts.privy, ready: true });
      return;
    }
    const wasSignedIn = lastAuthState === true;
    lastAuthState = next;
    authed = next;
    aiEnabled = nextAi;
    localAiEnabled = nextLocalAi;
    hostedAiActive = nextHostedAiActive;
    if (opts && opts.entitlements && typeof opts.entitlements === "object" && lastTelemetry) {
      lastTelemetry = {
        ...lastTelemetry,
        entitlements: opts.entitlements,
        hosted_ai: opts.entitlements.hosted_ai || lastTelemetry.hosted_ai,
      };
    }
    if (opts && opts.privy) applyPrivyState({ ...opts.privy, ready: true });
    applyAuthUI();
    // Browser-owned AI is optional. The overlay is now only a fallback if the app
    // cannot establish even a guest Ruby High session.
    if (authed === false) {
      signinEl.classList.add("is-open");
      signinEl.setAttribute("aria-hidden", "false");
      setSigninStatus("Local session unavailable. Retry, or use an AI key.", true);
      if (sheetOverlayOpen) closeSheet();
    } else {
      signinEl.classList.remove("is-open");
      signinEl.setAttribute("aria-hidden", "true");
      setSigninStatus("", false);
    }
    if (teacherChatEnabled() && lastTelemetry) loadHistory(lastTelemetry.faculty);
    if (sheetOverlayOpen) renderSheet();
  }
  // Auth is split: the browser-owned AI key stays in web storage, while the
  // server owns an opaque Ruby High session cookie that maps to the
  // persistent character. Verify both on boot and whenever OAuth state may
  // have changed.
  async function ensureGuestSession() {
    const headers = new Headers();
    const key = getStoredApiKey();
    if (key) headers.set("X-Openrouter-Key", key);
    attachVisitorHeader(headers);
    const r = await fetch("/api/apps/ruby-high/auth/guest", {
      method: "POST",
      credentials: "same-origin",
      headers,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data || !data.session) throw new Error("guest session failed");
    setAuthState(true, { ai: !!data.ai, local_ai: !!data.local_ai, hosted_ai: data.hosted_ai, entitlements: data.entitlements, privy: data.privy });
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
      attachVisitorHeader(headers);
      const r = await fetch("/api/apps/ruby-high/auth/me", {
        credentials: "same-origin",
        headers,
      });
      const data = await r.json().catch(() => ({}));
      if (seq !== authCheckSeq) return;
      if (r.ok && data && data.session) {
        setAuthState(true, { ai: !!data.ai, local_ai: !!data.local_ai, hosted_ai: data.hosted_ai, entitlements: data.entitlements, privy: data.privy });
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
      if (els.privyAction) els.privyAction.hidden = true;
      renderAccountPage();
      return;
    }
    if (authed) {
      els.youState.textContent = privyState.authenticated && privyState.walletAddress
        ? shortWallet(privyState.walletAddress)
        : aiEnabled
          ? (localAiEnabled ? "local AI" : "AI enabled")
          : activeTeacherUsesServerAi() ? "teacher connected" : "offline mode";
      els.footerAction.hidden = true;
      if (els.privyAction) {
        els.privyAction.textContent = "Account";
        els.privyAction.hidden = false;
      }
      if (els.hallPassBtn) els.hallPassBtn.hidden = false;
      els.chatForm.hidden = true;
      setChatComposerDisabled(true);
    } else {
      // Unauthed means even guest-session creation failed; the fallback
      // sign-in overlay is the only thing the user can see.
      els.youState.textContent = "signed out";
      els.footerAction.hidden = true;
      if (els.privyAction) els.privyAction.hidden = true;
      if (els.hallPassBtn) els.hallPassBtn.hidden = false;
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
    syncPackGenerationControls();
    renderAccountPage();
  }
  async function logout() {
    // Clear the credential first so any in-flight refresh sees us as
    // signed out, then ask the server to drop the cookie that bucketed
    // our state.
    clearStoredAuth();
    try {
      await fetch("/api/apps/ruby-high/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: attachVisitorHeader(new Headers()),
      });
    } catch (e) { /* network failure is fine — local state is what matters */ }
    authed = null;
    aiEnabled = false;
    localAiEnabled = false;
    hostedAiActive = false;
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
      hostedAiActive = !!((data.entitlements && data.entitlements.hosted_ai && data.entitlements.hosted_ai.active) || (data.hosted_ai && data.hosted_ai.active));
      if (data.entitlements && typeof data.entitlements === "object") {
        lastTelemetry = {
          ...lastTelemetry,
          entitlements: data.entitlements,
          hosted_ai: data.entitlements.hosted_ai || lastTelemetry.hosted_ai,
        };
      }
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
    let playerStreamMsgEl = null;
    let studentStreamMsgEl = null;
    function replaceStreamMsgBody(el, text) {
      if (!el) return;
      el.dataset.markdownRaw = sanitizeVisibleChatText(text || "");
      renderMarkdownInto(el, el.dataset.markdownRaw);
      scrollIfPinned();
    }
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
        } else if (event === "player-delta") {
          if (!playerStreamMsgEl) {
            playerStreamMsgEl = appendMsg({ kind: "you", name: playerDisplayName(), body: "", color: "var(--accent)" });
          }
          playerStreamMsgEl.dataset.markdownRaw = (playerStreamMsgEl.dataset.markdownRaw || "") + ((parsed && parsed.text) || "");
          renderMarkdownInto(playerStreamMsgEl, playerStreamMsgEl.dataset.markdownRaw);
          scrollIfPinned(true);
        } else if (event === "player-line") {
          const text = parsed && parsed.text ? String(parsed.text) : "";
          if (text) {
            if (playerStreamMsgEl) replaceStreamMsgBody(playerStreamMsgEl, text);
            else appendMsg({ kind: "you", name: playerDisplayName(), body: text, color: "var(--accent)" });
          }
          playerStreamMsgEl = null;
          streamMsgEl = null;
        } else if (event === "student-delta") {
          const student = parsed && parsed.student ? parsed.student : {};
          if (!studentStreamMsgEl) {
            studentStreamMsgEl = appendMsg({
              kind: "student",
              name: student.name || "Student",
              body: "",
              color: student.color || "#52c673",
              studentId: student.id || "",
            });
          }
          studentStreamMsgEl.dataset.markdownRaw = (studentStreamMsgEl.dataset.markdownRaw || "") + ((parsed && parsed.text) || "");
          renderMarkdownInto(studentStreamMsgEl, studentStreamMsgEl.dataset.markdownRaw);
          scrollIfPinned();
        } else if (event === "student") {
          const student = parsed && parsed.student ? parsed.student : {};
          const line = parsed && parsed.line ? String(parsed.line) : "";
          if (line) {
            if (studentStreamMsgEl) replaceStreamMsgBody(studentStreamMsgEl, line);
            else {
              appendMsg({
                kind: "student",
                name: student.name || "Student",
                body: line,
                color: student.color || "#52c673",
                studentId: student.id || "",
              });
            }
          }
          studentStreamMsgEl = null;
          streamMsgEl = null;
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
          // JSON dump."
          const teacherName = (speaker && speaker.name) || "Teacher";
          appendTool(toolSummary(parsed, teacherName));
          refreshSessionAfterStreamEvent();
          streamMsgEl = null;
        } else if (event === "error") {
          appendSystem("error · " + (parsed.message || "unknown"));
          refreshSessionAfterStreamEvent();
          playerStreamMsgEl = null;
          studentStreamMsgEl = null;
          streamMsgEl = null;
        } else if (event === "waiting" || event === "opinion-graded") {
          refreshSessionAfterStreamEvent();
          streamMsgEl = null;
        } else if (event === "done" || event === "end") {
          refreshSessionAfterStreamEvent();
          playerStreamMsgEl = null;
          studentStreamMsgEl = null;
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
        const re = new RegExp("\b" + s.name + "\b", "i");
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
  if (els.privyAction) els.privyAction.addEventListener("click", openPrivyAccount);
  if (els.signinPrivy) els.signinPrivy.addEventListener("click", openPrivyAccount);

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

  if (els.reportBugLink && !els.reportBugLink.dataset.discordLink) {
    els.reportBugLink.addEventListener("click", openBugReport);
  }
  if (els.bugReportForm) els.bugReportForm.addEventListener("submit", submitBugReport);
  if (els.bugReportClose) els.bugReportClose.addEventListener("click", closeBugReport);
  if (els.bugReportCancel) els.bugReportCancel.addEventListener("click", closeBugReport);
  if (els.bugReportOverlay) els.bugReportOverlay.addEventListener("click", (e) => {
    if (e.target === els.bugReportOverlay) closeBugReport();
  });
  if (els.hallPassBtn) els.hallPassBtn.addEventListener("click", () => {
    setAccountPane("account");
    void openPrivyAccount();
  });
  if (Array.isArray(els.accountTabs)) {
    els.accountTabs.forEach((tab) => {
      tab.addEventListener("click", () => setAccountPane(tab.getAttribute("data-account-tab")));
    });
  }
  if (els.accountBuyPasses) els.accountBuyPasses.addEventListener("click", () => openBilling({ mode: "hall-passes" }));
  if (els.accountBuyCardPacks) els.accountBuyCardPacks.addEventListener("click", () => {
    const checkout = cardPackCheckoutState();
    if (!authed) return;
    if (checkout.loaded && !checkout.ready) {
      setBillingStatus("Card pack checkout is unavailable right now.", true);
      if (els.accountCardSummary) {
        els.accountCardSummary.textContent = "Card pack checkout is unavailable right now.";
      }
      return;
    }
    openBilling({ mode: "card-packs" });
  });
  if (els.accountMintCards) els.accountMintCards.addEventListener("click", async () => {
    if (billingBusy) return;
    const hasWallet = !!knownSolanaOwnerWalletAddress();
    const hasPendingMints = pendingHallPassCardMintsForTelemetry().length > 0;
    const hasActivePack = hallPassPacksForTelemetry().some((pack) => pack.status === "active");
    if (!hasWallet && (hasPendingMints || hasActivePack)) {
      await ensureSolanaWalletFromAccount();
      return;
    }
    if (hasPendingMints) {
      await mintPendingCardNftsFromAccount();
    }
  });
  if (els.accountCreateCharacter) els.accountCreateCharacter.addEventListener("click", openCharacterCreationFromAccount);
  if (els.accountUnlockSlot) els.accountUnlockSlot.addEventListener("click", unlockCharacterSlotFromAccount);
  if (els.accountAiUsePass) els.accountAiUsePass.addEventListener("click", () => activateAiPass({ source: "account" }));
  if (els.accountAiAction) els.accountAiAction.addEventListener("click", handleAccountAiAction);
  if (els.blackboardEmptyAction) els.blackboardEmptyAction.addEventListener("click", handleBlackboardEmptyAction);
  if (els.billingClose) els.billingClose.addEventListener("click", closeBilling);
  if (els.billingOverlay) els.billingOverlay.addEventListener("click", (e) => {
    if (e.target === els.billingOverlay) closeBilling();
  });
  if (els.signinGuest) els.signinGuest.addEventListener("click", retryGuestSession);
  if (els.privyClose) els.privyClose.addEventListener("click", closePrivyAccount);
  if (els.privyOverlay) els.privyOverlay.addEventListener("click", (e) => {
    if (e.target === els.privyOverlay) closePrivyAccount();
  });
  if (els.privyLoginWidget) els.privyLoginWidget.addEventListener("click", async () => {
    if (privyState.authenticated) {
      await ensureSolanaWalletFromAccount();
      return;
    }
    await startPrivyLogin();
  });
  if (els.privySignout) els.privySignout.addEventListener("click", signOutPrivy);

  // Click your name/avatar to open the character sheet.
  const youCardBlock = document.querySelector(".channels-footer .you-meta");
  // ── onboarding button handlers ──────────────────────────────────────────
  // ── morning announcements dismiss ───────────────────────────────────────
  const announcementsDismiss = document.getElementById("announcements-dismiss");
  if (announcementsDismiss) announcementsDismiss.addEventListener("click", dismissAnnouncements);
  // Allow Escape key to dismiss
  document.addEventListener("keydown", function(ev) {
    if (ev.key === "Escape" && announcementsOverlay && !announcementsOverlay.hidden) {
      dismissAnnouncements();
    }
  });
  // Click outside panel to dismiss
  var announcementsOverlayEl = document.getElementById("announcements-overlay");
  if (announcementsOverlayEl) announcementsOverlayEl.addEventListener("click", function(ev) {
    if (ev.target === announcementsOverlayEl) dismissAnnouncements();
  });

  const onboardingCreateBtn = document.getElementById("onboarding-create-btn");
  const onboardingBooksBtn = document.getElementById("onboarding-books-btn");
  if (onboardingCreateBtn) onboardingCreateBtn.addEventListener("click", () => {
    onboardingCreateBtn.disabled = true;
    openCharacterCreation();
  });
  if (onboardingBooksBtn) onboardingBooksBtn.addEventListener("click", () => {
    window.open("https://ratimics.gumroad.com", "_blank", "noopener,noreferrer");
  });

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
  consumeReferralFlag();
  // The session is born already enrolled at Freshman year (server-side
  // default). The player progresses Freshman → Sophomore → Junior → Senior
  // → graduate as they clear per-grade daily-class and subject-grade gates. There is no year
  // picker — they walk in, get started, and advance by playing.
  // Auth is checked once on boot and again whenever a persistent OAuth
  // key changes in another tab or the user returns to this tab from
  // elsewhere (focus). No periodic polling: the only
  // server state we need here is the session cookie's current validity.
  async function bootInitialSession() {
    showWelcomeBackCopy = markLocalAppOpen();
    await deriveAuth();
    postViewerMetricEvent("app_open", {
      path: window.location.pathname,
      referrer: document.referrer || "",
      ref: referralRef || "",
    });
    await fetchSession();
  }
  void bootInitialSession();
  initializePrivyFromStoredSession();
  window.addEventListener("storage", (e) => {
    if (e.key === AUTH_KEY || e.key === AUTH_LABEL || e.key === AUTH_PERSIST || e.key === null) deriveAuth();
  });
  // Belt-and-braces wake-up triggers. The OAuth flow is now same-tab so
  // none of these are load-bearing on the happy path, but they cover any
  // edge where the user returns from a separate-tab flow (a stray
  // target=_blank link, a back-forward cache hit, a tab-switch on iOS
  // Safari which does not fire focus reliably between same-window tabs).
  let hiddenAt = document.visibilityState === "hidden" ? Date.now() : 0;
  let lastResumeMetricAt = 0;
  function maybePostSessionResume(reason) {
    if (hiddenAt <= 0) return;
    const now = Date.now();
    const inactiveMs = now - hiddenAt;
    if (inactiveMs < 5 * 60 * 1000) return;
    if (lastResumeMetricAt > 0 && now - lastResumeMetricAt < 5 * 60 * 1000) return;
    lastResumeMetricAt = now;
    hiddenAt = 0;
    postViewerMetricEvent("session_resume", {
      inactiveMs: Math.max(0, Math.floor(inactiveMs || 0)),
      reason: reason || "visible",
    });
  }
  window.addEventListener("focus", () => { deriveAuth(); initializePrivyFromStoredSession(); maybePostSessionResume("focus"); });
  window.addEventListener("pageshow", () => { deriveAuth(); initializePrivyFromStoredSession(); maybePostSessionResume("pageshow"); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    if (document.visibilityState === "visible") {
      deriveAuth();
      initializePrivyFromStoredSession();
      maybePostSessionResume("visibilitychange");
    }
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
}
