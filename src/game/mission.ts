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
  FIRST_TARGET_DIST_M, NEXT_TARGET_RANGE, MISSION_PACE_KMH,
  DELIVERY_TIME_LIMIT_MS, DELIVERY_TIME_CARRY_PCT,
} from '../config.ts'

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
}

/**
 * Time allowed for a leg of `lengthM` metres.
 *
 * Proportional, so the clock makes the same promise on every leg. A flat budget
 * is what created the discontinuity at the first delivery, and it would create
 * another one the next time leg length changed.
 */
export function legBudgetMs(lengthM: number): number {
  return Math.round(lengthM / 1000 / MISSION_PACE_KMH * 3_600_000)
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

export function createMission(seed: number): MissionState {
  return {
    seed,
    targetDist: FIRST_TARGET_DIST_M,
    legStartDist: 0,
    timerMs: DELIVERY_TIME_LIMIT_MS,
    deliveryCount: 0,
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
export function deliverIfArrived(m: MissionState, distanceM: number): boolean {
  if (distanceM < m.targetDist) return false

  m.deliveryCount++
  const carried = m.timerMs * DELIVERY_TIME_CARRY_PCT
  const legLength = nextTargetLengthM(m.deliveryCount, m.seed)
  m.legStartDist = m.targetDist
  m.targetDist = m.targetDist + legLength
  m.timerMs = carried + legBudgetMs(legLength)
  return true
}

/** Metres still to drive on the current leg (never negative). */
export function remainingM(m: MissionState, distanceM: number): number {
  return Math.max(0, m.targetDist - distanceM)
}
