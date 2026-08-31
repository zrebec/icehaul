/**
 * What one pixel of growth does to the picture.
 *
 * A vehicle approaching the player is redrawn at a new integer size every dozen
 * frames or so, and each of those steps is a chance for the drawing to jump. The
 * question this file settles is not *whether* it jumps — some jump is forced by
 * having only w columns to say something with — but whether the resampler adds
 * any jump of its own on top.
 *
 * ── The floor, and why it is measurable ─────────────────────────────────────
 * Resample the same sprite from an eight-times finer copy of itself. The source
 * grid has stopped being the limit there, so whatever picture change is left
 * between `w` and `w + 1` is what the target grid forces and nothing else. Any
 * excess over that is the resampler's own.
 *
 * Measured against the unweighted resampler that shipped through 0.6.0, the
 * excess was concentrated and large: 13.6 pp on the step where a car passes 1:1,
 * 12.1 pp for a mini, 9.0 pp for a bus. Weighting each source pixel by the area
 * the target cell actually covers removes essentially all of it — see
 * `scaleRoadsideRows`.
 *
 * This is the counterpart to `approachChurn.test.ts`: that one walks a real
 * approach and asks when the drawing changes, this one takes the size steps in
 * isolation and asks how much each one is allowed to change.
 */

import { describe, it, expect } from 'vitest'
import { scaleRoadsideRows } from '../road3d.ts'
import { getTrafficSprite } from '../sprites/catalog.ts'
import { pictureChurn, finerSource } from './pictureChurn.ts'
import { TRAFFIC_CANONICAL_SIZE } from '../../config.ts'
import type { LodTier } from '../vehicleLod.ts'
import type { TrafficDir, VehicleType } from '../../game/traffic.ts'

const DIRS: TrafficDir[] = ['same', 'oncoming']
const TYPES: VehicleType[] = ['mini', 'car', 'bus']

/** A broad diagnostic range for the canonical mid-resolution source. */
const MIN_W = 13
const MAX_W = 32

interface Step {
  w: number
  h: number
  nextW: number
  nextH: number
  /** Picture change over this step, from the real source. */
  churn: number
  /** The same step resampled from a finer source: what the target grid forces. */
  floor: number
}

/**
 * Both tests below walk the same six sprites, and the walk is the expensive part
 * — every step resamples twice and compares two pictures on a common fine grid.
 * `sizeSteps` is pure in `(dir, type)`, so computing it once cuts the second
 * test's work in half. Measured: 1.62 s -> 0.86 s for `never changes the picture`.
 */
const stepCache = new Map<string, Step[]>()

function sizeSteps(dir: TrafficDir, type: VehicleType): Step[] {
  const cached = stepCache.get(`${dir}:${type}`)
  if (cached) return cached
  const computed = computeSizeSteps(dir, type)
  stepCache.set(`${dir}:${type}`, computed)
  return computed
}

function computeSizeSteps(dir: TrafficDir, type: VehicleType): Step[] {
  const rows = getTrafficSprite(dir, type, 'mid').rows
  const fine = finerSource(rows)
  const srcW = rows[0]!.length
  const srcH = rows.length
  const steps: Step[] = []

  for (let w = MIN_W; w < MAX_W; w++) {
    // The projection keeps the sprite's aspect ratio, so height follows width.
    const h = Math.max(3, Math.round(w * srcH / srcW))
    const nextH = Math.max(3, Math.round((w + 1) * srcH / srcW))
    steps.push({
      w, h, nextW: w + 1, nextH,
      churn: pictureChurn(scaleRoadsideRows(rows, w, h), scaleRoadsideRows(rows, w + 1, nextH)),
      floor: pictureChurn(scaleRoadsideRows(fine, w, h), scaleRoadsideRows(fine, w + 1, nextH)),
    })
  }
  return steps
}

describe('what one pixel of growth does to the picture', () => {
  it('prints the profile', () => {
    for (const type of TYPES) {
      const rows = getTrafficSprite('same', type, 'mid').rows
      const steps = sizeSteps('same', type)
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
      const worst = steps.reduce((a, b) => (b.churn - b.floor > a.churn - a.floor ? b : a))

      console.log(`\n  ${type} — source ${rows[0]!.length}x${rows.length}, ${steps.length} one-pixel steps`)
      console.log(`    mean picture change ${(mean(steps.map(s => s.churn)) * 100).toFixed(1)}%,` +
        ` floor ${(mean(steps.map(s => s.floor)) * 100).toFixed(1)}%`)
      console.log(`    worst excess ${((worst.churn - worst.floor) * 100).toFixed(1)} pp` +
        ` at ${worst.w}x${worst.h} -> ${worst.nextW}x${worst.nextH}`)
      console.log(`    picture wrong against the source, averaged over sizes: ` +
        `${(mean(steps.map(s => pictureChurn(rows, scaleRoadsideRows(rows, s.w, s.h)))) * 100).toFixed(1)}%`)
    }
    expect(sizeSteps('same', 'car').length).toBe(MAX_W - MIN_W)
  })

  it('never changes the picture more than the target grid forces', () => {
    // The property worth having, and the one the unweighted resampler broke: a
    // size step may only change what a finer source would also have changed.
    // 2 pp of slack covers the comparison grid's own quantisation; the measured
    // worst case sits under 1 pp, and the version this replaced reached 13.6.
    for (const dir of DIRS) {
      for (const type of TYPES) {
        for (const s of sizeSteps(dir, type)) {
          expect(
            s.churn - s.floor,
            `${dir}/${type} ${s.w}x${s.h} -> ${s.nextW}x${s.nextH}: ` +
            `${(s.churn * 100).toFixed(1)}% against a floor of ${(s.floor * 100).toFixed(1)}%`,
          ).toBeLessThan(0.02)
        }
      }
    }
  })

  it('draws the silhouette at the size it really is', () => {
    // Weighting is what makes this hold. Counting every touched source pixel
    // once let a barely-covered edge cell read as solid, so every downscale drew
    // the vehicle fatter than the source — worst at ratios just under 1:1, where
    // the inflation then vanished in one frame as the sprite grew past it.
    for (const dir of DIRS) {
      for (const type of TYPES) {
        const rows = getTrafficSprite(dir, type, 'mid').rows
        const srcW = rows[0]!.length
        const srcH = rows.length
        const sourceOpaque = rows.join('').split('').filter(c => c !== '.').length / (srcW * srcH)

        for (let w = MIN_W; w <= MAX_W; w++) {
          const h = Math.max(3, Math.round(w * srcH / srcW))
          const scaled = scaleRoadsideRows(rows, w, h)
          const opaque = scaled.join('').split('').filter(c => c !== '.').length / (w * h)
          expect(
            opaque,
            `${dir}/${type} at ${w}x${h} covers ${(opaque * 100).toFixed(0)}% against the source's ${(sourceOpaque * 100).toFixed(0)}%`,
          ).toBeLessThan(sourceOpaque + 0.11)
        }
      }
    }
  })

  it('resamples the same picture whatever grid the source is drawn on', () => {
    // Area weighting means the resampler reads the sprite as a picture rather
    // than as a grid of cells, so a finer copy of the same sprite resamples to
    // very nearly the same raster. This is the property the floor above relies
    // on, asserted directly rather than assumed.
    for (const type of TYPES) {
      const rows = getTrafficSprite('same', type, 'mid').rows
      const fine = finerSource(rows)
      for (let w = MIN_W; w <= MAX_W; w += 3) {
        const h = Math.max(3, Math.round(w * rows.length / rows[0]!.length))
        expect(
          pictureChurn(scaleRoadsideRows(rows, w, h), scaleRoadsideRows(fine, w, h)),
          `${type} at ${w}x${h}`,
        ).toBeLessThan(0.06)
      }
    }
  })

  it('resamples every authored tier consistently with a finer copy at its physical spans', () => {
    const heightSamples: Record<LodTier, readonly number[]> = {
      far: [3, 5, 7],
      mid: [8, 10, 13],
      near: [14, 18, 24],
    }

    for (const dir of DIRS) {
      for (const type of TYPES) {
        const physical = TRAFFIC_CANONICAL_SIZE[type]
        const maxHeight = Math.ceil(physical.h * 1.43)
        for (const lod of ['far', 'mid', 'near'] as const) {
          const rows = getTrafficSprite(dir, type, lod).rows
          const fine = finerSource(rows)
          for (const requestedH of heightSamples[lod]) {
            const h = Math.min(requestedH, maxHeight)
            const w = Math.max(1, Math.ceil(h * physical.w / physical.h))
            expect(
              pictureChurn(scaleRoadsideRows(rows, w, h), scaleRoadsideRows(fine, w, h)),
              `${dir}/${type}/${lod} at ${w}x${h}`,
            ).toBeLessThan(0.08)
          }
        }
      }
    }
  })
})
