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
  // Mirrored from types.ts: gates the player must clear to advance OUT of
  // each year (BOTH must hold). Kept inline so the top-bar chip can render
  // without an extra telemetry round-trip.
  const STREAK_REQUIRED = { "9": 1, "10": 2, "11": 3, "12": 4 };
  const XP_REQUIRED     = { "9": 5, "10": 15, "11": 30, "12": 50 };
  const LOUNGE_ID = "lounge";

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
      const found = ids.map((sid) => STUDENTS.find((s) => s.id === sid)).filter(Boolean);
      if (found.length > 0) return found;
    }
    return STUDENTS.slice(0, 2);
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
    stream: $("stream"),
    blackboardPanel: $("blackboard-panel"),
    loungeStage: $("lounge-stage"),
    teacherFigure: $("teacher-figure"),
    blackboardEmpty: $("blackboard-empty"),
    blackboardEmptyText: $("blackboard-empty-text"),
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
    qnum: $("qnum"),
    nextBtn: $("next-btn"),
    raceStrip: $("race-strip"),
    raceRow: $("race-row"),
    timerPill: $("timer-pill"),
    timerLabel: $("timer-label"),
    difficultyFilter: $("difficulty-filter"),
    composerZone: $("composer-zone"),
    chatForm: $("chat-form"),
    chatInput: $("chat-input"),
    chatSend: $("chat-send"),
    signinCta: $("signin-cta"),
    checking: $("checking"),
    scrim: $("scrim"),
    congrats: $("congrats-toast"),
    xpBurst: $("xp-burst"),
  };

  // ── view state ────────────────────────────────────────────────────────────
  let lastTelemetry = null;
  let lastRosterSig = "";
  let lastRevealId = null;
  let authed = null; // null = unknown, true/false set after first poll
  let lockedFor = null;
  let streamingMsgEl = null;
  let renderedHistorySig = null;
  let activeQuestionId = null; // currently displayed question id on the blackboard
  let questionCounter = 0;     // session-local question count for "Question N" label
  let lastShownGrade = null;
  let lastShownFaculty = null;
  let agentBusy = false;       // true while a teacher-driven SSE turn is running
  let lastAgentTrigger = null; // dedupe key so we don't re-fire on poll
  // Reset the guards above whenever the player walks into a new context
  // (faculty change, lounge entry, grade selection). Without this, the
  // dedupe key from a prior visit silently blocks channel-enter on revisit:
  // "I went back to Ruby's room and she didn't greet me."
  function resetAgentGuards() {
    lastAgentTrigger = null;
    lastRevealId = null;
  }
  let opinionSubmitted = false; // player's text has been recorded for current round
  let opinionGradeFired = false; // grading has been triggered for current round
  const renderedOpinionIds = new Set(); // responder ids whose text we've appended to chat
  const gradedResponderIds = new Set(); // responders whose grade-tag we've stamped on
  let sheetOverlayOpen = false;
  let sheetAutoShown = false;

  // Track scroll-to-bottom intent: only auto-scroll if user is near bottom.
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
  function teacherStickerUrl(facultyId) {
    if (!facultyId) return null;
    return apiBase + "/assets/teachers/" + encodeURIComponent(facultyId) + ".png";
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
      const tag = document.createElement("span"); tag.className = "role-tag you"; tag.textContent = "You"; head.appendChild(tag);
    } else if (kind === "student") {
      const tag = document.createElement("span"); tag.className = "role-tag student"; tag.textContent = "Student"; head.appendChild(tag);
    }
    const stamp = document.createElement("span");
    stamp.className = "stamp";
    stamp.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    head.appendChild(stamp);
    const bodyEl = document.createElement("div");
    bodyEl.className = "body";
    bodyEl.textContent = body || "";
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
    const heroSrc = facultyId
      ? apiBase + "/assets/teachers/" + encodeURIComponent(facultyId) + "-full.png"
      : apiBase + "/assets/teachers/ruby-full.png";
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
  function escape(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c])); }

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
    // Opinion mode: keep the chalkboard prompt visible but hide the A/B/C/D
    // grid. Player and AI students all answer in chat — the teacher reads
    // them and grades from there.
    els.blackboardPanel.classList.remove("is-empty");
    els.blackboardEmpty.hidden = true;
    els.blackboardMeta.hidden = false;
    els.boardFrameHost.hidden = false;
    // After a wrong answer on the CURRENT question, hide the A/B/C/D grid
    // so the teacher's reaction + explanation in the chat stream gets the
    // mobile vertical space. The verdict line on the board itself still
    // tells the player they were wrong; the colored outlines are just a
    // celebration accent we can afford to drop on a miss. Re-shows
    // automatically when the next question lands (lastReveal.questionId
    // diverges from current.id).
    const reveal = lastTelemetry?.lastReveal;
    const wrongOnCurrent = !!(reveal
      && !reveal.wasCorrect
      && lastTelemetry?.current
      && reveal.questionId === lastTelemetry.current.id);
    els.answersHost.hidden = !!isOpinion || wrongOnCurrent;
    // Footer (Question N + difficulty filter + Next btn) only when signed
    // in. Pre-auth users can't act on it.
    els.blackboardFoot.hidden = !authed;
  }

  // ── top-bar arc indicator (live progress through the 4-year arc) ────────
  // Shape: "Junior · streak 2/3 · 28/50 XP". Hidden until a character
  // exists. Streak/XP turn accent-colored once the gate is met (player's
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
      els.arcXp.textContent = (ch.xp ?? 0) + " XP";
      els.arcXp.classList.remove("is-met");
      return;
    }
    const yearLabel = GRADE_LABELS[grade] || ("Grade " + grade);
    els.arcYear.textContent = yearLabel;
    const streakCount = ch.streak && ch.streak.grade === grade ? ch.streak.count : 0;
    const streakReq   = STREAK_REQUIRED[grade] || 1;
    const xp          = ch.xp ?? 0;
    const xpReq       = XP_REQUIRED[grade] || 5;
    els.arcStreak.textContent = "streak " + streakCount + "/" + streakReq;
    els.arcStreak.classList.toggle("is-met", streakCount >= streakReq);
    els.arcXp.textContent = xp + "/" + xpReq + " XP";
    els.arcXp.classList.toggle("is-met", xp >= xpReq);
  }

  // ── race strip (timer + per-NPC thinking/locked indicators) ─────────────
  function renderRaceStrip(t) {
    const round = t.active_round;
    // Hard gate: race strip ONLY when authed + active round + matching live
    // question + unresolved + still-counting. A stale round whose questionId
    // no longer matches the board's question (faculty switched, next question
    // posed, etc.) gets hidden — otherwise its frozen "22s" pill sits
    // forever while everything else has moved on.
    const liveRound = round
      && t.current
      && round.questionId === t.current.id
      && !round.resolved
      && (round.remainingMs ?? 0) > 0;
    if (!authed || !liveRound) {
      els.raceStrip.hidden = true;
      els.raceRow.innerHTML = "";
      return;
    }
    els.raceStrip.hidden = false;
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
      name: "You",
      faceUrl: null,
      isLocked: round.player.isLocked,
      pick: round.player.picked, // null until reveal
      isCorrect: round.resolved && round.player.picked && t.current ? round.player.picked === t.lastReveal?.correct : null,
      isFirstCorrect: round.firstCorrect === "player",
      color: "var(--accent)",
    });
    (round.npcs || []).forEach((n) => {
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
        const img = document.createElement("img");
        img.src = apiBase + "/assets/teachers/" + ""; // placeholder, will use student face below
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
      return;
    }
    // Use the -face crop for the corner badge — cleaner head/shoulders fit.
    const url = apiBase + "/assets/teachers/" + encodeURIComponent(faculty.id) + "-face.png";
    if (els.teacherFigure.dataset.facultyId !== faculty.id) {
      // Clear first so the browser repaints even if the URL is cached, and
      // restart the entry animation so the speaker change reads visually.
      els.teacherFigure.dataset.facultyId = faculty.id;
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
    if (!question) {
      showBlackboardEmpty(true);
      activeQuestionId = null;
      const daily = lastTelemetry && lastTelemetry.daily;
      if (!authed) {
        els.blackboardEmptyText.textContent = "Sign in below to start class.";
      } else if (!lastTelemetry?.character) {
        els.blackboardEmptyText.textContent = "Roll a character — your name will appear in the seating chart.";
      } else if (faculty && faculty.id === LOUNGE_ID) {
        els.blackboardEmptyText.textContent = "You're in the teachers' lounge. No questions here — eavesdrop on the faculty.";
      } else if (daily && daily.reason === "completed") {
        els.blackboardEmptyText.textContent = "School's out for today. The next bell rings at 17:00 UTC tomorrow — your streak holds until then.";
      } else if (daily && daily.reason === "weekend") {
        els.blackboardEmptyText.textContent = "School's closed for the weekend. Class is back Monday at 17:00 UTC. Streak holds across the break.";
      } else if (daily && daily.available) {
        els.blackboardEmptyText.textContent = "Today's Daily is ready. Tap Next question to start.";
      } else {
        els.blackboardEmptyText.textContent = "The teacher will write a question on the board in a moment.";
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
    if (currentGrade) { const g = document.createElement("span"); g.className = "pill"; g.textContent = "Grade " + currentGrade; els.blackboardMeta.appendChild(g); }

    // Prompt — always wipe + rewrite on new question (chalkboard re-erasing).
    if (isNewQuestion) {
      els.boardPrompt.textContent = question.prompt;
      els.boardReveal.hidden = true;
      els.boardReveal.textContent = "";
      els.boardReveal.classList.remove("correct", "wrong");
    }

    // Answer buttons
    els.answers.forEach((btn) => {
      const pick = btn.dataset.pick;
      const label = btn.querySelector(".label");
      const text = (question.options && question.options[pick]) || "—";
      label.textContent = text;
      if (isNewQuestion) {
        btn.classList.remove("is-correct", "is-wrong");
      }
      btn.disabled = role === "agent";
    });

    // Footer — Question N label always visible; difficulty filter + Next
    // button only when the player is signed in (otherwise nothing they can
    // press should be visible).
    els.qnum.textContent = "Question " + questionCounter;
    els.nextBtn.disabled = false;
    els.nextBtn.style.display = "none"; // hidden until reveal
    if (els.difficultyFilter) els.difficultyFilter.hidden = !authed;
    els.blackboardFoot.hidden = !authed;

    // Opinion-mode bookkeeping resets on new question.
    if (isNewQuestion && isOpinion) {
      opinionSubmitted = false;
      opinionGradeFired = false;
      renderedOpinionIds.clear();
      gradedResponderIds.clear();
    }
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
    verdict.textContent = reveal.wasCorrect
      ? "✓ Correct (" + reveal.picked + ")"
      : "✗ You picked " + reveal.picked + " — answer was " + reveal.correct;
    els.boardReveal.appendChild(verdict);
    if (reveal.playerRoll) {
      const r = reveal.playerRoll;
      const fmt = (n) => (n >= 0 ? "+" : "") + n;
      const mod = r.total - (r.dice[0] + r.dice[1]);
      const chip = document.createElement("span");
      chip.className = "roll-chip " + r.outcome;
      chip.textContent = "🎲 " + r.dice[0] + "+" + r.dice[1] + fmt(mod) + " " + r.stat.toUpperCase() + " = " + r.total;
      els.boardReveal.appendChild(chip);
      if (r.xpAwarded > 0) {
        const xp = document.createElement("span");
        xp.className = "roll-chip hit";
        xp.textContent = "+" + r.xpAwarded + " XP";
        els.boardReveal.appendChild(xp);
      }
    }
    if (reveal.explanation) {
      const expl = document.createElement("div");
      expl.className = "reveal-explanation";
      expl.textContent = reveal.explanation;
      els.boardReveal.appendChild(expl);
    }
    els.nextBtn.style.display = "";
    els.nextBtn.focus();
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
      chip.textContent = "🎲 " + r.dice[0] + "+" + r.dice[1] + fmt(mod) + " " + r.stat.toUpperCase() + " = " + r.total;
      body.appendChild(chip);
      if (r.xpAwarded > 0) {
        const xp = document.createElement("span");
        xp.className = "roll-chip hit";
        xp.textContent = "+" + r.xpAwarded + " XP";
        body.appendChild(xp);
      }
    }
    wrap.appendChild(body);
    els.stream.appendChild(wrap);
    scrollIfPinned();
  }
  function showXpBurst(amount) {
    if (!amount || amount <= 0) return;
    els.xpBurst.textContent = "+" + amount + " XP";
    els.xpBurst.classList.remove("is-visible");
    void els.xpBurst.offsetWidth;
    els.xpBurst.classList.add("is-visible");
    clearTimeout(xpBurstTimer);
    xpBurstTimer = setTimeout(() => els.xpBurst.classList.remove("is-visible"), 1800);
  }
  let xpBurstTimer = null;

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
    const sig = (grade ?? "?") + "::" + roster.map((f) => f.id + ":" + f.available + ":" + f.questionCount).join("|") + "::" + t.faculty;
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
    const title = document.createElement("div");
    title.className = "channel-section-title";
    title.textContent = (GRADE_LABELS[grade] || grade) + " year — class periods";
    els.channelsList.appendChild(title);

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
        img.src = apiBase + "/assets/teachers/" + encodeURIComponent(fac.id) + "-face.png";
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
      const cohortIds = cohort[room.id] || [];
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

    // Class roster — show every student in the year as "online" with a small
    // face thumb. Click any of them to open their profile card.
    const studentsTitle = document.createElement("div");
    studentsTitle.className = "channel-section-title";
    studentsTitle.textContent = "Class — online";
    els.channelsList.appendChild(studentsTitle);
    const npcRoster = t.npc_roster || [];
    npcRoster.forEach((npc) => {
      const s = STUDENTS.find((x) => x.id === npc.id);
      if (!s) return;
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
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.cssText = "width:8px;height:8px;border-radius:999px;background:#4cb555;";
      row.appendChild(dot);
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
    if (fac.id === "ruby") return "Welcome to " + g + ". Pick \\"Next question\\" whenever you're ready.";
    if (fac.id === "sally-science") return "Sally here. " + g + " STEM — let's see what you've got.";
    if (fac.id === "professor-edward") return "You've found my " + g + " literature room. Take a seat.";
    return "Class is in session. Hit \\"Next question\\" to start.";
  }
  async function setFaculty(facultyId) {
    const prev = lastTelemetry && lastTelemetry.faculty;
    if (facultyId === prev) { closeRails(); return; }
    const data = await command({ type: "set-faculty", faculty: facultyId });
    if (data && data.session) {
      clearStream();
      resetBlackboard();
      resetAgentGuards();
      const fac = (data.session.telemetry.faculty_roster || []).find((f) => f.id === facultyId);
      const grade = data.session.telemetry.current_grade;
      if (authed) {
        loadHistory(facultyId);
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
      // Prefer today's Daily — that's the arc. Falls through to free-play
      // ("pick") only when the Daily isn't available (weekend, already done,
      // or no character). Free-play doesn't tick the streak; it's playtest
      // sandbox.
      const daily = lastTelemetry && lastTelemetry.daily;
      if (daily && daily.available) {
        await command({ type: "play-daily" });
      } else {
        await command({
          type: "pick",
          difficulty: els.difficultyFilter.value || undefined,
        });
      }
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
    // Note: the teacher's reaction fires when the ROUND RESOLVES, not when
    // the player clicks — see render() / new-reveal detection below. The
    // round may stay open for a few seconds while NPCs commit their picks.
  }

  // ── advantage roll ──────────────────────────────────────────────────────
  let rollingAdvantage = false;
  function renderAdvantageBar(t) {
    const round = t && t.active_round;
    const isMcLive = !!(authed && t && t.current && round && !round.resolved
      && round.type === "multiple-choice" && !t.is_opinion && t.character);
    if (!isMcLive) {
      els.advantageBar.hidden = true;
      els.advantageResult.hidden = true;
      // Make sure no stale eliminated styling lingers from the previous round.
      els.answers.forEach((btn) => btn.classList.remove("is-eliminated"));
      return;
    }
    els.advantageBar.hidden = false;
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
      els.advantageBtn.disabled = playerLocked || rollingAdvantage;
      els.advantageBtn.textContent = "🎲 Roll for advantage";
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
    // Composer: only enabled when the player is in a state that can chat.
    const canChat = authed && (mode === "between-rounds" || mode === "round-live" || mode === "round-revealed" || mode === "in-lounge");
    els.signinCta.hidden = mode !== "needs-auth";
    els.chatForm.hidden = !canChat;
    if (canChat) { els.chatInput.disabled = false; els.chatSend.disabled = false; }
    // Race strip: only during a live round.
    if (mode !== "round-live") {
      els.raceStrip.hidden = true;
      if (els.raceRow) els.raceRow.innerHTML = "";
    }
    // Blackboard footer (Question N + difficulty filter + Next): only when
    // the player can actually act on it.
    const showBoardFoot = mode === "round-live" || mode === "round-revealed";
    if (els.blackboardFoot) els.blackboardFoot.hidden = !showBoardFoot;
    if (els.difficultyFilter) els.difficultyFilter.hidden = !authed;
  }

  function render(s) {
    if (!s || !s.telemetry) return;
    const t = s.telemetry;
    lastTelemetry = t;
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

    // Header
    const fac = (t.faculty_roster || []).find((f) => f.id === t.faculty);
    els.channelTitle.textContent = fac ? channelNameFor(fac) : "general";
    els.channelSub.textContent = fac
      ? fac.displayName + " · " + (t.current_grade ? "Grade " + t.current_grade : "settling in")
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
      if (revealId !== lastRevealId) {
        lastRevealId = revealId;
        if (activeQuestionId === t.lastReveal.questionId) {
          applyRevealToBlackboard(t.lastReveal);
          appendResultChip(t.lastReveal);
        }
        showCongrats(t.lastReveal.encouragement, t.lastReveal.wasCorrect);
        if (t.lastReveal.playerRoll && t.lastReveal.playerRoll.xpAwarded > 0) {
          showXpBurst(t.lastReveal.playerRoll.xpAwarded);
        }
        scheduleStudentChime(t.lastReveal.wasCorrect, t.current_grade);
        // Teacher reacts + queues next question. Small delay so the
        // congrats toast lands first and the chat doesn't feel stacked.
        // force=true: bypass the agentBusy guard. If a prior turn's SSE
        // stream stuck (network drop, server hang), agentBusy stays true
        // and answer-graded gets silently dropped — leaving the player
        // staring at a revealed answer with no next question. The teacher
        // reaction is the thing that unsticks the flow; never gate it.
        if (authed && t.faculty !== LOUNGE_ID) {
          setTimeout(() => {
            runAgentTurn("answer-graded", {
              grade: t.current_grade,
              picked: t.lastReveal.picked,
              correct: t.lastReveal.correct,
              wasCorrect: t.lastReveal.wasCorrect,
            }, { force: true });
          }, 600);
        }
      }
    } else if (!t.current && lastRevealId) {
      lastRevealId = null;
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
    }

    lastShownGrade = t.current_grade;
    lastShownFaculty = t.faculty;
  }

  // ── portrait generation (fire-and-forget after character accept) ────────
  async function generateAndAttachPortrait(c) {
    if (!authed) return;
    try {
      const r = await fetch("/api/apps/ruby-high/chat/character/portrait", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: c.name, playbookId: c.playbookId, personality: c.personality, stats: c.stats }),
      });
      if (!r.ok) return;
      const data = await r.json();
      if (data && data.portraitDataUrl) {
        await command({ type: "set-portrait", portraitDataUrl: data.portraitDataUrl });
      }
    } catch { /* ignore — sheet close was instant; this is a soft enhancement */ }
  }

  // ── unified CCG-style character card ────────────────────────────────────
  // One renderer for player, student, AND teacher cards. Big art on top,
  // name banner, stats line, body text, optional quote, optional footer.
  function buildCharacterCard(spec) {
    // spec: { role, name, subtitle, portraitUrl, accent, stats?, bodyText, quote?, footer?, actions? }
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
      q.textContent = "“" + spec.quote + "”";
      body.appendChild(q);
    }
    if (spec.footer) {
      const ft = document.createElement("div");
      ft.className = "ccg-footer";
      const title = document.createElement("strong");
      title.textContent = spec.footer.title;
      ft.appendChild(title);
      ft.appendChild(document.createTextNode(spec.footer.content));
      body.appendChild(ft);
    }
    card.appendChild(body);
    if (spec.actions && spec.actions.length) {
      const actionsRow = document.createElement("div");
      actionsRow.className = "sheet-actions";
      for (const a of spec.actions) {
        const btn = document.createElement("button");
        if (a.secondary) btn.className = "secondary";
        btn.textContent = a.label;
        btn.addEventListener("click", a.onClick);
        actionsRow.appendChild(btn);
      }
      // The actions row sits OUTSIDE the card, in the sheet card container,
      // so the card itself stays self-contained art.
      sheetCard.appendChild(card);
      sheetCard.appendChild(actionsRow);
      return null; // already appended
    }
    return card;
  }
  function appendCard(spec) {
    sheetCard.innerHTML = "";
    const card = buildCharacterCard(spec);
    if (card) sheetCard.appendChild(card);
  }

  // ── teacher profile (click teacher thumb in channel rail to open) ───────
  function openTeacherProfile(facultyId) {
    const t = lastTelemetry;
    const fac = (t && t.faculty_roster || []).find((f) => f.id === facultyId);
    if (!fac) return;
    sheetOverlayOpen = true;
    sheetEl.classList.add("is-open");
    const subjectMap = { ruby: "Homeroom · school lore + general", "sally-science": "Science Lab · physics, chem, bio, earth-sci", "professor-edward": "Library · postwar literature & literary theory" };
    // Short, in-voice quotes — MTG flavor text. One-liner each, character speaking.
    const signatureMap = {
      ruby: "My job's the door. The teaching happens in the rooms.",
      "sally-science": "I'd rather you be wrong with reasons than right by accident.",
      "professor-edward": "Every wrong answer has a half-truth folded inside it. We start there.",
    };
    appendCard({
      role: "teacher",
      name: fac.displayName,
      subtitle: subjectMap[fac.id] || fac.bio,
      portraitUrl: apiBase + "/assets/teachers/" + encodeURIComponent(fac.id) + "-full.png",
      accent: fac.accent,
      quote: signatureMap[fac.id] || fac.bio,
      footer: { title: "Teaches", content: subjectMap[fac.id] || fac.bio },
      actions: [{ label: "Close", secondary: true, onClick: closeSheet }],
    });
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
    appendCard({
      role: "student",
      name: s.name,
      subtitle: arcLine + (npc.currentRoom ? " · #" + npc.currentRoom : ""),
      portraitUrl: apiBase + "/assets/students/" + encodeURIComponent(npc.id) + "-full.png",
      accent: s.color,
      stats: npc.stats,
      quote: studentVibe(npc.id),
      actions: [{ label: "Close", secondary: true, onClick: closeSheet }],
    });
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
      const r = await fetch("/api/apps/ruby-high/chat/character/diploma", {
        method: "POST",
        credentials: "same-origin",
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

  function renderSheetReadonly(c, playbooks) {
    const pb = playbooks.find((p) => p.id === c.playbookId) || { name: c.playbookId, blurb: "", startingMove: { name: "—", description: "" } };
    const grade = lastTelemetry?.current_grade ? "Grade " + lastTelemetry.current_grade : "Freshman";
    appendCard({
      role: "player",
      name: c.name,
      subtitle: graduatedFor(c) ? "Graduated · " + (c.xp ?? 0) + " XP" : pb.name + " · " + grade + " · " + (c.xp ?? 0) + " XP",
      // Graduated character: show the diploma image (cap+gown) instead of
      // the standing portrait. Falls back to the standing portrait while
      // diploma image gen is still in flight.
      portraitUrl: (graduatedFor(c) && c.diplomaImageDataUrl) || c.portraitDataUrl || (apiBase + "/assets/teachers/ruby-full.png"),
      accent: pb.accent,
      stats: c.stats,
      // Card quote prefers the MTG-style flavor line; legacy characters
      // created before that field existed fall back to the arc answer.
      quote: c.flavorQuote || c.arcAnswer,
      footer: pb.startingMove ? { title: pb.startingMove.name, content: pb.startingMove.description } : undefined,
      actions: [
        {
          label: "Reroll character",
          secondary: true,
          onClick: async () => {
            if (!confirm("Throw away " + c.name + " and roll a new student? Your XP and class progress will be reset too.")) return;
            await command({ type: "clear-character" });
            await command({ type: "reset" });
            sheetAutoShown = false;
            renderSheet();
          },
        },
        { label: "Close", onClick: closeSheet },
      ],
    });
  }
  function fmtStat(n) { return (n >= 0 ? "+" : "") + n; }
  // Random-roll character creation. The player INHABITS an AI student rather
  // than building one. Server picks playbook + stats; LLM fills in the
  // name/hook/personality. Single "Roll" or "Reroll" button.
  //
  // Auth gate: if the player isn't signed in to OpenRouter, render the
  // sign-in CTA instead — they need the LLM to roll a character.
  function renderSheetCreation(playbooks) {
    sheetCard.innerHTML = "";
    if (!authed) {
      const h = document.createElement("h2");
      h.textContent = "Welcome to Ruby High";
      sheetCard.appendChild(h);
      const sub = document.createElement("p");
      sub.className = "sub";
      sub.textContent = "Sign in with your OpenRouter account first — your character is rolled by an LLM and the chat with the teachers runs on your account.";
      sheetCard.appendChild(sub);
      const actions = document.createElement("div");
      actions.className = "sheet-actions";
      const signin = document.createElement("a");
      signin.href = "/api/apps/ruby-high/auth/start";
      signin.target = "_blank";
      signin.rel = "noopener";
      signin.textContent = "Sign in with OpenRouter";
      signin.style.cssText = "display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:800;font-size:14px;";
      const close = document.createElement("button");
      close.className = "secondary";
      close.textContent = "Close";
      close.addEventListener("click", closeSheet);
      actions.appendChild(close);
      actions.appendChild(signin);
      sheetCard.appendChild(actions);
      return;
    }

    const h = document.createElement("h2");
    h.textContent = "Welcome to Ruby High";
    sheetCard.appendChild(h);
    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = "You're inhabiting an AI student. Hit roll to draw a character — name, vibe, stats, the lot. Reroll until one feels right.";
    sheetCard.appendChild(sub);

    // Preview area (filled after first roll).
    const preview = document.createElement("div");
    preview.id = "char-preview";
    preview.style.cssText = "display:none;flex-direction:column;gap:10px;margin-top:8px;";
    sheetCard.appendChild(preview);

    // Status line for in-flight rolls / errors.
    const status = document.createElement("div");
    status.className = "stat-budget";
    status.textContent = "";
    sheetCard.appendChild(status);

    // Actions
    const actions = document.createElement("div");
    actions.className = "sheet-actions";
    const rollBtn = document.createElement("button");
    rollBtn.textContent = "Roll a character";
    const acceptBtn = document.createElement("button");
    acceptBtn.textContent = "Start the school year";
    acceptBtn.style.display = "none";
    actions.appendChild(rollBtn);
    actions.appendChild(acceptBtn);
    sheetCard.appendChild(actions);

    let rolled = null;
    let rolling = false;

    function renderPreview(c) {
      preview.innerHTML = "";
      preview.style.display = "flex";
      const pb = playbooks.find((p) => p.id === c.playbookId) || { name: c.playbookId, startingMove: { name: "—", description: "" } };
      const head = document.createElement("div");
      head.style.cssText = "display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;";
      const name = document.createElement("div");
      name.style.cssText = "font-size:20px;font-weight:800;color:var(--text);";
      name.textContent = c.name;
      head.appendChild(name);
      const tag = document.createElement("span");
      tag.style.cssText = "font-size:11px;background:var(--accent);color:#fff;padding:2px 8px;border-radius:999px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;";
      tag.textContent = pb.name;
      head.appendChild(tag);
      preview.appendChild(head);

      const fmt = (n) => (n >= 0 ? "+" : "") + n;
      const statLine = document.createElement("div");
      statLine.style.cssText = "font-size:12px;color:var(--text-mute);letter-spacing:0.06em;";
      statLine.textContent = "HEAD " + fmt(c.stats.head) + " · HEART " + fmt(c.stats.heart) + " · HUSTLE " + fmt(c.stats.hustle) + " · HONOR " + fmt(c.stats.honor);
      preview.appendChild(statLine);

      const body = document.createElement("div");
      body.style.cssText = "color:var(--text);font-size:14px;line-height:1.5;background:var(--bg-elev);border-radius:10px;padding:10px 12px;";
      body.textContent = c.personality;
      preview.appendChild(body);

      const arc = document.createElement("div");
      arc.style.cssText = "border-left:3px solid var(--accent);padding:6px 10px;color:var(--text-soft);font-style:italic;font-size:13px;line-height:1.5;background:var(--bg-elev);border-radius:0 8px 8px 0;";
      // Show the flavor quote on the preview when present; legacy rolls
      // (no flavorQuote yet) fall back to the arc answer.
      arc.textContent = "“" + (c.flavorQuote || c.arcAnswer) + "”";
      preview.appendChild(arc);

      const move = document.createElement("div");
      move.style.cssText = "font-size:11px;color:var(--text-mute);";
      const moveName = document.createElement("strong");
      moveName.style.color = "var(--text)";
      moveName.textContent = pb.startingMove.name;
      move.appendChild(moveName);
      move.appendChild(document.createTextNode(" — " + pb.startingMove.description));
      preview.appendChild(move);
    }

    async function roll() {
      if (rolling) return;
      rolling = true;
      rollBtn.disabled = true;
      acceptBtn.disabled = true;
      acceptBtn.style.display = rolled ? "" : "none";
      status.textContent = "Rolling…";
      status.classList.remove("is-invalid");
      try {
        const r = await fetch("/api/apps/ruby-high/chat/character/generate", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({ error: r.status }));
          throw new Error(err.error || "request " + r.status);
        }
        const data = await r.json();
        rolled = data.character;
        rollBtn.textContent = "Reroll";
        acceptBtn.style.display = "";
        renderPreview(rolled);
        status.textContent = "";
      } catch (err) {
        status.textContent = "Couldn't roll · " + (err && err.message ? err.message : "error");
        status.classList.add("is-invalid");
      } finally {
        rolling = false;
        rollBtn.disabled = false;
        acceptBtn.disabled = !rolled;
      }
    }

    rollBtn.addEventListener("click", roll);
    acceptBtn.addEventListener("click", async () => {
      if (!rolled) return;
      acceptBtn.disabled = true;
      rollBtn.disabled = true;
      status.textContent = "Saving character…";
      const saved = rolled;
      const data = await command({ type: "create-character", ...rolled });
      if (data && data.session) {
        // Close immediately; portrait gen runs in background and lands on
        // the character via /chat/character/portrait → /command set-portrait.
        closeSheet();
        void generateAndAttachPortrait(saved);
      } else {
        acceptBtn.disabled = false;
        rollBtn.disabled = false;
      }
    });

    // Auto-roll on first open. By the time we get here authed is guaranteed
    // true (the unauth branch returned above).
    roll();
  }
  sheetEl.addEventListener("click", (e) => { if (e.target === sheetEl) closeSheet(); });

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
  async function fireStudentChime({ situation, note, grade, faculty, delayMs }) {
    if (!studentChimeAllowed()) return;
    const who = pickRandom(studentsForGrade(grade));
    if (!authed) {
      const fallback = situation === "answer-correct"
        ? pickRandom(STUDENT_LINES_RIGHT)
        : situation === "answer-wrong"
          ? pickRandom(STUDENT_LINES_WRONG)
          : pickRandom(STUDENT_LINES_GREET);
      setTimeout(() => appendMsg({ kind: "student", name: who.name, body: fallback, color: who.color, studentId: who.id }), delayMs ?? 700);
      return;
    }
    const wait = delayMs ?? (700 + Math.random() * 800);
    setTimeout(async () => {
      try {
        const r = await fetch("/api/apps/ruby-high/chat/student-chime", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: who.id, situation, note, faculty }),
        });
        if (!r.ok) throw new Error("student " + r.status);
        const data = await r.json();
        const line = (data && data.line) || pickRandom(STUDENT_LINES_GREET);
        appendMsg({ kind: "student", name: who.name, body: line, color: who.color, studentId: who.id });
      } catch (err) {
        // Fallback to canned line if the API call fails.
        const fallback = situation === "answer-correct" ? pickRandom(STUDENT_LINES_RIGHT) : pickRandom(STUDENT_LINES_WRONG);
        appendMsg({ kind: "student", name: who.name, body: fallback, color: who.color, studentId: who.id });
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
  async function pollAuth() {
    try {
      const r = await fetch("/api/apps/ruby-high/auth/me", { credentials: "same-origin" });
      const data = await r.json();
      const next = !!data.authed;
      if (next !== lastAuthState) {
        const wasSignedIn = lastAuthState === true;
        lastAuthState = next;
        authed = next;
        applyAuthUI();
        if (authed && lastTelemetry) loadHistory(lastTelemetry.faculty);
        // If the sheet overlay is open while auth state changes, re-render it
        // so the unauth CTA flips to the Roll UI (or vice versa).
        if (sheetOverlayOpen) renderSheet();
        // Just signed in + no character yet → open the sheet automatically.
        if (authed && !wasSignedIn && lastTelemetry && !lastTelemetry.character && !sheetOverlayOpen) {
          sheetAutoShown = true;
          openSheet();
        }
      }
    } catch {
      if (authed === true) { authed = false; lastAuthState = false; applyAuthUI(); }
    }
  }
  function applyAuthUI() {
    els.checking.hidden = authed !== null;
    if (authed === null) {
      els.signinCta.hidden = true;
      els.chatForm.hidden = true;
      els.checking.hidden = false;
      els.youState.textContent = "checking…";
      els.footerAction.hidden = true;
      return;
    }
    els.footerAction.hidden = false;
    if (authed) {
      els.youState.textContent = "signed in";
      els.footerAction.textContent = "Sign out";
      els.signinCta.hidden = true;
      els.chatForm.hidden = false;
      els.chatInput.disabled = false;
      els.chatSend.disabled = false;
    } else {
      els.youState.textContent = "signed out";
      els.footerAction.textContent = "Sign in";
      els.signinCta.hidden = false;
      // Hide the textarea + send entirely until auth — no half-disabled state.
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
    await fetch("/api/apps/ruby-high/auth/logout", { method: "POST", credentials: "same-origin" });
    authed = false;
    lastAuthState = false;
    applyAuthUI();
    if (lastTelemetry) loadHistory(lastTelemetry.faculty);
  }
  async function loadHistory(facultyId) {
    if (!authed || !facultyId) return;
    try {
      const r = await fetch("/api/apps/ruby-high/chat/history?faculty=" + encodeURIComponent(facultyId), { credentials: "same-origin" });
      const data = await r.json();
      authed = !!data.authed;
      const msgs = data.history || [];
      const sig = facultyId + ":" + msgs.length;
      if (sig === renderedHistorySig) return;
      renderedHistorySig = sig;
      els.stream.innerHTML = "";
      streamingMsgEl = null;
      const fac = (lastTelemetry && lastTelemetry.faculty_roster || []).find((f) => f.id === facultyId);
      const teacherName = fac ? fac.displayName : facultyId;
      const teacherAccent = fac ? fac.accent : "#d22a2a";
      msgs.forEach((m) => {
        if (m.role === "user") appendMsg({ kind: "you", name: "You", body: m.content, color: "var(--accent)" });
        else if (m.role === "assistant" && m.content) appendMsg({ kind: "teacher", name: teacherName, body: m.content, color: teacherAccent, facultyId });
      });
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
  async function consumeSseStream(response) {
    if (!response.ok || !response.body) {
      const err = await response.json().catch(() => ({ error: response.status }));
      appendSystem("chat error · " + (err.error || response.status));
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
        if (event === "speaker") {
          speaker = teacherInfo(parsed.facultyId);
          streamingMsgEl = null; // force a new bubble for the new speaker
        } else if (event === "delta") {
          if (!streamingMsgEl) {
            streamingMsgEl = appendMsg({ kind: "teacher", name: speaker.name, body: "", color: speaker.accent, facultyId: speaker.facultyId });
          }
          streamingMsgEl.textContent += parsed.text || "";
          scrollIfPinned();
        } else if (event === "tool") {
          const args = parsed.args || {};
          const summary = parsed.tool + "(" + Object.keys(args).slice(0, 3).map((k) => k + "=" + JSON.stringify(args[k])).join(", ") + ") → " + (parsed.result && parsed.result.ok ? "ok" : "fail");
          appendTool(summary);
          fetchSession();
          streamingMsgEl = null;
        } else if (event === "error") {
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
    const targetFaculty = (lastTelemetry && lastTelemetry.faculty) || "ruby";

    // If an opinion question is active and the player hasn't submitted their
    // response yet, route this chat message to /chat/opinion-submit instead
    // of the regular agent loop.
    const inOpinion = !!(lastTelemetry && lastTelemetry.is_opinion && lastTelemetry.active_round && !lastTelemetry.active_round.resolved && !opinionSubmitted);

    appendMsg({ kind: "you", name: "You", body: text, color: "var(--accent)" });
    els.chatInput.value = "";
    els.chatInput.style.height = "40px";
    els.chatInput.disabled = true;
    els.chatSend.disabled = true;
    try {
      let r;
      if (inOpinion) {
        opinionSubmitted = true;
        r = await fetch("/api/apps/ruby-high/chat/opinion-submit", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      } else {
        r = await fetch("/api/apps/ruby-high/chat", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ faculty: targetFaculty, message: text }),
        });
      }
      await consumeSseStream(r);
    } catch (err) {
      appendSystem("chat failed · " + (err && err.message ? err.message : "error"));
    } finally {
      agentBusy = false;
      els.chatInput.disabled = !authed;
      els.chatSend.disabled = !authed;
      els.chatInput.focus();
      if (Math.random() < 0.4) {
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
    try {
      const r = await fetch("/api/apps/ruby-high/chat/event", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faculty: targetFaculty, trigger, context: context || {} }),
      });
      await consumeSseStream(r);
    } catch (err) {
      appendSystem("teacher offline · " + (err && err.message ? err.message : "error"));
    } finally {
      agentBusy = false;
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
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const nameEl = node.querySelector(".head .name");
      if (!nameEl) continue;
      const name = (nameEl.textContent || "").trim();
      const target = grade.responder === "player" ? "You" :
        (STUDENTS.find((s) => s.id === grade.responder)?.name || grade.responder);
      if (name !== target) continue;
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
      const r = await fetch("/api/apps/ruby-high/chat/opinion-submit", {
        method: "POST",
        credentials: "same-origin",
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
  els.difficultyFilter.addEventListener("click", (e) => e.stopPropagation());
  els.hamburger.addEventListener("click", toggleRails);
  els.scrim.addEventListener("click", closeRails);
  els.homeBtn.addEventListener("click", openRails);
  els.footerAction.addEventListener("click", () => {
    if (authed) logout();
    else window.open("/api/apps/ruby-high/auth/start", "_blank", "noopener");
  });
  // Click your name/avatar to open the character sheet.
  const youCardBlock = document.querySelector(".channels-footer .you-meta");
  if (youCardBlock) youCardBlock.addEventListener("click", openSheet);
  const youAvatarEl = document.querySelector(".channels-footer .you-avatar");
  if (youAvatarEl) youAvatarEl.addEventListener("click", openSheet);
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
  // → graduate as they pass per-grade Daily thresholds. There is no year
  // picker — they walk in, get started, and advance by playing.
  fetchSession();
  pollAuth();
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
  setInterval(pollAuth, 3000);
})();
`;
}
