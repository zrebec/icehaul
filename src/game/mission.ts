/**
 * Delivery mission state: where the next drop-off is, and how long there is to
 * reach it.
 *
 * This used to live as three local variables inside the drive scene's closure,
 * which is precisely why the game shipped a mission nobody could finish. With
 * the rules sealed inside a scene there was nothing to unit-test, and the only
 * test that touched them — `completability.test.ts` — stopped at the first
 * delivery and so never saw the second leg ask for 15 to 25 km against a clock
 * that had just been reset to eight minutes.
 *
 * So the rules live here, as a plain deterministic state machine: no canvas, no
 * audio, no vehicle. The drive scene and the completability bot drive the same
 * one, which is the point — the bot cannot pass a mission the player would fail.
 */

import {
  FIRST_TARGET_DIST_M, NEXT_TARGET_RANGE, DELIVERY_TIME_CARRY_PCT,
} from '../config.ts'
import { planLeg, type RoadSampler } from './routeplan.ts'

function hash(n: number): number {
  let x = (n + 0x9E3779B9) | 0
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B)
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35)
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000
}

export interface MissionState {
  /** Route seed — the leg lengths hang off it, like every other stream. */
  readonly seed: number
  /** Absolute world distance of the current drop-off (metres). */
  targetDist: number
  /** Absolute world distance the current leg started at (metres). */
  legStartDist: number
  /** Time left to reach `targetDist` (ms). Zero means the run is over. */
  timerMs: number
  /** How many deliveries have been completed. */
  deliveryCount: number
  /** What the current leg was granted, ms — shown on pickup so a veteran can
   *  read the route off the clock, which is the point of the whole thing. */
  lastBudgetMs: number
}

/**
 * Time allowed for the leg from `startM` to `endM`, given the road it crosses.
 *
 * It was `lengthM / MISSION_PACE_KMH` — proportional, which fixed the 0.8.1
 * discontinuity, but blind: every kilometre was priced the same whether it was
 * asphalt or ice. A competent run holds 42-46 km/h against a 37.5 km/h pace, so
 * the surplus compounded until the clock stopped meaning anything.
 *
 * Now the budget is read off *this* road — see `routeplan.ts`. The consequence
 * is deliberate and worth knowing before playing: a flat pace punishes being
 * slow, and a route-aware one punishes being **cautious**. Ice legs get calmer,
 * asphalt legs get tense.
 */
export function legBudgetMs(startM: number, endM: number, road: RoadSampler, firstLeg = false): number {
  return Math.round(planLeg(startM, endM, road, { firstLeg }).budgetS * 1000)
}

/**
 * Length of the leg that follows delivery number `deliveryCount`, in metres.
 *
 * Mixed with the route seed. It was `hash(deliveryCount * 71)` with no seed at
 * all, so every route in the game asked for the same sequence of distances —
 * the one procedural stream that was not a function of the route.
 */
export function nextTargetLengthM(deliveryCount: number, seed: number): number {
  const [minD, maxD] = NEXT_TARGET_RANGE
  return minD + (maxD - minD) * hash(deliveryCount * 71 + 23 + seed)
}

/**
 * The road is injected rather than imported so this module stays pure and the
 * planner can be tested over a road that does not exist. It also keeps the
 * dependency pointing one way: the mission asks the road questions, never the
 * other way round.
 */
export function createMission(seed: number, road: RoadSampler): MissionState {
  return {
    seed,
    targetDist: FIRST_TARGET_DIST_M,
    legStartDist: 0,
    timerMs: legBudgetMs(0, FIRST_TARGET_DIST_M, road, true),
    deliveryCount: 0,
    lastBudgetMs: legBudgetMs(0, FIRST_TARGET_DIST_M, road, true),
  }
}

/** Count the clock down. Never goes below zero. */
export function tickMission(m: MissionState, dtMs: number): void {
  m.timerMs = Math.max(0, m.timerMs - dtMs)
}

/** True once the clock has run out — the timeout game-over condition. */
export function isMissionExpired(m: MissionState): boolean {
  return m.timerMs <= 0
}

/**
 * Advance the mission if the truck has reached the drop-off. Returns true on
 * the frame a delivery lands, so the caller can pay out fuel, score and noise.
 *
 * Unused time carries over at `DELIVERY_TIME_CARRY_PCT` rather than being
 * discarded: the timer used to be *reset* to a full budget on delivery, which
 * read to the player as gaining a couple of minutes when it was really the
 * clock jumping backwards.
 */
export function deliverIfArrived(m: MissionState, distanceM: number, road: RoadSampler): boolean {
  if (distanceM < m.targetDist) return false

  m.deliveryCount++
  const carried = m.timerMs * DELIVERY_TIME_CARRY_PCT
  const legLength = nextTargetLengthM(m.deliveryCount, m.seed)
  m.legStartDist = m.targetDist
  m.targetDist = m.targetDist + legLength
  // Planned once, here, and never again: the road ahead does not change under
  // the player, so a per-frame recomputation would be the same answer at a cost.
  m.lastBudgetMs = legBudgetMs(m.legStartDist, m.targetDist, road)
  m.timerMs = carried + m.lastBudgetMs
  return true
}

/** Add time to the clock — canisters pay in seconds as well as in fuel. */
export function addMissionTime(m: MissionState, ms: number): void {
  m.timerMs += ms
}

/** Metres still to drive on the current leg (never negative). */
export function remainingM(m: MissionState, distanceM: number): number {
  return Math.max(0, m.targetDist - distanceM)
}
