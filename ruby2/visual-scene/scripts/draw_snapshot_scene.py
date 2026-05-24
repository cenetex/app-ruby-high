#!/usr/bin/env python3
"""Draw a Ruby High scene from the C UI snapshot JSON contract."""

from __future__ import annotations

import argparse
import json
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
OUT_DIR = ROOT / "ruby2" / "visual-scene" / "mockups"
W, H = 1600, 900

INK = (35, 31, 32, 255)
SOFT_INK = (75, 65, 60, 255)
PAPER = (255, 250, 240, 244)
RUBY = (210, 42, 42, 255)
BLUE = (62, 109, 168, 255)
WHITE = (255, 250, 240, 255)
BOARD = (47, 90, 63, 246)
BOARD_FRAME = (107, 63, 29, 255)
BOARD_FRAME_LIGHT = (138, 90, 48, 255)
CHALK = (244, 244, 240, 246)
CHALK_SOFT = (216, 229, 214, 220)
ACTION_COLORS = [
    (240, 146, 42, 246),
    (247, 211, 58, 246),
    (76, 181, 85, 246),
    (58, 163, 224, 246),
]

ROOM_BACKGROUNDS = {
    "hallway": "assets/nft/grok-sources/location-homeroom.jpg",
    "homeroom": "assets/nft/grok-sources/location-homeroom.jpg",
    "science_lab": "assets/nft/grok-sources/location-science-lab.jpg",
    "library": "assets/nft/grok-sources/location-library.jpg",
    "cafeteria": "assets/nft/grok-sources/location-cafeteria.jpg",
    "greenhouse": "assets/nft/grok-sources/location-greenhouse.jpg",
    "courtyard": "assets/nft/grok-sources/location-courtyard.jpg",
}

CHARACTER_ASSETS = {
    "ruby": "ruby2/visual-scene/generated/ruby-cutout.png",
    "lyra": "ruby2/visual-scene/generated/lyra-cutout.png",
    "mika": "ruby2/visual-scene/generated/mika-cutout.png",
    "ravi": "ruby2/visual-scene/generated/ravi-cutout.png",
    "indra": "ruby2/visual-scene/generated/indra-cutout.png",
    "noor": "ruby2/visual-scene/generated/noor-cutout.png",
    "sami": "ruby2/visual-scene/generated/sami-cutout.png",
}

REACTIONS = {
    "lyra": "stamp's still wet.",
    "ravi": "technically, evidence.",
    "mika": "you cooked. for real.",
    "noor": "trying too hard.",
    "sami": "respectfully, weird.",
    "indra": "it moved.",
}

BUBBLE_STYLES = {
    "lyra": ((255, 241, 247, 242), (209, 86, 133, 255)),
    "ravi": ((255, 247, 222, 242), (214, 126, 37, 255)),
    "mika": ((235, 253, 239, 242), (69, 174, 96, 255)),
    "noor": ((245, 240, 255, 242), (118, 91, 175, 255)),
    "sami": ((255, 241, 226, 242), (224, 117, 75, 255)),
    "indra": ((242, 244, 255, 242), (81, 101, 176, 255)),
    "sally": ((232, 251, 241, 242), (65, 145, 104, 255)),
    "professor-edward": ((240, 246, 255, 242), (73, 106, 162, 255)),
}

OBJECT_COPY = {
    "answer_card": ("ANSWER", "original", "class of 1998"),
    "wet_work_order": ("ORDER", "revised", "4:12 p.m."),
    "zero_dollar_receipt": ("RECEIPT", "$0.00", "same footer"),
    "notebook": ("NOTEBOOK", "margin", "open"),
}


def font(path: str | Path, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype(str(path), size)
    except OSError:
        return ImageFont.load_default()


F_TITLE = font(ROOT / "assets/fonts/schoolbell-regular.ttf", 46)
F_NAME = font(ROOT / "assets/fonts/schoolbell-regular.ttf", 44)
F_NOTE = font(ROOT / "assets/fonts/caveat-regular.ttf", 34)
F_BOARD = font(ROOT / "assets/fonts/crafty-girls-regular.ttf", 24)
F_BOARD_BIG = font(ROOT / "assets/fonts/crafty-girls-regular.ttf", 32)
F_BOARD_LABEL = font(ROOT / "assets/fonts/schoolbell-regular.ttf", 22)
F_UI = font("/System/Library/Fonts/Supplemental/Arial.ttf", 20)
F_UI_SMALL = font("/System/Library/Fonts/Supplemental/Arial.ttf", 15)
F_UI_BOLD = font("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 20)
F_BODY = font("/System/Library/Fonts/Supplemental/Arial.ttf", 32)
F_CHOICE = font("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 20)
F_REACT = font("/System/Library/Fonts/Supplemental/Arial.ttf", 15)


def cover_image(path: Path, size: tuple[int, int]) -> Image.Image:
    img = Image.open(path).convert("RGBA")
    ratio = img.width / img.height
    target_ratio = size[0] / size[1]
    if ratio > target_ratio:
        new_h = size[1]
        new_w = int(new_h * ratio)
    else:
        new_w = size[0]
        new_h = int(new_w / ratio)
    img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = (new_w - size[0]) // 2
    top = (new_h - size[1]) // 2
    return img.crop((left, top, left + size[0], top + size[1]))


def paste_contain(base: Image.Image, path: Path, box: tuple[int, int, int, int]) -> None:
    asset = Image.open(path).convert("RGBA")
    x, y, w, h = box
    asset.thumbnail((w, h), Image.Resampling.LANCZOS)
    base.alpha_composite(asset, (x + (w - asset.width) // 2, y + h - asset.height))


def draw_panel(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill=PAPER, outline=INK, radius=14, width=3) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    width: int,
    font_obj: ImageFont.ImageFont,
    fill=INK,
    line_gap: int = 6,
) -> int:
    x, y = xy
    avg = max(1, int(draw.textlength("abcdefghijklmnopqrstuvwxyz", font=font_obj) / 26))
    chars = max(10, width // avg)
    for line in textwrap.wrap(text, width=chars) or [""]:
        draw.text((x, y), line, fill=fill, font=font_obj)
        bbox = draw.textbbox((x, y), line or " ", font=font_obj)
        y += bbox[3] - bbox[1] + line_gap
    return y


def latest_event(snapshot: dict) -> dict | None:
    events = snapshot.get("events") or []
    return events[-1] if events else None


def latest_speakable_event(snapshot: dict) -> dict | None:
    for event in reversed(snapshot.get("events") or []):
        if event.get("performance") or event.get("characterId"):
            return event
    return latest_event(snapshot)


def choose_speaker(snapshot: dict) -> dict | None:
    event = latest_speakable_event(snapshot)
    people = snapshot.get("people") or []
    by_id = {person.get("id"): person for person in people}
    if event and event.get("performance", {}).get("speakerId") in by_id:
        return by_id[event["performance"]["speakerId"]]
    if event and event.get("characterId") in by_id:
        return by_id[event["characterId"]]
    if "ruby" in by_id:
        return by_id["ruby"]
    return people[0] if people else None


def main_line(snapshot: dict) -> str:
    event = latest_speakable_event(snapshot)
    if event and event.get("performance", {}).get("line"):
        return event["performance"]["line"]

    object_ids = {obj.get("id") for obj in snapshot.get("objects", [])}
    if snapshot.get("roomId") == "homeroom" and {"answer_card", "wet_work_order"} <= object_ids:
        return "The answer card says original. The wet stamp says revised. Before you answer, decide what can actually be trusted."
    if event:
        return event.get("text", "")
    return "The room waits for a real move."


def without_speaker_prefix(line: str, speaker_name: str | None) -> str:
    if not speaker_name:
        return line
    prefix = f"{speaker_name}: "
    return line[len(prefix):] if line.startswith(prefix) else line


def notebook_line(snapshot: dict) -> str:
    event = latest_event(snapshot)
    for candidate in reversed(snapshot.get("events") or []):
        if candidate.get("kind") == "notebook_updated":
            return candidate.get("text", "")
    object_names = ", ".join(obj.get("name", "") for obj in snapshot.get("objects", []))
    if object_names:
        return f"Room steady. Current evidence: {object_names}."
    return event.get("text", "Notebook margin clear.") if event else "Notebook margin clear."


def primary_actions(snapshot: dict) -> list[dict]:
    actions = snapshot.get("actions") or []
    approaches = [action for action in actions if action.get("kind") == "approach"]
    if approaches:
        discipline_order = {"source": 0, "sense": 1, "signal": 2, "sync": 3}
        return sorted(
            approaches,
            key=lambda action: discipline_order.get(str(action.get("disciplineId", "")).lower(), 99),
        )[:4]
    inspect = [action for action in actions if action.get("kind") == "inspect"]
    social = [action for action in actions if action.get("kind") == "talk"]
    chosen = inspect + social
    if len(chosen) >= 4:
        return chosen[:4]
    for action in actions:
        if action not in chosen:
            chosen.append(action)
        if len(chosen) == 4:
            break
    return chosen


def blackboard_lines(snapshot: dict) -> list[str]:
    object_ids = {obj.get("id") for obj in snapshot.get("objects", [])}
    clocks = snapshot.get("clocks", {})
    if snapshot.get("roomId") == "homeroom" and {"answer_card", "wet_work_order"} <= object_ids:
        return [
            "ANSWER CARD: original",
            "WORK ORDER: revised, wet",
            "BOARD QUESTION:",
            "What can be trusted?",
        ]
    if "zero_dollar_receipt" in object_ids and clocks.get("Null Signal", 0):
        return [
            "RECEIPT: $0.00",
            "FOOTER: copied exactly",
            "BOARD UPDATE:",
            "The pattern followed.",
        ]
    if "zero_dollar_receipt" in object_ids:
        return [
            "RECEIPT: $0.00",
            "FOOTER: same footer",
            "BOARD QUESTION:",
            "Who can verify it?",
        ]
    return [
        snapshot.get("room", "Room").upper(),
        "BOARD QUESTION:",
        "What is the next Ruby High move?",
    ]


def show_blackboard_focus(snapshot: dict) -> bool:
    return any(action.get("kind") == "approach" for action in primary_actions(snapshot))


def draw_focus_blackboard(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    snapshot: dict,
) -> None:
    frame = (430, 132, 1295, 380)
    inner = (450, 152, 1275, 360)
    draw.rounded_rectangle(frame, radius=13, fill=BOARD_FRAME, outline=(70, 35, 15, 255), width=3)
    draw.rounded_rectangle((frame[0] + 5, frame[1] + 5, frame[2] - 5, frame[3] - 5), radius=10, outline=BOARD_FRAME_LIGHT, width=4)
    draw.rounded_rectangle(inner, radius=7, fill=BOARD, outline=(24, 58, 39, 255), width=2)

    chalk_wash = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    wash = ImageDraw.Draw(chalk_wash)
    wash.ellipse((inner[0] + 30, inner[1] + 5, inner[0] + 470, inner[1] + 168), fill=(255, 255, 255, 13))
    wash.ellipse((inner[2] - 420, inner[1] + 48, inner[2] + 20, inner[3] + 82), fill=(255, 255, 255, 9))
    img.alpha_composite(chalk_wash)

    draw.text((478, 170), "Blackboard", fill=CHALK_SOFT, font=F_BOARD_LABEL)
    y = 204
    for line in blackboard_lines(snapshot):
        font_obj = F_BOARD_BIG if line.endswith(":") or line == "BOARD QUESTION:" or line == "BOARD UPDATE:" else F_BOARD
        draw.text((478, y), line, fill=CHALK, font=font_obj)
        y += 34 if font_obj is F_BOARD else 41

    draw.rounded_rectangle((1148, 314, 1248, 344), radius=15, fill=(255, 250, 240, 228), outline=(244, 244, 240, 86), width=1)
    draw.text((1198, 329), "Choices", fill=INK, font=F_UI_SMALL, anchor="mm")


def draw_speech_focus(
    draw: ImageDraw.ImageDraw,
    snapshot: dict,
    speaker: dict | None,
) -> None:
    bubble = (430, 132, 1295, 330)
    draw_panel(draw, bubble, fill=PAPER, outline=INK, radius=14, width=3)
    draw.polygon([(535, bubble[3]), (576, bubble[3]), (548, bubble[3] + 46)], fill=PAPER, outline=INK)
    speaker_name = speaker.get("name", "Ruby") if speaker else "Ruby"
    draw.text((bubble[0] + 38, bubble[1] + 32), speaker_name, fill=RUBY, font=F_NAME)
    draw_wrapped(
        draw,
        without_speaker_prefix(main_line(snapshot), speaker_name),
        (bubble[0] + 38, bubble[1] + 92),
        bubble[2] - bubble[0] - 76,
        F_BODY,
    )
    draw.rounded_rectangle((1174, 284, 1258, 316), radius=16, fill=(35, 31, 32, 210), outline=(255, 250, 240, 128), width=1)
    draw.text((1216, 300), "Next", fill=WHITE, font=F_UI_SMALL, anchor="mm")


def draw_notebook_strip(draw: ImageDraw.ImageDraw, snapshot: dict) -> None:
    draw_panel(draw, (34, 650, W - 34, 708), fill=(255, 250, 240, 238), outline=(35, 31, 32, 75), radius=7, width=2)
    draw.text((60, 683), "Notebook", fill=BLUE, font=F_NOTE)
    draw.text((218, 680), notebook_line(snapshot), fill=INK, font=F_UI)


def draw_action_tray(draw: ImageDraw.ImageDraw, actions: list[dict]) -> None:
    gap = 18
    x0 = 34
    y0 = 730
    bw = (W - 68 - gap * 3) // 4
    tile_h = 128
    for idx, action in enumerate(actions[:4]):
        x = x0 + idx * (bw + gap)
        yy = y0
        bg = ACTION_COLORS[idx % len(ACTION_COLORS)]
        text_color = WHITE if idx in (2, 3) else (26, 34, 56, 255)
        draw.rounded_rectangle((x, yy, x + bw, yy + tile_h), radius=13, fill=bg, outline=(20, 18, 18, 210), width=2)
        draw.rounded_rectangle((x + 3, yy + 3, x + bw - 3, yy + tile_h - 3), radius=10, outline=(255, 255, 255, 78), width=2)
        badge = (x + 18, yy + 24, x + 68, yy + 74)
        draw.ellipse(badge, fill=(255, 250, 240, 236), outline=(20, 18, 18, 86), width=2)
        draw.text((x + 43, yy + 49), str(idx + 1), fill=(26, 34, 56, 255), font=F_UI_BOLD, anchor="mm")
        draw_wrapped(draw, action.get("label", ""), (x + 84, yy + 22), bw - 104, F_CHOICE, text_color, line_gap=3)


def draw_reaction_bubble(
    draw: ImageDraw.ImageDraw,
    text: str,
    box: tuple[int, int, int, int],
    character_id: str,
    tail_side: str,
) -> None:
    fill, outline = BUBBLE_STYLES.get(character_id, ((255, 250, 240, 238), (35, 31, 32, 150)))
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(box, radius=19, fill=fill, outline=outline, width=3)
    if tail_side == "left":
        points = [(x0 + 13, y1 - 17), (x0 - 25, y1 + 7), (x0 + 34, y1 - 8)]
    else:
        points = [(x1 - 13, y1 - 17), (x1 + 25, y1 + 7), (x1 - 34, y1 - 8)]
    draw.polygon(points, fill=fill, outline=outline)
    draw_wrapped(draw, text, (x0 + 18, y0 + 14), x1 - x0 - 36, F_REACT, SOFT_INK, line_gap=0)


def draw_object_card(draw: ImageDraw.ImageDraw, object_id: str, box: tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = box
    title, main, sub = OBJECT_COPY.get(object_id, (object_id.upper(), "", ""))
    fill = (255, 250, 240, 232)
    if object_id == "wet_work_order":
        fill = (232, 242, 246, 232)
    elif object_id == "zero_dollar_receipt":
        fill = (245, 245, 236, 232)
    elif object_id == "notebook":
        fill = (230, 241, 238, 232)
    draw_panel(draw, box, fill=fill, outline=(35, 31, 32, 140), radius=9, width=2)
    draw.text((x0 + 8, y0 + 9), title, fill=RUBY if object_id != "notebook" else BLUE, font=F_UI_SMALL)
    draw.text((x0 + 8, y0 + 31), main, fill=INK, font=F_UI_BOLD)
    draw.text((x0 + 8, y0 + 58), sub, fill=SOFT_INK, font=F_UI_SMALL)


def draw_scene(snapshot: dict, out_path: Path) -> None:
    room_id = snapshot.get("roomId", "homeroom")
    bg_path = ROOT / ROOM_BACKGROUNDS.get(room_id, ROOM_BACKGROUNDS["homeroom"])
    img = Image.alpha_composite(cover_image(bg_path, (W, H)), Image.new("RGBA", (W, H), (20, 15, 12, 88)))
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 642, W, H), fill=(10, 8, 7, 112))

    draw_panel(draw, (34, 30, 420, 122), fill=(255, 250, 240, 218), outline=(35, 31, 32, 80), radius=10, width=2)
    draw.text((58, 47), snapshot.get("timeBlock", "").upper(), fill=RUBY, font=F_UI_BOLD)
    draw.text((58, 70), snapshot.get("room", "Room"), fill=INK, font=F_TITLE)

    sx = W - 42
    for label in [snapshot.get("timeBlock", ""), *[f"{k} {v}" for k, v in snapshot.get("clocks", {}).items() if v]]:
        if not label:
            continue
        tw = int(draw.textlength(label, font=F_UI_BOLD)) + 34
        draw_panel(draw, (sx - tw, 36, sx, 76), fill=(35, 31, 32, 158), outline=(255, 250, 240, 88), radius=20, width=1)
        draw.text((sx - tw + 17, 47), label, fill=WHITE, font=F_UI_BOLD)
        sx -= tw + 10

    speaker = choose_speaker(snapshot)
    people = snapshot.get("people") or []
    speaker_id = speaker.get("id") if speaker else None
    witnesses = [person for person in people if person.get("id") != speaker_id]
    if not speaker and people:
        speaker = people[0]
        speaker_id = speaker.get("id")
        witnesses = people[1:]

    if speaker:
        asset = CHARACTER_ASSETS.get(speaker_id)
        if asset:
            paste_contain(img, ROOT / asset, (58, 148, 340, 650))
        name_w = int(draw.textlength(speaker.get("name", "Speaker"), font=F_UI_BOLD)) + 48
        draw_panel(draw, (204 - name_w // 2, 670, 204 + name_w // 2, 713), fill=(255, 250, 240, 232), outline=(35, 31, 32, 80), radius=8, width=2)
        draw.text((204 - name_w // 2 + 24, 681), speaker.get("name", "Speaker"), fill=INK, font=F_UI_BOLD)

    if show_blackboard_focus(snapshot):
        draw_focus_blackboard(img, draw, snapshot)
    else:
        draw_speech_focus(draw, snapshot, speaker)

    witness_boxes = [(875, 366, 214, 322), (1260, 354, 216, 334)]
    for witness, box in zip(witnesses[:2], witness_boxes):
        asset = CHARACTER_ASSETS.get(witness.get("id"))
        if asset:
            paste_contain(img, ROOT / asset, box)

    reaction_boxes = [
        ((1010, 414, 1252, 468), "left"),
        ((1066, 494, 1308, 548), "right"),
    ]
    for witness, (bubble_box, tail_side) in zip(witnesses[:2], reaction_boxes):
        draw_reaction_bubble(
            draw,
            REACTIONS.get(witness.get("id"), witness.get("name", "present")),
            bubble_box,
            witness.get("id", ""),
            tail_side,
        )

    rail_x = 1478
    objects = snapshot.get("objects") or []
    draw_panel(draw, (rail_x - 10, 206, rail_x + 100, 206 + max(1, len(objects)) * 92 + 16), fill=(255, 250, 240, 112), outline=(255, 250, 240, 82), radius=20, width=1)
    for idx, obj in enumerate(objects[:4]):
        draw_object_card(draw, obj.get("id", "object"), (rail_x, 224 + idx * 92, rail_x + 88, 302 + idx * 92))

    actions = primary_actions(snapshot)
    draw_notebook_strip(draw, snapshot)
    draw_action_tray(draw, actions)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out_path, quality=93)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--out", type=Path, default=OUT_DIR / "snapshot-scene.png")
    args = parser.parse_args()

    snapshot = json.loads(args.snapshot.read_text())
    draw_scene(snapshot, args.out)
    print(args.out)


if __name__ == "__main__":
    main()
