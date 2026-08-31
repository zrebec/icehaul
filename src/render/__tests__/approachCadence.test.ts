/**
 * How long a vehicle stands completely still while the player watches it.
 *
 * ── Why a second metric, when `approachChurn` already exists ────────────────
 * `approachChurn` asks how *cleanly* each change is made, and after the
 * area-weighted resample the answer is "at the floor the target grid forces".
 * The owner still read the approach as steppy, which left one lever: not how
 * clean each change is, but **how often one arrives**.
 *
 * Counting changes hides the fault. A car changes 44 times over an approach,
 * which sounds continuous, but the changes bunch up near the player: measured
 * on the pre-change renderer the far field held one single drawing for
 *
 *     mini  185 frames = 3.08 s     car  112 = 1.87 s     bus  128 = 2.13 s
 *
 * Three seconds of a completely motionless vehicle, and then a jump. That is
 * what "still a bit steppy" is, and the longest freeze is the number that says
 * it. Everything here is derived from the same walk `approachChurn` uses, so
 * the two tests can never disagree about what the approach was.
 *
 * ── The ceiling, and why the fix could not come from the scale curve ────────
 * A car takes 28 distinct widths and 19 distinct heights over the approach, so
 * at most 47 frames out of 785 can possibly differ from the one before while
 * the integer size is what gets quantised. The measured 44 is 94% of that.
 * There was nothing left to win there — the curve was already spending
 * everything it had. Growth had to stop being quantised to whole columns and
 * start being quantised to whole *pixels*, which is what `rasteriseVehicleAtScale`
 * does.
 */

import { describe, it, expect } from 'vitest'
import { DIRS, FPS, TYPES, freezeRuns, walkApproach } from './approachWalk.ts'

/**
 * The longest a vehicle may hold one drawing, in seconds.
 *
 * Set from measurement, not from taste. The worst case across all six
 * dir × type walks is a **mini in the far field**: at 200 m it is a box of
 * about 4 × 3, and over the two seconds it takes to close from 200 m to 165 m
 * its true size grows by a tenth of a pixel. There is nothing there to draw
 * differently, and no resampler can invent it.
 *
 * The lever that would move it is not in this file: `TRAFFIC_SCALE_FAR` (a car
 * is 4 px at the far anchor) or `TRAFFIC_VIEW_DISTANCE_M` (traffic appears at
 * 220 m). Both change how distance reads, so they are the owner's call — see
 * AGENTS.md.
 *
 * The budget is that measured worst case with headroom. Column-quantised growth
 * cost 3.07 s, so a regression to it fails here loudly.
 */
const MAX_FREEZE_S = 2.0

describe('how often the drawing changes during an approach', () => {
  it('prints the cadence profile', () => {
    console.log(`\n  longest run of frames holding one drawing, at 60 km/h closing`)
    for (const dir of DIRS) {
      for (const type of TYPES) {
        const frames = walkApproach(dir, type)
        const runs = freezeRuns(frames)
        const worst = Math.max(...runs)
        const changes = runs.length - 1
        // Where the worst freeze sits matters: near the player it would be a
        // bug in the scale curve, in the far field it is the sprite being tiny.
        let idx = 0
        for (const run of runs) {
          if (run === worst) break
          idx += run
        }
        // Split by authored tier, because a fix to one grid says nothing about
        // the other two.
        const perTier = (tier: string) => {
          const runs = freezeRuns(frames.filter(f => f.lod === tier))
          return runs.length ? Math.max(...runs) : 0
        }
        console.log(
          `    ${dir.padEnd(8)} ${type.padEnd(4)}  ${changes} changes / ${frames.length} frames` +
          `   worst ${String(worst).padStart(3)} = ${(worst / FPS).toFixed(2)} s` +
          ` at ${frames[idx]!.distM.toFixed(0).padStart(3)} m` +
          `   median ${median(runs).toFixed(1)}` +
          `   far ${(perTier('far') / FPS).toFixed(2)} s` +
          ` / mid ${(perTier('mid') / FPS).toFixed(2)} s` +
          ` / near ${(perTier('near') / FPS).toFixed(2)} s`,
        )
      }
    }
    expect(true).toBe(true)
  })

  it('never holds one drawing longer than the budget', () => {
    for (const dir of DIRS) {
      for (const type of TYPES) {
        const runs = freezeRuns(walkApproach(dir, type))
        const worst = Math.max(...runs)
        expect(worst / FPS, `${dir}/${type} longest freeze`).toBeLessThanOrEqual(MAX_FREEZE_S)
      }
    }
  })

})

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
