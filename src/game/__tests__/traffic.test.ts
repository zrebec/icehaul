import { describe, it, expect, beforeEach } from 'vitest'
import { resetTraffic, tickTraffic, getVisibleTraffic } from '../traffic.ts'
import { projectTrafficVehicle } from '../../render/road3d.ts'
import { VIEWPORT_TOP, VIEWPORT_BOTTOM } from '../../config.ts'
import type { TrafficVehicle } from '../traffic.ts'

const SEED = 123

beforeEach(() => {
  resetTraffic(SEED)
})

describe('resetTraffic', () => {
  it('starts with no visible vehicles', () => {
    const visible = getVisibleTraffic(0, 100)
    expect(visible.length).toBe(0)
  })
})

describe('tickTraffic', () => {
  it('spawns vehicles ahead of the player', () => {
    tickTraffic(900, 0, 60, 16)
    const visible = getVisibleTraffic(900, 200)
    expect(visible.length).toBeGreaterThan(0)
  })

  it('vehicles have valid properties', () => {
    tickTraffic(900, 0, 60, 16)
    const visible = getVisibleTraffic(900, 500)
    for (const v of visible) {
      expect(v.speed).toBeGreaterThan(0)
      expect(['same', 'oncoming']).toContain(v.dir)
      expect(['mini', 'car', 'bus']).toContain(v.type)
    }
  })

  it('deterministic with same seed', () => {
    tickTraffic(900, 0, 60, 16)
    const v1 = getVisibleTraffic(900, 500).map(v => v.distM)

    resetTraffic(SEED)
    tickTraffic(900, 0, 60, 16)
    const v2 = getVisibleTraffic(900, 500).map(v => v.distM)

    expect(v1).toEqual(v2)
  })

  it('oncoming vehicles move toward player', () => {
    tickTraffic(900, 0, 60, 16)
    const before = getVisibleTraffic(900, 500)
    const oncoming = before.find(v => v.dir === 'oncoming')
    if (oncoming) {
      const distBefore = oncoming.distM
      tickTraffic(900, 0, 60, 500)
      expect(oncoming.distM).toBeLessThan(distBefore)
    }
  })

  it('vehicles behind player are cleaned up', () => {
    for (let i = 0; i < 20; i++) tickTraffic(900 + i * 100, 0, 60, 500)
    const visible = getVisibleTraffic(2800, 300)
    for (const v of visible) {
      expect(v.distM).toBeGreaterThan(2600)
    }
  })

})

describe('projectTrafficVehicle', () => {
  function vehicleOf(type: TrafficVehicle['type']): TrafficVehicle {
    return {
      spawnDist: 1001.1,
      distM: 1001.1,
      x: 0,
      speed: 40,
      dir: 'same',
      type,
      gone: false,
    }
  }

  it('keeps a near vehicle visible below the old 3m cutoff', () => {
    const vehicle = vehicleOf('car')

    const projected = projectTrafficVehicle(
      VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, vehicle, () => 0,
    )

    expect(projected).not.toBeNull()
    expect(projected!.y).toBeGreaterThan(VIEWPORT_TOP)
    expect(projected!.y).toBeLessThan(VIEWPORT_BOTTOM)
    expect(projected!.h).toBeGreaterThanOrEqual(4)
  })

  it('projects mini, car, and bus with distinct collision sizes', () => {
    const mini = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, vehicleOf('mini'), () => 0)
    const car = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, vehicleOf('car'), () => 0)
    const bus = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, vehicleOf('bus'), () => 0)

    expect(mini).not.toBeNull()
    expect(car).not.toBeNull()
    expect(bus).not.toBeNull()
    expect(mini!.w).toBeLessThan(car!.w)
    expect(car!.w).toBeLessThan(bus!.w)
    expect(mini!.h).toBeLessThan(car!.h)
    expect(bus!.h).toBeGreaterThan(car!.h)
  })

  it('keeps growing as traffic gets closer to the truck', () => {
    const far = vehicleOf('car')
    far.distM = 1050
    far.spawnDist = 1050
    const near = vehicleOf('car')

    const projectedFar = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, far, () => 0)
    const projectedNear = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, near, () => 0)

    expect(projectedFar).not.toBeNull()
    expect(projectedNear).not.toBeNull()
    expect(projectedNear!.w).toBeGreaterThan(projectedFar!.w)
    expect(projectedNear!.h).toBeGreaterThan(projectedFar!.h)
  })

  it('keeps distant traffic small enough to read lane position', () => {
    const vehicle = vehicleOf('car')
    vehicle.distM = 1080
    vehicle.spawnDist = 1080

    const projected = projectTrafficVehicle(
      VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, vehicle, () => 0,
    )

    expect(projected).not.toBeNull()
    expect(projected!.w).toBeLessThanOrEqual(10)
    expect(projected!.h).toBeLessThanOrEqual(7)
  })

  it('keeps an almost nose-to-nose vehicle visible for collision checks', () => {
    const vehicle = vehicleOf('car')
    vehicle.distM = 1000.1
    vehicle.spawnDist = 1000.1

    const projected = projectTrafficVehicle(
      VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, vehicle, () => 0,
    )

    expect(projected).not.toBeNull()
    expect(projected!.w).toBeGreaterThan(20)
    expect(projected!.h).toBeGreaterThan(14)
  })

  it('keeps a just-passed vehicle in a short side pass-by phase', () => {
    const vehicle = vehicleOf('car')
    vehicle.distM = 997
    vehicle.spawnDist = 997
    vehicle.x = -0.45

    const projected = projectTrafficVehicle(
      VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, vehicle, () => 0,
    )

    expect(projected).not.toBeNull()
    expect(projected!.y).toBeGreaterThanOrEqual(VIEWPORT_BOTTOM - 1)
    expect(projected!.top).toBeLessThan(VIEWPORT_BOTTOM)
    expect(projected!.w).toBeGreaterThan(30)
  })

  it('removes traffic after the short pass-by phase', () => {
    const vehicle = vehicleOf('car')
    vehicle.distM = 994.5
    vehicle.spawnDist = 994.5

    const projected = projectTrafficVehicle(
      VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, vehicle, () => 0,
    )

    expect(projected).toBeNull()
  })
})
