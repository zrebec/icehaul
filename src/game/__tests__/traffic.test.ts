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

describe('lane placement', () => {
  // `vehicle.x = ±1` is the road edge (`road3d.ts:389`), so 0 is the centre line
  // and ±0.5 the lane centres. Same-direction traffic used to spawn in
  // [-0.20, +0.30] — centred on +0.05, straddling the centre line rather than
  // sitting in a lane — which read as a vehicle taking more than its half of
  // the road however wide it was drawn.
  const SEEDS = [123, 1443866, 534501, 52662, 1802200]

  const spawned = (seed: number) => {
    resetTraffic(seed)
    tickTraffic(900, 0, 60, 16)
    return getVisibleTraffic(900, TRAFFIC_VIEW_DISTANCE_M * 4)
  }

  it('puts every vehicle wholly on its own side of the centre line', () => {
    for (const seed of SEEDS) {
      const vehicles = spawned(seed)
      expect(vehicles.length, `seed ${seed} spawned nothing`).toBeGreaterThan(0)
      for (const v of vehicles) {
        if (v.dir === 'same') {
          expect(v.x, `seed ${seed}: same-direction at ${v.distM}m`).toBeGreaterThan(0)
        } else {
          expect(v.x, `seed ${seed}: oncoming at ${v.distM}m`).toBeLessThan(0)
        }
        expect(Math.abs(v.x), `seed ${seed}: inside the road edge`).toBeLessThan(1)
      }
    }
  })

  it('spreads each direction about its own lane centre', () => {
    const xs: Record<'same' | 'oncoming', number[]> = { same: [], oncoming: [] }
    for (const seed of SEEDS) for (const v of spawned(seed)) xs[v.dir].push(v.x)

    for (const dir of ['same', 'oncoming'] as const) {
      const centre = dir === 'same' ? 0.5 : -0.5
      const mean = xs[dir].reduce((a, b) => a + b, 0) / xs[dir].length
      expect(Math.abs(mean - centre), `${dir} mean sits on the lane centre`).toBeLessThan(0.1)
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

describe('brake lights on a same-direction vehicle', () => {
  // The follower is the only thing that ever slows a same-direction vehicle, so
  // "it went slower this tick" is the brake pedal. The renderer reads this flag
  // and swaps RED for B_RED in the framebuffer — see sprites/vehicles.ts.
  //
  // Worth knowing what this can and cannot show: the guard only acts on traffic
  // *behind* the player, which is the last 10 m of the visible window. A vehicle
  // ahead has no braking behaviour at all today.
  it('slows a vehicle that is closing on a slower player', () => {
    const fast = 90
    expect(followPlayerSpeed(1000, fast, 1005, 20, 16)).toBeLessThan(fast)
  })

  it('lights nothing while the player is the faster one', () => {
    resetTraffic(SEED)
    for (let i = 0; i < 30; i++) tickTraffic(1000 + i * 30, 0, 110, 500)
    const seen = getVisibleTraffic(1000 + 29 * 30, 400)
    expect(seen.length, 'no traffic to check').toBeGreaterThan(0)
    expect(seen.every(v => v.braking !== true)).toBe(true)
  })

  // There is deliberately no end-to-end "and then you see it light up" test,
  // because today you would not. Measured: the guard starts braking a vehicle at
  // roughly `TRAFFIC_MIN_FOLLOW_GAP_M + speed * TRAFFIC_FOLLOW_TIME_S` ~= 28 m
  // behind the player, and `getVisibleTraffic` only returns vehicles from 10 m
  // behind. By the time one is on screen it has already settled at the player's
  // speed and stopped braking. The colour swap is correct and costs nothing; it
  // is the *behaviour* that has nowhere to show yet. A vehicle **ahead** never
  // brakes at all — nothing in the model slows it.

  it('never lights an oncoming vehicle — its lamps face the other way', () => {
    resetTraffic(SEED)
    for (let i = 0; i < 40; i++) tickTraffic(900 + i * 20, 0, 60, 200)
    const seen = getVisibleTraffic(900 + 39 * 20, 400)
    expect(seen.filter(v => v.dir === 'oncoming').every(v => v.braking === undefined)).toBe(true)
  })
})
