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
 * The resampler resolves each target pixel to the opaque source char covering
 * most of it, so small features lose to bodywork: at 8×6 a car's lights are
 * outvoted by its panels. That is deliberate here. Making meaning survive
 * distance is the far LOD tier's job, and it does it by writing the lamps back
 * on afterwards rather than by hoping the vote keeps them.
 */

import { resampleSpriteAtSpan } from './spriteRaster.ts'
import { buildVehicleContour, type VehicleContour } from './vehicleContour.ts'

/**
 * Rasters are keyed by sprite identity and the quantised scale it was built at.
 *
 * Keying by integer size was enough while the size *was* the quantisation, but
 * a sprite is now sampled at a fractional size and two different scales that
 * round to the same `w × h` are two different drawings — that difference is the
 * whole point.
 *
 * The working set is bounded and countable. Scale runs from `TRAFFIC_SCALE_FAR`
 * to a little past `TRAFFIC_SCALE_NEAR`, about 366 buckets at
 * {@link SCALE_STEPS}, for each of six sprites — call it 2200 entries. The far
 * flavour only exists below each sprite's tier boundary, adding about 800 more.
 * The cap sits above that with room, so eviction (a full clear) is a guard
 * against a future renderer widening the range, not a thing that happens in
 * play.
 */
const MAX_ENTRIES = 4096

/**
 * Scale is quantised before anything is computed from it, so the cached raster
 * and the `left`/`top` it is drawn at can never be derived from different
 * numbers. 1/256 puts roughly one bucket per pixel the sprite gains over the
 * whole approach — finer than the grid can express, which is what it must be,
 * or the quantisation would become the thing that limits growth.
 */
const SCALE_STEPS = 256

export interface ScaledVehicle {
  raster: readonly string[]
  left: number
  top: number
  w: number
  h: number
  /**
   * The dark outline and contact shadow drawn *behind* this vehicle, or `null`
   * when it is too small to carry them. Deliberately beside the raster rather
   * than inside it — see `vehicleContour.ts` for why collision must not see it.
   */
  contour: VehicleContour | null
}

export interface PhysicalSpriteSize {
  readonly w: number
  readonly h: number
}

export interface VehicleRasterOptions {
  /** Canonical projected box before scale; defaults to the source grid. */
  readonly physicalSize?: PhysicalSpriteSize
  /** A colour-only post-process such as the legacy far lamp overlay. */
  readonly refine?: (raster: readonly string[]) => readonly string[]
}

/** Cached geometry is relative to the anchor, which is why it caches at all. */
interface CachedScaled {
  raster: readonly string[]
  contour: VehicleContour | null
  dx: number
  dy: number
  w: number
  h: number
}

const scaledCache = new Map<string, CachedScaled | null>()

/** Cleared between tests so cache state cannot leak across cases. */
export function resetVehicleRasterCache(): void {
  scaledCache.clear()
}

export function vehicleRasterCacheSize(): number {
  return scaledCache.size
}

/**
 * The sprite drawn at a fractional scale, anchored bottom-centre on `anchorX` /
 * `anchorBottomY`.
 *
 * ── Why the integer box stopped being an input ──────────────────────────────
 * Rounding the projected span to whole pixels first made growth arrive a whole
 * column at a time. The input is now a canonical physical size and a fractional
 * scale; `w` and `h` are outputs. The source grid can independently be a small
 * far symbol or a double-resolution near drawing.
 *
 * Sampling at the true fractional size puts the sprite's edges between cells, so
 * each edge cell crosses the coverage threshold at its own scale and the drawing
 * grows a pixel at a time. `w` and `h` are the containing screen box read back
 * from that projected span.
 *
 * Returns `null` when nothing survives the threshold — the caller draws nothing.
 */
export function rasteriseVehicleAtScale(
  assetId: string,
  rows: readonly string[],
  scale: number,
  anchorX: number,
  anchorBottomY: number,
  options: VehicleRasterOptions = {},
): ScaledVehicle | null {
  if (rows.length === 0 || scale <= 0) return null

  const sourceW = rows[0]?.length ?? 0
  const physicalW = options.physicalSize?.w ?? sourceW
  const physicalH = options.physicalSize?.h ?? rows.length
  if (sourceW === 0 || physicalW <= 0 || physicalH <= 0) return null

  // Quantise once, then derive everything from the quantised value — the raster
  // and the position it is drawn at must come from the same number.
  const steps = Math.max(1, Math.round(scale * SCALE_STEPS))
  const quantised = steps / SCALE_STEPS
  const cacheKey = `${assetId}@${steps}`

  let hit = scaledCache.get(cacheKey)
  if (hit === undefined) {
    // Cached relative to the anchor. `left - anchorX` and `top - anchorBottomY`
    // depend only on the scale, because both anchors are whole pixels, so one
    // entry serves the vehicle wherever it sits on the road.
    const built = resampleSpriteAtSpan(
      rows,
      physicalW * quantised,
      physicalH * quantised,
      0,
      0,
    )
    hit = built === null
      ? null
      : {
        // `refine` may only recolour — the cached `w`/`h` come from the
        // untouched silhouette, and both tiers must agree on them.
        raster: options.refine ? options.refine(built.raster) : built.raster,
        // Derived from the silhouette, which `refine` may not change, so the
        // far and detail flavours of one scale get identical contours.
        contour: buildVehicleContour(built.raster),
        dx: built.left, dy: built.top, w: built.w, h: built.h,
      }
    if (scaledCache.size >= MAX_ENTRIES) scaledCache.clear()
    scaledCache.set(cacheKey, hit)
  }
  if (hit === null) return null

  return {
    raster: hit.raster,
    contour: hit.contour,
    left: anchorX + hit.dx,
    top: anchorBottomY + hit.dy,
    w: hit.w,
    h: hit.h,
  }
}
