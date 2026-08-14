/**
 * One raster per drawn vehicle, shared by the renderer and the collision check.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Drawing and collision used to resample the sprite in opposite directions and
 * disagree about the result. `drawTrafficRows` mapped source → target, painting a
 * rect (minimum 1×1) per *source* pixel; `checkTruckTrafficCollision` mapped
 * target → source, asking which source pixel a *screen* pixel fell on. Those two
 * are not inverses, and measuring them showed they never agreed:
 *
 *     distance   drawn-not-solid   solid-not-drawn   agreement
 *       220 m           6                 2             81%
 *        50 m           7                 0             90%
 *        10 m           9                16             84%
 *         1 m          19                45             87%
 *
 * At a metre that is 45 pixels of invisible hitbox and 19 visible pixels that
 * pass straight through — which is exactly the reported "we touch and nothing
 * happens". "Pixel-perfect collision" was only ever true of the source sprite,
 * not of what reached the screen.
 *
 * Resampling once and letting both readers share the answer makes the claim true
 * by construction rather than by coincidence.
 *
 * ── What it does not do ─────────────────────────────────────────────────────
 * {@link scaleRoadsideRows} resolves each target pixel to the *most common*
 * opaque source char, so small features lose to bodywork: at 8×6 a car's lights
 * are outvoted by its panels. That is deliberate here. Making meaning survive
 * distance is the job of the far LOD tier, and mixing it in now would make it
 * impossible to tell which change bought which improvement.
 */

import { scaleRoadsideRows } from './road3d.ts'

/**
 * Rasters are keyed by sprite identity and target size, and a vehicle holds the
 * same integer size for many frames as it approaches, so nearly every frame is a
 * cache hit. Sizes are bounded — 3 px to a little over 30 — so the working set
 * is small; the cap only guards against a future renderer widening the range.
 */
const MAX_ENTRIES = 512
const cache = new Map<string, readonly string[]>()

/** Cleared between tests so cache state cannot leak across cases. */
export function resetVehicleRasterCache(): void {
  cache.clear()
}

export function vehicleRasterCacheSize(): number {
  return cache.size
}

/**
 * The sprite resampled to exactly `w × h` target pixels, as row strings where
 * `.` is transparent. One raster pixel is one screen pixel, so both the renderer
 * and the collision check can index it directly with no further arithmetic.
 *
 * `key` must identify the source sprite — direction and type is enough today.
 */
export function rasteriseVehicle(
  key: string,
  rows: readonly string[],
  w: number,
  h: number,
): readonly string[] {
  if (rows.length === 0) return []
  return cachedRaster(key, w, h, () => scaleRoadsideRows(rows, w, h))
}

/**
 * Cache any raster built for a given size — used by the far tier, which composes
 * its symbol directly at the target size instead of resampling a source sprite.
 * Resampling one down would defeat the point: a lamp is a single pixel, and the
 * dominant-colour vote deletes it exactly when it matters most.
 */
export function cachedRaster(
  key: string,
  w: number,
  h: number,
  build: () => readonly string[],
): readonly string[] {
  if (w <= 0 || h <= 0) return []

  const cacheKey = `${key}:${w}x${h}`
  const hit = cache.get(cacheKey)
  if (hit) return hit

  const raster = build()
  if (cache.size >= MAX_ENTRIES) cache.clear()
  cache.set(cacheKey, raster)
  return raster
}
