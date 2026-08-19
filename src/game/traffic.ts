/**
 * Traffic system — vehicles in both directions.
 *
 * Same-direction: slower vehicles you must overtake (shift laterally).
 * Oncoming: fast vehicles on the other side — dodge or crash.
 * Collision = game over.
 */
import {
  TRAFFIC_SPACING_M, TRAFFIC_SPACING_JITTER,
  TRAFFIC_SAME_DIR_PCT, TRAFFIC_SAME_SPEED, TRAFFIC_ONCOMING_SPEED,
  TRAFFIC_START_M, TRAFFIC_MIN_SPAWN_GAP_M,
  TRAFFIC_FOLLOW_BRAKE_KMH_S,
  TRAFFIC_CAUTION_RANGE, TRAFFIC_VIGOUR_RANGE,
  TRAFFIC_PLAN_INTERVAL_MS, TRAFFIC_BRAKE_LAMP_HOLD_MS,
} from '../config.ts'
import {
  chooseTargetKph, followTargetKph, stepSpeed, type Obstacle,
} from './trafficDriver.ts'
import type { RoadSampler } from './safespeed.ts'
import type { LodTier } from '../render/vehicleLod.ts'

export type TrafficDir = 'same' | 'oncoming'
export type VehicleType = 'mini' | 'car' | 'bus'

export interface TrafficVehicle {
  /** Absolute world distance when spawned (metres). */
  spawnDist: number
  /** Current world distance (moves for oncoming, static-relative for same-dir). */
  distM: number
  /** Lateral position: -0.6..+0.6 (stays in lane). */
  x: number
  /** Speed in km/h — what it is doing now. */
  speed: number
  dir: TrafficDir
  type: VehicleType
  /** Marked when passed or off-screen. */
  gone: boolean
  /**
   * Lamps lit — same-direction vehicles only. Set from the pedal work in
   * `trafficDriver.ts` and held for `TRAFFIC_BRAKE_LAMP_HOLD_MS` after it stops,
   * the way a driver does not release the moment they are down to speed. Drives
   * the brake lights, which are a raster change and not just a glow: with
   * `?glow=0` the colour swap is all there is.
   */
  braking?: boolean
  /**
   * Level of detail drawn last frame. Lives on the vehicle because the choice is
   * hysteretic — see `render/vehicleLod.ts`. Absent until first projected.
   */
  lodTier?: LodTier
}

/**
 * A vehicle the simulation owns: everything the renderer sees, plus how it
 * drives.
 *
 * Split from {@link TrafficVehicle} rather than piled onto it because the two
 * are wanted by different halves of the game. The renderer, the glow, the LOD
 * choice and the collision check need a position, a size and a lamp state, and
 * nothing about a driver's nerve — which is also why a dozen render tests can go
 * on building a vehicle out of six obvious fields without being asked to invent
 * a caution factor for it.
 */
export interface DrivenVehicle extends TrafficVehicle {
  /**
   * The speed it wants, as drawn at spawn. Split from `speed` because until
   * traffic learned to brake, a vehicle the follow guard slowed never got its
   * speed back: nothing in the model ever raised it again.
   */
  cruise: number
  /** Drawn once at spawn — see `TRAFFIC_CAUTION_RANGE`. */
  caution: number
  /** Drawn once at spawn — see `TRAFFIC_VIGOUR_RANGE`. */
  vigour: number
  /** ms until this vehicle re-reads the road; staggered so they do not all plan
   *  on the same frame. */
  planMs: number
  /** Last computed target speed, km/h. Applied every frame, recomputed rarely. */
  targetKph: number
  /** ms the brake lamp still has to stay lit — see `TRAFFIC_BRAKE_LAMP_HOLD_MS`. */
  brakeLampMs: number
}

function hash(n: number): number {
  let x = (n + 0x9E3779B9) | 0
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B)
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35)
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000
}

let _vehicles: DrivenVehicle[] = []
let _nextSpawnDist = TRAFFIC_START_M
let _seed = 0

export function resetTraffic(seed: number): void {
  _seed = seed
  _vehicles = []
  _nextSpawnDist = TRAFFIC_START_M
}

/**
 * Rear-end guard: same-direction traffic closing on the player from behind.
 *
 * Kept as its own entry point because it is the one piece of traffic behaviour
 * with a direct fairness argument behind it — it stops the truck being rammed
 * when it slows hard on snow, sand or mud — and because it is worth being able
 * to test that argument on its own. The decision inside it is now the shared
 * one from `trafficDriver.ts`; only the emergency rate is local.
 */
export function followPlayerSpeed(
  trafficDist: number,
  trafficSpeed: number,
  playerDist: number,
  playerSpeed: number,
  dtMs: number,
): number {
  const target = followTargetKph(playerDist - trafficDist, trafficSpeed, playerSpeed)
  if (target >= trafficSpeed) return trafficSpeed

  const dt = Math.max(0, dtMs / 1000)
  return Math.max(target, trafficSpeed - TRAFFIC_FOLLOW_BRAKE_KMH_S * dt)
}

function spawnVehicle(): void {
  const idx = _vehicles.length
  const h1 = hash(idx * 59 + 7 + _seed)
  const h2 = hash(idx * 73 + 13 + _seed)
  const h3 = hash(idx * 41 + 29 + _seed)
  const h4 = hash(idx * 97 + 37 + _seed)

  const dir: TrafficDir = h1 < TRAFFIC_SAME_DIR_PCT ? 'same' : 'oncoming'
  const type: VehicleType = h2 < 0.38 ? 'mini' : h2 < 0.78 ? 'car' : 'bus'

  let speed: number
  let x: number
  if (dir === 'same') {
    const [minS, maxS] = TRAFFIC_SAME_SPEED
    speed = minS + (maxS - minS) * h3
    // Same-direction: the right lane, spread about its centre.
    //
    // This used to be `-0.2 + h4 * 0.5` — range [-0.20, +0.30], centred on
    // +0.05, which is the *centre line*, not a lane. `vehicle.x = ±1` is the
    // road edge (`road3d.ts:389`), so the right lane's centre is +0.50, and a
    // bus at the old median put 44% of its body in the oncoming lane at 25 m.
    // No width curve could make that read as "in its lane".
    //
    // The rewrite consumes the same `h4` roll, so the roll sequence is untouched
    // and the seed catalogue in AGENTS.md still names the same routes.
    x = 0.30 + h4 * 0.40  // range [+0.30, +0.70]
  } else {
    const [minS, maxS] = TRAFFIC_ONCOMING_SPEED
    speed = minS + (maxS - minS) * h3
    // Oncoming: clearly in the left lane — player must drift to collide
    x = -0.6 + h4 * 0.3  // range [-0.6, -0.3]
  }

  // Two more rolls, on multipliers nothing else uses, so every existing draw
  // lands exactly where it did: positions, types and cruise speeds are unchanged
  // on every seed and the catalogue in AGENTS.md still names the same routes.
  const h5 = hash(idx * 101 + 43 + _seed)
  const h6 = hash(idx * 103 + 53 + _seed)
  const [minC, maxC] = TRAFFIC_CAUTION_RANGE
  const [minV, maxV] = TRAFFIC_VIGOUR_RANGE

  // Never on top of something already there. The scan repeats because clearing
  // one vehicle can put the spot inside the next; three passes covers any
  // realistic cluster and cannot loop for ever.
  let at = _nextSpawnDist
  for (let pass = 0; pass < 3; pass++) {
    let moved = false
    for (const other of _vehicles) {
      if (other.gone || other.dir !== dir) continue
      if (Math.abs(other.distM - at) < TRAFFIC_MIN_SPAWN_GAP_M) {
        at = other.distM + TRAFFIC_MIN_SPAWN_GAP_M
        moved = true
      }
    }
    if (!moved) break
  }

  _vehicles.push({
    spawnDist: at,
    distM: at,
    x, speed, dir, type, gone: false,
    cruise: speed,
    caution: minC + (maxC - minC) * h5,
    vigour: minV + (maxV - minV) * h6,
    // Staggered, so a dozen vehicles do not all re-read the road on one frame.
    planMs: (idx % 6) * (TRAFFIC_PLAN_INTERVAL_MS / 6),
    targetKph: speed,
    brakeLampMs: 0,
  })

  const jitter = 1 + (hash(idx * 83 + 19 + _seed) * 2 - 1) * TRAFFIC_SPACING_JITTER
  _nextSpawnDist += TRAFFIC_SPACING_M * jitter
}

/**
 * Update traffic vehicle positions each frame.
 *
 * Same-direction vehicles drive: they read the road ahead through `road`, they
 * queue behind whatever is in front of them (another vehicle, or the player),
 * and they light their lamps when they brake. The decisions all live in
 * `trafficDriver.ts`; this function owns the state and the bookkeeping.
 *
 * `road` is optional. Without it a vehicle only answers to what is in front of
 * it — which is what every existing caller that has no road wants, and keeps the
 * anticipation out of tests that are about something else.
 *
 * Collision is detected separately using a pixel-perfect screen-space check in
 * drive.ts.
 */
export function tickTraffic(
  playerDist: number,
  playerX: number,
  playerSpeed: number,
  dtMs: number,
  road?: RoadSampler,
): void {
  const dt = dtMs / 1000

  while (_nextSpawnDist < playerDist + 500) {
    spawnVehicle()
  }

  // Oncoming traffic is deliberately untouched — Fox's call. Whatever it does
  // with its brakes happens behind lamps that face away from the player, so it
  // would be work nobody could see, and slowing it would quietly make the road
  // safer.
  const same: DrivenVehicle[] = []
  for (const v of _vehicles) {
    if (v.gone) continue
    if (v.dir === 'same') { same.push(v); continue }
    v.distM -= (v.speed / 3.6) * dt
    if (v.distM < playerDist - 100) v.gone = true
  }

  // Nearest first, so each vehicle's leader is simply the next one along. Sorted
  // every tick rather than kept in order: same-direction vehicles cruise at
  // anything from 30 to 55 km/h, so spawn order and road order come apart within
  // a couple of kilometres — measured, see `traffic.test.ts`.
  same.sort((a, b) => a.distM - b.distM)

  for (let i = 0; i < same.length; i++) {
    const v = same[i]!

    v.planMs -= dtMs
    if (v.planMs <= 0) {
      v.planMs += TRAFFIC_PLAN_INTERVAL_MS
      const obstacles: Obstacle[] = [{ gapM: playerDist - v.distM, speedKph: playerSpeed }]
      const leader = same[i + 1]
      if (leader) obstacles.push({ gapM: leader.distM - v.distM, speedKph: leader.speed })
      v.targetKph = chooseTargetKph(road ?? null, v.distM, v.speed, v.cruise, v, obstacles)
    }

    const step = stepSpeed(v.speed, v.targetKph, v.cruise, v, dtMs)
    v.speed = step.speedKph
    // Held rather than read raw: a driver does not lift off the pedal the instant
    // they are down to speed, and Fox asked for the lamps to stay on a few metres
    // into the surface they braked for.
    v.brakeLampMs = step.braking
      ? TRAFFIC_BRAKE_LAMP_HOLD_MS
      : Math.max(0, v.brakeLampMs - dtMs)
    v.braking = v.brakeLampMs > 0
    v.distM += (v.speed / 3.6) * dt

    if (v.distM < playerDist - 100) v.gone = true
  }
}

/**
 * Returns vehicles within visible range for rendering.
 */
export function getVisibleTraffic(
  cameraDist: number,
  visibleRange: number,
): readonly TrafficVehicle[] {
  const result: TrafficVehicle[] = []
  for (const v of _vehicles) {
    if (v.gone) continue
    const dz = v.distM - cameraDist
    if (dz < -10 || dz > visibleRange) continue
    result.push(v)
  }
  return result
}
