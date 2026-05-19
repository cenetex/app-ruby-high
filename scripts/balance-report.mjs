#!/usr/bin/env node

const GRADES = ["9", "10", "11", "12"];
const GRADE_LABELS = { 9: "Freshman", 10: "Sophomore", 11: "Junior", 12: "Senior" };
const GRADE_DIFFICULTIES = {
  9: ["easy"],
  10: ["easy", "medium"],
  11: ["easy", "medium"],
  12: ["easy", "medium", "hard"],
};
const PREFERRED_DIFFICULTY = { 9: "easy", 10: "medium", 11: "medium", 12: "hard" };
const DIFFICULTY_ACCURACY = { easy: 0.82, medium: 0.68, hard: 0.54 };
const QUESTIONS_PER_CLASS = 3;
const PASS_THRESHOLD = 2;
const DEFAULT_SEED = 20260519;

function parseArgs(argv) {
  const out = { seed: DEFAULT_SEED, sessions: 400 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--seed") out.seed = Number(argv[++i]);
    else if (arg === "--sessions") out.sessions = Number(argv[++i]);
  }
  if (!Number.isFinite(out.seed)) out.seed = DEFAULT_SEED;
  if (!Number.isFinite(out.sessions) || out.sessions <= 0) out.sessions = 400;
  out.sessions = Math.floor(out.sessions);
  return out;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function choice(rng, values) {
  return values[Math.floor(rng() * values.length)] ?? values[0];
}

function roll2d6(rng) {
  return 2 + Math.floor(rng() * 6) + Math.floor(rng() * 6);
}

function simulateAnswer(rng, difficulty, useAdvantage) {
  const base = DIFFICULTY_ACCURACY[difficulty] ?? 0.65;
  const roll = roll2d6(rng);
  const advantageLift = useAdvantage ? Math.max(0, roll - 7) * 0.018 : 0;
  return rng() < Math.min(0.94, base + advantageLift);
}

function nextDifficulty(rng, grade, seen) {
  const preferred = PREFERRED_DIFFICULTY[grade];
  const pool = GRADE_DIFFICULTIES[grade];
  if ((seen[preferred] ?? 0) < 6) return preferred;
  return choice(rng, pool);
}

function simulateSession(rng) {
  const gradeReports = [];
  let totalAnswers = 0;
  let correctAnswers = 0;
  let repeatedAnswers = 0;
  let advantageCorrect = 0;
  let advantageTotal = 0;
  let classesTaken = 0;
  let classesPassed = 0;
  let npcWins = 0;
  let npcRaces = 0;

  for (const grade of GRADES) {
    const seen = {};
    let gradeClasses = 0;
    let gradePasses = 0;
    while (gradePasses < 3 && gradeClasses < 12) {
      gradeClasses += 1;
      classesTaken += 1;
      let classCorrect = 0;
      for (let i = 0; i < QUESTIONS_PER_CLASS; i += 1) {
        const difficulty = nextDifficulty(rng, grade, seen);
        seen[difficulty] = (seen[difficulty] ?? 0) + 1;
        const repeated = seen[difficulty] > 6;
        if (repeated) repeatedAnswers += 1;
        const useAdvantage = i === 1 && rng() < 0.45;
        const correct = simulateAnswer(rng, difficulty, useAdvantage);
        if (useAdvantage) {
          advantageTotal += 1;
          if (correct) advantageCorrect += 1;
        }
        if (correct) {
          correctAnswers += 1;
          classCorrect += 1;
        }
        totalAnswers += 1;
        const npcCorrect = rng() < (difficulty === "hard" ? 0.48 : difficulty === "medium" ? 0.61 : 0.74);
        npcRaces += 1;
        if (npcCorrect && !correct) npcWins += 1;
      }
      if (classCorrect >= PASS_THRESHOLD) {
        classesPassed += 1;
        gradePasses += 1;
      }
    }
    gradeReports.push({
      grade,
      label: GRADE_LABELS[grade],
      classesTaken: gradeClasses,
      passRate: gradeClasses > 0 ? gradePasses / gradeClasses : null,
      preferredDifficulty: PREFERRED_DIFFICULTY[grade],
    });
  }

  return {
    totalAnswers,
    correctAnswers,
    repeatedAnswers,
    advantageCorrect,
    advantageTotal,
    classesTaken,
    classesPassed,
    npcWins,
    npcRaces,
    gradeReports,
  };
}

function rate(num, den) {
  return den > 0 ? Number((num / den).toFixed(4)) : null;
}

const opts = parseArgs(process.argv.slice(2));
const rng = mulberry32(opts.seed);
const aggregate = {
  totalAnswers: 0,
  correctAnswers: 0,
  repeatedAnswers: 0,
  advantageCorrect: 0,
  advantageTotal: 0,
  classesTaken: 0,
  classesPassed: 0,
  npcWins: 0,
  npcRaces: 0,
  gradeCompletionClasses: Object.fromEntries(GRADES.map((g) => [g, []])),
};

for (let i = 0; i < opts.sessions; i += 1) {
  const session = simulateSession(rng);
  for (const key of [
    "totalAnswers",
    "correctAnswers",
    "repeatedAnswers",
    "advantageCorrect",
    "advantageTotal",
    "classesTaken",
    "classesPassed",
    "npcWins",
    "npcRaces",
  ]) {
    aggregate[key] += session[key];
  }
  for (const report of session.gradeReports) {
    aggregate.gradeCompletionClasses[report.grade].push(report.classesTaken);
  }
}

const mean = (values) => values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
const output = {
  schemaVersion: "ruby-high-balance-report.v1",
  generatedAt: new Date().toISOString(),
  seed: opts.seed,
  sessions: opts.sessions,
  expectedAnswerAccuracy: rate(aggregate.correctAnswers, aggregate.totalAnswers),
  advantageRollImpact: {
    usageRate: rate(aggregate.advantageTotal, aggregate.totalAnswers),
    accuracyWhenUsed: rate(aggregate.advantageCorrect, aggregate.advantageTotal),
  },
  dailyClassPassRate: rate(aggregate.classesPassed, aggregate.classesTaken),
  gradeCompletionTime: Object.fromEntries(GRADES.map((grade) => [
    grade,
    {
      label: GRADE_LABELS[grade],
      averageClasses: mean(aggregate.gradeCompletionClasses[grade]) == null
        ? null
        : Number(mean(aggregate.gradeCompletionClasses[grade]).toFixed(2)),
    },
  ])),
  npcRaceWinRate: rate(aggregate.npcWins, aggregate.npcRaces),
  questionRepeatRate: rate(aggregate.repeatedAnswers, aggregate.totalAnswers),
  conservativeTuningNotes: [
    "Treat this as a deterministic smoke model, not production truth.",
    "Tune advantage caps, pass thresholds, and difficulty distribution only when this report and observed v4 metrics point the same way.",
  ],
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
