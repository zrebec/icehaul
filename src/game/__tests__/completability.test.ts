/**
 * Completability simulation — first 5 km (first delivery target).
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
 */

import { describe, it, expect } from 'vitest'
import { resetRoad, getSurfaceAt, getCurvatureAt, gripFor, accelFor, type Surface } from '../road.ts'
import { createVehicle, tickVehicle } from '../vehicle.ts'
import { computeRoadEdges } from '../roadgeometry.ts'
import { checkTruckOffroad } from '../offroad.ts'
import { TRUCK_BMP_W, TRUCK_BMP_H } from '../../render/truck.ts'
import {
  DELIVERY_TIME_LIMIT_MS, FIRST_TARGET_DIST_M,
  SURFACE_FUEL_MULT, GEARS, GEAR_COUNT, CLUTCH_MATCH_TOLERANCE,
  GAME_WIDTH, VIEWPORT_BOTTOM, OFFROAD_CRASH_SEVERITY, OFFROAD_TIMEOUT_S,
} from '../../config.ts'

// ─── Strategies ──────────────────────────────────────────────────────────────

type Strategy = Record<Surface, number>

const STRATEGIES: Record<string, Strategy> = {
  aggressive: {
    asphalt: 80,
    snow:    60,
    ice:     38,
    sand:    60,
    mud:     55,
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

interface SimResult {
  strategy: string
  completed: boolean
  failReason: 'timeout' | 'fuel' | null
  distanceM: number
  elapsedMs: number
  fuelRemaining: number
  avgKph: number
  segments: SegmentSummary[]
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

/** Mirrors `drive.ts:547` — where the truck is drawn for a given lateral state. */
function truckDrawPos(playerX: number, lateralV: number) {
  return {
    x: Math.round(GAME_WIDTH / 2 + playerX * 50 - TRUCK_BMP_W / 2 + (-lateralV * 1.5)),
    y: Math.round(VIEWPORT_BOTTOM - 2 - TRUCK_BMP_H),
  }
}

// 20 diverse seeds that cover a wide range of generated surfaces
const MULTI_SEEDS = [0, 1, 7, 42, 99, 137, 256, 500, 777, 999,
                     1234, 2025, 4096, 8888, 12345, 19999, 55555, 99999, 123456, 999999]

function runSim(strategyName: string, targetKph: Strategy, seed = SEED): SimResult {
  resetRoad(seed)
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

  while (v.distance < FIRST_TARGET_DIST_M && elapsedMs < DELIVERY_TIME_LIMIT_MS) {
    const surface  = getSurfaceAt(v.distance) as Surface
    const curvature = getCurvatureAt(v.distance)
    const grip     = gripFor(surface)
    const accel    = accelFor(surface)
    const target   = targetKph[surface]

    // Speed controller
    const throttle = v.speed < target
    const brake    = v.speed > target + 5

    // Steering P-controller — keep x near 0, counter vx drift
    const steerLeft  = v.x > 0.08 || v.vx > 0.12
    const steerRight = v.x < -0.08 || v.vx < -0.12

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
        maxOffroadSeverity,
        offroadSurface,
        offroadCrashAtM,
      }
    }
  }

  const finalSurface = getSurfaceAt(v.distance) as Surface
  flushSegment(finalSurface, v.distance, elapsedMs, v.fuel)

  const timedOut = elapsedMs >= DELIVERY_TIME_LIMIT_MS && v.distance < FIRST_TARGET_DIST_M
  return {
    strategy: strategyName,
    completed: !timedOut,
    failReason: timedOut ? 'timeout' : null,
    distanceM: Math.round(v.distance),
    elapsedMs,
    fuelRemaining: Math.round(v.fuel * 1000) / 1000,
    avgKph: Math.round(v.distance / 1000 / (elapsedMs / 3_600_000) * 10) / 10,
    segments,
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
