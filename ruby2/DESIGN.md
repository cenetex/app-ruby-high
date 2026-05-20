# Ruby High 2.0 Design

> An authored school-year RPG where every class teaches something, every social beat makes the result real, and every day leaves one memory in the Yearbook.

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
- Captain Null carries special pressure/minigame encounters
- AI creates flavor inside rails
- every day leaves a memory

### 1.2 Design Motto

> Every class should teach you something. Every hallway should make that result socially real. Every day should leave one memory in the Yearbook.

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
-> tomorrow's scene remembers it
```

### 1.3 What This Is Not

Ruby High 2.0 should not become:

- a chatbot wearing school clothes
- a free-roaming map before the class/social loop is proven
- an open-ended friendship simulator
- a classroom combat game where classmates become enemies
- a rewrite of auth, billing, metrics, admin, or content-pack management
- a client-authoritative game
- a generator of random personal campuses

Do not move durable decisions into AI or the client. The server owns schedule, room state, class outcomes, affinity deltas, rewards, memory writes, metrics, and billing. AI can write lines, vary reactions, suggest bounded reply copy, and help generate assets after validation.

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

Year One should be heavily guided. Later years can become increasingly freeform, but "freeform" means more freedom in schedule, route, electives, relationships, and goals. It does not mean freeform social text input.

| Year | Structure | Player Freedom | Design Goal |
|---|---|---|---|
| Year One | guided freshman year | follow a clear school-day path with small choices | teach the ritual and build attachment |
| Year Two | semi-open schedule | choose class order, electives, and some social priorities | make the school feel broader |
| Year Three | open week planning | pick goals, clubs, study routes, and social arcs | make identity and reputation matter |
| Year Four | capstone year | choose specialization paths and major relationships | make the Yearbook feel earned |

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
  Arrival -> Homeroom class -> Cafeteria social -> Notebook memory

Day 2: Science Lab Tease
  Hallway check-in -> Science Lab intro -> Ravi/Mika beat -> Flashcards use -> first Captain Null stinger

Day 3: Library Day
  Library unlock -> interpretation challenge -> Lyra/Indra beat

Day 4: Cafeteria Pressure
  cafeteria social pressure -> practice class -> Hall Pass tutorial

Day 5: First Week Report
  Ruby review -> Yearbook entry -> next-week hook
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

Day One should teach the normal school ritual before Captain Null interrupts it
later. It needs no cosmic pressure. The whole point is to make normal Ruby High
feel real first.

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

| Question | Stat | Purpose |
|---|---|---|
| `ruby-001` | Head | teach answer selection and reveal |
| `ruby-002` | Heart | teach classmates reacting to tone/social meaning |
| `ruby-003` | Honor | teach evidence/fairness as school identity |

Class report language:

```text
strong: Ruby noticed you found your footing fast.
mixed: Ruby noticed you kept going after the room got loud.
missed: Ruby noticed you stayed in the room and finished anyway.
```

Cafeteria social beat:

```text
Lyra: "You got the hard one wrong too? Okay. That makes me feel slightly less doomed."
```

Choices:

| Choice | Stat | Effect |
|---|---|---|
| "That question was brutal." | Heart | Lyra affinity +1, `shared-struggle` memory tag |
| "I'm getting it next time." | Hustle | Mika affinity +1, `comeback-student` reputation tag |
| "Ask Indra. She knew." | Head | schedules an Indra/Library hint later |

Notebook memory variants:

```text
success: First Homeroom - Ruby noticed you found your footing fast. At lunch, someone noticed too.
mixed: First Homeroom - You missed a step, recovered, and still made it to lunch with a story.
failure: First Homeroom - The first class hit hard, but you stayed. That counts.
```

Tomorrow hook:

```text
Ruby: "Science Lab tomorrow. Bring Flashcards. Sally likes evidence."
```

Captain Null should not appear in Day One except, at most, as a background
artifact or hidden comic tease. The first explicit Null interruption belongs
around Day Two, once the ordinary class/social/memory loop has been taught.

### 2.6 Beat Contract

Every beat should answer four questions:

```text
What happened?
What can the player choose?
What changes because of the choice?
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
| `memory` | write Notebook/Yearbook memory |
| `hook` | create a reason to return |
| `null_minigame` | Captain Null special pressure encounter |

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

### 3.2 Main Verbs

Ruby High needs a small explicit verb set.

| Verb | System |
|---|---|
| Go | room graph and campus navigation |
| Talk | multiple-choice social beats |
| Attend | class start |
| Answer | quiz/question mechanic |
| Use Item | card/item support mechanic |
| Check Notes | hints, history, progress, next goal |
| Reflect | recovery, relationship, summary, Yearbook |

The player should never feel like they are clicking random chat bubbles. They should understand the school as actionable.

### 3.3 Rooms

The current channel rail becomes a campus graph. For the first playable version, movement should be menu/exits based, not direct character walking.

Direct walking adds collision, pathing, animation, camera, mobile controls, and empty-space problems before the real loop is proven. Ruby High's first game is choosing where to go and who to engage.

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
- present characters
- available actions
- schedule context
- room event hooks

### 3.4 Classes

Classes remain structured. This is the correct place for educational rigor.

Class rhythm:

```text
teacher frames the lesson
classmate reaction sets stakes
question appears
player chooses answer
NPCs lock answers
reveal animation
teacher explains
one classmate reacts
progress meter updates
```

NPC answer lock is the key classroom design move. Even when NPC answers are mostly cosmetic, seeing Ravi lock in, Lyra hesitate, or Indra stay quiet turns the question into a social event.

Classroom UI should include:

- room background
- teacher standee
- NPC classmates in seats or side rail
- chalkboard/question panel
- answer buttons
- dice/advantage UI if retained
- progress meter
- answer reveal
- class report

Multiple-choice is the default. Typed/opinion modes are premium classroom beats later, not first-run load.

### 3.5 Social

Social is also multiple-choice.

Social is not open chat. It is a structured consequence beat after something meaningful happens, usually a class result.

Classmates should create stakes, support, comedy, pressure, and memory. They
should not become adversaries. If Ruby High needs a battle-shaped interruption,
use Captain Null.

Social beat rhythm:

```text
trigger: class result or authored schedule beat
setup: one or two classmates are present
line: one character reacts to what just happened
choice: player chooses one of 2-3 replies
outcome: affinity, hint, rumor, memory, schedule nudge, or tomorrow hook
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

### 3.6 Captain Null Minigames

Ruby High does not need combat. It needs occasional pressure encounters.
Captain Null is the natural hook for those encounters.

Captain Null minigames should mirror the First Bell comic: strange, observatory
/ void-theory interruptions where normal school logic bends for a short,
structured challenge. They are the RPG "battle" slot without making classmates
hostile.

Use Captain Null minigames to:

- punctuate the authored year at key moments
- create mystery and stakes outside normal class/social rhythm
- test the four stats under pressure
- unlock or reveal First Bell comic pages
- seed longer arcs without derailing the school-day loop

Comic motifs to mirror:

| Motif | Minigame Use |
|---|---|
| black star / shadow | looming external pressure, not a classmate enemy |
| impossible surface / hidden center | player must inspect beyond first appearance |
| signal before source | future hint, delayed explanation, tomorrow hook |
| coordinates / song | pattern puzzle or ordered choice sequence |
| door behind sight | solve by changing approach, not brute force |
| duplicate astronaut / hollow self | identity check, memory/reputation reflection |
| command words | short objective cards such as `DO`, `STAR`, `SILENCE` |
| silence over violence | win condition can be restraint, not conquest |

Minigame rhythm:

```text
intrusion: something impossible interrupts the day
frame: Captain Null names the problem
choice: player picks a stat-flavored approach
resolve: short puzzle/check/reveal
reaction: classmates process what just happened
reward: comic page, memory flag, hint, or Yearbook shard
return: normal school day resumes
```

Example approaches:

```text
Head   -> map the pattern
Heart  -> steady the room
Hustle -> act before the window closes
Honor  -> hold the signal / follow the rule
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

The Notebook is the daily operational memory. The Yearbook is the emotional archive.

Notebook:

- shows current day goal
- stores class result
- records hints and item effects
- previews tomorrow hook
- helps the player recover after failure

Yearbook:

- seals important memories
- turns learning and social outcomes into identity
- makes the school year feel cumulative
- gives long-term retention a visible object

Memory write shape:

```json
{
  "id": "memory:first-homeroom",
  "scope": "notebook",
  "title": "First Homeroom",
  "bodyTemplate": "Ruby noticed you {classResultPhrase}. {socialPhrase}",
  "sourceBeatIds": ["y1d1-homeroom", "y1d1-cafeteria"],
  "yearbookEligible": true
}
```

If the Yearbook does not become emotionally important, Ruby High risks collapsing back into a quiz app.

### 3.8 Progression

Progression should stay light and school-flavored.

| Track | Purpose | Increments From | Unlocks |
|---|---|---|---|
| Mastery | subject progress | class results, practice, item use | harder classes, explanations, teacher comments |
| Affinity | classmate relationships | social choices, recovery, repeated presence | social beats, hints, later appearances |
| Reputation | class-wide identity | patterns across class/social outcomes | alternate reactions, report language |
| Yearbook | collected memories | sealed daily/weekly memories | retrospectives, capstones, sharing |

No heavy stat screen in Year One. Let these tracks appear through dialogue, Notebook text, reports, and occasional unlocks.

### 3.9 Stats As Identity Lens

Honor, Heart, Head, and Hustle should be the player's school identity lens, not
a heavy optimization layer.

| Stat | Means | Best Used For |
|---|---|---|
| Head | recall, analysis, theory, close reading | class questions, Library, explanations, noticing patterns |
| Heart | empathy, tone, friendship, belonging | social choices, Cafeteria, Greenhouse, recovery beats |
| Hustle | speed, improvisation, practical action | Science Lab, Courtyard, quick decisions, experiments |
| Honor | integrity, evidence, discipline, fairness | citations, rules, teacher trust, ethical choices |

Design rule:

> Stats should shape how the player gets through school, not whether they are
> allowed to play.

Class questions can be tagged by stat. Social choices can also carry stat
flavor. The stat tag tells the game what kind of identity the player is
expressing, which NPCs are likely to notice, and what wording belongs in the
Notebook or Yearbook.

Example social stat choices:

```text
Lyra: "I knew it was C. I knew it."

Choices:
- "Walk me through your notes."                 Head
- "You're not the only one panicking."          Heart
- "Let's fix it before next class."            Hustle
- "The question was fair. Hard, but fair."      Honor
```

Stats should feed reputation language:

| Pattern | Reputation Language |
|---|---|
| Head | the one who sees the answer |
| Heart | the one people trust |
| Hustle | the comeback student |
| Honor | the one who checks the evidence |

Item affinity:

| Item | Stat Flavor |
|---|---|
| Flashcards | Head |
| Lunch Tray | Heart |
| Lab Flask | Hustle |
| Library Card | Head / Honor |
| Hall Pass | Heart / Honor |
| Notebook | all stats |

Do not let the stats turn Ruby High into "stack Head to win." They should affect
advantage moments, routes, wording, social consequences, and Yearbook identity.
No authored critical path can require a high stat. A low stat can change the
route, tone, report language, or recovery beat, but it cannot block completion
of a required school-day beat.

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
| `captain-null` | Captain Null | Special encounter teacher | Observatory, void theory, impossible engines |
| `eliza` | Eliza | Guest teacher | Systems Lab, agents, networks, coordination |
| `rati` | Rati | Guest teacher | Signal Studies, myth, tokens, strange economics |

Teacher play styles:

| Teacher | Play Style |
|---|---|
| Ruby | general knowledge, onboarding, meta, AI literacy |
| Sally Science | evidence, experiments, cause/effect |
| Professor Edward | interpretation, ambiguity, close reading |
| Captain Null | mystery, impossible systems, astronomy/void lore, First Bell minigames |
| Eliza | agents, networks, coordination puzzles |
| Rati | signals, myth, tokens, strange economics |

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
| `hall-pass` | Hall Pass | Front Office | Reset, grace, second chances | "Sometimes the smartest move is stepping out and coming back better." |
| `flashcards` | Flashcards | Study Kit | Memory, revision, exam prep | "Shuffle. Repeat. Survive." |
| `library-card` | Library Card | Quiet Wing | Access, research, borrowed wisdom | "If the answer exists, this helps you find it." |
| `lab-flask` | Lab Flask | Science Lab | Experiments, evidence, clean explanations | "Observe first. Guess later." |
| `lunch-tray` | Lunch Tray | Commons | Fuel, gossip, lunchtime diplomacy | "Half the social game happens between bites." |
| `notebook` | Notebook | Daily Carry | Plans, panic, ideas in progress | "Messy notes still count as evidence of life." |

Item uses:

| Item | Use |
|---|---|
| Hall Pass | exit/reset a bad social or class moment |
| Flashcards | preview/review likely concepts |
| Library Card | unlock deeper explanation or source |
| Lab Flask | run an experiment or evidence check |
| Lunch Tray | trigger cafeteria social event |
| Notebook | save notes, review history, see next goal |

Do not build complex inventory early. Items should first be simple school verbs.

## 5. Content Schemas

### 5.1 Year Schedule

The year schedule is server-owned content. It tells the scene system what must happen today, what can happen optionally, and how open the day should be.

```json
{
  "id": "year1",
  "name": "First Bell",
  "autonomy": "guided",
  "days": [
    {
      "id": "year1-day1",
      "title": "First Homeroom",
      "requiredBeats": [
        { "id": "y1d1-arrival", "type": "arrival", "roomId": "hallway-east" },
        { "id": "y1d1-homeroom", "type": "class", "roomId": "homeroom", "facultyId": "ruby", "questionSetId": "ruby-homeroom-001" },
        { "id": "y1d1-cafeteria", "type": "social", "roomId": "cafeteria", "choiceSetId": "cafeteria-first-result" },
        { "id": "y1d1-notebook", "type": "memory", "target": "notebook", "memoryId": "first-homeroom" }
      ],
      "optionalBeats": [],
      "unlocks": ["notebook", "flashcards"],
      "tomorrowHook": "science-lab-redemption"
    },
    {
      "id": "year1-day2",
      "title": "Science Lab Tease",
      "requiredBeats": [
        { "id": "y1d2-checkin", "type": "arrival", "roomId": "hallway-east" },
        { "id": "y1d2-science-lab", "type": "class", "roomId": "science-lab", "facultyId": "sally-science", "questionSetId": "sally-lab-001" },
        { "id": "y1d2-flashcards", "type": "item", "itemId": "flashcards" },
        { "id": "y1d2-null-stinger", "type": "null_minigame", "minigameId": "null-first-signal" },
        { "id": "y1d2-recover", "type": "social", "roomId": "hallway-east", "choiceSetId": "after-null-witnesses" }
      ],
      "optionalBeats": [],
      "unlocks": ["science-lab", "first-bell/page-01"],
      "tomorrowHook": "library-indra-pattern"
    }
  ]
}
```

Rules:

- Year One can force `nextRequiredAction`.
- Later years expose more optional beats and fewer required beats.
- The server resolves beat availability from year progress, daily credit rules, room state, affinity, and item ownership.
- The client renders available choices; it does not decide the schedule.

### 5.2 Social Choice Set

Social choice sets should carry consequence metadata.

```json
{
  "id": "cafeteria-first-result",
  "trigger": "after_class_result",
  "roomId": "cafeteria",
  "characters": ["lyra", "mika"],
  "speaker": "lyra",
  "lineTemplate": "You got the hard one wrong too? Okay. That makes me feel slightly less doomed.",
  "choices": [
    {
      "id": "admit-brutal",
      "label": "That question was brutal.",
      "tone": "honest",
      "stat": "heart",
      "effects": { "affinity": { "lyra": 1 }, "memoryTag": "shared-struggle" }
    },
    {
      "id": "next-time",
      "label": "I'm getting it next time.",
      "tone": "resilient",
      "stat": "hustle",
      "effects": { "affinity": { "mika": 1 }, "reputationTag": "comeback-student" }
    },
    {
      "id": "ask-indra",
      "label": "Ask Indra. She knew.",
      "tone": "deflecting",
      "stat": "head",
      "effects": { "scheduleHint": "indra-library-later" }
    }
  ],
  "fallbackLine": "Lyra folds her notes in half, then immediately unfolds them again."
}
```

### 5.3 Class Beat

Class beats should be authored enough to create subject identity.

```json
{
  "id": "ruby-homeroom-001",
  "facultyId": "ruby",
  "subject": "homeroom",
  "questions": [
    { "id": "ruby-001", "stat": "head" },
    { "id": "ruby-002", "stat": "heart" },
    { "id": "ruby-003", "stat": "honor" }
  ],
  "npcLocks": [
    { "characterId": "lyra", "behavior": "hesitates_then_locks" },
    { "characterId": "mika", "behavior": "waits_for_player" },
    { "characterId": "noor", "behavior": "deadpan_after_reveal" }
  ],
  "reportTemplate": "Ruby noticed you {resultPhrase}. {reputationPhrase}"
}
```

### 5.4 Captain Null Minigame

Captain Null minigames are authored special beats, not generic combat.

```json
{
  "id": "null-first-signal",
  "type": "null_minigame",
  "sourceComic": "first-bell",
  "comicPage": "page-01",
  "motifs": ["black-star", "shadow", "command-card"],
  "captainNullLine": "There are stars that watch. Learn to look back.",
  "stakes": "The hallway clock stops between bells.",
  "approaches": [
    { "id": "map-pattern", "label": "Map the impossible pattern.", "stat": "head" },
    { "id": "steady-room", "label": "Keep everyone calm.", "stat": "heart" },
    { "id": "move-now", "label": "Act before the bell catches up.", "stat": "hustle" },
    { "id": "hold-signal", "label": "Hold the signal steady.", "stat": "honor" }
  ],
  "outcomes": {
    "clear": {
      "condition": "approach matches strongest stat or prior clue",
      "effects": { "comicPage": "first-bell/page-01", "memoryTag": "held-the-signal", "reputationTag": "steady-under-static" }
    },
    "mixed": {
      "condition": "valid approach without matching clue",
      "effects": { "comicPage": "first-bell/page-01", "memoryTag": "saw-the-shadow", "followupBeatId": "y1d2-recover" }
    },
    "failed_forward": {
      "condition": "timed out or repeated invalid approach",
      "effects": { "memoryTag": "clock-skipped", "followupBeatId": "y1d2-recover" }
    },
    "restraint": {
      "condition": "player chooses silence/hold instead of action",
      "effects": { "comicPage": "first-bell/page-01", "memoryTag": "chose-silence", "yearbookEligible": true }
    }
  },
  "schoolEffects": {
    "notebookPhrase": "The hallway clock skipped. Someone wrote DO where the bell should have been.",
    "nextHook": "Indra later asks whether anyone else heard the signal."
  },
  "returnBeatId": "y1d2-recover"
}
```

Captain Null minigames should be authored as a sequence, with each comic page
teaching one new interaction pattern:

| Comic Page | Minigame Pattern | Stat Bias |
|---|---|---|
| `page-01` | identify the impossible command | Honor / Head |
| `page-02` | find the hidden center beneath a false surface | Head / Hustle |
| `page-03` | decode a signal or coordinate song | Head / Heart |
| `page-04` | solve by closing the obvious path | Honor / Heart |
| `page-05` | confront the hollow double without becoming it | Heart / Honor |
| `page-06` | choose restraint before the black star wakes | Honor / Hustle |

Comic pages are not just collectibles. Unlocking a page should change the school
year in a small visible way: a Notebook phrase, a later hallway anomaly, a new
Indra question, a Ruby warning, or a Yearbook shard. If a page unlock does not
alter any later beat, it is only an asset reward and should wait.

## 6. Simulation Model

### 6.1 Server Authority

The server owns:

- current authored school year
- current year day
- current beat
- current school day
- time block
- player room
- NPC room positions
- available actions
- class availability
- social event availability
- memory writes
- comic page unlocks
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

### 6.3 NPC Schedules

Every NPC gets a deterministic schedule with optional state-based overrides.

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

NPCs should feel like they move around, but the first version can compute positions on demand from current time block, year schedule, affinity, recent events, and active guest faculty.

### 6.4 AI Use

AI should create surprise inside rails, not decide the rails.

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
- no background LLM calls for NPC movement
- repeated room visits reuse cached social state until time block changes
- output must validate before it affects affinity, hints, memory, or progress
- failure shows authored fallback and does not block exits

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
    "nextRequiredAction": "go:homeroom"
  },
  "timeBlock": "arrival",
  "player": {
    "roomId": "hallway-east",
    "character": {},
    "grade": "9",
    "stats": { "head": 1, "heart": 0, "hustle": 1, "honor": 0 },
    "wallet": {}
  },
  "room": {
    "id": "hallway-east",
    "name": "East Hallway",
    "background": "hallway-east.morning",
    "exits": [{ "to": "homeroom", "label": "Homeroom" }]
  },
  "characters": [
    {
      "id": "ruby",
      "assetId": "ruby.full",
      "pose": "idle",
      "screenAnchor": "right",
      "presentReason": "arrival_greeting"
    }
  ],
  "actions": [
    { "id": "go:homeroom", "type": "move", "label": "Homeroom", "enabled": true },
    { "id": "check:notebook", "type": "check_notes", "label": "Notebook", "enabled": true }
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

Commands:

```json
{ "commandId": "cmd_client_001", "sceneVersion": 12, "type": "move", "to": "homeroom" }
{ "commandId": "cmd_client_002", "sceneVersion": 13, "type": "start_class", "facultyId": "ruby" }
{ "commandId": "cmd_client_003", "sceneVersion": 14, "type": "answer_question", "questionId": "ruby-001", "answer": "B" }
{ "commandId": "cmd_client_004", "sceneVersion": 15, "type": "social_choice", "choiceSetId": "cafeteria-first-result", "choiceId": "next-time" }
{ "commandId": "cmd_client_005", "sceneVersion": 16, "type": "use_item", "itemId": "flashcards" }
{ "commandId": "cmd_client_006", "sceneVersion": 17, "type": "record_memory", "memoryId": "first-homeroom" }
{ "commandId": "cmd_client_007", "sceneVersion": 18, "type": "null_minigame_choice", "minigameId": "null-first-signal", "approachId": "hold-signal" }
{ "commandId": "cmd_client_008", "sceneVersion": 19, "type": "advance_dialogue" }
```

Rules:

- `commandId` is required for mutating commands.
- Replaying the same `commandId` returns the original result.
- Stale `sceneVersion` returns the latest scene plus a recoverable conflict error.
- The server never trusts client-provided room, character, reward, affinity, or memory state.
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
  "characters": {}
}
```

## 8. Data Model Additions

New durable concepts:

- school year id
- year day id
- current beat id
- completed beat ids
- current time block
- current room id
- room visit history
- social event history
- memory records
- comic page unlocks
- affinity deltas
- reputation tags
- stat expression history
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
  currentRoomId: string;
  currentTimeBlock: Ruby2TimeBlock;
  visitedRooms: Record<string, number>;
  socialEvents: Ruby2SocialEventRecord[];
  memories: Ruby2MemoryRecord[];
  comicUnlocks: string[];
  affinity: Record<string, number>;
  reputationTags: string[];
  statExpressionCounts: Record<"head" | "heart" | "hustle" | "honor", number>;
  npcRoomOverrides: Record<string, Ruby2NpcRoomOverride>;
  commandResults: Record<string, Ruby2CommandResult>;
  lastSceneEventId: string;
};
```

Keep stored state small. Derived values such as "which NPCs are in this room" should come from year schedule, NPC schedule, and current state unless a durable override is needed.

## 9. Client And Presentation

### 9.1 Recommended Client Shape

Use a C/sokol game client for the play surface if the hard rendering spike passes:

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

Long-form editing, admin dashboards, metrics charts, account management, and billing management remain better as web/native shell UI.

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
room.entered
room.exited
character.appeared
dialogue.line_started
dialogue.line_finished
question.revealed
answer.locked
npc.answer_locked
answer.resolved
social.choice_selected
null_minigame.started
null_minigame.choice_selected
null_minigame.completed
comic_page.unlocked
memory.recorded
yearbook.sealed
bell.rang
```

Reduced-motion and low-power modes map events to simpler transitions. They do not disable state changes.

## 10. Metrics

Ruby High 2.0 should be measured by retention truth, not spectacle.

Events:

```text
ruby2_client_boot
ruby2_scene_loaded
ruby2_beat_started
ruby2_room_entered
ruby2_exit_taken
ruby2_dialogue_started
ruby2_dialogue_completed
ruby2_class_started
ruby2_question_revealed
ruby2_answer_locked
ruby2_answer_resolved
ruby2_class_completed
ruby2_social_choice_presented
ruby2_social_choice_selected
ruby2_stat_expression_recorded
ruby2_social_interlude_completed
ruby2_null_minigame_started
ruby2_null_minigame_completed
ruby2_comic_page_unlocked
ruby2_memory_recorded
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
- Notebook memory recorded -> next-day return
- Day 2 return -> first Captain Null minigame started
- first Captain Null minigame started -> comic page unlocked
- comic page unlocked -> later beat references the page/anomaly

Stat metrics should track which stat was expressed by a class question, social
choice, item use, or memory write. Use this to understand player identity
patterns, not to optimize a combat-style build.

Captain Null metrics should answer whether the pressure slot improves return,
comic collection, and Yearbook attachment without harming class/social
completion.

Primary success metric:

> Unique visitors who complete a first class, record a first memory, and return after 24 hours.

Week One success metric:

> Returning players who reach the Day Two Captain Null interruption, unlock the
> first comic page, and later see the school acknowledge that anomaly.

Cost metrics:

- social LLM calls per completed first class
- social LLM calls per returning visitor
- asset-generation cost per accepted room asset
- failed/degraded AI rate
- native crash-free sessions

## 11. Build Plan

Build the product in content-first wedges.

### 11.1 Wedge 0: Year One Text Simulation

Purpose: prove the game loop before frontend work.

Scope:

- Year One Day One fixture
- room/action text output
- one Ruby class, reducible to one question for smoke tests
- one multiple-choice social beat
- Notebook memory write
- stat tags on class questions and social choices
- tomorrow hook
- deterministic replay tests

Acceptance:

- the whole day can be completed in a terminal/test harness
- social choices produce visible consequences
- stat expression affects report or memory wording
- memory text reflects class/social outcome
- same input sequence produces same state
- no renderer, no AI, no mobile

### 11.2 Wedge 1: Scene Contract

Purpose: prove the backend can drive a game scene without leaking business rules into the client.

Scope:

- `GET /api/apps/ruby-high/ruby2/session/:sessionId/scene`
- `POST /api/apps/ruby-high/ruby2/session/:sessionId/command`
- Year One Day One fixture
- hallway, homeroom, cafeteria room graph
- idempotent commands
- ordered animation events
- fixture tests for stale scene versions and duplicate command ids

Acceptance:

- scene snapshots are deterministic for the same state
- required beats appear in intended order
- duplicate command ids return same result
- stale command versions recover cleanly
- client can rebuild visible state from scene JSON plus asset manifest

### 11.3 Wedge 2: Render Prototype

Purpose: prove the game client can present Ruby High text and choices well.

Scope:

- one hallway background
- one Ruby standee
- one dialogue box
- two dialogue choices
- local scene JSON fixture
- local asset manifest fixture
- desktop and mobile viewport layouts
- reduced-motion flag

Acceptance:

- text wraps without clipping at mobile and desktop sizes
- touch targets are stable and large enough
- standee and dialogue box do not fight for space
- background crops acceptably on mobile
- web/WASM build runs the same scene

### 11.4 Wedge 3: Classroom Loop

Purpose: prove existing class mechanics feel better in the RPG surface.

Scope:

- hallway -> homeroom movement
- Ruby class intro
- one multiple-choice question for prototype
- answer lock
- NPC answer lock animation
- answer reveal animation
- class report
- metrics

Acceptance:

- one class can be completed without the current viewer UI
- answer outcome is server-authoritative
- animation is driven by server events
- degraded/no-animation mode still plays correctly
- it feels materially more like attending Ruby High than using the current board

### 11.5 Wedge 4: Social And Memory

Purpose: prove class results become social material.

Scope:

- cafeteria social room
- Lyra and Mika present
- one constrained multiple-choice social beat
- 2-3 reply choices
- authored fallback dialogue
- affinity/reputation/hint result validated by schema
- Notebook memory write
- tomorrow hook

Acceptance:

- social event never blocks exits or next action
- player response is captured as `choiceId`, not freeform text
- durable social result is schema-valid
- Notebook memory reflects the class/social outcome
- metrics compare class-only vs class-plus-social completion

### 11.6 Wedge 5: Captain Null Minigame

Purpose: prove Ruby High has a battle-shaped pressure slot without making
classmates adversarial. Build this as a Day Two-ish text/scene fixture before
mobile proof.

Scope:

- one Captain Null authored minigame fixture
- one First Bell comic-page unlock
- four stat-flavored approaches
- clear/mixed/failed-forward/restraint outcomes
- one later school beat affected by the comic unlock
- no freeform input
- no twitch reflex requirement
- return to normal school schedule after completion

Acceptance:

- minigame feels like an interruption from the comic, not a normal class
- player choice is captured as an approach id
- outcome can reward restraint or silence, not only action
- comic page unlock is durable
- a later scene references the anomaly/comic page
- classmates react afterward as allies/witnesses, not enemies

### 11.7 Wedge 6: Mobile Proof

Only after Wedges 0-5 pass:

- build one iOS shell or one Android shell
- wire session/auth handoff
- confirm asset loading
- confirm safe areas and touch input
- confirm suspend/resume behavior
- emit native error/crash telemetry

Exit criteria: one real device can play the same class-plus-social-plus-memory slice.

## 12. Phasing

Phase 0: Year One content simulation.

Phase 1: Scene and command APIs.

Phase 2: render/text/touch prototype.

Phase 3: first classroom.

Phase 4: first social and Notebook memory.

Phase 5: first Captain Null minigame.

Phase 6: first mobile proof.

Phase 7: campus expansion after retention signal.

Phase 8: production migration behind a feature flag.

Move default traffic only if Ruby High 2.0 beats the current viewer on first-class completion, memory completion, D1 visitor retention, D1 character retention, and crash-free sessions without regressing auth or commerce.

## 13. Risks

### Content Vagueness

The largest risk is building a game shell before the authored year feels good.

Mitigation:

- Year One Day One text simulation first
- every beat has choices, consequences, memory, and hook
- do not start broad frontend work until the text loop works

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

### AI Chaos

AI can make the school feel alive or incoherent.

Mitigation:

- deterministic year schedule
- deterministic room graph
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

Social spaces can accidentally turn every room visit into an LLM bill.

Mitigation:

- budget one social generation per early-session beat
- cache social outputs by time block and room
- show authored fallback on failure or budget exhaustion
- track social LLM calls per completed class and per retained visitor

## 14. Open Decisions

- What final copy should replace the placeholder Year One Day One script?
- Which exact Day One question content best teaches Head, Heart, and Honor?
- Should Year One Day One use Noor or Sami as the third social voice?
- Where inside Day Two should the first Captain Null stinger land: before Science Lab, after Science Lab, or after the Flashcards tutorial?
- How many daily memories become Yearbook entries automatically?
- When, if ever, should direct movement become worth its complexity?
- Which text renderer gives acceptable mobile quality with the least custom work?
- Should first-slice backgrounds be bundled or fetched/cached dynamically?
- Which native shell should host the first mobile proof?

## 15. Guiding Constraint

Ruby High 2.0 should be deterministic underneath and magical on top.

The year schedule, room graph, class outcomes, social choices, memory writes, rewards, progression, metrics, and billing must be structured. AI should provide dialogue, flavor, background generation, and social texture inside those rails.

That is the difference between a school-year RPG with AI in it and a chatbot wearing a school uniform.
