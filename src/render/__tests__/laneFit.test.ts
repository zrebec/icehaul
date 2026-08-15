/**
 * How wide a vehicle is drawn against the lane it is sitting in.
 *
 * Nobody had ever compared the two. Road width and vehicle size are separate
 * fakes — `half(z) = ROAD_HALF_TOP + 178.652/z` has an additive floor so the
 * road stays readable at the horizon, and `scale(z) = A/(z+B)` has an additive
 * offset so a vehicle never grows past `A/B` — and their ratio therefore goes to
 * zero at both ends and peaks in between, at `z* = sqrt(B * 178.652 / c0)`.
 *
 * With `c0 = 14` that peak was 20.9 m and a bus held **1.21 lanes** there: drawn
 * wider than the lane it occupied, from roughly 40 m down to 10 m. That is what
 * the owner reported as "wider than half the road".
 *
 * These tests hold the property, not the constant. `ROAD_HALF_TOP` is a
 * continuous dial and may be re-tuned by eye; what may not come back is a
 * vehicle overflowing its lane.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { projectTrafficVehicle } from '../road3d.ts'
import { resetVehicleRasterCache } from '../vehicleRaster.ts'
import { computeRoadEdges } from '../../game/roadgeometry.ts'
import {
  VIEWPORT_TOP, VIEWPORT_BOTTOM, TRAFFIC_SCALE_A, TRAFFIC_SCALE_B,
} from '../../config.ts'
import type { TrafficVehicle, TrafficDir, VehicleType } from '../../game/traffic.ts'

const noCurve = () => 0
const DIRS: readonly TrafficDir[] = ['same', 'oncoming']
const TYPES: readonly VehicleType[] = ['mini', 'car', 'bus']

/** Lane centres, so a vehicle is measured where the game actually puts it. */
const LANE_X: Record<TrafficDir, number> = { same: 0.5, oncoming: -0.5 }

const edgesAt = computeRoadEdges(0, 0, noCurve)

/**
 * Half the road at a screen row, asked of the same function off-road detection
 * uses rather than re-derived here — `projection.test.ts` keeps the renderer and
 * `roadgeometry.ts` in step the same way. `vehicle.x = ±1` is the road edge
 * (`road3d.ts:389`), so one lane is exactly this wide.
 */
function lanePx(screenY: number): number {
  const e = edgesAt(screenY)
  if (!e) throw new Error(`no road edges at y=${screenY}`)
  return (e.rightRoad - e.leftRoad) / 2
}

/** Columns actually painted, which is narrower than the box for a tapered sprite. */
function paintedWidth(raster: readonly string[]): number {
  let min = Infinity
  let max = -Infinity
  for (const row of raster) {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '.') continue
      if (x < min) min = x
      if (x > max) max = x
    }
  }
  return max < min ? 0 : max - min + 1
}

function project(distM: number, dir: TrafficDir, type: VehicleType) {
  const vehicle: TrafficVehicle = {
    spawnDist: 0, distM, x: LANE_X[dir], speed: 0, dir, type, gone: false,
  }
  return projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, vehicle, noCurve)
}

/** 220 m to 1.2 m in quarter-metre steps — fine enough to land on the peak. */
function sweep(dir: TrafficDir, type: VehicleType) {
  const out: Array<{ z: number; painted: number; box: number; lane: number }> = []
  for (let z = 220; z >= 1.2; z -= 0.25) {
    const p = project(z, dir, type)
    if (!p) continue
    out.push({ z, painted: paintedWidth(p.raster), box: p.w, lane: lanePx(p.y) })
  }
  return out
}

describe('a vehicle fits the lane it sits in', () => {
  beforeEach(resetVehicleRasterCache)

  it.each(DIRS.flatMap(dir => TYPES.map(type => [dir, type] as const)))(
    'never draws %s/%s wider than its lane', (dir, type) => {
      for (const { z, painted, box, lane } of sweep(dir, type)) {
        expect(painted, `${dir}/${type} painted at ${z.toFixed(2)}m`).toBeLessThanOrEqual(lane)
        // One pixel of slack for the box, which is `ceil(span)` around a sprite
        // that may not paint its outermost column.
        expect(box, `${dir}/${type} box at ${z.toFixed(2)}m`).toBeLessThanOrEqual(lane + 1)
      }
    })

  it('keeps every type under a lane with margin to spare', () => {
    // A bus used to peak at 1.21. The margin is what stops a re-tune of
    // ROAD_HALF_TOP from quietly walking back to an overflowing lane.
    for (const dir of DIRS) {
      for (const type of TYPES) {
        const peak = Math.max(...sweep(dir, type).map(s => s.painted / s.lane))
        expect(peak, `${dir}/${type} peak lane share`).toBeLessThanOrEqual(0.90)
      }
    }
  })

  it('peaks in the middle of the approach, not at either end', () => {
    // Structural, and worth stating rather than discovering: the ratio is zero
    // at both limits, so it must peak in between. A flat ratio is not available
    // — `half` grows only 1.19x from 220 m to 50 m, so pinning size to it would
    // reinstate exactly the flat far field #30 was built to remove.
    for (const dir of DIRS) {
      for (const type of TYPES) {
        const s = sweep(dir, type)
        const shares = s.map(e => e.painted / e.lane)
        const peakAt = shares.indexOf(Math.max(...shares))
        expect(peakAt, `${dir}/${type} peak is not at the far end`).toBeGreaterThan(0)
        expect(peakAt, `${dir}/${type} peak is not at the near end`).toBeLessThan(shares.length - 1)
      }
    }
  })

  it('keeps mini < car < bus at every depth', () => {
    for (const dir of DIRS) {
      for (let z = 220; z >= 1.2; z -= 0.5) {
        const w = TYPES.map(type => project(z, dir, type)?.w ?? 0)
        expect(w[0]!, `${dir} mini < car at ${z}m`).toBeLessThanOrEqual(w[1]!)
        expect(w[1]!, `${dir} car < bus at ${z}m`).toBeLessThanOrEqual(w[2]!)
      }
    }
  })
})

describe('widening the road did not touch vehicle scale', () => {
  beforeEach(resetVehicleRasterCache)

  // The whole reason this lever was chosen over reshaping the scale curve: the
  // growth curve (#30), the approach cadence (#34), the LOD thresholds and every
  // collision raster had to stay byte-identical. Compared against the solved
  // hyperbola itself rather than against copied-out numbers, so a future re-tune
  // of the anchors moves this test with it and a stray road change does not.
  it.each([220, 100, 50, 25, 10, 2, 1.2])('still reads the solved curve at %sm', (z) => {
    const p = project(z, 'same', 'car')
    expect(p!.scale).toBeCloseTo(TRAFFIC_SCALE_A / (z + TRAFFIC_SCALE_B), 9)
  })
})
