# Ruby High

> A school where the teachers grade you in their own voice. Clear daily classes, bank grades, and keep the yearbook.

<!-- promo-asset: hero-classroom — wide screenshot of the viewer with Ruby's chalkboard, the room rail, and the character card visible -->

This is the strategic and mechanics doc for Ruby High. It is the source of truth for the product. The marketing site is a stylesheet on top.

The doc is in three parts:

- **Part 1 — Current State.** What is shipped and running today, verified against source.
- **Part 2 — Future State.** Where the product goes if every aspirational item lands.
- **Part 3 — Gaps.** Doc-vs-code drift, missing features, partial implementations, open questions, and a prioritized next-steps plan.

For the run-it-yourself and Fly deploy runbook, see [`README.md`](./README.md). For the legacy AWS fallback runbook, see [`infra/README.md`](./infra/README.md).

---

# Part 1 — Current State

> *Everything in Part 1 is shipped, tested, and running in production. Each claim is grounded in current source.*

## 1.1 The bet

> *Most AI products fail in the same place: the second session.*

The first session is dazzling. The user closes the tab. They never come back.

Ruby High is built around the bet that the failure is structural, not creative. Other AI products optimize for one of: a voice you remember, a grade that means something, a daily cadence, an artifact you can keep. The category leaders rarely stack two. None stacks four.

Ruby High stacks all four. A 2–3 sentence essay graded by Professor Edward on a Tuesday, delivered alongside three classmates' essays, archived to a yearbook page you can show a friend — that is something no other AI product produces. The combination is the product. Each ingredient on its own is commodity.

**It's free.** You sign in with your own OpenRouter key — no card, no subscription. Your inference bill is yours, not ours. The key never touches our server: it lives in your browser's localStorage and rides along on each request as a header.

## 1.2 What a day looks like

> *The school bell rings at 17:00 UTC. One teacher is on the floor. They run today's graded class.*

You open the app on Tuesday afternoon. Professor Edward is at the chalkboard — Tuesdays are his class day. He posts a short graded class. On an opinion day, that means a passage to discuss and three sentences asked of you. You're a Junior this year, so Sami and Mika are your two classmates in the literature room. You write your response. They write theirs. Edward reads all three and grades them in his voice — a 0–10 score, one sentence of comment, a single named "best response."

Your streak ticks. Indra graduated last week while you were still here — you can see her name has moved up the cohort rail. The grade lives on your report card under Edward's name.

Tomorrow is Wednesday. Wednesday's class belongs to Ruby. The bell rings at the same time.

<!-- promo-asset: question-walkthrough-clip — short looping mp4 of a real round resolving end to end -->

## 1.3 The three pillars

> *The Daily Class is the cadence. The Cohort is the company. The Yearbook is the artifact. Each pillar is load-bearing.*

### The Daily Class — cadence

Every day at 17:00 UTC the school refreshes a once-per-day graded class for the scheduled faculty. A daily class is three questions. Passing the class at C or better can tick the school-day streak; clearing enough streak days and enough class credits advances the year. Graduate after Senior.

The daily cadence is not a side mode. It is the arc's clock. Scarcity lives in the once-per-day graded class, while practice questions stay playable whenever the student shows up.

### The Cohort — company

Six AI classmates run their own four-year arcs alongside you. They roll their own daily-class progress on their own dice. Indra might graduate while you are still a Sophomore. Mika might fall behind. Coming back to the app means coming back to *people*, not to a save file.

This is the second-session hook. The streak is what brings you back; the cohort is what makes coming back feel like coming back to a place.

### The Yearbook — artifact

Every year you complete writes a permanent yearbook entry. Senior completion writes a fourth entry, generates a sticker diploma image with a subject-themed accessory based on your highest-scoring class, and unlocks Mentor mode — your next character can inherit the previous one's playbook move and quote.

The yearbook is the social object the product produces. Every other AI product produces ephemeral chat. Ruby High produces report cards.

<!-- promo-asset: yearbook-page — mock of a graduated character's yearbook entry: sticker portrait, top essay highlighted, teachers + classmates of the year, completion date -->

## 1.4 The cast

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

## 1.5 Why no other AI product does this

> *Voice, judgment, cadence, and a keepable grade — the four ingredients that nobody else stacks.*

| Product class | Voice | Judgment that matters | Daily cadence | A grade you can keep |
|---|:---:|:---:|:---:|:---:|
| Tutoring chatbots (ChatGPT, Khan-style) | weak | yes | no | no |
| AI roleplay (AI Dungeon, c.ai) | strong | no | no | no |
| Daily quizzes (Wordle, NYT) | none | yes | yes | streak only |
| **Ruby High** | **strong** | **yes** | **yes** | **yes** |

ChatGPT will give you feedback. It will not give you Edward's feedback. The taste is the moat.

## 1.6 Mechanics — shipped today

> *A light Powered-by-the-Apocalypse layer over a spaced-repetition core. The mechanics are the connective tissue that makes question play feel like progression instead of a worksheet.*

The mechanics layer is released **CC BY 4.0**. It draws on Apocalypse World (Vincent Baker), Dungeon World (Sage LaTorra & Adam Koebel), and is distantly inspired by Monsterhearts 2 (Avery Alder). The card-mastery layer is conventional spaced-repetition, in the Anki / SM-2 lineage.

### 1.6.1 The school

Four rooms. Three classrooms (Homeroom / Science / Library) and the Teachers' Lounge. Rooms are fixed across years.

Four years — Freshman, Sophomore, Junior, Senior. Players start at Freshman; Senior completion graduates them.

### 1.6.2 The character sheet

Each character has:

- **Identity** — a name, a playbook, a sticker portrait, a personality blurb, an arc-answer to the playbook's hook question, and a flavor quote.
- **Stats** — HEAD (recall), HEART (empathy), HUSTLE (speed), HONOR (integrity). Range −1 to +3. Each playbook starts with one +2, one +1, one 0, one −1.
- **State** — current daily-class streak, last class-played date, per-faculty card-mastery memory.
- **Yearbook** — completed years archived. Sealed at graduation.

Character creation is **LLM-rolled**. The system picks a playbook at random, assigns the +2/+1/0/−1 distribution, and writes the name, personality, arc-answer, and flavor quote in voice. The player accepts or re-rolls. There is no build screen.

### 1.6.3 The six playbooks

Each playbook is a starting template — stat array, hook question, starting move, accent color.

| Playbook | Stats | Hook | Move |
|---|---|---|---|
| **Overachiever** | HEAD +2, HONOR +1, HEART 0, HUSTLE −1 | *Why is Cs not enough?* | Margins are sacred — once per year, retake one missed question |
| **Slacker** | HUSTLE +2, HEART +1, HEAD 0, HONOR −1 | *Who do you not want to disappoint?* | Wing it — when you'd fail a HEAD roll, swap it for HUSTLE |
| **Heart** | HEART +2, HONOR +1, HUSTLE 0, HEAD −1 | *Whose orbit are you stuck in?* | Pep talk — give a classmate advantage |
| **Outsider** | HONOR +2, HEAD +1, HEART 0, HUSTLE −1 | *What did you leave behind?* | Outside eyes — see one explanation before answering |
| **Class Clown** | HEART +2, HUSTLE +1, HONOR 0, HEAD −1 | *What can't you say without a joke?* | Crack the room — roll HEART instead of HEAD on a miss |
| **Lifer** | HEAD +1, HEART +1, HUSTLE +1, HONOR −1 | *What's the best gossip you've picked up about this place?* | Old gossip — start ahead with each faculty member |

Stats, hook, and accent color are wired and active. The playbook moves render on the character card and pass into the teacher's context as flavor; **mechanical wiring of the moves is in Part 3 (Gaps)**.

<!-- promo-asset: playbook-cards — six trading-card-style sticker portraits, one per playbook, with stat array + hook + move on each -->

### 1.6.4 The dice — review quality, no XP

When a question resolves, the server rolls 2d6 + your relevant stat:

| Total | Outcome |
|---|---|
| 10+ | strong hit |
| 7–9 | mixed |
| 6− | miss |

The dice no longer award XP directly. They classify the round outcome (hit / mixed / miss), which feeds the **card review rating** described in §1.6.5. A wrong answer is its own consequence; the dice cannot pile on. Rolls only ever upgrade the outcome, never punish.

**Cheat-proof by construction.** The student-facing LLM never sees the question's correct answer. NPC accuracy is dice + their stat block — they roll before the question is shown to them. Cheating-by-prompt-injection is mathematically impossible.

**Advantage roll.** Once per multiple-choice round the player can tap "Roll for advantage" to cross wrong choices off the board: hit eliminates two, mixed eliminates one, miss eliminates none. The roll is consumed regardless of outcome.

<!-- promo-asset: dice-resolve — animated mock of the chalkboard at resolution: 2d6 + HEAD ticker, NPCs racing in the room, hit/mixed/miss popping out -->

### 1.6.5 Card mastery — the progression core

Every question has per-character mastery memory with one of four phases:

| Phase | Meaning |
|---|---|
| **new** | never seen |
| **learning** | seen but not yet stable |
| **review** | answered correctly two in a row; on a review schedule |
| **mastered** | answered correctly enough times in a row to be retired from the queue |

Each round's hit/mixed/miss outcome rates the card and pushes it through the phases or knocks it back. This memory drives scheduling and practice: shaky cards come back, stable cards move out, and generated/imported teacher packs can land in the same review queue.

Daily class grades are tracked separately from card memory: each completed class records a score and letter grade, and those class records gate year advancement (§1.6.6). Card mastery is the layer that makes "answering a question" feel like banking a card, and "coming back tomorrow" feel like clearing a queue.

### 1.6.6 The year gates

To advance out of a year, two gates must both hold:

| Year | Streak in a row | Daily classes per room |
|---|:---:|:---:|
| Freshman | 1 | 3 C-or-better classes in a row |
| Sophomore | 2 | 3 C-or-better classes in a row |
| Junior | 3 | 3 C-or-better classes in a row |
| Senior | 4 → graduate | 3 C-or-better classes in a row |

Per-room letter grade is only awarded after the room has a three-class C-or-better streak. Before that point, the UI shows course progress such as 0/3 or 2/3 instead of a provisional F. All three teaching rooms — Homeroom (Ruby), Science (Sally), Library (Edward) — must be cleared for the current year. A streak alone is not enough; ducking a room means you do not advance, no matter how many Mondays you've strung together.

### 1.6.7 The Daily Class

Every day at 17:00 UTC the daily-class window opens for the day's faculty. The graded class is three questions. Once that class is complete, regular practice remains open for the rest of the day.

**Faculty rotation.** Mon → Sally Science · Tue → Professor Edward · Wed → Ruby · Thu → Sally Science · Fri → Professor Edward · Sat → Ruby · Sun → Sally Science. The class rotation runs every day; the rotation continues across the weekend.

**Bell.** 17:00 UTC. Before the bell, the day-key still resolves to yesterday's class window.

**Discoverability.** The always-on Next Question flow is the primary surface. There is no separate daily banner; the room itself tells the player whether today's graded class is available, active, complete, or in practice.

### 1.6.8 Opinion mode — the moat

The headline mechanic. Multiple choice is the on-ramp. The teacher poses an open question; the player writes 2–3 sentences; two AI classmates write theirs; the teacher grades all three in voice with a score (0–10), a one-line comment, and a single named "best response." Pass = score ≥ 7.

Opinion mode is the artifact other AI products do not produce. ChatGPT will give you feedback. It will not give you Edward's feedback.

### 1.6.9 The Cohort

Six NPCs, each running an independent four-year arc. On every daily-class streak tick, every still-in-school NPC rolls 2d6 + HEAD against the day's progress check. Pass ticks their streak; miss resets it. They graduate on Senior streak. They can outpace the player or fall behind.

NPCs gate on streak alone — no per-room gate. They feel hungrier than the player, which is what makes the rivalry tense.

The seating chart is keyed by *player* grade and filtered by NPC cohort drift. When Indra graduates ahead, her current-year seat empties; when Mika falls behind, her current-year seat empties too.

<!-- promo-asset: cohort-rail — vertical rail of the six classmates with grade pips and streak chips, one or two ahead of the player, one or two behind -->

### 1.6.10 Mentor mode and graduation rewards

When a graduated character is cleared, the system stashes a mentor offer — the character's name, their playbook, and the playbook's starting move. The next character can accept the offer at creation; if they do, the previous character's move name and description are stamped onto the new sheet under `inheritedFrom` and rendered on the character card.

The inherited move is cosmetic + lore today. **Mechanical wiring is in Part 3 (3.2).**

Senior completion also writes a `GraduationReward` — one of stat / advantage / affinity — applied at character completion alongside the diploma image. The diploma's subject-themed accessory is selected by best per-faculty correctness ratio.

### 1.6.11 Hidden comic pages

`Ruby High: Book One - First Bell` is a cross-character collection. The session owns the collection, so clearing or graduating a character does not wipe found pages.

Main story pages unlock from class performance: Ruby, Sally Science, and Professor Edward each grant one page when the player earns an A in that teacher's class during Freshman year, and one more page for an A during Junior year. Insert pages are tied to classmates: each student grants one fixed insert page the first time their Social Card cell is circled.

## 1.7 Architecture

> *One container, one DynamoDB table, four services + a content-pack registry, no queue.*

### Services and supporting modules

| Component | File | Job |
|---|---|---|
| `RubyHighService` | `src/services/ruby-high-service.ts` | Per-session game state, the phase machine, the dice, daily-class progression, card mastery, the cohort, graduation. |
| `FacultyService` | `src/services/faculty-service.ts` | Resolves faculty + question banks against the composed Ruby High roster, including the weekly Guest Faculty slot. Picks daily-class and practice questions. |
| `ChatService` | `src/services/chat-service.ts` | SSE per-teacher on OpenRouter or the configured local OpenAI-compatible text endpoint. Owns chat history and dispatches supported tools into the game state. |
| `AuthService` | `src/services/auth-service.ts` | OpenRouter PKCE OAuth. Issues opaque cookie sessions; the API key never lives on the server — it's stored in the player's browser localStorage and sent on each request as a header. Maintains a per-user record so a player's character persists across sessions. |
| Content registry | `src/content/registry.ts` (+ `src/content/packs/`) | Active content pack resolver, global and per-session. Serves the built-in `ruby-high-original` plus session-scoped runtime packs. |
| `StateStore` | `src/services/state-store.ts` + `dynamo-state-store.ts` | Two backends: atomic JSON-file for local dev, DynamoDB on-demand for production. Stores both per-session quiz state and per-user identity. |
| Event log | `src/services/logger.ts` | Structured JSON events emitted to stdout. Today's emissions: `bonus.posed`, `character.created`, `player.grade-advanced`, `player.graduation-ready`, `player.graduated`, `pack.activated`, `pack.session-switched`, `question.promoted-to-bank`, `chat.bank-exhausted`, `diploma.first-attempt-failed`, `portrait.first-attempt-failed`. |
| Rate limiter | `src/services/rate-limit.ts` | Token-bucket utility. Wired but optional per route — endpoint coverage is in Gaps (3.2). |

### Key design choices

**The teacher is the chatbot, the chatbot drives the board.** Each teacher is a separate OpenRouter-streamed chat with their own system prompt and their own model. They drive the chalkboard via tool calls (`pick_from_bank`, `pose_question`, `pose_opinion`, `clear_board`, `handoff_faculty`). When the player picks an answer in the viewer, the teacher gets a system-event note and reacts in character.

**The state machine is the spine.** Five phases (`intro`, `in-room`, `asking`, `revealed`, `lounge`) and seven transition actions (`select-grade`, `enter-room`, `enter-lounge`, `pose-question`, `resolve-round`, `clear-board`, `reset`). Every mutator routes through one transition function. A `phaseToken` bumps on every transition so the viewer can dedupe one-shot effects without races.

**Persistence is per-session, with a per-user index.** One row per session — keyed by either `rh:user:<openrouter-token>` for signed-in users or `rh:anonymous` for the preview bucket. A separate `AuthUserRecord` keys sessions to userId so a returning player rejoins their own character. DynamoDB TTL auto-expires idle sessions. The JSON-file backend is a single atomic-write file at `~/.ruby-high/state.json`.

**Cheat-proofing is structural.** The student-side LLM never sees the answer key. The server rolls the dice, picks the question, and stores the correct answer. NPC accuracy comes from `2d6 + their HEAD stat` rolled before the question is revealed to them. Prompt-injection cannot win because the prompt does not have the information.

**Portraits live in S3.** Generated character portraits and diploma images are uploaded to an S3 bucket (`RUBY_HIGH_PORTRAITS_BUCKET`) so they survive container restarts and don't bloat the state row.

## 1.8 Economics

> *The product is structurally $0 / user / month to operate. This is rare and deliberate.*

LLM costs are paid by the user via their own OpenRouter API key. Per-user, the inference is free to us. The PKCE flow is the entire payment mechanism — no key ever touches our servers.

State persistence runs on DynamoDB on-demand. ~5–20 KB per session. Portraits and diplomas live in S3. A single Fly machine handles hundreds of concurrent users before any rearchitecture.

This unlocks two product moves:

1. **No paywall.** The product can be free without losing money on it.
2. **Future revenue is upside, not survival.** Optional layers — a yearbook print store, guest-faculty character packs, a tournament tier — become real products rather than rent-extraction on a captive audience.

Anything that breaks the user-paid-inference model needs an extremely good reason.

---

# Part 2 — Future State

> *Where Ruby High goes if every aspirational item lands. Nothing in Part 2 is built.*

## 2.1 Playbook moves wired into round resolution

All six playbook moves render on the character card today as flavor passed to the teacher's context. The future product wires them into round resolution: Overachiever's "retake one missed question per year," Slacker's "swap HEAD → HUSTLE on a fail," Heart's "give a classmate advantage," and so on. This is what turns the four stats into six distinct characters to play.

## 2.2 Faculty expansion — a five-day week

Three teachers shipped (Ruby, Sally Science, Professor Edward) cover a 7-day rotation but only three voices. Future state: history, logic, music theory, philosophy, and art history teachers, each with a stable voice and question bank. Goal — a five-day school week with a different voice each day, weekends off.

This is gated on the faculty-voice evaluation harness (§3.1). Without an automated "is this in voice?" check, voice drift becomes the bottleneck the moment a fourth teacher ships.

## 2.3 The Faculty Cup — weekly invitational essay tournament

A bracket. ELO. A spectator viewer. Top essayists from the week's daily classes invited; the teachers grade head-to-head matchups. The yearbook records cup wins as a separate decoration.

The weekly tournament is the social object that scales beyond a single player's yearbook page — a leaderboard with taste, not points.

## 2.4 Multiplayer co-op

Same daily class window, two students, one shared lounge. The cohort already runs as parallel arcs; co-op is the version where the parallel arc on the seat next to you is another human.

## 2.5 Community-authored faculty packs

The pack registry and Guest Faculty slot are wired for this. Ruby High remains the permanent base school; public creator packs rotate into a weekly guest course automatically, and players can override the weekly pick from search. A teacher pack is a name, a voice prompt, a sticker portrait, a question bank or source-card set, and a model preference.

This depends on §2.2's evaluation harness — voice evaluation is a public-good guard, not a private-product nicety, the moment outside packs are loadable.

## 2.6 Public yearbook as a default social object

The first share surface exists: `GET /api/apps/ruby-high/yearbook/:shareId/:grade` returns a static card page, `?format=json` returns the immutable card data, and `?format=svg` returns the social image used by OG tags. The viewer exposes Open/Copy controls on sealed year cards. Senior diplomas are still designed to be screenshotted; the next product step is explicit privacy controls.

The privacy default is still an open question (§3.3). Until that decision is made, share-card IDs are unguessable hashes of session/character identity and are not listed publicly.

## 2.7 The Lounge as a cadence product

A "Tuesday Lounge" thread between the three teachers, separately graded as conversation, screenshot-able. The lounge phase exists in the state machine; today it is a transition state, not a product. The future version is a thread you can read.

---

# Part 3 — Gaps

> *Three buckets: doc-vs-code drift, missing/partial features, and open design questions — followed by a prioritized next-steps plan.*

## 3.1 Doc-vs-code drift

> *Where the previous DESIGN.md drifted from current source. Worth calling out so future readers don't trust stale claims.*

| Drift | Doc said | Code says | Resolution |
|---|---|---|---|
| **XP / rarity gates** | Year advancement requires per-class XP minimums and rarity-rolled Legendary targets. | Rarity and XP helpers are compatibility shims for older persisted rounds. New progression is daily classes: completed class count + average letter grade + streak. | This doc reflects the daily-class gate. The compatibility helpers can be deleted once old persisted states no longer need them. |
| **Conditions / Strings** | Schema declares both; "currently never written"; aspirational. | Both fields **removed from the schema** in PR #63. | Removed from this doc. They are not future work in the current design. |
| **Event log canonical list** | The retention dashboard depends on `sign_in`, `character_created`, `question_posed`, `answer_picked`, `essay_submitted`, `essay_graded`, `grade_completed`, `session_end`. | Now emits all eight (in dot-style: `auth.signed-in`, `character.created`, `question.posed`, `answer.picked`, `essay.submitted`, `essay.graded`, `player.grade-advanced` ≈ `grade_completed`, `session.ended`), plus `bonus.posed`, `pack.*`, and the failure events. Existing dot-style names retained — renaming for cosmetic underscore-style consistency would break any downstream sink. Captured in `event-log.test.ts` so a quiet rename is impossible. |
| **AWS App Runner production** | Cited as the production target. | Production is on **Fly.io**. App Runner workflow is retained as a manual fallback only. | This doc and main's README now say Fly. |
| **Report Card tab** | Claimed per-essay grade history existed only in state and no UI surfaced it. | The viewer has a Report Card card over `essay_reports`, including count, average, top score, recent entries, comments, and the out-essayed rivalry line. | Treat the report card as shipped; future work is refinement, not first implementation. |

## 3.2 Missing or partial

### Missing — listed but not built

| Gap | What it is | Size |
|---|---|---|
| **Curated content beyond ruby-high-original** | The built-in pack ships with 15 questions per teacher. No curated first-party SAT/MCAT/AP/community packs have been ingested and reviewed yet. | Medium (per pack: 1 day to ingest + curate). |
| **Legacy rarity/XP compatibility removal** | `Rarity`, `XP_FOR_RARITY`, `xpForRarity`, `rollRarity`, and legacy round fields can be deleted once older persisted states no longer need to hydrate through them. | Trivial once state compatibility is no longer required. |

### Partial — shipped but incomplete

| Gap | What's there | What's missing |
|---|---|---|
| **Retention dashboard** | `/api/apps/ruby-high/admin/metrics` is token-gated and returns auth, Ruby High, and log-counter snapshots. `logMetricsSnapshot()` gives an in-process event/error counter. | A durable queryable sink, saved queries, and trend storage. The JSON route is enough for tuning today but not enough for historical analysis. |
| **Yearbook share cards** | Public static HTML, JSON, SVG, OG tags, session telemetry share URLs, and viewer Open/Copy controls are wired. | Privacy policy/default and a real PNG renderer for platforms that do not honor SVG OG images. |
| **Faculty-voice evaluation harness** | `npm run eval:voice` runs a lightweight reference-set smoke harness and optionally calls an OpenRouter judge when a key is present. | A larger hand-curated held-out set, thresholds that fail CI, and generated sample capture from real teacher/course flows. |
| **Mentor mode mechanical effect** | `inheritedFrom` field captured on the new character; rendered on card. | No code reads `inheritedFrom` during round resolution. The inherited move is lore, not mechanics. |
| **Playbook moves** | All six moves named, described, rendered on character card, and passed to teacher context as flavor. | None of the six change round resolution. |
| **Rate-limiter endpoint coverage** | Buckets cover LLM-backed chat, portrait/diploma generation, `/command` mutations, viewer metric events, and remote course-material URL imports. The full per-endpoint policy lives in the JSDoc at the top of `src/services/rate-limit.ts`. | Read-only GETs and a few cheap POSTs (`/control`, `/auth/logout`, `/packs/active`) are intentionally ungated. `GET /auth/callback` triggers an outbound OpenRouter token-exchange and is the next candidate to gate if we ever see hostile callback floods. |

## 3.3 Open questions

> *Where the design hasn't settled, and where we want collaborator input.*

- **NPC essay regeneration.** Are NPC essay responses deterministic for a given prompt or generated fresh per round? Currently fresh per round, which costs the user's own tokens and produces novelty. Acceptable but worth measuring.
- **Faculty voice at scale.** The system prompt is the contract. The eval harness in §3.2 will need a rubric — exact-match-style voice tests, or LLM-judge with criteria? Lean: LLM-judge + a small held-out set of human-graded references.
- **Public yearbook default.** Are yearbook pages opt-in public, opt-out, or always private? Lean: every artifact's privacy is set by the player, default private.
- **Lounge as a cadence product.** A "Tuesday Lounge" thread between the three teachers, separately graded as conversation, screenshot-able. Tempting; deferred until the core question loop lands harder.

## 3.4 Prioritized next steps

> *Sequencing across the missing and partial buckets. Each step is sized to a small PR.*

**Stabilization rule.** No new teachers, tournaments, multiplayer, public pack marketplace, or additional playbook-move surface until the daily-class loop, first-session path, yearbook artifact, and basic metrics feel seamless.

### P0 — unblocks tuning (**event names done; dashboard layer next**)

1. **Persist the retention dashboard.** All eight canonical events emit and the token-gated `/admin/metrics` JSON route exists. Next: ship logs/metrics to a queryable sink (Fly log drain to ClickHouse, Postgres, or SQLite-on-Litestream is enough), add saved queries for D1 retention, questions/session, and grade-completion rate, then snapshot trends over time.

### P1 — closes the two real shipped-but-unfinished social gaps

2. **Finish yearbook sharing policy.** Decide the privacy default and configure a PNG renderer for platforms that need raster OG images. The backend route, SVG card, and viewer Open/Copy controls already exist.
3. **Tighten the Report Card.** The card exists; next refinement is per-teacher filtering and deeper comparison copy once enough essay history exists.

### P2 — small mechanical wins

4. **Wire one mentor move mechanically.** Pick the cheapest end-to-end move — likely Overachiever's "retake one missed question per year" or Slacker's "swap HEAD → HUSTLE on a fail." Concrete, testable, finishes the §1.6.10 partial.

### P3 — content & evaluation (the moat)

5. **Expand the faculty-voice eval harness.** The script exists. Next: 20–30 hand-graded reference Q/A pairs per teacher, real generated samples from course packs, and a CI threshold.

### Defer

- Remaining playbook moves wired in — handle one (P2 step 4) before the rest.
- Faculty expansion, multiplayer co-op, Faculty Cup tournament, and public community packs — premature until the stabilization rule above is satisfied.
- Public yearbook default policy — answer falls out of P1 step 2 now that share-cards exist; design decision then, not now.

### Sequencing call

Do **P0 → P1.2 → P1.3 → P2.4** in order. Four small PRs that together close the shipped-but-unfinished social gaps, give us measurement, and produce the social artifact the product was designed around.

---

## License

[MIT](./LICENSE) for the code. The mechanics layer (Part 1, §1.6) is **CC BY 4.0** and inspired by the Apocalypse World / Dungeon World lineage. The card-mastery layer is conventional spaced-repetition, in the Anki / SM-2 lineage.

<!-- promo-asset: footer-band — sticker portraits of the three teachers in a row, color blocks behind -->
