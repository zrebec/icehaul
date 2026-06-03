import { describe, it, expect } from 'vitest'
import { createVehicle, tickVehicle, MAX_SPEED, type Vehicle, type VehicleInput } from '../vehicle.ts'
import { STALL_GRACE_MS, REDLINE_BURN_MS, REDLINE_WARN_DELAY_MS, GEAR_COUNT } from '../../config.ts'

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
    tickVehicle(v, { ...noInput, shiftUp: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.gear).toBe(3)
    tickVehicle(v, { ...noInput, shiftDown: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.gear).toBe(2)
  })

  it('lugging a high gear warns first, then stalls after the grace period', () => {
    const v = freshVehicle({ speed: 4, gear: 4 })   // 4th lugs below ~6 km/h
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, dt16)
    expect(v.stallWarning).toBe(true)               // coughing, not dead yet
    expect(v.stalled).toBe(false)
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, STALL_GRACE_MS + 100)
    expect(v.stalled).toBe(true)
    expect(v.rpm).toBe(0)
  })

  it('downshifting during the warning avoids the stall', () => {
    const v = freshVehicle({ speed: 4, gear: 4 })
    tickVehicle(v, noInput, 'asphalt', 1.0, 1.0, dt16)
    expect(v.stallWarning).toBe(true)
    tickVehicle(v, { ...noInput, shiftDown: true }, 'asphalt', 1.0, 1.0, dt16)  // 4→3
    tickVehicle(v, { ...noInput, shiftDown: true }, 'asphalt', 1.0, 1.0, dt16)  // 3→2 recovers
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
    const v = freshVehicle({ speed: 4, gear: 4 })
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
    tickVehicle(v, { ...noInput, shiftDown: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.gear).toBe(2)             // refused — stays in 2nd
    expect(v.shiftBlocked).toBe(true)
  })

  it('allows the same downshift once below the limit', () => {
    const v = freshVehicle({ speed: 30, gear: 2 })   // 30 < 35
    tickVehicle(v, { ...noInput, shiftDown: true }, 'asphalt', 1.0, 1.0, dt16)
    expect(v.gear).toBe(1)
    expect(v.shiftBlocked).toBe(false)
  })

  it('a null maxSpeedToShift never blocks (4th/5th)', () => {
    const v = freshVehicle({ speed: 120, gear: 5 })
    tickVehicle(v, { ...noInput, shiftDown: true }, 'asphalt', 1.0, 1.0, dt16)  // 5 → 4
    expect(v.gear).toBe(4)
    expect(v.shiftBlocked).toBe(false)
  })

  it('upshifts are never blocked by a synchro limit', () => {
    const v = freshVehicle({ speed: 28, gear: 1 })
    tickVehicle(v, { ...noInput, shiftUp: true }, 'asphalt', 1.0, 1.0, dt16)  // 1 → 2
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
    tickVehicle(v, { ...noInput, throttle: true, shiftUp: true }, 'asphalt', 1.0, 1.0, dt16)  // 3 → 4
    expect(v.redlineWarning).toBe(false)
    expect(v.stalled).toBe(false)
    expect(v.redlineMs).toBe(0)
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
