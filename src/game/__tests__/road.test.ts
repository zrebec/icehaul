import { describe, it, expect, beforeEach } from 'vitest'
import { resetRoad, getSurfaceAt, gripFor, getGripAt, accelFor, isDangerAhead, sharpCurveAhead, getCurvatureAt } from '../road.ts'
import { START_ASPHALT_M, SURFACE_GRIP, SURFACE_ACCEL, ICE_AHEAD_LOOK_M, SURFACE_TRANSITION_M, CURVE_WARN_CURVATURE, CURVE_AHEAD_LOOK_M } from '../../config.ts'

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
  it('returns null on the opening asphalt stretch', () => {
    expect(isDangerAhead(0)).toBeNull()
    expect(isDangerAhead(100)).toBeNull()
  })

  it('reports the surface, its distance and its bend', () => {
    let firstHazard = -1
    for (let d = 0; d < 10000; d += 5) {
      if (getSurfaceAt(d) !== 'asphalt') { firstHazard = d; break }
    }
    expect(firstHazard).toBeGreaterThan(0)

    const from = firstHazard - 150
    const danger = isDangerAhead(from)
    expect(danger).not.toBeNull()
    expect(danger!.surface).toBe(getSurfaceAt(firstHazard))
    // Scanned at 5 m, so the reported start is within one step of the real one.
    expect(Math.abs(danger!.distanceM - (firstHazard - from))).toBeLessThanOrEqual(5)
    expect(Math.abs(danger!.curvature)).toBeLessThanOrEqual(2.0)
  })

  it('counts down as the hazard gets closer', () => {
    let firstHazard = -1
    for (let d = 0; d < 10000; d += 5) {
      if (getSurfaceAt(d) !== 'asphalt') { firstHazard = d; break }
    }
    const far = isDangerAhead(firstHazard - 200)
    const near = isDangerAhead(firstHazard - 50)
    expect(far).not.toBeNull()
    expect(near).not.toBeNull()
    // The old point-sample version could not do this at all: it returned only a
    // surface, so the strip read the same at 220 m as at 10 m.
    expect(near!.distanceM).toBeLessThan(far!.distanceM)
  })

  it('sees a hazard shorter than the look-ahead window', () => {
    // The point sample missed these entirely — the segment could open and close
    // between the player and the probe at ICE_AHEAD_LOOK_M.
    let found = false
    for (let d = 0; d < 40000; d += 5) {
      if (getSurfaceAt(d) !== 'asphalt') continue
      const hazardNow = isDangerAhead(d)
      if (!hazardNow) continue
      const pointSample = getSurfaceAt(d + ICE_AHEAD_LOOK_M)
      if (pointSample === 'asphalt') {
        // Interval scan sees it; the far-point probe reports plain asphalt.
        expect(hazardNow.surface).not.toBe('asphalt')
        found = true
        break
      }
    }
    expect(found, 'no short hazard found in 40 km to demonstrate the gap').toBe(true)
  })

  it('stays silent while standing on the hazard it would warn about', () => {
    for (let d = 0; d < 10000; d += 5) {
      const here = getSurfaceAt(d)
      if (here === 'asphalt') continue
      const danger = isDangerAhead(d)
      if (danger) expect(danger.surface).not.toBe(here)
      return
    }
  })

  it('stays silent when the road ahead is only asphalt', () => {
    for (let d = 0; d < 10000; d += 5) {
      let allAsphalt = true
      for (let k = d; k <= d + ICE_AHEAD_LOOK_M; k += 5) {
        if (getSurfaceAt(k) !== 'asphalt') { allAsphalt = false; break }
      }
      if (allAsphalt) {
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

// ─── Hazard entry is never inside a bend ─────────────────────────────────────

describe('surface generation', () => {
  const SEEDS = [0, 1, 7, 42, 99, 137, 256, 500, 777, 999,
                 1234, 2025, 4096, 8888, 12345, 19999, 55555, 99999, 123456, 999999, 1443866]

  /** Distances at which a non-asphalt segment begins, within `upTo`. */
  function hazardStarts(upTo: number): number[] {
    const starts: number[] = []
    let prev = getSurfaceAt(0)
    for (let d = 1; d <= upTo; d++) {
      const s = getSurfaceAt(d)
      if (s !== prev && s !== 'asphalt') starts.push(d)
      prev = s
    }
    return starts
  }

  it('stays deterministic per seed', () => {
    resetRoad(1443866)
    const a: string[] = []
    for (let d = 0; d < 6000; d += 25) a.push(getSurfaceAt(d))
    resetRoad(1443866)
    const b: string[] = []
    for (let d = 0; d < 6000; d += 25) b.push(getSurfaceAt(d))
    expect(a).toEqual(b)
  })

  it('generation terminates and still produces varied surfaces', () => {
    for (const seed of SEEDS) {
      resetRoad(seed)
      const seen = new Set<string>()
      for (let d = 0; d < 8000; d += 25) seen.add(getSurfaceAt(d))
      expect(seen.has('asphalt'), `seed ${seed}`).toBe(true)
      expect([...seen].some(s => s !== 'asphalt'), `seed ${seed} is all asphalt`).toBe(true)
    }
  })

  it('does not starve hazards — they still cover a real share of the route', () => {
    // Guards the balance of the route: a probability or length change that made
    // hazards rare would turn an ice-road game into an asphalt one with scenery.
    let nonAsphalt = 0
    let total = 0
    for (const seed of SEEDS) {
      resetRoad(seed)
      for (let d = 0; d < 5000; d += 10) {
        total++
        if (getSurfaceAt(d) !== 'asphalt') nonAsphalt++
      }
    }
    const share = nonAsphalt / total
    console.log(`\nnon-asphalt share of the first 5 km across ${SEEDS.length} seeds: ${(share * 100).toFixed(1)}%`)
    expect(share).toBeGreaterThan(0.25)
  })
})

// ─── Sharp bend while already on a slippery surface ──────────────────────────

describe('sharpCurveAhead', () => {
  it('says nothing on asphalt — reading the bend is the game there', () => {
    for (let d = 0; d < START_ASPHALT_M; d += 25) {
      expect(sharpCurveAhead(d), `asphalt at ${d}m`).toBeNull()
    }
  })

  it('warns about a sharp bend while standing on a hazard', () => {
    // isDangerAhead is deliberately silent here, which is the gap this fills.
    let found = false
    for (let d = 0; d < 40000; d += 5) {
      if (getSurfaceAt(d) === 'asphalt') continue
      const curve = sharpCurveAhead(d)
      if (!curve) continue
      expect(isDangerAhead(d)?.surface).not.toBe(getSurfaceAt(d))
      expect(Math.abs(curve.curvature)).toBeGreaterThanOrEqual(CURVE_WARN_CURVATURE)
      expect(curve.distanceM).toBeGreaterThanOrEqual(0)
      expect(curve.distanceM).toBeLessThanOrEqual(CURVE_AHEAD_LOOK_M)
      found = true
      break
    }
    expect(found, 'no sharp bend on a hazard within 40 km').toBe(true)
  })

  it('never reports a bend gentler than the warning threshold', () => {
    for (let d = 0; d < 20000; d += 5) {
      const curve = sharpCurveAhead(d)
      if (curve) expect(Math.abs(curve.curvature)).toBeGreaterThanOrEqual(CURVE_WARN_CURVATURE)
    }
  })

  it('reports the curvature actually present at the distance it names', () => {
    for (let d = 0; d < 20000; d += 5) {
      const curve = sharpCurveAhead(d)
      if (!curve) continue
      expect(getCurvatureAt(d + curve.distanceM)).toBeCloseTo(curve.curvature, 6)
      return
    }
  })

  it('counts down as the bend approaches', () => {
    for (let d = 0; d < 20000; d += 5) {
      const here = sharpCurveAhead(d)
      if (!here || here.distanceM < 20) continue
      const closer = sharpCurveAhead(d + 15)
      if (!closer) continue
      expect(closer.distanceM).toBeLessThan(here.distanceM)
      return
    }
  })

  it('is deterministic for a given seed', () => {
    const take = () => {
      const out: string[] = []
      for (let d = 0; d < 8000; d += 25) {
        const c = sharpCurveAhead(d)
        out.push(c ? `${c.distanceM}:${c.curvature.toFixed(4)}` : '-')
      }
      return out
    }
    const a = take()
    resetRoad(SEED)
    expect(take()).toEqual(a)
  })
})
