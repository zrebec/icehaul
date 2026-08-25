import { describe, expect, it } from 'vitest'
import { trafficClosingPerFrame, trafficSweepDepths } from '../collisionSweep.ts'
import {
  TRAFFIC_SWEEP_MAX_SAMPLES,
  TRAFFIC_SWEEP_MAX_STEP_M,
  TRAFFIC_SWEEP_NEAR_M,
} from '../../config.ts'

/** The measured case that motivated the sweep: 90 km/h player, 80 km/h oncoming. */
const ONCOMING_PER_FRAME = trafficClosingPerFrame(90, 80, true, 1000 / 60)
/** Same-direction traffic 20 km/h slower — the case that never had the problem. */
const SAME_DIR_PER_FRAME = trafficClosingPerFrame(90, 70, false, 1000 / 60)

describe('trafficClosingPerFrame', () => {
  it('adds the speeds head-on and subtracts them in the same direction', () => {
    expect(trafficClosingPerFrame(90, 80, true, 1000)).toBeCloseTo(170 / 3.6, 5)
    expect(trafficClosingPerFrame(90, 70, false, 1000)).toBeCloseTo(20 / 3.6, 5)
  })

  it('reproduces the measured per-frame advance at 60 fps', () => {
    expect(ONCOMING_PER_FRAME).toBeCloseTo(0.787, 3)
    expect(SAME_DIR_PER_FRAME).toBeCloseTo(0.093, 3)
  })

  it('goes negative when the gap is opening, and ignores a negative frame time', () => {
    expect(trafficClosingPerFrame(50, 90, false, 1000)).toBeLessThan(0)
    expect(trafficClosingPerFrame(90, 80, true, -5)).toBe(0)
  })
})

describe('trafficSweepDepths — when nothing is swept', () => {
  it('returns the single current depth beyond the near field', () => {
    const far = TRAFFIC_SWEEP_NEAR_M + 1
    expect(trafficSweepDepths(far, ONCOMING_PER_FRAME)).toEqual([far])
  })

  it('returns one depth for a vehicle that is not approaching', () => {
    expect(trafficSweepDepths(3, 0)).toEqual([3])
    expect(trafficSweepDepths(3, -0.5)).toEqual([3])
  })

  it('costs nothing extra for same-direction traffic', () => {
    // 0,093 m per frame is well under one step, so the old single test stands.
    expect(trafficSweepDepths(3, SAME_DIR_PER_FRAME)).toEqual([3])
  })

  it('survives a non-finite depth or closing rate', () => {
    expect(trafficSweepDepths(Number.NaN, ONCOMING_PER_FRAME)).toEqual([])
    expect(trafficSweepDepths(3, Number.NaN)).toEqual([3])
  })
})

describe('trafficSweepDepths — the oncoming case', () => {
  it('splits the closed gap into steps no larger than the tuned maximum', () => {
    const depths = trafficSweepDepths(3, ONCOMING_PER_FRAME)
    expect(depths.length).toBeGreaterThan(1)

    const worldZPrev = 3 + ONCOMING_PER_FRAME
    let previous = worldZPrev
    for (const d of depths) {
      expect(previous - d).toBeLessThanOrEqual(TRAFFIC_SWEEP_MAX_STEP_M + 1e-9)
      previous = d
    }
  })

  it('ends exactly on the current depth, so the old behaviour is still included', () => {
    const depths = trafficSweepDepths(2.5, ONCOMING_PER_FRAME)
    expect(depths.at(-1)).toBeCloseTo(2.5, 10)
  })

  it('never re-tests the previous frame position', () => {
    const worldZNow = 3
    const depths = trafficSweepDepths(worldZNow, ONCOMING_PER_FRAME)
    expect(depths[0]).toBeLessThan(worldZNow + ONCOMING_PER_FRAME)
  })

  it('orders depths from far to near', () => {
    const depths = trafficSweepDepths(2, ONCOMING_PER_FRAME)
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i]!).toBeLessThan(depths[i - 1]!)
    }
  })

  it('cuts the worst scanline jump from 18 rows to about 5', () => {
    // The projection the game uses: scanline = round(PERSPECTIVE_K / worldZ) - 1.
    const line = (z: number) => Math.round(150 / z) - 1
    // The measured frame is the one that *starts* at three metres and ends short
    // of it, which is where the eighteen-row jump was found.
    const from = 3
    const worldZNow = from - ONCOMING_PER_FRAME
    expect(line(worldZNow) - line(from)).toBe(18) // unswept, for contrast

    let previous = from
    let worst = 0
    for (const d of trafficSweepDepths(worldZNow, ONCOMING_PER_FRAME)) {
      worst = Math.max(worst, line(d) - line(previous))
      previous = d
    }
    expect(worst).toBeLessThanOrEqual(6)
  })
})

describe('trafficSweepDepths — level with the cab', () => {
  it('tests exactly zero when the vehicle passes the player this frame', () => {
    const depths = trafficSweepDepths(-0.3, ONCOMING_PER_FRAME)
    expect(depths).toContain(0)
  })

  it('keeps the far-to-near order when zero is inserted', () => {
    const depths = trafficSweepDepths(-0.3, ONCOMING_PER_FRAME)
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i]!).toBeLessThan(depths[i - 1]!)
    }
  })

  it('does not force a zero when the vehicle is still ahead', () => {
    expect(trafficSweepDepths(1.5, ONCOMING_PER_FRAME)).not.toContain(0)
  })
})

describe('trafficSweepDepths — cost ceiling', () => {
  it('caps the sample count however long the frame was', () => {
    const absurd = trafficSweepDepths(2, 500)
    expect(absurd.length).toBeLessThanOrEqual(TRAFFIC_SWEEP_MAX_SAMPLES + 1)
  })

  it('honours option overrides so the tuning can be tested independently', () => {
    const depths = trafficSweepDepths(3, 1, { maxStepM: 0.5, maxSamples: 8 })
    expect(depths).toHaveLength(2)
  })
})
