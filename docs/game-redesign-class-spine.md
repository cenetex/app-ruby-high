# Ruby High Redesign: Class Spine

Date: 2026-07-14
Status: Phase 2 class ritual shipped; archive/public-world phases remain

## Summary

Ruby High should be redesigned around one primary promise:

> Every day, you enter class, answer in front of a room, hear the teacher
> respond, see classmates react, and leave with the school record changed.

This keeps the strongest parts of the current product: teachers, classmates,
daily classes, class grades, playbooks, MASH relationships, yearbook entries,
public world events, Hall Passes, card NFTs, portraits, and graduation. The
problem is hierarchy. Multiple-choice question play currently reads as the main
game, while the more distinctive product, being seen by a school with memory and
taste, appears later or around the edges.

The redesign should not add a new named ritual. It should make the existing
class rhythm more emotionally complete.

The product spine becomes:

1. answer in class
2. receive a teacher response
3. see classmates react
4. update the school record
5. collect the year's best moments as artifacts

## What Changes

We should remove the idea of a separate named payoff object.

The teacher response is not a new collectible system by itself. It is the
natural end of class. It can be saved, quoted, shared, and later appear in the
yearbook, but the player should not feel like Ruby High has introduced another
headline mechanic.

Use plain product language:

- teacher response
- class result
- class note
- room reaction
- school record
- yearbook entry

Avoid making players learn a new product noun for something school already
understands.

## Ritual Budget

The redesign must reduce ceremony, not add it.

Ruby High already has many potential reward moments: class completion, First
Bell report, comics, relationship ticks, yearbook entries, graduation, photos,
Hall Pass grants, card packs, public-world events, and NFTs. If each one acts
like a headline, the player will stop understanding what matters.

The rule:

> One primary ritual per session. Everything else is a receipt, a chip, or a
> quiet archive update.

### Tier 1: Primary Ritual

Only one of these should dominate a play session:

- first-session class note
- daily class result
- year graduation ceremony

The UI can be large, emotional, and modal here.

### Tier 2: Secondary Receipts

These can appear in the post-class summary or account/archive surfaces:

- comic page found
- relationship cell circled or scratched
- yearbook progress changed
- public-world room contribution
- Merit Stars gained
- Hall Pass balance changed

They should not steal the screen from the class result.

### Tier 3: Quiet State

These should update silently unless the player goes looking:

- card mastery phase changes
- NFT eligibility
- pack/card collection status
- detailed public-world metrics
- practice queue changes
- low-level wallet/history rows

They are important systems, not moment-to-moment drama.

### Compression Rule

If several rewards happen at once, show one story:

> Ruby answered you. Mika reacted. A comic page came out of that moment.

Do not show three separate celebrations.

### First Bell Rule

First Bell is the tutorial ritual. It teaches the pattern once:

answer -> teacher response -> school record.

After that, First Bell should become an archive/collection thread, not a
repeated modal competing with daily class.

### Graduation Rule

Graduation is the year-level ritual. It should not feel like another routine
reward. It should collect the year's strongest class notes, relationships, and
artifacts into one ceremony.

Graduation should happen less often, hit harder, and summarize more.

## Design Pillars

### 1. Class Is The Game

Ruby High is not strongest as a quiz app. It is strongest as a school with
standards, memory, and social pressure.

The emotional high point of a session should be the class result:

- what the student said or chose
- how the teacher responded
- how it compared to the room
- what a stronger answer would have done
- what changed because of it

The response should be specific enough to screenshot and meaningful enough to
chase.

### 2. The Room Matters

Classmates are not decoration. They are the pressure system. A player should
feel like they answered in a room, not in a private quiz engine.

Every graded moment should answer:

- Who beat me?
- Who backed me?
- Who did I impress?
- Who thinks I missed the point?

The MASH/social card should become the visible consequence layer for this.

### 3. Artifacts Are Proof

The yearbook, First Bell report, diploma, graduation photo, and NFTs should
commemorate remembered school moments. The artifact is not merely proof of
completion. It is proof that Ruby High saw a student think and wrote it into
the record.

Completion artifacts are weaker than remembered-moment artifacts.

### 4. Daily Cadence Stays

The school day is a great constraint. Keep it. The redesign should not become a
free-form chat sandbox.

The ideal daily class is short, repeatable, and emotionally complete:

1. enter room
2. warm up
3. answer the real prompt
4. hear the teacher respond
5. see consequences
6. leave with an archive update or progress toward one

### 5. Systems Must Read As One Thing

Ruby High has many good systems. The player should not have to understand all of
them at once.

The visible hierarchy should be:

1. answer today
2. get a teacher response
3. improve your standing
4. keep the best records

Everything else is supporting texture.

### 6. Three Homes Only

The shipped app should organize existing systems into three homes:

1. **Classroom**: daily class, teacher response, classmates, chat, and review.
2. **Yearbook**: class notes, report card, relationships, comics, graduation,
   share artifacts, and generated keepsakes.
3. **Account**: identity, wallet, Hall Passes, cards, packs, minting, receipts,
   trust, and settings.

Anything outside those homes should be removed from primary chrome or treated as
a contextual receipt. Packs, cards, mints, and wallet balances should not sit
beside the class-progress chip.

## Redesigned Core Loop

### Previous Feel

The player mostly experiences:

1. next question
2. pick answer
3. dice/result
4. class progress
5. maybe artifact later

This is legible, but it is close to commodity quiz play.

### Shipped Class Feel

The player should experience:

1. **Bell**: today has a teacher and a room.
2. **Evidence**: two short board cards establish the topic and performance.
3. **Take**: the teacher asks for a concise answer or opinion.
4. **Peers**: classmates answer too.
5. **Teacher Response**: the teacher compares, critiques, and nudges.
6. **Room Reaction**: grade, relationship, mastery, and room state update.
7. **School Record**: the class result is saved into report-card/yearbook
   trajectory.

Multiple choice remains useful, but it becomes preparation and evidence. The
teacher response becomes the payoff.

## Daily Class V2

Each core-faculty daily class is a three-card session followed by its result:

1. **Two Evidence Cards**
   - A fast multiple-choice or typed-answer card.
   - Purpose: establish topic, earn evidence, trigger playbook moves.
   - Result should feed the class result context.

2. **Take Card**
   - A short opinion prompt.
   - Player writes 1-3 sentences.
   - Two classmates answer in their own voice.

3. **Class Result**
   - Teacher responds comparatively.
   - Shows score impact, teacher line, and classmate reaction.
   - Saves as the durable class moment.

This preserves the three-question class footprint while changing the emotional
center. Instead of three similar quiz cards, the class has evidence, a written
take, and a teacher response.

Important: this is one class ritual, not three reward moments. Evidence and
Take are setup. Class Result is the payoff.

## Practice V2

Practice stays mostly question-based, but its framing changes:

- Practice is where you build evidence and sharpen weak cards.
- Daily class is where teachers respond to your take.
- Merit Stars can fund extra teacher chat or practice support.

Practice should not compete with daily class. It should point toward it.

## Class Result Object

We still need a reusable model and renderer, but it should not be framed as a
new named collectible. Treat it as the saved result of a class beat.

### Required Fields

- Teacher
- Subject / room
- Grade year
- Prompt
- Player answer
- Teacher response
- Score or letter impact
- Rank in room, if available
- Best responder, if available
- What a stronger answer would have done
- One classmate reaction
- One mechanical consequence

### Tone Standard

The response should be:

- specific
- comparative
- worldview-driven
- useful
- occasionally sharp
- never generic praise

Bad:

> Great answer. You did well.

Good:

> You noticed the tradeoff, but you treated every motive like it had equal
> weight. Kiran saw the hierarchy sooner. Next time, name the strongest pressure
> first.

### Data Shape

The class result can be stored as structured data:

- `id`
- `studentId`
- `teacherId`
- `roomId`
- `dayKey`
- `sourceQuestionIds`
- `prompt`
- `studentAnswer`
- `teacherResponse`
- `scoreDelta`
- `rank`
- `bestResponderId`
- `classmateReaction`
- `relationshipDeltas`
- `artifactEligibility`
- `createdAt`

This object can power:

- post-class summary
- yearbook entries
- First Bell report
- graduation recap
- public world event log
- share image generation
- NFT metadata

## Existing Systems Reframed

### Questions

Keep, but reposition.

Questions are not the whole game. They are the lesson material and evidence
engine.

Use questions for:

- warm-up
- teacher lesson pacing
- mastery
- practice
- playbook triggers
- classroom momentum

Daily class should guarantee at least one opinion moment where a teacher can
respond in voice.

### Dice

Keep, but make quieter.

Dice are charming, but they should not feel like the reason the school made a
decision. They should color uncertainty, not replace the teacher.

Use dice for:

- close-call flavor
- playbook move resolution
- room energy
- comic timing

Avoid showing dice as the main explanation for a class result.

### Playbooks

Keep, make more visible.

Playbooks are excellent because they make students feel authored. Current
playbook moves should become legible inside the class result and room reaction.

Example:

> Mika used Golden Retriever Logic: +1 Heart with the room, but Professor Lyons
> still wanted sharper evidence.

### MASH Relationships

Keep, make it the social consequence layer.

After a class result:

- one classmate reacts
- one relationship changes
- one MASH cell updates
- the player understands why

Do not show every relationship change every time. Show the most story-rich one.

### Yearbook

Keep, but make it a record archive.

The yearbook should collect remembered class notes, relationships, portraits,
and graduation artifacts. It is the place a player returns to see who they
became at school.

Yearbook entries should include:

- teacher quote
- signature answer
- strongest room reaction
- relationship snapshot
- portrait
- generated photo, when earned

### Graduation

Keep, make rarer and more meaningful.

Graduation should happen after the school has enough memory to summarize a year.
It should not feel like another routine progress popup.

Graduation should include:

- final grade
- teacher address
- classmate quote
- relationship status
- generated graduation image
- minted or mintable artifact, if eligible
- yearbook page update

### Comics

Keep, but make them receipts.

Comics should not compete with the class result. They should feel like a scene
that came out of what happened in class.

Best use:

- post-class receipt
- yearbook insert
- shareable moment
- public-world flavor event

### Hall Passes And NFTs

Keep, make earned artifacts feel like school records.

The strongest NFT candidates are not generic cards. They are:

- cast portraits
- player portraits
- yearbook pages
- graduation photos
- First Bell reports
- rare class photos
- special teacher notes

NFTs should sit behind meaningful school memory. They should be a way to keep a
record, not the main reason to play.

## Public World Reframe

The public world should feel like shared school life, not only a chatroom.

Useful public events:

- a student topped the room today
- a classmate reacted to a strong answer
- a comic scene appeared from class
- a graduation photo entered the yearbook
- a teacher note became widely shared

Public-world surfaces should emphasize:

- room energy
- class trends
- popular classmates
- active teachers
- shared artifacts

Avoid making public feeds feel like raw quiz logs.

## UI Direction

### Daily Class Screen

The daily class screen should read like a classroom:

1. Teacher presence
2. Today's room
3. Board card
4. Player answer
5. Classmates nearby
6. Teacher response
7. Room reaction
8. Continue / archive

The UI should not make every subsystem equally loud.

### Post-Class Summary

The post-class summary should show one main result and compact receipts.

Primary area:

- teacher response
- class score impact
- classmate reaction

Receipt row:

- relationship update
- comic found
- yearbook progress
- Merit Stars
- Hall Pass progress

Archive action:

- save to yearbook
- share image
- view class record

### Yearbook Screen

The yearbook should become the durable emotional inventory.

Primary tabs:

- Students
- Teachers
- Class Notes
- Photos
- Graduation
- Collection

It should feel like looking through a school record, not managing a database.

## NFT Metadata Compatibility

NFT metadata should describe artifacts in MUD-friendly terms:

- stable item type
- character or player identity
- school year
- room
- teacher
- date key
- rarity
- image URL
- external URL
- source event id
- deterministic provenance fields

Recommended trait names:

- `Artifact Type`
- `School`
- `Year`
- `Room`
- `Teacher`
- `Student`
- `Cast Role`
- `Season`
- `Source Event`
- `Generation`
- `Rarity`

Avoid metadata that only makes sense inside current UI copy. A MUD should be
able to read the artifact as a world object.

## Metrics

Track whether the player understands and returns for the class rhythm.

### Core Events

- `daily_class_started`
- `evidence_card_completed`
- `take_card_submitted`
- `teacher_response_viewed`
- `room_reaction_viewed`
- `class_result_completed`
- `class_record_saved`
- `yearbook_entry_viewed`
- `artifact_shared`
- `artifact_mint_started`
- `artifact_mint_completed`

### Retention Questions

The next pass should answer:

- Do players return for daily class?
- Do players submit takes when prompted?
- Do players read the teacher response?
- Do players click into the yearbook after a class result?
- Do relationship changes increase next-day return?
- Do generated photos increase sharing?
- Do NFTs monetize only after the school record matters?

### Quality Questions

Log enough structure to audit:

- generic teacher responses
- repeated classmate reactions
- confusing score changes
- weak artifact eligibility moments
- graduation events without enough remembered history

## Implementation Phases

### Phase 1: Class Result MVP

Build a reusable class result model and renderer.

Scope:

- teacher
- room
- prompt
- player answer
- teacher response
- score impact
- one classmate reaction
- one archive flag

Integrate into:

- First Bell
- daily class completion
- yearbook class notes

Acceptance:

- after first answer, the player sees a teacher response
- after an opinion round, the response can be saved as a class note
- class notes can render as share images
- no new headline mechanic is introduced

### Phase 2: Daily Class V2 — shipped 2026-07-14

Change daily class to a three-beat session:

1. two evidence cards
2. one take card
3. class result after grading

Acceptance:

- daily class always includes one opinion prompt
- classmates answer in character
- teacher response references the prompt and answer
- room reaction updates one visible social consequence
- the take does not satisfy the separate grade-essay graduation gate
- all seven class-ritual events above persist into the admin metric snapshot

### Phase 3: Social Consequence Layer

Make classmate reactions visible after class results.

Acceptance:

- one classmate reaction appears per daily class
- MASH cell updates are explainable
- relationship deltas are stored
- classmates feel less decorative

### Phase 4: Artifact Archive

Make yearbook entries highlight remembered school moments.

Acceptance:

- class notes are browsable
- yearbook can show teacher quote, student answer, and reaction
- graduation can summarize the year
- share images pull from the same data

### Phase 5: Public World

Tune public world to show class and artifact events.

Acceptance:

- public feed highlights class moments, not raw answers
- room state reflects collective activity
- generated images appear in relevant share posts
- empty rooms still feel like school is happening

### Phase 6: NFT Artifact Path

Connect generated artifacts to minting.

Acceptance:

- player portrait and cast portrait artifacts are mintable
- graduation photo metadata is MUD-compatible
- class note and yearbook artifacts have stable event provenance
- image URLs are publicly readable before minting
- metadata has a durable schema version

## Non-Goals

Do not do these before the class rhythm works:

- add more reward types
- add more currencies
- add another named final-card system
- add another permanent top-level button
- promote packs, cards, wallet, or minting beside class progress
- make graduation more frequent
- make NFTs the first-session goal
- turn daily class into open-ended chat

## Final Spine

Daily class produces a teacher response.

Teacher response changes relationships and records.

Records become yearbook artifacts.

Artifacts can be shared, collected, or minted.

That is the product loop.
