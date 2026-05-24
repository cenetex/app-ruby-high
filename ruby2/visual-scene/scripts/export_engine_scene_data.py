#!/usr/bin/env python3
"""Export C UI snapshot JSON files as a file:// friendly browser data bundle."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def title_from_path(path: Path) -> str:
    return path.stem.replace("-", " ").title()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshots", nargs="+", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    snapshots = []
    for path in args.snapshots:
        snapshot = json.loads(path.read_text(encoding="utf-8"))
        snapshot["sceneId"] = path.stem
        snapshot["sceneTitle"] = title_from_path(path)
        snapshots.append(snapshot)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(snapshots, indent=2, ensure_ascii=True)
    args.out.write_text(
        "window.RUBY2_ENGINE_SNAPSHOTS = "
        + payload
        + ";\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
