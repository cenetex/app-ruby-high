# Ruby High · Roadmap

## MMO-readiness roadmap — 2026-06-18

This section is grounded in the current GitHub issue tracker for
`cenetex/app-ruby-high` plus the deployed Ruby High state as of June 18, 2026.
The tracker has **no open MMO/multiplayer feature issues yet**; the open issues
are mostly reliability, security, and maintainability work that should become
the runway for MMO development rather than a parallel pile of guesses.

### Tracker audit

| Issue | Status | Roadmap meaning |
|---|---:|---|
| [#122 Return 400 for unknown viewer command types](https://github.com/cenetex/app-ruby-high/issues/122) | Implemented locally; ready for PR/CI | **P0 pre-MMO hardening.** Unknown mutation commands now fail closed with a 400 before mutating state. |
| [#121 Harden creator materials URL ingestion](https://github.com/cenetex/app-ruby-high/issues/121) | Implemented locally; ready for PR/CI | **P1 security.** Creator/import URL ingestion is constrained by host allowlisting, raw GitHub normalization, private-network rejection, redirect checks, and size limits. |
| [#120 Make the Privy browser bundle cacheable or smaller](https://github.com/cenetex/app-ruby-high/issues/120) | Implemented locally; ready for PR/CI | **P2 performance.** Versioned Privy bundle requests are immutable-cacheable and the bundle-size guard now protects the lazy account widget payload. |
| [#119 Harden viewer auth-token handling and CSP](https://github.com/cenetex/app-ruby-high/issues/119) | Implemented locally; ready for PR/CI | **P1 security.** Browser-owned OpenRouter keys default to session scope, legacy local keys migrate down unless persistence is explicit, and inline viewer scripts use hashes instead of broad `unsafe-inline`. |
| [#118 Add Playwright browser smoke tests](https://github.com/cenetex/app-ruby-high/issues/118) | Implemented; ready to close after CI run | **Tracker cleanup.** Playwright browser smoke exists locally and in a dedicated Actions workflow for viewer/browser PRs. |
| [#117 Refactor inline viewer client into typed modules](https://github.com/cenetex/app-ruby-high/issues/117) | Open, first slice implemented | **P1 maintainability.** The MMO-facing public world feed now has typed pure helpers; continue extracting UI areas before adding larger multiplayer surfaces. |
| [#65 Deploy Workflow Failed: deploy-fly](https://github.com/cenetex/app-ruby-high/issues/65) | Open but stale | **Tracker cleanup.** Current deploys and prod smoke pass; confirm the historical run is no longer actionable, then close or replace with a living deploy-health issue. |

### Current readiness evidence

- Production deploy is healthy on Fly and post-deploy smoke passes.
- Built-in curriculum is expanded to 600 questions: Ruby, Sally Science, and
  Professor Edward each expose 200 questions in prod health/session telemetry.
- Public world surfaces exist:
  `/api/apps/ruby-high/world` and `/api/apps/ruby-high/world/events`.
- Deploy smoke now checks the public world snapshot, SSE replay framing,
  `no-store` headers, and private identifier leakage.
- Route tests cover live stream cursors, heartbeats, reconnects,
  same-millisecond events, client close/write-failure cleanup, per-client live
  stream caps, and sanitized public projections.

### Phase 0 — Close the tracker gap

Goal: get the issue tracker to tell the truth before inventing new MMO tickets.

- Close or update #118 after confirming the browser smoke suite satisfies the
  original acceptance criteria.
- Close or replace #65 after confirming the current `deploy-fly` failure is stale.
- Land #119-#122 through PR/CI before adding new multiplayer commands; public
  multiplayer command and import surfaces should fail closed by default.
- First-class MMO issues now exist for the work below so this roadmap stays tied
  to GitHub, not memory.

Acceptance gate: open issues distinguish stale/resolved work from active
blockers, and the tracker contains explicit MMO milestone issues.

### Phase 1 — Multiplayer-safe foundation

Goal: make the current app safe to extend into shared-world play.

- Keep #119 and #121 fixes under regression coverage as public surfaces grow:
  viewer token storage/CSP and creator URL imports are now guarded locally.
- Continue #117 by extracting the public world/feed client behind typed
  interfaces. Cursor math, event pruning, event labels, room titles, and compact
  summary formatting now live in `client-pure.ts`; SSE request sequencing,
  backoff, cursor replay, snapshots, and event merging now live in
  `viewer-parts/world-feed.ts`; compact world-panel room/event render models
  plus race-strip timer/card and blackboard question-prompt render models also
  live in typed helpers. Honor Roll leaderboard row/header models are now typed
  too, with the header rendered without string HTML, and the top-bar arc
  indicator plus classmate/channel-rail arc labels, year meters, and room
  completion meters are now typed. The next slice should move larger viewer
  surfaces behind module boundaries before larger multiplayer UI is added.
- Keep the public world smoke guard in every deploy.

Acceptance gate: new multiplayer UI can be added without expanding the most
fragile unchecked browser surface, and public/user-generated inputs have clear
security boundaries.

### Phase 2 — First multiplayer loop: live class rooms

Goal: turn the existing public world feed into gameplay.

Build a minimal room loop around the structures that already exist:

- Grade/faculty rooms show active students, recent class events, and curriculum
  pressure.
- A class-wide goal runs for a short window: answer streaks, teacher affinity,
  comic/page unlock progress, or curriculum rescue for low question pools.
- Individual answers remain private by default; public events are sanitized and
  consent-aware.
- The world feed emits room-level progress events that clients can replay with
  existing cursors.

Acceptance gate: two anonymous/guest sessions can contribute to the same room
goal and both clients observe progress through the public world feed without
private state leakage.

### Phase 3 — Dynamic teacher curriculum

Goal: make question generation a teacher research loop, not one-off expansion.

- Store hand-authored teacher research corpora as durable content inputs.
- Track per-teacher coverage, repetition, weak pools, and recent generated
  concepts.
- Add a generation queue that proposes new questions only when a pool is weak,
  then validates and promotes candidates through tests/check scripts.
- Keep first-grade sets curated and narrow; allow higher grades to become more
  expansive.

Acceptance gate: a teacher can detect an exhausted or repetitive topic pool,
generate candidate questions from her corpus, pass validation, and expose the
new content without editing source JSON by hand.

### Phase 4 — Durable world model

Goal: stop deriving the MMO entirely from private session state.

Introduce explicit durable entities only when Phase 2 proves the loop:

- rooms/cohorts/terms
- room goals and outcomes
- teacher agendas
- public world events
- moderation/report records
- season or school-year summaries

Acceptance gate: shared room state survives deploys/restarts, has admin
visibility, and can be replayed independently of any one student's session.

### Phase 5 — Social product and moderation

Goal: make public presence safe and legible.

- Public profile/visibility controls beyond the current social consent bit.
- Report/hide/admin moderation flows for public names and events.
- Rate limits for public actions, not just HTTP endpoints.
- Product language that explains what becomes public before it happens.

Acceptance gate: a user can understand and control their public presence, and an
admin can respond to a bad public event without touching the database manually.

### Phase 6 — Economy and collection integration

Goal: connect Hall Passes, NFTs, cards, and comics to the shared school world.

- Public achievement rituals for card/comic unlocks.
- Room or term rewards that can feed card packs without pay-to-win pressure.
- Collection showcases and profile/yearbook flexes.
- Marketplace verification remains a revenue/credibility track, not a blocker
  on multiplayer play.

Acceptance gate: multiplayer activity creates visible, collectible, shareable
outcomes without requiring crypto participation.

### New MMO GitHub issues

1. [#139 MMO: live class rooms MVP](https://github.com/cenetex/app-ruby-high/issues/139)
   — shared room goal, room progress events, two-client acceptance test.
2. [#140 MMO: typed public-world viewer module](https://github.com/cenetex/app-ruby-high/issues/140)
   — extract feed/client rendering from `viewer-parts/client.ts` behind typed
   pure helpers.
3. [#141 MMO: teacher curriculum research loop](https://github.com/cenetex/app-ruby-high/issues/141)
   — corpora, coverage detection, generation queue, validation/promote path.
4. [#142 MMO: public presence and moderation controls](https://github.com/cenetex/app-ruby-high/issues/142)
   — visibility settings, report/hide/admin review.
5. [#143 MMO: durable room/world state model](https://github.com/cenetex/app-ruby-high/issues/143)
   — explicit room/term/goal records once live class rooms prove the loop.

---

## Revenue Roadmap

**May 27, 2026** — written the day everything else was shut down.
**Re-sequenced May 29, 2026** — measurement pulled to the front; distribution reframed
as a pipeline (see [`docs/MARKETING.md`](./docs/MARKETING.md)).
**Superseded in part June 18, 2026** — the "no multiplayer" constraint below no
longer reflects product direction. Keep the revenue funnel work, but sequence it
alongside the MMO-readiness roadmap above.

The only project left is Ruby High. The only goal is to make it pay for
itself, then for the next thing. Every line below is chosen by one
criterion: does it turn a visitor into a supporter.

---

## Who built this

Someone who got prescribed Seroquel for working with the Americans turned
the experience into a trilingual classical Chinese chronicle, built an
autonomous agent ecosystem from scratch, lost the funding for all of it
except a school game where AI teachers grade your opinions, and is now
using a legal fight as one distribution channel among several.

The philosophy (annihilism.org, the Qiao analects) is not decoration. It
is the depth underneath the product. The Bloomberg reader who lands on a
warm chalkboard page and later discovers the lesson on annihilism.org
should feel the product is *worthy* of the story that brought them there.

---

## Context

- Ruby High is deployed on Fly.io (`ruby-high.fly.dev`) with scale-to-zero.
- Users bring their own OpenRouter key — inference costs are theirs, not ours.
- Marginal cost per active user is functionally zero.
- Monetization: Stripe Hall Passes, Solana NFT packs ($RUBY token), card-burn
  redemption, and Gumroad books (Qiao, Egregoregramming 101).
- Two Metaplex Core collections live on mainnet:
  `Ruby High: First Bell` and `Ruby High: First Bell Packs`.
- Distribution is a **pipeline of marketing events**, not a single email — see
  [`docs/MARKETING.md`](./docs/MARKETING.md). The Amanda Iacone / Bloomberg Tax
  email is the capstone of the first wave, not the opener.
- Budget: ~$40.

## How the phases sequence

The order is not arbitrary. **Measure first** (it's nearly free and mostly already
built), because a traffic spike you can't read teaches nothing. **Then make the
surface convert** (Phase 1) — driving traffic to a surface that doesn't convert
wastes the spike. **Only then fire the distribution pipeline** (Phase 2). NFT
marketplace credibility (Phase 3) gates only the *crypto-audience* events, not the
press/HN ones, so it runs in parallel rather than blocking. Phase 4 deepens
conversion once we have real funnel data.

---

## Phase 0 — Measure (always-on, mostly already built)

> A spike from any marketing event is worthless if we can't tell whether it
> converted. This is the cheapest phase and the prerequisite for every other one,
> so it runs first and continuously.

**What already exists** (don't rebuild it): the admin metrics route (`src/routes/admin.ts`,
schema `v4`) already tracks visitor cohorts (`total / newLast24h / returningLast24h`)
and `ruby.retention.visitorD1` over privacy-preserving hashed visitor ids, and it
already flags the in-process counters as non-durable.

### 0.1 The gap: a durable, cross-deploy sink
- The operational counters are in-process and die on deploy/restart/machine
  replacement. Ship the metric events to a queryable sink (Fly log drain or
  equivalent) so "did the Bloomberg spike convert?" is answerable a month later,
  after the traffic fades.

### 0.2 The conversion funnel
- Extend the existing visitor cohorts into a funnel: **visitor → signed-in player →
  payer** (Hall Pass / NFT / book). The retention half (D1, and add D7) is the
  easy extension of what `admin.ts` already computes.

---

## Phase 1 — The landing surface tells the real story

> The landing page is warm and charming — chalkboard, comic pages, teacher
> stickers. It's good. But a Bloomberg reader who lands here after reading
> about a legal fight needs to feel the product is *worthy* of the story
> that brought them. The philosophy needs to be discoverable, not buried.

### 1.1 Surface the depth
- Add a "Books" link to the nav and footer, pointing to Gumroad.
- The annihilism.org lesson inside Ruby High — make it findable from the
  landing page or early in the viewer flow.
- The Qiao book link and the Egregoregramming book link: both on the
  landing page.

### 1.2 Three purchase paths, visible before deep gameplay
- Hall Pass purchase visible before (or immediately after) sign-in.
- NFT pack purchase entry point beside card/pack surfaces.
- Books as a third path: someone who doesn't want to play or collect
  can still support by buying the philosophy.

### 1.3 Audit the first-session flow
- Trace visitor landing → viewer → first question → session end.
- Time-to-value: can a new player understand the proposition in 30 seconds?
- Identify every leak — confusion, friction, dead clicks.
- **This is the highest-leverage item in the whole roadmap** and the hard
  prerequisite for the press/HN events in Phase 2.

---

## Phase 2 — Fire the distribution pipeline

> Distribution is a sequence of shots on goal, each driving a spike the Phase 1
> surface converts. Full plan and ranking in [`docs/MARKETING.md`](./docs/MARKETING.md).

### 2.1 Sequence by readiness
- Fire the zero-prerequisite events now: the **annihilism.org → school funnel**
  and the **founder-story thread**.
- Once Phase 1 converts, fire **Show HN**, then the **Amanda Iacone** capstone.
- Books drop and Reddit are cheap repeat shots between the big ones.

### 2.2 One event at a time, read the funnel between
- Fire, then read Phase 0's funnel before the next. Don't stack events you can't
  attribute.

### 2.3 Never rest on one arrow
- Keep the pipeline populated so there's always a *next* event queued. Amanda is
  one row, not the strategy.

---

## Phase 3 — NFT marketplace credibility

> A verified Magic Eden collection is the credibility signal a Solana collector
> checks. It turns NFTs from "inventory" into "a price someone can see." It gates
> the *crypto-audience* events only — run it in parallel with Phases 1–2, not as a
> blocker on the press shots.

### 3.1 Magic Eden listing
- Submit `Ruby High: First Bell` card collection via Creator Hub.
- Submit `Ruby High: First Bell Packs` pack receipt collection.
- Verify collection artwork, description, website against canonical copy
  in [`docs/nft/NFT_MARKETPLACE_VERIFICATION.md`](./docs/nft/NFT_MARKETPLACE_VERIFICATION.md).

### 3.2 Acceptance checks
- Newly minted assets display correct collection names, artwork, traits.
- No proof hashes leaking into visible marketplace traits.
- Helius/DAS returns durable image + metadata URLs.

### 3.3 Volume signal (optional spend)
- Seeding trading toward the badge threshold (50K+ USD volume, aspirational)
  costs real money against a $40 budget. Treat as optional, not required.

---

## Phase 4 — Product gaps that convert

> From DESIGN.md Part 3. Each item directly affects monetization or
> retention. Prioritize against the Phase 0 funnel data, not guesses.

### 4.1 Yearbook sharing
- The yearbook card route, SVG renderer, and viewer controls exist.
- Add a PNG renderer for platforms that don't honor SVG OG images.
- A shareable yearbook page is Ruby High's viral loop — "here's what
  Professor Edward said about my essay."

### 4.2 Playbook moves wired in
- Overachiever's "retake one missed question per year" — makes the
  playbook feel real instead of just flavor text. Deepens investment
  and retention.

### 4.3 First-party content packs
- The built-in pack ships with 15 questions per teacher.
- Ingest 1-2 more packs (SAT-level science, literature, philosophy)
  to deepen the content moat.

---

## Revenue targets

| Milestone | What it means |
|---|---|
| Funnel attributable end-to-end | A spike can be traced visitor → player → payer (Phase 0) |
| First Hall Pass purchase from a stranger | Someone found us outside our circle and paid |
| First NFT pack sold to a non-team wallet | The collection has organic demand |
| Magic Eden listed + verified | The marketplace believes the collection is real |
| D7 retention above 20% | The product works as a habit |
| Monthly revenue covers Fly + SQLite/S3 operating costs | Self-sustaining |

---

## What we're not doing

- No new teachers. Three is enough until retention data proves demand.
- Multiplayer is no longer out of scope as of June 18, 2026; the MMO-readiness
  roadmap above supersedes the old "no multiplayer" constraint. Tournaments and
  Faculty Cup remain later than the live-class-room MVP.
- No public pack marketplace. Community packs are later, not now.
- No new infrastructure. Fly + SQLite volume + S3 is the stack. No queues,
  no Kubernetes, no rearchitect. (Phase 0's sink is a log drain, not new infra.)
- No betting the funnel on a single marketing event.

---

## The tie-ins

- **annihilism.org** — one of the Ruby High lessons, and a standing inbound
  funnel (Marketing event #2). The philosophy is the depth underneath the
  product. A Bloomberg reader who discovers the school teaches militant
  anti-essentialism alongside science gets a second reason to stay.
- **Qiao** — the book. Pay-what-you-want on Gumroad, free on
  annihilism.org. A purchase path for someone who wants the philosophy
  without playing the game.
- **Egregoregramming 101** — the course. $19 on Gumroad. The technical
  manual for the whole ecosystem, now a time capsule since most of the
  referenced repos are gone.
- **The legal fight** — the story behind the Amanda Iacone event. The story
  drives traffic; the product converts. One channel among several.
