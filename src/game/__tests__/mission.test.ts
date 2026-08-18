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
  addMissionTime, createMission, legBudgetMs, nextTargetLengthM, tickMission,
  deliverIfArrived, isMissionExpired, remainingM,
} from '../mission.ts'
import type { RoadSampler } from '../routeplan.ts'
import {
  FIRST_TARGET_DIST_M, NEXT_TARGET_RANGE,
  DELIVERY_TIME_CARRY_PCT, MAX_SPEED, SURFACE_GRIP,
  PLAN_PACE_MAX_KMH, PLAN_PACE_MIN_KMH,
} from '../../config.ts'

const SEED = 1_443_866

/**
 * A road that never changes, so these tests stay about the *mission* — what it
 * demands and how it hands legs over. Whether a real route's budget is drivable
 * is `routeplan.test.ts` and `completability.test.ts`.
 */
const flatRoad = (surface: 'asphalt' | 'ice' = 'asphalt'): RoadSampler => ({
  surfaceAt: () => surface,
  gripAt: () => SURFACE_GRIP[surface],
  curvatureAt: () => 0,
})
const ROAD = flatRoad()

/** Average km/h a leg of `lengthM` demands inside `budgetMs`. */
function requiredKph(lengthM: number, budgetMs: number): number {
  return (lengthM / 1000) / (budgetMs / 3_600_000)
}

describe('leg budget', () => {
  it('is read off the road rather than off a flat pace', () => {
    // The change 0.11.x makes: the same five kilometres cost different amounts
    // of time depending on what they are made of. A flat pace could not say
    // that, which is why a competent run banked ten seconds a kilometre.
    const easy = legBudgetMs(0, 5000, flatRoad('asphalt'))
    const hard = legBudgetMs(0, 5000, flatRoad('ice'))
    expect(hard).toBeGreaterThan(easy)
  })

  it('gives the first leg a beginner allowance the others do not get', () => {
    // The planner reads the route from the seed; a player on their first run of
    // it cannot, and the first leg also starts from a cold standstill.
    expect(legBudgetMs(0, 5000, ROAD, true)).toBeGreaterThan(legBudgetMs(0, 5000, ROAD))
  })

  it('still grows with the length of the leg', () => {
    // Not linearly any more — a longer leg may cross easier ground — but the
    // 0.8.1 defect was a budget that did not grow at all.
    expect(legBudgetMs(0, 8000, ROAD)).toBeGreaterThan(legBudgetMs(0, 4000, ROAD))
  })

  it('never demands a pace outside the guard rails, on any road', () => {
    // The clamp that 0.8.1 did not have, checked here through the mission's own
    // entry point rather than only inside the planner.
    for (const road of [flatRoad('asphalt'), flatRoad('ice')]) {
      for (const lengthM of [1000, 5000, 8000]) {
        const kph = requiredKph(lengthM, legBudgetMs(0, lengthM, road))
        expect(kph).toBeLessThanOrEqual(PLAN_PACE_MAX_KMH + 0.01)
        expect(kph).toBeGreaterThanOrEqual(PLAN_PACE_MIN_KMH - 0.01)
      }
    }
  })
})

describe('target range is reachable', () => {
  // The 0.8.1 defect, stated as an assertion: a target the truck cannot reach
  // flat out is not a difficult mission, it is an impossible one.
  it('never demands more than the truck can do', () => {
    const [minD, maxD] = NEXT_TARGET_RANGE
    for (const lengthM of [minD, (minD + maxD) / 2, maxD]) {
      expect(requiredKph(lengthM, legBudgetMs(0, lengthM, ROAD))).toBeLessThan(MAX_SPEED)
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
    const m = createMission(SEED, ROAD)
    expect(deliverIfArrived(m, FIRST_TARGET_DIST_M - 1, ROAD)).toBe(false)
    expect(m.deliveryCount).toBe(0)
    expect(m.targetDist).toBe(FIRST_TARGET_DIST_M)
  })

  it('adds the new leg to what was left instead of resetting the clock', () => {
    // The 0.8.1 behaviour was `timerMs = DELIVERY_TIME_LIMIT_MS` — a jump back
    // to a full budget that Fox read as "you only gain 2 minutes".
    const m = createMission(SEED, ROAD)
    const granted = m.timerMs
    tickMission(m, granted / 2)
    const leftover = m.timerMs
    expect(leftover).toBeCloseTo(granted / 2, 6)

    deliverIfArrived(m, FIRST_TARGET_DIST_M, ROAD)
    const legBudget = legBudgetMs(m.legStartDist, m.targetDist, ROAD)
    expect(m.timerMs).toBeCloseTo(leftover * DELIVERY_TIME_CARRY_PCT + legBudget, 6)
    expect(m.timerMs).toBeGreaterThan(legBudget)
  })

  it('measures the next leg from the drop-off, not from where the truck stopped', () => {
    // Called a few metres late (a frame's worth of overshoot), the leg must
    // still be the length it was drawn as — otherwise the target creeps
    // forward by a frame of travel on every delivery.
    const m = createMission(SEED, ROAD)
    deliverIfArrived(m, FIRST_TARGET_DIST_M + 7.3, ROAD)
    expect(m.legStartDist).toBe(FIRST_TARGET_DIST_M)
    expect(m.targetDist - m.legStartDist).toBeCloseTo(nextTargetLengthM(1, SEED), 6)
  })

  it('keeps every leg of a long run inside the pace', () => {
    const m = createMission(SEED, ROAD)
    let dist = 0
    for (let leg = 0; leg < 20; leg++) {
      const onTheClock = m.timerMs
      // Each leg's own budget, ignoring anything banked, must be on the clock.
      expect(legBudgetMs(m.legStartDist, m.targetDist, ROAD))
        .toBeLessThanOrEqual(onTheClock + 0.01)
      dist = m.targetDist
      expect(deliverIfArrived(m, dist, ROAD)).toBe(true)
    }
    expect(m.deliveryCount).toBe(20)
  })
})

describe('timer', () => {
  it('counts down and stops at zero', () => {
    const m = createMission(SEED, ROAD)
    tickMission(m, m.timerMs + 5000)
    expect(m.timerMs).toBe(0)
    expect(isMissionExpired(m)).toBe(true)
  })

  it('is not expired while time remains', () => {
    const m = createMission(SEED, ROAD)
    tickMission(m, m.timerMs - 1)
    expect(isMissionExpired(m)).toBe(false)
  })

  it('takes the canister bonus straight onto the clock', () => {
    const m = createMission(SEED, ROAD)
    const before = m.timerMs
    addMissionTime(m, 10_000)
    expect(m.timerMs).toBe(before + 10_000)
  })
})

describe('remaining distance', () => {
  it('never reads negative once the truck is past the target', () => {
    const m = createMission(SEED, ROAD)
    expect(remainingM(m, 0)).toBe(FIRST_TARGET_DIST_M)
    expect(remainingM(m, FIRST_TARGET_DIST_M + 500)).toBe(0)
  })
})
