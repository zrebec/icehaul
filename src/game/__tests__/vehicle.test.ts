import { describe, it, expect } from 'vitest'
import { createVehicle, tickVehicle, MAX_SPEED, type Vehicle, type VehicleInput } from '../vehicle.ts'

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
