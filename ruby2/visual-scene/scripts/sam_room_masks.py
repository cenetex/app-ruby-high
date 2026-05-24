#!/usr/bin/env python3
"""Prompt SAM for Ruby High room foreground masks.

This is an offline asset-pipeline experiment. It does not run in the game.
The first fixture targets Homeroom foreground desks/plants so paper dolls can
stand behind scene objects.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import torch
from segment_anything import SamPredictor, sam_model_registry


DEFAULT_PROMPTS = {
    "homeroom": {
        "image": "assets/nft/grok-sources/location-homeroom.jpg",
        "model_type": "vit_b",
        "groups": [
            {
                "id": "front_left_desks",
                "points": [[120, 635], [270, 620], [420, 690]],
                "negatives": [[680, 360], [1120, 350]],
            },
            {
                "id": "front_center_desks",
                "points": [[535, 640], [650, 675], [795, 705]],
                "negatives": [[720, 360], [1150, 360]],
            },
            {
                "id": "front_right_desks",
                "points": [[1070, 625], [1220, 665], [1310, 715]],
                "negatives": [[730, 360], [370, 370]],
            },
            {
                "id": "left_window_plants",
                "points": [[155, 403], [230, 395]],
                "negatives": [[100, 210], [520, 690]],
            },
        ],
    }
}


def repo_root_from_script() -> Path:
    return Path(__file__).resolve().parents[3]


def load_image(path: Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(path)
    return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)


def write_rgba_foreground(image: np.ndarray, mask: np.ndarray, output_path: Path) -> None:
    rgba = np.zeros((image.shape[0], image.shape[1], 4), dtype=np.uint8)
    rgba[..., :3] = image
    rgba[..., 3] = (mask.astype(np.uint8) * 255)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output_path), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))


def write_mask(mask: np.ndarray, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output_path), mask.astype(np.uint8) * 255)


def write_overlay(image: np.ndarray, mask: np.ndarray, output_path: Path) -> None:
    overlay = image.copy()
    color = np.zeros_like(overlay)
    color[..., 0] = 255
    color[..., 1] = 40
    color[..., 2] = 160
    overlay = np.where(mask[..., None], (overlay * 0.55 + color * 0.45).astype(np.uint8), overlay)

    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(overlay, contours, -1, (255, 255, 255), 2)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output_path), cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR))


def predict_group(predictor: SamPredictor, group: dict) -> tuple[np.ndarray, float]:
    points = group.get("points", [])
    negatives = group.get("negatives", [])
    if not points:
        raise ValueError(f"group {group.get('id', '<unknown>')} has no points")

    coords = np.array(points + negatives, dtype=np.float32)
    labels = np.array(([1] * len(points)) + ([0] * len(negatives)), dtype=np.int32)
    masks, scores, _ = predictor.predict(
        point_coords=coords,
        point_labels=labels,
        multimask_output=True,
    )
    best = int(np.argmax(scores))
    return masks[best], float(scores[best])


def load_prompt_config(args: argparse.Namespace, root: Path) -> dict:
    if args.config:
        config_path = (root / args.config).resolve() if not Path(args.config).is_absolute() else Path(args.config)
        return json.loads(config_path.read_text())
    if args.room not in DEFAULT_PROMPTS:
        raise ValueError(f"no default prompt config for room {args.room}")
    return DEFAULT_PROMPTS[args.room]


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Ruby High room masks with Segment Anything")
    parser.add_argument("--room", default="homeroom")
    parser.add_argument("--config", help="Optional JSON prompt config path")
    parser.add_argument("--checkpoint", default="ruby2/visual-scene/checkpoints/sam_vit_b_01ec64.pth")
    parser.add_argument("--output-dir", default="ruby2/visual-scene/generated/masks")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "mps", "cuda"])
    args = parser.parse_args()

    root = repo_root_from_script()
    config = load_prompt_config(args, root)
    image_path = (root / config["image"]).resolve()
    checkpoint_path = (root / args.checkpoint).resolve()
    output_dir = (root / args.output_dir).resolve()
    room = args.room

    if args.device == "auto":
        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    else:
        device = args.device

    image = load_image(image_path)
    model_type = config.get("model_type", "vit_b")
    sam = sam_model_registry[model_type](checkpoint=str(checkpoint_path))
    sam.to(device=device)
    predictor = SamPredictor(sam)
    predictor.set_image(image)

    combined = np.zeros(image.shape[:2], dtype=bool)
    manifest = {
        "schema": "ruby-high.sam-mask-manifest.v1",
        "room": room,
        "image": str(image_path.relative_to(root)),
        "checkpoint": str(checkpoint_path.relative_to(root)),
        "device": device,
        "groups": [],
    }

    for group in config["groups"]:
        group_mask, score = predict_group(predictor, group)
        combined |= group_mask

        group_id = group["id"]
        mask_path = output_dir / f"{room}-{group_id}-mask.png"
        foreground_path = output_dir / f"{room}-{group_id}.png"
        overlay_path = output_dir / f"{room}-{group_id}-overlay.png"
        write_mask(group_mask, mask_path)
        write_rgba_foreground(image, group_mask, foreground_path)
        write_overlay(image, group_mask, overlay_path)
        manifest["groups"].append({
            "id": group_id,
            "score": score,
            "mask": str(mask_path.relative_to(root)),
            "foreground": str(foreground_path.relative_to(root)),
            "overlay": str(overlay_path.relative_to(root)),
        })

    write_mask(combined, output_dir / f"{room}-foreground-sam-mask.png")
    write_rgba_foreground(image, combined, output_dir / f"{room}-foreground-sam.png")
    write_overlay(image, combined, output_dir / f"{room}-foreground-sam-overlay.png")
    manifest["combined"] = {
        "mask": str((output_dir / f"{room}-foreground-sam-mask.png").relative_to(root)),
        "foreground": str((output_dir / f"{room}-foreground-sam.png").relative_to(root)),
        "overlay": str((output_dir / f"{room}-foreground-sam-overlay.png").relative_to(root)),
    }

    manifest_path = output_dir / f"{room}-sam-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
