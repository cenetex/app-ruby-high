# Ruby High — Distribution Plan

> How to open the funnel for a pre-traction, character-driven AI school game,
> written for a team whose strength is building, not marketing.

## 0. Operating Principle

**Turn distribution into a building problem.** A builder will not out-hustle
marketers at posting. But a builder can (a) ship a share loop that does the
distribution for them, and (b) narrate the build, which needs no marketing
skill. Lead with those two; treat paid/awareness motions as secondary.

**Measure before you fill.** v1 is already instrumented (activation funnel +
return, keyed by `visitorHash`). The order is: seed a small trickle -> watch
where they drop -> patch the leak -> *then* open the top. Pouring traffic into an
unmeasured funnel wastes the one shot you get with each audience. Most
"distribution is hard" pain is a leaky middle, not a narrow top.

## 1. The Funnel

| Stage | Question | Current State |
|---|---|---|
| Awareness | Does anyone know it exists? | ~nobody yet (real, but not the first fix) |
| Trial -> Aha | Does the first 60 seconds land an undeniable moment? | the moment is a funny, personalized AI teacher/classmate reaction; if it arrives at minute 5, every channel converts worse |
| Aha -> Return | Does the memory -> tomorrow loop pull them back? | the core retention thesis (lesson -> memory -> changed tomorrow) |
| Return -> Share | Does playing *produce* something worth posting? | `yearbook_copy` exists; the loop is half-built |
| Monetize | NFT/CCG, Hall Pass | additive only; never gates/bribes the loop (see Monetization) |

The fastest wins are in the middle (Trial->Aha, Return->Share), and they are all
**building tasks**.

## 2. Funnel Openers, Ranked

1. **Yearbook / character-reaction share loop (the unfair advantage).** The
   product *generates* shareable artifacts: your character, your report card, a
   sealed Yearbook page, and especially **AI teacher/classmate reactions**
   (personalized, novel, screenshot-able — Noor's deadpan roasts and Professor
   Edward's verdicts are built for this). Each share is a free ad with a link
   back. `yearbook_copy` is already instrumented. This is content marketing where
   the content is a byproduct of play, so it costs no marketing labor.
   *Honest caveat:* loops rarely reach k>1; treat as amplification + measurable,
   not a growth explosion. It still needs a seed trickle at the top.

2. **Build in public (the builder's cheat code).** Don't market — narrate making
   it. "I built a school where AI teachers grade you in their own voice." Post
   the cast, the weird outputs, the dev moments; clip characters for short-form
   (TikTok/Reels), where AI-character content has rare organic reach. Compounds;
   needs no existing audience to start.

3. **Show up where the audience already is.** Joining existing rooms beats
   building a megaphone: relevant Discords, subreddits (studytok-adjacent, cozy
   games, AI tools), and the existing $RUBY/crypto community for buzz and funding.
   **Tag the crypto cohort separately** so incentivized users never pollute the
   organic retention read.

4. **One launch spike** (Show HN / Product Hunt / a fitting subreddit) — run as a
   *measurement event* for Trial->Aha conversion, not a durable strategy.

5. **Seed 3-5 creators** with a custom character or pack. One study / cozy-game /
   AI creator beats 10k bought clicks at this stage.

6. **Paid ads: not yet.** Do not buy traffic until D1 retention clears a bar;
   CAC before proven retention is filling a leaky bucket.

## 3. Two-Week Starter

- **Week 1 (build):** make the first 60 seconds undeniable (fast character ->
  funny AI reaction); make sharing one tap -> branded image + URL; confirm
  funnel/share events fire.
- **Week 2 (seed + read):** push ~100-300 organic, non-incentivized people
  through it (build-in-public + a couple of communities + one launch spike). Do
  not optimize awareness — read the funnel, find the single biggest drop, fix
  that one thing. Repeat.

## 4. Measurement

Use the existing v1 instrumentation; add one or two steps for the v2 memory loop.

- Activation: `first_character_created -> first_question_answered ->
  first_daily_class_passed`.
- Return: `app_open` / `session_resume` / `visitor_seen` -> compute D1/D7 per
  `visitorHash`.
- Share loop: `yearbook_copy` (and a `share_artifact_created` /
  `share_link_visited` pair if/when the one-tap share ships).
- **Cohort tags (required):** wallet-connected / NFT-holder vs. organic;
  incentivized vs. not. Read retention on the organic, non-incentivized segment.

**Primary metric to move:** unique visitors who complete a first class, record a
first memory, and return after 24h — read on the *organic* cohort.

## 5. Monetization Boundary (so distribution stays clean)

The token/NFT layer is **monetization-side and additive**: NFT/CCG sold for
memecoins, NFTs burnable for Hall Passes, a $RUBY->RUBY burn-to-mint migration —
and **no earn-to-play rewards.** Paying people to do the thing you're trying to
measure (log in, complete a class) measures the bribe, not the game. Keep
incentives off the retention metric, and keep owned/NFT cards from gating or
advantaging the core loop.

## 6. One-Line Frame

Your distribution strategy is **a great share loop + a tight first 60 seconds +
narrate the build** — three building tasks — plus a small seed to measure.
Volume comes *after* the middle converts.
