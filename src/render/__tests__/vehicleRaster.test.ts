/**
 * The contract this module exists for: what is drawn and what collides are the
 * same set of pixels. Before the shared raster they were resampled in opposite
 * directions and never agreed — 45 pixels of invisible hitbox at a metre, and 19
 * visible pixels that passed straight through.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { projectTrafficVehicle } from '../road3d.ts'
import { rasteriseVehicleAtScale, resetVehicleRasterCache, vehicleRasterCacheSize } from '../vehicleRaster.ts'
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

describe('rasteriseVehicleAtScale', () => {
  const SQUARE = ['XXXX', 'XXXX', 'XXXX', 'XXXX']

  it('fills the box that contains the sprite at that scale', () => {
    const r = rasteriseVehicleAtScale('t', SQUARE, 1.5, 100, 100)!
    // 4 source px at 1.5 is 6 px of sprite, so 6 whole cells hold it.
    expect(r.w).toBe(6)
    expect(r.h).toBe(6)
    expect(r.raster).toHaveLength(6)
    for (const row of r.raster) expect(row).toHaveLength(6)
  })

  it('sits on its anchor: bottom edge on y, centred within half a pixel on x', () => {
    for (const scale of [0.3, 0.55, 0.8, 1.0, 1.43]) {
      const r = rasteriseVehicleAtScale('t', SQUARE, scale, 100, 100)!
      expect(r.top + r.h, `scale ${scale} bottom`).toBe(100)
      const centre = r.left + r.w / 2
      expect(Math.abs(centre - 100), `scale ${scale} centre`).toBeLessThanOrEqual(0.5)
    }
  })

  it('grows the box by one pixel at a time, never two', () => {
    // The whole point. Centring the box exactly on the anchor would force an
    // even width and it would grow two columns at a time — see the geometry note
    // in `resampleSpriteAtScale`.
    let prev = rasteriseVehicleAtScale('t', SQUARE, 0.2, 100, 100)!
    for (let s = 0.2; s <= 1.43; s += 1 / 256) {
      const cur = rasteriseVehicleAtScale('t', SQUARE, s, 100, 100)!
      expect(cur.w - prev.w, `w at scale ${s.toFixed(3)}`).toBeGreaterThanOrEqual(0)
      expect(cur.w - prev.w, `w at scale ${s.toFixed(3)}`).toBeLessThanOrEqual(1)
      expect(cur.h - prev.h, `h at scale ${s.toFixed(3)}`).toBeGreaterThanOrEqual(0)
      expect(cur.h - prev.h, `h at scale ${s.toFixed(3)}`).toBeLessThanOrEqual(1)
      prev = cur
    }
  })

  it('changes the drawing between two scales that share a box size', () => {
    // What separates this from the integer path it replaced: the same `w × h`
    // can hold two different drawings, and that is where the extra cadence
    // during an approach comes from.
    const rows = ['..XX..', '.XXXX.', 'XXXXXX', 'XX..XX']
    const seen = new Set<string>()
    for (let s = 0.5; s <= 1.2; s += 1 / 256) {
      const r = rasteriseVehicleAtScale('t', rows, s, 100, 100)
      if (r) seen.add(`${r.w}x${r.h}:${r.raster.join('|')}`)
    }
    const sizes = new Set([...seen].map(k => k.split(':')[0]))
    expect(seen.size, 'distinct drawings').toBeGreaterThan(sizes.size)
  })

  it('is deterministic — the same request gives the same pixels', () => {
    const a = rasteriseVehicleAtScale('t', ['XX.', '.XX'], 0.7, 50, 60)
    resetVehicleRasterCache()
    const b = rasteriseVehicleAtScale('t', ['XX.', '.XX'], 0.7, 50, 60)
    expect(b).toEqual(a)
  })

  it('caches by sprite identity and quantised scale, not by position', () => {
    const rows = ['XX', 'XX']
    rasteriseVehicleAtScale('a', rows, 0.8, 100, 100)
    expect(vehicleRasterCacheSize()).toBe(1)
    rasteriseVehicleAtScale('a', rows, 0.8, 100, 100)
    expect(vehicleRasterCacheSize()).toBe(1)   // same key, no growth
    rasteriseVehicleAtScale('a', rows, 0.8, 40, 70)
    expect(vehicleRasterCacheSize()).toBe(1)   // elsewhere on the road, same raster
    rasteriseVehicleAtScale('a', rows, 1.2, 100, 100)
    expect(vehicleRasterCacheSize()).toBe(2)   // different scale
    rasteriseVehicleAtScale('b', rows, 0.8, 100, 100)
    expect(vehicleRasterCacheSize()).toBe(3)   // different sprite
  })

  it('refuses a degenerate request rather than inventing one', () => {
    expect(rasteriseVehicleAtScale('t', ['XX'], 0, 10, 10)).toBeNull()
    expect(rasteriseVehicleAtScale('t', ['XX'], -1, 10, 10)).toBeNull()
    expect(rasteriseVehicleAtScale('t', [], 1, 10, 10)).toBeNull()
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
          const raster = p!.raster

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
    const raster = p.raster
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
  it('pins the physical box throughout the approach', () => {
    // Characterisation before authored LOD assets gain 0.5x / 1x / 2x source
    // resolutions. These boxes are the gameplay geometry: changing the source
    // grid must not move an anchor, widen a lane share or grow the hitbox.
    const expected = {
      mini: [
        [220, 126, 29, 3, 3], [100, 125, 28, 6, 5], [50, 123, 27, 9, 7],
        [25, 122, 27, 12, 10], [10, 119, 33, 17, 13], [5, 118, 46, 19, 15],
        [2, 118, 90, 20, 16],
      ],
      car: [
        [220, 125, 29, 5, 3], [100, 123, 27, 9, 6], [50, 121, 24, 14, 10],
        [25, 118, 24, 19, 13], [10, 115, 28, 26, 18], [5, 113, 41, 29, 20],
        [2, 112, 85, 31, 21],
      ],
      bus: [
        [220, 125, 28, 6, 4], [100, 122, 26, 11, 7], [50, 119, 23, 17, 11],
        [25, 116, 21, 24, 16], [10, 111, 25, 33, 21], [5, 109, 37, 37, 24],
        [2, 108, 80, 40, 26],
      ],
    } as const

    for (const type of ['mini', 'car', 'bus'] as const) {
      for (const [dist, left, top, w, h] of expected[type]) {
        const p = projectTrafficVehicle(
          VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, veh(dist, 'same', type), noCurve,
        )!
        expect(
          { left: p.left, top: p.top, w: p.w, h: p.h },
          `${type} at ${dist}m`,
        ).toEqual({ left, top, w, h })
      }
    }
  })

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
