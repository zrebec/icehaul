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
  TRAFFIC_COLLISION_RADIUS_CAR, TRAFFIC_COLLISION_RADIUS_TRUCK,
  TRAFFIC_COLLISION_DEPTH_M, TRAFFIC_START_M,
} from '../config.ts'

export type TrafficDir = 'same' | 'oncoming'
export type VehicleType = 'car' | 'truck'

export interface TrafficVehicle {
  /** Absolute world distance when spawned (metres). */
  spawnDist: number
  /** Current world distance (moves for oncoming, static-relative for same-dir). */
  distM: number
  /** Lateral position: -0.6..+0.6 (stays in lane). */
  x: number
  /** Speed in km/h. */
  speed: number
  dir: TrafficDir
  type: VehicleType
  /** Marked when passed or off-screen. */
  gone: boolean
}

function hash(n: number): number {
  let x = (n + 0x9E3779B9) | 0
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B)
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35)
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000
}

let _vehicles: TrafficVehicle[] = []
let _nextSpawnDist = TRAFFIC_START_M
let _seed = 0

export function resetTraffic(seed: number): void {
  _seed = seed
  _vehicles = []
  _nextSpawnDist = TRAFFIC_START_M
}

function spawnVehicle(): void {
  const idx = _vehicles.length
  const h1 = hash(idx * 59 + 7 + _seed)
  const h2 = hash(idx * 73 + 13 + _seed)
  const h3 = hash(idx * 41 + 29 + _seed)
  const h4 = hash(idx * 97 + 37 + _seed)

  const dir: TrafficDir = h1 < TRAFFIC_SAME_DIR_PCT ? 'same' : 'oncoming'
  const type: VehicleType = h2 < 0.7 ? 'car' : 'truck'

  let speed: number
  let x: number
  if (dir === 'same') {
    const [minS, maxS] = TRAFFIC_SAME_SPEED
    speed = minS + (maxS - minS) * h3
    // Same-direction: random lane (centre to slight right)
    x = -0.2 + h4 * 0.5
  } else {
    const [minS, maxS] = TRAFFIC_ONCOMING_SPEED
    speed = minS + (maxS - minS) * h3
    // Oncoming: opposite side (left half of road)
    x = -0.6 + h4 * 0.4
  }

  _vehicles.push({
    spawnDist: _nextSpawnDist,
    distM: _nextSpawnDist,
    x, speed, dir, type, gone: false,
  })

  const jitter = 1 + (hash(idx * 83 + 19 + _seed) * 2 - 1) * TRAFFIC_SPACING_JITTER
  _nextSpawnDist += TRAFFIC_SPACING_M * jitter
}

/**
 * Update traffic positions. Call each frame.
 * Returns 'crash' if player collided with a vehicle, null otherwise.
 */
export function tickTraffic(
  playerDist: number,
  playerX: number,
  playerSpeed: number,
  dtMs: number,
): 'crash' | null {
  const dt = dtMs / 1000

  // Ensure vehicles are spawned ahead
  while (_nextSpawnDist < playerDist + 500) {
    spawnVehicle()
  }

  let crashed = false

  for (const v of _vehicles) {
    if (v.gone) continue

    // Move vehicles
    if (v.dir === 'same') {
      // Same-direction vehicles move forward at their own speed
      v.distM += (v.speed / 3.6) * dt
    } else {
      // Oncoming vehicles approach from ahead (move toward player)
      v.distM -= (v.speed / 3.6) * dt
    }

    // Clean up vehicles far behind
    if (v.distM < playerDist - 100) {
      v.gone = true
      continue
    }

    // Collision check — radius matches visual sprite size
    const dz = v.distM - playerDist
    if (Math.abs(dz) < TRAFFIC_COLLISION_DEPTH_M) {
      const dx = Math.abs(v.x - playerX)
      const collisionW = v.type === 'truck' ? TRAFFIC_COLLISION_RADIUS_TRUCK : TRAFFIC_COLLISION_RADIUS_CAR
      if (dx < collisionW) {
        crashed = true
      }
    }
  }

  return crashed ? 'crash' : null
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
