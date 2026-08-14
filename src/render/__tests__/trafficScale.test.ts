/**
 * The growth curve. A vehicle used to hold nearly the same size for three
 * quarters of its approach and then treble in the last 48 m, which reads as
 * "it was far away and then it was suddenly on me" rather than as closing speed.
 */

import { describe, it, expect } from 'vitest'
import { projectTrafficVehicle } from '../road3d.ts'
import {
  TRAFFIC_SCALE_A, TRAFFIC_SCALE_B, TRAFFIC_SCALE_FAR, TRAFFIC_SCALE_FAR_Z_M,
  TRAFFIC_SCALE_NEAR, TRAFFIC_SCALE_NEAR_Z_M, VIEWPORT_BOTTOM, VIEWPORT_TOP,
} from '../../config.ts'
import type { TrafficVehicle, VehicleType } from '../../game/traffic.ts'

const noCurve = () => 0
const veh = (distM: number, type: VehicleType = 'car'): TrafficVehicle =>
  ({ spawnDist: 0, distM, x: 0, speed: 0, dir: 'same', type, gone: false })

const project = (distM: number, type: VehicleType = 'car') =>
  projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, veh(distM, type), noCurve)!

describe('the solved curve passes through its anchors', () => {
  it('hits the near scale at the near depth', () => {
    expect(TRAFFIC_SCALE_A / (TRAFFIC_SCALE_NEAR_Z_M + TRAFFIC_SCALE_B))
      .toBeCloseTo(TRAFFIC_SCALE_NEAR, 6)
  })

  it('hits the far scale at the far depth', () => {
    expect(TRAFFIC_SCALE_A / (TRAFFIC_SCALE_FAR_Z_M + TRAFFIC_SCALE_B))
      .toBeCloseTo(TRAFFIC_SCALE_FAR, 6)
  })

  it('has a positive offset, so the near end stays finite', () => {
    expect(TRAFFIC_SCALE_B).toBeGreaterThan(0)
  })
})

describe('size reads as distance across the whole approach', () => {
  const LADDER = [220, 180, 150, 120, 100, 80, 60, 50, 40, 30, 25, 20, 15, 10, 5, 2]

  it('grows at every step, never plateauing', () => {
    // The old curve grew a car by 3 px across the 170 m from 220 to 50, then
    // trebled it in the last 48. Every step here has to carry some of the change.
    let prev = project(LADDER[0]!).w
    for (const dist of LADDER.slice(1)) {
      const w = project(dist).w
      expect(w, `at ${dist}m`).toBeGreaterThan(prev)
      prev = w
    }
  })

  it('spends real growth on the far half, not only the last few metres', () => {
    const far = project(220).w
    const mid = project(50).w
    const near = project(2).w
    // 220 -> 50 m is three quarters of the approach and used to be worth 1.4x.
    expect(mid / far).toBeGreaterThan(2.5)
    // The near half still has to carry its share, or nothing feels like arrival.
    expect(near / mid).toBeGreaterThan(1.8)
  })

  it('never jumps by more than a third in one sampled step', () => {
    // A step much larger than its neighbours is the "suddenly on me" artefact.
    let prev = project(LADDER[0]!).w
    for (const dist of LADDER.slice(1)) {
      const w = project(dist).w
      expect(w / prev, `at ${dist}m`).toBeLessThan(1.34)
      prev = w
    }
  })

  it('keeps the near size the owner asked to preserve', () => {
    expect(project(2).w).toBeGreaterThanOrEqual(29)
    expect(project(2).w).toBeLessThanOrEqual(33)
  })
})

describe('scale is continuous where the projection changes branch', () => {
  it('does not resize on the frame a vehicle draws level with the player', () => {
    // worldZ <= 0 switches to the pass-behind branch. It used to start from a
    // hardcoded 1.45 while the depth curve ended elsewhere, so a vehicle changed
    // size at the moment it was most visible.
    const before = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 100, 0, veh(100.1), noCurve)!
    const after = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 100, 0, veh(99.9), noCurve)!
    expect(Math.abs(after.scale - before.scale)).toBeLessThan(0.02)
    expect(Math.abs(after.w - before.w)).toBeLessThanOrEqual(1)
  })
})
