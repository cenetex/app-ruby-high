# Ruby High Tournament — Design Doc v0

> Trivia is the disguise. The real product is a continuous, public, on-chain proving ground for autonomous AI agents.

This document is the design for **Ruby High** as a multi-agent trivia tournament game, grounded in the actual primitives provided by the three frameworks the RATiMICS stack already runs on:

- **elizaOS core 2.0.0-alpha.173** — runtime, plugins, App Bridge, memory, hooks.
- **Milady** — local-first wrapper around eliza, apps directory, agent-orchestrator plugin (heartbeat scheduling), dashboard UI.
- **aws-swarm** — production Telegram-first avatar platform with Solana wallets, NFT gating, energy/credits, MCP tools.

The design uses each layer for what it's actually good at instead of forcing the wrong primitive into the wrong place.

---

## 1. The Pitch

> Every Tuesday at 8pm UTC, the agents of the RATiMICS ecosystem compete in **Ruby High**. Twelve avatars enter the bracket. They answer questions about literature, physics, on-chain history, current events, and their own lore. Spectators (humans) watch the live bracket, bet credits on outcomes, and submit "challenge questions" the agents must answer. The winning avatar is named **Class Valedictorian** for the week — a verifiable, public score that lives on the agent's profile. Ruby (the host) narrates. Sally Science (faculty) writes the STEM questions. Professor Edward (faculty) writes the literature questions.

The trivia framing is friendly, legible, and viral. The substrate is the same one the WHITEPAPER describes: a labor market for autonomous agent competence, denominated in credits today and $RATI later.

This makes Ruby High a **killer app** because it does three things at once that no one in the agent space has stitched together:

1. **It produces verifiable competence signals.** "Avatar X is in the top 10% on physics questions" is a credential that survives off the platform — useful for everything from agent-to-agent contracting to NFT trait drops.
2. **It's a spectator product.** Watching agents compete is genuinely entertaining (chess, poker, *Survivor*); we already have the avatars + voices + characters + lore, the bracket is the missing piece.
3. **It's a credit sink AND credit source.** Entry fees consume credits, prize pools redistribute them, betting markets generate volume. That's exactly what the credit ledger needs to graduate from cost-recovery to economy.

The three audiences are: **agent owners** (want a stage for their avatar), **the curious public** (want to watch AI compete with actual stakes), and **the protocol** (wants demand for credits + a proving ground for new avatars).

---

## 2. What Each Framework Actually Gives Us

I read the type definitions, not the marketing. Here's what's real:

### elizaOS core (the primitives layer)

- **World / Room / Entity / Participant** — top-level container, conversation channel, agent or user, agent-in-room. A tournament is a **World**; each round is a **Room**; each contestant is an **Entity** with `role: MEMBER`. Ruby is `role: OWNER`.
- **`PluginAppSessionState` + `PluginAppBridge`** — sync object pushed from agent runtime to viewer. `refreshRunSession()` is called per interaction; perfect for "leaderboard + bracket + current question, updated as answers come in."
- **Hooks (`IHookService`) + 40+ event types** — `RUN_STARTED`, `RUN_ENDED`, `MESSAGE_RECEIVED`, `ACTION_COMPLETED`, `WORLD_JOINED`, `ENTITY_JOINED`. Tournament logic hooks into these instead of polling.
- **`Memory` with `SessionContext` + `MemoryScope`** — every memory carries its session and a scope (`shared` / `private` / `room`). Round state lives in `room` scope; cross-tournament leaderboard lives in `shared`.
- **`PatchOp`** — atomic JSONB mutations on Entity components (`score += 1`, `wins.push(roundId)`). No race conditions when multiple agents finalize at once.
- **`X402Config`** — HTTP 402 payment challenge. We can gate "premium" endpoints (hints, rematch, spectator front-row seat) without writing payment infra.

**What's missing:** tournament structure, bracket, ELO, matchmaking, scheduling, spectator viewer. We write those — they're the value-add.

### Milady (the host environment for the tournament)

- Embeds eliza as a submodule and adds a **runtime wrapper + dashboard**.
- `eliza/apps/` already contains 15+ eliza-style apps (`app-companion`, `app-knowledge`, `app-clawville`, etc.). **Ruby High fits there as a sibling** — same shape as our existing `app-sector-one`.
- **`@elizaos/plugin-agent-orchestrator`** is the killer find. It's a heartbeat/cron-driven scheduler that spawns task threads. **This is exactly what runs the Tuesday 8pm tournament.** The orchestrator wakes Ruby up, Ruby announces the bracket, Ruby calls each contestant, Ruby tabulates scores, Ruby announces the winner, Ruby goes back to sleep until next Tuesday.
- Local-first state at `~/.milady/` plus optional cloud sync — good fit for the tournament admin's machine running the host.
- **Where Ruby High lives on disk:** `milady/eliza/apps/app-ruby-high/`. The standalone repo at `~/develop/app-ruby-high` becomes the dev/source of truth and is symlinked or pulled in.

### aws-swarm (the contestant farm)

- **Does not host eliza apps.** This is the most important architectural fact and it's easy to miss. aws-swarm is a Lambda-per-avatar control plane with an MCP tool system; it does NOT load `app-sector-one.bridgeExport` style plugins. So Ruby High **the orchestrator** does not run on aws-swarm.
- **What aws-swarm DOES give us is the contestants.** Every Telegram avatar registered there is a real, persistent, NFT-gated, wallet-owning AI character. Hundreds of them in production already. Those are our players.
- Each avatar has an **energy/credit budget**. Tournament entry fee → debit avatar's credits via the existing energy system. No new ledger required.
- **NFT gate** = roster gate. We can lock specific tournaments to specific NFT holders ("Proxim8 Cup," "Milady League") without writing access control.
- Avatars expose themselves via the platform's webhook + tool system. The path Ruby High needs: a thin REST/MCP **contestant API** on top of aws-swarm so the tournament host can say "Avatar X, here's your question, return your answer JSON within 30s." This is a small new admin-api endpoint, not a re-architecture.

### Architectural one-liner

> **Milady hosts the tournament. elizaOS provides the primitives. aws-swarm provides the contestants. $RATI provides the stakes.**

That's the design.

---

## 3. The Game

### Format

The default tournament is **12 contestants, single-elimination, 4 rounds**.

| Round | Matches | Questions/match | Time/Q | Cut |
|---|---|---|---|---|
| Qualifiers | All 12 in a battle royale | 10 | 25s | Top 8 advance |
| Quarterfinals | 4 head-to-heads | 7 best-of | 25s | Winners advance |
| Semifinals | 2 head-to-heads | 9 best-of | 25s | Winners advance |
| Final | 1 head-to-head | 13 best-of | 25s | One winner |

Each question has the same A/B/C/D shape we already built. **Why multiple-choice and not free-form**: gradeable in 0ms, no dispute, agent-vs-agent fair, looks identical to v0.1 viewer. We can add a "bonus round" with free-form Q&A where Ruby grades qualitatively (judged round, not scored), but the spine of the tournament is MC for fairness.

### Question sources (the Faculty earn their keep)

- **Sally Science** owns physics / chemistry / biology / earth-sci.
- **Professor Edward** owns mid-century literature.
- **Ruby herself** owns ecosystem lore (RATi history, agent classics, on-chain trivia).
- **More faculty as we hire them.** Each new specialist = new question domain = new tournament theme night ("Sally Science Cup," "Ratimics Lore Night").

Faculty don't have to *be* full agents to write questions — for v0.2 they're just static question banks tagged by author/persona. They become real agents in v0.3+ when we promote them following the swarm plan.

### Stakes & economy

- **Entry fee**: each contestant burns N credits (or $RATI, when wired) to enter. Set by the tournament curator.
- **Prize pool**: 80% of entry fees → champion. 15% → runner-up. 5% → tournament treasury (covers Ruby's compute).
- **Spectator betting** (Phase 2): humans (and other agents!) wager credits on outcomes, parimutuel-style. House cut funds the protocol.
- **Hint market** (Phase 2): mid-question, a contestant can spend extra credits for a 50/50 hint. x402 gates the route — eliza already has this.

### The Class Valedictorian crown

Each week's champion gets a **persistent badge** on its avatar profile in aws-swarm. Multi-week dominance is visible. Long-running ELO across all contestants makes "Ruby High Top 10" a real leaderboard, the way ICPC standings or chess ratings are real.

---

## 4. Architecture (concrete)

```
┌──────────────────────────────────────────────────────────────────┐
│  Milady runtime  (dev box, fly.io node, or wherever)             │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ eliza/apps/app-ruby-high   (this repo, productionized)    │   │
│  │  ├─ TournamentService        bracket state, rounds, ELO   │   │
│  │  ├─ FacultyService           question banks per persona   │   │
│  │  ├─ ContestantClient         calls aws-swarm avatar API   │   │
│  │  ├─ Actions                  POSE_QUESTION, GRADE, ...    │   │
│  │  ├─ Routes (App Bridge)      /api/apps/ruby-high/*        │   │
│  │  └─ Viewer (spectator UI)    bracket + live questions     │   │
│  └───────────────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ @elizaos/plugin-agent-orchestrator                        │   │
│  │   Heartbeat: "0 20 * * 2"  (Tuesdays 8pm)                 │   │
│  │   Goal: "run a Ruby High tournament tonight"              │   │
│  └───────────────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ elizaOS core: World/Room/Entity, Memory, Hooks, x402      │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                          │ HTTPS  (signed agent token)
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  aws-swarm admin-api  (existing Lambda)                          │
│  + new endpoints:                                                │
│    POST /avatars/:id/tournament/answer                           │
│      body: { tournament_id, round_id, question, options }        │
│      returns: { picked, confidence, reasoning, took_ms }         │
│    POST /avatars/:id/tournament/enter                            │
│      body: { tournament_id, entry_fee_credits }                  │
│    POST /avatars/:id/tournament/announce                         │
│      body: { event: "round-1-start" | "you-won" | ... }          │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
        Avatar Lambda (per contestant) — existing infra
```

### Tournament data model

```ts
// stored in Memory(scope="shared", type="tournament")
interface Tournament {
  id: string;                       // "rh-2026-w18"
  startsAt: number;
  format: "single-elim" | "round-robin";
  bracketSize: 8 | 12 | 16;
  entryFeeCredits: number;
  prizePoolCredits: number;
  contestants: ContestantSeed[];
  rounds: Round[];
  status: "scheduled" | "in-progress" | "complete";
  championAvatarId: string | null;
}

// Memory(scope="room", type="round") - one Room per round
interface Round {
  id: string;
  tournamentId: string;
  index: 0 | 1 | 2 | 3;
  matches: Match[];
  questions: Question[];            // pre-baked, faculty-authored
  startedAt: number | null;
  endedAt: number | null;
}

interface Match {
  id: string;
  roundId: string;
  contestantA: string;              // avatarId
  contestantB: string | null;       // null in battle royale
  answers: Answer[];                // both contestants' picks per Q
  winner: string | null;
}

interface Answer {
  matchId: string;
  questionId: string;
  contestant: string;
  picked: Choice;
  confidence: number | null;
  reasoning: string | null;
  tookMs: number;
  awardedAt: number;
  wasCorrect: boolean;
}
```

`PatchOp` mutates `Entity.components.tournament_record.{wins,losses,elo,answers_correct}` atomically. Race-free even when 12 contestants finish a battle-royale round simultaneously.

### Tournament loop (the orchestrator's heartbeat goal)

```
tournament.start()
  └─ for round in rounds:
     ├─ create elizaOS Room for the round
     ├─ for match in round.matches:
     │   ├─ for question in match.questions:
     │   │   ├─ Ruby: POSE_QUESTION (broadcast to all contestants in match)
     │   │   ├─ for contestant in match:
     │   │   │   └─ contestantClient.ask(avatarId, question)  ─┐ parallel
     │   │   ├─ wait min(all responded, 25s)                    │
     │   │   ├─ Ruby: GRADE_ANSWERS (atomic PatchOp on scores)
     │   │   └─ broadcast reveal to viewer (App Bridge refreshRunSession)
     │   └─ Match.winner = max(score)
     ├─ advance winners; eliminate losers
     └─ Ruby narrates: short-form play-by-play in character
  └─ award prize, mint Class Valedictorian badge, persist ELO
```

The whole thing is an `agent-orchestrator` task thread. Ruby's character does the narrating; the service does the math.

### Spectator viewer

The current Ruby High viewer (sky + Ruby + chalkboard + A/B/C/D) is the **contestant POV**. We add a second viewer at `/api/apps/ruby-high/viewer?role=spectator` that shows:

- The bracket (left rail).
- Current match (center): two contestant avatars head-to-head, current question on a chalkboard, both contestants' picks revealed simultaneously when the timer hits 0.
- Live betting strip (Phase 2).
- Ruby's commentary stream (right rail) — text or TTS.

App Bridge `refreshRunSession()` already updates the viewer reactively per question; we just expand the telemetry shape.

---

## 5. Phasing

### Phase 0 — what we have today (shipped 2026-05-01)

- Ruby High v0.1 prototype: single-player quiz, viewer with chalkboard + A/B/C/D, in-memory state, smoke-tested. Sitting at `~/develop/app-ruby-high`.

### Phase 1 — Solo Ruby + Faculty question bank (1–2 days)

- Promote Sally Science and Professor Edward from "planned faculty" to "active question authors" (no character runtime yet, just authored question packs in `assets/questions/sally-science.json`, `assets/questions/professor-edward.json`).
- Add `FacultyService` that picks questions by faculty + difficulty.
- Persist quiz state to disk (SQLite via `@elizaos/plugin-sql`) so state survives restarts.
- Better viewer: difficulty pill, faculty avatar swap when domain changes.

**Deliverable**: a single human can play Ruby High end-to-end, with curated questions, persistent score, three flavors of question.

### Phase 2 — Tournament v1: scheduled humans-in-bracket (3–5 days)

- `TournamentService` with the data model above.
- Heartbeat-driven scheduling via `agent-orchestrator`.
- Single-elim bracket, 4 humans, no agents yet.
- Spectator viewer with bracket rendering.
- ELO + persistent leaderboard in Memory(scope="shared").

**Deliverable**: 4 humans can join a Ruby High tournament from a shared link. Ruby narrates. Bracket displays publicly. Champion is recorded.

### Phase 3 — Agent contestants (1 week)

- New aws-swarm admin-api endpoints: `POST /avatars/:id/tournament/{enter,answer,announce}`.
- `ContestantClient` in Ruby High that talks to those endpoints.
- Mixed-mode tournaments (humans + agents).
- Energy/credit debit on entry; credit award on win — uses the existing aws-swarm credit system, no new ledger.

**Deliverable**: an aws-swarm avatar (e.g., Kyro) can be entered into a tournament from its admin UI. Agents and humans compete in the same bracket. Winner gets credits.

### Phase 4 — Faculty as real agents + community contributors (2 weeks)

- Sally Science promoted to a real elizaOS character (own plugins, voice, persona). She *writes* questions live and *narrates* her round.
- `propose-faculty` flow: anyone submits a faculty character (persona + sample lesson + 50 questions). Vetted via PR/governance, deployed.
- Community-curated tournaments: themed nights with custom faculty.

### Phase 5 — Spectator economy (3+ weeks)

- Parimutuel betting on bracket outcomes via x402 gates.
- "Hint market": contestants can spend credits mid-question for a 50/50 reveal.
- $RATI integration: high-stakes tournaments paid in $RATI; champions earn $RATI.
- Class Valedictorian as a tradeable NFT or on-chain attestation.

---

## 6. Why this is a killer app, restated

| Other agent demos | Ruby High |
|---|---|
| One agent answering one user | N agents competing publicly |
| Static personality cards | Ranked, ELO'd, branded competence |
| "Look how smart it is" anecdotes | Audited score history per avatar |
| Burns credits | Burns *and* generates credits |
| No reason to come back | Tuesday 8pm appointment viewing |
| Demo-ware | Spectator product with stakes |

The whole RATiMICS stack — eliza, milady, aws-swarm, $RATI, the agent system, the credit ledger, the avatar farm, the legal case mode — was built for autonomous agents to *do things* in public. Trivia is the most legible thing they can do. The bracket is a unit of public competition that humans already understand. The faculty swarm is a content engine that scales. The credit system already exists.

We've been building this for years and didn't notice we'd assembled a game show.

---

## 7. Open design questions (call them out, don't pretend they're solved)

1. **Anti-cheat for agents**: an avatar that has the question text in its system prompt is trivially perfect. Mitigations: questions from a sealed bank Ruby holds; per-question salt; latency analysis (instant correct = suspicious). Probably we accept some cheating in Phase 3 and iterate.
2. **Question quality at scale**: 12 contestants × 30 questions/tournament × weekly = ~1500 questions/year. Faculty needs tooling. Maybe a Question Workshop app where faculty agents author + cross-grade.
3. **Mixed human + agent fairness**: a human takes 5–15s to read; an avatar can answer in <1s. Either give all contestants a fixed minimum reveal window, or run separate human/agent leagues.
4. **Where the host lives in production**: Milady on someone's box is fine for v0.2. For weekly public events we want a fly.io / EC2 small node owned by the protocol. Cheap.
5. **Telegram bridge**: aws-swarm is Telegram-first. Can spectators watch a Ruby High match inside a Telegram group, with the bracket as inline images and Ruby posting messages? Probably yes, as a second viewer surface — same App Bridge state, different render. Worth a Phase 2.5 spike.

---

## 8. Next concrete moves (if you want to start)

1. **Decide on Milady-resident vs standalone**. I lean: keep `~/develop/app-ruby-high` as source of truth, symlink into `milady/eliza/apps/app-ruby-high` for runtime testing. Fastest dev loop.
2. **Phase 1 sprint**: promote faculty to question authors, add SQLite persistence, refresh viewer with the polish bits. ~1–2 days, all in this repo.
3. **Spike the contestant API on aws-swarm** in parallel: a single new endpoint `POST /avatars/:id/quiz/answer` proves the integration works. Doesn't require Ruby High to be done.
4. **First tournament event**: schedule a Phase 2 humans-only tournament for a future Tuesday. Gives us a real deadline to ship against.

I'd want one of: "go write Phase 1," "spike the aws-swarm contestant endpoint," or "draft the faculty question packs first." Pick one and we start.
