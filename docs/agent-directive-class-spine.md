# Agent Directive: Next Improvement Passes For The Class Spine

Date: 2026-06-21
Status: active work order for agent improvement passes

Read this before touching the teaching loop, faculty voice, grading, share
images, yearbook artifacts, or NFT generation.

## The Frame

Ruby High's defensible edge is not more quiz content. It is a school that feels
like it has memory, standards, teachers with taste, and classmates who notice
what happened in the room.

The product should not introduce another named payoff mechanic. The class
itself is the ritual:

1. enter room
2. answer
3. hear the teacher respond
4. see classmates react
5. update the school record
6. keep the best moments as artifacts

Multiple choice is lesson material. Open response is where the player feels
seen. The teacher response is the emotional end of class, not a standalone
collectible system.

## Cardinal Rule

Do not add another headline concept when a school word already works.

Prefer:

- teacher response
- class result
- class note
- room reaction
- school record
- yearbook entry
- graduation artifact

Avoid turning feedback, rewards, graduation, unlocks, and NFTs into separate
rituals that all demand equal attention.

## Pass 1: Make Class The Spine

What: make daily class feel like a complete school moment, not a row of similar
quiz cards.

Target class rhythm:

1. Evidence card
2. Take card
3. Class result

Where:

- `src/services/chat-service.ts`
- daily class turn policy
- opinion round flow
- class completion rendering

Verify:

- daily class includes at least one open-response or opinion prompt
- the teacher response references the player's actual answer
- one classmate reaction appears after the response
- the class result is saved as a recordable event

## Pass 2: Tighten Teacher Response

What: replace generic grading prose with a teacher response that is specific,
useful, comparative, and in character.

Response standard:

- names one concrete strength or weakness
- says what a stronger answer would have done
- reflects the teacher's worldview
- can compare against classmates when appropriate
- avoids generic praise
- never attacks the player's identity or protected traits

Target shape:

> You are {faculty}. A student answered in front of the room. Respond in your
> own voice. Name the specific thing that worked or failed, say what a stronger
> answer would have done, and note how the room reacted. Be sharp about weak
> thinking, never cruel about the person.

Where:

- grading callback in `src/services/chat-service.ts`
- faculty voice assembly in `src/services/faculty-service.ts`
- any prompt templates that summarize class results

Verify:

- snapshot tests reject interchangeable responses
- no-platitudes check catches "good job" style filler
- response includes at least one answer-specific detail
- response can be saved into the school record

## Pass 3: Make The Room Matter

What: classmates should be the pressure system.

After a class result, show:

- one classmate reaction
- one relationship change
- one visible MASH/social consequence
- the reason it changed

Where:

- MASH relationship updates
- viewer chat rendering
- class summary UI
- public world event generation

Verify:

- classmate reaction is tied to the player's answer or result
- relationship deltas have visible explanations
- only the most story-rich social change is promoted
- additional changes can remain in quiet state

## Pass 4: Turn Records Into Artifacts

What: share images, yearbook entries, graduation photos, and NFTs should
commemorate remembered school moments.

Strong artifact candidates:

- player portrait
- cast portrait
- class note
- yearbook page
- graduation photo
- First Bell report
- rare class photo
- special teacher note

Where:

- `src/services/ruby-high-service.ts`
- `src/services/hall-pass-nfts.ts`
- yearbook routes
- share image generation
- metadata generation

Verify:

- share image includes the teacher response or class note context
- artifact metadata includes stable source event provenance
- image URLs are publicly readable before minting
- generated player and cast images can become artifacts
- NFT metadata uses durable trait names that a MUD can read

## Pass 5: Reduce Ceremony

What: consolidate rewards so the player understands what mattered.

One primary ritual per session:

- first-session class note
- daily class result
- year graduation ceremony

Everything else is a compact receipt:

- comic page found
- relationship update
- yearbook progress
- Merit Stars
- Hall Pass change
- NFT eligibility

Where:

- post-class summary
- unlock messaging
- yearbook progress UI
- public world event feed
- graduation flow

Verify:

- concurrent rewards compress into one story
- post-class screen promotes one main result
- secondary rewards do not open separate modals by default
- graduation remains a year-level ceremony, not a routine popup

## Definition Of Done

The next implementation pass is done when a fresh player can complete a daily
class and understand this sequence without explanation:

1. I answered in class.
2. The teacher responded to what I actually said.
3. A classmate noticed.
4. My school record changed.
5. The best parts can become yearbook/share/NFT artifacts later.

If a change makes the game feel like it has more named systems to learn, cut or
compress it.
