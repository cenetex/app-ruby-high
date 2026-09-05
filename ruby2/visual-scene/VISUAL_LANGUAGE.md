# Ruby High Visual Language

> **Status: Ruby High 2.0 prototype.** This guide describes the standalone scene in this directory. The live web viewer at `/api/apps/ruby-high/viewer` uses the classroom layout in [`src/viewer-parts`](../../src/viewer-parts/). See the [runbook](../../README.md) for the production app.

## Core Read

Ruby High should look like a school-day RPG staged through readable dialogue
screens: painted room backgrounds, close-up character cutouts, physical item
cards, speech bubbles, a functional blackboard, and Notebook/Yearbook UI
surfaces.

The player should read each screen as:

```text
Where am I?
Who is here?
What item matters?
Who is speaking?
Why are they reacting?
What can I do next?
```

## Composition

Use a stable 16:9 stage.

- Background fills the whole stage and establishes place.
- The active speaker appears as a close-up cutout, cropped by the lower UI.
- Witnesses appear lower in the room as smaller bodies with tiny reaction
  bubbles.
- The active speaker moves forward through scale, brightness, and speech bubble
  attachment, not through a separate modal.
- Items sit in a quiet side rail so they stay readable without crowding the
  people.
- The focus surface alternates between speech bubble and blackboard in the same
  upper stage slot. Ruby can ask the question in a bubble, then a Next button
  can reveal the board state without moving the player choices.
- The bottom action tray stays persistent. It owns the four legal choices and
  keeps the bright Ruby 1.0 answer colors.

## Layer Order

```text
1. room background
2. room tint / time-of-day wash
3. dialogue vignette
4. active speaker close-up
5. witness bodies and tiny reaction bubbles
6. item side rail
7. focus surface: speech bubble or blackboard
8. Notebook margin strip
9. bottom action tray
```

## Locations

Rooms should keep their emotional function visible.

| Location | Visual Read |
| --- | --- |
| Homeroom | safe, guided, Ruby-centered, first bell pressure |
| Science Lab | bright surfaces, lab items, instrument clutter |
| Library | quiet contrast, shelves, margin notes, impossible text |
| Cafeteria | crowded energy, trays, gossip surfaces |
| Greenhouse | recovery, warmer light, slower pacing |
| Courtyard | crossings, open air, routes visible |

Use wide backgrounds as places first. Card art can appear in UI, map nodes, or
Yearbook pages, but should not replace the room stage.

## Avatars

The current alpha-friendly avatar assets are stronger as dialogue cutouts than
as walkable sprites. Use them like close-up RPG standees until the art pipeline
can export depth-aware scenes.

Rules:

- Use generated `*-cutout.png` files as the first close-up cutouts.
- Teachers and students can both be the featured speaker.
- Featured speaker anchors one side of the scene and is cropped by the bottom
  UI, giving a half-body close-up without new assets.
- Other present characters appear lower in the room with one short read:
  "checking the step twice", "not touching the margin", etc.
- Avoid pretending characters are standing precisely on a generated floor until
  the asset pipeline has depth and occlusion metadata.
- Use collectible card art for Yearbook/inventory/card surfaces, not for
  physically present room standees.

## Items

Items should feel like actionable school artifacts.

- Notebook is always a foreground anchor.
- Flashcards sit near the action tray during preparation or class.
- Office Pass appears as a recovery affordance only in a legal scene.
- Library Card / Lab Flask / Lunch Tray should appear in matching rooms or
  loadout moments.

Do not show unusable item buttons as dead UI. If the item appears, it should be
inspectable, usable, or clearly part of the scene.

## UI

The UI should feel like school equipment before it feels like a HUD.

- Top-left: room and time block, small and legible.
- Top-right: light status marks, not a stats dashboard.
- Focus slot: speech bubble or blackboard, never both competing for attention.
- Bottom: persistent four-button action tray.
- Notebook strip: a margin-style line above the action tray.

## Witness And Responder Rule

NPC reaction bubbles should come from the engine's resolved co-presence and class
session responder slots. A visual scene can emphasize Lyra, Ravi, Mika, Indra,
Noor, or Sami through scale, dimming, and short reads, but it should not invent a
witness who was not present or granted a validated remote slot.

When the goal/plan runtime lands, the preferred presentation order is:

```text
teacher frames board
-> blackboard shows problem
-> player chooses approach
-> selected classmate responder bubbles appear
-> Notebook margin records the social/memory consequence
```

The player does not need to see raw NPC goal names, but the visible reaction
should make the goal legible: Lyra verifies, Ravi tests, Mika supports, Indra
spots a pattern, Noor punctures the fake-normal thing, Sami avoids effort until
the contradiction is too obvious.

## Blackboard Functionality

The blackboard is not decoration. It is the teacher/problem surface that makes
the current problem state legible. It shares the focus slot with the active speaker's
speech bubble.

| Blackboard Region | Purpose | Source |
| --- | --- | --- |
| Item lines | What items/claims are currently on the board | `snapshot.items`, latest event |
| Board question/update | What problem the room is asking now | scene resolver / event kind |
| Next / Speech toggle | Alternates between character line and board state | local presentation state |

The action tray owns the player moves:

| Action Tray Region | Purpose | Source |
| --- | --- | --- |
| Choice tiles | The four legal player verbs | `snapshot.actions` |
| Bright colors | Fast choice parsing, inherited from Ruby 1.0 | visual style |
| Number badges | Input index for keyboard/controller/touch | action order |
| Notebook margin | Consequence/memory read after action | latest notebook event |

Speech bubbles still carry character performance. They should not replace the
board. Ruby can explain, Noor can react, Lyra can panic, then the same focus
area can flip into the blackboard so the player sees the state of the problem.

Use the Ruby 1.0 answer colors for action tray choices:

| Slot | Color | Use |
| --- | --- | --- |
| 1 | orange `#f0922a` | first legal move |
| 2 | yellow `#f7d33a` | second legal move |
| 3 | green `#4cb555` | third legal move |
| 4 | blue `#3aa3e0` | fourth legal move |

These colors do not reveal Source/Sense/Sync/Signal. They are visual rhythm and
input affordance only.

The four approach buttons should show grounded actions, not stat names:

```text
Compare the answer card with the work-order step.
Ask what revised changes in the answer.
Circle the mismatch between answer card and work order.
Ask Ravi and Lyra what each can verify.
```

Source / Sense / Signal / Sync remain engine disciplines, not the player's
visible labels.

## Engine Bridge

The browser prototype should not maintain a separate authored scene state. The
C UI snapshot is the source of truth for:

- current room and time block
- visible clocks and discipline traces
- class session phase and responder slots
- people physically present
- items physically present
- latest speakable event / performance line
- Notebook margin line
- legal actions

`engine-snapshots/*.json` are sample C outputs. Run
`scripts/export_engine_scene_data.py` to convert them into
`engine-scene-data.js`, which keeps the prototype usable from `file://` while
preserving the same state contract as the CLI.

The renderer may add presentation-only reads, such as Lyra's tiny witness
reaction or a procedural item card, but it should not invent state. If a
person, item, clock, or action is not in the snapshot, it should not appear as
available in the scene.

## First Bell / Theory Hype Treatment

Captain Null should first appear as First Bell media and student theory pressure
inside the existing school screen before it gets a dedicated session.

Good first symptoms:

- a First Bell issue is half-visible on a desk, shelf, or cafeteria tray
- a photocopied panel disagrees with a hallway item
- Notebook margin text borrows a comic word
- a rumor/thread card appears in the Notebook strip
- room tint cools as mood, not proof that the world changed
- a speech bubble turns a coincidence into a theory

The scene should still look like Ruby High. Null is fandom and theory pressure
entering the school, not a separate combat UI or genre rupture dropped on top.
