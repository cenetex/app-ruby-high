export interface RubyHighTeacherResearchCorpus {
  id: string;
  facultyId: string;
  title: string;
  corpusPath: string;
  researchInterests: string[];
  lanes: string[];
  readingList: string[];
  canonicalMisconceptions: string[];
  gradeBriefs: Record<"9" | "10" | "11" | "12", string>;
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
    readingList: [
      "AI application design notes: system prompts, retrieval, structured outputs, evals, and model routing.",
      "Agent operations notes: least privilege, idempotency, retries, dirty worktrees, audit trails, and human confirmation.",
      "Networked systems notes: HTTP, TLS, DNS, OAuth, webhooks, database indexes, rate limits, and smoke tests.",
      "On-chain fairness notes: wallets, mint authorities, nonces, Merkle proofs, replay resistance, and commit-reveal verification.",
    ],
    canonicalMisconceptions: [
      "A bigger context window means perfect recall.",
      "Chat history is the same thing as durable memory.",
      "A model refusal policy is the same thing as app authorization.",
      "Putting a game on-chain automatically makes every outcome fair.",
      "An agent can safely retry irreversible tools without idempotency or confirmation.",
    ],
    gradeBriefs: {
      "9": "Keep Ruby's freshman set concrete: vocabulary, permissions, context windows, BYOK, streaming, retrieval, and small classroom decisions.",
      "10": "Move sophomores into operations: prompts versus policies, OAuth versus passwords, retrieval versus memory, and automation with bounded side effects.",
      "11": "Ask juniors to reason architecturally: evals, grounding, structured tool calls, idempotency, model routing, indexes, and consistency tradeoffs.",
      "12": "Make senior questions adversarial and ethical: prompt injection, secret handling, least privilege, replay resistance, commit-reveal fairness, and public/private boundaries.",
    },
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
    readingList: [
      "Lab-method notes: units, variables, controls, error, uncertainty, graph reading, and evidence discipline.",
      "Physics model notes: motion, forces, energy, momentum, electricity, optics, waves, thermodynamics, relativity, and quantum evidence.",
      "Chemistry reasoning notes: atoms, bonding, pH, catalysts, solutions, redox, gases, equilibrium, nuclear decay, and separation methods.",
      "Life-and-earth systems notes: cells, DNA, enzymes, evolution, immunity, meiosis, tectonics, climate records, oceans, and atmosphere.",
    ],
    canonicalMisconceptions: [
      "Speed and acceleration are the same quantity.",
      "Mass and weight measure the same thing.",
      "Catalysts are consumed by the reactions they speed up.",
      "pH changes linearly instead of logarithmically.",
      "Individuals evolve because they need to adapt.",
      "Weather and climate describe the same scale of evidence.",
    ],
    gradeBriefs: {
      "9": "Keep Sally's freshman set like a clean lab bench: units, definitions, everyday observations, safety, variables, and direct cause/effect.",
      "10": "Ask sophomores to combine relationships: Ohm's law, conservation, catalysts, molarity, transcription, selection, and greenhouse effect.",
      "11": "Make junior questions model-driven: wave tradeoffs, equilibrium shifts, codons, Hardy-Weinberg assumptions, seafloor spreading, and current drivers.",
      "12": "Use senior questions for evidence and constraints: entropy, Lorentz factor, photoelectric effect, chromatography, crossing over, antibodies, ice cores, albedo, S waves, and Coriolis.",
    },
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
    readingList: [
      "Close-reading notebook: Austen, Shelley, Fitzgerald, Achebe, Orwell, Salinger, narrator/author distinctions, imagery, irony, and evidence.",
      "Narrative-form notebook: focalization, free indirect discourse, frame narrative, unreliable narration, polyphony, genre, and stream of consciousness.",
      "Theory notebook: formalism, New Criticism, Marxist, feminist, postcolonial, reader-response, structuralism, deconstruction, archive, affect, and hermeneutics.",
      "Mid-century notebook: World War II, Cold War paranoia, suburban conformity, obscenity trials, existentialism, Beat culture, paperback distribution, and mass media.",
    ],
    canonicalMisconceptions: [
      "Theme is a one-word label instead of an argument.",
      "The author, narrator, and protagonist are interchangeable.",
      "Point of view means the same thing as opinion.",
      "Theory is just a list of names rather than a method of asking questions.",
      "Deconstruction means nothing means anything.",
    ],
    gradeBriefs: {
      "9": "Keep Edward's freshman set recognizable and useful: author/title pairs, protagonist, antagonist, setting, imagery, irony, narration, and evidence.",
      "10": "Ask sophomores to apply terms: unreliable narration, free indirect discourse, bildungsroman, satire, intertextuality, frame narrative, canon, and close reading.",
      "11": "Make junior questions methodological: New Criticism, structuralism, deconstruction, ideology, archive, affect, genre, hermeneutics, narratology, and intentional fallacy.",
      "12": "Use senior questions for history and argument: Barthes, Foucault, Bakhtin, Said, Cold War literature, obscenity trials, suburban fiction, Pynchon, Nabokov, confessional poetry, and mass media.",
    },
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
    readingList: [...corpus.readingList],
    canonicalMisconceptions: [...corpus.canonicalMisconceptions],
    gradeBriefs: { ...corpus.gradeBriefs },
  }));
}
