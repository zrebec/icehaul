import {
  type Surface,
  SURFACE_GRIP, SURFACE_ACCEL, SURFACE_PROBABILITY, SURFACE_LENGTH_RANGE,
  RECOVERY_ASPHALT_PCT, RECOVERY_ASPHALT_RANGE, START_ASPHALT_M,
  ICE_AHEAD_LOOK_M,
  CURVE_INTENSITY_RANGE, STRAIGHT_LENGTH_RANGE, TURN_LENGTH_RANGE, TURN_RAMP_M,
} from '../config.ts'

export type { Surface }

function hash(n: number): number {
  let x = (n + 0x9E3779B9) | 0
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B)
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35)
  x = x ^ (x >>> 16)
  return (x >>> 0) / 0x100000000
}

// ── Surface segments (variable length, recovery asphalt) ────────────────────

interface RoadSegment { start: number; end: number; surface: Surface }

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
let _lastWasSpecial = false

function ensureGenerated(upToDist: number): void {
  while (_generatedUpTo < upToDist + 500) {
    const idx = _segments.length
    if (idx === 0) {
      _segments.push({ start: 0, end: START_ASPHALT_M, surface: 'asphalt' })
      _generatedUpTo = START_ASPHALT_M
      _lastWasSpecial = false
      continue
    }

    // After a special surface → recovery asphalt (85% chance)
    if (_lastWasSpecial && hash(idx * 53 + 7) < RECOVERY_ASPHALT_PCT) {
      const [minL, maxL] = RECOVERY_ASPHALT_RANGE
      const length = minL + (maxL - minL) * hash(idx * 37 + 19)
      _segments.push({ start: _generatedUpTo, end: _generatedUpTo + length, surface: 'asphalt' })
      _generatedUpTo += length
      _lastWasSpecial = false
      continue
    }

    // Normal segment
    const surface = pickSurface(hash(idx * 17 + 3))
    const [minLen, maxLen] = SURFACE_LENGTH_RANGE[surface]
    const length = minLen + (maxLen - minLen) * hash(idx * 31 + 11)
    _segments.push({ start: _generatedUpTo, end: _generatedUpTo + length, surface })
    _generatedUpTo += length
    _lastWasSpecial = surface !== 'asphalt'
  }
}

export function getSurfaceAt(distanceMeters: number, _seed = 0): Surface {
  if (distanceMeters < 0) return 'asphalt'
  ensureGenerated(distanceMeters)
  for (let i = _segments.length - 1; i >= 0; i--) {
    if (distanceMeters >= _segments[i]!.start) return _segments[i]!.surface
  }
  return 'asphalt'
}

export function gripFor(surface: Surface): number { return SURFACE_GRIP[surface] }
export function accelFor(surface: Surface): number { return SURFACE_ACCEL[surface] }

export function isDangerAhead(currentDist: number): Surface | null {
  const current = getSurfaceAt(currentDist)
  if (current === 'asphalt') {
    const ahead = getSurfaceAt(currentDist + ICE_AHEAD_LOOK_M)
    return ahead !== 'asphalt' ? ahead : null
  }
  return null
}

// ── Curvature pattern: straight → ramp → turn → ramp → straight ────────────

interface CurveSection {
  start: number
  end: number
  /** 0 = straight, non-zero = full curvature (negative=left, positive=right). */
  curvature: number
  /** 'straight' | 'rampIn' | 'turn' | 'rampOut' */
  type: 'straight' | 'rampIn' | 'turn' | 'rampOut'
}

const _curves: CurveSection[] = []
let _curvesUpTo = 0

function ensureCurvesGenerated(upToDist: number): void {
  while (_curvesUpTo < upToDist + 500) {
    const idx = _curves.length

    if (idx === 0) {
      const len = 200
      _curves.push({ start: 0, end: len, curvature: 0, type: 'straight' })
      _curvesUpTo = len
      continue
    }

    const prev = _curves[idx - 1]!

    if (prev.type === 'straight' || prev.type === 'rampOut') {
      // After a straight or ramp-out → start a new turn sequence
      // First: straight section
      if (prev.type === 'rampOut') {
        const [minS, maxS] = STRAIGHT_LENGTH_RANGE
        const straightLen = minS + (maxS - minS) * hash(idx * 41 + 5)
        _curves.push({ start: _curvesUpTo, end: _curvesUpTo + straightLen, curvature: 0, type: 'straight' })
        _curvesUpTo += straightLen
        continue
      }

      // After a straight → rampIn to a turn
      const [minI, maxI] = CURVE_INTENSITY_RANGE
      const intensity = minI + (maxI - minI) * hash(idx * 59 + 13)
      const direction = hash(idx * 73 + 29) < 0.5 ? -1 : 1
      const curvature = intensity * direction

      _curves.push({ start: _curvesUpTo, end: _curvesUpTo + TURN_RAMP_M, curvature, type: 'rampIn' })
      _curvesUpTo += TURN_RAMP_M
      continue
    }

    if (prev.type === 'rampIn') {
      // rampIn → full turn
      const [minT, maxT] = TURN_LENGTH_RANGE
      const turnLen = minT + (maxT - minT) * hash(idx * 47 + 17)
      _curves.push({ start: _curvesUpTo, end: _curvesUpTo + turnLen, curvature: prev.curvature, type: 'turn' })
      _curvesUpTo += turnLen
      continue
    }

    if (prev.type === 'turn') {
      // turn → rampOut
      _curves.push({ start: _curvesUpTo, end: _curvesUpTo + TURN_RAMP_M, curvature: prev.curvature, type: 'rampOut' })
      _curvesUpTo += TURN_RAMP_M
      continue
    }
  }
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

export function getCurvatureAt(distM: number): number {
  if (distM < 0) return 0
  ensureCurvesGenerated(distM)

  for (let i = _curves.length - 1; i >= 0; i--) {
    const sec = _curves[i]!
    if (distM < sec.start) continue

    switch (sec.type) {
      case 'straight':
        return 0
      case 'turn':
        return sec.curvature
      case 'rampIn': {
        const t = (distM - sec.start) / (sec.end - sec.start)
        return sec.curvature * smoothstep(Math.min(1, t))
      }
      case 'rampOut': {
        const t = (distM - sec.start) / (sec.end - sec.start)
        return sec.curvature * (1 - smoothstep(Math.min(1, t)))
      }
    }
  }
  return 0
}
