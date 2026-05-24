# Ruby High 2.0 C Architecture Review

Date: 2026-05-21

## Verdict

The C wedge is now strong enough to support a legal-option ranker spike and a
graphical UI scaffold. It is not yet ready for large authored years, durable
ranker training, or fully agentic school simulation until the content pipeline,
trace contract, and replay surface are frozen.

The important line is this: rankers may order legal choices, choose legal NPC
agendas, and choose which legal LLM branches to pre-generate. Rankers must not
create choices, mutate state, invent room presence, or decide durable outcomes.
The deterministic engine remains the authority.

## Current Boundaries

### Deterministic Engine

`ruby2_engine` owns durable state:

- clocks, items, affinity, discipline counts, virtue counts
- active room, time block, unlocked rooms, companion
- Yearbook candidates and archetype resolution
- shared effect payload application
- gate evaluation over flat state variables

This boundary is sound. Every durable mutation should keep flowing through
`Ruby2EffectPayload` or a narrow world command resolver.

### MUD-Shaped World Kernel

`ruby2_world` owns spatial truth:

- room graph
- NPC placement
- object presence
- legal action discovery
- command validation
- event queue
- bounded micro-agent intents

This is the correct shape for Ruby High as a world instead of a scripted
transcript. The current implementation is still content-in-C, but the interface
is close to what a content compiler should generate.

### Ranker Boundary

`ruby2_ranker` is intentionally low-authority:

- accepts an already legal candidate list
- encodes fixed features
- sorts candidates with a deterministic linear model
- writes trace JSONL for replay/training
- rejects inconsistent selected-action traces

This matches the useful pattern from tiny rankers: the model ranks only legal
options. It can improve pacing and priority without becoming the rules engine.

### UI Snapshot Boundary

`ruby2_ui` builds a read-only snapshot:

- current room and time block
- clock and discipline reads
- present people and objects
- ranked or unranked legal actions
- visible events

This is the right first graphical-client boundary. A renderer can consume the
snapshot without knowing how schedules, agents, or state mutation work.

### LLM Boundary

The LLM layer remains performance-only:

- speech-bubble lines
- occasional smooth mind pass
- background pre-generation for visible branches
- authored fallback when output is malformed or slow

The LLM should not receive raw technical state names as the primary prompt. The
future prompt layer should wake the avatar with human-readable first-person
context, then ask for one line out loud.

## Scaling Gaps

### Content Is Still Embedded In C

The world kernel has the right API shape, but rooms, action labels, agenda
rules, and beat outcomes are still compiled directly into C. That will not scale
to a school year. The next major architecture move is a data compiler that emits
validated C tables or compact binary packs.

Required generated surfaces:

- rooms and exits
- object placements
- NPC schedule overrides
- legal action templates
- approach labels
- effect payloads
- agent agenda rules
- UI string tables
- ranker feature metadata

### Action IDs Are Still A Transitional Constraint

The command path means the engine no longer needs to stay one enum forever, but
the current query layer still exposes closed `Ruby2WorldActionId` values. That
is fine for Wedge 0. It will be too rigid for authored years unless action IDs
become content IDs or compiler-assigned stable integers.

### Ranker Traces Need Player Selection Hooks

The trace writer exists, but the playable loops do not yet emit traces when a
human or scripted test selects an action. Until that is wired, the ranker is a
scaffold, not a learning system.

Minimum trace fields:

- schema and feature encoder version
- replay-stable state hash
- task name
- legal candidate IDs
- feature vector or feature encoder reference
- ranked indices and scores
- selected candidate
- optional target candidate
- post-choice utility label, when available

### Replay Needs A Stable Content Version

`ruby2_ranker_world_state_hash` now hashes stable state fields instead of raw
struct memory, but full replay still needs content-pack versioning. A ranker
trace without the exact content pack cannot be safely replayed after authors
change action labels, room schedules, or effect payloads.

### LLM And World Demos Are Still Separate

`play-world` proves the world kernel. `play-llm` proves bounded performance
generation. The next vertical slice should consume world events, build
performance packets, optionally pre-generate legal branch reactions, and return
to the world reducer after player choice.

## Ranker Roadmap

### 1. UI Action Ranker

Purpose: order legal player actions so the graphical UI can surface the most
context-relevant options without hiding the full legal set.

Allowed inputs:

- world snapshot
- legal actions from `ruby2_world_query_actions`
- current clocks, room, time block, present objects and people

Forbidden:

- adding actions
- removing legal actions for difficulty reasons
- mutating state

### 2. LLM Pregeneration Ranker

Purpose: decide which already visible branch consequence should be generated in
the background while the player reads choices.

Allowed inputs:

- visible branch list
- current scene importance
- prior cache hits
- local latency budget

Forbidden:

- generating hidden branches that are not legal
- changing authored outcomes
- blocking the player if pregen misses

### 3. Agent Agenda Ranker

Purpose: choose among legal NPC agenda intents during semi-open school time.

Allowed inputs:

- agenda table filtered by trigger and co-presence rules
- character schedule
- room and object state

Forbidden:

- teleporting NPCs
- speaking when not co-present
- overriding required beat placement

### 4. Yearbook Candidate Ranker

Purpose: order milestone-only Yearbook candidates for weekly review.

Allowed inputs:

- explicit milestone candidates
- candidate score features
- repetition and rarity features
- callback availability

Forbidden:

- creating candidates from ordinary hallway noise
- sealing entries without a ritual or explicit player choice

## Cleanup Priorities

1. Move content tables out of handwritten C.
2. Emit ranker traces from every scripted and interactive choice.
3. Merge `play-world` and `play-llm` into one vertical slice.
4. Replace enum-only action IDs with content-compiled IDs.
5. Add replay tests that rebuild a ranker decision from trace input.
6. Add a tiny trainable ranker backend behind the current linear scorer.
7. Keep the UI boundary snapshot-first until sokol or another renderer is worth
   introducing.

## Architectural Rule

Ruby High should feel alive because the school exposes legal possibilities,
characters react inside strict world rules, and small rankers improve timing.
It should not feel alive because opaque models are secretly deciding what the
school is.
