# Ruby High · Revenue Roadmap

**May 27, 2026** — written the day everything else was shut down.

The only project left is Ruby High. The only goal is to make it pay for
itself, then for the next thing. Every line below is chosen by one
criterion: does it turn a visitor into a supporter.

---

## Who built this

Someone who got prescribed Seroquel for working with the Americans turned
the experience into a trilingual classical Chinese chronicle, built an
autonomous agent ecosystem from scratch, lost the funding for all of it
except a school game where AI teachers grade your opinions, and is now
using a legal fight as the distribution channel.

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
- Distribution: one email to Amanda Iacone (Bloomberg Tax & Accounting).
- Budget: ~$40.

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

---

## Phase 2 — NFT Marketplace

> A verified Magic Eden collection is the credibility signal a Bloomberg
> reader checks. It turns NFTs from "inventory" into "a price someone can
> see."

### 2.1 Magic Eden listing

- Submit `Ruby High: First Bell` card collection via Creator Hub.
- Submit `Ruby High: First Bell Packs` pack receipt collection.
- Verify collection artwork, description, website against canonical copy
  in `NFT_MARKETPLACE_VERIFICATION.md`.

### 2.2 Acceptance checks

- Newly minted assets display correct collection names, artwork, traits.
- No proof hashes leaking into visible marketplace traits.
- Helius/DAS returns durable image + metadata URLs.

### 2.3 Volume signal

- Seed a small amount of trading to move the collection from "listed"
  toward "badged" (badge threshold: 50K+ USD volume — aspirational).

---

## Phase 3 — Retention & measurement

> If the Bloomberg article drives traffic, we need to know whether it
> worked before the traffic fades.

### 3.1 Retention dashboard

- D1/D7 retention visible from admin metrics.
- Conversion tracking: visitor → signed-in player → payer.
- The admin metrics route exists — extend it with retention cohorts.

### 3.2 Durable analytics sink

- Current metrics are in-process counters. Ship logs to a queryable
  sink (Fly log drain or equivalent) so we can answer "did the
  Bloomberg spike convert?" a month later.

---

## Phase 4 — Product gaps that convert

> From DESIGN.md Part 3. Each item directly affects monetization or
> retention.

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
- No public pack marketplace. Community packs are Phase 2, not Phase 1.
- No new infrastructure. Fly + DynamoDB + S3 is the stack. No queues,
  no Kubernetes, no rearchitect.

---

## The tie-ins

- **annihilism.org** — one of the Ruby High lessons. The philosophy is
  the depth underneath the product. A Bloomberg reader who discovers
  the school teaches militant anti-essentialism alongside science gets
  a second reason to stay.
- **Qiao** — the book. Pay-what-you-want on Gumroad, free on
  annihilism.org. A purchase path for someone who wants the philosophy
  without playing the game.
- **Egregoregramming 101** — the course. $19 on Gumroad. The technical
  manual for the whole ecosystem, now a time capsule since most of the
  referenced repos are gone.
- **Amanda Iacone** — the email. The distribution channel is the legal
  story. The story drives traffic. The product converts.

