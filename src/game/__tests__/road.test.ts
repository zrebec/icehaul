import { describe, it, expect, beforeEach } from 'vitest'
import { resetRoad, getSurfaceAt, gripFor, accelFor, isDangerAhead, getCurvatureAt } from '../road.ts'
import { START_ASPHALT_M, SURFACE_GRIP, SURFACE_ACCEL, ICE_AHEAD_LOOK_M } from '../../config.ts'

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

  it('returns surface type when danger approaches', () => {
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

  it('returns null when already on non-asphalt surface', () => {
    let nonAsphaltDist = -1
    for (let d = 0; d < 10000; d += 5) {
      if (getSurfaceAt(d) !== 'asphalt') { nonAsphaltDist = d; break }
    }
    expect(nonAsphaltDist).toBeGreaterThan(0)
    expect(isDangerAhead(nonAsphaltDist)).toBeNull()
  })

  it('returns null well before any surface change', () => {
    expect(isDangerAhead(0)).toBeNull()
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
