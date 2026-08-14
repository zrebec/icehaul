/**
 * The dark pass drawn behind a vehicle: a one-pixel outline and a contact shadow.
 *
 * ── Why an outline is worth more than interior detail ───────────────────────
 * A vehicle is drawn straight onto the road surface with nothing between them.
 * On asphalt that is fine — the road is black and any body colour separates from
 * it — but on ice, snow and sand the road is bright, and a white oncoming car on
 * snow has literally nothing marking where it ends. `AGENTS.md` has said since
 * 2026-08-09 that a one-pixel dark contour is worth more than five interior
 * details, and this is that contour.
 *
 * It costs nothing where it is not needed: black on black asphalt is invisible,
 * which is exactly the surface where the vehicle already separated cleanly. The
 * outline is therefore self-limiting rather than something to switch per surface.
 *
 * ── Why it is not part of the vehicle raster ────────────────────────────────
 * "One raster, three consumers" — draw, collision and glow must agree on which
 * pixels *are* the vehicle. The outline is not the vehicle: it sits outside the
 * silhouette, and letting it into the raster would quietly grow every hitbox by
 * a pixel on all four sides, turning a graphics change into a difficulty change.
 *
 * So the contour is a second, parallel mask derived from the raster and drawn
 * behind it. Collision keeps reading the raster alone and is untouched by
 * anything here.
 *
 * ── The contact shadow ──────────────────────────────────────────────────────
 * One dark row under the wheels, inset from both ends so it reads as an ellipse
 * seen almost edge-on rather than as a plinth. Without it a vehicle at distance
 * appears to float slightly above the road, because nothing in the picture says
 * where the road surface passes beneath it.
 */

import { CONTOUR_MIN_HEIGHT, SHADOW_MIN_HEIGHT } from '../config.ts'

/** Marks a dark cell. Not a palette entry — the renderer maps it to `C.BLACK`. */
export const CONTOUR_CHAR = '#'

export interface VehicleContour {
  /** Rows of {@link CONTOUR_CHAR} and `.`, aligned by the offsets below. */
  rows: readonly string[]
  /** Where row 0 / column 0 sits relative to the vehicle raster's own corner. */
  dx: number
  dy: number
}

/**
 * The dark mask for a rasterised vehicle, or `null` when it is too small to
 * carry one.
 *
 * Below {@link CONTOUR_MIN_HEIGHT} the outline stops helping and starts lying:
 * a halo around a 3 × 2 blob is more pixels than the blob, so distance would
 * read as *bigger* — which would undo the growth curve the approach depends on.
 */
export function buildVehicleContour(raster: readonly string[]): VehicleContour | null {
  const h = raster.length
  const w = raster[0]?.length ?? 0
  if (w === 0 || h === 0 || h < CONTOUR_MIN_HEIGHT) return null

  const solid = (x: number, y: number): boolean => {
    const ch = raster[y]?.[x]
    return ch !== undefined && ch !== '.'
  }

  // One cell of margin all round, plus one more below for the shadow.
  const outW = w + 2
  const outH = h + 3
  const rows: string[][] = []
  for (let y = 0; y < outH; y++) rows.push(new Array<string>(outW).fill('.'))

  const bounds = solidBounds(raster, w, h)
  if (!bounds) return null

  // The row directly under the vehicle belongs to the shadow when there is one.
  // Otherwise the two would draw into each other: the outline traces the wheels
  // and the shadow spans the gap between them, and together they make a flat bar
  // the full width of the car — which is the plinth the inset exists to avoid.
  const hasShadow = h >= SHADOW_MIN_HEIGHT
  const shadowRow = bounds.lowest + 1

  // Outline: any empty cell orthogonally touching the silhouette. Diagonals are
  // left alone deliberately — including them thickens every corner to two pixels
  // and at these sizes that reads as a blob with a border rather than a shape.
  for (let y = 0; y < outH; y++) {
    const sy = y - 1
    if (hasShadow && sy === shadowRow) continue
    for (let x = 0; x < outW; x++) {
      const sx = x - 1
      if (solid(sx, sy)) continue
      if (solid(sx - 1, sy) || solid(sx + 1, sy) || solid(sx, sy - 1) || solid(sx, sy + 1)) {
        rows[y]![x] = CONTOUR_CHAR
      }
    }
  }

  if (hasShadow) addContactShadow(rows, bounds, shadowRow)

  return { rows: rows.map(r => r.join('')), dx: -1, dy: -1 }
}

interface SolidBounds {
  /** Lowest row with any solid cell — the wheels, not the box's bottom edge. */
  lowest: number
  left: number
  right: number
}

function solidBounds(raster: readonly string[], w: number, h: number): SolidBounds | null {
  let lowest = -1
  let left = w
  let right = -1
  for (let y = 0; y < h; y++) {
    const row = raster[y]!
    for (let x = 0; x < w; x++) {
      if (row[x] === '.') continue
      lowest = y
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  return lowest < 0 || right < left ? null : { lowest, left, right }
}

/**
 * A dark bar on the road directly under the vehicle.
 *
 * Anchored to the lowest solid row rather than to the raster's bottom edge: the
 * box is `ceil(span)` and can carry a transparent row, and a shadow floating a
 * pixel below the wheels is worse than none.
 *
 * The inset scales with width so the bar always stops short of the bodywork. A
 * shadow as wide as the vehicle reads as a step it is standing on; one that
 * tapers reads as an ellipse seen almost edge-on, which is what it is.
 */
function addContactShadow(rows: string[][], bounds: SolidBounds, shadowRow: number): void {
  const inset = Math.floor((bounds.right - bounds.left + 1) / 8)
  const from = bounds.left + inset
  const to = bounds.right - inset
  if (to < from) return

  const target = rows[shadowRow + 1]   // +1 for the mask's own top margin
  if (!target) return
  for (let x = from; x <= to; x++) target[x + 1] = CONTOUR_CHAR
}
