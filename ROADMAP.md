# Ruby High · Revenue Roadmap

**May 27, 2026** — written the day everything else was shut down.
**Re-sequenced May 29, 2026** — measurement pulled to the front; distribution reframed
as a pipeline (see [`docs/MARKETING.md`](./docs/MARKETING.md)).

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
| Monthly revenue covers Fly + DynamoDB | Self-sustaining |

---

## What we're not doing

- No new teachers. Three is enough until retention data proves demand.
- No multiplayer, tournaments, or Faculty Cup. Premature until the core
  loop converts.
- No public pack marketplace. Community packs are later, not now.
- No new infrastructure. Fly + DynamoDB + S3 is the stack. No queues,
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
