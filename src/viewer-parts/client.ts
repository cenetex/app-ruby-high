// @ts-nocheck
// Browser client body for the inline Ruby High viewer. This is real JavaScript
// now, not a template-string blob; keep imports out of this file because
// viewerScript serializes runViewerClient with Function#toString().
export function runViewerClient(bootstrap) {
  const motionPreference = initViewerMotionPreference();
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
  const sessionUrl = apiBase + "/session/" + encodeURIComponent(sessionId);
  const commandUrl = sessionUrl + "/command";
  const metricsEventUrl = apiBase + "/metrics/event";
  // VIEWER_CONSTANTS (VISITOR_ID_KEY, GRADE_LABELS, STAT_META, …) and pure
  // helpers (statLabel, letterGradeForScore, makeVisitorId, getVisitorId,
  // attachVisitorHeader, …) are declared in the surrounding IIFE by
  // viewer-parts/script.ts → client-pure.ts. They're in scope here.
  function subjectProgressForFaculty(fid) {
    const roster = (lastTelemetry && lastTelemetry.faculty_roster) || [];
    return roster.find((f) => f.id === fid) || null;
  }
  function subjectDisplayName(fid, progress) {
    const known = { ruby: "Homeroom", "sally-science": "Science", "professor-edward": "Literature", roko: "AI Alignment" };
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
      if (tomorrow.name === "Roko" || tomorrow.name === "roko") return "Roko";
      return tomorrow.name;
    }
    return null;
  }

  function postClassState(t) {
    const progress = t && t.active_course_progress;
    const report = !!(t && activeDailyClassIsComplete(t) && !t.current && !t.graduation_ready);
    const nextRole = (progress && progress.nextCardRole) || "";
    const nextOpinionPurpose = (progress && progress.nextOpinionPurpose) || "";
    const canPick = scheduledCanPick(t);
    const hasBank = Number(progress && progress.total || 0) > 0;
    return {
      report,
      nextRole,
      canPick,
      essayReady: report && canPick && nextOpinionPurpose === "grade-essay",
      socialReady: report && canPick && nextRole === "social" && nextOpinionPurpose !== "grade-essay",
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
      : "Today's class is done. Sign up to keep your student, earn Merit Stars, and open every classroom. It only takes a moment.";
  }
  function nextChatCost(t) {
    const value = Number(t && t.next_chat_cost);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 100;
  }
  function chatActionLabel(t) {
    return "Chat " + formatWholeNumber(nextChatCost(t)) + " ⭐";
  }
  function chatCostTitle(t, prefix) {
    return prefix + " Costs " + formatWholeNumber(nextChatCost(t)) + " Merit Stars.";
  }
  function nextQuestionButtonLabel(t) {
    t = t || lastTelemetry;
    if (t && t.graduation_ready && !t.current) return "Ceremony";
    const round = t && t.active_round;
    const cur = t && t.current;
    const offlineClassroom = !!(authed && !teacherChatEnabled() && t && t.character && t.faculty !== LOUNGE_ID);
    if (round && !round.resolved && cur) return offlineClassroom ? "Continue" : chatActionLabel(t);
    if (cur && (currentRevealMatches(t) || t.status === "revealed")) {
      const progressView = dailyClassProgressView(t);
      return progressView.visible ? progressView.continuationLabel : "Continue";
    }
    if (t && t.graduation_gate && t.graduation_gate.stage === "essay" && !cur) return "Final build";
    const postClass = postClassState(t);
    if (postClass.report && guestSignupRequired(t)) return "Sign up";
    if (postClass.essayReady) return "Final build";
    if (postClass.socialReady) return "Reflect";
    if (postClass.report) return "Practice";
    return offlineClassroom ? "Continue" : chatActionLabel(t);
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
    const live = !!(round && !round.resolved && cur);
    const ceremonyReady = !!(t && t.graduation_ready && !cur);
    const inFreeformRound = !!(
      live
      && (t.is_opinion || cur.type === "typed-answer" || cur.type === "image-occlusion" || cur.type === "story-action")
    );
    // Offline multiple-choice rounds already have one clear action: answer
    // the board. A second full-width "Continue" button only opens an AI hint
    // dead end, so keep it out of the hierarchy until the reveal is ready.
    const offlineLiveRound = live && !teacherChatEnabled();
    els.nextBtn.hidden = !available || inFreeformRound || ceremonyReady || offlineLiveRound;
    els.nextBtn.textContent = nextQuestionButtonLabel(t);
    const postClass = postClassState(t);
    els.nextBtn.title = live
      ? (teacherChatEnabled() ? chatCostTitle(t, "Ask for a hint.") : "Answer the question to continue")
      : postClass.report && guestSignupRequired(t)
        ? "Sign up to continue past today's class"
      : cur && currentRevealCompletedClass(t)
        ? "Show the class report"
      : cur
        ? "Continue"
      : t && t.graduation_gate && t.graduation_gate.stage === "essay"
        ? "Build your final response"
      : postClass.essayReady
        ? "Build your final response"
      : postClass.socialReady
        ? "Start a short homeroom reflection"
        : postClass.report
        ? "Start after-class review"
      : t && t.graduation_ready && !cur
        ? "Open the graduation ceremony"
        : teacherChatEnabled()
          ? chatCostTitle(t, "Continue when the class starts a chat.")
          : "Continue";
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
    return !!(key && !t.current && key !== dismissedClassReportKey);
  }
  function currentRevealMatches(t) {
    return !!(t && t.current && t.lastReveal && t.lastReveal.questionId === t.current.id);
  }
  function currentRevealCompletedClass(t) {
    if (!t || !t.current || (!currentRevealMatches(t) && t.status !== "revealed")) return false;
    const cp = t.lastReveal && t.lastReveal.classProgress;
    return !!((cp && cp.mode === "class" && cp.completed) || activeDailyClassIsComplete(t));
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
    return boardStatusRenderer.buildSubjectGrades(t.current_grade, subjectClearSummary());
  }

  function buildBoardClassStartHeader(statusText, infoText) {
    const summary = subjectClearSummary();
    const grade = lastTelemetry && lastTelemetry.current_grade ? lastTelemetry.current_grade : "";
    return boardStatusRenderer.buildClassStartHeader(grade, summary, statusText, infoText);
  }

  function buildGuestSpotlight(t) {
    return guestSpotlightRenderer.build(t);
  }

  let guestSpotlightStartInFlight = false;
  async function startGuestSpotlight(pack) {
    if (!pack || !pack.id || guestSpotlightStartInFlight) return false;
    guestSpotlightStartInFlight = true;
    try {
      packLibraryState = await packStudioClient.setGuestAuto();
      syncGuestAutoButton();
      renderPackList();
      renderDraftPackList();
      await fetchSession();
      const data = await command({ type: "pick", faculty: "guest", mode: "class" });
      const outcome = guestSpotlightStartOutcome(data, apiClient.lastCommandError());
      if (outcome === "not-ready") {
        appendSystem("The guest teacher does not have a class ready yet.");
        return false;
      }
      if (outcome !== "started") return false;
      // Record a start only after a guest question reaches the board.
      postViewerMetricEvent("guest_spotlight_started", { packId: pack.id });
      return true;
    } catch (_err) {
      appendSystem("The guest teacher is unavailable. Try again in a moment.");
      return false;
    } finally {
      guestSpotlightStartInFlight = false;
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
  const ANNOUNCEMENTS_LOGO_URL = apiBase + "/assets/optimized/ruby-high-app-icon.webp?v=thumbs-20260830";
  let announcementsOverlay = null;
  let announcementsPreviousFocus = null;
  let announcementsBackgroundLocked = false;
  let onboardingIntroTracked = false;
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
    "ruby", "sally-science", "professor-edward", "roko", "captain-null", "eliza", "rati",
    "item-hall-pass", "item-flashcards", "item-library-card", "item-lab-flask", "item-lunch-tray", "item-notebook",
    "location-homeroom", "location-science-lab", "location-library", "location-cafeteria", "location-greenhouse", "location-courtyard",
  ];
  // HALL_PASS_CARDS_PER_PACK is in VIEWER_CONSTANTS.
  const HALL_PASS_CARD_BURN_HALL_PASS_VALUE = 5;
  const PACK_MINT_STATUS_LINES = [
    "Checking your wallet...",
    "Confirming your payment...",
    "Creating your collectible pack...",
    "Waiting for Solana...",
    "Adding the pack to your account...",
  ];
  const CARD_MINT_STATUS_LINES = [
    "Preparing your collectible card...",
    "Checking the card details...",
    "Waiting for wallet approval...",
    "Sending the approved transaction...",
    "Finishing the mint...",
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
    workspace: $("workspace"),
    serversRail: $("servers-rail"),
    channelsRail: $("channels-rail"),
    homeBtn: $("home-btn"),
    gradeTitle: $("grade-title"),
    channelsList: $("channels-list"),
    youProfile: $("you-profile"),
    youAvatar: $("you-avatar"),
    youName: $("you-name"),
    youState: $("you-state"),
    footerAction: $("footer-action"),
    privyAction: $("privy-action"),
    hamburger: $("hamburger"),
    channelsClose: $("channels-close"),
    channelTitle: $("channel-title"),
    channelSub: $("channel-sub"),
    arcIndicator: $("arc-indicator"),
    arcYear: $("arc-year"),
    arcStreak: $("arc-streak"),
    arcXp: $("arc-xp"),
    arcEssaySep: $("arc-essay-sep"),
    arcEssay: $("arc-essay"),
    mobileViewToggle: $("mobile-view-toggle"),
    mobileViewButtons: Array.from(document.querySelectorAll("[data-mobile-view]")),
    stream: $("stream"),
    blackboardPanel: $("blackboard-panel"),
    loungeStage: $("lounge-stage"),
    loungeFigures: $("lounge-figures"),
    teacherFigure: $("teacher-figure"),
    teacherName: $("teacher-name"),
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
    dailyClassProgress: $("daily-class-progress"),
    boardFrameHost: $("board-frame-host"),
    boardPrompt: $("board-prompt"),
    boardReveal: $("board-reveal"),
    answersHost: $("answers-host"),
    answers: Array.from(document.querySelectorAll(".answer")),
    typedAnswerHost: $("typed-answer-host"),
    typedAnswerForm: $("typed-answer-form"),
    labyrinthActionForm: $("labyrinth-action-form"),
    labyrinthAttributeGrid: $("labyrinth-attribute-grid"),
    labyrinthExitGrid: $("labyrinth-exit-grid"),
    typedSubmitBtn: $("typed-submit-btn"),
    generateMcBtn: $("generate-mc-btn"),
    responseBuilder: $("response-builder"),
    responseBuildStatus: $("response-build-status"),
    responseCardButtons: Array.from(document.querySelectorAll("[data-response-card]")),
    responseCardGroups: Array.from(document.querySelectorAll("[data-response-group]")),
    responseStepButtons: Array.from(document.querySelectorAll("[data-response-step]")),
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
    passkeyAction: $("passkey-action"),
    passkeyCreate: $("passkey-create"),
    passkeySecuritySummary: $("passkey-security-summary"),
    passkeyAutofillLabel: $("passkey-autofill-label"),
    passkeyAutofill: $("passkey-autofill"),
    passkeyList: $("passkey-list"),
    passkeyRecoveryCard: $("passkey-recovery-card"),
    passkeyRecoveryInput: $("passkey-recovery-input"),
    passkeyRecoverySubmit: $("passkey-recovery-submit"),
    passkeyRecoveryCreate: $("passkey-recovery-create"),
    passkeyRecoveryCode: $("passkey-recovery-code"),
    passkeyRecoveryValue: $("passkey-recovery-value"),
    passkeyRecoveryCopy: $("passkey-recovery-copy"),
    passkeyRecoveryDownload: $("passkey-recovery-download"),
    privyLoginWidget: $("privy-login-widget"),
    privySignout: $("privy-signout"),
    privyStatus: $("privy-status"),
    accountWorkspace: document.querySelector(".account-workspace"),
    accountTabs: Array.from(document.querySelectorAll("[data-account-tab]")),
    accountPanels: Array.from(document.querySelectorAll("[data-account-panel]")),
    accountWalletBalance: $("account-wallet-balance"),
    accountWalletMeta: $("account-wallet-meta"),
    accountBuyPasses: $("account-buy-passes"),
    accountBuyCardPacks: $("account-buy-card-packs"),
    accountMintCards: $("account-mint-cards"),
    accountCardSummary: $("account-card-summary"),
    accountHallPassCards: $("account-hall-pass-cards"),
    accountCharacterSummary: $("account-character-summary"),
    accountCharacterGrid: $("account-character-grid"),
    accountCreateCharacter: $("account-create-character"),
    accountUnlockSlot: $("account-unlock-slot"),
    accountPublicWorldSummary: $("account-public-world-summary"),
    accountPublicWorldStatus: $("account-public-world-status"),
    accountPublicWorldToggle: $("account-public-world-toggle"),
    accountDelete: $("account-delete"),
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
    leaderboardPanel: $("leaderboard-panel"),
    leaderboardBody: $("leaderboard-body"),
    leaderboardBack: $("leaderboard-back"),
    appConfirmOk: $("app-confirm-ok"),
  };

  let viewerModalBackgroundDepth = 0;
  function focusWithoutScroll(target) {
    if (!target || typeof target.focus !== "function") return;
    try { target.focus({ preventScroll: true }); } catch (_err) { try { target.focus(); } catch (_focusErr) {} }
  }

  function modalFocusableElements(overlay) {
    if (!overlay) return [];
    return Array.from(overlay.querySelectorAll(
      "button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])",
    )).filter((element) => {
      if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
      if (element.closest("[hidden], [aria-hidden='true']")) return false;
      return element.getClientRects().length > 0;
    });
  }

  function trapModalFocus(event, overlay) {
    if (!event || event.key !== "Tab") return;
    const focusable = modalFocusableElements(overlay);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      focusWithoutScroll(last);
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      focusWithoutScroll(first);
    } else if (!overlay.contains(document.activeElement)) {
      event.preventDefault();
      focusWithoutScroll(event.shiftKey ? last : first);
    }
  }

  function lockViewerModalBackground() {
    viewerModalBackgroundDepth += 1;
    if (viewerModalBackgroundDepth !== 1 || !els.shell) return;
    els.shell.setAttribute("inert", "");
    els.shell.setAttribute("aria-hidden", "true");
  }

  function unlockViewerModalBackground() {
    viewerModalBackgroundDepth = Math.max(0, viewerModalBackgroundDepth - 1);
    if (viewerModalBackgroundDepth !== 0 || !els.shell) return;
    els.shell.removeAttribute("inert");
    els.shell.removeAttribute("aria-hidden");
  }

  function restoreModalFocus(previousFocus, fallbackFocus) {
    const focusableSelector = "button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])";
    const isUsable = (target) => !!(
      target
      && target.isConnected
      && typeof target.matches === "function"
      && target.matches(focusableSelector)
      && !target.hidden
      && !target.closest("[hidden], [inert], [aria-hidden='true']")
      && target.getClientRects().length > 0
    );
    const previousUsable = isUsable(previousFocus);
    const fallbackUsable = isUsable(fallbackFocus);
    focusWithoutScroll(previousUsable ? previousFocus : fallbackUsable ? fallbackFocus : null);
  }

  const viewerModalStates = new WeakMap();
  const viewerModalStack = [];
  function openViewerModal(overlay, options) {
    if (!overlay) return;
    const opts = options || {};
    let state = viewerModalStates.get(overlay);
    if (!state) {
      state = { open: false, previousFocus: null, fallbackFocus: null, onRequestClose: null, dismissible: true, onKeyDown: null };
      viewerModalStates.set(overlay, state);
    }
    state.fallbackFocus = opts.fallbackFocus || state.fallbackFocus;
    state.onRequestClose = typeof opts.onRequestClose === "function" ? opts.onRequestClose : state.onRequestClose;
    state.dismissible = opts.dismissible !== false;
    if (!state.open) {
      const previousModal = viewerModalStack[viewerModalStack.length - 1];
      if (previousModal && previousModal !== overlay) {
        previousModal.setAttribute("inert", "");
        previousModal.setAttribute("aria-hidden", "true");
      }
      state.previousFocus = document.activeElement && typeof document.activeElement.focus === "function"
        ? document.activeElement
        : null;
      state.open = true;
      viewerModalStack.push(overlay);
      lockViewerModalBackground();
      state.onKeyDown = (event) => {
        if (event.key === "Escape" && state.dismissible) {
          event.preventDefault();
          if (state.onRequestClose) state.onRequestClose();
          return;
        }
        trapModalFocus(event, overlay);
      };
      overlay.addEventListener("keydown", state.onKeyDown);
    }
    overlay.hidden = false;
    overlay.classList.add("is-open");
    if (viewerModalStack[viewerModalStack.length - 1] === overlay) {
      overlay.removeAttribute("inert");
      overlay.setAttribute("aria-hidden", "false");
    }
    const requestedFocus = typeof opts.initialFocus === "function" ? opts.initialFocus() : opts.initialFocus;
    setTimeout(() => {
      if (!state.open || viewerModalStack[viewerModalStack.length - 1] !== overlay) return;
      const focusTarget = requestedFocus || modalFocusableElements(overlay)[0];
      focusWithoutScroll(focusTarget);
    }, 0);
  }

  function closeViewerModal(overlay, fallbackFocus) {
    if (!overlay) return;
    const state = viewerModalStates.get(overlay);
    const stackIndex = viewerModalStack.indexOf(overlay);
    const wasTopModal = stackIndex === viewerModalStack.length - 1;
    if (stackIndex >= 0) viewerModalStack.splice(stackIndex, 1);
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    overlay.removeAttribute("inert");
    overlay.hidden = true;
    if (!state || !state.open) return;
    state.open = false;
    if (state.onKeyDown) overlay.removeEventListener("keydown", state.onKeyDown);
    state.onKeyDown = null;
    unlockViewerModalBackground();
    if (wasTopModal) {
      const nextModal = viewerModalStack[viewerModalStack.length - 1];
      if (nextModal) {
        nextModal.removeAttribute("inert");
        nextModal.setAttribute("aria-hidden", "false");
      }
      restoreModalFocus(state.previousFocus, fallbackFocus || state.fallbackFocus);
    }
    state.previousFocus = null;
  }

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

    return new Promise((resolve) => {
      function cleanup(result) {
        closeViewerModal(overlay);
        overlay.classList.remove("is-danger");
        overlay.removeEventListener("click", onOverlayClick);
        okBtn.removeEventListener("click", onConfirm);
        cancelBtn.removeEventListener("click", onCancel);
        activeConfirmDialog = null;
        resolve(result);
      }
      function onConfirm() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onOverlayClick(event) {
        if (event.target === overlay) cleanup(false);
      }
      activeConfirmDialog = { resolve: cleanup };
      overlay.addEventListener("click", onOverlayClick);
      okBtn.addEventListener("click", onConfirm);
      cancelBtn.addEventListener("click", onCancel);
      const focusTarget = options && options.focus === "confirm" ? okBtn : cancelBtn;
      openViewerModal(overlay, {
        onRequestClose: onCancel,
        initialFocus: focusTarget,
      });
    });
  }

  // ── view state ────────────────────────────────────────────────────────────
  let lastTelemetry = null;
  let lastRosterSig = "";
  let lastRevealId = null;
  let lastAnswerGradedTriggerId = null;
  let lastIdleTriggerId = null;
  let showWelcomeBackCopy = false;
  let firstRunCreationOpened = false;
  let lastPostClassToastShown = false;
  let authed = null; // app-owned Ruby High session ready
  let aiEnabled = false; // Browser/local/hosted text AI + Ruby High session present
  let localAiEnabled = false;
  let hostedAiActive = false;
  let passkeyState = {
    available: true,
    registered: false,
    authenticated: false,
    recent: false,
    recoveryConfigured: false,
    credentials: [],
  };
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
    return "Use an AI key before " + action + ".";
  }
  const teacherImageStatusView = createTeacherImageStatusView({
    openRouterGenerationMessage,
  });
  const profileCardView = createProfileCardView({
    gradeLabels: GRADE_LABELS,
    streakRequired: STREAK_REQUIRED,
    teachingFacultyLabels: TEACHING_FACULTY_LABELS,
  });
  const boardStatusRenderer = createBoardStatusRenderer({
    document,
    titleView: boardSubjectGradesTitleView,
    subjectGateMetaFor,
    subjectProgressShortLabel,
    letterGradePasses,
    buildSubjectGradeChip: makeSubjectGradeChip,
  });
  const chatMessageRenderer = createChatMessageRenderer({
    document,
    sanitizeVisibleChatText,
    renderMarkdownInto,
  });
  let lockedFor = null;
  let renderedHistorySig = null;
  let activeQuestionId = null; // currently displayed question id on the blackboard
  let mobilePane = "challenge";
  let mobilePaneQuestionId = null;
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
  let leaderboardViewOpen = false;
  let appPage = "class";
  let yearbookPane = "record";
  let yearbookRenderKey = "";
  const pageScrollPositions = new Map();
  let billingProductsCache = null;
  let billingMode = "hall-passes";
  let billingBusy = false;
  let selectedBillingProductId = null;
  let activeAccountPane = "account";
  let comicUnlockEventsPrimed = false;
  let comicUnlockModalOpen = false;
  let firstBellReportModalOpen = false;
  const seenComicUnlockEventIds = new Set();
  const pendingComicUnlocks = [];
  let packSyncBusy = false;
  let packSyncWalletAddress = "";
  let packSyncAt = 0;
  let chatViewSeq = 0;         // bumps on room/lounges switches; invalidates stale history/SSE work
  function setNextButtonDisabled(disabled) {
    if (els.nextBtn) els.nextBtn.disabled = !!disabled;
  }
  function setChatComposerDisabled(disabled) {
    els.chatInput.disabled = !!disabled;
    els.chatSend.disabled = !!disabled;
  }
  const packMintProgressController = createPackMintProgressController({
    document,
    defaultLines: PACK_MINT_STATUS_LINES,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  });
  function updatePackMintProgress(message) {
    packMintProgressController.update(message);
  }
  function showPackMintProgress(message, options) {
    packMintProgressController.show(message, options);
  }
  function hidePackMintProgress(delayMs) {
    packMintProgressController.hide(delayMs);
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
    appendSystem("Today's scheduled question is not ready. Use an AI key for an extra question, or come back tomorrow.");
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
    if (creationSheetOpen()) return false;
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
    const key = (t.faculty || "") + "|" + (t.current_grade || "") + "|" + todayKey + "|" + phaseToken + "|" + questionCount + "|" + ready + "|" + canPick + "|" + (progress.nextCardRole || "") + "|" + (progress.nextOpinionPurpose || "");
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
  let opinionSubmitted = false; // player's response-card build has been recorded for current round
  let opinionSubmittedQuestionId = null;
  let opinionGradeFired = false; // grading has been triggered for current round
  let typedSubmitting = false;
  let generatingMc = false;
  let takeStartedQuestionId = null;
  let responseCardSelection = {};
  let responseBuilderActiveGroup = "claim";
  const viewedClassReportKeys = new Set();
  const renderedOpinionIds = new Set(); // responder ids whose text we've appended to chat
  const gradedResponderIds = new Set(); // responders whose grade-tag we've stamped on
  let sheetOverlayOpen = false;
  let returnToAccountAfterSheet = false;
  const chatHistoryHumanStudentsByFaculty = new Map();
  let roomHumanHistorySig = "";

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
  const RESPONSE_CARD_GROUPS = ["claim", "stance", "evidence", "impact"];
  const RESPONSE_CARD_GROUP_LABELS = { claim: "claim", stance: "position", evidence: "evidence", impact: "impact" };
  function resetResponseBuilder() {
    responseCardSelection = {};
    responseBuilderActiveGroup = RESPONSE_CARD_GROUPS[0];
    els.responseCardButtons.forEach((button) => {
      button.classList.remove("is-selected");
      button.setAttribute("aria-pressed", "false");
    });
  }
  function selectedResponseCardPayload() {
    if (!RESPONSE_CARD_GROUPS.every((group) => responseCardSelection[group])) return null;
    return {
      claimId: responseCardSelection.claim,
      stance: responseCardSelection.stance,
      evidence: responseCardSelection.evidence,
      impact: responseCardSelection.impact,
    };
  }
  function syncResponseClaims() {
    const claims = Array.isArray(lastTelemetry && lastTelemetry.response_claims)
      ? lastTelemetry.response_claims.slice(0, 2)
      : [];
    const buttons = els.responseCardButtons.filter((button) => button.dataset.group === "claim");
    buttons.forEach((button, index) => {
      const claim = claims[index];
      button.hidden = !claim;
      button.dataset.value = claim ? String(claim.id || "") : "";
      button.dataset.short = claim ? String(claim.answer || "") : "";
      const title = button.querySelector("strong");
      const detail = button.querySelector("small");
      if (title) title.textContent = claim ? String(claim.answer || "Claim") : "—";
      if (detail) detail.textContent = claim ? String(claim.prompt || "") : "—";
    });
  }
  function responseGroupIsAvailable(group) {
    const groupIndex = RESPONSE_CARD_GROUPS.indexOf(group);
    return groupIndex >= 0 && RESPONSE_CARD_GROUPS.slice(0, groupIndex).every((entry) => responseCardSelection[entry]);
  }
  function openResponseGroup(group) {
    if (!responseGroupIsAvailable(group)) return;
    responseBuilderActiveGroup = group;
    syncResponseBuilder(true, false);
  }
  function syncResponseBuilder(isOpinion, disabled) {
    if (isOpinion) syncResponseClaims();
    const complete = !!selectedResponseCardPayload();
    if (!responseGroupIsAvailable(responseBuilderActiveGroup)) {
      responseBuilderActiveGroup = RESPONSE_CARD_GROUPS.find((group) => responseGroupIsAvailable(group) && !responseCardSelection[group]) || RESPONSE_CARD_GROUPS[0];
    }
    els.responseBuilder.hidden = !isOpinion;
    els.responseBuilder.dataset.activeGroup = responseBuilderActiveGroup;
    els.responseCardGroups.forEach((group) => {
      group.hidden = group.dataset.responseGroup !== responseBuilderActiveGroup;
    });
    els.responseCardButtons.forEach((button) => {
      const selected = responseCardSelection[button.dataset.group] === button.dataset.value;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = !!disabled;
    });
    els.responseStepButtons.forEach((button) => {
      const group = button.dataset.responseStep;
      const selected = !!responseCardSelection[group];
      const active = group === responseBuilderActiveGroup;
      button.classList.toggle("is-active", active);
      button.classList.toggle("is-complete", selected);
      if (active) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
      button.disabled = !!disabled || !responseGroupIsAvailable(group);
      const marker = button.querySelector(":scope > span");
      if (marker) marker.textContent = selected ? "✓" : String(RESPONSE_CARD_GROUPS.indexOf(group) + 1);
    });
    els.typedSubmitBtn.hidden = !isOpinion;
    els.typedSubmitBtn.disabled = !!disabled || !complete;
    els.typedSubmitBtn.textContent = typedSubmitting ? "Creating…" : "Submit";
    if (els.responseBuildStatus) {
      els.responseBuildStatus.textContent = complete ? "Ready" : RESPONSE_CARD_GROUP_LABELS[responseBuilderActiveGroup];
    }
  }
  function syncLabyrinthAction(question, disabled) {
    const active = !!(question && question.type === "story-action");
    els.labyrinthActionForm.hidden = !active;
    els.typedAnswerForm.hidden = active;
    if (!active) return;
    const moves = [
      { id: "head", label: "HEAD", detail: "Study the mechanism" },
      { id: "heart", label: "HEART", detail: "Work through people" },
      { id: "hustle", label: "HUSTLE", detail: "Change the situation" },
      { id: "honor", label: "HONOR", detail: "Make or defend a rule" },
    ];
    els.labyrinthAttributeGrid.replaceChildren();
    for (const move of moves) {
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = !!disabled || typedSubmitting;
      const label = document.createElement("strong");
      label.textContent = move.label;
      const detail = document.createElement("span");
      detail.textContent = move.detail;
      button.append(label, detail);
      button.addEventListener("click", () => { void performLabyrinthAction(move.id); });
      els.labyrinthAttributeGrid.appendChild(button);
    }
    els.labyrinthExitGrid.replaceChildren();
    const labyrinth = questionPromptView(question).caseStudy?.labyrinth;
    for (const exit of labyrinth?.availableExits || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = !!disabled || typedSubmitting;
      button.textContent = "Go to " + exit.label;
      button.addEventListener("click", () => { void performLabyrinthAction("go " + exit.nodeId); });
      els.labyrinthExitGrid.appendChild(button);
    }
  }
  function playerMessageIdentitySig() {
    const ch = lastTelemetry && lastTelemetry.character;
    return playerDisplayName() + ":" + (ch && ch.portraitDataUrl ? ch.portraitDataUrl.length : 0);
  }
  function chatHistorySignature(facultyId, msgs) {
    const rows = (Array.isArray(msgs) ? msgs : []).map((m) => [
      m && m.role,
      m && m.at,
      m && m.faculty,
      m && m.content,
      m && m.authorName,
      m && m.avatarUrl,
      m && m.isSelf ? "self" : "other",
      m && m.tool,
      m && m.result && m.result.ok ? "ok" : "",
    ].join("\x1f"));
    return facultyId + ":" + playerMessageIdentitySig() + ":" + rows.join("\x1e");
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
    const nodes = dialogueNodes(".msg.teacher .body, .msg.student .body");
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
        const isStoryChoice = reveal.questionType === "story-choice";
        const isStoryAction = reveal.questionType === "story-action";
        const result = isStoryAction
          ? "I acted in the labyrinth"
          : isStoryChoice
          ? "I locked in a story choice"
          : reveal.forfeit
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
        const correctLine = !isStoryChoice && !isStoryAction && correct ? " The correct answer was " + correct + "." : "";
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
      return "I'm ready for the next " + facultyName + " question. " + questionsLeftSentence(progress) + " in today's class.";
    }
    return "I'm ready for the next " + facultyName + " question.";
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
  function setPaidChatPendingFeedback() {
    if (!els.nextBtn || els.nextBtn.hidden) return;
    const cost = formatWholeNumber(nextChatCost(lastTelemetry));
    els.nextBtn.textContent = "Chatting...";
    els.nextBtn.title = "Reserving " + cost + " Merit Stars. Refunded if chat fails.";
  }
  async function runPlayerChatTurn(intent, extraContext) {
    const manualTurn = turnController.beginManual();
    if (!manualTurn) {
      appendSystem("Chat is already working.");
      return;
    }
    try {
      if (!teacherChatEnabled()) {
        const playerLine = playerChatLine(intent);
        appendMsg({ kind: "you", name: playerDisplayName(), body: playerLine, color: "var(--accent)" });
        appendSystem(intent === "hint" ? "Answer the question to continue. Use an AI key for teacher hints." : "Use an AI key for teacher replies.");
        return;
      }
      setPaidChatPendingFeedback();
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
      if (lastTelemetry) updateChatAction(deriveViewMode(lastTelemetry));
    }
  }
  function applyChatAvatarAspectClass(avatar, img) {
    if (!avatar || !img) return;
    const update = () => {
      const width = Number(img.naturalWidth || 0);
      const height = Number(img.naturalHeight || 0);
      avatar.classList.remove("is-tall-avatar", "is-square-avatar");
      if (!width || !height) return;
      const ratio = width / height;
      if (ratio < 0.82) avatar.classList.add("is-tall-avatar");
      else if (ratio >= 0.9 && ratio <= 1.1) avatar.classList.add("is-square-avatar");
    };
    img.onload = () => update();
    if (img.complete) update();
  }
  function syncPlayerMessageHeaders() {
    if (!els.stream) return;
    const displayName = playerDisplayName();
    const ch = lastTelemetry && lastTelemetry.character;
    const portraitSrc = ch && ch.portraitDataUrl ? ch.portraitDataUrl : null;
    const initial = displayName ? displayName.slice(0, 1).toUpperCase() : "U";
    dialogueNodes(".msg.you").forEach((node) => {
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
          applyChatAvatarAspectClass(avatar, img);
        } else {
          avatar.textContent = "";
          const nextImg = document.createElement("img");
          nextImg.src = portraitSrc;
          nextImg.alt = displayName;
          applyChatAvatarAspectClass(avatar, nextImg);
          avatar.appendChild(nextImg);
        }
      } else {
        avatar.classList.remove("is-tall-avatar", "is-square-avatar");
        avatar.style.background = "var(--accent)";
        if (img) avatar.replaceChildren();
        if (avatar.textContent !== initial) avatar.textContent = initial;
      }
    });
  }

  function dialogueNodes(selector) {
    return els.stream ? Array.from(els.stream.querySelectorAll(selector)) : [];
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

  function setDialogueCompaction(summary) {
    const existing = els.stream.querySelector("[data-dialogue-compaction]");
    if (!summary) {
      if (existing) existing.remove();
      return;
    }
    const node = existing || document.createElement("div");
    node.dataset.dialogueCompaction = "true";
    node.className = "conversation-summary";
    node.textContent = "Earlier conversation: " + summary;
    if (!existing) els.stream.prepend(node);
  }

  function clearStream() {
    chatViewSeq++;
    els.stream.innerHTML = "";
    renderedHistorySig = null;
    lastSocialSummaryId = null;
  }
  // Page navigation owns destinations; telemetry continues to update the lesson.
  function showAppPage(page, options) {
    const next = ["class", "campus", "yearbook", "account"].includes(page) ? page : "class";
    const changed = next !== appPage;
    if (changed) pageScrollPositions.set(appPage, els.workspace.scrollTop);
    if (appPage === "account" && next !== "account") void abortConditionalPasskey();
    appPage = next;
    els.shell.dataset.appPage = next;
    document.getElementById("class-page").hidden = next !== "class";
    document.getElementById("campus-page").hidden = next !== "campus";
    document.getElementById("yearbook-page").hidden = next !== "yearbook";
    els.privyOverlay.hidden = next !== "account";
    els.privyOverlay.classList.toggle("is-open", next === "account");
    document.querySelectorAll("[data-app-page]").forEach((button) => {
      if (button === els.shell) return;
      if (button.dataset.appPage === next) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    els.youProfile.setAttribute("aria-expanded", String(next === "account"));
    if (next === "campus") {
      leaderboardViewOpen = false;
      els.channelsRail.hidden = false;
      els.leaderboardPanel.hidden = true;
    }
    if (next === "class") {
      leaderboardViewOpen = false;
      applyViewMode(deriveViewMode(lastTelemetry));
    }
    if (next === "yearbook") {
      renderYearbookPage();
      renderAccountComics();
    }
    if (changed) els.workspace.scrollTop = pageScrollPositions.get(next) || 0;
    if (!options || options.history !== false) {
      const url = new URL(window.location.href);
      if (url.hash !== "#" + next) {
        url.hash = next;
        window.history.pushState({ rubyHighPage: next }, "", url);
      }
    }
    if (!options || options.focus !== false) {
      const headingId = { class: "channel-title", campus: "campus-title", yearbook: "yearbook-title", account: "account-title" }[next];
      const heading = document.getElementById(headingId);
      heading.setAttribute("tabindex", "-1");
      focusWithoutScroll(heading);
    }
  }

  function showYearbookPane(pane) {
    yearbookPane = pane === "comics" ? "comics" : "record";
    document.getElementById("yearbook-record").hidden = yearbookPane !== "record";
    document.getElementById("yearbook-comics").hidden = yearbookPane !== "comics";
    document.querySelectorAll("[data-yearbook-pane]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.yearbookPane === yearbookPane));
    });
  }

  function renderYearbookPage() {
    const t = lastTelemetry || {};
    const c = t.character;
    const entries = c && Array.isArray(c.yearbook) ? c.yearbook : [];
    const roster = t.faculty_roster || [];
    const key = JSON.stringify([c && c.id, c && c.name, t.current_grade, t.faculty,
      t.active_course_progress, entries, roster.map((f) => [f.id, f.completedClasses, f.requiredClasses, f.courseGrade])]);
    if (key === yearbookRenderKey) return;
    yearbookRenderKey = key;
    const host = document.getElementById("yearbook-record");
    host.replaceChildren();
    document.getElementById("yearbook-subtitle").textContent = c
      ? c.name + " · " + (GRADE_LABELS[t.current_grade] || "Your school years")
      : "Your classes and keepsakes have a home here.";
    if (!c) {
      const empty = document.createElement("div");
      empty.className = "page-empty";
      const title = document.createElement("h2");
      title.textContent = "Your story starts with a student";
      const copy = document.createElement("p");
      copy.textContent = "Take your first class to begin your school record.";
      const action = document.createElement("button");
      action.className = "primary";
      action.textContent = "Create my student";
      action.addEventListener("click", openCharacterCreation);
      empty.append(title, copy, action);
      host.appendChild(empty);
      return;
    }
    const teacher = roster.find((f) => f.id === t.faculty);
    const report = buildClassReportCard(teacher, t.current_grade);
    if (report) {
      const heading = document.createElement("h2");
      heading.className = "page-section-title";
      heading.textContent = "Latest class";
      host.append(heading, report);
    }
    const record = document.createElement("section");
    record.className = "school-record";
    const title = document.createElement("h2");
    title.className = "page-section-title";
    title.textContent = "This year's courses";
    record.appendChild(title);
    roster.filter((f) => f.id !== LOUNGE_ID && Number(f.requiredClasses || 0) > 0).forEach((f) => {
      const row = document.createElement("div");
      row.className = "school-record-row";
      const subject = document.createElement("strong");
      subject.textContent = subjectDisplayName(f.id, f);
      const progress = document.createElement("span");
      progress.textContent = Number(f.completedClasses || 0) + " of " + Number(f.requiredClasses || 0) + " class days";
      const grade = document.createElement("span");
      grade.className = "school-record-grade";
      grade.textContent = earnedCourseGrade(f) || "In progress";
      row.append(subject, progress, grade);
      record.appendChild(row);
    });
    host.appendChild(record);
    const playbooks = t.playbooks || [];
    const pb = playbooks.find((p) => p.id === c.playbookId) || {};
    if (entries.length) {
      const archive = document.createElement("section");
      archive.className = "yearbook-archive";
      const heading = document.createElement("h2");
      heading.className = "page-section-title";
      heading.textContent = "Completed years";
      archive.appendChild(heading);
      entries.slice().sort((a, b) => Number(b.grade) - Number(a.grade)).forEach((entry) => {
        archive.appendChild(buildYearbookArchiveEntry(entry, c, pb, playbooks));
      });
      host.appendChild(archive);
    } else {
      const note = document.createElement("p");
      note.className = "page-note";
      note.textContent = "Your first completed year will appear here with its report and keepsakes.";
      host.appendChild(note);
    }
    const profile = document.createElement("button");
    profile.className = "page-link";
    profile.textContent = "View student card and full report";
    profile.addEventListener("click", () => openSheet());
    host.appendChild(profile);
  }

  function showClassSurface(force) {
    // Session polling repaints the blackboard every few seconds. Honor Roll
    // is an explicit view choice, so background paints must not silently
    // kick the player back to class. Direct navigation actions pass force.
    if (leaderboardViewOpen && !force) return;
    if (force) showAppPage("class");
    leaderboardViewOpen = false;
    els.leaderboardPanel.hidden = true;
    els.blackboardPanel.hidden = false;
    els.loungeStage.hidden = false;
    els.stream.hidden = false;
    els.composerZone.hidden = false;
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
      appendSystem("Could not submit your answer · " + message);
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
      if (viewerSessionReadyMs == null) viewerSessionReadyMs = performance.now();
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
    const lowerSessionId = String(sessionId || "").toLowerCase();
    const clientSurface = role === "agent"
      ? "agent"
      : lowerSessionId.indexOf("smoke") !== -1 || lowerSessionId.indexOf("synthetic") !== -1
        ? "smoke"
        : "viewer";
    const body = Object.assign({ type: type, clientSurface: clientSurface }, payload || {});
    apiFetch(metricsEventUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      timeoutMs: 2500,
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  let viewerSessionReadyMs = null;
  let viewerLargestContentfulPaintMs = 0;
  let viewerInteractionToNextPaintMs = 0;
  let viewerCumulativeLayoutShift = 0;
  let viewerPerformanceReported = false;
  try {
    new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        viewerLargestContentfulPaintMs = Math.max(viewerLargestContentfulPaintMs, entry.startTime || 0);
      });
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (!entry.hadRecentInput) viewerCumulativeLayoutShift += entry.value || 0;
      });
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        viewerInteractionToNextPaintMs = Math.max(viewerInteractionToNextPaintMs, entry.duration || 0);
      });
    }).observe({ type: "event", buffered: true, durationThreshold: 40 });
  } catch (_err) { /* older browsers can omit individual performance entry types */ }

  function reportViewerPerformance() {
    if (viewerPerformanceReported) return;
    viewerPerformanceReported = true;
    const navigation = performance.getEntriesByType("navigation")[0];
    const firstContentfulPaint = performance.getEntriesByName("first-contentful-paint")[0];
    postViewerMetricEvent("performance_sample", {
      ttfbMs: navigation ? navigation.responseStart : 0,
      fcpMs: firstContentfulPaint ? firstContentfulPaint.startTime : 0,
      lcpMs: viewerLargestContentfulPaintMs,
      inpMs: viewerInteractionToNextPaintMs,
      cls: viewerCumulativeLayoutShift,
      sessionReadyMs: viewerSessionReadyMs || 0,
    });
  }
  window.addEventListener("load", () => setTimeout(reportViewerPerformance, 3000), { once: true });
  window.addEventListener("pagehide", reportViewerPerformance, { once: true });

  const SESSION_RESUME_INACTIVE_MS = 5 * 60 * 1000;
  let viewerMetricsBooted = false;
  let viewerInactiveSince = document.visibilityState === "hidden" ? Date.now() : null;
  let sessionPollHandle = null;

  function markViewerInactive() {
    if (viewerInactiveSince == null) viewerInactiveSince = Date.now();
  }

  function postViewerSessionResume(reason) {
    if (viewerInactiveSince == null) return;
    const inactiveMs = Math.max(0, Date.now() - viewerInactiveSince);
    viewerInactiveSince = null;
    if (!viewerMetricsBooted || inactiveMs < SESSION_RESUME_INACTIVE_MS) return;
    postViewerMetricEvent("session_resume", { inactiveMs: inactiveMs, reason: reason });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      markViewerInactive();
      pauseSessionPolling();
    } else {
      postViewerSessionResume("visibility");
      resumeSessionPolling();
    }
  });
  window.addEventListener("blur", markViewerInactive);
  window.addEventListener("focus", () => postViewerSessionResume("focus"));
  window.addEventListener("pagehide", markViewerInactive);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) postViewerSessionResume("pageshow");
  });

  let acquisitionAttribution = null;
  let quickRollExperimentLanding = false;

  const onboardingFunnelStepsSent = new Set();
  function postOnboardingFunnelStep(step) {
    if (!step || onboardingFunnelStepsSent.has(step)) return;
    onboardingFunnelStepsSent.add(step);
    postViewerMetricEvent("funnel_step", { step: step });
  }

  // imageRequestId is in client-pure.

  async function command(payload) {
    return apiClient.command(payload);
  }

  const accountPublicWorldController = createAccountPublicWorldController({
    elements: {
      summary: els.accountPublicWorldSummary,
      status: els.accountPublicWorldStatus,
      toggle: els.accountPublicWorldToggle,
    },
    getCharacter() {
      return lastTelemetry && lastTelemetry.character;
    },
    isAuthed() {
      return !!authed;
    },
    isBusy() {
      return !!billingBusy;
    },
    setBusy(busy) {
      billingBusy = !!busy;
    },
    viewFor: accountPublicWorldView,
    command,
    notify(message, ok) {
      showCongrats(message, ok);
    },
    setStatus(message, isError) {
      setPrivyStatus(message, isError);
    },
    onUpdated() {
      renderAccountPage();
    },
  });
  const accountTrustRenderer = createAccountTrustPanelRenderer({
    document,
    container: els.accountTrustList,
  });
  const cardBurnSelector = createCardBurnSelector({
    document,
    setTimeout,
    cardArtUrl: hallPassCardArtUrl,
    cardTitle(card) {
      return displayCardText(card && (card.characterName || card.title), "Ruby High Card");
    },
    cardMeta(card) {
      return displayCardText(card && card.title, "Collectible Card");
    },
  });
  const billingProductsRenderer = createBillingProductsRenderer({
    document,
    productRowView: billingProductRowView,
    hallPassPaymentChoiceView: billingHallPassPaymentChoiceView,
    cardPackPaymentChoiceView: billingCardPackPaymentChoiceView,
    cardBurnChoiceView: billingCardBurnChoiceView,
    isPrivyConfigured() {
      return !!privyState.configured;
    },
    canPackCheckout(solana) {
      return !!(solana && solana.configured);
    },
    onSelectProduct: selectBillingProduct,
    onStartCheckout: startCheckout,
    onStartSolanaPayment: startSolanaPayment,
    onBurnCard: burnHallPassCardFromBilling,
  });
  const accountHistoryRenderer = createAccountHistoryPanelRenderer({
    document,
    container: els.accountHistoryList,
    rowView: accountHistoryRowView,
  });
  const welcomeHallPassPopupRenderer = createWelcomeHallPassPopupRenderer({
    document,
    artUrl: WELCOME_HALL_PASS_ART_URL,
    viewFor: welcomeHallPassPopupView,
    portraitConfigured() {
      const portraitEntitlement = hostedImageEntitlement("portrait");
      return !!getStoredApiKey() || !!(portraitEntitlement && portraitEntitlement.configured);
    },
    hasCharacter() {
      return !!(lastTelemetry && lastTelemetry.character);
    },
    markSeen: markWelcomeHallPassPopupSeen,
    setOpen(open) {
      welcomeHallPassPopupOpen = !!open;
    },
    openAccount: openPrivyAccount,
    openCharacterCreation,
  });
  const accountCardReaderRenderer = createAccountCardReaderRenderer({
    document,
    cardBackArtUrl: CARD_BACK_ART_URL,
    cardProfile: hallPassCardProfile,
    cardReaderView: accountHallPassCardReaderView,
    cardArtUrl: hallPassCardArtUrl,
    appendSolanaProofLink,
    mintCard: mintHallPassCardFromAccount,
    isAuthed() {
      return !!authed;
    },
    isBillingBusy() {
      return !!billingBusy;
    },
  });
  const accountCharacterRenderer = createAccountCharacterPanelRenderer({
    document,
    grid: els.accountCharacterGrid,
    summary: els.accountCharacterSummary,
    createButton: els.accountCreateCharacter,
    unlockButton: els.accountUnlockSlot,
    panelView: accountCharacterPanelView,
    cardView: accountCharacterCardView,
    emptySlotView: accountEmptyCharacterSlotView,
    fallbackPortraitFor: defaultPortraitFor,
    openActiveCharacter: openCharacterSheetFromAccount,
    openCharacterCreation: openCharacterCreationFromAccount,
  });
  const ccgCardRenderer = createCcgCardRenderer({
    document,
    renderMarkdownInto,
    appendProgression,
  });
  const careerCardRenderer = createCareerCardRenderer({
    document,
    appendProgression,
  });
  const careerTokensRenderer = createCareerTokensRenderer({
    document,
    streakScoreMultiplier,
  });
  const creationCandidateCardRenderer = createCreationCandidateCardRenderer({
    document,
  });
  const creationControlCardRenderer = createCreationControlCardRenderer({
    document,
  });
  const creationIntroRenderer = createCreationIntroRenderer({
    document,
  });
  const creationRollPresenter = createCreationRollPresenter({
    renderMarkdownInto,
    renderCreationStatsInto(parent, stats) {
      creationStatsRenderer.renderInto(parent, stats);
    },
    defaultPortraitFor,
  });
  const creationRowsRenderer = createCreationRowsRenderer({
    document,
  });
  const creationStatsRenderer = createCreationStatsRenderer({
    document,
  });
  const graduationCeremonyRenderer = createGraduationCeremonyRenderer({
    document,
  });
  const classReportRenderer = createClassReportRenderer({
    document,
    teacherShortName,
    gradeLabel: (grade) => GRADE_LABELS[grade] || (grade ? "Grade " + grade : "current year"),
    letterGradeForScore,
    letterGradePasses,
    todayCorrectSummary,
    formatClassScore,
    postClassState,
    guestSignupRequired,
    knownTeacherAssetId,
    teacherAssetUrl,
  });
  const yearbookArchiveRenderer = createYearbookArchiveRenderer({
    document,
    gradeLabels: GRADE_LABELS,
    gradeShortLabels: GRADE_SHORT_LABELS,
    gradeOrder: GRADE_ORDER,
    formatSealedDate,
    fmtStat,
    renderMarkdownInto,
    buildPhotoAction: buildGraduationPhotoAction,
  });
  const paperCardRenderer = createPaperCardRenderer({
    gradeLabels: GRADE_LABELS,
    buildCharacterCard,
    defaultPortraitFor,
    formatSealedDate,
  });
  const studentPoolCardRenderer = createStudentPoolCardRenderer({
    document,
    defaultPortraitFor,
    formatSealedDate,
    clipEssayText,
  });
  const mashGridRenderer = createMashGridRenderer({
    document,
    students: STUDENTS,
    recentRelationshipEvents,
    mashTickStory,
  });
  const revealFeedbackRenderer = createRevealFeedbackRenderer({
    document,
    statLabel,
    scoreAwardLabel,
    mashTickStory,
    studentColorById,
  });
  const reportCardRenderer = createReportCardRenderer({
    document,
    essayLetter,
    clipEssayText,
    facultyLabel,
    essayScoreText,
    formatSealedDate,
    essayResponderName,
    essayRivalryText,
    buildCareerMetrics,
  });
  const yearbookShareActionsRenderer = createYearbookShareActionsRenderer({
    document,
    absoluteUrl: absoluteViewerUrl,
    copyText: copyTextToClipboard,
    openUrl(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    postMetric: postViewerMetricEvent,
    setTimeout(callback, ms) {
      return setTimeout(callback, ms);
    },
  });
  const comicReaderRenderer = createComicReaderRenderer({
    document,
    pageTitle: comicPageTitle,
    pageUrl: comicPageUrl,
  });
  const accountComicRenderer = createAccountComicPanelRenderer({
    document,
    container: els.accountComics,
    summary: els.accountComicSummary,
    viewFor: accountComicPanelView,
    comicPageUrl,
    openReader: showComicReader,
  });
  const accountHallPassCardsRenderer = createAccountHallPassCardsPanelRenderer({
    document,
    container: els.accountHallPassCards,
    summary: els.accountCardSummary,
    buyButton: els.accountBuyCardPacks,
    mintButton: els.accountMintCards,
    panelView: accountHallPassCardsPanelView,
    packTileView: accountHallPassPackTileView,
    cardTileView: accountHallPassCardTileView,
    packArtUrl(kind) {
      return kind === "active" ? PACK_NFT_ART_URL : PACK_OPENED_NFT_ART_URL;
    },
    cardArtUrl(card, faceDown) {
      return faceDown ? CARD_BACK_ART_URL : hallPassCardArtUrl(card);
    },
    appendSolanaProofLink,
    ensureSolanaWallet: ensureSolanaWalletFromAccount,
    openPack: openHallPassPackFromAccount,
    openCard: showHallPassCardReader,
  });
  const roomChannelRowsController = createRoomChannelRowsController({
    document,
    teacherSmallAvatarUrl,
    teacherInitial,
    buildStudentFaceChip,
    openTeacherProfile,
    setFaculty,
  });
  const leaderboardPanelRenderer = createLeaderboardPanelRenderer({
    document,
    body: els.leaderboardBody,
    viewFor: leaderboardView,
  });
  const raceStripRenderer = createRaceStripRenderer({
    document,
    timerLabel: els.timerLabel,
    timerPill: els.timerPill,
    row: els.raceRow,
    viewFor: raceStripView,
  });
  const arcIndicatorRenderer = createArcIndicatorRenderer({
    root: els.arcIndicator,
    year: els.arcYear,
    streak: els.arcStreak,
    subject: els.arcXp,
    essaySeparator: els.arcEssaySep,
    essay: els.arcEssay,
    viewFor: arcIndicatorView,
  });
  const guestSpotlightRenderer = createGuestSpotlightRenderer({
    document,
    viewFor: guestSpotlightView,
    isUnlocked: secondarySurfacesUnlocked,
    markSeen(packId) {
      postViewerMetricEvent("guest_spotlight_seen", { packId });
    },
    startPack(pack) {
      void startGuestSpotlight(pack);
    },
  });
  const classmateChannelRowsRenderer = createClassmateChannelRowsRenderer({
    document,
    faceUrl: studentFaceUrl,
    openStudentProfile,
  });

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
  const BUILTIN_TEACHER_ASSET_IDS = new Set(["ruby", "sally-science", "professor-edward", "roko"]);
  const OPTIMIZED_TEACHER_FACE_IDS = new Set(["ruby", "sally-science", "professor-edward", "roko", "eliza", "seraph"]);
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
    if (variant === "face" && OPTIMIZED_TEACHER_FACE_IDS.has(assetId)) {
      return apiBase + "/assets/optimized/teachers/" + encodeURIComponent(assetId) + "-face.webp?v=thumbs-20260830";
    }
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
    return studentFaceUrl(studentId);
  }
  function appendMsg({ kind, name, body, color, facultyId, studentId, avatarUrl }) {
    let avatarImgSrc = avatarUrl || null;
    if (kind === "teacher" && facultyId) avatarImgSrc = teacherSmallAvatarUrl(facultyId);
    else if (kind === "student" && studentId) avatarImgSrc = studentStickerUrl(studentId);
    else if (kind === "you" && lastTelemetry?.character?.portraitDataUrl) avatarImgSrc = lastTelemetry.character.portraitDataUrl;
    const rendered = chatMessageRenderer.buildMessage({ kind, name, body, color, avatarUrl: avatarImgSrc });
    const wrap = rendered.wrap;
    const bodyEl = rendered.body;
    els.stream.appendChild(wrap);
    scrollIfPinned(kind === "you");
    return bodyEl;
  }
  function appendSystem(text) {
    const wrap = chatMessageRenderer.buildSystem(text);
    els.stream.appendChild(wrap);
    scrollIfPinned();
  }
  function appendTool(text) {
    const wrap = chatMessageRenderer.buildTool(text);
    els.stream.appendChild(wrap);
    scrollIfPinned();
  }
  function appendEmptyState({ title, body, ctaLabel, ctaAction, facultyId }) {
    const heroSrc = (facultyId && teacherAssetUrl(facultyId, "full")) || teacherAssetUrl("ruby", "full");
    const wrap = chatMessageRenderer.buildEmptyState({ title, body, ctaLabel, ctaAction, heroSrc });
    els.stream.appendChild(wrap);
  }
  // escape, escapeHtml, safeMarkdownHref, sanitizeVisibleChatText,
  // markdownInlineHtml, appendMarkdownInline, renderMarkdownInto are
  // in client-pure.ts.

  // ── blackboard panel (single, persistent, updates in place) ─────────────
  function showBlackboardEmpty(reset) {
    showClassSurface();
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
  function renderDailyClassProgress(t) {
    if (!els.dailyClassProgress) return;
    const view = dailyClassProgressView(t);
    els.dailyClassProgress.hidden = !view.visible;
    els.dailyClassProgress.replaceChildren();
    if (!view.visible) return;
    for (const step of view.steps) {
      const item = document.createElement("li");
      item.className = "is-" + step.state;
      const marker = document.createElement("span");
      marker.className = "daily-class-progress-mark";
      marker.setAttribute("aria-hidden", "true");
      marker.textContent = step.state === "complete" ? "✓" : "";
      const label = document.createElement("span");
      label.className = "daily-class-progress-label";
      label.textContent = step.label;
      const status = document.createElement("span");
      status.className = "visually-hidden";
      status.textContent = step.state === "complete"
        ? ", complete"
        : step.state === "current"
          ? ", current"
          : ", not started";
      item.append(marker, label, status);
      if (step.state === "current") item.setAttribute("aria-current", "step");
      els.dailyClassProgress.appendChild(item);
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
    showClassSurface();
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
    showClassSurface();
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
    return classReportRenderer.buildCard(faculty, currentGrade, progress);
  }
  function buildClassReportNextStep() {
    return classReportRenderer.buildNextStep(lastTelemetry);
  }
  function showBlackboardClassReport(faculty, currentGrade) {
    const report = buildClassReportCard(faculty, currentGrade);
    if (!report) {
      showBlackboardEmpty(true);
      return;
    }
    const reportKey = classReportKey(lastTelemetry);
    if (reportKey && !viewedClassReportKeys.has(reportKey)) {
      viewedClassReportKeys.add(reportKey);
      postViewerMetricEvent("class_result_viewed", {});
    }
    showClassSurface();
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
    const yearbookAction = document.createElement("button");
    yearbookAction.type = "button";
    yearbookAction.className = "page-link class-yearbook-action";
    yearbookAction.textContent = "Open yearbook";
    yearbookAction.addEventListener("click", () => showAppPage("yearbook"));
    els.blackboardFoot.replaceChildren(buildClassReportNextStep(), yearbookAction);
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
    arcIndicatorRenderer.render(t, {
      subjects: subjectClearSummary(),
    });
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
      options.pack ? walletPreviewLine("Collectible pack", options.pack) : "",
      options.card ? walletPreviewLine("Collectible card", options.card) : "",
      options.recipient ? walletPreviewLine("Recipient", walletPreviewAddress(options.recipient)) : "",
      options.mint ? walletPreviewLine("Collectible ID", walletPreviewAddress(options.mint)) : "",
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
    if (status === 404) return action + " could not find that collectible card or pack. Refresh Ruby High and try again.";
    if (status === 502 || status === 503 || status === 504) {
      return action + " is temporarily unavailable. " + safeState;
    }
    return action + (status ? " failed (" + status + "). " : " failed. ") + safeState;
  }

  function friendlySolanaActionError(err, unchanged) {
    const message = err && err.message ? String(err.message) : String(err || "error");
    if (/user rejected|rejected|canceled|cancelled/i.test(message)) return "Wallet request canceled.";
    if (/needs more SOL|insufficient funds|insufficient lamports|Attempt to debit|0x1\b|needs at least|balance is .*needs/i.test(message)) {
      return "This purchase needs more SOL for the pack price and Solana network fees. Nothing was charged.";
    }
    if (/403|forbidden|Helius|RPC rejected/i.test(message)) {
      return "Ruby High could not send this request to Solana. Your collectible did not change. Try again later.";
    }
    if (/429|too many requests|rate.?limit/i.test(message)) {
      return "The wallet service is busy. Wait a minute, then try again.";
    }
    if (/not found yet|not found on-chain|confirmation/i.test(message)) {
      return "Solana is still processing the transaction. Wait a few seconds, then try again.";
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
        copy: action + " needs " + hallPassCostLabel(cost) + ". Buy Hall Passes or permanently destroy a collectible card first.",
        detail: "Class questions and the included student art still work for free.",
      });
      return false;
    }
    const spendLabel = usePhotoDayCredit ? "1 Photo Day credit" : hallPassCostLabel(cost);
    const spendKind = usePhotoDayCredit ? "photo-day credit" : "Hall Pass";
    const isCharacterPortrait = action === "Custom student portrait";
    const isGraduationPhoto = action === "Take graduation photo";
    const detail = isCharacterPortrait
      ? "Keep editing while it runs. Ruby saves the student after the request finishes."
      : isGraduationPhoto
        ? "Ruby will add the finished group photo to your yearbook."
      : "Keep editing while it runs. Save and Close unlock once it finishes or you cancel.";
    const confirmText = isCharacterPortrait ? "Generate portrait" : isGraduationPhoto ? "Take photo" : "Generate image";
    if (usePhotoDayCredit) {
      return confirmInApp({
        kicker: "Ruby High image",
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
      copy: opts && opts.copy ? opts.copy : "This action needs Hall Passes. Buy more or permanently destroy a collectible card first.",
      detail: opts && opts.detail ? opts.detail : "You can keep playing classes for free.",
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
    const entitlement = hostedImageEntitlement("portrait") || {};
    const cost = entitlement.cost || 1;
    return teacherImageStatusView.reason({
      authed,
      hasApiKey: !!getStoredApiKey(),
      entitlement,
      canSpendHallPasses: canSpendHallPasses(cost),
    });
  }

  function teacherImageCreditHint() {
    const entitlement = hostedImageEntitlement("portrait") || {};
    const cost = entitlement.cost || 1;
    return teacherImageStatusView.creditHint({
      authed,
      hasApiKey: !!getStoredApiKey(),
      entitlement,
      canSpendHallPasses: canSpendHallPasses(cost),
    });
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
    syncBillingWallet(lastTelemetry);
    renderAccountPage();
  }

  function syncBillingWallet(t) {
    if (!els.billingWallet) return;
    const cardCount = walletCardCount(t || lastTelemetry);
    const packCount = walletPackCount(t || lastTelemetry);
    const hallPasses = walletNumbers(t || lastTelemetry).hallPasses;
    els.billingWallet.textContent = formatWholeNumber(hallPasses) + " Hall Pass" + (hallPasses === 1 ? "" : "es")
      + " · " + formatWholeNumber(packCount) + " Collectible Pack" + (packCount === 1 ? "" : "s")
      + " · " + formatWholeNumber(cardCount) + " Collectible Card" + (cardCount === 1 ? "" : "s");
    renderAccountWallet();
  }

  function setBillingStatus(text, invalid) {
    if (!els.billingStatus) return;
    els.billingStatus.textContent = text || "";
    els.billingStatus.classList.toggle("is-invalid", !!invalid);
  }

  // formatSolDisplayAmount, cardPackDebitLabel,
  // cardPackCreditLabel, cardPackPaymentDeltaLabel, cardPackProductMeta,
  // and formatMoney are in client-pure.ts.

  function cardPackCheckoutState() {
    const solana = billingProductsCache && billingProductsCache.solana && typeof billingProductsCache.solana === "object"
      ? billingProductsCache.solana
      : null;
    if (!solana) return { loaded: false, ready: true, reason: "" };
    if (!solana.configured) return { loaded: true, ready: false, reason: "Collectible-pack checkout is not available here." };
    return { loaded: true, ready: true, reason: "" };
  }

  function hostedAiTelemetry(t) {
    const entitlements = hostedEntitlements(t);
    const ai = entitlements && entitlements.hosted_ai && typeof entitlements.hosted_ai === "object"
      ? entitlements.hosted_ai
      : t && t.hosted_ai && typeof t.hosted_ai === "object" ? t.hosted_ai : null;
    const expiresAt = ai && ai.expiresAt != null ? Number(ai.expiresAt) : 0;
    const cost = ai && ai.cost != null ? Number(ai.cost) : 1;
    const durationMs = ai && ai.durationMs != null ? Number(ai.durationMs) : 604_800_000;
    const hasExpiry = Number.isFinite(expiresAt) && expiresAt > 0;
    return {
      active: !!(ai && ai.active && (!hasExpiry || expiresAt > Date.now())),
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
        const rawId = tab && tab.getAttribute("data-account-tab");
        const view = accountPaneItemView(rawId, active);
        const selected = rawId === view.id && view.selected;
        tab.classList.toggle("is-active", selected);
        tab.setAttribute("aria-selected", selected ? view.ariaSelected : "false");
        tab.tabIndex = selected ? view.tabIndex : -1;
      });
    }
    if (Array.isArray(els.accountPanels)) {
      els.accountPanels.forEach((panel) => {
        const rawId = panel && panel.getAttribute("data-account-panel");
        const view = accountPaneItemView(rawId, active);
        const selected = rawId === view.id && view.selected;
        panel.classList.toggle("is-active", selected);
        panel.hidden = selected ? view.hidden : true;
      });
    }
  }

  function renderAccountPage() {
    renderAccountPaneState();
    renderAccountWallet();
    renderAccountHallPassCards();
    renderAccountCharacters();
    renderAccountPublicWorld();
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
    if (!quiet && els.accountCardSummary) els.accountCardSummary.textContent = "Checking your wallet for collectible packs...";
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
          setPrivyStatus("Updated " + pieces.join(", ") + " collectible pack" + (importedCount + removedCount + restoredCount === 1 ? "" : "s") + " from your wallet.", false);
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

  function renderAccountWallet() {
    if (!els.accountWalletBalance) return;
    const slots = characterSlotTelemetry();
    const view = accountWalletPanelView(walletNumbers(lastTelemetry || {}), slots, {
      authed,
      billingBusy,
      billingMode,
    });
    els.accountWalletBalance.textContent = view.balanceText;
    if (els.accountBuyPasses) {
      els.accountBuyPasses.disabled = view.buyPassesDisabled;
      els.accountBuyPasses.textContent = view.buyPassesText;
      els.accountBuyPasses.title = view.buyPassesTitle;
    }
    if (els.accountWalletMeta) {
      els.accountWalletMeta.textContent = view.metaText;
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

  function renderAccountTrust() {
    if (!els.accountTrustList) return;
    const payload = billingProductsCache && typeof billingProductsCache === "object" ? billingProductsCache : null;
    const connectedWallet = knownSolanaOwnerWalletAddress();
    const view = accountTrustPanelView(payload, connectedWallet, buildId || "dev");
    accountTrustRenderer.render(view);
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

  function renderAccountHallPassCards() {
    const cards = hallPassCardsForTelemetry();
    const packs = hallPassPacksForTelemetry();
    const pendingMints = pendingHallPassCardMintsForTelemetry();
    accountHallPassCardsRenderer.render({
      authed,
      billingBusy,
      billingMode,
      checkout: cardPackCheckoutState(),
      cards,
      packs,
      pendingMints,
      hasSolanaWallet: !!knownSolanaOwnerWalletAddress(),
    });
  }

  function showHallPassCardReader(card) {
    accountCardReaderRenderer.show(card);
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
    if (card.characterId === "ruby" || card.characterId === "sally-science" || card.characterId === "professor-edward" || card.characterId === "roko") {
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
    const slots = characterSlotTelemetry();
    const wallet = walletNumbers(lastTelemetry);
    const entries = ownedCharacterEntries();
    accountCharacterRenderer.render({
      authed,
      billingBusy,
      slots,
      wallet,
      entries,
      hasActiveCharacter: !!(lastTelemetry && lastTelemetry.character),
      playbooks: lastTelemetry && Array.isArray(lastTelemetry.playbooks) ? lastTelemetry.playbooks : [],
      currentGrade: lastTelemetry && lastTelemetry.current_grade,
    });
  }

  function renderAccountPublicWorld() {
    accountPublicWorldController.render();
  }

  function openCharacterSheetFromAccount() {
    returnToAccountAfterSheet = true;
    closePrivyAccount();
    openSheet({ returnToAccount: true });
  }

  function openCharacterCreation() {
    if (lastTelemetry?.character) return;
    postOnboardingFunnelStep("onboarding_creation_opened");
    closePrivyAccount();
    openSheet();
  }

  function openCharacterCreationFromAccount() {
    openCharacterSheetFromAccount();
  }

  function renderAccountComics() {
    accountComicRenderer.render(comicCollectionForTelemetry());
  }

  function renderAccountHistory() {
    if (!els.accountHistoryList) return;
    const wallet = lastTelemetry && lastTelemetry.wallet && typeof lastTelemetry.wallet === "object" ? lastTelemetry.wallet : {};
    accountHistoryRenderer.render(wallet.transactions, { limit: 18 });
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
    welcomeHallPassPopupRenderer.show(grant, opts);
  }

  // accountHistoryRowView is in client-pure.

  async function unlockCharacterSlotFromAccount() {
    if (!authed || billingBusy) return;
    billingBusy = true;
    renderAccountCharacters();
    setPrivyStatus("Adding a student slot...", false);
    try {
      const data = await command({ type: "unlock-character-slot", requestId: imageRequestId("character-slot") });
      if (data && data.session) {
        setPrivyStatus("Student slot added. You also received one Photo Day credit.", false);
        renderAccountPage();
      } else {
        setPrivyStatus("Could not add a student slot.", true);
      }
    } finally {
      billingBusy = false;
      renderAccountCharacters();
    }
  }

  async function togglePublicWorldFromAccount() {
    await accountPublicWorldController.toggle();
  }

  async function ensureSolanaWalletFromAccount() {
    if (knownSolanaOwnerWalletAddress()) return true;
    if (!privyConfig) {
      setPrivyStatus("Wallet connection is not available here.", true);
      return false;
    }
    if (billingBusy) return false;
    billingBusy = true;
    renderAccountPage();
    try {
      if (!await ensurePasskeyAccount()) return false;
      await initializePrivyFromStoredSession();
      if (knownSolanaOwnerWalletAddress()) {
        setPrivyStatus("Wallet ready.", false);
        return true;
      }
      setPrivyStatus("Connect a Solana wallet to continue.", false);
      const approved = await confirmWalletTransactionPreview({
        title: "Connect your Solana wallet?",
        action: "Connect wallet",
        cost: "None",
        prompt: "Your wallet should ask to connect an address only.",
        copy: "Ruby High will ask for your Solana wallet address. This will not send a transaction or charge you.",
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
      cost: "No payment",
      pack: "Ruby High Pack",
      prompt: "You should not need to sign a wallet transaction to open this pack.",
      copy: "Ruby High will open a pack you own and reveal five collectible cards in your account.",
      confirmText: "Open pack",
    });
    if (!approved) {
      setPrivyStatus("Pack open canceled.", false);
      return;
    }
    billingBusy = true;
    renderAccountHallPassCards();
    showPackMintProgress("Opening your pack and revealing five collectible cards...");
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
      setPrivyStatus(openedText + " " + formatWholeNumber(count) + " card" + (count === 1 ? "" : "s") + " revealed.", false);
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
    showPackMintProgress("Creating your collectible card on Solana...", {
      title: "Minting your collectible card",
      lines: CARD_MINT_STATUS_LINES,
      rotate: false,
    });
    setPrivyStatus("Creating your collectible card on Solana...", false);
    try {
      const ownerWalletAddress = knownSolanaOwnerWalletAddress();
      if (!ownerWalletAddress) throw new Error("Connect a Solana wallet before minting collectible cards.");
      updatePackMintProgress("Preparing wallet transaction...");
      const prepared = await apiFetch(apiBase + "/nft/mint-card-prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 120000,
        body: JSON.stringify({ cardId: cleanCardId, ownerWalletAddress, clientBuild: buildId }),
      });
      const preparedData = await prepared.json().catch(() => ({}));
      if (!prepared.ok || !preparedData || !preparedData.ok || !preparedData.mint) {
        throw new Error(nftHttpErrorMessage("Minting the collectible card", prepared, preparedData, "Your card was not minted; try again in a minute."));
      }
      if (preparedData.mint.serverMinted || !preparedData.mint.transactionBase64) {
        const name = preparedData.card && preparedData.card.characterName ? preparedData.card.characterName : "Collectible card";
        updatePackMintProgress("Card minted on Solana.");
        setPrivyStatus(name + " minted on Solana.", false);
        await fetchSession();
        renderAccountPage();
        hidePackMintProgress(900);
        return hallPassCardById(cleanCardId) || preparedData.card || null;
      }
      const client = await getPrivyClient();
      if (!client || typeof client.signSolanaTransaction !== "function") {
        throw new Error("Creating collectible cards on Solana is unavailable.");
      }
      updatePackMintProgress("Review the card-creation transaction in your wallet...");
      setPrivyStatus("Review the collectible-card transaction in your wallet.", false);
      const signed = await withWalletActionTimeout(
        client.signSolanaTransaction(preparedData.mint),
        "Wallet approval timed out. Your card is still safe in Ruby High; try again when your wallet is ready.",
      );
      updatePackMintProgress("Sending the card transaction to Solana...");
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
        throw new Error(nftHttpErrorMessage("Confirming the collectible card", confirmed, data, "Your card mint is not recorded yet; try again in a minute."));
      }
      const name = data.card && data.card.characterName ? data.card.characterName : "Collectible card";
      setPrivyStatus(name + " minted on Solana.", false);
      await fetchSession();
      renderAccountPage();
      return hallPassCardById(cleanCardId) || data.card || null;
    } catch (err) {
      hidePackMintProgress();
      setPrivyStatus("Card mint failed · " + friendlySolanaActionError(err, "Your card is still safe in Ruby High; try again in a minute."), true);
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
        setPrivyStatus("Waiting for card mint confirmation...", false);
      }
      const confirmed = await apiFetch(apiBase + "/nft/mint-card-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 30000,
        body: JSON.stringify(input),
      });
      const data = await confirmed.json().catch(() => ({}));
      if (confirmed.ok && data && data.ok) return data;
      const errorMessage = nftHttpErrorMessage("Confirming the collectible card", confirmed, data, "Your card mint is not recorded yet; try again in a minute.");
      if (confirmed.status === 404 && /No collectible card ready to mint matches this request\./i.test(errorMessage)) {
        await fetchSession();
        const alreadyRevealed = hallPassCardById(input.cardId);
        if (alreadyRevealed && alreadyRevealed.mintAddress && alreadyRevealed.mintSignature) {
          return { ok: true, card: alreadyRevealed };
        }
      }
      lastError = new Error(errorMessage);
      if (!isRetryableSolanaMintConfirm(confirmed.status, errorMessage) || attempt + 1 >= maxAttempts) break;
    }
    throw lastError || new Error("Could not confirm the collectible card.");
  }

  function renderBillingProducts(payload) {
    if (!els.billingProducts) return;
    els.billingProducts.replaceChildren();
    syncBillingWallet(lastTelemetry);
    const mode = billingMode === "card-packs" ? "card-packs" : "hall-passes";
    const entitlements = payload && payload.entitlements && typeof payload.entitlements === "object" ? payload.entitlements : null;
    const hostedImages = entitlements && entitlements.hosted_images && typeof entitlements.hosted_images === "object"
      ? entitlements.hosted_images
      : null;
    const cardBurn = payload && payload.cardBurn && typeof payload.cardBurn === "object" ? payload.cardBurn : null;
    const hallPassesPerBurnedCard = positiveWholeNumber(cardBurn && cardBurn.hallPassesPerCard || HALL_PASS_CARD_BURN_HALL_PASS_VALUE, HALL_PASS_CARD_BURN_HALL_PASS_VALUE);
    const solana = payload && payload.solana && typeof payload.solana === "object" ? payload.solana : null;
    const panelView = billingProductsPanelView(mode, payload, solana, {
      hallPassesPerBurnedCard,
    });
    if (els.billingTitle) els.billingTitle.textContent = panelView.titleText;
    if (els.billingSub) els.billingSub.textContent = panelView.subtitleText;
    const costs = {
      portrait: hostedImages && hostedImages.portrait ? hostedImages.portrait.cost : payload && payload.imageCosts ? payload.imageCosts.portrait : undefined,
      diploma: hostedImages && hostedImages.diploma ? hostedImages.diploma.cost : payload && payload.imageCosts ? payload.imageCosts.diploma : undefined,
    };
    const creator = creatorPricing(payload);
    if (els.billingCosts) {
      els.billingCosts.replaceChildren();
      [
        ["Portrait", costs.portrait],
        ["Diploma art", costs.diploma],
        ["Publish a course", creator.courseSlotCost],
        ["More questions", creator.questionGenerationCost],
      ].forEach(([label, cost]) => {
        const chip = document.createElement("span");
        chip.className = "cost-chip";
        chip.textContent = label + ": " + billingHallPassCostLabel(cost);
        els.billingCosts.appendChild(chip);
      });
      if (mode === "card-packs") {
        els.billingCosts.replaceChildren();
        panelView.cardPackCostLabels.forEach((label) => {
          const chip = document.createElement("span");
          chip.className = "cost-chip";
          chip.textContent = label;
          els.billingCosts.appendChild(chip);
        });
      }
    }
    const solanaProducts = solana && Array.isArray(solana.products) ? solana.products : [];
    const products = Array.isArray(payload && payload.products) ? payload.products : [];
    const shownProducts = mode === "card-packs" ? solanaProducts : products;
    if (mode === "hall-passes") {
      els.billingProducts.appendChild(buildHallPassCardBurnChoice(hallPassesPerBurnedCard));
    }
    if (shownProducts.length === 0) {
      setBillingStatus(panelView.emptyStatusText, true);
      return;
    }
    if (selectedBillingProductId && !shownProducts.some((product) => product.id === selectedBillingProductId)) {
      selectedBillingProductId = null;
    }
    shownProducts.forEach((product) => {
      els.billingProducts.appendChild(billingProductsRenderer.buildProductRow(mode, product, solana, {
        selected: product.id === selectedBillingProductId,
        billingBusy,
      }));
      if (product.id === selectedBillingProductId) {
        els.billingProducts.appendChild(mode === "card-packs"
          ? buildCardPackPaymentChoice(solana, product)
          : buildBillingPaymentChoice(payload, product));
      }
    });
    setBillingStatus(panelView.checkoutStatusText, panelView.checkoutStatusError);
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
    return billingProductsRenderer.buildHallPassPaymentChoice(payload, product, { billingBusy });
  }

  function buildHallPassCardBurnChoice(hallPassesPerBurnedCard) {
    const ownerWallet = knownSolanaOwnerWalletAddress() || connectedSolanaWalletAddress();
    const burnableCards = ownerWallet ? activeMintedHallPassCardsForWallet(ownerWallet).length : mintedCardCount(lastTelemetry);
    return billingProductsRenderer.buildCardBurnChoice({
      hasWallet: !!ownerWallet,
      burnableCards,
      hallPassesPerBurnedCard,
      authed,
      billingBusy,
    });
  }

  function buildCardPackPaymentChoice(solana, product) {
    return billingProductsRenderer.buildCardPackPaymentChoice(solana, product, { billingBusy });
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
        setBillingStatus("Card exchange canceled.", false);
        return;
      }
      setBillingStatus("Could not exchange the collectible card · " + friendlySolanaActionError(err, "Your card was not changed; try again in a minute."), true);
    } finally {
      billingBusy = false;
      renderAccountPage();
      if (billingProductsCache) renderBillingProducts(billingProductsCache);
    }
  }

  async function loadBillingProducts() {
    setBillingStatus(billingMode === "card-packs" ? "Loading collectible packs..." : "Loading Hall Passes...", false);
    try {
      const r = await apiFetch(apiBase + "/billing/products", { timeoutMs: 8000 });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data || !data.ok) throw new Error(data.error || "billing " + r.status);
      billingProductsCache = data;
      renderBillingProducts(data);
    } catch (err) {
      setBillingStatus((billingMode === "card-packs" ? "Could not load collectible packs" : "Could not load Hall Passes") + " · " + (err && err.message ? err.message : "Please try again."), true);
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
      setBillingStatus("Starter Hall Passes are unavailable · " + (err && err.message ? err.message : "Please try again."), true);
    } finally {
      welcomeHallPassClaimInFlight = false;
    }
  }

  function openBilling(opts) {
    if (!authed || !els.billingOverlay) return;
    billingMode = opts && opts.mode === "card-packs" ? "card-packs" : "hall-passes";
    selectedBillingProductId = null;
    syncBillingWallet(lastTelemetry);
    openViewerModal(els.billingOverlay, {
      onRequestClose: closeBilling,
      initialFocus: els.billingClose,
    });
    if (billingProductsCache) renderBillingProducts(billingProductsCache);
    if (billingMode === "hall-passes") void claimWelcomeHallPassesFromBilling();
    void loadBillingProducts();
  }

  function closeBilling() {
    if (!els.billingOverlay || billingBusy) return;
    closeViewerModal(els.billingOverlay);
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
      setBillingStatus("Checkout failed · " + (err && err.message ? err.message : "Please try again."), true);
    }
  }

  async function startSolanaPayment(productId) {
    if (!productId || billingBusy) return;
    billingBusy = true;
    let finalBillingStatus = null;
    if (billingProductsCache) renderBillingProducts(billingProductsCache);
    setBillingStatus("Starting collectible-pack checkout...", false);
    try {
      if (!connectedSolanaWalletAddress()) {
        const connected = await ensureSolanaWalletForBilling();
        if (!connected) {
          finalBillingStatus = ["Collectible-pack checkout canceled.", false];
          setBillingStatus(finalBillingStatus[0], finalBillingStatus[1]);
          return;
        }
      }
      setBillingStatus("Preparing collectible-pack payment...", false);
      const ownerWalletAddress = connectedSolanaWalletAddress();
      const r = await apiFetch(apiBase + "/billing/solana/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 12000,
        body: JSON.stringify({ productId, ownerWalletAddress }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data || !data.ok) {
        throw new Error(nftHttpErrorMessage("Collectible-pack checkout", r, data, "No Ruby High pack was created; try again in a minute."));
      }
      const client = await getPrivyClient();
      if (!client || typeof client.paySolanaQuote !== "function") throw new Error("Solana wallet checkout is unavailable.");
      const product = data.product || {};
      const approved = await confirmWalletTransactionPreview({
        title: "Pay for this collectible pack?",
        action: "Buy " + cardPackProductLabel(product),
        walletAddress: ownerWalletAddress,
        cost: cardPackDebitLabel(product, data),
        credit: cardPackCreditLabel(product),
        pack: cardPackProductLabel(product) + " · " + formatWholeNumber(product.cardCount || HALL_PASS_CARDS_PER_PACK) + " cards",
        recipient: data.recipient,
        reference: data.reference,
        prompt: "Your wallet should show the pack price and a small Solana network fee.",
        copy: "Ruby High will ask your wallet to approve one collectible-pack purchase. It should not ask for permission to use other assets.",
        confirmText: "Open wallet",
      });
      if (!approved) {
        finalBillingStatus = ["Collectible-pack checkout canceled.", false];
        setBillingStatus(finalBillingStatus[0], finalBillingStatus[1]);
        return;
      }
      setBillingStatus("Confirm the collectible-pack payment in your wallet...", false);
      const payment = await client.paySolanaQuote(data);
      const signature = payment && payment.signature ? payment.signature : "";
      showPackMintProgress("Payment approved. Confirming your Ruby High pack...");
      setBillingStatus("Payment sent. Confirming pack...", false);
      await confirmSolanaPayment(productId, signature, payment && payment.walletAddress, data);
    } catch (err) {
      hidePackMintProgress();
      finalBillingStatus = ["Collectible-pack checkout failed · " + friendlySolanaActionError(err, "If your wallet already approved the payment, keep it connected and try again in a minute."), true];
      setBillingStatus(finalBillingStatus[0], finalBillingStatus[1]);
      setPrivyStatus(finalBillingStatus[0], finalBillingStatus[1]);
    } finally {
      billingBusy = false;
      renderAccountPage();
      if (billingProductsCache) renderBillingProducts(billingProductsCache);
      if (finalBillingStatus) setBillingStatus(finalBillingStatus[0], finalBillingStatus[1]);
    }
  }

  async function ensureSolanaWalletForBilling(opts) {
    if (connectedSolanaWalletAddress()) return true;
    const actionLabel = opts && opts.actionLabel ? String(opts.actionLabel) : "collectible-pack checkout";
    if (!privyConfig) throw new Error(actionLabel + " is not configured.");
    if (!await ensurePasskeyAccount()) return false;
    await initializePrivyFromStoredSession();
    if (connectedSolanaWalletAddress()) return true;
    setBillingStatus("Opening wallet connection for " + actionLabel + "...", false);
    const approved = await confirmWalletTransactionPreview({
      title: "Connect your Solana wallet?",
      action: "Connect wallet",
      cost: "None",
      prompt: "Your wallet should ask to connect an address only.",
      copy: "Ruby High will ask for your Solana wallet address. This will not send a transaction or charge you.",
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
      updatePackMintProgress(attempt === 0 ? "Checking the Solana receipt..." : "Waiting for payment confirmation...");
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
        lastError = new Error(nftHttpErrorMessage("Collectible-pack confirmation", r, data, "If your wallet already approved the payment, keep it connected and try again in a minute."));
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
        solAmount: data.solAmount || (quote && quote.product && quote.product.solAmount),
        symbol: data.symbol || (quote && quote.product && quote.product.symbol) || (quote && quote.symbol) || "SOL",
      };
      setBillingStatus(
        (data.applied ? packText + " created · " : packText + " already created · ") + cardPackPaymentDeltaLabel(paidProduct, quote),
        false,
      );
      updatePackMintProgress(data.applied ? "Pack created. Adding it to your account..." : "Pack already created. Updating your account...");
      hidePackMintProgress(900);
      await fetchSession();
      await deriveAuth();
      await syncWalletPackNftsFromAccount({ force: true, quiet: true });
      if (billingProductsCache) await loadBillingProducts();
      return;
    }
    throw lastError || new Error("Could not confirm the Solana payment.");
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
    return cardBurnSelector.select(cards, needed);
  }

  async function burnHallPassCardsForSpend(count, opts) {
    const needed = positiveWholeNumber(count, 1);
    if (needed <= 0) return [];
    if (!connectedSolanaWalletAddress()) {
      const connected = await ensureSolanaWalletForBilling();
      if (!connected) throw new Error("Connect a Solana wallet before permanently destroying a collectible card.");
    }
    const ownerWalletAddress = connectedSolanaWalletAddress();
    const cards = activeMintedHallPassCardsForWallet(ownerWalletAddress);
    if (cards.length < needed) {
      throw new Error("No collectible card on Solana is available to exchange from this wallet.");
    }
    const client = await getPrivyClient();
    if (!client || typeof client.signAndSendSolanaTransaction !== "function") {
      throw new Error("This collectible-card exchange is unavailable.");
    }
    if (opts && typeof opts.status === "function") {
      opts.status("Choose " + (needed === 1 ? "a collectible card" : needed + " collectible cards") + " to permanently destroy...", false);
    }
    const presetCards = opts && Array.isArray(opts.presetCards) ? opts.presetCards.filter(Boolean).slice(0, needed) : [];
    const selectedCards = presetCards.length === needed
      ? presetCards
      : await selectHallPassCardsForBurn(cards, needed);
    if (!selectedCards) throw new Error("Card exchange canceled.");
    if (opts && typeof opts.status === "function") {
      opts.status(
        "Opening your wallet to permanently destroy " + needed + " collectible card" + (needed === 1 ? "" : "s") + "...",
        false,
      );
    }
    const burns = [];
    for (let index = 0; index < selectedCards.length; index += 1) {
      const selectedCard = selectedCards[index];
      if (opts && typeof opts.status === "function") {
        opts.status(
          "Opening your wallet for card " + (index + 1) + " of " + selectedCards.length + "...",
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
        throw new Error(nftHttpErrorMessage("The collectible-card exchange", r, data, "Your card was not changed; try again in a minute."));
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
        throw new Error("The selected collectible card changed. Please choose it again.");
      }
      const approved = await confirmWalletTransactionPreview({
        title: selectedCards.length === 1 ? "Permanently destroy this card?" : "Permanently destroy card " + (index + 1) + " of " + selectedCards.length + "?",
        action: "Permanently destroy a collectible card for Hall Passes",
        walletAddress: ownerWalletAddress,
        cost: "Permanently destroy 1 collectible card",
        credit: hallPassCostLabel(hallPassBurnCreditForCards(1)),
        card: preparedCard.characterName || selectedCard.characterName || "Ruby High Card",
        reference: preparedCard.mintAddress,
        prompt: "Your wallet should show one transaction that permanently destroys this collectible card.",
        copy: "This cannot be undone. Ruby High will add Hall Passes after Solana confirms the transaction.",
        confirmText: "Open wallet",
        tone: "danger",
      });
      if (!approved) {
        if (opts && typeof opts.status === "function") opts.status("Card exchange canceled.", false);
        throw new Error("Card exchange canceled.");
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
    status("Permanently destroying " + needed + " collectible card" + (needed === 1 ? "" : "s") + " for " + hallPassCostLabel(expectedCredit) + "...", false);
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
        status("Added " + hallPassCostLabel(amount) + " from " + needed + " permanently destroyed collectible card" + (needed === 1 ? "" : "s") + ".", false);
        await fetchSession();
        await deriveAuth();
        renderAccountPage();
        if (billingProductsCache) renderBillingProducts(billingProductsCache);
        return data;
      }
      lastError = new Error(nftHttpErrorMessage("Adding Hall Passes", r, data, "If your wallet already approved the exchange, keep it connected and try again in a minute."));
      if (!/not found yet|confirmation|try again|rpc/i.test(lastError.message) || attempt === 3) throw lastError;
      status("Waiting for the card exchange to finish...", false);
    }
    throw lastError || new Error("Could not add Hall Passes from the collectible card.");
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
      lastError = new Error(nftHttpErrorMessage("Confirming the card exchange", r, data, "If your wallet already approved the exchange, keep it connected and try again in a minute."));
      if (!/not found yet|confirmation|try again|rpc/i.test(lastError.message)) break;
    }
    throw lastError || new Error("Could not confirm the collectible-card exchange.");
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

  function consumeAcquisitionAttribution() {
    try {
      const url = new URL(window.location.href);
      const keys = ["rh_source", "rh_campaign", "rh_landing", "rh_entry"];
      if (!keys.some((key) => url.searchParams.has(key))) return;
      acquisitionAttribution = {
        campaignSource: url.searchParams.get("rh_source") || "",
        campaignId: url.searchParams.get("rh_campaign") || "",
        landingVariant: url.searchParams.get("rh_landing") || "",
        entrypoint: url.searchParams.get("rh_entry") || "",
      };
      quickRollExperimentLanding = acquisitionAttribution.landingVariant === "quick-roll-v1";
      if (quickRollExperimentLanding) {
        const subtitle = document.querySelector("#blackboard-empty-text .onboarding-sub");
        const detail = document.querySelector("#blackboard-empty-text .onboarding-detail");
        const create = document.getElementById("onboarding-create-btn");
        if (subtitle) subtitle.textContent = "Create a student. Complete one class. Get your report.";
        if (detail) detail.textContent = "Start with a ready student, then change anything you like before saving.";
        if (create) create.textContent = "Create or edit my student";
      }
      keys.forEach((key) => url.searchParams.delete(key));
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    } catch (_e) {
      acquisitionAttribution = null;
      quickRollExperimentLanding = false;
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

  function consumeSharedPackFlag() {
    try {
      const url = new URL(window.location.href);
      const packId = (url.searchParams.get("pack") || "").trim();
      if (!packId) return "";
      url.searchParams.delete("pack");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      return packId.slice(0, 180);
    } catch (_e) {
      return "";
    }
  }

  async function applySharedPackFromUrl(packId) {
    const cleanPackId = String(packId || "").trim();
    if (!cleanPackId) return;
    try {
      await packStudioClient.installPack(cleanPackId, true);
      await packStudioClient.setActivePack(cleanPackId);
      await fetchSession();
      showCongrats("Shared class added.", true);
    } catch (err) {
      showCongrats("Could not add shared class.", false);
    }
  }

  // ── race strip (timer + per-NPC thinking/locked indicators) ─────────────
  function renderRaceStrip(t) {
    raceStripRenderer.render(t, {
      students: STUDENTS,
      visibleStudentIds: STUDENTS.filter((s) => shouldShowStudentId(s.id)).map((s) => s.id),
      playerName: playerDisplayName(),
    });
  }
  function renderTeacherFigure(faculty) {
    els.teacherName.textContent = faculty && faculty.id !== LOUNGE_ID ? faculty.displayName || "Teacher" : "";
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
  // original pack that's Ruby/Sally/Edward/Roko; for a generated/imported pack
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

  function buildCaseActionResult(action, compact) {
    if (!action || !action.report) return null;
    const wrap = document.createElement("article");
    wrap.className = "case-action-result" + (compact ? " is-compact" : "");
    const top = document.createElement("div");
    top.className = "case-action-result-top";
    const label = document.createElement("strong");
    label.textContent = action.reportLabel || ((action.actorName || "Investigator") + " report");
    const confidence = document.createElement("span");
    const confidenceValue = ["low", "medium", "high"].includes(String(action.confidence))
      ? String(action.confidence)
      : "medium";
    confidence.className = "case-action-confidence is-" + confidenceValue;
    confidence.textContent = confidenceValue + " confidence";
    top.append(label, confidence);
    wrap.appendChild(top);
    if (action.actionLabel) {
      const move = document.createElement("p");
      move.className = "case-action-move";
      move.textContent = (action.actorName || "Investigator") + " · " + action.actionLabel;
      wrap.appendChild(move);
    }
    const report = document.createElement("p");
    report.className = "case-action-report";
    report.textContent = action.report;
    wrap.appendChild(report);
    if (action.revealedEvidence && action.revealedEvidence.detail) {
      const evidence = document.createElement("div");
      evidence.className = "case-action-new-evidence";
      const evidenceLabel = document.createElement("strong");
      evidenceLabel.textContent = action.revealedEvidence.label || "New evidence";
      const evidenceSource = document.createElement("span");
      evidenceSource.textContent = action.revealedEvidence.source || action.actorName || "Investigation";
      const evidenceDetail = document.createElement("p");
      evidenceDetail.textContent = action.revealedEvidence.detail;
      evidence.append(evidenceLabel, evidenceSource, evidenceDetail);
      wrap.appendChild(evidence);
    }
    if (action.verificationPrompt) {
      const verify = document.createElement("p");
      verify.className = "case-action-verify";
      verify.textContent = "Verify before relying on it: " + action.verificationPrompt;
      wrap.appendChild(verify);
    }
    return wrap;
  }

  function buildCasePathResult(choice) {
    if (!choice || !choice.eventConsequence) return null;
    const wrap = document.createElement("article");
    wrap.className = "case-path-result";
    const label = document.createElement("strong");
    label.textContent = choice.eventLabel || "The situation changes";
    const move = document.createElement("p");
    move.className = "case-path-move";
    move.textContent = "You chose: " + choice.choiceLabel;
    const result = document.createElement("p");
    result.className = "case-path-consequence";
    result.textContent = choice.eventConsequence;
    wrap.append(label, move, result);
    (choice.revealedEvidence || []).forEach((item) => {
      const evidence = document.createElement("div");
      evidence.className = "case-path-evidence";
      const heading = document.createElement("strong");
      heading.textContent = item.label || "New evidence";
      const source = document.createElement("span");
      source.textContent = item.source || "Later report";
      const detail = document.createElement("p");
      detail.textContent = item.detail || "";
      evidence.append(heading, source, detail);
      wrap.appendChild(evidence);
    });
    if (choice.reflection) {
      const reflection = document.createElement("p");
      reflection.className = "case-path-reflection";
      reflection.textContent = "Question now: " + choice.reflection;
      wrap.appendChild(reflection);
    }
    return wrap;
  }

  function renderQuestionPrompt(question) {
    const view = questionPromptView(question);
    els.boardPrompt.replaceChildren();
    if (view.caseStudy) {
      const caseWrap = document.createElement("section");
      caseWrap.className = "case-study-card case-stage-" + view.caseStudy.stage;
      const top = document.createElement("div");
      top.className = "case-study-topline";
      const stage = document.createElement("span");
      stage.className = "case-study-stage";
      stage.textContent = view.caseStudy.storyFunction
        ? view.caseStudy.storyFunction + (view.caseStudy.nodeTitle ? " · " + view.caseStudy.nodeTitle : "")
        : view.caseStudy.stage === "investigate"
          ? "Sign"
          : view.caseStudy.stage === "decide"
            ? "Challenge"
            : view.caseStudy.stage === "navigate"
              ? "Discover"
              : "Return";
      const title = document.createElement("strong");
      title.className = "case-study-title";
      title.textContent = view.caseStudy.title;
      top.append(stage, title);
      caseWrap.appendChild(top);
      if (view.caseStudy.assignmentLabel || (view.caseStudy.route && view.caseStudy.route.length > 0)) {
        const route = document.createElement("div");
        route.className = "case-study-route";
        const routeLabel = document.createElement("strong");
        routeLabel.textContent = view.caseStudy.assignmentLabel || "Assignment route";
        route.appendChild(routeLabel);
        (view.caseStudy.route || []).forEach((step, index) => {
          const node = document.createElement("span");
          node.textContent = (index > 0 ? "→ " : "") + step.label;
          route.appendChild(node);
        });
        caseWrap.appendChild(route);
      }
      if (view.caseStudy.labyrinth) {
        const state = view.caseStudy.labyrinth;
        const status = document.createElement("div");
        status.className = "case-labyrinth-state";
        const progress = document.createElement("strong");
        progress.textContent = "Rooms " + state.completedRooms + "/" + state.requiredRooms;
        const pressure = document.createElement("span");
        pressure.textContent = "Rumor " + state.rumor + " · Trust " + (state.trust >= 0 ? "+" : "") + state.trust + " · Distress " + state.distress;
        const humans = document.createElement("span");
        humans.textContent = state.requiredHumans > 1
          ? "Hands " + state.presentHumans + "/" + state.requiredHumans
          : "Solo passage";
        status.append(progress, pressure, humans);
        if (state.inventory.length > 0) {
          const inventory = document.createElement("span");
          inventory.textContent = "Carrying: " + state.inventory.join(", ");
          status.appendChild(inventory);
        }
        caseWrap.appendChild(status);
      }
      if (view.caseStudy.hook) {
        const hook = document.createElement("p");
        hook.className = "case-study-hook";
        hook.textContent = view.caseStudy.hook;
        caseWrap.appendChild(hook);
      }
      const scene = document.createElement("p");
      scene.className = "case-study-scene";
      scene.textContent = view.caseStudy.scene;
      caseWrap.appendChild(scene);
      if (view.caseStudy.evidence.length > 0) {
        const evidence = document.createElement("div");
        evidence.className = "case-study-evidence";
        view.caseStudy.evidence.forEach((item) => {
          const card = document.createElement("article");
          card.className = "case-study-evidence-item";
          const label = document.createElement("strong");
          label.textContent = item.label;
          const source = document.createElement("span");
          source.textContent = item.source;
          const detail = document.createElement("p");
          detail.textContent = item.detail;
          card.append(label, source, detail);
          evidence.appendChild(card);
        });
        caseWrap.appendChild(evidence);
      }
      (view.caseStudy.priorChoices || []).forEach((choice) => {
        const pathResult = buildCasePathResult(choice);
        if (pathResult) caseWrap.appendChild(pathResult);
      });
      if (view.caseStudy.investigation) {
        const investigation = buildCaseActionResult(view.caseStudy.investigation, false);
        if (investigation) caseWrap.appendChild(investigation);
      }
      if (view.caseStudy.sources && view.caseStudy.sources.length > 0) {
        const sources = document.createElement("div");
        sources.className = "case-study-sources";
        const label = document.createElement("span");
        label.textContent = "Further reading";
        sources.appendChild(label);
        view.caseStudy.sources.forEach((source) => {
          const link = document.createElement("a");
          link.href = source.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = source.label;
          link.title = source.note || source.label;
          sources.appendChild(link);
        });
        caseWrap.appendChild(sources);
      }
      els.boardPrompt.appendChild(caseWrap);
    }
    if (view.images.length > 0) {
      const wrap = document.createElement("div");
      wrap.className = "anki-media-grid";
      view.images.forEach((asset) => {
        const img = document.createElement("img");
        img.src = asset.src;
        img.alt = asset.alt;
        wrap.appendChild(img);
      });
      els.boardPrompt.appendChild(wrap);
    }
    const text = document.createElement("div");
    text.className = "prompt-text";
    renderMarkdownInto(text, view.prompt);
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
      if (authed && lastTelemetry && lastTelemetry.character && shouldShowClassReport(lastTelemetry)) {
        showBlackboardClassReport(faculty, currentGrade);
        return;
      }
      if (authed && lastTelemetry && lastTelemetry.character && lastTelemetry.graduation_ready) {
        showBlackboardCeremony(faculty, currentGrade);
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
        if (els.blackboardEmptyAction) els.blackboardEmptyAction.hidden = true;
      } else if (lastTelemetry && lastTelemetry.graduation_ready) {
        els.blackboardEmptyText.textContent = "You finished this year's requirements. Pick a reward to save the year in your yearbook.";
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
        const gate = (lastTelemetry && lastTelemetry.graduation_gate) || {};
        const essayReady = gate.stage === "essay";
        const practiceOnly = !!progress && Number(progress.requiredClasses || 0) === 0;
        const todayDone = progress && progress.today && progress.today.status === "complete";
        const todayActive = progress && progress.today && progress.today.status === "active";
        const teacherName = faculty ? teacherShortName(faculty, "today's teacher") : "today's teacher";
        const advanceLabel = teacherChatEnabled() ? chatActionLabel(lastTelemetry) : "Continue";
        const lead = essayReady
          ? "Your final response board is ready — tap " + advanceLabel + " to start building."
          : practiceOnly
            ? "This is a practice room — tap " + advanceLabel + " to review."
          : todayDone
            ? "Today's graded class is complete. Review is open."
          : todayActive
            ? "Continue today's class — tap " + advanceLabel + " to start."
            : "Start today's graded class — tap " + advanceLabel + " to start.";
        const welcome = showWelcomeBackCopy ? "Welcome back — " + teacherName + " is ready. " : "";
        const infoText = hint ? welcome + lead + " " + hint : welcome + lead;
        const statusText = essayReady
          ? "Final response ready"
          : practiceOnly
            ? "Practice room"
          : todayDone
            ? "Class complete · review open"
          : todayActive
            ? "Class in progress"
            : "Today's class ready";
        els.blackboardEmptyText.replaceChildren(buildBoardClassStartHeader(statusText, infoText));
        if (els.blackboardEmptyAction) {
          els.blackboardEmptyAction.textContent = essayReady
            ? "Build final response"
            : practiceOnly
              ? "Start practice"
              : todayActive ? "Continue today's class" : "Start today's class";
          els.blackboardEmptyAction.hidden = !essayReady && !practiceOnly && !!todayDone;
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
    const isStoryAction = question.type === "story-action";
    const isFreeformAnswer = isTypedAnswer || isOpinion || isStoryAction;
    if (isNewQuestion) {
      clearOpinionSubmitted();
      opinionGradeFired = false;
      renderedOpinionIds.clear();
      gradedResponderIds.clear();
      resetResponseBuilder();
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
        ? ar.classSession.mode === "class"
          ? "GRADED TAKE " + (ar.classSession.index || "?") + "/" + (ar.classSession.total || 3)
          : "REFLECTION"
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
      els.boardReveal.classList.remove("correct", "wrong", "neutral");
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
        btn.classList.remove("is-correct", "is-wrong", "is-selected");
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
    syncResponseBuilder(isOpinion, typedDisabled);
    syncLabyrinthAction(question, typedDisabled);
    els.generateMcBtn.hidden = !(isTypedAnswer && question.canGenerateMc);
    els.generateMcBtn.disabled = role === "agent" || playerLocked || !!(round && round.resolved) || generatingMc || !aiEnabled;
    els.generateMcBtn.title = aiEnabled
      ? "Create answer choices for this question"
      : "Use an AI key to create answer choices";
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
    const result = document.createElement("span");
    result.className = "reveal-result";
    const isBest = round.bestResponder === "player";
    result.textContent = (isBest ? "★ " : "") + "Your grade: " + playerGrade.score.toFixed(1) + "/10";
    els.boardReveal.appendChild(result);
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
    const isStoryChoice = reveal.questionType === "story-choice";
    const isStoryAction = reveal.questionType === "story-action";
    const isOpenStory = isStoryChoice || isStoryAction;
    const isTypedReveal = !isStoryAction && (reveal.answerText != null || reveal.expectedAnswer != null || reveal.answerJudge != null);
    els.answers.forEach((btn) => {
      btn.disabled = true;
      if (isOpenStory) {
        if (!reveal.forfeit && btn.dataset.pick === reveal.picked) btn.classList.add("is-selected");
      } else {
        if (btn.dataset.pick === reveal.correct) btn.classList.add("is-correct");
        if (!reveal.forfeit && btn.dataset.pick === reveal.picked && !reveal.wasCorrect) btn.classList.add("is-wrong");
      }
    });
    els.responseCardButtons.forEach((button) => { button.disabled = true; });
    els.responseStepButtons.forEach((button) => { button.disabled = true; });
    els.typedSubmitBtn.disabled = true;
    els.labyrinthAttributeGrid.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    els.labyrinthExitGrid.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    els.generateMcBtn.disabled = true;
    // The wrong-answer "hide A/B/C/D for chat space" rule lives in
    // showBlackboardLoaded so it survives re-renders driven by the
    // telemetry poll. Don't duplicate it here.
    els.boardReveal.hidden = false;
    els.boardReveal.classList.toggle("neutral", isOpenStory);
    els.boardReveal.classList.toggle("correct", !isOpenStory && !!reveal.wasCorrect);
    els.boardReveal.classList.toggle("wrong", !isOpenStory && !reveal.wasCorrect);
    // Build the reveal block by parts so the dice render alongside the result.
    els.boardReveal.replaceChildren();
    const result = document.createElement("span");
    result.className = "reveal-result";
    result.textContent = isOpenStory
      ? reveal.forfeit ? "The scene moved on" : isStoryAction ? "Action resolved — no verdict" : "Choice locked — no verdict yet"
      : reveal.forfeit
      ? "⏱ Time's up — answer was " + (isTypedReveal ? (reveal.expectedAnswer || reveal.correct) : reveal.correct)
      : isTypedReveal
      ? (reveal.wasCorrect ? "✓ Correct" : "✗ Not quite")
      : reveal.affinitySave
      ? "✓ Class affinity saved " + reveal.picked + " — answer was " + reveal.correct
      : reveal.wasCorrect
      ? "✓ Correct (" + reveal.picked + ")"
      : "✗ You picked " + reveal.picked + " — answer was " + reveal.correct;
    els.boardReveal.appendChild(result);
    if (isOpenStory && reveal.caseChoice && reveal.caseChoice.lockedText) {
      const choiceNote = document.createElement("div");
      choiceNote.className = "reveal-case-consequence";
      const label = document.createElement("strong");
      label.textContent = "Immediate state";
      const detail = document.createElement("span");
      detail.textContent = reveal.caseChoice.lockedText;
      choiceNote.append(label, detail);
      els.boardReveal.appendChild(choiceNote);
    }
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
        judge.textContent = "Answer match: " + Math.round(Number(reveal.answerJudge.score) * 100) + "%";
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
    if (reveal.caseConsequence && reveal.caseConsequence.detail) {
      const consequence = document.createElement("div");
      consequence.className = "reveal-case-consequence";
      const label = document.createElement("strong");
      label.textContent = reveal.caseConsequence.label || "What changed";
      const detail = document.createElement("span");
      detail.textContent = reveal.caseConsequence.detail;
      consequence.append(label, detail);
      els.boardReveal.appendChild(consequence);
    }
    if (reveal.caseActionResult) {
      const actionResult = buildCaseActionResult(reveal.caseActionResult, true);
      if (actionResult) els.boardReveal.appendChild(actionResult);
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
      const options = (type === "multiple-choice" || type === "story-choice") && q && q.options
        ? q.options
        : (reveal.questionOptions || null);
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
        correctAnswer: type === "story-choice" || type === "story-action" ? null : (reveal.expectedAnswer || optionAnswer(reveal.correct)),
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
        return "The teacher singled out " + name + "'s response build; you took notice." + tail;
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

    const wrap = revealFeedbackRenderer.buildSocialSummary(events);
    if (!wrap) return;
    els.stream.appendChild(wrap);
    postViewerMetricEvent("room_reaction_viewed", {
      questionId: reveal.questionId,
      faculty: t && t.faculty,
    });
    scrollIfPinned();
  }

  function appendResultChip(reveal) {
    const wrap = revealFeedbackRenderer.buildResult(reveal, questionCounter, relationshipEventsForQuestion(reveal && reveal.questionId));
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
    const humans = publicRoomStudentsForRail(t);
    const rosterSig = roster.map((n) => n.id + ":" + (n.currentRoom || "")).join(",");
    const cohortSig = cohort.map((n) =>
      n.id + ":" + n.grade + ":" + (n.graduated ? "1" : "0") + ":" + ((n.streak && n.streak.count) || 0)
    ).join(",");
    const socialSig = STUDENTS.map((s) => {
      const cell = cells && cells[s.id];
      return s.id + ":" + (cell ? [cell.affinity || 0, cell.circled ? 1 : 0, cell.scratched ? 1 : 0].join("/") : "");
    }).join(",");
    const humanSig = humans.map((student) => [
      student && student.id,
      student && student.name,
      student && student.grade,
      student && student.facultyId,
      student && student.portraitUrl,
    ].join(":")).join(",");
    return rosterSig + "::" + cohortSig + "::" + socialSig + "::humans=" + humanSig + "::hidden=" + (hiddenNpcStudentId() || "");
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
  function studentArcSubtitle(entry, currentGrade) {
    return classmateArcSubtitle(entry, currentGrade, entry && entry.npc && entry.npc.currentRoom ? roomLabelFor(entry.npc.currentRoom) : "");
  }
  function studentArcProgress(entry) {
    return classmateArcProgress(entry);
  }
  function studentArcProgressLabel(progress) {
    return classmateArcProgressLabel(progress);
  }
  function playbookAccent(playbookId) {
    const playbooks = Array.isArray(lastTelemetry && lastTelemetry.playbooks) ? lastTelemetry.playbooks : [];
    const hit = playbooks.find((p) => p && p.id === playbookId);
    return (hit && hit.accent) || "#4a6fa5";
  }
  function playbookLabel(playbookId) {
    const playbooks = Array.isArray(lastTelemetry && lastTelemetry.playbooks) ? lastTelemetry.playbooks : [];
    const hit = playbooks.find((p) => p && p.id === playbookId);
    return (hit && (hit.shortName || hit.name)) || "Student";
  }
  function humanRoomName(facultyId) {
    const fid = String(facultyId || "");
    const roster = Array.isArray(lastTelemetry && lastTelemetry.faculty_roster) ? lastTelemetry.faculty_roster : [];
    const fac = roster.find((f) => f && f.id === fid);
    return channelNameFor(fac || { id: fid });
  }
  function isDefaultStudentAvatarUrl(value) {
    return /\/assets\/students\/[^/?#]+-(?:face|full)\.png(?:[?#].*)?$/i.test(String(value || ""));
  }
  function customChatHumanPortraitUrl(raw) {
    const portraitUrl = String(raw || "").trim();
    if (!portraitUrl || portraitUrl.length > 2048 || /[\r\n]/.test(portraitUrl)) return "";
    if (portraitUrl.startsWith("//") || /^data:/i.test(portraitUrl)) return "";
    if (!(portraitUrl.startsWith("/") || /^https?:\/\//i.test(portraitUrl))) return "";
    if (isDefaultStudentAvatarUrl(portraitUrl)) return "";
    return portraitUrl;
  }
  function chatHumanStudentKey(name, portraitUrl) {
    return String(name || "Student").trim().toLowerCase() + "|" + String(portraitUrl || "").trim();
  }
  function rememberChatHistoryHumanStudent(facultyId, message) {
    if (!message || message.role !== "user" || message.isSelf) return false;
    const faculty = String(facultyId || message.faculty || "").trim();
    if (!faculty) return false;
    const portraitUrl = customChatHumanPortraitUrl(message.avatarUrl);
    if (!portraitUrl) return false;
    const name = String(message.authorName || "Student").trim() || "Student";
    if (name === "You") return false;
    const lastActive = Number.isFinite(Number(message.at)) ? Math.floor(Number(message.at)) : Date.now();
    const key = chatHumanStudentKey(name, portraitUrl);
    const idSlug = key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "student";
    const entry = {
      key,
      id: "chat-human:" + idSlug,
      name,
      playbookId: "",
      grade: "",
      facultyId: faculty,
      portraitUrl,
      stats: {},
      classGrades: {},
      yearbookCount: 0,
      lastActive,
    };
    const rows = chatHistoryHumanStudentsByFaculty.get(faculty) || [];
    const existingIndex = rows.findIndex((row) => row && row.key === key);
    if (existingIndex >= 0) {
      const current = rows[existingIndex];
      if (current && current.lastActive >= lastActive) return false;
      rows[existingIndex] = { ...current, ...entry };
    } else {
      rows.push(entry);
    }
    rows.sort((a, b) => Number(b.lastActive || 0) - Number(a.lastActive || 0) || String(a.name).localeCompare(String(b.name)));
    chatHistoryHumanStudentsByFaculty.set(faculty, rows.slice(0, 8));
    return true;
  }
  function rememberChatHistoryHumanStudents(facultyId, messages) {
    let changed = false;
    (Array.isArray(messages) ? messages : []).forEach((message) => {
      if (rememberChatHistoryHumanStudent(facultyId, message)) changed = true;
    });
    return changed;
  }
  function publicRoomStudentsForRail(t) {
    const out = [];
    const seenIds = new Set();
    const seenPeople = new Set();
    const seenNames = new Set();
    const seenPortraits = new Set();
    const add = (student) => {
      if (!student || typeof student !== "object") return;
      const portraitUrl = String(student.portraitUrl || "").trim();
      const facultyId = String(student.facultyId || "").trim();
      if (!portraitUrl || !facultyId) return;
      const name = String(student.name || "Student").trim() || "Student";
      const id = String(student.id || ("human:" + chatHumanStudentKey(name, portraitUrl))).trim();
      const personKey = chatHumanStudentKey(name, portraitUrl);
      const nameKey = name.toLowerCase();
      const portraitKey = portraitUrl.toLowerCase();
      if (seenIds.has(id) || seenPeople.has(personKey) || (nameKey !== "student" && seenNames.has(nameKey)) || seenPortraits.has(portraitKey)) return;
      seenIds.add(id);
      seenPeople.add(personKey);
      if (nameKey !== "student") seenNames.add(nameKey);
      seenPortraits.add(portraitKey);
      out.push({ ...student, id, name, facultyId, portraitUrl });
    };
    (Array.isArray(t && t.public_room_students) ? t.public_room_students : []).forEach(add);
    chatHistoryHumanStudentsByFaculty.forEach((rows) => {
      (Array.isArray(rows) ? rows : []).forEach(add);
    });
    return out;
  }
  function publicRoomHumanRows(t, grade) {
    const activeFaculty = String((t && t.faculty) || "");
    const rows = publicRoomStudentsForRail(t).filter((student) => !activeFaculty || student.facultyId === activeFaculty);
    return rows
      .map((student) => {
        const portraitUrl = String((student && student.portraitUrl) || "").trim();
        if (!portraitUrl) return null;
        const name = String((student && student.name) || "Student").trim() || "Student";
        const rowGrade = String((student && student.grade) || grade || "");
        const gradeTitle = GRADE_LABELS[rowGrade] || (rowGrade ? "Grade " + rowGrade : "Student");
        const id = String((student && student.id) || ("human:" + name));
        return {
          npc: { ...student, kind: "human", currentRoom: student && student.facultyId },
          student: { ...student, kind: "human", color: playbookAccent(student && student.playbookId) },
          studentId: id,
          kind: "human",
          name,
          color: playbookAccent(student && student.playbookId),
          gradeTitle,
          ariaLabel: name + ", " + gradeTitle + ", in this channel",
          subtitle: gradeTitle + " · in channel",
          progress: null,
          progressLabel: "",
          social: null,
          portraitUrl,
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  function roomCompletionProgress(fac) {
    return roomCompletionProgressView(fac);
  }
  function roomCompletionLabel(fac, progress) {
    return roomCompletionProgressLabel(fac, progress);
  }
  function studentFaceUrl(studentId) {
    return apiBase + "/assets/optimized/students/" + encodeURIComponent(studentId) + "-face.webp?v=thumbs-20260830";
  }
  function applyRoomStudentChipPortraitClass(chip, img) {
    if (!chip || !img) return;
    const update = () => {
      const width = Number(img.naturalWidth || 0);
      const height = Number(img.naturalHeight || 0);
      chip.classList.remove("is-tall-portrait", "is-square-portrait", "is-wide-portrait");
      if (!width || !height) return;
      const ratio = width / height;
      if (ratio < 0.82) chip.classList.add("is-tall-portrait");
      else if (ratio > 1.18) chip.classList.add("is-wide-portrait");
      else chip.classList.add("is-square-portrait");
    };
    img.onload = () => update();
    if (img.complete) update();
  }
  function buildStudentFaceChip(student, className) {
    const record = student && typeof student === "object" ? student : { id: student };
    const studentId = String((record && record.id) || "");
    const name = String((record && record.name) || "").trim();
    const portraitUrl = String((record && record.portraitUrl) || "").trim();
    const s = STUDENTS.find((x) => x.id === studentId);
    const chip = document.createElement("span");
    chip.className = className || "student-face-chip";
    chip.style.setProperty("--student-accent", s ? s.color : "#888");
    chip.title = name || (s ? s.name : studentId);
    chip.setAttribute("aria-label", chip.title);
    if (portraitUrl) chip.classList.add("is-custom-portrait");
    if (record && record.kind === "human") {
      chip.classList.add("is-clickable");
      chip.setAttribute("role", "button");
      chip.setAttribute("tabindex", "0");
      const openHuman = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openHumanStudentProfile(record);
      };
      chip.addEventListener("click", openHuman);
      chip.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        openHuman(event);
      });
    }
    const img = document.createElement("img");
    img.src = portraitUrl || studentFaceUrl(studentId);
    img.alt = "";
    img.onerror = () => {
      chip.classList.add("is-fallback");
      chip.classList.remove("is-custom-portrait", "is-tall-portrait", "is-square-portrait", "is-wide-portrait");
      const fallbackName = name || (s ? s.name : "");
      chip.textContent = fallbackName.slice(0, 1).toUpperCase() || "?";
    };
    if (portraitUrl) applyRoomStudentChipPortraitClass(chip, img);
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
  function studentSocialMarkView(cell) {
    if (!cell) return null;
    const affinity = Number(cell.affinity || 0);
    if (affinity === 0 && !cell.circled && !cell.scratched) return null;
    return {
      className: "student-social-mark"
      + (cell.scratched ? " is-scratched" : cell.circled ? " is-circled" : affinity > 0 ? " is-warm" : affinity < 0 ? " is-cool" : " is-neutral"),
      title: studentSocialTitle(cell),
      text: affinity > 0 ? "+" + affinity : String(affinity),
    };
  }
  function classmateChannelGroups(t, grade) {
    const npcRoster = (t.npc_roster || [])
      .map((npc) => {
        const s = STUDENTS.find((x) => x.id === npc.id);
        if (!s || !shouldShowStudentId(npc.id)) return null;
        const arc = studentArcFor(npc.id, t);
        const rosterGrade = arc && !arc.graduated ? arc.grade : npc.grade;
        const gradeIdx = GRADE_ORDER.indexOf(String(rosterGrade));
        const entry = {
          npc,
          s,
          student: s,
          studentId: npc.id,
          arc,
          rosterGrade,
          socialCell: studentSocialCellFor(npc.id, t),
          sortGrade: arc && arc.graduated ? GRADE_ORDER.length : (gradeIdx >= 0 ? gradeIdx : GRADE_ORDER.length + 1),
        };
        const progress = studentArcProgress(entry);
        const progressLabel = studentArcProgressLabel(progress);
        const gradeTitle = arc && arc.graduated
          ? "Graduated"
          : (GRADE_LABELS[rosterGrade] || ("Grade " + rosterGrade));
        return {
          ...entry,
          name: s.name,
          color: s.color,
          gradeTitle,
          ariaLabel: s.name + ", " + gradeTitle + (progress ? ", " + progressLabel : ""),
          subtitle: studentArcSubtitle(entry, grade),
          progress,
          progressLabel,
          social: studentSocialMarkView(entry.socialCell),
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.sortGrade !== b.sortGrade) return a.sortGrade - b.sortGrade;
        return String(a.name).localeCompare(String(b.name));
      });
    const groups = new Map();
    npcRoster.forEach((entry) => {
      const key = studentCohortKey(entry);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
    const npcGroups = Array.from(groups.entries())
      .sort((a, b) => studentCohortSortValue(a[0]) - studentCohortSortValue(b[0]))
      .map(([key, entries]) => ({
        key,
        label: studentCohortLabel(key),
        rows: entries,
      }));
    const humanRows = publicRoomHumanRows(t, grade);
    return humanRows.length
      ? [{ key: "public-room-humans", label: "This channel", rows: humanRows }, ...npcGroups]
      : npcGroups;
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
    const cohort = t.room_cohort || {};
    const visibleStudentIds = STUDENTS.filter((s) => shouldShowStudentId(s.id)).map((s) => s.id);
    const railHumanStudents = publicRoomStudentsForRail(t);
    const roomViews = roomChannelRowViews(t.rooms || [], roster, cohort, t.faculty, STUDENTS, visibleStudentIds, railHumanStudents);
    roomChannelRowsController.appendRows(els.channelsList, roomViews, roster);

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

    if (!unlocked) return;

    // Honor Roll belongs with the primary destinations, above the longer
    // student roster. Placing it after every classmate pushed it below the
    // visible rail at common desktop heights and made the feature look absent.
    const honorTitle = document.createElement("div");
    honorTitle.className = "channel-section-title";
    honorTitle.textContent = "Honor Roll";
    els.channelsList.appendChild(honorTitle);
    const honorRow = document.createElement("button");
    honorRow.id = "honor-roll-button";
    honorRow.className = "channel-row";
    honorRow.type = "button";
    honorRow.setAttribute("aria-label", "View Honor Roll");
    honorRow.setAttribute("aria-controls", "leaderboard-panel");
    const honorThumb = document.createElement("span");
    honorThumb.className = "teacher-thumb";
    honorThumb.style.background = "#222";
    honorThumb.style.display = "grid";
    honorThumb.style.placeItems = "center";
    honorThumb.style.color = "#ffd700";
    honorThumb.style.fontSize = "16px";
    honorThumb.textContent = "🏆";
    honorRow.appendChild(honorThumb);
    const honorMeta = document.createElement("span");
    honorMeta.style.flex = "1 1 auto";
    honorMeta.style.fontWeight = "600";
    honorMeta.style.fontSize = "15px";
    honorMeta.textContent = "View Honor Roll";
    honorRow.appendChild(honorMeta);
    honorRow.addEventListener("click", () => showLeaderboard());
    els.channelsList.appendChild(honorRow);

    // Students — group the cohort by the year they are actually living in,
    // then use the row body for room/arc/social-card state instead of
    // repeating the same grade chip six times.
    classmateChannelRowsRenderer.appendSection(els.channelsList, classmateChannelGroups(t, grade));

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
    showClassSurface(true);
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
    showClassSurface(true);
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
        appendSystem("Use an AI key to hear the teachers' conversation.");
      }
    }
    closeRails();
  }

  async function showLeaderboard() {
    showAppPage("campus");
    els.channelsRail.hidden = true;
    leaderboardViewOpen = true;
    hideBlackboard();
    els.leaderboardPanel.hidden = false;
    els.leaderboardBody.innerHTML = '<div class="leaderboard-loading">Loading…</div>';
    focusWithoutScroll(els.leaderboardBack);
    try {
      const r = await apiFetch(apiBase + "/cohort");
      if (!r.ok) throw { status: r.status };
      const data = await r.json();
      renderLeaderboard(data);
    } catch (err) {
      const message = document.createElement("div");
      message.className = "leaderboard-loading";
      message.textContent = viewerRequestError("Honor Roll", err);
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Try again";
      retry.addEventListener("click", showLeaderboard);
      els.leaderboardBody.replaceChildren(message, retry);
    }
  }

  function hideBlackboard() {
    els.blackboardPanel.hidden = true;
    els.loungeStage.hidden = true;
    els.stream.hidden = true;
    els.composerZone.hidden = true;
    if (els.mobileViewToggle) els.mobileViewToggle.hidden = true;
    delete els.shell.dataset.mobilePane;
  }

  function renderLeaderboard(data) {
    const playbooks = (lastTelemetry && Array.isArray(lastTelemetry.playbooks)) ? lastTelemetry.playbooks : [];
    leaderboardPanelRenderer.render(data, playbooks);
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
    if (teacherChatEnabled() && telemetryPhase(lastTelemetry) === "asking") setMobilePane("chat", false);
    // Graduation ceremony is always accessible — bypass the agent turn guard so
    // the Ceremony button works even while a teacher SSE turn is in flight.
    if (lastTelemetry && lastTelemetry.graduation_ready && !lastTelemetry.current) {
      openSheet();
      return;
    }
    // A completed class still has its final reveal on the board. Clear that
    // reveal first so render() can show the promised report; signup/practice
    // is the action from the report, not a replacement for it.
    if (lastTelemetry && currentRevealCompletedClass(lastTelemetry)) {
      const now = Date.now();
      if (now - lastChatButtonAt < 900) return;
      lastChatButtonAt = now;
      await command({ type: "clear" });
      lockedFor = null;
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
    if (lastTelemetry && lastTelemetry.active_round && lastTelemetry.active_round.idleTriggered && !lastTelemetry.active_round.resolved) {
      appendSystem("The teacher is checking this answer now.");
      return;
    }
    if (turnController.isBusy()) {
      appendSystem("Chat is already working.");
      return;
    }
    const now = Date.now();
    if (now - lastChatButtonAt < 900) return;
    lastChatButtonAt = now;
    const buttonTurn = turnController.beginButtonAction();
    if (!buttonTurn) {
      appendSystem("Chat is already working.");
      return;
    }
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
            appendSystem("Answer the question to continue. Use an AI key for hints.");
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
            appendSystem("Use an AI key to continue the lounge conversation.");
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
          const continueClass = !!(
            lastTelemetry
            && lastTelemetry.lastReveal
            && lastTelemetry.lastReveal.classProgress
            && lastTelemetry.lastReveal.classProgress.mode === "class"
            && !currentRevealCompletedClass(lastTelemetry)
          );
          await command({ type: "clear" });
          if (continueClass) await command({ type: "pick" });
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
        setMobilePane("chat", false);
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
        const continueClass = !!(
          lastTelemetry
          && lastTelemetry.lastReveal
          && lastTelemetry.lastReveal.classProgress
          && lastTelemetry.lastReveal.classProgress.mode === "class"
          && !currentRevealCompletedClass(lastTelemetry)
        );
        await command({ type: "clear" });
        if (continueClass) await command({ type: "pick" });
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
    if (typedSubmitting || els.typedSubmitBtn.disabled) return;
    const responseCards = selectedResponseCardPayload();
    if (!responseCards) return;
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
    els.responseCardButtons.forEach((button) => { button.disabled = true; });
    els.responseStepButtons.forEach((button) => { button.disabled = true; });
    try {
      if (inOpinion) {
        markOpinionSubmitted(opinionQuestionId);
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
          body: JSON.stringify(aiEnabled ? { responseCards } : { responseCards, force: true }),
        });
        await consumeSseStream(r, streamGuard);
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
      syncResponseBuilder(inOpinion, role === "agent" || (inOpinion ? opinionLocked : locked));
    }
  }

  async function performLabyrinthAction(answerText) {
    if (typedSubmitting) return;
    typedSubmitting = true;
    els.labyrinthAttributeGrid.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    els.labyrinthExitGrid.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      const data = await command({ type: "answer-text", answerText, role });
      if (data && data.session && data.session.telemetry) {
        maybeRunAnswerGraded(data.session.telemetry, 0);
      }
    } catch (err) {
      appendSystem("The labyrinth could not resolve that move · " + (err && err.message ? err.message : "error"));
    } finally {
      typedSubmitting = false;
      const question = lastTelemetry && lastTelemetry.current;
      const round = lastTelemetry && lastTelemetry.active_round;
      syncLabyrinthAction(question, role === "agent" || !!(round && (round.resolved || round.player && round.player.isLocked)));
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
        ? "🎲 No help rolls left this grade"
        : "🎲 Roll for help (" + budget.remaining + "/" + budget.cap + " left)";
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
    document.documentElement.style.setProperty("--teacher-accent", color || "#d22a2a");
    document.documentElement.style.setProperty("--accent", "#c73543");
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
  function setMobilePane(nextPane, focusTab) {
    if (!els.mobileViewToggle || els.mobileViewToggle.hidden) return;
    mobilePane = nextPane === "chat" ? "chat" : "challenge";
    els.shell.dataset.mobilePane = mobilePane;
    els.mobileViewButtons.forEach((button) => {
      const selected = button.dataset.mobileView === mobilePane;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focusTab) focusWithoutScroll(button);
    });
    if (mobilePane === "chat") {
      requestAnimationFrame(() => {
        els.stream.scrollTop = els.stream.scrollHeight;
      });
    }
  }
  function syncMobileViewToggle(mode) {
    if (!els.mobileViewToggle) return;
    const available = !!(lastTelemetry && lastTelemetry.character) && !leaderboardViewOpen;
    els.mobileViewToggle.hidden = !available;
    if (!available) {
      mobilePaneQuestionId = null;
      delete els.shell.dataset.mobilePane;
      return;
    }
    const questionId = lastTelemetry && lastTelemetry.current ? lastTelemetry.current.id : null;
    if (questionId && questionId !== mobilePaneQuestionId) {
      mobilePaneQuestionId = questionId;
      mobilePane = "challenge";
    }
    setMobilePane(mobilePane, false);
  }
  function applyViewMode(mode) {
    // The single authority for "what should be visible right now". Sets
    // a data-mode attribute on the blackboard panel + on the shell, and
    // CSS hides per mode (see the .blackboard-panel[data-mode=...] rules).
    // Sub-renderers below (renderRaceStrip, renderAdvantageBar) only paint
    // CONTENT — they no longer fight over visibility.
    els.blackboardPanel.dataset.mode = mode;
    els.shell.dataset.mode = mode;
    if (!leaderboardViewOpen) {
      els.blackboardPanel.hidden = false;
      els.stream.hidden = false;
      els.composerZone.hidden = false;
      els.leaderboardPanel.hidden = true;
    }
    syncMobileViewToggle(mode);
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
    // The welcome screen is the only first-visit introduction. Daily
    // announcements return after enrollment, when they have useful context.
    if (!t || !t.character) return;
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

    const streak = (t && t.streak) || 0;
    const todayFaculty = t && t.faculty_roster && Array.isArray(t.faculty_roster)
      ? t.faculty_roster.find(function(f) { return f.id === t.faculty; })
      : null;
    const facultyName = todayFaculty
      ? (todayFaculty.displayName || todayFaculty.shortName || todayFaculty.name || "Ruby")
      : "Ruby";
    const grade = t && t.current_grade;
    const gradeLabel = grade ? ("Grade " + grade) : "";

    // Notes: guest faculty, books, comic pages
    var notes = [];
    var guestPack = t && t.guest_pack && t.guest_pack.auto;
    if (guestPack && guestPack.teacher_name) {
      notes.push({ icon: "📚", text: "<strong>Guest teacher:</strong> " + escapeHtml(guestPack.teacher_name) + " — " + escapeHtml(guestPack.name || guestPack.subject || "guest class") });
    }
    notes.push({ icon: "📖", text: "<strong>Books:</strong> <em>Qiao</em> and <em>Egregoregramming 101</em> on Gumroad" });

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

    const announcementCta = document.getElementById("announcements-dismiss");
    if (announcementCta) announcementCta.textContent = "Take your seat";
    const announcementAbout = document.getElementById("announcements-about");
    const announcementBooks = document.getElementById("announcements-books");
    if (announcementAbout) announcementAbout.hidden = false;
    if (announcementBooks) announcementBooks.hidden = false;

    announcementsPreviousFocus = document.activeElement && typeof document.activeElement.focus === "function"
      ? document.activeElement
      : null;
    overlay.hidden = false;
    focusWithoutScroll(document.getElementById("announcements-dismiss"));
    lockViewerModalBackground();
    announcementsBackgroundLocked = true;
  }

  function dismissAnnouncements() {
    markAnnouncementsSeen();
    if (announcementsOverlay) {
      announcementsOverlay.hidden = true;
    }
    if (announcementsBackgroundLocked) {
      unlockViewerModalBackground();
      announcementsBackgroundLocked = false;
    }
    const fallback = document.getElementById("onboarding-create-btn") || els.nextBtn;
    restoreModalFocus(announcementsPreviousFocus, fallback);
    announcementsPreviousFocus = null;
    if (lastTelemetry) syncFirstBellReportModal(lastTelemetry);
  }


  // ── onboarding / first-visit intro ──────────────────────────────────────
  function syncOnboardingActions(t) {
    const actions = document.getElementById("onboarding-actions");
    const visible = !!authed && !(t && t.character);
    if (actions) actions.hidden = !visible;
    if (visible && !onboardingIntroTracked) {
      onboardingIntroTracked = true;
      // The first welcome carries today's announcement role. Do not interrupt
      // the first question with another modal immediately after enrollment.
      markAnnouncementsSeen();
      postOnboardingFunnelStep("onboarding_intro_shown");
    }
    // The richer first-run actions replace the legacy fallback button.
    const emptyAction = document.getElementById("blackboard-empty-action");
    if (emptyAction && visible) emptyAction.hidden = true;
  }

  function render(s) {
    if (!s || !s.telemetry) return;
    const t = s.telemetry;
    const gainedCharacter = !lastTelemetry?.character && !!t.character;
    lastTelemetry = t;
    if (t.character && sheetEl.classList.contains("is-creation-overlay") && sheetEl.classList.contains("is-open")) {
      closeSheet();
    }
    if (gainedCharacter && els.stream.children.length > 0) clearStream();
    syncOnboardingActions(t);
    syncAiStateFromTelemetry(t);
    syncBillingWallet(t);
    renderAccountPage();
    syncComicUnlockModals(t);
    syncFirstBellReportModal(t);
    if (teacherChatEnabled() && t.faculty && (!renderedHistorySig || !renderedHistorySig.startsWith(t.faculty + ":"))) {
      loadHistory(t.faculty);
    }
    loadRoomHumanHistories(t);
    applyViewMode(deriveViewMode(t));
    // Returning-student briefing, shown once per day after enrollment.
    showMorningAnnouncements(t);

    if (authed && !t.character && !firstRunCreationOpened) {
      firstRunCreationOpened = true;
      // Put every new player at the first useful decision immediately.
      setTimeout(() => {
        if (lastTelemetry === t && !lastTelemetry.character) openCharacterCreation();
      }, 0);
    }
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
          ? "Class dismissed. " + facultyName + " graded your work. " + nextFaculty + " teaches tomorrow at 17:00 UTC. Come back to keep your daily progress."
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
    renderDailyClassProgress(t);
    renderBlackboard(t.current || null, fac || null, t.current_grade);
    renderRaceStrip(t);
    renderAdvantageBar(t);
    if (t.is_opinion && t.active_round) {
      renderOpinionsIntoChat(t.active_round);
      maybeAutoTriggerGrading(t);
    }

    // Reveal — apply to the board and keep the result in the conversation.
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
        if (t.lastReveal.questionType !== "story-choice" && t.lastReveal.questionType !== "story-action") {
          showCongrats(t.lastReveal.encouragement, t.lastReveal.wasCorrect);
        }
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
        if (t.lastReveal.questionType !== "story-choice" && t.lastReveal.questionType !== "story-action") {
          scheduleStudentChime(t.lastReveal.wasCorrect, t.current_grade, 4500);
        }
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
      if (els.youName) els.youName.textContent = "Create student";
      if (els.youProfile) els.youProfile.setAttribute("aria-label", "Open your account");
      if (els.youAvatar) {
        els.youAvatar.innerHTML = "";
        els.youAvatar.textContent = "+";
      }
    }
    if (t.character) {
      if (els.youProfile) els.youProfile.setAttribute("aria-label", "Open your account");
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

    if (appPage === "yearbook") renderYearbookPage();
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
    return ccgCardRenderer.buildCharacterCard(spec);
  }

  // Lifted out of appendProgression so the same chip + metadata are reusable
  // by the on-board subject-grade row that renders when the chalkboard is empty.
  const SUBJECT_GATE_ICONS = { ruby: "⌂", "sally-science": "⚗", "professor-edward": "✎", roko: "△", guest: "☆" };
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
    const view = subjectGradeChipView(spec);
    const chip = document.createElement("span");
    chip.className = view.className;
    chip.title = view.title;
    chip.setAttribute("aria-label", view.ariaLabel);
    const icon = document.createElement("span");
    icon.className = "subject-grade-icon";
    icon.textContent = view.iconText;
    const letter = document.createElement("span");
    letter.className = "subject-grade-letter";
    letter.textContent = view.gradeText;
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
    sheetCard.classList.remove("is-two-card-deck");
    sheetCard.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "card-deck profile-page is-count-" + cardNodes.length;
    sheetCard.appendChild(wrap);

    const track = document.createElement("div");
    track.className = "card-deck-track profile-page-sections";
    wrap.appendChild(track);
    cardNodes.forEach((card) => track.appendChild(card));
    const cards = Array.from(track.children);
    const scrollToCard = (i) => {
      const target = cards[Math.max(0, Math.min(cards.length - 1, i))];
      if (target && target.scrollIntoView) target.scrollIntoView({ block: "start", behavior: motionPreference.isReduced() ? "instant" : "smooth" });
    };
    return { track, scrollToCard };
  }

  // ── teacher profile (click teacher thumb in channel rail to open) ───────
  function openTeacherProfile(facultyId) {
    const t = lastTelemetry;
    const fac = (t && t.faculty_roster || []).find((f) => f.id === facultyId);
    if (!fac) return;
    sheetOverlayOpen = true;
    openViewerModal(sheetEl, {
      onRequestClose: closeSheet,
      initialFocus: () => sheetCloseBtn,
    });
    renderCardDeck([
      buildTeacherProfileCard(fac),
      buildTeacherCareerCard(fac),
    ]);
  }

  // ── student profile card ─────────────────────────────────────────────────
  function openHumanStudentProfile(human) {
    if (!human || typeof human !== "object") return;
    sheetOverlayOpen = true;
    openViewerModal(sheetEl, {
      onRequestClose: closeSheet,
      initialFocus: () => sheetCloseBtn,
    });
    const name = String(human.name || "Student").trim() || "Student";
    const gradeKey = String(human.grade || "");
    const gradeTitle = GRADE_LABELS[gradeKey] || (gradeKey ? "Grade " + gradeKey : "Student");
    const facultyId = String(human.facultyId || human.currentRoom || "");
    const roomName = humanRoomName(facultyId);
    const portraitUrl = String(human.portraitUrl || "").trim();
    const accent = playbookAccent(human.playbookId);
    const playbook = playbookLabel(human.playbookId);
    const stats = human.stats && typeof human.stats === "object" ? human.stats : {};
    const classGrades = human.classGrades && typeof human.classGrades === "object" && !Array.isArray(human.classGrades)
      ? human.classGrades
      : {};
    const completedClasses = Object.keys(classGrades).length;
    const yearbookCount = Math.max(0, Math.floor(Number(human.yearbookCount || 0)));
    const subtitle = gradeTitle + (roomName ? " · #" + roomName : "");
    renderCardDeck([
      buildCharacterCard({
        role: "student",
        name,
        subtitle,
        portraitUrl,
        accent,
        stats,
        quote: playbook + " at Ruby High.",
        footer: { title: "Current room", content: roomName ? "#" + roomName : "Ruby High" },
      }),
      buildProfileCareerCard({
        badgeLabel: "student",
        name: "Student Page",
        subtitle: playbook,
        metrics: [
          { label: "room", value: roomName ? "#" + roomName : "Ruby High", detail: "current channel", met: !!roomName },
          { label: "year", value: gradeTitle, detail: "current year", met: !!gradeKey },
          { label: "classes", value: String(completedClasses), detail: "completed", met: completedClasses > 0 },
          { label: "yearbook", value: String(yearbookCount), detail: "entries", met: yearbookCount > 0 },
        ],
      }),
    ]);
  }

  function openStudentProfile(npc, s) {
    if ((npc && npc.kind === "human") || (s && s.kind === "human")) {
      openHumanStudentProfile(npc && npc.kind === "human" ? npc : s);
      return;
    }
    sheetOverlayOpen = true;
    openViewerModal(sheetEl, {
      onRequestClose: closeSheet,
      initialFocus: () => sheetCloseBtn,
    });
    // Pull this NPC's parallel-arc state from the cohort. That's the
    // rivalry surface — what year they're on, what their daily-class count looks
    // like, whether they've already graduated past you.
    const arc = (lastTelemetry && lastTelemetry.npc_cohort)
      ? lastTelemetry.npc_cohort.find((n) => n.id === npc.id)
      : null;
    renderCardDeck([
      buildCharacterCard(profileCardView.studentProfileCard({
        npc,
        student: s,
        arc,
        portraitUrl: studentFullPortraitUrl(npc.id),
      })),
      buildStudentCareerCard(npc, s, arc),
    ]);
  }

  function roomLabelFor(roomId) {
    return profileCardView.roomLabel(roomId);
  }
  function teacherFullPortraitUrl(facultyId) {
    return teacherPortraitUrl(facultyId, "full");
  }
  function buildTeacherProfileCard(fac) {
    return buildCharacterCard(profileCardView.teacherProfileCard(fac, teacherFullPortraitUrl(fac.id)));
  }
  function buildTeacherCareerCard(fac) {
    return buildProfileCareerCard(profileCardView.teacherCareerCard(fac));
  }
  function buildStudentCareerCard(npc, _s, arc) {
    return buildProfileCareerCard(profileCardView.studentCareerCard({
      npc,
      arc,
      currentGrade: lastTelemetry?.current_grade,
    }));
  }
  function buildProfileCareerCard(spec) {
    return careerCardRenderer.buildProfileCard(spec);
  }
  function buildCareerMetrics(rows) {
    return careerCardRenderer.buildMetrics(rows);
  }
  function buildCareerTokens(spec) {
    return careerTokensRenderer.build(spec);
  }
  // ── character sheet UI ──────────────────────────────────────────────────
  const sheetEl = $("sheet-overlay");
  const sheetCard = $("sheet-card");
  function creationSheetOpen() {
    return !!(sheetOverlayOpen && sheetCard.classList.contains("is-creation-sheet"));
  }
  // Sign-in fallback surface. Normal boot creates a guest session and hides
  // this; it only opens if the app cannot establish a playable Ruby High
  // session.
  const signinEl = $("signin-overlay");
  function openSheet(options) {
    if (options && options.returnToAccount) returnToAccountAfterSheet = true;
    sheetOverlayOpen = true;
    openViewerModal(sheetEl, {
      onRequestClose: closeSheet,
      initialFocus: () => sheetCloseBtn,
    });
    renderSheet();
  }
  function closeSheet() {
    const shouldReturnToAccount = returnToAccountAfterSheet;
    returnToAccountAfterSheet = false;
    sheetOverlayOpen = false;
    closeViewerModal(sheetEl, els.nextBtn || els.youProfile);
    if (shouldReturnToAccount && authed) {
      setTimeout(() => { void openPrivyAccount(); }, 0);
    }
  }
  function renderSheet() {
    const t = lastTelemetry || {};
    const playbooks = t.playbooks || [];
    const closeButton = document.getElementById("sheet-close");
    sheetEl.classList.toggle("is-creation-overlay", !t.character);
    if (t.character) {
      sheetEl.setAttribute("aria-label", "Student card");
      if (closeButton) closeButton.setAttribute("aria-label", "Close student card");
      renderSheetReadonly(t.character, playbooks);
    } else {
      sheetEl.setAttribute("aria-label", "Create your Ruby High student");
      if (closeButton) closeButton.setAttribute("aria-label", "Close student creator");
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
    if (graduatedFor(c)) return "You graduated. You finished all four years, but you can keep playing.";
    const t = lastTelemetry || {};
    const gate = t.graduation_gate || {};
    if (gate.stage === "ceremony" || t.graduation_ready || c.pendingGraduation) {
      return "Requirements complete — the graduation ceremony is on the blackboard.";
    }
    if (gate.stage === "essay") {
      const essayOnBoard = t.current && t.current.opinionPurpose === "grade-essay";
      return essayOnBoard
        ? "Class requirements complete — your final response board is open."
        : "Class requirements complete — build your final response to finish the year.";
    }
    const grade = String(t.current_grade ?? "9");
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
      parts.push("Pass each subject with a C or better: " + segs.join(", "));
    }
    if (gate.essayRequired && !gate.essayCompleted) {
      parts.push("You can build your final response after you finish the class requirements");
    }

    if (parts.length === 0) {
      return "Keep working through this year's requirements.";
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
      const gradeLabel = completedGrade ? (GRADE_LABELS[completedGrade] || ("Grade " + completedGrade)) : "Ruby High";
      const scoreText = finalGrade.averageScore == null ? "Final grade ready" : "Final grade " + finalGrade.letter + " · " + formatClassScore(finalGrade.averageScore);
      const setBusy = (btn, text, controls) => {
        controls.buttons.forEach((b) => { b.disabled = true; });
        btn.textContent = text;
        controls.status.textContent = "Ceremony in progress…";
        controls.status.classList.remove("is-invalid");
      };
      const resetCeremonyControls = (controls) => {
        controls.buttons.forEach((b) => { b.disabled = false; });
      };
      const setCeremonyError = (controls, message) => {
        controls.status.textContent = message || "Ceremony failed — pick again.";
        controls.status.classList.add("is-invalid");
        resetCeremonyControls(controls);
      };
      const submitReward = async (reward, btn, controls) => {
        try {
          setBusy(btn, "Sealing…", controls);
          btn.textContent = "Sealing…";
          controls.status.textContent = "Ceremony in progress…";
          controls.status.classList.remove("is-invalid");
          const data = await command({ type: "complete-graduation", reward });
          if (data && data.session) {
            showCongrats(next ? "You're a " + targetLabel + " now!" : "You graduated.", true);
            await fetchSession();
            if (sheetOverlayOpen) renderSheet();
            return;
          }
          setCeremonyError(controls, "Ceremony failed — pick again.");
        } catch (err) {
          setCeremonyError(controls, err && err.message ? err.message : "Photo failed — pick again.");
        }
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
        label: "Generate photo later",
        detail: "in your yearbook any time.",
        reward: { kind: "photo" },
      };
      const seed = (c.pendingGraduation && c.pendingGraduation.readyAt)
        || (ready && ready.readyAt)
        || hashCeremonySeed((c.name || "") + ":" + grade);
      const choices = [photoChoice].concat(seededShuffle(pool, seed).slice(0, 2));
      return graduationCeremonyRenderer.build({
        onBoard,
        completedGradeLabel: gradeLabel,
        finalGradeLetter: finalGrade.letter,
        scoreText,
        targetLabel,
        hasNextGrade: !!next,
        photoLaterNote: "Choose one reward. You can generate the photo later in your yearbook.",
        choices,
        onChoice: submitReward,
      });
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
      .filter((y) => !(!grad && y.grade === liveGrade));

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
      : pb.name + " · " + gradeLabel + " student";

    const actions = [];
    if (!graduated) {
      actions.push({
        label: "✨ Age up portrait",
        secondary: true,
        onClick: async (e) => {
          const btn = e && e.currentTarget;
          if (btn) { btn.disabled = true; btn.textContent = "✨ Aging up…"; }
          try {
            if (!(await confirmHostedCreditSpend("Age up student portrait", "portrait"))) {
              if (btn) { btn.disabled = false; btn.textContent = "✨ Age up portrait"; }
              return;
            }
            const portraitEntitlement = hostedImageEntitlement("portrait") || {};
            const portraitCost = portraitEntitlement.cost || 1;
            if (usingHostedImageGeneration("portrait") && !canSpendHallPasses(portraitCost)) return;
            const r = await apiFetch("/api/apps/ruby-high/chat/character/portrait/age-up", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ requestId: imageRequestId("age-up-portrait") }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw { status: r.status };
            if (typeof data.hallPasses === "number") applyHallPassBalance(data.hallPasses, data.entitlements, data.characterSlots);
            await fetchSession();
            if (sheetOverlayOpen) renderSheet();
            const gradeName = data.grade ? (GRADE_LABELS[data.grade] || data.grade) : "the next year";
            showCongrats("Portrait aged up for " + gradeName + ".", true);
          } catch (err) {
            if (btn) { btn.disabled = false; btn.textContent = "✨ Age up portrait"; }
            showCongrats(viewerRequestError("Portrait update", err), false);
          }
        },
      });
    }
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
    return studentPoolCardRenderer.build(pool, playbooks);
  }

  // ── Social card grid (relationship layer) ───────────────────────────────
  // Six classmates × six fortune axes resolve over 4 years. Cells tick
  // up/down per essay; circle at +2; scratch at -3. Resolved axes become
  // superlatives on the diploma. This is the player-facing slice — a
  // compact 2x3 of cells plus the resolved axis lines underneath.
  function buildMashGrid(c, graduated) {
    return mashGridRenderer.build(c, graduated);
  }

  function essayReportsForCard() {
    const reports = lastTelemetry && Array.isArray(lastTelemetry.essay_reports) ? lastTelemetry.essay_reports : [];
    return reports
      .filter((r) => r && typeof r === "object")
      .slice()
      .sort((a, b) => Number(a.gradedAt || 0) - Number(b.gradedAt || 0));
  }
  // essayScoreText, essayLetter are in client-pure.
  function essayResponderName(id) {
    if (!id) return "—";
    if (id === "player") return playerDisplayName();
    return studentNameById(id);
  }
  // clipEssayText is in client-pure.
  function essayRivalryText(recent) {
    if (!recent.length) return "No response results yet.";
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
      return essayResponderName(rivalId) + " led " + rivalCount + " of the last " + recent.length + " response builds.";
    }
    if (playerWins > 0) {
      return "You held the top response build " + playerWins + " of the last " + recent.length + ".";
    }
    return "No classroom winner recorded yet.";
  }
  function buildReportEntry(report) {
    return reportCardRenderer.buildEntry(report);
  }
  function buildReportCard() {
    return reportCardRenderer.buildCard(essayReportsForCard());
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
    const subjects = subjectClearSummary();
    const gradeLine = subjects.grades
      .map((g) => letterGradePasses(g.grade) ? g.grade : subjectProgressShortLabel(g.progress))
      .join(" ");
    const metrics = [];
    if (graduated) {
      metrics.push({ label: "status", value: "graduated", detail: "all four years complete", met: true });
      metrics.push({ label: "yearbook", value: yearbookCount + "/4", detail: "years saved", met: yearbookCount >= 4 });
    } else {
      metrics.push({ label: "today", value: todaySummary.value, detail: activeSubject + " · " + todaySummary.detail, met: todaySummary.met });
    }
    const tokens = graduated
      ? null
      : buildCareerTokens({
        streakHere,
        streakReq,
        streakLastDate,
        todayKey,
        advantageRemaining: budget.remaining,
        advantageCap: budget.cap,
      });

    const ceremonyReady = !!(t.graduation_ready || c.pendingGraduation);
    const ceremony = ceremonyReady ? buildGraduationCeremony(c, grade, {}) : null;
    const nextStep = ceremonyReady ? "" : buildNextStepHint(c);
    const mash = buildMashGrid(c, graduated);
    return careerCardRenderer.buildSchoolCard({
      graduated,
      roleLabel: graduated ? "graduated" : gradeLabel,
      subtitle: graduated ? "Arc complete" : gradeLabel + " · " + gradeLine,
      metrics,
      tokens,
      ceremony,
      nextStep,
      progression: buildProgressionForCharacter(c),
      mash,
    });
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

  function comicUnlockEventsForTelemetry(t) {
    const events = t && Array.isArray(t.school_events) ? t.school_events : [];
    return events.filter((event) => event && event.kind === "comic.page-unlocked" && event.id);
  }

  function comicUnlockFromEvent(event) {
    if (!event) return null;
    const pageNumber = Math.floor(Number(event.pageNumber || 0));
    if (!Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > FIRST_BELL_PAGE_COUNT) return null;
    return {
      issueId: event.issueId || "first-bell",
      pageId: event.pageId || "first-bell-page-" + String(pageNumber).padStart(2, "0"),
      pageNumber,
      unlockedAt: Number(event.at || Date.now()),
      reason: event.reason || "legacy",
      sourceId: event.sourceId || "",
      label: event.label || comicPageTitle(pageNumber),
    };
  }

  function maybeShowNextComicUnlockModal() {
    if (comicUnlockModalOpen || pendingComicUnlocks.length === 0) return;
    const unlock = pendingComicUnlocks.shift();
    if (!unlock) return;
    const collection = comicCollectionForTelemetry() || {
      issueId: "first-bell",
      title: "Ruby High: Book One - First Bell",
      pageCount: FIRST_BELL_PAGE_COUNT,
      unlockedPages: [unlock],
    };
    comicUnlockModalOpen = true;
    showComicReader(collection, unlock, {
      reward: true,
      onClose: () => {
        comicUnlockModalOpen = false;
        maybeShowNextComicUnlockModal();
      },
    });
  }

  function syncComicUnlockModals(t) {
    const events = comicUnlockEventsForTelemetry(t);
    if (!comicUnlockEventsPrimed) {
      events.forEach((event) => seenComicUnlockEventIds.add(event.id));
      comicUnlockEventsPrimed = true;
      return;
    }
    for (const event of events) {
      if (seenComicUnlockEventIds.has(event.id)) continue;
      seenComicUnlockEventIds.add(event.id);
      const unlock = comicUnlockFromEvent(event);
      if (unlock) pendingComicUnlocks.push(unlock);
    }
    maybeShowNextComicUnlockModal();
  }

  function firstBellReportKey(report) {
    if (!report) return "";
    return String(report.reportId || report.questionId || report.awardedAt || "unknown")
      .replace(/[^a-zA-Z0-9:._-]/g, "_");
  }

  function firstBellReportSeenKey(report) {
    return "ruby-high:first-bell-report-seen:" + firstBellReportKey(report);
  }

  function hasSeenFirstBellReport(report) {
    return !!report && storageGet("local", firstBellReportSeenKey(report)) === "1";
  }

  function markFirstBellReportSeen(report) {
    if (report) storageSet("local", firstBellReportSeenKey(report), "1");
  }

  function firstBellGradeLabel(grade) {
    if (!grade) return "";
    if (typeof GRADE_LABELS !== "undefined" && GRADE_LABELS[grade]) return GRADE_LABELS[grade];
    return "Grade " + grade;
  }

  function firstBellPortraitUrl(character) {
    const portrait = character && typeof character.portraitDataUrl === "string"
      ? character.portraitDataUrl.trim()
      : "";
    if (portrait) return portrait;
    return defaultPortraitFor(character && character.playbookId);
  }

  function appendFirstBellFact(list, label, value, emphatic) {
    if (!list || value == null || value === "") return;
    const row = document.createElement("div");
    row.className = "first-bell-fact" + (emphatic ? " is-emphatic" : "");
    const key = document.createElement("span");
    key.className = "first-bell-fact-key";
    key.textContent = label;
    const val = document.createElement("span");
    val.className = "first-bell-fact-value";
    val.textContent = String(value);
    row.append(key, val);
    list.appendChild(row);
  }

  function closeFirstBellReportModal(overlay, onKeyDown, previousFocus) {
    if (!overlay || !overlay.parentNode) return;
    if (onKeyDown) overlay.removeEventListener("keydown", onKeyDown);
    overlay.parentNode.removeChild(overlay);
    unlockViewerModalBackground();
    restoreModalFocus(previousFocus, els.nextBtn);
    firstBellReportModalOpen = false;
  }

  function showFirstBellReport(report, character, share) {
    if (!report || firstBellReportModalOpen) return;
    firstBellReportModalOpen = true;
    const previousFocus = document.activeElement && typeof document.activeElement.focus === "function"
      ? document.activeElement
      : null;

    const overlay = document.createElement("div");
    overlay.className = "first-bell-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "first-bell-title");

    const card = document.createElement("section");
    card.className = "first-bell-card";
    card.tabIndex = -1;

    const hero = document.createElement("div");
    hero.className = "first-bell-hero";

    const portraitWrap = document.createElement("div");
    portraitWrap.className = "first-bell-portrait";
    const img = document.createElement("img");
    img.src = firstBellPortraitUrl(character);
    img.alt = "";
    portraitWrap.appendChild(img);

    const titleBlock = document.createElement("div");
    titleBlock.className = "first-bell-title";
    const kicker = document.createElement("div");
    kicker.className = "first-bell-kicker";
    kicker.textContent = "First Bell";
    const title = document.createElement("h2");
    title.id = "first-bell-title";
    title.textContent = "First Bell Report";
    const meta = document.createElement("p");
    meta.className = "first-bell-meta";
    const metaParts = [
      report.facultyName || report.facultyId || "Ruby High",
      firstBellGradeLabel(report.grade),
      report.wasCorrect ? "Correct" : "Needs more work",
    ].filter(Boolean);
    meta.textContent = metaParts.join(" / ");
    titleBlock.append(kicker, title, meta);
    hero.append(portraitWrap, titleBlock);

    const body = document.createElement("div");
    body.className = "first-bell-body";

    const prompt = document.createElement("blockquote");
    prompt.className = "first-bell-prompt";
    prompt.textContent = report.prompt || "First question answered.";

    const facts = document.createElement("div");
    facts.className = "first-bell-facts";
    appendFirstBellFact(facts, "Answer", report.answerText, true);
    if (!report.wasCorrect && report.correctAnswerText) {
      appendFirstBellFact(facts, "Correct", report.correctAnswerText, false);
    }
    if (Number.isFinite(Number(report.score))) {
      appendFirstBellFact(facts, "Score", String(report.score), false);
    }

    body.append(prompt, facts);
    if (report.encouragement) {
      const note = document.createElement("p");
      note.className = "first-bell-note";
      note.textContent = report.encouragement;
      body.appendChild(note);
    }

    const actions = document.createElement("div");
    actions.className = "first-bell-actions";
    const secondary = document.createElement("button");
    secondary.type = "button";
    secondary.className = "secondary";
    secondary.textContent = "Open student card";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "secondary";
    copy.textContent = "Copy link";
    copy.title = "Copy First Bell report link";
    const primary = document.createElement("button");
    primary.type = "button";
    primary.className = "primary";
    primary.textContent = "Continue";
    actions.append(secondary);
    const shareId = share && share.shareId ? String(share.shareId) : "";
    const shareUrl = share && share.url ? absoluteViewerUrl(share.url) : "";
    if (shareId && shareUrl) actions.appendChild(copy);
    actions.appendChild(primary);

    let onKeyDown = null;
    const close = () => closeFirstBellReportModal(overlay, onKeyDown, previousFocus);
    onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      trapModalFocus(event, overlay);
    };
    overlay.addEventListener("keydown", onKeyDown);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    primary.addEventListener("click", close);
    secondary.addEventListener("click", () => {
      close();
      openSheet();
    });
    copy.addEventListener("click", async () => {
      const original = copy.textContent || "Copy link";
      try {
        await copyTextToClipboard(shareUrl);
        const payload = {
          shareId: shareId,
          destination: "copy",
          kind: "first_bell_report",
          ...(share && share.grade ? { grade: String(share.grade) } : {}),
        };
        postViewerMetricEvent("share_initiated", payload);
        copy.textContent = "Copied";
      } catch (_err) {
        copy.textContent = "Failed";
      } finally {
        setTimeout(() => { copy.textContent = original; }, 1200);
      }
    });

    card.append(hero, body, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    focusWithoutScroll(primary);
    lockViewerModalBackground();
  }

  function syncFirstBellReportModal(t) {
    const report = t && t.first_bell_report;
    if (
      !report
      || firstBellReportModalOpen
      || (announcementsOverlay && !announcementsOverlay.hidden)
      || hasSeenFirstBellReport(report)
    ) return;
    markFirstBellReportSeen(report);
    showFirstBellReport(report, t.character, t.first_bell_share);
  }

  function showComicReader(collection, unlock, options) {
    comicReaderRenderer.show(collection, unlock, options);
  }

  function buildYearbookArchive(entries, liveChar, livePb, playbooks) {
    return yearbookArchiveRenderer.buildArchive(entries, liveChar, livePb, playbooks);
  }

  function buildYearbookArchiveEntry(entry, liveChar, livePb, playbooks) {
    return yearbookArchiveRenderer.buildEntry(entry, liveChar, livePb, playbooks);
  }

  function buildDiplomaCollectible(diploma) {
    return yearbookArchiveRenderer.buildDiploma(diploma);
  }

  function buildGraduationPhotoCollectible(photo) {
    return yearbookArchiveRenderer.buildGraduationPhoto(photo);
  }

  function buildGraduationPhotoAction(photo, entry) {
    const grade = String((photo && photo.grade) || (entry && entry.grade) || "");
    if (!grade) return null;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "paper-archive-photo-action";
    btn.textContent = "Take photo";
    btn.title = "Take graduation photo";
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      if (!(await confirmHostedCreditSpend("Take graduation photo", "portrait"))) return;
      const photoEntitlement = hostedImageEntitlement("portrait") || {};
      const photoCost = photoEntitlement.cost || 1;
      if (usingHostedImageGeneration("portrait") && !canSpendHallPasses(photoCost)) return;
      btn.disabled = true;
      btn.textContent = "Taking…";
      try {
        const r = await apiFetch("/api/apps/ruby-high/chat/character/graduation-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grade,
            requestId: imageRequestId("graduation-photo-" + grade),
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw { status: r.status };
        if (typeof data.hallPasses === "number") applyHallPassBalance(data.hallPasses, data.entitlements, data.characterSlots);
        await fetchSession();
        if (sheetOverlayOpen) renderSheet();
        showCongrats("Graduation photo added to the yearbook.", true);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Try again";
        showCongrats(viewerRequestError("Graduation photo", err), false);
      }
    });
    return btn;
  }


  function buildYearbookShareActions(share) {
    return yearbookShareActionsRenderer.build(share);
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
    return paperCardRenderer.build(entry, liveChar, livePb, playbooks);
  }

  // formatSealedDate, fmtStat are in client-pure.

  // ── default-pack portraits ──────────────────────────────────────────────
  // Every playbook owns one of the six unused student portraits in
  // assets/students/. The player picks a portrait by playbook before
  // ever paying for AI gen. If they upgrade ("✨ Generate AI portrait")
  // and it succeeds, that data URL replaces the default in the autosaved
  // character. If they don't, the default ships with the character and the
  // post-acceptance "background portrait gen" path is gone entirely - what
  // you saw at creation is what you get.
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
    return apiBase + "/assets/optimized/students/" + encodeURIComponent(studentId) + "-full.webp?v=thumbs-20260830";
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
      || portrait.endsWith("/assets/students/" + defaultId + "-full.png")
      || portrait.indexOf("/assets/optimized/students/" + defaultId + "-full.webp") !== -1;
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

    const { explanation } = creationIntroRenderer.renderInto(sheetCard);

    // Creation is a plain setup page. The old collectible-card styling is
    // kept only in the shared renderer classes so existing presentation code
    // can still update the same references.
    const candidateCardRefs = creationCandidateCardRenderer.build();
    const candidateCard = candidateCardRefs.card;
    const candidateBody = candidateCardRefs.body;
    const candidateRole = candidateCardRefs.role;
    const portraitImg = candidateCardRefs.portraitImg;
    const candidateName = candidateCardRefs.name;
    const candidateSubtitle = candidateCardRefs.subtitle;
    const candidateStats = candidateCardRefs.stats;
    const candidateQuote = candidateCardRefs.quote;
    const candidateMoveTitle = candidateCardRefs.moveTitle;
    const candidateMoveContent = candidateCardRefs.moveContent;
    const portraitStatus = candidateCardRefs.portraitStatus;
    const portraitBtn = candidateCardRefs.portraitBtn;
    const customizeBtn = candidateCardRefs.customizeBtn;
    const saveBtn = candidateCardRefs.saveBtn;

    const controlsSubtitle = "Stats, voice, rerolls, and custom portraits are optional. You can start class without changing them.";
    const controlsCardRefs = creationControlCardRenderer.build({
      subtitle: controlsSubtitle,
    });
    const controlsCard = controlsCardRefs.card;
    const fields = controlsCardRefs.fields;
    const rollBtn = controlsCardRefs.rollBtn;
    const doneBtn = controlsCardRefs.doneBtn;
    const status = controlsCardRefs.status;

    // Control rows: one per component. Each row has a reroll button that
    // re-fires /chat/character/generate with regen=[<field>], keep=<rest>.
    function makeRow(label, key) {
      return creationRowsRenderer.buildRow(fields, label, key);
    }
    const nameRow = makeRow("Name", "name");
    const playbookRow = makeRow("Style", "playbook");
    const statsRow = makeRow("Stats", "stats");
    const personalityRow = makeRow("Voice", "personality");
    const quoteRow = makeRow("Quote", "flavorQuote");

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "creation-edit-input";
    nameInput.maxLength = 48;
    nameInput.autocomplete = "nickname";
    nameInput.setAttribute("aria-label", "Student name");
    nameInput.placeholder = "Student name";
    nameRow.val.replaceChildren(nameInput);
    nameRow.input = nameInput;

    const playbookSelect = document.createElement("select");
    playbookSelect.className = "creation-edit-input creation-playbook-select";
    playbookSelect.setAttribute("aria-label", "Student style");
    playbooks.forEach((playbook) => {
      const option = document.createElement("option");
      option.value = playbook.id;
      option.textContent = playbook.name || playbook.id;
      playbookSelect.appendChild(option);
    });
    playbookRow.val.replaceChildren(playbookSelect);
    playbookRow.select = playbookSelect;

    const quickFields = document.createElement("div");
    quickFields.className = "creation-quick-fields";
    quickFields.appendChild(nameRow.row);
    quickFields.appendChild(playbookRow.row);
    candidateBody.insertBefore(quickFields, candidateCardRefs.hint);

    // Keep the default decision small. Detailed character data is still
    // available, but only after the player asks for it.
    candidateStats.hidden = true;
    candidateQuote.hidden = true;
    const candidateMove = candidateMoveTitle.parentElement;
    if (candidateMove) candidateMove.hidden = true;
    controlsCard.id = "creation-more-options";
    controlsCard.hidden = true;
    customizeBtn.textContent = "Advanced";
    customizeBtn.setAttribute("aria-controls", controlsCard.id);
    customizeBtn.setAttribute("aria-expanded", "false");
    const controlActions = doneBtn.parentElement;
    if (controlActions) controlActions.insertBefore(portraitBtn, doneBtn);
    const controlBody = controlsCard.querySelector(".ccg-body");
    if (controlBody) controlBody.insertBefore(portraitStatus, status);
    candidateBody.insertBefore(status, candidateStats);

    let creatorRendered = false;

    // Reveal the form (and hide the loading state) once the first
    // roll lands. Subsequent component-rerolls don't re-trigger this.
    function revealForm() {
      if (creatorRendered) return;
      creatorRendered = true;
      sheetCard.classList.remove("is-card-deck-sheet");
      sheetCard.classList.remove("is-two-card-deck");
      sheetCard.classList.add("is-creation-sheet");
      sheetCard.innerHTML = "";
      explanation.classList.add("is-persistent");
      const creator = document.createElement("div");
      creator.className = "creation-single";
      creator.appendChild(candidateCard);
      creator.appendChild(controlsCard);
      sheetCard.appendChild(explanation);
      sheetCard.appendChild(creator);
    }

    let rolled = null;
    // Per-component in-flight flags so the user can mash multiple rerolls
    // and the buttons disable independently. Module-scope portraitInFlight
    // is gone in this PR.
    const inFlight = { all: false, name: false, personality: false, arcAnswer: false, flavorQuote: false, stats: false, playbook: false, portrait: false, saving: false };
    let aiPortraitDataUrl = null; // when set, replaces the default at save-time
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
      overachiever: "I want proof that being excellent is not the same as being safe.",
      slacker: "I want to stop pretending I do not care before I disappoint someone who does.",
      heart: "I want to learn how to help without carrying the whole room by myself.",
      outsider: "I want to find the hidden pattern without becoming part of it.",
      "class-clown": "I want to see what happens when I finish a thought without turning it into a joke.",
      lifer: "I want to know this place well enough to make it better without letting it own me.",
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
      const arcAnswer = regen.has("arcAnswer") || regen.has("playbook") || !prev.arcAnswer
        ? (OFFLINE_ARCS[pb.id] || "I want to figure out what kind of student this place makes me.")
        : prev.arcAnswer;
      const flavorQuote = regen.has("flavorQuote") || !prev.flavorQuote ? pickRandom(OFFLINE_QUOTES) : prev.flavorQuote;
      return { name, playbookId: pb.id, stats, personality, arcAnswer, flavorQuote };
    }

    function setStatus(text, invalid) {
      status.textContent = text || "";
      status.classList.toggle("is-invalid", !!invalid);
    }
    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    function isTransientRollStatus(statusCode) {
      return statusCode === 408 || statusCode === 502 || statusCode === 503 || statusCode === 504;
    }
    async function fetchCharacterRoll(body, retryTransient) {
      const waits = retryTransient ? [0, 650] : [0];
      for (let attempt = 0; attempt < waits.length; attempt += 1) {
        if (waits[attempt] > 0) {
          setStatus("Ruby is trying again after a connection problem...");
          await sleep(waits[attempt]);
        }
        const r = await apiFetch("/api/apps/ruby-high/chat/character/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          timeoutMs: 6000,
          body: JSON.stringify(body),
        });
        if (r.ok) return await r.json();
        if (!isTransientRollStatus(r.status) || attempt === waits.length - 1) {
          throw { status: r.status };
        }
      }
    }
    function applyDisabled() {
      rollBtn.disabled = inFlight.all || inFlight.saving;
      rollBtn.textContent = inFlight.all
        ? "Creating..."
        : rolled
          ? aiEnabled
            ? "AI remix student"
            : "Try another student"
          : "Make a student";
      saveBtn.hidden = !rolled;
      saveBtn.disabled = !rolled || !String(rolled.name || "").trim() || inFlight.all || inFlight.saving;
      nameInput.disabled = !rolled || inFlight.all || inFlight.saving || inFlight.name;
      playbookSelect.disabled = !rolled || inFlight.all || inFlight.saving || inFlight.playbook;
      customizeBtn.disabled = !rolled || inFlight.all || inFlight.saving;
      doneBtn.disabled = !rolled || inFlight.all || inFlight.saving;
      [nameRow, playbookRow, statsRow, personalityRow, quoteRow].forEach(({ reroll }) => {
        const k = reroll.dataset.key;
        reroll.disabled = !rolled || inFlight.all || inFlight.saving || !!inFlight[k];
      });
      const portraitHallPassNeeded = hostedPortraitHallPassNeeded();
      const portraitReason = portraitGenerationStatusReason();
      portraitBtn.hidden = !portraitGenerationVisible();
      portraitBtn.disabled = !rolled || inFlight.portrait || inFlight.saving || (!!portraitReason && !portraitHallPassNeeded);
      portraitBtn.title = portraitReason || "";
    }

    function portraitGenerationVisible() {
      const entitlement = hostedImageEntitlement("portrait");
      return !!getStoredApiKey() || !!(entitlement && entitlement.configured);
    }

    function hostedPortraitHallPassNeeded() {
      if (getStoredApiKey()) return false;
      const entitlement = hostedImageEntitlement("portrait");
      if (!entitlement || !entitlement.configured) return false;
      if (characterSlotTelemetry().photoDayCredits > 0) return false;
      const cost = Math.max(1, Math.floor(Number(entitlement.cost || 1)));
      return !canSpendHallPasses(cost);
    }

    function portraitGenerationStatusReason() {
      if (getStoredApiKey()) return "";
      const entitlement = hostedImageEntitlement("portrait");
      if (entitlement && entitlement.configured) {
        return "";
      }
      return "Use an AI key for a custom portrait.";
    }

    function renderRolled(c) {
      creationRollPresenter.renderRolled(c, playbooks, {
        card: candidateCard,
        role: candidateRole,
        portraitImg,
        name: candidateName,
        subtitle: candidateSubtitle,
        stats: candidateStats,
        quote: candidateQuote,
        moveTitle: candidateMoveTitle,
        moveContent: candidateMoveContent,
      }, {
        nameRow,
        playbookRow,
        statsRow,
        personalityRow,
        quoteRow,
      }, !!aiPortraitDataUrl);
      postOnboardingFunnelStep("onboarding_candidate_ready");
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
      setStatus(isFullRoll ? "Creating…" : "Trying another " + components.join(", ") + "…");
      try {
        // If the player reroll-cycles the playbook OR the name AFTER
        // generating an AI portrait, the AI image no longer matches —
        // drop it so the default takes over. The player can re-fire ✨
        // if they want a new AI portrait against the new identity.
        if (isFullRoll || (!isFullRoll && (components.includes("playbook") || components.includes("name")))) {
          aiPortraitDataUrl = null;
        }
        // The first candidate is deliberately local and immediate. AI is an
        // optional remix, never a dependency between landing and class.
        if ((isFullRoll && !rolled) || !aiEnabled) {
          rolled = offlineCharacterRoll(components);
          renderRolled(rolled);
          revealForm();
          setStatus("Your student is ready.");
          return;
        }
        const body = isFullRoll
          ? {}
          : { regen: components, keep: rolled || {} };
        const data = await fetchCharacterRoll(body, true);
        rolled = data.character;
        renderRolled(rolled);
        // First roll lands → swap from loading-state to form.
        revealForm();
        setStatus("");
      } catch (err) {
        // A creator should always create. If optional AI is slow or
        // unavailable, complete the requested reroll locally instead of
        // leaving an empty or stuck sheet.
        rolled = offlineCharacterRoll(components);
        renderRolled(rolled);
        revealForm();
        setStatus(studentRemixFallbackMessage(err));
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

    rollBtn.addEventListener("click", () => {
      if (inFlight.all || inFlight.saving) return;
      void rollComponents();
    });

    nameInput.addEventListener("input", () => {
      if (!rolled) return;
      rolled = { ...rolled, name: nameInput.value };
      candidateName.textContent = nameInput.value.trim() || "Your student";
      if (aiPortraitDataUrl) {
        aiPortraitDataUrl = null;
        portraitImg.src = defaultPortraitFor(rolled.playbookId);
        portraitStatus.textContent = "Name changed — using the included portrait.";
      }
      applyDisabled();
    });

    playbookSelect.addEventListener("change", () => {
      if (!rolled) return;
      const playbook = playbooks.find((entry) => entry.id === playbookSelect.value);
      if (!playbook) return;
      rolled = {
        ...rolled,
        playbookId: playbook.id,
        arcAnswer: OFFLINE_ARCS[playbook.id] || "I want to figure out what kind of student this place makes me.",
      };
      aiPortraitDataUrl = null;
      renderRolled(rolled);
      portraitStatus.textContent = "Student style changed — using the included portrait.";
      applyDisabled();
    });

    function setMoreOptionsOpen(open) {
      controlsCard.hidden = !open;
      customizeBtn.textContent = open ? "Hide advanced" : "Advanced";
      customizeBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        setTimeout(() => focusWithoutScroll(statsRow.reroll), 0);
      } else {
        setTimeout(() => focusWithoutScroll(customizeBtn), 0);
      }
    }
    customizeBtn.addEventListener("click", () => setMoreOptionsOpen(controlsCard.hidden));
    doneBtn.addEventListener("click", () => setMoreOptionsOpen(false));

    // ✨ Generate AI portrait — fires /chat/character/portrait. On
    // success, replaces the default img and stashes the data URL so it
    // ships with the create-character command. On failure, leaves the
    // default in place and shows an inline error.
    portraitBtn.addEventListener("click", async () => {
      if (hostedPortraitHallPassNeeded()) {
        const entitlement = hostedImageEntitlement("portrait") || {};
        const cost = Math.max(1, Math.floor(Number(entitlement.cost || 1)));
        await promptForHallPasses({
          title: "Hall Pass needed",
          copy: "A custom student portrait needs " + hallPassCostLabel(cost) + ". Claim your free starter Hall Passes or add more.",
          detail: "Creating your student stays free.",
        });
        return;
      }
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
      if (!(await confirmHostedCreditSpend("Custom student portrait", "portrait", usePhotoDayCredit))) return;
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
          throw { status: r.status };
        }
        const data = await r.json();
        if (!data || !data.portraitDataUrl) throw new Error("no image returned");
        aiPortraitDataUrl = data.portraitDataUrl;
        portraitImg.src = aiPortraitDataUrl;
        if (typeof data.hallPasses === "number") applyHallPassBalance(data.hallPasses, data.entitlements, data.characterSlots);
        portraitBtn.textContent = "✨ Try again";
        portraitStatus.textContent = "AI portrait ready.";
      } catch (err) {
        portraitStatus.textContent = viewerRequestError("Portrait generation", err) + " You can start class with your current portrait.";
        portraitStatus.classList.add("is-invalid");
        portraitBtn.textContent = "✨ Generate AI portrait";
      } finally {
        inFlight.portrait = false;
        applyDisabled();
      }
    });

    function currentCharacterSnapshot() {
      if (!rolled) return null;
      const portraitUrl = aiPortraitDataUrl || defaultPortraitFor(rolled.playbookId);
      return {
        name: String(rolled.name || "").trim(),
        playbookId: rolled.playbookId,
        stats: { ...rolled.stats },
        arcAnswer: rolled.arcAnswer || "",
        flavorQuote: rolled.flavorQuote,
        personality: rolled.personality || "",
        portraitDataUrl: portraitUrl,
      };
    }

    function finishCharacterEnrollment() {
      closeSheet();
      setTimeout(() => {
        if (lastTelemetry && shouldAutoStartClass(lastTelemetry)) void pickNext();
      }, 0);
    }

    function reportCharacterEnrollmentFailure(error) {
      const failureKind = error && typeof error.kind === "string"
        ? error.kind
        : "missing_response";
      postViewerMetricEvent("onboarding_enrollment_failed", {
        failureKind: failureKind,
        ...(error && Number.isFinite(Number(error.status)) ? { statusCode: Number(error.status) } : {}),
      });
      const message = failureKind === "timeout"
        ? "Saving took too long. Your student is still here — tap Start first class to try again."
        : failureKind === "network"
          ? "Saving lost its connection. Your student is still here — reconnect and try again."
          : "Could not start Grade 9. Your student is still here — try again.";
      setStatus(message, true);
    }

    async function beginClassFromCharacter() {
      if (!rolled || inFlight.all || inFlight.saving) return;
      const snapshot = currentCharacterSnapshot();
      if (!snapshot) return;
      inFlight.saving = true;
      postOnboardingFunnelStep("onboarding_enrollment_started");
      applyDisabled();
      setStatus("Saving your student...");
      try {
        const data = await command({
          type: "create-character",
          startFirstBell: true,
          ...snapshot,
        });
        if (!data || !data.session) {
          const commandError = apiClient.lastCommandError();
          setStatus("Checking your student...");
          await fetchSession({ timeoutMs: SESSION_REFRESH_TIMEOUT_MS });
          if (lastTelemetry && lastTelemetry.character) {
            finishCharacterEnrollment();
            return;
          }
          reportCharacterEnrollmentFailure(commandError);
          return;
        }
        finishCharacterEnrollment();
      } finally {
        inFlight.saving = false;
        if (sheetOverlayOpen) applyDisabled();
      }
    }

    saveBtn.addEventListener("click", () => { void beginClassFromCharacter(); });

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
    { id: "roko", name: "Roko", subject: "AI Alignment", description: "Calm, causal, and focused on the incentives hiding inside frightening stories.", quote: "Name the objective. Then name what it eats." },
  ];
  const teacherRollControlsRenderer = createTeacherRollControlsRenderer({
    document,
    assets: PREGENERATED_TEACHER_ASSETS,
  });
  const teacherCreationDeckRenderer = createTeacherCreationDeckRenderer({
    document,
    buildCharacterCard,
  });
  const teacherPreviewUpdater = createTeacherPreviewUpdater({
    renderMarkdownInto,
  });
  const teacherStatPillsRenderer = createTeacherStatPillsRenderer({
    document,
    statLabel,
    fmtStat,
  });
  const TEACHER_ROLL_NAMES = ["Ruby", "Sally Science", "Professor Edward", "Roko", "Mara Vale", "Dr. Mina Quill", "Theo Signal", "Cass Vector", "Nico Frame"];
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
    { pct: 18, title: "Saving draft", detail: "Saving the course." },
    { pct: 42, title: "Preparing materials", detail: "Checking markdown and size limits." },
    { pct: 68, title: "Writing questions", detail: "Building the teacher's question set." },
    { pct: 88, title: "Updating library", detail: "Refreshing your courses." },
  ];
  const COURSE_GENERATION_STEPS = [
    { key: "materials", pct: 12, label: "Read course materials" },
    { key: "teacher", pct: 34, label: "Create teacher name and voice" },
    { key: "portrait", pct: 58, label: "Generate teacher portrait" },
    { key: "questions", pct: 78, label: "Write class questions" },
    { key: "saving", pct: 94, label: "Save the course" },
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
        body: JSON.stringify(Object.assign({ name: "Untitled Course" }, payload || {})),
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

  function closePackStore() {
    if (packImportBusy) {
      packStatusEl.textContent = "Finish this library update before closing.";
      packStatusEl.classList.remove("is-invalid");
      return;
    }
    closeViewerModal(packEl);
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
    openViewerModal(packEditEl, {
      onRequestClose: closePackEditor,
      initialFocus: packEditCloseBtn,
    });
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
    closeViewerModal(packEditEl);
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
    packStatusEl.textContent = "Keep this window open while Ruby High adds the teacher.";
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
      ? "This week's automatic guest is " + (active.name || "Guest teacher") + "."
      : "Use Ruby High's weekly automatic guest teacher.";
  }

  function renderPackSearchList() {
    if (!packSearchListEl) return;
    const packs = packSearchState && Array.isArray(packSearchState.packs) ? packSearchState.packs : [];
    packSearchListEl.innerHTML = "";
    if (!packSearchState.searched) {
      packSearchListEl.innerHTML = '<div class="sub">Search or press Search to browse public courses.</div>';
      return;
    }
    if (packs.length === 0) {
      packSearchListEl.innerHTML = '<div class="sub">No public courses are available yet.</div>';
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
      packDraftListEl.innerHTML = '<div class="sub">No draft courses yet.</div>';
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
    const view = packLibraryCardView(pack, { draft: isDraft, search: isSearch, busy: packImportBusy });
    card.className = view.className;
    if (view.interactive) {
      card.setAttribute("role", "button");
      card.tabIndex = view.tabIndex;
      card.setAttribute("aria-label", view.ariaLabel);
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
    name.textContent = view.name;
    const desc = document.createElement("div");
    desc.className = "pack-card-desc";
    desc.textContent = view.description;
    titleWrap.appendChild(name);
    titleWrap.appendChild(desc);
    head.appendChild(titleWrap);
    card.appendChild(head);

    const meta = document.createElement("div");
    meta.className = "pack-card-meta";
    view.chips.forEach((text) => {
      const chip = document.createElement("span");
      chip.className = "pack-chip";
      chip.textContent = text;
      meta.appendChild(chip);
    });
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "pack-card-actions";
    if (view.stateText) {
      const state = document.createElement("div");
      state.className = "pack-row-state";
      state.textContent = view.stateText;
      actions.appendChild(state);
    }

    view.actions.forEach((action) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = action.className;
      btn.textContent = action.text;
      btn.disabled = action.disabled;
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (action.kind === "search-primary" && pack.installed) {
          activateLibraryPack(pack);
          return;
        }
        if (action.kind === "search-primary") {
          installCreatorPack(pack);
          return;
        }
        if (action.kind === "edit") {
          if (isDraft) editDraftPack(pack.id);
          else editPublishedPack(pack);
          return;
        }
        if (action.kind === "uninstall") {
          uninstallLibraryPack(pack);
          return;
        }
        if (action.kind === "delete") {
          deleteLibraryPack(pack, { draft: isDraft });
        }
      });
      actions.appendChild(btn);
    });
    card.appendChild(actions);
    return card;
  }

  async function deleteLibraryPack(pack, opts) {
    if (!pack || packImportBusy) return;
    const name = pack.name || "Untitled Course";
    const kind = opts && opts.draft ? "draft course" : "course";
    if (!(await confirmInApp({
      kicker: "Delete " + kind,
      title: "Delete " + name + "?",
      copy: "This removes the " + kind + " from your library.",
      confirmText: "Delete",
      tone: "danger",
    }))) return;
    setPackBusy(true);
    packStatusEl.textContent = "Deleting course...";
    packStatusEl.classList.remove("is-invalid");
    try {
      const deleteResult = opts && opts.draft
        ? await packStudioClient.deleteDraftPack(pack.id)
        : await packStudioClient.deletePublishedPack(pack.id);
      applyPackDeletionResult(pack, opts, deleteResult);
      renderPackList();
      renderDraftPackList();
      packStatusEl.textContent = "Course deleted.";
    } catch (err) {
      packStatusEl.textContent = "Could not delete course · " + (err && err.message ? err.message : "error");
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
    const name = pack.name || "Untitled Course";
    if (!(await confirmInApp({
      kicker: "Remove course",
      title: "Uninstall " + name + "?",
      copy: "You can install it again from search or keep editing it if you own it.",
      confirmText: "Uninstall",
    }))) return;
    setPackBusy(true);
    packStatusEl.textContent = "Removing course...";
    packStatusEl.classList.remove("is-invalid");
    try {
      packLibraryState = await packStudioClient.uninstallPack(pack.id);
      renderPackList();
      renderDraftPackList();
      await refreshPackSearchResults();
      packStatusEl.textContent = "Course removed.";
      await fetchSession();
    } catch (err) {
      packStatusEl.textContent = "Could not remove course · " + (err && err.message ? err.message : "error");
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
    packSearchListEl.innerHTML = '<div class="sub">' + (query ? "Searching public courses..." : "Loading public courses...") + '</div>';
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
      packStatusEl.textContent = "Could not search courses · " + (err && err.message ? err.message : "error");
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
    packStatusEl.textContent = "Adding course...";
    packStatusEl.classList.remove("is-invalid");
    try {
      packLibraryState = await packStudioClient.installPack(pack.id, true);
      syncGuestAutoButton();
      renderPackList();
      renderDraftPackList();
      await refreshPackSearchResults();
      packStatusEl.textContent = "Course added.";
    } catch (err) {
      packStatusEl.textContent = "Could not add course · " + (err && err.message ? err.message : "error");
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
    return assetId === "sally-science" ? "#4cb555" : assetId === "professor-edward" ? "#5865f2" : assetId === "roko" ? "#a35c35" : "#d22a2a";
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
      name: "Untitled Course",
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
      name: currentDraft && currentDraft.name ? currentDraft.name : "Untitled Course",
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
    return teacherStatPillsRenderer.build(stats);
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
    teacherPreviewUpdater.refresh(packTeacherDetailEl, pendingTeacherRoll);
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
    const roll = pendingTeacherRoll || rollTeacherCandidate();
    return teacherRollControlsRenderer.build({
      roll,
      importBusy: packImportBusy,
      imageBusy: pendingTeacherImageBusy,
      imageStatus: pendingTeacherImageStatus,
      imageInvalid: pendingTeacherImageInvalid,
      imageReason: teacherImageGenerationStatusReason(),
      imageCreditHint: teacherImageCreditHint(),
      statsNode: buildTeacherStatPills(roll.stats),
      onFieldInput: updatePendingTeacherRollField,
      onReroll(key) {
        rollTeacherCandidate([key]);
        renderPackTeacherEditor();
      },
      onChooseImage: chooseTeacherImage,
      onGenerateImage: generateTeacherImageForPendingRoll,
      onCancelImage: cancelTeacherImageGeneration,
    });
  }
  function renderNewTeacherCreation() {
    const roll = pendingTeacherRoll || rollTeacherCandidate();
    const portraitUrl = roll.profileImageUrl || packTeacherAssetUrl(roll.assetTeacherId, "full");
    packTeacherDetailEl.appendChild(teacherCreationDeckRenderer.build({
      roll,
      portraitUrl,
      accent: teacherRollAccent(roll.assetTeacherId),
      importBusy: packImportBusy,
      imageBusy: pendingTeacherImageBusy,
      questionGenerationBusy: packQuestionGenerationBusy,
      controls: buildTeacherRollControls(),
      onSave: savePendingTeacherRoll,
    }));
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
  function renderPackTeacherEditor() {
    if (!packTeacherListEl || !packTeacherDetailEl) return;
    const teachers = currentDraft && Array.isArray(currentDraft.teachers) ? currentDraft.teachers : [];
    if (!packTeacherCreateMode && !selectedPackTeacherId && teachers[0]) selectedPackTeacherId = teachers[0].id;
    if (!packTeacherCreateMode && !teachers.some((teacher) => teacher.id === selectedPackTeacherId)) {
      selectedPackTeacherId = teachers[0] ? teachers[0].id : null;
    }
    packTeacherListEl.innerHTML = "";
    teachers.forEach((teacher) => {
      const avatarUrl = draftTeacherImageUrl(teacher, "face");
      const view = packTeacherRowView(teacher, {
        selected: teacher.id === selectedPackTeacherId,
        busy: packImportBusy,
        avatarUrl,
      });
      const row = document.createElement("div");
      row.className = view.className;
      const select = document.createElement("button");
      select.type = "button";
      select.className = "pack-teacher-select";
      select.disabled = view.selectDisabled;
      const avatar = document.createElement("span");
      avatar.className = "pack-teacher-avatar";
      if (view.avatarUrl) {
        const img = document.createElement("img");
        img.src = view.avatarUrl;
        img.alt = "";
        avatar.appendChild(img);
      } else {
        avatar.textContent = view.avatarText;
      }
      const copy = document.createElement("span");
      copy.className = "pack-teacher-copy";
      const title = document.createElement("span");
      title.className = "pack-teacher-title";
      title.textContent = view.titleText;
      const subtitle = document.createElement("span");
      subtitle.className = "pack-teacher-subtitle";
      subtitle.textContent = view.subtitleText;
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
      edit.disabled = view.editDisabled;
      edit.addEventListener("click", () => editDraftTeacher(teacher.id));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "pack-teacher-row-action danger";
      del.textContent = "Delete";
      del.disabled = view.deleteDisabled;
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
    const view = packTeacherDetailView(selected);
    const head = document.createElement("div");
    head.className = "pack-teacher-detail-head";
    const copy = document.createElement("div");
    const name = document.createElement("div");
    name.className = "pack-teacher-detail-name";
    name.textContent = view.nameText;
    const meta = document.createElement("div");
    meta.className = "pack-teacher-detail-meta";
    meta.textContent = view.metaText;
    copy.appendChild(name);
    copy.appendChild(meta);
    head.appendChild(copy);
    packTeacherDetailEl.appendChild(head);
    if (view.descriptionText) {
      const bio = document.createElement("div");
      bio.className = "pack-teacher-detail-meta";
      bio.textContent = view.descriptionText;
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
        ? "Course portraits need Ruby High image creation."
        : "Use an AI key before generating a course.";
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
    if (!hostedAi || !hostedAi.configured) return "Use an AI key before generating more questions.";
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
    if (packEditTitleEl) packEditTitleEl.textContent = emptyDraft ? "Create Course" : "Edit Course";
    if (packEditSubtitleEl) packEditSubtitleEl.textContent = emptyDraft ? "Add course materials here." : (currentDraft.name || "Draft course");
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
    const view = packQuestionListView(teacher);
    if (view.emptyText) {
      const empty = document.createElement("div");
      empty.className = "sub";
      empty.textContent = view.emptyText;
      teacherQuestionListEl.appendChild(empty);
      return;
    }
    view.rows.forEach((question) => {
      const row = document.createElement("div");
      row.className = "pack-question-row";
      const body = document.createElement("div");
      const prompt = document.createElement("div");
      prompt.className = "pack-question-prompt";
      prompt.textContent = question.promptText;
      const answer = document.createElement("div");
      answer.className = "pack-question-answer";
      answer.textContent = question.detailText;
      body.appendChild(prompt);
      body.appendChild(answer);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "pack-action";
      del.textContent = question.deleteText;
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
      copy: "This removes the teacher and their questions from the draft course.",
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
    if (packEditStatusEl) packEditStatusEl.textContent = "Publishing course...";
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
  function applyPasskeyState(next) {
    if (!next || typeof next !== "object") return;
    passkeyState = {
      available: next.available !== false,
      registered: !!next.registered,
      authenticated: !!next.authenticated,
      recent: !!next.recent,
      recoveryConfigured: !!next.recoveryConfigured,
      credentials: Array.isArray(next.credentials) ? next.credentials.filter((item) => item && typeof item.id === "string") : [],
    };
    renderAccountIdentity();
  }
  let conditionalPasskeyAbortController = null;
  let conditionalPasskeyPromise = null;
  let recoveryCodeForDisplay = "";
  async function abortConditionalPasskey() {
    const pending = conditionalPasskeyPromise;
    if (conditionalPasskeyAbortController) conditionalPasskeyAbortController.abort();
    if (pending) await pending.catch(() => {});
  }
  function passkeySupported() {
    return !!(window.PublicKeyCredential && navigator.credentials);
  }
  function decodePasskeyBase64url(value) {
    const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)).buffer;
  }
  function encodePasskeyBase64url(value) {
    const bytes = new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function passkeyCreationOptions(options) {
    if (typeof PublicKeyCredential.parseCreationOptionsFromJSON === "function") {
      return PublicKeyCredential.parseCreationOptionsFromJSON(options);
    }
    return {
      ...options,
      challenge: decodePasskeyBase64url(options.challenge),
      user: { ...options.user, id: decodePasskeyBase64url(options.user.id) },
      excludeCredentials: (options.excludeCredentials || []).map((item) => ({
        ...item,
        id: decodePasskeyBase64url(item.id),
      })),
    };
  }
  function passkeyRequestOptions(options) {
    if (typeof PublicKeyCredential.parseRequestOptionsFromJSON === "function") {
      return PublicKeyCredential.parseRequestOptionsFromJSON(options);
    }
    return {
      ...options,
      challenge: decodePasskeyBase64url(options.challenge),
      allowCredentials: (options.allowCredentials || []).map((item) => ({
        ...item,
        id: decodePasskeyBase64url(item.id),
      })),
    };
  }
  function passkeyCredentialJson(credential) {
    if (typeof credential.toJSON === "function") return credential.toJSON();
    const response = credential.response;
    const result = {
      id: credential.id,
      rawId: encodePasskeyBase64url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: { clientDataJSON: encodePasskeyBase64url(response.clientDataJSON) },
    };
    if ("attestationObject" in response) {
      result.response.attestationObject = encodePasskeyBase64url(response.attestationObject);
      result.response.transports = typeof response.getTransports === "function" ? response.getTransports() : [];
    } else {
      result.response.authenticatorData = encodePasskeyBase64url(response.authenticatorData);
      result.response.signature = encodePasskeyBase64url(response.signature);
      result.response.userHandle = response.userHandle ? encodePasskeyBase64url(response.userHandle) : undefined;
    }
    return result;
  }
  function friendlyPasskeyError(err) {
    if (err && err.name === "NotAllowedError") return "Passkey check closed or timed out. Try again.";
    if (err && err.name === "InvalidStateError") return "This passkey is already linked to Ruby High.";
    if (err && err.name === "NotSupportedError") return "This browser needs a newer passkey feature. Try Safari, Chrome, or Edge.";
    if (err && err.name === "SecurityError") return "Passkeys need Ruby High to open on its secure web address.";
    return err && err.message ? String(err.message) : "Passkey check failed. Try again.";
  }
  async function passkeyJsonRequest(path, body) {
    const r = await fetch(apiBase + path, {
      method: "POST",
      credentials: "same-origin",
      headers: attachVisitorHeader(new Headers({ "Content-Type": "application/json" })),
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Passkey request failed.");
    return data;
  }
  async function finishPasskeySession(data, message) {
    applyPasskeyState(data.passkey);
    if (data.privy) applyPrivyState({ ...data.privy, ready: true });
    setAuthState(true, {
      ai: !!data.ai,
      local_ai: !!data.local_ai,
      hosted_ai: data.hosted_ai,
      entitlements: data.entitlements,
      passkey: data.passkey,
      privy: data.privy,
    });
    if (data.recoveryCode) showPasskeyRecoveryCode(data.recoveryCode);
    setPrivyStatus(message, false);
    await fetchSession();
    if (sheetOverlayOpen && lastTelemetry?.character) closeSheet();
  }
  async function startPasskeyRegistration() {
    if (!passkeySupported()) {
      setPrivyStatus("This browser needs passkey support. Try Safari, Chrome, or Edge.", true);
      return false;
    }
    await abortConditionalPasskey();
    if (passkeyState.registered && passkeyState.authenticated && !passkeyState.recent) {
      const verified = await startPasskeyReauthentication();
      if (!verified) return false;
    }
    setPasskeyBusy(true);
    setPrivyStatus("Waiting for your device to create a passkey...", false);
    try {
      const options = await passkeyJsonRequest("/auth/passkey/register/options", {});
      const credential = await navigator.credentials.create({ publicKey: passkeyCreationOptions(options.publicKey) });
      if (!credential) throw new Error("Your device did not create a passkey.");
      const data = await passkeyJsonRequest("/auth/passkey/register/verify", {
        flowId: options.flowId,
        response: passkeyCredentialJson(credential),
      });
      await finishPasskeySession(data, "Passkey ready. Your Ruby High account can travel with you.");
      return true;
    } catch (err) {
      setPrivyStatus(friendlyPasskeyError(err), true);
      return false;
    } finally {
      setPasskeyBusy(false);
    }
  }
  async function startPasskeyLogin() {
    if (!passkeySupported()) {
      setPrivyStatus("This browser needs passkey support. Try Safari, Chrome, or Edge.", true);
      return false;
    }
    await abortConditionalPasskey();
    setPasskeyBusy(true);
    setPrivyStatus("Waiting for your passkey...", false);
    try {
      const options = await passkeyJsonRequest("/auth/passkey/login/options", {});
      const credential = await navigator.credentials.get({ publicKey: passkeyRequestOptions(options.publicKey) });
      if (!credential) throw new Error("Your device did not return a passkey.");
      const data = await passkeyJsonRequest("/auth/passkey/login/verify", {
        flowId: options.flowId,
        response: passkeyCredentialJson(credential),
      });
      await finishPasskeySession(data, "Signed in with your passkey.");
      return true;
    } catch (err) {
      setPrivyStatus(friendlyPasskeyError(err), true);
      return false;
    } finally {
      setPasskeyBusy(false);
    }
  }
  async function startPasskeyReauthentication() {
    if (!passkeySupported()) {
      setPrivyStatus("This browser needs passkey support. Try Safari, Chrome, or Edge.", true);
      return false;
    }
    await abortConditionalPasskey();
    setPasskeyBusy(true);
    setPrivyStatus("Confirm this account with your passkey...", false);
    try {
      const options = await passkeyJsonRequest("/auth/passkey/reauth/options", {});
      const credential = await navigator.credentials.get({ publicKey: passkeyRequestOptions(options.publicKey) });
      if (!credential) throw new Error("Your device did not return a passkey.");
      const data = await passkeyJsonRequest("/auth/passkey/login/verify", {
        flowId: options.flowId,
        response: passkeyCredentialJson(credential),
      });
      await finishPasskeySession(data, "Account confirmed.");
      return true;
    } catch (err) {
      setPrivyStatus(friendlyPasskeyError(err), true);
      return false;
    } finally {
      setPasskeyBusy(false);
    }
  }
  async function ensureRecentPasskey() {
    if (!passkeyState.registered || passkeyState.recent) return true;
    return startPasskeyReauthentication();
  }
  function startConditionalPasskeyLogin() {
    if (conditionalPasskeyPromise) return conditionalPasskeyPromise;
    const pending = runConditionalPasskeyLogin();
    conditionalPasskeyPromise = pending;
    pending.then(
      () => { if (conditionalPasskeyPromise === pending) conditionalPasskeyPromise = null; },
      () => { if (conditionalPasskeyPromise === pending) conditionalPasskeyPromise = null; },
    );
    return pending;
  }
  async function runConditionalPasskeyLogin() {
    if (!passkeySupported() || passkeyState.authenticated || conditionalPasskeyAbortController) return;
    if (typeof PublicKeyCredential.isConditionalMediationAvailable !== "function") return;
    const controller = new AbortController();
    conditionalPasskeyAbortController = controller;
    try {
      const available = await PublicKeyCredential.isConditionalMediationAvailable();
      if (!available || passkeyState.authenticated || controller.signal.aborted) return;
      const options = await passkeyJsonRequest("/auth/passkey/login/options", {});
      if (controller.signal.aborted) return;
      const credential = await navigator.credentials.get({
        publicKey: passkeyRequestOptions(options.publicKey),
        mediation: "conditional",
        signal: controller.signal,
      });
      if (!credential) return;
      const data = await passkeyJsonRequest("/auth/passkey/login/verify", {
        flowId: options.flowId,
        response: passkeyCredentialJson(credential),
      });
      await finishPasskeySession(data, "Signed in with your passkey.");
    } catch (err) {
      if (err && (err.name === "AbortError" || err.name === "NotAllowedError")) return;
      setPrivyStatus(friendlyPasskeyError(err), true);
    } finally {
      if (conditionalPasskeyAbortController === controller) conditionalPasskeyAbortController = null;
    }
  }
  function showPasskeyRecoveryCode(code) {
    recoveryCodeForDisplay = String(code || "").trim();
    if (els.passkeyRecoveryValue) els.passkeyRecoveryValue.textContent = recoveryCodeForDisplay;
    if (els.passkeyRecoveryCode) els.passkeyRecoveryCode.hidden = !recoveryCodeForDisplay;
  }
  async function startPasskeyRecovery() {
    const recoveryCode = String(els.passkeyRecoveryInput && els.passkeyRecoveryInput.value || "").trim();
    if (!recoveryCode) {
      setPrivyStatus("Enter your recovery code.", true);
      if (els.passkeyRecoveryInput) els.passkeyRecoveryInput.focus();
      return false;
    }
    if (!passkeySupported()) {
      setPrivyStatus("This browser needs passkey support. Try Safari, Chrome, or Edge.", true);
      return false;
    }
    await abortConditionalPasskey();
    setPasskeyBusy(true);
    setPrivyStatus("Waiting for your device to create a new passkey...", false);
    try {
      const options = await passkeyJsonRequest("/auth/passkey/recover/options", { recoveryCode });
      const credential = await navigator.credentials.create({ publicKey: passkeyCreationOptions(options.publicKey) });
      if (!credential) throw new Error("Your device did not create a passkey.");
      const data = await passkeyJsonRequest("/auth/passkey/recover/verify", {
        flowId: options.flowId,
        response: passkeyCredentialJson(credential),
      });
      if (els.passkeyRecoveryInput) els.passkeyRecoveryInput.value = "";
      await finishPasskeySession(data, "Account recovered. Save the fresh recovery code.");
      return true;
    } catch (err) {
      setPrivyStatus(friendlyPasskeyError(err), true);
      return false;
    } finally {
      setPasskeyBusy(false);
    }
  }
  async function regeneratePasskeyRecoveryCode() {
    if (!await ensureRecentPasskey()) return;
    setPasskeyBusy(true);
    try {
      const data = await passkeyJsonRequest("/auth/passkey/recovery-code", {});
      applyPasskeyState(data.passkey);
      showPasskeyRecoveryCode(data.recoveryCode);
      setPrivyStatus("Fresh recovery code ready. Save it now.", false);
    } catch (err) {
      setPrivyStatus(friendlyPasskeyError(err), true);
    } finally {
      setPasskeyBusy(false);
    }
  }
  async function copyPasskeyRecoveryCode() {
    if (!recoveryCodeForDisplay) return;
    try {
      await copyTextToClipboard(recoveryCodeForDisplay);
      setPrivyStatus("Recovery code copied.", false);
    } catch (_err) {
      setPrivyStatus("Select the recovery code and copy it.", true);
    }
  }
  function downloadPasskeyRecoveryCode() {
    if (!recoveryCodeForDisplay) return;
    const blob = new Blob([
      "Ruby High recovery code\n\n",
      recoveryCodeForDisplay,
      "\n\nStore this in a password manager. It works once.\n",
    ], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ruby-high-recovery-code.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setPrivyStatus("Recovery code downloaded.", false);
  }
  async function deletePasskeyCredential(id, name) {
    if (!await ensureRecentPasskey()) return;
    const confirmed = await confirmInApp({
      kicker: "Passkey security",
      title: "Delete " + name + "?",
      copy: "Your other passkey will keep this account available.",
      confirmText: "Delete passkey",
      tone: "danger",
      focus: "cancel",
    });
    if (!confirmed) return;
    setPasskeyBusy(true);
    try {
      const data = await passkeyJsonRequest("/auth/passkey/delete", { id });
      applyPasskeyState(data.passkey);
      setPrivyStatus("Passkey deleted.", false);
    } catch (err) {
      setPrivyStatus(friendlyPasskeyError(err), true);
    } finally {
      setPasskeyBusy(false);
    }
  }
  async function ensurePasskeyAccount() {
    if (passkeyState.authenticated) return true;
    return passkeyState.registered ? startPasskeyLogin() : startPasskeyRegistration();
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
      return "The wallet service is busy. Wait a minute, then try again.";
    }
    if (/disallowed_login_method/i.test(message)) {
      return "Wallet sign-in is not available. Contact Ruby High support.";
    }
    if (/popup|modal|did not open/i.test(message)) {
      return "Sign-in did not open. Refresh Ruby High and try again.";
    }
    return message || fallback || "Sign-in failed";
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
    renderAccountIdentity();
    applyAuthUI();
    renderAccountPage();
  }
  function renderAccountIdentity() {
    const solanaAddress = knownSolanaOwnerWalletAddress();
    if (els.privyWallet) {
      els.privyWallet.textContent = solanaAddress
        ? shortWallet(solanaAddress) + " · solana"
        : passkeyState.authenticated
          ? "Passkey account"
          : passkeyState.registered
            ? "Passkey ready"
            : "Guest session";
    }
    if (els.passkeyAction) {
      els.passkeyAction.hidden = passkeyState.authenticated;
      els.passkeyAction.textContent = "Sign in with a passkey";
    }
    if (els.passkeyCreate) {
      els.passkeyCreate.hidden = passkeyState.registered && !passkeyState.authenticated;
      els.passkeyCreate.textContent = passkeyState.authenticated ? "Add passkey" : "Save progress with a passkey";
    }
    if (els.privyLoginWidget) {
      els.privyLoginWidget.hidden = !passkeyState.authenticated || !privyState.configured || !!solanaAddress;
      els.privyLoginWidget.textContent = "Connect wallet";
      els.privyLoginWidget.title = "Connect a Solana wallet to open packs or mint collectible cards.";
    }
    if (els.privySignout) els.privySignout.hidden = !passkeyState.authenticated;
    if (els.signinPrivy) els.signinPrivy.hidden = false;
    renderPasskeySecurity();
  }
  function passkeyDate(value) {
    const date = new Date(Number(value));
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { dateStyle: "medium" }) : "";
  }
  function renderPasskeySecurity() {
    const signedIn = passkeyState.authenticated;
    if (els.passkeySecuritySummary) {
      els.passkeySecuritySummary.textContent = signedIn
        ? passkeyState.credentials.length + " saved passkey" + (passkeyState.credentials.length === 1 ? "" : "s") + ". Add two for safer recovery."
        : "Sign in, or use a recovery code to create a fresh passkey.";
    }
    if (els.passkeyAutofillLabel) els.passkeyAutofillLabel.hidden = signedIn;
    if (els.passkeyRecoveryCard) els.passkeyRecoveryCard.hidden = signedIn;
    if (els.passkeyRecoveryCreate) els.passkeyRecoveryCreate.hidden = !signedIn || !passkeyState.registered;
    if (!els.passkeyList) return;
    els.passkeyList.replaceChildren();
    els.passkeyList.hidden = !signedIn;
    if (!signedIn) return;
    passkeyState.credentials.forEach((item) => {
      const row = document.createElement("div");
      row.className = "passkey-row";
      const text = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = item.name || "Passkey";
      const meta = document.createElement("span");
      const created = passkeyDate(item.createdAt);
      const used = passkeyDate(item.lastUsedAt);
      meta.textContent = (item.synced ? "Synced" : "Device-bound")
        + (created ? " · added " + created : "")
        + (used ? " · used " + used : "");
      text.append(title, meta);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Delete";
      button.disabled = passkeyState.credentials.length <= 1;
      button.title = button.disabled ? "Add another passkey first." : "Delete this passkey";
      button.addEventListener("click", () => deletePasskeyCredential(item.id, title.textContent));
      row.append(text, button);
      els.passkeyList.appendChild(row);
    });
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
    if (!passkeyState.authenticated) await syncPrivyServerSession(snapshot);
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
    if (!r.ok || !data.session) throw new Error(data.error || "Sign-in failed");
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
        if (snapshot.authenticated && !passkeyState.authenticated) await syncPrivyServerSession(snapshot);
      } catch (err) {
        if (/429|too many requests|rate.?limit/i.test(err && err.message ? String(err.message) : String(err || ""))) {
          lastPrivyRateLimitedAt = Date.now();
        }
        if (!privyState.authenticated) applyPrivyState({ configured: true, authenticated: false, ready: true });
        if (els.privyOverlay && els.privyOverlay.classList.contains("is-open")) {
          setPrivyStatus("Sign-in unavailable · " + friendlyPrivyAccountError(err, "error"), true);
        }
      } finally {
        privyRefreshPromise = null;
      }
    })();
    return privyRefreshPromise;
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
  function showPrivyAccountModal() {
    showAppPage("account");
  }
  async function openPrivyAccount() {
    setPrivyStatus("", false);
    try {
      showPrivyAccountModal();
      renderAccountIdentity();
      renderAccountPage();
      if (els.accountWorkspace) els.accountWorkspace.scrollTop = 0;
      void startConditionalPasskeyLogin();
      void syncWalletPackNftsFromAccount({ force: true });
    } catch (err) {
      showPrivyAccountModal();
      setPrivyStatus(friendlyPrivyAccountError(err, "Sign-in error"), true);
    }
  }
  function closePrivyAccount() {
    if (!els.privyOverlay) return;
    void abortConditionalPasskey();
    if (appPage === "account") showAppPage("class");
    setPrivyStatus("", false);
  }
  function setPrivyBusy(busy) {
    if (els.privyLoginWidget) els.privyLoginWidget.disabled = !!busy;
    if (els.privySignout) els.privySignout.disabled = !!busy;
    if (els.accountDelete) els.accountDelete.disabled = !!busy;
  }
  function setPasskeyBusy(busy) {
    if (els.passkeyAction) els.passkeyAction.disabled = !!busy;
    if (els.passkeyCreate) els.passkeyCreate.disabled = !!busy;
    if (els.signinPrivy) els.signinPrivy.disabled = !!busy;
    if (els.passkeyRecoverySubmit) els.passkeyRecoverySubmit.disabled = !!busy;
    if (els.passkeyRecoveryCreate) els.passkeyRecoveryCreate.disabled = !!busy;
  }
  async function signOutPrivy() {
    setPrivyBusy(true);
    setPrivyStatus("Signing out...", false);
    try {
      if (privyClient) await privyClient.logout();
      applyPrivyState({ configured: !!privyConfig, authenticated: false, ready: true });
      applyPasskeyState({
        available: true,
        registered: false,
        authenticated: false,
        recent: false,
        recoveryConfigured: false,
        credentials: [],
      });
      await logout();
      setPrivyStatus("Signed out.", false);
    } catch (err) {
      setPrivyStatus(err && err.message ? err.message : "Could not sign out", true);
    } finally {
      setPrivyBusy(false);
    }
  }
  async function deleteAccountFromAccount() {
    if (!authed) {
      setPrivyStatus("No Ruby High account is signed in.", true);
      return;
    }
    const confirmed = await confirmInApp({
      kicker: "Delete account",
      title: "Delete this account?",
      copy: "This permanently removes this account, students, progress, purchase history, receipts, and school activity.",
      detail: "This cannot be undone.",
      confirmText: "Delete account",
      tone: "danger",
      focus: "cancel",
    });
    if (!confirmed) return;
    if (!await ensureRecentPasskey()) return;
    setPrivyBusy(true);
    setPrivyStatus("Deleting account...", false);
    try {
      const r = await fetch(apiBase + "/auth/delete-account", {
        method: "POST",
        credentials: "same-origin",
        headers: attachVisitorHeader(new Headers()),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || "Could not delete account.");
      clearStoredAuth();
      rotateVisitorId();
      try {
        if (privyClient) await privyClient.logout();
      } catch (_err) {}
      applyPrivyState({ configured: !!privyConfig, authenticated: false, ready: true });
      authed = null;
      aiEnabled = false;
      localAiEnabled = false;
      hostedAiActive = false;
      lastAuthState = null;
      lastTelemetry = null;
      showPasskeyRecoveryCode("");
      applyAuthUI();
      setPrivyStatus("Account deleted. Starting fresh...", false);
      setTimeout(() => { window.location.reload(); }, 700);
    } catch (err) {
      setPrivyStatus(err && err.message ? err.message : "Could not delete account", true);
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
      if (opts && opts.passkey) applyPasskeyState(opts.passkey);
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
    if (opts && opts.passkey) applyPasskeyState(opts.passkey);
    if (opts && opts.privy) applyPrivyState({ ...opts.privy, ready: true });
    applyAuthUI();
    // Browser-owned AI is optional. The overlay is now only a fallback if the app
    // cannot establish even a guest Ruby High session.
    if (authed === false) {
      openViewerModal(signinEl, {
        dismissible: false,
        initialFocus: els.signinGuest,
      });
      setSigninStatus("Local session unavailable. Retry, or use an AI key.", true);
      if (sheetOverlayOpen) closeSheet();
    } else {
      closeViewerModal(signinEl);
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
    setAuthState(true, { ai: !!data.ai, local_ai: !!data.local_ai, hosted_ai: data.hosted_ai, entitlements: data.entitlements, passkey: data.passkey, privy: data.privy });
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
        setAuthState(true, { ai: !!data.ai, local_ai: !!data.local_ai, hosted_ai: data.hosted_ai, entitlements: data.entitlements, passkey: data.passkey, privy: data.privy });
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
        : passkeyState.authenticated
          ? "passkey ready"
        : aiEnabled
          ? (localAiEnabled ? "on-device AI" : "AI enabled")
          : activeTeacherUsesServerAi() ? "teacher connected" : "offline mode";
      els.footerAction.hidden = true;
      if (els.privyAction) {
        els.privyAction.textContent = "Account";
        els.privyAction.hidden = false;
      }
      els.chatForm.hidden = true;
      setChatComposerDisabled(true);
    } else {
      // Unauthed means even guest-session creation failed; the fallback
      // sign-in overlay is the only thing the user can see.
      els.youState.textContent = "signed out";
      els.footerAction.hidden = true;
      if (els.privyAction) els.privyAction.hidden = true;
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
    rotateVisitorId();
    await abortConditionalPasskey();
    showPasskeyRecoveryCode("");
    authed = null;
    aiEnabled = false;
    localAiEnabled = false;
    hostedAiActive = false;
    lastAuthState = null;
    lastTelemetry = null;
    lastRosterSig = null;
    // Keep the account screen available for passkey sign-in or recovery.
    // A fresh browser visit still opens the student creator as usual.
    firstRunCreationOpened = true;
    onboardingIntroTracked = false;
    onboardingFunnelStepsSent.clear();
    roomHumanHistorySig = "";
    chatHistoryHumanStudentsByFaculty.clear();
    await deriveAuth();
    if (authed) await fetchSession();
    applyAuthUI();
    if (teacherChatEnabled() && lastTelemetry) loadHistory(lastTelemetry.faculty);
  }
  function roomHumanHistoryFacultyIds(t) {
    const ids = [];
    const seen = new Set();
    (Array.isArray(t && t.rooms) ? t.rooms : []).forEach((room) => {
      const facultyId = String((room && (room.teacherId || room.facultyId)) || "").trim();
      if (!facultyId || facultyId === LOUNGE_ID || seen.has(facultyId)) return;
      seen.add(facultyId);
      ids.push(facultyId);
    });
    return ids;
  }
  async function loadRoomHumanHistories(t) {
    if (!teacherChatEnabled() || !t) return;
    const faculties = roomHumanHistoryFacultyIds(t);
    if (!faculties.length) return;
    const sig = faculties.join("|");
    if (sig === roomHumanHistorySig) return;
    roomHumanHistorySig = sig;
    let changed = false;
    await Promise.all(faculties.map(async (facultyId) => {
      try {
        const r = await apiFetch("/api/apps/ruby-high/chat/history?faculty=" + encodeURIComponent(facultyId));
        const data = await r.json();
        if (rememberChatHistoryHumanStudents(facultyId, data && data.history)) changed = true;
      } catch (_err) {
        // Best-effort only; server presence still renders the room.
      }
    }));
    if (changed) {
      lastRosterSig = null;
      rebuildChannelsRail();
    }
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
      const summary = typeof data.summary === "string" ? data.summary.trim() : "";
      const sig = chatHistorySignature(facultyId, summary ? [{ role: "system", content: summary }, ...msgs] : msgs);
      if (sig === renderedHistorySig) return;
      renderedHistorySig = sig;
      const rememberedRoomHumans = rememberChatHistoryHumanStudents(facultyId, msgs);
      els.stream.innerHTML = "";
      const fac = (lastTelemetry && lastTelemetry.faculty_roster || []).find((f) => f.id === facultyId);
      const teacherName = fac ? fac.displayName : facultyId;
      const teacherAccent = fac ? fac.accent : "#d22a2a";
      setDialogueCompaction(summary);
      msgs.forEach((m) => {
        if (m.role === "user") {
          const isSelf = !!m.isSelf;
          appendMsg({
            kind: isSelf ? "you" : "player",
            name: isSelf ? playerDisplayName() : (m.authorName || "Student"),
            body: m.content,
            color: isSelf ? "var(--accent)" : "#3aa3e0",
            avatarUrl: m.avatarUrl || null,
          });
        }
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
      if (rememberedRoomHumans) {
        lastRosterSig = null;
        rebuildChannelsRail();
      }
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
        appendSystem(viewerRequestError("Teacher chat", error, response.status));
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
          const refund = parsed && parsed.refunded ? " Your Merit Stars were returned." : "";
          appendSystem(viewerRequestError("Teacher chat", null) + refund);
          refreshSessionAfterStreamEvent();
          playerStreamMsgEl = null;
          studentStreamMsgEl = null;
          streamMsgEl = null;
        } else if (event === "summary") {
          setDialogueCompaction(parsed && parsed.text ? String(parsed.text) : "");
        } else if (event === "opinion-response") {
          const responseText = parsed && parsed.text ? String(parsed.text) : "";
          if (responseText && !renderedOpinionIds.has("player")) {
            renderedOpinionIds.add("player");
            appendMsg({ kind: "you", name: playerDisplayName(), body: responseText, color: "var(--accent)" });
          }
        } else if (event === "waiting" || event === "opinion-graded") {
          if (event === "opinion-graded" && parsed && parsed.opinionPurpose === "daily-take") {
            postViewerMetricEvent("teacher_response_viewed", {
              questionId: parsed.questionId,
              faculty: parsed.faculty,
            });
          }
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
    if (!agentTurn) {
      appendSystem("Chat is already working.");
      return;
    }
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
        const escapedName = String(s.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp("\\b" + escapedName + "\\b", "i");
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
          body: JSON.stringify({ faculty: targetFaculty, message: text, clientTurnSeq: streamGuard.streamSeq }),
        });
      }
      await consumeSseStream(r, streamGuard);
    } catch (err) {
      if (inOpinion) clearOpinionSubmitted();
      if (chatStreamStillCurrent(streamGuard)) appendSystem(viewerRequestError("Teacher chat", err));
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
      if (chatStreamStillCurrent(streamGuard)) appendSystem(viewerRequestError("Teacher chat", err));
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
  function openRails() { showAppPage("campus"); }
  function closeRails(restoreFocus) {
    if (restoreFocus) showAppPage("class");
  }
  function toggleRails() { showAppPage(appPage === "campus" ? "class" : "campus"); }

  // ── opinion-mode helpers ────────────────────────────────────────────────
  // The player's opinion submission is just a regular chat message routed to
  // the opinion endpoint. NPC responses appear as chat messages too. The
  // teacher's response streams as a normal chat reply when grading fires.
  function renderOpinionsIntoChat(round) {
    if (!round || round.type !== "opinion") return;
    // Render any new responses (deduped by responder id) as chat messages.
    for (const r of (round.opinionResponses || [])) {
      if (renderedOpinionIds.has(r.responder)) continue;
      renderedOpinionIds.add(r.responder);
      if (r.responder === "player") {
        appendMsg({ kind: "you", name: playerDisplayName(), body: r.text, color: "var(--accent)" });
        continue;
      }
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
    const nodes = dialogueNodes(".msg");
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
  function recordTakeStarted() {
    const question = lastTelemetry && lastTelemetry.current;
    if (!question || question.opinionPurpose !== "daily-take" || takeStartedQuestionId === question.id) return;
    takeStartedQuestionId = question.id;
    postViewerMetricEvent("take_card_started", { questionId: question.id });
  }
  els.responseCardButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      const group = button.dataset.group;
      const value = button.dataset.value;
      if (!group || !value) return;
      responseCardSelection[group] = value;
      const groupIndex = RESPONSE_CARD_GROUPS.indexOf(group);
      const nextGroup = RESPONSE_CARD_GROUPS[groupIndex + 1];
      if (nextGroup && !responseCardSelection[nextGroup]) responseBuilderActiveGroup = nextGroup;
      recordTakeStarted();
      syncResponseBuilder(true, false);
    });
  });
  els.responseStepButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      openResponseGroup(button.dataset.responseStep);
    });
  });
  els.generateMcBtn.addEventListener("click", generateMultipleChoice);
  els.nextBtn.addEventListener("click", pickNext);
  els.mobileViewButtons.forEach((button) => {
    button.addEventListener("click", () => setMobilePane(button.dataset.mobileView, false));
  });
  els.hamburger.addEventListener("click", toggleRails);
  if (els.leaderboardBack) els.leaderboardBack.addEventListener("click", () => showAppPage("campus"));
  els.scrim.addEventListener("click", () => closeRails(true));
  if (els.channelsClose) els.channelsClose.addEventListener("click", () => closeRails(true));
  els.homeBtn.addEventListener("click", () => showAppPage("class"));
  document.querySelectorAll(".app-nav [data-app-page]").forEach((button) => {
    button.addEventListener("click", () => showAppPage(button.dataset.appPage));
  });
  document.querySelectorAll("[data-yearbook-pane]").forEach((button) => {
    button.addEventListener("click", () => showYearbookPane(button.dataset.yearbookPane));
  });
  window.addEventListener("popstate", () => {
    const page = window.location.hash.slice(1);
    showAppPage(page, { history: false });
    if (page === "account") { renderAccountIdentity(); renderAccountPage(); }
  });
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
  if (els.signinPrivy) els.signinPrivy.addEventListener("click", startPasskeyLogin);

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
    openViewerModal(els.bugReportOverlay, {
      onRequestClose: closeBugReport,
      initialFocus: els.bugReportText,
    });
  }
  function closeBugReport() {
    if (!els.bugReportOverlay) return;
    if (els.bugReportOverlay.classList.contains("is-busy")) return;
    closeViewerModal(els.bugReportOverlay, els.reportBugLink);
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
  if (Array.isArray(els.accountTabs)) {
    els.accountTabs.forEach((tab) => {
      tab.addEventListener("click", () => setAccountPane(tab.getAttribute("data-account-tab")));
      tab.addEventListener("keydown", (event) => {
        const currentIndex = els.accountTabs.indexOf(tab);
        const targetIndex = accountPaneKeyTarget(event.key, currentIndex, els.accountTabs.length);
        if (targetIndex == null) return;
        event.preventDefault();
        const target = els.accountTabs[targetIndex];
        if (!target) return;
        setAccountPane(target.getAttribute("data-account-tab"));
        focusWithoutScroll(target);
      });
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
  if (els.accountPublicWorldToggle) els.accountPublicWorldToggle.addEventListener("click", togglePublicWorldFromAccount);
  if (els.accountDelete) els.accountDelete.addEventListener("click", deleteAccountFromAccount);
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
  if (els.passkeyAction) els.passkeyAction.addEventListener("click", startPasskeyLogin);
  if (els.passkeyCreate) els.passkeyCreate.addEventListener("click", startPasskeyRegistration);
  if (els.passkeyRecoverySubmit) els.passkeyRecoverySubmit.addEventListener("click", startPasskeyRecovery);
  if (els.passkeyRecoveryCreate) els.passkeyRecoveryCreate.addEventListener("click", regeneratePasskeyRecoveryCode);
  if (els.passkeyRecoveryCopy) els.passkeyRecoveryCopy.addEventListener("click", copyPasskeyRecoveryCode);
  if (els.passkeyRecoveryDownload) els.passkeyRecoveryDownload.addEventListener("click", downloadPasskeyRecoveryCode);
  if (els.passkeyRecoveryInput) els.passkeyRecoveryInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void startPasskeyRecovery();
  });
  if (els.privyLoginWidget) els.privyLoginWidget.addEventListener("click", async () => {
    await ensureSolanaWalletFromAccount();
  });
  if (els.privySignout) els.privySignout.addEventListener("click", signOutPrivy);

  // ── onboarding button handlers ──────────────────────────────────────────
  // ── morning announcements dismiss ───────────────────────────────────────
  const announcementsDismiss = document.getElementById("announcements-dismiss");
  if (announcementsDismiss) announcementsDismiss.addEventListener("click", function() {
    const startCreation = !!lastTelemetry && !lastTelemetry.character;
    dismissAnnouncements();
    if (startCreation) setTimeout(() => openCharacterCreation(), 0);
  });
  // Allow Escape key to dismiss
  document.addEventListener("keydown", function(ev) {
    if (announcementsOverlay && !announcementsOverlay.hidden) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        dismissAnnouncements();
        return;
      }
      trapModalFocus(ev, announcementsOverlay);
      return;
    }
    if (ev.key === "Escape" && window.matchMedia("(max-width: 1099px)").matches && els.shell.classList.contains("is-rails-open")) {
      ev.preventDefault();
      closeRails(true);
    }
  });
  // Click outside panel to dismiss
  var announcementsOverlayEl = document.getElementById("announcements-overlay");
  if (announcementsOverlayEl) announcementsOverlayEl.addEventListener("click", function(ev) {
    if (ev.target === announcementsOverlayEl) dismissAnnouncements();
  });

  const onboardingCreateBtn = document.getElementById("onboarding-create-btn");
  // The first action supplies a candidate immediately, but it lands
  // in the creation sheet before enrollment. That keeps the fast first-run
  // path while preserving whole-student rerolls, field rerolls, and the AI
  // portrait affordance until the player explicitly starts Freshman year.
  if (onboardingCreateBtn) onboardingCreateBtn.addEventListener("click", openCharacterCreation);

  if (els.youProfile) els.youProfile.addEventListener("click", openPrivyAccount);
  els.chatForm.addEventListener("submit", (e) => { e.preventDefault(); sendChatMessage(els.chatInput.value); });
  els.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(els.chatInput.value); }
  });
  els.chatInput.addEventListener("input", () => {
    els.chatInput.style.height = "40px";
    els.chatInput.style.height = Math.min(140, els.chatInput.scrollHeight) + "px";
  });

  applyAuthUI();
  consumeAcquisitionAttribution();
  consumeBillingReturnFlag();
  consumeReferralFlag();
  const sharedPackId = consumeSharedPackFlag();
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
    viewerMetricsBooted = true;
    postViewerMetricEvent("app_open", acquisitionAttribution || {});
    await fetchSession();
    await applySharedPackFromUrl(sharedPackId);
    const page = window.location.hash.slice(1);
    if (["campus", "yearbook", "account"].includes(page)) {
      showAppPage(page, { history: false, focus: false });
      if (page === "account") { renderAccountIdentity(); renderAccountPage(); }
    }
  }
  void bootInitialSession();
  // Privy's React/wallet bundle is intentionally loaded only when the account
  // surface opens. /auth/me already returns the server-known account snapshot,
  // so downloading the full wallet stack during every anonymous page load is
  // unnecessary.
  // Adaptive poll: tick quickly during an active race so NPC picks land in
  // real time; back off when idle and stop completely in hidden tabs.
  function pauseSessionPolling() {
    clearTimeout(sessionPollHandle);
    sessionPollHandle = null;
  }
  function resumeSessionPolling() {
    if (document.visibilityState === "hidden") return;
    pauseSessionPolling();
    void fetchSession({ timeoutMs: SESSION_REFRESH_TIMEOUT_MS }).finally(adaptiveSchedule);
  }
  function adaptiveSchedule() {
    pauseSessionPolling();
    if (document.visibilityState === "hidden") return;
    const round = lastTelemetry && lastTelemetry.active_round;
    const fast = round && !round.resolved;
    sessionPollHandle = setTimeout(async () => {
      await fetchSession();
      adaptiveSchedule();
    }, fast ? 750 : 15000);
  }
  adaptiveSchedule();
}
