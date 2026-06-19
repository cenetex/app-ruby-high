export interface RubyHighTeacherResearchCorpus {
  id: string;
  facultyId: string;
  title: string;
  corpusPath: string;
  researchInterests: string[];
  lanes: string[];
}

const BUILT_IN_TEACHER_RESEARCH_CORPORA: RubyHighTeacherResearchCorpus[] = [
  {
    id: "ruby-research-corpus",
    facultyId: "ruby",
    title: "Ruby Research Corpus",
    corpusPath: "assets/corpora/ruby.md",
    researchInterests: [
      "AI application design",
      "agent reliability",
      "networked systems",
      "on-chain literacy",
      "classroom ethics",
    ],
    lanes: [
      "Freshman bridge questions: practical AI/web vocabulary, but asked through small classroom scenarios.",
      "Agent reliability questions: user confirmation, dirty worktrees, tool schemas, idempotency, retries, and safe side effects.",
      "Systems literacy questions: HTTP, TLS, DNS, OAuth, webhooks, database indexes, rate limits, and smoke tests.",
      "On-chain fairness questions: wallets, mint authority, nonces, Merkle proofs, replay resistance, and commit-reveal verification.",
      "Multiplayer ethics questions: what classmates can see, what must stay private, and when confidence should be checked.",
    ],
  },
  {
    id: "sally-science-research-corpus",
    facultyId: "sally-science",
    title: "Sally Science Research Corpus",
    corpusPath: "assets/corpora/sally-science.md",
    researchInterests: [
      "measurement and lab safety",
      "physics models",
      "chemistry reasoning",
      "biology systems",
      "earth science evidence",
    ],
    lanes: [
      "Measurement and lab-safety questions: units, variables, controls, uncertainty, goggles, and evidence discipline.",
      "Physics model questions: motion, forces, energy, electricity, waves, optics, thermodynamics, and constraints.",
      "Chemistry reasoning questions: bonding, pH, catalysts, molarity, redox, equilibrium, gases, and lab separation.",
      "Biology systems questions: DNA, transcription, enzymes, evolution, homeostasis, immunity, meiosis, and population assumptions.",
      "Earth science evidence questions: tectonics, seismology, atmosphere, climate records, ocean currents, albedo, and Coriolis.",
    ],
  },
  {
    id: "professor-edward-research-corpus",
    facultyId: "professor-edward",
    title: "Professor Edward Research Corpus",
    corpusPath: "assets/corpora/professor-edward.md",
    researchInterests: [
      "close reading",
      "narrative form",
      "literary theory and method",
      "mid-century history",
      "seminar ethics",
    ],
    lanes: [
      "Close-reading questions: narrator versus author, point of view, imagery, irony, setting, and textual evidence.",
      "Narrative-form questions: focalization, free indirect discourse, frame narrative, unreliable narration, polyphony, and genre.",
      "Theory-method questions: formalism, New Criticism, Marxist, feminist, postcolonial, reader-response, archive, and affect methods.",
      "Mid-century history questions: Cold War paranoia, suburban conformity, obscenity trials, paperback distribution, and mass media.",
      "Seminar ethics questions: how readers resist manipulative narration, handle authorial intention, and argue responsibly from evidence.",
    ],
  },
];

const BUILT_IN_TEACHER_RESEARCH_CORPORA_BY_FACULTY = new Map(
  BUILT_IN_TEACHER_RESEARCH_CORPORA.map((corpus) => [corpus.facultyId, corpus]),
);

export function builtInTeacherResearchCorpusForFaculty(facultyId: string): RubyHighTeacherResearchCorpus | null {
  return BUILT_IN_TEACHER_RESEARCH_CORPORA_BY_FACULTY.get(facultyId) ?? null;
}

export function builtInTeacherResearchCorpora(): RubyHighTeacherResearchCorpus[] {
  return BUILT_IN_TEACHER_RESEARCH_CORPORA.map((corpus) => ({
    ...corpus,
    researchInterests: [...corpus.researchInterests],
    lanes: [...corpus.lanes],
  }));
}
