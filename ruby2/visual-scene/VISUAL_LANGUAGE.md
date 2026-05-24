# Ruby High Visual Language

## Core Read

Ruby High should look like a school-day RPG staged through readable dialogue
screens: painted room backgrounds, close-up character cutouts, physical item
cards, speech bubbles, a functional blackboard, and Notebook/Yearbook UI
surfaces.

The player should read each screen as:

```text
Where am I?
Who is here?
What object matters?
Who is speaking?
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
| Science Lab | bright surfaces, evidence objects, instrument clutter |
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
  "checking the stamp twice", "not touching the margin", etc.
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

## Blackboard Functionality

The blackboard is not decoration. It is the teacher/problem surface that makes
the current evidence legible. It shares the focus slot with the active speaker's
speech bubble.

| Blackboard Region | Purpose | Source |
| --- | --- | --- |
| Evidence lines | What objects/facts are currently on the board | `snapshot.objects`, latest event |
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
Compare the answer card with the wet work-order stamp.
Ask what original is supposed to mean.
Circle the footer Ruby says she did not print.
Ask Ravi and Lyra what each can verify.
```

Source / Sense / Signal / Sync remain engine disciplines, not the player's
visible labels.

## Engine Bridge

The browser prototype should not maintain a separate authored scene state. The
C UI snapshot is the source of truth for:

- current room and time block
- visible clocks and discipline traces
- people physically present
- objects physically present
- latest speakable event / performance line
- Notebook margin line
- legal actions

`engine-snapshots/*.json` are sample C outputs. Run
`scripts/export_engine_scene_data.py` to convert them into
`engine-scene-data.js`, which keeps the prototype usable from `file://` while
preserving the same state contract as the CLI.

The renderer may add presentation-only reads, such as Lyra's tiny witness
reaction or a procedural receipt card, but it should not invent state. If a
person, object, clock, or action is not in the snapshot, it should not appear as
available in the scene.

## Null Treatment

Captain Null should bend the existing school screen before it gets its own mode.

Good first symptoms:

- footer text appears on the wrong object
- clock hand stops one tick early
- Notebook margin changes phrasing
- room tint cools or desaturates
- a speech bubble gets too quiet

The scene should still look like Ruby High. Null is pressure entering the
school, not a separate combat UI dropped on top.
