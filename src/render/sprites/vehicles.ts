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
 * 7. **Structure is drawn in black, inside the silhouette.** The keylines: a
 *    waist line under the glass, a dark inboard edge on each lamp cluster, a
 *    bumper band, shut lines, wheel arches. This is the second pass (2026-08-19)
 *    and it is what the first one deliberately left out.
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
 * ── The second pass: structure, and why it was needed (2026-08-19) ─────────
 * Fox, after the traffic-braking playtest: *"hre chýbajú detaily (hlavne
 * vozidiel). Také čierne outlines, ktoré sa všeobecne robili."* The harder reason
 * under the aesthetic one is that **brightness is exhausted as a carrier**: `RED`
 * and `B_RED` are 50 units apart on one channel, and the lamp halo saturates them
 * into each other. Anything a vehicle still needs to say has to be said with
 * shape.
 *
 * So each drawing gained keylines — rule 7 — in the language the player's own
 * truck already speaks: a mass of colour described by dark structural lines,
 * rather than a flat slab with a window in it. The outer contour (#35) was
 * already there and lives outside the raster; these are the *interior* lines it
 * never had.
 *
 * Bodies also stopped sharing colours. The mini and the car were both
 * `B_GREEN`, so at the distance where their silhouettes stop differing there was
 * nothing left to tell them apart at all; the mini is `B_MAGENTA` now, which no
 * vehicle, surface, kerb or marker uses.
 *
 * Two things the drawing had to give up, both to measurement rather than taste:
 *
 * - **The oncoming mini has no wheel arches.** Its front is a full-width dark
 *   grille, and an arch row under one merges into a single dark mass at 4 px:
 *   1.05 s -> 1.83 s of freeze for that one row. A narrower grille (1.47 s) and
 *   arches pushed to the edges (1.83 s) were tried and neither recovered it.
 * - **The number plates are `WHITE`, not `B_YELLOW`.** Yellow is the *oncoming
 *   lamp colour*, and at 14 px a bright yellow bar across a same-direction car's
 *   rear outshone the red lamps that carry direction and the brake. Plain white
 *   is the one unused entry left in the palette and it competes with nothing.
 *   (Removing the plate entirely was tried: it costs the same mini 1.17 s ->
 *   1.83 s, because the plate is what keeps the bumper and the arches from
 *   reading as one dark mass.)
 *
 * Result across the fleet, longest hold of one drawing (budget 2.0 s):
 *
 *                first redraw    with keylines
 *     same mini      1.28 s          1.17 s
 *     same car       0.83 s          0.83 s
 *     same bus       0.57 s          0.55 s
 *     oncoming mini  0.95 s          1.05 s
 *     oncoming car   0.83 s          0.83 s
 *     oncoming bus   0.82 s          0.83 s
 *
 * The count of *changes* per approach went up everywhere it mattered — the car
 * 168 -> 177, the bus 182 -> 195 — so the structure is not only visible up close,
 * it is doing work in the far field too.
 */

import { C } from 'zx-kit'
import type { SpectrumColor } from 'zx-kit'

export type RowColors = Record<string, SpectrumColor>

// ── Mini ────────────────────────────────────────────────────────────────────
// 14 x 11. The smallest body, and the one with least room to say anything: one
// roof row, a two-row glass band, one row of wheels.
//
// The keylines are what the redraw adds. A hatchback seen from behind is a slab
// of colour unless something describes it, so: a **waist line** under the glass
// where the tailgate meets the shoulder, a **dark inboard edge** on each lamp so
// the cluster reads as a fitted unit rather than a stain, a **dark bumper**
// carrying the plate, and **wheel arches** picked out above the tyres.
//
// Glass and plate stay eight wide. That is not a drawing choice — see the
// far-field rule in the header: a feature narrower than about a quarter of the
// body stops contributing at the distance where contribution is scarcest.
//
// ── Why the oncoming mini has no arches, when everything else does ──────────
// Because they cost 0.78 s of far-field motion, measured. Its front is a
// full-width dark grille, and an arch row directly under one merges into a
// single dark mass at the size where the mini is 4 px tall — a mass that then
// stops changing as the sprite grows. `approachCadence` went 1.05 s -> 1.83 s
// against a 2.0 s budget for that one row. Three alternatives were measured and
// none of them recovered it: a narrower grille reached 1.47 s, arches pushed out
// to the edges 1.83 s. The rear keeps its arches because a yellow plate sits
// between them and the bumper, so the two dark bands never touch.

export const SAME_MINI_ROWS = [
  '...XXXXXXXX...',
  '..XWWWWWWWWX..',
  '..XWWWWWWWWX..',
  '.XBBBBBBBBBBX.',
  'XXXXXXXXXXXXXX',
  'RRBXXXXXXXXBRR',
  'RRBXXXXXXXXBRR',
  'XBBPPPPPPPPBBX',
  'XBBBXXXXXXBBBX',
  '.BBB......BBB.',
  '..............',
] as const

export const ONCOMING_MINI_ROWS = [
  '...XXXXXXXX...',
  '..XWWWWWWWWX..',
  '..XWWWWWWWWX..',
  '.XBBBBBBBBBBX.',
  'XXXXXXXXXXXXXX',
  'YYBXXXXXXXXBYY',
  'YYBXXXXXXXXBYY',
  'XBBBBBBBBBBBBX',
  'XXXXXXXXXXXXXX',
  '.BBB......BBB.',
  '..............',
] as const

// ── Car ─────────────────────────────────────────────────────────────────────
// 22 x 15. The drawing the player looks at most. Four rows of taper from roof to
// shoulder give it a silhouette that is still a car once the resampler has had
// it; the keylines give it something to be *inside* that silhouette.
//
// Rear: waist line, lamp clusters with a dark inboard edge, a bumper band with
// the plate let into it, and arches over the wheels. Front: the same skeleton
// with the bumper band opened out into a full grille, because a front is mostly
// grille and a rear is mostly panel — that difference is worth more at 22 px
// than any amount of extra shape.

export const SAME_CAR_ROWS = [
  '......XXXXXXXXXX......',
  '.....XXXXXXXXXXXX.....',
  '....XXXWWWWWWWWXXX....',
  '....XXXWWWWWWWWXXX....',
  '...XXXBBBBBBBBBBXXX...',
  '..XXXXXXXXXXXXXXXXXX..',
  '.XXXXBBBBBBBBBBBBXXXX.',
  'XXXXXXXXXXXXXXXXXXXXXX',
  'RRRBXXXXXXXXXXXXXXBRRR',
  'RRRBXXXXXXXXXXXXXXBRRR',
  'XXXBBBBPPPPPPPPBBBBXXX',
  'XXBBBBXXXXXXXXXXBBBBXX',
  '..BBBB..........BBBB..',
  '..BBBB..........BBBB..',
  '......................',
] as const

export const ONCOMING_CAR_ROWS = [
  '......XXXXXXXXXX......',
  '.....XXXXXXXXXXXX.....',
  '....XXWWWWWWWWWWXX....',
  '....XXWWWWWWWWWWXX....',
  '...XXXBBBBBBBBBBXXX...',
  '..XXXXXXXXXXXXXXXXXX..',
  '.XXXXBBBBBBBBBBBBXXXX.',
  'XXXXXXXXXXXXXXXXXXXXXX',
  'YYYBXXXXXXXXXXXXXXBYYY',
  'YYYBXXXXXXXXXXXXXXBYYY',
  'XXXBBBBBBBBBBBBBBBBXXX',
  'XXBBBBXXXXXXXXXXBBBBXX',
  '..BBBB..........BBBB..',
  '..BBBB..........BBBB..',
  '......................',
] as const

// ── Bus ─────────────────────────────────────────────────────────────────────
// 28 x 18. Slab-sided, so the shape carries almost nothing and the structure has
// to carry everything: a glass band with its own **pillars and a waist line**, a
// central door seam, a three-row lamp cluster boxed in black, and arches that
// line up with the tyres to the pixel.
//
// The waist line matters more here than on the other two. A bus is a rectangle,
// and a rectangle with a horizontal line across it reads as a vehicle with a
// window; without the line it reads as a coloured brick with a blue stripe.

export const SAME_BUS_ROWS = [
  '..XXXXXXXXXXXXXXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXXXXXXXXXXXXXX.',
  'XXXBWWWWWWBWWWWWWBWWWWWWBXXX',
  'XXXBWWWWWWBWWWWWWBWWWWWWBXXX',
  'XXXBWWWWWWBWWWWWWBWWWWWWBXXX',
  'XXXBBBBBBBBBBBBBBBBBBBBBBXXX',
  'XXXXXXXXXXXXXBBXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXBBXXXXXXXXXXXXX',
  'BBBBBXXXXXXXXBBXXXXXXXXBBBBB',
  'RRRRBXXXXXXXXBBXXXXXXXXBRRRR',
  'RRRRBXXXXXXXXBBXXXXXXXXBRRRR',
  'RRRRBXXXXXXXXXXXXXXXXXXBRRRR',
  'BBBBBXXXXXBBBBBBBBXXXXXBBBBB',
  'XXXBBBBBBXXXXXXXXXXBBBBBBXXX',
  '...BBBBBB..........BBBBBB...',
  '...BBBBBB..........BBBBBB...',
  '....BBBB............BBBB....',
  '............................',
] as const

export const ONCOMING_BUS_ROWS = [
  '..XXXXXXXXXXXXXXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXXXXXXXXXXXXXX.',
  'XXXBWWWWWWBWWWWWWBWWWWWWBXXX',
  'XXXBWWWWWWBWWWWWWBWWWWWWBXXX',
  'XXXBWWWWWWBWWWWWWBWWWWWWBXXX',
  'XXXBBBBBBBBBBBBBBBBBBBBBBXXX',
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXBBXXXXXXXXXXXXX',
  'BBBBBXXXXXXXXBBXXXXXXXXBBBBB',
  'YYYYBXXXXXXXXBBXXXXXXXXBYYYY',
  'YYYYBXXXXXXXXBBXXXXXXXXBYYYY',
  'YYYYBXXXXXXXXXXXXXXXXXXBYYYY',
  'BBBBBXXXXXBBBBBBBBXXXXXBBBBB',
  'XXXBBBBBBXXXXXXXXXXBBBBBBXXX',
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

/**
 * Three same-direction bodies, three colours — magenta, green, yellow.
 *
 * The mini and the car were both `B_GREEN`, which meant that at the distance
 * where the silhouettes stop being distinguishable (they are 4 px and 5 px tall)
 * there was nothing left to tell them apart at all. Type is not safety
 * information the way direction is, but it *is* the difference between "traffic"
 * and "a road with things on it", and the palette can carry it for free.
 *
 * Magenta is not a colour any of this fleet had, and that is the point: no other
 * vehicle, surface, kerb or marker uses it, so a magenta blob is unambiguously a
 * small car going the player's way.
 */
export const SAME_MINI_COLORS: RowColors = {
  X: C.B_MAGENTA, W: C.CYAN, R: C.RED, B: C.BLACK, P: C.WHITE,
}
export const SAME_MINI_BRAKE_COLORS: RowColors = { ...SAME_MINI_COLORS, R: C.B_RED }
export const ONCOMING_MINI_COLORS: RowColors = {
  X: C.B_WHITE, W: C.CYAN, B: C.BLACK, Y: C.B_YELLOW,
}
export const SAME_CAR_COLORS: RowColors = {
  X: C.B_GREEN, W: C.CYAN, R: C.RED, B: C.BLACK, P: C.WHITE,
}
export const SAME_CAR_BRAKE_COLORS: RowColors = { ...SAME_CAR_COLORS, R: C.B_RED }
export const ONCOMING_CAR_COLORS: RowColors = {
  X: C.B_WHITE, W: C.CYAN, B: C.BLACK, Y: C.B_YELLOW,
}
/**
 * Yellow, since 2026-08-19 — the repaint this file spent two paragraphs asking
 * for, and Fox's call: *"prekresli autobus (kľudne biely, žltý) a musí byť
 * vidieť."*
 *
 * **What it was and why it could not stay.** Bodywork was `B_RED` and the lamps
 * `RED`, so a same-direction bus said "going away" in dark red on bright red —
 * the weakest lamp contrast in the fleet, and one that got worse with distance
 * rather than better, because `applyFarLamps` writes `R` and `R` was the
 * near-invisible one. The redraw could only work around it: a black inboard edge
 * per lamp cluster, so the eye reads a bounded shape instead of a slightly darker
 * patch of body. **And the bus had no brake state at all**, because `B_RED` lamps
 * on `B_RED` bodywork would have been a brake light that lies.
 *
 * `B_YELLOW` frees red entirely, and no other vehicle is yellow. The one thing it
 * costs is worth stating plainly: **`B_YELLOW` is also the oncoming lamp
 * colour**, so at 220 m a yellow body is the same hue as an oncoming vehicle's
 * lights. Direction survives because it was never carried by the body — a
 * same-direction bus wears a **red** halo and red lamps, an oncoming one a yellow
 * halo, and the halo is far larger than the body at exactly the distance where
 * the body is too small to read.
 *
 * The `Y` strip across the rear panel went black in the same change: on a yellow
 * body it would have been invisible, and `Y` no longer appears in this drawing
 * at all.
 */
export const SAME_BUS_COLORS: RowColors = {
  X: C.B_YELLOW, W: C.CYAN, R: C.RED, B: C.BLACK,
}
export const SAME_BUS_BRAKE_COLORS: RowColors = { ...SAME_BUS_COLORS, R: C.B_RED }
export const ONCOMING_BUS_COLORS: RowColors = {
  X: C.B_RED, W: C.CYAN, B: C.BLACK, Y: C.B_YELLOW,
}
