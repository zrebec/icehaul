/**
 * Swept sampling for near-field traffic collision.
 *
 * The projection is `scanline = round(PERSPECTIVE_K / worldZ) - 1`, which is the
 * correct inverse perspective and also the reason a single test per frame stops
 * being enough close up: the sprite's screen speed grows without bound as `worldZ`
 * approaches zero, while its world speed stays constant.
 *
 * Measured at 60 fps with an oncoming vehicle (90 + 80 km/h), closing at 47,2 m/s:
 *
 * | worldZ | advance per frame | scanline jump |
 * |-------:|------------------:|--------------:|
 * |    6 m |           0,787 m |     4 riadky  |
 * |    3 m |           0,787 m |  **18 riadkov** |
 * |    2 m |           0,787 m |    13 riadkov |
 *
 * The truck is 64 px tall, so at three metres an oncoming car skipped 28 % of it
 * between two frames — and the whole six-metre collision window held only 7,6
 * frames. Contact was decided by where those few samples happened to land rather
 * than by geometry, which is one defect wearing two faces: an unfair crash, and a
 * near miss that should have been a hit.
 *
 * Same-direction traffic never had the problem (64,8 frames per window, 4 rows at
 * worst), so the sample count is derived from the actual closing rate: the cost
 * rises only where the risk does.
 */
import {
  TRAFFIC_SWEEP_MAX_SAMPLES,
  TRAFFIC_SWEEP_MAX_STEP_M,
  TRAFFIC_SWEEP_NEAR_M,
} from '../config.ts'

/** Overrides exist for tests; the game always uses the tuned constants. */
export interface TrafficSweepOptions {
  nearM?: number
  maxStepM?: number
  maxSamples?: number
}

/**
 * Depth at which a vehicle should be tested this frame, far to near.
 *
 * The last entry is always `worldZNow`, so a caller that ignores sweeping
 * entirely still gets today's behaviour. `worldZPrev` itself is deliberately left
 * out: it was already tested on the previous frame.
 *
 * @param worldZNow        Depth after this frame's movement (metres, may be negative).
 * @param closingMPerFrame How much the gap shrank this frame. Zero or negative
 *                         means the vehicle is not approaching, so one sample is
 *                         all it can need.
 */
export function trafficSweepDepths(
  worldZNow: number,
  closingMPerFrame: number,
  opts: TrafficSweepOptions = {},
): number[] {
  const nearM = opts.nearM ?? TRAFFIC_SWEEP_NEAR_M
  const maxStepM = opts.maxStepM ?? TRAFFIC_SWEEP_MAX_STEP_M
  const maxSamples = opts.maxSamples ?? TRAFFIC_SWEEP_MAX_SAMPLES

  if (!Number.isFinite(worldZNow)) return []
  // Far away the sprite barely moves between frames, and sweeping there would buy
  // precision nobody can see. Receding vehicles cannot close a gap at all.
  if (worldZNow > nearM || !Number.isFinite(closingMPerFrame) || closingMPerFrame <= 0) {
    return [worldZNow]
  }

  const steps = Math.min(
    maxSamples,
    Math.max(1, Math.ceil(closingMPerFrame / Math.max(1e-6, maxStepM))),
  )
  const worldZPrev = worldZNow + closingMPerFrame
  const depths: number[] = []
  for (let k = 1; k <= steps; k++) {
    depths.push(worldZPrev - (closingMPerFrame * k) / steps)
  }

  // Level with the cab is the worst case and the one the player feels most, so it
  // is tested exactly rather than left to wherever the even spacing happens to land.
  if (worldZPrev > 0 && worldZNow < 0 && !depths.includes(0)) {
    const at = depths.findIndex((d) => d < 0)
    depths.splice(at < 0 ? depths.length : at, 0, 0)
  }

  return depths
}

/**
 * How fast the gap to a traffic vehicle is shrinking, in metres per frame.
 *
 * Derived from speeds rather than from a remembered position: `tickTraffic` moves
 * oncoming vehicles by `-speed/3.6 * dt` and the camera forward by `+speed/3.6 * dt`,
 * so the rate is exact and needs no per-vehicle history.
 *
 * @returns Positive when closing, negative when the gap is opening.
 */
export function trafficClosingPerFrame(
  playerSpeedKmh: number,
  vehicleSpeedKmh: number,
  oncoming: boolean,
  dtMs: number,
): number {
  const relKmh = oncoming ? playerSpeedKmh + vehicleSpeedKmh : playerSpeedKmh - vehicleSpeedKmh
  return (relKmh / 3.6) * (Math.max(0, dtMs) / 1000)
}
