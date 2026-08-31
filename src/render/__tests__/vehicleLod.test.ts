import { describe, it, expect } from 'vitest'
import { C } from 'zx-kit'
import { chooseLodTier, type LodTier } from '../vehicleLod.ts'
import { projectTrafficVehicle } from '../road3d.ts'
import { rasteriseVehicleAtScale, resetVehicleRasterCache } from '../vehicleRaster.ts'
import { getTrafficSprite, trafficSpriteName } from '../sprites/catalog.ts'
import {
  LOD_FAR_MAX_HEIGHT, LOD_MID_MAX_HEIGHT, LOD_HYSTERESIS_PX,
  TRAFFIC_CANONICAL_SIZE, VIEWPORT_BOTTOM, VIEWPORT_TOP,
} from '../../config.ts'
import type { TrafficDir, TrafficVehicle, VehicleType } from '../../game/traffic.ts'

const noCurve = () => 0
const veh = (distM: number, dir: TrafficDir, type: VehicleType): TrafficVehicle =>
  ({ spawnDist: 0, distM, x: 0, speed: 0, dir, type, gone: false })

describe('chooseLodTier', () => {
  it('starts on the two plain thresholds when nothing was drawn before', () => {
    expect(chooseLodTier(LOD_FAR_MAX_HEIGHT - 1)).toBe('far')
    expect(chooseLodTier(LOD_FAR_MAX_HEIGHT)).toBe('far')
    expect(chooseLodTier(LOD_FAR_MAX_HEIGHT + 1)).toBe('mid')
    expect(chooseLodTier(LOD_MID_MAX_HEIGHT)).toBe('mid')
    expect(chooseLodTier(LOD_MID_MAX_HEIGHT + 1)).toBe('near')
  })

  it('holds its tier inside both dead-bands', () => {
    // The band is what stops a braking vehicle, whose projected height wobbles by
    // a pixel, from flickering between two different drawings every frame.
    for (let h = LOD_FAR_MAX_HEIGHT - LOD_HYSTERESIS_PX; h <= LOD_FAR_MAX_HEIGHT + LOD_HYSTERESIS_PX; h++) {
      expect(chooseLodTier(h, 'far'), `h=${h} from far`).toBe('far')
      expect(chooseLodTier(h, 'mid'), `h=${h} from mid`).toBe('mid')
    }
    for (let h = LOD_MID_MAX_HEIGHT - LOD_HYSTERESIS_PX; h <= LOD_MID_MAX_HEIGHT + LOD_HYSTERESIS_PX; h++) {
      expect(chooseLodTier(h, 'mid'), `h=${h} from mid`).toBe('mid')
      expect(chooseLodTier(h, 'near'), `h=${h} from near`).toBe('near')
    }
  })

  it('switches once either band is cleared, in both directions', () => {
    expect(chooseLodTier(LOD_FAR_MAX_HEIGHT + LOD_HYSTERESIS_PX + 1, 'far')).toBe('mid')
    expect(chooseLodTier(LOD_FAR_MAX_HEIGHT - LOD_HYSTERESIS_PX - 1, 'mid')).toBe('far')
    expect(chooseLodTier(LOD_MID_MAX_HEIGHT + LOD_HYSTERESIS_PX + 1, 'mid')).toBe('near')
    expect(chooseLodTier(LOD_MID_MAX_HEIGHT - LOD_HYSTERESIS_PX - 1, 'near')).toBe('mid')
  })

  it('can skip a tier after a large height jump', () => {
    expect(chooseLodTier(LOD_MID_MAX_HEIGHT + LOD_HYSTERESIS_PX + 1, 'far')).toBe('near')
    expect(chooseLodTier(LOD_FAR_MAX_HEIGHT - LOD_HYSTERESIS_PX - 1, 'near')).toBe('far')
  })

  it('cannot oscillate: one crossing per boundary in either direction', () => {
    // Walk a vehicle in and back out again, feeding each answer to the next call.
    let tier = chooseLodTier(4)
    const seen: string[] = [tier]
    for (const h of [5, 6, 7, 8, 9, 11, 13, 14, 15, 14, 13, 12, 11, 9, 7, 6, 5]) {
      tier = chooseLodTier(h, tier)
      if (tier !== seen[seen.length - 1]) seen.push(tier)
    }
    expect(seen).toEqual(['far', 'mid', 'near', 'mid', 'far'])
  })
})

describe('authored traffic tiers', () => {
  const DIRS: readonly TrafficDir[] = ['same', 'oncoming']
  const TYPES: readonly VehicleType[] = ['mini', 'car', 'bus']
  const TIERS: readonly LodTier[] = ['far', 'mid', 'near']

  it('puts the correct pair of lamps in every authored asset', () => {
    for (const dir of DIRS) {
      const lamp = dir === 'same' ? 'R' : 'Y'
      const wrong = dir === 'same' ? 'Y' : 'R'
      for (const type of TYPES) {
        for (const tier of TIERS) {
          const body = getTrafficSprite(dir, type, tier).rows.join('')
          expect(body, `${dir}/${type}/${tier} has no ${lamp}`).toContain(lamp)
          if (dir === 'oncoming') {
            expect(body, `${dir}/${type}/${tier} contains rear lamp ${wrong}`).not.toContain(wrong)
          }
        }
      }
    }
  })

  it('changes only rear R when braking, in every tier', () => {
    for (const type of TYPES) {
      for (const tier of TIERS) {
        const rolling = getTrafficSprite('same', type, tier)
        const braking = getTrafficSprite('same', type, tier, true)
        expect(rolling.colors.R, `${type}/${tier} rolling`).toBe(C.RED)
        expect(braking.colors.R, `${type}/${tier} braking`).toBe(C.B_RED)
        for (const char of Object.keys(rolling.colors)) {
          if (char !== 'R') expect(braking.colors[char], `${type}/${tier}/${char}`).toBe(rolling.colors[char])
        }

        const front = getTrafficSprite('oncoming', type, tier)
        expect(getTrafficSprite('oncoming', type, tier, true)).toBe(front)
      }
    }
  })
})

describe('the projected authored tiers', () => {
  it('shows both lamps at every distance and type the far tier covers', () => {
    resetVehicleRasterCache()
    let covered = 0
    const failures: string[] = []
    for (const dir of ['same', 'oncoming'] as TrafficDir[]) {
      const lamp = dir === 'same' ? 'R' : 'Y'
      for (const type of ['mini', 'car', 'bus'] as VehicleType[]) {
        for (const dist of [220, 180, 150, 120, 100, 80, 60, 50, 40, 30]) {
          const p = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, veh(dist, dir, type), noCurve)!
          if (p.lod !== 'far') continue
          covered++
          // A row whose *outermost body pixels* are both lamp colour. Searching
          // for the colour alone would not do: the source art has rear lamps and
          // indicators in the middle of the bodywork, and those are exactly the
          // pixels the resample cannot be trusted to keep. The pair at the ends
          // is the overlay, and it is what carries direction at this size.
          const flanked = p.raster.some(row => {
            const body = row.split('').map((c, i) => (c === '.' ? -1 : i)).filter(i => i >= 0)
            return body.length > 0
              && row[body[0]!] === lamp
              && row[body[body.length - 1]!] === lamp
          })
          if (!flanked) {
            failures.push(`${dir}/${type} at ${dist}m (${p.w}x${p.h}): ${p.raster.join('/')}`)
          }
        }
      }
    }
    expect(covered, 'no far-tier cases were exercised').toBeGreaterThan(30)
    expect(failures).toEqual([])
  })

  it('uses all three tiers in monotonic order during an approach', () => {
    for (const dir of ['same', 'oncoming'] as TrafficDir[]) {
      for (const type of ['mini', 'car', 'bus'] as VehicleType[]) {
        const vehicle = veh(220, dir, type)
        const seen: LodTier[] = []
        for (let dist = 220; dist >= 2; dist -= 0.25) {
          vehicle.distM = dist
          const p = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, vehicle, noCurve)!
          if (seen.at(-1) !== p.lod) seen.push(p.lod)
        }
        expect(seen, `${dir}/${type}`).toEqual(['far', 'mid', 'near'])
      }
    }
  })

  it('resamples the selected authored asset, not a shared fallback drawing', () => {
    for (const dir of ['same', 'oncoming'] as TrafficDir[]) {
      for (const type of ['mini', 'car', 'bus'] as VehicleType[]) {
        const vehicle = veh(220, dir, type)
        const projected = new Map<LodTier, NonNullable<ReturnType<typeof projectTrafficVehicle>>>()
        for (let dist = 220; dist >= 2 && projected.size < 3; dist -= 0.25) {
          vehicle.distM = dist
          const p = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, vehicle, noCurve)!
          if (!projected.has(p.lod)) projected.set(p.lod, p)
        }

        for (const lod of ['far', 'mid', 'near'] as const) {
          const p = projected.get(lod)!
          const sprite = getTrafficSprite(dir, type, lod)
          const expected = rasteriseVehicleAtScale(
            `expected:${trafficSpriteName(dir, type, lod)}`,
            sprite.rows,
            p.scale,
            p.x,
            p.y,
            {
              physicalSize: TRAFFIC_CANONICAL_SIZE[type],
              priorityChars: [dir === 'same' ? 'R' : 'Y'],
            },
          )!
          expect(p.raster, `${dir}/${type}/${lod}`).toEqual(expected.raster)
          expect({ left: p.left, top: p.top, w: p.w, h: p.h })
            .toEqual({ left: expected.left, top: expected.top, w: expected.w, h: expected.h })
        }
      }
    }
  })
})
