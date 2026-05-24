#!/usr/bin/env python3
"""Draw static Ruby High dialogue mockups from scene-layout.json."""

from __future__ import annotations

import json
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
SCENE_DIR = ROOT / "ruby2" / "visual-scene"
LAYOUT_PATH = SCENE_DIR / "scene-layout.json"
OUT_DIR = SCENE_DIR / "mockups"

W, H = 1600, 900

INK = (35, 31, 32, 255)
SOFT_INK = (74, 64, 59, 255)
PAPER = (255, 250, 240, 245)
PAPER_SOFT = (248, 238, 219, 236)
RUBY = (210, 42, 42, 255)
BLUE = (62, 109, 168, 255)
GOLD = (228, 183, 79, 255)
WHITE = (255, 250, 240, 255)


def font(path: str | Path, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
      return ImageFont.truetype(str(path), size)
    except OSError:
      return ImageFont.load_default()


F_TITLE = font(ROOT / "assets/fonts/schoolbell-regular.ttf", 46)
F_NAME = font(ROOT / "assets/fonts/schoolbell-regular.ttf", 44)
F_NOTE = font(ROOT / "assets/fonts/caveat-regular.ttf", 34)
F_UI = font("/System/Library/Fonts/Supplemental/Arial.ttf", 20)
F_UI_SMALL = font("/System/Library/Fonts/Supplemental/Arial.ttf", 16)
F_UI_BOLD = font("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 20)
F_BODY = font("/System/Library/Fonts/Supplemental/Arial.ttf", 32)
F_BODY_SMALL = font("/System/Library/Fonts/Supplemental/Arial.ttf", 26)
F_CHOICE = font("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 20)
F_REACT = font("/System/Library/Fonts/Supplemental/Arial.ttf", 15)

REACTION_COPY = {
    "lyra": "stamp's still wet.",
    "ravi": "technically, evidence.",
    "sami": "three versions. neat.",
    "noor": "popular is not true.",
    "indra": "it moved.",
    "sally": "test the change.",
}


def resolve_asset(scene_relative_path: str) -> Path:
    return (SCENE_DIR / scene_relative_path).resolve()


def cover_image(path: Path, size: tuple[int, int]) -> Image.Image:
    img = Image.open(path).convert("RGBA")
    img_ratio = img.width / img.height
    target_ratio = size[0] / size[1]
    if img_ratio > target_ratio:
        new_h = size[1]
        new_w = int(new_h * img_ratio)
    else:
        new_w = size[0]
        new_h = int(new_w / img_ratio)
    img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = (new_w - size[0]) // 2
    top = (new_h - size[1]) // 2
    return img.crop((left, top, left + size[0], top + size[1]))


def paste_contain(base: Image.Image, path: Path, box: tuple[int, int, int, int], bottom: bool = True) -> None:
    asset = Image.open(path).convert("RGBA")
    x, y, w, h = box
    asset.thumbnail((w, h), Image.Resampling.LANCZOS)
    px = x + (w - asset.width) // 2
    py = y + (h - asset.height if bottom else 0)
    base.alpha_composite(asset, (px, py))


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    width: int,
    font_obj: ImageFont.ImageFont,
    fill: tuple[int, int, int, int],
    line_gap: int = 7,
) -> int:
    x, y = xy
    avg = max(1, int(draw.textlength("abcdefghijklmnopqrstuvwxyz", font=font_obj) / 26))
    chars = max(12, width // avg)
    lines: list[str] = []
    for paragraph in text.split("\n"):
        lines.extend(textwrap.wrap(paragraph, width=chars) or [""])
    for line in lines:
        draw.text((x, y), line, font=font_obj, fill=fill)
        bbox = draw.textbbox((x, y), line or " ", font=font_obj)
        y += bbox[3] - bbox[1] + line_gap
    return y


def draw_panel(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill=PAPER, outline=INK, radius=14, width=3) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def reaction_text(witness: dict) -> str:
    return REACTION_COPY.get(witness.get("id"), witness.get("read", "present"))


def draw_reaction_bubble(
    draw: ImageDraw.ImageDraw,
    text: str,
    box: tuple[int, int, int, int],
    tail_point: tuple[int, int],
) -> None:
    x0, y0, x1, y1 = box
    fill = (255, 250, 240, 228)
    outline = (35, 31, 32, 126)
    draw_panel(draw, box, fill=fill, outline=outline, radius=18, width=2)

    if tail_point[0] < x0:
        anchor = (x0, (y0 + y1) // 2)
        tail = [(anchor[0], anchor[1] - 9), (anchor[0], anchor[1] + 9), tail_point]
    else:
        anchor = (x1, (y0 + y1) // 2)
        tail = [(anchor[0], anchor[1] - 9), (anchor[0], anchor[1] + 9), tail_point]

    draw.polygon(tail, fill=fill, outline=outline)
    draw_wrapped(draw, text, (x0 + 14, y0 + 14), x1 - x0 - 28, F_REACT, SOFT_INK, line_gap=0)


def draw_scene(scene: dict, out_path: Path) -> None:
    bg = cover_image(resolve_asset(scene["background"]["src"]), (W, H))
    img = Image.alpha_composite(bg, Image.new("RGBA", (W, H), (20, 15, 12, 88)))
    draw = ImageDraw.Draw(img)

    # Quiet lower reading band and mild side vignettes.
    draw.rectangle((0, 666, W, H), fill=(10, 8, 7, 98))
    draw.rectangle((0, 0, W, H), outline=(255, 255, 255, 38), width=2)

    # Top location/status.
    draw_panel(draw, (34, 30, 420, 122), fill=(255, 250, 240, 218), outline=(35, 31, 32, 80), radius=10, width=2)
    draw.text((58, 47), scene["kicker"].upper(), fill=RUBY, font=F_UI_BOLD)
    draw.text((58, 70), scene["title"], fill=INK, font=F_TITLE)

    sx = W - 42
    for status in reversed(scene.get("status", [])):
        tw = int(draw.textlength(status, font=F_UI_BOLD)) + 34
        draw_panel(draw, (sx - tw, 36, sx, 76), fill=(35, 31, 32, 158), outline=(255, 250, 240, 88), radius=20, width=1)
        draw.text((sx - tw + 17, 47), status, fill=WHITE, font=F_UI_BOLD)
        sx -= tw + 10

    speaker = scene["cast"]["speaker"]
    side = speaker.get("side", "left")
    if side == "left":
        speaker_box = (58, 148, 340, 650)
        bubble = (430, 132, 1295, 330)
        tail = [(535, 342), (576, 342), (548, 388)]
        witness_boxes = [(875, 366, 214, 322), (1260, 354, 216, 334)]
        react_bubbles = [
            (1084, 436, 1266, 486, 1052, 516),
            (1084, 494, 1266, 544, 1300, 522),
        ]
        item_x = 1498
    else:
        speaker_box = (1210, 148, 330, 650)
        bubble = (300, 132, 1165, 330)
        tail = [(1048, 330), (1089, 330), (1072, 376)]
        witness_boxes = [(135, 366, 214, 322), (560, 354, 206, 334)]
        react_bubbles = [
            (366, 436, 550, 486, 336, 516),
            (366, 494, 550, 544, 592, 522),
        ]
        item_x = 34

    paste_contain(img, resolve_asset(speaker["src"]), speaker_box)
    name_w = int(draw.textlength(speaker["name"], font=F_UI_BOLD)) + 48
    name_cx = speaker_box[0] + speaker_box[2] // 2
    draw_panel(draw, (name_cx - name_w // 2, 670, name_cx + name_w // 2, 713), fill=(255, 250, 240, 232), outline=(35, 31, 32, 80), radius=8, width=2)
    draw.text((name_cx - name_w // 2 + 24, 681), speaker["name"], fill=INK, font=F_UI_BOLD)

    # Speech bubble.
    draw_panel(draw, bubble, fill=PAPER, outline=INK, radius=14, width=3)
    if side == "left":
        draw.polygon([(535, bubble[3]), (576, bubble[3]), (548, bubble[3] + 46)], fill=PAPER, outline=INK)
    else:
        draw.polygon(tail, fill=PAPER, outline=INK)
    draw.text((bubble[0] + 38, bubble[1] + 32), scene["speech"]["speaker"], fill=RUBY, font=F_NAME)
    draw_wrapped(draw, scene["speech"]["text"], (bubble[0] + 38, bubble[1] + 92), bubble[2] - bubble[0] - 76, F_BODY, INK, line_gap=4)

    # Witnesses stay in the room as standalone bodies.
    for i, witness in enumerate(scene["cast"].get("witnesses", [])):
        box = witness_boxes[i] if i < len(witness_boxes) else witness_boxes[-1]
        paste_contain(img, resolve_asset(witness["src"]), box)

    # Item side rail.
    rail_box = (item_x - 8, 224, item_x + 70, 466)
    draw_panel(draw, rail_box, fill=(255, 250, 240, 112), outline=(255, 250, 240, 82), radius=20, width=1)
    for i, item in enumerate(scene.get("itemSlots", [])):
        x = item_x
        y = 244 + i * 92
        paste_contain(img, resolve_asset(item["src"]), (x, y, 54 if not item.get("active") else 62, 68 if not item.get("active") else 76))
        label = item["label"]
        tw = int(draw.textlength(label, font=F_UI_SMALL)) + 18
        cx = x + 31
        draw_panel(draw, (cx - tw // 2, y + 63, cx + tw // 2, y + 86), fill=(255, 250, 240, 224), outline=(35, 31, 32, 65), radius=8, width=1)
        draw.text((cx - tw // 2 + 9, y + 66), label, fill=INK, font=F_UI_SMALL)

    # Tiny reaction bubbles, stacked like a local room chat between witnesses.
    for i, witness in enumerate(scene["cast"].get("witnesses", [])):
        if i < len(react_bubbles):
            bx0, by0, bx1, by1, tx, ty = react_bubbles[i]
        else:
            x, y, w, h = witness_boxes[i] if i < len(witness_boxes) else witness_boxes[-1]
            bx0, by0, bx1, by1 = x + w, y + h // 2, x + w + 190, y + h // 2 + 50
            tx, ty = x + w - 20, y + h // 2 + 24
        draw_reaction_bubble(draw, reaction_text(witness), (bx0, by0, bx1, by1), (tx, ty))

    # Notebook strip.
    draw_panel(draw, (34, 650, W - 34, 708), fill=(255, 250, 240, 238), outline=(35, 31, 32, 75), radius=7, width=2)
    draw.text((60, 683), "Notebook", fill=BLUE, font=F_NOTE)
    draw.text((218, 680), scene["notebookLine"], fill=INK, font=F_UI)

    # Multiple-choice action tray.
    actions = scene.get("actions", [])
    gap = 18
    x0 = 34
    y0 = 730
    bw = (W - 68 - gap * 3) // 4
    for i, action in enumerate(actions):
        x = x0 + i * (bw + gap)
        box = (x, y0, x + bw, 858)
        draw_panel(draw, box, fill=(255, 250, 240, 238), outline=INK, radius=10, width=2)
        draw.text((x + 22, y0 + 22), str(i + 1), fill=RUBY, font=F_UI_BOLD)
        draw_wrapped(draw, action, (x + 56, y0 + 20), bw - 74, F_CHOICE, INK, line_gap=4)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out_path, quality=93)


def make_contact_sheet(paths: list[Path], out_path: Path) -> None:
    thumb_w, thumb_h = 760, 428
    gutter = 24
    sheet = Image.new("RGB", (thumb_w, thumb_h * len(paths) + gutter * (len(paths) + 1)), (23, 21, 20))
    y = gutter
    for path in paths:
        img = Image.open(path).convert("RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        sheet.paste(img, (gutter, y))
        y += thumb_h + gutter
    sheet.save(out_path, quality=92)


def main() -> None:
    layout = json.loads(LAYOUT_PATH.read_text())
    paths: list[Path] = []
    for scene in layout["scenes"]:
        out = OUT_DIR / f"{scene['id']}-dialogue.png"
        draw_scene(scene, out)
        paths.append(out)
    make_contact_sheet(paths, OUT_DIR / "dialogue-contact-sheet.png")
    print("\n".join(str(path) for path in paths))
    print(OUT_DIR / "dialogue-contact-sheet.png")


if __name__ == "__main__":
    main()
