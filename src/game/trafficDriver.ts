/**
 * What a driver in traffic wants to be doing, metre by metre.
 *
 * Pure and stateless: nothing here touches a vehicle. `traffic.ts` owns the state
 * and applies what this module decides, which is what lets the decisions be
 * tested over a road that does not exist.
 *
 * ── The two halves of "how fast should I be going" ──────────────────────────
 * The cornering law in `safespeed.ts` says what the tyres allow. That is the
 * wrong question for a car at 45 km/h: the sharpest bend on asphalt allows
 * 84.9 km/h, so a model built on grip alone would never light a single brake
 * light. `TRAFFIC_CORNER_COMFORT_PCT` is the other half — what a driver actually
 * uses — and `TRAFFIC_SURFACE_MAX_KPH` covers the case the cornering law cannot
 * speak about at all, which is a straight piece of ice.
 *
 * ── Why the anticipation is a separate deceleration ─────────────────────────
 * The look-ahead *time* is not what puts the lights on early; the deceleration
 * the driver plans with is. At the emergency rate a car sheds 55 to 30 km/h in
 * 6.6 m, so the lamp would be a blink nobody could read. Planning at
 * `TRAFFIC_BRAKE_PLAN_KMH_S` moves that to about 42 m, which is a signal.
 * Measured table in that constant's docblock.
 */

import { corneringSpeedKph, type RoadSampler } from './safespeed.ts'
import {
  TRAFFIC_ACCEL_KMH_S,
  TRAFFIC_BRAKE_LAMP_MIN_KMH_S, TRAFFIC_BRAKE_MAX_KMH_S, TRAFFIC_BRAKE_MIN_KMH_S,
  TRAFFIC_BRAKE_PLAN_KMH_S, TRAFFIC_BRAKE_RESPONSE_S,
  TRAFFIC_CORNER_COMFORT_PCT, TRAFFIC_SURFACE_MAX_KPH, TRAFFIC_SURFACE_PACE_PCT,
  TRAFFIC_FOLLOW_TIME_S, TRAFFIC_FOLLOW_UNDERSHOOT_KMH, TRAFFIC_MIN_FOLLOW_GAP_M,
  TRAFFIC_LOOKAHEAD_MAX_M, TRAFFIC_LOOKAHEAD_MIN_M, TRAFFIC_LOOKAHEAD_S,
  TRAFFIC_LOOKAHEAD_STEP_M,
} from '../config.ts'

/**
 * The two things that make one driver different from another, drawn once per
 * vehicle from the route seed — see `spawnVehicle`.
 *
 * Two rather than one so that "brakes early and gently" and "brakes late and
 * hard" are both drivers who exist. A single dial would only ever produce one
 * diagonal through that square.
 */
export interface DriverTraits {
  /** Above 1 reads further ahead and accepts a lower speed. */
  caution: number
  /** Above 1 leans harder on the pedal once the decision is made. */
  vigour: number
}

/** Something in the way: another vehicle, or the player. Same problem twice. */
export interface Obstacle {
  /** Metres ahead. Zero or negative means it is not in front and does not count. */
  gapM: number
  speedKph: number
}

export interface SpeedStep {
  speedKph: number
  /** True while the pedal is actually down hard enough to light the lamps. */
  braking: boolean
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

const KPH_TO_MS = 1 / 3.6

/**
 * The speed the road at `distM` allows, before anything else is in the way.
 *
 * Three caps, and each answers something the other two cannot: the bend (from
 * the friction circle, scaled down to what a driver uses), the surface (because
 * the bend says nothing about a straight), and the vehicle's own cruise.
 */
export function roadLimitKph(
  road: RoadSampler,
  distM: number,
  cruiseKph: number,
  caution: number,
): number {
  const c = Math.max(0.01, caution)
  const physical = corneringSpeedKph(road.curvatureAt(distM), road.gripAt(distM))
  let limit = physical * TRAFFIC_CORNER_COMFORT_PCT / c

  // Two rules about the surface, and each catches what the other misses: an
  // absolute cap ("nobody does 55 on bare ice") only slows vehicles that were
  // already above it, and a share of cruise ("everybody comes off their own
  // pace") only slows them in proportion. Together they mean a 30 km/h car and a
  // 55 km/h car both brake for the same snow, by different amounts.
  const surface = road.surfaceAt(distM)
  const surfaceCap = TRAFFIC_SURFACE_MAX_KPH[surface]
  if (surfaceCap !== null) limit = Math.min(limit, surfaceCap / c)
  limit = Math.min(limit, cruiseKph * TRAFFIC_SURFACE_PACE_PCT[surface] / c)

  return Math.min(limit, cruiseKph)
}

/**
 * How fast this vehicle may be going *here*, given everything it can see ahead.
 *
 * The backward pass `routeplan.ts` runs over a whole leg, run online over one
 * driver's horizon: a limit `d` metres away reaches back as the braking distance
 * it needs. That is what turns "there is ice at 40 m" into "the brake lights come
 * on now" — without it a car would arrive at the ice at full speed and brake
 * afterwards, which is both wrong and useless as a signal to the player behind.
 */
export function roadTargetKph(
  road: RoadSampler,
  distM: number,
  speedKph: number,
  cruiseKph: number,
  traits: DriverTraits,
): number {
  const horizonM = clamp(
    speedKph * KPH_TO_MS * TRAFFIC_LOOKAHEAD_S * Math.max(0.01, traits.caution),
    TRAFFIC_LOOKAHEAD_MIN_M,
    TRAFFIC_LOOKAHEAD_MAX_M,
  )
  const planDecelMs2 = TRAFFIC_BRAKE_PLAN_KMH_S * KPH_TO_MS * Math.max(0.01, traits.vigour)

  // Evenly spaced and always including both ends, so a horizon that is not a
  // whole number of steps still sees the limit at the far end of it.
  const steps = Math.max(1, Math.ceil(horizonM / TRAFFIC_LOOKAHEAD_STEP_M))
  let target = cruiseKph

  for (let i = 0; i <= steps; i++) {
    const d = horizonM * (i / steps)
    const limitMs = roadLimitKph(road, distM + d, cruiseKph, traits.caution) * KPH_TO_MS
    // v² = u² + 2as, solved for what I may be doing now and still be down to
    // `limit` in `d` metres at the deceleration this driver plans with.
    const reachableKph = Math.sqrt(limitMs * limitMs + 2 * planDecelMs2 * d) / KPH_TO_MS
    if (reachableKph < target) target = reachableKph
  }

  return target
}

/**
 * The speed a follower accepts behind whatever is in front of it.
 *
 * Returns **Infinity** when there is nothing to answer for, rather than the
 * vehicle's own speed. That matters: callers take a minimum across every
 * constraint, and a constraint that reported the current speed would pin a
 * vehicle that had just braked to the speed it braked to — it could never get
 * back up to cruise, because "no constraint" would keep saying "stay here".
 */
export function followTargetKph(gapM: number, ownSpeed: number, leadSpeed: number): number {
  if (gapM <= 0) return Number.POSITIVE_INFINITY          // behind me; not my problem
  if (ownSpeed <= leadSpeed) return Number.POSITIVE_INFINITY  // not closing

  const closingMs = (ownSpeed - leadSpeed) * KPH_TO_MS
  const desiredGapM = TRAFFIC_MIN_FOLLOW_GAP_M + ownSpeed * KPH_TO_MS * TRAFFIC_FOLLOW_TIME_S
  const timeToContactS = gapM / closingMs
  if (gapM >= desiredGapM && timeToContactS >= TRAFFIC_FOLLOW_TIME_S) {
    return Number.POSITIVE_INFINITY
  }

  // Matching the leader is only good enough while there is still a gap to keep.
  // Once inside `TRAFFIC_MIN_FOLLOW_GAP_M` the target has to go *below* it, or a
  // gap that has already closed too far can never open again — measured before
  // this line existed: two vehicles came within 1.6 m of each other, on a road
  // where a vehicle is 6 m long.
  const room = clamp(gapM / TRAFFIC_MIN_FOLLOW_GAP_M, 0, 1)
  return Math.max(0, (leadSpeed - TRAFFIC_FOLLOW_UNDERSHOOT_KMH) * room)
}

/**
 * Everything at once: the road ahead and everything in the way, whichever asks
 * for less. `road` may be null, in which case only the obstacles count.
 */
export function chooseTargetKph(
  road: RoadSampler | null,
  distM: number,
  speedKph: number,
  cruiseKph: number,
  traits: DriverTraits,
  obstacles: readonly Obstacle[],
): number {
  let target = road
    ? roadTargetKph(road, distM, speedKph, cruiseKph, traits)
    : cruiseKph

  for (const o of obstacles) {
    const t = followTargetKph(o.gapM, speedKph, o.speedKph)
    if (t < target) target = t
  }

  return clamp(target, 0, cruiseKph)
}

/**
 * One tick of pedal work: close on the target, and say whether the lamps are lit.
 *
 * The deceleration is what the gap *demands* — the excess divided by
 * `TRAFFIC_BRAKE_RESPONSE_S` — rather than a constant, so a driver easing off for
 * a bend 80 m away and one whose target just collapsed behind a stopped car do
 * visibly different things. Vigour scales it, which is where the last of the
 * variety comes from.
 *
 * The lamp reads the deceleration **actually achieved**, not the rate that was
 * asked for. Those differ on the tick a vehicle finally reaches its target, and
 * reading the intent instead would light the lamps for a vehicle creeping down
 * the last 0.1 km/h — which is exactly the flicker the hold timer exists to stop.
 */
export function stepSpeed(
  speedKph: number,
  targetKph: number,
  cruiseKph: number,
  traits: DriverTraits,
  dtMs: number,
): SpeedStep {
  const dt = Math.max(0, dtMs) / 1000

  if (targetKph < speedKph - 0.001) {
    const demandKmhS = (speedKph - targetKph) / TRAFFIC_BRAKE_RESPONSE_S
    const decelKmhS = clamp(demandKmhS, TRAFFIC_BRAKE_MIN_KMH_S, TRAFFIC_BRAKE_MAX_KMH_S)
      * Math.max(0, traits.vigour)
    const next = Math.max(targetKph, speedKph - decelKmhS * dt)
    const achievedKmhS = dt > 0 ? (speedKph - next) / dt : 0
    return { speedKph: next, braking: achievedKmhS >= TRAFFIC_BRAKE_LAMP_MIN_KMH_S }
  }

  // Nothing to slow for: back toward cruise, never past the current target.
  const ceiling = Math.min(cruiseKph, targetKph)
  return { speedKph: Math.min(ceiling, speedKph + TRAFFIC_ACCEL_KMH_S * dt), braking: false }
}
