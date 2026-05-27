import { describe, it, expect } from 'vitest'
import { checkTruckOffroad, type OffroadResult } from '../offroad.ts'
import { computeRoadEdges } from '../roadgeometry.ts'
import { TRUCK_BMP_W, TRUCK_BMP_H, TRUCK_BMP_DATA } from '../../render/truck.ts'
import { GAME_WIDTH, VIEWPORT_BOTTOM } from '../../config.ts'

const noCurve = () => 0

function truckDrawPos(vx: number, vxLateral: number) {
  const cx = GAME_WIDTH / 2 + vx * 50
  const lean = -vxLateral * 1.5
  return {
    x: Math.round(cx - 12 + lean),
    y: Math.round(VIEWPORT_BOTTOM - 2 - 32),
  }
}

function checkAtPosition(playerX: number, playerVx = 0, curveFn = noCurve): OffroadResult {
  const pos = truckDrawPos(playerX, playerVx)
  const edges = computeRoadEdges(500, playerX, curveFn)
  return checkTruckOffroad(pos.x, pos.y, edges)
}

describe('truck bitmap mask', () => {
  it('exported dimensions are correct', () => {
    expect(TRUCK_BMP_W).toBe(24)
    expect(TRUCK_BMP_H).toBe(32)
    expect(TRUCK_BMP_DATA.length).toBe((24 / 8) * 32)
  })

  it('bitmap has opaque pixels', () => {
    let opaqueCount = 0
    for (let i = 0; i < TRUCK_BMP_DATA.length; i++) {
      for (let b = 0; b < 8; b++) {
        if (TRUCK_BMP_DATA[i]! & (1 << b)) opaqueCount++
      }
    }
    expect(opaqueCount).toBeGreaterThan(100)
  })
})

describe('checkTruckOffroad', () => {
  it('truck centered on straight road is fully on-road', () => {
    const result = checkAtPosition(0)
    expect(result.severity).toBe(0)
    expect(result.offRoadPixels).toBe(0)
    expect(result.marginLeft).toBeGreaterThan(50)
    expect(result.marginRight).toBeGreaterThan(50)
  })

  it('total pixel count is positive and consistent', () => {
    const r1 = checkAtPosition(0)
    const r2 = checkAtPosition(0.5)
    expect(r1.totalPixels).toBeGreaterThan(300)
    expect(r1.totalPixels).toBe(r2.totalPixels)
  })

  it('slight lateral offset remains on-road', () => {
    const result = checkAtPosition(0.5)
    expect(result.severity).toBe(0)
    expect(result.offRoadPixels).toBe(0)
  })

  it('moderate offset still on-road but margin decreases', () => {
    const center = checkAtPosition(0)
    const offset = checkAtPosition(1.0)
    expect(offset.severity).toBe(0)
    expect(offset.marginRight).toBeLessThan(center.marginRight)
  })

  it('going far right puts pixels off-road on right side', () => {
    const result = checkAtPosition(1.8)
    expect(result.severity).toBeGreaterThan(0)
    expect(result.rightOff).toBeGreaterThan(0)
    expect(result.leftOff).toBe(0)
  })

  it('going far left puts pixels off-road on left side', () => {
    const result = checkAtPosition(-1.8)
    expect(result.severity).toBeGreaterThan(0)
    expect(result.leftOff).toBeGreaterThan(0)
    expect(result.rightOff).toBe(0)
  })

  it('severity increases as truck goes further off-road', () => {
    const mild = checkAtPosition(1.7)
    const severe = checkAtPosition(2.0)
    expect(severe.severity).toBeGreaterThan(mild.severity)
  })

  it('severity is capped at 1.0', () => {
    const result = checkAtPosition(2.0)
    expect(result.severity).toBeLessThanOrEqual(1)
    expect(result.severity).toBeGreaterThan(0)
  })

  it('offRoadPixels + on-road pixels equals totalPixels', () => {
    const result = checkAtPosition(1.8)
    expect(result.offRoadPixels).toBeLessThanOrEqual(result.totalPixels)
    expect(result.offRoadPixels).toBe(result.leftOff + result.rightOff)
  })

  it('marginLeft and marginRight are symmetric when centered', () => {
    const result = checkAtPosition(0)
    expect(Math.abs(result.marginLeft - result.marginRight)).toBeLessThan(5)
  })

  it('curve shifts road edge, changing offroad result', () => {
    const straight = checkAtPosition(1.5, 0, noCurve)
    const curvedRight = checkAtPosition(1.5, 0, () => -2.0)
    expect(curvedRight.marginRight).not.toEqual(straight.marginRight)
  })

  it('lean from lateral velocity shifts truck pixels', () => {
    const noLean = checkAtPosition(1.5, 0)
    const leanRight = checkAtPosition(1.5, -1.0)
    expect(leanRight.marginRight).toBeLessThan(noLean.marginRight)
  })

  it('severity is exactly 0 when fully on road at different positions', () => {
    const r1 = checkAtPosition(0)
    const r2 = checkAtPosition(0.3)
    expect(r1.severity).toBe(0)
    expect(r2.severity).toBe(0)
    expect(r1.offRoadPixels).toBe(0)
    expect(r2.offRoadPixels).toBe(0)
  })
})
