# Sprite import standard

How hand-drawn / AI-generated sprite art becomes in-game zx-kit sprites.

## Pipeline

```
docs/assets/<sheet>.png  ──node scripts/sprite-import.mjs──▶  src/render/sprites/<name>.ts
   (2×2 contact sheet)        (segment + downsample + snap)        (ROWS + COLORS)
```

## Source sheet format

- A **2×2 grid of sprites** on a **black** background (one PNG, up to 4 sprites).
- Art may be AI-generated (imagegen) and therefore **imprecise** — the visible 8×8
  grid is **decorative only**. The importer never aligns to it.
- Each sprite has a label below it; labels and dimension marks are ignored.
- Colours should be (roughly) ZX palette; anything is snapped to the nearest of the
  16 zx-kit colours, and near-black becomes the transparent background.
- Lives in `docs/assets/` next to `vehicle-sprite-reference.png`.

## The importer (`scripts/sprite-import.mjs`)

For each quadrant it:
1. **Segments** the art by block-density (the largest connected blob of "occupied"
   12 px blocks) — robust to dithering, labels and dimension ticks.
2. **Downsamples** that blob to the target game-pixel size (area-average per cell +
   transparency where a cell is mostly background).
3. **Snaps** each cell to the nearest zx-kit palette colour.

Target sizes (multiple of 8, **min 24×24**) and the sheet layout are declared in the
`EXPECTED` table at the top of the script — edit there to add sprites or retarget sizes.

```bash
node scripts/sprite-import.mjs                 # dry run: geometry + ASCII preview
node scripts/sprite-import.mjs --write         # writes src/render/sprites/*.ts
node scripts/sprite-import.mjs other.png --write
```

## Output format (in code)

Same shape as the oncoming-traffic sprites in `render/road3d.ts`, so a single
renderer (`drawScaledRows`, perspective-scaled) draws both traffic and roadside:

```ts
export const CONIFER_W = 32
export const CONIFER_H = 56
export const CONIFER_ROWS = ['....gg....', ...] as const
export const CONIFER_COLORS: Record<string, SpectrumColor> = { g: C.GREEN, C: C.B_CYAN, ... }
```

Row-string chars: `.` = transparent; lowercase = normal-brightness colour, UPPERCASE =
bright (`g`=`GREEN`, `G`=`B_GREEN`, `c`/`C`=`CYAN`/`B_CYAN`, `y`/`Y`, `r`/`R`, `w`/`W`, …).

The generated files carry an `AUTO-GENERATED … do not edit by hand` header — re-run the
importer to change them; tweak the source PNG or the `EXPECTED` table, not the `.ts`.

## Current sprites

| Sprite | Size | Sheet |
|--------|------|-------|
| `deciduous` | 40×56 | `decorations-v2.png` |
| `conifer`   | 32×56 | `decorations-v2.png` |
| `rocks`     | 40×24 | `decorations-v2.png` |
| `signpost`  | 32×40 | `decorations-v2.png` |
