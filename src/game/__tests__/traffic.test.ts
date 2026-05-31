import { describe, it, expect, beforeEach } from 'vitest'
import { followPlayerSpeed, resetTraffic, tickTraffic, getVisibleTraffic } from '../traffic.ts'
import { getTrafficSpriteRows, projectTrafficVehicle } from '../../render/road3d.ts'
import { VIEWPORT_TOP, VIEWPORT_BOTTOM, TRAFFIC_VIEW_DISTANCE_M } from '../../config.ts'
import type { TrafficVehicle } from '../traffic.ts'

const SEED = 123
const TRAFFIC_SPRITE_DIMS = {
  mini: { w: 14, h: 11 },
  car: { w: 22, h: 15 },
  bus: { w: 28, h: 18 },
} as const

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

describe('followPlayerSpeed', () => {
  it('keeps same-direction traffic speed when the player is not ahead', () => {
    expect(followPlayerSpeed(1005, 50, 1000, 25, 1000)).toBe(50)
  })

  it('keeps speed when the traffic vehicle is not closing on the player', () => {
    expect(followPlayerSpeed(970, 25, 1000, 30, 1000)).toBe(25)
  })

  it('brakes a same-direction vehicle that is closing inside the safe gap', () => {
    const nextSpeed = followPlayerSpeed(980, 55, 1000, 25, 1000)

    expect(nextSpeed).toBeLessThan(55)
    expect(nextSpeed).toBeGreaterThanOrEqual(23)
  })

  it('does not brake a distant same-direction vehicle with enough time gap', () => {
    expect(followPlayerSpeed(900, 55, 1000, 25, 1000)).toBe(55)
  })
})

describe('traffic sprite rows', () => {
  for (const dir of ['same', 'oncoming'] as const) {
    for (const type of ['mini', 'car', 'bus'] as const) {
      it(`${dir} ${type} preserves source dimensions and solid pixels`, () => {
        const rows = getTrafficSpriteRows(dir, type)
        const expected = TRAFFIC_SPRITE_DIMS[type]
        const solid = rows.join('').replaceAll('.', '').length

        expect(rows).toHaveLength(expected.h)
        for (const row of rows) expect(row).toHaveLength(expected.w)
        expect(solid).toBeGreaterThan(expected.w * expected.h * 0.45)
      })
    }
  }

  it('keeps mini, car, and bus source silhouettes in increasing size order', () => {
    expect(TRAFFIC_SPRITE_DIMS.mini.w).toBeLessThan(TRAFFIC_SPRITE_DIMS.car.w)
    expect(TRAFFIC_SPRITE_DIMS.car.w).toBeLessThan(TRAFFIC_SPRITE_DIMS.bus.w)
    expect(TRAFFIC_SPRITE_DIMS.mini.h).toBeLessThan(TRAFFIC_SPRITE_DIMS.car.h)
    expect(TRAFFIC_SPRITE_DIMS.car.h).toBeLessThan(TRAFFIC_SPRITE_DIMS.bus.h)
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
    far.distM = 1200
    far.spawnDist = 1200
    const mid = vehicleOf('car')
    mid.distM = 1050
    mid.spawnDist = 1050
    const near = vehicleOf('car')

    const projectedFar = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, far, () => 0)
    const projectedMid = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, mid, () => 0)
    const projectedNear = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, near, () => 0)

    expect(projectedFar).not.toBeNull()
    expect(projectedMid).not.toBeNull()
    expect(projectedNear).not.toBeNull()
    expect(projectedMid!.w).toBeGreaterThan(projectedFar!.w)
    expect(projectedNear!.w).toBeGreaterThan(projectedMid!.w)
    expect(projectedMid!.h).toBeGreaterThan(projectedFar!.h)
    expect(projectedNear!.h).toBeGreaterThan(projectedMid!.h)
  })

  it('bases vehicle scale on world depth, not only on screen row', () => {
    const far = vehicleOf('bus')
    far.distM = 1210
    far.spawnDist = far.distM
    const closer = vehicleOf('bus')
    closer.distM = 1180
    closer.spawnDist = closer.distM

    const projectedFar = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, far, () => 0)
    const projectedCloser = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, closer, () => 0)

    expect(projectedFar).not.toBeNull()
    expect(projectedCloser).not.toBeNull()
    expect(projectedCloser!.scale).toBeGreaterThan(projectedFar!.scale)
  })

  it('keeps vehicle scale monotonic with world depth across the long view', () => {
    const distances = [1215, 1180, 1120, 1060, 1005]
    const scales = distances.map((distM) => {
      const vehicle = vehicleOf('car')
      vehicle.distM = distM
      vehicle.spawnDist = distM
      return projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, vehicle, () => 0)!.scale
    })

    for (let i = 1; i < scales.length; i++) {
      expect(scales[i]).toBeGreaterThan(scales[i - 1]!)
    }
  })

  it('keeps distant traffic small enough to read lane position', () => {
    const vehicle = vehicleOf('car')
    vehicle.distM = 1200
    vehicle.spawnDist = 1200

    const projected = projectTrafficVehicle(
      VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, vehicle, () => 0,
    )

    expect(projected).not.toBeNull()
    expect(projected!.w).toBeLessThanOrEqual(10)
    expect(projected!.h).toBeLessThanOrEqual(7)
  })

  it('projects traffic almost as far as the traffic look-ahead limit', () => {
    const vehicle = vehicleOf('car')
    vehicle.distM = 1000 + TRAFFIC_VIEW_DISTANCE_M - 5
    vehicle.spawnDist = vehicle.distM

    const projected = projectTrafficVehicle(
      VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, vehicle, () => 0,
    )

    expect(projected).not.toBeNull()
    expect(projected!.y).toBeGreaterThan(VIEWPORT_TOP)
    expect(projected!.y).toBeLessThan(VIEWPORT_BOTTOM)
    expect(projected!.scale).toBeLessThan(0.5)
  })

  it('does not project traffic beyond the traffic look-ahead limit', () => {
    const vehicle = vehicleOf('car')
    vehicle.distM = 1000 + TRAFFIC_VIEW_DISTANCE_M + 1
    vehicle.spawnDist = vehicle.distM

    const projected = projectTrafficVehicle(
      VIEWPORT_TOP, VIEWPORT_BOTTOM, 1000, 0, vehicle, () => 0,
    )

    expect(projected).toBeNull()
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
