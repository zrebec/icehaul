/**
 * The decisions a traffic driver makes, over roads that do not exist.
 *
 * Everything here is a property of the law rather than a snapshot of a seed:
 * whether a sharper bend asks for less speed, whether the lift starts before the
 * ice or on it, whether two drivers meeting one bend do two different things.
 * That a real route then behaves is `traffic.test.ts`.
 */

import { describe, it, expect } from 'vitest'
import {
  roadLimitKph, roadTargetKph, followTargetKph, chooseTargetKph, stepSpeed,
  type DriverTraits,
} from '../trafficDriver.ts'
import type { RoadSampler } from '../safespeed.ts'
import {
  SURFACE_GRIP, type Surface,
  TRAFFIC_SAME_SPEED, TRAFFIC_SURFACE_MAX_KPH, TRAFFIC_CAUTION_RANGE,
  TRAFFIC_BRAKE_LAMP_MIN_KMH_S, TRAFFIC_MIN_FOLLOW_GAP_M,
} from '../../config.ts'

const SURFACES: readonly Surface[] = ['asphalt', 'snow', 'ice', 'sand', 'mud']
const CRUISE = TRAFFIC_SAME_SPEED[1]          // 55 — the fleet's quickest
const NORMAL: DriverTraits = { caution: 1, vigour: 1 }

/** A road with no surprises — every sample identical. */
function flatRoad(surface: Surface, curvature = 0): RoadSampler {
  return {
    surfaceAt: () => surface,
    gripAt: () => SURFACE_GRIP[surface],
    curvatureAt: () => curvature,
  }
}

/** Asphalt with one stretch of ice in the middle of it. */
function roadWithIce(iceFrom: number, iceTo: number): RoadSampler {
  const on = (d: number) => d >= iceFrom && d < iceTo
  return {
    surfaceAt: (d) => (on(d) ? 'ice' : 'asphalt'),
    gripAt: (d) => (on(d) ? SURFACE_GRIP.ice : SURFACE_GRIP.asphalt),
    curvatureAt: () => 0,
  }
}

// ─── What the road allows ────────────────────────────────────────────────────

describe('roadLimitKph', () => {
  it('asks for less speed the sharper the bend, on every surface', () => {
    for (const s of SURFACES) {
      const limits = [0.4, 1.0, 1.5, 2.0].map(c => roadLimitKph(flatRoad(s, c), 0, CRUISE, 1))
      for (let i = 1; i < limits.length; i++) {
        expect(limits[i]!, `${s} at increasing curvature`).toBeLessThanOrEqual(limits[i - 1]!)
      }
    }
  })

  it('asks for less speed the worse the grip, at one bend', () => {
    const at = (s: Surface) => roadLimitKph(flatRoad(s, 2.0), 0, CRUISE, 1)
    expect(at('asphalt')).toBeGreaterThan(at('snow'))
    expect(at('snow')).toBeGreaterThan(at('ice'))
  })

  it('leaves a gentle asphalt bend alone — nobody in traffic is near the limit', () => {
    // The whole reason TRAFFIC_CORNER_COMFORT_PCT exists is that the physics
    // limit is far above cruise. At curvature 1.0 even the comfort speed is, so
    // a bend that earns a chevron in the HUD is not automatically a brake light.
    expect(roadLimitKph(flatRoad('asphalt', 1.0), 0, CRUISE, 1)).toBeGreaterThanOrEqual(CRUISE)
  })

  it('bites on the sharpest asphalt bend, and only for the quicker half of the fleet', () => {
    const limit = roadLimitKph(flatRoad('asphalt', 2.0), 0, CRUISE, 1)
    expect(limit).toBeLessThan(TRAFFIC_SAME_SPEED[1])   // the quick ones brake
    expect(limit).toBeGreaterThan(TRAFFIC_SAME_SPEED[0]) // the slow ones do not
  })

  it('caps a straight piece of ice, which the cornering law cannot', () => {
    // A straight has no lateral demand, so the friction circle happily allows
    // 55 km/h on bare ice. This is the cap that says no.
    expect(roadLimitKph(flatRoad('ice', 0), 0, CRUISE, 1)).toBe(TRAFFIC_SURFACE_MAX_KPH.ice)
  })

  it('never returns more than the vehicle wanted in the first place', () => {
    for (const s of SURFACES) {
      expect(roadLimitKph(flatRoad(s, 0), 0, 30, 1)).toBeLessThanOrEqual(30)
    }
  })
})

// ─── Reading the road ahead ──────────────────────────────────────────────────

describe('roadTargetKph', () => {
  it('is just the limit on a road that never changes', () => {
    const road = flatRoad('ice', 0)
    expect(roadTargetKph(road, 0, CRUISE, CRUISE, NORMAL))
      .toBeCloseTo(roadLimitKph(road, 0, CRUISE, 1), 6)
  })

  it('starts slowing BEFORE the ice, not on it', () => {
    // The point of the whole feature: the lamps have to come on while the ice is
    // still ahead, or they tell the player nothing they could act on.
    const road = roadWithIce(200, 400)
    const at = (d: number) => roadTargetKph(road, d, CRUISE, CRUISE, NORMAL)

    expect(at(200), 'at the ice it is already down to the ice speed')
      .toBeLessThanOrEqual(TRAFFIC_SURFACE_MAX_KPH.ice! + 0.01)
    expect(at(180), 'twenty metres out it is well into braking').toBeLessThan(CRUISE - 5)
    expect(at(100), 'a hundred metres out there is nothing to do yet').toBe(CRUISE)
  })

  it('a cautious driver brakes earlier and to a lower speed than a bold one', () => {
    // Two cars meeting one hazard must not look like one decision.
    const road = roadWithIce(200, 400)
    const bold = roadTargetKph(road, 175, CRUISE, CRUISE, { caution: TRAFFIC_CAUTION_RANGE[0], vigour: 1 })
    const careful = roadTargetKph(road, 175, CRUISE, CRUISE, { caution: TRAFFIC_CAUTION_RANGE[1], vigour: 1 })
    expect(careful).toBeLessThan(bold)
  })

  it('never asks for more than the vehicle cruises at', () => {
    for (const s of SURFACES) {
      expect(roadTargetKph(flatRoad(s, 0), 0, 40, 40, NORMAL)).toBeLessThanOrEqual(40)
    }
  })

  it('prints where braking starts, per surface', () => {
    // The number the feature lives or dies on: too short and the brake light is a
    // blink, too long and traffic crawls everywhere. See TRAFFIC_BRAKE_PLAN_KMH_S.
    const rows = SURFACES.filter(s => s !== 'asphalt').map((s) => {
      const road: RoadSampler = {
        surfaceAt: (d) => (d >= 300 ? s : 'asphalt'),
        gripAt: (d) => (d >= 300 ? SURFACE_GRIP[s] : SURFACE_GRIP.asphalt),
        curvatureAt: () => 0,
      }
      let liftAt = 300
      for (let d = 300; d >= 150; d -= 1) {
        if (roadTargetKph(road, d, CRUISE, CRUISE, NORMAL) >= CRUISE - 0.01) break
        liftAt = d
      }
      const settled = roadTargetKph(road, 300, CRUISE, CRUISE, NORMAL)
      return `${s.padEnd(8)} lifts ${String(300 - liftAt).padStart(3)} m out, down to ${settled.toFixed(1)} km/h`
    })
    console.log(`\n═══ A ${CRUISE} km/h car meeting a surface change ═══\n${rows.join('\n')}`)
    expect(rows.length).toBe(4)
  })
})

// ─── Following ───────────────────────────────────────────────────────────────

describe('followTargetKph', () => {
  it('says nothing at all when the other thing is behind', () => {
    expect(followTargetKph(-5, 50, 25)).toBe(Number.POSITIVE_INFINITY)
  })

  it('says nothing when it is not closing', () => {
    expect(followTargetKph(30, 25, 30)).toBe(Number.POSITIVE_INFINITY)
  })

  it('says nothing at a comfortable distance', () => {
    expect(followTargetKph(100, 55, 25)).toBe(Number.POSITIVE_INFINITY)
  })

  it('settles just under the leader once inside the gap', () => {
    expect(followTargetKph(20, 55, 25)).toBe(23)
  })

  it('reports Infinity rather than the current speed, so recovery is possible', () => {
    // The trap this avoids: a "no constraint" answer of `ownSpeed` would pin a
    // vehicle that had just braked to the speed it braked to, forever.
    const justBraked = 25
    expect(chooseTargetKph(null, 0, justBraked, 55, NORMAL, [{ gapM: 500, speedKph: 50 }]))
      .toBe(55)
  })
})

describe('chooseTargetKph', () => {
  it('takes whichever asks for less, the road or the queue', () => {
    const road = flatRoad('asphalt', 0)
    const clear = chooseTargetKph(road, 0, 55, 55, NORMAL, [])
    const blocked = chooseTargetKph(road, 0, 55, 55, NORMAL, [{ gapM: 15, speedKph: 30 }])
    expect(clear).toBe(55)
    expect(blocked).toBeLessThan(clear)
  })

  it('works with no road at all — the queue still holds', () => {
    expect(chooseTargetKph(null, 0, 55, 55, NORMAL, [{ gapM: 12, speedKph: 20 }])).toBe(18)
  })

  it('never returns more than cruise, or less than zero', () => {
    const road = flatRoad('ice', 2.0)
    const t = chooseTargetKph(road, 0, 55, 55, NORMAL, [{ gapM: 5, speedKph: 0 }])
    expect(t).toBeGreaterThanOrEqual(0)
    expect(t).toBeLessThanOrEqual(55)
  })
})

// ─── The pedal ───────────────────────────────────────────────────────────────

describe('stepSpeed', () => {
  it('never undershoots the target', () => {
    const step = stepSpeed(55, 30, 55, { caution: 1, vigour: 5 }, 5000)
    expect(step.speedKph).toBe(30)
  })

  it('climbs back to cruise once the reason is gone, and stops there', () => {
    let speed = 20
    for (let i = 0; i < 400; i++) speed = stepSpeed(speed, 55, 55, NORMAL, 100).speedKph
    expect(speed).toBe(55)
  })

  it('lights the lamps for a real brake', () => {
    expect(stepSpeed(55, 30, 55, NORMAL, 16).braking).toBe(true)
  })

  it('leaves them dark for the last sliver of a correction', () => {
    // The vehicle is 0.02 km/h above target: it arrives this tick, and the
    // deceleration it actually achieved is nothing like a brake.
    const step = stepSpeed(30.02, 30, 55, NORMAL, 16)
    expect(step.speedKph).toBe(30)
    expect(step.braking).toBe(false)
  })

  it('leaves them dark while accelerating', () => {
    expect(stepSpeed(30, 55, 55, NORMAL, 16).braking).toBe(false)
  })

  it('a vigorous driver sheds more in the same tick than a timid one', () => {
    const timid = stepSpeed(55, 30, 55, { caution: 1, vigour: 0.85 }, 100).speedKph
    const keen = stepSpeed(55, 30, 55, { caution: 1, vigour: 1.2 }, 100).speedKph
    expect(keen).toBeLessThan(timid)
  })

  it('the lamp threshold is a real threshold, not decoration', () => {
    // A deceleration under TRAFFIC_BRAKE_LAMP_MIN_KMH_S must not light anything,
    // whatever asked for it. Constructed so the achieved rate lands below it.
    const dtMs = 100
    const target = 40
    const speed = target + (TRAFFIC_BRAKE_LAMP_MIN_KMH_S * 0.5) * (dtMs / 1000)
    expect(stepSpeed(speed, target, 55, NORMAL, dtMs).braking).toBe(false)
  })
})

// ─── The gap the queue keeps ─────────────────────────────────────────────────

describe('a follower closing on a slower leader', () => {
  it('settles behind it instead of driving through it', () => {
    // Two vehicles on a straight, the quicker one behind. Simulated at the rate
    // the game ticks, with the follower obeying only what this module says.
    let gapM = 60
    let follower = 55
    const leader = 30
    for (let i = 0; i < 3000; i++) {
      const target = chooseTargetKph(null, 0, follower, 55, NORMAL, [{ gapM, speedKph: leader }])
      follower = stepSpeed(follower, target, 55, NORMAL, 16).speedKph
      gapM += (leader - follower) / 3.6 * 0.016
      expect(gapM, `closed to ${gapM.toFixed(1)} m after ${i} ticks`).toBeGreaterThan(0)
    }
    expect(follower).toBeLessThanOrEqual(leader)
    expect(gapM).toBeGreaterThan(TRAFFIC_MIN_FOLLOW_GAP_M * 0.5)
  })
})
