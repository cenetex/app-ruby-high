# Ruby High 2.0 Design

> An authored school-year RPG where every class teaches something, every social beat makes the result real, and every day leaves the right memory behind.

Ruby High 2.0 is not a prettier version of the current viewer. It changes the product metaphor from "chat channels with a quiz board" to "a school year you live through."

The strongest version is:

```text
show up
attend class
answer under pressure
survive the social fallout
write the day into memory
come back tomorrow
```

Ruby High keeps the current backend as the authority for identity, state, metrics, questions, content packs, billing, and LLM calls. The new surface is a school-life RPG layer on top of those systems.

The useful TTRPG borrowing is structural, not cosmetic:

```text
encounter -> move -> consequence -> memory
```

D&D uses that structure for exploration, combat, loot, and rest. Ruby High
uses it for school days, class challenges, social consequences, Captain Null
pressure, and tomorrow.

## 1. Product Decision

### 1.1 North Star

Ruby High is a school-year RPG where learning, social drama, and AI character reactions feed one loop:

```text
class result -> social consequence -> notebook memory -> yearbook identity -> tomorrow hook
```

The player fantasy is not:

> I am using an educational quiz app.

It is:

> I am a student at Ruby High. I have classes, classmates, teachers, rumors, pressure, jokes, awkward wins, and a day to get through.

Every design decision should reinforce:

- school is a place
- class is an event
- classmates notice what happened
- classmates are not adversaries
- social is multiple-choice and consequential
- Captain Null carries special First Bell theory-session encounters
- AI creates flavor inside rails
- every day leaves a Notebook trace, and only the right moments become Yearbook

### 1.2 Design Motto

> Every class should teach you something. Every hallway should make that result socially real. Every day should leave the right memory behind.

This is the product difference:

```text
ordinary educational game:
answer question -> get score

Ruby High:
answer question
-> classmates react
-> teacher interprets
-> relationship changes
-> Notebook records it
-> the right moments become Yearbook artifacts
-> tomorrow's scene remembers it
```

### 1.3 TTRPG Design Read

Ruby High borrows from story-first tabletop design, but it is not a tabletop
simulator. The player does not type "I try X" and wait for a GM to improvise.
The player chooses authored moves, and the server resolves persistent state.

The honest product frame is:

> structured CYOA with persistent state, school simulation, discipline moves,
> and AI-performed character reactions.

The TTRPG borrowing is useful only where it creates structure: encounters,
clocks, conditions, fail-forward, fronts, and campaign memory.

Better references than D&D combat:

| TTRPG Idea | Ruby High Use |
|---|---|
| Encounter | class, social beat, item beat, or Captain Null interruption |
| Move | a multiple-choice action with a discipline and virtue flavor |
| Clock | visible or hidden pressure that advances through choices |
| Condition | short-lived state such as `frazzled`, `focused`, or `null-touched` |
| Fail-forward | wrong answers and awkward choices create recovery beats, not dead ends |
| Front / threat | Captain Null as the recurring campaign pressure |
| Campaign log | Notebook and Yearbook |

The design goal is not "add battle" or pretend multiple choice is tabletop
improvisation. It is to make authored school scenes react with tabletop-like
memory:

```text
Ruby frames the situation.
The player chooses a move.
The school state shifts.
Someone remembers.
```

### 1.4 What This Is Not

Ruby High 2.0 should not become:

- a chatbot wearing school clothes
- a free-roaming map before the class/social loop is proven
- a Skyrim-style open world where the school-day loop can be ignored
- an open-ended friendship simulator
- a classroom combat game where classmates become enemies
- a rewrite of auth, billing, metrics, admin, or content-pack management
- a client-authoritative game
- a generator of random personal campuses

Do not move durable decisions into AI or the client. The server owns schedule, room state, class outcomes, affinity deltas, rewards, memory writes, metrics, and billing. AI can write lines, vary reactions, suggest bounded reply copy, and help generate assets after validation.

### 1.5 Structural Product Bets

Ruby High 2.0 is built on three structural bets.

| Bet | Product Reason | Design Consequence |
|---|---|---|
| Utility becomes ritual | quiz apps decay when scores and streaks stop feeling meaningful | make every lesson part of a school-day ritual with classmates, places, pressure, and memory |
| Failure becomes material | standard quiz failure creates retry friction and shame | wrong answers advance the story through recovery, social fallout, clocks, and changed memory text |
| AI stays on rails | pure AI sandboxes collapse into inconsistent state and runaway cost | server owns facts and consequences; AI performs character voice inside validated slots |

These bets are linked. Learning is the catalyst, not the whole reward. The
player returns because yesterday's class became today's social context.

The product should preserve this chain:

```text
lesson -> visible result -> social meaning -> durable memory -> changed tomorrow
```

If a feature does not strengthen that chain, it is probably secondary.

### 1.5.1 Strategic Bet: Breadth To Depth

Ruby High 2.0 is not only an upgrade to v1. It is a strategic narrowing.

V1 is a scalable AI-breadth product: many subjects, many generated questions,
and broad utility. V2 chooses hand-authored depth: one small school year with
characters, memory, consequences, and identity.

This is deliberate. Question volume is commoditized; any quiz app can generate
more questions. The moat for v2 is a characterful authored year that players
remember, share, and return to because classmates and artifacts remember them.

Consequences:

- keep Year One small enough to author well
- do not promise four authored years before retention proves the loop
- keep the content compiler, template system, and replay harness scalable even
  while Week One is hand-made
- measure whether depth retains before spending like depth already won

### 1.5.2 Product Identity: Learning Game First

Ruby High is a cozy school-life RPG that contains learning. It should still
teach, but the player/buyer promise is not "infinite curriculum coverage." The
promise is:

```text
learn something
see how you handled it socially
remember who noticed
return to a changed school day
```

Correctness still matters. Approach choice should not become pure vibe
selection. When progress is decoupled from answer correctness, the product must
show what the player learned through explanations, source checks, corrections,
Notebook wording, and later callbacks. If a slice cannot substantiate learning,
it should be positioned as narrative play, not edtech mastery.

### 1.6 Premise

Ruby High needs a premise stronger than "a school with charming characters."

Working premise:

> Ruby High is a school for learning how to live with intelligent systems,
> unstable signals, and people under pressure. Students learn to read evidence,
> coordinate with agents, hold a fair line, and notice when the world starts
> answering back.

Why the player is here:

- they are a new student in Ruby High's first fully agent-aware freshman year
- the curriculum mixes ordinary school subjects with AI literacy, systems,
  signals, evidence, interpretation, and social judgment
- the school believes questions are never just tests; they reveal how people
  think, react, help, panic, and recover
- Captain Null is a cult comic/ARG obsession moving through the student body:
  a fictional mystery that makes students argue about sources, patterns,
  over-interpretation, restraint, and whether a coincidence deserves a theory

Graduation fantasy:

```text
I did not just pass classes.
I became the kind of person Ruby High was trying to train:
someone who can learn, read the room, coordinate with others,
and face impossible signals without losing the thread.
```

Premise contract:

- every subject should connect back to evidence, interpretation, coordination,
  signal, or social judgment
- every teacher should represent a mode of thinking, not just a content category
- Captain Null should test the school's premise through fandom, theory pressure,
  and grounded weird-fiction coincidences, not out-of-school genre stakes
- the Yearbook should show who the player became, not merely what happened

### 1.7 RPG Affordance Contract

Ruby High should not stop at structured CYOA with persistent state. To read as
an RPG, it needs affordances that CYOA usually lacks:

| RPG Affordance | Ruby High Version |
|---|---|
| Branch-gated identity | disciplines open optional routes; virtues shape identity |
| Scarce resources | time blocks, attention, stress, item slots, and companion slots force choice |
| Opportunity cost | choosing Library means missing Cafeteria, not just seeing Library first |
| World response | teachers, classmates, routes, and Null address who the player has become |
| Distinct pressure mode | Captain Null re-labels the four discipline buttons inside a multi-round tactical state |

RPG rule:

> The required school spine stays safe. The branches around it should diverge
> hard enough that two players build meaningfully different Yearbooks.

First-ten-session divergence target:

- at least 30% of remembered outcomes should differ by player route, approach,
  social response, or recovery choice
- every session after onboarding should contain at least one choice whose
  consequence is visible later, not only different copy in the moment
- the required spine may stay mostly shared, but Notebook entries, classmate
  callbacks, optional opportunities, and Yearbook candidates must diverge early
- if the first ten sessions feel like the same year with different captions,
  the RPG promise has failed even if later years would branch more

If every player sees the same school year with different captions, Ruby High is
still CYOA. If players spend time differently, bring different items, unlock
different branches, build different reputations, and seal different Yearbook
artifacts, it becomes a school-life RPG.

## 2. Game Structure

### 2.1 School Years

The top-level content unit is a school year.

A year is not just theme text. It is an authored schedule of classes, social beats, room unlocks, items, relationship arcs, memory targets, and autonomy rules.

```text
Year
  Week
    Day
      Beat
```

Each year should define:

- year theme
- day/week schedule
- required class beats
- required or optional social beats
- room unlocks
- item/card unlocks
- recurring classmates and teachers
- Notebook memory targets
- Yearbook milestones
- tomorrow hooks
- autonomy level

### 2.2 Guided To Open

Year One should be heavily guided. Later years can become increasingly freeform,
but "freeform" means more freedom in schedule, route, electives, relationships,
and goals. It does not mean freeform social text input.

Ruby High is not an open-world game in Year One. It is a guided campus RPG: the
player inhabits a school, but the day still has an authored path. The useful
near-term genre label is **school-day pointcrawl**:

```text
time block -> choose reachable room -> encounter -> consequence -> next bell
```

The game becomes open-world-ish only when movement creates opportunity cost. If
every player must visit the same rooms in the same order and cannot miss or
alter anything by choosing a route, the game has a map, not an open world.

| Year | Structure | Player Freedom | Design Goal |
|---|---|---|---|
| Year One | guided freshman year | follow a clear school-day path with small choices | teach the ritual and build attachment |
| Year Two | semi-open schedule | choose class order, electives, and some social priorities | make the school feel broader |
| Year Three | open week planning | pick goals, clubs, study routes, and social arcs | make identity and reputation matter |
| Year Four | capstone year | choose specialization paths and major relationships | make the Yearbook feel earned |

Openness ladder:

| Tier | Shape | What Changes |
|---|---|---|
| Guided path | required rooms in authored order | teaches the ritual safely |
| Branching day | one or two optional beats inside a required day | choice changes wording, affinity, hint, or memory |
| Hub block | a time block offers several rooms and limited actions | choosing one opportunity can expire, delay, or alter another |
| Open week | player plans class order, study, social, and recovery priorities | absences, callbacks, and clocks make the week reactive |
| Open schedule | player pursues arcs across campus with fewer required beats | identity, reputation, and Yearbook goals drive routing |

Open-world threshold:

- at least two rooms are valid during the same time block
- each room offers a different mechanical or social opportunity
- the player has a limited time/action budget
- choosing one route can miss, delay, or mutate another beat
- NPC schedules advance whether or not the player follows them
- the Notebook/Yearbook can remember both actions and omissions

The expansion path is not "add more UI." It is "author more school."

### 2.3 Year One: First Bell

Year One is the playable pilot season. It should be guided, charming, low-pressure, and specific.

Year One teaches:

- how Homeroom works
- who Ruby is
- why Lyra panics
- why Mika has the player's back
- why Noor makes results funnier
- how social choices work
- how items are verbs
- how the Notebook records a day
- how the Yearbook turns days into identity

Year One Week One:

```text
Day 1: First Homeroom
  Arrival -> Homeroom class -> Cafeteria social -> Notebook memory -> First Bell comic tease

Day 2: Science Lab Tease
  Hallway check-in -> Science Lab intro -> Ravi/Mika beat -> Flashcards tutorial -> social acknowledgement of the tease

Day 3: Library Day
  Library unlock -> interpretation challenge -> Lyra/Indra beat -> First Bell theory rise

Day 4: Cafeteria Pressure
  cafeteria social pressure -> practice class -> Office Pass tutorial -> recovery route

Day 5: First Week Report
  Ruby review -> first Captain Null theory session -> choose first Yearbook page candidate -> next-week hook
```

### 2.4 Year One Day One

The first playable content target is Year One Day One. It should work as a deterministic text simulation before it gets a game client.

Day One beats:

| Beat Id | Type | Room | Purpose | Required |
|---|---|---|---|---|
| `y1d1-arrival` | arrival | Hallway | Ruby greets and orients the player | yes |
| `y1d1-name-vibe` | setup | Hallway | player chooses name/vibe/avatar | yes |
| `y1d1-bell` | transition | Hallway | bell rings and Homeroom becomes required | yes |
| `y1d1-homeroom` | class | Homeroom | Ruby runs the first class | yes |
| `y1d1-report` | report | Homeroom | class result becomes identity signal | yes |
| `y1d1-cafeteria` | social | Cafeteria | classmates react to the result | yes |
| `y1d1-notebook` | memory | Cafeteria | Notebook records the day | yes |
| `y1d1-tomorrow` | hook | Hallway/Cafeteria | Science Lab or Library is teased | yes |

Day One can use a three-question class in the product slice. Early technical wedges may use one question as a prototype reduction.

### 2.5 Year One Day One Script

Day One should teach the normal school ritual before Captain Null becomes a
schoolwide theory object later. It needs no literal weirdness. The whole point is
to make normal Ruby High feel real first.

Opening:

```text
Hallway, arrival.
Ruby: "First bell is always the loudest. You ready to find your seat?"
```

Setup choices:

```text
Choose vibe:
- Prepared
- Curious
- Scrambling
- Quiet
```

First class:

| Question | Discipline + Virtue | Purpose |
|---|---|---|
| `y1d1-ruby-001` | Sense + Head | teach answer selection and reveal |
| `y1d1-ruby-002` | Sync + Heart | teach classmates reacting to tone/social meaning |
| `y1d1-ruby-003` | Source + Honor | teach evidence/fairness as school identity |

Day One question copy:

```json
[
  {
    "id": "y1d1-ruby-001",
    "discipline": "sense",
    "virtue": "head",
    "prompt": "Ruby writes one rule on the board: 'Read the room before you answer.' What should you check first?",
    "options": {
      "A": "Which answer looks longest",
      "B": "What the question is actually asking",
      "C": "Whether Lyra already panicked",
      "D": "How fast everyone else clicked"
    },
    "correct": "B",
    "explanation": "Head starts with orientation. Before speed, confidence, or social pressure, understand the actual question."
  },
  {
    "id": "y1d1-ruby-002",
    "discipline": "sync",
    "virtue": "heart",
    "prompt": "Lyra whispers, 'I knew it was C. I knew it.' What reply keeps the table steady?",
    "options": {
      "A": "You should have clicked faster.",
      "B": "That one was rough. Walk me through your notes?",
      "C": "I stopped listening after the bell.",
      "D": "Noor, roast this question immediately."
    },
    "correct": "B",
    "explanation": "Heart is not about being soft. It is noticing the person beside you and keeping the room usable."
  },
  {
    "id": "y1d1-ruby-003",
    "discipline": "source",
    "virtue": "honor",
    "prompt": "Ruby asks what to do when an AI answer sounds confident but the source on the desk disagrees. What is the Ruby High move?",
    "options": {
      "A": "Trust the confident answer",
      "B": "Ignore both and guess",
      "C": "Check the source and say what changed your mind",
      "D": "Ask for a more dramatic explanation"
    },
    "correct": "C",
    "explanation": "Honor means evidence, fairness, and saying why you changed your answer."
  }
]
```

Class report language:

```text
strong: Ruby noticed you found your footing fast.
mixed: Ruby noticed you kept going after the room got loud.
missed: Ruby noticed you stayed in the room and finished anyway.
```

Cafeteria social beat:

```text
Lyra: "You got the hard one wrong too? Okay. That makes me feel slightly less doomed."
Noor: "The test designer is in this room and is laughing."
```

Choices:

| Choice | Discipline + Virtue | Effect |
|---|---|---|
| "That question was brutal." | Sync + Heart | Lyra affinity +1, Stress -1, `shared-struggle` memory tag, `seen` condition |
| "I'm getting it next time." | Sync + Hustle | Mika affinity +1, Bell +1, `comeback-student` reputation tag |
| "Ask Indra. She knew." | Sense + Head | Rumor +1, schedules an Indra/Library hint later |

Notebook memory variants:

```text
success: First Homeroom - Ruby noticed you found your footing fast. At lunch, someone noticed too.
mixed: First Homeroom - You missed a step, recovered, and still made it to lunch with a story.
failure: First Homeroom - The first class hit hard, but you stayed. That counts.
```

Day One class resolver:

| Result | Condition | Outcome | Effects |
|---|---|---|---|
| `clear` | 3 correct | Ruby noticed you found your footing fast. | Mastery +1, `focused` condition |
| `mixed` | 2 correct | Ruby noticed you kept going after the room got loud. | Mastery +1, Stress +1 |
| `failed_forward` | 0-1 correct | Ruby noticed you stayed in the room and finished anyway. | Stress +1, recovery prompt eligible |

Day One should never fail the player out of Homeroom. A low score changes the
report, social setup, witness cast, recovery prompts, and Yearbook candidate; it
does not block the cafeteria beat or tomorrow hook.

Tomorrow hook:

```text
Ruby: "Science Lab tomorrow. Bring Flashcards. Sally likes evidence."
```

Captain Null should not appear in Day One except as a background artifact or
hidden First Bell comic tease. The first full Null encounter belongs after the
ramp has been taught: comic glimpse, social acknowledgement, theory rise, then
explicit ARG/deep-reading session. Week One should not jump from ordinary
cafeteria life straight to genre rupture without those school-side bridges.

### 2.6 Year One Day Three Library Signal Rise Script

Day Three should be authored with more specificity than an ordinary mid-week
day. It is the First Bell theory-rise stage: the player should feel that the
comic is becoming socially active before anyone treats Captain Null as more than
a weird fandom object.

Purpose:

- unlock the Library as the first interpretation/source route
- turn Indra from a quiet name into a playable presence
- show that evidence and interpretation are different skills
- make the Null Signal visible as theory hype and pattern pressure, not as a
  crisis alert
- create at least two competing Yearbook candidates for the Week One ritual

Day Three beats:

```text
Arrival
-> Library unlock
-> Professor Edward interpretation class
-> Lyra/Indra source-table beat
-> margin mismatch / stopped catalog card
-> choose how to handle the theory rise
-> Notebook memory and Yearbook candidates
```

Library unlock:

```text
Professor Edward: "The Library does not make answers safer. It makes them accountable."
Lyra: "Great. Love a room where even the shelves can judge me."
Indra: "The margin changed."
```

Interpretation challenge:

| Question | Discipline + Virtue | Purpose |
|---|---|---|
| `y1d3-edward-001` | Source + Head | identify what the source literally says |
| `y1d3-edward-002` | Sense + Honor | separate evidence from convenient interpretation |
| `y1d3-edward-003` | Sync + Heart | decide how to respond when Lyra overcorrects |

Theory-rise scene:

```text
The same sentence appears in three places:
on the page,
on a catalog card,
and in the Notebook margin.

Only the Notebook version has one extra word: DO.
Indra says the same word appears in First Bell issue one.
```

Choices:

| Choice | Discipline + Virtue | Effect |
|---|---|---|
| Check the source against the catalog card. | Source + Head/Honor | source clue, Null Signal +1 but `steady-reader` tag |
| Ask Indra what changed. | Sense + Head/Heart | Indra affinity +1, schedules later Library callback |
| Copy the sentence exactly into the Notebook. | Signal + Honor | `held-the-line`, unlocks stronger Day Five restraint option |
| Joke with Lyra and leave it alone. | Sync + Heart | Stress -1, Null Signal symptom remains unexplained |

Resolver:

| Result | Condition | Outcome | Effects |
|---|---|---|---|
| `clear` | player checks source or copies exactly | the coincidence is contained as a clue | Source/Signal trace, virtue flavor, Notebook phrase, Day Five clue |
| `mixed` | player asks Indra or comforts Lyra | the social beat stabilizes, but the theory spreads | affinity +1, Null Signal +1 |
| `failed_forward` | player ignores evidence under pressure | Library route remains open, but the clue mutates later | Stress +1 or Rumor +1, altered Day Five prompt |

Rules:

- do not use Captain Null's name as direct danger on Day Three
- the apparent mismatch should be ordinary-school visible: margin, catalog card, shelf
  label, clock, hallway sign, or classmate witness line
- Indra must either speak one precise line or take one precise action that only
  makes sense because she noticed the comic/source mismatch
- Day Three should produce at least one Library/Indra candidate and one signal
  candidate, so the Week One Yearbook ritual can demonstrate curation

### 2.7 Year One Day Four Office Pass Script

Day Four should be authored with nearly Day-One specificity because it teaches a
new RPG verb: recovery.

Purpose:

- prove failure/recovery can be a player choice, not a consolation prize
- teach the in-world Office Pass item without confusing it with paid Hall Pass
  wallet credits
- make Stress mechanically visible through route pressure
- show that a recovery route costs time and can expire another optional beat

Day Four beats:

```text
Arrival
-> Cafeteria pressure social
-> short practice class
-> Stress / Rumor reveal
-> Office Pass tutorial
-> choose recovery route or stay in social pressure
-> Notebook memory and Yearbook candidate
```

Office Pass tutorial scene:

```text
Ruby: "The pass is not a skip. It is a way to step out before the room decides who you are."

Choices:
- Use the Office Pass and take the Greenhouse route.      Sync + Heart/Honor
- Stay in Cafeteria and answer the rumor directly.        Sync + Hustle/Heart
- Ask Ruby what the fair version of recovery is.          Sense + Honor
```

Resolver:

| Choice | Effect | Opportunity Cost |
|---|---|---|
| Greenhouse route | Stress -1 or -2, `backed-up`, Mika/Greenhouse callback | miss one cafeteria affinity beat |
| Stay in Cafeteria | Rumor -1 if successful, Mika/Sami witness, Stress may stay high | no recovery condition |
| Ask Ruby | teacher trust, Sense + Honor trace, Office Pass rule clarified | Bell +1 |

Rules:

- using Office Pass consumes story item charge only, never `wallet.hallPasses`
- the pass opens a route; it does not erase the class/social result
- recovery should create a distinct Yearbook candidate if it changes who signs
  or remembers the moment

### 2.8 Beat Contract

Every beat should answer five questions:

```text
What happened?
What can the player choose?
What changes because of the choice?
What should the player feel?
What does tomorrow remember?
```

Beat types:

| Type | Use |
|---|---|
| `arrival` | establish room, cast, and required next action |
| `setup` | collect player name, vibe, avatar, or preference |
| `transition` | bell, passing period, route change, unlock |
| `class` | teacher-led question sequence |
| `social` | multiple-choice social consequence |
| `item` | teach or use a card/item verb |
| `report` | summarize class outcome and progression |
| `memory` | write Notebook memory or create a Yearbook candidate |
| `hook` | create a reason to return |
| `null_minigame` | Captain Null special theory-session encounter |

## 3. Core Gameplay

### 3.1 Nested Loops

Moment loop, 10-30 seconds:

```text
read scene
choose action
see character reaction
gain or lose tiny state
move forward
```

Session loop, 5-10 minutes:

```text
arrival
-> class challenge
-> result/reveal
-> passing period
-> social interlude
-> Notebook memory
-> tomorrow hook
```

Retention loop:

```text
come back tomorrow
see who remembers yesterday
take another class
unlock a new social beat
build identity at school
```

Structured-choice translation:

| Ruby High Beat | Tabletop Shape | Durable Question |
|---|---|---|
| Class | skill-challenge-inspired sequence | What did the player learn, and how did they handle pressure? |
| Social | relationship move with authored options | Who noticed, and what changed between people? |
| Item | support move | What advantage, recovery, or route did the player create? |
| Captain Null | First Bell theory pressure encounter | What claim, clue, or over-read pattern entered the school, and what did the player refuse, hold, or change? |
| Notebook | session log | What does tomorrow remember? |

This is not PbtA-style improvisational authorship. Ruby High gets its agency
from branch choice, state persistence, route consequences, and social memory,
not from freeform player declarations.

Every major beat should state:

```text
situation
available moves
visible or hidden pressure
consequence
memory
```

### 3.2 Main Verbs

Ruby High needs a small explicit verb set.

| Verb | System |
|---|---|
| Go | campus world graph and route navigation |
| Prepare | choose daily item loadout, optional focus, and later companion |
| Talk | multiple-choice social beats |
| Attend | class start |
| Approach | choose Source / Sense / Signal / Sync for a teacher problem |
| Use Item | card/item support mechanic |
| Check Notes | hints, history, progress, next goal |
| Reflect | recovery, relationship, summary, Yearbook |

The player should never feel like they are clicking random chat bubbles. They should understand the school as actionable.

### 3.3 Rooms

The current channel rail becomes a campus world graph. For the first playable
version, movement should be menu/exits based, not direct character walking.

Direct walking adds collision, pathing, animation, camera, mobile controls, and empty-space problems before the real loop is proven. Ruby High's first game is choosing where to go and who to engage.

Movement has three layers:

| Layer | Purpose | First Slice |
|---|---|---|
| World graph | authoritative rooms, exits, schedules, co-presence, route gates | yes |
| Route presentation | hallway/courtyard transitions, bell movement, passing-period beats | yes, lightly |
| Direct walking | pointer/touch/WASD avatar movement with collision/pathing | no |

The school should feel inhabited even before direct walking exists:

```text
Lyra is actually somewhere.
Ruby has a reason to be in Homeroom.
Noor appears in Cafeteria because lunch happened.
Indra can be found in the Library after certain outcomes.
Captain Null bends a route instead of replacing the map.
```

Initial rooms:

| Room | Game Function | Emotional Flavor | First Slice |
|---|---|---|---|
| Hallway | arrival, passing period, exits | movement, pressure, possibility | yes |
| Homeroom | onboarding, daily check-in, general questions | safety, orientation, Ruby's voice | yes |
| Cafeteria | social reactions, gossip, affinity | comedy, chaos, peer pressure | yes |
| Science Lab | evidence, experiments, STEM challenges | energy, precision, "prove it" | later |
| Library | literature, theory, interpretation | quiet tension, deep thinking | later |
| Greenhouse | reflection, biology, recovery | calm, growth, second chances | later |
| Courtyard | crossroads, chance events, transitions | possibility, encounters | later |
| Yearbook Office | artifacts and sharing | memory, identity, closure | later |

Each room has:

- stable id
- display name
- background asset
- exits
- route tags, such as `short`, `quiet`, `crowded`, or `locked`
- present characters
- available actions
- schedule context
- room event hooks

Every room should answer:

```text
Who is here?
Why are they here?
What can happen here?
What time is it?
What changes if I leave?
```

Player movement should create gameplay:

| Movement Choice | Possible Consequence |
|---|---|
| Go to Cafeteria now | see the class-result social beat |
| Go to Library later | find an Indra hint |
| Linger in Hallway | Bell Clock advances |
| Use Office Pass item | access a recovery route |
| Follow rumor | trigger a Courtyard or Cafeteria callback |

Semi-open movement should first appear as a bounded school block, not as a full
campus sandbox.

Example lunch block:

| Choice | Immediate Beat | Opportunity Cost |
|---|---|---|
| Cafeteria | Sami/Noor gossip and class-result social reaction | Rumor may rise; Library clue waits or expires |
| Library | Indra hint or source panel | miss the cafeteria joke or affinity chance |
| Greenhouse | recover Stress and reflect | Bell advances; social momentum cools |
| Courtyard | chance event or First Bell clue | risk Theory Hype and altered route home |

This is the first real open-world threshold: the player can go somewhere else,
and "somewhere else" matters.

The graphical client can show a map overlay, clickable exits, small route
animations, character standees, and speech bubbles. The server still resolves
which exits are available and who is present.

### 3.4 Classes

Classes remain structured. This is the correct place for educational rigor.

Class rhythm:

```text
teacher frames the lesson
classmate reaction sets stakes
teacher problem appears
player chooses an approach
NPCs lock answers or approaches
reveal animation
teacher explains
one classmate reacts
progress meter updates
```

NPC lock-in is the key classroom design move. Even when NPC choices are mostly
cosmetic, seeing Ravi lock in, Lyra hesitate, or Indra stay quiet turns the
problem into a social event.

Treat a class as a skill-challenge-inspired authored sequence, not just a quiz
screen. A three-question class is a three-round structured encounter:

```text
Round 1: orient to the problem
Round 2: make a pressured choice
Round 3: explain, revise, or hold the rule
```

Outcomes should be:

| Outcome | Meaning |
|---|---|
| Clear | player gets it and earns clean momentum |
| Mixed | player progresses, but stress, rumor, or Null Signal advances |
| Failed-forward | player misses, learns, and triggers a recovery/social beat |
| Restraint | player wins by refusing, waiting, or checking evidence |

Classroom UI should include:

- room background
- teacher standee
- NPC classmates in seats or side rail
- chalkboard/question panel
- approach buttons
- dice/advantage UI if retained
- progress meter
- approach reveal
- class report

Multiple-choice is the default. In Ruby v2, the most important first-run choice
is usually the approach, not a typed answer. Typed/opinion modes are premium
classroom beats later, not first-run load.

### 3.5 Social

Social is also multiple-choice.

Social is not open chat. It is a structured consequence beat after something meaningful happens, usually a class result.

Classmates should create stakes, support, comedy, pressure, and memory. They
should not become adversaries. If Ruby High needs a distinct pressure slot, use
Captain Null.

"Not adversaries" does not mean friction-free. School needs complicated peers:

- rivals who respect the player more after being challenged
- friends whose confidence can be strained by repeated choices
- classmates who misread a public failure and later revise their view
- people who want different things from the same social moment
- temporary awkwardness that can heal into a stronger memory

The line is: classmates can create social pressure, disagreement, envy,
embarrassment, or rivalry, but they should not become combat targets or cruelty
machines. Ruby High can be cozy without being frictionless.

Social beat rhythm:

```text
trigger: class result or authored schedule beat
setup: one or two classmates are present
line: one character reacts to what just happened
choice: player chooses one of 2-3 replies
outcome: affinity, hint, rumor, memory, schedule nudge, or tomorrow hook
```

Social choices are relationship moves. They should not ask, "Do you want to be
nice or mean?" They should ask, "Which part of your school identity do you
express right now?"

```text
Source -> check what can be proven
Sense  -> read what the moment means
Sync   -> keep people and systems coordinated
Signal -> notice when the world answers back
```

Example:

```text
Lyra: "You got the hard one wrong too? Okay. That makes me feel slightly less doomed."

Choices:
- "That question was brutal."
- "I'm getting it next time."
- "Ask Indra. She knew."
```

Hard rule: every social beat should produce at least one meaningful result:

- affinity delta
- hint
- rumor
- later character appearance
- item use
- Notebook memory
- Yearbook flag
- tomorrow hook

Avoid generic choice labels such as `Nice`, `Mean`, and `Funny`. Use in-world choices:

```text
Admit the question was unfair.
Brag that you almost had it.
Ask why Indra looked so calm.
```

Social templates should reduce authoring burden without making the cast feel
generic. They are authored encounter frames with variable slots, not random
dialogue generators.

Reusable social template shape:

```json
{
  "id": "shared-failure-recovery",
  "trigger": "after_class_result",
  "eligibleResults": ["mixed", "failed_forward"],
  "castSlots": [
    { "slot": "primary", "traits": ["anxious", "study-focused"], "defaultCharacterId": "lyra" },
    { "slot": "witness", "traits": ["deadpan", "comic-relief"], "defaultCharacterId": "noor" }
  ],
  "choiceArchetypes": ["validate", "commit_next_time", "ask_for_pattern"],
  "effectsByChoice": {
    "validate": { "affinity": { "primary": 1 }, "clockDeltas": { "stress": -1 }, "memoryTag": "shared-struggle" },
    "commit_next_time": { "reputationTag": "comeback-student", "clockDeltas": { "bell": 1 } },
    "ask_for_pattern": { "scheduleHint": "library-pattern-followup", "clockDeltas": { "rumor": 1 } }
  },
  "fallbackLine": "The table goes quiet for a second, then the day keeps moving."
}
```

Template rules:

- templates provide structure; character packs provide voice
- every template must name its trigger, cast slots, choice archetypes, effect
  payloads, and fallback line
- cast substitution must respect room presence, schedule, affinity, and tone
- each template needs at least one concrete authored example before it is reused
- if two uses of a template would produce the same emotional beat in the same
  week, prefer a different beat or skip it

### 3.6 Captain Null Theory Sessions

Ruby High does not need combat. It needs occasional pressure encounters.
Captain Null is the natural hook for those encounters, but Captain Null should be
grounded as fiction inside the school: a cult comic and ARG-like theory object
that students read, quote, over-interpret, and argue about.

Captain Null theory sessions should mirror the experience of reading First Bell too
closely with classmates: strange panels, observatory lore, command words,
schoolwide clue hunting, and moments where a coincidence starts to feel like a
pattern. They are the RPG pressure slot without making classmates hostile or
changing the game's grounded school genre.

Use Captain Null theory sessions to:

- punctuate the authored year at key moments
- create mystery and stakes outside normal class/social rhythm while keeping the
  stakes human-sized
- test the four disciplines under pressure
- unlock or reveal First Bell comic pages
- seed longer arcs without derailing the school-day loop

Tone bridge rule:

> Captain Null should enter through the school, not replace it.

The school-life and comic-mystery layers need a ramp:

| Stage | School-Side Presentation |
|---|---|
| Background tease | First Bell poster, borrowed issue, wrong word in Notebook margin |
| Social acknowledgement | Noor jokes, Lyra overthinks, Ravi lore-dumps, Ruby quietly redirects |
| Theory rise | Null Signal clock changes after contradiction, rumor, over-reading, or restraint |
| Theory session | a comic/ARG close-reading session frames a short pressure encounter |
| Aftermath | classmates react as witnesses; the normal schedule resumes with changed memory |

Do not cold-open a genre rupture. The player should feel that Ruby High's
students made a weird comic socially important, not that they were teleported
into a different game.

Comic motifs to mirror:

| Motif | Theory-Session Use |
|---|---|
| black star / shadow | fictional pressure and fandom iconography, not a classmate enemy |
| impossible surface / hidden center | player must inspect beyond first appearance |
| signal before source | future hint, delayed explanation, tomorrow hook |
| coordinates / song | pattern puzzle or ordered choice sequence |
| door behind sight | solve by changing approach, not brute force |
| duplicate astronaut / hollow self | identity check, memory/reputation reflection |
| command words | short objective cards such as `DO`, `STAR`, `SILENCE` |
| silence over violence | win condition can be restraint, not conquest |

Theory-session rhythm:

```text
intrusion: a comic clue, rumor, or coincidence interrupts the day
frame: a teacher, classmate, or comic panel names the problem
read: player studies the page, clue, or school-side mismatch
choice: player picks a discipline-labeled action with virtue flavor
resolve: short puzzle/check/reveal/restraint
reaction: classmates process what just happened
reward: comic page, memory flag, hint, or Yearbook shard
return: normal school day resumes
```

Captain Null cannot just be a class with stranger copy. It needs a different
time signature, but it should not need a different input surface. Null uses the
same universal four-button discipline panel as class problems; the scene swaps
the labels to make the pressure mode feel different.

Null discipline label mapping:

| Discipline Button | Null Labels | Use |
|---|---|---|
| Source | Observe / Verify | check source, issue, author note, catalog card, or physical clue |
| Sense | Name / Decode | identify the metaphor, contradiction, or command word |
| Sync | Hold Signal / Coordinate | keep the fandom/social room stable under pressure |
| Signal | Break Pattern / Stay Silent | resist over-interpretation, interrupt a bad theory, or let a pattern pass |

Restraint is the signature Null mechanic. In normal class, the player usually
answers. In Null encounters, the strongest move may be to wait, refuse, hold,
or say nothing. The engine still records a four-discipline action index; the
round context decides whether the Signal button renders as `Break Pattern` or
`Stay Silent`.

Example approaches:

```text
Source -> verify the page, source, or physical clue
Sense  -> name what the contradiction means
Sync   -> steady the room or fandom argument
Signal -> hold, refuse, or break the theory loop
```

Six-page adventure arc:

```text
Page 1: black star / shadow / command card
Page 2: false surface / hidden center
Page 3: dead moon choir / coordinates / song
Page 4: temple behind sight / time folds
Page 5: hollow astronaut / duplicate self
Page 6: mouth of the black star / choose silence
```

Rules:

- keep them short
- do not make classmates enemies
- do not replace classes or social beats
- do not require twitch reflexes in Year One
- always return to the authored school-day schedule

### 3.7 Notebook And Yearbook

The Notebook is the daily operational memory. The Yearbook is the scarce identity
artifact.

Do not collapse memory into one pipeline. Ruby High has three memory layers:

| Layer | Job | Example |
|---|---|---|
| Mechanical state | drives rules, gates, clocks, affinity, conditions | `focused`, Lyra affinity +1, Rumor +1 |
| Notebook memory | records what happened and what to do next | "First Homeroom: Ruby noticed you kept going." |
| Yearbook artifact | ritualizes who the player became | "The Comeback Student", signed by Mika and Lyra |

The Yearbook is not a sealed Notebook entry. It should have scarcity, visual
ritual, aesthetic treatment, and downstream consequence.

Notebook:

- shows current day goal
- stores class result
- records hints and item effects
- stores every ordinary day trace without ceremony
- previews tomorrow hook
- helps the player recover after failure
- feeds a candidate queue for later Yearbook curation

Yearbook:

- seals only important memories
- targets roughly 15-25 entries per authored school year, not one per day
- turns learning and social outcomes into identity
- makes the school year feel cumulative
- gives long-term retention a visible object
- unlocks callbacks, titles, portraits, social signatures, reflection scenes, or
  capstone variants the Notebook cannot unlock

Yearbook sealing rule:

- Notebook can record every class, hint, item, and social beat.
- Yearbook candidates are created only by explicit authored milestone beats:
  end-of-class reports, social climaxes, Captain Null resolutions, weekly
  rituals, relationship pages, or finales.
- Ordinary hallway movement, baseline item use, routine practice answers, and
  minor route choices can update the Notebook, but they do not write directly to
  the Yearbook candidate table.
- A candidate can be auto-highlighted, but it is not automatically sealed just
  because the day ended.
- Yearbook sealing should happen at rituals: end of week, relationship beat,
  club/class arc, Captain Null page clear, first-term review, year finale.
- If multiple candidates compete, prefer the one with the strongest combination
  of mechanical consequence, social consequence, emotional tone, and future
  callback.
- Year One can auto-select the first candidate for onboarding, but the product
  should quickly teach that the Yearbook is curated, not spammed.
- A sealed entry must unlock or alter something later: a callback line, route,
  classmate signature, reflection prompt, reputation title, card treatment, or
  capstone condition.

Memory write shape:

```json
{
  "id": "memory:first-homeroom",
  "scope": "notebook",
  "title": "First Homeroom",
  "bodyTemplate": "Ruby noticed you {classResultPhrase}. {socialPhrase}",
  "sourceBeatIds": ["y1d1-homeroom", "y1d1-cafeteria"],
  "yearbookCandidate": {
    "eligible": true,
    "score": 4,
    "reason": "first-class-social-failure-recovery",
    "suggestedArtifactId": "artifact:first-homeroom-comeback"
  }
}
```

Yearbook artifact shape:

```json
{
  "id": "artifact:first-homeroom-comeback",
  "title": "The First Comeback",
  "kind": "identity_card",
  "rarity": "ordinary-but-important",
  "sourceMemoryIds": ["memory:first-homeroom"],
  "sourceBeatIds": ["y1d1-homeroom", "y1d1-cafeteria"],
  "identityTags": ["comeback-student", "kept-going"],
  "signatures": ["ruby", "mika"],
  "visualTreatment": "cafeteria-polaroid",
  "unlocks": [
    { "type": "callback_line", "beatId": "y1d3-library-arrival" },
    { "type": "reputation_title", "id": "comeback-student" }
  ]
}
```

Yearbook rituals:

| Ritual | Use |
|---|---|
| First page | onboarding moment after Day One or Week One, auto-selected only once |
| Weekly review | choose one candidate from the week and see who signs it |
| Relationship page | classmate-specific memory after enough shared beats |
| Null page | comic/theory artifact with school-side aftermath |
| Year finale | capstone spread showing identity, relationships, and unresolved signals |

Yearbook ritual UX rule:

> The Yearbook is a school scene, not file management.

Do not make the player sort a feed of memories, drag cards into slots, or compare
discipline or virtue deltas in a meta menu. Sealing should happen inside the fiction:

```text
Mika: "Real question. What actually goes in the page for this week?"

Choices:
- The class you almost bailed on but finished
- The cafeteria save
- The weird clock note nobody else admits seeing
```

The player chooses between 2-3 curated candidates. A present classmate signs or
marks the page in their voice. The UI can expose details on the back of the card,
but the front-facing moment should feel like classmates deciding what this week
meant, not the player maintaining a collection database.

Candidate selection logic:

```text
candidate_score =
  mechanical_weight
+ social_weight
+ identity_weight
+ callback_weight
+ rarity_weight
- repetition_penalty
```

Sample Wedge -1 weights:

| Component | Range | Counts When |
|---|---:|---|
| `mechanical_weight` | 0-3 | changed route, clock, item timing, companion availability, or branch access |
| `social_weight` | 0-3 | changed affinity, witness cast, relationship page, signature, or future social setup |
| `identity_weight` | 0-3 | expresses discipline lane, virtue pattern, reputation tag, recovery pattern, or emerging archetype |
| `callback_weight` | 0-4 | has an authored later line, route, prompt, page, or capstone condition |
| `rarity_weight` | 0-2 | first occurrence, unusual restraint, comic page, or hard-to-repeat combination |
| `repetition_penalty` | 0-3 | duplicates a recent artifact type, signature, route, or emotional role |

Wedge -1 defaults:

- minimum candidate score: 4
- minimum seal score: 7, unless it is the onboarding first page
- ritual shortlist: top 2-3 eligible candidates after lifecycle filtering
- tie-breakers: downstream callback, new signature, underrepresented discipline lane,
  then player-facing emotional clarity

Worked example:

| Candidate | Mechanical | Social | Identity | Callback | Rarity | Penalty | Score | Ritual Use |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `first-homeroom-comeback` | 1 | 2 | 3 | 3 | 1 | 0 | 10 | strong Week One page; Mika/Lyra signature |
| `library-margin-do` | 2 | 1 | 2 | 4 | 2 | 0 | 11 | auto-highlighted as signal page draft |
| `ordinary-flashcards-use` | 1 | 0 | 1 | 0 | 0 | 1 | 1 | Notebook only, not a Yearbook candidate |

The game can highlight `library-margin-do`, but the player still chooses which
page to seal if both high-value candidates fit the ritual. The curation UX is
not "the game picks one and the player watches."

Selection rules:

- every candidate records why it exists; do not seal unexplained artifacts
- the game may auto-highlight the highest-scoring candidate at a ritual
- the player should choose between 2-3 candidates once curation is taught
- the first Yearbook page may be auto-selected for onboarding only
- a candidate without a downstream callback cannot be sealed unless it is a
  finale artifact
- rejected candidates remain in Notebook history but do not become Yearbook
  artifacts
- if all candidates are weak, the ritual should create a class report or group
  photo instead of pretending a minor event was iconic

Candidate lifecycle and cap:

- only `candidate`, `highlighted`, and `pinned` records count against the active
  cap
- after a weekly ritual, seal one page, optionally pin up to two candidates that
  have explicit future callbacks, and archive the rest into Notebook history
- expired or archived candidates keep their Notebook memory and metrics, but no
  longer consume active Yearbook candidate slots
- branches can contribute score evidence without always creating a candidate;
  create a candidate only when the branch changes future state, signature,
  callback, identity, or player self-understanding
- if the active queue is full, a higher-scoring incoming candidate may evict the
  lowest-scoring unsealed and unpinned candidate

Weekly review flow:

```text
Ruby or a classmate frames the ritual in-world.
2-3 candidate cards appear as Yearbook page drafts.
Classmate signatures preview what each page means emotionally.
Player seals one page.
The signing character adds a short line or mark.
The sealed artifact immediately shows one future callback or unlock.
Notebook keeps the rest as ordinary memories.
```

If the Yearbook does not become emotionally important, Ruby High risks collapsing back into a quiz app.

### 3.8 Progression

Progression should stay light and school-flavored.

| Track | Purpose | Increments From | Unlocks |
|---|---|---|---|
| Mastery | subject progress | class results, practice, item use | harder classes, explanations, teacher comments |
| Affinity | classmate relationships | social choices, recovery, repeated presence | social beats, hints, later appearances |
| Reputation | class-wide identity | patterns across class/social outcomes | alternate reactions, report language |
| Yearbook | scarce identity artifacts | curated candidates, arc rituals, capstones | retrospectives, callbacks, capstones, sharing |

No heavy progression screen in Year One. Let these tracks appear through dialogue, Notebook text, reports, and occasional unlocks.

### 3.9 Disciplines And Virtues

Ruby High now has two progression languages.

**Disciplines** are what the school trains. They are the RPG-facing competency
layer and should carry most route gates, class mastery, item affordances, and
teacher progression.

**Virtues** are how the player shows up. Head, Heart, Hustle, and Honor remain
valuable, but they should read as identity style, reputation, and social tone,
not as the whole progression system.

Design rule:

> Disciplines decide what the player is becoming able to do. Virtues describe
> what kind of student they are becoming while doing it.

Core disciplines:

| Discipline | Meaning | Teachers / Spaces | Opens |
|---|---|---|---|
| Source | observe, cite, verify, test | Ruby, Sally, Science Lab, Library | source panels, experiment checks, evidence routes |
| Sense | read ambiguity, meaning, subtext | Edward, Ruby, Library | interpretation routes, close-reading hints, contradiction framing |
| Sync | work with people, agents, systems | Eliza, Homeroom, Cafeteria, Greenhouse | companion actions, social repair, agent coordination |
| Signal | read patterns, claims, comic callbacks, theory pressure | Rati, Captain Null, Courtyard, Library | Theory Hype labels, route rumors, comic callbacks |

Virtues:

| Virtue | Means | Best Used For |
|---|---|---|
| Head | analysis, theory, pattern confidence | report language, Indra/Edward reactions, Scholar identity |
| Heart | empathy, tone, belonging | Lyra/Mika/Noor reactions, Connector identity |
| Hustle | speed, improvisation, practical nerve | Ravi/Sally reactions, Operator or Comeback identity |
| Honor | integrity, fairness, restraint | Ruby/teacher trust, Conscience identity, Null silence |

The old four-stat model should not be deleted. It should be demoted into
Ruby's read of the player:

```text
Strongest Discipline: Source
Ruby's Read: Wild Card, leaning Conscience
Notebook Margin: Source steady, Signal ticking
```

This gives the school more design room. A player can be:

```text
Source + Head  -> sharp evidence-reader
Source + Honor -> fair source-checker
Sense + Heart  -> emotionally literate interpreter
Sync + Hustle  -> fast social coordinator
Signal + Honor -> restraint-first Null responder
Signal + Head  -> pattern mapper
```

Do not let disciplines vanish into aggregate correctness. A class result should
track both score and discipline expression, with optional virtue flavor.

Example trace:

```json
{
  "classResult": "mixed",
  "correctCount": 2,
  "choiceTrace": [
    { "questionId": "y1d1-ruby-001", "discipline": "sense", "virtue": "head", "correct": true },
    { "questionId": "y1d1-ruby-002", "discipline": "sync", "virtue": "heart", "correct": false },
    { "questionId": "y1d1-ruby-003", "discipline": "source", "virtue": "honor", "correct": true }
  ],
  "disciplineOutcome": {
    "source": "expressed",
    "sense": "expressed",
    "sync": "missed"
  },
  "virtueOutcome": {
    "head": "expressed",
    "honor": "expressed",
    "heart": "missed"
  }
}
```

The report, social witness choice, Notebook candidate, Yearbook signature, and
later callbacks can then react to both:

- which discipline the player used or missed
- which virtue made that choice feel like *this* player

Example social choices:

```text
Lyra: "I knew it was C. I knew it."

Choices:
- "Walk me through your notes."                 Sense + Head
- "You're not the only one panicking."          Sync + Heart
- "Let's fix it before next class."            Sync + Hustle
- "The question was fair. Hard, but fair."      Source + Honor
```

Item affinity:

| Item | Primary Discipline | Virtue Flavor |
|---|---|---|
| Flashcards | Sense | Head |
| Lunch Tray | Sync | Heart |
| Lab Flask | Source | Hustle |
| Library Card | Source / Sense | Head / Honor |
| Office Pass | Sync / Sense | Heart / Honor |
| Notebook | all disciplines | all virtues |

Mechanical teeth rule:

> Nonblocking does not mean cosmetic.

Disciplines, virtues, clocks, and conditions should create real differences in
route, information, tools, and social availability while preserving fail-forward
completion.

| Mechanic | Acceptable Teeth | Not Acceptable |
|---|---|---|
| High discipline | alternate route, source, tool, teacher option, Null label/route | required to pass the day |
| Low discipline | recovery beat, different witness, missing an optional clue | retry wall or dead end |
| Strong virtue pattern | reputation language, NPC attention, Yearbook signature | pure stat-stick damage bonus |
| Condition | temporary action, advantage, route modifier, classmate callback | permanent hidden penalty |
| Clock threshold | authored recovery, interruption, or scene mutation | arbitrary punishment popup |
| Affinity | optional scene, witness reaction, hint source, altered schedule | required friendship gate for core class |

Players should be able to say, "My choice changed what I could do," even when
the school day still moved forward.

Branch-gating rule:

> Gate divergence, not completion.

Disciplines should open side routes that create different beats, relationships,
and Yearbook material. Virtues can tint those routes or combine with them for
more specific variants.

| Discipline | Branch Lane | Opens |
|---|---|---|
| Source | Lab / Library evidence routes | source checks, experiments, evidence maps, Sally/Ravi proof beats |
| Sense | Library / Homeroom interpretation routes | Edward/Indra close reads, ambiguity choices, contradiction framing |
| Sync | Cafeteria / Greenhouse / Systems Lab routes | social repair, companion actions, Eliza coordination beats |
| Signal | Courtyard / Library / Null routes | pattern reads, restraint choices, comic-page callbacks |

Branch rules:

- branches are optional routes, activity choices, scene variants, or item uses
- branch access can require discipline expression, virtue pattern, reputation
  archetype, affinity, condition, item loadout, sealed artifact, or companion
  presence
- missing a branch must never block the school-day spine
- branches should create distinct Yearbook candidates, not just alternate copy
- a branch can reveal information, alter a later scene, change who signs an
  artifact, or unlock a companion action

Branch threshold tuning:

| Gate Tier | Typical Requirement | Use |
|---|---|---|
| Tier 1 | discipline 1, item carried, condition active, or recent tag | Week One tutorial variants and early hints |
| Tier 2 | discipline 2, affinity 2, item + room, or repeated lane choice | meaningful Year One optional branches |
| Tier 3 | discipline 3+, archetype, companion, or sealed artifact | mid/late Year One specialization routes and Year Two depth |

Do not require `discipline_gte: 3` for the first free-block divergence unless
the same branch also has an accessible item, condition, or affinity route. Year
One should teach divergence early with Tier 1-2 gates, then let Tier 3 gates
become aspirational specialization.

Example:

```text
After school:
- Source 2 or Library Card: source-table study with Indra
- Sense 2 or Edward note: interpretation route in Library
- Sync 2 or Mika affinity 2: Greenhouse recovery walk
- Signal 2 or prior restraint: Courtyard coincidence / Null silence route
```

### 3.10 Approach Choice And Training

The core classroom interaction changes from Ruby v1's answer-first quiz model
to a problem-first RPG move.

Ruby v1:

```text
Teacher asks a multiple-choice question.
Player chooses A / B / C / D.
System marks correct or wrong.
```

Ruby v2:

```text
Teacher poses a problem.
Player chooses how to approach it:
Source / Sense / Signal / Sync.
The approach changes the framing, evidence, NPC reaction, effect payload, and
training credit.
The school day continues.
```

This keeps the human input multiple-choice, but changes what the choice means.
The player is not only guessing an answer. They are choosing the discipline they
trust under pressure.

Class problem contract:

```json
{
  "problemId": "y1d3-edward-library-card",
  "prompt": "Edward places two summaries of the same passage on the table. One is confident. One is careful. What do you do first?",
  "approaches": [
    { "id": "source", "label": "Choose Source", "verb": "cite the passage", "trains": "source" },
    { "id": "sense", "label": "Choose Sense", "verb": "read the subtext", "trains": "sense" },
    { "id": "sync", "label": "Choose Sync", "verb": "ask who needs what", "trains": "sync" },
    { "id": "signal", "label": "Choose Signal", "verb": "notice the pattern that should not repeat", "trains": "signal" }
  ],
  "resolver": "teacher-problem-v1",
  "effects": "shared-effect-payload"
}
```

Approach choices are still authored. The server decides whether the chosen
approach was strong, mixed, risky, or restrained in context. AI may perform a
character line about that result, but it does not decide the result or the
training delta.

Learning claim contract:

- approach choice decides how the player engages the problem
- answer correctness, source checking, explanation quality, or recovery evidence
  still decides what the player demonstrably learned
- if a wrong answer advances, the day must still teach the correction through an
  explanation, social response, Notebook line, or later callback
- a player should not be able to farm mastery by always choosing the same
  flattering discipline label
- if a beat only measures identity expression, label it as school-life RPG
  expression, not subject mastery

Training rule:

> Players level disciplines by doing them, Morrowind-style.

There is no abstract "spend three points on Source" screen in Year One. Source
goes up because the player repeatedly cites, verifies, tests, or challenges
evidence in real scenes. Sync goes up because the player repeatedly coordinates
people, systems, and social pressure. Signal goes up because the player keeps
reading anomalies and choosing restraint or pattern-breaking under pressure.

Training sources:

| Source | Trains | Notes |
|---|---|---|
| Required class problems | chosen discipline, sometimes teacher mastery | main tutorial surface |
| Optional free-block activities | activity discipline plus room affinity | main divergence surface |
| Item use | item's discipline if used in a valid context | no credit for spam or invalid use |
| Failed-forward recovery | missed or recovery discipline | lets failure become practice |
| Captain Null encounters | Signal plus restraint-linked virtue | comic/ARG pressure slot |
| Yearbook sealing | small permanent identity mark or route unlock | reward for meaningful history, not grind |

Virtues are trained differently. Head, Heart, Hustle, and Honor should emerge
from the style of approach, social response, recovery choice, and restraint
pattern. They describe the player's school identity; they are not a second grind
track.

Example:

```text
Ruby: "The answer is confident. The source disagrees. What's the move?"

Choices:
- Choose Source: cite the source before trusting the answer.
- Choose Sense: read what the answer is trying to make you assume.
- Choose Sync: ask the room what everyone is using as evidence.
- Choose Signal: mark the repeated phrase that keeps showing up.
```

The same problem can train different players differently. The important unit is
not "question answered." It is "approach expressed."

Anti-grind rules:

- credit only comes from accepted server-resolved choices
- repeated low-context use gets reduced or no training credit
- each discipline has daily soft caps in Year One
- optional training consumes a scarce free block, item charge, recovery chance,
  or route opportunity
- repeated template runs should create weaker Yearbook candidates through the
  repetition penalty
- visible progression should appear as Notebook margin reads, teacher comments,
  class reports, route unlocks, and Yearbook signatures before raw numbers

Training should create competence, not a farm loop.

Backlog implication:

> Wedge -1 and Wedge 0 must prove the approach-choice loop, not just a better
> multiple-choice quiz.

The first playable text slice should include at least one teacher problem where
all four approaches are valid inputs, produce different discipline deltas, and
create different downstream social or Yearbook material.

### 3.11 Scarcity, Preparation, And Companions

The school-day spine is required. The RPG layer lives in the limited choices
around that spine.

Free block rule:

> After the required school beat, the player gets one meaningful optional slot.

Early example:

| Activity | Location | Gain | Opportunity Cost |
|---|---|---|---|
| Study with Indra | Library | Sense or Source, source clue | miss Cafeteria affinity beat |
| Hang out with Mika | Cafeteria | Sync, affinity, rumor softener | miss Library clue |
| Lab side project with Ravi | Science Lab | Source, experiment action | Stress may stay high |
| Investigate Null Signal | Courtyard | Signal, comic progress | risk Null Signal increase |
| Recover in Greenhouse | Greenhouse | Stress -2, reflection candidate | miss social or mastery gain |

Rules:

- one free-block action per day in Year One once introduced
- later years can add more slots, not unlimited actions
- activity choice can consume time, item charges, stress, companion availability,
  or a one-day route opportunity
- missed activities can expire, delay, or mutate into a different beat
- the Notebook should show what was chosen and what passed by

Preparation rule:

> Before the school day, the player chooses what kind of student they are packing
> to be today.

Item loadout starts small:

| Year | Locker/Bag Rule |
|---|---|
| Year One | Notebook always carried; choose 1 support item once loadout is taught |
| Year Two | choose 2 support items and optionally 1 companion for a free block |
| Year Three | choose 3 support items; some specialization tools compete for slots |
| Year Four | capstone loadout reflects chosen path and Yearbook artifacts |

Examples:

- Flashcards help class prep but do little in a Null encounter.
- Lab Flask opens Science Lab evidence actions but is wasted in Library.
- Library Card opens sources, Indra clues, and teacher-office research beats.
- Office Pass opens recovery routes but costs the support slot that could have
  carried an advantage tool.

Preparation should matter before the player sees the exact problem. This creates
RPG identity without turning the required school day into a failure gate.

Specialization rule:

> By Year Three, accumulated choices should make the player a recognizable kind
> of Ruby High student.

Small bounded archetype set:

| Archetype | Built From | World Response |
|---|---|---|
| Scholar | sustained Sense / Head / Library choices | Indra and Edward offer deeper interpretation routes |
| Connector | sustained Sync / Heart / Cafeteria / Greenhouse choices | classmates bring social problems to the player |
| Operator | sustained Source / Hustle / Lab / Courtyard choices | Sally and Ravi open improvisation side projects |
| Conscience | sustained Honor / Source / teacher trust / restraint choices | Ruby, Edward, and Null respond to restraint choices |
| Signal-Reader | repeated Signal / Null / restraint choices | pattern routes and comic callbacks appear earlier |
| Comeback Student | repeated failed-forward recoveries | Mika/Ruby recovery routes get stronger |
| Wild Card | mixed disciplines, virtues, and varied routes | flexible but fewer deep branch unlocks |

Reputation should be queryable, not just prose. Scenes can ask for
`dominantArchetype`, `secondaryArchetype`, and `recentReputationTags` to choose
variants without combinatorial explosion.

Reputation tags vs archetypes:

- `reputationTag` is an atomic event label, such as `comeback-student`,
  `steady-under-static`, or `library-pattern`
- `dominantArchetype` is an aggregate identity resolved from repeated tags,
  discipline expression, virtue pattern, route choice, item use, and sealed artifacts
- authors should never gate a branch on one isolated tag when they mean a stable
  identity pattern

Archetype resolution:

```text
archetype_score =
  discipline_expression_points
 virtue_expression_points
+ route_lane_points
+ item_loadout_points
+ reputation_tag_points
+ sealed_yearbook_points
+ companion_activity_points
```

Resolution rules:

- Year One can expose `leaning` labels, but should avoid hard archetype-only
  gates before players have enough history
- resolve a dominant archetype when one score reaches 6 and leads the next score
  by at least 2
- resolve a secondary archetype when the second score reaches 4
- if no score reaches 6 by the relevant check, or if the top three scores are
  within 1 point, resolve `wild_card`
- `wild_card` must be a viable flexible path, not a penalty state; it should open
  bridge routes, broad-but-shallow hints, and mixed-signature Yearbook pages
- recompute after major rituals, not after every click; use recent tags for line
  flavor and aggregate archetypes for gates

Example:

```text
Three `comeback-student` tags do not automatically make the player a Comeback
Student archetype.

Three recovery tags + one Greenhouse/Office Pass route + one sealed recovery
artifact can.
```

Companion rule:

> Affinity becomes RPG-useful when the player can bring a classmate to a beat.

Companions are introduced after the core loop is proven, likely mid-Year Two.
One companion can join a free-block activity or optional route when present and
available.

| Companion | Useful In | Changes |
|---|---|---|
| Lyra | Library, class prep, recovery after hard questions | reveals study clue; can create anxiety if Stress is high |
| Mika | Cafeteria, Greenhouse, failed-forward routes | reduces social fallout; improves recovery beats |
| Ravi | Science Lab, Courtyard, experiments | adds evidence option and chaos/rumor risk |
| Indra | Library, First Bell aftermath, interpretation | unlocks quiet high-value hints |
| Sami | Cafeteria, Hallway, rumor scenes | deflects pressure and reframes social consequences |
| Noor | Cafeteria, social witness scenes, unfair questions | reveals absurdity and lowers tension |

Companion rules:

- companions are not always available; schedules and affinity matter
- companion presence unlocks actions or softens costs, not automatic wins
- bringing one companion means not bringing another
- companion participation can create Yearbook signatures and relationship pages

### 3.12 Clocks, Conditions, And Fail-Forward

The RPG pressure layer needs consequences, but not combat HP. Use clocks and conditions.

Clocks are small deterministic counters that make the school feel reactive.
They are not real-time timers, and they are not punishment meters.

Hidden clocks are high-risk. Rumor and Null Signal can create mystery, but they
can also make authored consequences feel arbitrary. Prototype hidden vs
Notebook-visible presentation before committing to a year-long hidden-state
design.

`Null Signal` is the engine-facing clock name for the First Bell/Captain Null
pressure layer. Player-facing copy should usually read as theory hype, ARG
pressure, fandom over-interpretation, or pattern fever unless an authored comic
encounter is explicitly in progress.

Core clocks:

| Clock | Meaning | Advances From | Triggers |
|---|---|---|---|
| Bell Clock | school-day pacing | required beats completed, lingering, certain Hustle/Sync choices | forced transition, passing-period scene |
| Stress Clock | player/social pressure | wrong answer, awkward social choice, Null intrusion | recovery prompt, Office Pass after tutorial, Greenhouse recovery, Mika support |
| Rumor Clock | how far an event spreads | cafeteria choices, visible failure, dramatic success | altered social line, reputation tag, hallway callback |
| Null Signal Clock | theory/ARG pressure | contradiction, comic clue, over-reading, Null theory-session mixed outcome | Captain Null stinger, comic-page callback |
| Relationship Clocks | classmate arc progress | affinity choices, repeated presence, shared memories | personal scene, hint, Yearbook memory |

Conditions are short-lived tags that modify wording, hints, and available moves.

Useful first conditions:

| Condition | Source | Effect |
|---|---|---|
| `focused` | Flashcards, correct streak, Notebook review | one hint, cleaner report language |
| `frazzled` | Stress Clock threshold, missed answer | recovery choice appears |
| `backed-up` | Mika/Lyra/Sami support beat | softens social fallout |
| `under-pressure` | Bell Clock near threshold | choices feel tighter, but no twitch timing |
| `null-touched` | Captain Null encounter | later theory line, Indra/Ruby follow-up |
| `seen` | strong Heart/social choice | classmate remembers the player helped |

Fail-forward rule:

> A failed or awkward choice should advance the day, reveal information, and
> create a recovery/social beat. It should not force a retry screen.

Fail-forward must restructure at least one downstream surface. Variant copy is
not enough.

Examples:

| Failure Surface | Structural Change |
|---|---|
| missed Sync + Heart question | Lyra appears in Cafeteria instead of Indra; recovery choice opens |
| visible class stumble | Rumor Clock advances and a hallway witness line appears |
| failed Science evidence read | Lab Flask evidence-check beat appears next Science Lab visit |
| high Stress threshold | Greenhouse route opens while one optional social beat expires |
| Null mixed outcome | `null-touched` condition alters Library route and Indra callback |

Day completion should remain safe. The order, cast, route, opportunity cost, or
next-day callback should not.

Every meaningful beat should touch at least two systems:

| Beat Result | Also Touches |
|---|---|
| Class answer | mastery plus reputation, stress, or Null Signal |
| Social choice | affinity plus rumor, condition, or schedule hint |
| Item use | advantage plus condition or clock reduction |
| Captain Null outcome | comic unlock plus condition, memory, or later theory beat |
| Notebook entry | Yearbook candidate plus tomorrow callback |

## 4. Cards As Mechanics

Cards are not lore dressing. They are the player's interaction model.

Student cards are social archetypes. Teacher cards are modes of thought. Location cards are play spaces. Item cards are verbs with school objects wrapped around them.

Use stable lowercase ids in scene JSON, asset manifests, save state, telemetry, and Yearbook artifacts.

### 4.1 Student Cards

| Id | Card | Role | Lean | Artifact Quote |
|---|---|---|---|---|
| `lyra` | Lyra | Anxious overachiever | Literature | "wait what -- i KNEW it was c. ok im rewriting my notes." |
| `sami` | Sami | Chill sarcastic one | Homeroom/social reactions | "respectfully, ouch. couldve been you." |
| `ravi` | Ravi | Loud fact-dropper | Science | "OK so technically -- wait, sorry, am i shouting again" |
| `indra` | Indra | Quiet sniper with one perfect line | Literature | "the answer was always c." |
| `mika` | Mika | Supportive hype machine | Science | "you cooked. for real." |
| `noor` | Noor | Deadpan one-liner specialist | Homeroom/social reactions | "the test designer is in this room and is laughing." |

Gameplay roles:

| Student | Role In Play | Mechanic |
|---|---|---|
| Lyra | anxious overachiever | study hints, intense wrong-answer reactions |
| Sami | sarcastic social mirror | outcome commentary, tension release |
| Ravi | fact-dropper | science context, overexplains |
| Indra | quiet sniper | rare high-value hints or reveals |
| Mika | hype machine | confidence after success or failure |
| Noor | deadpan truth-teller | unfair-question comedy, social bite |

### 4.2 Teacher Cards

| Id | Card | Role | Teaches |
|---|---|---|---|
| `ruby` | Ruby | Homeroom teacher, host, generalist | Homeroom, general knowledge, AI literacy, agent culture, school meta |
| `sally-science` | Sally Science | STEM teacher | Physics, chemistry, biology, earth science, lab thinking, scientific method |
| `professor-edward` | Professor Edward | Literature teacher | Postwar literature, literary theory, mid-century history, critical thinking |
| `captain-null` | Captain Null | Fictional comic/ARG pressure slot | First Bell pages, theory pressure, close reading, restraint |
| `eliza` | Eliza | Guest teacher | Systems Lab, agents, networks, coordination |
| `rati` | Rati | Guest teacher | Signal Studies, myth, tokens, strange economics |

Teacher play styles:

| Teacher | Play Style |
|---|---|
| Ruby | general knowledge, onboarding, meta, AI literacy |
| Sally Science | evidence, experiments, cause/effect |
| Professor Edward | interpretation, ambiguity, close reading |
| Captain Null | cult comic mystery, ARG-like clues, over-interpretation pressure, First Bell sessions |
| Eliza | agents, networks, coordination puzzles |
| Rati | signals, myth, tokens, strange economics |

Premise mapping:

| Teacher | Premise Mode | Tests |
|---|---|---|
| Ruby | AI literacy and social judgment | can the player read the room before trusting an answer? |
| Sally Science | evidence and experimental discipline | can the player observe, test, and revise? |
| Professor Edward | interpretation and historical ambiguity | can the player hold more than one reading without losing the text? |
| Captain Null | fandom signal under pressure | can the player resist false patterns and preserve the source? |
| Eliza | coordination with agents and networks | can the player make systems legible and cooperative? |
| Rati | signals, myth, tokens, and world-building | can the player tell signal from noise without flattening meaning? |

### 4.3 Location Cards

| Id | Card | Wing | Purpose | Artifact Quote |
|---|---|---|---|---|
| `homeroom` | Homeroom | Front Door | Orientation, check-ins, general knowledge | "Where every day begins, and every question gets a room." |
| `science-lab` | Science Lab | STEM Wing | Physics, chemistry, biology | "Observe. Test. Explain. Repeat." |
| `library` | Library | Quiet Wing | Literature, theory, deep reading | "If it matters, someone wrote it down." |
| `cafeteria` | Cafeteria | Commons | Lunch, gossip, social reactions | "Half the school day happens between bites." |
| `greenhouse` | Greenhouse | Garden Annex | Growth, reflection, biology | "Some lessons grow slowly." |
| `courtyard` | Courtyard | Central Grounds | Breaks, crossroads, chance encounters | "Every hallway leads somewhere. Every path leads to someone." |

### 4.4 Item Cards

| Id | Card | Source | Function | Artifact Quote |
|---|---|---|---|---|
| `office-pass` | Office Pass | Front Office | Reset, grace, second chances | "Sometimes the smartest move is stepping out and coming back better." |
| `flashcards` | Flashcards | Study Kit | Memory, revision, exam prep | "Shuffle. Repeat. Survive." |
| `library-card` | Library Card | Quiet Wing | Access, research, borrowed wisdom | "If the answer exists, this helps you find it." |
| `lab-flask` | Lab Flask | Science Lab | Experiments, evidence, clean explanations | "Observe first. Guess later." |
| `lunch-tray` | Lunch Tray | Commons | Fuel, gossip, lunchtime diplomacy | "Half the social game happens between bites." |
| `notebook` | Notebook | Daily Carry | Plans, panic, ideas in progress | "Messy notes still count as evidence of life." |

Item kinds:

| Kind | Meaning | Items |
|---|---|---|
| `tool` | reusable interface or persistent action | Notebook |
| `consumable_story` | limited in-school use, not paid currency | Office Pass, Flashcards |
| `key` | unlocks routes, screens, or content | Library Card |
| `scene_prop` | enables a specific room interaction | Lab Flask, Lunch Tray |

Concrete item mechanics:

| Item | Kind | Valid Use | Mechanical Result |
|---|---|---|---|
| Notebook | `tool` | any non-locked beat | opens goals, hints, memory, tomorrow hook; no charges |
| Flashcards | `consumable_story` | before/during class | applies `focused`; reveals one concept or suppresses one bad option |
| Office Pass | `consumable_story` | Stress >= 2, failed-forward, or social pressure beat | asks to step out, plays hallway/Greenhouse recovery route; Stress -1, Bell +1 |
| Library Card | `key` | Library, source panel, explanation beat | unlocks source/deeper explanation/Indra route |
| Lab Flask | `scene_prop` | Science Lab evidence question | adds an evidence-check step before answer lock |
| Lunch Tray | `scene_prop` | Cafeteria social beat | selects seating setup and social cast variant |

Do not build complex inventory early. Items should first be authorized verbs
with clear server-resolved effects.

Item readiness rule:

> If an item cannot create a server-resolved action, condition, route, hint,
> memory, or scene variant, it is not ready to be in the game.

Graphical presentation:

- items appear in a small school-bag tray, not a loot grid
- contextual item buttons appear only when valid for the current beat
- each item has a card zoom state for art, quote, and use text
- item use must be embodied in the room whenever it changes state: the player
  opens the Notebook, flips Flashcards, shows a Library Card, asks for the Office
  Pass, handles the Lab Flask, or chooses where to sit with the Lunch Tray
- item use emits animation events such as `item.used`, `item.exhausted`, or
  `hint.revealed`
- teacher/classmate speech can acknowledge item use, but durable item effects
  still come from the server resolver

Item immersion rule:

> Never let an item feel like a mana potion with school art.

The button can be compact, but the result should be spatial or social. Office
Pass does not simply reduce a Stress number; it triggers a request to leave, a
quiet hallway beat, a Greenhouse or hallway recovery choice, and a return with
lost time. Flashcards should appear as a desk or bag action before a hint.
Library Card should open access to a source panel or librarian/Indra route.

Naming rule:

- `office-pass` is the school item card used inside the RPG loop.
- Hall Pass wallet credits remain the economy/entitlement concept owned by the
  existing billing and wallet systems.
- Scene state should keep these separate as `items.office-pass` and
  `wallet.hallPasses` or equivalent. Do not spend paid Hall Pass wallet credits
  just because the player used the in-world Office Pass item in a story beat.

### 4.5 CCG And Ownership Contract

Ruby High already has a Hall Pass card/NFT model. V2 card mechanics must
reconcile with it instead of letting ownership accidentally become progression.

Ownership rule:

> Owned cards and NFT artifacts are additive: identity,
> collection, cosmetics, premium convenience, community status, and shareable
> proof. They must not gate or mechanically advantage the core class/social/
> memory retention loop.

Design implications:

- Student, teacher, location, and item cards are interaction models first.
- NFT/CCG ownership can skin, frame, stamp, display, share, or collect a card.
- Owned cards should not improve answer correctness, discipline gain, class
  outcomes, relationship deltas, or required route access by default.
- If an owned card ever grants gameplay advantage, it must be segmented,
  explicitly measured, and treated as a pay-to-win risk rather than a default
  design path.
- The Yearbook is the natural ownership surface: sealed pages, signatures,
  report cards, and identity artifacts can become owned/shareable without
  bribing the lesson loop.
- Wallet-connected, NFT-holder, and collector users must be cohort-tagged
  so monetization behavior does not pollute organic retention reads.

## 5. Content Schemas

### 5.1 Year Schedule

The year schedule is server-owned content. It tells the scene system what must happen today, what can happen optionally, and how open the day should be.

```json
{
  "id": "year1",
  "name": "First Bell",
  "autonomy": "guided",
  "openness": {
    "tier": "guided_path",
    "timeBudget": null,
    "missableOptionalBeats": false,
    "requiredBeatRecovery": "always_available"
  },
  "days": [
    {
      "id": "year1-day1",
      "title": "First Homeroom",
      "requiredBeats": [
        { "id": "y1d1-arrival", "type": "arrival", "roomId": "hallway-east" },
        { "id": "y1d1-name-vibe", "type": "setup", "roomId": "hallway-east" },
        { "id": "y1d1-bell", "type": "transition", "roomId": "hallway-east", "nextRequiredAction": "go:homeroom" },
        { "id": "y1d1-homeroom", "type": "class", "roomId": "homeroom", "facultyId": "ruby", "questionSetId": "ruby-homeroom-001" },
        { "id": "y1d1-report", "type": "report", "roomId": "homeroom", "sourceBeatId": "y1d1-homeroom" },
        { "id": "y1d1-cafeteria", "type": "social", "roomId": "cafeteria", "choiceSetId": "cafeteria-first-result" },
        { "id": "y1d1-notebook", "type": "memory", "target": "notebook", "memoryId": "first-homeroom" },
        { "id": "y1d1-tomorrow", "type": "hook", "roomId": "cafeteria", "hookId": "science-lab-redemption" }
      ],
      "optionalBeats": [],
      "itemGrants": [
        { "itemId": "notebook", "beatId": "y1d1-arrival", "reason": "daily-carry" },
        { "itemId": "flashcards", "beatId": "y1d1-tomorrow", "reason": "science-lab-hook" }
      ],
      "unlocks": ["science-lab"],
      "tomorrowHook": "science-lab-redemption"
    },
    {
      "id": "year1-day2",
      "title": "Science Lab Tease",
      "requiredBeats": [
        { "id": "y1d2-checkin", "type": "arrival", "roomId": "hallway-east" },
        { "id": "y1d2-science-lab", "type": "class", "roomId": "science-lab", "facultyId": "sally-science", "questionSetId": "sally-lab-001" },
        { "id": "y1d2-flashcards", "type": "item_tutorial", "roomId": "science-lab", "itemId": "flashcards", "sourceBeatId": "y1d2-science-lab", "timing": "before_first_answer" },
        { "id": "y1d2-null-ack", "type": "signal_tease", "roomId": "hallway-east", "teaseId": "clock-margin-mark" },
        { "id": "y1d2-recover", "type": "social", "roomId": "hallway-east", "choiceSetId": "after-null-witnesses" }
      ],
      "optionalBeats": [],
      "unlocks": ["library"],
      "possibleUnlocks": ["null-signal/notebook-mark"],
      "tomorrowHook": "library-indra-pattern"
    }
  ]
}
```

Rules:

- Year One can force `nextRequiredAction`.
- Later years expose more optional beats and fewer required beats.
- `autonomy` describes how directed the year feels; `openness` describes the
  actual routing mechanics.
- The server resolves beat availability from year progress, daily credit rules, room state, affinity, and item ownership.
- `itemGrants` are explicit item acquisition events, not generic unlock text.
- `unlocks` are content or room access grants; `possibleUnlocks` are granted only by validated beat outcomes.
- The client renders available choices; it does not decide the schedule.

Canonical Year One item acquisition:

| Item | Acquired At | Why |
|---|---|---|
| `notebook` | `y1d1-arrival` | establishes goals, notes, memory, and tomorrow hook |
| `flashcards` | `y1d1-tomorrow` | tees up Day Two Science Lab and the first item tutorial |
| `office-pass` | Day Four Office Pass tutorial | teaches recovery as a deliberate school verb after the core class/social loop is understood |

### 5.2 Activity Blocks, Branch Gates, And Loadout

Activity blocks are where RPG opportunity cost lives. They are not required
spine beats. They are limited slots inside a day.

```json
{
  "id": "y1d3-after-school-free-block",
  "timeBlock": "after_school",
  "slotCount": 1,
  "requiredBeatRecovery": "always_available",
  "activities": [
    {
      "id": "study-library-indra",
      "roomId": "library",
      "label": "Study with Indra",
      "gate": { "any": [
        { "type": "discipline_gte", "discipline": "sense", "value": 2 },
        { "type": "discipline_gte", "discipline": "source", "value": 2 },
        { "type": "item_carried", "itemId": "library-card" }
      ] },
      "effects": {
        "mastery": { "literature": 1 },
        "affinity": { "indra": 1 },
        "memoryTag": "library-pattern",
        "disciplineDeltas": { "sense": 1 }
      },
      "opportunityCost": ["cafeteria-mika-hangout", "greenhouse-recover"],
      "yearbookCandidateWeight": 2
    },
    {
      "id": "greenhouse-recover",
      "roomId": "greenhouse",
      "label": "Take the greenhouse route",
      "gate": { "type": "clock_gte", "clock": "stress", "value": 2 },
      "effects": {
        "clockDeltas": { "stress": -2 },
        "conditions": [{ "id": "backed-up", "scope": "day", "sourceBeatId": "current" }]
      },
      "opportunityCost": ["study-library-indra", "lab-ravi-side-project"],
      "yearbookCandidateWeight": 1
    }
  ]
}
```

Daily loadout shape:

```json
{
  "id": "y1-loadout-basic",
  "alwaysCarried": ["notebook"],
  "supportSlots": 1,
  "eligibleItems": ["flashcards", "library-card", "lab-flask", "office-pass"],
  "rules": [
    "items must be owned or scene-granted",
    "support item actions require item_carried unless marked scene_prop",
    "loadout locks when arrival beat completes"
  ]
}
```

Branch gate shape:

```json
{
  "all": [
      { "type": "time_block_eq", "timeBlock": "after_school" },
      { "type": "room_unlocked", "roomId": "library" },
      { "any": [
      { "type": "discipline_gte", "discipline": "sense", "value": 2 },
      { "type": "reputation_is", "archetype": "scholar" },
      { "type": "companion_present", "characterId": "indra" }
    ] }
  ]
}
```

Reputation archetype shape:

```json
{
  "id": "scholar",
  "label": "Scholar",
  "disciplineWeights": { "sense": 3, "source": 1 },
  "virtueWeights": { "head": 2, "honor": 1 },
  "signals": ["library_route", "source_panel", "indra_hint"],
  "npcVariants": {
    "indra": "respects-pattern-work",
    "professor-edward": "offers-close-reading"
  },
  "branchUnlocks": ["library-deep-source", "edward-office-hours"]
}
```

Companion availability shape:

```json
{
  "characterId": "mika",
  "availableFor": ["cafeteria-hangout", "greenhouse-recover"],
  "requires": { "type": "affinity_gte", "characterId": "mika", "value": 2 },
  "cost": { "companionSlot": 1 },
  "actions": [
    {
      "id": "mika-deflect-rumor",
      "validWhen": { "type": "clock_gte", "clock": "rumor", "value": 1 },
      "effects": { "clockDeltas": { "rumor": -1 }, "memoryTag": "mika-had-your-back" }
    }
  ]
}
```

Rules:

- activity gates are evaluated by the server from compiled content, not client
  strings
- a failed gate hides or explains the branch; it never blocks required progress
- loadout should be chosen before the player knows every beat in the day
- activity and companion choices should create opportunity cost and Yearbook
  variance
- companion actions must validate co-presence before being offered

### 5.3 Social Choice Set

Social choice sets should carry consequence metadata.

```json
{
  "id": "cafeteria-first-result",
  "trigger": "after_class_result",
  "roomId": "cafeteria",
  "characters": ["lyra", "mika", "noor"],
  "speaker": "lyra",
  "lineTemplate": "You got the hard one wrong too? Okay. That makes me feel slightly less doomed.",
  "reactionLines": [
    { "characterId": "noor", "lineTemplate": "The test designer is in this room and is laughing." }
  ],
  "choices": [
    {
      "id": "admit-brutal",
      "label": "That question was brutal.",
      "tone": "honest",
      "discipline": "sync",
      "virtue": "heart",
      "effects": {
        "affinity": { "lyra": 1 },
        "memoryTag": "shared-struggle",
        "clockDeltas": { "stress": -1 },
        "conditions": [{ "id": "seen", "scope": "day", "sourceBeatId": "y1d1-cafeteria" }]
      }
    },
    {
      "id": "next-time",
      "label": "I'm getting it next time.",
      "tone": "resilient",
      "discipline": "sync",
      "virtue": "hustle",
      "effects": {
        "affinity": { "mika": 1 },
        "reputationTag": "comeback-student",
        "clockDeltas": { "bell": 1 }
      }
    },
    {
      "id": "ask-indra",
      "label": "Ask Indra. She knew.",
      "tone": "deflecting",
      "discipline": "sense",
      "virtue": "head",
      "effects": {
        "scheduleHint": "indra-library-later",
        "clockDeltas": { "rumor": 1 }
      }
    }
  ],
  "fallbackLine": "Lyra folds her notes in half, then immediately unfolds them again."
}
```

### 5.4 Class Beat

Class beats should be authored enough to create subject identity.

```json
{
  "id": "ruby-homeroom-001",
  "facultyId": "ruby",
  "subject": "homeroom",
  "questions": [
    { "id": "y1d1-ruby-001", "discipline": "sense", "virtue": "head" },
    { "id": "y1d1-ruby-002", "discipline": "sync", "virtue": "heart" },
    { "id": "y1d1-ruby-003", "discipline": "source", "virtue": "honor" }
  ],
  "choiceTracePolicy": {
    "recordPerQuestion": true,
    "feedReport": true,
    "feedSocialWitness": true,
    "feedYearbookCandidate": true
  },
  "outcomeResolver": {
    "clear": {
      "condition": "correctCount == 3",
      "effects": {
        "mastery": { "homeroom": 1 },
        "conditions": [{ "id": "focused", "scope": "day", "sourceBeatId": "y1d1-homeroom" }]
      },
      "resultPhrase": "found your footing fast"
    },
    "mixed": {
      "condition": "correctCount == 2",
      "effects": {
        "mastery": { "homeroom": 1 },
        "clockDeltas": { "stress": 1 }
      },
      "resultPhrase": "kept going after the room got loud"
    },
    "failed_forward": {
      "condition": "correctCount <= 1",
      "effects": {
        "clockDeltas": { "stress": 1 },
        "followupPrompt": "day-one-recovery-eligible"
      },
      "resultPhrase": "stayed in the room and finished anyway"
    }
  },
  "npcLocks": [
    { "characterId": "lyra", "behavior": "hesitates_then_locks" },
    { "characterId": "mika", "behavior": "waits_for_player" },
    { "characterId": "noor", "behavior": "deadpan_after_reveal" }
  ],
  "reportTemplate": "Ruby noticed you {resultPhrase}. {reputationPhrase}"
}
```

### 5.5 Captain Null Theory Session

Captain Null theory sessions are authored special beats, not generic combat. The
default fiction is a First Bell comic/ARG theory session that spills into the
school day through rumors, margins, props, and classmate obsession.

The engine id can remain `null_minigame` during the C wedge, but player-facing
copy and product planning should call these theory sessions.

```json
{
  "id": "null-first-signal",
  "type": "null_minigame",
  "sourceComic": "first-bell",
  "comicPage": "page-01",
  "motifs": ["black-star", "shadow", "command-card"],
  "captainNullLine": "There are stars that watch. Learn to look back.",
  "stakes": "The fandom thread is turning a hallway clock coincidence into proof.",
  "state": {
    "visibleContradiction": "The copied panel and hallway clock disagree about where the hands should be.",
    "commandWord": "DO",
    "silenceAvailable": true,
    "signalStability": 2,
    "nullPressure": 0,
    "invalidActionCount": 0,
    "trace": []
  },
  "buttons": [
    { "index": 0, "discipline": "source", "defaultLabel": "Source" },
    { "index": 1, "discipline": "sense", "defaultLabel": "Sense" },
    { "index": 2, "discipline": "sync", "defaultLabel": "Sync" },
    { "index": 3, "discipline": "signal", "defaultLabel": "Signal" }
  ],
  "rounds": [
    {
      "id": "observe-contradiction",
      "prompt": "The copied panel has no clock hands. The hallway clock does.",
      "availableButtons": ["source", "sense", "signal"],
      "buttonLabels": {
        "source": "Observe",
        "sense": "Name",
        "signal": "Stay Silent"
      },
      "onAction": {
        "source": {
          "stateDeltas": { "signalStability": 1 },
          "hint": { "kind": "concept", "text": "The command word is from the panel, not the hallway." }
        },
        "sense": {
          "stateDeltas": { "nullPressure": 1 },
          "clockDeltas": { "null_signal": 1 }
        },
        "signal": {
          "stateDeltas": { "signalStability": 1 },
          "conditions": [{ "id": "focused", "scope": "beat", "sourceBeatId": "current" }]
        }
      }
    },
    {
      "id": "hold-or-break",
      "prompt": "Someone tapes DO above the door before anyone admits doing it.",
      "availableButtons": ["source", "sync", "signal"],
      "buttonLabels": {
        "source": "Verify",
        "sync": "Hold Signal",
        "signal": "Break Pattern"
      },
      "onAction": {
        "signal": {
          "stateDeltas": { "nullPressure": 2, "signalStability": -1 },
          "clockDeltas": { "null_signal": 1, "stress": 1 }
        },
        "sync": {
          "stateDeltas": { "signalStability": 1 },
          "clockDeltas": { "null_signal": -1 }
        },
        "source": {
          "stateDeltas": { "signalStability": 1 },
          "hint": { "kind": "source", "text": "The tape came from Ravi's photocopy, not the door." }
        }
      }
    }
  ],
  "approaches": [
    { "id": "verify-clock", "button": 0, "label": "Source - verify the panel before touching the word.", "discipline": "source", "virtue": "honor" },
    { "id": "name-command", "button": 1, "label": "Sense - name what the command is doing to the room.", "discipline": "sense", "virtue": "head" },
    { "id": "steady-room", "button": 2, "label": "Sync - keep the theory thread from becoming a fight.", "discipline": "sync", "virtue": "heart" },
    { "id": "choose-silence", "button": 3, "label": "Signal - stay silent and let the bad pattern pass.", "discipline": "signal", "virtue": "honor" }
  ],
  "outcomes": {
    "clear": {
      "condition": "signalStability >= 4 && nullPressure <= 1 && trace includes source, or signalStability >= 3 && nullPressure <= 1 && trace includes source && sync",
      "effects": {
        "comicPage": "first-bell/page-01",
        "memoryTag": "held-the-signal",
        "reputationTag": "steady-under-static",
        "clockDeltas": { "null_signal": -1 }
      }
    },
    "mixed": {
      "condition": "trace length >= 1 && nullPressure <= 3 && signalStability >= 1",
      "effects": {
        "comicPage": "first-bell/page-01",
        "memoryTag": "saw-the-shadow",
        "followupBeatId": "y1d2-recover",
        "clockDeltas": { "stress": 1, "null_signal": 1 },
        "conditions": [{ "id": "null-touched", "scope": "week", "sourceBeatId": "y1d5-null-minigame" }]
      }
    },
    "failed_forward": {
      "condition": "invalidActionCount > 0 || nullPressure >= 3 || signalStability <= 0",
      "effects": {
        "comicPage": "first-bell/page-01",
        "memoryTag": "clock-skipped",
        "followupBeatId": "y1d2-recover",
        "clockDeltas": { "stress": 1, "null_signal": 1 },
        "conditions": [{ "id": "frazzled", "scope": "day", "sourceBeatId": "y1d5-null-minigame" }]
      }
    },
    "restraint": {
      "condition": "silenceAvailable && trace includes signal with stay-silent label && signalStability >= 3 && nullPressure <= 1",
      "effects": {
        "comicPage": "first-bell/page-01",
        "memoryTag": "chose-silence",
        "yearbookCandidate": true,
        "clockDeltas": { "null_signal": -1 },
        "conditions": [{ "id": "focused", "scope": "day", "sourceBeatId": "y1d5-null-minigame" }]
      }
    }
  },
  "schoolEffects": {
    "notebookPhrase": "The First Bell copy said DO. The hallway made everyone argue about it.",
    "nextHook": "Indra later asks whether anyone checked the issue number."
  },
  "returnBeatId": "y1d2-recover"
}
```

Captain Null theory sessions should be authored as a sequence, with each comic page
teaching one new interaction pattern. The encounter can use stylized internal
language, but the school-side cause remains grounded: a page, photocopy, rumor,
club debate, prop, or campus coincidence.

| Comic Page | Theory-Session Pattern | Discipline + Virtue Bias |
|---|---|---|
| `page-01` | identify the impossible command | Signal + Honor/Head |
| `page-02` | find the hidden center beneath a false surface | Sense + Head/Hustle |
| `page-03` | decode a signal or coordinate song | Signal/Sync + Head/Heart |
| `page-04` | solve by closing the obvious path | Sense + Honor/Heart |
| `page-05` | confront the hollow double without becoming it | Sync + Heart/Honor |
| `page-06` | choose restraint before the black star wakes | Signal + Honor/Hustle |

Comic pages are not just collectibles. Unlocking a page should change the school
year in a small visible way: a Notebook phrase, a later hallway rumor, a new
Indra question, a Ruby warning, or a Yearbook shard. If a page unlock does not
alter any later beat, it is only an asset reward and should wait.

Null encounter rules:

- every Null encounter has at least two rounds
- each round exposes a subset of the four discipline buttons with Null-specific
  labels, not a custom input layout
- actions update encounter state before the final outcome resolver runs
- action-heavy choices should usually raise pressure, narrow later options, or
  spend stability
- restraint choices should often preserve stability, reveal a hidden option, or
  unlock the highest-value Yearbook candidate
- the final outcome should depend on the encounter trace, not only the player's
  strongest discipline and virtue pattern
- the encounter must return to the normal school schedule with visible aftermath

### 5.6 Clocks And Conditions

Clocks and conditions should be normal effect payloads, usable by classes,
social choices, items, and Captain Null theory sessions.

Clock registry:

```json
{
  "bell": {
    "label": "Bell",
    "max": 4,
    "visibility": "public",
    "thresholds": [
      { "id": "bell-force-transition", "at": 4, "beatId": "next-required-transition", "once": false }
    ]
  },
  "stress": {
    "label": "Stress",
    "max": 4,
    "visibility": "notebook",
    "thresholds": [
      { "id": "stress-recovery", "at": 3, "beatId": "greenhouse-recover", "once": true }
    ]
  },
  "rumor": {
    "label": "Rumor",
    "max": 4,
    "visibility": "hidden_until_triggered",
    "thresholds": [
      { "id": "rumor-hallway-callback", "at": 2, "beatId": "hallway-rumor-callback", "once": true }
    ]
  },
  "null_signal": {
    "label": "Null Signal",
    "playerLabel": "Theory Hype",
    "max": 6,
    "visibility": "hidden_until_triggered",
    "thresholds": [
      { "id": "null-stinger", "at": 3, "beatId": "next-null-stinger", "once": true }
    ]
  }
}
```

```json
{
  "clockDeltas": {
    "bell": 0,
    "stress": 1,
    "rumor": 0,
    "null_signal": 1
  },
  "conditions": [
    {
      "id": "frazzled",
      "scope": "day",
      "sourceBeatId": "y1d5-null-minigame",
      "expiresAt": "day_done"
    }
  ],
  "followupBeatId": "y1d2-recover"
}
```

Clock rules:

- clock ids are authored and server-known
- clock changes come only from validated command resolution
- thresholds trigger authored beats, not arbitrary AI events
- clocks can be visible, Notebook-visible, or hidden until revealed
- required school-day completion cannot depend on reducing a clock to zero

Condition rules:

- conditions are tags, not full systems
- each condition has a scope: beat, day, week, or year
- each condition must have a source beat
- conditions can alter wording, hints, route options, and memory text
- conditions cannot block a required beat in Year One

### 5.7 Campus Map

The campus map is an authored graph, not a generated open world.

```json
{
  "id": "ruby-high-campus-y1",
  "opennessTier": "guided_path",
  "defaultStartNodeId": "hallway-east",
  "nodes": [
    {
      "id": "hallway-east",
      "type": "hallway",
      "displayName": "East Hallway",
      "background": "hallway-east.morning",
      "tags": ["arrival", "passing-period"],
      "exits": [
        { "to": "homeroom", "label": "Homeroom", "routeId": "hallway-east-to-homeroom", "availableWhen": "beat >= y1d1-bell" },
        { "to": "cafeteria", "label": "Cafeteria", "routeId": "hallway-east-to-cafeteria", "availableWhen": "timeBlock == lunch" },
        { "to": "courtyard", "label": "Courtyard", "routeId": "hallway-east-to-courtyard", "availableWhen": "unlocked:courtyard" }
      ]
    },
    {
      "id": "homeroom",
      "type": "classroom",
      "displayName": "Homeroom",
      "background": "homeroom.period",
      "tags": ["class", "front-door"],
      "exits": [
        { "to": "hallway-east", "label": "Hallway", "routeId": "homeroom-to-hallway-east", "availableWhen": "class_complete" }
      ]
    },
    {
      "id": "cafeteria",
      "type": "social",
      "displayName": "Cafeteria",
      "background": "cafeteria.lunch",
      "tags": ["lunch", "social"],
      "exits": [
        { "to": "hallway-east", "label": "Hallway", "routeId": "cafeteria-to-hallway-east", "availableWhen": "true" }
      ]
    }
  ],
  "routes": [
    {
      "id": "hallway-east-to-homeroom",
      "from": "hallway-east",
      "to": "homeroom",
      "presentation": "short_hallway_walk",
      "tags": ["short", "crowded"],
      "decisionText": "Take the main hallway before the bell.",
      "visibleTradeoff": "fast route, more witnesses",
      "clockDeltas": { "bell": 1 },
      "possibleEvents": ["bell.rang", "character.passed_by"]
    },
    {
      "id": "cafeteria-to-greenhouse-quiet",
      "from": "cafeteria",
      "to": "greenhouse",
      "presentation": "quiet_side_hall",
      "tags": ["quiet", "recovery", "long"],
      "decisionText": "Take the quiet hall toward the Greenhouse.",
      "visibleTradeoff": "recover Stress, miss one cafeteria beat",
      "clockDeltas": { "bell": 1, "stress": -1 },
      "possibleEvents": ["mika.passed_by", "optional_social.expired"]
    }
  ]
}
```

Map rules:

- nodes and routes are authored content
- route availability is server-resolved from beat, time block, room unlocks,
  conditions, and schedule gates
- route presentation can be animated, but route resolution is not client-owned
- the first slice uses known exits, not fog-of-war exploration
- the first slice is not open world; it is a guided map with authored exits
- a later map becomes semi-open only when routes compete for limited school time
  and produce different consequences
- later years can hide some agent locations until the player learns a schedule,
  rumor, or Notebook clue
- Captain Null should bend routes through First Bell clues, locked doors,
  stopped clocks, over-read coincidences, or rumor pressure instead of moving
  the game to a separate side mode

Route UX rules:

- route choices should be framed as physical decisions: main hallway, side hall,
  courtyard shortcut, library stairs, cafeteria table, Greenhouse path
- route buttons should name the place/action, while a small in-world hint can
  preview the emotional tradeoff
- do not present routes as raw resource transactions such as "Stress -1, Bell +1"
  without the school action that causes those changes
- every route offered as a choice needs at least one of: cast change, clock
  delta, missed opportunity, clue, item timing, or later callback
- route presentation should include the consequence source: who saw the player,
  what hallway was crowded, what object looked wrong, or what optional beat
  expired while the player was elsewhere

### 5.8 Item Cards And Use Resolver

Items are authored verbs. Every usable item needs state, valid targets, effects,
fallback copy, and presentation events.

Item state shape:

```json
{
  "itemId": "flashcards",
  "kind": "consumable_story",
  "owned": true,
  "charges": 2,
  "refreshesAt": "day",
  "acquiredBeatId": "y1d1-tomorrow",
  "activeConditionIds": [],
  "exhaustedUntil": null
}
```

Item use resolver shape:

```json
{
  "id": "flashcards-class-hint",
  "itemId": "flashcards",
  "validWhen": {
    "beatTypes": ["class"],
    "rooms": ["homeroom", "science-lab", "library"],
    "requiresOwned": true,
    "requiresCharges": 1
  },
  "targets": {
    "targetBeatId": "current",
    "targetQuestionId": "optional"
  },
  "effects": {
    "itemDeltas": { "flashcards": -1 },
    "conditions": [{ "id": "focused", "scope": "beat", "sourceBeatId": "current" }],
    "hint": { "kind": "concept", "text": "One answer ignores the evidence." },
    "clockDeltas": { "stress": -1 }
  },
  "presentation": {
    "kind": "embodied_action",
    "animation": "flashcards.flip",
    "routeBeatId": null,
    "speechSlotIntent": "acknowledge_item_use"
  },
  "events": ["item.used", "condition.applied", "hint.revealed"],
  "fallbackLine": "You flip through the cards, but this is not the moment for them."
}
```

Year One item registry:

| Item | Initial State | Resolver |
|---|---|---|
| `notebook` | owned, no charges | `notebook-open` |
| `flashcards` | granted at Day One hook, 2 charges/day | `flashcards-class-hint` |
| `office-pass` | granted by Day Four Office Pass tutorial, 1 story charge/day | `office-pass-recovery-route` |
| `lunch-tray` | appears in Cafeteria, no carry state at first | `lunch-tray-seat-choice` |
| `library-card` | unlocks with Library Day | `library-card-source-panel` |
| `lab-flask` | appears in Science Lab | `lab-flask-evidence-check` |

Concrete resolvers:

| Resolver | Accepted When | Effects |
|---|---|---|
| `notebook-open` | any non-locked beat | opens Notebook screen; no durable state except telemetry |
| `flashcards-class-hint` | class beat, charges > 0 | desk/bag action, itemDeltas.flashcards -1, `focused`, hint reveal, Stress -1 |
| `office-pass-recovery-route` | Stress >= 2 or `failed_forward` after Office Pass tutorial | ask-to-step-out beat, itemDeltas.office-pass -1, Stress -1, Bell +1, route to recovery beat |
| `lunch-tray-seat-choice` | Cafeteria social setup | selects social cast/table variant; may add Heart expression |
| `library-card-source-panel` | Library or explanation beat | unlocks source panel and optional Indra hint |
| `lab-flask-evidence-check` | Science evidence question | inserts observe/test step before answer lock |

Rules:

- item effects use the same effect payloads as classes, social choices, clocks,
  and Null theory sessions
- item use is server-authoritative and idempotent by `commandId`
- invalid item use returns a fallback line and no durable effects
- item actions are contextual; do not show unusable item buttons as dead UI in
  Year One
- item state changes need an embodied presentation event or route beat unless
  the item is purely informational, such as opening the Notebook
- `consumable_story` charges are spent only after the server validates the
  current beat, route transition, target, and resolver id; client animation bugs
  must never consume charges
- story item charges are not paid wallet credits
- paid `wallet.hallPasses` can later buy or refill story opportunities only
  through explicit server fulfillment, never by accidental item use

### 5.9 Shared Effect Payload

Classes, social choices, item uses, clocks, movement callbacks, and Captain Null
theory sessions should all resolve through the same effect payload shape. The payload
describes requested state changes; only the server reducer applies them.

```json
{
  "clockDeltas": { "stress": -1, "bell": 1 },
  "conditions": [
    { "id": "focused", "scope": "beat", "sourceBeatId": "current" }
  ],
  "mastery": { "science": 1 },
  "affinity": { "lyra": 1 },
  "reputationTag": "comeback-student",
  "memoryTag": "shared-struggle",
  "scheduleHint": "indra-library-later",
  "followupBeatId": "greenhouse-recover",
  "followupPrompt": "day-one-recovery-eligible",
  "comicPage": "first-bell/page-01",
  "itemDeltas": { "flashcards": -1 },
  "routeOverride": {
    "routeId": "recovery-greenhouse",
    "toRoomId": "greenhouse",
    "reason": "stress-recovery"
  },
  "hint": {
    "kind": "concept",
    "text": "One answer ignores the evidence.",
    "targetQuestionId": "sally-lab-001-q1"
  },
  "yearbookCandidate": {
    "eligible": true,
    "suggestedArtifactId": "artifact:science-lab-comeback"
  }
}
```

Reducer rules:

- clamp clocks and item charges after every payload
- reject effects that target unowned items, locked rooms, absent characters, or
  unavailable beats
- validate every condition id, memory tag, comic page, and route id against
  authored content
- apply effects in deterministic order: item deltas, clocks, conditions,
  mastery/affinity/reputation, route or follow-up scheduling, Yearbook candidate
  creation
- emit animation and dialogue events from the accepted effect list; do not let
  animation events mutate state
- treat unknown fields as schema errors in fixtures and as rejected no-ops in
  production-safe command handling

### 5.10 Content Authoring Strategy

Ruby High is an authored-school product. That is the differentiator and the
scaling risk.

Do not pretend the content treadmill disappears. Build an authoring pipeline
early.

Authoring units:

| Unit | Purpose | Reuse Strategy |
|---|---|---|
| Day spine | required beats, time blocks, room unlocks, tomorrow hook | mostly authored by hand |
| Class pack | questions, discipline/virtue tags, NPC locks, explanations, outcome resolver | reusable by subject/teacher |
| Approach pack | one teacher problem with Source / Sense / Signal / Sync options, resolver, training deltas, and reaction slots | reusable by teacher mode and problem type |
| Social template | trigger, cast slots, choice archetypes, effect payloads | reused with strict voice/cast variation |
| Room event | route mismatch, bulletin, recovery beat, chance encounter | reused by time block and room role |
| Item resolver | valid targets, effects, fallback, presentation events | system-authored and reused |
| Yearbook artifact | scarce identity page with visual/ritual/callbacks | authored for high-value outcomes |
| Null theory session | theory state, discipline labels, restraint path, aftermath | bespoke by comic page |

Pipeline:

```text
premise / year arc
-> day spine
-> authored exemplar beats
-> template extraction
-> schema validation
-> deterministic text simulation
-> playtest metrics
-> graphical fixture
```

The C wedge currently proves the API shape with some content embedded directly
in C. That is acceptable for Wedge 0, but Year One requires a content compiler
that emits validated C tables or compact binary packs.

Required generated surfaces:

- rooms and exits
- object placements
- NPC schedule overrides
- NPC goal profiles and plan-step templates
- class-session definitions and responder slots
- room-pressure definitions
- relationship memory reason tags
- legal action templates
- approach labels
- effect payloads
- agent agenda rules
- UI string tables
- ranker feature metadata

Action IDs are transitional. The command path no longer has to remain one enum
forever, but authored years should use stable content IDs or compiler-assigned
stable integers rather than hand-maintained `Ruby2WorldActionId` values.

Pre-traction scaling rule:

> Do not pay for full authored depth before retention proves the loop, and do
> not destroy the scalable pipeline while proving it.

Year One should be small and hand-made. The engine, schema, replay harness, and
content compiler should stay cheap to scale. The team does not commit to four
authored years until a retention read shows that the loop retains and the
pipeline can produce Year Two at a fraction of Year One's human cost while
keeping authored peaks hand-made.

Two traps to avoid:

- over-scale Year One into generic mush that disproves the authored-depth thesis
  before it is actually tested
- under-scale the pipeline into a beautiful Week One that cannot become Year Two
  without a writing room

AI use in authoring:

- AI may draft candidate lines, social template variants, question distractors,
  or Yearbook artifact copy in an editor/admin workflow
- AI may propose structured content, but a human or validator must approve ids,
  triggers, effects, gates, and downstream callbacks
- runtime AI still performs inside slots; it does not invent durable day spines,
  routes, rewards, or Yearbook artifacts

AI cost posture:

- author approach packs as structured data first; let AI draft optional line
  variants after the resolver and effects exist
- cache runtime lines by `beatId`, `characterId`, `approachId`, `outcomeId`,
  `archetype`, and major clock state
- prefer authored fallback lines for ordinary approach outcomes and reserve
  runtime generation for high-salience reactions, weekly rituals, and Null
  aftermath
- batch-generate low-stakes ambient lines in authoring tools instead of paying
  runtime cost per room visit
- track AI tokens per completed school day, cache hit rate, fallback rate, and
  cost per sealed Yearbook callback

Approach-pack scaling rule:

> Do not author four bespoke micro-scenes for every classroom beat.

A good approach pack is one strong problem frame plus four meaningfully different
ways to engage it. The four approaches should share the premise, teacher setup,
resolver, and report structure while varying the evidence shown, the action
verb, the NPC reaction, and the effect payload.

Minimum shape:

```text
1 problem frame
4 approach choices: Source / Sense / Signal / Sync
4 outcome snippets, preferably short
1-2 witness reactions selected by schedule and result
1 shared effect payload
0-1 Yearbook candidate hook if the moment is important
```

If every day needs many fully bespoke four-way approach packs, Year One will not
scale. The backlog should prove a small library of reusable problem types:

| Problem Type | Primary Teachers | Reuse |
|---|---|---|
| conflicting source | Ruby, Sally, Edward | Source and Sense tutorial backbone |
| social pressure | Ruby, Eliza, Cafeteria beats | Sync plus virtue expression |
| theory trace | Rati, Captain Null, Library/Courtyard | Signal ramp and restraint |
| experiment choice | Sally, Science Lab | Source / Hustle pressure |
| system coordination | Eliza, Homeroom, Systems Lab | Sync / Source coordination |

Minimum content operating model before campus expansion:

- one complete Week One spine
- one social template library with at least five tested templates
- one class pack pattern per first subject
- one approach-pack library with enough Source / Sense / Signal / Sync problems
  to prove training through play
- one Null page fixture with distinct discipline labels and pressure-state rules
- one Yearbook artifact budget for the year, including target count and ritual
  points
- a validation report showing unreachable beats, repeated templates, missing
  fallbacks, and candidates with no downstream callback

Wedge -1 content budget:

| Content Type | Week One Minimum | Year One Planning Target |
|---|---:|---:|
| Day spines | 5 | 20-30 authored school days |
| Required class packs | 3 | 12-18 |
| Approach packs | 6-10 | 45-70, mostly reusable by problem type |
| Practice/tutorial class variants | 2 | 10-15 |
| Social templates | 5 | 18-24 |
| Hand-authored social exemplars | 8 | 35-50 |
| Room events / route anomalies | 6 | 30-45 |
| Free-block activities | 5 | 25-40 |
| Item resolver variants | 4 | 10-14, but Year One still carries only 1 support slot |
| Companion witness/setup variants | 0-2 | 4-8, no player-selected companion yet |
| Companion action variants | 0 | 0 in Year One; Year Two target is 24-36 after companions unlock |
| Null encounters | 1 | 6 comic-page encounters plus 6-10 minor signals |
| Yearbook artifacts | 2-3 | 15-25 |
| Teacher premise callbacks | 3 | 20-30 |

Authoring priority budget:

| Priority | Hand-Author First | Template / System Support |
|---|---|---|
| Core milestones | Day One, weekly wrap rituals, first Office Pass recovery, first Null theory session, term finale, year finale | none; these carry product identity |
| Character anchors | first meaningful beat with each core classmate, first conflict/repair, first companion activity | template only after one exemplar exists |
| Learning anchors | first class per teacher, first failed-forward recovery, first source/evidence lesson | reusable class pack patterns after proof |
| Mid-week connective tissue | ordinary hallway checks, lunch reactions, practice review, route anomalies | structured templates with cast/voice/effect variation |
| Ambient life | bulletin lines, background chatter, route flavor, repeated room arrivals | generated or templated inside strict budgets |

Production rule:

- spend human writing on moments players will remember, seal, quote, or return for
- use templates for days whose job is rhythm, recovery, practice, or pacing
- every template family needs at least one hand-authored exemplar before expansion
- if the content pipeline stalls, cut optional breadth before weakening Day One,
  weekly rituals, Null encounters, or Yearbook callbacks

Template fatigue checks:

- no social template should appear twice in the same emotional role within three
  school days
- cast swaps must change at least one choice, effect, witness, or opportunity
  cost, not only the speaker line
- a Week One simulation should report repeated trigger/template/cast triples
- a Year One content plan should expose expected words, beats, templates,
  artifacts, and validation errors before implementation expands
- a build-step simulator should run at least 1,000 deterministic Week One
  pathway samples; flag any path where the same social template, emotional role,
  and character combination recurs more than three times

Sizing implication:

> If Wedge -1 cannot produce the Week One minimum above, do not proceed to the
> scene contract as if the product shape is proven.

## 6. Simulation Model

### 6.1 Server Authority

The server owns:

- current authored school year
- current year day
- current beat
- current school day
- time block
- campus map
- player room
- player route transitions
- NPC room positions
- NPC movement requests and approved overrides
- available actions
- item ownership and item use results
- class availability
- social event availability
- agent speaking slots and validated performance packets
- memory writes
- comic page unlocks
- pressure clocks
- active conditions
- metrics/funnel emission
- rewards and progression outcomes

The client owns:

- rendering
- animation
- local input state
- camera/layout
- transient dialogue box state
- optimistic button affordances where safe

The client never decides durable outcomes. It asks the server to perform actions.

### 6.2 Time Blocks

Use discrete school-day blocks, not real-time simulation at first:

```text
arrival
period_1
passing_1
lunch
period_2
after_school
day_done
```

Time blocks are presentation rhythm. They are not permission to mint unlimited daily progress.

Implementation rules:

- visible time block advances during the session
- server still enforces once-per-day graded-class credit
- practice/tutorial classes can play without daily-credit side effects
- D1 retention is measured only from real activity at least 24 hours later

### 6.3 Clocks And Conditions

Clocks and conditions are server-authoritative state derived from command
resolution. The client can display them, but it cannot advance, clear, or invent
them.

Clock state shape:

```json
{
  "id": "stress",
  "label": "Stress",
  "value": 1,
  "max": 4,
  "visibility": "notebook",
  "thresholds": [
    { "at": 3, "beatId": "greenhouse-recover", "once": true }
  ]
}
```

Visibility modes:

| Visibility | Use |
|---|---|
| `public` | safe to show directly in the HUD or Notebook |
| `notebook` | visible in reflective UI, not always on screen |
| `hidden_until_triggered` | used for Captain Null and mystery pressure |
| `internal` | metrics/balancing only |

Hidden clock rule:

- every hidden clock needs visible symptoms before it triggers a major beat
- the Notebook should eventually explain what the player could have noticed
- if players read a trigger as random in testing, make the clock Notebook-visible
  or add stronger symptoms

Condition state shape:

```json
{
  "id": "null-touched",
  "scope": "week",
  "sourceBeatId": "y1d5-null-minigame",
  "appliedAtBeatId": "y1d2-recover",
  "expiresAt": "week_done"
}
```

Implementation rules:

- clamp clock values between zero and max
- apply threshold beats after command resolution
- never trigger more than one required recovery beat from the same threshold in
  one command
- present threshold beats as authored school events, not system warnings
- keep condition count small and expire aggressively

### 6.4 NPC Schedules

Every NPC gets a deterministic schedule with optional state-based overrides.
This is how the school feels inhabited without simulating every footstep.

```json
{
  "id": "lyra",
  "schedule": {
    "arrival": "hallway-east",
    "period_1": "homeroom",
    "passing_1": "hallway-east",
    "lunch": "cafeteria",
    "period_2": "science-lab",
    "after_school": "library"
  },
  "overrides": [
    {
      "when": "affinity >= 3 and player_failed_science_today",
      "room": "library",
      "reason": "studying"
    }
  ]
}
```

NPCs should feel like they move around, but the first version can compute
positions on demand from current time block, year schedule, affinity, recent
events, and active guest faculty.

Co-presence rule:

> A micro-agent can speak in a normal scene only when the world graph says that
> character is present, arriving, passing by, or explicitly remote through an
> authored device such as Notebook, announcement, or screen.

Agent movement is request-based, not autonomous teleportation. Micro-agents can
have tightly scoped movement tools:

```text
read_current_room()
read_visible_characters()
read_own_schedule()
read_known_routes()
request_move(roomId, reason)
propose_encounter(roomId, reason)
```

The server/director can resolve those requests as:

```text
approve_move_now
delay_until_next_time_block
convert_to_later_appearance
deny_not_on_schedule
deny_not_visible_to_player
```

Examples:

| Agent Request | Server Resolution |
|---|---|
| Lyra asks to go to Library after a failed class | approve as after-school override if affinity or class result allows |
| Noor asks to appear in Cafeteria during Homeroom | deny or convert to lunch reaction |
| Indra asks to appear after a Rumor Clock threshold | delay until hallway/library callback beat |
| Captain Null theory session asks to interrupt a route | approve only if Null Signal threshold or authored Week One stinger allows |

The AI may propose motion and encounter flavor. It may not decide durable room
state, route availability, schedule gates, or whether a required beat advances.

NPC placement priority:

```text
active required beat cast
> authored event override
> companion selection for current activity
> state-based schedule override
> deterministic time-block schedule
> approved micro-agent movement request
> ambient/background presence
```

Rules:

- a required beat can always place its required cast
- an authored override beats an agent request
- companion selection reserves the classmate for that activity if validation
  passes
- accepted companion selections set one `activeCompanionId` for the current
  optional/free-time activity; ordinary schedule checks must read that field
  before placing the same NPC elsewhere
- if a later social/template beat expected that companion elsewhere, use an
  alternate witness, remote note, or fallback line instead of silently duplicating
  the character
- micro-agent requests cannot displace a character already committed to a beat,
  activity, companion slot, or higher-priority override
- social templates must validate every cast slot against this resolved
  placement; missing optional witnesses use fallbacks instead of failing the
  scene

#### 6.4.1 NPC Goals And Plans

Detailed implementation PRD: [`PRD_NPC_GOALS_AND_PLANS.md`](./PRD_NPC_GOALS_AND_PLANS.md).

NPC schedules are necessary but not sufficient. Schedules explain where a
classmate is; goals and plans explain why they act. V2 should extend deterministic
placement with per-NPC goals, short validated plans, relationship cells, class
session responders, room pressure, Notebook objectives, and replay coverage.

Design rule:

> If an NPC did something, the engine should be able to answer what they wanted,
> what plan they were following, which world rule allowed it, what changed, and
> whether the same seed can replay it.

### 6.5 AI Use

AI should create surprise inside rails, not decide the rails.

Use a Governor-Controller split:

```text
Narrative / LLM Governor
-> structured goal weights, motive summaries, memory summaries, performance copy
-> Deterministic Kernel / Controller
-> legal movement, clocks, relationships, commands, memory writes, replay
```

The Governor runs slowly: authoring, transition, weekly review, overnight, or
high-salience performance slots. It can update character motive weights,
summarize what an NPC thinks happened, or voice a validated action.

The Controller runs every world step. It owns pathing, co-presence, legal verbs,
clock ticks, relationship math, class outcomes, Notebook writes, Yearbook
candidates, and replay hashes. NPCs do not wait for the LLM to walk through a
hallway or choose from already legal plan steps.

Good:

```text
server decides Lyra is in Cafeteria
server decides the player got 2/3 correct
AI writes Lyra's reaction in her voice
server validates output shape
```

Bad:

```text
AI decides where Lyra is
AI decides whether the player passed
AI decides what reward unlocks
```

Initial AI rules:

- one generated social variation per player/session after first class completion
- social player input is multiple-choice, not freeform text
- no background LLM calls for tactical NPC movement
- any LLM-updated goal weights must happen in a named Governor cycle with
  schema validation, replay logging, and authored fallback
- repeated room visits reuse cached social state until time block changes
- output must validate before it affects affinity, hints, memory, or progress
- failure shows authored fallback and does not block exits

### 6.6 Micro-Agent Performance Packets

A micro-agent does not chat freely. It performs inside a server-granted slot. The
slot defines who may speak, why they are speaking, which tools they can use, how
long the line can be, and where the graphical client should present it.

Performance packet shape:

```json
{
  "id": "perf_lyra_001",
  "characterId": "lyra",
  "slotId": "class-reveal-reaction-1",
  "intent": "wrong_answer_reaction",
  "line": "wait what -- i KNEW it was c. ok im rewriting my notes.",
  "bubble": {
    "type": "speech",
    "priority": "reaction",
    "anchor": "character",
    "maxChars": 96
  },
  "performance": {
    "pose": "panic-notes",
    "expression": "anxious",
    "target": "player",
    "durationMs": 2600
  },
  "toolCalls": [
    {
      "tool": "lock_answer",
      "result": { "questionId": "y1d1-ruby-001", "answer": "C" }
    }
  ],
  "fallbackLine": "Lyra rewrites the same line twice."
}
```

Slot grant shape:

```json
{
  "slotId": "class-reveal-reaction-1",
  "beatId": "y1d1-homeroom",
  "characterId": "lyra",
  "intent": "wrong_answer_reaction",
  "allowedTools": ["read_own_profile", "read_current_question", "lock_answer"],
  "lineBudget": { "maxChars": 96, "maxSentences": 2 },
  "requiredVoiceTags": ["anxious-overachiever", "literature-leaning"],
  "outputTarget": "speech_bubble"
}
```

Rules:

- a character can speak only if present, arriving, passing by, or explicitly
  remote-authorized by the scene
- the server/director grants slots; the micro-agent cannot create its own turn
- tools are per-slot, not per-agent global powers
- generated lines must fit the bubble budget and allowed tone
- tool results are proposals until validated by the server reducer
- performance packets can animate pose, expression, target, and timing; they
  cannot mutate durable state directly
- validation failure uses the authored `fallbackLine` and still advances the
  scene if the beat itself is otherwise complete
- cache accepted packets by beat/result where repetition would be noticeable
  but not valuable

### 6.7 Rankers, Traces, And Replay

Rankers may order legal choices, choose legal NPC agenda or goal-plan intents,
and choose which visible LLM branches to pre-generate. They must not create
choices, hide required choices, invent room presence, mutate state, or decide
durable outcomes.

Ranker boundaries:

| Ranker | Purpose | Allowed Inputs | Forbidden |
|---|---|---|---|
| UI action ranker | order legal player actions for presentation | world snapshot, legal actions, clocks, room, time block, present objects and people | adding actions, removing legal actions for difficulty, mutating state |
| LLM pregen ranker | pick which visible branch consequence to generate in the background | visible branch list, scene importance, cache history, latency budget | hidden branch generation, changed authored outcomes, blocking play on cache miss |
| Agent goal-plan ranker | choose among legal NPC agenda or goal-plan intents | filtered agenda table, active goals, plan cursors, class phase, room pressure, relationship status, memory tags, blocked reasons, schedule, room/object state | teleporting NPCs, remote speech, overriding required beats, inventing goals, plan steps, relationship deltas, or Notebook memory |
| Yearbook candidate ranker | order milestone-only Yearbook candidates for review | explicit candidates, score features, repetition/rarity, callback availability | creating candidates from ordinary noise, sealing without ritual or player choice |

Minimum ranker trace fields:

- schema and feature encoder version
- content pack version
- replay-stable state hash
- task name
- legal candidate IDs
- feature vector or feature encoder reference
- ranked indices and scores
- selected candidate
- optional target candidate
- post-choice utility label, when available

Replay is not optional tooling. A ranker trace without the exact content pack
cannot be safely replayed after authors change action labels, room schedules, or
effect payloads. Every test harness that drives a scripted or interactive choice
should emit enough trace data to rebuild the legal candidate set, the selected
action, and the school-day summary under the same seed.

## 7. API Shape

Ruby High 2.0 needs structured scene APIs. It should not scrape current viewer HTML.

### 7.1 Scene Snapshot

```http
GET /api/apps/ruby-high/ruby2/session/:sessionId/scene
```

Response:

```json
{
  "schema": "ruby-high-rpg-scene.v1",
  "sceneVersion": 12,
  "eventCursor": "evt_000012",
  "serverTime": "2026-05-19T12:00:00.000Z",
  "sessionId": "rh:user:...",
  "visitorId": "rhv_...",
  "year": { "id": "year1", "name": "First Bell", "autonomy": "guided" },
  "day": { "id": "year1-day1", "title": "First Homeroom", "schoolDay": "2026-05-19" },
  "beat": {
    "id": "y1d1-arrival",
    "type": "arrival",
    "required": true,
    "nextRequiredAction": "setup:name-vibe"
  },
  "timeBlock": "arrival",
  "player": {
    "roomId": "hallway-east",
    "character": {},
    "grade": "9",
    "disciplines": { "source": 0, "sense": 1, "sync": 1, "signal": 0 },
    "virtues": { "head": 1, "heart": 0, "hustle": 1, "honor": 0 },
    "items": {
      "notebook": { "itemId": "notebook", "kind": "tool", "owned": true, "refreshesAt": "never", "acquiredBeatId": "y1d1-arrival", "activeConditionIds": [] }
    },
    "wallet": { "hallPasses": 0 }
  },
  "clocks": [
    { "id": "bell", "label": "Bell", "value": 0, "max": 4, "visibility": "public" },
    { "id": "stress", "label": "Stress", "value": 0, "max": 4, "visibility": "notebook" },
    { "id": "rumor", "label": "Rumor", "value": 0, "max": 4, "visibility": "hidden_until_triggered" },
    { "id": "null_signal", "label": "Null Signal", "value": 0, "max": 6, "visibility": "hidden_until_triggered" }
  ],
  "conditions": [
    { "id": "focused", "scope": "day", "sourceBeatId": "y1d1-name-vibe" }
  ],
  "map": {
    "id": "ruby-high-campus-y1",
    "currentNodeId": "hallway-east",
    "knownNodeIds": ["hallway-east", "homeroom", "cafeteria"],
    "availableRoutes": [
      {
        "routeId": "hallway-east-to-homeroom",
        "toRoomId": "homeroom",
        "label": "Main hall to Homeroom",
        "decisionText": "Take the main hallway before the bell.",
        "visibleTradeoff": "fast route, more witnesses",
        "presentation": "short_hallway_walk",
        "tags": ["short", "crowded"]
      }
    ]
  },
  "room": {
    "id": "hallway-east",
    "name": "East Hallway",
    "background": "hallway-east.morning",
    "exits": []
  },
  "characters": [
    {
      "id": "ruby",
      "assetId": "ruby.full",
      "pose": "idle",
      "screenAnchor": "right",
      "roomId": "hallway-east",
      "presentReason": "arrival_greeting"
    }
  ],
  "performanceQueue": [
    {
      "id": "perf_ruby_001",
      "characterId": "ruby",
      "slotId": "arrival-greeting",
      "intent": "orient_player",
      "line": "First bell is not scary. It is just loud.",
      "bubble": { "type": "speech", "priority": "primary", "anchor": "character", "maxChars": 96 },
      "performance": { "pose": "idle", "expression": "warm", "target": "player", "durationMs": 2800 },
      "toolCalls": [],
      "fallbackLine": "Ruby waits by the hallway door."
    }
  ],
  "actions": [
    { "id": "setup:vibe-prepared", "type": "setup", "label": "Prepared", "enabled": true },
    { "id": "setup:vibe-curious", "type": "setup", "label": "Curious", "enabled": true },
    { "id": "setup:vibe-scrambling", "type": "setup", "label": "Scrambling", "enabled": true },
    { "id": "setup:vibe-quiet", "type": "setup", "label": "Quiet", "enabled": true },
    { "id": "check:notebook", "type": "check_notes", "label": "Notebook", "enabled": true }
  ],
  "itemActions": [
    {
      "id": "item:notebook-open",
      "itemId": "notebook",
      "itemUseId": "notebook-open",
      "type": "use_item",
      "label": "Notebook",
      "enabled": true,
      "display": { "slot": "school-bag", "icon": "notebook.icon", "cardAsset": "notebook.card" },
      "targets": { "targetBeatId": "y1d1-arrival" },
      "charges": null
    }
  ],
  "memoryTargets": [
    { "id": "first-homeroom", "scope": "notebook", "status": "pending" }
  ],
  "tomorrowHook": "science-lab-redemption",
  "metrics": { "funnelStep": "arrival_scene_seen" }
}
```

### 7.2 Command Endpoint

```http
POST /api/apps/ruby-high/ruby2/session/:sessionId/command
```

Day One command examples:

```json
{ "commandId": "cmd_client_001", "sceneVersion": 12, "type": "setup_choice", "setupId": "y1d1-name-vibe", "choiceId": "vibe-curious" }
{ "commandId": "cmd_client_002", "sceneVersion": 13, "type": "advance_dialogue" }
{ "commandId": "cmd_client_003", "sceneVersion": 14, "type": "move", "to": "homeroom" }
{ "commandId": "cmd_client_004", "sceneVersion": 15, "type": "start_class", "facultyId": "ruby" }
{ "commandId": "cmd_client_005", "sceneVersion": 16, "type": "answer_question", "questionId": "y1d1-ruby-001", "answer": "B" }
{ "commandId": "cmd_client_006", "sceneVersion": 17, "type": "social_choice", "choiceSetId": "cafeteria-first-result", "choiceId": "next-time" }
{ "commandId": "cmd_client_007", "sceneVersion": 18, "type": "record_memory", "memoryId": "first-homeroom" }
```

Day Two command examples:

```json
{ "commandId": "cmd_client_101", "sceneVersion": 42, "type": "move", "to": "science-lab" }
{ "commandId": "cmd_client_102", "sceneVersion": 43, "type": "start_class", "facultyId": "sally-science" }
{ "commandId": "cmd_client_103", "sceneVersion": 44, "type": "use_item", "itemId": "flashcards", "itemUseId": "flashcards-class-hint", "targetBeatId": "y1d2-science-lab", "targetQuestionId": "sally-lab-001-q1" }
{ "commandId": "cmd_client_104", "sceneVersion": 45, "type": "answer_question", "questionId": "sally-lab-001-q1", "answer": "A" }
{ "commandId": "cmd_client_105", "sceneVersion": 46, "type": "acknowledge_signal_tease", "teaseId": "clock-margin-mark" }
```

Week One Null command examples:

```json
{ "commandId": "cmd_client_501", "sceneVersion": 90, "type": "null_minigame_action", "minigameId": "null-first-signal", "roundId": "observe-contradiction", "buttonIndex": 0, "discipline": "source", "label": "Observe" }
{ "commandId": "cmd_client_502", "sceneVersion": 91, "type": "null_minigame_action", "minigameId": "null-first-signal", "roundId": "silence-or-break", "buttonIndex": 3, "discipline": "signal", "label": "Stay Silent" }
```

Rules:

- `commandId` is required for mutating commands.
- Replaying the same `commandId` returns the original result.
- Stale `sceneVersion` returns the latest scene plus a recoverable conflict error.
- The server never trusts client-provided room, character, reward, affinity, or memory state.
- Durable effects are resolved from accepted `Ruby2EffectPayload` records only.
- Every accepted command produces zero or more ordered animation events.

### 7.3 Asset Manifest

```http
GET /api/apps/ruby-high/ruby2/assets/manifest
```

Response:

```json
{
  "schema": "ruby-high-rpg-assets.v1",
  "backgrounds": {
    "hallway-east.morning": {
      "url": "/api/apps/ruby-high/assets/ruby2/backgrounds/hallway-east_morning.png",
      "width": 1920,
      "height": 1080,
      "safeRects": {
        "dialogue": [80, 720, 1760, 260],
        "characters": [180, 160, 1560, 640]
      }
    }
  },
  "characters": {},
  "items": {
    "notebook.icon": {
      "url": "/api/apps/ruby-high/assets/ruby2/items/notebook_icon.png",
      "width": 256,
      "height": 256,
      "uiUse": "school_bag"
    },
    "notebook.card": {
      "url": "/api/apps/ruby-high/assets/ruby2/items/notebook_card.png",
      "width": 1024,
      "height": 1400,
      "uiUse": "card_zoom"
    },
    "flashcards.icon": {
      "url": "/api/apps/ruby-high/assets/ruby2/items/flashcards_icon.png",
      "width": 256,
      "height": 256,
      "uiUse": "school_bag"
    },
    "flashcards.card": {
      "url": "/api/apps/ruby-high/assets/ruby2/items/flashcards_card.png",
      "width": 1024,
      "height": 1400,
      "uiUse": "card_zoom"
    },
    "office-pass.icon": {
      "url": "/api/apps/ruby-high/assets/ruby2/items/office-pass_icon.png",
      "width": 256,
      "height": 256,
      "uiUse": "school_bag"
    },
    "office-pass.card": {
      "url": "/api/apps/ruby-high/assets/ruby2/items/office-pass_card.png",
      "width": 1024,
      "height": 1400,
      "uiUse": "card_zoom"
    },
    "library-card.icon": {
      "url": "/api/apps/ruby-high/assets/ruby2/items/library-card_icon.png",
      "width": 256,
      "height": 256,
      "uiUse": "school_bag"
    },
    "library-card.card": {
      "url": "/api/apps/ruby-high/assets/ruby2/items/library-card_card.png",
      "width": 1024,
      "height": 1400,
      "uiUse": "card_zoom"
    },
    "lab-flask.icon": {
      "url": "/api/apps/ruby-high/assets/ruby2/items/lab-flask_icon.png",
      "width": 256,
      "height": 256,
      "uiUse": "contextual_action"
    },
    "lab-flask.card": {
      "url": "/api/apps/ruby-high/assets/ruby2/items/lab-flask_card.png",
      "width": 1024,
      "height": 1400,
      "uiUse": "card_zoom"
    },
    "lunch-tray.icon": {
      "url": "/api/apps/ruby-high/assets/ruby2/items/lunch-tray_icon.png",
      "width": 256,
      "height": 256,
      "uiUse": "contextual_action"
    },
    "lunch-tray.card": {
      "url": "/api/apps/ruby-high/assets/ruby2/items/lunch-tray_card.png",
      "width": 1024,
      "height": 1400,
      "uiUse": "card_zoom"
    }
  }
}
```

## 8. Data Model Additions

New durable concepts:

- school year id
- year day id
- current beat id
- completed beat ids
- current time block
- campus map id
- current room id
- known room ids
- route history
- room visit history
- NPC room positions
- NPC movement requests
- item state
- daily loadout
- item use history
- activity/free-block history
- companion selection history
- social event history
- memory records
- yearbook candidate records
- yearbook records
- comic page unlocks
- clock state
- active conditions
- affinity deltas
- reputation tags
- reputation archetypes
- discipline expression history
- virtue expression history
- scene asset ids
- RPG client version

Potential state:

```ts
type Ruby2State = {
  clientVersion: string;
  sceneVersion: number;
  eventCursor: string;
  schoolYearId: string;
  yearDayId: string;
  schoolDay: string;
  currentBeatId: string;
  completedBeatIds: string[];
  campusMapId: string;
  currentRoomId: string;
  knownRoomIds: string[];
  routeHistory: Ruby2RouteRecord[];
  currentTimeBlock: Ruby2TimeBlock;
  visitedRooms: Record<string, number>;
  npcPositions: Record<string, Ruby2NpcPosition>;
  npcMoveRequests: Ruby2NpcMoveRequest[];
  items: Record<string, Ruby2ItemState>;
  dailyLoadout: Ruby2LoadoutState;
  itemUses: Ruby2ItemUseRecord[];
  activityUses: Ruby2ActivityUseRecord[];
  companionSelections: Ruby2CompanionSelectionRecord[];
  companionRuntime: Ruby2CompanionRuntimeState;
  socialEvents: Ruby2SocialEventRecord[];
  memories: Ruby2MemoryRecord[];
  yearbookCandidates: Ruby2YearbookCandidateRecord[];
  yearbookEntries: Ruby2YearbookEntryRecord[];
  comicUnlocks: string[];
  clocks: Record<string, Ruby2ClockState>;
  conditions: Ruby2ConditionRecord[];
  affinity: Record<string, number>;
  reputationTags: string[];
  dominantArchetype?: Ruby2ReputationArchetype;
  secondaryArchetype?: Ruby2ReputationArchetype;
  disciplineExpressionCounts: Record<"source" | "sense" | "sync" | "signal", number>;
  virtueExpressionCounts: Record<"head" | "heart" | "hustle" | "honor", number>;
  npcRoomOverrides: Record<string, Ruby2NpcRoomOverride>;
  commandResults: Record<string, Ruby2CommandResult>;
  lastSceneEventId: string;
};

type Ruby2ClockState = {
  id: string;
  value: number;
  max: number;
  visibility: "public" | "notebook" | "hidden_until_triggered" | "internal";
  triggeredThresholds: string[];
};

type Ruby2ConditionRecord = {
  id: string;
  scope: "beat" | "day" | "week" | "year";
  sourceBeatId: string;
  appliedAtBeatId: string;
  expiresAt?: string;
};

type Ruby2YearbookEntryRecord = {
  id: string;
  title: string;
  kind: "identity_card" | "relationship_page" | "null_page" | "weekly_spread" | "finale_spread";
  sourceMemoryIds: string[];
  sourceBeatIds: string[];
  identityTags: string[];
  signatures: string[];
  visualTreatment: string;
  unlocks: Array<{ type: string; id?: string; beatId?: string }>;
  sealedAtSchoolDay: string;
};

type Ruby2YearbookCandidateRecord = {
  id: string;
  sourceMemoryIds: string[];
  sourceBeatIds: string[];
  score: number;
  scoreBreakdown?: {
    mechanical: number;
    social: number;
    identity: number;
    callback: number;
    rarity: number;
    repetitionPenalty: number;
  };
  reason: string;
  suggestedArtifactId?: string;
  status: "candidate" | "highlighted" | "pinned" | "sealed" | "archived" | "expired";
  expiresAtRitualId?: string;
};

type Ruby2RouteRecord = {
  routeId: string;
  fromRoomId: string;
  toRoomId: string;
  sourceBeatId: string;
  timeBlock: Ruby2TimeBlock;
};

type Ruby2NpcPosition = {
  roomId: string;
  reason: "schedule" | "override" | "arrival" | "passing_by" | "remote";
  visibleToPlayer: boolean;
};

type Ruby2NpcMoveRequest = {
  characterId: string;
  targetRoomId: string;
  reason: string;
  requestedAtBeatId: string;
  status: "approved" | "delayed" | "converted" | "denied";
};

type Ruby2ReputationArchetype =
  | "scholar"
  | "connector"
  | "operator"
  | "conscience"
  | "signal_reader"
  | "comeback_student"
  | "wild_card";

type Ruby2LoadoutState = {
  schoolDay: string;
  alwaysCarriedItemIds: string[];
  supportItemIds: string[];
  supportSlotsUsed: number;
  supportSlotsMax: number;
  lockedAtBeatId?: string;
};

type Ruby2ActivityUseRecord = {
  activityBlockId: string;
  activityId: string;
  schoolDay: string;
  timeBlock: Ruby2TimeBlock;
  companionId?: string;
  opportunityCosts: string[];
  effects: Ruby2EffectPayload;
};

type Ruby2CompanionSelectionRecord = {
  characterId: string;
  activityId: string;
  schoolDay: string;
  accepted: boolean;
  fallbackReason?: "absent" | "affinity_low" | "already_committed" | "slot_full";
};

type Ruby2CompanionRuntimeState = {
  activeCompanionId?: string;
};

type Ruby2ConditionEffect = {
  id: string;
  scope: "beat" | "day" | "week" | "year";
  sourceBeatId: string;
  expiresAt?: string;
};

type Ruby2EffectPayload = {
  milestoneKind?: "none" | "class_report" | "social_climax" | "null_resolution" | "weekly_ritual";
  clockDeltas?: Partial<Record<"bell" | "stress" | "rumor" | "null_signal", number>>;
  conditions?: Ruby2ConditionEffect[];
  mastery?: Record<string, number>;
  disciplineDeltas?: Partial<Record<"source" | "sense" | "sync" | "signal", number>>;
  virtueDeltas?: Partial<Record<"head" | "heart" | "hustle" | "honor", number>>;
  affinity?: Record<string, number>;
  reputationTag?: string;
  memoryTag?: string;
  scheduleHint?: string;
  followupBeatId?: string;
  followupPrompt?: string;
  comicPage?: string;
  itemDeltas?: Record<string, number>;
  routeOverride?: {
    routeId: string;
    toRoomId: string;
    reason: string;
  };
  hint?: {
    kind: "concept" | "source" | "eliminate_option" | "route";
    text: string;
    targetQuestionId?: string;
  };
  yearbookCandidate?: {
    eligible: boolean;
    suggestedArtifactId?: string;
    reason?: string;
  };
};

// Reducer rule: yearbookCandidate is ignored unless milestoneKind is
// class_report, social_climax, null_resolution, or weekly_ritual.
// Notebook-only events can still record memory tags, hints, clocks, and affinity.

type Ruby2PerformancePacket = {
  id: string;
  characterId: string;
  slotId: string;
  intent: string;
  line: string;
  bubble: {
    type: "speech" | "thought" | "announcement" | "caption";
    priority: "primary" | "reaction" | "ambient";
    anchor: "character" | "hud" | "room";
    maxChars: number;
  };
  performance: {
    pose: string;
    expression: string;
    target?: string;
    durationMs: number;
  };
  toolCalls: Array<{ tool: string; result: unknown }>;
  fallbackLine: string;
};

type Ruby2ItemState = {
  itemId: string;
  kind: "tool" | "consumable_story" | "key" | "scene_prop";
  owned: boolean;
  charges?: number;
  refreshesAt?: "beat" | "day" | "week" | "never";
  acquiredBeatId: string;
  activeConditionIds: string[];
  exhaustedUntil?: string;
};

type Ruby2ItemUseRecord = {
  itemUseId: string;
  itemId: string;
  sourceBeatId: string;
  targetBeatId?: string;
  targetQuestionId?: string;
  accepted: boolean;
  effects: Ruby2EffectPayload;
  events: string[];
};
```

Keep stored state small. Derived values such as "which NPCs are in this room" should come from year schedule, NPC schedule, and current state unless a durable override is needed.

### 8.1 C Implementation Contract

The C client should not parse gameplay strings at runtime. Content should be
compiled into compact ids, enums, fixed arrays, and simple byte-code-like gates.

Unified reducer:

```c
void ruby2_apply_effect_payload(
  Ruby2State* state,
  const Ruby2EffectPayload* payload,
  Ruby2EventQueue* out_events
);
```

All accepted commands produce an effect payload. Only the reducer mutates
durable state. Class, social, item, activity, route, and Null commands should
share this path.

Compiled branch/route gates:

```c
typedef enum {
  RUBY2_VAR_STRESS,
  RUBY2_VAR_BELL,
  RUBY2_VAR_RUMOR,
  RUBY2_VAR_NULL_SIGNAL,
  RUBY2_VAR_DISC_SOURCE,
  RUBY2_VAR_DISC_SENSE,
  RUBY2_VAR_DISC_SYNC,
  RUBY2_VAR_DISC_SIGNAL,
  RUBY2_VAR_VIRT_HEAD,
  RUBY2_VAR_VIRT_HEART,
  RUBY2_VAR_VIRT_HUSTLE,
  RUBY2_VAR_VIRT_HONOR,
  RUBY2_VAR_AFF_LYRA,
  RUBY2_VAR_AFF_MIKA,
  RUBY2_VAR_COUNT
} Ruby2StateVar;

typedef enum {
  RUBY2_FLAG_ROOM_UNLOCKED,
  RUBY2_FLAG_ITEM_CARRIED,
  RUBY2_FLAG_REPUTATION,
  RUBY2_FLAG_COMPANION_PRESENT
} Ruby2StateFlagKind;

typedef enum {
  RUBY2_GATE_TRUE,
  RUBY2_GATE_VAR_GTE,
  RUBY2_GATE_VAR_EQ,
  RUBY2_GATE_FLAG_SET,
  RUBY2_GATE_AND,
  RUBY2_GATE_OR,
  RUBY2_GATE_NOT
} Ruby2GateType;

typedef struct {
  Ruby2GateType type;
  uint16_t arg1;
  uint16_t arg2;
} Ruby2GateOp;
```

The content build step should turn strings such as `timeBlock == lunch` into
gate ops over generated state-variable and flag enums. Runtime gate evaluation
should be integer switches over bounded arrays, not a pile of type-specific
query operators.

Compound gates:

Nested JSON gates such as `{ "all": [...], "any": [...] }` should compile to a
flat Reverse Polish Notation instruction list. The runtime evaluator uses a tiny
fixed boolean stack, not recursion and not heap allocation.

```c
#define RUBY2_MAX_GATE_OPS 16
#define RUBY2_MAX_GATE_STACK 8

typedef struct {
  Ruby2GateOp ops[RUBY2_MAX_GATE_OPS];
  uint8_t count;
} Ruby2CompiledGate;

bool ruby2_eval_gate(
  const Ruby2StateBlock* state,
  const Ruby2CompiledGate* gate
) {
  bool stack[RUBY2_MAX_GATE_STACK];
  int8_t sp = -1;

  for (uint8_t i = 0; i < gate->count; ++i) {
    const Ruby2GateOp* op = &gate->ops[i];
    switch (op->type) {
      case RUBY2_GATE_VAR_GTE:
        if (sp >= RUBY2_MAX_GATE_STACK - 1) return false;
        stack[++sp] = state->variables[op->arg1] >= op->arg2;
        break;
      case RUBY2_GATE_VAR_EQ:
        if (sp >= RUBY2_MAX_GATE_STACK - 1) return false;
        stack[++sp] = state->variables[op->arg1] == op->arg2;
        break;
      case RUBY2_GATE_FLAG_SET:
        if (sp >= RUBY2_MAX_GATE_STACK - 1) return false;
        stack[++sp] = ruby2_state_flag_set(state, op->arg1, op->arg2);
        break;
      case RUBY2_GATE_AND:
        if (sp < 1) return false;
        stack[sp - 1] = stack[sp - 1] && stack[sp];
        --sp;
        break;
      case RUBY2_GATE_OR:
        if (sp < 1) return false;
        stack[sp - 1] = stack[sp - 1] || stack[sp];
        --sp;
        break;
      case RUBY2_GATE_NOT:
        if (sp < 0) return false;
        stack[sp] = !stack[sp];
        break;
      default:
        if (sp >= RUBY2_MAX_GATE_STACK - 1) return false;
        stack[++sp] = ruby2_eval_atomic_gate(state, op);
        break;
    }
  }

  return sp == 0 ? stack[0] : false;
}
```

Fixed state target:

```c
#define RUBY2_MAX_CONDITIONS 16
#define RUBY2_MAX_ITEMS 12
#define RUBY2_MAX_MEMORIES 64
#define RUBY2_MAX_YEARBOOK_CANDIDATES 32
#define RUBY2_MAX_YEARBOOK_ENTRIES 25
#define RUBY2_MIN_YEARBOOK_CANDIDATE_SCORE 4
#define RUBY2_MAX_ACTIVITY_HISTORY 64
#define RUBY2_MAX_PERFORMANCE_QUEUE 8
#define RUBY2_CHARACTER_NONE 255

typedef struct {
  uint32_t scene_version;
  uint32_t event_cursor;
  uint16_t school_year_id;
  uint16_t year_day_id;
  uint16_t current_beat_id;
  uint16_t current_room_id;
  uint8_t current_time_block;
  Ruby2ClockState clocks[4];
  Ruby2ConditionRecord conditions[RUBY2_MAX_CONDITIONS];
  uint8_t condition_count;
  Ruby2ItemState items[RUBY2_MAX_ITEMS];
  uint8_t item_count;
  uint16_t support_item_ids[3];
  uint8_t support_item_count;
  uint8_t affinity[8];
  uint16_t variables[RUBY2_VAR_COUNT];
  uint16_t reputation_archetype;
  uint32_t discipline_counts[4];
  uint32_t virtue_counts[4];
  Ruby2YearbookCandidateRecord yearbook_candidates[RUBY2_MAX_YEARBOOK_CANDIDATES];
  uint8_t yearbook_candidate_count;
  uint8_t active_companion_id;
} Ruby2StateBlock;
```

Bounded Yearbook candidate insertion:

```c
void ruby2_insert_yearbook_candidate(
  Ruby2StateBlock* state,
  Ruby2YearbookCandidateRecord candidate
) {
  if (candidate.score < RUBY2_MIN_YEARBOOK_CANDIDATE_SCORE) {
    return;
  }

  if (state->yearbook_candidate_count < RUBY2_MAX_YEARBOOK_CANDIDATES) {
    state->yearbook_candidates[state->yearbook_candidate_count++] = candidate;
    return;
  }

  int16_t lowest_idx = -1;
  int32_t lowest_score = INT32_MAX;

  for (uint8_t i = 0; i < state->yearbook_candidate_count; ++i) {
    const Ruby2YearbookCandidateRecord* existing = &state->yearbook_candidates[i];
    if (ruby2_candidate_is_sealed(existing) || ruby2_candidate_is_pinned(existing)) continue;
    if (existing->score < lowest_score) {
      lowest_score = existing->score;
      lowest_idx = (int16_t)i;
    }
  }

  if (lowest_idx >= 0 && candidate.score > lowest_score) {
    state->yearbook_candidates[lowest_idx] = candidate;
  }
}
```

Candidate overflow must be deterministic: reject weak candidates, evict only
lower-scoring unsealed/unpinned candidates, and never mutate sealed Yearbook
entries.

Active companion:

- accepted companion selections set `active_companion_id`
- NPC placement checks consult `active_companion_id` before ordinary schedules
- only one companion can be active during a free-time activity
- conflicting social templates must route to fallback witness paths rather than
  duplicating the companion elsewhere
- clear `active_companion_id` at the activity end beat or next time-block transition

Performance queue:

```c
typedef struct {
  Ruby2PerformancePacket packets[RUBY2_MAX_PERFORMANCE_QUEUE];
  uint8_t head;
  uint8_t tail;
  uint8_t count;
} Ruby2PerformanceQueue;
```

C rules:

- no gameplay string parsing in the play surface
- no heap allocation required for normal scene playback
- ids should be generated/hashed consistently by the content pipeline
- arrays should have explicit caps and safe overflow behavior
- compound gates compile to flat bounded instruction arrays and evaluate through
  stack code
- candidate queue overflow must be deterministic and priority-based
- `consumable_story` item charges decrement only inside the accepted reducer path
  after beat, target, and resolver validation
- companion co-presence locks outrank normal schedules for the active activity
- scene JSON can be used at API boundaries, but the client should decode into
  fixed structs before rendering
- replay tests should compare state blocks and event queues after command
  sequences
- rejected gates, absent companions, or missing optional witnesses should return
  fallback actions/events, not crash or stall

## 9. Client And Presentation

### 9.1 Recommended Client Shape

Default stance: web-first until retention says otherwise.

`ruby2/c` is a deterministic-core proving ground first. It should prove world
state, reducers, replay, rankers, and fixed-layout scene playback. It is not
automatically the production client. A custom C/sokol client becomes justified
only after the web retention loop clears the learn-first gate and the hard
rendering spike proves text, touch, and layout quality.

If justified, use a C/sokol game client for the play surface:

- sokol_app for lifecycle/input/window
- sokol_gfx for rendering
- sokol_audio later if needed
- sokol_fetch or platform bridge for network calls
- stb_image or equivalent for image decode
- signed distance field or bitmap font path for text
- Emscripten target for web/WASM
- native targets for iOS and Android

Keep platform shells thin:

- web shell: WASM boot, auth handoff, local storage bridge, fetch bridge
- iOS shell: lifecycle, store billing, secure storage, push/deep links later
- Android shell: lifecycle, Play Billing, secure storage, push/deep links later

Long-form editing, admin dashboards, metrics charts, account management, and
billing management remain better as web/native shell UI. The v1/PWA surface
remains the right retention-truth build until users prove the v2 loop deserves
native platform investment.

In-world UX rule:

> Gameplay UI should feel like school equipment before it feels like a HUD.

The server can expose clocks, charges, routes, and gates as explicit state, but
the client should present them through school objects whenever possible:

| System | Preferred Presentation | Avoid |
|---|---|---|
| Stress | Notebook margin marks, character expression, recovery prompt | permanent red meter dominating the screen |
| Bell | wall clock, bell sound, passing-period banner | abstract turn counter without place |
| Inventory | school-bag tray and physical item cards | loot grid or RPG backpack spreadsheet |
| Yearbook | page drafts, signatures, stickers, classmate ritual | generic collection-management screen |
| Routes | doors, hallway signs, map overlay, route cards with scene art | bare destination list with raw discipline deltas |
| Null Signal / Theory Hype | First Bell page, margin glyph, rumor thread, stopped clock, hallway poster | sudden crisis alert or genre-breaking rupture with no school-side symptom |

Visible UI is allowed when clarity needs it. The product rule is that the player
should understand what school action caused the system effect.

### 9.2 First Hard Client Spike

The first client spike is not "build the game." It is a viability test for text, touch, and layout:

- render one 1920x1080 hallway background into desktop and mobile viewports
- render one transparent Ruby standee with correct scaling and anchoring
- render a dialogue box with wrapped text, speaker name, and two choices
- support pointer/touch selection with stable hit targets
- support a reduced-motion flag
- load scene JSON and an asset manifest from local fixtures
- build the same code path to web/WASM

If this spike cannot make text, touch, and layout feel good, stop before deeper client work.

### 9.3 Assets

Existing teacher/student art should become standees or sprites composited over generated scenes.

Required character derivatives:

- full-body standee
- face portrait
- small icon
- optional expression variants
- optional simple idle/talk animation frames

Background rules:

- canonical assets, not arbitrary per-session images
- no text in background images
- no characters baked into room backgrounds
- consistent camera angle per room
- safe negative space for dialogue and UI
- mobile crop variants or safe crop zones
- deterministic asset ids in source control or object storage

Initial background set:

```text
hallway-east_morning.png
hallway-east_passing.png
homeroom_period.png
cafeteria_lunch.png
```

The style bible should be written before generating the full room set.

### 9.4 Animation

Animations should be event-driven.

Events:

```text
beat.started
route.started
route.completed
room.entered
room.exited
character.appeared
character.moved
item.gained
item.used
item.exhausted
item.embodied_scene_completed
hint.revealed
dialogue.line_started
dialogue.line_finished
question.revealed
answer.locked
npc.answer_locked
answer.resolved
social.choice_selected
clock.delta_applied
condition.applied
null_minigame.started
null_minigame.choice_selected
null_minigame.completed
comic_page.unlocked
memory.recorded
yearbook.candidate_created
yearbook.ritual_started
yearbook.sealed
bell.rang
```

Reduced-motion and low-power modes map events to simpler transitions. They do not disable state changes.

## 10. Metrics

Ruby High 2.0 should be measured by retention truth, not spectacle.

V1 already measures most of the validation path in
`src/services/ruby-high-service.ts` and `src/routes/metrics-events.ts`:

- activation funnel: `first_character_created`, `first_question_answered`,
  `first_daily_class_passed`, `first_essay_submitted`,
  `first_grade_completed`
- first-10-minute activation windows for the same funnel
- return signal: `visitor_seen`, `app_open`, `session_resume`
- Yearbook engagement: `yearbook_open`, `yearbook_copy`
- arbitrary event `metadata`, which makes cohort tagging feasible

The missing cheap instrumentation is the daily memory loop: Notebook memory
recorded, next-day memory callback seen, and whether that callback changes D1
return against the current quiz experience.

Events:

```text
ruby2_client_boot
ruby2_scene_loaded
ruby2_beat_started
ruby2_route_started
ruby2_route_completed
ruby2_room_entered
ruby2_exit_taken
ruby2_npc_position_resolved
ruby2_npc_move_request_resolved
ruby2_loadout_locked
ruby2_item_gained
ruby2_item_used
ruby2_item_use_rejected
ruby2_item_embodied_scene_completed
ruby2_item_exhausted
ruby2_activity_presented
ruby2_activity_selected
ruby2_companion_selected
ruby2_companion_lock_created
ruby2_companion_lock_conflict_resolved
ruby2_reputation_archetype_changed
ruby2_hint_revealed
ruby2_dialogue_started
ruby2_dialogue_completed
ruby2_class_started
ruby2_approach_problem_presented
ruby2_approach_choice_selected
ruby2_approach_resolved
ruby2_training_credit_applied
ruby2_question_revealed
ruby2_answer_locked
ruby2_answer_resolved
ruby2_class_completed
ruby2_social_choice_presented
ruby2_social_choice_selected
ruby2_discipline_expression_recorded
ruby2_virtue_expression_recorded
ruby2_clock_delta_applied
ruby2_clock_threshold_reached
ruby2_condition_applied
ruby2_condition_expired
ruby2_social_interlude_completed
ruby2_null_minigame_started
ruby2_null_minigame_action_selected
ruby2_null_minigame_completed
ruby2_comic_page_unlocked
ruby2_memory_recorded
ruby2_yearbook_candidate_created
ruby2_yearbook_candidate_highlighted
ruby2_yearbook_candidate_archived
ruby2_yearbook_candidate_evicted
ruby2_yearbook_ritual_started
ruby2_yearbook_ritual_choice_selected
ruby2_yearbook_sealed
ruby2_day_completed
ruby2_return_day_started
ruby2_ai_degraded
ruby2_asset_load_failed
ruby2_client_error
ruby2_client_crash
ruby2_command_failed
```

Key funnels:

- visitor -> guest session -> arrival scene
- arrival scene -> character locked
- character locked -> first classroom entered
- first classroom entered -> first answer locked
- first answer locked -> first class completed
- first class completed -> first social choice selected
- first social choice selected -> Notebook memory recorded
- Notebook memory recorded -> Yearbook candidate created
- Yearbook candidate created -> next-day return
- Week One completed -> Yearbook ritual started
- Yearbook ritual started -> Yearbook page sealed
- Week One ramp completed -> first Captain Null theory session started
- first Captain Null theory session started -> comic page unlocked
- comic page unlocked -> later beat references the page/theory beat

Progression metrics should track which discipline and virtue were expressed by
a class question, social choice, item use, or memory write. Use this to
understand player identity patterns, not to optimize a combat-style build.

Approach metrics should answer whether the new RPG verb is working. Track
Source / Sense / Signal / Sync impressions, selections, accepted training
credits, repeated-use penalties, downstream branch unlocks, and later Yearbook
candidates created from each approach. If most players experience the same
Week One despite different approach choices, the RPG layer is not doing enough
work.

Item metrics should answer whether items create useful choices or dead UI. Track
item action impressions, accepted uses, rejected uses, embodied scene
completion, hint reveals, charge exhaustion, and whether item use improves class
completion, social completion, recovery completion, or next-day return.

Clock and condition metrics should answer whether school-day pressure creates
better retention or only more friction. Track threshold reach, recovery-beat
completion, condition frequency, and whether players still complete the school
day after mixed or failed-forward outcomes.

Captain Null metrics should answer whether the comic/ARG pressure slot improves
return, comic collection, and Yearbook attachment without harming class/social
completion.

Yearbook metrics should measure emotional artifact value, not log volume. Track
candidate creation, ritual starts, candidate review, seal rate from 2-3 curated
choices, sealed artifacts per year, signature interaction, callbacks from sealed
artifacts, revisit rate for Yearbook screens, and whether players reach a later
beat that explicitly references an earlier sealed artifact.

Primary success metric:

> Unique visitors who complete a first class, record a first memory, and return after 24 hours.

Arc success metric:

> Returning players who seal a Week One Yearbook artifact and later reach a beat
> that calls back to the class, social choice, or First Bell theory beat that
> created it.

Week One success metric:

> Returning players who complete the First Bell ramp, reach the first Week One
> Captain Null theory session, unlock the first comic page, and later see the
> school acknowledge that theory beat.

Cost metrics:

- social LLM calls per completed first class
- social LLM calls per returning visitor
- AI calls per approach problem completed
- cache hit rate for approach and social performance packets
- token cost per sealed Yearbook callback
- asset-generation cost per accepted room asset
- failed/degraded AI rate
- native crash-free sessions

## 11. Distribution And Go-To-Market

Distribution is a product constraint, not a postscript. Ruby High needs a clean
retention cohort before it needs scale.

Two distribution goals:

| Goal | Meaning | Priority |
|---|---|---|
| Clean retention cohort | a few hundred organic, non-incentivized users who can validate the loop | first |
| Raw growth, buzz, liquidity | collector reach, launch spikes, and social noise | second |

Channel priority:

1. Yearbook/character share loop. Shareable character, report card, sealed page,
   and memory artifacts are the most on-thesis viral mechanic: memory becomes
   identity, identity becomes a share, and a friend asks what it is.
2. Cast-forward short-form video. Lead with Ruby, Lyra, Mika, Noor, Ravi, Indra,
   Sami, and the First Bell mystery, not "AI tutor."
3. Creator and niche seeding. Favor cozy games, AI-character experiments,
   study-with-me niches, and weird-school fiction over broad paid acquisition.
4. One-time launch spikes such as Show HN, Product Hunt, and fitting subreddits.
   Treat these as measurement events for activation, not a durable channel.

Distribution discipline:

- do not buy paid traffic until D1 retention clears a bar
- tag collector, wallet-connected, NFT-holder, paid, and incentivized
  cohorts separately
- never let incentivized users pollute the organic retention read
- use v1's existing `yearbook_copy` path as the first share-loop test bed

## 12. Monetization And NFT / CCG Model

The monetization model must be explicit because it can damage the retention
signal if it touches the core loop incorrectly.

Current model:

- NFTs are CCG cards.
- CCG/NFT packs are purchased with native SOL.
- NFT cards are burnable for Hall Passes, the existing premium currency.
- Ruby High does not pay earn-to-play token rewards.

Hard design line:

> NFT and CCG systems are additive. They may support ownership,
> collection, identity, cosmetics, premium convenience, community status, and
> shareability. They must not gate or mechanically advantage the class/social/
> memory loop that retention depends on.

Allowed surfaces:

- Yearbook pages as owned/shareable artifacts
- character cards as collection and identity objects
- cosmetic frames, stamps, signatures, rarity marks, and profile display
- premium generation, hosted art, or convenience where it does not change class
  correctness, social outcomes, memory creation, or required progress

Forbidden by default:

- pay-to-win class answers
- paid discipline gain
- paid relationship deltas
- paid required route unlocks
- token rewards for playing, studying, returning, or sharing

Cohort requirement:

- every wallet-connected, NFT-holder, card-burn, Hall Pass spender, collector,
  and organic non-wallet user must be segmentable in metrics
- retention decisions should default to organic non-incentivized cohorts unless
  the team is deliberately measuring monetized behavior

## 13. Build Plan

Build the product in content-first wedges.

Learn-first rule:

> Pull the retention read forward before building the expensive machine.

Before mobile, broad native client work, Captain Null arcs, companion systems,
or four authored years, ship the thinnest retention-valid slice to early users:
Week One, text/web, no custom C client, no companions, and no Captain Null
requirement. The slice must include the actual differentiator:

```text
class result
-> social beat
-> Notebook memory
-> changed tomorrow opening
```

A slice missing that loop is not a valid test of v2. Compare it head-to-head
against the current v1 quiz experience using first-class completion,
memory-recorded rate, D1 visitor retention, and next-day callback reach.

Only after this read is positive should the team spend heavily on native client
work, wider authored years, and deeper First Bell/Captain Null arcs.

Current C wedge scaling priorities:

1. Move content tables out of handwritten C into compiled content packs.
2. Replace one-shot NPC agenda flags with the goal/plan runtime.
3. Emit ranker and goal/plan traces from scripted and interactive choices.
4. Merge `play-world` and `play-llm` behavior into one vertical slice.
5. Replace enum-only action IDs with content-compiled IDs.
6. Add replay tests that rebuild a ranker decision and a school-day summary
   from trace input.
7. Add a tiny trainable ranker backend behind the current linear scorer only
   after legal-option traces are reliable.
8. Keep the UI boundary snapshot-first until sokol or another renderer is worth
   introducing.

### 13.1 Wedge -1: Premise, Yearbook, And Authoring Contract

Purpose: solve the load-bearing design joints before proving the loop.

Scope:

- one-page Ruby High premise lock
- Year One Yearbook artifact budget, target 15-25 entries
- Day One Notebook memory vs Yearbook candidate contract
- Day Three Library Signal Rise script with Indra, source interpretation, and
  non-named Null symptoms
- one exemplar Yearbook artifact with visual treatment, signatures, and a later
  callback
- sample Yearbook scoring weights and two competing candidate examples
- Week One content spine with required beats and candidate rituals
- first social template exemplar and reuse rules
- reputation tag vs archetype resolution policy
- branch threshold tuning for early Year One gates
- Source / Sense / Signal / Sync approach-choice contract for teacher problems
- learn-by-doing training policy, including anti-grind caps and repetition rules
- approach-pack content budget and runtime AI cost budget
- Captain Null discipline-label mapping and restraint-first distinction from class beats
- Captain Null trace-based outcome resolver
- class discipline/virtue trace policy
- Office Pass naming confirmed against Hall Pass wallet credits
- C runtime notes for compiled gates, candidate queue overflow, item validation,
  and active companion state

Acceptance:

- the loop answers why Ruby High exists and why the player is there
- Notebook, mechanical state, and Yearbook artifacts are distinct records
- the first Yearbook candidate does something later that a Notebook entry cannot
- content authoring has exemplars, templates, validation, fatigue checks, and a
  Week One minimum content budget
- Day Three can produce at least two plausible competing Yearbook candidates
- Null has at least one mechanic that is not equivalent to answering a class
  question
- Null final outcome reads encounter trace fields, not only discipline match
- at least one teacher problem can be represented as four discipline approaches,
  with resolver-owned effects and bounded AI performance slots
- disciplines and virtues preserve per-choice signal beyond aggregate class score
- training credit comes from accepted server-resolved approach choices, not
  point-spend UI or repeated client actions
- content budget shows how many approach packs Week One needs and how much of
  that copy can be cached, templated, or batch-generated
- archetype gates have a deterministic resolution function
- active Yearbook candidates have lifecycle and overflow behavior

### 13.2 Wedge 0: Year One Text Simulation

Purpose: prove the game loop before frontend work.

Scope:

- Year One Day One fixture
- canonical Day One required beat order
- campus world graph with hallway, homeroom, and cafeteria nodes
- room/action text output
- one Ruby class, reducible to one teacher problem for smoke tests
- one teacher problem with Source / Sense / Signal / Sync approach choices
- one explicit class session object that owns board phase, seated NPCs, and
  responder slots
- Day One class outcome resolver
- one multiple-choice social beat
- Notebook memory write
- one Yearbook candidate generated from the Notebook memory
- Notebook item state and `notebook-open` resolver
- discipline and virtue tags on class questions and social choices
- discipline training deltas from accepted approach choices
- per-question discipline/virtue trace in class result
- one simple clock effect, such as Stress or Rumor
- one simple condition, such as `focused` or `seen`
- one shared effect payload reducer used by class, social, and item commands
- tomorrow hook
- deterministic replay tests
- gameplay divergence test proving two Week One paths produce different
  disciplines, Yearbook candidates, Null outcomes, and tomorrow hooks

Acceptance:

- the whole day can be completed in a terminal/test harness
- player movement resolves through the campus graph, not ad hoc room ids
- NPC co-presence is derived from schedule or authored overrides
- class session state, not ad hoc room flags, decides which NPCs can react to a
  board result
- social choices produce visible consequences
- discipline and virtue expression affects report or memory wording
- approach choices produce different accepted effect payloads and training credit
- clock and condition changes are visible in state and replay deterministically
- class, social, and item outcomes use the same accepted effect payload path
- memory text reflects class/social outcome
- Yearbook candidate is created from a significant memory and remains distinct
  from the Notebook record
- Notebook item use is accepted only as a server-resolved command
- same input sequence produces same state
- no renderer, no AI, no mobile

### 13.3 Wedge 1: Scene Contract

Purpose: prove the backend can drive a game scene without leaking business rules into the client.

Scope:

- `GET /api/apps/ruby-high/ruby2/session/:sessionId/scene`
- `POST /api/apps/ruby-high/ruby2/session/:sessionId/command`
- Year One Day One fixture
- canonical schedule matches the Day One script beat-for-beat
- hallway, homeroom, cafeteria world graph with available route resolution
- NPC positions derived from deterministic schedules
- idempotent commands
- server-owned clocks and conditions in scene snapshots
- item state and item actions in scene snapshots
- daily loadout state and branch-gated activity actions in scene snapshots
- companion availability validation for optional activities
- validated performance packet queue in scene snapshots
- ordered animation events
- fixture tests for stale scene versions and duplicate command ids

Acceptance:

- scene snapshots are deterministic for the same state
- required beats appear in intended order
- available exits match the current beat, time block, and route gates
- visible characters match NPC schedule/override state
- item actions match item ownership, charges, and valid beat rules
- branch-gated actions match discipline, virtue, item loadout, companion, clock, and room gates
- item actions include resolver id, display assets, targets, and charge state
- accepted effect payloads validate before any animation event is emitted
- duplicate command ids return same result
- stale command versions recover cleanly
- client can rebuild visible state from scene JSON plus asset manifest

### 13.4 Wedge 2: Render Prototype

Purpose: prove the game client can present Ruby High text and choices well.

Scope:

- one hallway background
- one Ruby standee
- one dialogue box
- one speech bubble driven by a performance packet fixture
- two dialogue choices
- local scene JSON fixture
- local asset manifest fixture
- desktop and mobile viewport layouts
- reduced-motion flag

Acceptance:

- text wraps without clipping at mobile and desktop sizes
- touch targets are stable and large enough
- standee and dialogue box do not fight for space
- speech bubbles respect max character budget and screen anchors
- background crops acceptably on mobile
- web/WASM build runs the same scene

### 13.5 Wedge 3: Classroom Loop

Purpose: prove existing class mechanics feel better in the RPG surface.

Scope:

- hallway -> homeroom movement
- Ruby class intro
- one teacher problem with four approach choices
- optional Flashcards use before answer lock
- approach lock
- NPC answer lock animation
- approach reveal animation
- class session resolution that records who was seated, who locked in, and who
  can respond
- class report
- metrics

Acceptance:

- one class can be completed without the current viewer UI
- approach outcome is server-authoritative
- Flashcards can reveal a hint without choosing the approach for the player
- animation is driven by server events
- degraded/no-animation mode still plays correctly
- it feels materially more like attending Ruby High than using the current board

### 13.6 Wedge 4: Social And Memory

Purpose: prove class results become social material.

Scope:

- cafeteria social room
- Lyra, Mika, and Noor present
- one constrained multiple-choice social beat
- one class social round after a board result, selecting 1-2 responders from
  seated NPCs with valid goals or response slots
- one reusable social template with concrete authored cast slots
- 2-3 reply choices
- authored fallback dialogue
- affinity/reputation/hint result validated by schema
- Notebook memory write
- tomorrow hook

Acceptance:

- social event never blocks exits or next action
- player response is captured as `choiceId`, not freeform text
- durable social result is schema-valid
- class-social responders come from resolved co-presence and class session state,
  not random spawning
- template substitution respects room presence, character voice, and fallback
  rules
- Notebook memory reflects the class/social outcome
- Noor can appear as a reaction witness without owning the primary social choice
- metrics compare class-only vs class-plus-social completion

### 13.7 Wedge 5: First Bell / Captain Null Theory Session

Purpose: prove Ruby High has a distinct comic/ARG pressure slot without making
classmates adversarial or implying genre-breaking stakes. Build this as a
Week One text/scene fixture after the First Bell ramp before mobile proof.

Scope:

- one Captain Null authored theory-session fixture
- one First Bell comic-page unlock
- at least two encounter rounds with state changes between rounds
- a limited subset of the four discipline buttons per round
- four discipline-flavored approaches with virtue expression
- three normal-school foreshadow beats before the session
- clear/mixed/failed-forward/restraint outcomes
- Null Signal clock delta
- one condition such as `null-touched` or `frazzled`
- one later school beat affected by the comic unlock
- no freeform input
- no twitch reflex requirement
- return to normal school schedule after completion

Acceptance:

- theory session feels like pressure from the comic, not a normal class
- theory session is anchored in a school-side signal, object, route, or witness line
- player action is captured as round id plus discipline button index
- later-round available buttons and labels can change because of earlier actions
- outcome can reward restraint or silence, not only action
- comic page unlock is durable
- Null Signal and condition effects are durable and server-authoritative
- a later scene references the theory beat/comic page
- classmates react afterward as allies/witnesses, not enemies

### 13.8 Wedge 6: Mobile Proof

Only after Wedges -1 through 5 pass and the web/text retention read is positive:

This is a platform feasibility wedge, not a production mobile app wedge.

- keep the C engine headless/snapshot-first unless retention justifies a custom
  native client
- build one minimal iOS shell or one minimal Android shell
- wire session/auth handoff
- confirm asset loading
- confirm safe areas and touch input
- confirm suspend/resume behavior
- emit native error/crash telemetry
- do not implement store purchases, push, offline sync, or full native polish

Exit criteria: one real device can play the same class-plus-social-plus-memory slice.

### 13.9 Wedge 7: Semi-Open Campus Block

Purpose: prove Ruby High can become open-world-ish without losing the school-day
loop.

Scope:

- one bounded lunch or after-school time block
- three to four reachable rooms
- limited action budget for the block
- two optional social beats
- one recovery/reflection beat
- one hint or First Bell/Null Signal clue
- one beat that can expire, delay, or mutate because the player chose elsewhere
- NPC schedules that create absence as well as presence
- per-NPC goals and short plans for at least three classmates during the block
- structured blocked reasons when an NPC cannot pursue a plan
- Notebook summary that records both chosen and missed opportunities

Acceptance:

- the player has at least two meaningful routes during the same time block
- different routes produce different state, memory, affinity, clock, or hint
  outcomes
- at least one optional beat can be missed without blocking the day
- required school-day progress remains recoverable
- NPC co-presence changes based on schedule, not random spawning
- NPC behavior can be explained by goal, plan, validator result, and memory
- the block feels like choosing how to spend school time, not selecting a menu
  item from a hub

## 14. Phasing

Phase 0: premise, Yearbook, authoring contract, distribution plan, monetization
guardrails, and v1 measurement patch.

Phase 1: v1 retention read for the v2 thesis. Add the missing memory/callback
instrumentation to the current web surface and tag wallet/NFT/crypto cohorts.

Phase 2: thinnest v2 loop on web/text: class result -> social beat -> Notebook
memory -> changed tomorrow opening. No mobile, no custom native client, no
Captain Null dependency.

Phase 3: Year One content simulation and replay coverage.

Phase 4: scene and command APIs.

Phase 5: render/text/touch prototype for web, with C used as deterministic core
unless retention justifies a native client.

Phase 6: first classroom.

Phase 7: first social and Notebook memory.

Phase 8: first Captain Null theory session.

Phase 9: first mobile proof.

Phase 10: first semi-open campus block.

Phase 11: campus expansion after retention signal.

Phase 12: production migration behind a feature flag.

Move default traffic only if Ruby High 2.0 beats the current viewer on
first-class completion, memory completion, D1 visitor retention, D1 character
retention, Yearbook callback reach, and crash-free sessions without regressing
auth or commerce.

Migration policy:

- v1 remains the retention-truth surface until v2 beats it on the metrics above
- existing Hall Pass balances, cards, wallet state, and NFT ownership migrate or
  remain honored; no in-flight value is stranded
- v1 content packs may coexist as legacy/classic mode if they retain or monetize
  better than the v2 loop
- default traffic moves behind a feature flag, with cohort rollback available
- NFT/CCG ownership migration is handled as wallet/economy infrastructure, not
  as a gameplay progression reset

## 15. Risks

### Content Vagueness

The largest risk is building a game shell before the authored year feels good.

Mitigation:

- Year One Day One text simulation first
- every beat has choices, consequences, memory, and hook
- do not start broad frontend work until the text loop works

### Distribution Silence

The product can fail even if the design is strong if no clean retention cohort
ever arrives.

Mitigation:

- build the Yearbook/character share loop early
- use cast-forward short-form clips and niche seeding before paid acquisition
- treat launch spikes as measurement events, not durable strategy
- do not buy traffic until D1 retention clears a bar
- separate organic users from wallet/NFT/collector users in every read

### Monetization Coupling

The NFT/CCG layer can corrupt the core loop if ownership becomes progression
or if incentivized users contaminate the retention signal.

Mitigation:

- keep NFT/card ownership additive and identity/cosmetic by default
- never gate required class, social, memory, or Yearbook callback progress behind
  ownership
- prohibit earn-to-play rewards
- cohort-tag wallet-connected, NFT-holder, card-burn, Hall Pass spender,
  collector, and organic users
- use Yearbook ownership/share artifacts as the primary on-thesis ownership
  surface

### Content Treadmill

The design depends on authored days, schedules, social beats, class questions,
item uses, and callbacks. If every moment is bespoke, production stalls. If too
much becomes generic, Ruby High stops feeling like a real school. Without a
content pipeline, the product caps out at Year One.

Mitigation:

- author reusable social templates with concrete cast slots and effect payloads
- build character voice packs that can perform inside those templates
- reuse beat structure, not emotional content
- require at least one hand-authored exemplar before templating a beat type
- measure repeated-template fatigue through skipped beats, fast clicks, and low
  next-day return after template-heavy sessions

### Approach Content Explosion

The Source / Sense / Signal / Sync loop is stronger than a quiz, but it can
quadruple authoring cost if every teacher problem becomes four bespoke scenes.

Mitigation:

- treat an approach pack as one problem frame with four short discipline actions,
  not four unrelated branches
- share teacher setup, resolver, class report, and effect payload shape across
  the four approaches
- hand-author the first exemplar for each problem type, then template the
  ordinary variants
- reserve fully bespoke approach branches for weekly rituals, Null ramp beats,
  and Yearbook-candidate moments
- validate that different approaches create different state or route material,
  not only different copy

### Cosmetic Mechanics

If disciplines, virtues, clocks, conditions, and items only change wording, players will read
the system as fake even if the prose is good.

Mitigation:

- every discipline and condition needs at least one nonblocking mechanical affordance
- choices can unlock routes, hints, item timing, witness reactions, or recovery
  beats without gating core completion
- report and Yearbook wording should reflect mechanical differences, not stand
  in for them
- test at least one alternate route per core discipline before expanding the
  progression system

### Text Rendering

Ruby High is text-heavy. C game UIs do not get browser-quality text, accessibility, selection, and IME support for free.

Mitigation:

- keep long-form editing out of the C client
- test wrapped dialogue and choices early
- use shell UI for account, billing, admin, and pack editing
- make text rendering pass before server integration in the client

### Scope Creep

A campus RPG can grow forever.

Mitigation:

- Year One Day One first
- three rooms only
- three to four characters only
- one class only
- one social interlude only
- no direct movement
- no complex inventory
- no unbounded AI chat

### Item Bloat

Items can turn into a generic inventory system instead of school verbs.

Mitigation:

- each item must have one clear verb
- no loot grid in Year One
- hide invalid item actions instead of showing disabled clutter
- require embodied use scenes for items that change clocks, routes, or affinity
- validate item effects through the same server reducer as class/social effects
- keep story item charges separate from paid wallet credits

### Yearbook File Management

The Yearbook can lose emotional value if curation feels like sorting records.

Mitigation:

- seal pages only during in-world rituals
- show 2-3 curated drafts, not a raw candidate feed
- let classmates sign, mark, or comment on the chosen page
- keep discipline, virtue, and callback details available but secondary to the emotional choice
- convert weak candidates into Notebook notes, class reports, or group photos

### Map Feels Like Menu

If movement is only a list of buttons, the school can still feel like old
channels with nicer names.

Mitigation:

- every room has a reason for who is present
- exits have route presentation and time-block flavor
- route choices can affect Bell, Rumor, Stress, or later encounters
- route labels should name physical choices and social context, not only
  destinations
- NPC schedules create co-presence and absence
- map overlay shows the school as a place, even before direct walking

### Open World Too Early

If the team chases a full open campus before the class/social/memory loop works,
Ruby High will gain empty space instead of deeper play.

Mitigation:

- Year One remains a guided campus pointcrawl
- the first openness proof is one bounded lunch or after-school block
- open routes require opportunity cost, not just extra exits
- required beats stay recoverable while optional beats can expire or mutate
- do not add direct walking until route choice is already meaningful

### Tonal Whiplash

Captain Null gives Ruby High its pressure slot, but it can break the school
fantasy if it plays like a literal genre threat instead of a grounded cult-comic
and ARG-style social obsession.

Mitigation:

- introduce Null through First Bell pages, ordinary school objects, rumors,
  source mismatches, and classmate reactions
- let the Null Signal/Theory Hype clock build atmosphere before major sessions
- keep classmates as fandom theorists, skeptics, witnesses, and friends, not
  combat opponents
- return to the normal school schedule after every Null beat
- make aftermath visible in Notebook, hallway dialogue, or a later class line

### AI Chaos

AI can make the school feel alive or incoherent.

Mitigation:

- deterministic year schedule
- deterministic room graph
- deterministic route graph
- deterministic NPC schedules
- structured LLM outputs
- server validation
- authored fallback
- no AI-authored durable state without schema validation

### Asset Inconsistency

Generated backgrounds can look inconsistent.

Mitigation:

- style bible before full room set
- canonical room prompts
- fixed camera
- no characters/text in backgrounds
- asset approval/cache
- safe crop zones

### Parallel Frontends

The existing viewer and Ruby High 2.0 can drift.

Mitigation:

- backend scene APIs share business rules where possible
- keep viewer fallback until migration
- avoid duplicating auth, billing, metrics, and class outcome logic

### Native Platform Complexity

iOS and Android add lifecycle, safe areas, store rules, secure storage, crash reporting, app review, and network edge cases.

Mitigation:

- prove one native platform before campus expansion
- keep billing in native shell and server fulfillment paths
- keep account management out of the C client
- add native smoke telemetry before public rollout

### AI Cost Creep

Social spaces and approach outcomes can accidentally turn every room visit or
teacher problem into an LLM bill.

Mitigation:

- budget one social generation per early-session beat
- cache social outputs by time block and room
- cache approach reaction outputs by beat, character, approach, outcome, and
  player archetype
- use batch-generated or authored fallback lines for ordinary approach results
- reserve runtime AI for high-salience social reactions, weekly rituals, and
  First Bell aftermath
- show authored fallback on failure or budget exhaustion
- track social and approach LLM calls per completed class and per retained
  visitor

## 16. Open Decisions

- What final polish should replace any remaining placeholder prose in the Year One Day One script?
- Which exact premise wording should become player-facing canon?
- Which 15-25 Year One moments deserve scarce Yearbook artifact treatment?
- What D1 retention threshold graduates v2 from web/text validation to broader
  authored-depth investment?
- What retention or UX signal would justify direct character walking over graph-based routes?
- Which text renderer gives acceptable mobile quality with the least custom work?
- Should first-slice backgrounds be bundled or fetched/cached dynamically?
- Which native shell should host the first mobile proof if web retention justifies it?

## 17. Guiding Constraint

Ruby High 2.0 should be deterministic underneath and expressive on top.

The year schedule, room graph, route graph, class outcomes, social choices,
memory writes, Yearbook candidates/artifacts, rewards, progression, metrics, and
billing must be structured. AI should provide dialogue, flavor, background
generation, and social texture inside those rails.

That is the difference between a school-year RPG with AI in it and a chatbot wearing a school uniform.
