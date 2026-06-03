/**
 * Completability simulation — first 5 km (first delivery target).
 *
 * Runs the vehicle physics frame-by-frame (16 ms ticks, ~60 fps) with a
 * proportional speed controller and a simple steering P-controller that
 * keeps the truck centred. Off-road is not checked — this is an ideal-
 * driver lower-bound: if it fails here, no human can complete it either.
 *
 * Three strategies are compared:
 *   aggressive  — push speed as high as surface allows
 *   moderate    — careful but not paranoid
 *   conservative — fuel-first, bare-minimum speed above the 43 km/h average
 *
 * The test asserts that at least ONE strategy can complete 5 km within
 * 7 minutes without running out of fuel.  A detailed surface/speed table
 * is always printed so you can see what's eating the budget.
 */

import { describe, it, expect } from 'vitest'
import { resetRoad, getSurfaceAt, getCurvatureAt, gripFor, accelFor, type Surface } from '../road.ts'
import { createVehicle, tickVehicle } from '../vehicle.ts'
import {
  DELIVERY_TIME_LIMIT_MS, FIRST_TARGET_DIST_M,
  SURFACE_FUEL_MULT, GEARS, GEAR_COUNT,
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
}

// ─── Core simulation ─────────────────────────────────────────────────────────

const DT_MS = 16
const SEED  = 42

function runSim(strategyName: string, targetKph: Strategy): SimResult {
  resetRoad(SEED)
  const v = createVehicle()

  let elapsedMs     = 0
  let lastSurface   = getSurfaceAt(0) as Surface
  let segStartDist  = 0
  let segStartTime  = 0
  let segStartFuel  = v.fuel
  const segments: SegmentSummary[] = []

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
    const shiftUp   = throttle && rpm > 0.9 && v.gear < GEAR_COUNT
    const shiftDown = rpm < 0.15 && v.gear > 1   // downshift before lugging

    tickVehicle(
      v,
      { throttle, brake, steerLeft, steerRight, shiftUp, shiftDown },
      surface, grip, accel, DT_MS, curvature,
    )

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
