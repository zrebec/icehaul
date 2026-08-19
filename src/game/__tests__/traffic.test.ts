import { describe, it, expect, beforeEach } from 'vitest'
import { followPlayerSpeed, resetTraffic, tickTraffic, getVisibleTraffic } from '../traffic.ts'
import { getTrafficSpriteRows, projectTrafficVehicle } from '../../render/road3d.ts'
import { resetRoad, getSurfaceAt, getGripAt, getCurvatureAt } from '../road.ts'
import { dailyRoadSeed } from '../seed.ts'
import {
  VIEWPORT_TOP, VIEWPORT_BOTTOM, TRAFFIC_VIEW_DISTANCE_M,
  TRAFFIC_SPACING_M, TRAFFIC_SAME_DIR_PCT, TRAFFIC_COLLISION_DEPTH_M,
  SURFACE_GRIP, type Surface,
} from '../../config.ts'
import type { TrafficVehicle } from '../traffic.ts'
import type { RoadSampler } from '../safespeed.ts'

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

// ─── What the density actually is, measured ──────────────────────────────────

describe('traffic density, measured', () => {
  /**
   * Printed rather than asserted, in the style of `completability.test.ts`: these
   * are the numbers a tuning decision gets made from, and pinning them would only
   * mean re-pinning them the day `TRAFFIC_SPACING_M` moves.
   *
   * The question they answer is whether car-to-car braking has anything to bite
   * on, and the measurement **overturned the arithmetic that predicted it would
   * not**. Spacing is `TRAFFIC_SPACING_M` over every vehicle and only
   * `TRAFFIC_SAME_DIR_PCT` of them go the player's way, which says consecutive
   * same-direction vehicles should sit 220 / 0.55 = 400 m apart. They do not —
   * spawn spacing is not what survives. Vehicles cruise anywhere in
   * `TRAFFIC_SAME_SPEED` (30-55) while the player holds ~45, so the slow ones
   * fall back and the quick ones run forward, and the gap distribution ends up
   * set by drift rather than by the spawner:
   *
   *     seed        w/leader <=100m   mean gap   closest ever
   *     42                    63.2%        67m           23 m
   *     1443866               41.5%       100m           24 m
   *     534501                62.0%        73m           23 m
   *     7                     19.7%       178m           29 m
   *     99999                 58.0%        86m           23 m
   *
   * So a follower has something in front of it **most of the time**, which is far
   * more than the arithmetic promised.
   *
   * The "closest ever" column used to read **0 m on every seed**, and finding out
   * why was worth more than the rest of this table: a new vehicle was spawned at
   * a point a quicker one had already driven past, so it appeared 0.35 m behind
   * a car that had started 286 m further back. That is what made traffic look
   * drawn through itself. `TRAFFIC_MIN_SPAWN_GAP_M` fixed it; the car-following
   * model, which was the obvious suspect, was never the cause.
   */
  const SEEDS = [42, 1_443_866, 534_501, 7, 99_999]
  const PLAYER_KPH = 45
  const STEP_MS = 100
  const RUN_M = 5000
  /** A gap worth calling "following" — beyond this nobody is holding anybody up. */
  const REACH_M = 100

  interface Density {
    seed: number
    samples: number
    withLeader: number
    meanGapM: number
    minGapM: number
    overlaps: number
    slowest: number
    fastest: number
  }

  function measure(seed: number): Density {
    resetTraffic(seed)
    let dist = 0
    let samples = 0
    let withLeader = 0
    let gapSum = 0
    let gapCount = 0
    let minGapM = Infinity
    let overlaps = 0
    let slowest = Infinity
    let fastest = 0

    while (dist < RUN_M) {
      tickTraffic(dist, 0, PLAYER_KPH, STEP_MS)
      dist += (PLAYER_KPH / 3.6) * (STEP_MS / 1000)

      // Sorted by depth so "the next one" is the vehicle immediately ahead. The
      // spawn order cannot be trusted for this: vehicles move at their own
      // speeds, so the array order and the road order come apart.
      const same = getVisibleTraffic(dist, 600)
        .filter(v => v.dir === 'same')
        .slice()
        .sort((a, b) => a.distM - b.distM)

      for (let i = 0; i < same.length; i++) {
        const v = same[i]!
        samples++
        if (v.speed < slowest) slowest = v.speed
        if (v.speed > fastest) fastest = v.speed

        const leader = same[i + 1]
        if (!leader) continue
        const gapM = leader.distM - v.distM
        gapSum += gapM
        gapCount++
        if (gapM < minGapM) minGapM = gapM
        if (gapM < TRAFFIC_COLLISION_DEPTH_M) overlaps++
        if (gapM <= REACH_M) withLeader++
      }
    }

    return {
      seed,
      samples,
      withLeader,
      meanGapM: gapCount > 0 ? gapSum / gapCount : 0,
      minGapM: Number.isFinite(minGapM) ? minGapM : 0,
      overlaps,
      slowest: Number.isFinite(slowest) ? slowest : 0,
      fastest,
    }
  }

  it('prints how often a same-direction vehicle has another one within reach', () => {
    const rows = SEEDS.map(measure)
    const head = `${'Seed'.padEnd(9)} ${'samples'.padStart(8)} ${'w/leader'.padStart(9)}`
      + ` ${'mean gap'.padStart(9)} ${'min gap'.padStart(8)} ${'overlaps'.padStart(9)}`
      + ` ${'speeds km/h'.padStart(12)}`
    const lines = [head, '─'.repeat(head.length)]
    for (const r of rows) {
      const pct = r.samples > 0 ? (r.withLeader / r.samples * 100).toFixed(1) : '0.0'
      lines.push(
        `${String(r.seed).padEnd(9)} ${String(r.samples).padStart(8)} ${`${pct}%`.padStart(9)}`
        + ` ${`${r.meanGapM.toFixed(0)}m`.padStart(9)} ${`${r.minGapM.toFixed(0)}m`.padStart(8)}`
        + ` ${String(r.overlaps).padStart(9)}`
        + ` ${`${r.slowest.toFixed(0)}-${r.fastest.toFixed(0)}`.padStart(12)}`,
      )
    }
    lines.push('─'.repeat(head.length))
    lines.push(`analytic mean gap between same-direction vehicles:`
      + ` ${TRAFFIC_SPACING_M} / ${TRAFFIC_SAME_DIR_PCT} = ${(TRAFFIC_SPACING_M / TRAFFIC_SAME_DIR_PCT).toFixed(0)} m`)
    console.log(`\n═══ Same-direction density over ${RUN_M / 1000} km at ${PLAYER_KPH} km/h ═══\n${lines.join('\n')}`)

    expect(rows.length).toBe(SEEDS.length)
  })

  it('never puts two same-direction vehicles inside each other', () => {
    // This assertion was written the other way round first, as a baseline: it
    // said "they do touch", because they did — 0.00 m on every seed — and a test
    // that only printed that would have let the fix land unnoticed. It flipped
    // when `TRAFFIC_MIN_SPAWN_GAP_M` landed, which is the whole reason it exists
    // in this shape.
    const worst = Math.min(...SEEDS.map(s => measure(s).minGapM))
    console.log(`\nClosest two same-direction vehicles ever got: ${worst.toFixed(2)} m`
      + ` (a vehicle is ${TRAFFIC_COLLISION_DEPTH_M} m of road)`)
    expect(worst).toBeGreaterThan(TRAFFIC_COLLISION_DEPTH_M * 2)
  })
})

// ─── The lamps, on a real road ───────────────────────────────────────────────

describe('braking for what is ahead', () => {
  /**
   * The end-to-end claim, and the one Fox will judge from the driving seat:
   * **a vehicle in front of you lights its lamps before the hazard, not on it.**
   *
   * Driven over the real generated road rather than a synthetic one, because the
   * thing being checked is not the law — `trafficDriver.test.ts` has that — but
   * whether the wiring delivers it on the roads the game actually makes.
   */
  const PLAYER_KPH = 45
  const STEP_MS = 50

  interface Brake {
    distM: number
    /** Metres from here to the next surface change, or null if none in reach. */
    toHazardM: number | null
    surface: Surface
  }

  function driveAndWatch(seed: number, runM: number): Brake[] {
    resetRoad(seed)
    resetTraffic(seed)
    const road: RoadSampler = {
      surfaceAt: (d) => getSurfaceAt(d),
      gripAt: (d) => getGripAt(d),
      curvatureAt: (d) => getCurvatureAt(d),
    }

    const events: Brake[] = []
    const lit = new Set<TrafficVehicle>()
    let dist = 0

    while (dist < runM) {
      tickTraffic(dist, 0, PLAYER_KPH, STEP_MS, road)
      dist += (PLAYER_KPH / 3.6) * (STEP_MS / 1000)

      for (const v of getVisibleTraffic(dist, TRAFFIC_VIEW_DISTANCE_M)) {
        if (v.dir !== 'same') continue
        if (v.braking !== true) { lit.delete(v); continue }
        if (lit.has(v)) continue          // one event per press of the pedal
        lit.add(v)

        // How far this vehicle is from whatever surface it is heading into.
        const here = getSurfaceAt(v.distM)
        let toHazardM: number | null = null
        for (let d = 0; d <= 120; d += 2) {
          if (getSurfaceAt(v.distM + d) !== here) { toHazardM = d; break }
        }
        events.push({ distM: v.distM, toHazardM, surface: here })
      }
    }
    return events
  }

  it('lights the lamps of a vehicle ahead, before it reaches the hazard', () => {
    const events = driveAndWatch(1_443_866, 5000)
    expect(events.length, 'no same-direction vehicle ever braked').toBeGreaterThan(0)

    // Braking that begins with a surface change in sight is the anticipation
    // working. Some events will be queueing instead, which is also correct — so
    // this asks that anticipation happens at all, not that everything is it.
    const anticipating = events.filter(e => e.toHazardM !== null)
    expect(anticipating.length, 'nobody ever braked with a hazard in sight')
      .toBeGreaterThan(0)
    for (const e of anticipating) {
      expect(e.toHazardM!, 'braking started before the hazard, not on it')
        .toBeGreaterThan(0)
    }
  })

  it('prints what a player would see, on today\'s route and on the catalogue', () => {
    const seeds = [dailyRoadSeed(), 1_443_866, 42, 534_501]
    const rows: string[] = []
    for (const seed of seeds) {
      const events = driveAndWatch(seed, 5000)
      const withHazard = events.filter(e => e.toHazardM !== null)
      const dists = withHazard.map(e => e.toHazardM!)
      const mean = dists.length > 0 ? dists.reduce((a, b) => a + b, 0) / dists.length : 0
      rows.push(
        `${String(seed).padEnd(10)} ${String(events.length).padStart(6)} brake events`
        + ` · ${String(withHazard.length).padStart(4)} with a surface change in sight`
        + ` · lit on average ${mean.toFixed(0)} m before it`,
      )
    }
    console.log(`\n═══ Brake lights over 5 km at ${PLAYER_KPH} km/h ═══\n${rows.join('\n')}`)
    expect(rows.length).toBe(seeds.length)
  })

  it('holds the lamps a few metres into the surface it braked for', () => {
    // Fox, from the driving seat: a driver brakes on the approach *and* keeps the
    // pedal down a moment once they are on it. Without the hold the lamps would
    // go dark exactly at the boundary, which is the one moment the player is
    // looking at them.
    // Past TRAFFIC_START_M, or nothing has spawned to test with.
    const ICE_AT = 1200
    const road: RoadSampler = {
      surfaceAt: (d) => (d >= ICE_AT ? 'ice' : 'asphalt'),
      gripAt: (d) => (d >= ICE_AT ? SURFACE_GRIP.ice : SURFACE_GRIP.asphalt),
      curvatureAt: () => 0,
    }
    // Which way the first few vehicles go is a property of the seed, and this
    // test is not about that — so take the first seed that offers one going the
    // player's way rather than pinning one and hoping.
    let target: TrafficVehicle | undefined
    for (const seed of [7, 42, 123, 999, 1_443_866]) {
      resetTraffic(seed)
      tickTraffic(900, 0, 45, 16, road)
      target = getVisibleTraffic(900, 600).find(x => x.dir === 'same')
      if (target) break
    }
    expect(target, 'no seed offered a same-direction vehicle').toBeTruthy()

    // Placed just before the ice, running at the fleet's top speed.
    const v = target!
    v.distM = ICE_AT - 20
    v.speed = 55

    let litPastBoundary = 0
    for (let i = 0; i < 400; i++) {
      tickTraffic(900, 0, 45, 16, road)
      if (v.distM >= ICE_AT && v.braking === true) litPastBoundary += 1
    }
    // Sixteen ticks is a quarter of a second; at 30 km/h that is over two metres.
    expect(litPastBoundary, 'lamps went dark at the boundary').toBeGreaterThan(16)
  })
})
