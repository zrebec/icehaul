/**
 * Level of detail for traffic — "draw meaning in the distance, geometry up close".
 *
 * ── Why a far tier exists ───────────────────────────────────────────────────
 * At 220 m a car is 8 × 6 px. Measuring what survived the resample showed the
 * problem is not that the detail is small, it is that the wrong things survive:
 * a car's lights are a handful of source pixels and lose every vote to its
 * bodywork, so the one fact the player needs — *is it coming at me or am I
 * catching it* — is carried by two or three pixels that come and go.
 *
 * Shrinking a detailed sprite can never fix that. The far tier therefore
 * **guarantees** the lights instead of hoping they survive: it takes the
 * resampled sprite and writes lamp colour into the outermost body pixels of one
 * row, where an edge pixel survives and an interior one is swallowed.
 *
 * ── Why it stopped composing its own symbol ─────────────────────────────────
 * It used to build a blob at the target size — a solid rectangle with a tapered
 * roof, lamps at the corners and a dark base — which was right about what to
 * draw and wrong about what it cost. Two measurements closed it out:
 *
 * - **The handover was the largest single change in an approach.** Swapping one
 *   drawing for a different one replaced 35% of the picture in a frame, against
 *   5-10% for every size step around it.
 * - **The far tier owned the steppiness.** It covers 220 m down to 28-67 m
 *   depending on type, and a rectangle can only grow a whole column at a time,
 *   so the vehicle held one drawing for up to 3.07 s.
 *
 * Recolouring the real silhouette fixes both at once. The far tier now differs
 * from the detail tier by *colour in one row*, so the handover has no shape to
 * change, and it inherits the fractional growth of the raster underneath it.
 *
 * Type is still not really distinguished — the silhouettes exist but at six
 * pixels of height they carry no more than size already did. That was always the
 * honest claim; it is now a consequence rather than a rule.
 *
 * ── Tier selection ──────────────────────────────────────────────────────────
 * Chosen by *projected height*, not `worldZ`, so it survives a change to the
 * viewport or the projection. Same-direction traffic can close and fall back as
 * it brakes, so the height wobbles by a pixel around a boundary; the hysteresis
 * band stops that turning into a flicker between two drawings.
 */

import { LOD_FAR_MAX_HEIGHT, LOD_HYSTERESIS_PX } from '../config.ts'
import type { TrafficVehicle } from '../game/traffic.ts'

export type LodTier = 'far' | 'detail'

/**
 * Writes the lamps back onto a resampled sprite, and changes nothing else.
 *
 * The silhouette is left exactly as the resampler produced it — only colour is
 * replaced, never a transparent cell. That is what makes the handover cheap and
 * keeps the sprite's growth monotonic: the far and detail drawings of the same
 * frame have identical shape, so crossing the boundary cannot move a pixel.
 *
 * The lamps go in the outermost *body* columns because an edge pixel survives
 * where an interior one is swallowed, and they widen to two once there is room.
 * Direction is carried by lamp colour and never by body colour — a
 * same-direction bus is red bodywork, so "red means going away" only holds if it
 * is the lamps that are red.
 */
export function applyFarLamps(
  raster: readonly string[],
  dir: TrafficVehicle['dir'],
): readonly string[] {
  const h = raster.length
  const w = raster[0]?.length ?? 0
  if (w === 0 || h === 0) return raster

  // One row above the base, so the lamps sit on the body rather than in the
  // wheels — or the last row when the sprite is too short to have a choice.
  let lampRow = h >= 3 ? h - 2 : h - 1
  let bounds = solidBodyBounds(raster[lampRow]!)
  // The chosen row often is not body. It can be entirely transparent (a car's
  // wheel gap survives the resample), and since the sprites were redrawn with
  // separated wheels it can also be *split* — opaque at both ends with road
  // showing between. Writing lamps into either loses them or paints them onto
  // the tyres, so walk up to the first unbroken run of body.
  while (bounds === null && lampRow > 0) {
    lampRow--
    bounds = solidBodyBounds(raster[lampRow]!)
  }
  if (bounds === null) return raster

  const lamp = dir === 'oncoming' ? 'Y' : 'R'
  const lampW = w >= 9 ? 2 : 1
  const row = raster[lampRow]!.split('')
  for (let i = 0; i < lampW; i++) {
    if (bounds.left + i <= bounds.right) row[bounds.left + i] = lamp
    if (bounds.right - i >= bounds.left) row[bounds.right - i] = lamp
  }

  const out = raster.slice()
  out[lampRow] = row.join('')
  return out
}

/**
 * First and last column of an *unbroken* opaque run, or `null` when the row has
 * no opaque cells or its opaque cells are split by a gap.
 *
 * The gap is what distinguishes a wheel row from a body row, and it is the only
 * thing that can: at six pixels of height there is no other signal. A row that
 * fails this test is not a row the lamps belong on.
 */
function solidBodyBounds(row: string): { left: number; right: number } | null {
  let left = -1
  let right = -1
  for (let x = 0; x < row.length; x++) {
    if (row[x] === '.') continue
    if (left < 0) left = x
    right = x
  }
  if (left < 0) return null
  for (let x = left; x <= right; x++) {
    if (row[x] === '.') return null
  }
  return { left, right }
}

/**
 * Which tier to draw at this projected height, given the tier drawn last frame.
 *
 * Pure — the caller owns the memory. Without `previous` it picks on the plain
 * threshold, which is what a vehicle appearing for the first time should get.
 */
export function chooseLodTier(projectedHeight: number, previous?: LodTier): LodTier {
  if (previous === 'far') {
    return projectedHeight > LOD_FAR_MAX_HEIGHT + LOD_HYSTERESIS_PX ? 'detail' : 'far'
  }
  if (previous === 'detail') {
    return projectedHeight < LOD_FAR_MAX_HEIGHT - LOD_HYSTERESIS_PX ? 'far' : 'detail'
  }
  return projectedHeight <= LOD_FAR_MAX_HEIGHT ? 'far' : 'detail'
}
