import { describe, it, expect } from 'vitest'
import { computeRoadEdges } from '../roadgeometry.ts'
import { VIEWPORT_TOP, VIEWPORT_BOTTOM, HORIZON_PCT, GAME_WIDTH, LATERAL_SHIFT } from '../../config.ts'

const horizonY = VIEWPORT_TOP + Math.floor((VIEWPORT_BOTTOM - VIEWPORT_TOP) * HORIZON_PCT)

describe('computeRoadEdges', () => {
  const noCurve = () => 0

  it('returns undefined above the horizon', () => {
    const lookup = computeRoadEdges(0, 0, noCurve)
    expect(lookup(horizonY)).toBeUndefined()
    expect(lookup(0)).toBeUndefined()
    expect(lookup(VIEWPORT_TOP)).toBeUndefined()
  })

  it('returns edges for valid road scanlines', () => {
    const lookup = computeRoadEdges(0, 0, noCurve)
    const bottomEdge = lookup(VIEWPORT_BOTTOM - 1)
    expect(bottomEdge).toBeDefined()
    expect(bottomEdge!.leftRoad).toBeLessThan(bottomEdge!.rightRoad)
    expect(bottomEdge!.kerbW).toBeGreaterThanOrEqual(1)
  })

  it('road is wider at bottom (perspective)', () => {
    const lookup = computeRoadEdges(0, 0, noCurve)
    const nearHorizon = lookup(horizonY + 2)!
    const nearBottom = lookup(VIEWPORT_BOTTOM - 2)!
    const widthTop = nearHorizon.rightRoad - nearHorizon.leftRoad
    const widthBottom = nearBottom.rightRoad - nearBottom.leftRoad
    expect(widthBottom).toBeGreaterThan(widthTop)
  })

  it('road is centered when playerX is 0', () => {
    const lookup = computeRoadEdges(0, 0, noCurve)
    const mid = lookup(Math.floor((horizonY + VIEWPORT_BOTTOM) / 2))!
    const center = (mid.leftRoad + mid.rightRoad) / 2
    expect(Math.abs(center - GAME_WIDTH / 2)).toBeLessThan(2)
  })

  it('road center shifts left when playerX > 0 (parallax)', () => {
    const centered = computeRoadEdges(0, 0, noCurve)
    const shifted = computeRoadEdges(0, 1.0, noCurve)
    const y = VIEWPORT_BOTTOM - 5
    expect(shifted(y)!.centerX).toBeLessThan(centered(y)!.centerX)
  })

  it('parallax shift equals playerX * LATERAL_SHIFT', () => {
    const base = computeRoadEdges(0, 0, noCurve)
    const px = 0.5
    const shifted = computeRoadEdges(0, px, noCurve)
    const y = VIEWPORT_BOTTOM - 5
    const expected = px * LATERAL_SHIFT
    expect(Math.abs(base(y)!.centerX - shifted(y)!.centerX - expected)).toBeLessThan(1)
  })

  it('curve offsets shift the road', () => {
    const straight = computeRoadEdges(0, 0, noCurve)
    const curved = computeRoadEdges(0, 0, () => 1.5)
    const y = Math.floor((horizonY + VIEWPORT_BOTTOM) / 2)
    expect(curved(y)!.centerX).not.toEqual(straight(y)!.centerX)
  })

  it('negative curvature shifts opposite direction', () => {
    const curveRight = computeRoadEdges(0, 0, () => 1.0)
    const curveLeft = computeRoadEdges(0, 0, () => -1.0)
    const y = Math.floor((horizonY + VIEWPORT_BOTTOM) / 2)
    const rightCenter = curveRight(y)!.centerX
    const leftCenter = curveLeft(y)!.centerX
    expect(rightCenter).not.toEqual(leftCenter)
  })

  it('kerb width increases toward bottom', () => {
    const lookup = computeRoadEdges(0, 0, noCurve)
    const topKerb = lookup(horizonY + 3)!.kerbW
    const bottomKerb = lookup(VIEWPORT_BOTTOM - 2)!.kerbW
    expect(bottomKerb).toBeGreaterThanOrEqual(topKerb)
  })

  it('all scanlines between horizon+1 and VIEWPORT_BOTTOM-1 have edges', () => {
    const lookup = computeRoadEdges(0, 0, noCurve)
    let count = 0
    for (let y = horizonY + 1; y < VIEWPORT_BOTTOM; y++) {
      if (lookup(y)) count++
    }
    expect(count).toBeGreaterThan(0)
    expect(count).toBe(VIEWPORT_BOTTOM - horizonY - 1)
  })
})
