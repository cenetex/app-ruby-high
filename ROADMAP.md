# Ruby High · Roadmap

## MMO-readiness roadmap — 2026-06-19

This section is grounded in the open GitHub issue tracker for
`cenetex/app-ruby-high` plus PR
[#138](https://github.com/cenetex/app-ruby-high/pull/138). The goal is to keep
Ruby High's multiplayer direction tied to explicit issues and acceptance gates
instead of drifting into vibe-only product work.

As of June 19, 2026, #138 is green on GitHub Actions and contains the first
issue-backed MMO runway: deploy/security hardening, browser smoke, public world
projection, typed viewer seams, live-room goal contributions, curriculum
research plumbing, presence/moderation controls, and durable public-world state.
The live GitHub tracker still has exactly five active MMO issues (#139-#143)
plus the broader viewer refactor (#117); this roadmap treats those issues as
the implementation contract.

### Tracker audit

| Issue | Status | Roadmap meaning |
|---|---:|---|
| [#143 MMO: durable room and world state model](https://github.com/cenetex/app-ruby-high/issues/143) | Open, first durable slices in #138 | **P0 MMO data model.** Live-room goals, sanitized room/term snapshots, completed room outcomes, teacher agenda records, public event replay, summary counters, moderation suppression state, and rollback docs are durable; next is richer outcome summaries, agenda execution rules, and restart/replay acceptance tests that prove the durable model is not just an admin counter. |
| [#142 MMO: public presence and moderation controls](https://github.com/cenetex/app-ruby-high/issues/142) | Open, operator workflow in #138 | **P0 safety.** Public presence toggle, public-name review policy, per-player hide/report, admin moderation snapshot, repeated-report counts, moderator notes, report dismissal, global suppression, action throttles, and account copy that names public/private profile fields exist; next is tying moderation surfaces into richer live-room rewards and term progression. |
| [#141 MMO: teacher curriculum research loop](https://github.com/cenetex/app-ruby-high/issues/141) | Open, deeper loop in #138 | **P1 content engine.** Teacher corpora metadata, reading lists, primary-source packets, misconception checks, grade briefs, replenishment proposals, coverage-exhaustion auto-enqueue, validation, review readiness, explicit approval gates, runtime promotion, weak-subject and repetition signals exist; next is broader per-teacher corpus depth. |
| [#140 MMO: typed public-world viewer module](https://github.com/cenetex/app-ruby-high/issues/140) | Open, several seams in #138 | **P1 maintainability.** World feed, world panel, lifecycle wiring, public-world action handling, composed world-controller wiring, race/question/leaderboard/progress models, account pane/AI/wallet/trust/cards/card-tile/card-reader/comics/public-world visibility view models, account-history row models, and account character-slot panel/card models are typed; next is extracting the next public-world/account surface still owned by `viewer-parts/client.ts`. |
| [#139 MMO: live class rooms MVP](https://github.com/cenetex/app-ruby-high/issues/139) | Open, answer-flow goal path in #138 | **P1 gameplay.** Two guest sessions can contribute to a room goal through normal answer commands and observe sanitized public progress; next is richer room rules and visible cooperative rewards. |
| [#122 Return 400 for unknown viewer command types](https://github.com/cenetex/app-ruby-high/issues/122) | Fixed in #138; close after merge | **P0 pre-MMO hardening.** Unknown mutation commands fail closed with a 400 before mutating state. |
| [#121 Harden creator materials URL ingestion](https://github.com/cenetex/app-ruby-high/issues/121) | Fixed in #138; close after merge | **P1 security.** Creator/import URL ingestion is constrained by host allowlisting, raw GitHub normalization, private-network rejection, redirect checks, and size limits. |
| [#120 Make the Privy browser bundle cacheable or smaller](https://github.com/cenetex/app-ruby-high/issues/120) | Fixed in #138; close after merge | **P2 performance.** Versioned Privy bundle requests are immutable-cacheable and the bundle-size guard protects the lazy account widget payload. |
| [#119 Harden viewer auth-token handling and CSP](https://github.com/cenetex/app-ruby-high/issues/119) | Fixed in #138; close after merge | **P1 security.** Browser-owned OpenRouter keys default to session scope, legacy local keys migrate down unless persistence is explicit, and inline viewer scripts use hashes instead of broad `unsafe-inline`. |
| [#118 Add Playwright browser smoke tests](https://github.com/cenetex/app-ruby-high/issues/118) | Fixed in #138; close after merge | **Tracker cleanup.** Playwright browser smoke exists locally and in a dedicated Actions workflow for viewer/browser PRs. |
| [#117 Refactor inline viewer client into typed modules](https://github.com/cenetex/app-ruby-high/issues/117) | Open, many slices in #138 | **P1 maintainability.** Continue extracting UI areas before adding larger multiplayer surfaces. |
| [#65 Deploy Workflow Failed: deploy-fly](https://github.com/cenetex/app-ruby-high/issues/65) | Open but stale | **Tracker cleanup.** Current PR deploy verification is green; close or replace after confirming `main` no longer has that historical failure mode. |

### Operating order

The active issues are intentionally not parallel wishlists. Work them in this
order unless production evidence says otherwise:

1. **#140 / #117 — reduce viewer risk before adding more MMO UI.** Extract the
   next public-world/account surfaces from the unchecked serialized client into
   typed helpers with focused tests.
2. **#139 — make the live room loop fun on purpose.** Upgrade the current
   answer-flow contribution path into visible cooperative room rules and rewards
   while keeping answer details private.
3. **#143 — prove the world survives restarts.** Extend durable room outcomes
   and teacher agendas into replayable summaries with rollback coverage and
   admin visibility.
4. **#142 — keep public play safe as it becomes central.** Extend the
   public-name review, profile copy, and moderation paths so they match the
   richer live-room surfaces; public-name review now gates live-room reward
   contribution as well as room visibility.
5. **#141 — deepen the teacher research loop.** Broaden the corpora and
   approval/replenishment affordances after the gameplay loop shows which
   concepts actually need more material.

The older issues (#118-#122) should close after #138 lands on `main`; they are
not roadmap work anymore. Issue #65 should be closed or replaced only after
checking current `main` deploy history.

### Current readiness evidence

- GitHub Actions are green on PR #138: deploy verify, lockfile, and browser
  smoke pass; deploy is correctly skipped for the PR branch.
- Built-in curriculum is expanded to 600 questions: Ruby, Sally Science, and
  Professor Edward each expose 200 questions in prod health/session telemetry.
- Public world surfaces exist:
  `/api/apps/ruby-high/world` and `/api/apps/ruby-high/world/events`.
- Deploy smoke now checks the public world snapshot, SSE replay framing,
  `no-store` headers, and private identifier leakage.
- Route tests cover live stream cursors, heartbeats, reconnects,
  same-millisecond events, client close/write-failure cleanup, per-client live
  stream caps, and sanitized public projections.
- Browser smoke covers guest boot, full grade 9-12 journey, comic unlock modal,
  public world-feed stream rollover, two-client live-room progress, and
  desktop/mobile framing.

### Phase 0 — Close the tracker gap

Goal: keep the issue tracker accurate while PR #138 moves toward merge.

- Merge #138 only while deploy verify, lockfile, and browser smoke are green.
- Close #118-#122 after #138 lands and passes on `main`.
- Close or replace #65 after checking current `deploy-fly` history on `main`.
- Leave #117 and #139-#143 open as the active MMO runway.

Acceptance gate: open issues distinguish stale/resolved work from active
blockers, and every MMO slice maps to #117 or #139-#143.

### Phase 1 — Multiplayer-safe foundation

Goal: make the current app safe to extend into shared-world play.

- Keep #119 and #121 fixes under regression coverage as public surfaces grow:
  viewer token storage/CSP and creator URL imports are now guarded in #138.
- Continue #117 by extracting the public world/feed client behind typed
  interfaces. Cursor math, event pruning, event labels, room titles, summary
  formatting, SSE sequencing/backoff/replay, snapshots, event merging,
  world-panel render models, race-strip models, question prompts, Honor Roll
  rows, arc indicators, progress labels, public-world lifecycle wiring,
  account public-world visibility models, and public-world hide/report actions
  now live in typed helpers. The next slice should move larger viewer surfaces
  behind module boundaries before larger multiplayer UI is added.
- Keep the public world smoke guard in every deploy.

Acceptance gate: new multiplayer UI can be added without expanding the most
fragile unchecked browser surface, and public/user-generated inputs have clear
security boundaries.

### Phase 2 — First multiplayer loop: live class rooms

Goal: turn the existing public world feed into gameplay.

The first minimal room loop exists in #138. Build the player-facing version
around those structures:

- Grade/faculty rooms show active students, recent class events, and curriculum
  pressure.
- A class-wide goal runs for a short window: answer streaks, teacher affinity,
  comic/page unlock progress, or curriculum rescue for low question pools.
- Individual answers remain private by default; public events are sanitized and
  consent-aware.
- The world feed emits room-level progress events that clients can replay with
  existing cursors.
- Browser tests now cover room goal contribution through normal `pick` /
  `answer` commands rather than the dev-only contribution helper.

Acceptance gate: two anonymous/guest sessions can contribute to the same room
goal and both clients observe progress through the public world feed without
private state leakage.

### Phase 3 — Dynamic teacher curriculum

Goal: make question generation a teacher research loop, not one-off expansion.

- Store hand-authored teacher research corpora as durable content inputs. The
  current teacher corpus metadata is a start; it should deepen into specific
  reading lists, research interests, disallowed repetition patterns, and grade
  lanes.
- Track per-teacher coverage, repetition, weak pools, and recent generated
  concepts. #138 exposes these signals to replenishment planning.
- Add a generation queue that proposes new questions only when a pool is weak,
  then validates and promotes candidates through tests/check scripts. #138 has a
  proposal queue, automatic corpus-backed candidate draft seeding from weak
  pools, optional OpenRouter/course-model draft generation with deterministic
  fallback, validation, runtime promotion, and richer hand-authored teacher
  corpora with reading lists, canonical misconceptions, and grade-specific
  briefs that are carried into admin snapshots, draft packets, and LLM prompts.
  Exhausted generated pools can now auto-enqueue review drafts through the
  token-gated admin endpoint without duplicating existing queued drafts.
  Promotion now requires an explicit reviewer approval stamp tied to the draft's
  current question fingerprint, so edits after approval must be re-approved.
  Corpus plans now select compact primary-source packets by grade and subject,
  and carry those packet IDs, anchors, summaries, and question seeds into admin
  snapshots, review materials, prompt seeds, and OpenRouter generation prompts.
- Keep first-grade sets curated and narrow; allow higher grades to become more
  expansive.

Acceptance gate: a teacher can detect an exhausted or repetitive topic pool,
generate candidate questions from her corpus, pass validation, and expose the
new content without editing source JSON by hand.

### Phase 4 — Durable world model

Goal: stop deriving the MMO entirely from private session state.

Phase 2 has proved the first loop enough to introduce explicit durable entities
incrementally:

- rooms/cohorts/terms
- room goals, completed outcomes, and room/term snapshots (first slices exist in #138)
- teacher agendas (first slice exists in #138)
- public world events (first slice exists in #138)
- moderation/report records and suppression state (first slice exists in #138)
- season or school-year summaries (first slice exists in #138)

Acceptance gate: shared room state survives deploys/restarts, has admin
visibility, and can be replayed independently of any one student's session.

### Phase 5 — Social product and moderation

Goal: make public presence safe and legible.

- Public profile/visibility controls beyond the old social consent bit. #138
  separates public-world presence from teacher social/X posting consent while
  preserving the legacy `socialConsent=false` hide behavior.
- Report/hide/admin moderation flows for public names and events. #138 covers
  public-name review before world entry, event hide/report, admin review,
  repeated-report counts, durable moderator notes, dismissal, and durable
  global suppression.
- Rate limits for public actions, not just HTTP endpoints. #138 adds a tighter
  public-world safety action limiter.
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

### Next implementation slices

1. [#140](https://github.com/cenetex/app-ruby-high/issues/140) / [#117](https://github.com/cenetex/app-ruby-high/issues/117):
   continue extracting public-world UI from `viewer-parts/client.ts` into typed
   modules with unit tests. The account public-world control is now behind a
   typed controller, and live-room channel row view models now come from typed
   helpers plus a typed room-row DOM controller. The public-world feed, panel,
   action, and lifecycle wiring now compose behind one typed world controller
   that still serializes into the inline viewer. Account wallet-history rows
   now render from typed pure view models instead of wallet transaction logic in
   the unchecked client. Account character-slot summary, create/unlock state,
   and cards now render from typed pure view models for active, graduated,
   create, and empty states. Account AI status/action labels and wallet
   balance/action labels now render from typed view models. Next target: the
   next large public-world or account surface still owned by the unchecked
   client. Account pane tab/panel selected state now comes from typed pure view
   models instead of inline DOM decision logic. Account Trust panel row/link/note
   data now comes from a typed pure view model, leaving the unchecked client to
   only append DOM rows. Account card-pack summary, checkout action state, and
   reveal/connect action state now come from a typed pure panel view model.
   Account comic progress and page tile lock/open state now come from a typed
   pure panel view model, while the client keeps reader modal DOM and image URLs.
   Account pack/card tile labels, details, classes, proof labels, and pack-open
   action state now come from typed pure tile view models. Account card-reader
   title/detail/profile/reveal state now comes from a typed pure view model,
   and its Hall Pass profile lookup catalog now serializes as a typed pure
   helper instead of living inside the unchecked client. Welcome Hall Pass
   popup title/body/action copy now comes from a typed pure view model instead
   of modal-local branching in the unchecked client. Billing Card Burn row
   copy and button state now come from a typed pure view model instead of
   inline billing DOM branching. Card-pack payment choice title/meta/button/note
   copy now comes from a typed pure view model while the unchecked client keeps
   wallet/config checks and payment side effects. Stripe Hall Pass payment
   choice title/meta/button state now follows the same typed pure-helper path.
   Shared billing product row title/meta/selected-button state now also comes
   from a typed pure helper for both Hall Pass and card-pack modes, and billing
   panel title/subtitle/card-pack cost/status copy now comes from a typed pure
   view model. Weekly guest spotlight title/meta/action state now comes from a
   typed pure view model instead of unchecked lounge DOM branching. Empty-board
   subject summary titles and subject-grade chip classes/tooltips/labels now
   come from typed pure helpers shared by the chalkboard and progression UI.
   Active term-rule summary labels now have a dedicated typed helper for
   ordering, filtering, and capping grade-scoped room modifiers.
2. [#139](https://github.com/cenetex/app-ruby-high/issues/139): replace the
   current minimal room contribution proof with one visible cooperative reward:
   completed live-room goals now carry a class-wide Study Spark reward label in
   the sanitized world feed and increment Study Spark totals in the durable
   public-world summary/admin health surface; the public `/world` snapshot now
   carries those totals, the live `/world/events` snapshot includes them, and
   the player School World panel renders them in its compact summary with
   browser coverage across multiple public clients. Study Sparks now also drive
   a deterministic term-progress label in the durable public-world summary,
   `/world` snapshot, live `/world/events` snapshot, admin health surface, and
   player School World summary. Term Level 1 now unlocks a concrete Term
   Momentum room rule: the next live-room goal is stored and rendered as a
   two-student cooperative target, with the sanitized public room/event payload
   carrying the rule label and durable outcome replay preserving the reduced
   target. The current term is now also materialized as a durable term record
   with Spark totals, level, active rule labels, per-grade Spark lanes, admin
   health visibility, and restart replay coverage. Each eligible grade lane now
   persists an actionable room-rule target, and Term Momentum applies only to
   grade lanes that earned the level, so one grade's progress does not silently
   buff every room. Term Level 2 now unlocks a four-student Term Rally rule with
   a distinct public Rally Spark reward label, durable outcome persistence, and
   sanitized event replay coverage. Active grade-scoped term rules now appear
   in the public world summary, compact player world-feed label, and room chips:
   active rooms now show rule pressure such as Term Rally's four-student goal at
   room-selection time. Active term room rules now also promote matching
   low-pool teacher agendas to ready execution with durable term-rule metadata,
   and the admin replenishment queue now uses ready teacher agendas to
   prioritize and auto-enqueue review drafts without bypassing approval.
   Reviewed draft creation, approval, and promotion now write durable lifecycle
   status back onto the matching teacher agenda, and promoted agendas now mark
   the generation queue satisfied so already-reviewed replenishment pressure
   does not keep asking for another draft. Next, connect satisfied agenda loops
   to richer term/cohort summaries.
3. [#143](https://github.com/cenetex/app-ruby-high/issues/143): durable room
   outcomes now carry sanitized room titles, aggregate completion summaries,
   Study Spark reward labels, and a recent-outcomes admin health surface.
   Durable teacher agendas now carry aggregate execution status, reason, next
   action, and priority score with admin health counts. JSON/dev and
   SQLite-backed restart replay tests now prove sanitized events, outcomes,
   agendas, summary Study Sparks, and term-progress labels hydrate without
   private sessions. Term Momentum outcome records now preserve the term-rule
   label and reduced target for replay. Explicit term records now persist the
   current term's Spark totals, level, next threshold, active rules, per-grade
   progress lanes, actionable room-rule targets, public summary projection, and
   health surface. Next, promote term records into richer term/cohort entities
   instead of one school-year aggregate.
4. [#142](https://github.com/cenetex/app-ruby-high/issues/142): public-name
   review now blocks reserved, contact-info, empty, and unsafe student names
   from entering public rooms, filters already-visible unsafe names out of
   server projections, and explains the review in the account public-world
   control. The same gate now has regression coverage for shared live-room
   rewards, so reviewed names cannot earn public room progress while valid
   classmates can continue the goal. Public-world participant IDs are also
   pseudonymous `world:session:*` tokens across room presence, event visibility,
   and durable live-room contributor state. Next, carry that safety model into
   richer term progression rewards as public presence becomes more valuable.
5. [#141](https://github.com/cenetex/app-ruby-high/issues/141): continue
   broadening the teacher corpora and reviewer affordances once live-room and
   durable-world telemetry shows which grade/teacher pools are actually weak.
   Ruby, Sally Science, and Professor Edward now each have a fourth
   hand-authored source packet aimed at multiplayer/runtime, scientific systems
   constraints, or public seminar ethics respectively, with tests enforcing
   packet depth, seed coverage, and defensive copies.

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
