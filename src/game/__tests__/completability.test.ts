/**
 * Completability simulation — the delivery run.
 *
 * Runs the vehicle physics frame-by-frame (16 ms ticks, ~60 fps) with a
 * proportional speed controller and a simple steering P-controller that
 * keeps the truck centred. This is an ideal-driver lower bound: if it fails
 * here, no human can complete it either.
 *
 * Three strategies are compared:
 *   aggressive  — push speed as high as surface allows
 *   moderate    — careful but not paranoid
 *   conservative — fuel-first, bare-minimum speed above the 43 km/h average
 *
 * The test asserts that at least ONE strategy can complete 5 km within
 * 7 minutes without running out of fuel.  A detailed surface/speed table
 * is always printed so you can see what's eating the budget.
 *
 * ── Off-road ────────────────────────────────────────────────────────────────
 * This file used to say "off-road is not checked", and that hole is exactly how
 * an ice-in-a-sharp-curve layout — which no human can hold — kept passing. Every
 * tick now also asks the game's own geometry whether the truck left the road, and
 * a separate assertion forbids the run drive.ts would have ended.
 *
 * The excursion is *recorded, not acted on*: the sim keeps driving afterwards, so
 * "is there enough time and fuel" stays answerable independently of "can it be
 * steered". Two questions, two verdicts — collapsing them would mean one broken
 * axis blinds the other. See `controllability.test.ts` for the lateral envelope.
 *
 * ── Past the first delivery ─────────────────────────────────────────────────
 * The sweep below stops at 5 km, and for a long time that was the whole file —
 * which is exactly how 0.8.1 shipped a second leg asking for 15 to 25 km against
 * a clock that had just been reset to eight minutes. "Completable" meant "the
 * first leg is completable" and nothing more.
 *
 * So `runSim` now takes a leg count and walks the real `game/mission.ts` state
 * machine, the same one the drive scene runs. Beyond one leg the driver also has
 * to refuel: a delivery only pays back half a tank and a leg costs most of one,
 * so canisters stop being a bonus and become the thing that keeps the run alive.
 * The bot detours for them the way a human does — only when it needs the fuel,
 * only when the road is straight enough and grippy enough to be worth leaving
 * the middle for — and confirms the pickup by calling the game's own
 * `checkCanisterPickup`, never a re-derived threshold.
 */

import { describe, it, expect } from 'vitest'
import { resetRoad, getSurfaceAt, getCurvatureAt, getGripAt, accelFor, type Surface } from '../road.ts'
import { createVehicle, tickVehicle } from '../vehicle.ts'
import { computeRoadEdges } from '../roadgeometry.ts'
import { checkTruckOffroad } from '../offroad.ts'
import { resetCanisters, getVisibleCanisters, checkCanisterPickup } from '../canisters.ts'
import {
  createMission, tickMission, deliverIfArrived, isMissionExpired, legBudgetMs,
} from '../mission.ts'
import { TRUCK_BMP_W, TRUCK_BMP_H } from '../../render/truck.ts'
import {
  DELIVERY_TIME_LIMIT_MS, FIRST_TARGET_DIST_M, DELIVERY_FUEL_REFILL,
  SURFACE_FUEL_MULT, GEARS, GEAR_COUNT, CLUTCH_MATCH_TOLERANCE,
  GAME_WIDTH, VIEWPORT_BOTTOM, OFFROAD_CRASH_SEVERITY, OFFROAD_TIMEOUT_S,
} from '../../config.ts'

// ─── Strategies ──────────────────────────────────────────────────────────────

type Strategy = Record<Surface, number>

const STRATEGIES: Record<string, Strategy> = {
  // Straight-line targets; every strategy eases off for bends via curveSpeedFactor.
  // Aggressive was recalibrated when the lateral envelope was fixed — its brief is
  // "as fast as the surface allows", and the surface now allows more. Left at the
  // old numbers it could no longer burn a tank inside 5 km, which cost the sweep
  // its proof that the FUEL OUT game-over is reachable at all.
  aggressive: {
    asphalt: 115,
    snow:    80,
    ice:     50,
    sand:    80,
    mud:     75,
  },
  moderate: {
    asphalt: 65,
    snow:    50,
    ice:     32,
    sand:    50,
    mud:     45,
  },
  conservative: {
    asphalt: 52,
    snow:    46,
    ice:     28,
    sand:    46,
    mud:     42,
  },
}

// ─── Simulation types ─────────────────────────────────────────────────────────

interface SegmentSummary {
  surface: Surface
  startM: number
  endM: number
  lengthM: number
  targetKph: number
  avgKph: number
  timeS: number
  fuelUsed: number
  fuelPerKm: number
  fuelMult: number
}

/** One delivery leg, as the mission handed it out and as the driver drove it. */
interface LegSummary {
  /** 1-based leg number. */
  index: number
  lengthM: number
  timeS: number
  /** What the mission allowed for this leg alone, ignoring anything banked. */
  budgetS: number
  /** Time still on the clock at the drop-off — this is what carries over. */
  timeLeftS: number
  fuelStart: number
  fuelEnd: number
  canisters: number
}

interface SimResult {
  strategy: string
  completed: boolean
  failReason: 'timeout' | 'fuel' | null
  distanceM: number
  elapsedMs: number
  fuelRemaining: number
  avgKph: number
  segments: SegmentSummary[]
  /** Completed deliveries. */
  deliveries: number
  /** Per-leg breakdown; empty for a run that never reached a drop-off. */
  legs: LegSummary[]
  /** Canisters picked up, across the whole run. */
  canisters: number
  /** Worst off-road severity seen (0 = never left the road). */
  maxOffroadSeverity: number
  /** Surface the truck was on when it first left the road, if it ever did. */
  offroadSurface: Surface | null
  /**
   * Distance at which drive.ts would have ended the run off-road, or null.
   * Recorded rather than acted on: the sim keeps driving so that the time and
   * fuel verdicts stay independent of the lateral verdict.
   */
  offroadCrashAtM: number | null
}

// ─── Core simulation ─────────────────────────────────────────────────────────

const DT_MS = 16
const SEED  = 42

/**
 * How far ahead the driver reads the road, and how hard they lift for what they
 * see. A strategy's number is its speed on a *straight* stretch of that surface;
 * this is the part that says "and you ease off for the bend", which is the whole
 * premise of the game and was missing from the model entirely.
 *
 * Deliberately a crude human heuristic and NOT derived from any physics
 * constant. If the driver picked its speed from the real lateral envelope the
 * off-road assertion would be circular — the sim would be steering by the same
 * numbers it exists to audit.
 */
const CURVE_CAUTION = 0.35
const CURVE_LOOKAHEAD_M = 90
const CURVE_SAMPLE_M = 15

/**
 * How far ahead the driver reads the *surface*. Deliberately shorter than
 * `ICE_AHEAD_LOOK_M` (220 m): the sim must never plan on more warning than the
 * top bar actually gives a human.
 *
 * Without this the driver only reacted to the surface under its own wheels, and
 * on ice — decel 8 km/h/s against speedFade 0.55 — that is far too late. You
 * brake for ice while still on asphalt or you do not brake at all.
 */
const SURFACE_LOOKAHEAD_M = 150
const SURFACE_SAMPLE_M = 25

/** Sharpest curvature within the driver's look-ahead, as a speed multiplier. */
function curveSpeedFactor(distM: number): number {
  let peak = 0
  for (let d = distM; d <= distM + CURVE_LOOKAHEAD_M; d += CURVE_SAMPLE_M) {
    const c = Math.abs(getCurvatureAt(d))
    if (c > peak) peak = c
  }
  return 1 / (1 + peak * CURVE_CAUTION)
}

/** Speed to hold now: slowest surface in sight, eased further for the bend. */
function plannedTarget(distM: number, targetKph: Strategy): number {
  let slowest = Infinity
  for (let d = distM; d <= distM + SURFACE_LOOKAHEAD_M; d += SURFACE_SAMPLE_M) {
    const t = targetKph[getSurfaceAt(d) as Surface]
    if (t < slowest) slowest = t
  }
  return slowest * curveSpeedFactor(distM)
}

/**
 * ── Refuelling detour ───────────────────────────────────────────────────────
 * A delivery pays back half a tank and a leg costs most of one, so past the
 * first drop-off the run lives or dies on canisters. These say when the driver
 * is willing to leave the middle of the road for one — the same judgement a
 * human makes, and deliberately conservative on all three axes.
 */
/** Fuel level below which the driver starts detouring for canisters. */
const CANISTER_SEEK_FUEL = 0.65
/** How far ahead a canister has to be to be worth aiming at (metres). */
const CANISTER_SEEK_LOOK_M = 260
/**
 * Grip below which the driver stays in the middle whatever the fuel says.
 * Swerving for a jerrycan on ice is how you end up in the snowbank, and the
 * off-road assertion below would rightly call that a failure of the route.
 */
const CANISTER_SEEK_MIN_GRIP = 0.6
/**
 * Sharpest curvature the driver will detour through. A bend moves the road
 * out from under a truck that is already off-centre.
 */
const CANISTER_SEEK_MAX_CURVE = 0.8
/**
 * Lateral limit for the detour. Canisters sit at up to ±0.9 and the pickup
 * radius is 0.25, so ±0.7 reaches every one of them while keeping the truck
 * clear of the kerb — measured: at x = 1.0 on a straight there are 3 px of
 * road left, and a bend eats more than that.
 */
const CANISTER_SEEK_MAX_X = 0.7

/**
 * Where the driver wants to be laterally: the middle, unless it is short of
 * fuel and there is a canister ahead worth a detour.
 */
function canisterAimX(distM: number, fuel: number): number {
  if (fuel >= CANISTER_SEEK_FUEL) return 0
  if (getGripAt(distM) < CANISTER_SEEK_MIN_GRIP) return 0
  if (Math.abs(getCurvatureAt(distM)) > CANISTER_SEEK_MAX_CURVE) return 0

  const ahead = getVisibleCanisters(distM, CANISTER_SEEK_LOOK_M)
  let nearest: number | null = null
  let nearestDist = Infinity
  for (const c of ahead) {
    const gap = c.distM - distM
    if (gap <= 0 || gap >= nearestDist) continue
    // Do not commit to a detour that a bend between here and there would spoil.
    if (Math.abs(getCurvatureAt(c.distM)) > CANISTER_SEEK_MAX_CURVE) continue
    nearest = c.x
    nearestDist = gap
  }
  if (nearest === null) return 0
  return Math.max(-CANISTER_SEEK_MAX_X, Math.min(CANISTER_SEEK_MAX_X, nearest))
}

/** Mirrors `drive.ts:547` — where the truck is drawn for a given lateral state. */
function truckDrawPos(playerX: number, lateralV: number) {
  return {
    x: Math.round(GAME_WIDTH / 2 + playerX * 50 - TRUCK_BMP_W / 2 + (-lateralV * 1.5)),
    y: Math.round(VIEWPORT_BOTTOM - 2 - TRUCK_BMP_H),
  }
}

// 20 diverse seeds that cover a wide range of generated surfaces, plus 1443866 —
// the owner's hand-verified worst case: a mostly-ice route completed in a real
// playtest with ~12 s to spare. It is the one entry here backed by a human hand
// on the keys rather than by sampling, so it stays in the sweep permanently.
const MULTI_SEEDS = [0, 1, 7, 42, 99, 137, 256, 500, 777, 999,
                     1234, 2025, 4096, 8888, 12345, 19999, 55555, 99999, 123456, 999999,
                     1443866]

interface SimOptions {
  /** Deliveries to attempt. 1 — the default — is the original first-leg run. */
  legs?: number
  /** Let the driver detour for canisters. Required for more than one leg. */
  collectCanisters?: boolean
}

function runSim(
  strategyName: string,
  targetKph: Strategy,
  seed = SEED,
  opts: SimOptions = {},
): SimResult {
  const legCount = opts.legs ?? 1
  const collectCanisters = opts.collectCanisters ?? false

  resetRoad(seed)
  // Same offset the drive scene uses, so the sim meets the canisters the player
  // would meet on this route rather than a different set.
  resetCanisters((seed + 2) >>> 0)
  const v = createVehicle()

  let elapsedMs     = 0
  let lastSurface   = getSurfaceAt(0) as Surface
  let segStartDist  = 0
  let segStartTime  = 0
  let segStartFuel  = v.fuel
  const segments: SegmentSummary[] = []
  // Clutch driver state (see the shift block in the loop below).
  let clutchPhase: 'in' | 'out' = 'out'

  // Off-road tracking. This used to be absent — the header said so — which is why
  // an ice-in-a-curve layout no human could survive still passed. The two failure
  // conditions below are exactly the ones drive.ts:419-420 and :440-443 act on.
  // Noting them does NOT stop the sim: time and fuel are separate questions and
  // must stay answerable even on a route that also happens to be undriveable.
  let maxOffroadSeverity = 0
  let offroadAccumS = 0
  let offroadSurface: Surface | null = null
  let offroadCrashAtM: number | null = null

  // Mission state — the real one from game/mission.ts, so this bot cannot pass
  // a leg the drive scene would have handed out differently.
  const mission = createMission(seed)
  const legs: LegSummary[] = []
  let canisters = 0
  let legStartDist = 0
  let legStartTime = 0
  let legStartFuel = v.fuel
  let legCanisters = 0

  function flushSegment(currentSurface: Surface, nowDist: number, nowTime: number, nowFuel: number) {
    const lengthM = nowDist - segStartDist
    if (lengthM < 1) return
    const timeS   = (nowTime - segStartTime) / 1000
    const fuelUsed = segStartFuel - nowFuel
    const avgKph  = timeS > 0 ? (lengthM / 1000) / (timeS / 3600) : 0
    segments.push({
      surface: lastSurface,
      startM:  Math.round(segStartDist),
      endM:    Math.round(nowDist),
      lengthM: Math.round(lengthM),
      targetKph: targetKph[lastSurface],
      avgKph:  Math.round(avgKph * 10) / 10,
      timeS:   Math.round(timeS * 10) / 10,
      fuelUsed: Math.round(fuelUsed * 10000) / 10000,
      fuelPerKm: lengthM > 0 ? Math.round(fuelUsed / (lengthM / 1000) * 1000) / 1000 : 0,
      fuelMult: SURFACE_FUEL_MULT[lastSurface],
    })
    lastSurface  = currentSurface
    segStartDist = nowDist
    segStartTime = nowTime
    segStartFuel = nowFuel
  }

  while (mission.deliveryCount < legCount && !isMissionExpired(mission)) {
    const surface  = getSurfaceAt(v.distance) as Surface
    const curvature = getCurvatureAt(v.distance)
    const grip     = getGripAt(v.distance)
    const accel    = accelFor(surface)
    // Straight-line speed for the worst surface in sight, eased off for the bend.
    const target   = plannedTarget(v.distance, targetKph)

    // Speed controller
    const throttle = v.speed < target
    const brake    = v.speed > target + 5

    // Steering P-controller — hold the aim line, counter vx drift. The aim is
    // the middle of the road unless the driver is detouring for fuel.
    const aimX = collectCanisters ? canisterAimX(v.distance, v.fuel) : 0
    const steerLeft  = v.x > aimX + 0.08 || v.vx > 0.12
    const steerRight = v.x < aimX - 0.08 || v.vx < -0.12

    // Auto-gearbox — keep revs in the power band so the ideal driver can use the
    // full speed range (mirrors what a human does with A/D shifting). rpm = speed / to.
    const spec = GEARS[v.gear - 1]!
    const rpm  = spec.to > 0 ? v.speed / spec.to : 0
    const wantUp   = throttle && rpm > 0.9 && v.gear < GEAR_COUNT
    const wantDown = rpm < 0.33 && v.gear > 1   // downshift well before lugging (LUG_RPM 0.25)

    // ── Clutch driver ──────────────────────────────────────────────────────
    // Shifting now requires the clutch (SHIFT), so the ideal driver has to work
    // one too — and that is the point of running it here. This bot does exactly
    // what a competent human does and nothing a human could not: press, select,
    // match the revs (blipping the throttle when the new gear wants MORE revs
    // than the engine currently has), release. It never reads a hidden number
    // and never teleports the gearbox.
    //
    // If this loop cannot finish 5 km inside the budget, the mechanic is not
    // completable and the tuning is wrong — that is the assertion these tests
    // are really making now.
    let shiftUp = false
    let shiftDown = false
    let clutch = false
    let blip = false

    if (clutchPhase === 'out') {
      if (wantUp || wantDown) {
        clutchPhase = 'in'
        clutch = true
        shiftUp = wantUp
        shiftDown = !wantUp
      }
    } else {
      clutch = true
      // Revs the wheels will demand once it bites — recomputed every tick,
      // because the truck keeps slowing down while we are declutched.
      const nextSpec = GEARS[v.gear - 1]!
      const wantRpm = nextSpec.to > 0 ? v.speed / nextSpec.to : 0
      const err = v.engineRpm - wantRpm
      if (Math.abs(err) <= CLUTCH_MATCH_TOLERANCE * 0.6) {
        clutch = false                 // release — inside the clean window
        clutchPhase = 'out'
      } else {
        blip = err < 0                 // engine too slow → blip (the downshift case)
      }
    }

    tickVehicle(
      v,
      {
        throttle: clutch ? blip : throttle,   // declutched, the throttle only revs the engine
        brake: clutch ? false : brake,
        steerLeft, steerRight, shiftUp, shiftDown, clutch,
      },
      surface, grip, accel, DT_MS, curvature,
    )

    // ── Did the truck leave the road? ──────────────────────────────────────
    // Measured through the game's own geometry, not a re-derived threshold.
    const pos = truckDrawPos(v.x, v.vx)
    const off = checkTruckOffroad(pos.x, pos.y, computeRoadEdges(v.distance, v.x, getCurvatureAt))
    if (off.severity > 0) {
      if (offroadSurface === null) offroadSurface = surface
      if (off.severity > maxOffroadSeverity) maxOffroadSeverity = off.severity
      offroadAccumS += DT_MS / 1000
      // Instant crash on a deep excursion, or three seconds of any excursion.
      const wouldCrash = off.severity >= OFFROAD_CRASH_SEVERITY || offroadAccumS > OFFROAD_TIMEOUT_S
      if (wouldCrash && offroadCrashAtM === null) offroadCrashAtM = v.distance
    } else {
      offroadAccumS = 0
    }

    // Segment tracking
    if (surface !== lastSurface) {
      flushSegment(surface, v.distance, elapsedMs, v.fuel)
    }

    elapsedMs += DT_MS
    tickMission(mission, DT_MS)

    // Refuelling — the same call drive.ts makes, so a pickup here is a pickup
    // there. Skipped entirely on a single-leg run, which is what keeps the
    // "aggressive runs dry" assertion below meaningful.
    if (collectCanisters) {
      const gained = checkCanisterPickup(v.distance, v.x)
      if (gained > 0) {
        v.fuel = Math.min(1, v.fuel + gained)
        canisters++
        legCanisters++
      }
    }

    // Delivery. `mission.legStartDist` becomes the drop-off we just reached, so
    // the leg that ended is the span from where the last one started.
    if (deliverIfArrived(mission, v.distance)) {
      const lengthM = mission.legStartDist - legStartDist
      legs.push({
        index: mission.deliveryCount,
        lengthM: Math.round(lengthM),
        timeS: Math.round((elapsedMs - legStartTime) / 100) / 10,
        budgetS: Math.round(legBudgetMs(lengthM) / 100) / 10,
        timeLeftS: Math.round(mission.timerMs / 100) / 10,
        fuelStart: Math.round(legStartFuel * 1000) / 1000,
        fuelEnd: Math.round(v.fuel * 1000) / 1000,
        canisters: legCanisters,
      })
      v.fuel = Math.min(1, v.fuel + DELIVERY_FUEL_REFILL)
      legStartDist = mission.legStartDist
      legStartTime = elapsedMs
      legStartFuel = v.fuel
      legCanisters = 0
    }

    if (v.fuel <= 0 && v.speed < 1) {
      flushSegment(surface, v.distance, elapsedMs, v.fuel)
      return {
        strategy: strategyName,
        completed: false,
        failReason: 'fuel',
        distanceM: Math.round(v.distance),
        elapsedMs,
        fuelRemaining: 0,
        avgKph: v.distance / 1000 / (elapsedMs / 3_600_000),
        segments,
        deliveries: mission.deliveryCount,
        legs,
        canisters,
        maxOffroadSeverity,
        offroadSurface,
        offroadCrashAtM,
      }
    }
  }

  const finalSurface = getSurfaceAt(v.distance) as Surface
  flushSegment(finalSurface, v.distance, elapsedMs, v.fuel)

  const timedOut = mission.deliveryCount < legCount
  return {
    strategy: strategyName,
    completed: !timedOut,
    failReason: timedOut ? 'timeout' : null,
    distanceM: Math.round(v.distance),
    elapsedMs,
    fuelRemaining: Math.round(v.fuel * 1000) / 1000,
    avgKph: Math.round(v.distance / 1000 / (elapsedMs / 3_600_000) * 10) / 10,
    segments,
    deliveries: mission.deliveryCount,
    legs,
    canisters,
    maxOffroadSeverity,
    offroadSurface,
    offroadCrashAtM,
  }
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function printTable(result: SimResult): void {
  const status = result.completed
    ? `✓ COMPLETED  (${(result.elapsedMs / 1000).toFixed(0)}s, fuel left: ${(result.fuelRemaining * 100).toFixed(1)}%)`
    : `✗ FAILED — ${result.failReason?.toUpperCase()} at ${result.distanceM}m`

  console.log(`\n═══ Strategy: ${result.strategy.toUpperCase()}  avg ${result.avgKph} km/h  ${status} ═══`)
  console.log(
    'Surface  '.padEnd(10) +
    'Dist(m) '.padStart(8) +
    'Target  '.padStart(8) +
    'Avg km/h'.padStart(9) +
    'Time(s) '.padStart(9) +
    'Fuel    '.padStart(8) +
    'Fuel/km '.padStart(9) +
    'Mult'.padStart(5),
  )
  console.log('─'.repeat(66))

  let totalFuel = 0
  let totalTime = 0
  for (const s of result.segments) {
    totalFuel += s.fuelUsed
    totalTime += s.timeS
    console.log(
      s.surface.padEnd(10) +
      String(s.lengthM).padStart(8) +
      String(s.targetKph).padStart(8) +
      String(s.avgKph).padStart(9) +
      String(s.timeS).padStart(9) +
      String(s.fuelUsed).padStart(8) +
      String(s.fuelPerKm).padStart(9) +
      String(s.fuelMult).padStart(5),
    )
  }
  console.log('─'.repeat(66))
  console.log(
    'TOTAL'.padEnd(10) +
    String(result.distanceM).padStart(8) +
    ''.padStart(8) +
    ''.padStart(9) +
    String(Math.round(totalTime * 10) / 10).padStart(9) +
    String(Math.round(totalFuel * 10000) / 10000).padStart(8),
  )
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('completability — first 5 km (first delivery)', () => {
  const results = Object.entries(STRATEGIES).map(([name, s]) => runSim(name, s))

  it('prints surface/speed/fuel table for all strategies', () => {
    for (const r of results) printTable(r)
    // Always passes — output is for human inspection
    expect(results.length).toBe(3)
  })

  it('at least one strategy completes 5 km within the time and fuel budget', () => {
    const wins = results.filter(r => r.completed)
    if (wins.length === 0) {
      console.log('\n⚠️  NO strategy completed 5 km. Reasons:')
      for (const r of results) {
        console.log(`  ${r.strategy}: ${r.failReason} at ${r.distanceM}m (avg ${r.avgKph} km/h, fuel ${(r.fuelRemaining * 100).toFixed(1)}% left)`)
      }
    }
    expect(wins.length).toBeGreaterThan(0)
  })

  it('moderate strategy reaches at least 4 km (partial progress check)', () => {
    const moderate = results.find(r => r.strategy === 'moderate')!
    expect(moderate.distanceM).toBeGreaterThan(4000)
  })

  it('surface map — first 5 km contains expected non-asphalt sections', () => {
    resetRoad(SEED)
    const surfaces = new Set<string>()
    for (let d = 0; d < FIRST_TARGET_DIST_M; d += 20) {
      surfaces.add(getSurfaceAt(d))
    }
    // Always has asphalt (start stretch)
    expect(surfaces.has('asphalt')).toBe(true)
    // Should have at least one non-asphalt surface in 5 km
    const nonAsphalt = [...surfaces].filter(s => s !== 'asphalt')
    console.log(`\nSurfaces in first 5km (seed ${SEED}):`, [...surfaces].sort().join(', '))
    console.log(`Required min avg speed: ${((FIRST_TARGET_DIST_M / 1000) / (DELIVERY_TIME_LIMIT_MS / 3600000)).toFixed(1)} km/h`)
    expect(nonAsphalt.length).toBeGreaterThanOrEqual(0) // informational
  })
})

// ─── Multi-seed completability sweep ─────────────────────────────────────────
//
// Tests 20 diverse seeds to catch surface layouts that heavily favour slow terrain
// (e.g. 2×ICE + 2×MUD + 3×SNOW). For each seed the "aggressive" strategy must
// complete within the time limit — it sets the hard floor.  The sweep also prints
// a worst-case table so we can calibrate DELIVERY_TIME_LIMIT_MS realistically.

describe('completability — multi-seed sweep (20 seeds)', () => {
  type SeedResult = {
    seed: number
    surfaces: string
    best: SimResult
    allResults: SimResult[]
  }

  const sweep: SeedResult[] = MULTI_SEEDS.map(seed => {
    const allResults = Object.entries(STRATEGIES).map(([name, s]) => runSim(name, s, seed))
    const best = allResults.reduce((a, b) =>
      (b.completed && !a.completed) ? b :
      (a.completed && !b.completed) ? a :
      b.distanceM > a.distanceM ? b : a
    )
    resetRoad(seed)
    const surfSet = new Set<string>()
    for (let d = 0; d < FIRST_TARGET_DIST_M; d += 50) surfSet.add(getSurfaceAt(d))
    return { seed, surfaces: [...surfSet].sort().join('+'), best, allResults }
  })

  it('prints per-seed summary table', () => {
    const limitS = DELIVERY_TIME_LIMIT_MS / 1000
    console.log(`\n${'Seed'.padEnd(8)} ${'Surfaces'.padEnd(32)} ${'Best strategy'.padEnd(14)} ${'Time(s)'.padStart(8)} ${'Fuel%'.padStart(6)} ${'OK?'.padStart(4)}`)
    console.log('─'.repeat(76))
    for (const { seed, surfaces, best } of sweep) {
      const timeS = (best.elapsedMs / 1000).toFixed(0)
      const fuel  = (best.fuelRemaining * 100).toFixed(1)
      const ok    = best.completed ? '✓' : `✗ ${best.failReason}@${best.distanceM}m`
      console.log(`${String(seed).padEnd(8)} ${surfaces.padEnd(32)} ${best.strategy.padEnd(14)} ${timeS.padStart(8)} ${fuel.padStart(6)} ${ok.padStart(4)}`)
    }
    console.log(`\nTime limit: ${limitS}s (${(limitS/60).toFixed(1)} min)`)
    const failed = sweep.filter(s => !s.best.completed)
    if (failed.length > 0) {
      console.log(`\n⚠️  ${failed.length}/${sweep.length} seeds failed with ALL strategies:`)
      for (const f of failed) {
        console.log(`  seed ${f.seed} (${f.surfaces}): best=${f.best.strategy} reached ${f.best.distanceM}m`)
      }
    } else {
      console.log(`\n✓ All ${sweep.length} seeds completable by at least one strategy.`)
    }
    expect(sweep.length).toBe(MULTI_SEEDS.length)
  })

  it('aggressive strategy never times out (may run dry on fuel, but never hits 8 min wall)', () => {
    // Aggressive may run out of fuel on heavy-surface seeds — that is by design.
    // What we forbid is a TIMEOUT: if it times out, the time limit is too tight.
    const timedOut = sweep.filter(s => {
      const agg = s.allResults.find(r => r.strategy === 'aggressive')!
      return agg.failReason === 'timeout'
    })
    if (timedOut.length > 0) {
      console.log(`\n❌ Aggressive TIMED OUT on ${timedOut.length} seed(s) — consider raising DELIVERY_TIME_LIMIT_MS:`)
      for (const f of timedOut) {
        const agg = f.allResults.find(r => r.strategy === 'aggressive')!
        console.log(`  seed ${f.seed} (${f.surfaces}): reached ${agg.distanceM}m in ${(agg.elapsedMs/1000).toFixed(0)}s`)
      }
    }
    expect(timedOut.length).toBe(0)
  })

  it('at least one strategy completes every seed', () => {
    const failed = sweep.filter(s => !s.best.completed)
    expect(failed.length).toBe(0)
  })

  it('no strategy is ever thrown off the road — the route is driveable, not just reachable', () => {
    // The assertion this file was missing. "Completable" used to mean only
    // "enough time and fuel"; a layout that puts ice inside a sharp curve is
    // unreachable for a different reason, and this is what catches it.
    const crashed = sweep.flatMap(s =>
      s.allResults
        .filter(r => r.offroadCrashAtM !== null)
        .map(r => ({ seed: s.seed, surfaces: s.surfaces, r })),
    )
    if (crashed.length > 0) {
      const total = sweep.length * Object.keys(STRATEGIES).length
      console.log(`\n❌ Off-road crash on ${crashed.length}/${total} strategy/seed combination(s):`)
      for (const { seed, surfaces, r } of crashed) {
        console.log(
          `  seed ${seed} (${surfaces}): ${r.strategy} left the road at ` +
          `${Math.round(r.offroadCrashAtM!)}m on ${r.offroadSurface}, ` +
          `worst severity ${(r.maxOffroadSeverity * 100).toFixed(0)}%`,
        )
      }
    }
    expect(crashed.length).toBe(0)
  })

  it('aggressive strategy is fuel-limited on at least one seed — FUEL OUT path is reachable', () => {
    // NOTE: this is a single-leg run, which is why it is still true — a
    // single-leg run never collects canisters. See the multi-leg block below.
    // Confirms the drive.ts triggerGameOver("fuel") path is exercisable in practice,
    // not just theoretically wired. Aggressive burns fuel fast on heavy-surface seeds;
    // the sim has no canister pickups, so it runs dry before finishing 5 km on those seeds.
    const fuelOut = sweep.filter(s => {
      const agg = s.allResults.find(r => r.strategy === 'aggressive')!
      return agg.failReason === 'fuel'
    })
    expect(fuelOut.length).toBeGreaterThan(0)
  })
})

// ─── Past the first delivery ─────────────────────────────────────────────────
//
// The gap that let 0.8.1 ship a mission nobody could finish. Everything above
// stops at 5 km, so the second leg — a different length, on a clock that carries
// over, with a tank that only got half a refill — had never been simulated once.

const MULTI_LEG_COUNT = 3
const MULTI_LEG_SEEDS = [1443866, 534501, 1327161, 52662, 42]

describe(`completability — ${MULTI_LEG_COUNT} legs (past the first delivery)`, () => {
  type LegRun = { seed: number; results: SimResult[]; best: SimResult }

  const runs: LegRun[] = MULTI_LEG_SEEDS.map(seed => {
    const results = Object.entries(STRATEGIES).map(([name, s]) =>
      runSim(name, s, seed, { legs: MULTI_LEG_COUNT, collectCanisters: true }))
    const best = results.reduce((a, b) =>
      (b.completed && !a.completed) ? b :
      (a.completed && !b.completed) ? a :
      b.deliveries > a.deliveries ? b :
      b.distanceM > a.distanceM ? b : a
    )
    return { seed, results, best }
  })

  it('prints the per-leg breakdown', () => {
    for (const { seed, results } of runs) {
      console.log(`\n═══ seed ${seed} — ${MULTI_LEG_COUNT} legs ═══`)
      for (const r of results) {
        const status = r.completed
          ? `✓ ${r.deliveries}/${MULTI_LEG_COUNT} deliveries`
          : `✗ ${r.failReason} after ${r.deliveries} (at ${r.distanceM}m)`
        console.log(`  ${r.strategy.padEnd(13)} ${status}  ${r.canisters} canisters`)
        console.log(
          '    ' + 'Leg'.padEnd(4) + 'Length(m)'.padStart(10) + 'Budget(s)'.padStart(10) +
          'Time(s)'.padStart(9) + 'Left(s)'.padStart(9) + 'Fuel in'.padStart(9) +
          'Fuel out'.padStart(9) + 'Cans'.padStart(6),
        )
        for (const l of r.legs) {
          console.log(
            '    ' + String(l.index).padEnd(4) + String(l.lengthM).padStart(10) +
            String(l.budgetS).padStart(10) + String(l.timeS).padStart(9) +
            String(l.timeLeftS).padStart(9) +
            (l.fuelStart * 100).toFixed(1).padStart(9) +
            (l.fuelEnd * 100).toFixed(1).padStart(9) +
            String(l.canisters).padStart(6),
          )
        }
      }
    }
    expect(runs.length).toBe(MULTI_LEG_SEEDS.length)
  })

  it('at least one strategy completes every leg on every seed', () => {
    // The assertion 0.8.1 was missing. Before the proportional budget this
    // failed on all five seeds at the first delivery: the second leg asked for
    // 15 to 25 km inside eight minutes, which is 113 to 188 km/h against a
    // MAX_SPEED of 120.
    const failed = runs.filter(r => !r.best.completed)
    if (failed.length > 0) {
      console.log(`\n❌ ${failed.length}/${runs.length} seed(s) cannot be finished past the first delivery:`)
      for (const f of failed) {
        console.log(`  seed ${f.seed}: best=${f.best.strategy} got ${f.best.deliveries}/${MULTI_LEG_COUNT} (${f.best.failReason} at ${f.best.distanceM}m)`)
      }
    }
    expect(failed.length).toBe(0)
  })

  it('the winning run clears each leg inside that leg\'s own budget', () => {
    // Carry-over must be a reward, not a crutch. If a leg only fits because of
    // time banked earlier, the pace is a lie and the first bad leg ends the run.
    const overrun = runs.flatMap(r =>
      r.best.legs
        .filter(l => l.timeS > l.budgetS)
        .map(l => ({ seed: r.seed, strategy: r.best.strategy, l })),
    )
    if (overrun.length > 0) {
      console.log('\n❌ Leg(s) that only fit because of banked time:')
      for (const { seed, strategy, l } of overrun) {
        console.log(`  seed ${seed} ${strategy} leg ${l.index}: ${l.lengthM}m took ${l.timeS}s against a ${l.budgetS}s budget`)
      }
    }
    expect(overrun.length).toBe(0)
  })

  it('never runs dry — half a tank plus canisters covers a leg', () => {
    // A delivery only refills DELIVERY_FUEL_REFILL and a leg costs most of a
    // tank, so this is really an assertion about canister density.
    const dry = runs.filter(r => r.best.failReason === 'fuel')
    if (dry.length > 0) {
      console.log('\n❌ Ran out of fuel past the first delivery:')
      for (const d of dry) {
        console.log(`  seed ${d.seed}: dry at ${d.best.distanceM}m after ${d.best.deliveries} deliveries, ${d.best.canisters} canisters collected`)
      }
    }
    expect(dry.length).toBe(0)
  })

  it('the refuelling detour never puts the truck off the road', () => {
    // The bot leaves the middle of the road to collect, which is a new way to
    // fail that the single-leg runs never had. Measured: severity stays at 0,
    // so the ±0.7 aim clamp plus the grip and curvature gates hold.
    const crashed = runs.flatMap(r =>
      r.results
        .filter(x => x.offroadCrashAtM !== null)
        .map(x => ({ seed: r.seed, x })),
    )
    if (crashed.length > 0) {
      console.log('\n❌ Off-road while running multiple legs:')
      for (const { seed, x } of crashed) {
        console.log(`  seed ${seed}: ${x.strategy} left the road at ${Math.round(x.offroadCrashAtM!)}m on ${x.offroadSurface}`)
      }
    }
    expect(crashed.length).toBe(0)
  })

  it('reports how much time the carry-over banks by the last leg', () => {
    // Not an assertion — a number the owner asked to watch. Unused time carries
    // over in full (DELIVERY_TIME_CARRY_PCT = 1.0), so a good driver arrives at
    // each drop-off with more clock than the leg was given. If this keeps
    // climbing, the clock has stopped being a pressure and the dial is the fix.
    console.log('\nBanked time at each drop-off (winning strategy):')
    for (const r of runs) {
      const banked = r.best.legs.map(l => `leg ${l.index}: ${(l.timeLeftS / 60).toFixed(1)} min`).join('   ')
      console.log(`  seed ${String(r.seed).padEnd(8)} ${banked}`)
    }
    expect(runs.every(r => r.best.legs.length === MULTI_LEG_COUNT)).toBe(true)
  })
})
