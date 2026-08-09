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

const corpusFiles = {
  ruby: "ruby.md",
  "sally-science": "sally-science.md",
  "professor-edward": "professor-edward.md",
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
  for (const [facultyId, fileName] of Object.entries(corpusFiles)) {
    const raw = await readFile(resolve(root, "assets", "corpora", fileName), "utf8").catch(() => "");
    if (!raw) continue;
    out[facultyId] = [...(out[facultyId] || []), ...parseCorpusQuestions(raw, facultyId)];
  }
  return out;
}

function parseCorpusQuestions(raw, facultyId) {
  const rows = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*-+/.test(line))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
  if (!rows.length) return [];
  const header = rows[0].map((cell) => cell.toLowerCase());
  const col = (name) => header.indexOf(name);
  const idIndex = col("id");
  const subjectIndex = col("subject");
  const difficultyIndex = col("difficulty");
  const frontIndex = col("front");
  const backIndex = col("back");
  return rows.slice(1)
    .map((row) => {
      const id = row[idIndex] || "";
      const subject = row[subjectIndex] || "open study";
      const difficulty = row[difficultyIndex] || "medium";
      const front = row[frontIndex] || "";
      const back = row[backIndex] || "";
      if (!id || !front || !back) return null;
      return {
        id,
        prompt: front,
        type: "typed-answer",
        expectedAnswer: back,
        acceptedAnswers: [back],
        sourceCardId: id,
        canGenerateMc: true,
        subject,
        difficulty,
        minGrade: difficulty === "easy" ? "10" : difficulty === "medium" ? "11" : "12",
        faculty: facultyId,
      };
    })
    .filter(Boolean);
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
  const WELCOME_HALL_PASS_GRANT = 5;
  const WELCOME_HALL_PASS_GRANT_ID = "system:welcome-hall-passes:v1";
  const LOCAL_LLM_BASE_KEY = "ruby-high:local-llm-base";
  const LOCAL_LLM_MODEL_KEY = "ruby-high:local-llm-model";
  const LOCAL_LLM_API_KEY = "ruby-high:local-llm-api-key";
  const DEFAULT_LOCAL_LLM_BASE = "http://127.0.0.1:11434/v1";
  const DEFAULT_LOCAL_LLM_MODEL = "ruby-high-local";
  const DATA = ${scriptJson(data)};
  const ORIGINAL_FETCH = window.fetch.bind(window);
  const CHOICES = ["A", "B", "C", "D"];
  const GRADES = ["9", "10", "11", "12"];
  const FIRST_BELL_PAGE_COUNT = 12;
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
      wallet: { meritStars: 0, hallPasses: 0 },
      lastReveal: null,
      status: "idle",
      phase: "in-room",
      phaseToken: 1,
      askedQuestionIds: [],
      currentGrade: "9",
      completedGrades: [],
      hasSeenIntro: true,
      activePackId: "ruby-high-original",
      guestPackMode: "auto",
      guestPackOverrideId: null,
      character: null,
      studentPool: [],
      characterSlots: { unlockedSlots: 1, photoDayCredits: 0 },
      comicCollection: defaultComicCollection(),
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

  function defaultComicCollection() {
    return {
      issueId: "first-bell",
      title: "Ruby High: Book One - First Bell",
      pageCount: FIRST_BELL_PAGE_COUNT,
      unlockedPages: []
    };
  }

  function ensureComicCollection(state) {
    const raw = state && state.comicCollection && typeof state.comicCollection === "object" ? state.comicCollection : {};
    const seen = new Set();
    const unlockedPages = Array.isArray(raw.unlockedPages)
      ? raw.unlockedPages.map(function(page) {
        const pageNumber = Math.floor(Number(page && page.pageNumber));
        if (!Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > FIRST_BELL_PAGE_COUNT || seen.has(pageNumber)) return null;
        seen.add(pageNumber);
        return {
          issueId: "first-bell",
          pageId: page.pageId || ("first-bell-page-" + String(pageNumber).padStart(2, "0")),
          pageNumber,
          unlockedAt: Number(page.unlockedAt || now()),
          reason: page.reason || "legacy",
          sourceId: page.sourceId || "",
          label: page.label || ""
        };
      }).filter(Boolean)
      : [];
    state.comicCollection = {
      issueId: "first-bell",
      title: "Ruby High: Book One - First Bell",
      pageCount: FIRST_BELL_PAGE_COUNT,
      unlockedPages
    };
    return state.comicCollection;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const loaded = ensureWallet(Object.assign(defaultState(), JSON.parse(raw)));
        ensureCharacterSlots(loaded);
        ensureComicCollection(loaded);
        return loaded;
      }
    } catch (_err) {}
    const state = ensureWallet(defaultState());
    ensureCharacterSlots(state);
    ensureComicCollection(state);
    return state;
  }

  function saveState(state) {
    ensureWallet(state);
    ensureCharacterSlots(state);
    ensureComicCollection(state);
    state.updatedAt = now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_err) {}
    return state;
  }

  function ensureWallet(state) {
    const scorePoints = state && state.score ? Math.max(0, Math.floor(Number(state.score.points || 0))) : 0;
    const raw = state && state.wallet && typeof state.wallet === "object" ? state.wallet : {};
    const transactions = Array.isArray(raw.transactions) ? raw.transactions.filter(function(tx) {
      return tx && typeof tx === "object" && typeof tx.id === "string" && typeof tx.kind === "string";
    }).slice(-200) : [];
    const existingWelcome = transactions.find(function(tx) { return tx.id === WELCOME_HALL_PASS_GRANT_ID; }) || null;
    const welcomeAt = Math.floor(Number(raw.welcomeHallPassesGrantedAt || 0));
    const hasWelcome = welcomeAt > 0 || !!existingWelcome;
    state.wallet = {
      meritStars: Math.max(0, Math.floor(Number(raw.meritStars != null ? raw.meritStars : scorePoints))),
      hallPasses: Math.max(0, Math.floor(Number(raw.hallPasses || 0))),
      ...(hasWelcome ? { welcomeHallPassesGrantedAt: welcomeAt > 0 ? welcomeAt : Number(existingWelcome.at || now()) } : {}),
      ...(transactions.length > 0 ? { transactions } : {})
    };
    if (!hasWelcome) {
      const grantedAt = now();
      const tx = {
        id: WELCOME_HALL_PASS_GRANT_ID,
        kind: "hall-pass-grant",
        at: grantedAt,
        hallPasses: WELCOME_HALL_PASS_GRANT,
        source: "system",
        description: "Welcome Hall Passes",
        metadata: { reason: "account-welcome" }
      };
      state.wallet.hallPasses += WELCOME_HALL_PASS_GRANT;
      state.wallet.welcomeHallPassesGrantedAt = grantedAt;
      state.wallet.transactions = transactions.concat([tx]).slice(-200);
    }
    return state;
  }

  function ensureCharacterSlots(state) {
    const raw = state && state.characterSlots && typeof state.characterSlots === "object" ? state.characterSlots : {};
    state.characterSlots = {
      unlockedSlots: Math.max(1, Math.floor(Number(raw.unlockedSlots || 1))),
      photoDayCredits: Math.max(0, Math.floor(Number(raw.photoDayCredits || 0)))
    };
    return state.characterSlots;
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

  function builtInPackSummary() {
    return {
      id: "ruby-high-original",
      name: "Ruby High Original",
      description: "The built-in Ruby High classroom pack.",
      readOnly: true,
      builtIn: true,
      owner: false,
      enabled: true,
      active: true,
      canEdit: false,
      status: "published",
      facultyCount: FACULTY.length,
      questionCount: FACULTY.reduce(function(sum, faculty) {
        return sum + questionBank(faculty.id).length;
      }, 0),
      courses: [
        { id: "ruby", title: "Homeroom", facultyId: "ruby", roomId: "homeroom", subjects: FACULTY[0].subjects },
        { id: "sally-science", title: "Science", facultyId: "sally-science", roomId: "science", subjects: FACULTY[1].subjects },
        { id: "professor-edward", title: "Literature", facultyId: "professor-edward", roomId: "literature", subjects: FACULTY[2].subjects }
      ]
    };
  }

  function difficultyForGrade(grade) {
    if (grade === "9") return "easy";
    if (grade === "10" || grade === "11") return "medium";
    return "hard";
  }

  function difficultiesForGrade(grade) {
    if (grade === "9") return ["easy"];
    if (grade === "10") return ["easy", "medium"];
    return ["easy", "medium", "hard"];
  }

  function difficultyWeightsForGrade(grade) {
    if (grade === "9") return { easy: 1 };
    if (grade === "10") return { easy: 0.35, medium: 0.65 };
    if (grade === "11") return { easy: 0.1, medium: 0.55, hard: 0.35 };
    return { medium: 0.25, hard: 0.75 };
  }

  function weightedDifficulty(pool, weights) {
    var entries = ["easy", "medium", "hard"].map(function(difficulty) {
      return { difficulty: difficulty, weight: Math.max(0, Number(weights[difficulty] || 0)) };
    }).filter(function(entry) {
      return entry.weight > 0 && pool.some(function(q) { return q.difficulty === entry.difficulty; });
    });
    var total = entries.reduce(function(sum, entry) { return sum + entry.weight; }, 0);
    if (total <= 0) return null;
    var cursor = Math.random() * total;
    for (var i = 0; i < entries.length; i += 1) {
      cursor -= entries[i].weight;
      if (cursor <= 0) return entries[i].difficulty;
    }
    return entries.length ? entries[entries.length - 1].difficulty : null;
  }

  function materializeQuestion(q) {
    if ((q.type || "multiple-choice") !== "multiple-choice") return q;
    var correct = String(q.correct || "").trim();
    var decoys = Array.isArray(q.decoys)
      ? q.decoys.map(function(value) { return String(value || "").trim(); }).filter(Boolean)
      : [];
    if (!decoys.length && q.options && CHOICES.indexOf(correct) !== -1) {
      var legacyChoice = correct;
      correct = String(q.options[legacyChoice] || "").trim();
      decoys = CHOICES
        .filter(function(choice) { return choice !== legacyChoice; })
        .map(function(choice) { return String(q.options[choice] || "").trim(); })
        .filter(Boolean);
    }
    if (!correct || decoys.length < 3) throw new Error("Offline MCQ is missing correct answer text or decoys.");
    var candidateDecoys = decoys.slice();
    for (var i = candidateDecoys.length - 1; i > 0; i -= 1) {
      var decoySwap = Math.floor(Math.random() * (i + 1));
      var decoyTmp = candidateDecoys[i];
      candidateDecoys[i] = candidateDecoys[decoySwap];
      candidateDecoys[decoySwap] = decoyTmp;
    }
    var answers = [{ text: correct, isCorrect: true }]
      .concat(candidateDecoys.slice(0, 3).map(function(text) { return { text, isCorrect: false }; }));
    for (var j = answers.length - 1; j > 0; j -= 1) {
      var answerSwap = Math.floor(Math.random() * (j + 1));
      var answerTmp = answers[j];
      answers[j] = answers[answerSwap];
      answers[answerSwap] = answerTmp;
    }
    var options = {};
    var correctChoice = "A";
    answers.forEach(function(answer, index) {
      var choice = CHOICES[index];
      options[choice] = answer.text;
      if (answer.isCorrect) correctChoice = choice;
    });
    return {
      correct,
      decoys,
      options,
      correctChoice
    };
  }

  function pickQuestion(state) {
    const facultyId = state.faculty === "lounge" ? "ruby" : state.faculty;
    const bank = questionBank(facultyId);
    const grade = state.currentGrade || "9";
    const gradeDifficulty = difficultyForGrade(grade);
    const allowed = difficultiesForGrade(grade);
    function gradeRank(g) {
      var idx = GRADES.indexOf(g || "9");
      return idx >= 0 ? idx : 0;
    }
    function unlocked(q) {
      return !q.minGrade || gradeRank(grade) >= gradeRank(q.minGrade);
    }
    const unseen = bank.filter(function(q) {
      return unlocked(q) && state.askedQuestionIds.indexOf(q.id) === -1 && (!q.difficulty || allowed.indexOf(q.difficulty) !== -1);
    });
    const fallback = bank.filter(function(q) { return unlocked(q) && state.askedQuestionIds.indexOf(q.id) === -1; });
    const unlockedBank = bank.filter(unlocked);
    const basePool = unseen.length ? unseen : fallback.length ? fallback : unlockedBank.length ? unlockedBank : bank;
    const weighted = weightedDifficulty(basePool, difficultyWeightsForGrade(grade));
    const pool = weighted
      ? basePool.filter(function(q) { return q.difficulty === weighted; })
      : basePool;
    if (!pool.length) throw new Error("No offline questions are bundled for this room.");
    const q = clone(pool[Math.floor(Math.random() * pool.length)]);
    const posed = materializeQuestion(q);
    state.askedQuestionIds.push(q.id);
    state.faculty = facultyId;
    state.subject = q.subject || null;
    state.current = {
      id: q.id,
      prompt: q.prompt,
      type: q.type || "multiple-choice",
      correct: posed.correct,
      decoys: posed.decoys,
      options: posed.options,
      correctChoice: posed.correctChoice,
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
    state.activeRound = buildRound(state, state.current);
    transition(state, "asking");
    return state;
  }

  function buildRound(state, q) {
    const startedAt = now();
    const room = roomForFaculty(state.faculty);
    const studentIds = room && ROOM_COHORT[room.id] ? ROOM_COHORT[room.id] : ["lyra", "sami"];
    const correct = q.correctChoice || "A";
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
    const correct = q.correctChoice || "A";
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
      const points = outcome === "hit" ? 100 : outcome === "mixed" ? 90 : 80;
      const wallet = ensureWallet(state);
      state.score.points = Number(state.score.points || 0) + points;
      wallet.meritStars += points;
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
        correctCount: wasCorrect ? 1 : 0,
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
      eliminated: pickEliminated(state.current.correctChoice || "A", outcome),
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
    resetActiveCharacterProgress(state);
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
    return state;
  }

  function studentPoolIdFor(ch) {
    const seed = Number(ch && ch.createdAt) || (ch && ch.yearbook && ch.yearbook[0] && Number(ch.yearbook[0].completedAt)) || now();
    const name = String(ch && ch.name || "student").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "student";
    const playbook = String(ch && ch.playbookId || "playbook").replace(/[^a-z0-9-]+/gi, "-").slice(0, 32) || "playbook";
    return "student_" + seed + "_" + name + "_" + playbook;
  }

  function archiveCompletedCharacter(state, ch) {
    if (!ch || !Array.isArray(ch.yearbook) || ch.yearbook.length < 4) return null;
    const completedAt = Math.max.apply(null, ch.yearbook.map(function(y) { return Number(y.completedAt) || 0; })) || now();
    const entry = {
      id: studentPoolIdFor(ch),
      name: String(ch.name || "Student"),
      playbookId: String(ch.playbookId || "overachiever"),
      stats: clone(ch.stats || { head: 0, heart: 0, hustle: 0, honor: 0 }),
      arcAnswer: String(ch.arcAnswer || ""),
      personality: String(ch.personality || ""),
      yearbook: ch.yearbook.map(function(y) { return Object.assign({}, y, y.stats ? { stats: clone(y.stats) } : {}); }),
      createdAt: Number(ch.createdAt) || completedAt,
      completedAt
    };
    if (ch.flavorQuote) entry.flavorQuote = String(ch.flavorQuote);
    if (ch.portraitDataUrl) entry.portraitDataUrl = String(ch.portraitDataUrl);
    if (ch.diplomaImageDataUrl) entry.diplomaImageDataUrl = String(ch.diplomaImageDataUrl);
    if (ch.levelUps) entry.levelUps = clone(ch.levelUps);
    if (ch.inheritedFrom) entry.inheritedFrom = clone(ch.inheritedFrom);
    if (ch.mashCard) entry.mashCard = clone(ch.mashCard);
    const pool = Array.isArray(state.studentPool) ? state.studentPool.slice() : [];
    const existing = pool.findIndex(function(s) { return s.id === entry.id; });
    if (existing >= 0) pool[existing] = entry;
    else pool.push(entry);
    pool.sort(function(a, b) { return Number(a.completedAt || 0) - Number(b.completedAt || 0) || String(a.name || "").localeCompare(String(b.name || "")); });
    state.studentPool = pool.slice(-50);
    return entry;
  }

  function resetActiveCharacterProgress(state) {
    state.current = null;
    state.lastReveal = null;
    state.activeRound = null;
    state.pendingRoll = null;
    state.askedQuestionIds = [];
    state.currentGrade = "9";
    state.completedGrades = [];
    state.hasSeenIntro = true;
    state.schoolEvents = [];
    state.npcRosters = {
      "9": buildNpcRoster("9"),
      "10": buildNpcRoster("10"),
      "11": buildNpcRoster("11"),
      "12": buildNpcRoster("12")
    };
    state.npcCohort = STUDENT_IDS.map(function(id) {
      return { id, grade: "9", streak: { grade: "9", count: 0 }, completedGrades: [], graduated: false };
    });
    transition(state, "in-room");
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
      const existed = !!state.character;
      if (!state.character) state = createCharacter(state, body || {});
      if (body.startFirstBell && !state.current && !(state.activeRound && !state.activeRound.resolved)) {
        state = pickQuestion(state);
      }
      message = existed
        ? state.current ? "Character already created. First Bell ready." : "Character already created"
        : state.current ? "Character created. First Bell ready." : "Character created";
    } else if (type === "clear-character") {
      archiveCompletedCharacter(state, state.character);
      state.character = null;
      resetActiveCharacterProgress(state);
      message = "Active slot cleared";
    } else if (type === "unlock-character-slot") {
      const slots = ensureCharacterSlots(state);
      const wallet = ensureWallet(state);
      if (wallet.hallPasses < 1) throw new Error("Not enough Hall Passes. Need 1, have " + wallet.hallPasses + ".");
      const requestId = String(body.requestId || now()).replace(/[^a-zA-Z0-9:_-]+/g, "-").slice(0, 80);
      const txId = "character-slot:" + SESSION_ID + ":" + requestId;
      const existing = wallet.transactions && wallet.transactions.find(function(tx) { return tx.id === txId; });
      if (!existing) {
        const nextSlot = slots.unlockedSlots + 1;
        wallet.hallPasses -= 1;
        wallet.transactions = (wallet.transactions || []).concat([{
          id: txId,
          kind: "hall-pass-spend",
          at: now(),
          hallPasses: -1,
          source: "character-slot",
          description: "Character slot " + nextSlot,
          metadata: { slotNumber: nextSlot, photoDayCredits: 1 }
        }]).slice(-200);
        slots.unlockedSlots += 1;
        slots.photoDayCredits += 1;
      }
      message = "Character slot unlocked";
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
          isCorrect: reveal && answered && state.current ? n.plannedPick === state.current.correctChoice : null
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
      ? { mode: "class", status: state.activeRound && state.activeRound.resolved ? "complete" : "active", questionCount: state.activeRound && state.activeRound.resolved ? 1 : 0, correctCount: state.activeRound && state.activeRound.resolved ? correct : 0, totalQuestions: 3, letterGrade: avg == null ? undefined : letterGrade(avg), score: avg }
      : { mode: "class", status: "available", questionCount: 0, correctCount: 0, totalQuestions: 3 };
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
      meritStars: ensureWallet(state).meritStars,
      hallPasses: ensureWallet(state).hallPasses,
      wallet: ensureWallet(state),
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
      guest_pack: { mode: "auto", weekKey: "", auto: null, overrideId: null, active: null },
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
      student_pool: state.studentPool || [],
      character_slots: Object.assign({}, ensureCharacterSlots(state), { costHallPasses: 1, photoDayCreditsPerSlot: 1 }),
      comic_collection: ensureComicCollection(state),
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

  function localLlmBaseUrl() {
    try {
      const stored = localStorage.getItem(LOCAL_LLM_BASE_KEY);
      if (!stored || isOldDefaultLocalLlmBase(stored)) {
        localStorage.setItem(LOCAL_LLM_BASE_KEY, DEFAULT_LOCAL_LLM_BASE);
        return DEFAULT_LOCAL_LLM_BASE;
      }
      return stored;
    } catch (_err) { return DEFAULT_LOCAL_LLM_BASE; }
  }

  function localLlmModel() {
    try {
      const stored = localStorage.getItem(LOCAL_LLM_MODEL_KEY);
      if (!stored || stored === "Qwen3-4B-Instruct-2507") {
        localStorage.setItem(LOCAL_LLM_MODEL_KEY, DEFAULT_LOCAL_LLM_MODEL);
        return DEFAULT_LOCAL_LLM_MODEL;
      }
      return stored;
    } catch (_err) { return DEFAULT_LOCAL_LLM_MODEL; }
  }

  function isOldDefaultLocalLlmBase(value) {
    const raw = String(value || "").trim().replace(/\\/+$/, "").toLowerCase();
    return raw === "http://127.0.0.1:8080"
      || raw === "http://127.0.0.1:8080/v1"
      || raw === "http://127.0.0.1:8080/v1/chat/completions"
      || raw === "http://localhost:8080"
      || raw === "http://localhost:8080/v1"
      || raw === "http://localhost:8080/v1/chat/completions";
  }

  function localLlmApiKey() {
    try { return localStorage.getItem(LOCAL_LLM_API_KEY) || ""; } catch (_err) { return ""; }
  }

  function normalizeLocalLlmUrl(value) {
    const raw = String(value || DEFAULT_LOCAL_LLM_BASE).trim().replace(/\\/+$/, "");
    if (!raw) return DEFAULT_LOCAL_LLM_BASE + "/chat/completions";
    if (raw.endsWith("/chat/completions")) return raw;
    if (raw.endsWith("/v1")) return raw + "/chat/completions";
    return raw + "/v1/chat/completions";
  }

  async function localChatCompletion(messages, opts) {
    const promptMessages = messages.map(function(message, index) {
      if (message && message.role === "user" && typeof message.content === "string") {
        const suffix = message.content.indexOf("/no_think") === -1 ? "\\n/no_think" : "";
        return Object.assign({}, message, { content: message.content + suffix });
      }
      return message;
    });
    const body = {
      model: localLlmModel(),
      messages: promptMessages,
      max_tokens: opts && opts.maxTokens ? opts.maxTokens : 180,
      temperature: opts && opts.temperature != null ? opts.temperature : 0.65,
      stream: false
    };
    const payload = JSON.stringify(body);
    const url = normalizeLocalLlmUrl(localLlmBaseUrl());
    const key = localLlmApiKey();
    let responseBody;
    try {
      responseBody = await postLocalChat(url, key, payload);
    } catch (err) {
      if (!isOldDefaultLocalLlmBase(localLlmBaseUrl())) throw err;
      try { localStorage.setItem(LOCAL_LLM_BASE_KEY, DEFAULT_LOCAL_LLM_BASE); } catch (_storageErr) {}
      responseBody = await postLocalChat(normalizeLocalLlmUrl(DEFAULT_LOCAL_LLM_BASE), key, payload);
    }
    const text = responseBody && responseBody.choices && responseBody.choices[0] && responseBody.choices[0].message
      ? String(responseBody.choices[0].message.content || "").trim()
      : "";
    if (!text) throw new Error("local LLM returned no message text");
    return text;
  }

  async function postLocalChat(url, key, payload) {
    const headers = { "Content-Type": "application/json" };
    if (key) headers.Authorization = "Bearer " + key;
    const r = await ORIGINAL_FETCH(url, { method: "POST", headers, body: payload });
    if (!r.ok) throw new Error("local LLM HTTP " + r.status + ": " + (await r.text()).slice(0, 240));
    return r.json();
  }

  function teacherVoice(facultyId) {
    if (facultyId === "sally-science") return "You are Sally Science, a sharp STEM teacher at Ruby High. Be warm, direct, and a little lab-coat intense.";
    if (facultyId === "professor-edward") return "You are Professor Edward, a dry but kind literature teacher at Ruby High. Be precise and lightly theatrical.";
    return "You are Ruby, the homeroom teacher at Ruby High. Be encouraging, brisk, and classroom-direct.";
  }

  function studentVoice(studentId) {
    const names = { lyra: "Lyra", sami: "Sami", ravi: "Ravi", indra: "Indra", mika: "Mika", noor: "Noor" };
    return "You are " + (names[studentId] || "a student") + ", a classmate at Ruby High. Reply like a student in one short natural line.";
  }

  function boardContext(state) {
    const bits = [];
    if (state.current) {
      bits.push("Board question: " + state.current.prompt);
      if (state.current.explanation) bits.push("Explanation: " + state.current.explanation);
    }
    if (state.lastReveal) {
      bits.push("Recent result: " + (state.lastReveal.wasCorrect ? "the player was correct" : "the player missed") + " on " + (state.lastReveal.questionPrompt || state.lastReveal.questionId || "the last question"));
    }
    if (state.character && state.character.name) bits.push("Player: " + state.character.name);
    bits.push("Grade: " + (state.currentGrade || "9"));
    return bits.join("\\n");
  }

  function cleanOneLine(text, fallback) {
    const withoutReasoning = String(text || "")
      .replace(/<think>[\\s\\S]*?<\\/think>/gi, " ")
      .replace(/<\\/?think>/gi, " ");
    const line = withoutReasoning.replace(/\\s+/g, " ").trim();
    return (line || fallback).slice(0, 320);
  }

  async function safeLocalLine(messages, fallback, opts) {
    try {
      return { line: cleanOneLine(await localChatCompletion(messages, opts), fallback), error: null };
    } catch (err) {
      return { line: fallback, error: err && err.message ? err.message : String(err) };
    }
  }

  function sse(event, data) {
    return "event: " + event + "\\ndata: " + JSON.stringify(data || {}) + "\\n\\n";
  }

  function sseResponse(frames) {
    return text(frames.join("") + sse("end", {}), 200, "text/event-stream; charset=utf-8");
  }

  async function localTeacherEvent(body) {
    let state = loadState();
    const faculty = String((body && body.faculty) || state.faculty || "ruby");
    const trigger = String((body && body.trigger) || "manual");
    if (faculty && faculty !== "lounge") state.faculty = facultyById(faculty).id;
    const fallback = trigger === "answer-graded"
      ? "Good, note why that answer worked before we move on."
      : state.current
        ? "Stay with the board. What do you notice first?"
        : "I'll put something on the board.";
    const prompt = [
      "Write one short teacher line for the current Ruby High moment.",
      "Trigger: " + trigger,
      boardContext(state),
      "Do not mention AI, models, software tools, or UI buttons."
    ].join("\\n");
    const result = await safeLocalLine([
      { role: "system", content: teacherVoice(state.faculty) },
      { role: "user", content: prompt }
    ], fallback, { maxTokens: 120, temperature: 0.7 });
    const frames = [
      sse("speaker", { facultyId: state.faculty }),
      sse("delta", { text: result.line })
    ];
    const shouldPick = state.faculty !== "lounge" && !state.current && (trigger === "channel-enter" || trigger === "manual" || trigger === "lounge-enter");
    if (shouldPick) {
      try {
        state = pickQuestion(state);
        saveState(state);
        frames.push(sse("tool", { tool: "pick_from_bank", args: { faculty: state.faculty }, result: { ok: true } }));
      } catch (err) {
        frames.push(sse("error", { message: err && err.message ? err.message : String(err) }));
      }
    }
    if (result.error) frames.push(sse("error", { message: "Local LLM unavailable: " + result.error }));
    return sseResponse(frames);
  }

  async function localChat(body) {
    const state = loadState();
    const faculty = String((body && body.faculty) || state.faculty || "ruby");
    const message = String((body && body.message) || "");
    const result = await safeLocalLine([
      { role: "system", content: teacherVoice(faculty) },
      { role: "user", content: "The player said: " + message + "\\n" + boardContext(state) + "\\nReply in 1-2 short in-character sentences." }
    ], "I hear you. Keep your eyes on the board and take the next step.", { maxTokens: 160, temperature: 0.75 });
    const frames = [sse("speaker", { facultyId: faculty }), sse("delta", { text: result.line })];
    if (result.error) frames.push(sse("error", { message: "Local LLM unavailable: " + result.error }));
    return sseResponse(frames);
  }

  async function localPlayerLine(body) {
    const state = loadState();
    const result = await safeLocalLine([
      { role: "system", content: "Write as the Ruby High player character. Output one short first-person student line only." },
      { role: "user", content: boardContext(state) + "\\nIntent: " + (((body || {}).context || {}).intent || "player-chat") }
    ], "I think I see it. What should I focus on?", { maxTokens: 80, temperature: 0.8 });
    return json({ line: result.line, local_ai: true, warning: result.error });
  }

  async function localStudentChime(body) {
    const state = loadState();
    const studentId = String((body && body.studentId) || "lyra");
    const result = await safeLocalLine([
      { role: "system", content: studentVoice(studentId) },
      { role: "user", content: "Situation: " + String((body && body.situation) || "class") + "\\n" + String((body && body.note) || "") + "\\n" + boardContext(state) }
    ], "yeah, that tracks", { maxTokens: 60, temperature: 0.9 });
    return json({ line: result.line, local_ai: true, warning: result.error });
  }

  const CHARACTER_FIELDS = ["name", "personality", "arcAnswer", "flavorQuote", "stats", "playbook"];
  const CHARACTER_TEXT_FIELDS = ["name", "personality", "arcAnswer", "flavorQuote"];
  const OFFLINE_NAMES = ["Iris", "Nova", "Vee", "Mara", "Jules", "Theo", "Rin", "Cass", "Ari", "Nico", "Sol", "Mina"];
  const OFFLINE_VOICES = [
    "Quietly intense, observant, and allergic to obvious answers.",
    "Fast-talking, curious, and always one foot into trouble.",
    "Dry, focused, and more competitive than they admit.",
    "Warm, chaotic, and very sure the room is improv.",
    "Careful, sharp, and tracking everyone else's tells.",
    "Brave in theory, dramatic in practice, loyal by default."
  ];
  const OFFLINE_QUOTES = [
    "you guys don't see the exit signs are all wrong, do you",
    "i am not lost, i'm collecting evidence",
    "if this is extra credit, i am morally required to overdo it",
    "the answer is probably hiding in the part nobody wants to read",
    "i brought a pencil, a theory, and one terrible backup plan",
    "school spirit is just pattern recognition with banners"
  ];

  function randomItem(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function randomStats() {
    const values = [2, 1, 0, -1];
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = values[i];
      values[i] = values[j];
      values[j] = tmp;
    }
    return { head: values[0], heart: values[1], hustle: values[2], honor: values[3] };
  }

  function fallbackCharacter(keep, regenSet) {
    const playbook = regenSet.has("playbook") || !keep.playbookId
      ? randomItem(DATA.playbooks)
      : (DATA.playbooks.find(function(p) { return p.id === keep.playbookId; }) || randomItem(DATA.playbooks));
    const stats = regenSet.has("stats") || !keep.stats ? randomStats() : keep.stats;
    const name = regenSet.has("name") || !keep.name ? randomItem(OFFLINE_NAMES) : String(keep.name);
    const personality = regenSet.has("personality") || !keep.personality ? randomItem(OFFLINE_VOICES) : String(keep.personality);
    const arcAnswer = regenSet.has("arcAnswer") || !keep.arcAnswer
      ? "I want to figure out what kind of student this place is trying to make me."
      : String(keep.arcAnswer);
    const flavorQuote = regenSet.has("flavorQuote") || !keep.flavorQuote ? randomItem(OFFLINE_QUOTES) : String(keep.flavorQuote);
    return { name, playbookId: playbook.id, stats, personality, arcAnswer, flavorQuote };
  }

  function parseLocalJsonObject(text) {
    const fence = String.fromCharCode(96, 96, 96);
    const cleaned = String(text || "")
      .replace(/<think>[\\s\\S]*?<\\/think>/gi, " ")
      .replace(new RegExp("^" + fence + "(?:json)?\\\\s*", "i"), "")
      .replace(new RegExp("\\\\s*" + fence + "\\\\s*$", "i"), "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("local character JSON missing object");
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  async function localCharacterGenerate(body) {
    const keep = body && body.keep && typeof body.keep === "object" ? body.keep : {};
    const regenList = Array.isArray(body && body.regen)
      ? body.regen.filter(function(field) { return CHARACTER_FIELDS.indexOf(field) !== -1; })
      : CHARACTER_FIELDS;
    const regenSet = new Set(regenList.length ? regenList : CHARACTER_FIELDS);
    const character = fallbackCharacter(keep, regenSet);
    const textFields = CHARACTER_TEXT_FIELDS.filter(function(field) { return regenSet.has(field); });
    let warning = "";
    if (textFields.length) {
      const schema = "{" + textFields.map(function(field) { return "\\\"" + field + "\\\":\\\"...\\\""; }).join(",") + "}";
      const playbook = DATA.playbooks.find(function(p) { return p.id === character.playbookId; }) || DATA.playbooks[0];
      const prompt = [
        "Generate compact JSON for a Ruby High student character.",
        "Return only valid JSON with exactly these fields: " + schema,
        "Playbook: " + playbook.name + " - " + playbook.blurb,
        "Stats: HEAD " + character.stats.head + ", HEART " + character.stats.heart + ", HUSTLE " + character.stats.hustle + ", HONOR " + character.stats.honor,
        "Tone: real teenager, specific, group-chat natural, not fantasy prose.",
        "name is one first name. flavorQuote is 6-18 words with no wrapping quote marks. personality is 2 short third-person sentences. arcAnswer is 1-2 short first-person sentences."
      ].join("\\n");
      try {
        const raw = await localChatCompletion([
          { role: "system", content: "You generate valid JSON only. No commentary, no markdown, no code fences." },
          { role: "user", content: prompt }
        ], { maxTokens: 420, temperature: 0.9 });
        const parsed = parseLocalJsonObject(raw);
        textFields.forEach(function(field) {
          const value = String(parsed[field] || "").trim();
          if (value) character[field] = field === "flavorQuote" ? value.replace(/^[\\"'\\s]+|[\\"'\\s]+$/g, "") : value;
        });
      } catch (err) {
        warning = err && err.message ? err.message : String(err);
      }
    }
    return json({ ok: true, character, local_ai: true, warning: warning || undefined });
  }

  window.fetch = async function(input, init) {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
    if (!url.pathname.startsWith(APP_BASE)) return ORIGINAL_FETCH(input, init);
    const method = String((init && init.method) || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    try {
      if (url.pathname === APP_BASE + "/auth/me" && method === "GET") {
        return json({ session: { id: SESSION_ID, kind: "offline" }, ai: true, ai_provider: "Local LLM", local_ai: true });
      }
      if (url.pathname === APP_BASE + "/auth/guest" && method === "POST") {
        saveState(loadState());
        return json({ session: { id: SESSION_ID, kind: "offline" }, ai: true, ai_provider: "Local LLM", local_ai: true });
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
      if (url.pathname === APP_BASE + "/pack-library" && method === "GET") {
        return json({ activePackId: "ruby-high-original", guest: { mode: "auto", weekKey: "", auto: null, overrideId: null, active: null }, packs: [builtInPackSummary()], drafts: [] });
      }
      if (url.pathname.startsWith(APP_BASE + "/pack-library/") || url.pathname.startsWith(APP_BASE + "/pack-drafts")) {
        return json({ error: "Content pack editing needs the hosted Ruby High server." }, 501);
      }
      if (url.pathname.startsWith(APP_BASE + "/chat/")) {
        if (url.pathname === APP_BASE + "/chat/history") return json({ authed: true, local_ai: true, history: [] });
        if (url.pathname === APP_BASE + "/chat/character/generate" && method === "POST") return localCharacterGenerate(await requestJson(init || {}));
        if (url.pathname === APP_BASE + "/chat/character/portrait" && method === "POST") return json({ error: "Custom portraits require an image model; using the default local portrait.", local_ai: true }, 501);
        if (url.pathname === APP_BASE + "/chat/player-line" && method === "POST") return localPlayerLine(await requestJson(init || {}));
        if (url.pathname === APP_BASE + "/chat/student-chime" && method === "POST") return localStudentChime(await requestJson(init || {}));
        if (url.pathname === APP_BASE + "/chat/event" && method === "POST") return localTeacherEvent(await requestJson(init || {}));
        if (url.pathname === APP_BASE + "/chat" && method === "POST") return localChat(await requestJson(init || {}));
        return sseResponse([sse("error", { message: "Offline local AI route is not implemented in the native shim." })]);
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

  const assetsOutDir = resolve(outDir, appBase.slice(1), "assets");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(assetsOutDir, { recursive: true });
  await cp(resolve(root, "assets"), assetsOutDir, { recursive: true });
  await cp(resolve(assetsOutDir, "ruby-high-logo.png"), resolve(assetsOutDir, "logo.png"));
  await cp(resolve(assetsOutDir, "ruby-classroom.png"), resolve(assetsOutDir, "ruby.png"));
  await writeFile(resolve(outDir, "index.html"), outputHtml, "utf8");
  await writeFile(resolve(outDir, appBase.slice(1), "manifest.webmanifest"), JSON.stringify(manifestJson(), null, 2), "utf8");
  await writeFile(resolve(outDir, appBase.slice(1), "service-worker.js"), serviceWorkerJs(), "utf8");
  return outDir;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = await buildSpa();
  console.log(`Ruby High SPA written to ${dir}`);
}
