import { describe, it, expect } from 'vitest'
import { depthToScanline, scanlineToDepth, computeCurveOffsets } from '../projection.ts'
import { computeRoadEdges } from '../../game/roadgeometry.ts'
import {
  PERSPECTIVE_K, GAME_WIDTH, LATERAL_SHIFT,
  VIEWPORT_TOP, VIEWPORT_BOTTOM, HORIZON_PCT,
  ROAD_HALF_TOP, ROAD_HALF_BOTTOM,
} from '../../config.ts'

const horizonY = VIEWPORT_TOP + Math.floor((VIEWPORT_BOTTOM - VIEWPORT_TOP) * HORIZON_PCT)
const roadHeight = VIEWPORT_BOTTOM - horizonY
const SCANLINES = roadHeight - 1

describe('depthToScanline / scanlineToDepth', () => {
  it('round-trips', () => {
    for (const dy of [1, 2, 6, 20, 88]) {
      expect(depthToScanline(scanlineToDepth(dy))).toBeCloseTo(dy, 9)
    }
  })

  it('puts distant world depth near the horizon', () => {
    expect(depthToScanline(PERSPECTIVE_K)).toBe(1)
    expect(scanlineToDepth(1)).toBe(PERSPECTIVE_K)
    expect(scanlineToDepth(2)).toBe(PERSPECTIVE_K / 2)
  })

  it('compresses enormous depth into the top scanlines', () => {
    // The reason per-scanline sampling of a world pattern aliases: the first
    // scanline covers 75 m of world, the last covers centimetres.
    const topGap = scanlineToDepth(1) - scanlineToDepth(2)
    const bottomGap = scanlineToDepth(SCANLINES - 1) - scanlineToDepth(SCANLINES)
    expect(topGap).toBeGreaterThan(70)
    expect(bottomGap).toBeLessThan(0.1)
  })
})

describe('computeCurveOffsets', () => {
  const curveFns: Array<[string, (d: number) => number]> = [
    ['straight', () => 0],
    ['constant right', () => 1.2],
    ['constant left', () => -0.8],
    ['sine', (d) => Math.sin(d / 40) * 1.5],
    ['step', (d) => (d % 200 < 100 ? 1 : -1)],
  ]

  // The renderer and the off-road/collision check must agree on where the road
  // is, to the pixel. They compute it in two places; this test is what keeps
  // roadgeometry.ts honest if either side is touched.
  it.each(curveFns)('matches computeRoadEdges centreX exactly (%s)', (_name, curveFn) => {
    for (const cameraDistance of [0, 37.5, 250, 1234.75]) {
      for (const playerX of [0, 0.6, -1.1]) {
        const offsets = computeCurveOffsets(cameraDistance, SCANLINES, curveFn)
        const edges = computeRoadEdges(cameraDistance, playerX, curveFn)
        const baseVanX = GAME_WIDTH / 2 - playerX * LATERAL_SHIFT

        for (let i = 0; i < SCANLINES; i++) {
          const dy = i + 1
          const fromProjection = baseVanX + (offsets[i] ?? 0)
          expect(edges(horizonY + dy)!.centerX).toBe(fromProjection)
        }
      }
    }
  })

  it.each(curveFns)('matches computeRoadEdges road edges exactly (%s)', (_name, curveFn) => {
    const cameraDistance = 512.25
    const playerX = 0.35
    const offsets = computeCurveOffsets(cameraDistance, SCANLINES, curveFn)
    const edges = computeRoadEdges(cameraDistance, playerX, curveFn)
    const baseVanX = GAME_WIDTH / 2 - playerX * LATERAL_SHIFT

    for (let i = 0; i < SCANLINES; i++) {
      const dy = i + 1
      const t = dy / roadHeight
      const half = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * t
      const cx = baseVanX + (offsets[i] ?? 0)
      const e = edges(horizonY + dy)!
      expect(e.leftRoad).toBe(Math.round(cx - half))
      expect(e.rightRoad).toBe(Math.round(cx + half))
    }
  })

  it('stays a Float32Array — float64 accumulation would drift from roadgeometry', () => {
    expect(computeCurveOffsets(0, SCANLINES, () => 1)).toBeInstanceOf(Float32Array)
  })

  it('leans the road further off centre closer to the horizon', () => {
    const offsets = computeCurveOffsets(0, SCANLINES, () => 1)
    expect(offsets[SCANLINES - 1]).toBe(0) // bottom scanline is the reference
    expect(Math.abs(offsets[0]!)).toBeGreaterThan(Math.abs(offsets[SCANLINES - 2]!))
  })
})
