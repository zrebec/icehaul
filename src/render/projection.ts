import { PERSPECTIVE_K, CURVE_STRENGTH } from '../config.ts'

/**
 * Pseudo-3D road projection — the one place that turns world depth into screen
 * scanlines and back.
 *
 * The road is drawn as `scanlines` horizontal strips below the horizon. Strip
 * `dy` (1-based, 1 = first row under the horizon) samples the world at
 * `worldZ = PERSPECTIVE_K / dy` metres ahead of the camera, so depth per strip
 * is enormous near the horizon (dy=1 → 150 m, dy=2 → 75 m) and tiny at the
 * bottom (dy=88 → 1.7 m).
 *
 * That asymmetry is why anything world-periodic must be projected FROM the
 * world (`depthToScanline`) rather than sampled per scanline: a 0.8 m marker
 * checked against a strip 75 m deep is hit roughly once in a hundred frames,
 * which reads as flicker. Canisters, traffic and roadside objects already
 * projected correctly; the road surface patterns did not.
 */

/** Screen scanline (1-based, fractional) showing world depth `worldZ` metres ahead. */
export function depthToScanline(worldZ: number): number {
  return PERSPECTIVE_K / worldZ
}

/** World depth in metres sampled by scanline `dy` (1-based). Inverse of {@link depthToScanline}. */
export function scanlineToDepth(dy: number): number {
  return PERSPECTIVE_K / dy
}

/**
 * Depth in metres beyond which one scanline covers more than one full period of
 * a `periodM`-metre pattern — the Nyquist limit for that pattern.
 *
 * Solves `K/z - K/(z+p) = 1` for z, i.e. "one period spans exactly one scanline":
 * `z = (-p + √(p² + 4·K·p)) / 2`. Past it the pattern is sub-pixel and can only
 * alias, so callers draw a flat colour there instead of a stripe.
 */
export function patternDepthLimit(periodM: number): number {
  return (-periodM + Math.sqrt(periodM * periodM + 4 * PERSPECTIVE_K * periodM)) / 2
}

/**
 * Accumulated horizontal curve offset per scanline, indexed by `i = dy - 1`.
 *
 * Curvature is integrated from the bottom of the screen upward and weighted by
 * distance from the bottom, so a bend leans the road progressively further off
 * centre the closer a scanline sits to the horizon.
 *
 * Keep the Float32Array and the accumulation order: `game/roadgeometry.ts`
 * repeats this loop for off-road/collision detection and the two must stay
 * bit-identical. Render and collision disagreeing about where the road is has
 * already cost this project three debugging rounds.
 */
export function computeCurveOffsets(
  cameraDistance: number,
  scanlines: number,
  getCurvature: (distM: number) => number,
): Float32Array {
  const curveOffset = new Float32Array(scanlines)
  let acc = 0
  for (let i = scanlines - 1; i >= 0; i--) {
    const distFromBottom = (scanlines - 1 - i) / scanlines
    const dy = i + 1
    const worldZ = PERSPECTIVE_K / dy
    acc += getCurvature(cameraDistance + worldZ) * CURVE_STRENGTH * distFromBottom
    curveOffset[i] = acc
  }
  return curveOffset
}
