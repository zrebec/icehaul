import {
  type Surface,
  SURFACE_GRIP, SURFACE_ACCEL, SURFACE_PROBABILITY, SURFACE_LENGTH_RANGE,
  SEGMENT_LENGTH_M, CURVATURE_RANGE, STRAIGHT_SEGMENT_PCT,
  ICE_AHEAD_LOOK_M, START_ASPHALT_M,
} from '../config.ts'

export type { Surface }

function hash(n: number): number {
  let x = (n + 0x9E3779B9) | 0
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B)
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35)
  x = x ^ (x >>> 16)
  return (x >>> 0) / 0x100000000
}

// ── Variable-length road segments ───────────────────────────────────────────

interface RoadSegment {
  start: number
  end: number
  surface: Surface
}

const SURFACE_ORDER: Surface[] = ['asphalt', 'snow', 'ice', 'sand', 'mud']

function pickSurface(h: number): Surface {
  let acc = 0
  for (const s of SURFACE_ORDER) {
    acc += SURFACE_PROBABILITY[s]
    if (h < acc) return s
  }
  return 'asphalt'
}

const _segments: RoadSegment[] = []
let _generatedUpTo = 0

function ensureGenerated(upToDist: number): void {
  while (_generatedUpTo < upToDist + 500) {
    if (_segments.length === 0) {
      _segments.push({ start: 0, end: START_ASPHALT_M, surface: 'asphalt' })
      _generatedUpTo = START_ASPHALT_M
    } else {
      const idx = _segments.length
      const surface = pickSurface(hash(idx * 17 + 3))
      const [minLen, maxLen] = SURFACE_LENGTH_RANGE[surface]
      const length = minLen + (maxLen - minLen) * hash(idx * 31 + 11)
      _segments.push({ start: _generatedUpTo, end: _generatedUpTo + length, surface })
      _generatedUpTo += length
    }
  }
}

export function getSurfaceAt(distanceMeters: number, _seed = 0): Surface {
  if (distanceMeters < 0) return 'asphalt'
  ensureGenerated(distanceMeters)
  for (let i = _segments.length - 1; i >= 0; i--) {
    const seg = _segments[i]!
    if (distanceMeters >= seg.start) return seg.surface
  }
  return 'asphalt'
}

export function gripFor(surface: Surface): number {
  return SURFACE_GRIP[surface]
}

export function accelFor(surface: Surface): number {
  return SURFACE_ACCEL[surface]
}

export function isDangerAhead(currentDist: number): Surface | null {
  const current = getSurfaceAt(currentDist)
  if (current === 'asphalt') {
    const ahead = getSurfaceAt(currentDist + ICE_AHEAD_LOOK_M)
    return ahead !== 'asphalt' ? ahead : null
  }
  return null
}

// ── Curvature (fixed grid, independent of surface segments) ─────────────────

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
