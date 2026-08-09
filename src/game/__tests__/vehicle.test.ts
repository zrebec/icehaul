import { describe, it, expect } from 'vitest'
import { createVehicle, tickVehicle, massAccelMult, massBrakeMult, massStallMult, MAX_SPEED, type Vehicle, type VehicleInput } from '../vehicle.ts'
import {
  STALL_GRACE_MS, REDLINE_BURN_MS, REDLINE_WARN_DELAY_MS, REDLINE_RPM,
  GEAR_COUNT, REFERENCE_MASS_T, CLUTCH_IDLE_RPM, CLUTCH_GOVERNOR_RPM,
  CLUTCH_REV_RESPONSE, GEARS,
} from '../../config.ts'

const noInput: VehicleInput = { throttle: false, brake: false, steerLeft: false, steerRight: false }
const dt16 = 16

function freshVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return { ...createVehicle(), ...overrides }
}

describe('createVehicle', () => {
  it('starts at zero state', () => {
    const v = createVehicle()
    expect(v.x).toBe(0)
    expect(v.vx).toBe(0)
    expect(v.speed).toBe(0)
    expect(v.distance).toBe(0)
    expect(v.fuel).toBe(1.0)
  })
})

describe('massAccelMult', () => {
  it('is exactly 1.0 at the reference mass (today\'s feel unchanged)', () => {
    expect(massAccelMult(REFERENCE_MASS_T)).toBe(1.0)
    expect(massAccelMult(20)).toBe(1.0)
  })

  it('a light 10 t cab accelerates ~2x harder', () => {
    expect(massAccelMult(10)).toBeCloseTo(2.0, 5)
  })

  it('a heavy 30 t load accelerates ~0.67x (a slog)', () => {
    expect(massAccelMult(30)).toBeCloseTo(0.667, 3)
  })

  it('is monotonic: heavier mass always means less pull', () => {
    expect(massAccelMult(10)).toBeGreaterThan(massAccelMult(20))
    expect(massAccelMult(20)).toBeGreaterThan(massAccelMult(30))
  })

  it('honours an explicit reference mass override', () => {
    expect(massAccelMult(15, 30)).toBe(2.0)
  })

  it('composed into accelMult, a heavier truck gains less speed per tick', () => {
    const light = freshVehicle()
    const heavy = freshVehicle()
    const throttle: VehicleInput = { ...noInput, throttle: true }
    // Same surface (asphalt accel 1.0) and grip; only the mass multiplier differs.
    tickVehicle(light, throttle, 'asphalt', 1.0, 1.0 * massAccelMult(10), 200)
    tickVehicle(heavy, throttle, 'asphalt', 1.0, 1.0 * massAccelMult(30), 200)
    expect(light.speed).toBeGreaterThan(heavy.speed)
  })
})

describe('massBrakeMult', () => {
  it('is exactly 1.0 at the reference mass (today\'s braking unchanged)', () => {
    expect(massBrakeMult(REFERENCE_MASS_T)).toBe(1.0)
    expect(massBrakeMult(20)).toBe(1.0)
  })

  it('a light 10 t cab brakes ~2x harder (stops sooner)', () => {
    expect(massBrakeMult(10)).toBeCloseTo(2.0, 5)
  })

  it('a heavy 30 t load brakes ~0.67x (carries momentum, stops later)', () => {
    expect(massBrakeMult(30)).toBeCloseTo(0.667, 3)
  })

  it('is monotonic: heavier mass always means weaker braking', () => {
    expect(massBrakeMult(10)).toBeGreaterThan(massBrakeMult(20))
    expect(massBrakeMult(20)).toBeGreaterThan(massBrakeMult(30))
  })

  it('honours an explicit reference mass override', () => {
    expect(massBrakeMult(15, 30)).toBe(2.0)
  })

  it('omitting massT defaults to the reference mass (no behaviour change)', () => {
    const withDefault = freshVehicle({ speed: 100 })
    const withRef = freshVehicle({ speed: 100 })
    const brake: VehicleInput = { ...noInput, brake: true }
    // No massT arg vs. explicit 20 t must produce identical speed.
    tickVehicle(withDefault, brake, 'asphalt', 1.0, 1.0, 200)
    tickVehicle(withRef, brake, 'asphalt', 1.0, 1.0, 200, 0, 0, 0, REFERENCE_MASS_T)
    expect(withDefault.speed).toBe(withRef.speed)
  })

  it('a heavier truck keeps more speed under identical braking (longer stop)', () => {
    const light = freshVehicle({ speed: 100 })
    const heavy = freshVehicle({ speed: 100 })
    const brake: VehicleInput = { ...noInput, brake: true }
    // Same surface, speed and dt; only the mass differs (last arg).
    tickVehicle(light, brake, 'asphalt', 1.0, 1.0, 200, 0, 0, 0, 10)
    tickVehicle(heavy, brake, 'asphalt', 1.0, 1.0, 200, 0, 0, 0, 30)
    expect(heavy.speed).toBeGreaterThan(light.speed)
  })
})

describe('massStallMult', () => {
  it('is exactly 1.0 at the reference mass (grace period unchanged)', () => {
    expect(massStallMult(REFERENCE_MASS_T)).toBe(1.0)
    expect(massStallMult(20)).toBe(1.0)
  })

  it('a heavy 30 t load has ~0.67x grace (lugs to a stall sooner)', () => {
    expect(massStallMult(30)).toBeCloseTo(0.667, 3)
  })

  it('a light 10 t cab has ~2x grace (forgiving)', () => {
    expect(massStallMult(10)).toBeCloseTo(2.0, 5)
  })

  it('is monotonic: heavier mass always means less grace', () => {
    expect(massStallMult(10)).toBeGreaterThan(massStallMult(20))
    expect(massStallMult(20)).toBeGreaterThan(massStallMult(30))
  })

  it('a heavier lugging truck stalls within a window a lighter one survives', () => {
    // Gear 2 (top 52), 10 km/h → rpm ≈ 0.19 < LUG_RPM: both trucks are lugging.
    const heavy = freshVehicle({ gear: 2, speed: 10 })
    const light = freshVehicle({ gear: 2, speed: 10 })
    // One tick longer than 30 t's grace (~2333 ms) but shorter than 10 t's (~7000 ms).
    const dt = 2500
    tickVehicle(heavy, noInput, 'asphalt', 1.0, 1.0, dt, 0, 0, 0, 30)
    tickVehicle(light, noInput, 'asphalt', 1.0, 1.0, dt, 0, 0, 0, 10)
    expect(heavy.stalled).toBe(true)
    expect(light.stalled).toBe(false)
  })

  it('at the reference mass the stall grace is exactly STALL_GRACE_MS', () => {
    const onEdge = freshVehicle({ gear: 2, speed: 10 })
    const justUnder = freshVehicle({ gear: 2, speed: 10 })
    tickVehicle(onEdge, noInput, 'asphalt', 1.0, 1.0, STALL_GRACE_MS)        // default 20 t
    tickVehicle(justUnder, noInput, 'asphalt', 1.0, 1.0, STALL_GRACE_MS - 1) // default 20 t
    expect(onEdge.stalled).toBe(true)
    expect(justUnder.stalled).toBe(false)
  })
})

describe('tickVehicle — throttle and brake', () => {
  it('throttle increases speed', () => {
    const v = freshVehicle()
    tickVehicle(v, { ...noInput, throttle: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.speed).toBeGreaterThan(0)
  })

  it('speed does not exceed MAX_SPEED', () => {
    const v = freshVehicle({ speed: MAX_SPEED - 0.5 })
    tickVehicle(v, { ...noInput, throttle: true }, 'asphalt', 1.0, 1.0, 1000)
    expect(v.speed).toBeLessThanOrEqual(MAX_SPEED)
  })

  it('brake reduces speed', () => {
    const v = freshVehicle({ speed: 60 })
    tickVehicle(v, { ...noInput, brake: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.speed).toBeLessThan(60)
  })

  it('brake does not go below zero', () => {
    const v = freshVehicle({ speed: 0.1 })
    tickVehicle(v, { ...noInput, brake: true }, 'asphalt', 1.0, 1.0, 1000)
    expect(v.speed).toBeGreaterThanOrEqual(0)
  })

  it('no throttle or brake causes gradual deceleration', () => {
    const v = freshVehicle({ speed: 80 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, 500)
    expect(v.speed).toBeLessThan(80)
    expect(v.speed).toBeGreaterThan(0)
  })

  it('empty fuel prevents throttle', () => {
    const v = freshVehicle({ fuel: 0 })
    tickVehicle(v, { ...noInput, throttle: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.speed).toBe(0)
  })

  it('empty fuel causes coast-down', () => {
    const v = freshVehicle({ speed: 50, fuel: 0 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, 500)
    expect(v.speed).toBeLessThan(50)
  })
})

describe('tickVehicle — steering', () => {
  it('steer left changes lateral velocity', () => {
    const v = freshVehicle({ speed: 60 })
    tickVehicle(v, { ...noInput, steerLeft: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.vx).toBeLessThan(0)
  })

  it('steer right changes lateral velocity', () => {
    const v = freshVehicle({ speed: 60 })
    tickVehicle(v, { ...noInput, steerRight: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.vx).toBeGreaterThan(0)
  })

  it('lateral velocity is damped when not steering', () => {
    const v = freshVehicle({ speed: 60, vx: 1.0 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, 100)
    expect(Math.abs(v.vx)).toBeLessThan(1.0)
  })

  it('low grip reduces steering effectiveness', () => {
    const vHigh = freshVehicle({ speed: 60 })
    const vLow = freshVehicle({ speed: 60 })
    tickVehicle(vHigh, { ...noInput, steerRight: true }, 'asphalt', 1.0, 1.0, dt16)
    tickVehicle(vLow, { ...noInput, steerRight: true }, 'ice', 0.25, 1.0, dt16)
    expect(Math.abs(vLow.vx)).toBeLessThan(Math.abs(vHigh.vx))
  })

  it('lateral velocity clamped to MAX_LATERAL_V', () => {
    const v = freshVehicle({ speed: 60, vx: 2.4 })
    tickVehicle(v, { ...noInput, steerRight: true }, 'asphalt', 1.0, 1.0, 1000)
    expect(v.vx).toBeLessThanOrEqual(2.5)
  })

  it('position x is clamped to ±2.0', () => {
    const v = freshVehicle({ speed: 60, x: 1.9, vx: 2.5 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, 1000)
    expect(v.x).toBeLessThanOrEqual(2.0)
    expect(v.x).toBeGreaterThanOrEqual(-2.0)
  })
})

describe('tickVehicle — off-road physics (pixel-perfect driven)', () => {
  it('offroadSeverity > 0 reduces speed', () => {
    const v = freshVehicle({ speed: 80 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, dt16, 0, 0.5, 0)
    expect(v.speed).toBeLessThan(80)
  })

  it('higher severity means more speed reduction', () => {
    const vMild = freshVehicle({ speed: 80 })
    const vHeavy = freshVehicle({ speed: 80 })
    tickVehicle(vMild, noInput, 'asphalt', 1.0, 1.0, 100, 0, 0.1, 0)
    tickVehicle(vHeavy, noInput, 'asphalt', 1.0, 1.0, 100, 0, 0.8, 0)
    expect(vHeavy.speed).toBeLessThan(vMild.speed)
  })

  it('offroadReturnDir pushes lateral velocity back', () => {
    const v = freshVehicle({ speed: 60, vx: 0 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, 100, 0, 0.5, -1)
    expect(v.vx).toBeLessThan(0)
  })

  it('positive returnDir pushes right', () => {
    const v = freshVehicle({ speed: 60, vx: 0 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, 100, 0, 0.5, 1)
    expect(v.vx).toBeGreaterThan(0)
  })

  it('severity 0 has no off-road effect', () => {
    const vNormal = freshVehicle({ speed: 80 })
    const vZeroSev = freshVehicle({ speed: 80 })
    tickVehicle(vNormal, noInput, 'asphalt', 1.0, 1.0, dt16, 0)
    tickVehicle(vZeroSev, noInput, 'asphalt', 1.0, 1.0, dt16, 0, 0, 0)
    expect(vZeroSev.speed).toBe(vNormal.speed)
  })
})

describe('tickVehicle — surfaces', () => {
  it('ice has lower grip effect on steering', () => {
    const vAsphalt = freshVehicle({ speed: 60 })
    const vIce = freshVehicle({ speed: 60 })
    tickVehicle(vAsphalt, { ...noInput, steerRight: true }, 'asphalt', 1.0, 1.0, 100)
    tickVehicle(vIce, { ...noInput, steerRight: true }, 'ice', 0.25, 1.0, 100)
    expect(Math.abs(vIce.vx)).toBeLessThan(Math.abs(vAsphalt.vx))
  })

  it('sand surface drags speed more', () => {
    const vAsphalt = freshVehicle({ speed: 80 })
    const vSand = freshVehicle({ speed: 80 })
    tickVehicle(vAsphalt, noInput, 'asphalt', 1.0, 1.0, 500)
    tickVehicle(vSand, noInput, 'sand', 0.35, 1.0, 500)
    expect(vSand.speed).toBeLessThan(vAsphalt.speed)
  })
})

describe('tickVehicle — distance and fuel', () => {
  it('distance increases with speed', () => {
    const v = freshVehicle({ speed: 60 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, 1000)
    expect(v.distance).toBeGreaterThan(0)
  })

  it('fuel decreases when driving', () => {
    const v = freshVehicle({ speed: 60, fuel: 1.0 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, 1000)
    expect(v.fuel).toBeLessThan(1.0)
  })

  it('fuel does not go below zero', () => {
    const v = freshVehicle({ speed: 120, fuel: 0.001 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, 10000)
    expect(v.fuel).toBeGreaterThanOrEqual(0)
  })

  it('curvature causes lateral drift', () => {
    const v = freshVehicle({ speed: 80, vx: 0 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, 100, 1.5)
    expect(v.vx).not.toBe(0)
  })
})

describe('tickVehicle — manual gearbox + stall', () => {
  it('first gear cannot exceed its top speed (~28 km/h)', () => {
    const v = freshVehicle({ speed: 27, gear: 1 })
    for (let i = 0; i < 300; i++) {
      tickVehicle(v, { ...noInput, throttle: true }, 'asphalt', 1.0, 1.0, dt16)
    }
    expect(v.speed).toBeLessThanOrEqual(28.001)
    expect(v.stalled).toBe(false)
  })

  it('shiftUp raises the gear, shiftDown lowers it', () => {
    const v = freshVehicle({ speed: 40, gear: 2 })
    tickVehicle(v, { ...noInput, clutch: true, shiftUp: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.gear).toBe(3)
    tickVehicle(v, { ...noInput, clutch: true, shiftDown: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.gear).toBe(2)
  })

  it('lugging a high gear warns first, then stalls after the grace period', () => {
    const v = freshVehicle({ speed: 20, gear: 5 })  // 5th lugs below ~32 km/h
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, dt16)
    expect(v.stallWarning).toBe(true)               // coughing, not dead yet
    expect(v.stalled).toBe(false)
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, STALL_GRACE_MS + 100)
    expect(v.stalled).toBe(true)
    expect(v.rpm).toBe(0)
  })

  it('downshifting during the warning avoids the stall', () => {
    const v = freshVehicle({ speed: 20, gear: 5 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, dt16)
    expect(v.stallWarning).toBe(true)
    tickVehicle(v, { ...noInput, clutch: true, shiftDown: true }, 'asphalt', 1.0, 1.0, dt16)  // 5→4 (still lugging)
    tickVehicle(v, { ...noInput, clutch: true, shiftDown: true }, 'asphalt', 1.0, 1.0, dt16)  // 4→3 recovers
    expect(v.stallWarning).toBe(false)
    expect(v.stalled).toBe(false)
  })

  it('first gear never stalls or warns, even at a standstill', () => {
    const v = freshVehicle({ speed: 0, gear: 1 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, dt16)
    expect(v.stallWarning).toBe(false)
    expect(v.stalled).toBe(false)
  })

  it('a stalled engine produces no throttle power', () => {
    const v = freshVehicle({ speed: 20, gear: 5 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, STALL_GRACE_MS + 100)  // lug past grace → stall
    expect(v.stalled).toBe(true)
    const before = v.speed
    tickVehicle(v, { ...noInput, throttle: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.speed).toBeLessThanOrEqual(before)          // no acceleration while dead
  })

  it('ENTER restart clears the stall and engages a drivable gear', () => {
    const v = freshVehicle({ speed: 0, gear: 4 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, STALL_GRACE_MS + 100)  // stall in 4th
    expect(v.stalled).toBe(true)
    tickVehicle(v, { ...noInput, restart: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.stalled).toBe(false)
    expect(v.gear).toBe(1)                               // startableGear(0) → 1st
  })
})

describe('tickVehicle — synchro shift limits', () => {
  it('refuses a downshift into a gear above its maxSpeedToShift', () => {
    const v = freshVehicle({ speed: 50, gear: 2 })   // 1st engages only below 35
    tickVehicle(v, { ...noInput, clutch: true, shiftDown: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.gear).toBe(2)             // refused — stays in 2nd
    expect(v.shiftBlocked).toBe(true)
  })

  it('allows the same downshift once below the limit', () => {
    const v = freshVehicle({ speed: 30, gear: 2 })   // 30 < 35
    tickVehicle(v, { ...noInput, clutch: true, shiftDown: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.gear).toBe(1)
    expect(v.shiftBlocked).toBe(false)
  })

  it('a null maxSpeedToShift never blocks (4th/5th)', () => {
    const v = freshVehicle({ speed: 120, gear: 5 })
    tickVehicle(v, { ...noInput, clutch: true, shiftDown: true }, 'asphalt', 1.0, 1.0, dt16)  // 5 → 4
    expect(v.gear).toBe(4)
    expect(v.shiftBlocked).toBe(false)
  })

  it('upshifts are never blocked by a synchro limit', () => {
    const v = freshVehicle({ speed: 28, gear: 1 })
    tickVehicle(v, { ...noInput, clutch: true, shiftUp: true }, 'asphalt', 1.0, 1.0, dt16)  // 1 → 2
    expect(v.gear).toBe(2)
    expect(v.shiftBlocked).toBe(false)
  })
})

describe('tickVehicle — redline burn-out', () => {
  it('holding the redline under throttle warns, then burns the engine out', () => {
    const v = freshVehicle({ speed: 76, gear: 3 })  // gear 3 tops out at 76 → redline
    tickVehicle(v, { ...noInput, throttle: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.redlineWarning).toBe(false)            // warn delay not elapsed yet
    expect(v.stalled).toBe(false)
    tickVehicle(v, { ...noInput, throttle: true }, 'asphalt', 1.0, 1.0, REDLINE_WARN_DELAY_MS)
    expect(v.redlineWarning).toBe(true)             // buzzer nag
    tickVehicle(v, { ...noInput, throttle: true }, 'asphalt', 1.0, 1.0, REDLINE_BURN_MS)
    expect(v.stalled).toBe(true)
    expect(v.stallCause).toBe('overrev')
  })

  it('upshifting in time avoids the burn-out', () => {
    const v = freshVehicle({ speed: 76, gear: 3 })
    tickVehicle(v, { ...noInput, throttle: true }, 'asphalt', 1.0, 1.0, REDLINE_WARN_DELAY_MS + 100)
    expect(v.redlineWarning).toBe(true)
    // Clutch in disconnects the wheel-driven redline. Off throttle, inertia now
    // starts a smooth fall toward idle while the upshift selects a lower target.
    tickVehicle(v, { ...noInput, clutch: true, shiftUp: true }, 'asphalt', 1.0, 1.0, dt16)  // 3 → 4
    expect(v.gear).toBe(4)
    expect(v.redlineWarning).toBe(false)
    expect(v.stalled).toBe(false)
    expect(v.redlineMs).toBe(0)
  })

  it('the declutched governor prevents burn-out with the throttle held', () => {
    const v = freshVehicle({ speed: 76, gear: GEAR_COUNT })
    tickVehicle(
      v,
      { ...noInput, clutch: true, throttle: true },
      'asphalt', 1.0, 1.0, REDLINE_BURN_MS + 1000,
    )
    expect(v.engineRpm).toBeCloseTo(CLUTCH_GOVERNOR_RPM, 8)
    expect(v.engineRpm).toBeLessThan(REDLINE_RPM)
    expect(v.redlineWarning).toBe(false)
    expect(v.redlineMs).toBe(0)
    expect(v.stalled).toBe(false)
  })

  it('coasting at the limiter (no throttle) never burns out', () => {
    const v = freshVehicle({ speed: 76, gear: 3 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, REDLINE_BURN_MS + 1000)
    expect(v.stalled).toBe(false)
    expect(v.redlineMs).toBe(0)
  })

  it('the top gear never burns out at max speed (no higher gear to shift to)', () => {
    const v = freshVehicle({ speed: 120, gear: GEAR_COUNT })
    for (let i = 0; i < 600; i++) {
      tickVehicle(v, { ...noInput, throttle: true }, 'asphalt', 1.0, 1.0, dt16)
    }
    expect(v.stalled).toBe(false)
    expect(v.redlineWarning).toBe(false)
  })
})

describe('tickVehicle — fuel exhaustion chain', () => {
  it('near-empty tank drains to zero under sustained throttle', () => {
    const v = freshVehicle({ speed: 80, fuel: 0.001 })
    for (let i = 0; i < 100; i++) tickVehicle(v, { ...noInput, throttle: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.fuel).toBe(0)
  })

  it('empty tank: speed coasts to zero — satisfies drive.ts game-over precondition (fuel<=0 && speed<1)', () => {
    // drive.ts fires triggerGameOver('fuel') when v.fuel <= 0 && v.speed < 1.
    // Verify that physics alone brings a coasting truck to a full stop.
    const v = freshVehicle({ speed: 60, fuel: 0 })
    for (let i = 0; i < 600; i++) tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, dt16)
    expect(v.speed).toBe(0)
  })
})

// ── Clutch ──────────────────────────────────────────────────────────────────
// The mechanic in one sentence: the clean release point is wherever the engine's
// revs equal what the wheels demand in the selected gear, and that target moves
// while you are declutched. These pin the parts that make that true.

describe('tickVehicle — clutch', () => {
  const clutchIn = (over: Partial<VehicleInput> = {}): VehicleInput =>
    ({ ...noInput, clutch: true, ...over })

  it('refuses to change gear without the clutch, and says so', () => {
    const v = freshVehicle({ speed: 40, gear: 2 })
    tickVehicle(v, { ...noInput, shiftUp: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.gear).toBe(2)              // there is no clutchless shifting
    expect(v.shiftBlocked).toBe(true)   // same grind cue as a refused synchro
  })

  it('declutching cuts the drive — throttle revs the engine but not the truck', () => {
    const v = freshVehicle({ speed: 40, gear: 2 })
    const before = v.speed
    tickVehicle(v, clutchIn({ throttle: true }), 'asphalt', 1.0, 1.0, 200)
    expect(v.engineRpm).toBeGreaterThan(CLUTCH_IDLE_RPM)  // revs climbed
    expect(v.speed).toBeLessThanOrEqual(before)           // …the truck did not
  })

  it('pressing the clutch under throttle does not launch high revs into the limiter', () => {
    const v = freshVehicle({ speed: 72, gear: 3 })
    // Prime engineRpm from the engaged drivetrain, as a real preceding frame does.
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, dt16)
    const before = v.engineRpm
    expect(before).toBeGreaterThan(0.9)

    tickVehicle(v, clutchIn({ throttle: true }), 'asphalt', 1.0, 1.0, 250)
    expect(v.engineRpm).toBeLessThanOrEqual(before)
    expect(v.engineRpm).toBeLessThan(REDLINE_RPM)
  })

  it('declutching below idle raises revs smoothly instead of snapping to idle', () => {
    const v = freshVehicle({ speed: 6, gear: 5 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, dt16)
    const before = v.engineRpm
    expect(before).toBeLessThan(CLUTCH_IDLE_RPM)

    tickVehicle(v, clutchIn(), 'asphalt', 1.0, 1.0, dt16)
    expect(v.engineRpm).toBeGreaterThan(before)
    expect(v.engineRpm).toBeLessThan(CLUTCH_IDLE_RPM)
  })

  it('free-rev inertia is stable across different physics tick sizes', () => {
    const run = (ticks: number, dtMs: number): number => {
      const v = freshVehicle({ engineRpm: 0.4 })
      for (let i = 0; i < ticks; i++) {
        tickVehicle(v, clutchIn({ throttle: true }), 'asphalt', 1.0, 1.0, dtMs)
      }
      return v.engineRpm
    }

    const oneLongTick = run(1, 1000)
    const tenShortTicks = run(10, 100)
    const expected = CLUTCH_GOVERNOR_RPM
      - (CLUTCH_GOVERNOR_RPM - 0.4) * Math.exp(-CLUTCH_REV_RESPONSE)
    expect(oneLongTick).toBeCloseTo(tenShortTicks, 10)
    expect(oneLongTick).toBeCloseTo(expected, 10)
  })

  it('a rev-matched release is clean: no jolt', () => {
    // 3rd at 60 km/h wants 60/76 ≈ 0.79. Blip to there, then let it out.
    const v = freshVehicle({ speed: 60, gear: 3 })
    tickVehicle(v, clutchIn(), 'asphalt', 1.0, 1.0, dt16)
    v.engineRpm = 60 / 76
    const before = v.speed
    tickVehicle(v, { ...noInput }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.clutchJolt).toBe(false)
    expect(v.lastBite).toBe(0)
    expect(v.speed).toBeCloseTo(before, 0)
  })

  it('dumping the clutch on an unblipped downshift jolts the truck', () => {
    // 3rd → 2nd at 50: 2nd demands 50/52 ≈ 0.96, engine is idling at 0.20.
    // The wheels have to drag it up, and the truck pays for it.
    const v = freshVehicle({ speed: 50, gear: 3 })
    tickVehicle(v, clutchIn({ shiftDown: true }), 'asphalt', 1.0, 1.0, dt16)
    expect(v.gear).toBe(2)
    const before = v.speed
    tickVehicle(v, { ...noInput }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.clutchJolt).toBe(true)
    expect(v.lastBite).toBeLessThan(0)        // engine slower than demanded
    expect(v.speed).toBeLessThan(before - 2)  // a lurch you feel…
    expect(v.speed).toBeGreaterThan(before - 6) // …not a brake pedal (see CLUTCH_SHOCK)
  })

  it('merely dipping the pedal in the same gear is nearly free', () => {
    // REGRESSION (owner, 2026-08-01): "SHIFT automatically starts braking the
    // truck… practically at 0". CLUTCH_SHOCK was set as if a 20 t truck had to
    // spend its momentum spinning the engine up; at 26 a half-second dip with no
    // gear change cost 6.7 km/h. The mass ratio is ~1000:1 — the engine follows
    // the truck, not the reverse.
    const v = freshVehicle({ speed: 60, gear: 3 })
    v.engineRpm = 60 / 76
    for (let i = 0; i < 300 / dt16; i++) {
      tickVehicle(v, clutchIn(), 'asphalt', 1.0, 1.0, dt16)
    }
    const before = v.speed
    tickVehicle(v, { ...noInput }, 'asphalt', 1.0, 1.0, dt16)
    // Bound moved 1.5 -> 1.6 with the switch to exponential free-rev decay, and
    // the reason is real rather than cosmetic: over this 300 ms dip the engine
    // now falls to ~0.44 instead of ~0.58, because a first-order response is
    // steep at high rpm where the old flat 0.7/s ramp was not. A free flywheel
    // does spool down fast, so the bite finds a wider mismatch and costs a little
    // more. Still nothing like the 6.7 km/h that prompted this test.
    expect(before - v.speed).toBeLessThan(1.6)
  })

  it('letting the clutch out in far too tall a gear kills the engine on the spot', () => {
    // 10 km/h in 5th: the wheels can only turn the engine at 10/130 ≈ 0.08, well
    // under CLUTCH_STALL_RPM, so the truck drags the motor under idle. No cough,
    // no grace — this was one action, not a gradual lug.
    const v = freshVehicle({ speed: 10, gear: 5 })
    tickVehicle(v, clutchIn(), 'asphalt', 1.0, 1.0, dt16)
    tickVehicle(v, { ...noInput }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.stalled).toBe(true)
    expect(v.stallCause).toBe('clutch')
  })

  it('landing just under the lug line still gets the normal warning, not death', () => {
    // 18 km/h in 3rd ≈ 0.24 — below LUG_RPM but above CLUTCH_STALL_RPM. That is
    // where the mercy lives: you get STALL_GRACE_MS to downshift out of it.
    const v = freshVehicle({ speed: 18, gear: 3 })
    tickVehicle(v, clutchIn(), 'asphalt', 1.0, 1.0, dt16)
    tickVehicle(v, { ...noInput }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.stalled).toBe(false)
    expect(v.stallWarning).toBe(true)
  })

  it('blipping the throttle first turns that same downshift clean', () => {
    const v = freshVehicle({ speed: 50, gear: 3 })
    tickVehicle(v, clutchIn({ shiftDown: true }), 'asphalt', 1.0, 1.0, dt16)
    // Hold the clutch and rev until the engine reaches what 2nd will demand.
    for (let i = 0; i < 200 && v.engineRpm < 50 / 52 - 0.02; i++) {
      tickVehicle(v, clutchIn({ throttle: true }), 'asphalt', 1.0, 1.0, dt16)
    }
    const before = v.speed
    tickVehicle(v, { ...noInput }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.clutchJolt).toBe(false)
    expect(v.speed).toBeCloseTo(before, 0)
  })

  it('a heavier truck shrugs off the same mismatch', () => {
    const shock = (massT: number) => {
      const v = freshVehicle({ speed: 50, gear: 2 })
      tickVehicle(v, clutchIn(), 'asphalt', 1.0, 1.0, dt16)
      v.engineRpm = CLUTCH_IDLE_RPM               // identical mismatch both times
      const before = v.speed
      tickVehicle(v, { ...noInput }, 'asphalt', 1.0, 1.0, dt16, 0, 0, 0, massT)
      return before - v.speed
    }
    expect(shock(30)).toBeLessThan(shock(10))
  })

  it('targetRpm tracks what the selected gear will demand, live', () => {
    const v = freshVehicle({ speed: 76, gear: 3 })
    tickVehicle(v, clutchIn(), 'asphalt', 1.0, 1.0, dt16)
    expect(v.targetRpm).toBeCloseTo(1, 1)         // 76/76 — 3rd is at its ceiling
    tickVehicle(v, clutchIn({ shiftUp: true }), 'asphalt', 1.0, 1.0, dt16)
    expect(v.targetRpm).toBeCloseTo(76 / 100, 1)  // 4th wants far fewer revs
  })

  it('dumping an over-revved clutch is a lurch, not free speed', () => {
    // REGRESSION (2026-08-01, found by driving the real build): the first cut
    // was symmetric, so revving to the limiter in neutral and side-stepping the
    // pedal threw the truck from 3 km/h to 30 — faster than actually driving.
    // Over-revved bites now mostly spin the wheels (CLUTCH_LAUNCH_FRACTION).
    const v = freshVehicle({ speed: 3, gear: 2 })
    tickVehicle(v, clutchIn(), 'asphalt', 1.0, 1.0, dt16)
    v.engineRpm = 1                       // wound right up to the redline
    tickVehicle(v, { ...noInput }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.clutchJolt).toBe(true)
    expect(v.speed).toBeGreaterThan(3)    // it does lurch forward…
    expect(v.speed).toBeLessThan(10)      // …but nothing like a free gear
  })

  it('a launch can never carry you past the gear\'s own ceiling', () => {
    const v = freshVehicle({ speed: GEARS[0]!.to - 1, gear: 1 })
    tickVehicle(v, clutchIn(), 'asphalt', 1.0, 1.0, dt16)
    v.engineRpm = 1
    tickVehicle(v, { ...noInput }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.speed).toBeLessThanOrEqual(GEARS[0]!.to)
  })

  it('the engine cannot lug while the clutch is in', () => {
    // Nothing is loading it, so pressing the pedal is the correct save when you
    // are about to stall — and the stall timer must actually respect that.
    const v = freshVehicle({ speed: 5, gear: 5 })
    tickVehicle(v, clutchIn(), 'asphalt', 1.0, 1.0, STALL_GRACE_MS * 3)
    expect(v.stalled).toBe(false)
    expect(v.stallWarnMs).toBe(0)
  })
})
