export interface RubyHighTeacherSourcePacket {
  id: string;
  title: string;
  anchor: string;
  summary: string;
  grades: Array<"9" | "10" | "11" | "12">;
  subjects: string[];
  questionSeeds: string[];
}

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
  sourcePackets: RubyHighTeacherSourcePacket[];
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
    sourcePackets: [
      {
        id: "ruby-source-agent-ops",
        title: "Agent operations notes",
        anchor: "least privilege, idempotency, retries, and dirty worktrees",
        summary: "Operational agent behavior is safe when every side effect has scoped authority, explicit confirmation where needed, bounded retries, and durable evidence of what changed.",
        grades: ["10", "11", "12"],
        subjects: ["agent reliability", "classroom ethics", "networked systems"],
        questionSeeds: [
          "Compare a harmless retry with an irreversible retry that needs an idempotency key.",
          "Ask how an agent should handle a dirty worktree before editing shared files.",
          "Test why least-privilege tool access is different from a model's refusal policy.",
        ],
      },
      {
        id: "ruby-source-ai-systems",
        title: "AI application design notes",
        anchor: "context windows, retrieval, structured outputs, evals, and routing",
        summary: "AI applications improve when model context is deliberately selected, external facts are retrieved at answer time, outputs are validated, and model choice is tied to cost and capability.",
        grades: ["9", "10", "11"],
        subjects: ["AI application design", "agent reliability"],
        questionSeeds: [
          "Ask when retrieval is better than hoping a model remembers.",
          "Distinguish a context window from durable memory.",
          "Test why generated JSON still needs validation before use.",
        ],
      },
      {
        id: "ruby-source-public-world",
        title: "Public world safety notes",
        anchor: "public/private boundaries, consent, and moderation",
        summary: "Shared school-world features need clear boundaries: public profiles expose only intentional fields, private answers stay private, and moderation actions must be reversible and auditable.",
        grades: ["11", "12"],
        subjects: ["classroom ethics", "on-chain literacy", "networked systems"],
        questionSeeds: [
          "Ask what should stay private when a student appears in a shared room.",
          "Test why public visibility needs a separate toggle from social posting.",
          "Connect auditability to moderation notes and suppressions.",
        ],
      },
      {
        id: "ruby-source-multiplayer-runtime",
        title: "Multiplayer runtime notes",
        anchor: "shared state, replay cursors, room rules, term lanes, and smoke tests",
        summary: "Multiplayer classroom systems stay trustworthy when shared state is replayable, room rules are explicit data, public events are sanitized, and deploy smoke proves clients can reconnect without private leakage.",
        grades: ["10", "11", "12"],
        subjects: ["networked systems", "agent reliability", "classroom ethics"],
        questionSeeds: [
          "Ask why a replay cursor is safer than asking clients to guess what they missed.",
          "Test why a room rule should be stored as data instead of hidden in UI copy.",
          "Connect deploy smoke to public-world regressions that unit tests might miss.",
        ],
      },
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
    sourcePackets: [
      {
        id: "sally-source-lab-method",
        title: "Lab-method notes",
        anchor: "units, variables, controls, error, uncertainty, and graph reading",
        summary: "A trustworthy lab question asks students to separate variables, choose useful measurements, preserve controls, and treat uncertainty as part of evidence rather than noise.",
        grades: ["9", "10"],
        subjects: ["measurement and lab safety", "physics models", "chemistry reasoning"],
        questionSeeds: [
          "Ask why a control group matters before comparing outcomes.",
          "Distinguish precision from accuracy in a classroom measurement.",
          "Test how units reveal whether an answer is physically sensible.",
        ],
      },
      {
        id: "sally-source-chem-bio-systems",
        title: "Chemistry and biology systems notes",
        anchor: "bonding, catalysts, pH, enzymes, DNA, selection, and homeostasis",
        summary: "Chemical and biological systems questions should make students reason about mechanisms, scales, and constraints instead of memorizing isolated vocabulary.",
        grades: ["10", "11", "12"],
        subjects: ["chemistry reasoning", "biology systems"],
        questionSeeds: [
          "Ask why catalysts speed reactions without being consumed.",
          "Test the logarithmic meaning of a pH change.",
          "Connect enzyme shape to reaction specificity.",
        ],
      },
      {
        id: "sally-source-earth-evidence",
        title: "Earth science evidence notes",
        anchor: "tectonics, climate records, ocean currents, albedo, and seismic waves",
        summary: "Earth science questions should ask what evidence survives at planetary scale and which mechanism best explains the pattern.",
        grades: ["11", "12"],
        subjects: ["earth science evidence"],
        questionSeeds: [
          "Ask what ice cores preserve and why that counts as climate evidence.",
          "Test why S waves reveal something about Earth's interior.",
          "Connect albedo to feedback in climate systems.",
        ],
      },
      {
        id: "sally-source-systems-constraints",
        title: "Systems and constraints notes",
        anchor: "feedback loops, limiting reagents, carrying capacity, energy budgets, and model boundaries",
        summary: "Science systems questions become stronger when students identify the conserved quantity, limiting factor, feedback loop, or boundary condition before choosing a formula or explanation.",
        grades: ["10", "11", "12"],
        subjects: ["physics models", "chemistry reasoning", "biology systems", "earth science evidence"],
        questionSeeds: [
          "Ask which variable is conserved and which variable can leak from a model.",
          "Test why a limiting reagent or carrying capacity changes the final outcome.",
          "Connect feedback loops to when a small change grows instead of fading.",
        ],
      },
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
    sourcePackets: [
      {
        id: "edward-source-close-reading",
        title: "Close-reading notebook",
        anchor: "narrator versus author, imagery, irony, point of view, and evidence",
        summary: "Responsible literary questions ask students to cite form and language, not collapse the author, narrator, and protagonist into one voice.",
        grades: ["9", "10"],
        subjects: ["close reading", "narrative form", "seminar ethics"],
        questionSeeds: [
          "Ask how a narrator can differ from an author.",
          "Test why theme must become an argument rather than a label.",
          "Connect point of view to what evidence a reader can access.",
        ],
      },
      {
        id: "edward-source-theory-method",
        title: "Theory-method notebook",
        anchor: "formalism, New Criticism, ideology, archive, affect, and hermeneutics",
        summary: "Theory questions should frame each name as a method of asking better questions about evidence, power, feeling, form, or interpretation.",
        grades: ["11", "12"],
        subjects: ["literary theory and method", "close reading", "seminar ethics"],
        questionSeeds: [
          "Ask what New Criticism privileges in a text.",
          "Test why archive theory asks what gets preserved or excluded.",
          "Distinguish deconstruction from the lazy claim that nothing means anything.",
        ],
      },
      {
        id: "edward-source-midcentury",
        title: "Mid-century notebook",
        anchor: "Cold War paranoia, suburban conformity, obscenity trials, paperbacks, and mass media",
        summary: "Mid-century questions work best when they connect literary form to institutions, distribution, censorship, technology, and postwar social pressure.",
        grades: ["12"],
        subjects: ["mid-century history", "literary theory and method", "narrative form"],
        questionSeeds: [
          "Ask what anxiety Cold War literature often stages.",
          "Connect paperback distribution to cultural access.",
          "Test why obscenity trials matter to literature as an institution.",
        ],
      },
      {
        id: "edward-source-public-seminar",
        title: "Public seminar ethics notebook",
        anchor: "interpretive charity, public evidence, classroom persona, moderation, and collective reading",
        summary: "A public seminar asks readers to make claims from shared evidence, separate persona from person, and keep disagreement legible enough for the room to learn from it.",
        grades: ["10", "11", "12"],
        subjects: ["seminar ethics", "close reading", "narrative form"],
        questionSeeds: [
          "Ask how a reader can challenge an interpretation without attacking the person offering it.",
          "Test why public claims need evidence classmates can inspect.",
          "Connect unreliable narration to the difference between persona and person.",
        ],
      },
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
    readingList: [...corpus.readingList],
    canonicalMisconceptions: [...corpus.canonicalMisconceptions],
    gradeBriefs: { ...corpus.gradeBriefs },
    sourcePackets: corpus.sourcePackets.map((packet) => ({
      ...packet,
      grades: [...packet.grades],
      subjects: [...packet.subjects],
      questionSeeds: [...packet.questionSeeds],
    })),
  }));
}
