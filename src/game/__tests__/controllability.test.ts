/**
 * Controllability envelope — can the truck actually hold the road in a curve?
 *
 * `completability.test.ts` answers "is 5 km reachable in time and on fuel" but it
 * says so explicitly: *off-road is not checked*. So a surface/curvature pair that
 * no human could survive passes it silently. This file is the missing half.
 *
 * ── What it measures ────────────────────────────────────────────────────────
 * For one surface, one constant curvature and one road speed, it runs the real
 * `tickVehicle` with the same steering P-controller the completability sim uses,
 * then asks the *game's own* geometry whether the truck left the road:
 * `computeRoadEdges` → `checkTruckOffroad`, at the same screen position
 * `drive.ts` draws the truck. No parallel model, no re-derived threshold.
 *
 * Road speed is pinned every tick. That is deliberate: this isolates the LATERAL
 * envelope. Whether the gearbox can reach or hold that speed is completability's
 * job, not this file's.
 *
 * ── The number it produces ──────────────────────────────────────────────────
 * `envelope(surface, curvature)` = the highest speed at which the truck holds the
 * road *and holds it at every slower speed too*. That "and below" clause matters:
 * it is what makes "slow down" a valid answer. An envelope with holes in it is a
 * game where braking sometimes makes things worse.
 */

import { describe, it, expect } from 'vitest'
import { createVehicle, tickVehicle } from '../vehicle.ts'
import { gripFor, accelFor, type Surface } from '../road.ts'
import { computeRoadEdges } from '../roadgeometry.ts'
import { checkTruckOffroad } from '../offroad.ts'
import { TRUCK_BMP_W, TRUCK_BMP_H } from '../../render/truck.ts'
import { GAME_WIDTH, VIEWPORT_BOTTOM, GEARS, GEAR_COUNT } from '../../config.ts'
import { SURFACE_GRIP } from '../../config.ts'

const DT_MS = 16
/** Long enough for the lateral state to settle; drift saturates far sooner. */
const RUN_SECONDS = 10
/** Speed sweep granularity for `envelope`, in km/h. */
const SPEED_STEP = 5
const MAX_SWEEP_KPH = 120

const SURFACES: readonly Surface[] = ['asphalt', 'snow', 'ice', 'sand', 'mud']
/** 0.4 and 2.0 are the ends of CURVE_INTENSITY_RANGE; the middle two are the common case. */
const CURVATURES = [0.4, 1.0, 1.5, 2.0] as const

/** Mirrors `drive.ts:547` + `offroad.test.ts:11-18` — where the truck is drawn. */
function truckDrawPos(playerX: number, lateralV: number) {
  const cx = GAME_WIDTH / 2 + playerX * 50
  const lean = -lateralV * 1.5
  return {
    x: Math.round(cx - TRUCK_BMP_W / 2 + lean),
    y: Math.round(VIEWPORT_BOTTOM - 2 - TRUCK_BMP_H),
  }
}

/** Lowest gear whose band covers this speed — keeps rpm plausible, no lugging. */
function gearForSpeed(kph: number): number {
  for (let i = 0; i < GEAR_COUNT; i++) {
    if (kph <= GEARS[i]!.to) return i + 1
  }
  return GEAR_COUNT
}

interface HoldResult {
  /** Peak |v.x| reached during the run. */
  maxAbsX: number
  /** Peak off-road severity (fraction of truck pixels outside the kerb). */
  maxSeverity: number
  /** True if any truck pixel ever left the road. */
  offRoad: boolean
}

/**
 * Drive a constant-radius curve at a fixed speed and report whether the truck
 * ever left the road.
 */
function holdsLine(
  surface: Surface,
  curvature: number,
  speedKph: number,
  opts: { brake?: boolean; mirror?: boolean } = {},
): HoldResult {
  const signedCurvature = opts.mirror ? -curvature : curvature
  const v = createVehicle()
  v.speed = speedKph
  v.gear = gearForSpeed(speedKph)

  const grip = gripFor(surface)
  const accel = accelFor(surface)
  const curveFn = () => signedCurvature

  let maxAbsX = 0
  let maxSeverity = 0

  const ticks = Math.round((RUN_SECONDS * 1000) / DT_MS)
  for (let i = 0; i < ticks; i++) {
    // Same P-controller as completability.test.ts:138-140 — a competent human,
    // not an oracle: it reacts to position and drift, it does not predict.
    const steerLeft = v.x > 0.08 || v.vx > 0.12
    const steerRight = v.x < -0.08 || v.vx < -0.12

    tickVehicle(
      v,
      { throttle: false, brake: opts.brake ?? false, steerLeft, steerRight },
      surface, grip, accel, DT_MS, signedCurvature,
    )

    // Pin road speed — this test is about the lateral axis only.
    v.speed = speedKph

    const pos = truckDrawPos(v.x, v.vx)
    const edges = computeRoadEdges(v.distance, v.x, curveFn)
    const off = checkTruckOffroad(pos.x, pos.y, edges)

    if (Math.abs(v.x) > maxAbsX) maxAbsX = Math.abs(v.x)
    if (off.severity > maxSeverity) maxSeverity = off.severity
  }

  return { maxAbsX, maxSeverity, offRoad: maxSeverity > 0 }
}

/**
 * Highest speed that holds the road *with every slower speed also holding*.
 * Returns 0 if even the slowest sweep step already leaves the road.
 */
function envelope(surface: Surface, curvature: number, opts: { brake?: boolean; mirror?: boolean } = {}): number {
  let best = 0
  for (let kph = SPEED_STEP; kph <= MAX_SWEEP_KPH; kph += SPEED_STEP) {
    if (holdsLine(surface, curvature, kph, opts).offRoad) break
    best = kph
  }
  return best
}

type EnvelopeTable = Record<Surface, number[]>

function buildTable(opts: { brake?: boolean; mirror?: boolean } = {}): EnvelopeTable {
  const table = {} as EnvelopeTable
  for (const surface of SURFACES) {
    table[surface] = CURVATURES.map(c => envelope(surface, c, opts))
  }
  return table
}

function printTable(table: EnvelopeTable, label: string): void {
  console.log(`\n═══ Controllability envelope (${label}) — max km/h that holds the road ═══`)
  console.log('Surface'.padEnd(10) + CURVATURES.map(c => `c=${c}`.padStart(8)).join(''))
  console.log('─'.repeat(10 + CURVATURES.length * 8))
  for (const surface of SURFACES) {
    console.log(surface.padEnd(10) + table[surface].map(n => String(n).padStart(8)).join(''))
  }
}

// Both tables are built once — the sweep is the expensive part of this file.
const COASTING = buildTable()
const BRAKING = buildTable({ brake: true })
/** Same sweep with the curve mirrored, for the symmetry check below. */
const COASTING_LEFT = buildTable({ mirror: true })

// ─── Baseline: the measurement itself must be sound ──────────────────────────

describe('controllability — measurement sanity', () => {
  it('a centred truck on a straight road never reads off-road', () => {
    const r = holdsLine('asphalt', 0, 60)
    expect(r.offRoad).toBe(false)
    expect(r.maxAbsX).toBeLessThan(0.1)
  })

  it('crawling through the sharpest curve is survivable on every surface', () => {
    // If this fails, holding x≈0 is itself off-road in a curve and the whole
    // premise below is wrong — fix the model before reading any other number.
    for (const surface of SURFACES) {
      expect(holdsLine(surface, 2.0, 10).offRoad, `${surface} @ 10 km/h`).toBe(false)
    }
  })

  it('enough speed always breaks the road hold — the envelope is not unbounded', () => {
    expect(holdsLine('ice', 2.0, 120).offRoad).toBe(true)
  })
})

// ─── The envelope ────────────────────────────────────────────────────────────

describe('controllability envelope', () => {
  it('prints the envelope table', () => {
    printTable(COASTING, 'COASTING')
    expect(Object.keys(COASTING).length).toBe(SURFACES.length)
  })

  it('ice holds the sharpest curve up to at least 40 km/h', () => {
    // THE invariant this whole change exists for. The promise is "slow down
    // before the ice and you live", and 40 km/h is where that becomes true.
    //
    // 40 rather than 45 is a physics claim, not a difficulty preference: safe
    // curve speed scales as sqrt(mu), asphalt holds this curve at 85, so 40
    // asserts mu_ice ~ 0.155 — bare ice. 45 would be asserting studs the truck
    // does not have, and playtested as noticeably less tense.
    expect(COASTING.ice[3]).toBeGreaterThanOrEqual(40)
  })

  it('ice still loses the sharpest curve well before 60 km/h', () => {
    // The counterweight. Ice must stay frightening — an envelope that keeps
    // climbing means the fix overshot and the hazard is gone.
    expect(COASTING.ice[3]).toBeLessThan(60)
  })

  it('asphalt keeps its current feel in the sharpest curve', () => {
    expect(COASTING.asphalt[3]).toBeGreaterThanOrEqual(85)
  })

  it('envelope widens monotonically as the curve opens up', () => {
    // c=0.4 must never be tighter than c=2.0 on any surface.
    for (const surface of SURFACES) {
      const row = COASTING[surface]
      for (let i = 1; i < row.length; i++) {
        expect(row[i - 1]!, `${surface}: c=${CURVATURES[i - 1]} vs c=${CURVATURES[i]}`)
          .toBeGreaterThanOrEqual(row[i]!)
      }
    }
  })

  it('grip ordering is respected — more grip is never a smaller envelope', () => {
    // Order comes from the config, never from a copy of it: two surfaces on the
    // same grip are not ordered *by grip*, so there is nothing to assert about                                                             // them — SURFACE_STEER_DAMP_MULT and SURFACE_CURVE_DRIFT_MULT decide, and
    // they are entitled to.
    const byGrip = [...SURFACES].sort((a, b) => SURFACE_GRIP[b] - SURFACE_GRIP[a])
    for (let c = 0; c < CURVATURES.length; c++) {
      for (let i = 1; i < byGrip.length; i++) {
        const more = byGrip[i - 1]!
        const less = byGrip[i]!
        if (SURFACE_GRIP[more] === SURFACE_GRIP[less]) continue
        expect(COASTING[more][c]!, `c=${CURVATURES[c]}: ${more} vs ${less}`)
          .toBeGreaterThanOrEqual(COASTING[less][c]!)
      }
    }
  })

})

// ─── Braking (audit §3c) ─────────────────────────────────────────────────────

describe('controllability envelope — braking into the curve', () => {
  it('prints the braking envelope table', () => {
    printTable(BRAKING, 'BRAKING')
    expect(Object.keys(BRAKING).length).toBe(SURFACES.length)
  })

  it('braking on ice leaves a usable steering envelope', () => {
    // Slowing down is the correct response to ICE AHEAD. If holding the brake
    // collapses steering authority, the game punishes the right decision.
    expect(BRAKING.ice[1]).toBeGreaterThanOrEqual(30)
  })

  it('braking never widens the envelope', () => {
    for (const surface of SURFACES) {
      for (let c = 0; c < CURVATURES.length; c++) {
        expect(BRAKING[surface][c]!, `${surface} @ c=${CURVATURES[c]}`)
          .toBeLessThanOrEqual(COASTING[surface][c]!)
      }
    }
  })
})

// ─── Symmetry ────────────────────────────────────────────────────────────────

describe('controllability envelope — left/right symmetry', () => {
  it('a left curve is exactly as driveable as its mirrored right curve', () => {
    // The lateral model is one signed axis, so a sign slip anywhere in it —
    // steering, centrifugal, the lean offset, the off-road margin — shows up as
    // one direction being easier than the other and as nothing else.
    for (const surface of SURFACES) {
      expect(COASTING_LEFT[surface], surface).toEqual(COASTING[surface])
    }
  })
})
