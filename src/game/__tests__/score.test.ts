/**
 * Scoring — what a drive is worth.
 *
 * Two things are being pinned here. The control numbers from the owner's spec
 * (a 5 km leg is 500 on asphalt and 700 on ice), and the property that makes
 * those numbers mean anything: the total must not depend on how often the game
 * happens to call the function. A score that drifts with the frame rate is a
 * bug you find months later, on someone else's machine, with no way to reproduce.
 */

import { describe, it, expect } from 'vitest'
import { createScore, accrueScore, addScoreBonus, SCORE_BLOCK_M } from '../score.ts'
import { resetRoad, getSurfaceAt, type Surface } from '../road.ts'
import {
  SCORE_PER_100M, SURFACE_SCORE_MULT, DELIVERY_SCORE, FIRST_TARGET_DIST_M,
} from '../../config.ts'

const allOf = (s: Surface) => () => s

/** Drive `distanceM` in fixed steps, scoring as we go. */
function driveAndScore(distanceM: number, stepM: number, surfaceAt: (d: number) => Surface): number {
  const s = createScore()
  for (let d = stepM; d <= distanceM; d += stepM) accrueScore(s, d, surfaceAt)
  accrueScore(s, distanceM, surfaceAt)
  return s.points
}

describe('control numbers', () => {
  it('pays 500 for 5 km of asphalt', () => {
    expect(driveAndScore(FIRST_TARGET_DIST_M, 10, allOf('asphalt'))).toBe(500)
  })

  it('pays 700 for 5 km of ice', () => {
    expect(driveAndScore(FIRST_TARGET_DIST_M, 10, allOf('ice'))).toBe(700)
  })

  it('pays every surface its multiplier, in whole points', () => {
    for (const [surface, mult] of Object.entries(SURFACE_SCORE_MULT)) {
      const points = driveAndScore(1000, 10, allOf(surface as Surface))
      // 1 km = 10 blocks.
      expect(points).toBe(10 * Math.round(SCORE_PER_100M * mult))
      expect(Number.isInteger(points)).toBe(true)
    }
  })
})

describe('frame-rate independence', () => {
  it('reaches the same total whatever the step size', () => {
    // 16 ms at 30 km/h is ~0.13 m; 33 ms at 120 km/h is ~1.1 m. A block must
    // never be paid twice or skipped because of where a frame boundary fell.
    const totals = [0.13, 1.1, 7, 33, 100, 250].map(step =>
      driveAndScore(5000, step, allOf('snow')))
    expect(new Set(totals).size).toBe(1)
    expect(totals[0]).toBe(600)
  })

  it('is unchanged by extra calls at the same distance', () => {
    const s = createScore()
    accrueScore(s, 350, allOf('asphalt'))
    const after = s.points
    accrueScore(s, 350, allOf('asphalt'))
    accrueScore(s, 350, allOf('asphalt'))
    expect(s.points).toBe(after)
  })
})

describe('blocks', () => {
  it('pays nothing for a block that has not been crossed', () => {
    const s = createScore()
    expect(accrueScore(s, SCORE_BLOCK_M - 0.01, allOf('ice'))).toBe(0)
    expect(s.points).toBe(0)
  })

  it('pays the moment the block completes, and only for whole blocks', () => {
    const s = createScore()
    expect(accrueScore(s, SCORE_BLOCK_M, allOf('ice'))).toBe(14)
    expect(accrueScore(s, SCORE_BLOCK_M * 2.99, allOf('ice'))).toBe(14)
    expect(s.points).toBe(28)
    expect(s.scoredToM).toBe(SCORE_BLOCK_M * 2)
  })

  it('values a block by its midpoint, not by wherever the frame landed', () => {
    // Ice up to 250 m, asphalt after: blocks 0 and 1 (midpoints 50 and 150) are
    // ice, block 2 (midpoint 250) is asphalt.
    const surfaceAt = (d: number): Surface => (d < 250 ? 'ice' : 'asphalt')
    const s = createScore()
    accrueScore(s, 300, surfaceAt)
    expect(s.points).toBe(14 + 14 + 10)
  })
})

describe('delivery bonus', () => {
  it('adds a lump without touching what the road has paid for', () => {
    const s = createScore()
    accrueScore(s, 1000, allOf('asphalt'))
    addScoreBonus(s, DELIVERY_SCORE)
    expect(s.points).toBe(100 + DELIVERY_SCORE)
    expect(s.scoredToM).toBe(1000)
  })
})

describe('on a real route', () => {
  it('scores the reference seed in the band the mix predicts', () => {
    // AGENTS.md §2 puts the weighted mean multiplier of a route at ~1.085, so
    // 5 km lands near 543. The reference seed is 48.5 % ice, well above the
    // mean, so it should sit above that and below the all-ice ceiling of 700.
    resetRoad(1_443_866)
    const points = driveAndScore(FIRST_TARGET_DIST_M, 5, d => getSurfaceAt(d) as Surface)
    console.log(`\nseed 1443866 — 5 km of driving scores ${points} (+${DELIVERY_SCORE} on delivery)`)
    expect(points).toBeGreaterThan(500)
    expect(points).toBeLessThan(700)
  })

  it('gives a plain route less than an ice-heavy one', () => {
    resetRoad(1_443_866)
    const icy = driveAndScore(FIRST_TARGET_DIST_M, 5, d => getSurfaceAt(d) as Surface)
    resetRoad(42)
    const plain = driveAndScore(FIRST_TARGET_DIST_M, 5, d => getSurfaceAt(d) as Surface)
    console.log(`seed 42 — 5 km of driving scores ${plain}`)
    expect(icy).toBeGreaterThan(plain)
  })
})
