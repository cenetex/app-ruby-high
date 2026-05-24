# Ruby High 2.0 — Design Doc Revision Report

> A product-level review of `ruby2/DESIGN.md`, grounded against the live v1
> codebase. Written for the design doc authors as a revision brief: what to
> preserve, what to add, and what to reconcile.

## 0. Scope

This report reviews `ruby2/DESIGN.md` (the v2 design) at the product/strategy
level — not line edits to scripts or schemas. Findings are grounded in the
current v1 implementation (the Node service + PWA), which is **largely
feature-complete and instrumented**, and is intended to serve as the retention
test bed once there is traffic.

The doc is strong craft. Most of this report is about **strategic decisions the
doc leaves implicit** and **sections that are missing entirely** (distribution,
monetization), not about fixing what's there.

## 1. Executive Summary

1. **The retention thesis and the "deterministic underneath, magical on top"
   posture are correct. Preserve them.** The spine `lesson -> result -> social
   meaning -> memory -> changed tomorrow` is a real retention engine.

2. **The doc never names its central strategic bet.** v2 quietly converts a
   *scalable AI-breadth* product (v1: infinite subjects/questions) into an
   *unscalable hand-authored-depth* product (one charming year). That is a
   deliberate, defensible bet — but it must be stated as a top-level decision,
   because it reshapes content cost, team, and addressable market.

3. **"Scalability" should be reframed as a sequencing question, not a strategy
   question.** The product is pre-traction. With no retention data yet, every
   dollar spent on authored depth is unmeasurable faith. Keep the engine and
   pipeline cheap/scalable; make Year One small and hand-made; treat "can we
   scale authored depth?" as an explicit graduation gate *after* a positive
   retention read.

4. **Distribution is the current binding constraint, and the doc is silent on
   it.** No amount of design resolves "if we get users." The doc needs a
   go-to-market section.

5. **Monetization is a hole.** The actual model — NFT/CCG sold for memecoins,
   NFTs burnable for Hall Passes, a $RUBY->RUBY burn-to-mint migration, and
   explicitly **no earn-to-play rewards** — is not in the doc. It must be, with
   one hard design line drawn (Section 4.4).

6. **The build plan is a good *build* sequence but a poor *learn* sequence.** It
   constructs nearly the whole machine before real users produce a retention
   number. The retention read should be pulled forward using v1.

## 2. What The Doc Gets Right (Preserve)

These are load-bearing strengths. Revisions should not weaken them.

- **The retention spine** (Section 1.5) and the "utility becomes ritual /
  failure becomes material / AI stays on rails" framing.
- **Server authority and the determinism constraint** (Sections 6.1, 15). This
  is what keeps AI cost and incoherence bounded and is the right architecture.
- **The anti-cosmetic-mechanics rule** (Section 3.9: "nonblocking does not mean
  cosmetic"). Keep enforcing that every mechanic has real, nonblocking teeth.
- **The Yearbook scarcity model** (Section 3.7): 15-25/year, sealed in-fiction,
  every sealed artifact must unlock a downstream callback. This is excellent and
  is also the seed of the growth loop (see 4.3).
- **"What This Is Not" (Section 1.4)** and the content authoring discipline
  (Section 5.10: authored peaks, templated valleys). Keep.
- **The wallet/game-state separation principle** already stated in the doc
  ("keep story item charges separate from paid wallet credits"; Office Pass !=
  Hall Pass). This is the precedent the monetization section should build on.

## 3. Grounding: What v1 Already Measures

Confirmed in the v1 code (`src/services/ruby-high-service.ts`,
`src/routes/metrics-events.ts`):

- **Activation funnel**, keyed by `visitorHash`:
  `first_character_created -> first_question_answered ->
  first_daily_class_passed -> first_essay_submitted -> first_grade_completed`,
  with a "first 10 minutes" activation window.
- **Return signal**: `app_open`, `session_resume` (with `inactiveMs`),
  `visitor_seen` — enough to compute D1/D7 per visitor.
- **Yearbook engagement**: `yearbook_open`, `yearbook_copy`.
- Metric events carry arbitrary `metadata`, and wallet-connected state is
  knowable per session — so **cohort tagging is feasible today**.

Implication for the doc: of the stated primary success metric ("complete a first
class, record a first memory, return after 24h"), v1 already measures *first
class* and *24h return*. The **only missing instrument is the per-day memory
loop** (the Notebook trace is a v2 concept; v1 has only the Yearbook). That is
one or two new funnel steps — cheap. The doc should note that the v2 thesis is
testable on v1 with minimal instrumentation, not a from-scratch measurement
build.

## 4. Strategic Gaps Requiring Revision

### 4.1 Name the breadth-to-depth bet explicitly (new subsection under Section 1)

The doc reads as if v2 is purely an upgrade. It is also a strategic narrowing:
trading infinite-subject AI breadth for one hand-authored year. Add a short
subsection that states this as a chosen bet, with its consequence: the moat
becomes the authored, characterful year (hard to copy) rather than question
volume (a commodity that anyone can generate — and the very thing that makes
quiz apps decay). Make the tradeoff explicit so it is owned, not stumbled into.

### 4.2 Reframe scalability as sequencing under uncertainty (revise Section 5.10 / add to Section 11)

Add the operating principle: **pre-traction, do not pay for authored depth, and
do not destroy scalability — keep both cheap to reach.** Under genuine
uncertainty, scalable/cheap is the option-preserving path; authored depth is the
irreversible, expensive bet. Document a **graduation gate**: the team does not
commit to four authored years until a Wedge -1/0 retention read shows the
loop retains *and* the pipeline can produce Year Two at a fraction of the human
cost while keeping the peaks feeling hand-made.

State the two traps plainly:
- Over-scale Year One -> generic mush that disproves the thesis before it is
  tested.
- Under-scale the pipeline -> a gorgeous Week One that caps out because Year Two
  costs a writing room (the doc's own "Content Treadmill" risk).

### 4.3 Add a Distribution / Go-To-Market section (NEW — currently absent)

The doc has no distribution thinking, yet "get users" is the binding constraint.
Add a section that distinguishes two goals and prioritizes the first:

- **Goal A — a clean retention cohort** (a few hundred *organic,
  non-incentivized* users is enough to validate the thesis).
- **Goal B — raw growth/buzz/liquidity** (what the token community provides).

Recommended channels, ranked by fit for a cozy AI-character edutainment product:

1. **Yearbook/character share loop (product-led, highest leverage).** Already
   half-built (`yearbook_copy`). A shareable identity artifact (your character,
   report card, sealed page) is the natural viral mechanic and is on-thesis
   (memory -> identity -> share -> a friend asks "what is this?"). This is also
   the *right* home for token/ownership integration (see 4.4).
2. **Cast-forward short-form video.** The characters are the hook; lead with
   them, not with "AI tutor."
3. **Creator/niche seeding**, not paid ads.
4. **A one-time launch spike** (Show HN / Product Hunt / fitting subreddits) as a
   *measurement event* for activation, not a durable strategy.

Document the discipline: **do not buy paid traffic until D1 retention clears a
bar** (CAC before proven retention is filling a leaky bucket), and **tag the
crypto-community cohort separately** so incentivized users never pollute the
organic retention read.

### 4.4 Add a Monetization & Token/CCG section (NEW — currently a hole)

The doc barely mentions money and explicitly makes Office Pass *not* paid, but
the real model is unstated. Document it:

- **NFTs are the CCG cards**, sold for memecoins.
- **NFTs are burnable for Hall Passes** (existing in-game premium currency).
- **A $RUBY -> RUBY burn-to-mint migration** (token redenomination), a treasury
  action separate from gameplay.
- **No earn-to-play / token rewards.** (Important: this is what keeps the
  retention signal clean. State it as a deliberate principle, not an omission.)

**The one hard design line the doc must draw** (extends the existing Office
Pass / Hall Pass separation): the token/NFT layer is **additive — ownership,
collection, identity, cosmetics, premium, community status — and must never
gate or mechanically advantage the core retention loop.** Specifically, reconcile
this with Section 4 ("Cards As Mechanics"), which currently treats
student/teacher/location/item cards as the interaction model but says nothing
about which cards are owned/NFT or how ownership touches gameplay. The doc must
state:

- Whether owned/NFT cards confer any gameplay effect, and if so, that it is
  cosmetic/identity, not pay-to-win. If owned cards advantage play, that
  reintroduces the exact "gate/bribe the loop" problem and pollutes retention —
  it must then be a deliberate, segmented, measured decision.
- That the **Yearbook-as-owned-artifact** is the natural, on-thesis place for
  token/ownership integration (identity + the share loop in 4.3), as opposed to
  combat/progression advantage.
- A **cohort-tagging requirement**: wallet-connected / NFT-holder users are
  tagged so monetization activity does not contaminate the retention read.

### 4.5 Resolve the edtech-vs-game identity (revise Section 1.5 and 3.10)

Section 3.10 moves the core interaction from "answer A/B/C/D" to "choose an
approach (Source/Sense/Signal/Sync)." This is a strong RPG verb, but it can let
a player progress by choosing a *vibe* rather than demonstrating knowledge —
which quietly erodes the educational claim that v1 was built on. The doc should
state, explicitly:

- Who the user/buyer is and whether they value *mastery* or *a cozy narrative
  game that contains learning*.
- Whether approach-choice and answer-correctness are decoupled, and if so, how
  the product still substantiates "you learned something" (or whether it
  deliberately no longer claims to).

### 4.6 Address rails-vs-divergence in Year One (revise Section 3.11 / 1.7)

Section 1.7 fears "same year, different captions = still CYOA," yet Year One
gives the player only one free-block slot per day, so the required spine is the
overwhelming majority of what a new player touches and all divergence lives in a
thin, skippable layer. The doc should quantify the target: **what fraction of
the first ten sessions is genuinely divergent vs. flavored rails**, and confirm
that the RPG promise is real where it matters most (onboarding), not only in
later years most players never reach.

### 4.7 Convert the build plan into a learn-first sequence (revise Sections 11-12)

The wedge plan builds scene contract, render, classroom, social, Null, mobile,
and open campus before real users yield a retention number (Phase 10). For a
pre-traction product, pull the retention read forward:

- Ship the **thinnest authored slice (Week One, text/web, no C client, no
  Captain Null, no companions)** to a cohort of existing/early users and measure
  the doc's own primary metric head-to-head against the current quiz experience.
- **Critical caveat:** the slice must contain the actual differentiator — the
  class result must feed a social beat, which writes a memory, which changes
  tomorrow's opening. A slice missing that loop will produce a flat read and
  wrongly "disprove" depth.
- Keep everything expensive (C client, Null arcs, four authored years)
  downstream of that single signal.

### 4.8 Reconcile the client-platform contradiction (revise Sections 9, 11.8)

The wedge plan marches toward a custom C/native client, while the v1 README
states native is *intentionally out* of the current "retention-truth build"
until web data justifies it. These conflict. The doc should declare whether the
`ruby2/c` engine is a **headless deterministic-core proving ground** (keep — low
risk) or **the client** (expensive, premature pre-traction). Custom C text
rendering is one of the doc's own top risks; do not commit to it as the client
before the loop retains on web.

### 4.9 Clarify v1 -> v2 migration and cannibalization (expand Section 12)

The doc says "migrate behind a feature flag" but not the product relationship:
does v1 sunset, coexist, or become a mode within v2? What happens to existing
players, packs, the Hall Pass economy, and the NFT/token rails during
transition? State the intended end-state and the handling of in-flight value.

## 5. Suggested Edits By Section (quick map)

| Doc Section | Recommended Change |
|---|---|
| 1 (Product Decision) | Add subsection naming the breadth->depth strategic bet (4.1) and the edtech-vs-game identity decision (4.5) |
| 1.7 / 3.11 | Quantify rails-vs-divergence for the first ten sessions (4.6) |
| 3.10 | State whether approach-choice decouples progress from knowledge, and the consequence for the learning claim (4.5) |
| 4 (Cards As Mechanics) | Reconcile with the NFT/CCG model: ownership = additive, not pay-to-win (4.4) |
| NEW section | Distribution / Go-To-Market (4.3) |
| NEW section | Monetization & Token/CCG model + the additive-not-gating line + cohort tagging (4.4) |
| 5.10 | Add the pre-traction sequencing principle and the scale-depth graduation gate (4.2) |
| 9 / 11.8 | Resolve C/native-client vs web-first contradiction (4.8) |
| 10 (Metrics) | Note v1 already measures activation+return; only the per-day memory step is missing (Section 3 above) |
| 11-12 (Build Plan / Phasing) | Reorder to a learn-first sequence; pull the retention read forward onto v1 (4.7); clarify v1->v2 migration (4.9) |

## 6. Priority

If revisions are time-boxed, do them in this order:

1. **Distribution section (4.3)** and **Monetization/Token section (4.4)** — the
   two missing sections; without them the doc omits the constraints that
   actually decide success right now.
2. **Sequencing/graduation gate (4.2)** and **learn-first build plan (4.7)** —
   these prevent over-investing in authored depth before it is validated.
3. **Name the strategic bet (4.1)** and **edtech-vs-game identity (4.5)** — make
   the implicit explicit so the team is choosing, not drifting.
4. **Rails-vs-divergence (4.6)**, **client contradiction (4.8)**, **migration
   (4.9)** — important clarifications, lower urgency.

## 7. One-Line Frame For The Authors

The design craft is not the risk. The risks are: (a) committing to an
unscalable authored-depth product before any retention proof, (b) having no
distribution plan for a pre-traction app, and (c) leaving the token/CCG
monetization undocumented so its one dangerous coupling (pay-to-win cards
gating/bribing the core loop) is never explicitly ruled out. Revise to make
these three things explicit and decided.
