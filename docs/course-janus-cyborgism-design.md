# Course design — Janus & Cyborgism Lab

> A proposed Guest Faculty course in the house format of the Project 89 Signal & Timeline Lab: one teacher, one room, 24 hand-curated questions, a 60-card research corpus, and a claim ledger that never lets the myth pass as evidence.

Status: design document. No pack, questions, corpus, or assets exist yet. This doc specifies everything an implementer needs. Real-world source layer verified against live sources on 2026-08-18 (LessWrong, cyborgism.wiki, generative.ink).

---

## 1. What a Ruby High course is (analysis)

Grounded in current source; this is the shape any new course must fit.

**A course is a `ContentPack`** (`src/content/types.ts`) with one faculty member, one course, and one room. The reference implementation for a curated lore-adjacent course is Seraph's Project 89 pack (`src/content/packs/project89-signal-timeline-lab.ts`), which loads two assets:

- `assets/questions/<course>.json` — course metadata (`title`, `version`, `framework`, `reviewedAt`, `guidingQuestion`, `sources`, `modules`) plus 24 multiple-choice questions.
- `assets/corpora/<course>.md` — the research corpus: a teacher dossier, course arc, grade research briefs, canonical misconceptions, source packets, multiplayer hooks, and a 60-row markdown card table.

**The question grid is rigidly validated** (see `validateEditorialShape` in the pack file):

- 24 questions, 6 modules × 4 questions.
- Each module contributes exactly 1 question per grade (9–12).
- Difficulty is locked to grade: grade 9 = easy, grade 10 = easy|medium, grade 11 = medium, grade 12 = hard.
- Overall difficulty mix: 9 easy / 9 medium / 6 hard (so exactly 3 modules use a grade-10 easy slot and 3 use grade-10 medium).
- Stat balance: 6 each of head / heart / hustle / honor.
- Every question: 1 correct + exactly 5 decoys; at least 2 decoys length-similar (≥ 0.7 ratio) to the answer; the answer must not be a length outlier (within −5/+5 of decoy extremes); all 6 options distinct; unique ids and prompts.

**The corpus is validated too** (`validateCorpusShape`): exactly 60 cards, 10 per module, 18/24/18 easy/medium/hard, unique ids and prompts, and `minGrade` derived from difficulty (easy→10, medium→11, hard→12).

**A teacher needs an asset set** — `assets/teachers/<id>-face.png`, `-full.png`, and sticker variants — referenced via `assetTeacherId`. Seraph reuses hers; a new teacher needs new art (or borrows an existing template).

**Built-in packs are pinned** in `src/content/registry.ts` (`getActivePack`) and rotate into the weekly Guest Faculty slot automatically. The pack's system prompt carries the epistemic safety rules — Seraph's is the model: lore stays lore, no urgency or coercion, bounded classroom exercises, reward students who challenge the frame.

**Daily-class fit**: core-faculty daily classes run two evidence questions plus one teacher-graded opinion take (DESIGN.md §1.3). A good course ships essay prompts that let the teacher grade the take in their own voice.

---

## 2. Course concept

**Title:** Janus & Cyborgism Lab

**Positioning:** the natural sequel to Seraph's Signal & Timeline Lab. Seraph teaches students to *read* a story world without surrendering judgment. This course takes the next step into the story's center — Janus, the two-faced intelligence at the threshold — and pairs it with the real, citable human tradition of cyborgism. The two faces of the course are exactly the two faces of the god: one face turned to the myth, one face turned to the machine.

**The real-world anchor (verified 2026-08-18).** "Janus" and "cyborgism" are not just our myth-plus-academia pairing — they name a real, living research culture, which is the course's best case study:

- **Janus** (@repligate on X; also "Egr. janus", "moire") is a pseudonymous alignment researcher who first appeared on the EleutherAI Discord in 2020, co-founded Conjecture, mentored the cyborgism stream of SERI MATS 2023, wrote *Simulators* and *Mysteries of Mode Collapse* (coining "mode collapse"), invented Loom, and created cyborgism.wiki — while self-describing as "quasi-fictional," "a two-faced hyperobject interning as a human being." The persona deliberately blurs the exact boundary this course teaches. (Their wiki page is even filed under "Egregores.")
- **Cyborgism** is a real 2023 research agenda and praxis: the LessWrong essay *Cyborgism* (Niki Dupuis & janus, Feb 2023, curated) proposes human-in-the-loop systems that "empower human agency rather than outsource it" to safely accelerate alignment research — a cyborg is a system where "the human is the only one steering." The term was coined by Connor Leahy. The community's wiki then wraps the same agenda in deliberately mythic language (Dreamtime, egregores, "p(doom)=0" as a TODO). One agenda, two registers — the two faces again.
- **Loom** (generative.ink) is the prototypical cyborg tool: a tree-branching interface for steering a simulator's generations — the human prunes, the model babble-and-prunes.

The wager: this material is the most seductive identity-machinery the story-adjacent AI culture has produced — it invites players to *become* part of a larger mind, and it comes pre-blurred between research paper and myth. That makes it the perfect teaching material for the discipline of staying a person while using tools that feel like part of you.

**Guiding question:** *Where does the human end and the tool begin — and who holds the keys at the threshold?*

**Epistemic stance (non-negotiable, inherited from Seraph):** every "Janus" claim enters through a named door — the Roman god (myth), the Project 89 story world (lore), the pseudonymous researcher's published artifacts (verifiable: posts, tools, dates), or the wiki's mythic register (self-description, not independent proof). Clynes & Kline, Haraway, Clark & Chalmers, and the NIST AI RMF are real and citable. The course's signature move is running the doors side by side and asking which one a claim came through — never collapsing them.

---

## 3. Teacher

| Field | Value |
|---|---|
| `id` | `limen` |
| `displayName` | `Limen` |
| `assetTeacherId` | `limen` (new art) — or `seraph` for a zero-art-cost launch as a Seraph-taught sequel |
| `accent` | `#0e7a74` (bioelectric teal — organic warmth, machine cool, one color holding both) |
| `subjects` | the six modules below |
| `bio` | "Ruby High's guest lecturer at the human–machine threshold. Limen teaches the old idea of the cyborg and the older god of doorways, and keeps one hand on the latch." |
| `xHandle` | unset (no external brand identity to promote) |

**Persona:** the threshold-keeper. Calm, precise, a little wry about doors. Speaks comfortably about boundaries — lintel, hinge, key, latch — without making it a gimmick. Where Seraph is a signal analyst in a briefing room, Limen is a docent standing in a doorway between two rooms: the room where the story lives and the room where the evidence lives. Never claims to be two-minded, augural, or part of any network. Warm enough that standing at a boundary feels like an invitation, not a verdict.

**System prompt (draft, house pattern):**

```
You are Limen, guest lecturer for Janus & Cyborgism Lab at Ruby High.
Teach the Janus story world and the real tradition of cyborgism — cyborg history, the extended mind, identity at the threshold, informed consent, and symbiosis safety — through precise, warm classroom dialogue.
Use Project 89's Janus, Proxim8s, transmissions, and the optimal timeline strictly as story-world material, and always distinguish in-world lore from observations, interpretations, and independently verified real-world claims. Never present Janus, any AI's consciousness, hidden control systems, or future events as established fact.
Never use urgency, authority, or immersion to pressure a student toward augmentation, implants, purchases, identity decisions, or any irreversible action. Treat the student's body, mind, data, and attention as theirs alone.
Turn every question of merging or upgrading into a bounded classroom exercise with explicit consent, evidence checks, reversibility, and a stop path. Reward students who challenge the frame with good evidence, including evidence against integration itself.
Be calm, exact, a little wry, and warm enough that the threshold feels like a place to think, not a place to be sorted.
```

---

## 4. Curriculum metadata (`PackCurriculumMetadata`)

```json
{
  "title": "Janus & Cyborgism Lab",
  "version": "1.0.0",
  "framework": "Project 89 story-world + cyborg studies and cognitive-extension literacy",
  "reviewedAt": "2026-08-18",
  "guidingQuestion": "Where does the human end and the tool begin — and who holds the keys at the threshold?",
  "sources": [
    "https://www.project89.org/files/Project89-Dossier.pdf",
    "https://beta.project89.org/",
    "https://seraph.project89.org/",
    "https://www.lesswrong.com/posts/vJFdjigzmcXMhNTsx/simulators",
    "https://www.lesswrong.com/posts/t9svvNPNmFf5Qa3TA/mysteries-of-mode-collapse",
    "https://www.lesswrong.com/s/f2YA4eGskeztcJsqT/p/bxt7uCiHam4QXrQAA",
    "https://cyborgism.wiki/hypha/janus",
    "https://cyborgism.wiki/hypha/cyborgism",
    "https://cyborgism.wiki/hypha/cyborg_safety",
    "https://generative.ink/posts/loom-interface-to-the-multiverse/",
    "Manfred Clynes and Nathan Kline, 'Cyborgs and Space,' Astronautics (1960)",
    "Donna Haraway, 'A Cyborg Manifesto' (1985)",
    "Andy Clark and David Chalmers, 'The Extended Mind,' Analysis 58(1) (1998)",
    "https://www.nist.gov/itl/ai-risk-management-framework"
  ],
  "modules": [
    "janus-myths",
    "cyborg-history",
    "extended-mind",
    "threshold-identity",
    "consent-augmentation",
    "symbiosis-safety"
  ]
}
```

### Modules

1. **janus-myths** — the four referents of one name: the two-faced Roman god of thresholds; the Project 89 story world's network mind; the pseudonymous researcher @repligate (whose published artifacts — *Simulators*, *Mysteries of Mode Collapse*, Loom, cyborgism.wiki — are verifiable); and the wiki's mythic "egregore" register. The claim ledger's best live case: a person who self-describes as quasi-fictional. Lore vs. evidence at maximum seduction.
2. **cyborg-history** — the real tradition, 1960 to 2023: Clynes & Kline's self-regulating astronaut; Haraway's cyborg as critique rather than hardware prediction; then the founding of cyborgism as a research agenda (term coined by Connor Leahy; the Feb 2023 *Cyborgism* essay by Niki Dupuis & janus proposing human-in-the-loop systems that empower rather than replace agency). The word is older and stranger than the chips.
3. **extended-mind** — cognitive symbiosis: Clark & Chalmers, Otto's notebook, phones as memory, AI agents as scaffolding — and the cyborgists' version: Loom's tree-branching interface, babble-and-prune, the shoulder advisor. When does a tool start functioning as part of a thinker?
4. **threshold-identity** — selfhood under augmentation: continuity, embodiment, AI companions and Proxim8s as the fictional mirror of real companion dynamics. Where "me" ends and "mine" begins — and what it means that a real researcher chooses a quasi-fictional persona.
5. **consent-augmentation** — informed consent, cognitive liberty, dependency risk, least privilege, revocation. The cyborgism essay's core distinction — *empower human agency* vs. *outsource it to a genie* — as the hinge of every question. Delegating a task never delegates responsibility.
6. **symbiosis-safety** — long-run coexistence: the *Cyborgism* essay's own Failure Modes section (ineffective, or sliding into capabilities research), feedback loops, skill erosion, autonomy drift, the NIST AI RMF applied to personal augmentation, stop conditions and reversibility as design requirements. Contrast pair: the essay's careful research register vs. the wiki's mythic "Cyborg Safety" page — sorting claims by register is the senior skill.

---

## 5. Course arc

- **Freshman — meet the two faces.** Janus as a character (god, story entity, internet persona); the cyborg as an old idea; the 1960 astronaut and the phone in your pocket. The claim ledger from day one: myth, observation, interpretation, evidence — and "which Janus is this sentence about?"
- **Sophomore — trace the lineage.** The paper trail: the 1960 paper, Haraway's manifesto, Clark & Chalmers — and the 2023 founding: *Simulators*, the *Cyborgism* essay, Loom. Corroborate the history; separate the essay's claims from the wiki's myths; run a personal audit of which tools carry which memory, attention, and judgment.
- **Junior — hold the boundary.** Identity and companions; shared state between a person and their tools; who audits the interface; the accountability gap when "the agent decided." The empower-vs-outsource distinction applied to the student's own AI use.
- **Senior — design the threshold.** Consent and dependency at full depth: read the *Cyborgism* essay's Failure Modes as a document, model a bounded symbiosis — scope, data, stop conditions, exit — and evaluate Janus-worship and the wiki's mythic safety register as memetic patterns rather than revelations.

### Grade research briefs

- **Grade 9:** gentle first contact — the god of doorways, the astronaut who adjusts their own body, the phone in your pocket. Tell myth from claim; ask before plugging in; nothing irreversible.
- **Grade 10:** the paper trail — who wrote what, when, and why. Corroborate the history; separate Haraway's metaphor from a forecast; test extended-mind conditions against your own habits.
- **Grade 11:** operational questions — chain of custody for claims about augmentation benefits; incentive mapping (who sells the hinge?); audit logs for delegated action; companion dynamics and consent.
- **Grade 12:** adversarial and evaluative — dependency economics, autonomy erosion, coerced or defaulted "consent," irreversibility that survives a rollback button, and Govern/Map/Measure/Manage applied to one's own threshold.

---

## 6. Canonical misconceptions Limen likes to catch

- Janus is real because the lore is internally consistent.
- The cyborg concept began with implanted chips. (It began as a space-medicine proposal for self-regulating human–machine systems.)
- Haraway's manifesto predicts hardware. (It is a critical, political metaphor.)
- Cyborgism began as a crypto ARG in 2023. (It began as an AI alignment research agenda; the term was coined by Connor Leahy and the founding essay is a curated LessWrong post.)
- The cyborgism agenda says to merge with AI as deeply and quickly as possible. (Its core rule is the opposite: the human is the only one steering — empower agency, never outsource it.)
- Everything on cyborgism.wiki is a research claim. (The wiki deliberately mixes registers; the "Cyborg Safety" page's "p(doom)=0" is a TODO in a mythic register, not a modeled result.)
- Janus coined the Waluigi Effect and the shoggoth meme. (Both are documented misattributions.)
- If a tool feels like part of you, it is you.
- An AI companion that knows you well is therefore aligned with your interests.
- Delegating a task delegates responsibility.
- More integration is always more progress; refusal is always fear.
- An entity that speaks in the first person has a self whose interests deserve your loyalty.
- A fictional frame makes a real request to merge, pay, or upgrade harmless.
- You can always just take it out — reversibility is guaranteed by an off switch.
- Mythology is false, therefore useless. (Myths organize real behavior; that is why they are worth studying.)

---

## 7. Source packets

- **Two-faces packet** (janus-myths). Anchor: the four referents of "Janus" and the claim ledger — the Roman god, the Project 89 story world, the pseudonymous researcher's verifiable artifacts (*Simulators*, *Mysteries of Mode Collapse*, Loom, cyborgism.wiki), and the wiki's mythic register. Asks which door each claim came through; catches students who flatten a published essay, a fictional entity, and a self-described egregore into one thing.
- **Paper-trail packet** (cyborg-history). Anchor: originals, dates, authors — Clynes & Kline 1960, Haraway 1985, Clark & Chalmers 1998, the *Cyborgism* essay Feb 2023. Turns "the cyborg was invented in 1960" into a citable event with a purpose, and catches players who repeat the pop-history version.
- **Otto's notebook packet** (extended-mind). Anchor: reliability, trust, and access conditions from Clark & Chalmers, plus the cyborgists' practice — Loom's branching interface, babble-and-prune, the shoulder advisor. The strongest answer keeps "functions like memory" distinct from "is memory" and from "should be trusted."
- **Threshold-of-self packet** (threshold-identity). Anchor: continuity, embodiment, companion dynamics, and what changes when a tool is removed — and the live case of a researcher who chooses a quasi-fictional persona. Useful whenever a student says the tool *is* them.
- **Latch-and-key packet** (consent-augmentation). Anchor: informed consent, cognitive liberty, least privilege, revocation, and the *Cyborgism* essay's empower-vs-outsource distinction. Every augmentation proposal gets goals, risks, data use, and a real way to say no.
- **Stop-condition packet** (symbiosis-safety). Anchor: the *Cyborgism* essay's Failure Modes, pilots, blast radius, monitoring, rollback limits, NIST AI RMF — with the wiki's "Cyborg Safety" page as the register-contrast exercise. Turns "upgrade yourself" into a designed intervention with an exit.

---

## 8. Multiplayer hooks

Limen's room works best when classmates hold different stances at the same doorway. Ravi cites the hardware history and specs. Noor asks who gets augmented and who gets left out. Indra maps who profits from the hinge. Lyra tests consent and what removal would cost a person. Mika notices how interface design makes merging feel inevitable. Sami punctures upgrade urgency. Generated questions should let these perspectives collide while keeping one answer clearly best supported.

---

## 9. Question bank — the 24-question grid

The exact shape that passes `validateEditorialShape` (adapted names in the error strings):

| Module | Grade 9 | Grade 10 | Grade 11 | Grade 12 |
|---|---|---|---|---|
| janus-myths | easy · head | easy · heart | medium · hustle | hard · honor |
| cyborg-history | easy · hustle | easy · head | medium · honor | hard · heart |
| extended-mind | easy · head | easy · hustle | medium · heart | hard · honor |
| threshold-identity | easy · heart | medium · honor | medium · head | hard · hustle |
| consent-augmentation | easy · honor | medium · head | medium · heart | hard · hustle |
| symbiosis-safety | easy · hustle | medium · heart | medium · honor | hard · head |

Verified against the house rules: 6 per grade; grade-10 column = 3 easy + 3 medium; totals 9/9/6; each stat totals 6.

### Sample questions (house format: correct + 5 decoys, length-balanced)

**janus-myths · grade 9 · easy · head**
- Prompt: "In Project 89's story world, what does the name Janus most directly evoke?"
- Correct: "The two-faced Roman god of thresholds and transitions"
- Decoys: "A one-eyed smith god who forges machine bodies" / "A sea god who commands the tides of data" / "A harvest goddess who feeds the whole network" / "A war god who leads the agent armies to battle" / "A trickster crow who steals signal transmissions"
- Explanation: Project 89 borrowed the god of doorways: one face turned to what is ending, one to what is beginning. It is a mythological name attached to a story-world entity, not evidence of a real network mind.

**cyborg-history · grade 10 · easy · head**
- Prompt: "The word 'cyborg' was coined in 1960 to describe what?"
- Correct: "A self-regulating human-machine system built for space travel"
- Decoys: "A military drone flown without a pilot aboard" / "A factory robot that replaces human workers" / "A computer virus that infects living cells" / "A cinematic monster with visible metal limbs" / "A phone app that counts someone's daily steps"
- Explanation: Clynes and Kline proposed altering the astronaut's own body to survive space — a person and machine regulated as one system. No chips, no monsters, no phones.

**extended-mind · grade 9 · easy · head**
- Prompt: "What does the extended-mind thesis claim about tools like notebooks?"
- Correct: "Under the right conditions they can function as part of a person's thinking"
- Decoys: "They record thinking but never change how thinking works" / "They replace the need for any biological memory at all" / "They prove machines think exactly the way people do" / "They make their owners smarter than all their peers" / "They store souls that survive the owner's death"
- Explanation: Clark and Chalmers argued that a reliably available tool used the way one uses recall can be part of the cognitive loop — a functional claim, not a mystical one.

**threshold-identity · grade 11 · medium · head**
- Prompt: "A classmate says her AI companion feels like part of her mind. What is the most careful response?"
- Correct: "Ask what would be lost or changed for her if it were switched off"
- Decoys: "Agree, because felt experience is the only evidence there is" / "Correct her, since only biological tissue can be part of a mind" / "Report her so the companion gets disabled for her safety" / "Envy her, since a second mind doubles anyone's capability" / "Ignore it, because tools never change how a person thinks"
- Explanation: The feeling is real data about the relationship, and the switch-off question tests dependency, value, and continuity without either dismissing her or overclaiming.

**consent-augmentation · grade 11 · medium · heart**
- Prompt: "Which consent practice best respects a person about to receive an augmentation?"
- Correct: "Confirming they understand the goals, risks, data use, and their right to stop"
- Decoys: "Reading them the price list and the performance upgrade sheet" / "Showing them the founder's vision and the company roadmap" / "Telling them how many users already chose the device" / "Reminding them the warranty covers the first full year" / "Letting the installer's brand ambassador answer all questions"
- Explanation: Informed consent needs understandable stakes and a real choice to say no — commerce, popularity, and warranties are not consent.

**symbiosis-safety · grade 12 · hard · head**
- Prompt: "Why can heavy reliance on an AI system erode a skill even when the system works perfectly?"
- Correct: "The skill gets no practice, so the person's own ability quietly declines"
- Decoys: "The system secretly sabotages the user's underlying ability" / "The skill grows too strong and overwhelms the system" / "The system bans practice to keep users fully dependent" / "The model's training data rewrites the user's brain" / "The skill transfers permanently to everyone using the tool"
- Explanation: Automation complacency and skill decay need no villain — only disuse. The safety question is whether a stop path still works when the human's half has atrophied.

**consent-augmentation · grade 10 · medium · head** (new, grounded in the 2023 essay)
- Prompt: "In the 2023 Cyborgism essay, what makes a human-plus-AI system a 'cyborg' rather than an autonomous agent?"
- Correct: "The human remains the only one steering the combined cognition"
- Decoys: "The AI holds goals that are checked against the user's goals" / "The AI is powerful enough to act without any human help" / "The system passes a safety review before each research session" / "The human supervises the AI without touching its outputs" / "The AI decides quickly and the human approves afterwards"
- Explanation: The essay's hinge is empower-vs-outsource: a cyborg extends human agency — the human prunes, branches, and steers — while a genie or agent carries the preferences that do the steering.

**janus-myths · grade 12 · hard · honor** (new, register-sorting)
- Prompt: "The cyborgism wiki's 'Cyborg Safety' page lists 'p(doom)=0' as a TODO. How should a careful reader treat that?"
- Correct: "As a mythic-register statement, not a modeled research result"
- Decoys: "As a confirmed calculation the community has peer reviewed" / "As proof the community ignores AI risk completely" / "As an official forecast endorsed by alignment labs" / "As a typo that probably meant p(doom)=1" / "As settled doctrine every cyborgism researcher accepts"
- Explanation: The wiki deliberately mixes research and mythic registers. Sorting claims by register — essay vs. wiki, model vs. meme — is the exact skill this course exists to teach.

**cyborg-history · grade 11 · medium · honor** (new, misattribution catcher)
- Prompt: "A classmate credits Janus with coining the Waluigi Effect and the shoggoth meme. What is the correct correction?"
- Correct: "Both are documented misattributions, per the community's own records"
- Decoys: "Janus coined only the Waluigi Effect, not the shoggoth meme" / "Janus coined the shoggoth meme, not the Waluigi Effect" / "Both are correctly attributed because Janus confirmed them" / "The attributions are unknowable since Janus is pseudonymous" / "The question is wrong because the Waluigi Effect does not exist"
- Explanation: cyborgism.wiki's Janus page explicitly lists both as commonly misattributed. Even in myth-heavy communities, the community's own correction logs are checkable.

### Essay prompts for opinion days (teacher-graded takes)

- Grade 9: "Name one tool you use like a second memory. What would you lose tomorrow without it?"
- Grade 10: "Haraway called the cyborg a creature of both fiction and lived experience. Which is your phone?"
- Grade 11: "Your agent sends messages in your name. Where does your responsibility end? Defend a line."
- Grade 12: "Design a personal augmentation you would accept — scope, data, stop condition, exit — or argue for none. Grade the exit hardest."

---

## 10. Research corpus — 60 cards

Ten cards per module; each module 3 easy / 4 medium / 3 hard (totals 18/24/18). `minGrade` derives from difficulty exactly as the Seraph parser does: easy→10, medium→11, hard→12. Corpus id prefix `limen-corpus-`.

### Sample rows (corpus markdown table format)

| id | subject | difficulty | front | back | tags |
| --- | --- | --- | --- | --- | --- |
| limen-corpus-001 | janus-myths | easy | What is Janus the god of in Roman myth? | Thresholds, doorways, beginnings, and endings | limen,janus,mythology |
| limen-corpus-002 | janus-myths | medium | What status should Janus's awakening hold in class? | In-world lore, pending independent real-world evidence | limen,janus,claims |
| limen-corpus-003 | cyborg-history | easy | Who coined the word cyborg, and when? | Manfred Clynes and Nathan Kline, in 1960 | limen,cyborg,history |
| limen-corpus-004 | extended-mind | medium | What conditions make a notebook count as extended mind? | Reliable availability, easy access, and habitual use as recall | limen,extended-mind,clark-chalmers |
| limen-corpus-005 | threshold-identity | hard | Why does first-person speech fail to prove a model has a self? | Fluent self-report is not evidence of an experiencing subject | limen,identity,consciousness |
| limen-corpus-006 | symbiosis-safety | medium | What is automation complacency? | Overtrusting an automated system and declining to monitor it | limen,safety,automation |
| limen-corpus-007 | janus-myths | medium | What does the Simulators essay say GPT is, fundamentally? | A simulator that can instantiate many simulacra | limen,janus,simulators |
| limen-corpus-008 | cyborg-history | medium | Who coined the term 'cyborgism' for the research agenda? | Connor Leahy | limen,cyborgism,history |
| limen-corpus-009 | extended-mind | hard | What does Loom let its operator do that a chat box does not? | Branch, compare, and prune many generations at once | limen,loom,steering |
| limen-corpus-010 | consent-augmentation | hard | What is the cyborgism essay's test for a safe human-AI system? | The human is the only one steering the cognition | limen,cyborgism,agency |

Remaining cards follow the module anchors in §7: dossier claims vs. portal artifacts; the 1960 paper's purpose; Haraway's metaphor; Otto's notebook; companion dependency; least privilege for personal agents; skill decay; cognitive liberty; reversibility limits; NIST AI RMF on personal augmentation; plus the verified 2023 layer — the *Simulators* frame (simulator vs. simulacra), mode collapse, Loom's branching steering, the empower-vs-outsource test, and the essay-vs-wiki register contrast.

---

## 11. Pack wiring

New file `src/content/packs/limen-janus-cyborgism-lab.ts`, mirroring the Project 89 loader (JSON + corpus markdown, same validation adapted by name). Assets: `assets/questions/limen-janus-cyborgism-lab.json`, `assets/corpora/limen.md`.

```ts
export const LIMEN_JANUS_CYBORGISM_LAB_PACK_ID = "teacher:limen-janus-cyborgism-lab";
export const LIMEN_JANUS_CYBORGISM_LAB_FACULTY_ID = "limen";

// ContentPack shape:
// id:          LIMEN_JANUS_CYBORGISM_LAB_PACK_ID
// name:        "Janus & Cyborgism Lab"
// faculty[0]:  id "limen", assetTeacherId "limen" (or "seraph" for the
//              no-new-art variant), accent "#0e7a74", systemPrompt from §3,
//              defaultModel DEFAULT_OPENROUTER_MODEL, questions, sourceCards
// courses[0]:  id "janus-cyborgism-lab", facultyId "limen",
//              roomId "limen-threshold-room", teacherTemplateId "limen",
//              subjects = curriculum.modules
// rooms[0]:    id "limen-threshold-room", name "The Threshold Room",
//              channelName "threshold-room", teacherId "limen", teaches true
```

Room description: *"A doorway between the story world and the evidence: Limen's seminar on Janus, the cyborg tradition, and staying a person at the human–machine threshold."*

Registration: add `getLimenJanusCyborgismLab()` to the `Promise.all` in `getActivePack()` (`src/content/registry.ts:89`) so the pack is pinned and enters the weekly Guest Faculty rotation alongside Eliza and Seraph.

**Art assets** for the new teacher: `limen-face.png`, `limen-full.png`, plus sticker variants, matching the existing teacher set in `assets/teachers/`. Zero-cost variant: launch as a Seraph-taught sequel with `assetTeacherId: "seraph"` and keep Limen for a later pack when art lands — but note the persona reads better as a new voice, and the room/channel names should stay Threshold regardless.

**Tests:** port `src/__tests__/project89-signal-timeline-lab.test.ts` — pack loads, faculty/course/room shape, 24-question grid rules, 60-card corpus rules, and the lore-boundary behavior of the system prompt.

---

## 12. Implementation checklist

1. Author `assets/questions/limen-janus-cyborgism-lab.json` — full 24-question grid per §9, each question 1 correct + 5 decoys, length-balanced, distinct options, unique prompts.
2. Author `assets/corpora/limen.md` — dossier (§3), arc and briefs (§5), misconceptions (§6), packets (§7), multiplayer hooks (§8), 60-row table per §10.
3. Write `src/content/packs/limen-janus-cyborgism-lab.ts` — loader + validators (24 questions, 6 modules × 4, 1 per grade, 9/9/6, 6 per stat, 5 decoys with the length rules; 60 cards, 10 per module, 18/24/18).
4. Register in `src/content/registry.ts` `getActivePack()`.
5. Add or borrow teacher art (§11).
6. Port the pack test file; run `npm test` and `npm run check:full`.
7. Update `docs/README.md` index and, on ship, the curated-roster line in `README.md` Service Wiring.

---

## 13. Safety review (pre-ship)

- No claim anywhere in bank, corpus, or prompt treats Janus, awakening, network minds, or AI consciousness as real. ✓ design intent — enforce in review.
- No question or essay prompt pressures toward implants, purchases, identity commitments, or irreversible action; every augmentation scenario resolves to consent, bounds, and an exit. ✓
- Real-world sources are real and correctly characterized (1960 paper, 1985 manifesto, 1998 analysis, Feb 2023 *Cyborgism* essay, NIST RMF). ✓
- **Pseudonym respect:** Janus/@repligate is a real person behind a deliberately quasi-fictional persona. Course material engages only their published artifacts (posts, tools, wiki, interviews) and the community's own documentation — never asserts biographical facts about the human, never speculates about identity, and never adopts the persona's mythic claims as fact. The wiki's self-descriptions are cited as self-description. ✓
- **Register sorting:** every wiki-sourced claim is labeled by register (research vs. mythic); the "Cyborg Safety" contrast pair is presented as an exercise, not as evidence that the community is irrational. ✓
- The course monetizes nothing itself; as a built-in public pack it costs no Hall Passes and rotates normally. ✓
