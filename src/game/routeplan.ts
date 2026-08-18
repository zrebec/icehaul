/**
 * How long this particular road *should* take — the clock that knows the route.
 *
 * The road is a deterministic function of the seed, so the game can look at the
 * kilometres ahead and work out what they cost before the player drives them.
 * The delivery budget is built from that instead of from a flat average pace,
 * which is what `MISSION_PACE_KMH` was: a number copied off the original first
 * leg, held fixed while a competent run learned to hold 42-46 km/h, and
 * therefore banking about ten seconds a kilometre until the clock stopped
 * meaning anything.
 *
 * ── Three layers, and each answers a different question ─────────────────────
 * 1. **How fast may I go here?** — the friction circle, anchored on the measured
 *    envelope in `controllability.test.ts`. See {@link safeSpeedKph}.
 * 2. **How fast can I actually be going here?** — the same road with braking and
 *    acceleration applied, because a limit you cannot reach or cannot leave is
 *    not a limit you drive. See {@link speedProfile}.
 * 3. **How much more than the ideal does a human need?** — the slack, calibrated
 *    against the completability bot rather than reasoned about.
 *
 * ── Why layer 2 is not optional ─────────────────────────────────────────────
 * Summing `distance / safeSpeed` looks like the whole job and is the trap in it.
 * That sum assumes speed changes instantly, and a route that alternates asphalt
 * at 120 with ice at 40 every few hundred metres spends most of its time doing
 * neither: it is braking into the ice and climbing back out. Ignore that and the
 * budget comes out tightest on exactly the routes this feature exists to
 * measure properly.
 *
 * ── The rule this module must never break ───────────────────────────────────
 * It shares no constant with `completability.test.ts`. That bot is a crude human
 * heuristic on purpose, and its own comments explain why: a driver steering by
 * the physics it exists to audit proves nothing. The same circularity would
 * apply here, one level up — a budget derived from the bot's speeds, checked by
 * the bot, is a tautology with extra steps.
 */

import {
  MAX_SPEED,
  PLAN_ACCEL_MS2, PLAN_C_MIN, PLAN_STEP_M, PLAN_SURFACE_VMAX, PLAN_V_REF,
  PLAN_EXPECTED_CANISTER_PCT, PLAN_FIRST_LEG_BONUS_S, PLAN_SLACK,
  PLAN_START_ALLOWANCE_S, PLAN_TRAFFIC_ALLOWANCE_S_PER_KM,
  PLAN_PACE_MAX_KMH, PLAN_PACE_MIN_KMH,
  CANISTER_SPACING_M, CANISTER_TIME_BONUS_S,
  SURFACE_BRAKE,
  type Surface,
} from '../config.ts'

/** Everything the planner needs to know about the road, and nothing more.
 *  Injected so the planner can be tested over a road that does not exist. */
export interface RoadSampler {
  surfaceAt(distM: number): Surface
  gripAt(distM: number): number
  curvatureAt(distM: number): number
}

const KPH_TO_MS = 1 / 3.6

/**
 * The fastest this point may be taken, km/h.
 *
 * `v = V_REF / sqrt(curvature) * sqrt(grip)`, capped by the truck's top speed and
 * by what the surface's drag allows on a straight. The first half is the
 * friction circle and the second is the measured envelope — twenty cells of
 * `controllability.test.ts` reproduced by one line, to within about 5 %.
 *
 * Grip comes from `getGripAt`, not from `SURFACE_GRIP[surface]`, so the 20 m
 * ramp across a seam is already in it: the plan must not assume an edge the
 * physics does not have.
 */
export function safeSpeedKph(curvature: number, grip: number, surface: Surface): number {
  const bend = PLAN_V_REF / Math.sqrt(Math.max(Math.abs(curvature), PLAN_C_MIN))
  const cornering = bend * Math.sqrt(Math.max(0, grip))
  return Math.min(MAX_SPEED, PLAN_SURFACE_VMAX[surface], cornering)
}

/**
 * The speed a driver who knows the road would actually carry, sample by sample,
 * in m/s. Two passes over the limit curve:
 *
 * - **backwards**, so a limit ahead reaches back up the road as the braking
 *   distance it really needs. This is what turns "there is ice at 400 m" into
 *   "you are already slowing at 300 m", which is the game's whole thesis;
 * - **forwards**, so leaving a slow section costs what climbing back through the
 *   gears costs.
 *
 * Exported for the tests, which check the shape of the curve rather than the
 * single number that falls out of it.
 */
export function speedProfile(startM: number, endM: number, road: RoadSampler): number[] {
  const span = Math.max(0, endM - startM)
  const count = Math.max(2, Math.ceil(span / PLAN_STEP_M) + 1)
  const step = span / (count - 1)

  const v: number[] = new Array<number>(count)
  const brake: number[] = new Array<number>(count)

  for (let i = 0; i < count; i++) {
    const d = startM + i * step
    const surface = road.surfaceAt(d)
    v[i] = safeSpeedKph(road.curvatureAt(d), road.gripAt(d), surface) * KPH_TO_MS
    brake[i] = SURFACE_BRAKE[surface].decel * KPH_TO_MS
  }

  // Braking: what can I still be doing here, given what is coming?
  for (let i = count - 2; i >= 0; i--) {
    const reachable = Math.sqrt(v[i + 1]! * v[i + 1]! + 2 * brake[i]! * step)
    if (reachable < v[i]!) v[i] = reachable
  }

  // Acceleration: what can I be doing here, given where I have come from?
  for (let i = 1; i < count; i++) {
    const reachable = Math.sqrt(v[i - 1]! * v[i - 1]! + 2 * PLAN_ACCEL_MS2 * step)
    if (reachable < v[i]!) v[i] = reachable
  }

  return v
}

export interface LegPlan {
  /** Metres the leg covers. */
  lengthM: number
  /** Seconds a driver who knows every metre would need. */
  idealTimeS: number
  /** Seconds the clock actually grants, before carry-over. */
  budgetS: number
  /** What `budgetS` implies as an average speed, km/h — the readable summary. */
  paceKph: number
  /** True when the guard rails had to catch the number. Always a signal. */
  clamped: boolean
}

/** Time to drive a finished speed profile, seconds. */
function profileTimeS(v: readonly number[], span: number): number {
  if (v.length < 2 || span <= 0) return 0
  const step = span / (v.length - 1)
  let t = 0
  for (let i = 0; i < v.length - 1; i++) {
    const mean = (v[i]! + v[i + 1]!) / 2
    if (mean > 0.01) t += step / mean
  }
  return t
}

/**
 * The budget for one leg.
 *
 * `idealTimeS x slack`, plus what the plan cannot see (a standing start, traffic
 * it does not model), **minus the time the road is about to hand back**: each
 * canister is worth {@link CANISTER_TIME_BONUS_S}, and at today's spacing that is
 * +14.3 s per kilometre — more than the surplus this feature exists to remove.
 * Budgeting for a share of them (never all — see `PLAN_EXPECTED_CANISTER_PCT`)
 * is what stops the bonus from quietly undoing the clock.
 *
 * Finally clamped to a demanded average speed between `PLAN_PACE_MIN_KMH` and
 * `PLAN_PACE_MAX_KMH`. That clamp is the thing 0.8.1 did not have.
 */
export function planLeg(
  startM: number,
  endM: number,
  road: RoadSampler,
  opts: { firstLeg?: boolean } = {},
): LegPlan {
  const lengthM = Math.max(0, endM - startM)
  const km = lengthM / 1000
  const idealTimeS = profileTimeS(speedProfile(startM, endM, road), lengthM)

  const expectedCanisters = lengthM / CANISTER_SPACING_M
  const canisterCreditS = expectedCanisters * CANISTER_TIME_BONUS_S * PLAN_EXPECTED_CANISTER_PCT

  const raw = idealTimeS * PLAN_SLACK
    + PLAN_START_ALLOWANCE_S
    + (opts.firstLeg ? PLAN_FIRST_LEG_BONUS_S : 0)
    + km * PLAN_TRAFFIC_ALLOWANCE_S_PER_KM
    - canisterCreditS

  const floorS = km / PLAN_PACE_MAX_KMH * 3600
  const ceilS = km / PLAN_PACE_MIN_KMH * 3600
  const budgetS = Math.min(ceilS, Math.max(floorS, raw))

  return {
    lengthM,
    idealTimeS,
    budgetS,
    paceKph: budgetS > 0 ? km / (budgetS / 3600) : 0,
    clamped: budgetS !== raw,
  }
}
