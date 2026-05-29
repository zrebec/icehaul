import { describe, it, expect } from 'vitest'
import { checkTruckOffroad, checkTruckTrafficCollision, type OffroadResult } from '../offroad.ts'
import { computeRoadEdges } from '../roadgeometry.ts'
import { TRUCK_BMP_W, TRUCK_BMP_H, TRUCK_BMP_DATA } from '../../render/truck.ts'
import { GAME_WIDTH, VIEWPORT_BOTTOM, VIEWPORT_TOP } from '../../config.ts'
import { getTrafficSpriteRows, projectTrafficVehicle } from '../../render/road3d.ts'
import type { TrafficVehicle } from '../traffic.ts'

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

describe('checkTruckTrafficCollision', () => {
  // Truck bitmap: 24 × 32 px, truckDrawX/Y = 0 for simplicity.
  // The solid body/cab rows are roughly rows 4–27 of the bitmap.

  it('no overlap when rect is entirely to the right', () => {
    expect(checkTruckTrafficCollision(0, 0, 30, 0, 10, 32)).toBe(false)
  })

  it('no overlap when rect is entirely to the left', () => {
    expect(checkTruckTrafficCollision(0, 0, -15, 0, 10, 32)).toBe(false)
  })

  it('no overlap when rect is entirely above', () => {
    expect(checkTruckTrafficCollision(0, 0, 0, -10, 24, 8)).toBe(false)
  })

  it('no overlap when rect is entirely below the bitmap', () => {
    expect(checkTruckTrafficCollision(0, 0, 0, 35, 24, 8)).toBe(false)
  })

  it('overlap when rect covers the solid body rows', () => {
    // Rows 6–20 are the solid cab+body area
    expect(checkTruckTrafficCollision(0, 0, 0, 6, 24, 14)).toBe(true)
  })

  it('overlap for full rect covering entire bitmap', () => {
    expect(checkTruckTrafficCollision(0, 0, 0, 0, 24, 32)).toBe(true)
  })

  it('truckDrawX offset shifts truck pixels correctly', () => {
    // Truck at x=100: rect at (0,0,24,32) must not overlap
    expect(checkTruckTrafficCollision(100, 0, 0, 0, 24, 32)).toBe(false)
    // Same rect shifted to truck position — must overlap
    expect(checkTruckTrafficCollision(100, 0, 100, 0, 24, 32)).toBe(true)
  })

  it('truckDrawY offset shifts truck pixels correctly', () => {
    // Truck at y=50: rect at (0, 0, 24, 10) misses
    expect(checkTruckTrafficCollision(0, 50, 0, 0, 24, 10)).toBe(false)
    // Rect at y=56 (solid body area of shifted truck) — must overlap
    expect(checkTruckTrafficCollision(0, 50, 0, 56, 24, 14)).toBe(true)
  })

  it('zero-width rect never overlaps', () => {
    expect(checkTruckTrafficCollision(0, 0, 0, 0, 0, 32)).toBe(false)
  })

  it('single-pixel rect inside solid area overlaps', () => {
    // x=12, y=10 is inside the truck body
    expect(checkTruckTrafficCollision(0, 0, 12, 10, 1, 1)).toBe(true)
  })

  it('ignores transparent traffic pixels even when the truck pixel is inside the projected rect', () => {
    expect(checkTruckTrafficCollision(0, 0, 12, 10, 1, 1, ['.'])).toBe(false)
  })

  it('collides with solid traffic pixels when the truck mask touches the sprite mask', () => {
    expect(checkTruckTrafficCollision(0, 0, 12, 10, 1, 1, ['X'])).toBe(true)
  })

  it('matches projected traffic rect for a centered near car', () => {
    const truck = truckDrawPos(0, 0)
    const vehicle: TrafficVehicle = {
      spawnDist: 501.1,
      distM: 501.1,
      x: 0,
      speed: 40,
      dir: 'same',
      type: 'car',
      gone: false,
    }
    const projected = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 500, 0, vehicle, noCurve)

    expect(projected).not.toBeNull()
    expect(checkTruckTrafficCollision(
      truck.x, truck.y,
      projected!.left, projected!.top, projected!.w, projected!.h,
      getTrafficSpriteRows(vehicle.dir, vehicle.type),
    )).toBe(true)
  })

  it('does not collide with a near oncoming vehicle still in the left lane', () => {
    const truck = truckDrawPos(0, 0)
    const vehicle: TrafficVehicle = {
      spawnDist: 501.1,
      distM: 501.1,
      x: -0.55,
      speed: 80,
      dir: 'oncoming',
      type: 'car',
      gone: false,
    }
    const projected = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 500, 0, vehicle, noCurve)

    expect(projected).not.toBeNull()
    expect(checkTruckTrafficCollision(
      truck.x, truck.y,
      projected!.left, projected!.top, projected!.w, projected!.h,
      getTrafficSpriteRows(vehicle.dir, vehicle.type),
    )).toBe(false)
  })

  it('keeps side contact possible during the pass-by phase', () => {
    const truck = truckDrawPos(0, 0)
    const vehicle: TrafficVehicle = {
      spawnDist: 497,
      distM: 497,
      x: -0.15,
      speed: 80,
      dir: 'oncoming',
      type: 'car',
      gone: false,
    }
    const projected = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 500, 0, vehicle, noCurve)

    expect(projected).not.toBeNull()
    expect(checkTruckTrafficCollision(
      truck.x, truck.y,
      projected!.left, projected!.top, projected!.w, projected!.h,
      getTrafficSpriteRows(vehicle.dir, vehicle.type),
    )).toBe(true)
  })
})
