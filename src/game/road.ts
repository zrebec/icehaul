import {
  ICE_GRIP, SEGMENT_LENGTH_M, ICE_PROBABILITY,
  CURVATURE_RANGE, STRAIGHT_SEGMENT_PCT, ICE_AHEAD_LOOK_M,
} from '../config.ts'

export type Surface = 'asphalt' | 'ice'

function hash(n: number): number {
  let x = (n + 0x9E3779B9) | 0
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B)
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35)
  x = x ^ (x >>> 16)
  return (x >>> 0) / 0x100000000
}

export function getSurfaceAt(distanceMeters: number, seed = 0): Surface {
  const segIdx = Math.floor(distanceMeters / SEGMENT_LENGTH_M)
  return hash(segIdx + seed * 1009) < ICE_PROBABILITY ? 'ice' : 'asphalt'
}

export function gripFor(surface: Surface): number {
  return surface === 'ice' ? ICE_GRIP : 1.0
}

export function isIceAhead(currentDist: number): boolean {
  if (getSurfaceAt(currentDist) === 'ice') return false
  return getSurfaceAt(currentDist + ICE_AHEAD_LOOK_M) === 'ice'
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
