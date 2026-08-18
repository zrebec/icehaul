/**
 * The clock that knows the road — held to properties, not to numbers.
 *
 * Two things here are worth reading before changing anything. The first is the
 * terminal-speed measurement: `PLAN_SURFACE_VMAX` is a claim about what the
 * truck can hold on each surface, and a claim about physics that nobody checks
 * is a guess. It is checked here against the real `tickVehicle`.
 *
 * The second is what is deliberately *absent*: nothing in this file imports from
 * `completability.test.ts` and nothing there imports from here. The bot is a
 * crude human heuristic and the planner is physics; calibrating one against the
 * other is only meaningful while they stay strangers.
 */

import { describe, it, expect } from 'vitest'
import { planLeg, safeSpeedKph, speedProfile, type RoadSampler } from '../routeplan.ts'
import { createVehicle, tickVehicle } from '../vehicle.ts'
import { gripFor, accelFor, resetRoad, getSurfaceAt, getGripAt, getCurvatureAt, type Surface } from '../road.ts'
import {
  MAX_SPEED, PLAN_SURFACE_VMAX, PLAN_PACE_MAX_KMH, PLAN_PACE_MIN_KMH,
  GEARS, GEAR_COUNT, SURFACE_GRIP, CLUTCH_MATCH_TOLERANCE,
} from '../../config.ts'

const SURFACES: readonly Surface[] = ['asphalt', 'snow', 'ice', 'sand', 'mud']

/** A road with no surprises — every sample identical. */
function flatRoad(surface: Surface, curvature = 0): RoadSampler {
  return {
    surfaceAt: () => surface,
    gripAt: () => SURFACE_GRIP[surface],
    curvatureAt: () => curvature,
  }
}

/** Asphalt with one stretch of ice in the middle of it. */
function roadWithIce(iceFrom: number, iceTo: number): RoadSampler {
  const on = (d: number) => d >= iceFrom && d < iceTo
  return {
    surfaceAt: (d) => (on(d) ? 'ice' : 'asphalt'),
    gripAt: (d) => (on(d) ? SURFACE_GRIP.ice : SURFACE_GRIP.asphalt),
    curvatureAt: () => 0,
  }
}

// ─── The claim about drag ────────────────────────────────────────────────────

describe('PLAN_SURFACE_VMAX is measured, not assumed', () => {
  /**
   * Flat out, in a straight line, through the gears, until the speed stops
   * climbing. This is the one number the cornering law cannot produce: on sand
   * and mud the limit is drag, and a leg budgeted at a speed the truck cannot
   * reach would be a delivery nobody could make.
   */
  function terminalSpeedKph(surface: Surface): number {
    const v = createVehicle()
    const grip = gripFor(surface)
    const accel = accelFor(surface)
    // The same clutch protocol a human uses — press, select, match, release. The
    // *protocol* is shared with the completability bot because it is how the
    // gearbox works; not one speed number is.
    let phase: 'in' | 'out' = 'out'
    let best = 0
    let last = 0

    for (let i = 0; i < 120_000; i++) {
      // Refilled every tick: this measures what drag allows, not how far a tank
      // goes. At 120 km/h a full tank is about 2.5 km, so without this the sweep
      // would be measuring the fuel system.
      v.fuel = 1

      const spec = GEARS[v.gear - 1]!
      const wantUp = v.gear < GEAR_COUNT && v.speed > spec.to * 0.92
      let clutch = false
      let shiftUp = false
      let blip = false

      if (phase === 'out') {
        if (wantUp) { phase = 'in'; clutch = true; shiftUp = true }
      } else {
        clutch = true
        const nextSpec = GEARS[v.gear - 1]!
        const wantRpm = nextSpec.to > 0 ? v.speed / nextSpec.to : 0
        const err = v.engineRpm - wantRpm
        if (Math.abs(err) <= CLUTCH_MATCH_TOLERANCE * 0.6) { clutch = false; phase = 'out' }
        else blip = err < 0
      }

      tickVehicle(
        v,
        { throttle: clutch ? blip : true, brake: false, steerLeft: false, steerRight: false, clutch, shiftUp },
        surface, grip, accel, 16,
      )
      if (v.speed > best) best = v.speed

      // Stop once ten seconds of full throttle stops buying anything.
      if (i > 1800 && i % 625 === 0) {
        if (v.speed - last < 0.05) break
        last = v.speed
      }
    }
    return best
  }

  const measured = Object.fromEntries(
    SURFACES.map(s => [s, terminalSpeedKph(s)]),
  ) as Record<Surface, number>

  it('prints what the truck actually holds', () => {
    const rows = SURFACES.map(s =>
      `${s.padEnd(8)} measured ${measured[s].toFixed(1).padStart(6)} km/h   plan ${String(PLAN_SURFACE_VMAX[s]).padStart(4)}`)
    console.log(`\n═══ Terminal speed, flat out on a straight ═══\n${rows.join('\n')}`)
    expect(Object.keys(measured).length).toBe(SURFACES.length)
  })

  it.each(SURFACES)('%s: the plan never asks for more than the truck can hold', (surface) => {
    // A 2 km/h tolerance: the sweep stops when the gain per ten seconds falls
    // below a threshold, so it lands just under the true asymptote.
    expect(PLAN_SURFACE_VMAX[surface]).toBeLessThanOrEqual(measured[surface] + 2)
  })
})

// ─── The safe-speed law ──────────────────────────────────────────────────────

describe('safeSpeedKph', () => {
  it('reproduces the measured controllability envelope at the sharpest curve', () => {
    // From controllability.test.ts, COASTING at c=2.0 — the *lateral* envelope,
    // which is about holding the road and says nothing about reaching the speed.
    // So the drag cap is taken out of the way here (every surface is planned as
    // asphalt) and only the cornering half of the law is under test. 15% is the
    // allowance: this is a budget, not a steering input.
    const measuredAtC2: Record<Surface, number> = {
      asphalt: 85, snow: 55, ice: 40, sand: 50, mud: 60,
    }
    for (const s of SURFACES) {
      const cornering = safeSpeedKph(2.0, SURFACE_GRIP[s], 'asphalt')
      const err = Math.abs(cornering - measuredAtC2[s]) / measuredAtC2[s]
      expect(err, `${s}: predicted ${cornering.toFixed(1)} vs measured ${measuredAtC2[s]}`)
        .toBeLessThan(0.15)
    }
  })

  it('lets drag win where drag is the real limit', () => {
    // The finding that made the terminal-speed measurement worth writing: on
    // snow, sand and mud the truck runs out of engine long before it runs out of
    // grip, so on an open bend the plan is capped by what it can reach and not
    // by what it could hold.
    for (const s of ['snow', 'sand', 'mud'] as const) {
      expect(safeSpeedKph(0.4, SURFACE_GRIP[s], s), s).toBe(PLAN_SURFACE_VMAX[s])
    }
    // …and on asphalt and ice it is the bend that binds, not the engine.
    expect(safeSpeedKph(2.0, SURFACE_GRIP.asphalt, 'asphalt')).toBeLessThan(PLAN_SURFACE_VMAX.asphalt)
  })

  it('never exceeds the truck, the surface, or the bend', () => {
    for (const s of SURFACES) {
      for (const c of [0, 0.4, 1, 1.5, 2]) {
        const v = safeSpeedKph(c, SURFACE_GRIP[s], s)
        expect(v).toBeLessThanOrEqual(MAX_SPEED)
        expect(v).toBeLessThanOrEqual(PLAN_SURFACE_VMAX[s])
        expect(v).toBeGreaterThan(0)
      }
    }
  })

  it('is monotonic in both arguments — more grip is faster, more bend is slower', () => {
    let previous = Infinity
    for (const c of [0.4, 1, 1.5, 2, 3]) {
      const v = safeSpeedKph(c, 1, 'asphalt')
      expect(v).toBeLessThanOrEqual(previous)
      previous = v
    }
    expect(safeSpeedKph(2, 1.0, 'asphalt')).toBeGreaterThan(safeSpeedKph(2, 0.25, 'asphalt'))
  })

  it('treats a left bend exactly like its mirrored right', () => {
    expect(safeSpeedKph(-1.7, 0.45, 'snow')).toBe(safeSpeedKph(1.7, 0.45, 'snow'))
  })
})

// ─── The profile ─────────────────────────────────────────────────────────────

describe('speedProfile', () => {
  it('on an unchanging road it is just the limit', () => {
    const v = speedProfile(0, 1000, flatRoad('asphalt'))
    const limit = safeSpeedKph(0, SURFACE_GRIP.asphalt, 'asphalt') / 3.6
    // The first sample is free (the leg is entered at speed); everything after
    // it is bounded by acceleration, so only the tail is at the limit.
    expect(v.at(-1)!).toBeCloseTo(limit, 3)
  })

  it('starts slowing down BEFORE the ice, not on it', () => {
    // The whole thesis of the game, expressed as a property of the plan: a limit
    // ahead has to reach back up the road as the braking distance it needs.
    const v = speedProfile(0, 1000, roadWithIce(500, 700))
    const asphaltLimit = safeSpeedKph(0, SURFACE_GRIP.asphalt, 'asphalt') / 3.6
    const iceLimit = safeSpeedKph(0, SURFACE_GRIP.ice, 'ice') / 3.6

    const step = 1000 / (v.length - 1)
    const atIceEntry = v[Math.round(500 / step)]!
    expect(atIceEntry, 'must already be at ice speed when the ice starts')
      .toBeLessThan(iceLimit * 1.05)

    // Where the lift begins, expressed as a property rather than a sample: the
    // profile must leave the asphalt limit somewhere before the ice, and not
    // absurdly early. Braking 120 -> 40 km/h at 18 km/h/s takes about 99 m, so
    // the answer is arithmetic, not taste.
    const liftIndex = v.findIndex(s => s < asphaltLimit - 0.01)
    const liftAtM = liftIndex * step
    expect(liftAtM, 'the lift must start before the ice').toBeLessThan(500)
    expect(liftAtM, 'and not half a kilometre early').toBeGreaterThan(350)
  })

  it('does not leap back to full speed the metre the ice ends', () => {
    const v = speedProfile(0, 1000, roadWithIce(300, 500))
    const step = 1000 / (v.length - 1)
    const atExit = v[Math.round(500 / step)]!
    const shortlyAfter = v[Math.round(560 / step)]!
    const asphaltLimit = safeSpeedKph(0, SURFACE_GRIP.asphalt, 'asphalt') / 3.6

    expect(shortlyAfter).toBeGreaterThan(atExit)
    expect(shortlyAfter, 'acceleration is not instant').toBeLessThan(asphaltLimit)
  })

  it('never exceeds the limit anywhere', () => {
    const road = roadWithIce(400, 600)
    const v = speedProfile(0, 1200, road)
    const step = 1200 / (v.length - 1)
    for (let i = 0; i < v.length; i++) {
      const d = i * step
      const limit = safeSpeedKph(road.curvatureAt(d), road.gripAt(d), road.surfaceAt(d)) / 3.6
      expect(v[i]!, `sample at ${d} m`).toBeLessThanOrEqual(limit + 1e-9)
    }
  })
})

// ─── The budget ──────────────────────────────────────────────────────────────

describe('planLeg', () => {
  it('gives a hard route more time than an easy one of the same length', () => {
    // The point of the whole feature, as one assertion.
    const easy = planLeg(0, 5000, flatRoad('asphalt'))
    const hard = planLeg(0, 5000, flatRoad('ice', 1.5))
    expect(hard.budgetS).toBeGreaterThan(easy.budgetS)
    expect(hard.paceKph).toBeLessThan(easy.paceKph)
  })

  it('is deterministic — the same road plans to the same second', () => {
    const a = planLeg(0, 6000, roadWithIce(1000, 1800))
    const b = planLeg(0, 6000, roadWithIce(1000, 1800))
    expect(a.budgetS).toBe(b.budgetS)
  })

  it('grants more than the ideal, always', () => {
    for (const s of SURFACES) {
      const p = planLeg(0, 4000, flatRoad(s, 1.0))
      expect(p.budgetS, s).toBeGreaterThan(p.idealTimeS)
    }
  })

  it('never demands a pace outside the guard rails', () => {
    // The clamp that 0.8.1 did not have. Even a road the planner has never seen
    // cannot produce a leg that asks for 188 km/h.
    const roads: RoadSampler[] = [
      flatRoad('asphalt'),
      flatRoad('ice', 2),
      flatRoad('sand', 2),
      { surfaceAt: () => 'asphalt', gripAt: () => 0, curvatureAt: () => 9 },
    ]
    for (const road of roads) {
      for (const len of [1000, 5000, 8000]) {
        const p = planLeg(0, len, road)
        expect(p.paceKph).toBeLessThanOrEqual(PLAN_PACE_MAX_KMH + 0.01)
        expect(p.paceKph).toBeGreaterThanOrEqual(PLAN_PACE_MIN_KMH - 0.01)
      }
    }
  })

  it('gives the first leg its beginner allowance', () => {
    const first = planLeg(0, 5000, flatRoad('asphalt'), { firstLeg: true })
    const later = planLeg(0, 5000, flatRoad('asphalt'))
    expect(first.budgetS).toBeGreaterThan(later.budgetS)
  })

  it('scales with length rather than jumping at a leg boundary', () => {
    // What the flat 8-minute reset got wrong in 0.8.1: twice the road must ask
    // for roughly twice the time, not the same time.
    const short = planLeg(0, 3000, flatRoad('snow'))
    const long = planLeg(0, 6000, flatRoad('snow'))
    const ratio = long.budgetS / short.budgetS
    expect(ratio).toBeGreaterThan(1.7)
    expect(ratio).toBeLessThan(2.3)
  })
})

// ─── What the plan actually asks of the seed catalogue ───────────────────────

describe('the plan, on real roads', () => {
  // Printed for the same reason `controllability.test.ts` prints its envelope:
  // every tuning decision after this one is a judgement about these numbers, and
  // a judgement without the table in front of it is a guess.
  const SEEDS = [42, 1_443_866, 534_501, 7, 99_999]

  it('prints the first leg of each catalogue seed', () => {
    const rows: string[] = []
    for (const seed of SEEDS) {
      resetRoad(seed)
      const road: RoadSampler = {
        surfaceAt: (d) => getSurfaceAt(d),
        gripAt: (d) => getGripAt(d),
        curvatureAt: (d) => getCurvatureAt(d),
      }
      const p = planLeg(0, 5000, road, { firstLeg: true })
      const surfaces = new Set<string>()
      for (let d = 0; d < 5000; d += 50) surfaces.add(getSurfaceAt(d))
      rows.push(
        `${String(seed).padStart(9)}  ideal ${p.idealTimeS.toFixed(0).padStart(4)}s` +
        `  budget ${p.budgetS.toFixed(0).padStart(4)}s  pace ${p.paceKph.toFixed(1).padStart(5)} km/h` +
        `  ${p.clamped ? 'CLAMPED' : '       '}  ${[...surfaces].sort().join('+')}`,
      )
    }
    console.log(`\n═══ First leg, 5 km, per seed ═══\n${rows.join('\n')}`)
    expect(rows.length).toBe(SEEDS.length)
  })
})
