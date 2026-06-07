# Ruby High 2.0 PRD: NPC Goals, Plans, And Generative School Simulation

Date: 2026-05-24
Status: Draft for v2 implementation planning
Owner: Ruby High 2.0 game systems
Related docs: `ruby2/DESIGN.md`, `ruby2/c/README.md`

## 1. Summary

Ruby High 2.0 should feel like a school world, not a sequence of room panels.
The current C wedge has a good deterministic world kernel: rooms, exits, items,
NPC placement, event queues, validated intents, and ranked legal actions. The
missing layer is per-NPC agency.

Every NPC needs goals and short plans. A student should not merely appear in a
room and fire one authored line. They should have a reason to be there, a thing
they are trying to do, a plan that can succeed or fail, and memory that changes
future classroom and hallway behavior.

The target loop is:

```text
schedule creates co-presence
-> class or room pressure creates NPC goals
-> NPCs build short legal plans
-> the world validates intents
-> player choices and NPC choices resolve together
-> relationships, Notebook, and Yearbook candidates update
-> tomorrow's schedule and goals remember enough to feel continuous
```

This PRD extends the v2 design contract with an implementable goal/plan system
that learns from two existing codebases:

- Ruby High v1: class scenes, seated rosters, opinion rounds, MASH relationship
  cells, durable social events, and teacher prompts grounded in engine facts.
- Signal: ticked world simulation, local pressure, contracts generated from
  world need, NPC role/state loops, bounded knowledge, and deterministic replay
  harnesses.

## 2. Problem

The current v2 C slice is coherent but too authored and one-shot. It can produce
valid actions and room-specific blackboard moments, but the school does not yet
feel alive because NPCs do not own durable motivations.

Current limitations:

- NPCs mostly hold a room id plus a small list of fixed agenda flags.
- Agent selection accepts one ranked agenda intent per tick, then marks that
  agenda done forever.
- Classroom blackboard moments are resolved as single panels instead of social
  sessions with follow-up stakes.
- Affinity exists as a durable numeric field, but there is no relationship-cell
  history, no scratch/circle style status, and no reason trail.
- NPC behavior is not yet grounded in class session state, board state, room
  pressure, player history, or each NPC's own recent memory.
- Replay tests prove specific routes, not emergent school-day coverage.

The result is a prototype that can show school content, but not yet simulate a
school day.

## 3. Product Goal

Make Ruby High 2.0 feel like a small authored school where classmates pursue
simple goals inside deterministic rules.

The player should notice that:

- Lyra tries to verify answers and gets anxious when the item trail is weak.
- Ravi chases sources, lab facts, and weird mismatches.
- Indra waits for patterns, then gives decisive reads.
- Mika stabilizes the room and supports recovery.
- Noor punctures fake-normal behavior and turns contradictions into jokes or
  clues.
- Sami avoids effort until cynicism becomes useful.
- Ruby keeps the school day legible and pulls the class back to the lesson.

The system does not need large-language-model autonomy to achieve this. It needs
server-owned goals, short plans, validated intents, and durable memory.

### 3.1 Governor-Controller Split

Ruby High should use a Governor-Controller architecture.

```text
+-------------------------------------------------------------+
| Narrative / LLM Governor                                    |
| - compiles character psychology into goal weights/settings   |
| - voices validated actions in character-consistent prose     |
| - summarizes memories during class transitions or overnight  |
+-------------------------------------------------------------+
                              |
                              v
                   structured JSON / C structs
                              |
                              v
+-------------------------------------------------------------+
| Deterministic Kernel / Controller                           |
| - validates NPC intents against movement and map rules       |
| - manages clocks, conditions, relationships, and schedules   |
| - restricts actions to legal verbs and replayable reducers   |
+-------------------------------------------------------------+
```

The Governor is slow and strategic. It may run during authoring, class
transitions, weekly review, or overnight cycles to update high-level settings:
goal weights, motive summaries, memory summaries, response style, and candidate
performance lines.

The Controller is fast and tactical. It runs every world step, validates
movement, path availability, co-presence, item visibility, relationship
formulas, clock ticks, and effect application. It never waits for an LLM before
an NPC can take a legal step.

All Governor output must be structured, versioned, replay-logged, and optional.
If the Governor is absent, slow, malformed, or contradicted by the validator,
the deterministic Controller uses authored fallback configuration and keeps the
school day moving.

## 4. Non-Goals

This PRD does not propose:

- freeform NPC chat
- unvalidated LLM-authored goals or durable outcomes
- random campus generation
- unbounded open-world simulation
- NPCs becoming combat enemies
- client-authoritative movement or state changes
- replacing authored year/day content
- a real-time walking simulator before route choice is meaningful

NPCs can feel agentic while remaining deterministic and bounded.

## 5. Design Inputs From Ruby High v1

Ruby High v1 already has the richer social loop. The v2 C implementation should
borrow these patterns, not throw them away.

### 5.1 Class Is The Social Unit

In v1, the classroom owns the social context: teacher, board, player, seated
classmates, question, stat, roster, and relationship state. That is stronger than
a generic map room because it makes learning and social reaction part of one
scene.

V2 should model `Ruby2ClassSession` as a first-class world struct, not infer a
class from a room plus a question flag.

### 5.2 NPCs Participate In Rounds

V1 pre-rolls seated NPCs for multiple-choice and opinion rounds. Their accuracy
and timing come from stats, not from the student-side LLM. This is the right
contract for v2:

- stats and deterministic rolls decide mechanical participation
- goals and plan state decide why an NPC cares
- LLM performance, if used, only voices a validated result

### 5.3 Relationship Cells Matter

V1's MASH layer gives every classmate a relationship cell. Cells tick up or down
from essay outcomes, best-responder status, applauder/rubber reactions, and
playbook effects. Cells can become circled or scratched, then feed Yearbook
resolution.

V2 should port the idea, not necessarily the exact MASH flavor:

```text
relationship cell = affinity + ticks + status + last touched reason
```

This gives NPCs durable social texture without needing a complex friendship sim.

### 5.4 Durable School Events Feed Performance

V1 teacher prompts receive engine-owned relationship state and recent school
events. The prompt can react to facts, but cannot invent or mutate them.

V2 should preserve the same boundary:

- world events and memories are engine-owned
- performance packets summarize them
- generated speech is flavor over validated facts

### 5.5 Social Cards Become Class Social Rounds

V1's social card concept is useful, but v2 should make it spatial and systemic.
After a board answer, the class should enter a short social round where seated
NPCs pursue goals such as support, challenge, ask for checkable item, joke, or withdraw.

## 6. Design Inputs From Signal

Signal demonstrates how a small C world can feel generative without giving AI
control over rules.

### 6.1 A Ticked World Beats A Trigger List

Signal's `world_sim_step()` advances many systems each tick: stations,
production, contracts, NPC ships, player input, collision, construction, and
recovery. Ruby High does not need real-time physics, but it needs the same
structural idea:

```text
one world step runs several deterministic systems in order
```

Ruby's equivalent should advance schedules, class sessions, room pressures, NPC
goals, NPC plans, memories, and player-facing events.

### 6.2 Local Pressure Generates Work

Signal stations generate prices and contracts from inventory pressure. Ruby High
rooms can generate social/learning pressure from local state:

- Homeroom pressure: schedule drift, class confusion, unresolved board state.
- Science Lab pressure: unverified variable, missing control, method conflict.
- Library pressure: source mismatch, catalog clue, quiet tension.
- Cafeteria pressure: rumor, social fallout, seating choices, Lunch Tray table mismatch.
- Courtyard pressure: First Bell theory hype, absence, recovery, ambiguous witness.
- Teacher Office pressure: stress, repair, missed class, institutional boundary.

These pressures should feed NPC goals and Notebook objectives.

For Captain Null, `Null Signal` remains the engine-facing pressure name.
Player-facing Notebook goals and NPC dialogue should usually call it First Bell
theory hype, ARG pressure, fandom over-reading, or pattern fever unless an
authored comic session is explicitly in progress.

### 6.3 Contracts Map To Notebook Goals

Signal contracts give players world-authored objectives. Ruby High should do the
same through the Notebook:

```text
room pressure -> Notebook objective -> NPC/player plan opportunity
```

Example:

```text
Science Lab pressure: hidden variable unresolved
Notebook goal: name the hidden variable before the bell
NPC goals: Lyra verifies, Ravi tests, Mika supports, Noor jokes if it looks fake
```

### 6.4 NPC Role Loops Map To Student Tendencies

Signal NPCs have roles and states such as miner, hauler, tow drone, docked,
travel, unload, and return. Ruby students need lighter equivalents:

```text
student tendency + current goal + short plan state
```

They should not have hundreds of states. A few reusable goal kinds and plan steps
are enough.

### 6.5 Replay Is A Product Feature For The Team

Signal's deterministic test harnesses make emergent systems debuggable. Ruby
High needs the same discipline. A social sim is not shippable unless we can run
seeded days and see coverage, deadlocks, repeated templates, invalid intents, and
unreachable quiz moments.

## 7. Target Player Experience

### 7.1 Moment-To-Moment

The player enters a room. The UI shows who is present, what the room is trying to
resolve, and which actions are available. NPCs do not talk constantly. They act
when their goals create a valid slot.

Example Science Lab beat:

```text
Sally posts a lab board problem.
Ravi wants to test the obvious variable.
Lyra wants to verify the control.
Mika wants the player to not freeze.
Noor suspects the worksheet is pretending to be normal.

The player chooses "Name hidden variable."
Lyra supports because it satisfies her verify goal.
Ravi challenges because his test goal wanted a direct experiment.
Notebook records the lab result and the social split.
The next Cafeteria beat can reference who trusted the player's reasoning.
```

### 7.2 Over A Day

NPCs should be legible over multiple beats:

```text
arrival: Ruby pressures player toward Homeroom
class: Lyra notices a weak method
passing: Lyra heads toward Library because her verification goal remains open
lunch: Noor references the class mistake only if she witnessed it or heard it
notebook: unresolved goals become tomorrow hooks or expire with a reason
```

### 7.3 Over A Week

The player should see that classmates have lives and trajectories:

- a classmate can miss a social beat because they are elsewhere
- a classmate can pursue a follow-up from yesterday
- repeated player patterns change which NPCs volunteer help or challenge
- Yearbook candidates reflect not just class success, but who was involved and
  why the moment mattered

## 8. Core Concepts

### 8.1 Goal

A goal is an NPC-owned desire with urgency, target, expiry, and reason.

Examples:

- attend Homeroom before bell pressure reaches 2
- verify the Cafeteria Lunch Tray table marker
- support player after a public miss
- challenge unsupported answer in Science Lab
- ask Indra about the Library/First Bell source mismatch
- recover stress in Greenhouse after social pressure
- tell Ruby about a Null Signal/Theory Hype symptom

Goals are deterministic. They are created by schedule, class sessions, room
pressure, recent memories, relationships, and authored overrides.

### 8.2 Plan

A plan is a short list of legal-ish steps toward a goal. It is not guaranteed to
succeed. Each step must be validated by the world before it mutates state.

Examples:

```text
Goal: verify Lunch Tray table marker
Plan: move Cafeteria -> inspect Lunch Tray -> speak if co-present -> remember seating clue

Goal: support player after miss
Plan: move to current room if reachable -> speak support line -> update memory

Goal: challenge board answer
Plan: wait for board resolved -> speak challenge -> set social response memory
```

### 8.3 Intent

An intent is one proposed action emitted from the current plan step. The world
validator accepts or rejects it. Rejection is data, not a crash.

### 8.4 Class Session

A class session is the live board and social state for a teaching room.

It owns:

- room
- faculty
- board problem
- phase
- seated NPC list
- player answer or approach
- NPC answer/approach locks
- social responders
- relationship deltas
- Notebook outcome
- optional Yearbook candidate hook

### 8.5 Room Pressure

Room pressure is local simulation state that creates goals and objectives.

Examples:

- `method_gap`
- `rumor_heat`
- `bell_pressure`
- `null_signal`
- `social_tension`
- `unresolved_source`
- `stress`
- `quiet_focus`

### 8.6 Memory

Memory is a bounded fact trail attached to NPCs and the school. It should be
small, structured, and authored enough to render safely.

Examples:

- Lyra remembers player named the hidden variable.
- Noor remembers the Lunch Tray table marker changed where people sat.
- Mika remembers player recovered after a miss.
- Indra remembers the Library sentence changed only in the Notebook margin.

## 9. Functional Requirements

### P0 Requirements

1. Every placed NPC has at least one active goal or an explicit idle reason after
   world init and after each schedule transition.
2. Every active goal can produce either a valid short plan or a structured
   failure reason.
3. NPC plans emit intents through the existing world intent validator; plans do
   not mutate durable state directly.
4. Class sessions select seated NPCs from resolved schedule/co-presence, not
   random spawning.
5. Blackboard quiz resolution creates a social follow-up phase when at least one
   seated NPC has a matching goal.
6. Relationship cells update from class/social outcomes with reason tags.
7. Notebook memory records meaningful class, social, and plan-failure outcomes.
8. Replay tests can run seeded school days and assert coverage.
9. LLM performance packets can voice accepted social responses but cannot decide
   goals, plans, placement, or outcomes.

### P1 Requirements

1. Room pressure fields create Notebook goals and NPC goals.
2. NPCs can carry unresolved goals across time blocks when not expired.
3. NPC memory changes future goal priority and reaction selection.
4. Multiple NPC intents can resolve in one world step if they do not conflict.
5. UI debug snapshots expose NPC goals, plans, and blocked reasons in dev builds.
6. Yearbook candidates can cite which NPC goal or class session created the
   moment.
7. Goal-plan rankers can order legal NPC intents but cannot create goals,
   invent plan steps, move NPCs, or write memories.

### P2 Requirements

1. Schedule omissions matter: optional social beats can expire or mutate if the
   player goes elsewhere.
2. NPCs can pursue small offscreen goals that become later rumors or Notebook
   hints.
3. A week-level simulation can report repeated template/cast triples and flag
   stale social patterns.
4. Ranker traces include goal/plan features for later pacing tuning.

## 10. Proposed C Data Model

Names are illustrative. Implementation can adjust for size and existing enum
style.

```c
typedef enum {
  RUBY2_NPC_GOAL_IDLE,
  RUBY2_NPC_GOAL_ATTEND_CLASS,
  RUBY2_NPC_GOAL_ANSWER_BOARD,
  RUBY2_NPC_GOAL_VERIFY_METHOD,
  RUBY2_NPC_GOAL_SUPPORT_PEER,
  RUBY2_NPC_GOAL_CHALLENGE_PEER,
  RUBY2_NPC_GOAL_INSPECT_ITEM,
  RUBY2_NPC_GOAL_SPREAD_OR_CHECK_RUMOR,
  RUBY2_NPC_GOAL_RECOVER_STRESS,
  RUBY2_NPC_GOAL_REPORT_ANOMALY
} Ruby2NpcGoalKind;

typedef enum {
  RUBY2_NPC_PLAN_STEP_WAIT,
  RUBY2_NPC_PLAN_STEP_MOVE,
  RUBY2_NPC_PLAN_STEP_SPEAK,
  RUBY2_NPC_PLAN_STEP_INSPECT,
  RUBY2_NPC_PLAN_STEP_REMEMBER,
  RUBY2_NPC_PLAN_STEP_JOIN_CLASS,
  RUBY2_NPC_PLAN_STEP_SOCIAL_RESPONSE
} Ruby2NpcPlanStepKind;

typedef enum {
  RUBY2_REL_NEUTRAL,
  RUBY2_REL_WARM,
  RUBY2_REL_STRAINED,
  RUBY2_REL_CIRCLED,
  RUBY2_REL_SCRATCHED
} Ruby2RelationshipStatus;

typedef struct {
  int8_t affinity;
  uint8_t ticks;
  Ruby2RelationshipStatus status;
  uint32_t last_touched_tick;
  uint16_t last_reason_tag;
} Ruby2RelationshipCell;

typedef struct {
  Ruby2NpcGoalKind kind;
  Ruby2RoomId target_room;
  Ruby2CharacterId target_character;
  Ruby2WorldItemId target_item;
  uint8_t urgency;
  uint32_t created_tick;
  uint32_t expires_tick;
  uint16_t reason_tag;
} Ruby2NpcGoal;

typedef struct {
  Ruby2NpcPlanStepKind kind;
  Ruby2RoomId room;
  Ruby2CharacterId character;
  Ruby2WorldItemId item;
  Ruby2AgentIntentKind intent_kind;
  uint16_t text_id;
  uint16_t reason_tag;
} Ruby2NpcPlanStep;

typedef struct {
  Ruby2NpcGoal goals[3];
  Ruby2NpcPlanStep plan[4];
  uint8_t goal_count;
  uint8_t plan_count;
  uint8_t plan_cursor;
  uint8_t idle_reason;
  int8_t mood;
  uint32_t last_plan_tick;
  uint32_t blocked_until_tick;
  Ruby2RelationshipCell relationships[RUBY2_CHARACTER_COUNT];
} Ruby2NpcRuntime;

typedef enum {
  RUBY2_CLASS_PHASE_NONE,
  RUBY2_CLASS_PHASE_INTRO,
  RUBY2_CLASS_PHASE_BOARD,
  RUBY2_CLASS_PHASE_APPROACH_LOCK,
  RUBY2_CLASS_PHASE_RESOLUTION,
  RUBY2_CLASS_PHASE_SOCIAL_ROUND,
  RUBY2_CLASS_PHASE_NOTEBOOK
} Ruby2ClassPhase;

typedef struct {
  bool active;
  Ruby2RoomId room;
  Ruby2CharacterId faculty;
  Ruby2ClassPhase phase;
  Ruby2WorldActionId board_action;
  Ruby2WorldActionId player_approach;
  Ruby2CharacterId seated[RUBY2_CHARACTER_COUNT];
  uint8_t seated_count;
  Ruby2CharacterId responders[3];
  uint8_t responder_count;
  uint16_t notebook_memory_tag;
  uint16_t yearbook_candidate_tag;
} Ruby2ClassSession;

typedef struct {
  int8_t bell;
  int8_t rumor;
  int8_t stress;
  int8_t null_signal;
  int8_t method_gap;
  int8_t social_tension;
  int8_t unresolved_source;
} Ruby2RoomPressure;
```

## 11. Simulation Loop

The world step should become a phased reducer. The order matters because each
phase constrains the next.

```text
ruby2_world_step()
  1. advance schedule/time-block if needed
  2. resolve required beat placement and class sessions
  3. update room pressure from clocks, items, memories, and board state
  4. refresh or expire NPC goals
  5. build or repair short NPC plans
  6. emit candidate intents from plan cursors
  7. rank and resolve non-conflicting intents through validator
  8. advance accepted plan cursors or record blocked reasons
  9. resolve class social rounds and relationship ticks
 10. commit visible/internal events and Notebook memory
```

### 11.1 Schedule Phase

Inputs:

- time block
- required beat cast
- active companion
- room unlocks
- authored overrides
- existing NPC plan reservations

Output:

- resolved NPC room placement
- absence reasons for expected-but-missing NPCs
- placement events only when visible or important

### 11.2 Pressure Phase

Inputs:

- current room
- board problem
- items present
- clocks
- last visible/internal events
- unresolved Notebook goals

Output:

- per-room pressure values
- Notebook objective candidates
- trigger tags for NPC goal refresh

### 11.3 Goal Refresh Phase

Goals are refreshed when:

- NPC has no goal
- active goal expired
- class session phase changed
- room pressure crosses threshold
- relationship event touches the NPC
- schedule transition changes co-presence
- authored beat grants an override

Goal priority score:

```text
priority = urgency
         + schedule fit
         + room pressure fit
         + relationship relevance
         + recent memory relevance
         + class session relevance
         - blocked cooldown
```

### 11.4 Plan Build Phase

Plan builder should be simple and deterministic.

Rules:

- plan length max 4
- do not pathfind beyond one room hop for first implementation
- if target room is unreachable, return blocked route reason
- if speech requires co-presence, include move/wait first or fail with not
  co-present
- if item absent, either move to known item room or fail with item absent
- if class session phase is wrong, wait or expire

### 11.5 Intent Resolution Phase

The existing validator remains authoritative. The planner proposes; the world
disposes.

Conflict rules:

- one visible speech bubble at a time unless in explicit social round
- required beat intents outrank ambient goals
- class social responders are capped by the class session
- two NPCs can move in the same tick if destinations are legal and no required
  beat cast is broken
- offscreen remember events can resolve without stealing the visible focus

### 11.6 Memory Commit Phase

Each accepted or meaningfully blocked plan can write one bounded memory if it
meets a memory threshold.

Memory-worthy examples:

- NPC supported/challenged the player in a class social round
- NPC inspected an item tied to a Notebook objective
- NPC failed to reach a room because the player missed a schedule opportunity
- relationship status changed
- First Bell theory pressure changed the room

Non-memory examples:

- ambient move with no player relevance
- repeated flavor line
- plan wait step
- failed duplicate intent

## 12. Class Session Design

A blackboard quiz should become a mini-session rather than a one-shot resolver.

### 12.1 Session Phases

```text
intro: teacher frames room problem
board: player sees four discipline-aligned approaches
approach_lock: player choice is accepted, NPCs may lock opinions
resolution: effect payload applies
social_round: 1-2 seated NPCs respond from goals/plans
notebook: memory and next objective are written
```

### 12.2 Social Round Inputs

- player approach
- class result
- seated NPC goals
- relationship cells
- room pressure
- relevant items
- recent school events

### 12.3 Social Response Types

```text
support: reinforces player's approach or recovery
challenge: asks for a checkable item or points out weakness
clarify: explains a clue or asks teacher to reframe
joke: relieves stress while preserving consequence
withdraw: avoids speaking, which can still be a social signal
witness: records the moment for Notebook/Yearbook context
```

### 12.4 Science Lab Example

Room pressure:

```text
method_gap = 2
unresolved_source = 0
social_tension = 1
```

NPC goals:

```text
Lyra: verify method
Ravi: inspect/test item
Mika: support peer
Noor: challenge fake-normal wording
```

Player chooses `Name hidden variable`.

Resolution:

- Source/Sense training applies.
- Lyra support response becomes likely.
- Ravi challenge response becomes possible.
- Notebook records hidden variable resolution.
- Relationship ticks apply to responders.

### 12.5 Library Example

Room pressure:

```text
unresolved_source = 2
null_signal = 1
quiet_focus = 2
```

NPC goals:

```text
Indra: detect pattern
Lyra: verify catalog source
Noor: joke if contradiction is public
Sami: avoid effort unless contradiction is obvious
```

Player chooses `Check timestamp`.

Resolution:

- Source/Signal trace applies.
- Indra can witness the pattern.
- Lyra may warm if the item check is careful.
- Notebook gets a stronger Day Five clue if the player copies exactly.

## 13. NPC Goal Profiles

These profiles guide default goal creation and response selection. They are not
hard locks. Room pressure and relationship history can override them.

| NPC | Default Desires | Plan Bias | Social Risk |
|---|---|---|---|
| Ruby | keep schedule legible, keep class humane, notice Null symptoms | move player toward required beat, frame lesson, remember important shifts | too much shepherding can feel like railroading |
| Lyra | verify, get it right, avoid public uncertainty | inspect source, ask for checkable item, challenge weak answer | can become scoldy if not balanced by anxiety |
| Sami | conserve effort, puncture over-seriousness, avoid looking invested | wait, joke, challenge only when contradiction is obvious | can feel inert without useful cynicism hooks |
| Ravi | chase weird facts, test claims, follow concrete items | inspect, move to lab/item, speak enthusiastic fact | can become noise if every fact is disconnected |
| Indra | detect patterns, speak rarely, protect precision | wait, observe, then deliver high-signal line | can feel omniscient unless item-gated |
| Mika | support peers, lower stress, help recovery | speak support, accompany, convert miss to next attempt | can become generic encouragement |
| Noor | name contradictions, turn social pressure into comedy | joke, challenge fake normal, remember the theory beat | can undercut stakes if overused |

## 14. Notebook And Yearbook Integration

### 14.1 Notebook

Notebook should show the operational layer:

- current room goal
- unresolved class clue
- who witnessed the last class/social beat
- which NPC has a relevant follow-up
- what expires at the next bell

Example Notebook text:

```text
Science Lab: You named the hidden variable. Lyra wrote it down twice.
Ravi still wants a control. Ask him before the bell or let it become lunch gossip.
```

### 14.2 Yearbook

Yearbook candidates should be created only from high-salience moments:

- class social split with strong relationship change
- first time an NPC goal meaningfully helps or blocks the player
- weekly ritual choice
- Null resolution
- recovery after public failure

A candidate should cite:

- source beat
- class session
- NPC witness/signature
- goal or pressure that made the moment happen
- mechanical/social/identity/callback score

## 15. UI And Debug Requirements

### Player-Facing UI

- Show present NPCs clearly enough that social response feels grounded.
- Show class social responses as individual witness bubbles, not generic chat.
- Show Notebook objective updates after class/session resolution.
- Avoid exposing raw goal debug text to players in normal mode.

### Dev UI / Snapshot

Add debug-only fields to UI snapshots or trace output:

```json
{
  "npcDebug": [
    {
      "id": "lyra",
      "room": "science_lab",
      "goal": "verify_method",
      "goalReason": "science.method_gap",
      "plan": ["inspect:lab_flask", "speak:support_source"],
      "cursor": 0,
      "blockedReason": null
    }
  ]
}
```

This is necessary to tune the system without reading C structs in a debugger.

## 16. Governor-Controller Boundary

LLM output belongs to the Governor side of the architecture. It can configure,
rank, summarize, or perform validated intent context. It cannot execute the
intent directly.

Governor cycles may:

- compile a character's recent memories into motive weights
- adjust priority among authored goal families
- produce a short daily memory summary
- choose which legal performance branch to pre-generate
- replace an authored fallback line with a validated in-character line

Controller cycles must still:

- create or admit concrete goals only through schema-valid tables
- emit concrete plan steps from legal templates
- validate movement, speech, inspection, memory writes, and relationship deltas
- reject impossible actions and record blocked reasons
- commit durable state through deterministic reducers

Allowed:

- turn `support_peer` into a short Mika line
- turn `challenge_peer` into a short Lyra line
- smooth a class session recap into a teacher voice line
- vary witness bubble text inside max length and schema
- propose updated goal weights during an overnight Governor pass, if the output
  validates and is stored in the replay trace

Forbidden:

- decide an ad hoc executable goal during a world tick
- move an NPC
- decide whether an NPC witnessed something
- decide affinity deltas
- decide Notebook or Yearbook content IDs
- create a new item, route, room, or reward

Prompt input should contain human-readable facts derived from engine state:

```text
You are Lyra. You are in Science Lab. The player chose Source: name the hidden
variable. Your current validated intent is support_peer because your goal is
verify_method. Speak one line under 90 characters.
```

## 17. Implementation Plan

### Slice 0: PRD And Trace Vocabulary

Deliverables:

- this PRD
- final enum names for goal kinds, plan step kinds, relationship statuses, and
  blocked reasons
- trace labels for goal create, goal expire, plan build, plan blocked, intent
  accepted, intent rejected, relationship tick
- trace fields for schema version, content pack version, replay-stable state
  hash, task name, legal candidate ids, ranked indices, selected candidate, and
  optional utility label

Exit criteria:

- design and trace vocabulary are stable enough to write tests against

### Slice 1: Runtime State Scaffolding

Deliverables:

- add `Ruby2NpcRuntime npc_runtime[RUBY2_CHARACTER_COUNT]` to `Ruby2World`
- initialize each NPC with idle/attend-class goal based on starting schedule
- add bounded relationship cells or adapt existing affinity array behind helper
  functions
- add debug labels for goals and blocked reasons

Tests:

- every initialized NPC has a runtime record
- every placed NPC has goal or idle reason
- relationship helper clamps values and status transitions

Exit criteria:

- no visible gameplay change required
- existing tests still pass

### Slice 2: Class Session Struct

Deliverables:

- add `Ruby2ClassSession class_sessions[RUBY2_ROOM_COUNT]` or equivalent
- migrate Homeroom, Science Lab, and Library blackboard state into sessions
- select seated NPCs from resolved room presence
- expose session phase in UI snapshot/debug output

Tests:

- Homeroom starts session with expected faculty and seated NPCs
- Science Lab and Library sessions trigger after Homeroom resolution
- seated NPCs match co-presence, not random picks

Exit criteria:

- existing blackboard quiz moments still trigger
- session state survives room changes until resolved or expired

### Slice 3: Goal Refresh And Simple Planner

Deliverables:

- deterministic goal refresh from schedule, class session, room pressure, and
  relationship state
- plan builder for move, speak, inspect, remember, wait
- blocked reasons for not co-present, blocked route, item absent, phase wrong,
  already committed

Tests:

- Lyra gets verify goal in method-gap class session
- Mika gets support goal after player miss
- Noor gets challenge/joke goal after contradiction pressure
- unreachable target produces blocked route, not mutation

Exit criteria:

- each core student can produce one legal plan in at least one seeded state

### Slice 4: Plan Execution Through Existing Intent Validator

Deliverables:

- emit one candidate intent from each active plan cursor
- allow more than one non-conflicting offscreen intent per tick
- keep visible speech capped by UI focus rules
- advance plan cursor on accepted intent
- set cooldown/block reason on rejection

Tests:

- move intent changes room only through validator
- remote speech is rejected and recorded
- item inspect fails when absent
- accepted remember event is internal unless explicitly surfaced

Exit criteria:

- no plan step mutates world state directly

### Slice 5: Class Social Round

Deliverables:

- after board resolution, select 1-2 seated NPC responders by goal priority
- map player approach + NPC goal to response type
- apply relationship ticks with reason tags
- write Notebook memory including witness context
- optionally create Yearbook candidate for high-salience outcomes

Tests:

- Science Lab `Name hidden variable` can trigger Lyra/Ravi response split
- Library `Check timestamp` can trigger Indra/Lyra response
- social round does not fire if no seated NPC qualifies
- relationship ticks are deterministic under seed

Exit criteria:

- blackboard moments become social moments, not just result panels

### Slice 6: Room Pressure And Notebook Objectives

Deliverables:

- add `Ruby2RoomPressure` per room or compact equivalent
- derive pressure from clocks, current session, items, and memories
- create Notebook goals from pressure thresholds
- let pressure feed NPC goal priority

Tests:

- Lunch Tray item increases Cafeteria social/rumor pressure
- source mismatch increases Library unresolved-source pressure
- hidden variable increases Science method-gap pressure
- resolving correct approach lowers matching pressure or converts it to memory

Exit criteria:

- player can see at least one Notebook objective that came from room pressure

### Slice 7: Replay And Coverage Harness

Deliverables:

- seeded school-day simulation runner
- exact content-pack version captured in every replay trace
- configurable route policy: required-only, explore-first, social-first,
  random-legal under seed
- coverage report for NPC goals, plans, accepted intents, rejected intents,
  class sessions, room pressures, relationship ticks, Notebook memories

Tests:

- 100 seeded days do not deadlock
- every core NPC creates at least one non-idle goal in the suite
- every teaching room can host a class session
- every blackboard session can reach social round or explicit no-responder reason
- replay with same seed has same state hash and event summary

Exit criteria:

- regressions in quiz trigger reachability and NPC agency are caught by tests

### Slice 8: Performance Integration

Deliverables:

- performance packets include validated goal/plan context
- authored fallback table for each response type per NPC
- optional LLM replacement for high-salience social responses
- cache key includes character, response type, class session, player approach,
  relationship status, and archetype

Tests:

- invalid generated line falls back
- missing LLM does not block plan execution
- generated speech cannot change relationship or Notebook outcomes

Exit criteria:

- NPCs feel voiced without giving AI control over the world

## 18. Acceptance Criteria

The PRD is satisfied when a deterministic native run can show this sequence:

1. Player reaches Homeroom.
2. Homeroom starts a class session with seated NPCs.
3. Player resolves the board through an approach.
4. At least one NPC goal changes because of the class result.
5. At least one NPC plan emits an accepted validated intent.
6. Science Lab or Library starts a later class session.
7. Player resolves that board.
8. A class social round selects responders from seated NPCs.
9. Relationship cells and Notebook memory update with reason tags.
10. A replay harness reproduces the same summary under the same seed.

Qualitative acceptance:

- testers can explain what at least three NPCs wanted during the day
- testers notice absence/co-presence as meaningful
- quiz moments feel like class scenes, not modal panels
- social responses are grounded in who was present and what happened
- no one reports that AI appears to be inventing durable state

## 19. Metrics

### Design/Gameplay Metrics

- `npc_goal_created_total` by NPC and goal kind
- `npc_goal_expired_total` by reason
- `npc_plan_built_total` by NPC and goal kind
- `npc_plan_blocked_total` by blocked reason
- `npc_intent_accepted_total` by intent kind
- `npc_intent_rejected_total` by validator reason
- `class_session_started_total` by room/faculty
- `class_social_round_started_total` by room/faculty
- `relationship_tick_total` by NPC and reason
- `notebook_objective_created_total` by room pressure

### Product Metrics

- first blackboard reached
- first class social response seen
- first Notebook objective opened
- first relationship status change
- Day One completion
- next-day return after social response
- Week One Yearbook candidate sealed

### Debug Reports

Weekly or test-run report should show:

```text
seed: 42
school days simulated: 100
NPCs with non-idle goals: Ruby 100, Lyra 82, Mika 70, Ravi 77, Indra 64, Noor 69, Sami 43
invalid intents: 12 remote_speech, 4 blocked_route, 3 item_absent
class social rounds: Homeroom 100, Science 68, Library 57
relationship ticks: 214
unreachable board sessions: 0
repeated template/cast triples over threshold: 2
```

## 20. Risks And Mitigations

### Risk: Too Much Simulation, Not Enough Authored Shape

Mitigation:

- goals come from authored schedules, room pressure, and class sessions
- no random goal soup
- bounded goal count and plan length
- required beats outrank autonomous behavior

### Risk: NPCs Talk Too Much

Mitigation:

- visible speech slots are capped
- many intents are internal or Notebook-only
- social round responder count is capped
- offscreen plan steps do not steal focus

### Risk: Planner Bugs Create Deadlocks

Mitigation:

- every blocked plan gets a reason and cooldown
- replay harness runs many seeds
- no plan step mutates directly
- required beat placement can override ordinary plans

### Risk: Relationships Become Hidden Spreadsheet State

Mitigation:

- Notebook and teacher/classmate lines surface relationship changes in prose
- use discrete statuses in UI/debug, not only numbers
- Yearbook signatures and callbacks make high-salience changes visible

### Risk: AI Appears To Decide Facts

Mitigation:

- performance packets include validated intent context
- generated text is replacement-only for authored fallback
- schema validation rejects mechanical or state-changing claims
- durable outcomes are committed before LLM performance starts

## 21. Open Decisions

- Should relationship cells live in `Ruby2World`, `Ruby2State`, or be derived
  from the existing `affinity` array plus a separate event/history table?
- Should class sessions be one per teaching room or a single active session with
  room snapshots?
- How many NPC intents may resolve per world step before the event queue gets too
  noisy?
- Should offscreen NPC goals write Notebook hints immediately or only after the
  player encounters the NPC?
- Which relationship statuses should be visible to players in Year One?
- Should Sami's low-effort goals bias toward absence/idling more strongly than
  other NPCs, or should every NPC get equal early visibility for onboarding?

## 22. First Build Target

Build the smallest proof that changes the feel of play:

```text
Science Lab class session
+ Lyra verify goal
+ Ravi test/challenge goal
+ Mika support goal
+ class social round after player approach
+ relationship tick
+ Notebook memory
+ replay test
```

Why Science Lab first:

- current v2 already has a Science Lab blackboard quiz
- method/control/variable problems map cleanly to Source/Sense/Sync/Signal
- Ravi and Mika already have strong lab-facing identities
- Lyra's verification behavior creates a natural social split
- the result can be tested without needing a full open campus

After Science Lab works, port the same architecture to Library. Library should
prove source, pattern, quiet tension, and Null Signal/Theory Hype pressure around
First Bell without implying genre-breaking state.

## 23. Guiding Constraint

NPC agency must be visible, bounded, and replayable.

If an NPC did something, the engine should be able to answer:

```text
What did they want?
What plan were they following?
Which world rule allowed it?
What changed because it happened?
Can we replay it under the same seed?
```

If the answer is only "the AI said so," the feature is outside the Ruby High 2.0
contract.
