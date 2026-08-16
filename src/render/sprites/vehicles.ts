/**
 * The six traffic vehicles, drawn by hand.
 *
 * ── Why these were redrawn ──────────────────────────────────────────────────
 * Six pull requests fixed how a sprite reaches the screen — one shared raster,
 * a far LOD tier, a hyperbolic growth curve, an area-weighted resample,
 * fractional scaling, a contrast outline. None of them touched what the sprite
 * *was*. Owner, after all that: *"we are at a better level but honestly the
 * sprites are terrible — not even a person with imagination could tell it is a
 * car if they did not already know."*
 *
 * The originals came out of `scripts/sprite-import.mjs`, which segments an image
 * by block density. That earns its keep on roadside scenery, where lumpiness
 * reads as nature. On a vehicle it produced three defects no renderer can fix:
 *
 * - **Rear lamps as a bar across the middle.** On a real car, and on every
 *   readable 8-bit car, they sit at the outer corners — and they are the single
 *   feature that says "car, going away from me". The far tier had to *re-add*
 *   corner lamps precisely because the art got this wrong; now the two agree.
 * - **No bilateral symmetry.** A car is symmetric and these were not, because
 *   block-density segmentation has no reason to be. At this size the asymmetry
 *   reads as noise rather than as a vehicle.
 * - **Wheels that never separated from the body.** Black and body colour mixed
 *   in the bottom rows with no gap, so nothing ever showed the road underneath
 *   and the vehicle had no visible ground contact.
 *
 * ── The rules these follow ──────────────────────────────────────────────────
 * 1. **Every row is a palindrome.** Symmetry is cheap to hold and it is what
 *    makes thirty pixels read as a manufactured object.
 * 2. **Lamps occupy the outermost columns of the widest rows.** Not inset: an
 *    edge pixel survives the resample where an interior one is outvoted by
 *    bodywork, which is the same reason `applyFarLamps` writes to the edge.
 * 3. **Direction is carried by lamp colour, never by body colour.** Red going
 *    away, yellow coming at you.
 * 4. **The wheels have road between them.** Two dark blocks with a gap, below a
 *    solid bumper row.
 * 5. **Dimensions are unchanged** — mini 14x11, car 22x15, bus 28x18, each with
 *    one empty bottom row. Width and height are read straight off these tables
 *    and feed the projection, the LOD thresholds and the collision raster, so
 *    changing them would be a gameplay change wearing an art change's clothes.
 * 6. **Interior features are wide, not fine.** See below — this one was measured,
 *    not chosen.
 *
 * Colours are unchanged from the originals for the same reason: this is a
 * redraw, not a repaint. One consequence of that is called out at
 * {@link SAME_BUS_COLORS} and is worth a look.
 *
 * ── Why rule 6 exists: symmetry costs far-field motion, and the fix is width ─
 * The first symmetric mini made `approachCadence` fail: it held one drawing for
 * **2.58 s** at 204 m, against a 2 s budget and against 1.97 s for the sprite it
 * replaced. That is not a rendering regression, it is what symmetry does. The
 * old mini's off-centre window flipped on and off as the sampling grid drifted,
 * and those flips counted as changes — the "motion" in the far field was partly
 * the asymmetry flickering, which is exactly the noise this redraw removes.
 *
 * The fix was in the art, not the budget. Its rear window and plate were six
 * pixels wide against the oncoming mini's eight, and the oncoming mini was
 * already fine at 0.95 s. Widening both to eight took the freeze to **1.28 s** —
 * better than the sprite it replaced, with the symmetry kept. A feature has to
 * be wide enough to survive down to four pixels or it stops contributing
 * anything at the distance where contribution is scarcest.
 *
 * Result across the fleet, longest hold of one drawing (was: worst 1.97 s):
 *
 *     same mini 1.28 s   car 0.83 s   bus 0.57 s
 *     oncoming  0.95 s       0.83 s       0.82 s
 */

import { C } from 'zx-kit'
import type { SpectrumColor } from 'zx-kit'

export type RowColors = Record<string, SpectrumColor>

// ── Mini ────────────────────────────────────────────────────────────────────
// 14 x 11. The smallest body: one roof row, a two-row window, and a single row
// of wheels is all there is room for. Window and plate are eight wide rather
// than six for the far-field reason in the header — on a hatchback a rear window
// that nearly spans the back is right anyway.

export const SAME_MINI_ROWS = [
  '...XXXXXXXX...',
  '..XWWWWWWWWX..',
  '..XWWWWWWWWX..',
  '.XXXXXXXXXXXX.',
  'XXXXXXXXXXXXXX',
  'RRXXXXXXXXXXRR',
  'RRXXXXXXXXXXRR',
  'XXXYYYYYYYYXXX',
  'XXXXXXXXXXXXXX',
  '.BBB......BBB.',
  '..............',
] as const

export const ONCOMING_MINI_ROWS = [
  '...XXXXXXXX...',
  '..XWWWWWWWWX..',
  '..XWWWWWWWWX..',
  '.XXXXXXXXXXXX.',
  'XXXXXXXXXXXXXX',
  'YYXXXXXXXXXXYY',
  'YYXXXXXXXXXXYY',
  'XXXBBBBBBBBXXX',
  'XXXXXXXXXXXXXX',
  '.BBB......BBB.',
  '..............',
] as const

// ── Car ─────────────────────────────────────────────────────────────────────
// 22 x 15. The drawing the player looks at most, and the one the owner's
// complaint was aimed at. Four rows of taper from roof to shoulder give it a
// silhouette that is still a car once the resampler has had it.

export const SAME_CAR_ROWS = [
  '......XXXXXXXXXX......',
  '.....XXXXXXXXXXXX.....',
  '....XXXWWWWWWWWXXX....',
  '....XXXWWWWWWWWXXX....',
  '...XXXXXXXXXXXXXXXX...',
  '..XXXXXXXXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXXXXXXXX',
  'RRRXXXXXXXXXXXXXXXXRRR',
  'RRRXXXXXXXXXXXXXXXXRRR',
  'XXXXXXXYYYYYYYYXXXXXXX',
  'XXXXXXXXXXXXXXXXXXXXXX',
  '..BBBB..........BBBB..',
  '..BBBB..........BBBB..',
  '......................',
] as const

export const ONCOMING_CAR_ROWS = [
  '......XXXXXXXXXX......',
  '.....XXXXXXXXXXXX.....',
  '....XXWWWWWWWWWWXX....',
  '....XXWWWWWWWWWWXX....',
  '...XXXXXXXXXXXXXXXX...',
  '..XXXXXXXXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXXXXXXXX',
  'YYYXXXXXXXXXXXXXXXXYYY',
  'YYYXXXXXXXXXXXXXXXXYYY',
  'XXXXXBBBBBBBBBBBBXXXXX',
  'XXXXXXXXXXXXXXXXXXXXXX',
  '..BBBB..........BBBB..',
  '..BBBB..........BBBB..',
  '......................',
] as const

// ── Bus ─────────────────────────────────────────────────────────────────────
// 28 x 18. Slab-sided, so the shape carries almost nothing and the details have
// to: a tall window band, a central door seam, and a three-row lamp cluster.

export const SAME_BUS_ROWS = [
  '..XXXXXXXXXXXXXXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXXXXXXXXXXXXXX.',
  'XXXXWWWWWWWWWWWWWWWWWWWWXXXX',
  'XXXXWWWWWWWWWWWWWWWWWWWWXXXX',
  'XXXXWWWWWWWWWWWWWWWWWWWWXXXX',
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXBBBBXXXXXXXXXXXX',
  'XXXXXXXXXXXXBBBBXXXXXXXXXXXX',
  'BBBBBXXXXXXXBBBBXXXXXXXBBBBB',
  'RRRRBXXXXXXXBBBBXXXXXXXBRRRR',
  'RRRRBXXXXXXXXXXXXXXXXXXBRRRR',
  'RRRRBXXXXXXXXXXXXXXXXXXBRRRR',
  'BBBBBXXXXXYYYYYYYYXXXXXBBBBB',
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  '...BBBBBB..........BBBBBB...',
  '...BBBBBB..........BBBBBB...',
  '....BBBB............BBBB....',
  '............................',
] as const

export const ONCOMING_BUS_ROWS = [
  '..XXXXXXXXXXXXXXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXXXXXXXXXXXXXX.',
  'XXXWWWWWWWWWWWWWWWWWWWWWWXXX',
  'XXXWWWWWWWWWWWWWWWWWWWWWWXXX',
  'XXXWWWWWWWWWWWWWWWWWWWWWWXXX',
  'XXXWWWWWWWWWWWWWWWWWWWWWWXXX',
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'YYYYXXXXXXXXXXXXXXXXXXXXYYYY',
  'YYYYXXXXXXXXXXXXXXXXXXXXYYYY',
  'YYYYXXXXXXXXXXXXXXXXXXXXYYYY',
  'XXXXXXXBBBBBBBBBBBBBBXXXXXXX',
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  '...BBBBBB..........BBBBBB...',
  '...BBBBBB..........BBBBBB...',
  '....BBBB............BBBB....',
  '............................',
] as const

// ── Colours ─────────────────────────────────────────────────────────────────
// Unchanged from the imported sprites, except for the brake state below. `R` and
// `Y` must stay defined on every same / oncoming map respectively:
// `applyFarLamps` writes those two chars into the resampled raster, so a map
// missing one would drop the far tier's lamps.
//
// ── Tail lamp and brake lamp are two colours, not one brightness of glow ────
// A same-direction vehicle's lamps are `RED` while it rolls and `B_RED` while it
// brakes — the ZX BRIGHT bit, and the only period-correct way to say "brake".
//
// This is deliberately a change **in the framebuffer** rather than only in the
// bloom. `?glow=0` is a real setting a player may prefer, and the difference
// between a car ahead cruising and a car ahead stopping is safety information,
// not decoration. It has to survive the lights being switched off.

export const SAME_MINI_COLORS: RowColors = {
  X: C.B_GREEN, W: C.CYAN, R: C.RED, B: C.BLACK, Y: C.B_YELLOW,
}
export const SAME_MINI_BRAKE_COLORS: RowColors = { ...SAME_MINI_COLORS, R: C.B_RED }
export const ONCOMING_MINI_COLORS: RowColors = {
  X: C.B_WHITE, W: C.CYAN, B: C.BLACK, Y: C.B_YELLOW,
}
export const SAME_CAR_COLORS: RowColors = {
  X: C.B_GREEN, W: C.CYAN, R: C.RED, B: C.BLACK, Y: C.B_YELLOW,
}
export const SAME_CAR_BRAKE_COLORS: RowColors = { ...SAME_CAR_COLORS, R: C.B_RED }
export const ONCOMING_CAR_COLORS: RowColors = {
  X: C.B_WHITE, W: C.CYAN, B: C.BLACK, Y: C.B_YELLOW,
}
/**
 * The one place the palette fights the drawing: bodywork is `B_RED` and the
 * lamps are `RED`, so a same-direction bus signals "going away" in dark red on
 * bright red — the weakest lamp contrast in the fleet, and it gets weaker with
 * distance, not better. The far tier makes it worse rather than better, because
 * `applyFarLamps` writes `R` and `R` is the near-invisible one.
 *
 * The redraw works around it rather than solving it: each lamp cluster gets a
 * black inboard edge (see {@link SAME_BUS_ROWS}), so the eye reads a bounded
 * cluster instead of a slightly darker patch of body. That is as far as art can
 * take it.
 *
 * The actual fix is a body colour that is not red — `B_YELLOW` would free red
 * for the lamps entirely and no other vehicle is yellow — but that is a repaint
 * and a visible one, so it is the owner's call and not smuggled in here.
 *
 * **The bus therefore gets no brake state**, and that is the owner's decision
 * rather than an oversight: `B_RED` lamps on a `B_RED` body would be invisible
 * exactly when the information matters most, so it would be a brake light that
 * lies. Mini and car brake; the bus waits for the repaint.
 */
export const SAME_BUS_COLORS: RowColors = {
  X: C.B_RED, W: C.CYAN, Y: C.B_YELLOW, R: C.RED, B: C.BLACK,
}
export const ONCOMING_BUS_COLORS: RowColors = {
  X: C.B_RED, W: C.CYAN, B: C.BLACK, Y: C.B_YELLOW,
}
