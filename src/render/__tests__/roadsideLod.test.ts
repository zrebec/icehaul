import { describe, expect, it } from 'vitest'
import {
  SCENERY_CANONICAL_SIZE,
  SCENERY_SCALE_FAR, SCENERY_SCALE_FAR_Z_M,
  SCENERY_SCALE_NEAR, SCENERY_SCALE_NEAR_Z_M,
  VIEWPORT_BOTTOM, VIEWPORT_TOP,
} from '../../config.ts'
import type { RoadsideObject, RoadsideType } from '../../game/roadside.ts'
import {
  chooseSceneryLod, quantiseRoadsideScale, roadsideScaleForDepth,
} from '../roadsideRaster.ts'
import { drawRoadsideObjects, projectRoadsideObjects } from '../road3d.ts'
import { getRoadsideSprite, roadsideSpriteName } from '../sprites/catalog.ts'
import { rasteriseRoadsideAtScale } from '../roadsideRaster.ts'
import type { LodTier } from '../vehicleLod.ts'

const TYPES: readonly RoadsideType[] = ['deciduous', 'conifer', 'rocks', 'sign', 'lamp']
const DISTANCES = [220, 120, 80, 50, 25, 20, 10, 3] as const
const noCurve = () => 0

function objectAt(type: RoadsideType, distM: number): RoadsideObject {
  return { distM, side: 1, type, band: 'verge', offsetRoadWidths: 0.15 }
}

describe('scenery scale and LOD', () => {
  it('passes through both solved scale anchors', () => {
    expect(roadsideScaleForDepth(SCENERY_SCALE_FAR_Z_M)).toBeCloseTo(SCENERY_SCALE_FAR, 12)
    expect(roadsideScaleForDepth(SCENERY_SCALE_NEAR_Z_M)).toBeCloseTo(SCENERY_SCALE_NEAR, 12)
  })

  it('grows throughout the full approach instead of holding a far plateau', () => {
    const scales = DISTANCES.map(roadsideScaleForDepth)
    expect(new Set(scales).size).toBe(DISTANCES.length)
    for (let index = 1; index < scales.length; index++) {
      expect(scales[index], `${DISTANCES[index]}m`).toBeGreaterThan(scales[index - 1]!)
    }
  })

  it('uses far, mid, and near at the specified scale thresholds', () => {
    expect(chooseSceneryLod(0.30)).toBe('far')
    expect(chooseSceneryLod(0.3001)).toBe('mid')
    expect(chooseSceneryLod(0.50)).toBe('mid')
    expect(chooseSceneryLod(0.5001)).toBe('near')

    expect(DISTANCES.map(distance => chooseSceneryLod(roadsideScaleForDepth(distance))))
      .toEqual(['far', 'far', 'far', 'mid', 'mid', 'near', 'near', 'near'])
  })
})

describe('authored roadside projection', () => {
  it.each(TYPES)('%s reaches all three authored tiers', (type) => {
    const seen = new Set<LodTier>()
    for (const distance of DISTANCES) {
      const projection = projectRoadsideObjects(
        VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, [objectAt(type, distance)], noCurve,
      )[0]!
      seen.add(projection.lod)
    }
    expect(seen).toEqual(new Set<LodTier>(['far', 'mid', 'near']))
  })

  it.each(TYPES)('%s keeps authored resolution out of its physical box', (type) => {
    for (const distance of DISTANCES) {
      const projection = projectRoadsideObjects(
        VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, [objectAt(type, distance)], noCurve,
      )[0]!
      const physical = SCENERY_CANONICAL_SIZE[type]
      const scale = quantiseRoadsideScale(roadsideScaleForDepth(distance))
      expect(projection.w, `${distance}m width`).toBe(Math.ceil(physical.w * scale))
      expect(projection.h, `${distance}m height`).toBe(Math.ceil(physical.h * scale))
      expect(projection.raster).toHaveLength(projection.h)
      for (const row of projection.raster) expect(row).toHaveLength(projection.w)
      expect(projection.top + projection.h).toBe(projection.y)
    }
  })

  it.each(TYPES)('%s resamples exactly the selected JSON asset', (type) => {
    for (const distance of [220, 50, 3]) {
      const projection = projectRoadsideObjects(
        VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, [objectAt(type, distance)], noCurve,
      )[0]!
      const sprite = getRoadsideSprite(type, projection.lod)
      const expected = rasteriseRoadsideAtScale(
        `expected:${roadsideSpriteName(type, projection.lod)}`,
        sprite.rows,
        projection.scale,
        projection.x,
        projection.y,
        SCENERY_CANONICAL_SIZE[type],
        type === 'lamp' ? ['Y'] : [],
      )!
      expect(projection.raster).toEqual(expected.raster)
    }
  })

  it('keeps the authored yellow lamp head at every sampled distance', () => {
    for (const distance of DISTANCES) {
      const projection = projectRoadsideObjects(
        VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, [objectAt('lamp', distance)], noCurve,
      )[0]!
      expect(projection.raster.join(''), `${distance}m ${projection.w}x${projection.h}`).toContain('Y')
    }
  })

  it('sorts every type together from farthest to nearest', () => {
    const objects = [
      objectAt('lamp', 20), objectAt('deciduous', 200), objectAt('sign', 50),
      objectAt('rocks', 120), objectAt('conifer', 80),
    ]
    const projected = projectRoadsideObjects(
      VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, objects, noCurve,
    )
    expect(projected.map(item => item.worldZ)).toEqual([200, 120, 80, 50, 20])
    expect(projected.map(item => item.type)).toEqual(['deciduous', 'rocks', 'conifer', 'sign', 'lamp'])
  })

  it('draws authored sprites as horizontal spans, including the lamp', () => {
    const widths: number[] = []
    const ctx = {
      fillStyle: '',
      fillRect: (_x: number, _y: number, width: number) => widths.push(width),
    } as unknown as CanvasRenderingContext2D
    drawRoadsideObjects(
      ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0,
      TYPES.map(type => objectAt(type, 3)), noCurve,
    )
    expect(widths.length).toBeGreaterThan(0)
    expect(widths.some(width => width > 1)).toBe(true)
  })
})
