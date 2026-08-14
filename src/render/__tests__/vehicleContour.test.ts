/**
 * The dark pass: a one-pixel outline and a contact shadow behind each vehicle.
 *
 * Two things have to stay true, and they pull in opposite directions. The
 * outline has to actually enclose the silhouette, or a pale vehicle still
 * dissolves into snow — and it must not become the picture, or a distant blob
 * reads as bigger than it is and the growth curve stops meaning anything.
 *
 * A third is a correctness rule rather than an aesthetic one: the contour is not
 * the vehicle. It never reaches the raster, so the collision box is exactly what
 * it was before the outline existed.
 */

import { describe, it, expect } from 'vitest'
import { buildVehicleContour, CONTOUR_CHAR } from '../vehicleContour.ts'
import { contourEnabledFromSearch } from '../debug/trafficMatrix.ts'
import { projectTrafficVehicle } from '../road3d.ts'
import { resetVehicleRasterCache } from '../vehicleRaster.ts'
import {
  CONTOUR_MIN_HEIGHT, SHADOW_MIN_HEIGHT, VIEWPORT_BOTTOM, VIEWPORT_TOP,
} from '../../config.ts'
import type { TrafficDir, TrafficVehicle, VehicleType } from '../../game/traffic.ts'

const noCurve = () => 0
const DIRS: readonly TrafficDir[] = ['same', 'oncoming']
const TYPES: readonly VehicleType[] = ['mini', 'car', 'bus']
const DISTANCES = [220, 150, 100, 60, 40, 25, 10, 5, 2]

const project = (distM: number, dir: TrafficDir, type: VehicleType) =>
  projectTrafficVehicle(
    VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0,
    { spawnDist: 0, distM, x: 0, speed: 0, dir, type, gone: false } as TrafficVehicle,
    noCurve,
  )

/** A shape with a roofline, a wheel gap and a notch — the awkward cases at once. */
const CAR = [
  '..XXXX..',
  '.XXXXXX.',
  'XXXXXXXX',
  'XXXXXXXX',
  'XX....XX',
]

describe('buildVehicleContour', () => {
  it('refuses a vehicle too small to carry an outline', () => {
    const tiny = Array.from({ length: CONTOUR_MIN_HEIGHT - 1 }, () => 'XXX')
    expect(buildVehicleContour(tiny)).toBeNull()
    expect(buildVehicleContour([])).toBeNull()
  })

  it('never marks a cell the vehicle occupies', () => {
    // The outline goes *around* the silhouette. Marking a solid cell would eat a
    // body pixel, and at these sizes there are only about thirty that matter.
    const c = buildVehicleContour(CAR)!
    for (let y = 0; y < CAR.length; y++) {
      for (let x = 0; x < CAR[0]!.length; x++) {
        if (CAR[y]![x] === '.') continue
        expect(c.rows[y - c.dy]?.[x - c.dx], `solid cell (${x},${y})`).not.toBe(CONTOUR_CHAR)
      }
    }
  })

  it('encloses the silhouette on all four sides', () => {
    // CAR is below SHADOW_MIN_HEIGHT, so the outline owns every row including
    // the one under the wheels — the enclosure claim is about the outline alone.
    expect(CAR.length).toBeLessThan(SHADOW_MIN_HEIGHT)
    const c = buildVehicleContour(CAR)!
    const h = CAR.length
    const w = CAR[0]!.length
    const solid = (x: number, y: number) => CAR[y]?.[x] !== undefined && CAR[y]![x] !== '.'

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!solid(x, y)) continue
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
          if (solid(nx, ny)) continue
          expect(
            c.rows[ny - c.dy]?.[nx - c.dx],
            `unlit gap beside (${x},${y}) at (${nx},${ny})`,
          ).toBe(CONTOUR_CHAR)
        }
      }
    }
  })

  it('puts the contact shadow under the wheels, tapered at both ends', () => {
    // Wheels at the corners and a gap between them: the shadow has to bridge the
    // gap (or the car reads as two feet) and stop short of the corners (or it
    // reads as a plinth). That row is the shadow's alone — the outline skips it.
    const tall = ['..XXXX..', '.XXXXXX.', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XX....XX']
    expect(tall.length).toBeGreaterThanOrEqual(SHADOW_MIN_HEIGHT)
    const c = buildVehicleContour(tall)!

    const row = c.rows[tall.length - c.dy]!
    const lit = [...row].map((ch, i) => (ch === CONTOUR_CHAR ? i : -1)).filter(i => i >= 0)
    expect(lit.length, 'shadow row is empty').toBeGreaterThan(0)
    expect(lit.length, 'shadow reaches the full width of the body')
      .toBeLessThan(tall[0]!.length)
    // Contiguous — a shadow that copied the wheel gap would not be a ground line.
    expect(lit[lit.length - 1]! - lit[0]! + 1).toBe(lit.length)
  })

  it('leaves the row under a short vehicle to the outline, not the shadow', () => {
    // Between the two thresholds: tall enough to outline, too short to say where
    // "under the vehicle" stops and the vehicle starts. The outline still traces
    // the bottom edge — what is absent is a bar spanning the wheel gap.
    const short = ['XX..XX', 'XXXXXX', 'XXXXXX', 'XXXXXX', 'XX..XX']
    expect(short.length).toBeGreaterThanOrEqual(CONTOUR_MIN_HEIGHT)
    expect(short.length).toBeLessThan(SHADOW_MIN_HEIGHT)
    const c = buildVehicleContour(short)!
    const row = c.rows[short.length - c.dy]!
    // Under the wheels only: the gap between them stays open.
    expect(row).toBe('.##..##.')
  })
})

describe('the contour never reaches the vehicle', () => {
  it('keeps the collision raster free of contour cells', () => {
    resetVehicleRasterCache()
    for (const dir of DIRS) {
      for (const type of TYPES) {
        for (const dist of DISTANCES) {
          const p = project(dist, dir, type)!
          expect(p.raster.join(''), `${dir}/${type} at ${dist}m`).not.toContain(CONTOUR_CHAR)
        }
      }
    }
  })

  it('does not grow the box the collision check is given', () => {
    // The whole reason the contour is a parallel mask: were it inside the
    // raster, every hitbox would silently gain a pixel on all four sides and a
    // graphics change would have become a difficulty change.
    resetVehicleRasterCache()
    for (const dir of DIRS) {
      for (const type of TYPES) {
        for (const dist of DISTANCES) {
          const p = project(dist, dir, type)!
          expect(p.raster, `${dir}/${type} at ${dist}m rows`).toHaveLength(p.h)
          for (const row of p.raster) expect(row).toHaveLength(p.w)
          if (p.contour) {
            expect(p.contour.dx, 'contour starts outside the box').toBeLessThan(0)
            expect(p.contour.dy, 'contour starts outside the box').toBeLessThan(0)
          }
        }
      }
    }
  })
})

describe('the outline stays an edge, not the picture', () => {
  it('is always smaller than the vehicle it surrounds', () => {
    // The failure this guards against is specific: a halo costs roughly the
    // perimeter, and perimeter shrinks more slowly than area, so at some small
    // size the dark cells outnumber the bright ones and distance starts reading
    // as *bigger*. `CONTOUR_MIN_HEIGHT` is where that line was drawn.
    resetVehicleRasterCache()
    for (const dir of DIRS) {
      for (const type of TYPES) {
        for (const dist of DISTANCES) {
          const p = project(dist, dir, type)!
          if (!p.contour) continue
          const dark = p.contour.rows.join('').split(CONTOUR_CHAR).length - 1
          const solid = p.raster.join('').replace(/\./g, '').length
          expect(dark, `${dir}/${type} at ${dist}m (${p.w}x${p.h})`).toBeLessThan(solid)
        }
      }
    }
  })

  it('prints how much the dark pass costs at each distance', () => {
    resetVehicleRasterCache()
    console.log('\n  dark cells against the vehicle they surround, same/car')
    for (const dist of DISTANCES) {
      const p = project(dist, 'same', 'car')!
      const solid = p.raster.join('').replace(/\./g, '').length
      const dark = p.contour ? p.contour.rows.join('').split(CONTOUR_CHAR).length - 1 : 0
      console.log(
        `    ${String(dist).padStart(3)} m  ${p.w}x${p.h}`.padEnd(20) +
        `  body ${String(solid).padStart(3)}  dark ${String(dark).padStart(3)}` +
        `  ${p.contour ? `${(dark / solid * 100).toFixed(0)}%` : '— (below threshold)'}`,
      )
    }
    expect(true).toBe(true)
  })
})

describe('?outline=0', () => {
  it('is opt-out, and only on the exact string', () => {
    expect(contourEnabledFromSearch('')).toBe(true)
    expect(contourEnabledFromSearch('?outline=1')).toBe(true)
    expect(contourEnabledFromSearch('?outline=0')).toBe(false)
    // A typo must not silently change the picture a judgement is about to use.
    expect(contourEnabledFromSearch('?outline=false')).toBe(true)
    expect(contourEnabledFromSearch('?outline=')).toBe(true)
  })
})
