import { describe, it, expect } from 'vitest'
import { applyFarLamps, chooseLodTier } from '../vehicleLod.ts'
import { projectTrafficVehicle } from '../road3d.ts'
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

describe('applyFarLamps', () => {
  const SHAPES: Array<[string, readonly string[]]> = [
    ['tiny', ['.XX.', 'XXXX', 'XXXX']],
    ['tapered', ['.XXX.', 'XXXXX', 'XXXXX', 'XX.XX']],
    ['wide', ['..XXXXXX..', '.XXXXXXXX.', 'XXXXXXXXXX', 'XXXXXXXXXX', 'XX..XX..XX']],
  ]

  it('changes colour and never shape', () => {
    // The property the tier handover rests on. If the far tier could move a
    // pixel, crossing the boundary would be a redraw rather than a recolour, and
    // that used to be the single largest change in an approach.
    for (const dir of ['same', 'oncoming'] as TrafficDir[]) {
      for (const [name, rows] of SHAPES) {
        const out = applyFarLamps(rows, dir)
        const shape = (r: readonly string[]) => r.map(row => row.replace(/[^.]/g, 'X'))
        expect(shape(out), `${dir} ${name}`).toEqual(shape(rows))
      }
    }
  })

  it('puts a lamp at each end of one body row', () => {
    // The regression that motivated writing the lamps back on: a mini at 220 m
    // projects to about 4 x 3, and the dominant-colour vote deletes a one-pixel
    // lamp exactly where it is the only thing that matters. The ends are chosen
    // because an edge pixel survives where an interior one is swallowed.
    for (const dir of ['same', 'oncoming'] as TrafficDir[]) {
      const lamp = dir === 'same' ? 'R' : 'Y'
      for (const [name, rows] of SHAPES) {
        const out = applyFarLamps(rows, dir)
        const row = out.find(r => r.includes(lamp))
        expect(row, `${dir} ${name} has no ${lamp}`).toBeDefined()
        const body = row!.split('').map((c, i) => (c === '.' ? -1 : i)).filter(i => i >= 0)
        expect(row![body[0]!], `${dir} ${name} left lamp`).toBe(lamp)
        expect(row![body[body.length - 1]!], `${dir} ${name} right lamp`).toBe(lamp)
      }
    }
  })

  it('carries direction in the lamp colour and nothing else', () => {
    // Body colour cannot do this job: a same-direction bus is red bodywork, so
    // "red means going away" only holds if it is the lamps that are red.
    const plain = ['XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX']
    expect(applyFarLamps(plain, 'same').join('')).toContain('R')
    expect(applyFarLamps(plain, 'same').join('')).not.toContain('Y')
    expect(applyFarLamps(plain, 'oncoming').join('')).toContain('Y')
    expect(applyFarLamps(plain, 'oncoming').join('')).not.toContain('R')
  })

  it('is mostly body, so the blob still reads as a vehicle', () => {
    for (const [name, rows] of SHAPES) {
      const out = applyFarLamps(rows, 'same')
      const solid = out.join('').replace(/\./g, '')
      const body = solid.split('X').length - 1
      expect(body / solid.length, name).toBeGreaterThan(0.4)
    }
  })

  it('finds body to write on when the chosen row is a wheel gap', () => {
    // A car's wheel gap survives the resample, so the row one above the base can
    // be entirely transparent. Writing the lamps there would lose them.
    const rows = ['XXXXXX', 'XXXXXX', '......', 'XX..XX']
    const out = applyFarLamps(rows, 'same')
    expect(out.join('')).toContain('R')
    expect(out[2], 'the empty row must stay empty').toBe('......')
  })

  it('leaves a fully transparent raster alone rather than inventing a lamp', () => {
    expect(applyFarLamps(['....', '....'], 'same')).toEqual(['....', '....'])
    expect(applyFarLamps([], 'same')).toEqual([])
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
          expect(flanked, `${dir}/${type} at ${dist}m (${p.w}x${p.h}) has no flanking ${lamp} pair`).toBe(true)
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
