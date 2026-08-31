/** Perspective and LOD settings for non-colliding roadside scenery. */

export const SCENERY_VIEW_DISTANCE_M = 220

export const SCENERY_SCALE_FAR = 0.15
export const SCENERY_SCALE_FAR_Z_M = 220
export const SCENERY_SCALE_NEAR = 0.65
export const SCENERY_SCALE_NEAR_Z_M = 3

/** Solved hyperbola: `scale(z) = A / (z + B)` through both anchors. */
export const SCENERY_SCALE_B =
  (SCENERY_SCALE_FAR * SCENERY_SCALE_FAR_Z_M
    - SCENERY_SCALE_NEAR * SCENERY_SCALE_NEAR_Z_M)
  / (SCENERY_SCALE_NEAR - SCENERY_SCALE_FAR)

export const SCENERY_SCALE_A = SCENERY_SCALE_NEAR
  * (SCENERY_SCALE_NEAR_Z_M + SCENERY_SCALE_B)

export const SCENERY_LOD_FAR_MAX_SCALE = 0.30
export const SCENERY_LOD_MID_MAX_SCALE = 0.50

/** Physical boxes before projection; authored grid resolution is independent. */
export const SCENERY_CANONICAL_SIZE = {
  deciduous: { w: 22, h: 31 },
  conifer: { w: 18, h: 31 },
  rocks: { w: 22, h: 13 },
  sign: { w: 18, h: 22 },
  lamp: { w: 6, h: 28 },
} as const
