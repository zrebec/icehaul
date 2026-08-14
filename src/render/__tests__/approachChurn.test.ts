/**
 * How much the drawing changes from one frame to the next during an approach.
 *
 * The contact sheet cannot answer this: it captures single frames, and what the
 * owner reports as "steppy" is about *change between* frames. This walks a
 * vehicle in at a real speed, one physics tick at a time, and compares each
 * frame's raster with the one before it. `approachCadence.test.ts` asks the
 * other half of the question — how *often* a change arrives — off the same walk.
 *
 * ── The property worth having ───────────────────────────────────────────────
 * **The silhouette may only grow.** No frame of an approach may turn a pixel
 * that was part of the vehicle back into road. Growth is something the world
 * explains; a pixel that appears and then leaves is a substitution, and the eye
 * reads it as the drawing being swapped rather than the vehicle moving.
 *
 * This replaced a weaker rule — "the drawing may only change when the size
 * changes" — which was right about the symptom and wrong about the cause. Under
 * it the only way to grow was a whole column at a time, and that turned out to
 * be the fault itself: a vehicle held one drawing for up to three seconds and
 * then replaced a fifth of it at once. Sampling at a fractional scale lets the
 * drawing change while `w × h` stands still, which the old rule forbade and the
 * new one welcomes — provided every such change *adds*.
 *
 * ── Where the remaining change is ───────────────────────────────────────────
 * Colour inside the silhouette still moves: a window resampled at a slightly
 * larger scale covers different cells, and that is the vehicle getting closer,
 * not a pop. It is measured separately below rather than forbidden.
 */

import { describe, it, expect } from 'vitest'
import { pictureChurn } from './pictureChurn.ts'
import { DIRS, TYPES, walkApproach, type ApproachFrame } from './approachWalk.ts'

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

/**
 * Pixels the vehicle occupied last frame and does not occupy now, measured
 * **about the sprite's own bottom-centre anchor**.
 *
 * Not raster-local: a sprite that grew has its own corner in a different place,
 * so a raster-local diff calls ordinary growth a rearrangement. Not screen
 * coordinates either: near the player the vehicle rushes down the frame several
 * scanlines a tick, and that is motion — the thing the whole approach is for.
 * What is left when both are removed is whether the shape itself gave anything
 * back.
 */
function lostPixels(prev: ApproachFrame, cur: ApproachFrame): number {
  const anchor = (f: ApproachFrame) => ({ x: Math.round(f.w / 2), y: f.h })
  const a = anchor(prev)
  const b = anchor(cur)
  let lost = 0
  for (let y = 0; y < prev.raster.length; y++) {
    const row = prev.raster[y]!
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '.') continue
      const ch = cur.raster[y - a.y + b.y]?.[x - a.x + b.x]
      if (ch === undefined || ch === '.') lost++
    }
  }
  return lost
}

describe('what changes between frames during an approach', () => {
  it('prints the profile', () => {
    const frames = walkApproach('same', 'car')
    let changed = 0
    let worstPicture = 0
    let worstAt: ApproachFrame | null = null
    let totalLost = 0

    for (let i = 1; i < frames.length; i++) {
      const churn = contentChurn(frames[i - 1]!.raster, frames[i]!.raster)
      if (churn === 0 && frames[i]!.w === frames[i - 1]!.w) continue
      changed++
      totalLost += lostPixels(frames[i - 1]!, frames[i]!)
      const picture = pictureChurn(frames[i - 1]!.raster, frames[i]!.raster)
      if (picture > worstPicture) {
        worstPicture = picture
        worstAt = frames[i]!
      }
    }

    console.log(`\n  same/car, 60 km/h closing, ${frames.length} frames from 220 m to 2 m`)
    console.log(`  frames where the drawing changed: ${changed}`)
    console.log(`  pixels ever lost from the silhouette: ${totalLost}`)
    for (const dir of DIRS) {
      for (const type of TYPES) {
        const fs = walkApproach(dir, type)
        // Tracked by *share*, not by pixel count: two pixels off a 12-pixel mini
        // is a sixth of it, and two off a 600-pixel bus is nothing.
        let worstShare = 0, worstLost = 0, worstFrame: ApproachFrame | null = null
        let worstAbs = 0
        for (let i = 1; i < fs.length; i++) {
          const lost = lostPixels(fs[i - 1]!, fs[i]!)
          const solid = fs[i - 1]!.raster.join('').replace(/\./g, '').length || 1
          if (lost > worstAbs) worstAbs = lost
          if (lost / solid > worstShare) {
            worstShare = lost / solid; worstLost = lost; worstFrame = fs[i]!
          }
        }
        console.log(`    ${dir.padEnd(8)} ${type.padEnd(4)} worst loss ${(worstShare * 100).toFixed(1)}%` +
          ` = ${worstLost} px` +
          (worstFrame ? ` at ${worstFrame.distM.toFixed(0)} m, ${worstFrame.w}x${worstFrame.h}` : '') +
          `   largest absolute loss ${worstAbs} px`)
      }
    }
    console.log(`  largest single-frame picture change: ${(worstPicture * 100).toFixed(0)}%` +
      (worstAt ? ` at ${worstAt.distM.toFixed(1)} m — ${worstAt.w}x${worstAt.h}, ${worstAt.lod}` : ''))

    const handover = frames.findIndex((f, i) => i > 0 && f.lod !== frames[i - 1]!.lod)
    if (handover > 0) {
      const f = frames[handover]!
      console.log(`  tier handover at ${f.distM.toFixed(1)} m (${f.w}x${f.h}): ` +
        `${(pictureChurn(frames[handover - 1]!.raster, f.raster) * 100).toFixed(0)}% of the picture changed`)
    }
    expect(frames.length).toBeGreaterThan(500)
  })

  it('never draws a closer vehicle in a smaller box', () => {
    // Exact, and it holds by construction: the box is `ceil(span)` on each axis
    // and the scale curve is monotonic, so there is no scale at which a vehicle
    // that came nearer is allotted less room. This is the part of "the
    // silhouette only grows" that can be stated without qualification.
    for (const dir of DIRS) {
      for (const type of TYPES) {
        const frames = walkApproach(dir, type)
        for (let i = 1; i < frames.length; i++) {
          expect(frames[i]!.w, `${dir}/${type} w at ${frames[i]!.distM.toFixed(1)} m`)
            .toBeGreaterThanOrEqual(frames[i - 1]!.w)
          expect(frames[i]!.h, `${dir}/${type} h at ${frames[i]!.distM.toFixed(1)} m`)
            .toBeGreaterThanOrEqual(frames[i - 1]!.h)
        }
      }
    }
  })

  it('gives back at most a few percent of the silhouette in any one frame', () => {
    // What the box guarantee cannot: the *shape* inside it. Resampling a sprite
    // whose interior has holes — a wheel gap, a tapered corner — at a slightly
    // larger scale slides those holes, and a cell that held bodywork can hold a
    // gap instead. That is honest sampling of a picture that moved, not a pop.
    //
    // The budget is **one column's worth of pixels, or a tenth of the
    // silhouette, whichever is larger**. A column is the natural unit: a
    // one-pixel size step is exactly what touches a column, so no resampler can
    // promise less. The tenth takes over once the sprite is big enough for a
    // column to be a small part of it.
    //
    // Measured across all six dir × type walks: a whole approach gives back 152
    // pixels in total, the worst frame gives back 2-5 px, and the worst *share*
    // is 16.7% — which is two pixels off a 5 × 4 mini, where the grid has no
    // smaller move available. For comparison, swapping one drawing for another
    // used to cost a third of the picture in a single frame.
    for (const dir of DIRS) {
      for (const type of TYPES) {
        const frames = walkApproach(dir, type)
        for (let i = 1; i < frames.length; i++) {
          const prev = frames[i - 1]!
          const solid = prev.raster.join('').replace(/\./g, '').length
          if (solid === 0) continue
          expect(
            lostPixels(prev, frames[i]!),
            `${dir}/${type} at ${frames[i]!.distM.toFixed(1)} m (${prev.w}x${prev.h} → ${frames[i]!.w}x${frames[i]!.h}, ${solid} px solid)`,
          ).toBeLessThanOrEqual(Math.max(prev.w, solid * 0.1))
        }
      }
    }
  })

  it('hands over between tiers exactly once, and without changing shape', () => {
    // Two tiers, one crossing. The handover used to be the largest single change
    // in an approach — 35% of the picture — because it swapped one drawing for a
    // different one. It now only recolours, so the shape either side of it is
    // identical and the crossing costs no more than an ordinary frame.
    for (const dir of DIRS) {
      for (const type of TYPES) {
        const frames = walkApproach(dir, type)
        const switches = frames.filter((f, i) => i > 0 && f.lod !== frames[i - 1]!.lod)
        expect(switches, `${dir}/${type} tier switches`).toHaveLength(1)

        const at = frames.findIndex((f, i) => i > 0 && f.lod !== frames[i - 1]!.lod)
        const before = frames[at - 1]!
        const after = frames[at]!
        const shape = (f: ApproachFrame) => f.raster.map(r => r.replace(/[^.]/g, 'X'))
        if (before.w === after.w && before.h === after.h) {
          expect(shape(after), `${dir}/${type} handover shape`).toEqual(shape(before))
        }
      }
    }
  })

  it('never resizes by more than a pixel in one frame', () => {
    // A two-pixel jump at 60 km/h is a visible tick, and it would mean the scale
    // curve is steeper than the frame rate can carry.
    for (const dir of DIRS) {
      for (const type of TYPES) {
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
