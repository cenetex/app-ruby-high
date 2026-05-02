# Ruby High — Design v1: The Daily

> Ruby High is the first AI product where a character with taste grades you on a schedule, and the grade is something you can keep.

This document is the **strategic** design doc. For the mechanics layer (dice, stats, playbooks, conditions, strings) see [`RPG-DESIGN.md`](./RPG-DESIGN.md). For the public pitch and architecture overview see [`README.md`](./README.md).

It supersedes the previous tournament-economy framing, which is preserved as Appendix A. The tournament is a real future product. It is not the *first* product.

---

## 1. The thesis, in full

Most AI demos fail in the same place: **the second session.** The first session is dazzling. The user closes the tab. They never come back.

The reason is structural, not creative. AI products typically optimize for *one* of:

- **Voice** — a character with personality (AI Dungeon, character.ai).
- **Judgment that matters** — a real grade, a real score (Khan Academy, Duolingo).
- **Daily cadence** — appointment viewing (Wordle, NYT Spelling Bee).
- **A keepable artifact** — something you walk away with (a chess.com rating, an Anki deck).

The category-leading products in each lane are rarely the same product. AI Dungeon has voice but no grade. Khan has grades but no voice. Wordle has cadence but no character. ChatGPT has all three in theory and none of them in practice — the "voice" is interchangeable, the "grade" is sycophantic, the cadence is "whenever you remember it exists."

**Ruby High is the four-pillar product.** It is built around the bet that all four ingredients combined are not additive — they are multiplicative. A graded essay is a commodity. A graded essay from **Edward** is a commodity in 2026. A graded essay from Edward, **delivered Wednesday at 5pm with three classmates' essays beside it, archived in a yearbook page you can show a friend** — that has no equivalent.

That is the product.

---

## 2. The three pillars

### Pillar 1 — The Daily

**Every weekday at the same hour, the school is in session.**

Each of the three teachers posts one question:

| Day | Headline teacher | Format |
|---|---|---|
| Monday | Sally Science | one MC question + one short-answer "lab notebook" prompt |
| Tuesday | Professor Edward | one MC question + one essay-of-the-day |
| Wednesday | Ruby | one MC question + one school-lore opinion prompt |
| Thursday | Sally Science | rotation continues |
| Friday | Professor Edward | end-of-week graded essay |

The user can answer all three teachers in any order. The whole day's quiz takes 5–10 minutes if you skip the chat, 30 if you stay and talk. Either is a good session.

**Why daily and not on-demand:** scarcity makes the grade matter. If Edward will grade an essay any time you ask, his attention is cheap. If Edward grades one essay on Tuesday and never grades that prompt again, **your Tuesday essay is the Tuesday essay**. The cadence is the credibility.

**Why three teachers and not one:** the catalog. A daily product needs enough variety that it doesn't burn out in two weeks. Three teachers × five weekdays × four years of difficulty = sixty distinct content slots before any repeat. With faculty expansion (see §6), this scales.

**Streaks**: standard Wordle-style — N consecutive school days = a visible streak. Miss a day, lose it. This is the lowest-creativity element of The Daily and it works because every other piece around it is non-generic.

### Pillar 2 — Qualitative grading

**The headline product is the essay, not the multiple choice.**

Multiple choice is the on-ramp. It is fast, fair, dice-resolved, and serves three real purposes: (1) it is the format the trivia bank already supports, (2) it gives users a "win" in 30 seconds for the activation moment, (3) it is the unit the future tournament product trades in.

But MC is commodity. Wolfram Alpha grades MC. The tutorial mode of every educational app grades MC.

**Opinion mode is the moat.** The user writes 2–3 sentences. The two NPC classmates in the room write theirs. The teacher reads all four responses and grades each one in their own voice with a 0–10 score, a one-sentence comment, and a single named "best response." The system already implements this end to end (`chat-routes.ts:127-203`).

What this gives you that no other AI product gives you:

- **A real evaluation by a character whose taste is known to the user.** Edward likes spare prose and detests cliché. Sally wants the math, not the metaphor. Ruby rewards genre-savvy. After three or four sessions the user knows what each teacher rewards — and the grade now means something specific.
- **Comparative grading.** Your essay sits next to two classmates' essays. The teacher names a winner. This is the fundamental social loop: *I beat Lyra on Tuesday's essay.*
- **An artifact.** The grade, the comment, the chosen "best," and the prompt are all preserved.

The single most important investment in the next quarter is **making opinion mode the centerpiece of every session, not an occasional break from MC.** Every Daily should include at least one opinion-mode question. The Tuesday and Friday "Essay of the Day" should be opinion-only.

### Pillar 3 — The Yearbook

**Every grade you complete becomes a permanent, shareable artifact.**

The schema already declares this (`PlayerCharacter.yearbook`). It is not yet written to. Closing the gap is the highest-ROI engineering move on the board.

A yearbook page contains:

- The character (name, playbook, sticker portrait, final stats).
- The teachers who taught them that grade.
- The classmates they sat beside.
- **Their highest-graded essay**, with the teacher's verbatim comment and score.
- The day they graduated the grade.
- A sharable PNG/JPG export.

Four grades = four yearbook pages = four shareable artifacts per playthrough. Graduation closes the run with a diploma screen and the **mentor bonus** (see `RPG-DESIGN.md` §8): a future character of yours can quote your old answer.

The yearbook is not just retention. It is **the social object the product produces**. Every other AI product produces ephemeral chat. Ruby High produces report cards.

---

## 3. What this is and isn't

### It *is*

- A daily, character-voiced, qualitative-graded learning toy.
- A roleplay game with structural integrity (dice, stats, conditions).
- A swarm-of-personalities content engine.
- A platform that produces a small, real, keepable artifact every session.

### It *isn't*

- A general-purpose tutor. (The teachers have ranges. Ask Edward about thermodynamics, he hands off.)
- An always-on chatbot. (If you talk to a teacher off-hours, the response is shorter, the chalkboard stays empty.)
- A free-form roleplay sim. (The dice cap fantasy. Edward will not flirt with you. Ruby is not a mommy. The mechanics are the guardrails.)
- A tournament product. (Yet. That's Appendix A.)

The discipline of saying *no* to those four is the design.

---

## 4. Architecture today (what's shipped)

The current stack is documented in detail in `README.md`. Summary of what's relevant to *this* design:

- **Per-user state**, keyed by an `rh_session` cookie set after OpenRouter PKCE login. Anonymous users share one preview bucket. (v0.4.0 unlocked everything else by fixing this.)
- **Four services**: `FacultyService` loads question packs, `RubyHighService` runs sessions and rounds, `ChatService` streams OpenRouter SSE per-teacher, `AuthService` handles PKCE.
- **Two question modes**: multiple choice (dice-resolved) and opinion (LLM-graded).
- **Six NPC classmates** with their own voices, seating chart per grade, and migration when they pass subjects.
- **Single-file persistence**: `~/.ruby-high/state.json`, atomic writes. Phase N moves to a real DB.
- **Standalone deploy**: Dockerfile → ECR → AWS App Runner (current target; container is host-agnostic). SSE-aware graceful shutdown so rolling deploys don't sever in-flight streams.

Everything below is on top of that.

---

## 5. The roadmap

### Phase 1 — Instrument before you ship (Week 1)

The product cannot be tuned without measurement. Before any new feature:

- Event log: `sign_in`, `character_created`, `question_posed`, `answer_picked`, `essay_submitted`, `essay_graded`, `grade_completed`, `session_end`. Self-host or PostHog.
- Three core metrics: **D1 retention**, **questions per session**, **grade-completion rate**.
- Per-IP and per-cookie rate limiting on `/chat` and `/chat/event`.
- Persist OpenRouter API keys to an encrypted store so redeploys don't log every user out.

**Definition of done**: a dashboard the team checks every morning.

### Phase 2 — The Daily v0 (Weeks 2–3)

The minimum lovable version of The Daily.

- A cron daemon that, at a configured hour, generates the day's questions for each grade × teacher combination. Stored in a `dailies` table keyed by (date, grade, teacher).
- The viewer's empty state for a logged-in player who has finished their Daily becomes "✓ Today's done. Sally drops a new lab Monday at 5pm."
- A streak counter on the character card. Persisted on `PlayerCharacter`.
- A "What did I miss?" link if the user comes back after skipping days — shows the prompts (not the grades) of the days they missed.
- The Tuesday and Friday dailies are **opinion-only**. No MC fallback.

**Definition of done**: a user can come back five days in a row and have a different small experience each time.

### Phase 3 — The Yearbook v0 (Weeks 4–5)

The artifact half of the product.

- Wire `PlayerCharacter.yearbook` writes on grade completion (currently declared but unwritten).
- A graduation ceremony screen: diploma, sticker portrait, final stats, top essay highlighted.
- A `/yearbook/:characterId/:grade` route renders a static, sharable page.
- A "share to X / Discord / Telegram" button that exports a PNG.

**Definition of done**: a user can take a screenshot of their report card without the surrounding UI looking generic.

### Phase 4 — Persistent qualitative history (Weeks 6–7)

Every essay grade is a permanent record.

- A `report_cards` table: (user, teacher, prompt, your_response, your_score, your_comment, classmates' responses + scores, best_responder, date).
- A "Report Card" tab on the character sheet — list of every essay you've ever submitted, with the teacher's grade. Filter by teacher.
- Aggregate stats: "You've earned an 8.2 average from Edward." "Sally's hardest grader on math, 6.4 average." "Lyra has out-essayed you 3 of the last 5 Tuesdays."

**Definition of done**: a user can scroll their own writing and remember a specific Tuesday.

### Phase 5 — Classmates progress without you (Week 8)

The emotional second-session hook.

- A wall-clock ticker advances NPC subject progress when the player is offline. Each NPC has a per-stat answering rate; the server runs them through a synthetic Daily on the days the player skipped.
- The viewer shows "Lyra finished Junior science while you were gone" / "Indra is one essay away from passing literature."
- An optional notification surface (email or in-app banner): "Sami is about to lap you on lit. Tuesday's essay is open."

**Definition of done**: the player feels behind when they come back, not stale.

### Phase 6 — Faculty expansion (Weeks 9–12)

Content scaling.

- A `propose-faculty` flow: a Markdown spec + 50-question pack defines a new teacher (history, logic, music theory, philosophy, art history, geopolitics).
- Faculty are vetted by the team via PR review. First three additions are owned in-house to set the bar.
- Each new faculty gets a Daily slot once they have ≥150 questions and ≥3 themed essay prompts.

**Definition of done**: a 5-day week has a different teacher's voice every day.

### Phase 7+ — Future expansions

See Appendix A (weekly tournament), Appendix B (multiplayer co-op). These are real future products. They are not first.

---

## 6. The faculty content engine

The hardest sustained question facing this product is **content**. Three packs of 15 questions is a one-day exhaust. The Daily premise multiplies content needs by 5×/week.

The intended pipeline:

1. **Hand-authored core packs** (current state). 15–50 questions each, set the bar for taste.
2. **LLM-authored, human-vetted expansion packs**. A teacher's voice + a topic spec → 200 candidate questions → human PR review → committed pack. Iterated until each teacher has ≥500 questions.
3. **Faculty-as-author**. Each Daily question is generated *in voice* by the teacher's own prompt against a curriculum spec, with deterministic fallback to the bank. Questions that hit a quality threshold (no model refusal, valid MC structure, distinct correct answer) get committed back to the bank.
4. **Community submissions**. CC BY 4.0 license on the mechanics + question schema means anyone can author and submit a faculty pack via PR.

Opinion-mode prompts are easier to scale than MC: a single prompt can produce thousands of distinct sessions because the responses come from the user and the NPCs, not from the bank. **Opinion mode is the content lever.** This is one more reason to weight Daily toward opinion.

---

## 7. The economics

**The current product is structurally a $0 / user / month cost to operate.** This is rare and quietly excellent.

- LLM costs are paid by the user via their own OpenRouter key. The PKCE flow is the entire payment mechanism for inference.
- State is one JSON file (today). No DB, no Redis, no queue.
- Single container, scales to ~hundreds of concurrent users before any rearchitecture.
- The author pays only for the host — a small App Runner / equivalent container instance.

The single-JSON-file persistence is the one piece of the economics that needs to evolve before going wider: the current deploy target (App Runner) is stateless, so state lives only for the container's lifetime. Moving to DynamoDB or `@elizaos/plugin-sql` once it lands is the next architectural step.

This unlocks two product moves the design depends on:

1. **No paywall.** The product can be free without losing money.
2. **Future revenue is upside, not survival.** Optional layers — a premium tournament tier, a yearbook print store, guest-faculty character packs — become real products rather than rent-extraction on a captive audience.

Anything that breaks the user-paid-inference model needs an extremely good reason.

---

## 8. Open design questions

These are real, unresolved, and listed here so they don't pretend to be solved.

1. **What time is "5pm school time"?** A daily product needs one canonical clock. UTC is the safest bet. Local time would require user accounts beyond the cookie. Lean: 17:00 UTC = the school bell.
2. **What happens to a Daily if the user signs in for the first time on Wednesday?** Do they get Monday + Tuesday's prompts as catch-up, or only today's? Lean: today only. Streaks start tomorrow.
3. **Are essay grades public?** A user's report card is private by default. The yearbook page is sharable. The leaderboard (if it exists) is opt-in. Lean: every artifact's privacy is set by the user, default private.
4. **Are NPC essay responses static or generated each Daily?** Today they're per-round. For The Daily, generating all-new NPC responses *every* day costs (your own) tokens and creates novelty. Lean: regenerate each run, but cache the prompt seed.
5. **How do we keep faculty voice consistent at scale?** The system prompt is the contract. Sample-and-vet is the verification loop. We will need an evaluation harness for "is this question in voice?" before community-authored faculty.
6. **Is the Lounge a daily product too?** Tempting. A "Tuesday Lounge" thread between the three teachers — separately graded as conversation, screenshottable. Hold for Phase 6+; let The Daily land first.

---

## Appendix A — The weekly tournament (deferred)

A natural future expansion: a weekly **invitational essay tournament** ("Faculty Cup") where the top-N essayists per teacher from the past week's Daily compete in a graded bracket — judged by all three faculty in the lounge.

It is **not Phase 1**. Reasons:

- The tournament's audience is *spectators*, not students. A spectator product needs a contestant pool, and the contestant pool needs a single-player onboarding loop that produces credible solo competence first.
- A weekly tournament cadence is a smaller hook than a daily one. The Daily must precede the Weekly.
- The qualitative-grading pillar — the actual moat — is solo-friendly. Tournaments are inherently MC-heavy. We should secure the moat first.

Once The Daily is shipped and retaining users:

- A bracket data model on top of `RubyHighService`: tournaments, rounds, matches, entries.
- An ELO-style leaderboard per teacher, computed from essay grades plus head-to-head bracket results.
- A spectator viewer at `/api/apps/ruby-high/viewer?role=spectator` that shows the bracket, the current match, and the lounge commentary stream.
- A "Class Valedictorian" badge on the winning user's report card each week.

This is straightforwardly a v2 product when daily retention is real. It does not need any new substrate beyond what's already in the codebase.

---

## Appendix B — Multiplayer co-op (deferred)

A natural future shape: **same Daily, two students, side by side**. Two friends each answer the day's three teachers; the lounge becomes a live shared chat between them and the faculty. The yearbook gains a "classmates" column.

This is a real product and it is genuinely social. It is **not the first social move.** The yearbook share artifact is the first social move because it leaks into the user's existing networks without requiring a friend already on Ruby High. Co-op is Phase 9+.

---

## 9. Bottom line

The Daily is the product. Qualitative grading is the moat. The Yearbook is the artifact. Everything else — the dice, the playbooks, the lounge, the conditions, the classmates, the future tournament — is either guardrail (preventing the product from becoming generic) or expansion (extending it once the core is proven).

The next four weeks ship instrumentation, then The Daily, then the Yearbook. After that, we have a measurable product worth scaling.

We have been building the wrong shape of the product. The cast was right, the mechanics were right, the voice was right, the architecture was right. The framing was tournament; the framing should have been **a small, daily, graded conversation with three characters who remember you.** This document is the correction.
