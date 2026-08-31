import {
  SCENERY_LOD_FAR_MAX_SCALE, SCENERY_LOD_MID_MAX_SCALE,
  SCENERY_SCALE_A, SCENERY_SCALE_B,
} from '../config.ts'
import { resampleSpriteAtSpan } from './spriteRaster.ts'
import type { LodTier } from './vehicleLod.ts'

const SCALE_STEPS = 256
const MAX_ENTRIES = 2048

export interface RoadsidePhysicalSize {
  readonly w: number
  readonly h: number
}

export interface RoadsideRaster {
  readonly raster: readonly string[]
  readonly left: number
  readonly top: number
  readonly w: number
  readonly h: number
}

interface CachedRoadsideRaster {
  readonly raster: readonly string[]
  readonly dx: number
  readonly dy: number
  readonly w: number
  readonly h: number
}

const cache = new Map<string, CachedRoadsideRaster | null>()

export function resetRoadsideRasterCache(): void {
  cache.clear()
}

export function roadsideScaleForDepth(worldZ: number): number {
  return SCENERY_SCALE_A / (worldZ + SCENERY_SCALE_B)
}

export function chooseSceneryLod(scale: number): LodTier {
  if (scale <= SCENERY_LOD_FAR_MAX_SCALE) return 'far'
  return scale <= SCENERY_LOD_MID_MAX_SCALE ? 'mid' : 'near'
}

export function quantiseRoadsideScale(scale: number): number {
  if (scale <= 0) return 0
  return Math.max(1, Math.round(scale * SCALE_STEPS)) / SCALE_STEPS
}

/** Fractional, bottom-centre raster independent of the selected source grid. */
export function rasteriseRoadsideAtScale(
  assetId: string,
  rows: readonly string[],
  scale: number,
  anchorX: number,
  anchorBottomY: number,
  physicalSize: RoadsidePhysicalSize,
  priorityChars: readonly string[] = [],
): RoadsideRaster | null {
  if (rows.length === 0 || physicalSize.w <= 0 || physicalSize.h <= 0) return null
  const quantised = quantiseRoadsideScale(scale)
  if (quantised <= 0) return null
  const steps = Math.round(quantised * SCALE_STEPS)
  const key = `${assetId}@${steps}:${priorityChars.join('')}`

  let hit = cache.get(key)
  if (hit === undefined) {
    const built = resampleSpriteAtSpan(
      rows,
      physicalSize.w * quantised,
      physicalSize.h * quantised,
      0,
      0,
      priorityChars,
    )
    hit = built === null
      ? null
      : { raster: built.raster, dx: built.left, dy: built.top, w: built.w, h: built.h }
    if (cache.size >= MAX_ENTRIES) cache.clear()
    cache.set(key, hit)
  }
  if (hit === null) return null

  return {
    raster: hit.raster,
    left: anchorX + hit.dx,
    top: anchorBottomY + hit.dy,
    w: hit.w,
    h: hit.h,
  }
}
