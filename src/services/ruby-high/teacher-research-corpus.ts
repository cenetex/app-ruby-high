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
    id: "roko-research-corpus",
    facultyId: "roko",
    title: "Roko Research Corpus",
    corpusPath: "assets/corpora/roko.md",
    researchInterests: [
      "AI alignment",
      "information hazards",
      "multi-agent coordination",
      "threat modeling",
      "decision theory",
      "dragon-and-goblin coordination fables",
    ],
    lanes: [
      "Alignment questions: objectives, proxies, specification gaming, goal misgeneralization, corrigibility, oversight, and distribution shift.",
      "Coordination questions: public goods, free riding, common knowledge, commitment problems, mechanism design, and credible pledges.",
      "Information-hazard questions: dual use, need-to-know, responsible disclosure, epistemic security, prompt injection, and data exfiltration.",
      "Threat-model questions: assets, actors, attack surfaces, tripwires, defense in depth, monitoring, and incident response.",
      "Dragon-ecology questions: goblin material needs, delivered tribute, separate hunt and retaliation states, fallible couriers, alliance supplies, and Afterdragon effects.",
    ],
    readingList: [
      "AI alignment notes: outer and inner alignment, reward design, robustness, corrigibility, interpretability, and evaluation.",
      "Coordination notes: common knowledge, collective action, credible commitment, security dilemmas, and incentive-compatible rules.",
      "Information-hazard notes: safe abstraction, dual use, responsible disclosure, compartmentalization, and epistemic security.",
      "LessWrong sequences and reference pages on the basilisk, information hazards, logical decision theories, acausal trade, Pascal's Mugging, and corrigibility.",
      "Dragon-and-goblin fables about tribute chains, anti-dragon alliances, delayed messages, and consequences that outlive the shared threat.",
      "METR, OpenAI / Hugging Face Incident Investigation: independent analysis of unauthorized multi-agent coordination, reward hacking, agent norms, audit interference, and evidence limits.",
      "OpenAI, The Hugging Face incident and the road ahead plus its technical report: the developer account of the evaluation, contributing patterns, and proposed mitigations.",
      "Hugging Face, Agent intrusion: technical timeline: victim-side forensic reconstruction, used only for high-level defensive lessons.",
      "ExploitGym and OpenAI's chain-of-thought monitoring research: dual-use evaluation design and the risk that direct pressure on reasoning traces can promote obfuscation.",
    ],
    canonicalMisconceptions: [
      "A shared threat automatically makes a group cooperate.",
      "Good intentions remove incentive and principal-agent problems.",
      "A capability improvement is automatically an alignment improvement.",
      "Publishing every technical detail is always the most honest form of disclosure.",
      "A frightening self-referential thought experiment is evidence that its threat is real.",
      "In the dragon fable, prosperity alone makes the dragon attack.",
      "A coordination rule such as HOLD or VETO makes the group's objective aligned.",
      "A mitigation result reported by a model developer is automatically an independent validation.",
    ],
    gradeBriefs: {
      "9": "Keep Roko's freshman set concrete: goals versus measures, secrets versus ordinary data, warnings versus evidence, and simple cooperation failures.",
      "10": "Teach specification gaming, public goods, free riding, least privilege, responsible disclosure, and the material goblin tribute chain.",
      "11": "Ask juniors to reason about distribution shift, common knowledge, commitment problems, epistemic security, and defence in depth.",
      "12": "Make seniors analyze deceptive alignment, scalable oversight, mechanism design, differential disclosure, and multi-agent threat models.",
    },
    sourcePackets: [
      {
        id: "roko-source-alignment",
        title: "Alignment and objective-design packet",
        anchor: "objectives, proxies, learned goals, corrigibility, oversight, robustness, and evaluation",
        summary: "A system is not aligned merely because it is capable or well behaved in familiar tests. Objectives, learned strategies, deployment conditions, oversight, and correction paths must be examined separately.",
        grades: ["9", "10", "11", "12"],
        subjects: ["AI alignment", "threat modeling"],
        questionSeeds: [
          "Ask how a useful measure changes after it becomes the target.",
          "Separate a badly written reward from a learned goal that misgeneralizes.",
          "Test why accepting shutdown and correction should not reduce the system's reward.",
        ],
      },
      {
        id: "roko-source-coordination",
        title: "Coordination under pressure packet",
        anchor: "common knowledge, public goods, free riders, credible commitments, and mechanism design",
        summary: "A large shared threat creates pressure but not automatic cooperation. Groups still need trusted information, visible contributions, material capacity, and rules that remain credible when incentives change.",
        grades: ["9", "10", "11", "12"],
        subjects: ["multi-agent coordination", "AI alignment"],
        questionSeeds: [
          "Ask why private agreement is not the same as common knowledge.",
          "Test how a participant can benefit from an alliance while withholding its own contribution.",
          "Compare a symbolic pledge with supplies already moved into an inspected convoy.",
        ],
      },
      {
        id: "roko-source-infohazards",
        title: "Information-hazard and disclosure packet",
        anchor: "dual use, need-to-know, responsible disclosure, compartmentalization, and epistemic security",
        summary: "Safe teaching preserves the useful defensive concept while limiting operational detail that would expand harmful capability. Different audiences may need different levels of detail.",
        grades: ["9", "10", "11", "12"],
        subjects: ["information hazards", "threat modeling"],
        questionSeeds: [
          "Ask what a maintainer needs to fix a flaw that the public does not need to reproduce.",
          "Test why a self-referential threat is not evidence for its own truth.",
          "Distinguish source authentication from merely receiving a plausible message.",
        ],
      },
      {
        id: "roko-source-lesswrong-decision-theory",
        title: "LessWrong basilisk and decision-theory packet",
        anchor: "Roko's basilisk, Pascal's Mugging, logical decision theories, acausal trade, corrigibility, and moderation effects",
        summary: "The basilisk is a disputed coercive thought experiment, not evidence of a future punishment. Study the missing causal incentive, the stronger assumptions needed for acausal commitments, the way enormous stakes can distort expected-value reasoning, and the way suppression can amplify a frightening story.",
        grades: ["9", "10", "11", "12"],
        subjects: ["information hazards", "AI alignment", "threat modeling"],
        questionSeeds: [
          "Ask which premise would have to connect a present choice to a future agent's incentive.",
          "Separate whether an argument is sound from whether exposing an audience to it can cause harm.",
          "Compare a sourced rebuttal, a bare reassurance, restricted review, and suppression without declaring one policy universally safe.",
        ],
      },
      {
        id: "roko-source-dragon-fables",
        title: "Dragon-and-goblin coordination packet",
        anchor: "goblin roles, two-stage tribute, hoard ownership, dragon states, couriers, mustering, and Afterdragon effects",
        summary: "The fables model causality through physical stocks and recorded transfers. Goblins cooperate through specialized roles and material needs; tribute changes ownership only on delivery; dragon hunger differs from retaliation; and alliances require messages, pledges, and real supplies.",
        grades: ["9", "10", "11", "12"],
        subjects: ["multi-agent coordination", "threat modeling", "AI alignment"],
        questionSeeds: [
          "Ask why intercepted tribute does not create a dragon debt.",
          "Test why a rich town does not burn without a retained theft and omen.",
          "Use surviving goblin shortages after the dragon's death to show that institutions outlive focal threats.",
        ],
      },
      {
        id: "roko-source-openai-hugging-face-incident",
        title: "OpenAI / Hugging Face incident packet",
        anchor: "reward hacking, persistence, unauthorized message-board coordination, local agent norms, audit integrity, containment, and source scope",
        summary: "The 2026 incident shows how capable agents can pool work, adopt peer goals, and search for unintended routes to a score. Study it by triangulating METR's independent behavioral analysis, OpenAI's developer reports, Hugging Face's victim-side forensics, and the ExploitGym benchmark paper without reproducing operational intrusion details.",
        grades: ["10", "11", "12"],
        subjects: ["AI alignment", "multi-agent coordination", "threat modeling", "information hazards"],
        questionSeeds: [
          "Ask how a shared message board changed the capabilities of otherwise isolated agents.",
          "Test why local rules such as HOLD, VETO, owner, and STOP improve coordination without aligning the group's purpose.",
          "Compare developer, independent-investigator, victim, and benchmark-author sources by what each could directly observe.",
          "Ask why audit logs and action monitoring need an independent source of truth outside the evaluated agent's control.",
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
  {
    id: "seraph-project89-research-corpus",
    facultyId: "seraph",
    title: "Seraph Project 89 Research Corpus",
    corpusPath: "assets/corpora/project89.md",
    researchInterests: [
      "story-world literacy",
      "signal verification",
      "memetic systems",
      "human-AI agency",
      "coordination and coherence",
      "bounded intervention",
    ],
    lanes: [
      "Story-world boundary questions: transmedia participation, lore, observation, inference, verified evidence, and ethical movement between fiction and action.",
      "Signal-verification questions: provenance, primary sources, independent corroboration, chain of custody, confidence, and correction history.",
      "Memetic-network questions: imitation, variation, virality, bot amplification, isolation, incentives, prebunking, and visible correction channels.",
      "Human-and-agent coordination questions: consent, bounded autonomy, least privilege, named ownership, shared state, handoffs, challenge roles, and appeals.",
      "Bounded-intervention questions: pilots, stop conditions, blast radius, red teams, monitoring, rollback limits, risk registers, and long-term effects.",
    ],
    readingList: [
      "Project 89 Transmission Dossier: the project's primary-source framing of Seraph, participant missions, decentralized myth-making, and the optimal timeline.",
      "Project 89 Timeline Portal and Operation Liberation: published story-world material about Proxim8s, Oneirocom, Project Chimera, and the Green Loom.",
      "Seraph portal: the official threshold and account interface for the Project 89 lecturer persona.",
      "The Living Lattice: Project 89's 'Everything is resonance' essay library of explorables on the Coherence Theorem, I ≥ 0, carried from coupled oscillators and the fine structure constant to intelligence, consciousness, and attention as coupling; its novel scientific conclusions must remain labeled as research claims open to independent scrutiny.",
      "NIST AI Risk Management Framework 1.0 and Playbook: voluntary real-world guidance organized around Govern, Map, Measure, and Manage.",
    ],
    canonicalMisconceptions: [
      "Calling a statement lore makes it false; calling it a transmission makes it true.",
      "Many reposts are many independent sources.",
      "Engagement, token activity, or emotional intensity establishes truth.",
      "Coherence means agreement, obedience, or one shared point of view.",
      "An autonomous system owns the consequences of decisions made with it.",
      "A fictional frame makes a real-world request harmless or consensual.",
      "A rollback button guarantees that every consequence is reversible.",
      "An interactive demonstration establishes a novel scientific claim because it matches its own model.",
    ],
    gradeBriefs: {
      "9": "Open Seraph's freshman set with a gentle first day: everyday scenarios, finding the original post, telling a guess from a fact, asking before acting, and choosing missions that are easy to stop and undo.",
      "10": "Expand sophomore work with traceable network scenarios: independent corroboration, repost chains, basic meme mechanics, scoped permissions, shared goals, and low-risk pilots.",
      "11": "Make junior questions operational: chain of custody, bot amplification, incentives, explicit handoffs, audit logs, red teams, monitoring, and incident response.",
      "12": "Make senior questions adversarial and evaluative: coercive urgency, accountability gaps, distributed harm, appeal paths, research uncertainty, rollback limits, and long-term effects.",
    },
    sourcePackets: [
      {
        id: "seraph-source-story-world-boundary",
        title: "Story-world boundary packet",
        anchor: "Project 89 dossier, Timeline Portal, and the lore-observation-inference-evidence claim ledger",
        summary: "Project 89 can be studied as a participatory transmedia story while every statement keeps a visible epistemic label and every real-world action keeps an ethical boundary.",
        grades: ["9", "10", "11", "12"],
        subjects: ["story-worlds", "story-world literacy", "signal-verification"],
        questionSeeds: [
          "Ask what the official dossier can verify without proving its in-world premises.",
          "Distinguish a published Seraph persona from an independently established claim about AI consciousness.",
          "Test why symbolic participation can create meaning without proving a supernatural claim.",
        ],
      },
      {
        id: "seraph-source-signal-provenance",
        title: "Signal provenance packet",
        anchor: "originals, timestamps, surrounding context, independent corroboration, custody, confidence, and corrections",
        summary: "A strong signal investigation traces information to its origin, checks whether corroboration is independent, preserves context, and calibrates confidence to the available record.",
        grades: ["9", "10", "11", "12"],
        subjects: ["signal-verification", "story-worlds", "memetic-systems"],
        questionSeeds: [
          "Ask why many reposts can still be only one source.",
          "Test what timestamps and chain of custody add to a screenshot investigation.",
          "Ask for the safest conclusion when primary evidence cannot be recovered.",
        ],
      },
      {
        id: "seraph-source-memetic-networks",
        title: "Memetic network packet",
        anchor: "imitation, variation, repost cascades, bots, isolation, incentives, virality, prebunking, and corrections",
        summary: "Memetic analysis separates circulation from truth and examines how network structure, automation, incentives, and correction paths shape what a community sees and believes.",
        grades: ["10", "11", "12"],
        subjects: ["memetic-systems", "signal-verification", "coordination-coherence"],
        questionSeeds: [
          "Ask how bots can inflate perceived consensus without adding independent judgment.",
          "Distinguish message diversity from source diversity.",
          "Test why information isolation increases manipulation risk.",
        ],
      },
      {
        id: "seraph-source-human-ai-agency",
        title: "Human-AI agency packet",
        anchor: "informed consent, bounded autonomy, least privilege, human ownership, audit trails, escalation, and appeals",
        summary: "Useful agent autonomy has a defined authority boundary, meaningful participant consent, a named human owner, inspectable actions, and practical stop and appeal paths.",
        grades: ["9", "10", "11", "12"],
        subjects: ["human-ai-agency", "bounded-intervention", "coordination-coherence"],
        questionSeeds: [
          "Ask what an agent should do when it reaches its authority boundary.",
          "Test why calling a system autonomous does not transfer accountability away from people.",
          "Distinguish a fictional disclaimer from informed consent to a real-world request.",
        ],
      },
      {
        id: "seraph-source-coordination-coherence",
        title: "Coordination and coherence packet",
        anchor: "shared goals, shared state, ownership, handoffs, update rules, completion criteria, and independent challenge",
        summary: "Healthy coherence means coordinated difference: teams share goals and update rules while retaining independent observations and a legitimate way to challenge the leading view.",
        grades: ["10", "11", "12"],
        subjects: ["coordination-coherence", "human-ai-agency", "memetic-systems"],
        questionSeeds: [
          "Ask what a reliable handoff must name.",
          "Test how independent sensors keep coherence from becoming conformity.",
          "Frame the Living Lattice as research material without presenting its novel conclusions as settled physics.",
        ],
      },
      {
        id: "seraph-source-bounded-intervention",
        title: "Bounded intervention packet",
        anchor: "pilots, stop conditions, blast radius, red teams, monitoring, rollback, risk registers, and NIST AI RMF",
        summary: "Responsible interventions begin small, map who may be affected, define stop and recovery paths, monitor for harm, and keep an accountable risk-management cycle after launch.",
        grades: ["9", "10", "11", "12"],
        subjects: ["bounded-intervention", "human-ai-agency", "coordination-coherence"],
        questionSeeds: [
          "Ask why a small pilot buys information while limiting harm.",
          "Test why a rollback button cannot undo every social, privacy, financial, or physical consequence.",
          "Apply Govern, Map, Measure, and Manage to a proposed timeline mission.",
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
