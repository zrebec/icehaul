import { describe, it, expect, beforeEach } from 'vitest'
import { resetRoad, getSurfaceAt, gripFor, getGripAt, accelFor, isDangerAhead, getCurvatureAt } from '../road.ts'
import { START_ASPHALT_M, SURFACE_GRIP, SURFACE_ACCEL, ICE_AHEAD_LOOK_M, SURFACE_TRANSITION_M } from '../../config.ts'

const SEED = 42

beforeEach(() => {
  resetRoad(SEED)
})

describe('resetRoad', () => {
  it('produces deterministic results with same seed', () => {
    const surfaces1: string[] = []
    for (let d = 0; d < 5000; d += 100) surfaces1.push(getSurfaceAt(d))

    resetRoad(SEED)
    const surfaces2: string[] = []
    for (let d = 0; d < 5000; d += 100) surfaces2.push(getSurfaceAt(d))

    expect(surfaces1).toEqual(surfaces2)
  })

  it('different seeds produce different roads', () => {
    const surfaces1: string[] = []
    for (let d = 0; d < 5000; d += 100) surfaces1.push(getSurfaceAt(d))

    resetRoad(SEED + 999)
    const surfaces2: string[] = []
    for (let d = 0; d < 5000; d += 100) surfaces2.push(getSurfaceAt(d))

    expect(surfaces1).not.toEqual(surfaces2)
  })
})

describe('getSurfaceAt', () => {
  it('starts with asphalt', () => {
    expect(getSurfaceAt(0)).toBe('asphalt')
    expect(getSurfaceAt(500)).toBe('asphalt')
  })

  it('first START_ASPHALT_M metres are asphalt', () => {
    for (let d = 0; d < START_ASPHALT_M; d += 50) {
      expect(getSurfaceAt(d)).toBe('asphalt')
    }
  })

  it('eventually encounters non-asphalt surfaces', () => {
    let foundNonAsphalt = false
    for (let d = 0; d < 10000; d += 10) {
      if (getSurfaceAt(d) !== 'asphalt') { foundNonAsphalt = true; break }
    }
    expect(foundNonAsphalt).toBe(true)
  })

  it('negative distance returns asphalt', () => {
    expect(getSurfaceAt(-100)).toBe('asphalt')
  })

  it('returns valid surface type', () => {
    const valid = ['asphalt', 'snow', 'ice', 'sand', 'mud']
    for (let d = 0; d < 10000; d += 100) {
      expect(valid).toContain(getSurfaceAt(d))
    }
  })
})

describe('gripFor / accelFor', () => {
  it('returns correct grip for each surface', () => {
    expect(gripFor('asphalt')).toBe(SURFACE_GRIP.asphalt)
    expect(gripFor('ice')).toBe(SURFACE_GRIP.ice)
    expect(gripFor('snow')).toBe(SURFACE_GRIP.snow)
    expect(gripFor('sand')).toBe(SURFACE_GRIP.sand)
    expect(gripFor('mud')).toBe(SURFACE_GRIP.mud)
  })

  it('returns correct accel for each surface', () => {
    expect(accelFor('asphalt')).toBe(SURFACE_ACCEL.asphalt)
    expect(accelFor('ice')).toBe(SURFACE_ACCEL.ice)
  })

  it('ice has lower grip than asphalt', () => {
    expect(gripFor('ice')).toBeLessThan(gripFor('asphalt'))
  })
})

describe('isDangerAhead', () => {
  it('returns null on initial asphalt stretch', () => {
    expect(isDangerAhead(0)).toBeNull()
    expect(isDangerAhead(100)).toBeNull()
  })

  it('returns surface type when danger approaches from asphalt', () => {
    let firstNonAsphaltDist = -1
    for (let d = 0; d < 10000; d += 5) {
      if (getSurfaceAt(d) !== 'asphalt') { firstNonAsphaltDist = d; break }
    }
    expect(firstNonAsphaltDist).toBeGreaterThan(0)
    const warnDist = firstNonAsphaltDist - ICE_AHEAD_LOOK_M + 5
    if (warnDist > 0 && getSurfaceAt(warnDist) === 'asphalt') {
      const danger = isDangerAhead(warnDist)
      expect(danger).not.toBeNull()
    }
  })

  it('returns null when already on a surface and the same surface is still ahead', () => {
    // Standing in the middle of an ice/snow/etc zone — no warning needed
    let nonAsphaltDist = -1
    for (let d = 0; d < 10000; d += 5) {
      if (getSurfaceAt(d) !== 'asphalt') { nonAsphaltDist = d; break }
    }
    expect(nonAsphaltDist).toBeGreaterThan(0)
    // If ahead is also the same surface, should be silent
    const current = getSurfaceAt(nonAsphaltDist)
    const ahead = getSurfaceAt(nonAsphaltDist + ICE_AHEAD_LOOK_M)
    if (ahead === current) {
      expect(isDangerAhead(nonAsphaltDist)).toBeNull()
    }
  })

  it('warns when approaching a different dangerous surface from a dangerous surface', () => {
    // Find a transition: current = non-asphalt, ahead = different non-asphalt
    // (e.g. snow → dust, ice → mud). Scan a long stretch to find one.
    let warnDist = -1
    let expectedSurface: string | null = null
    for (let d = 0; d < 50000; d += 5) {
      const current = getSurfaceAt(d)
      const ahead = getSurfaceAt(d + ICE_AHEAD_LOOK_M)
      if (current !== 'asphalt' && ahead !== 'asphalt' && ahead !== current) {
        warnDist = d
        expectedSurface = ahead
        break
      }
    }
    if (warnDist >= 0) {
      expect(isDangerAhead(warnDist)).toBe(expectedSurface)
    }
    // If no cross-surface transition found in 50km the test is vacuously fine
  })

  it('returns null when heading back onto asphalt from a dangerous surface', () => {
    // Find a position: current = non-asphalt, ahead = asphalt (exiting the zone)
    for (let d = 0; d < 10000; d += 5) {
      const current = getSurfaceAt(d)
      const ahead = getSurfaceAt(d + ICE_AHEAD_LOOK_M)
      if (current !== 'asphalt' && ahead === 'asphalt') {
        expect(isDangerAhead(d)).toBeNull()
        return
      }
    }
  })
})

describe('getCurvatureAt', () => {
  it('returns 0 for negative distance', () => {
    expect(getCurvatureAt(-50)).toBe(0)
  })

  it('starts with straight road (curvature 0)', () => {
    expect(getCurvatureAt(0)).toBe(0)
    expect(getCurvatureAt(100)).toBe(0)
  })

  it('eventually has non-zero curvature', () => {
    let foundCurve = false
    for (let d = 0; d < 3000; d += 10) {
      if (getCurvatureAt(d) !== 0) { foundCurve = true; break }
    }
    expect(foundCurve).toBe(true)
  })

  it('curvature is deterministic with same seed', () => {
    const c1: number[] = []
    for (let d = 0; d < 3000; d += 50) c1.push(getCurvatureAt(d))

    resetRoad(SEED)
    const c2: number[] = []
    for (let d = 0; d < 3000; d += 50) c2.push(getCurvatureAt(d))

    expect(c1).toEqual(c2)
  })
})

// ─── Grip ramp across surface boundaries ─────────────────────────────────────

describe('getGripAt — blended surface transitions', () => {
  /** First boundary where the surface actually changes, scanning at 1 m. */
  function firstChange(fromM: number, toM: number): { at: number; before: string; after: string } | null {
    let prev = getSurfaceAt(fromM)
    for (let d = fromM + 1; d <= toM; d++) {
      const s = getSurfaceAt(d)
      if (s !== prev) return { at: d, before: prev, after: s }
      prev = s
    }
    return null
  }

  it('is deterministic for a given seed', () => {
    const a: number[] = []
    for (let d = 0; d < 3000; d += 7) a.push(getGripAt(d))
    resetRoad(SEED)
    const b: number[] = []
    for (let d = 0; d < 3000; d += 7) b.push(getGripAt(d))
    expect(a).toEqual(b)
  })

  it('matches the plain surface grip well away from any boundary', () => {
    // Mid-way through the long opening asphalt run.
    expect(getGripAt(START_ASPHALT_M / 2)).toBeCloseTo(SURFACE_GRIP.asphalt, 5)
  })

  it('never returns a value outside the surface grip range', () => {
    const lo = Math.min(...Object.values(SURFACE_GRIP))
    const hi = Math.max(...Object.values(SURFACE_GRIP))
    for (let d = 0; d < 5000; d += 3) {
      const g = getGripAt(d)
      expect(g).toBeGreaterThanOrEqual(lo - 1e-9)
      expect(g).toBeLessThanOrEqual(hi + 1e-9)
    }
  })

  it('has no single-tick grip cliff anywhere in the first 5 km', () => {
    // The bug this replaces: grip went 1.0 -> 0.25 between two consecutive ticks,
    // leaving no moment where the truck felt light and the player could still act.
    let worst = 0
    let worstAt = 0
    for (let d = 0; d < 5000; d += 0.5) {
      const step = Math.abs(getGripAt(d + 0.5) - getGripAt(d))
      if (step > worst) { worst = step; worstAt = d }
    }
    // 0.75 of grip spread over 20 m => ~0.02 per half-metre at the steepest.
    expect(worst, `steepest step ${worst.toFixed(4)} at ${worstAt}m`).toBeLessThan(0.05)
  })

  it('blends symmetrically across the seam, reaching each side by the ramp end', () => {
    const change = firstChange(START_ASPHALT_M - 50, 3000)
    expect(change).not.toBeNull()
    const { at, before, after } = change!
    const half = SURFACE_TRANSITION_M / 2

    const gBefore = SURFACE_GRIP[before as keyof typeof SURFACE_GRIP]
    const gAfter = SURFACE_GRIP[after as keyof typeof SURFACE_GRIP]

    // Fully settled on each side of the ramp...
    expect(getGripAt(at - half - 5)).toBeCloseTo(gBefore, 3)
    expect(getGripAt(at + half + 5)).toBeCloseTo(gAfter, 3)
    // ...and half way across it, roughly half way between the two.
    expect(getGripAt(at - 1)).toBeCloseTo((gBefore + gAfter) / 2, 1)
  })

  it('moves monotonically from one surface grip to the next across the seam', () => {
    const change = firstChange(START_ASPHALT_M - 50, 3000)!
    const half = SURFACE_TRANSITION_M / 2
    const descending =
      SURFACE_GRIP[change.after as keyof typeof SURFACE_GRIP] <
      SURFACE_GRIP[change.before as keyof typeof SURFACE_GRIP]

    let prev = getGripAt(change.at - half - 1)
    for (let d = change.at - half; d <= change.at + half + 1; d += 0.5) {
      const g = getGripAt(d)
      if (descending) expect(g).toBeLessThanOrEqual(prev + 1e-9)
      else expect(g).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = g
    }
  })
})
