# Agent Directive — Next Improvement Passes: Judgment Is the Spine

**Date:** 2026-06-01 · **Status:** active work order for agent improvement passes
**Read this before touching the teaching loop, faculty voice, or grading.**

---

## The frame (don't skip — it determines what "better" means)

Ruby High's only defensible edge is **a faculty with taste that judges what you actually think** — opinion-judgment, in front of AI peers, through a real worldview (annihilism). That is the one thing a funded, focus-grouped competitor structurally cannot ship.

Today the product buries that edge: multiple-choice trivia is the spine, opinion-judgment is a "break up the rhythm" garnish (`pose_opinion` is scoped to *once every 3-5 questions* in `src/services/chat-service.ts`), grading is a neutral comparative rubric, and faculty personality is an outsourced `bio`/`accent` field on content packs (`src/services/faculty-service.ts`). That is the commodity wearing the spine, and the moat hiding in the corner.

**The product is pre-revenue. Building is not the constraint — demand is.** The viral/paid object is *the verdict*: the brutal-brilliant thing Ruby says about someone's opinion that they screenshot and share. Every pass below bends toward making that verdict exist, sting, and spread.

**⛔ The cardinal rule: DO NOT make the judgment nicer, safer, more encouraging, or more "balanced."** The edge IS the unpleasantness — disdain you respect, calibrated so the sting is *earned* and approval is worth chasing. A "kinder rubric" or "supportive feedback" change is a regression and must be reverted. Aim cruelty at mid thinking, never at the person's identity/protected traits.

---

## Pass 1 — Invert the loop (judgment becomes the spine)

**What:** Make opinion-judgment the default, recurring core of a class session; demote MCQ to occasional texture (or cut it where it adds nothing). Flip the cadence: opinion rounds are the rhythm, MCQ is the break — the inverse of today.

**Where:** `src/services/chat-service.ts` — the `pose_opinion` / `pose_question` tool descriptions and the teacher turn policy that decides which fires. The room-scene assembly (~line 1095) and the opinion round flow (NPC responses → callback grade, ~lines 642-691).

**Verify:** A test over a simulated session asserts opinion rounds are the majority of graded turns (not ≤1-in-5). Keep the existing AI-peer comparative structure — being judged *against* peers is a feature; preserve it.

## Pass 2 — Rewrite the verdict (the 20-minute test that proves or kills this)

**What:** Replace the neutral "grade them comparatively against a rubric" instruction with a **house-voice verdict prompt**: a brilliant mentor with contempt for mid takes who (a) names the specific weakness in the student's opinion, (b) says what a *real* answer would have done, (c) judges through the worldview, not a neutral rubric, and (d) ranks the student honestly against the AI peers. Earned sting, real standard, zero generic praise.

**Where:** the grading callback in `src/services/chat-service.ts` (the system calls the teacher back to grade after an opinion round opens).

**Target shape (adapt, don't paste verbatim):**
> You are {faculty}. A student gave an opinion in front of the class. You have taste and a worldview, and you do not hand out participation credit. Say the truest useful thing about their take — including why it's mid if it is — and what a stronger answer would have done. Rank them honestly against the other students. Never generic, never cruel about the person, always cruel about lazy thinking. One verdict worth screenshotting.

**Verify:** snapshot/judge test asserts a graded verdict (a) cites a *specific* weakness or strength (not "good job"/"nice effort"), (b) states what a stronger take would do, (c) is not generic praise. A "no-platitudes" check fails the build if the verdict is interchangeable across different student answers.

## Pass 3 — Canonical Ruby (stop renting the soul)

**What:** Bake a canonical house faculty voice (Ruby) with the worldview *in her judgment*, shipped as product — not a blank `bio`/`accent` filled by pack data. Content packs *extend* the canon; they don't supply the default personality. The philosophy (annihilism / Emperor Qiao) must be **load-bearing in how she judges**, not lore in a corner.

**Where:** `src/services/faculty-service.ts` (`toFacultyMember`, faculty assembly), wherever the default/system faculty are seeded.

**Verify:** with no custom pack loaded, the default session has an unmistakable, consistent house voice (a test asserts the default faculty carry a non-empty canonical persona + worldview, not an empty/generic default).

## Pass 4 — The verdict is the product (make it shareable + the thing people pay for)

**What:** Turn the verdict into the artifact. The shareable/NFT/diploma should commemorate **a verdict worth bragging about** ("Ruby said mine was the only real take in the room"), not mere completion. Make the verdict easy to screenshot/share by design.

**Where:** NFT/diploma generation in `src/services/ruby-high-service.ts` (`kind: "grade-diploma"`, portrait/diploma/class-photo paths); the post-round UI that surfaces the verdict.

**Verify:** the share/diploma artifact embeds the verdict text/rank, not just a name+grade. (Monetization framing — buyers pay to be judged *well* by a judge whose standards are real; the diploma is proof you earned it.)

---

## Guardrails (apply to every pass)
- **Never sand off the edge.** Softening the verdict = regression. If unsure whether a change makes Ruby *nicer*, it does — don't ship it.
- Keep the AI-peer room scene (comparative judgment is the drama).
- Cruelty targets weak thinking, never the person's identity or protected characteristics; no harassment, no slurs — *taste*, not abuse.
- Don't add more MCQ banks, store features, or polish before Pass 1-2 land. The next dollar comes from the verdict, not more commodity content.
- Encode each pass's acceptance check as a test so it can't silently regress.

## Definition of done for this directive
Pass 1 + Pass 2 shipped and gated by tests; a fresh session's graded opinion verdict is specific, worldview-driven, screenshot-worthy, and unmistakably Ruby — with no generic praise anywhere in the grading path.
