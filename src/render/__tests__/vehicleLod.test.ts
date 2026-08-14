import { describe, it, expect } from 'vitest'
import { buildFarRaster, chooseLodTier } from '../vehicleLod.ts'
import { getTrafficRaster, projectTrafficVehicle } from '../road3d.ts'
import { resetVehicleRasterCache } from '../vehicleRaster.ts'
import { LOD_FAR_MAX_HEIGHT, LOD_HYSTERESIS_PX, VIEWPORT_BOTTOM, VIEWPORT_TOP } from '../../config.ts'
import type { TrafficDir, TrafficVehicle, VehicleType } from '../../game/traffic.ts'

const noCurve = () => 0
const veh = (distM: number, dir: TrafficDir, type: VehicleType): TrafficVehicle =>
  ({ spawnDist: 0, distM, x: 0, speed: 0, dir, type, gone: false })

describe('chooseLodTier', () => {
  it('starts on the plain threshold when nothing was drawn before', () => {
    expect(chooseLodTier(LOD_FAR_MAX_HEIGHT)).toBe('far')
    expect(chooseLodTier(LOD_FAR_MAX_HEIGHT + 1)).toBe('detail')
  })

  it('holds its tier inside the dead-band', () => {
    // The band is what stops a braking vehicle, whose projected height wobbles by
    // a pixel, from flickering between two different drawings every frame.
    for (let h = LOD_FAR_MAX_HEIGHT - LOD_HYSTERESIS_PX; h <= LOD_FAR_MAX_HEIGHT + LOD_HYSTERESIS_PX; h++) {
      expect(chooseLodTier(h, 'far'), `h=${h} from far`).toBe('far')
      expect(chooseLodTier(h, 'detail'), `h=${h} from detail`).toBe('detail')
    }
  })

  it('switches once the band is cleared, in both directions', () => {
    expect(chooseLodTier(LOD_FAR_MAX_HEIGHT + LOD_HYSTERESIS_PX + 1, 'far')).toBe('detail')
    expect(chooseLodTier(LOD_FAR_MAX_HEIGHT - LOD_HYSTERESIS_PX - 1, 'detail')).toBe('far')
  })

  it('cannot oscillate: one crossing per approach', () => {
    // Walk a vehicle in and back out again, feeding each answer to the next call.
    let tier = chooseLodTier(4)
    const seen: string[] = [tier]
    for (const h of [5, 6, 7, 8, 9, 10, 11, 12, 11, 10, 9, 8, 7, 6]) {
      tier = chooseLodTier(h, tier)
      if (tier !== seen[seen.length - 1]) seen.push(tier)
    }
    // far -> detail -> far, and nothing in between.
    expect(seen).toEqual(['far', 'detail', 'far'])
  })
})

describe('buildFarRaster', () => {
  const SIZES: Array<[number, number]> = [
    [3, 3], [4, 3], [5, 4], [6, 4], [8, 6], [9, 6], [11, 7], [13, 9],
  ]

  it('is exactly the size asked for', () => {
    for (const [w, h] of SIZES) {
      const r = buildFarRaster('same', w, h)
      expect(r, `${w}x${h}`).toHaveLength(h)
      for (const row of r) expect(row, `${w}x${h}`).toHaveLength(w)
    }
  })

  it('always shows both lamps, at every size the far tier can ask for', () => {
    // The regression that motivated composing this instead of resampling a
    // sprite: a mini at 220 m projects to 5 x 4, the source was 7 x 5, and the
    // dominant-colour vote deleted the lamps in the one place they matter.
    for (const dir of ['same', 'oncoming'] as TrafficDir[]) {
      const lamp = dir === 'same' ? 'R' : 'Y'
      for (const [w, h] of SIZES) {
        const rows = buildFarRaster(dir, w, h)
        const row = rows.find(r => r.includes(lamp))
        expect(row, `${dir} ${w}x${h} has no ${lamp}`).toBeDefined()
        expect(row![0], `${dir} ${w}x${h} left lamp`).toBe(lamp)
        expect(row![row!.length - 1], `${dir} ${w}x${h} right lamp`).toBe(lamp)
      }
    }
  })

  it('carries direction in the lamp colour and nothing else', () => {
    // Body colour cannot do this job: a same-direction bus is red bodywork, so
    // "red means going away" only holds if it is the lamps that are red.
    expect(buildFarRaster('same', 8, 6).join('')).toContain('R')
    expect(buildFarRaster('same', 8, 6).join('')).not.toContain('Y')
    expect(buildFarRaster('oncoming', 8, 6).join('')).toContain('Y')
    expect(buildFarRaster('oncoming', 8, 6).join('')).not.toContain('R')
  })

  it('is mostly body, so the blob still reads as a vehicle', () => {
    for (const [w, h] of SIZES) {
      const rows = buildFarRaster('same', w, h)
      const body = rows.join('').split('X').length - 1
      expect(body / (w * h), `${w}x${h}`).toBeGreaterThan(0.4)
    }
  })

  it('refuses a degenerate size rather than inventing one', () => {
    expect(buildFarRaster('same', 0, 5)).toEqual([])
    expect(buildFarRaster('same', 5, 0)).toEqual([])
  })
})

describe('the far tier keeps direction readable', () => {
  it('shows both lamps at every distance and type the far tier covers', () => {
    resetVehicleRasterCache()
    let covered = 0
    for (const dir of ['same', 'oncoming'] as TrafficDir[]) {
      const lamp = dir === 'same' ? 'R' : 'Y'
      for (const type of ['mini', 'car', 'bus'] as VehicleType[]) {
        for (const dist of [220, 180, 150, 120, 100, 80, 60, 50, 40, 30]) {
          const p = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, veh(dist, dir, type), noCurve)!
          if (p.lod !== 'far') continue
          covered++
          const raster = getTrafficRaster(dir, type, p.w, p.h, p.lod)
          const row = raster.find(r => r.includes(lamp))
          expect(row, `${dir}/${type} at ${dist}m (${p.w}x${p.h}) has no ${lamp}`).toBeDefined()
          expect(row![0], `${dir}/${type} at ${dist}m left lamp`).toBe(lamp)
          expect(row![row!.length - 1], `${dir}/${type} at ${dist}m right lamp`).toBe(lamp)
        }
      }
    }
    expect(covered, 'no far-tier cases were exercised').toBeGreaterThan(30)
  })

  it('is actually used across most of the approach', () => {
    const tiers = [220, 150, 100, 50, 25, 10, 2].map(d =>
      projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, veh(d, 'same', 'car'), noCurve)!.lod)
    expect(tiers.filter(t => t === 'far').length).toBeGreaterThanOrEqual(4)
    expect(tiers[tiers.length - 1]).toBe('detail')   // right beside you it is the sprite
  })
})
