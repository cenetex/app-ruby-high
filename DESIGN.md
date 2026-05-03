# Ruby High

> A school where the teachers grade you in their own voice. Once a day. The grade is yours to keep.

<!-- promo-asset: hero-classroom — wide screenshot of the viewer with Ruby's chalkboard, the room rail, and the character card visible -->

This is the strategic and mechanics doc for the Ruby High project. It is the source of truth for the product. The marketing site is a stylesheet on top.

For the run-it-yourself runbook, see [`README.md`](./README.md). For the deploy-it-to-AWS runbook, see [`infra/README.md`](./infra/README.md).

---

## 1. The bet

> *Most AI products fail in the same place: the second session.*

The first session is dazzling. The user closes the tab. They never come back.

Ruby High is built around the bet that the failure is structural, not creative. Other AI products optimize for one of: a voice you remember, a grade that means something, a daily cadence, an artifact you can keep. The category leaders rarely stack two. None stacks four.

Ruby High stacks all four. A 2–3 sentence essay graded by Professor Edward on a Tuesday, delivered alongside three classmates' essays, archived to a yearbook page you can show a friend — that is something no other AI product produces. The combination is the product. Each ingredient on its own is commodity.

**It's free.** You sign in with your own OpenRouter key — no card, no subscription, your inference bill is yours. We never see the key. The full economic argument is in §8.

---

## 2. What a day looks like

> *The school bell rings at 17:00 UTC. One teacher is on the floor. They post one question. That question is the day.*

You open the app on Tuesday afternoon. Professor Edward is at the chalkboard — Tuesdays are his. He posts an opinion question: a passage to discuss, three sentences asked of you. You're a Junior this year, so Sami and Mika are your two classmates in the literature room. You write your response. They write theirs. Edward reads all three and grades them in his voice — a 0–10 score, one sentence of comment, a single named "best response."

Your streak ticks. Indra graduated last week while you were still here — you can see her name has moved up the cohort rail. The grade lives on your report card under Edward's name.

Tomorrow is Wednesday. Wednesday is Ruby's. The bell rings at the same time.

<!-- promo-asset: daily-walkthrough-clip — short looping mp4 of a real Daily resolving end to end -->

---

## 3. Three pillars

> *The Daily is the cadence. The Cohort is the company. The Yearbook is the artifact. Each pillar is load-bearing.*

### The Daily — cadence

[live] Every weekday at 17:00 UTC the school is in session. One teacher is on the floor. One question is on the board. Pass enough Dailies in your year to advance; graduate after Senior. Streak resets on a miss. Weekends are off — streaks hold across them.

The Daily is not a side mode. The Daily is the entire arc. Scarcity is the credibility — if Edward will grade an essay any time you ask, his attention is cheap.

### The Cohort — company

[live] Six AI classmates run their own four-year arcs alongside you. They roll their own Dailies on their own dice. Indra might graduate while you are still a Sophomore. Mika might fall behind. Coming back to the app means coming back to *people*, not to a save file.

This is the second-session hook. The streak is what brings you back; the cohort is what makes coming back feel like coming back to a place.

### The Yearbook — artifact

[live] Every year you complete writes a permanent yearbook entry. Senior completion writes a fourth entry, generates a sticker diploma image with a subject-themed accessory based on your highest-scoring class, and unlocks Mentor mode — your next character can inherit the previous one's playbook move and quote.

The yearbook is the social object the product produces. Every other AI product produces ephemeral chat. Ruby High produces report cards.

<!-- promo-asset: yearbook-page — mock of a graduated character's yearbook entry: sticker portrait, top essay highlighted, teachers + classmates of the year, completion date -->

---

## 4. The cast

> *Three teachers with ranges. Six classmates with voices. One school.*

<!-- promo-asset: cast-grid — sticker portraits live in assets/teachers/ and assets/students/, faces and full-bodies both shipped -->

### Faculty

| Teacher | Voice | Range |
|---|---|---|
| **Ruby** | warm, quick, faintly mischievous | onboarding, general knowledge, the meta of the school |
| **Sally Science** | sharp graduate-TA energy | physics, chemistry, biology, earth science |
| **Professor Edward** | mid-century literary, dry | postwar literature, literary theory |

### Classmates

| Classmate | Vibe |
|---|---|
| **Lyra** | anxious overachiever |
| **Sami** | dry, sarcastic, deeply chill |
| **Ravi** | loud, drops obscure facts |
| **Indra** | quiet sniper, drops one perfect line |
| **Mika** | bright, supportive, jock energy |
| **Noor** | deadpan one-liner master |

Each classmate has stable stats, a real voice prompt, and a seat in the room beside you. Every NPC writes their own essay on every essay day, in their own register, without seeing the answer key.

---

## 5. Why no other AI product does this

> *Voice, judgment, cadence, and a keepable grade — the four ingredients that nobody else stacks.*

| Product class | Voice | Judgment that matters | Daily cadence | A grade you can keep |
|---|:---:|:---:|:---:|:---:|
| Tutoring chatbots (ChatGPT, Khan-style) | weak | yes | no | no |
| AI roleplay (AI Dungeon, c.ai) | strong | no | no | no |
| Daily quizzes (Wordle, NYT) | none | yes | yes | streak only |
| **Ruby High** | **strong** | **yes** | **yes** | **yes** |

ChatGPT will give you feedback. It will not give you Edward's feedback. The taste is the moat.

---

## 6. Mechanics

> *A light Powered-by-the-Apocalypse layer under the daily quiz. The mechanics are the connective tissue that makes a Daily feel like progression instead of a worksheet.*

The mechanics layer is released **CC BY 4.0**. It draws on Apocalypse World (Vincent Baker), Dungeon World (Sage LaTorra & Adam Koebel), and is distantly inspired by Monsterhearts 2 (Avery Alder).

### 6.1 The school

[live] Four rooms. Three classrooms (Homeroom / Science / Library) and the Teachers' Lounge. Rooms are fixed across years.

[live] Four years — Freshman, Sophomore, Junior, Senior. Players start at Freshman; Senior completion graduates them.

### 6.2 The character sheet

[live] Each character has:

- **Identity** — a name, a playbook, a sticker portrait, a personality blurb, an arc-answer to the playbook's hook question, and a flavor quote.
- **Stats** — HEAD (recall), HEART (empathy), HUSTLE (speed), HONOR (integrity). Range −1 to +3. Each playbook starts with one +2, one +1, one 0, one −1.
- **State** — XP, conditions, strings, current Daily streak, last-Daily-played date.
- **Yearbook** — completed years archived. Sealed at graduation.

[live] Character creation is **LLM-rolled**. The system picks a playbook at random, assigns the +2/+1/0/−1 distribution, and writes the name, personality, arc-answer, and flavor quote in voice. The player accepts or re-rolls. There is no build screen.

### 6.3 The six playbooks

[live] Each playbook is a starting template — stat array, hook question, starting move, accent color.

| Playbook | Stats | Hook | Move |
|---|---|---|---|
| **Overachiever** | HEAD +2, HONOR +1, HEART 0, HUSTLE −1 | *Why is Cs not enough?* | Margins are sacred — once per year, retake one missed question |
| **Slacker** | HUSTLE +2, HEART +1, HEAD 0, HONOR −1 | *Who do you not want to disappoint?* | Wing it — when you'd fail a HEAD roll, swap it for HUSTLE |
| **Heart** | HEART +2, HONOR +1, HUSTLE 0, HEAD −1 | *Whose orbit are you stuck in?* | Pep talk — spend a String to give a classmate advantage |
| **Outsider** | HONOR +2, HEAD +1, HEART 0, HUSTLE −1 | *What did you leave behind?* | Outside eyes — see one explanation before answering |
| **Class Clown** | HEART +2, HUSTLE +1, HONOR 0, HEAD −1 | *What can't you say without a joke?* | Crack the room — roll HEART instead of HEAD on a miss |
| **Lifer** | HEAD +1, HEART +1, HUSTLE +1, HONOR −1 | *What's the best gossip you've picked up about this place?* | Old gossip — start with 1 String on each faculty member |

[partial] The playbook moves render on the character card and are passed in to the teacher's context as flavor. None of the six change round resolution today — that's the next layer of mechanical wiring (see §6.9).

<!-- promo-asset: playbook-cards — six trading-card-style sticker portraits, one per playbook, with stat array + hook + move on each -->

### 6.4 The dice — bonus only

[live] When a question resolves, the server rolls 2d6 + your relevant stat:

| Total | Outcome | Effect |
|---|---|---|
| 10+ | strong hit | correct → +2 XP |
| 7–9 | mixed | correct → +1 XP, wrong → no penalty |
| 6− | miss | correct → +1 XP, wrong → no penalty |

The dice can only ever upgrade the outcome. They never punish. A wrong answer is its own consequence; piling on hurts retention more than it adds depth.

[live] **Cheat-proof by construction.** The student-facing LLM never sees the question's correct answer. NPC accuracy is dice + their stat block — they roll before the question is shown to them. Cheating-by-prompt-injection is mathematically impossible.

[live] **Advantage roll.** Once per multiple-choice round the player can tap "Roll for advantage" to cross wrong choices off the board: hit eliminates two, mixed eliminates one, miss eliminates none. The roll is consumed regardless of outcome.

<!-- promo-asset: dice-resolve — animated mock of the chalkboard at resolution: 2d6 + HEAD ticker, NPCs racing in the room, XP +N popping out -->

### 6.5 The Daily — gates

[live] To advance out of a year, both gates must hold on the same Daily:

| Year | Streak | Cumulative XP |
|---|:---:|:---:|
| Freshman | 1 in a row | 5 |
| Sophomore | 2 in a row | 15 |
| Junior | 3 in a row | 30 |
| Senior | 4 in a row → graduate | 50 |

Streaks reset on miss. XP accumulates across the whole run. The streak alone is not enough — XP confirms the player has been engaging. The XP alone is not enough — the streak confirms they can perform.

[live] **Faculty rotation.** Mon → Sally Science · Tue → Professor Edward · Wed → Ruby · Thu → Sally Science · Fri → Professor Edward. Saturday and Sunday: school closed, streak holds.

[live] **Bell.** 17:00 UTC. Before the bell, "today" is yesterday's Daily.

### 6.6 Opinion mode — the moat

[live] The headline mechanic. Multiple choice is the on-ramp. The teacher poses an open question; the player writes 2–3 sentences; two AI classmates write theirs; the teacher grades all three in voice with a score (0–10), a one-line comment, and a single named "best response." Pass = score ≥ 7.

Opinion mode is the artifact other AI products do not produce. ChatGPT will give you feedback. It will not give you Edward's feedback.

### 6.7 The Cohort

[live] Six NPCs, each running an independent four-year arc. On every Daily, every still-in-school NPC rolls 2d6 + HEAD against today's correct answer. Pass ticks their streak; miss resets it. They graduate on Senior streak. They can outpace the player or fall behind.

NPCs gate on streak alone — no XP gate. They feel hungrier than the player, which is what makes the rivalry tense.

<!-- promo-asset: cohort-rail — vertical rail of the six classmates with grade pips and streak chips, one or two ahead of the player, one or two behind -->

### 6.8 Mentor mode

[live] When a graduated character is cleared, the system stashes a mentor offer — the character's name, their playbook, and the playbook's starting move. The next character can accept the offer at creation; if they do, the previous character's move name and description are stamped onto the new sheet under `inheritedFrom` and rendered on the character card.

[partial] The inherited move is cosmetic + lore today. Future PRs can wire it as a real second move on the new character.

### 6.9 Conditions, Strings, room moves

[aspirational] The schema declares `conditions: string[]`, `strings: Record<string, number>`, and per-playbook starting moves. None of these change gameplay yet. The intent:

- **Conditions** (Tired / Anxious / Hurt / Lonely) — small stat debuffs cleared by specific in-fiction acts. Currently never written.
- **Strings** — relational currency, earned by interaction, spent for hints / skips / classmate advantage / a piece of gossip. Currently never written.
- **Room moves** — once-per-period playbook moves wired into the round resolution. Currently flavor only.

These are real future work, not a pivot — the schema is shaped for them and the docs name what they will be. They are deliberately not on the next-up list because the Daily-as-arc loop is more load-bearing.

---

## 7. What's built · what's next

> *Most of what the original design called "Phase 5+" is already in. The work that's actually next is smaller and sharper than the old roadmap.*

<!-- promo-asset: status-grid — three-column "Shipped / Next / Aspirational" grid where each row is a chip with a tag color matching the [live]/[partial]/[aspirational] semantics from §6 -->

### Shipped

- [live] OpenRouter PKCE login. Each user pays for their own LLM tokens.
- [live] LLM-rolled character creation with sticker portrait generation.
- [live] Six playbooks, four stats, four rooms, three teachers, six classmates.
- [live] Multiple choice with bonus-only 2d6 + stat dice + once-per-round advantage roll.
- [live] Opinion mode with full LLM-graded essays.
- [live] The Daily — deterministic-by-date question, faculty rotation, school-bell cutoff, weekday-only.
- [live] Streak + XP gates per year. Auto-advance on threshold. Senior completion graduates.
- [live] Yearbook write per grade, sealed at graduation.
- [live] Sticker diploma image generation at Senior completion, with subject-themed accessory.
- [live] Mentor mode — a graduated character offers their playbook move to the next character.
- [live] The Cohort — six NPCs running parallel arcs, ticking on every Daily.
- [live] Per-session phase machine (`intro → in-room → asking → revealed → lounge`).
- [live] Two persistence backends (JSON file for local dev, DynamoDB for production).
- [live] Production deploy via ECR → AWS App Runner. Stateless container, host-agnostic.

### Next

1. **Event log + retention dashboard.** The product cannot be tuned without measurement. `sign_in`, `character_created`, `question_posed`, `answer_picked`, `essay_submitted`, `essay_graded`, `grade_completed`, `session_end`. Three core metrics: D1 retention, questions per session, grade-completion rate.
2. **Yearbook share-card.** A `/yearbook/:characterId/:grade` route that renders a shareable static page + PNG export. The yearbook exists; it is not yet visible to anyone outside the player's session.
3. **Question pack scaling.** Three packs of 15 questions is roughly two weeks of Daily exhaust. Path: hand-authored core → LLM-authored expansion packs vetted via PR → in-voice runtime authoring with bank fallback. Target ≥ 200 vetted questions per teacher.
4. **Per-essay grade history.** A "Report Card" tab — every essay grade, filterable by teacher, with an average and a "Lyra has out-essayed you 3 of the last 5 Tuesdays" line.

### Aspirational

- Conditions, Strings, and the rest of the playbook moves wired into real round mechanics.
- Faculty expansion — history, logic, music theory, philosophy, art history. Goal: a five-day week with a different voice each day.
- A weekly invitational essay tournament (Faculty Cup). Bracket, ELO, spectator viewer.
- Multiplayer co-op — same Daily, two students, one shared lounge.

---

## 8. The economics

> *The product is structurally $0 / user / month to operate. This is rare and deliberate.*

[live] LLM costs are paid by the user via their own OpenRouter API key. Per-user, the inference is free to us. The PKCE flow is the entire payment mechanism — no key ever touches our servers.

State persistence runs on DynamoDB on-demand. ~5–20 KB per session. A single App Runner container handles hundreds of concurrent users before any rearchitecture.

This unlocks two product moves:

1. **No paywall.** The product can be free without losing money on it.
2. **Future revenue is upside, not survival.** Optional layers — a yearbook print store, guest-faculty character packs, a tournament tier — become real products rather than rent-extraction on a captive audience.

Anything that breaks the user-paid-inference model needs an extremely good reason.

---

## 9. Open questions

> *Where the design hasn't settled, and where we want collaborator input.*

- **NPC essay regeneration.** Are NPC essay responses the same every Tuesday or generated fresh per Daily? Currently fresh per Daily, which costs the user's own tokens and produces novelty. Acceptable but worth measuring.
- **Faculty voice at scale.** The system prompt is the contract. We will need an evaluation harness for "is this question in voice?" before community-authored faculty.
- **Public yearbook.** Are yearbook pages opt-in public, opt-out, or always private? Lean: every artifact's privacy is set by the player, default private.
- **Lounge as a Daily product.** A "Tuesday Lounge" thread between the three teachers, separately graded as conversation, screenshot-able. Tempting; deferred until the core Daily lands harder.
- **Conditions UX.** When Conditions land, does the player invoke them ("I'm Tired, this should be HEART not HEAD") or are they auto-applied? Lean: player-invoked, narrative justification required.

---

## 10. Try it · read the source · wire it in

> *Three doors into the project.*

### Try it

```bash
npm install
npm run build
npm run dev:server
```

Then open http://127.0.0.1:3000/api/apps/ruby-high/viewer. You will be asked to sign in with OpenRouter — a free PKCE flow, your own key, no card.

### Read the source

The repository is at [github.com/cenetex/app-ruby-high](https://github.com/cenetex/app-ruby-high). Start with `src/services/ruby-high-service.ts` for the game loop, `src/services/chat-service.ts` for the LLM bridge, `src/types.ts` for the schema. ~6,000 lines of TypeScript, ~2,250 lines of tests.

### Wire it into a character

```ts
import rubyHighPlugin from "@cenetex/app-ruby-high";

export const character = {
  name: "Ruby",
  plugins: [rubyHighPlugin /* , ...others */],
};
```

The plugin is also a standalone Node service. The Docker container is host-agnostic — it needs `PORT`, `HOST`, `RUBY_HIGH_PUBLIC_BASE` (must be HTTPS in production for OpenRouter PKCE), and a writable state backend.

---

## 11. Architecture (engineer's appendix)

> *One container, one DynamoDB table, four services, no queue.*

### Services

| Service | File | Job |
|---|---|---|
| `RubyHighService` | `src/services/ruby-high-service.ts` | Per-session game state, the phase machine, the dice, the Daily, the cohort. |
| `FacultyService` | `src/services/faculty-service.ts` | Loads the question packs at boot. Picks for free-play and for the Daily. |
| `ChatService` | `src/services/chat-service.ts` | OpenRouter SSE per-teacher. Owns chat history, dispatches tools into the game state. |
| `AuthService` | `src/services/auth-service.ts` | OpenRouter PKCE OAuth. Opaque cookie sessions. Keys live in process memory only. |
| `StateStore` | `src/services/state-store.ts` + `dynamo-state-store.ts` | Two backends: atomic JSON-file for local dev, DynamoDB on-demand for production. |

### Key design choices

**The teacher is the chatbot, the chatbot drives the board.** Each teacher is a separate OpenRouter-streamed chat with their own system prompt and their own model. They drive the chalkboard via tool calls (`pick_from_bank`, `pose_question`, `pose_opinion`, `clear_board`, `handoff_faculty`). When the player picks an answer in the viewer, the teacher gets a system-event note and reacts in character.

**The state machine is the spine.** Five phases (`intro`, `in-room`, `asking`, `revealed`, `lounge`) and seven actions (`select-grade`, `enter-room`, `enter-lounge`, `pose-question`, `resolve-round`, `clear-board`, `reset`). Every mutator routes through one transition function. A `phaseToken` bumps on every transition so the viewer can dedupe one-shot effects without races.

**Persistence is per-session by design.** One row per session — keyed by either `rh:user:<openrouter-token>` for signed-in users or `rh:anonymous` for the preview bucket. DynamoDB TTL auto-expires idle sessions. The JSON-file backend is a single atomic-write file at `~/.ruby-high/state.json`.

**Cheat-proofing is structural.** The student-side LLM never sees the answer key. The server rolls the dice, picks the question, and stores the correct answer. NPC accuracy comes from `2d6 + their HEAD stat` rolled before the question is revealed to them. Prompt-injection cannot win because the prompt does not have the information.

---

## 12. License

[MIT](./LICENSE) for the code. The mechanics layer (§6) is **CC BY 4.0** and inspired by the Apocalypse World / Dungeon World lineage.

<!-- promo-asset: footer-band — sticker portraits of the three teachers in a row, color blocks behind -->
