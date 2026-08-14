/**
 * How much the drawing changes from one frame to the next during an approach.
 *
 * The contact sheet cannot answer this: it captures single frames, and the thing
 * the owner reports as "still a bit steppy" is about *change between* frames.
 * This walks a vehicle in at a real speed, one physics tick at a time, and
 * compares each frame's raster with the one before it.
 *
 * ── The property worth having ───────────────────────────────────────────────
 * **The drawing may only change when the size changes.** A frame where the
 * silhouette is redrawn while `w` and `h` stand still is a pop — the eye sees a
 * substitution rather than motion, and there is nothing in the world to explain
 * it. Measured: **zero such frames**, including at the tier handover, which lands
 * on a frame that resizes anyway. The tier pop was the first suspect for the
 * reported steppiness and it is not the cause.
 *
 * What the measurement found instead: across 785 frames from 220 m to 2 m the
 * drawing changes only **44 times** — it is still for about 18 frames, then a
 * fifth to two fifths of it is replaced at once. That is the tick. It is worst
 * where the sprite is smallest, because one pixel of growth is a large share of a
 * 20-cell raster, and the measured share sits well above the floor that integer
 * sizing forces, so there is real headroom in how the resample handles growth.
 *
 * Content is compared aligned at the top-left corner rather than at the screen
 * position, deliberately. Aligning on screen would count the vehicle's motion
 * down and across the frame as change, which is exactly what should be happening.
 */

import { describe, it, expect } from 'vitest'
import { getTrafficRaster, projectTrafficVehicle } from '../road3d.ts'
import { resetVehicleRasterCache } from '../vehicleRaster.ts'
import { VIEWPORT_BOTTOM, VIEWPORT_TOP } from '../../config.ts'
import type { LodTier } from '../vehicleLod.ts'
import type { TrafficDir, TrafficVehicle, VehicleType } from '../../game/traffic.ts'

const noCurve = () => 0
/** One physics tick at 60 fps, closing at 60 km/h — an ordinary overtake. */
const CLOSING_KPH = 60
const DT_S = 1 / 60
const STEP_M = (CLOSING_KPH / 3.6) * DT_S

interface Frame {
  distM: number
  w: number
  h: number
  lod: LodTier
  /** Fraction of overlapping raster cells that differ from the previous frame. */
  churn: number
  /** True when this frame is drawn at exactly the size of the one before it. */
  sameSize: boolean
}

/** Cells that differ, over the overlap, with both rasters aligned top-left. */
function contentChurn(a: readonly string[], b: readonly string[]): number {
  const h = Math.min(a.length, b.length)
  const w = Math.min(a[0]?.length ?? 0, b[0]?.length ?? 0)
  if (w === 0 || h === 0) return 0
  let diff = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (a[y]![x] !== b[y]![x]) diff++
  }
  return diff / (w * h)
}

function walkApproach(dir: TrafficDir, type: VehicleType, fromM = 220, toM = 2): Frame[] {
  resetVehicleRasterCache()
  const frames: Frame[] = []
  let prev: { raster: readonly string[]; w: number; h: number } | null = null

  for (let distM = fromM; distM >= toM; distM -= STEP_M) {
    const vehicle: TrafficVehicle =
      { spawnDist: 0, distM, x: 0, speed: 0, dir, type, gone: false }
    // Carry the tier forward exactly as the game does, so hysteresis is exercised.
    if (frames.length > 0) vehicle.lodTier = frames[frames.length - 1]!.lod

    const p = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, vehicle, noCurve)
    if (!p) continue
    const raster = getTrafficRaster(dir, type, p.w, p.h, p.lod)

    frames.push({
      distM,
      w: p.w,
      h: p.h,
      lod: p.lod,
      churn: prev ? contentChurn(prev.raster, raster) : 0,
      sameSize: prev ? prev.w === p.w && prev.h === p.h : true,
    })
    prev = { raster, w: p.w, h: p.h }
  }
  return frames
}

describe('what changes between frames during an approach', () => {
  it('prints the profile', () => {
    const frames = walkApproach('same', 'car')
    const changed = frames.filter(f => f.churn > 0)
    const pops = frames.filter(f => f.sameSize && f.churn > 0)

    console.log(`\n  same/car, ${CLOSING_KPH} km/h closing, ${frames.length} frames from 220 m to 2 m`)
    console.log(`  frames where the drawing changed at all: ${changed.length}`)
    console.log(`  frames where it changed WITHOUT a size change: ${pops.length}`)
    for (const f of pops) {
      console.log(`    at ${f.distM.toFixed(1)} m — ${f.w}x${f.h}, tier ${f.lod}, ${(f.churn * 100).toFixed(0)}% redrawn`)
    }
    const handover = frames.findIndex((f, i) => i > 0 && f.lod !== frames[i - 1]!.lod)
    if (handover > 0) {
      const f = frames[handover]!
      console.log(`  tier handover at ${f.distM.toFixed(1)} m (${f.w}x${f.h}): ${(f.churn * 100).toFixed(0)}% redrawn`)
    }

    console.log('  five largest single-frame changes:')
    for (const f of [...frames].sort((a, b) => b.churn - a.churn).slice(0, 5)) {
      console.log(`    ${(f.churn * 100).toFixed(0).padStart(3)}% at ${f.distM.toFixed(1).padStart(6)} m — ${f.w}x${f.h}, ${f.lod}`)
    }

    // Churn is worst where the raster is smallest: one pixel of growth is a large
    // share of a 20-cell sprite and a small share of a 600-cell one.
    // Integer sizing forces a floor: growing w by one replaces at least 1/w of the
    // columns. Comparing against it says whether the resample is adding churn of
    // its own, or whether the step is simply as large as the geometry demands.
    console.log('  worst change by sprite area (floor = unavoidable share for a 1 px step):')
    for (const [lo, hi] of [[0, 40], [40, 100], [100, 250], [250, 10000]] as const) {
      const band = frames.filter(f => f.w * f.h >= lo && f.w * f.h < hi && f.churn > 0)
      if (band.length === 0) continue
      const worst = band.reduce((a, b) => (b.churn > a.churn ? b : a))
      const floor = 1 / worst.w * 100
      console.log(`    area ${String(lo).padStart(3)}-${String(hi).padStart(5)} cells: worst ${(worst.churn * 100).toFixed(0).padStart(3)}% vs floor ${floor.toFixed(0).padStart(2)}% (${worst.w}x${worst.h} at ${worst.distM.toFixed(0)} m), ${band.length} changes`)
    }
    expect(frames.length).toBeGreaterThan(500)
  })

  it('changes the drawing only when the size changes, apart from tier handovers', () => {
    // A redraw at constant size has nothing in the world to explain it, so the eye
    // reads a substitution rather than motion. One is unavoidable while tiers
    // exist; more than one means a tier boundary is in the wrong place.
    for (const dir of ['same', 'oncoming'] as TrafficDir[]) {
      for (const type of ['mini', 'car', 'bus'] as VehicleType[]) {
        const pops = walkApproach(dir, type).filter(f => f.sameSize && f.churn > 0)
        expect(pops.length, `${dir}/${type}: ${pops.map(p => `${p.distM.toFixed(0)}m`).join(', ')}`)
          .toBeLessThanOrEqual(1)
      }
    }
  })

  it('hands over between tiers exactly once, and low enough to be a handover', () => {
    // The budget an additional tier has to fit inside. If a middle tier pushes
    // either number up, its boundaries are in the wrong place — they belong where
    // the two drawings already look alike, not where the maths is tidy.
    for (const dir of ['same', 'oncoming'] as TrafficDir[]) {
      for (const type of ['mini', 'car', 'bus'] as VehicleType[]) {
        const frames = walkApproach(dir, type)
        const switches = frames.filter((f, i) => i > 0 && f.lod !== frames[i - 1]!.lod)
        expect(switches, `${dir}/${type} tier switches`).toHaveLength(1)
      }
    }
  })

  it('never resizes by more than a pixel in one frame', () => {
    // A two-pixel jump at 60 km/h is a visible tick, and it would mean the scale
    // curve is steeper than the frame rate can carry.
    for (const dir of ['same', 'oncoming'] as TrafficDir[]) {
      for (const type of ['mini', 'car', 'bus'] as VehicleType[]) {
        const frames = walkApproach(dir, type)
        for (let i = 1; i < frames.length; i++) {
          const dw = Math.abs(frames[i]!.w - frames[i - 1]!.w)
          const dh = Math.abs(frames[i]!.h - frames[i - 1]!.h)
          expect(Math.max(dw, dh), `${dir}/${type} at ${frames[i]!.distM.toFixed(1)} m`)
            .toBeLessThanOrEqual(1)
        }
      }
    }
  })
})
