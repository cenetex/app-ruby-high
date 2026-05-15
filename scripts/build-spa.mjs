#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outDir = resolve(root, "dist-spa");
const appBase = "/api/apps/ruby-high";

const questionFiles = {
  ruby: "ruby.json",
  "sally-science": "sally-science.json",
  "professor-edward": "professor-edward.json",
};

const playbooks = [
  {
    id: "overachiever",
    name: "The Overachiever",
    shortName: "Overachiever",
    blurb: "Cs are not enough. You sweat the ones you miss.",
    suggestedStats: { head: 2, heart: 0, hustle: -1, honor: 1 },
    hookQuestion: "Why is Cs not enough?",
    startingMove: { name: "Margins are sacred", description: "Once per year, retake one missed question." },
    accent: "#ff6f91",
  },
  {
    id: "slacker",
    name: "The Slacker",
    shortName: "Slacker",
    blurb: "Hides being smart. Always knows more than they let on.",
    suggestedStats: { head: 0, heart: 1, hustle: 2, honor: -1 },
    hookQuestion: "Who do you not want to disappoint?",
    startingMove: { name: "Wing it", description: "When you'd fail a HEAD roll, swap it for HUSTLE." },
    accent: "#36c2cc",
  },
  {
    id: "heart",
    name: "The Heart",
    shortName: "Heart",
    blurb: "Glue of every group. Quietly carries the people around you.",
    suggestedStats: { head: -1, heart: 2, hustle: 0, honor: 1 },
    hookQuestion: "Whose orbit are you stuck in?",
    startingMove: { name: "Pep talk", description: "When a classmate misses, you can write them a one-liner." },
    accent: "#52c673",
  },
  {
    id: "outsider",
    name: "The Outsider",
    shortName: "Outsider",
    blurb: "Transferred in. You see the things the locals stopped noticing.",
    suggestedStats: { head: 1, heart: 0, hustle: -1, honor: 2 },
    hookQuestion: "What did you leave behind?",
    startingMove: { name: "Outside eyes", description: "Once per period, see the explanation before answering." },
    accent: "#a06bff",
  },
  {
    id: "class-clown",
    name: "The Class Clown",
    shortName: "Clown",
    blurb: "Deflects with a joke. Sneakily makes the room better.",
    suggestedStats: { head: -1, heart: 2, hustle: 1, honor: 0 },
    hookQuestion: "What can't you say without a joke?",
    startingMove: { name: "Crack the room", description: "When you'd miss, roll HEART instead of HEAD." },
    accent: "#ffb05a",
  },
  {
    id: "lifer",
    name: "The Lifer",
    shortName: "Lifer",
    blurb: "Knows everyone's history. Knows where the bodies are buried.",
    suggestedStats: { head: 1, heart: 1, hustle: 1, honor: -1 },
    hookQuestion: "What's the best gossip you've picked up about this place?",
    startingMove: { name: "Old gossip", description: "You know which teacher is in a mood today." },
    accent: "#ec4f9e",
  },
];

async function readQuestions() {
  const out = {};
  for (const [facultyId, fileName] of Object.entries(questionFiles)) {
    const raw = await readFile(resolve(root, "assets", "questions", fileName), "utf8");
    const parsed = JSON.parse(raw);
    out[facultyId] = Array.isArray(parsed.questions) ? parsed.questions : [];
  }
  return out;
}

function scriptJson(value) {
  return JSON.stringify(value).replace(/<\//g, "<\\/");
}

function offlineApiScript(data) {
  return `(() => {
  if (window.__RUBY_HIGH_OFFLINE_API__) return;
  window.__RUBY_HIGH_OFFLINE_API__ = true;

  const APP_BASE = "/api/apps/ruby-high";
  const SESSION_ID = "rh:offline";
  const STORAGE_KEY = "ruby-high:offline-state:v1";
  const DATA = ${scriptJson(data)};
  const ORIGINAL_FETCH = window.fetch.bind(window);
  const CHOICES = ["A", "B", "C", "D"];
  const GRADES = ["9", "10", "11", "12"];
  const FACULTY = [
    { id: "ruby", displayName: "Ruby", shortName: "Ruby", subjects: ["onboarding", "general-knowledge", "ai-literacy", "agent-culture"], bio: "Host of Ruby High.", available: true, accent: "#d22a2a", assetTeacherId: "ruby" },
    { id: "sally-science", displayName: "Sally Science", shortName: "Sally", subjects: ["physics", "chemistry", "biology", "earth-science"], bio: "STEM teacher.", available: true, accent: "#3aa3e0", assetTeacherId: "sally-science" },
    { id: "professor-edward", displayName: "Professor Edward", shortName: "Edward", subjects: ["literature", "literary-theory", "mid-century"], bio: "Literature teacher.", available: true, accent: "#7a4f2a", assetTeacherId: "professor-edward" }
  ];
  const ROOMS = [
    { id: "homeroom", name: "Homeroom", channelName: "homeroom", teacherId: "ruby", description: "Ruby's homeroom.", teaches: true },
    { id: "science", name: "Science Lab", channelName: "science", teacherId: "sally-science", description: "Sally's lab.", teaches: true },
    { id: "literature", name: "Library", channelName: "literature", teacherId: "professor-edward", description: "Edward's seminar room.", teaches: true },
    { id: "lounge", name: "Teachers' Lounge", channelName: "lounge", teacherId: null, description: "Where the faculty hang out between periods.", teaches: false }
  ];
  const STUDENT_IDS = ["lyra", "sami", "ravi", "indra", "mika", "noor"];
  const STUDENT_STATS = {
    lyra: { head: 2, heart: 0, hustle: -1, honor: 1 },
    sami: { head: 0, heart: 1, hustle: 2, honor: -1 },
    ravi: { head: 1, heart: 1, hustle: 1, honor: -1 },
    indra: { head: 2, heart: -1, hustle: 0, honor: 1 },
    mika: { head: -1, heart: 2, hustle: 1, honor: 0 },
    noor: { head: 1, heart: 1, hustle: -1, honor: 1 }
  };
  const ROOM_COHORT = {
    homeroom: ["lyra", "sami"],
    science: ["ravi", "indra"],
    literature: ["mika", "noor"]
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function now() {
    return Date.now();
  }

  function dailyKey() {
    const d = new Date(now());
    if (d.getUTCHours() < 17) d.setUTCDate(d.getUTCDate() - 1);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function statusForPhase(phase) {
    if (phase === "asking") return "awaiting-answer";
    if (phase === "revealed") return "revealed";
    return "idle";
  }

  function transition(state, phase) {
    if (state.phase !== phase) {
      state.phase = phase;
      state.phaseToken = Number(state.phaseToken || 0) + 1;
    }
    state.status = statusForPhase(state.phase);
  }

  function defaultState() {
    return {
      sessionId: SESSION_ID,
      faculty: "ruby",
      subject: null,
      current: null,
      history: [],
      score: { correct: 0, total: 0, points: 0, possible: 0 },
      lastReveal: null,
      status: "idle",
      phase: "in-room",
      phaseToken: 1,
      askedQuestionIds: [],
      currentGrade: "9",
      completedGrades: [],
      hasSeenIntro: true,
      activePackId: "ruby-high-original",
      character: null,
      schoolEvents: [],
      npcRosters: {
        "9": buildNpcRoster("9"),
        "10": buildNpcRoster("10"),
        "11": buildNpcRoster("11"),
        "12": buildNpcRoster("12")
      },
      npcCohort: STUDENT_IDS.map(function(id) {
        return { id, grade: "9", streak: { grade: "9", count: 0 }, completedGrades: [], graduated: false };
      }),
      activeRound: null,
      pendingRoll: null,
      updatedAt: now()
    };
  }

  function buildNpcRoster(grade) {
    return [
      { id: "lyra", grade, currentRoom: "homeroom", stats: clone(STUDENT_STATS.lyra) },
      { id: "sami", grade, currentRoom: "homeroom", stats: clone(STUDENT_STATS.sami) },
      { id: "ravi", grade, currentRoom: "science", stats: clone(STUDENT_STATS.ravi) },
      { id: "indra", grade, currentRoom: "science", stats: clone(STUDENT_STATS.indra) },
      { id: "mika", grade, currentRoom: "literature", stats: clone(STUDENT_STATS.mika) },
      { id: "noor", grade, currentRoom: "literature", stats: clone(STUDENT_STATS.noor) }
    ];
  }

  function emptyMashCard() {
    const cells = {};
    STUDENT_IDS.forEach(function(id) {
      cells[id] = { affinity: 0, scratched: false, circled: false, ticks: 0 };
    });
    return { cells, resolved: {} };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    } catch (_err) {}
    return defaultState();
  }

  function saveState(state) {
    state.updatedAt = now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_err) {}
    return state;
  }

  function facultyById(id) {
    return FACULTY.find(function(f) { return f.id === id; }) || FACULTY[0];
  }

  function roomForFaculty(id) {
    return ROOMS.find(function(r) { return r.teacherId === id; }) || null;
  }

  function questionBank(facultyId) {
    return DATA.questions[facultyId] || DATA.questions.ruby || [];
  }

  function difficultyForGrade(grade) {
    if (grade === "9") return "easy";
    if (grade === "10" || grade === "11") return "medium";
    return "hard";
  }

  function pickQuestion(state) {
    const facultyId = state.faculty === "lounge" ? "ruby" : state.faculty;
    const bank = questionBank(facultyId);
    const gradeDifficulty = difficultyForGrade(state.currentGrade || "9");
    const unseen = bank.filter(function(q) {
      return state.askedQuestionIds.indexOf(q.id) === -1 && (!q.difficulty || q.difficulty === gradeDifficulty);
    });
    const fallback = bank.filter(function(q) { return state.askedQuestionIds.indexOf(q.id) === -1; });
    const pool = unseen.length ? unseen : fallback.length ? fallback : bank;
    if (!pool.length) throw new Error("No offline questions are bundled for this room.");
    const q = clone(pool[Math.floor(Math.random() * pool.length)]);
    state.askedQuestionIds.push(q.id);
    state.faculty = facultyId;
    state.subject = q.subject || null;
    state.current = {
      id: q.id,
      prompt: q.prompt,
      type: q.type || "multiple-choice",
      options: q.options || { A: "", B: "", C: "", D: "" },
      correct: q.correct || "A",
      explanation: q.explanation || null,
      subject: q.subject || null,
      stat: q.stat || "head",
      difficulty: q.difficulty || gradeDifficulty,
      faculty: facultyId,
      sourceCardId: q.sourceCardId || null,
      canGenerateMc: false,
      media: []
    };
    state.lastReveal = null;
    state.activeRound = buildRound(state, q);
    transition(state, "asking");
    return state;
  }

  function buildRound(state, q) {
    const startedAt = now();
    const room = roomForFaculty(state.faculty);
    const studentIds = room && ROOM_COHORT[room.id] ? ROOM_COHORT[room.id] : ["lyra", "sami"];
    const correct = q.correct || "A";
    const wrong = CHOICES.filter(function(c) { return c !== correct; });
    return {
      questionId: q.id,
      type: q.type || "multiple-choice",
      startedAt,
      durationMs: 25000,
      expiresAt: startedAt + 25000,
      idleTriggered: false,
      npcs: studentIds.map(function(studentId, i) {
        const gotIt = Math.random() > 0.35;
        return {
          studentId,
          delayMs: 1600 + i * 900 + Math.floor(Math.random() * 900),
          plannedPick: gotIt ? correct : wrong[Math.floor(Math.random() * wrong.length)] || correct,
          rolledTotal: gotIt ? 9 : 5,
          rolledStat: q.stat || "head",
          rolledDice: gotIt ? [4, 5] : [2, 3],
          outcome: gotIt ? "mixed" : "miss",
          answeredAt: null
        };
      }),
      player: { picked: null, answerText: null, answeredAt: null },
      resolved: false,
      resolvedAt: null,
      firstCorrect: null,
      opinionResponses: [],
      opinionGrades: [],
      bestResponder: null,
      advantage: null,
      isBonus: false,
      classSession: {
        mode: "class",
        facultyId: state.faculty,
        grade: state.currentGrade || "9",
        date: dailyKey(),
        index: 1,
        total: 3
      },
      cardRole: "class",
      stat: q.stat || "head"
    };
  }

  function roll2d6() {
    const a = Math.floor(Math.random() * 6) + 1;
    const b = Math.floor(Math.random() * 6) + 1;
    return { dice: [a, b], total: a + b };
  }

  function classify(total) {
    if (total >= 10) return "hit";
    if (total >= 7) return "mixed";
    return "miss";
  }

  function pickEliminated(correct, outcome) {
    const wrong = CHOICES.filter(function(c) { return c !== correct; });
    for (let i = wrong.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = wrong[i];
      wrong[i] = wrong[j];
      wrong[j] = tmp;
    }
    if (outcome === "hit") return wrong.slice(0, 2);
    if (outcome === "mixed") return wrong.slice(0, 1);
    return [];
  }

  function answerQuestion(state, picked) {
    if (!state.current || !state.activeRound) throw new Error("No active question.");
    picked = String(picked || "").toUpperCase();
    if (CHOICES.indexOf(picked) === -1) throw new Error("Pick must be A, B, C, or D.");
    const q = state.current;
    const correct = q.correct || "A";
    const wasCorrect = picked === correct;
    const answeredAt = now();
    const roll = roll2d6();
    const stat = q.stat || "head";
    const mod = state.character && state.character.stats ? Number(state.character.stats[stat] || 0) : 0;
    const total = roll.total + mod;
    const outcome = classify(total);
    state.activeRound.player = { picked, answerText: null, answeredAt };
    state.activeRound.resolved = true;
    state.activeRound.resolvedAt = answeredAt;
    state.activeRound.firstCorrect = wasCorrect ? "player" : null;
    state.activeRound.npcs = state.activeRound.npcs.map(function(n) {
      return Object.assign({}, n, { answeredAt: n.answeredAt || (state.activeRound.startedAt + n.delayMs) });
    });
    state.score.total += 1;
    state.score.possible = Number(state.score.possible || 0) + 100;
    if (wasCorrect) {
      state.score.correct += 1;
      state.score.points = Number(state.score.points || 0) + (outcome === "hit" ? 100 : outcome === "mixed" ? 90 : 80);
    }
    state.history.push({ questionId: q.id, picked, correct, wasCorrect, at: answeredAt });
    state.lastReveal = {
      questionId: q.id,
      questionPrompt: q.prompt,
      questionType: q.type || "multiple-choice",
      questionOptions: q.options,
      questionSubject: q.subject || null,
      questionDifficulty: q.difficulty || null,
      picked,
      correct,
      wasCorrect,
      explanation: q.explanation || null,
      encouragement: wasCorrect ? "Correct." : "Not quite.",
      scoreAward: wasCorrect ? { base: outcome === "hit" ? 100 : outcome === "mixed" ? 90 : 80, multiplier: 1, points: outcome === "hit" ? 100 : outcome === "mixed" ? 90 : 80, possible: 100 } : { base: 0, multiplier: 1, points: 0, possible: 100 },
      playerRoll: { stat, dice: roll.dice, total, outcome },
      classProgress: {
        mode: "class",
        cardRole: "class",
        facultyId: state.faculty,
        grade: state.currentGrade || "9",
        date: dailyKey(),
        questionCount: 1,
        totalQuestions: 3,
        completed: false,
        letterGrade: wasCorrect ? "B" : "F",
        score: wasCorrect ? 85 : 0
      },
      npcEvents: state.activeRound.npcs.map(function(n) {
        return { studentId: n.studentId, gotIt: n.plannedPick === correct };
      })
    };
    transition(state, "revealed");
    return state;
  }

  function rollAdvantage(state) {
    if (!state.current || !state.activeRound || state.activeRound.resolved) {
      return { state, result: null, reason: "no-round" };
    }
    if (state.activeRound.advantage && state.activeRound.advantage.rolled) {
      return { state, result: state.activeRound.advantage, reason: "already-rolled" };
    }
    if (state.activeRound.player && state.activeRound.player.answeredAt != null) {
      return { state, result: null, reason: "answered" };
    }
    const stat = state.current.stat || "head";
    const r = roll2d6();
    const mod = state.character && state.character.stats ? Number(state.character.stats[stat] || 0) : 0;
    const total = r.total + mod;
    const outcome = classify(total);
    const advantage = {
      rolled: true,
      stat,
      dice: r.dice,
      total,
      outcome,
      eliminated: pickEliminated(state.current.correct || "A", outcome),
      rolledAt: now()
    };
    state.activeRound.advantage = advantage;
    if (state.character && state.currentGrade) {
      state.character.advantageRollsUsed = state.character.advantageRollsUsed || {};
      state.character.advantageRollsUsed[state.currentGrade] = Number(state.character.advantageRollsUsed[state.currentGrade] || 0) + 1;
    }
    return { state, result: advantage };
  }

  function createCharacter(state, body) {
    const playbook = DATA.playbooks.find(function(p) { return p.id === body.playbookId; }) || DATA.playbooks[0];
    state.character = {
      name: String(body.name || "Student"),
      playbookId: playbook.id,
      stats: body.stats || playbook.suggestedStats,
      arcAnswer: String(body.arcAnswer || ""),
      flavorQuote: body.flavorQuote ? String(body.flavorQuote) : "",
      personality: String(body.personality || ""),
      portraitDataUrl: body.portraitDataUrl ? String(body.portraitDataUrl) : "",
      yearbook: [],
      streak: { grade: "9", count: 0 },
      lastBonusDate: "",
      subjectScores: {},
      advantageRollsUsed: {},
      advantageRollBonuses: {},
      classAffinity: {},
      dailyClasses: {},
      mashCard: emptyMashCard(),
      createdAt: now()
    };
    state.currentGrade = "9";
    state.completedGrades = [];
    state.hasSeenIntro = true;
    transition(state, "in-room");
    return state;
  }

  function handleCommand(body) {
    let state = loadState();
    const type = body && body.type;
    let message = "OK";
    if (type === "pick" || type === "play-daily" || type === "play-bonus") {
      state = pickQuestion(state);
      message = "Picked";
    } else if (type === "answer") {
      state = answerQuestion(state, body.picked);
      message = state.lastReveal && state.lastReveal.wasCorrect ? "Correct" : "Marked";
    } else if (type === "roll-advantage") {
      const result = rollAdvantage(state);
      state = result.state;
      message = result.result ? "Rolled" : "No active question to roll on.";
    } else if (type === "set-faculty") {
      const faculty = String(body.faculty || "ruby");
      state.faculty = faculty === "lounge" ? "lounge" : facultyById(faculty).id;
      state.current = null;
      state.lastReveal = null;
      state.activeRound = null;
      transition(state, state.faculty === "lounge" ? "lounge" : "in-room");
      message = "Now teaching: " + state.faculty;
    } else if (type === "clear") {
      state.current = null;
      state.lastReveal = null;
      state.activeRound = null;
      transition(state, state.faculty === "lounge" ? "lounge" : "in-room");
      message = "Cleared";
    } else if (type === "reset") {
      state = defaultState();
      message = "Session reset";
    } else if (type === "create-character") {
      state = createCharacter(state, body || {});
      message = "Character created";
    } else if (type === "clear-character") {
      state.character = null;
      state.current = null;
      state.lastReveal = null;
      state.activeRound = null;
      transition(state, "in-room");
      message = "Character cleared";
    } else if (type === "set-portrait") {
      if (state.character) state.character.portraitDataUrl = String(body.portraitDataUrl || "");
      message = "Portrait updated";
    } else if (type === "select-grade") {
      const grade = String(body.grade || "9");
      if (GRADES.indexOf(grade) === -1) throw new Error("Grade must be 9, 10, 11, or 12.");
      state.currentGrade = grade;
      message = "Grade set to " + grade;
    } else if (type === "mark-intro-seen") {
      state.hasSeenIntro = true;
      message = "Intro acknowledged";
    } else if (type === "force-resolve") {
      if (state.current && state.activeRound && !state.activeRound.resolved) state = answerQuestion(state, "A");
      message = "Round resolved";
    }
    saveState(state);
    return { success: true, message, session: buildSession(state) };
  }

  function activeRoundView(state) {
    const round = state.activeRound;
    if (!round) return null;
    const currentNow = now();
    const reveal = !!round.resolved;
    return {
      type: round.type || "multiple-choice",
      questionId: round.questionId,
      stat: round.stat || (state.current && state.current.stat) || "head",
      isBonus: false,
      classSession: round.classSession || null,
      cardRole: round.cardRole || "class",
      startedAt: round.startedAt,
      durationMs: round.durationMs,
      expiresAt: round.expiresAt,
      elapsedMs: Math.max(0, currentNow - round.startedAt),
      remainingMs: Math.max(0, round.expiresAt - currentNow),
      npcs: round.npcs.map(function(n) {
        const answered = reveal || currentNow >= round.startedAt + n.delayMs;
        return {
          studentId: n.studentId,
          delayMs: n.delayMs,
          answeredAt: answered ? (round.startedAt + n.delayMs) : null,
          isLocked: answered,
          pick: reveal && answered ? n.plannedPick : null,
          isCorrect: reveal && answered && state.current ? n.plannedPick === state.current.correct : null
        };
      }),
      player: {
        picked: reveal ? round.player.picked : null,
        answerText: reveal ? round.player.answerText || null : null,
        answeredAt: round.player.answeredAt,
        isLocked: round.player.answeredAt != null,
        timedOut: false
      },
      resolved: !!round.resolved,
      idleTriggered: false,
      firstCorrect: reveal ? round.firstCorrect : null,
      opinionResponses: [],
      opinionGrades: [],
      bestResponder: null,
      advantage: round.advantage || null
    };
  }

  function courseProgress(state, facultyId) {
    const total = questionBank(facultyId).length;
    const answered = state.history.filter(function(h) {
      const q = questionBank(facultyId).find(function(candidate) { return candidate.id === h.questionId; });
      return !!q;
    });
    const correct = answered.filter(function(h) { return h.wasCorrect; }).length;
    const avg = answered.length ? Math.round((correct / answered.length) * 100) : undefined;
    const today = state.current && state.faculty === facultyId
      ? { mode: "class", status: state.activeRound && state.activeRound.resolved ? "complete" : "active", questionCount: state.activeRound && state.activeRound.resolved ? 1 : 0, totalQuestions: 3, letterGrade: avg == null ? undefined : letterGrade(avg), score: avg }
      : { mode: "class", status: "available", questionCount: 0, totalQuestions: 3 };
    return {
      mode: "bank",
      facultyId,
      displayName: facultyById(facultyId).displayName,
      total,
      ready: Math.max(0, total - answered.length),
      canPick: facultyId !== "lounge" && total > 0,
      nextCardRole: "class",
      grade: avg == null ? undefined : letterGrade(avg),
      completedClasses: 0,
      requiredClasses: 1,
      averageScore: avg,
      today,
      mastered: correct,
      learning: Math.max(0, answered.length - correct),
      shaky: 0,
      new: Math.max(0, total - answered.length)
    };
  }

  function letterGrade(score) {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "F";
  }

  function buildSession(state) {
    const activeFaculty = facultyById(state.faculty === "lounge" ? "ruby" : state.faculty);
    const roster = FACULTY.map(function(f) {
      const progress = courseProgress(state, f.id);
      return Object.assign({}, f, {
        questionCount: questionBank(f.id).length,
        subjects: f.subjects,
        courseGrade: progress.grade,
        completedClasses: progress.completedClasses,
        requiredClasses: progress.requiredClasses,
        averageScore: progress.averageScore,
        todayClass: progress.today,
        readyCount: progress.ready,
        masteredCount: progress.mastered,
        learningCount: progress.learning,
        shakyCount: progress.shaky,
        newCount: progress.new
      });
    });
    const telemetry = {
      faculty: state.faculty,
      facultyDisplayName: state.faculty === "lounge" ? "Teachers' Lounge" : activeFaculty.displayName,
      facultyAccent: state.faculty === "lounge" ? "#9b6dff" : activeFaculty.accent,
      subject: state.subject,
      difficulty: state.current && state.current.difficulty || null,
      scoreCorrect: state.score.correct,
      scoreTotal: state.score.total,
      scorePoints: state.score.points || 0,
      scorePossible: state.score.possible || 0,
      status: state.status,
      phase: state.phase,
      phaseToken: state.phaseToken,
      current: state.current ? {
        id: state.current.id,
        prompt: state.current.prompt,
        type: state.current.type || "multiple-choice",
        options: state.current.options || { A: "", B: "", C: "", D: "" },
        subject: state.current.subject || null,
        stat: state.current.stat || null,
        difficulty: state.current.difficulty || null,
        sourceCardId: null,
        canGenerateMc: false,
        media: []
      } : null,
      lastReveal: state.lastReveal,
      faculty_roster: roster,
      asked_count: state.askedQuestionIds.length,
      store_path: "localStorage",
      current_grade: state.currentGrade,
      completed_grades: state.completedGrades,
      has_seen_intro: state.hasSeenIntro,
      active_pack: { id: "ruby-high-original", name: "Ruby High", description: "Bundled offline curriculum." },
      active_course: { id: activeFaculty.id, title: roomForFaculty(activeFaculty.id) ? roomForFaculty(activeFaculty.id).name : activeFaculty.displayName, facultyId: activeFaculty.id, roomId: roomForFaculty(activeFaculty.id) ? roomForFaculty(activeFaculty.id).id : "homeroom", teacherTemplateId: activeFaculty.id, subjects: activeFaculty.subjects },
      active_course_progress: state.faculty === "lounge" ? null : courseProgress(state, state.faculty),
      courses: FACULTY.map(function(f) { const room = roomForFaculty(f.id); return { id: f.id, title: room ? room.name : f.displayName, facultyId: f.id, roomId: room ? room.id : f.id, teacherTemplateId: f.id, subjects: f.subjects }; }),
      available_packs: [{ id: "ruby-high-original", name: "Ruby High", description: "Bundled offline curriculum.", faculty_count: FACULTY.length, question_count: Object.values(DATA.questions).reduce(function(sum, list) { return sum + list.length; }, 0) }],
      rooms: ROOMS,
      npc_roster: state.currentGrade ? (state.npcRosters[state.currentGrade] || []) : [],
      room_cohort: ROOM_COHORT,
      active_round: activeRoundView(state),
      is_opinion: false,
      character: state.character,
      school_events: state.schoolEvents || [],
      playbooks: DATA.playbooks,
      daily: { available: !!state.character, facultyId: state.faculty === "lounge" ? "ruby" : state.faculty, dailyKey: dailyKey() },
      npc_cohort: state.npcCohort || [],
      mentor_offer: null,
      advantage_rolls: deriveAdvantageRolls(state),
      graduation_ready: state.character && state.character.pendingGraduation || null
    };
    return {
      sessionId: SESSION_ID,
      appName: "@cenetex/app-ruby-high",
      mode: "spectate-and-steer",
      status: "running",
      displayName: "Ruby High",
      canSendCommands: true,
      controls: ["pause", "resume"],
      summary: telemetry.current ? telemetry.current.prompt : "Ruby High offline",
      goalLabel: "Ruby High",
      suggestedPrompts: [],
      telemetry
    };
  }

  function deriveAdvantageRolls(state) {
    const grade = state.currentGrade || "9";
    const used = state.character && state.character.advantageRollsUsed ? Number(state.character.advantageRollsUsed[grade] || 0) : 0;
    const cap = 3;
    return { used, cap, remaining: Math.max(0, cap - used) };
  }

  function json(data, status) {
    return Promise.resolve(new Response(JSON.stringify(data), {
      status: status || 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    }));
  }

  function text(data, status, contentType) {
    return Promise.resolve(new Response(data, {
      status: status || 200,
      headers: { "Content-Type": contentType || "text/plain; charset=utf-8", "Cache-Control": "no-store" }
    }));
  }

  async function requestJson(init) {
    try {
      if (!init || !init.body) return {};
      return JSON.parse(String(init.body));
    } catch (_err) {
      return {};
    }
  }

  window.fetch = async function(input, init) {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
    if (!url.pathname.startsWith(APP_BASE)) return ORIGINAL_FETCH(input, init);
    const method = String((init && init.method) || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    try {
      if (url.pathname === APP_BASE + "/auth/me" && method === "GET") {
        return json({ session: { id: SESSION_ID, kind: "offline" }, ai: false });
      }
      if (url.pathname === APP_BASE + "/auth/guest" && method === "POST") {
        saveState(loadState());
        return json({ session: { id: SESSION_ID, kind: "offline" }, ai: false });
      }
      if (url.pathname === APP_BASE + "/auth/logout" && method === "POST") {
        return json({ ok: true });
      }
      if (url.pathname === APP_BASE + "/packs" && method === "GET") {
        return json({ active_pack_id: "ruby-high-original", packs: buildSession(loadState()).telemetry.available_packs });
      }
      if (url.pathname.startsWith(APP_BASE + "/packs/")) {
        return json({ error: "Pack imports need the hosted Ruby High server." }, 501);
      }
      if (url.pathname.startsWith(APP_BASE + "/chat/")) {
        if (url.pathname === APP_BASE + "/chat/history") return json({ authed: false, messages: [] });
        return text("event: done\\ndata: {}\\n\\n", 200, "text/event-stream; charset=utf-8");
      }
      const sessionPrefix = APP_BASE + "/session/";
      if (url.pathname.startsWith(sessionPrefix)) {
        if (method === "GET" && !url.pathname.endsWith("/command") && !url.pathname.endsWith("/control")) {
          return json(buildSession(loadState()));
        }
        if (method === "POST" && url.pathname.endsWith("/control")) {
          return json({ success: true, message: "Offline mode keeps running locally.", session: null });
        }
        if (method === "POST" && url.pathname.endsWith("/command")) {
          const body = await requestJson(init || {});
          return json(handleCommand(body));
        }
      }
      return ORIGINAL_FETCH(input, init);
    } catch (err) {
      return json({ error: err && err.message ? err.message : String(err) }, 400);
    }
  };

  const style = document.createElement("style");
  style.textContent = "#footer-action{display:none!important}";
  document.head.appendChild(style);
})();`;
}

function manifestJson() {
  return {
    name: "Ruby High",
    short_name: "Ruby High",
    description: "Offline Ruby High classroom.",
    id: `${appBase}/`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#15171f",
    theme_color: "#1a1c25",
    categories: ["education", "games"],
    icons: [{ src: `${appBase}/assets/ruby.png`, sizes: "1280x1280", type: "image/png", purpose: "any" }],
  };
}

function serviceWorkerJs() {
  return `const CACHE_NAME = "ruby-high-spa-v1";
const CORE = ["/", "/index.html", "${appBase}/manifest.webmanifest", "${appBase}/assets/logo.png", "${appBase}/assets/ruby.png"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((key) => key === CACHE_NAME ? undefined : caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request)));
});
`;
}

export async function buildSpa() {
  const viewerModuleUrl = pathToFileURL(resolve(root, "dist", "index.js")).href;
  const { renderViewerHtml } = await import(viewerModuleUrl);
  const questions = await readQuestions();
  const html = renderViewerHtml({
    agentName: "Ruby",
    sessionId: "rh:offline",
    apiBase: appBase,
    role: "human",
  });
  const offlineScript = `<script>${offlineApiScript({ questions, playbooks })}</script>`;
  const outputHtml = html.replace("<script>", `${offlineScript}\n<script>`);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(resolve(outDir, appBase.slice(1), "assets"), { recursive: true });
  await cp(resolve(root, "assets"), resolve(outDir, appBase.slice(1), "assets"), { recursive: true });
  await writeFile(resolve(outDir, "index.html"), outputHtml, "utf8");
  await writeFile(resolve(outDir, appBase.slice(1), "manifest.webmanifest"), JSON.stringify(manifestJson(), null, 2), "utf8");
  await writeFile(resolve(outDir, appBase.slice(1), "service-worker.js"), serviceWorkerJs(), "utf8");
  return outDir;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = await buildSpa();
  console.log(`Ruby High SPA written to ${dir}`);
}
