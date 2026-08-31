#!/usr/bin/env python3
"""Regression checks for the authored three-tier sprite catalogue."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = REPO_ROOT / "src/render/sprites/assets"
ZX_RGBA = {
    "C.BLACK": (0x00, 0x00, 0x00, 0xFF),
    "C.BLUE": (0x00, 0x00, 0xCD, 0xFF),
    "C.RED": (0xCD, 0x00, 0x00, 0xFF),
    "C.MAGENTA": (0xCD, 0x00, 0xCD, 0xFF),
    "C.GREEN": (0x00, 0xCD, 0x00, 0xFF),
    "C.CYAN": (0x00, 0xCD, 0xCD, 0xFF),
    "C.YELLOW": (0xCD, 0xCD, 0x00, 0xFF),
    "C.WHITE": (0xCD, 0xCD, 0xCD, 0xFF),
    "C.B_BLACK": (0x00, 0x00, 0x00, 0xFF),
    "C.B_BLUE": (0x00, 0x00, 0xFF, 0xFF),
    "C.B_RED": (0xFF, 0x00, 0x00, 0xFF),
    "C.B_MAGENTA": (0xFF, 0x00, 0xFF, 0xFF),
    "C.B_GREEN": (0x00, 0xFF, 0x00, 0xFF),
    "C.B_CYAN": (0x00, 0xFF, 0xFF, 0xFF),
    "C.B_YELLOW": (0xFF, 0xFF, 0x00, 0xFF),
    "C.B_WHITE": (0xFF, 0xFF, 0xFF, 0xFF),
}
ZX_COLOURS = set(ZX_RGBA)
TRANSPARENT = (0x00, 0x00, 0x00, 0x00)


def load_catalogue() -> list[tuple[dict[str, object], dict[str, object]]]:
    manifest = json.loads((ASSET_ROOT / "manifest.json").read_text(encoding="utf-8"))
    return [
        (
            entry,
            json.loads((ASSET_ROOT / entry["files"]["json"]).read_text(encoding="utf-8")),
        )
        for entry in manifest["sprites"]
    ]


def used_colours(sprite: dict[str, object]) -> set[str]:
    rows = sprite["rows"]
    legend = sprite["legend"]
    return {legend[char] for row in rows for char in row if char != "."}


def local_cell_colour_counts(sprite: dict[str, object]) -> list[int]:
    width = sprite["w"]
    height = sprite["h"]
    rows = sprite["rows"]
    legend = sprite["legend"]
    counts: list[int] = []
    for y0 in range(0, height, 8):
        for x0 in range(0, width, 8):
            colours = {
                legend[rows[y][x]]
                for y in range(y0, min(y0 + 8, height))
                for x in range(x0, min(x0 + 8, width))
                if rows[y][x] != "."
            }
            counts.append(len(colours))
    return counts


def images_equal(left: Image.Image, right: Image.Image) -> bool:
    """Exact pixel equality, including RGB channels when alpha is unchanged."""
    return (
        left.mode == right.mode
        and left.size == right.size
        and left.tobytes() == right.tobytes()
    )


def render_sprite(sprite: dict[str, object]) -> Image.Image:
    """Rebuild the canonical native preview from JSON alone."""
    width = sprite["w"]
    height = sprite["h"]
    rows = sprite["rows"]
    legend = sprite["legend"]
    image = Image.new("RGBA", (width, height), TRANSPARENT)
    pixels = image.load()
    for y, row in enumerate(rows):
        for x, char in enumerate(row):
            if char != ".":
                pixels[x, y] = ZX_RGBA[legend[char]]
    return image


class LodSpriteCatalogueTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.catalogue = load_catalogue()

    def test_catalogue_has_expected_families_and_unique_names(self) -> None:
        entries = [entry for entry, _ in self.catalogue]
        self.assertEqual(len(entries), 33)
        self.assertEqual(len({entry["name"] for entry in entries}), 33)
        self.assertEqual(sum(entry["family"] == "traffic" for entry in entries), 18)
        self.assertEqual(sum(entry["family"] == "roadside" for entry in entries), 15)

    def test_grids_use_only_exact_zx_palette_symbols(self) -> None:
        for entry, sprite in self.catalogue:
            with self.subTest(sprite=entry["name"]):
                width = entry["w"]
                height = entry["h"]
                rows = sprite["rows"]
                legend = sprite["legend"]
                self.assertEqual((sprite["w"], sprite["h"]), (width, height))
                self.assertEqual(len(rows), height)
                self.assertTrue(all(len(row) == width for row in rows))
                self.assertTrue(all(char == "." or char in legend for row in rows for char in row))
                self.assertTrue(set(legend.values()).issubset(ZX_COLOURS))

    def test_mid_and_near_art_uses_a_richer_palette(self) -> None:
        for entry, sprite in self.catalogue:
            if entry["lod"] == "far":
                continue
            minimum = 5 if entry["family"] == "traffic" else 3
            if entry["family"] == "roadside" and entry["lod"] == "near":
                minimum = 4
            with self.subTest(sprite=entry["name"]):
                self.assertGreaterEqual(len(used_colours(sprite)), minimum)

    def test_detail_lods_are_not_flattened_to_two_colours_per_cell(self) -> None:
        for entry, sprite in self.catalogue:
            needs_rich_cell = (
                entry["family"] == "traffic" and entry["lod"] in {"mid", "near"}
            ) or (
                entry["family"] == "roadside" and entry["lod"] == "near"
            )
            if not needs_rich_cell:
                continue
            with self.subTest(sprite=entry["name"]):
                self.assertGreaterEqual(max(local_cell_colour_counts(sprite)), 3)

    def test_exact_image_comparison_detects_rgb_change_with_same_alpha(self) -> None:
        red = Image.new("RGBA", (1, 1), (255, 0, 0, 255))
        green = Image.new("RGBA", (1, 1), (0, 255, 0, 255))
        self.assertFalse(images_equal(red, green))

    def test_json_renderer_preserves_palette_and_transparency(self) -> None:
        sprite = {
            "w": 2,
            "h": 1,
            "rows": ["R."],
            "legend": {"R": "C.B_RED"},
        }
        rendered = render_sprite(sprite)
        self.assertEqual(
            list(rendered.getdata()),
            [(255, 0, 0, 255), (0, 0, 0, 0)],
        )

    def test_png_exports_match_rows_json_and_exact_nearest_neighbour_pixels(self) -> None:
        for entry, sprite in self.catalogue:
            with self.subTest(sprite=entry["name"]):
                width = entry["w"]
                height = entry["h"]
                rows = (ASSET_ROOT / entry["files"]["rows"]).read_text(
                    encoding="utf-8"
                ).splitlines()
                native = Image.open(ASSET_ROOT / entry["files"]["native"]).convert("RGBA")
                preview = Image.open(ASSET_ROOT / entry["files"]["preview4x"]).convert("RGBA")
                expected_native = render_sprite(sprite)
                self.assertEqual(native.size, (width, height))
                self.assertEqual(preview.size, (width * 4, height * 4))
                self.assertEqual(rows, sprite["rows"])
                self.assertTrue(images_equal(native, expected_native))
                expected_preview = expected_native.resize(
                    preview.size, Image.Resampling.NEAREST
                )
                self.assertTrue(images_equal(preview, expected_preview))


if __name__ == "__main__":
    unittest.main(verbosity=2)
