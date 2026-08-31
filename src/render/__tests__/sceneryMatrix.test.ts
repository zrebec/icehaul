import { describe, expect, it } from 'vitest'
import { GAME_WIDTH, VIEWPORT_BOTTOM, VIEWPORT_TOP } from '../../config.ts'
import {
  SCENERY_MATRIX_DEFAULTS,
  SCENERY_MATRIX_DISTANCES_M,
  SCENERY_MATRIX_TYPES,
  SCENERY_PLACEMENT_CAMERA_DISTANCES_M,
  isSceneryMatrixRequested,
  sceneryMatrixLayout,
  sceneryMatrixLayoutFor,
  sceneryMatrixOptionsFromSearch,
  sceneryPlacementLayout,
  sceneryPlacementSeedFromSearch,
} from '../debug/sceneryMatrix.ts'

describe('isSceneryMatrixRequested', () => {
  it('only fires on an explicit sceneryMatrix=1', () => {
    expect(isSceneryMatrixRequested('?sceneryMatrix=1')).toBe(true)
    expect(isSceneryMatrixRequested('?seed=42&sceneryMatrix=1')).toBe(true)
    expect(isSceneryMatrixRequested('')).toBe(false)
    expect(isSceneryMatrixRequested('?sceneryMatrix=0')).toBe(false)
    expect(isSceneryMatrixRequested('?matrix=1')).toBe(false)
  })
})

describe('sceneryMatrixLayout', () => {
  it('is one column per distance and one row per scenery type', () => {
    const layout = sceneryMatrixLayout()
    expect(layout.cols).toBe(SCENERY_MATRIX_DISTANCES_M.length)
    expect(layout.rows).toBe(SCENERY_MATRIX_TYPES.length)
  })

  it('uses the real road viewport for every cell', () => {
    const layout = sceneryMatrixLayout()
    expect(layout.cellW).toBe(GAME_WIDTH)
    expect(layout.cellH).toBe(VIEWPORT_BOTTOM - VIEWPORT_TOP)
  })

  it('scales and filters without leaving full-grid padding', () => {
    const filtered = sceneryMatrixLayout(2, { types: ['lamp'], distances: [220, 3] })
    expect(filtered.cols).toBe(2)
    expect(filtered.rows).toBe(1)
    expect(filtered.cellW).toBe(GAME_WIDTH * 2)
    expect(filtered.width).toBeLessThan(sceneryMatrixLayout(2).width)
  })
})

describe('sceneryMatrixLayoutFor', () => {
  it('uses the same defaults merge as the renderer', () => {
    const options = { types: ['sign' as const], distances: [80, 20], zoom: 2 }
    expect(sceneryMatrixLayoutFor(options)).toEqual(
      sceneryMatrixLayout(2, { ...SCENERY_MATRIX_DEFAULTS, ...options }),
    )
  })
})

describe('sceneryMatrixOptionsFromSearch', () => {
  it('returns no overrides for the bare debug query', () => {
    expect(sceneryMatrixOptionsFromSearch('?sceneryMatrix=1')).toEqual({})
  })

  it('reads the visual controls', () => {
    const options = sceneryMatrixOptionsFromSearch(
      '?sceneryMatrix=1&surface=ice&curve=2&offset=1.25&zoom=4&scanlines=1',
    )
    expect(options).toMatchObject({
      surface: 'ice', curvature: 2, offsetRoadWidths: 1.25, zoom: 4, scanlines: true,
    })
  })

  it('rejects unknown surfaces and unusable zooms', () => {
    expect(sceneryMatrixOptionsFromSearch('?surface=lava').surface).toBeUndefined()
    expect(sceneryMatrixOptionsFromSearch('?zoom=0').zoom).toBeUndefined()
    expect(sceneryMatrixOptionsFromSearch('?zoom=1.5').zoom).toBeUndefined()
    expect(sceneryMatrixOptionsFromSearch('?zoom=9').zoom).toBeUndefined()
  })

  it('clamps curvature and roadside offset to renderer-safe ranges', () => {
    expect(sceneryMatrixOptionsFromSearch('?curve=99').curvature).toBe(2)
    expect(sceneryMatrixOptionsFromSearch('?curve=-99').curvature).toBe(-2)
    expect(sceneryMatrixOptionsFromSearch('?offset=-1').offsetRoadWidths).toBe(0)
    expect(sceneryMatrixOptionsFromSearch('?offset=99').offsetRoadWidths).toBe(3)
  })

  it('filters types and reads an explicit distance ladder', () => {
    const options = sceneryMatrixOptionsFromSearch('?types=lamp,house,rocks&dist=220,20,nope,-2')
    expect(options.types).toEqual(['lamp', 'rocks'])
    expect(options.distances).toEqual([220, 20])
    expect(sceneryMatrixOptionsFromSearch('?types=house').types).toBeUndefined()
  })
})

describe('real placement mode', () => {
  it('accepts only an unsigned 32-bit decimal seed', () => {
    expect(sceneryPlacementSeedFromSearch('?placement=42')).toBe(42)
    expect(sceneryPlacementSeedFromSearch('?placement=1443866')).toBe(1_443_866)
    expect(sceneryPlacementSeedFromSearch('?placement=-1')).toBeUndefined()
    expect(sceneryPlacementSeedFromSearch('?placement=1.5')).toBeUndefined()
    expect(sceneryPlacementSeedFromSearch('?placement=4294967296')).toBeUndefined()
  })

  it('lays real route samples in one far-to-near-independent strip', () => {
    const layout = sceneryPlacementLayout(2)
    expect(layout.cols).toBe(SCENERY_PLACEMENT_CAMERA_DISTANCES_M.length)
    expect(layout.rows).toBe(1)
    expect(layout.cellW).toBe(GAME_WIDTH * 2)
    expect(layout.cellH).toBe((VIEWPORT_BOTTOM - VIEWPORT_TOP) * 2)
  })
})
