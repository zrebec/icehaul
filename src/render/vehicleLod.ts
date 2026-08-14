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
 * Shrinking a detailed sprite can never fix that. The far tier therefore draws
 * **less**: one silhouette, and lights big enough to survive, positioned so the
 * blob reads as a direction rather than as a vehicle. Type is deliberately not
 * distinguished — mini, car and bus already differ in projected size, and at six
 * pixels of height nothing else about them can be told apart honestly.
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
 * The far symbol, composed **directly at the target size** rather than resampled
 * down to it.
 *
 * The first attempt drew it from a 7 x 5 source sprite and lost: a mini at 220 m
 * projects to 5 x 4, so the symbol was *downscaled*, and the dominant-colour vote
 * that resolves each target pixel deletes a one-pixel lamp exactly when it is the
 * only thing that matters. Building the shape for the size it will occupy removes
 * the resample, and with it the failure.
 *
 * The lamps go in the outer columns because an edge pixel survives where an
 * interior one is swallowed, and they widen once there is room. Everything else
 * is a plain mass: at this size any further detail is a lie.
 */
export function buildFarRaster(dir: TrafficVehicle['dir'], w: number, h: number): readonly string[] {
  if (w <= 0 || h <= 0) return []

  const lamp = dir === 'oncoming' ? 'Y' : 'R'
  const lampW = w >= 9 ? 2 : 1
  const rows: string[] = []

  for (let y = 0; y < h; y++) rows.push('X'.repeat(w))

  // Taper the top corners once the symbol is tall enough to show a roofline.
  if (h >= 4 && w >= 5) {
    rows[0] = '.' + 'X'.repeat(w - 2) + '.'
  }

  // Lamps sit one row above the base, or on the last row when there is no room.
  const lampRow = h >= 3 ? h - 2 : h - 1
  const row = rows[lampRow]!.split('')
  for (let i = 0; i < lampW && i < w; i++) {
    row[i] = lamp
    row[w - 1 - i] = lamp
  }
  rows[lampRow] = row.join('')

  // A dark base reads as contact with the road and separates the mass from a
  // pale surface — a white oncoming vehicle otherwise dissolves into snow.
  if (h >= 5) {
    const base = rows[h - 1]!.split('')
    for (let x = 0; x < w; x++) base[x] = x < lampW || x >= w - lampW ? 'B' : '.'
    rows[h - 1] = base.join('')
  }

  return rows
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
