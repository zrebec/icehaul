#!/usr/bin/env python3
"""Author and validate the three-tier Ice Haul ZX sprite catalogue.

The artwork is code-native pixel construction: every plotted cell is an exact
ZX colour symbol or transparency.  It deliberately does not import, quantise,
resize, or trace an external image.  The official zx-spectrum-screen sprite
validator writes the JSON and both PNG previews for every final grid.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = REPO_ROOT / "src/render/sprites/assets"
DEFAULT_TOOL = Path("/Users/zrebec/.codex/skills/zx-spectrum-screen/scripts/zx_sprite.py")


class Grid:
    def __init__(self, width: int, height: int) -> None:
        self.w = width
        self.h = height
        self.pixels = [["." for _ in range(width)] for _ in range(height)]

    def put(self, x: int, y: int, char: str) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            self.pixels[y][x] = char

    def hline(self, y: int, x0: int, x1: int, char: str) -> None:
        for x in range(max(0, x0), min(self.w - 1, x1) + 1):
            self.put(x, y, char)

    def vline(self, x: int, y0: int, y1: int, char: str) -> None:
        for y in range(max(0, y0), min(self.h - 1, y1) + 1):
            self.put(x, y, char)

    def rect(self, x0: int, y0: int, x1: int, y1: int, char: str) -> None:
        for y in range(max(0, y0), min(self.h - 1, y1) + 1):
            self.hline(y, x0, x1, char)

    def line(self, x0: int, y0: int, x1: int, y1: int, char: str) -> None:
        dx = abs(x1 - x0)
        sx = 1 if x0 < x1 else -1
        dy = -abs(y1 - y0)
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            self.put(x0, y0, char)
            if x0 == x1 and y0 == y1:
                return
            twice = 2 * err
            if twice >= dy:
                err += dy
                x0 += sx
            if twice <= dx:
                err += dx
                y0 += sy

    def ellipse(self, cx: float, cy: float, rx: float, ry: float, char: str) -> None:
        if rx <= 0 or ry <= 0:
            return
        for y in range(max(0, math.floor(cy - ry)), min(self.h - 1, math.ceil(cy + ry)) + 1):
            for x in range(max(0, math.floor(cx - rx)), min(self.w - 1, math.ceil(cx + rx)) + 1):
                dx = (x - cx) / rx
                dy = (y - cy) / ry
                if dx * dx + dy * dy <= 1:
                    self.put(x, y, char)

    def recolour_ellipse(
        self,
        cx: float,
        cy: float,
        rx: float,
        ry: float,
        source: str,
        target: str,
    ) -> None:
        if rx <= 0 or ry <= 0:
            return
        for y in range(max(0, math.floor(cy - ry)), min(self.h - 1, math.ceil(cy + ry)) + 1):
            for x in range(max(0, math.floor(cx - rx)), min(self.w - 1, math.ceil(cx + rx)) + 1):
                dx = (x - cx) / rx
                dy = (y - cy) / ry
                if dx * dx + dy * dy <= 1 and self.pixels[y][x] == source:
                    self.put(x, y, target)

    def polygon(self, points: list[tuple[int, int]], char: str) -> None:
        min_y = max(0, min(y for _, y in points))
        max_y = min(self.h - 1, max(y for _, y in points))
        for y in range(min_y, max_y + 1):
            intersections: list[float] = []
            for index, (x1, y1) in enumerate(points):
                x2, y2 = points[(index + 1) % len(points)]
                if y1 == y2:
                    continue
                if min(y1, y2) <= y < max(y1, y2):
                    intersections.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
            intersections.sort()
            for index in range(0, len(intersections) - 1, 2):
                self.hline(y, math.ceil(intersections[index]), math.floor(intersections[index + 1]), char)

    def centred(self, y: int, width: int, char: str) -> tuple[int, int]:
        width = max(1, min(self.w, width))
        if (self.w - width) % 2:
            width = width - 1 if width > 1 else width + 1
        left = (self.w - width) // 2
        right = self.w - 1 - left
        self.hline(y, left, right, char)
        return left, right

    def rows(self) -> list[str]:
        return ["".join(row) for row in self.pixels]


@dataclass(frozen=True)
class Sprite:
    name: str
    family: str
    role: str
    lod: str
    width: int
    height: int
    rows: list[str]
    legend: dict[str, str]


VEHICLE_DIMS = {
    "mini": {"far": (7, 6), "mid": (14, 11), "near": (28, 22)},
    "car": {"far": (11, 8), "mid": (22, 15), "near": (44, 30)},
    "bus": {"far": (14, 9), "mid": (28, 18), "near": (56, 36)},
}

BODY_CHAR = {"mini": "G", "car": "B", "bus": "M"}
BODY_SHADE = {"mini": "g", "car": "b", "bus": "m"}

VEHICLE_LEGEND = {
    "K": "C.BLACK",
    "G": "C.B_GREEN",
    "g": "C.GREEN",
    "B": "C.B_BLUE",
    "b": "C.BLUE",
    "M": "C.B_MAGENTA",
    "m": "C.MAGENTA",
    "C": "C.B_CYAN",
    "c": "C.CYAN",
    "W": "C.B_WHITE",
    "w": "C.WHITE",
    "R": "C.RED",
    "Y": "C.B_YELLOW",
}


def parity_width(canvas_w: int, wanted: int) -> int:
    wanted = max(1, min(canvas_w, wanted))
    if (canvas_w - wanted) % 2:
        wanted += 1 if wanted < canvas_w else -1
    return max(1, wanted)


def body_bounds(row: list[str]) -> tuple[int, int] | None:
    solid = [index for index, char in enumerate(row) if char != "."]
    return (solid[0], solid[-1]) if solid else None


def bus_sprite(view: str, lod: str) -> Sprite:
    """A bus is a box, and sharing the car's tapering trapezoid is why it read as
    a wide saloon instead.

    The physical box is 28x18 and cannot change — it feeds lane fit, growth and
    collision — so the bus is half again wider than it is tall and height is not
    available as a cue. Everything here is a cue that survives that.

    1. **Vertical sides under a domed roof.** The taper is gone; only the top
       one to three rows are drawn in. This is the whole difference between a
       bus and a large car at this size, and see the note on the dome below for
       why it is not a flat top.
    2. **A window band, not a glasshouse.** A car's glass is a large share of
       its height; a bus rear face is mostly panel with a band under the roof.
       0.28 of the body going away, against the car's 0.40-plus.
    3. **Stacked corner lamps.** Buses and lorries carry their tail lights in a
       vertical cluster at each corner where a car carries a horizontal pair.
       The stack also downsamples better than a pair, because it presents the
       lamp colour on several rows of the outer edge at once — the same reason
       lamps sit in the outermost columns at all. Measured: cells that change
       when the brake comes on went from 8 to 24 at 15 m and 18 to 40 at 3 m,
       which is the framebuffer answer to a bus whose braking could only be read
       from its halo.
    4. **Wheels pushed well inboard.** A bus's rear axle sits a long way in from
       the corners and a car's does not.

    The front and rear are not one drawing with a recoloured strip. A coach seen
    head-on is mostly windscreen, so the front's glass runs to 0.40 of the body
    against the rear's 0.28, and the engine louvres belong to the back only.
    """
    width, height = VEHICLE_DIMS["bus"][lod]
    grid = Grid(width, height)
    body = BODY_CHAR["bus"]
    shade = BODY_SHADE["bus"]
    detail = {"far": 0, "mid": 1, "near": 2}[lod]

    wheel_y = height - 2
    bumper_y = height - 3
    top = 1
    rows = bumper_y - top + 1

    def band(fraction: float) -> int:
        return top + max(0, min(rows - 1, round(rows * fraction)))

    # ── 1. The box, under a domed roof ──
    #
    # The sides are vertical — that is the whole point — but a perfect rectangle
    # has edges at only two x positions, so as it grows every edge cell crosses
    # its coverage threshold at nearly the same scale and the far field freezes.
    # Measured: flat-topped, the bus held one drawing for 1.47 s against 0.92 s
    # for the trapezoid it replaced. A coach roof is domed anyway, and the dome
    # gives the silhouette two more edge positions to move through.
    grid.rect(0, top, width - 1, bumper_y, body)
    dome = max(1, round(width * 0.14))
    domed_rows = 1 + detail
    for index in range(domed_rows):
        inset = max(1, round(dome * (domed_rows - index) / domed_rows))
        for offset in range(inset):
            grid.put(offset, top + index, ".")
            grid.put(width - 1 - offset, top + index, ".")
    grid.centred(top, parity_width(width, width - 2 * dome), "W")

    # ── 2. The window band ──
    glass_top = top + 1
    glass_bottom = max(glass_top, band(0.28))
    if view == "front":
        # At far the two fractions round to the same row, so the windscreen has
        # to be forced one row deeper: without it the only thing separating an
        # oncoming bus from a receding one over 64% of its approach is the lamp
        # colour and a four-pixel mask.
        glass_bottom = max(glass_bottom + 1, band(0.40))
    pillar = max(1, round(width * 0.07))
    for y in range(glass_top, glass_bottom + 1):
        bounds = body_bounds(grid.pixels[y])
        if not bounds:
            continue
        left, right = bounds[0] + pillar, bounds[1] - pillar
        if left <= right:
            grid.hline(y, left, right, "C")
    if detail >= 1:
        deep = max(1, (glass_bottom - glass_top + 1) // 3)
        for y in range(glass_bottom - deep + 1, glass_bottom + 1):
            for x in range(width):
                if grid.pixels[y][x] == "C":
                    grid.put(x, y, "c")

    # ── 3. Structure below the glass ──
    if detail >= 1:
        # Belt line directly under the window, edge to edge but for one pixel.
        grid.hline(glass_bottom + 1, 1, width - 2, "K")
        # A darker lower panel so the flat face is two planes, not one slab.
        panel_top = band(0.46)
        for y in range(panel_top, bumper_y):
            grid.hline(y, 1, width - 2, shade)
    if detail >= 2 and view == "rear":
        # Rear engine louvres, low and centred: the one interior feature a coach
        # has that a car does not — and it belongs to the back of the vehicle
        # only, which is one more thing telling the two views apart.
        louvre_w = parity_width(width, max(2, round(width * 0.34)))
        left = (width - louvre_w) // 2
        for y in range(band(0.52), band(0.66) + 1, 2):
            grid.hline(y, left, width - 1 - left, "K")

    # ── 4. Stacked corner lamps ──
    lamp = "R" if view == "rear" else "Y"
    lamp_w = 1 if detail == 0 else 2 if detail == 1 else 4
    stack_h = 1 if detail == 0 else 3 if detail == 1 else 6
    lamp_top = band(0.72)
    lamp_bottom = min(bumper_y - 1, lamp_top + stack_h - 1)
    for y in range(lamp_top, lamp_bottom + 1):
        for offset in range(lamp_w):
            grid.put(offset, y, lamp)
            grid.put(width - 1 - offset, y, lamp)
        if detail >= 1:
            grid.put(lamp_w, y, "K")
            grid.put(width - 1 - lamp_w, y, "K")

    # ── 5. The face: a plate going away, a bumper mask coming at you ──
    face_y = min(bumper_y - 1, lamp_bottom + 1 if detail >= 1 else lamp_bottom)
    if view == "rear":
        plate_w = parity_width(width, max(2, round(width * 0.16)))
        left = (width - plate_w) // 2
        grid.hline(face_y, left, width - 1 - left, "W")
    else:
        mask_w = parity_width(width, max(2, round(width * 0.30)))
        left = (width - mask_w) // 2
        grid.hline(face_y, left, width - 1 - left, "K")
        if detail >= 2:
            grid.hline(face_y - 1, left + 1, width - 2 - left, "w")

    # ── 6. Bumper and wheels ──
    grid.hline(bumper_y, 0, width - 1, "K")
    if width > 6:
        inset = max(1, round(width * 0.08))
        grid.put(inset, bumper_y, "W")
        grid.put(width - 1 - inset, bumper_y, "W")

    wheel_inset = max(1, round(width * 0.22))
    wheel_w = max(1, round(width * 0.13))
    for x in range(wheel_inset, min(width, wheel_inset + wheel_w)):
        grid.put(x, wheel_y, "K")
        grid.put(width - 1 - x, wheel_y, "K")

    # Last row stays transparent: it is part of the ground anchor.
    return Sprite(f"bus-{view}-{lod}", "traffic", f"bus-{view}", lod,
                  width, height, grid.rows(), VEHICLE_LEGEND)


def vehicle_sprite(kind: str, view: str, lod: str) -> Sprite:
    if kind == "bus":
        return bus_sprite(view, lod)
    width, height = VEHICLE_DIMS[kind][lod]
    grid = Grid(width, height)
    body = BODY_CHAR[kind]
    shade = BODY_SHADE[kind]
    detail = {"far": 0, "mid": 1, "near": 2}[lod]
    wheel_y = height - 2
    bumper_y = height - 3
    top = 0 if height <= 6 else 1

    for y in range(top, bumper_y + 1):
        progress = (y - top) / max(1, bumper_y - top)
        if kind == "mini":
            ratio = 0.42 + 0.58 * min(1, progress * 1.45)
        elif kind == "car":
            ratio = 0.38 + 0.62 * min(1, progress * 1.30)
        else:
            ratio = 0.72 + 0.28 * min(1, progress * 2.0)
        row_width = parity_width(width, round(width * ratio))
        grid.centred(y, row_width, body)

    # Snow/roof highlight: a hard pixel band, never a blended edge.
    roof_width = parity_width(width, round(width * (0.40 if kind != "bus" else 0.70)))
    grid.centred(top, roof_width, "W")

    # Glass occupies a deliberately large region, because thin windows vanish first.
    glass_top = top + 1
    glass_bottom = max(glass_top, top + round((bumper_y - top) * (0.40 if kind != "bus" else 0.48)))
    for y in range(glass_top, min(glass_bottom, bumper_y - 1) + 1):
        bounds = body_bounds(grid.pixels[y])
        if not bounds:
            continue
        inset = 1 if detail == 0 else max(1, round(width * 0.09))
        left, right = bounds[0] + inset, bounds[1] - inset
        if left <= right:
            grid.hline(y, left, right, "C")

    # Mid and near get two glass planes. The normal cyan lower band gives the
    # windscreen depth without noise; the far tier keeps one unambiguous patch.
    if detail >= 1 and glass_bottom > glass_top:
        shadow_rows = 1 if detail == 1 else max(1, (glass_bottom - glass_top + 1) // 3)
        for y in range(glass_bottom - shadow_rows + 1, glass_bottom + 1):
            for x in range(width):
                if grid.pixels[y][x] == "C":
                    grid.put(x, y, "c")

    if detail >= 1 and glass_bottom >= glass_top:
        centre_left = (width - 1) // 2
        centre_right = width // 2
        grid.vline(centre_left, glass_top, glass_bottom, "K")
        grid.vline(centre_right, glass_top, glass_bottom, "K")

    if detail >= 2:
        # Pillars and waistline are the near-tier interior keylines.
        bounds = body_bounds(grid.pixels[glass_bottom])
        if bounds:
            grid.hline(glass_bottom + 1, bounds[0] + 1, bounds[1] - 1, "K")
        pillar_offset = max(2, round(width * 0.25))
        for x in {width // 2 - pillar_offset, width - 1 - (width // 2 - pillar_offset)}:
            grid.vline(x, glass_top, glass_bottom, "K")

        # Hard snow reflections in the upper glass corners. They remain exact
        # pixels and preserve bilateral symmetry.
        reflection_y = min(glass_bottom, glass_top + 1)
        reflection_bounds = body_bounds(grid.pixels[reflection_y])
        if reflection_bounds:
            reflection_w = max(1, round(width * 0.04))
            left = reflection_bounds[0] + max(2, round(width * 0.12))
            right = reflection_bounds[1] - max(2, round(width * 0.12))
            for offset in range(reflection_w):
                if grid.pixels[reflection_y][left + offset] in {"C", "c"}:
                    grid.put(left + offset, reflection_y, "W")
                if grid.pixels[reflection_y][right - offset] in {"C", "c"}:
                    grid.put(right - offset, reflection_y, "W")


    # A darker inset panel turns the body from one slab into two readable
    # planes. Mid receives a compact lower panel; near has enough pixels for a
    # broad panel with bright fenders left at both edges.
    if detail >= 1:
        shade_top = max(glass_bottom + 2, bumper_y - (2 if detail == 1 else max(4, height // 5)))
        shade_bottom = bumper_y - 1
        for y in range(shade_top, shade_bottom + 1):
            shade_bounds = body_bounds(grid.pixels[y])
            if not shade_bounds:
                continue
            inset = max(1, round(width * (0.13 if detail == 1 else 0.09)))
            for x in range(shade_bounds[0] + inset, shade_bounds[1] - inset + 1):
                if grid.pixels[y][x] == body:
                    grid.put(x, y, shade)

        if detail >= 2 and shade_top > glass_bottom + 1:
            shoulder_y = shade_top - 1
            shoulder_bounds = body_bounds(grid.pixels[shoulder_y])
            if shoulder_bounds:
                grid.hline(shoulder_y, shoulder_bounds[0] + 2, shoulder_bounds[1] - 2, "K")

    lamp_y = max(glass_bottom + 1, bumper_y - (3 if detail >= 2 else 2 if detail >= 1 else 1))
    bounds = body_bounds(grid.pixels[lamp_y])
    if bounds:
        lamp = "R" if view == "rear" else "Y"
        lamp_w = 1 if width < 20 else 2 if width < 48 else 3
        for offset in range(lamp_w):
            grid.put(bounds[0] + offset, lamp_y, lamp)
            grid.put(bounds[1] - offset, lamp_y, lamp)
        if detail >= 2:
            grid.put(bounds[0] + lamp_w, lamp_y, "K")
            grid.put(bounds[1] - lamp_w, lamp_y, "K")
            if lamp_y + 1 < bumper_y:
                for offset in range(lamp_w):
                    grid.put(bounds[0] + offset, lamp_y + 1, lamp)
                    grid.put(bounds[1] - offset, lamp_y + 1, lamp)

    # Direction-specific face. Rear has a plate and door line; front has a grille.
    face_y = min(bumper_y - 1, lamp_y + 1)
    face_bounds = body_bounds(grid.pixels[face_y])
    if face_bounds:
        centre = width // 2
        if view == "rear":
            plate_w = parity_width(width, max(2, round(width * 0.14)))
            left = (width - plate_w) // 2
            grid.hline(face_y, left, width - 1 - left, "W")
            if detail >= 2:
                seam_top = max(glass_bottom + 2, face_y - 3)
                grid.vline(centre - (0 if width % 2 else 1), seam_top, face_y - 1, "K")
                grid.vline(centre, seam_top, face_y - 1, "K")
        else:
            grille_w = parity_width(width, max(2, round(width * 0.32)))
            left = (width - grille_w) // 2
            grid.hline(face_y, left, width - 1 - left, "K")
            if detail >= 2 and face_y - 1 > glass_bottom:
                grid.hline(face_y - 1, left + 1, width - 2 - left, "w")

    if detail >= 1:
        # Wheel arches and sill make the body sit on its tyres. These are inside
        # the silhouette; the renderer's external outline remains separate.
        arch_y = bumper_y - 1
        arch_w = max(1, round(width * 0.13))
        arch_left = max(0, round(width * 0.08))
        grid.hline(arch_y, arch_left, min(width - 1, arch_left + arch_w), "K")
        grid.hline(arch_y, max(0, width - 1 - arch_left - arch_w), width - 1 - arch_left, "K")
        if detail >= 2 and arch_y - 1 > glass_bottom:
            grid.put(arch_left, arch_y - 1, shade)
            grid.put(width - 1 - arch_left, arch_y - 1, shade)

    if detail >= 2 and kind == "bus":
        belt_y = max(glass_bottom + 2, bumper_y - 7)
        belt_bounds = body_bounds(grid.pixels[belt_y])
        if belt_bounds:
            grid.hline(belt_y, belt_bounds[0] + 2, belt_bounds[1] - 2, "K")

    # Full-width bumper hangs above two separated wheel blocks.
    bounds = body_bounds(grid.pixels[bumper_y])
    if bounds:
        grid.hline(bumper_y, bounds[0], bounds[1], "K")
        inset = 1 if detail == 0 else max(1, round(width * 0.05))
        if bounds[1] - bounds[0] > 4:
            grid.hline(bumper_y, bounds[0] + inset, bounds[0] + inset, "W")
            grid.hline(bumper_y, bounds[1] - inset, bounds[1] - inset, "W")
        if detail == 0 and kind == "mini":
            # At 4x3 the uninterrupted seven-pixel bumper held one raster for
            # 2.03 s. A centre gap keeps the wheels visually separate and gives
            # fractional growth a real edge to move; measured worst hold 1.83 s.
            grid.put(width // 2, bumper_y, ".")

    wheel_w = max(1, round(width * (0.14 if kind != "bus" else 0.16)))
    wheel_left = max(0, round(width * 0.10))
    for x in range(wheel_left, min(width, wheel_left + wheel_w)):
        grid.put(x, wheel_y, "K")
        grid.put(width - 1 - x, wheel_y, "K")

    # Last row intentionally remains transparent: it is part of the ground anchor.
    name = f"{kind}-{view}-{lod}"
    return Sprite(name, "traffic", f"{kind}-{view}", lod, width, height, grid.rows(), VEHICLE_LEGEND)


ROADSIDE_DIMS = {
    "deciduous": {"far": (8, 12), "mid": (16, 24), "near": (32, 48)},
    "conifer": {"far": (8, 12), "mid": (16, 24), "near": (32, 48)},
    "rocks": {"far": (8, 5), "mid": (16, 10), "near": (32, 20)},
    "sign": {"far": (8, 12), "mid": (16, 24), "near": (24, 32)},
    "lamp": {"far": (3, 8), "mid": (5, 16), "near": (9, 32)},
}

ROADSIDE_LEGEND = {
    "K": "C.BLACK",
    "G": "C.B_GREEN",
    "g": "C.GREEN",
    "R": "C.RED",
    "C": "C.B_CYAN",
    "c": "C.CYAN",
    "Y": "C.B_YELLOW",
    "y": "C.YELLOW",
    "W": "C.B_WHITE",
    "w": "C.WHITE",
}


def deciduous_sprite(lod: str) -> Sprite:
    width, height = ROADSIDE_DIMS["deciduous"][lod]
    grid = Grid(width, height)
    detail = {"far": 0, "mid": 1, "near": 2}[lod]
    cx = (width - 1) / 2
    trunk_top = round(height * 0.46)
    trunk_bottom = height - 2
    trunk_half = max(0, round(width * 0.055))
    grid.rect(math.floor(cx) - trunk_half, trunk_top, math.ceil(cx) + trunk_half, trunk_bottom, "R")

    crown_specs = [
        (0.20, 0.31, 0.23, 0.18),
        (0.39, 0.17, 0.28, 0.18),
        (0.68, 0.24, 0.26, 0.20),
        (0.80, 0.39, 0.19, 0.16),
        (0.47, 0.40, 0.39, 0.18),
    ]
    for fx, fy, frx, fry in crown_specs:
        grid.ellipse(fx * (width - 1), fy * height, max(1, frx * width), max(1, fry * height), "G")

    # Normal green under-paint makes overlapping crown lobes visible. These
    # are broad shadow masses, not dithering, and the snow is applied over them.
    if detail >= 1:
        grid.recolour_ellipse(width * 0.27, height * 0.36, max(1, width * 0.18), max(1, height * 0.10), "G", "g")
        grid.recolour_ellipse(width * 0.69, height * 0.39, max(1, width * 0.20), max(1, height * 0.11), "G", "g")
        grid.recolour_ellipse(width * 0.47, height * 0.44, max(1, width * 0.23), max(1, height * 0.08), "G", "g")

    # Hard snow caps occupy only upper crown pixels.
    cap_limit = round(height * (0.32 if detail == 0 else 0.36))
    for y in range(0, min(height, cap_limit)):
        for x in range(width):
            if grid.pixels[y][x] == "G" and (y + (x // max(1, width // 8))) % 4 < 2:
                grid.pixels[y][x] = "W"

    # Cut a few deliberate bites out of the union so the crown never becomes a
    # circular lollipop. Coordinates scale from the near master down to all LODs.
    cuts = [(0.03, 0.26), (0.10, 0.43), (0.88, 0.19), (0.93, 0.39), (0.60, 0.02)]
    for fx, fy in cuts:
        x = min(width - 1, max(0, round(fx * (width - 1))))
        y = min(height - 1, max(0, round(fy * (height - 1))))
        grid.put(x, y, ".")
        if detail >= 2 and x + 1 < width:
            grid.put(x + 1, y, ".")

    if detail >= 1:
        grid.line(round(cx), trunk_top + 2, round(width * 0.18), round(height * 0.39), "R")
        grid.line(round(cx), trunk_top + 4, round(width * 0.82), round(height * 0.34), "R")
        grid.line(round(cx), trunk_top + 1, round(width * 0.68), round(height * 0.20), "R")
    if detail >= 2:
        for y in range(trunk_top + 3, trunk_bottom, 4):
            grid.put(math.floor(cx), y, "K")
        for x, y in [(5, 13), (11, 7), (20, 10), (26, 16), (8, 21), (23, 23)]:
            grid.put(x, y, "g")

    # Snow at ground, no continuous baseline that could look like a hitbox.
    grid.hline(height - 1, max(0, round(cx) - width // 5), min(width - 1, round(cx) + width // 5), "W")
    return Sprite(f"deciduous-{lod}", "roadside", "deciduous", lod, width, height, grid.rows(), ROADSIDE_LEGEND)


def conifer_sprite(lod: str) -> Sprite:
    width, height = ROADSIDE_DIMS["conifer"][lod]
    grid = Grid(width, height)
    detail = {"far": 0, "mid": 1, "near": 2}[lod]
    cx = (width - 1) / 2
    trunk_top = round(height * 0.52)
    grid.rect(math.floor(cx), trunk_top, math.ceil(cx), height - 2, "R")

    tiers = 3 if detail == 0 else 4 if detail == 1 else 5
    for tier in range(tiers):
        top = round(height * (0.03 + tier * 0.105))
        bottom = round(height * (0.35 + tier * 0.105))
        half = max(1, round(width * (0.15 + tier * 0.08)))
        grid.polygon([(round(cx), top), (round(cx) - half, bottom), (round(cx) + half, bottom)], "G")
        snow_y = min(height - 1, top + max(1, (bottom - top) // 3))
        snow_half = max(1, round(half * 0.60))
        grid.hline(snow_y, round(cx) - snow_half, round(cx) + snow_half, "W")
        if detail >= 1 and snow_y + 1 < bottom:
            grid.put(round(cx) - snow_half, snow_y + 1, "W")
            grid.put(round(cx) + snow_half, snow_y + 1, "W")

    # Darker branch undersides break up the large triangular green mass while
    # keeping the conifer's silhouette and tier rhythm intact.
    if detail >= 1:
        period = 4 if detail == 1 else 5
        thickness = 1 if detail == 1 else 2
        for y in range(round(height * 0.24), round(height * 0.78)):
            if y % period >= thickness:
                continue
            for x in range(width):
                if grid.pixels[y][x] == "G":
                    grid.put(x, y, "g")

    if detail >= 2:
        grid.vline(round(cx), round(height * 0.18), height - 5, "K")
        for y in range(round(height * 0.30), round(height * 0.76), 5):
            grid.put(round(cx) - 2, y, "g")
            grid.put(round(cx) + 2, y, "g")
    grid.hline(height - 1, max(0, round(cx) - width // 6), min(width - 1, round(cx) + width // 6), "W")
    return Sprite(f"conifer-{lod}", "roadside", "conifer", lod, width, height, grid.rows(), ROADSIDE_LEGEND)


def rocks_sprite(lod: str) -> Sprite:
    width, height = ROADSIDE_DIMS["rocks"][lod]
    grid = Grid(width, height)
    detail = {"far": 0, "mid": 1, "near": 2}[lod]
    rocks = [
        (0.22, 0.62, 0.23, 0.34),
        (0.52, 0.48, 0.25, 0.46),
        (0.79, 0.66, 0.20, 0.30),
    ]
    for index, (fx, fy, frx, fry) in enumerate(rocks):
        fill = "w" if index != 1 else "c"
        grid.ellipse(fx * (width - 1), fy * (height - 1), max(1, frx * width), max(1, fry * height), fill)
        cap_y = max(0, round((fy - fry * 0.55) * (height - 1)))
        cap_half = max(1, round(frx * width * 0.65))
        grid.hline(cap_y, round(fx * (width - 1)) - cap_half, round(fx * (width - 1)) + cap_half, "W")
    if detail >= 1:
        for x, y in [(3, height - 2), (width // 2, height // 2), (width - 4, height - 3)]:
            grid.put(x, y, "K")
    if detail >= 2:
        grid.line(width // 2 - 3, height // 2, width // 2 + 1, height - 3, "K")
        grid.line(width - 9, height // 2 + 2, width - 5, height - 2, "C")
    return Sprite(f"rocks-{lod}", "roadside", "rocks", lod, width, height, grid.rows(), ROADSIDE_LEGEND)


def sign_sprite(lod: str) -> Sprite:
    width, height = ROADSIDE_DIMS["sign"][lod]
    grid = Grid(width, height)
    detail = {"far": 0, "mid": 1, "near": 2}[lod]
    cx = width // 2
    post_w = 1 if width < 12 else 2
    grid.rect(cx - (post_w - 1), round(height * 0.29), cx, height - 2, "R")

    arm_h = max(2, round(height * 0.12))
    top_y = max(1, round(height * 0.12))
    lower_y = top_y + arm_h + max(1, round(height * 0.06))
    for y, points_right in [(top_y, True), (lower_y, False)]:
        x0 = 0 if not points_right else max(0, round(width * 0.12))
        x1 = width - 1 if points_right else min(width - 1, round(width * 0.88))
        grid.rect(x0, y, x1, y + arm_h - 1, "Y")
        tip_x = width - 1 if points_right else 0
        grid.put(tip_x, y + arm_h // 2, "Y")
        if detail >= 1:
            shadow_y = y + arm_h - 1
            for x in range(x0 + 1, x1):
                if grid.pixels[shadow_y][x] == "Y":
                    grid.put(x, shadow_y, "y")
        if detail >= 1:
            inner_left = x0 + 2
            inner_right = x1 - 2
            if inner_left <= inner_right:
                grid.hline(y + arm_h // 2, inner_left, inner_right, "K")
        if detail >= 2:
            notch = x1 - 3 if points_right else x0 + 3
            grid.put(notch, y, "W")

    grid.ellipse(cx - 0.5, max(1, top_y - 2), max(1, width * 0.10), max(1, height * 0.04), "W")
    grid.hline(height - 1, max(0, cx - width // 5), min(width - 1, cx + width // 5), "W")
    return Sprite(f"sign-{lod}", "roadside", "sign", lod, width, height, grid.rows(), ROADSIDE_LEGEND)


def lamp_sprite(lod: str) -> Sprite:
    width, height = ROADSIDE_DIMS["lamp"][lod]
    grid = Grid(width, height)
    detail = {"far": 0, "mid": 1, "near": 2}[lod]
    cx = width // 2
    light_w = width if detail == 0 else max(3, width - 2)
    left = (width - light_w) // 2
    grid.hline(0, left, width - 1 - left, "Y")
    if height > 8:
        grid.hline(1, left, width - 1 - left, "W")
    grid.vline(cx, 1 if height <= 8 else 2, height - 2, "w")
    if detail >= 1:
        grid.put(max(0, cx - 1), 2, "K")
        grid.put(min(width - 1, cx + 1), 2, "K")
    if detail >= 2:
        for y in range(4, height - 3):
            if y % 2 == 0 and cx - 1 >= 0:
                grid.put(cx - 1, y, "c")
        for y in range(6, height - 3, 6):
            grid.put(cx - 1, y, "K")
    grid.hline(height - 1, max(0, cx - 1), min(width - 1, cx + 1), "W")
    return Sprite(f"lamp-{lod}", "roadside", "lamp", lod, width, height, grid.rows(), ROADSIDE_LEGEND)


def all_sprites() -> list[Sprite]:
    sprites: list[Sprite] = []
    for kind in ("mini", "car", "bus"):
        for view in ("rear", "front"):
            for lod in ("far", "mid", "near"):
                sprites.append(vehicle_sprite(kind, view, lod))
    for lod in ("far", "mid", "near"):
        sprites.extend([
            deciduous_sprite(lod),
            conifer_sprite(lod),
            rocks_sprite(lod),
            sign_sprite(lod),
            lamp_sprite(lod),
        ])
    return sprites


def make_contact_sheet(sprites: list[Sprite], family: str, out_dir: Path) -> Path:
    family_sprites = [sprite for sprite in sprites if sprite.family == family]
    roles: list[str] = []
    for sprite in family_sprites:
        if sprite.role not in roles:
            roles.append(sprite.role)
    lods = ["far", "mid", "near"]
    cell_w = 270
    cell_h = 230 if family == "traffic" else 245
    label_h = 26
    sheet = Image.new("RGB", (cell_w * 3, label_h + cell_h * len(roles)), (20, 20, 20))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for column, lod in enumerate(lods):
        draw.text((column * cell_w + 8, 8), lod.upper(), fill=(255, 255, 255), font=font)

    for row, role in enumerate(roles):
        for column, lod in enumerate(lods):
            sprite = next(item for item in family_sprites if item.role == role and item.lod == lod)
            x0 = column * cell_w
            y0 = label_h + row * cell_h
            # Checkerboard makes transparency and black keylines visible.
            tile = 16
            for y in range(y0, y0 + cell_h, tile):
                for x in range(x0, x0 + cell_w, tile):
                    shade = 52 if ((x - x0) // tile + (y - y0) // tile) % 2 == 0 else 72
                    draw.rectangle((x, y, min(x + tile - 1, x0 + cell_w - 1), min(y + tile - 1, y0 + cell_h - 1)), fill=(shade, shade, shade))
            preview = Image.open(out_dir / family / f"{sprite.name}_4x.png").convert("RGBA")
            px = x0 + (cell_w - preview.width) // 2
            py = y0 + 24 + (cell_h - 54 - preview.height) // 2
            sheet.paste(preview, (px, py), preview)
            draw.rectangle((x0, y0, x0 + cell_w - 1, y0 + cell_h - 1), outline=(130, 130, 130))
            draw.text((x0 + 8, y0 + 7), f"{sprite.name}  {sprite.width}x{sprite.height}", fill=(255, 255, 255), font=font)

    path = out_dir / f"{family}-contact-sheet.png"
    sheet.save(path)
    return path


def export_sprite(sprite: Sprite, out_root: Path, tool: Path) -> str:
    family_dir = out_root / sprite.family
    family_dir.mkdir(parents=True, exist_ok=True)
    rows_path = family_dir / f"{sprite.name}.rows.txt"
    rows_path.write_text("\n".join(sprite.rows) + "\n", encoding="utf-8")
    command = [
        "python3", str(tool), str(rows_path),
        "--width", str(sprite.width), "--height", str(sprite.height),
        "--legend", *[f"{key}={value}" for key, value in sprite.legend.items() if key in "".join(sprite.rows)],
        "--name", sprite.name,
        "--out", str(family_dir),
    ]
    completed = subprocess.run(command, check=True, capture_output=True, text=True)
    return completed.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--tool", type=Path, default=DEFAULT_TOOL)
    args = parser.parse_args()

    sprites = all_sprites()
    if len(sprites) != 33:
        raise RuntimeError(f"catalogue must contain exactly 33 sprites, got {len(sprites)}")
    if not args.tool.is_file():
        raise FileNotFoundError(f"zx sprite validator not found: {args.tool}")

    validation_lines: list[str] = []
    for sprite in sprites:
        result = export_sprite(sprite, args.out, args.tool)
        validation_lines.append(f"{sprite.name}: {result}")
        print(validation_lines[-1])

    manifest = {
        "count": len(sprites),
        "mode": "ZX Spectrum software-composited sprite",
        "validator": str(args.tool),
        "sprites": [
            {
                "name": sprite.name,
                "family": sprite.family,
                "role": sprite.role,
                "lod": sprite.lod,
                "w": sprite.width,
                "h": sprite.height,
                "files": {
                    "rows": f"{sprite.family}/{sprite.name}.rows.txt",
                    "json": f"{sprite.family}/{sprite.name}.json",
                    "native": f"{sprite.family}/{sprite.name}.png",
                    "preview4x": f"{sprite.family}/{sprite.name}_4x.png",
                },
            }
            for sprite in sprites
        ],
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (args.out / "validation.txt").write_text("\n".join(validation_lines) + "\n", encoding="utf-8")

    traffic_sheet = make_contact_sheet(sprites, "traffic", args.out)
    roadside_sheet = make_contact_sheet(sprites, "roadside", args.out)
    print(f"WROTE {traffic_sheet}")
    print(f"WROTE {roadside_sheet}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
