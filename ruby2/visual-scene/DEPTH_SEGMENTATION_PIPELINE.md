# Ruby High v2 Depth Segmentation Pipeline

Date: 2026-05-21

## Goal

Ruby High v2 needs generated 16:9 room backgrounds to carry enough scene
metadata for a King's Quest-style stage:

- foreground masks for desks, counters, plants, shelves, railings, and other
  things that can cover a paper-doll avatar
- a relative depth map
- a floor or walkable baseline
- occlusion zones
- scale curves for avatar placement
- QA artifacts artists and implementers can inspect

This is not a full 3D reconstruction problem. The game only needs stable
2.5D placement rules for authored school rooms.

## Local Asset Context

Current wide room sources live in `assets/nft/grok-sources`:

| Room | Preferred source | Size |
| --- | --- | ---: |
| Homeroom | `location-homeroom.jpg` | 1360 x 768 |
| Science Lab | `location-science-lab.jpg` | 1360 x 768 |
| Library | `location-library.jpg` | 1360 x 768 |
| Cafeteria | `location-cafeteria.jpg` | 1360 x 768 |
| Greenhouse | `location-greenhouse.jpg` | 1360 x 768 |
| Courtyard | `location-courtyard.jpg` | 1360 x 768 |

Older square variants also exist beside them, but the scene prototype and asset
inventory already prefer the wide 1360 x 768 versions. Character cutouts in
`ruby2/visual-scene/generated` are tall transparent standees, so placement
metadata should be normalized to the room image instead of baked to a specific
CSS pixel size.

The existing visual language wants:

- full 16:9 room background
- shared floor line / baseline
- scale bands by role and depth
- foreground item props
- simple layered composition, not free camera movement

## Tooling Options Checked

### SAM 2.1

Official source: https://github.com/facebookresearch/sam2

Use for promptable image masks and automatic mask candidates. Current SAM 2.1
checkpoints support static image prediction and automatic mask generation. This
is useful for extracting desks, benches, counters, plants, shelves, doors, and
large foreground objects from a generated room.

Practical notes:

- Good candidate for an offline batch pass or artist-assisted annotation tool.
- Supports point and box prompts, so it can become an efficient review workflow:
  click object, save mask, name zone.
- Automatic mask generation should be treated as candidate generation, not
  final metadata. Generated school backgrounds have stylized edges and clutter,
  and auto masks will over-split shelves, desks, and posters.
- Installation expects modern Python/PyTorch and is friendliest on GPU. It can
  run without some custom CUDA post-processing, but this should stay outside the
  web app build.

Recommendation: use SAM 2.1 as the main mask proposal tool.

### Depth Anything V2

Official source: https://github.com/DepthAnything/Depth-Anything-V2

Use for relative monocular depth maps. Depth Anything V2 provides Small, Base,
Large, and Giant model tiers; the official repo notes that the Small model is
Apache-2.0, while Base/Large/Giant checkpoints are CC-BY-NC-4.0. It is also
available through Transformers and Apple Core ML references.

Practical notes:

- For this repo, relative depth is enough. We need near/far ordering and a
  normalized scale cue, not metric meters.
- The depth map can suggest occlusion bands and scale falloff, but it should not
  decide walkability alone. Painted floors, stairs, desks, and perspective lines
  can confuse monocular depth.
- Depth maps should be smoothed and quantized into a few bands for gameplay
  use. Do not use raw per-pixel depth for avatar scale every frame.

Recommendation: use Depth Anything V2 Small for the first automated pass because
its license is simplest and quality is likely enough at 1360 x 768. Keep the
model output as QA evidence plus derived hints, not canonical authoring truth.

### GroundingDINO / Grounded SAM 2

Official sources:

- https://github.com/IDEA-Research/GroundingDINO
- https://github.com/IDEA-Research/Grounded-SAM-2

Use when text prompts are useful, for example `desk`, `table`, `chair`,
`bookshelf`, `counter`, `plant`, `door`, `bench`, `window`, `railing`, and
`stairs`. Grounded SAM 2 combines open-set detection with SAM 2 mask extraction
and can dump JSON results in image demos.

Practical notes:

- This is useful for bootstrapping object candidates and labels.
- It is more moving parts than Ruby High needs for the MVP.
- Grounded SAM 2's newer strongest Grounding DINO 1.5 / 1.6 and DINO-X paths
  lean on API tokens in the official repo. Local GroundingDINO is still viable,
  but setup is heavier than Depth Anything plus SAM 2.
- Text grounding will miss fictional or stylized objects and may hallucinate
  labels. For room geometry, a human pass is still required.

Recommendation: defer Grounded SAM 2 until the manual pass becomes repetitive.
For MVP, use a small fixed prompt list only as optional object-label bootstrap.

### rembg / Similar Background Removal

Official source: https://github.com/danielgatis/rembg

Use for character or prop alpha extraction, not room depth segmentation. rembg
supports multiple matting/background removal models and can run through Docker
or Python/ONNX Runtime.

Practical notes:

- It fits the existing paper-doll/cutout asset gap.
- It does not understand room walkability, occlusion semantics, or scale curves.
- It can help make item-only props from card/source art, but it is the wrong
  primary tool for background scene metadata.

Recommendation: keep rembg in the avatar/prop cutout pipeline, not the room
placement pipeline.

## What To Automate

Automate these as batch-generated candidates:

1. `depth.png`: 16-bit or 8-bit normalized relative depth map from Depth
   Anything V2.
2. `depth-bands.png`: quantized near/mid/far visualization for human review.
3. `sam-candidates/*.png`: raw SAM 2 masks for high-confidence large objects.
4. `object-candidates.json`: bounding boxes, mask paths, areas, rough labels if
   GroundingDINO was used, and confidence scores.
5. `qa-overlay.png`: room image with depth bands, mask outlines, proposed floor
   line, and occlusion zones overlaid.
6. `qa-contact-sheet.png`: background, depth, bands, masks, and final zones in
   one inspectable image.

Automate these as suggestions only:

- candidate foreground occluders from masks whose lower edge intersects the
  bottom half of the room
- near/mid/far y bands from depth percentiles
- a first-pass scale curve from y position and depth-band average
- floor horizon / back-floor estimate from strong perspective lines if a
  line-detection pass is added later

## What Must Be Human-Authored

These should be explicit authored metadata, even if AI suggests defaults:

- `walkablePolygon`: the playable floor area. This is a design constraint, not
  just a visual one.
- `floorLine`: the baseline where paper dolls stand naturally.
- `scaleCurve`: the final avatar scale by y position. It must look good with
  Ruby High standees, not merely follow raw depth.
- `occlusionZones`: semantic zones such as `front_desks`, `lab_counter`,
  `greenhouse_plants`, `library_shelves`, or `courtyard_railing`.
- `safeSlots`: curated positions for dialogue staging, teacher anchoring,
  student clusters, and active-speaker focus.
- `blockedZones`: areas that should never receive a character, even if they are
  visible floor-like pixels.

The human pass is the product layer. AI should reduce tracing time, not decide
scene blocking.

## MVP Output Schema

Use one JSON file per room. Keep coordinates normalized from `0` to `1` so the
same metadata works at native 1360 x 768, CSS-scaled desktop, and mobile crops.

```json
{
  "schemaVersion": 1,
  "roomId": "homeroom",
  "sourceImage": "../../assets/nft/grok-sources/location-homeroom.jpg",
  "nativeSize": { "width": 1360, "height": 768 },
  "generatedAt": "2026-05-21",
  "assets": {
    "depthMap": "./generated/depth/homeroom-depth.png",
    "depthBands": "./generated/depth/homeroom-depth-bands.png",
    "qaOverlay": "./generated/depth/homeroom-qa-overlay.png"
  },
  "walkablePolygon": [
    [0.12, 0.58],
    [0.88, 0.58],
    [0.96, 0.94],
    [0.04, 0.94]
  ],
  "floorLine": {
    "backY": 0.58,
    "frontY": 0.94,
    "horizonY": 0.42
  },
  "scaleCurve": [
    { "y": 0.56, "scale": 0.58 },
    { "y": 0.70, "scale": 0.76 },
    { "y": 0.86, "scale": 1.0 },
    { "y": 0.96, "scale": 1.12 }
  ],
  "safeSlots": [
    {
      "id": "teacher_left",
      "x": 0.24,
      "y": 0.76,
      "role": "teacher",
      "scale": 0.92,
      "zBand": "mid"
    },
    {
      "id": "student_right",
      "x": 0.68,
      "y": 0.82,
      "role": "student",
      "scale": 0.84,
      "zBand": "front"
    }
  ],
  "occlusionZones": [
    {
      "id": "front_desks",
      "label": "Front desks",
      "mask": "./generated/depth/homeroom-occlusion-front-desks.png",
      "zPolicy": "cover_avatar_below_y",
      "thresholdY": 0.72,
      "softenPx": 2
    }
  ],
  "blockedZones": [
    {
      "id": "teacher_board_area",
      "polygon": [
        [0.28, 0.18],
        [0.72, 0.18],
        [0.72, 0.48],
        [0.28, 0.48]
      ],
      "reason": "wall"
    }
  ],
  "qa": {
    "status": "draft",
    "reviewedBy": null,
    "notes": []
  }
}
```

## Suggested File Layout

```text
ruby2/visual-scene/
  rooms/
    homeroom.depth.json
    science-lab.depth.json
  generated/
    depth/
      homeroom-depth.png
      homeroom-depth-bands.png
      homeroom-qa-overlay.png
      homeroom-occlusion-front-desks.png
      homeroom-sam-candidates/
```

Do not commit model checkpoints or large intermediate candidate masks by
default. Commit final room JSON and final approved masks; keep raw candidates as
regenerable artifacts unless they are needed for review.

## Proposed MVP Workflow

1. Select one room: `location-homeroom.jpg`.
2. Run Depth Anything V2 Small and save `depth.png`, `depth-bands.png`, and a
   depth histogram.
3. Run SAM 2.1 automatic masks, then filter to large masks in the lower and
   middle thirds of the image.
4. Optionally run GroundingDINO prompts for common school-room objects and pass
   boxes to SAM 2.1.
5. Generate a QA overlay with candidate masks and depth bands.
6. Human reviews in an annotation tool or simple local editor:
   - accepts or redraws foreground masks
   - draws walkable polygon
   - sets floor line
   - edits scale curve using two or three test standees
   - marks safe slots
7. Export `homeroom.depth.json` plus approved occlusion masks.
8. Load the JSON in the visual scene prototype and verify:
   - a student behind a desk is partially covered
   - a student in the back is smaller
   - a teacher on the side anchors correctly
   - active-speaker scale/focus does not break occlusion

## Recommendation

Build the Ruby High v2 room metadata pipeline as an offline asset tool, not as
runtime AI. The repo should consume authored JSON and approved PNG masks.

Use this stack:

1. Depth Anything V2 Small for relative depth candidates and QA.
2. SAM 2.1 for foreground/occluder mask proposals.
3. Optional GroundingDINO or Grounded SAM 2 for text-prompted object bootstrap
   after the first room proves the schema.
4. Human-authored walkable polygons, floor lines, scale curves, safe slots, and
   final occlusion semantics.

This gives Ruby High the King's Quest-style placement surface without pretending
that monocular depth or automatic segmentation can infer game blocking. The
right MVP is one hand-reviewed homeroom scene with visible occlusion and scale,
then repeat the same schema across science lab, library, cafeteria, greenhouse,
and courtyard.

