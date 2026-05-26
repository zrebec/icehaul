import {
  CANISTER_SPACING_M, CANISTER_SPACING_JITTER, CANISTER_X_RANGE,
  CANISTER_FUEL, CANISTER_PICKUP_RADIUS, CANISTER_PICKUP_DEPTH_M,
} from '../config.ts'

export interface Canister {
  /** Absolute world distance along the road (metres). */
  distM: number
  /** Lateral position: -1..+1 (0=centre, ±1=edge). */
  x: number
  /** Has this canister been collected? */
  collected: boolean
}

function hash(n: number): number {
  let x = (n + 0x9E3779B9) | 0
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B)
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35)
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000
}

let _canisters: Canister[] = []
let _nextSpawnDist = 400
let _seed = 0

export function resetCanisters(seed: number): void {
  _seed = seed
  _canisters = []
  _nextSpawnDist = 400
}

/**
 * Ensures canisters are generated up to `upToDist`.
 * Each canister has a random lateral position — some in centre (easy),
 * some near the edge (risky), occasionally on the kerb line (very risky).
 */
function ensureCanisters(upToDist: number): void {
  while (_nextSpawnDist < upToDist + 200) {
    const idx = _canisters.length
    const h1 = hash(idx * 67 + 13 + _seed)
    const h2 = hash(idx * 43 + 29 + _seed)

    const x = (h1 * 2 - 1) * CANISTER_X_RANGE  // -0.9..+0.9

    _canisters.push({ distM: _nextSpawnDist, x, collected: false })

    const jitter = 1 + (h2 * 2 - 1) * CANISTER_SPACING_JITTER
    _nextSpawnDist += CANISTER_SPACING_M * jitter
  }
}

/**
 * Check for canister pickup. Returns fuel gained (0 if no pickup).
 * Call once per frame with the truck's current position.
 */
export function checkCanisterPickup(truckDist: number, truckX: number): number {
  ensureCanisters(truckDist + 200)

  let fuelGained = 0
  for (const c of _canisters) {
    if (c.collected) continue
    if (c.distM < truckDist - 50) { c.collected = true; continue } // passed, gone
    // Pickup only when truck has REACHED or PASSED the canister (not before it)
    const ahead = c.distM - truckDist
    if (ahead > CANISTER_PICKUP_DEPTH_M) continue  // still ahead, too far
    if (ahead < -CANISTER_PICKUP_DEPTH_M) continue  // too far behind
    const dx = Math.abs(c.x - truckX)
    if (ahead <= 0 && dx < CANISTER_PICKUP_RADIUS) {
      c.collected = true
      fuelGained += CANISTER_FUEL
    }
  }
  return fuelGained
}

/**
 * Returns uncollected canisters within visible range for rendering.
 * `cameraDist` = truck's current distance.
 * `visibleRange` = how far ahead is visible (world metres to horizon).
 */
export function getVisibleCanisters(cameraDist: number, visibleRange: number): readonly Canister[] {
  ensureCanisters(cameraDist + visibleRange + 100)
  const result: Canister[] = []
  for (const c of _canisters) {
    if (c.collected) continue
    if (c.distM < cameraDist - 10) continue
    if (c.distM > cameraDist + visibleRange) break
    result.push(c)
  }
  return result
}
