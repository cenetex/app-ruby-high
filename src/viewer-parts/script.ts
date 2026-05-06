import type { ViewerRenderOptions } from "../viewer.js";

// Returns the SPA viewer's inline JS as a string. Threads only the
// per-session opts that bootstrap the client (apiBase, sessionId, role) —
// everything else is plain client code that talks to the server via
// /session/<id> and /command. Kept as a single string so the whole
// thing remains a no-build viewer (no bundler step needed for a quick
// edit).
export function viewerScript(opts: ViewerRenderOptions): string {
  const safeSession = encodeURIComponent(opts.sessionId);
  const safeApiBase = encodeURIComponent(opts.apiBase);
  const role = opts.role === "agent" ? "agent" : "human";
  return `
(() => {
  const apiBase = decodeURIComponent("${safeApiBase}");
  const sessionId = decodeURIComponent("${safeSession}");
  const role = "${role}";
  const sessionUrl = apiBase + "/session/" + encodeURIComponent(sessionId);
  const commandUrl = sessionUrl + "/command";
  const GRADE_LABELS = { "9": "Freshman", "10": "Sophomore", "11": "Junior", "12": "Senior" };
  const GRADE_SHORT_LABELS = { "9": "Fresh", "10": "Soph", "11": "Junior", "12": "Senior" };
  const GRADE_ORDER = ["9", "10", "11", "12"];
  // Mirrored from types.ts: school-day streak gates by year.
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
    if (mult >= 5) return "+" + points + " score · Friday ×5";
    return "+" + points + " score" + (mult > 1 ? " · ×" + mult : "");
  }
  function letterGradePasses(grade) {
    return /^[ABC]/.test(String(grade || ""));
  }
  function streakScoreMultiplier(count) {
    const n = Math.max(0, Math.floor(Number(count || 0)));
    if (n >= 4) return 5;
    if (n >= 3) return 3;
    if (n >= 2) return 2;
    return 1;
  }
  function courseProgressForFaculty(fid) {
    const roster = (lastTelemetry && lastTelemetry.faculty_roster) || [];
    return roster.find((f) => f.id === fid) || null;
  }
  function classGradeForFaculty(fid) {
    const progress = courseProgressForFaculty(fid);
    return (progress && progress.courseGrade) || "—";
  }
  function courseStatusText(progress) {
    if (!progress) return "settling in";
    const grade = progress.grade || "—";
    const done = Number(progress.completedClasses || 0);
    const required = Number(progress.requiredClasses || 0);
    const today = progress.today || {};
    if (today.status === "complete") {
      return "class complete today" + (today.letterGrade ? " · " + today.letterGrade : "") + " · " + grade;
    }
    if (today.status === "active") {
      return "class " + Number(today.questionCount || 0) + "/" + Number(today.totalQuestions || 3) + " · " + grade;
    }
    return done + "/" + required + " classes · " + grade;
  }
  function nextQuestionButtonLabel() {
    if (lastTelemetry && lastTelemetry.graduation_ready) return "Graduation ceremony →";
    const progress = lastTelemetry && lastTelemetry.active_course_progress;
    if (progress && progress.today && progress.today.status === "complete") return "Practice →";
    if (progress && progress.today && progress.today.status === "active") return "Continue class →";
    return "Start class →";
  }
  function classGradeSummary() {
    const grades = TEACHING_FACULTY_IDS.map((fid) => ({
      facultyId: fid,
      grade: classGradeForFaculty(fid),
      progress: courseProgressForFaculty(fid),
    }));
    const met = grades.filter((g) => {
      const p = g.progress || {};
      const completed = Number(p.completedClasses || 0);
      const required = Number(p.requiredClasses || 0);
      return required > 0 && completed >= required && letterGradePasses(g.grade);
    }).length;
    return { grades, met, total: grades.length };
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
  // Wrapper around fetch that attaches the OpenRouter key header when one
  // is present in localStorage. Use this for every same-origin API call.
  //
  // 401 handling: when the server says "not authenticated" — typically because
  // the rh_session cookie expired but localStorage still has a stale key — we
  // clear the local credential and re-derive auth state. That fires the same
  // re-render path as a logout: the mandatory #signin-overlay covers the
  // app, chat + footer button are hidden. The caller's error path may
  // still run, but it'll be writing to detached DOM nodes by then, so no
  // stale "Couldn't roll" string ever lands on screen.
  function apiFetch(url, init) {
    const opts = init ? Object.assign({}, init) : {};
    const headers = new Headers(opts.headers || {});
    const key = getStoredApiKey();
    if (key) headers.set("X-Openrouter-Key", key);
    opts.headers = headers;
    if (!opts.credentials) opts.credentials = "same-origin";
    return fetch(url, opts).then((r) => {
      if (r.status === 401 && getStoredApiKey()) {
        clearStoredAuth();
        try { deriveAuth(); } catch (_e) { /* deriveAuth not yet defined on boot */ }
      }
      return r;
    });
  }

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
    blackboardMeta: $("blackboard-meta"),
    boardFrameHost: $("board-frame-host"),
    boardPrompt: $("board-prompt"),
    boardReveal: $("board-reveal"),
    answersHost: $("answers-host"),
    answers: Array.from(document.querySelectorAll(".answer")),
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
    checking: $("checking"),
    scrim: $("scrim"),
    congrats: $("congrats-toast"),
  };

  // ── view state ────────────────────────────────────────────────────────────
  let lastTelemetry = null;
  let lastRosterSig = "";
  let lastRevealId = null;
  let lastAnswerGradedTriggerId = null;
  let authed = null; // null = unknown, true/false set after first poll
  let lockedFor = null;
  let streamingMsgEl = null;
  let renderedHistorySig = null;
  let activeQuestionId = null; // currently displayed question id on the blackboard
  let questionCounter = 0;     // session-local question count for "Question N" label
  let lastShownGrade = null;
  // Tracks the yearbook's length on the previous telemetry tick so we
  // can detect Senior completion (the only grade transition that
  // doesn't change current_grade). null on first boot — same suppress-
  // toast-on-first-tick semantics as lastShownGrade.
  let lastYearbookLen = null;
  let lastShownFaculty = null;
  let agentBusy = false;       // true while a teacher-driven SSE turn is running
  let agentBusySeq = 0;
  let lastAgentTrigger = null; // dedupe key so we don't re-fire on poll
  let chatViewSeq = 0;         // bumps on room/lounges switches; invalidates stale history/SSE work
  // Reset the guards above whenever the player walks into a new context
  // (faculty change, lounge entry, grade selection). Without this, the
  // dedupe key from a prior visit silently blocks channel-enter on revisit:
  // "I went back to Ruby's room and she didn't greet me."
  function resetAgentGuards() {
    lastAgentTrigger = null;
    lastRevealId = null;
    lastAnswerGradedTriggerId = null;
  }
  let opinionSubmitted = false; // player's text has been recorded for current round
  let opinionGradeFired = false; // grading has been triggered for current round
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
  function playerMessageIdentitySig() {
    const ch = lastTelemetry && lastTelemetry.character;
    return playerDisplayName() + ":" + (ch && ch.portraitDataUrl ? ch.portraitDataUrl.length : 0);
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
    streamingMsgEl = null;
    renderedHistorySig = null;
  }
  function resetBlackboard() {
    activeQuestionId = null;
    questionCounter = 0;
    showBlackboardEmpty(true);
  }

  // ── command helper ────────────────────────────────────────────────────────
  async function command(payload) {
    const seq = ++commandSeq;
    try {
      const r = await fetch(commandUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "request " + r.status }));
        appendSystem("error · " + (err.error || r.status));
        return null;
      }
      const data = await r.json();
      if (data && data.session) render(data.session);
      return data;
    } catch (err) {
      appendSystem("submit failed · " + (err && err.message ? err.message : "error"));
      return null;
    } finally {
      // Mark this command's seq so any in-flight fetchSession() that was
      // started before us discards its (now-stale) response on return.
      lastSettledCommandSeq = seq;
    }
  }
  // Monotonic counter bumped on every command(). Used by fetchSession() to
  // detect "a command happened while my GET was in flight, my response may
  // be stale, drop it." Prevents the poll from rendering a pre-mutation
  // snapshot over a freshly-mutated state (the post-command flicker).
  let commandSeq = 0;
  let lastSettledCommandSeq = 0;

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
  function facultyAssetId(facultyOrId) {
    if (!facultyOrId) return "";
    if (typeof facultyOrId === "object") return facultyOrId.assetTeacherId || knownTeacherAssetId(facultyOrId) || facultyOrId.id || "";
    const roster = (lastTelemetry && lastTelemetry.faculty_roster) || [];
    const fac = roster.find((f) => f.id === facultyOrId);
    return (fac && (fac.assetTeacherId || knownTeacherAssetId(fac))) || facultyOrId;
  }
  function teacherAssetUrl(facultyOrId, variant) {
    const assetId = facultyAssetId(facultyOrId) || "ruby";
    const suffix = variant ? "-" + variant : "";
    return apiBase + "/assets/teachers/" + encodeURIComponent(assetId) + suffix + ".png";
  }
  function teacherStickerUrl(facultyId) {
    if (!facultyId) return null;
    return teacherAssetUrl(facultyId, "");
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
    scrollIfPinned();
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
    const heroSrc = facultyId ? teacherAssetUrl(facultyId, "full") : teacherAssetUrl("ruby", "full");
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
    els.blackboardFoot.hidden = true;
    if (reset) {
      els.boardPrompt.textContent = "";
      els.boardReveal.hidden = true;
      els.boardReveal.textContent = "";
    }
  }
  function showBlackboardLoaded(isOpinion) {
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
    els.blackboardPanel.dataset.opinion = String(!!isOpinion);
  }

  // ── top-bar arc indicator (live progress through the 4-year arc) ────────
  // Shape: "Junior · streak 2/3 · 2/3 classes". Hidden until a character
  // exists. Streak/class progress turns accent-colored once the gate is met (player's
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
      els.arcXp.textContent = "classes passed";
      els.arcXp.classList.remove("is-met");
      els.arcScore.textContent = Math.round(Number(t.scorePoints || 0)) + " score";
      return;
    }
    const yearLabel = GRADE_LABELS[grade] || ("Grade " + grade);
    els.arcYear.textContent = yearLabel;
    const streakCount = ch.streak && ch.streak.grade === grade ? ch.streak.count : 0;
    const streakReq   = STREAK_REQUIRED[grade] || 1;
    els.arcStreak.textContent = "streak " + streakCount + "/" + streakReq;
    els.arcStreak.classList.toggle("is-met", streakCount >= streakReq);
    const classes = classGradeSummary();
    els.arcXp.textContent = classes.met + "/" + classes.total + " classes";
    els.arcXp.classList.toggle("is-met", classes.met >= classes.total);
    els.arcScore.textContent = Math.round(Number(t.scorePoints || 0)) + " score";
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
    const remainingS = Math.max(0, Math.ceil(round.remainingMs / 1000));
    els.timerLabel.textContent = round.resolved
      ? "done"
      : remainingS + "s";
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
        if (round.resolved && c.pick) {
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
    const url = teacherAssetUrl(faculty, "face");
    if (els.teacherFigure.dataset.facultyId !== faculty.id || els.teacherFigure.dataset.assetId !== assetId) {
      // Clear first so the browser repaints even if the URL is cached, and
      // restart the entry animation so the speaker change reads visually.
      els.teacherFigure.dataset.facultyId = faculty.id;
      els.teacherFigure.dataset.assetId = assetId;
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
  // original pack that's Ruby/Sally/Edward; for an Anki-imported pack
  // it's the deck-derived teacher (one figure). Without this the lounge
  // would always show the original-pack portraits regardless of which
  // pack the player is on. Anki teachers (no portrait asset) fall back
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
      const img = document.createElement("img");
      img.src = teacherAssetUrl(f, "full");
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
      showBlackboardEmpty(true);
      activeQuestionId = null;
      // The empty-board message is just text; the teacher/chat loop decides
      // when to write the next question.
      if (!authed) {
        els.blackboardEmptyText.textContent = "Sign in with OpenRouter to start class.";
      } else if (!lastTelemetry?.character) {
        els.blackboardEmptyText.textContent = "Roll a character — your name will appear in the seating chart.";
      } else if (faculty && faculty.id === LOUNGE_ID) {
        els.blackboardEmptyText.textContent = "You're in the teachers' lounge. No questions here — eavesdrop on the faculty.";
      } else if (lastTelemetry && lastTelemetry.graduation_ready) {
        els.blackboardEmptyText.textContent = "Requirements complete. Open your School Career card for the graduation ceremony.";
      } else {
        // Surface the "what you need" hint here too so the empty board
        // is informative instead of "the teacher will be with you in a
        // moment" forever. The hint comes second — the lead is still
        // the room's status, the hint is the actionable detail.
        const hint = lastTelemetry && lastTelemetry.character ? buildNextStepHint(lastTelemetry.character) : "";
        const progress = lastTelemetry && lastTelemetry.active_course_progress;
        const lead = progress && progress.today && progress.today.status === "complete"
          ? "Today's graded class is complete. Practice is open."
          : progress && progress.today && progress.today.status === "active"
            ? "Continue today's class when the teacher writes the next board."
            : "Start today's graded class when the teacher writes the next board.";
        els.blackboardEmptyText.textContent = hint ? lead + " " + hint : lead;
      }
      return;
    }

    const isNewQuestion = question.id !== activeQuestionId;
    if (isNewQuestion) {
      activeQuestionId = question.id;
      questionCounter += 1;
    }

    const isOpinion = (lastTelemetry && lastTelemetry.is_opinion) || question.type === "opinion";
    showBlackboardLoaded(isOpinion);

    // Meta pills
    els.blackboardMeta.innerHTML = "";
    if (faculty) {
      const f = document.createElement("span"); f.className = "pill faculty"; f.textContent = faculty.displayName || "Teacher"; els.blackboardMeta.appendChild(f);
    }
    if (question.subject) { const s = document.createElement("span"); s.className = "pill subject"; s.textContent = question.subject; els.blackboardMeta.appendChild(s); }
    if (question.difficulty) { const d = document.createElement("span"); d.className = "pill difficulty " + question.difficulty; d.textContent = question.difficulty; els.blackboardMeta.appendChild(d); }
    const ar = lastTelemetry && lastTelemetry.active_round;
    const stat = (ar && ar.stat) || (question && question.stat);
    const statPill = document.createElement("span");
    statPill.className = "pill stat " + (stat || "head");
    statPill.textContent = statLabel(stat);
    els.blackboardMeta.appendChild(statPill);
    if (ar && ar.isBonus) {
      const bonus = document.createElement("span");
      bonus.className = "pill bonus";
      bonus.textContent = "★ BONUS";
      els.blackboardMeta.appendChild(bonus);
    }
    if (ar && ar.classSession) {
      const cls = document.createElement("span");
      cls.className = "pill class-mode";
      cls.textContent = ar.classSession.mode === "class"
        ? "CLASS " + (ar.classSession.index || "?") + "/" + (ar.classSession.total || 3)
        : "PRACTICE";
      els.blackboardMeta.appendChild(cls);
    }

    // Prompt — always wipe + rewrite on new question (chalkboard re-erasing).
    if (isNewQuestion) {
      renderMarkdownInto(els.boardPrompt, question.prompt || "");
      els.boardReveal.hidden = true;
      els.boardReveal.textContent = "";
      els.boardReveal.classList.remove("correct", "wrong");
    }

    // Answer buttons
    let maxLen = 0;
    els.answers.forEach((btn) => {
      const pick = btn.dataset.pick;
      const label = btn.querySelector(".label");
      const text = (question.options && question.options[pick]) || "—";
      renderMarkdownInto(label, text, { inline: true });
      if (text.length > maxLen) maxLen = text.length;
      if (isNewQuestion) {
        btn.classList.remove("is-correct", "is-wrong");
      }
      btn.disabled = role === "agent";
    });
    // Long-answer mode flips the grid to single-column on narrow
    // viewports (handled in CSS). Threshold tuned so a 4-line
    // explanation-style answer triggers it but a regular MC option
    // ("the mitochondria is the powerhouse of the cell") doesn't.
    const answersGrid = document.getElementById("answers");
    if (answersGrid) answersGrid.classList.toggle("is-long", maxLen > 50);

    // Footer — Next button shown only when the player is signed in and only
    // after a reveal (revealRound clears the inline display:none).
    els.nextBtn.disabled = false;
    els.nextBtn.textContent = nextQuestionButtonLabel();
    els.nextBtn.style.display = "none"; // hidden until reveal
    els.blackboardFoot.hidden = !authed;

    // Opinion-mode bookkeeping resets on new question.
    if (isNewQuestion && isOpinion) {
      opinionSubmitted = false;
      opinionGradeFired = false;
      renderedOpinionIds.clear();
      gradedResponderIds.clear();
    }
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
    els.nextBtn.textContent = nextQuestionButtonLabel();
    els.nextBtn.style.display = "";
    els.nextBtn.focus();
  }

  function applyRevealToBlackboard(reveal) {
    if (!reveal) return;
    els.answers.forEach((btn) => {
      btn.disabled = true;
      if (btn.dataset.pick === reveal.correct) btn.classList.add("is-correct");
      if (btn.dataset.pick === reveal.picked && !reveal.wasCorrect) btn.classList.add("is-wrong");
    });
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
    verdict.textContent = reveal.affinitySave
      ? "✓ Class affinity saved " + reveal.picked + " — answer was " + reveal.correct
      : reveal.wasCorrect
      ? "✓ Correct (" + reveal.picked + ")"
      : "✗ You picked " + reveal.picked + " — answer was " + reveal.correct;
    els.boardReveal.appendChild(verdict);
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
        : (scoreMult >= 5 ? "◆ Friday Bonus ×5" : "◆ ×" + scoreMult + " score");
      els.boardReveal.appendChild(mult);
    }
    if (reveal.explanation) {
      const expl = document.createElement("div");
      expl.className = "reveal-explanation";
      renderMarkdownInto(expl, reveal.explanation);
      els.boardReveal.appendChild(expl);
    }
    els.nextBtn.style.display = "";
    els.nextBtn.focus();
  }

  function maybeRunAnswerGraded(t, delayMs) {
    const reveal = t && t.lastReveal;
    if (!reveal) return;
    const triggerId = reveal.questionId + ":" + reveal.picked + ":" + reveal.correct;
    if (triggerId === lastAnswerGradedTriggerId) return;
    const ceremonyReady = !!(t.graduation_ready || (t.character && t.character.pendingGraduation));
    const arcFinished = t.character && graduatedFor(t.character);
    if (!authed || t.faculty === LOUNGE_ID || arcFinished || ceremonyReady) return;
    lastAnswerGradedTriggerId = triggerId;
    setTimeout(() => {
      // If the player switches rooms before the delayed reaction fires,
      // don't let an old answer wake the wrong teacher.
      if (!lastTelemetry || lastTelemetry.faculty !== t.faculty) return;
      runAgentTurn("answer-graded", {
        grade: t.current_grade,
        picked: reveal.picked,
        correct: reveal.correct,
        wasCorrect: reveal.wasCorrect,
      }, { force: true });
    }, Math.max(0, delayMs || 0));
  }

  function appendResultChip(reveal) {
    const wrap = document.createElement("div");
    wrap.className = "msg result";
    const body = document.createElement("div");
    body.className = "body";
    const badge = document.createElement("span");
    badge.className = "badge-mini " + (reveal.wasCorrect ? "ok" : "bad");
    badge.textContent = reveal.wasCorrect ? "✓ " + reveal.picked : "✗ " + reveal.picked + " · " + reveal.correct;
    body.appendChild(badge);
    body.appendChild(document.createTextNode("Q" + questionCounter + " — " + (reveal.wasCorrect ? "correct" : "missed")));
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
        : (scoreMult >= 5 ? "◆ Friday ×5" : "◆ ×" + scoreMult);
      body.appendChild(mult);
    }
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
  function rebuildChannelsRail() {
    const t = lastTelemetry || {};
    const grade = t.current_grade;
    const roster = t.faculty_roster || [];
    const sig = (grade ?? "?") + "::" + roster.map((f) =>
      f.id + ":" + f.available + ":" + f.questionCount + ":" + (f.courseGrade || "")
        + ":" + (f.completedClasses ?? "") + "/" + (f.requiredClasses ?? "")
        + ":" + ((f.todayClass && f.todayClass.status) || "")
    ).join("|") + "::" + t.faculty;
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
        const img = document.createElement("img");
        img.src = teacherAssetUrl(fac, "face");
        img.alt = "";
        img.onerror = () => { thumb.style.background = fac.accent || "#444"; thumb.removeChild(img); };
        thumb.appendChild(img);
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
      if (fac && fac.courseGrade) {
        const courseMark = document.createElement("span");
        courseMark.className = "course-status-pill";
        const done = Number(fac.completedClasses || 0);
        const required = Number(fac.requiredClasses || 0);
        courseMark.title = done + "/" + required + " classes";
        courseMark.textContent = fac.courseGrade;
        row.appendChild(courseMark);
      }
      const cohortIds = (cohort[room.id] || []).filter((sid) => shouldShowStudentId(sid));
      if (cohortIds.length > 0) {
        const dots = document.createElement("span");
        dots.style.display = "inline-flex";
        dots.style.gap = "3px";
        cohortIds.forEach((sid) => {
          const s = STUDENTS.find((x) => x.id === sid);
          const d = document.createElement("span");
          d.style.cssText = "width:8px;height:8px;border-radius:999px;background:" + (s ? s.color : "#888");
          d.title = s ? s.name : sid;
          dots.appendChild(d);
        });
        row.appendChild(dots);
      }
      row.addEventListener("click", () => fac && setFaculty(fac.id));
      els.channelsList.appendChild(row);
    });

    // The Teachers' Lounge — same channel UX as a classroom but no teacher
    // thumbnail (it's the all-three-teachers room).
    {
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

    // Class roster — show every student in the year with their current cohort
    // grade. Click any of them to open their profile card.
    const studentsTitle = document.createElement("div");
    studentsTitle.className = "channel-section-title";
    studentsTitle.textContent = "Class — grade";
    els.channelsList.appendChild(studentsTitle);
    const npcRoster = t.npc_roster || [];
    npcRoster.forEach((npc) => {
      if (!shouldShowStudentId(npc.id)) return;
      const s = STUDENTS.find((x) => x.id === npc.id);
      if (!s) return;
      const arc = Array.isArray(t.npc_cohort) ? t.npc_cohort.find((n) => n.id === npc.id) : null;
      const rosterGrade = arc && !arc.graduated ? arc.grade : npc.grade;
      const gradeIdx = GRADE_ORDER.indexOf(String(rosterGrade));
      const diamondCount = arc && arc.graduated ? GRADE_ORDER.length : Math.max(1, gradeIdx + 1);
      const gradeTitle = arc && arc.graduated
        ? "Graduated"
        : (GRADE_LABELS[rosterGrade] || ("Grade " + rosterGrade));
      const row = document.createElement("button");
      row.className = "channel-row";
      row.type = "button";
      row.style.cssText = "background:transparent;font-weight:600;font-size:14px;";
      const thumb = document.createElement("span");
      thumb.className = "teacher-thumb";
      thumb.style.background = "#222";
      const img = document.createElement("img");
      img.src = apiBase + "/assets/students/" + encodeURIComponent(npc.id) + "-face.png";
      img.alt = "";
      img.onerror = () => { thumb.style.background = s.color; thumb.removeChild(img); };
      thumb.appendChild(img);
      row.appendChild(thumb);
      const name = document.createElement("span");
      name.style.flex = "1 1 auto";
      name.textContent = s.name;
      row.appendChild(name);
      const gradeMark = document.createElement("span");
      gradeMark.className = "roster-grade" + (arc && arc.graduated ? " is-graduated" : "");
      gradeMark.title = gradeTitle;
      gradeMark.setAttribute("aria-label", gradeTitle);
      const diamondWrap = document.createElement("span");
      diamondWrap.className = "roster-grade-diamonds";
      for (let i = 0; i < diamondCount; i++) {
        const diamond = document.createElement("span");
        diamond.className = "roster-grade-diamond";
        diamond.textContent = "◆";
        diamondWrap.appendChild(diamond);
      }
      const gradeLabel = document.createElement("span");
      gradeLabel.className = "roster-grade-label";
      gradeLabel.textContent = arc && arc.graduated ? "Grad" : (GRADE_SHORT_LABELS[rosterGrade] || String(rosterGrade));
      gradeMark.appendChild(diamondWrap);
      gradeMark.appendChild(gradeLabel);
      row.appendChild(gradeMark);
      row.addEventListener("click", () => openStudentProfile(npc, s));
      els.channelsList.appendChild(row);
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
      if (authed) {
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
      if (authed) {
        runAgentTurn("lounge-enter", { }, { force: true });
      } else {
        appendSystem("Sign in to eavesdrop on the faculty.");
      }
    }
    closeRails();
  }
  async function pickNext() {
    els.nextBtn.disabled = true;
    try {
      if (lastTelemetry && lastTelemetry.graduation_ready) {
        openSheet();
        return;
      }
      await command({ type: "pick" });
      lockedFor = null;
    } finally {
      els.nextBtn.disabled = false;
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
    // Composer: only enabled when the player is in a state that can chat.
    const canChat = authed && (mode === "between-rounds" || mode === "round-live" || mode === "round-revealed" || mode === "in-lounge");
    els.chatForm.hidden = !canChat;
    if (canChat) { els.chatInput.disabled = false; els.chatSend.disabled = false; }
    // Race strip + answers + advantage + footer-filter all hide via CSS now.
    // We still null out the race-row contents on mode exit so the next
    // round-live paint doesn't double-render stale cards.
    if (mode !== "round-live" && els.raceRow) els.raceRow.innerHTML = "";
  }

  function render(s) {
    if (!s || !s.telemetry) return;
    const t = s.telemetry;
    lastTelemetry = t;
    if (authed && t.faculty && (!renderedHistorySig || !renderedHistorySig.startsWith(t.faculty + ":"))) {
      loadHistory(t.faculty);
    }
    applyViewMode(deriveViewMode(t));

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
    els.channelTitle.textContent = fac ? channelNameFor(fac) : "general";
    const courseProgress = t.active_course_progress;
    const courseStatus = courseProgress
      ? courseStatusText(courseProgress)
      : (t.current_grade ? "Grade " + t.current_grade : "settling in");
    els.channelSub.textContent = fac
      ? fac.displayName + " · " + courseStatus
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
        } else {
          applyRevealToBlackboard(t.lastReveal);
          appendResultChip(t.lastReveal);
        }
        showCongrats(t.lastReveal.encouragement, t.lastReveal.wasCorrect);
        scheduleStudentChime(t.lastReveal.wasCorrect, t.current_grade);
        // Teacher reacts + queues next question. Small delay so the
        // congrats toast lands first and the chat doesn't feel stacked.
        // force=true: bypass the agentBusy guard. If a prior turn's SSE
        // stream stuck (network drop, server hang), agentBusy stays true
        // and answer-graded gets silently dropped — leaving the player
        // staring at a revealed answer with no next question. The teacher
        // reaction is the thing that unsticks the flow; never gate it.
        maybeRunAnswerGraded(t, 600);
      }
    } else if (!t.current && lastRevealId) {
      lastRevealId = null;
      lastAnswerGradedTriggerId = null;
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

    // First-launch character creation: open sheet overlay automatically — but
    // only once the player is signed in to OpenRouter. Otherwise the chat
    // panel's sign-in CTA is the priority; we don't want to dangle a Roll
    // button at someone who can't actually use it.
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

  function appendProgression(parent, progression) {
    if (!progression || !Array.isArray(progression.rungs)) return;
    const ROW_GRADE_LABELS = {
      "9": "Fresh",
      "10": "Soph",
      "11": "Junior",
      "12": "Senior",
    };
    const CLASS_GATE_META = [
      { facultyId: "ruby", label: "Homeroom", icon: "⌂" },
      { facultyId: "sally-science", label: "Science", icon: "⚗" },
      { facultyId: "professor-edward", label: "Literature", icon: "✎" },
    ];
    const makeGradeChip = (spec) => {
      const grade = spec.grade || "F";
      const met = spec.met !== undefined ? !!spec.met : (grade === "✓" || letterGradePasses(grade));
      const chip = document.createElement("span");
      chip.className = "class-grade-chip" + (met ? " is-met" : "");
      chip.title = grade === "—"
        ? spec.label + ": no class grade yet"
        : spec.label + ": " + grade + (met ? " complete" : " needs C and daily classes");
      chip.setAttribute("aria-label", chip.title);
      const icon = document.createElement("span");
      icon.className = "class-grade-icon";
      icon.textContent = spec.icon;
      const letter = document.createElement("span");
      letter.className = "class-grade-letter";
      letter.textContent = grade;
      chip.appendChild(icon);
      chip.appendChild(letter);
      return chip;
    };
    const makeGateRing = (spec) => {
      const have = Number(spec.have || 0);
      const need = Number(spec.need || 0);
      const remaining = Math.max(0, need - have);
      const met = remaining <= 0;
      const pct = need > 0 ? Math.max(0, Math.min(1, have / need)) : 1;
      const ring = document.createElement("span");
      ring.className = "gate-ring"
        + (spec.kind ? " " + spec.kind + "-ring" : "")
        + (met ? " is-met" : "");
      ring.style.setProperty("--pct", String(Math.round(pct * 100)) + "%");
      const titleUnit = remaining === 1 ? spec.unit : (spec.pluralUnit || spec.unit);
      ring.title = met
        ? spec.label + " complete"
        : spec.label + ": " + remaining + " " + titleUnit + " left";
      ring.setAttribute("aria-label", ring.title);
      const core = document.createElement("span");
      core.className = "gate-core";
      const icon = document.createElement("span");
      icon.className = "gate-icon";
      icon.textContent = spec.icon;
      core.appendChild(icon);
      if (!met && remaining > 0) {
        const count = document.createElement("span");
        count.className = "gate-count";
        count.textContent = String(remaining);
        core.appendChild(count);
      }
      ring.appendChild(core);
      return ring;
    };
    const makeStreakMark = (r) => {
      const need = Math.max(1, Number((r.streakProgress && r.streakProgress.need) || r.streakReq || 1));
      const have = Math.max(0, Number((r.streakProgress && r.streakProgress.have) || 0));
      const mark = document.createElement("span");
      mark.className = "rung-streak";
      const dayUnit = need === 1 ? "day" : "days";
      mark.title = r.state === "current"
        ? "School-day streak: " + Math.min(have, need) + "/" + need
        : need + " school-day streak " + dayUnit;
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
    head.textContent = progression.graduated ? "Yearbook" : "Class Schedule";
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
            const meta = CLASS_GATE_META.find((m) => m.facultyId === cp.facultyId)
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
          for (const meta of CLASS_GATE_META) {
            gates.appendChild(makeGradeChip({
              label: meta.label,
              icon: meta.icon,
              grade: "—",
            }));
          }
        }
      } else {
        if (r.state === "completed") {
          for (const meta of CLASS_GATE_META) {
            gates.appendChild(makeGradeChip({
              label: meta.label,
              icon: meta.icon,
              grade: "✓",
            }));
          }
        } else {
          for (const meta of CLASS_GATE_META) {
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
    sheetCard.innerHTML = "";
    const card = buildCharacterCard(spec);
    if (card) sheetCard.appendChild(card);
  }

  function renderCardDeck(cardNodes) {
    sheetCard.classList.add("is-card-deck-sheet");
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
    // rivalry surface — what year they're on, what their streak looks
    // like, whether they've already graduated past you.
    const arc = (lastTelemetry && lastTelemetry.npc_cohort)
      ? lastTelemetry.npc_cohort.find((n) => n.id === npc.id)
      : null;
    const arcLine = !arc
      ? (GRADE_LABELS[npc.grade] || npc.grade)
      : arc.graduated
        ? "Graduated · " + arc.completedGrades.length + " years"
        : (GRADE_LABELS[arc.grade] || arc.grade) + " · streak " + arc.streak.count;
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
    return TEACHER_STATS[facultyId] || { head: 2, heart: 1, hustle: 1, honor: 1 };
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
    return teacherAssetUrl(facultyId, "full");
  }
  function buildTeacherProfileCard(fac) {
    const subjectLine = TEACHER_SUBJECT_LINE[fac.id] || (Array.isArray(fac.subjects) ? fac.subjects.join(", ") : fac.bio);
    return buildCharacterCard({
      role: "teacher",
      name: fac.displayName,
      subtitle: subjectLine,
      portraitUrl: teacherFullPortraitUrl(fac.id),
      accent: fac.accent,
      stats: teacherStatsFor(fac.id),
      quote: TEACHER_SIGNATURE[fac.id] || fac.bio,
      footer: { title: "Teaches", content: subjectLine },
      // Close lives in the overlay corner now (X), so no per-card button.
    });
  }
  function buildTeacherCareerCard(fac) {
    return buildProfileCareerCard({
      badgeLabel: "faculty",
      subtitle: "Faculty · graduated",
      metrics: [
        { label: "status", value: "graduated", detail: "four-year arc complete", met: true },
        { label: "yearbook", value: "4/4", detail: "paper cards sealed", met: true },
        { label: "questions", value: String(fac.questionCount || 0), detail: "in this pack", met: false },
      ],
      progression: buildCompletedHighSchoolProgression(),
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
            { label: "streak", value: streakHere + "/" + streakReq, detail: "school days", met: streakHere >= streakReq },
            { label: "room", value: roomLabelFor(npc.currentRoom), detail: "current class", met: false },
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
    nameEl.textContent = "School Career";
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
    streakLabel.textContent = "Streak";
    streak.appendChild(streakLabel);
    const streakTrack = document.createElement("span");
    streakTrack.className = "career-streak-track";
    const diamonds = document.createElement("span");
    diamonds.className = "career-diamonds";
    const streakCap = Math.max(0, spec.streakReq || 0);
    const currentStreak = Math.max(0, spec.streakHere || 0);
    const scoreStreak = spec.streakLastDate && spec.todayKey && spec.streakLastDate === spec.todayKey
      ? Math.max(0, currentStreak - 1)
      : currentStreak;
    const streakFilled = Math.max(0, Math.min(streakCap, currentStreak));
    for (let i = 0; i < streakCap; i++) {
      const diamond = document.createElement("span");
      diamond.className = "career-diamond" + (i < streakFilled ? " is-filled" : "");
      diamond.setAttribute("aria-label", i < streakFilled ? "Streak day complete" : "Streak day needed");
      diamonds.appendChild(diamond);
    }
    const boosts = document.createElement("span");
    boosts.className = "career-multipliers";
    [
      { streak: 2, label: "×2" },
      { streak: 3, label: "×3" },
      { streak: 4, label: "Fri ×5" },
    ].forEach((boost) => {
      const chip = document.createElement("span");
      const live = scoreStreak >= boost.streak;
      chip.className = "career-multiplier" + (live ? " is-live" : "");
      chip.textContent = boost.label;
      chip.setAttribute("aria-label", live
        ? boost.label + " score boost active"
        : boost.label + " score boost unlocks after a " + boost.streak + "-day streak");
      boosts.appendChild(chip);
    });
    streakTrack.appendChild(diamonds);
    streakTrack.appendChild(boosts);
    streak.appendChild(streakTrack);
    const streakCount = document.createElement("span");
    streakCount.className = "career-token-count";
    const carriedMult = streakScoreMultiplier(scoreStreak);
    streakCount.textContent = streakFilled + "/" + streakCap + (carriedMult > 1 ? " · ×" + carriedMult : "");
    streak.appendChild(streakCount);
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
    advantageCount.textContent = remaining + "/" + dieCap;
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
  // Mandatory sign-in surface. Lifecycle: shown whenever authed === false;
  // hidden whenever authed === true. No dismiss affordance — there is
  // nothing else to do in the app while unauthed.
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
  //   1. Daily class — one passed class can tick the school-day streak.
  //   2. Streak — consecutive school days with at least one passed class.
  //   3. Class grades — each teaching room must be brought to C or better.
  // The hint surfaces the most-blocking gate as one short sentence.
  function buildNextStepHint(c) {
    if (!c) return "";
    if (graduatedFor(c)) return "You graduated. Keep playing if you want; the arc is done.";
    const t = lastTelemetry || {};
    if (t.graduation_ready || c.pendingGraduation) {
      return "Requirements complete — attend the ceremony and choose your level-up reward.";
    }
    const grade = String(t.current_grade ?? "9");
    const streakReq = STREAK_REQUIRED[grade] || 1;
    const streakHere = c.streak && c.streak.grade === grade ? c.streak.count : 0;
    const streakLastDate = c.streak && c.streak.grade === grade ? c.streak.lastDate : "";
    const todayKey = (t.daily && t.daily.dailyKey) || "";
    const todayKey = (t.daily && t.daily.dailyKey) || "";
    const todayDone = !!(c.streak && c.streak.grade === grade && c.streak.lastDate === todayKey);
    const ROOM_LABEL = { ruby: "homeroom", "sally-science": "Sally's class", "professor-edward": "Edward's class" };

    const streakNeeded = Math.max(0, streakReq - streakHere);
    const classGaps = classGradeSummary().grades
      .filter((x) => !letterGradePasses(x.grade));

    const parts = [];
    if (streakNeeded > 0 && !todayDone) {
      parts.push("Complete one daily class at C or better to grow your streak (" + streakHere + "/" + streakReq + ")");
    } else if (streakNeeded > 0) {
      parts.push("Streak banked for this school day — " + streakHere + "/" + streakReq + ", come back tomorrow");
    }
    if (classGaps.length > 0) {
      const segs = classGaps.map((cg) => (ROOM_LABEL[cg.facultyId] || cg.facultyId) + " (" + cg.grade + ")");
      parts.push("Complete each daily class at C or better: " + segs.join(", "));
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
  // the character sheet. Each rung names the gates (streak + class credit) so the
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
        classProgress = classGradeSummary().grades;
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
  function buildGraduationCeremony(c, grade) {
      const ready = (lastTelemetry && lastTelemetry.graduation_ready) || c.pendingGraduation;
      if (!ready) return null;
      const next = nextGradeAfterClient(grade);
      const targetLabel = next ? (GRADE_LABELS[next] || ("Grade " + next)) : "graduate";
      const wrap = document.createElement("div");
      wrap.className = "graduation-ceremony";

      const title = document.createElement("div");
      title.className = "graduation-title";
      title.textContent = next ? "Advance to " + targetLabel : "Graduation Ceremony";
      wrap.appendChild(title);

      const note = document.createElement("div");
      note.className = "graduation-note";
      note.textContent = "Requirements complete. Choose one level-up reward to seal the yearbook.";
      wrap.appendChild(note);

      const status = document.createElement("div");
      status.className = "graduation-status";
      wrap.appendChild(status);

      const groups = document.createElement("div");
      groups.className = "graduation-groups";
      wrap.appendChild(groups);

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
      const addGroup = (label) => {
        const group = document.createElement("div");
        group.className = "graduation-group";
        const h = document.createElement("div");
        h.className = "graduation-group-label";
        h.textContent = label;
        group.appendChild(h);
        const row = document.createElement("div");
        row.className = "graduation-choice-row";
        group.appendChild(row);
        groups.appendChild(group);
        return row;
      };
      const addChoice = (row, label, detail, reward, disabled) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "graduation-choice";
        btn.disabled = !!disabled;
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

      const statRow = addGroup("+1 to a stat");
      ["head", "heart", "hustle", "honor"].forEach((stat) => {
        const value = (c.stats && typeof c.stats[stat] === "number") ? c.stats[stat] : 0;
        addChoice(statRow, fmtRewardStat(stat, value), value >= 3 ? "already capped" : "cap +3", { kind: "stat", stat }, value >= 3);
      });

      const advRow = addGroup("Extra advantage");
      addChoice(advRow, "+1 die", next ? "for " + targetLabel + " year" : "for post-grad play", { kind: "advantage" }, false);

      const affinityRow = addGroup("Class affinity");
      TEACHING_FACULTY_IDS.forEach((fid) => {
        addChoice(affinityRow, facultyLabel(fid), "first miss counts once", { kind: "affinity", facultyId: fid }, false);
      });
      return wrap;
    }

  function renderSheetReadonly(c, playbooks) {
    // Current character-sheet model:
    //   CHARACTER CARD — stable identity: portrait/diploma, playbook,
    //     stats, quote, and starting move. It upgrades at graduation.
    //   SCHOOL CAREER CARD — live dashboard: grade, streak, class
    //     gates, advantage budget, and next-step hint.
    //   SEALED YEARS — frozen snapshots of past years. They sit behind the
    //     current character card as a collapsed yearbook stack, then accordion
    //     open when clicked.
    //
    // Layout: the carousel only carries the two active surfaces: Character
    // Card + School Career Card. Sealed prior years live inside the Character
    // Card so they read as history behind the current year instead of a third
    // competing card.
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
    card.classList.add("is-character-card");
    if (graduated) card.classList.add("is-graduated");
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
    const classes = classGradeSummary();
    const gradeLine = classes.grades.map((g) => g.grade).join(" ");
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
      // live gates compact: diamonds for the grade streak, boost chips for
      // post-streak scoring, and dice for advantage.
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

      const ceremony = !graduated ? buildGraduationCeremony(c, grade) : null;
      if (ceremony) {
        body.appendChild(ceremony);
      }

      const hint = buildNextStepHint(c);
      if (hint && !ceremony) {
        const ns = document.createElement("div");
        ns.className = "ccg-next-step";
        ns.textContent = hint;
      body.appendChild(ns);
    }

    appendProgression(body, buildProgressionForCharacter(c));
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

  // Random-roll character creation. The player INHABITS an AI student rather
  // than building one. Server picks playbook + stats; LLM fills in the
  // name/hook/personality. Each component has a small ↻ reroll button so the
  // player can lock in the parts they like and cycle the rest.
  //
  // Auth invariant: this function only runs when authed === true. The
  // unauth surface is the mandatory #signin-overlay shown by deriveAuth();
  // the sheet overlay is suppressed entirely while signed out, so there is
  // no unauth branch to render here.
  function renderSheetCreation(playbooks) {
    sheetCard.classList.remove("is-card-deck-sheet");
    sheetCard.classList.remove("is-two-card-deck");
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

    const h = document.createElement("h2");
    h.textContent = "Welcome to Ruby High";
    h.style.display = "none"; // hidden during loading; revealed when rolled lands
    sheetCard.appendChild(h);
    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = "You're inhabiting an AI student. Lock in the parts that fit; reroll the rest.";
    sub.style.display = "none";
    sheetCard.appendChild(sub);

    // Two-column wrap: portrait on the left, rerollable fields on the
    // right. Stacks on mobile (CSS handles the breakpoint). Each side
    // builds independently below.
    const card = document.createElement("div");
    card.className = "creation-card";
    card.style.display = "none";
    sheetCard.appendChild(card);

    // Portrait section — default-pack PNG by playbook, plus an opt-in
    // "✨ Generate AI portrait" button that swaps in a custom image.
    const portraitWrap = document.createElement("div");
    portraitWrap.className = "creation-portrait";
    card.appendChild(portraitWrap);
    const portraitImg = document.createElement("img");
    portraitImg.alt = "";
    portraitWrap.appendChild(portraitImg);
    const portraitBtn = document.createElement("button");
    portraitBtn.type = "button";
    portraitBtn.className = "creation-ai-portrait";
    portraitBtn.textContent = "✨ Generate AI portrait";
    portraitWrap.appendChild(portraitBtn);
    const portraitStatus = document.createElement("div");
    portraitStatus.className = "creation-portrait-status";
    portraitWrap.appendChild(portraitStatus);

    // Form rows: one per component. Each row has a reroll button that
    // re-fires /chat/character/generate with regen=[<field>], keep=<rest>.
    const fields = document.createElement("div");
    fields.className = "creation-fields";
    card.appendChild(fields);

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
    status.style.display = "none";
    sheetCard.appendChild(status);

    // Actions — single primary button. No "Reroll all" because each
    // field has its own reroll. If the player wants a clean slate they
    // can spam ↻ on every row.
    const actions = document.createElement("div");
    actions.className = "sheet-actions";
    actions.style.display = "none";
    const acceptBtn = document.createElement("button");
    acceptBtn.textContent = "Lock it in";
    acceptBtn.disabled = true;
    actions.appendChild(acceptBtn);
    sheetCard.appendChild(actions);

    // Reveal the form (and hide the loading state) once the first
    // roll lands. Subsequent component-rerolls don't re-trigger this.
    function revealForm() {
      loading.style.display = "none";
      h.style.display = "";
      sub.style.display = "";
      card.style.display = "";
      status.style.display = "";
      actions.style.display = "";
    }

    let rolled = null;
    // Per-component in-flight flags so the user can mash multiple rerolls
    // and the buttons disable independently. Module-scope portraitInFlight
    // is gone in this PR.
    const inFlight = { all: false, name: false, personality: false, arcAnswer: false, flavorQuote: false, stats: false, playbook: false, portrait: false };
    let aiPortraitDataUrl = null; // when set, replaces the default at accept-time

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
      portraitBtn.disabled = !rolled || inFlight.portrait;
    }

    function renderRolled(c) {
      const pb = playbooks.find((p) => p.id === c.playbookId) || { name: c.playbookId, startingMove: { name: "—", description: "" } };
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
        // Auto-pose the first question so the new player lands on a
        // live board instead of an empty chalkboard with the cryptic
        // "the teacher will write a question on the board in a moment."
        // The default faculty after createCharacter is "ruby" (homeroom),
        // and command({type:"pick"}) draws the first class question.
        try { await command({ type: "pick" }); }
        catch { /* swallow — empty board is the worst case, not a crash */ }
      } else {
        applyDisabled();
        setStatus("Save failed — try again.", true);
      }
    });

    // Auto-roll on first open. By the time we get here authed is guaranteed
    // true (the unauth branch returned above).
    rollComponents();
  }
  sheetEl.addEventListener("click", (e) => { if (e.target === sheetEl) closeSheet(); });
  // Universal close affordance — replaces every per-card "Close" button.
  // The X is absolutely positioned in the overlay corner (CSS), so it
  // tracks the overlay rather than any individual card variant.
  const sheetCloseBtn = $("sheet-close");
  if (sheetCloseBtn) sheetCloseBtn.addEventListener("click", closeSheet);

  // ── pack store overlay (Anki import + pack switcher) ────────────────────
  const packEl = $("pack-overlay");
  const packListEl = $("pack-list");
  const packFileInput = $("pack-anki-file");
  const packTeacherSelect = $("pack-teacher-select");
  const packImportBtn = $("pack-import-btn");
  const packCloseBtn = $("pack-close-btn");
  const packStatusEl = $("pack-import-status");
  const packBtn = $("pack-btn");
  const BUILTIN_IMPORT_TEACHERS = [
    { id: "ruby", name: "Ruby" },
    { id: "sally-science", name: "Sally Science" },
    { id: "professor-edward", name: "Professor Edward" },
  ];

  function openPackStore() {
    packEl.classList.add("is-open");
    renderPackTeacherOptions();
    renderPackList();
  }
  function closePackStore() {
    packEl.classList.remove("is-open");
    packStatusEl.textContent = "";
    packStatusEl.classList.remove("is-invalid");
  }
  function renderPackList() {
    const t = lastTelemetry || {};
    const packs = t.available_packs || [];
    const activeId = t.active_pack && t.active_pack.id;
    packListEl.innerHTML = "";
    if (packs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sub";
      empty.textContent = "No packs registered yet.";
      packListEl.appendChild(empty);
      return;
    }
    for (const p of packs) {
      const row = document.createElement("div");
      row.className = "pack-row" + (p.id === activeId ? " is-active" : "");
      const body = document.createElement("div");
      body.className = "pack-body";
      const name = document.createElement("div");
      name.className = "pack-name";
      name.textContent = p.name;
      const meta = document.createElement("div");
      meta.className = "pack-meta";
      meta.textContent = (p.faculty_count || 0) + " faculty · " + (p.question_count || 0) + " questions" + (p.description ? " — " + p.description : "");
      body.appendChild(name);
      body.appendChild(meta);
      row.appendChild(body);
      if (p.id === activeId) {
        const tag = document.createElement("span");
        tag.className = "pack-active-tag";
        tag.textContent = "Active";
        row.appendChild(tag);
      } else {
        row.addEventListener("click", () => switchPack(p.id));
      }
      packListEl.appendChild(row);
    }
  }
  function renderPackTeacherOptions() {
    if (!packTeacherSelect) return;
    const previous = packTeacherSelect.value || "ruby";
    packTeacherSelect.innerHTML = "";
    for (const teacher of BUILTIN_IMPORT_TEACHERS) {
      const opt = document.createElement("option");
      opt.value = teacher.id;
      opt.textContent = teacher.name;
      packTeacherSelect.appendChild(opt);
    }
    packTeacherSelect.value = BUILTIN_IMPORT_TEACHERS.some((t) => t.id === previous) ? previous : "ruby";
  }
  async function switchPack(packId) {
    packStatusEl.textContent = "Switching…";
    packStatusEl.classList.remove("is-invalid");
    try {
      const r = await fetch("/api/apps/ruby-high/packs/active", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.status }));
        throw new Error(err.error || "switch " + r.status);
      }
      packStatusEl.textContent = "Active pack switched. Reloading…";
      // Pack swap blew away faculty + question banks; safest bet is a clean
      // reload so the channels rail + chalkboard rebuild against the new pack.
      setTimeout(() => window.location.reload(), 300);
    } catch (err) {
      packStatusEl.textContent = "Couldn't switch · " + (err && err.message ? err.message : "error");
      packStatusEl.classList.add("is-invalid");
    }
  }
  packFileInput.addEventListener("change", () => {
    const file = packFileInput.files && packFileInput.files[0];
    packImportBtn.disabled = !file;
    if (file) packStatusEl.textContent = file.name + " — " + Math.round(file.size / 1024) + " KB";
  });
  packImportBtn.addEventListener("click", async () => {
    const file = packFileInput.files && packFileInput.files[0];
    if (!file) return;
    packImportBtn.disabled = true;
    packFileInput.disabled = true;
    packStatusEl.textContent = "Reading file…";
    packStatusEl.classList.remove("is-invalid");
    try {
      const buf = await file.arrayBuffer();
      const b64 = bytesToBase64(new Uint8Array(buf));
      packStatusEl.textContent = "Parsing + generating distractors (~$0.05, ~30s)…";
      // Use apiFetch — the server-side import handler reads the OpenRouter
      // key from X-Openrouter-Key (it pays for the distractor LLM calls).
      // Plain fetch() would skip the header and the import would 400 with
      // "OpenRouter API key required."
      const teacherId = packTeacherSelect && packTeacherSelect.value ? packTeacherSelect.value : "ruby";
      const r = await apiFetch("/api/apps/ruby-high/packs/import-anki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, data: b64, maxCards: 50, teacherId }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.status }));
        throw new Error(err.error || "import " + r.status);
      }
      const data = await r.json();
      const skipped = data.skipped || 0;
      const imported = data.pack && data.pack.question_count;
      packStatusEl.textContent = "Imported " + imported + " questions" + (skipped > 0 ? " (" + skipped + " skipped)" : "") + ". Reloading…";
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      packStatusEl.textContent = "Import failed · " + (err && err.message ? err.message : "error");
      packStatusEl.classList.add("is-invalid");
      packImportBtn.disabled = false;
      packFileInput.disabled = false;
    }
  });
  packCloseBtn.addEventListener("click", closePackStore);
  packEl.addEventListener("click", (e) => { if (e.target === packEl) closePackStore(); });
  packBtn.addEventListener("click", openPackStore);
  function bytesToBase64(bytes) {
    // Avoid String.fromCharCode(...bytes) overflow on big files by chunking.
    let s = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(s);
  }

  // ── student chime ─────────────────────────────────────────────────────────
  // When authed, fire the LLM-backed /chat/student-chime endpoint so the AI
  // students respond in their own voice. Falls back to canned lines when the
  // user isn't signed in.
  let lastChimeAt = 0;
  function studentChimeAllowed() {
    const now = Date.now();
    if (now - lastChimeAt < 5000) return false;
    lastChimeAt = now;
    return true;
  }
  async function fireStudentChime({ situation, note, grade, faculty, delayMs, studentId, bypassCooldown, playerText }) {
    if (!bypassCooldown && !studentChimeAllowed()) return;
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
    if (!who) return;
    if (!authed) {
      const fallback = situation === "answer-correct"
        ? pickRandom(STUDENT_LINES_RIGHT)
        : situation === "answer-wrong"
          ? pickRandom(STUDENT_LINES_WRONG)
          : pickRandom(STUDENT_LINES_GREET);
      setTimeout(() => {
        if (chimeStillCurrent()) appendMsg({ kind: "student", name: who.name, body: fallback, color: who.color, studentId: who.id });
      }, delayMs ?? 700);
      return;
    }
    const wait = delayMs ?? (700 + Math.random() * 800);
    setTimeout(async () => {
      try {
        const r = await apiFetch("/api/apps/ruby-high/chat/student-chime", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: who.id, situation, note, faculty, playerText }),
        });
        if (!r.ok) throw new Error("student " + r.status);
        const data = await r.json();
        const line = (data && data.line) || pickRandom(STUDENT_LINES_GREET);
        if (chimeStillCurrent()) appendMsg({ kind: "student", name: who.name, body: line, color: who.color, studentId: who.id });
      } catch (err) {
        // Fallback to canned line if the API call fails.
        const fallback = situation === "answer-correct" ? pickRandom(STUDENT_LINES_RIGHT) : pickRandom(STUDENT_LINES_WRONG);
        if (chimeStillCurrent()) appendMsg({ kind: "student", name: who.name, body: fallback, color: who.color, studentId: who.id });
      }
    }, wait);
  }
  function scheduleStudentChime(wasCorrect, grade) {
    fireStudentChime({
      situation: wasCorrect ? "answer-correct" : "answer-wrong",
      note: wasCorrect
        ? "Player just got the question right."
        : "Player just got the question wrong.",
      grade,
      faculty: lastTelemetry && lastTelemetry.faculty,
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
  function setAuthState(next) {
    if (next === lastAuthState) return;
    const wasSignedIn = lastAuthState === true;
    lastAuthState = next;
    authed = next;
    applyAuthUI();
    // Sign-in overlay is the unconditional unauth surface. Anywhere we
    // discover the user is unauthed, this overlay must be visible and
    // every other modal must be closed — there is exactly one screen
    // when signed out, and it is the sign-in screen.
    if (authed === false) {
      signinEl.classList.add("is-open");
      signinEl.setAttribute("aria-hidden", "false");
      if (sheetOverlayOpen) closeSheet();
    } else {
      signinEl.classList.remove("is-open");
      signinEl.setAttribute("aria-hidden", "true");
    }
    if (authed && lastTelemetry) loadHistory(lastTelemetry.faculty);
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
  async function deriveAuth() {
    const key = getStoredApiKey();
    const seq = ++authCheckSeq;
    if (!key) {
      setAuthState(false);
      return;
    }
    try {
      const headers = new Headers();
      headers.set("X-Openrouter-Key", key);
      const r = await fetch("/api/apps/ruby-high/auth/me", {
        credentials: "same-origin",
        headers,
      });
      const data = await r.json().catch(() => ({}));
      if (seq !== authCheckSeq) return;
      if (r.ok && data && data.authed) {
        setAuthState(true);
      } else {
        clearStoredAuth();
        setAuthState(false);
      }
    } catch (_e) {
      if (seq !== authCheckSeq) return;
      if (lastAuthState === null) setAuthState(false);
    }
  }
  function applyAuthUI() {
    els.checking.hidden = authed !== null;
    if (authed === null) {
      els.chatForm.hidden = true;
      els.checking.hidden = false;
      els.youState.textContent = "checking…";
      els.footerAction.hidden = true;
      return;
    }
    if (authed) {
      els.youState.textContent = "signed in";
      els.footerAction.textContent = "Sign out";
      els.footerAction.hidden = false;
      els.chatForm.hidden = false;
      els.chatInput.disabled = false;
      els.chatSend.disabled = false;
    } else {
      // Unauthed: the mandatory sign-in overlay is the only thing the user
      // can see. No "Sign in" button on the chrome — the chrome is
      // hidden behind the overlay anyway, and a sign-in button that opens
      // a sign-in overlay is exactly the cruft we tore out. Footer button
      // exists ONLY as the sign-out affordance.
      els.youState.textContent = "signed out";
      els.footerAction.hidden = true;
      els.chatForm.hidden = true;
      els.chatInput.disabled = true;
      els.chatSend.disabled = true;
    }
    // Re-render the blackboard so its visibility flips with auth state.
    if (lastTelemetry) {
      const fac = (lastTelemetry.faculty_roster || []).find((f) => f.id === lastTelemetry.faculty);
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
    authed = false;
    lastAuthState = false;
    applyAuthUI();
    if (lastTelemetry) loadHistory(lastTelemetry.faculty);
  }
  async function loadHistory(facultyId) {
    if (!authed || !facultyId) return;
    const requestSeq = chatViewSeq;
    try {
      const r = await apiFetch("/api/apps/ruby-high/chat/history?faculty=" + encodeURIComponent(facultyId));
      const data = await r.json();
      if (requestSeq !== chatViewSeq || !lastTelemetry || lastTelemetry.faculty !== facultyId) return;
      authed = !!data.authed;
      const msgs = data.history || [];
      const sig = facultyId + ":" + playerMessageIdentitySig() + ":" + msgs.length;
      if (sig === renderedHistorySig) return;
      renderedHistorySig = sig;
      els.stream.innerHTML = "";
      streamingMsgEl = null;
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
    const blockedByActiveBoard = /Question already (on|posted by).*board|wait for the student answer/i.test(errorText);
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
    if (!opts) return true;
    if (opts.viewSeq !== chatViewSeq) return false;
    if (!opts.facultyId || !lastTelemetry) return true;
    return lastTelemetry.faculty === opts.facultyId;
  }
  async function consumeSseStream(response, opts) {
    if (!response.ok || !response.body) {
      const err = await response.json().catch(() => ({ error: response.status }));
      if (chatStreamStillCurrent(opts)) appendSystem("chat error · " + (err.error || response.status));
      return;
    }
    streamingMsgEl = null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    // Default speaker = current channel's teacher; overridden by speaker events.
    let speaker = teacherInfo(lastTelemetry && lastTelemetry.faculty);
    let buf = "";
    // Hard ceiling: if the server hangs or the connection drops without a
    // proper close, the loop below would await reader.read() forever and
    // hold the agentBusy lock forever. Cancel after 45s so the surrounding
    // try/finally always reaches its release.
    const watchdog = setTimeout(() => { try { reader.cancel(); } catch { /* ignore */ } }, 45000);
    try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let frameEnd;
      while ((frameEnd = buf.indexOf("\\n\\n")) !== -1) {
        const frame = buf.slice(0, frameEnd);
        buf = buf.slice(frameEnd + 2);
        const lines = frame.split(/\\r?\\n/);
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }
        const currentStream = chatStreamStillCurrent(opts);
        if (event === "speaker") {
          if (!currentStream) continue;
          speaker = teacherInfo(parsed.facultyId);
          streamingMsgEl = null; // force a new bubble for the new speaker
        } else if (event === "delta") {
          if (!currentStream) continue;
          if (!streamingMsgEl) {
            streamingMsgEl = appendMsg({ kind: "teacher", name: speaker.name, body: "", color: speaker.accent, facultyId: speaker.facultyId });
          }
          streamingMsgEl.dataset.markdownRaw = (streamingMsgEl.dataset.markdownRaw || "") + (parsed.text || "");
          renderMarkdownInto(streamingMsgEl, streamingMsgEl.dataset.markdownRaw);
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
          if (!currentStream) continue;
          appendTool(toolSummary(parsed, teacherName));
          fetchSession();
          streamingMsgEl = null;
        } else if (event === "error") {
          if (!currentStream) continue;
          appendSystem("error · " + (parsed.message || "unknown"));
          streamingMsgEl = null;
        }
      }
    }
    } finally {
      clearTimeout(watchdog);
    }
  }

  async function sendChatMessage(text) {
    if (!authed || !text.trim()) return;
    if (agentBusy) return;
    agentBusy = true;
    const busySeq = ++agentBusySeq;
    const targetFaculty = (lastTelemetry && lastTelemetry.faculty) || "ruby";

    // If an opinion question is active and the player hasn't submitted their
    // response yet, route this chat message to /chat/opinion-submit instead
    // of the regular agent loop.
    const inOpinion = !!(lastTelemetry && lastTelemetry.is_opinion && lastTelemetry.active_round && !lastTelemetry.active_round.resolved && !opinionSubmitted);

    appendMsg({ kind: "you", name: playerDisplayName(), body: text, color: "var(--accent)" });
    const streamGuard = { viewSeq: chatViewSeq, facultyId: targetFaculty };

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
    els.chatInput.disabled = true;
    els.chatSend.disabled = true;
    try {
      let r;
      if (inOpinion) {
        opinionSubmitted = true;
        r = await apiFetch("/api/apps/ruby-high/chat/opinion-submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      } else {
        r = await apiFetch("/api/apps/ruby-high/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ faculty: targetFaculty, message: text }),
        });
      }
      await consumeSseStream(r, streamGuard);
    } catch (err) {
      if (chatStreamStillCurrent(streamGuard)) appendSystem("chat failed · " + (err && err.message ? err.message : "error"));
    } finally {
      if (agentBusySeq === busySeq) agentBusy = false;
      els.chatInput.disabled = !authed;
      els.chatSend.disabled = !authed;
      els.chatInput.focus();
      if (chatStreamStillCurrent(streamGuard) && Math.random() < 0.4) {
        fireStudentChime({
          situation: "teacher-replied-to-player",
          note: "Teacher just replied to the player. Riff briefly.",
          grade: lastTelemetry && lastTelemetry.current_grade,
          faculty: lastTelemetry && lastTelemetry.faculty,
          delayMs: 1200 + Math.random() * 1500,
        });
      }
    }
  }

  // Teacher-driven turn — fires when a state event happens (channel enter,
  // answer graded). The teacher decides what to say and whether to put a new
  // question on the board via tool calls.
  // opts.force = true bypasses the agentBusy guard. Used for user-initiated
  // transitions (room switch, lounge entry, grade selection) — blocking the
  // user while the previous teacher is still streaming is the antipattern
  // we're stepping away from. Eventually the busy concept moves chat-side
  // (group-chat semantics — multiple speakers, no global lock); this flag
  // is the transitional shape.
  async function runAgentTurn(trigger, context, opts) {
    if (!authed) return;
    const force = !!(opts && opts.force);
    if (!force && agentBusy) return;
    const targetFaculty = (lastTelemetry && lastTelemetry.faculty) || "ruby";
    const triggerKey = trigger + "::" + targetFaculty + "::" + ((context && context.grade) || "?");
    // Channel-enter dedupes per (grade, faculty); answer-graded fires every time.
    if (trigger === "channel-enter" && triggerKey === lastAgentTrigger) return;
    lastAgentTrigger = triggerKey;
    agentBusy = true;
    const busySeq = ++agentBusySeq;
    const streamGuard = { viewSeq: chatViewSeq, facultyId: targetFaculty };
    try {
      const r = await apiFetch("/api/apps/ruby-high/chat/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faculty: targetFaculty, trigger, context: context || {} }),
      });
      await consumeSseStream(r, streamGuard);
    } catch (err) {
      if (chatStreamStillCurrent(streamGuard)) appendSystem("teacher offline · " + (err && err.message ? err.message : "error"));
    } finally {
      if (agentBusySeq === busySeq) agentBusy = false;
    }
  }

  async function fetchSession() {
    // Snapshot the command seq at request start. If a command lands while
    // we're waiting on the network, our GET's response is from BEFORE the
    // command's mutation — discard rather than overwrite the fresh state
    // the command response already rendered.
    const seqAtStart = commandSeq;
    try {
      const r = await fetch(sessionUrl, { credentials: "same-origin" });
      if (!r.ok) throw new Error("session " + r.status);
      const s = await r.json();
      if (lastSettledCommandSeq > seqAtStart) return;
      render(s);
    } catch { /* ignore */ }
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
    try {
      const r = await apiFetch("/api/apps/ruby-high/chat/opinion-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      await consumeSseStream(r);
    } catch (err) {
      appendSystem("grading failed · " + (err && err.message ? err.message : "error"));
    }
  }

  // ── wire ─────────────────────────────────────────────────────────────────
  els.answers.forEach((btn) => {
    btn.addEventListener("click", () => pickAnswer(btn.dataset.pick, btn));
  });
  els.nextBtn.addEventListener("click", pickNext);
  els.hamburger.addEventListener("click", toggleRails);
  els.scrim.addEventListener("click", closeRails);
  els.homeBtn.addEventListener("click", openRails);
  els.footerAction.addEventListener("click", () => {
    // Footer button is sign-out only. The unauthed surface is the
    // mandatory #signin-overlay shown by deriveAuth — never reached
    // through a button on the chrome.
    if (authed) logout();
  });

  // ── bug-report surface ─────────────────────────────────────────────────
  // Capture the last few console errors + unhandled rejections so the
  // GitHub-issue prefill includes them. Limit to a small ring buffer
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

  els.reportBugLink.addEventListener("click", () => {
    const ch = lastTelemetry && lastTelemetry.character;
    const grade = lastTelemetry && lastTelemetry.current_grade;
    const faculty = lastTelemetry && lastTelemetry.faculty;
    // Markdown fence built dynamically because this whole script is wrapped
    // in an outer template literal — a literal backtick in this file would
    // close the wrapping template prematurely. charCode 96 is the fence char.
    const FENCE = String.fromCharCode(96).repeat(3);
    // NB: this whole script is wrapped in an outer TS template literal, so
    // a single-backslash newline-escape here would be consumed at build
    // time and emit an actual newline inside the double-quoted string
    // (→ unterminated literal). Double the backslash so the rendered JS
    // keeps the escape.
    const fenced = (s) => FENCE + "\\n" + s + "\\n" + FENCE;
    const tail = RECENT_ERRORS.length ? fenced(RECENT_ERRORS.join("\\n")) : "_(none in this session)_";
    const body = [
      "**What happened?**",
      "<!-- describe the bug here, including what you expected -->",
      "",
      "**Steps to reproduce:**",
      "1.",
      "2.",
      "3.",
      "",
      "---",
      "<details><summary>auto-collected context</summary>",
      "",
      "- url: " + window.location.href,
      "- user-agent: " + navigator.userAgent,
      "- timestamp: " + new Date().toISOString(),
      "- signed in: " + (authed ? "yes" : "no"),
      "- character: " + (ch ? ch.name + " (" + (ch.playbookId || "?") + ")" : "none"),
      "- grade: " + (grade || "—"),
      "- faculty: " + (faculty || "—"),
      "- viewport: " + window.innerWidth + "×" + window.innerHeight,
      "",
      "**Recent console errors:**",
      tail,
      "",
      "</details>",
    ].join("\\n");
    const issueUrl = "https://github.com/cenetex/app-ruby-high/issues/new?title="
      + encodeURIComponent("[bug] ")
      + "&body=" + encodeURIComponent(body)
      + "&labels=" + encodeURIComponent("bug,user-report");
    window.open(issueUrl, "_blank", "noopener");
  });

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
  // The session is born already enrolled at Freshman year (server-side
  // default). The player progresses Freshman → Sophomore → Junior → Senior
  // → graduate as they clear per-grade streak and class-credit gates. There is no year
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
}
