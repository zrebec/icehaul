import {
  type Surface,
  SURFACE_GRIP, SURFACE_ACCEL, SURFACE_PROBABILITY, SURFACE_LENGTH_RANGE,
  RECOVERY_ASPHALT_PCT, RECOVERY_ASPHALT_RANGE, START_ASPHALT_M, SURFACE_TRANSITION_M,
  ICE_AHEAD_LOOK_M,
  CURVE_INTENSITY_RANGE, STRAIGHT_LENGTH_RANGE, TURN_LENGTH_RANGE, TURN_RAMP_M,
  SAFE_ENTRY_STRAIGHT_M, SAFE_ENTRY_SEARCH_LIMIT_M,
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

let _segments: RoadSegment[] = []
let _generatedUpTo = 0
let _lastWasSpecial = false
let _seed = 0
/**
 * Counts *decisions*, not segments — the hash input for every roll below.
 *
 * These are the same number until a hazard has to be pushed forward onto a
 * straight and an asphalt filler is inserted ahead of it. Keying the rolls off
 * `_segments.length` would let that filler shift every later roll, so one
 * inserted segment reshuffles the whole remaining route and a seed stops meaning
 * what it meant. Seeds are how routes are reported, reproduced and playtested,
 * so the roll sequence has to survive the constraint: a given seed keeps its
 * exact surface order and lengths, and the constraint only moves where they sit.
 */
let _rollIdx = 0

/** Reset all road state with a new seed. Call at game start. */
export function resetRoad(seed: number): void {
  _seed = seed
  _segments = []
  _generatedUpTo = 0
  _lastWasSpecial = false
  _rollIdx = 0
  _curves = []
  _curvesUpTo = 0
}

function ensureGenerated(upToDist: number): void {
  while (_generatedUpTo < upToDist + 500) {
    const idx = _rollIdx
    if (idx === 0) {
      _segments.push({ start: 0, end: START_ASPHALT_M, surface: 'asphalt' })
      _generatedUpTo = START_ASPHALT_M
      _lastWasSpecial = false
      _rollIdx++
      continue
    }

    // After a special surface → recovery asphalt (85% chance)
    if (_lastWasSpecial && hash(idx * 53 + 7 + _seed) < RECOVERY_ASPHALT_PCT) {
      const [minL, maxL] = RECOVERY_ASPHALT_RANGE
      const length = minL + (maxL - minL) * hash(idx * 37 + 19 + _seed)
      _segments.push({ start: _generatedUpTo, end: _generatedUpTo + length, surface: 'asphalt' })
      _generatedUpTo += length
      _lastWasSpecial = false
      _rollIdx++
      continue
    }

    // Normal segment
    const surface = pickSurface(hash(idx * 17 + 3 + _seed))
    const [minLen, maxLen] = SURFACE_LENGTH_RANGE[surface]
    const length = minLen + (maxLen - minLen) * hash(idx * 31 + 11 + _seed)

    // A hazard must not begin inside a bend — see SAFE_ENTRY_STRAIGHT_M. This is
    // the only place the two generators talk to each other; the curve chain is
    // queried, never modified, so its own sequence stays independent of surfaces.
    if (surface !== 'asphalt') {
      const entry = nextStraightStart(_generatedUpTo, SAFE_ENTRY_STRAIGHT_M)
      if (entry > _generatedUpTo) {
        // Pave the gap, then start the hazard on the straight. Both segments are
        // pushed in the same iteration deliberately: re-entering the loop would
        // re-roll `surface` against a new idx and discard the decision we just
        // made, so the constraint would silently turn into a reshuffle.
        _segments.push({ start: _generatedUpTo, end: entry, surface: 'asphalt' })
      }
      _segments.push({ start: entry, end: entry + length, surface })
      _generatedUpTo = entry + length
      _lastWasSpecial = true
      _rollIdx++
      continue
    }

    _segments.push({ start: _generatedUpTo, end: _generatedUpTo + length, surface })
    _generatedUpTo += length
    _lastWasSpecial = false
    _rollIdx++
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

/**
 * Grip at a point, blended across segment boundaries over
 * {@link SURFACE_TRANSITION_M} centred on the seam — see that constant for why.
 *
 * Deliberately NOT `gripFor(getSurfaceAt(d))`: surface identity stays a hard
 * edge (visuals, drag, fuel, audio all key off it), only the number moves.
 */
export function getGripAt(distanceMeters: number): number {
  if (distanceMeters < 0) return SURFACE_GRIP.asphalt

  const half = SURFACE_TRANSITION_M / 2
  ensureGenerated(distanceMeters + half)

  let i = -1
  for (let k = _segments.length - 1; k >= 0; k--) {
    if (distanceMeters >= _segments[k]!.start) { i = k; break }
  }
  if (i < 0) return SURFACE_GRIP.asphalt

  const seg = _segments[i]!
  const here = SURFACE_GRIP[seg.surface]

  // Entering: blend up from the previous segment. The first segment has no
  // predecessor, so it starts flat.
  if (i > 0 && distanceMeters < seg.start + half) {
    const prev = SURFACE_GRIP[_segments[i - 1]!.surface]
    const t = (distanceMeters - (seg.start - half)) / SURFACE_TRANSITION_M
    return prev + (here - prev) * smoothstep(Math.max(0, Math.min(1, t)))
  }

  // Leaving: blend down into the next segment.
  const next = _segments[i + 1]
  if (next && distanceMeters > seg.end - half) {
    const there = SURFACE_GRIP[next.surface]
    const t = (distanceMeters - (seg.end - half)) / SURFACE_TRANSITION_M
    return here + (there - here) * smoothstep(Math.max(0, Math.min(1, t)))
  }

  return here
}

/** Warn when a different dangerous surface is approaching. No warning when already on it. */
export function isDangerAhead(currentDist: number): Surface | null {
  const current = getSurfaceAt(currentDist)
  const ahead = getSurfaceAt(currentDist + ICE_AHEAD_LOOK_M)
  if (ahead === 'asphalt') return null
  if (ahead === current) return null
  return ahead
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

let _curves: CurveSection[] = []
let _curvesUpTo = 0

function ensureCurvesGenerated(upToDist: number): void {  // uses _seed from module scope
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
        const straightLen = minS + (maxS - minS) * hash(idx * 41 + 5 + _seed)
        _curves.push({ start: _curvesUpTo, end: _curvesUpTo + straightLen, curvature: 0, type: 'straight' })
        _curvesUpTo += straightLen
        continue
      }

      // After a straight → rampIn to a turn
      const [minI, maxI] = CURVE_INTENSITY_RANGE
      const intensity = minI + (maxI - minI) * hash(idx * 59 + 13 + _seed)
      const direction = hash(idx * 73 + 29 + _seed) < 0.5 ? -1 : 1
      const curvature = intensity * direction

      _curves.push({ start: _curvesUpTo, end: _curvesUpTo + TURN_RAMP_M, curvature, type: 'rampIn' })
      _curvesUpTo += TURN_RAMP_M
      continue
    }

    if (prev.type === 'rampIn') {
      // rampIn → full turn
      const [minT, maxT] = TURN_LENGTH_RANGE
      const turnLen = minT + (maxT - minT) * hash(idx * 47 + 17 + _seed)
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

/**
 * Earliest distance at or after `fromDist` with at least `minLen` metres of
 * zero curvature ahead of it. Falls back to `fromDist` if nothing qualifies
 * inside {@link SAFE_ENTRY_SEARCH_LIMIT_M}.
 *
 * Read-only with respect to the curve chain: it extends generation but never
 * alters what was generated, so adding this coupling does not change the curve
 * sequence a seed produces.
 */
function nextStraightStart(fromDist: number, minLen: number): number {
  // Config-driven off switch, in the same spirit as GEARS[].maxSpeedToShift:
  // SAFE_ENTRY_STRAIGHT_M = 0 drops the constraint entirely and restores the
  // original independent generators, which is also how the A/B is measured.
  if (minLen <= 0) return fromDist

  const limit = fromDist + SAFE_ENTRY_SEARCH_LIMIT_M
  ensureCurvesGenerated(limit + minLen)

  for (const sec of _curves) {
    if (sec.type !== 'straight') continue
    if (sec.end <= fromDist) continue
    const start = Math.max(sec.start, fromDist)
    if (start > limit) break
    if (sec.end - start >= minLen) return start
  }
  return fromDist
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
