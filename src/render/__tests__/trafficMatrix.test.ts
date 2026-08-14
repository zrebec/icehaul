/**
 * The drawing itself is not tested here — jsdom has no 2D context, and a canvas
 * mock would only prove the mock works. The sheet is verified by looking at it
 * (`scripts/traffic-matrix.mjs`), which is the entire point of the harness.
 *
 * What is tested is everything that decides *which* cells get drawn and how big
 * the canvas must be, because a mismatch there silently crops or pads the sheet
 * and quietly invalidates the comparison it exists to support.
 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SELECTION, MATRIX_DEFAULTS, MATRIX_DIRS, MATRIX_DISTANCES_M, MATRIX_TYPES,
  isMatrixRequested, matrixLayout, matrixLayoutFor, matrixOptionsFromSearch,
} from '../debug/trafficMatrix.ts'
import { GAME_WIDTH, VIEWPORT_BOTTOM, VIEWPORT_TOP } from '../../config.ts'

describe('isMatrixRequested', () => {
  it('only fires on an explicit matrix=1', () => {
    expect(isMatrixRequested('?matrix=1')).toBe(true)
    expect(isMatrixRequested('?seed=42&matrix=1')).toBe(true)
    expect(isMatrixRequested('')).toBe(false)
    expect(isMatrixRequested('?matrix=0')).toBe(false)
    expect(isMatrixRequested('?matrix=true')).toBe(false)
    expect(isMatrixRequested('?seed=1443866')).toBe(false)
  })
})

describe('matrixLayout', () => {
  it('is one column per distance and one row per type/direction pair', () => {
    const l = matrixLayout()
    expect(l.cols).toBe(MATRIX_DISTANCES_M.length)
    expect(l.rows).toBe(MATRIX_TYPES.length * MATRIX_DIRS.length)
  })

  it('sizes a cell to the road viewport, not the whole screen', () => {
    const l = matrixLayout()
    expect(l.cellW).toBe(GAME_WIDTH)
    expect(l.cellH).toBe(VIEWPORT_BOTTOM - VIEWPORT_TOP)
  })

  it('scales cells by an integer zoom', () => {
    const one = matrixLayout(1)
    const four = matrixLayout(4)
    expect(four.cellW).toBe(one.cellW * 4)
    expect(four.cellH).toBe(one.cellH * 4)
  })

  it('shrinks with a narrower selection', () => {
    const l = matrixLayout(1, { types: ['car'], dirs: ['oncoming'], distances: [220, 10] })
    expect(l.cols).toBe(2)
    expect(l.rows).toBe(1)
    expect(l.width).toBeLessThan(matrixLayout(1).width)
  })
})

describe('matrixLayoutFor', () => {
  it('agrees with the layout the sheet actually draws', () => {
    // The canvas is sized from this and the sheet is drawn from MATRIX_DEFAULTS
    // merged with the same options. If these two merges ever disagree, a filtered
    // sheet lands in a canvas sized for the full grid and gets cropped.
    const options = { types: ['bus' as const], distances: [50, 5], zoom: 2 }
    const viaHelper = matrixLayoutFor(options)
    const viaMerge = matrixLayout(2, { ...MATRIX_DEFAULTS, ...options })
    expect(viaHelper).toEqual(viaMerge)
  })

  it('falls back to the full grid when given nothing', () => {
    expect(matrixLayoutFor()).toEqual(matrixLayout(1, DEFAULT_SELECTION))
  })
})

describe('matrixOptionsFromSearch', () => {
  it('returns nothing to override for an empty query', () => {
    expect(matrixOptionsFromSearch('?matrix=1')).toEqual({})
  })

  it('reads surface, curvature, lane, zoom and truck', () => {
    const o = matrixOptionsFromSearch('?matrix=1&surface=ice&curve=2&lane=0.5&zoom=4&truck=0')
    expect(o.surface).toBe('ice')
    expect(o.curvature).toBe(2)
    expect(o.playerX).toBe(0.5)
    expect(o.zoom).toBe(4)
    expect(o.showTruck).toBe(false)
  })

  it('ignores a surface that is not one', () => {
    expect(matrixOptionsFromSearch('?surface=lava').surface).toBeUndefined()
  })

  it('clamps curvature and lane to their real ranges', () => {
    expect(matrixOptionsFromSearch('?curve=99').curvature).toBe(2)
    expect(matrixOptionsFromSearch('?curve=-99').curvature).toBe(-2)
    expect(matrixOptionsFromSearch('?lane=9').playerX).toBe(1)
  })

  it('rejects a zoom that is not a usable integer', () => {
    expect(matrixOptionsFromSearch('?zoom=0').zoom).toBeUndefined()
    expect(matrixOptionsFromSearch('?zoom=1.5').zoom).toBeUndefined()
    expect(matrixOptionsFromSearch('?zoom=99').zoom).toBeUndefined()
    expect(matrixOptionsFromSearch('?zoom=4').zoom).toBe(4)
  })

  it('filters types and directions, dropping unknown names', () => {
    const o = matrixOptionsFromSearch('?types=car,lorry&dirs=oncoming')
    expect(o.types).toEqual(['car'])
    expect(o.dirs).toEqual(['oncoming'])
  })

  it('leaves the filter alone when every name is unknown', () => {
    // Better the full sheet than an empty one: a zero-row canvas renders nothing
    // and looks like the harness is broken rather than the query.
    expect(matrixOptionsFromSearch('?types=lorry').types).toBeUndefined()
  })

  it('reads a custom distance ladder and drops nonsense', () => {
    expect(matrixOptionsFromSearch('?dist=220,50,10').distances).toEqual([220, 50, 10])
    expect(matrixOptionsFromSearch('?dist=50,-5,abc').distances).toEqual([50])
    expect(matrixOptionsFromSearch('?dist=abc').distances).toBeUndefined()
  })
})

describe('the distance ladder', () => {
  it('runs from far to near', () => {
    for (let i = 1; i < MATRIX_DISTANCES_M.length; i++) {
      expect(MATRIX_DISTANCES_M[i]!).toBeLessThan(MATRIX_DISTANCES_M[i - 1]!)
    }
  })

  it('stays inside the distance traffic is actually drawn at', () => {
    // Beyond TRAFFIC_VIEW_DISTANCE_M the projection returns null and the cell
    // would be an empty road, which reads as a rendering bug rather than a choice.
    expect(Math.max(...MATRIX_DISTANCES_M)).toBeLessThanOrEqual(220)
    expect(Math.min(...MATRIX_DISTANCES_M)).toBeGreaterThan(0)
  })
})
