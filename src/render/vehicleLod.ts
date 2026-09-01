/**
 * Projected-height selection for the three authored traffic drawings.
 *
 * Height comes from the canonical physical box, not from an asset grid, so a
 * 0.5× far source and a 2× near source cross their boundaries at the same world
 * depth. The caller owns `previous`; retaining it inside a one-pixel dead-band
 * prevents a braking vehicle from flickering when its projected height wobbles.
 */

import { LOD_FAR_MAX_HEIGHT, LOD_MID_MAX_HEIGHT, LOD_HYSTERESIS_PX } from '../config.ts'

export type LodTier = 'far' | 'mid' | 'near'

/** Select a tier, allowing a sufficiently large height jump to skip one. */
export function chooseLodTier(projectedHeight: number, previous?: LodTier): LodTier {
  if (previous === 'far') {
    if (projectedHeight <= LOD_FAR_MAX_HEIGHT + LOD_HYSTERESIS_PX) return 'far'
    return projectedHeight > LOD_MID_MAX_HEIGHT + LOD_HYSTERESIS_PX ? 'near' : 'mid'
  }
  if (previous === 'mid') {
    if (projectedHeight < LOD_FAR_MAX_HEIGHT - LOD_HYSTERESIS_PX) return 'far'
    if (projectedHeight > LOD_MID_MAX_HEIGHT + LOD_HYSTERESIS_PX) return 'near'
    return 'mid'
  }
  if (previous === 'near') {
    if (projectedHeight >= LOD_MID_MAX_HEIGHT - LOD_HYSTERESIS_PX) return 'near'
    return projectedHeight < LOD_FAR_MAX_HEIGHT - LOD_HYSTERESIS_PX ? 'far' : 'mid'
  }

  if (projectedHeight <= LOD_FAR_MAX_HEIGHT) return 'far'
  return projectedHeight <= LOD_MID_MAX_HEIGHT ? 'mid' : 'near'
}
