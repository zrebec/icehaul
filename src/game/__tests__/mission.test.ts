/**
 * Mission rules — the arithmetic the game asks of the player.
 *
 * These are the tests that did not exist when 0.8.1 shipped a second leg asking
 * for 15 to 25 km against a clock reset to eight minutes. They need no vehicle
 * and no route: every assertion here is a statement about what the mission
 * *demands*, checked against the truck's top speed and against the one leg that
 * has been played by a human. `completability.test.ts` answers the other half —
 * whether a driver can actually meet the demand on a real road.
 */

import { describe, it, expect } from 'vitest'
import {
  createMission, legBudgetMs, nextTargetLengthM, tickMission,
  deliverIfArrived, isMissionExpired, remainingM,
} from '../mission.ts'
import {
  FIRST_TARGET_DIST_M, NEXT_TARGET_RANGE, MISSION_PACE_KMH,
  DELIVERY_TIME_LIMIT_MS, DELIVERY_TIME_CARRY_PCT, MAX_SPEED,
} from '../../config.ts'

const SEED = 1_443_866

/** Average km/h a leg of `lengthM` demands inside `budgetMs`. */
function requiredKph(lengthM: number, budgetMs: number): number {
  return (lengthM / 1000) / (budgetMs / 3_600_000)
}

describe('leg budget', () => {
  it('leaves the first leg at exactly the 8 minutes it was tuned to', () => {
    // The one leg with a human run behind it: the owner finished 5 km on the
    // reference seed with ~12 s to spare. Any change to the pace that moves
    // this number invalidates that playtest, so it is pinned by value and not
    // merely by formula.
    expect(DELIVERY_TIME_LIMIT_MS).toBe(8 * 60 * 1000)
    expect(legBudgetMs(FIRST_TARGET_DIST_M)).toBe(DELIVERY_TIME_LIMIT_MS)
  })

  it('asks the same average speed of every leg length', () => {
    for (const lengthM of [1000, 5000, 6500, 8000, 25000]) {
      expect(requiredKph(lengthM, legBudgetMs(lengthM))).toBeCloseTo(MISSION_PACE_KMH, 3)
    }
  })

  it('scales linearly, so twice the road is twice the clock', () => {
    expect(legBudgetMs(10_000)).toBe(2 * legBudgetMs(5000))
  })
})

describe('target range is reachable', () => {
  // The 0.8.1 defect, stated as an assertion: a target the truck cannot reach
  // flat out is not a difficult mission, it is an impossible one.
  it('never demands more than the truck can do', () => {
    const [minD, maxD] = NEXT_TARGET_RANGE
    for (const lengthM of [minD, (minD + maxD) / 2, maxD]) {
      expect(requiredKph(lengthM, legBudgetMs(lengthM))).toBeLessThan(MAX_SPEED)
    }
  })

  it('demands no more than the first leg does, at any drawn length', () => {
    // Every leg the generator can produce must sit at the pace a human has
    // already driven — that is the whole point of a proportional budget.
    const firstLegKph = requiredKph(FIRST_TARGET_DIST_M, DELIVERY_TIME_LIMIT_MS)
    for (let i = 0; i < 200; i++) {
      const lengthM = nextTargetLengthM(i, SEED)
      expect(requiredKph(lengthM, legBudgetMs(lengthM))).toBeLessThanOrEqual(firstLegKph + 0.01)
    }
  })

  it('draws every length inside the configured range', () => {
    const [minD, maxD] = NEXT_TARGET_RANGE
    for (let i = 0; i < 500; i++) {
      const lengthM = nextTargetLengthM(i, SEED)
      expect(lengthM).toBeGreaterThanOrEqual(minD)
      expect(lengthM).toBeLessThanOrEqual(maxD)
    }
  })
})

describe('leg lengths hang off the route seed', () => {
  // Regression: the draw was `hash(deliveryCount * 71)` with no seed, so every
  // route in the game asked for the same sequence of distances — the only
  // procedural stream that was not a function of the route.
  it('gives two routes different sequences', () => {
    const a = Array.from({ length: 8 }, (_, i) => nextTargetLengthM(i, SEED))
    const b = Array.from({ length: 8 }, (_, i) => nextTargetLengthM(i, 534_501))
    expect(a).not.toEqual(b)
  })

  it('gives the same route the same sequence every time', () => {
    const a = Array.from({ length: 8 }, (_, i) => nextTargetLengthM(i, SEED))
    const b = Array.from({ length: 8 }, (_, i) => nextTargetLengthM(i, SEED))
    expect(a).toEqual(b)
  })
})

describe('delivery', () => {
  it('does nothing until the truck reaches the drop-off', () => {
    const m = createMission(SEED)
    expect(deliverIfArrived(m, FIRST_TARGET_DIST_M - 1)).toBe(false)
    expect(m.deliveryCount).toBe(0)
    expect(m.targetDist).toBe(FIRST_TARGET_DIST_M)
  })

  it('adds the new leg to what was left instead of resetting the clock', () => {
    // The 0.8.1 behaviour was `timerMs = DELIVERY_TIME_LIMIT_MS` — a jump back
    // to a full budget that the owner read as "you only gain 2 minutes".
    const m = createMission(SEED)
    tickMission(m, 5 * 60 * 1000)          // 3 minutes left of the first leg
    const leftover = m.timerMs
    expect(leftover).toBe(3 * 60 * 1000)

    deliverIfArrived(m, FIRST_TARGET_DIST_M)
    const legLength = m.targetDist - m.legStartDist
    expect(m.timerMs).toBeCloseTo(leftover * DELIVERY_TIME_CARRY_PCT + legBudgetMs(legLength), 6)
    expect(m.timerMs).toBeGreaterThan(legBudgetMs(legLength))
  })

  it('measures the next leg from the drop-off, not from where the truck stopped', () => {
    // Called a few metres late (a frame's worth of overshoot), the leg must
    // still be the length it was drawn as — otherwise the target creeps
    // forward by a frame of travel on every delivery.
    const m = createMission(SEED)
    deliverIfArrived(m, FIRST_TARGET_DIST_M + 7.3)
    expect(m.legStartDist).toBe(FIRST_TARGET_DIST_M)
    expect(m.targetDist - m.legStartDist).toBeCloseTo(nextTargetLengthM(1, SEED), 6)
  })

  it('keeps every leg of a long run inside the pace', () => {
    const m = createMission(SEED)
    let dist = 0
    for (let leg = 0; leg < 20; leg++) {
      const budget = m.timerMs
      const lengthM = m.targetDist - m.legStartDist
      // Each leg's own budget, ignoring anything banked, must cover it at pace.
      expect(legBudgetMs(lengthM)).toBeLessThanOrEqual(budget + 0.01)
      dist = m.targetDist
      expect(deliverIfArrived(m, dist)).toBe(true)
    }
    expect(m.deliveryCount).toBe(20)
  })
})

describe('timer', () => {
  it('counts down and stops at zero', () => {
    const m = createMission(SEED)
    tickMission(m, DELIVERY_TIME_LIMIT_MS + 5000)
    expect(m.timerMs).toBe(0)
    expect(isMissionExpired(m)).toBe(true)
  })

  it('is not expired while time remains', () => {
    const m = createMission(SEED)
    tickMission(m, DELIVERY_TIME_LIMIT_MS - 1)
    expect(isMissionExpired(m)).toBe(false)
  })
})

describe('remaining distance', () => {
  it('never reads negative once the truck is past the target', () => {
    const m = createMission(SEED)
    expect(remainingM(m, 0)).toBe(FIRST_TARGET_DIST_M)
    expect(remainingM(m, FIRST_TARGET_DIST_M + 500)).toBe(0)
  })
})
