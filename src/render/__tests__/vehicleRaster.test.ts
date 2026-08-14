/**
 * The contract this module exists for: what is drawn and what collides are the
 * same set of pixels. Before the shared raster they were resampled in opposite
 * directions and never agreed — 45 pixels of invisible hitbox at a metre, and 19
 * visible pixels that passed straight through.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { getTrafficRaster, projectTrafficVehicle } from '../road3d.ts'
import { rasteriseVehicle, resetVehicleRasterCache, vehicleRasterCacheSize } from '../vehicleRaster.ts'
import { checkTruckTrafficCollision } from '../../game/offroad.ts'
import { bitmapPixelMask } from 'zx-kit'
import { TRUCK_BMP_H, TRUCK_BMP_W, TRUCK_COLLISION_BMP } from '../truck.ts'
import { VIEWPORT_BOTTOM, VIEWPORT_TOP } from '../../config.ts'
import type { TrafficDir, TrafficVehicle, VehicleType } from '../../game/traffic.ts'

const noCurve = () => 0
const DISTANCES = [220, 100, 50, 25, 10, 5, 2, 1]

const veh = (distM: number, dir: TrafficDir, type: VehicleType): TrafficVehicle =>
  ({ spawnDist: 0, distM, x: 0, speed: 0, dir, type, gone: false })

beforeEach(resetVehicleRasterCache)

describe('rasteriseVehicle', () => {
  it('produces exactly the requested target size', () => {
    const raster = rasteriseVehicle('t', ['XXXX', 'X..X', 'XXXX'], 7, 5)
    expect(raster).toHaveLength(5)
    for (const row of raster) expect(row).toHaveLength(7)
  })

  it('is deterministic — the same request gives the same pixels', () => {
    const a = rasteriseVehicle('t', ['XX.', '.XX'], 6, 4)
    resetVehicleRasterCache()
    const b = rasteriseVehicle('t', ['XX.', '.XX'], 6, 4)
    expect(b).toEqual(a)
  })

  it('caches by sprite identity and size', () => {
    const rows = ['XX', 'XX']
    rasteriseVehicle('a', rows, 4, 4)
    expect(vehicleRasterCacheSize()).toBe(1)
    rasteriseVehicle('a', rows, 4, 4)
    expect(vehicleRasterCacheSize()).toBe(1)   // same key, no growth
    rasteriseVehicle('a', rows, 5, 4)
    expect(vehicleRasterCacheSize()).toBe(2)   // different size
    rasteriseVehicle('b', rows, 4, 4)
    expect(vehicleRasterCacheSize()).toBe(3)   // different sprite
  })

  it('never returns rows for a degenerate size', () => {
    expect(rasteriseVehicle('t', ['XX'], 0, 4)).toEqual([])
    expect(rasteriseVehicle('t', ['XX'], 4, 0)).toEqual([])
    expect(rasteriseVehicle('t', [], 4, 4)).toEqual([])
  })
})

describe('the drawn pixels are the colliding pixels', () => {
  const truckMask = bitmapPixelMask(TRUCK_COLLISION_BMP)
  const probeRow = truckMask.rows.findIndex(r => r.length > 0)
  const probeCol = truckMask.rows[probeRow]![0]!

  /**
   * What "collides" must mean, written from the *drawing* side: a screen pixel is
   * solid iff the raster cell painted there is not transparent. This is the whole
   * contract — and stating it independently is the point, because the previous
   * implementation looked just as obviously correct while resampling the sprite a
   * second time, in the opposite direction, and disagreeing with the screen at
   * every distance.
   */
  function expectedHit(
    truckX: number, truckY: number,
    p: { left: number; top: number; w: number; h: number },
    raster: readonly string[],
  ): boolean {
    for (let row = 0; row < truckMask.height; row++) {
      const screenY = truckY + row
      if (screenY < p.top || screenY >= p.top + p.h) continue
      const rasterRow = raster[screenY - p.top]
      for (const col of truckMask.rows[row]!) {
        const screenX = truckX + col
        if (screenX < p.left || screenX >= p.left + p.w) continue
        const ch = rasterRow?.[screenX - p.left]
        if (ch && ch !== '.') return true
      }
    }
    return false
  }

  it('agrees with the drawn raster at every offset across a full pass', () => {
    let checked = 0
    let hits = 0

    for (const dir of ['same', 'oncoming'] as TrafficDir[]) {
      for (const type of ['mini', 'car', 'bus'] as VehicleType[]) {
        for (const dist of DISTANCES) {
          const p = projectTrafficVehicle(
            VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, veh(dist, dir, type), noCurve,
          )
          expect(p, `${dir}/${type} at ${dist}m must project`).not.toBeNull()
          const raster = getTrafficRaster(dir, type, p!.w, p!.h, p!.lod)

          // The raster covers the projected rect exactly: collision can neither
          // see a pixel outside the drawn area nor miss one inside it.
          expect(raster, `${dir}/${type} at ${dist}m rows`).toHaveLength(p!.h)
          for (const row of raster) expect(row).toHaveLength(p!.w)

          // Sweep the truck across and through the vehicle, including the misses
          // on either side, so both answers are exercised.
          for (let dx = -TRUCK_BMP_W; dx <= p!.w + TRUCK_BMP_W; dx += 3) {
            for (let dy = -TRUCK_BMP_H; dy <= p!.h + TRUCK_BMP_H; dy += 5) {
              const tx = p!.left + dx
              const ty = p!.top + dy
              const actual = checkTruckTrafficCollision(tx, ty, p!.left, p!.top, p!.w, p!.h, raster)
              const expected = expectedHit(tx, ty, p!, raster)
              expect(actual, `${dir}/${type} @${dist}m truck at (${dx},${dy})`).toBe(expected)
              checked++
              if (actual) hits++
            }
          }
        }
      }
    }

    // Guard against a sweep that silently covers nothing, or only misses.
    expect(checked).toBeGreaterThan(2000)
    expect(hits).toBeGreaterThan(200)
  })

  it('a solid raster pixel under a truck pixel does collide', () => {
    const p = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, veh(5, 'same', 'car'), noCurve)!
    const raster = getTrafficRaster('same', 'car', p.w, p.h, p.lod)
    let tested = 0
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        if (raster[y]![x] === '.') continue
        expect(checkTruckTrafficCollision(
          p.left + x - probeCol, p.top + y - probeRow,
          p.left, p.top, p.w, p.h, raster,
        ), `solid pixel (${x},${y})`).toBe(true)
        tested++
      }
    }
    expect(tested).toBeGreaterThan(100)
  })
})

describe('projected size is stable and monotonic', () => {
  it('never shrinks as a vehicle gets closer', () => {
    for (const dir of ['same', 'oncoming'] as TrafficDir[]) {
      for (const type of ['mini', 'car', 'bus'] as VehicleType[]) {
        let prevW = 0
        for (const dist of [...DISTANCES].reverse()) {
          const p = projectTrafficVehicle(
            VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, veh(dist, dir, type), noCurve,
          )!
          if (prevW) expect(p.w, `${dir}/${type} at ${dist}m`).toBeLessThanOrEqual(prevW)
          prevW = p.w
        }
      }
    }
  })

  it('keeps mini smaller than car and car smaller than bus at every distance', () => {
    for (const dist of DISTANCES) {
      const size = (type: VehicleType) =>
        projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, veh(dist, 'same', type), noCurve)!.w
      expect(size('mini'), `${dist}m`).toBeLessThan(size('car'))
      expect(size('car'), `${dist}m`).toBeLessThan(size('bus'))
    }
  })
})
