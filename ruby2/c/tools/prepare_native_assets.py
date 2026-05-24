#!/usr/bin/env python3
"""Prepare BMP assets for the dependency-light SDL2 native Ruby2 slice.

SDL2 core loads BMP without SDL_image. This script converts the existing Ruby
High JPG/PNG art into BMP files the C prototype can load directly. Character
cutouts are keyed against magenta so the C renderer can use SDL color-key
transparency without depending on PNG alpha support.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "ruby2" / "c" / "native-assets"
MAGENTA = (255, 0, 255)
STAGE = (1600, 900)

BACKGROUNDS = {
    "location-hallway.bmp": ROOT / "assets" / "nft" / "grok-sources" / "location-hallway.png",
    "location-homeroom.bmp": ROOT / "assets" / "nft" / "grok-sources" / "location-homeroom.jpg",
    "location-cafeteria.bmp": ROOT / "assets" / "nft" / "grok-sources" / "location-cafeteria.jpg",
    "location-science-lab.bmp": ROOT / "assets" / "nft" / "grok-sources" / "location-science-lab.jpg",
    "location-library.bmp": ROOT / "assets" / "nft" / "grok-sources" / "location-library.jpg",
    "location-greenhouse.bmp": ROOT / "assets" / "nft" / "grok-sources" / "location-greenhouse.jpg",
    "location-courtyard.bmp": ROOT / "assets" / "nft" / "grok-sources" / "location-courtyard.jpg",
}

CHARACTERS = {
    "ruby.bmp": ROOT / "ruby2" / "visual-scene" / "generated" / "ruby-cutout.png",
    "lyra.bmp": ROOT / "ruby2" / "visual-scene" / "generated" / "lyra-cutout.png",
    "ravi.bmp": ROOT / "ruby2" / "visual-scene" / "generated" / "ravi-cutout.png",
    "mika.bmp": ROOT / "ruby2" / "visual-scene" / "generated" / "mika-cutout.png",
    "noor.bmp": ROOT / "ruby2" / "visual-scene" / "generated" / "noor-cutout.png",
    "sami.bmp": ROOT / "ruby2" / "visual-scene" / "generated" / "sami-cutout.png",
    "indra.bmp": ROOT / "ruby2" / "visual-scene" / "generated" / "indra-cutout.png",
}

ITEMS = {
    "item-notebook.bmp": ROOT / "assets" / "nft" / "grok-sources" / "item-notebook.jpg",
    "item-flashcards.bmp": ROOT / "assets" / "nft" / "grok-sources" / "item-flashcards.jpg",
    "item-office-pass.bmp": ROOT / "assets" / "nft" / "grok-sources" / "item-hall-pass.jpg",
    "item-library-card.bmp": ROOT / "assets" / "nft" / "grok-sources" / "item-library-card.jpg",
    "item-lab-flask.bmp": ROOT / "assets" / "nft" / "grok-sources" / "item-lab-flask.jpg",
    "item-lunch-tray.bmp": ROOT / "assets" / "nft" / "grok-sources" / "item-lunch-tray.jpg",
}


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    ratio = image.width / image.height
    target_ratio = size[0] / size[1]
    if ratio > target_ratio:
        new_h = size[1]
        new_w = int(new_h * ratio)
    else:
        new_w = size[0]
        new_h = int(new_w / ratio)
    image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = (new_w - size[0]) // 2
    top = (new_h - size[1]) // 2
    return image.crop((left, top, left + size[0], top + size[1]))


def save_background(src: Path, dest: Path) -> None:
    image = cover(Image.open(src).convert("RGB"), STAGE)
    image.save(dest)


def save_keyed_cutout(src: Path, dest: Path) -> None:
    image = Image.open(src).convert("RGBA")
    keyed = Image.new("RGBA", image.size, MAGENTA + (255,))
    keyed.alpha_composite(image)
    keyed.convert("RGB").save(dest)

def save_item_icon(src: Path, dest: Path) -> None:
    image = cover(Image.open(src).convert("RGB"), (192, 192))
    image.save(dest)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, src in BACKGROUNDS.items():
        save_background(src, OUT / name)
    for name, src in CHARACTERS.items():
        save_keyed_cutout(src, OUT / name)
    for name, src in ITEMS.items():
        save_item_icon(src, OUT / name)
    print(f"wrote native BMP assets to {OUT}")


if __name__ == "__main__":
    main()
