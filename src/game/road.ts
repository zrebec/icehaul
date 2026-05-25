import {
  type Surface,
  SURFACE_GRIP, SURFACE_ACCEL, SURFACE_PROBABILITY,
  SEGMENT_LENGTH_M, CURVATURE_RANGE, STRAIGHT_SEGMENT_PCT,
  ICE_AHEAD_LOOK_M,
} from '../config.ts'

export type { Surface }

function hash(n: number): number {
  let x = (n + 0x9E3779B9) | 0
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B)
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35)
  x = x ^ (x >>> 16)
  return (x >>> 0) / 0x100000000
}

const SURFACE_ORDER: Surface[] = ['asphalt', 'snow', 'ice', 'sand', 'mud']

/** Pick a surface from the weighted probability table. */
function pickSurface(h: number): Surface {
  let acc = 0
  for (const s of SURFACE_ORDER) {
    acc += SURFACE_PROBABILITY[s]
    if (h < acc) return s
  }
  return 'asphalt'
}

export function getSurfaceAt(distanceMeters: number, seed = 0): Surface {
  const segIdx = Math.floor(distanceMeters / SEGMENT_LENGTH_M)
  return pickSurface(hash(segIdx + seed * 1009))
}

export function gripFor(surface: Surface): number {
  return SURFACE_GRIP[surface]
}

export function accelFor(surface: Surface): number {
  return SURFACE_ACCEL[surface]
}

/**
 * Returns true when current surface is safe but a dangerous surface
 * (ice, sand, mud) is approaching within look-ahead distance.
 */
export function isDangerAhead(currentDist: number): Surface | null {
  const current = getSurfaceAt(currentDist)
  if (current !== 'asphalt') return null
  const ahead = getSurfaceAt(currentDist + ICE_AHEAD_LOOK_M)
  return ahead !== 'asphalt' ? ahead : null
}

function segmentCurvature(segIdx: number): number {
  const h = hash(segIdx * 3 + 7)
  if (h < STRAIGHT_SEGMENT_PCT) return 0
  return (h - 0.5) * CURVATURE_RANGE
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

export function getCurvatureAt(distM: number): number {
  const segIdx = Math.floor(distM / SEGMENT_LENGTH_M)
  const segFrac = (distM % SEGMENT_LENGTH_M) / SEGMENT_LENGTH_M
  const c0 = segmentCurvature(segIdx)
  const c1 = segmentCurvature(segIdx + 1)
  return c0 + (c1 - c0) * smoothstep(segFrac)
}
