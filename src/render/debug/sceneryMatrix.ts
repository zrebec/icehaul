/**
 * Roadside contact sheets. Synthetic mode isolates one authored object at an
 * exact depth; placement mode draws the real seeded generator at four points on
 * one route. Both go through the production road and scenery renderers.
 */

import { C, drawScanlines } from 'zx-kit'
import {
  GAME_HEIGHT, GAME_WIDTH, SCANLINE_ALPHA,
  SCENERY_VIEW_DISTANCE_M, VIEWPORT_BOTTOM, VIEWPORT_TOP,
  type Surface,
} from '../../config.ts'
import { getCurvatureAt, getSurfaceAt, resetRoad } from '../../game/road.ts'
import {
  getRoadsideObjects, type RoadsideObject, type RoadsideType,
} from '../../game/roadside.ts'
import {
  drawRoad, drawRoadsideObjects, drawStarField, projectRoadsideObjects,
} from '../road3d.ts'
import type { LodTier } from '../vehicleLod.ts'

export const SCENERY_MATRIX_DISTANCES_M = [220, 120, 80, 50, 25, 20, 10, 3] as const
export const SCENERY_MATRIX_TYPES: readonly RoadsideType[] = [
  'deciduous', 'conifer', 'rocks', 'sign', 'lamp',
]

/** Four independent windows into a route, not an animation of one approach. */
export const SCENERY_PLACEMENT_CAMERA_DISTANCES_M = [0, 1000, 2500, 4500] as const

export interface SceneryMatrixSelection {
  readonly types: readonly RoadsideType[]
  readonly distances: readonly number[]
}

export interface SceneryMatrixLayout {
  readonly cols: number
  readonly rows: number
  readonly cellW: number
  readonly cellH: number
  readonly width: number
  readonly height: number
}

export interface SceneryMatrixOptions extends SceneryMatrixSelection {
  readonly surface: Surface
  readonly curvature: number
  readonly offsetRoadWidths: number
  readonly zoom: number
  readonly scanlines: boolean
}

const CELL_W = GAME_WIDTH
const CELL_H = VIEWPORT_BOTTOM - VIEWPORT_TOP
const LABEL_W = 104
const LABEL_H = 10

export const SCENERY_MATRIX_DEFAULTS: SceneryMatrixOptions = {
  types: SCENERY_MATRIX_TYPES,
  distances: SCENERY_MATRIX_DISTANCES_M,
  surface: 'asphalt',
  curvature: 0,
  offsetRoadWidths: 0.15,
  zoom: 1,
  scanlines: false,
}

export function sceneryMatrixLayout(
  zoom = 1,
  selection: SceneryMatrixSelection = SCENERY_MATRIX_DEFAULTS,
): SceneryMatrixLayout {
  const cols = selection.distances.length
  const rows = selection.types.length
  return {
    cols,
    rows,
    cellW: CELL_W * zoom,
    cellH: CELL_H * zoom,
    width: LABEL_W + cols * CELL_W * zoom,
    height: LABEL_H + rows * CELL_H * zoom,
  }
}

export function sceneryMatrixLayoutFor(
  options: Partial<SceneryMatrixOptions> = {},
): SceneryMatrixLayout {
  const merged = { ...SCENERY_MATRIX_DEFAULTS, ...options }
  return sceneryMatrixLayout(merged.zoom, merged)
}

export function sceneryPlacementLayout(zoom = 1): SceneryMatrixLayout {
  const cols = SCENERY_PLACEMENT_CAMERA_DISTANCES_M.length
  return {
    cols,
    rows: 1,
    cellW: CELL_W * zoom,
    cellH: CELL_H * zoom,
    width: LABEL_W + cols * CELL_W * zoom,
    height: LABEL_H + CELL_H * zoom,
  }
}

export function sceneryPlacementLayoutFor(
  options: Partial<SceneryMatrixOptions> = {},
): SceneryMatrixLayout {
  return sceneryPlacementLayout(options.zoom ?? SCENERY_MATRIX_DEFAULTS.zoom)
}

function objectAt(
  type: RoadsideType,
  distance: number,
  offsetRoadWidths: number,
): RoadsideObject {
  return {
    distM: distance,
    side: 1,
    type,
    band: 'verge',
    offsetRoadWidths,
  }
}

function clearCell(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = C.BLACK
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)
  drawStarField(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM)
}

function renderMatrixCell(
  ctx: CanvasRenderingContext2D,
  options: SceneryMatrixOptions,
  type: RoadsideType,
  distance: number,
): LodTier | undefined {
  const surfaceAt = () => options.surface
  const curvatureAt = () => options.curvature
  const object = objectAt(type, distance, options.offsetRoadWidths)

  clearCell(ctx)
  drawRoad(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, surfaceAt, curvatureAt)
  drawRoadsideObjects(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, [object], curvatureAt)

  // Tier label comes from the production projector; no scale or threshold is
  // copied into the harness.
  return projectRoadsideObjects(
    VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, [object], curvatureAt,
  )[0]?.lod
}

function drawTierBadge(
  ctx: CanvasRenderingContext2D,
  tier: LodTier | undefined,
  x: number,
  y: number,
): void {
  if (!tier) return
  ctx.fillStyle = C.BLACK
  ctx.fillRect(x + 1, y + 1, 27, 9)
  ctx.fillStyle = tier === 'far' ? C.B_CYAN : tier === 'mid' ? C.B_YELLOW : C.B_RED
  ctx.fillText(tier, x + 2, y + 2)
}

function makeCell(
  makeCellCanvas: () => HTMLCanvasElement,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = makeCellCanvas()
  canvas.width = GAME_WIDTH
  canvas.height = GAME_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('scenery matrix: no 2d context for the cell canvas')
  return { canvas, ctx }
}

function prepareSheet(ctx: CanvasRenderingContext2D, layout: SceneryMatrixLayout): void {
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = C.BLACK
  ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.fillStyle = C.B_WHITE
  ctx.font = '8px monospace'
  ctx.textBaseline = 'top'
}

export function drawSceneryMatrix(
  ctx: CanvasRenderingContext2D,
  makeCellCanvas: () => HTMLCanvasElement,
  options: Partial<SceneryMatrixOptions> = {},
): SceneryMatrixLayout {
  const merged: SceneryMatrixOptions = { ...SCENERY_MATRIX_DEFAULTS, ...options }
  const layout = sceneryMatrixLayout(merged.zoom, merged)
  const cell = makeCell(makeCellCanvas)
  prepareSheet(ctx, layout)

  for (let column = 0; column < layout.cols; column++) {
    ctx.fillText(`${merged.distances[column]}m`, LABEL_W + column * layout.cellW + 2, 1)
  }

  for (let row = 0; row < merged.types.length; row++) {
    const type = merged.types[row]!
    const y = LABEL_H + row * layout.cellH
    ctx.fillStyle = C.B_WHITE
    ctx.fillText(type, 1, y + 2)

    for (let column = 0; column < layout.cols; column++) {
      const tier = renderMatrixCell(cell.ctx, merged, type, merged.distances[column]!)
      const x = LABEL_W + column * layout.cellW
      ctx.drawImage(
        cell.canvas,
        0, VIEWPORT_TOP, GAME_WIDTH, CELL_H,
        x, y, layout.cellW, layout.cellH,
      )
      drawTierBadge(ctx, tier, x, y)
    }
  }

  if (merged.scanlines) drawScanlines(ctx, SCANLINE_ALPHA)
  return layout
}

function renderPlacementCell(
  ctx: CanvasRenderingContext2D,
  seed: number,
  cameraDistance: number,
): void {
  clearCell(ctx)
  drawRoad(
    ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, cameraDistance, 0,
    getSurfaceAt, getCurvatureAt,
  )
  const objects = getRoadsideObjects(
    (seed + 3) >>> 0,
    cameraDistance - 10,
    cameraDistance + SCENERY_VIEW_DISTANCE_M,
  )
  drawRoadsideObjects(
    ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, cameraDistance, 0, objects, getCurvatureAt,
  )
}

/** Draw four true generator windows for a named route seed. */
export function drawSceneryPlacement(
  ctx: CanvasRenderingContext2D,
  makeCellCanvas: () => HTMLCanvasElement,
  seed: number,
  options: Partial<SceneryMatrixOptions> = {},
): SceneryMatrixLayout {
  const zoom = options.zoom ?? SCENERY_MATRIX_DEFAULTS.zoom
  const scanlines = options.scanlines ?? SCENERY_MATRIX_DEFAULTS.scanlines
  const layout = sceneryPlacementLayout(zoom)
  const cell = makeCell(makeCellCanvas)
  prepareSheet(ctx, layout)
  resetRoad(seed)

  for (let column = 0; column < layout.cols; column++) {
    const cameraDistance = SCENERY_PLACEMENT_CAMERA_DISTANCES_M[column]!
    ctx.fillStyle = C.B_WHITE
    ctx.fillText(`${cameraDistance}m`, LABEL_W + column * layout.cellW + 2, 1)
  }
  ctx.fillText(`seed ${seed}`, 1, LABEL_H + 2)

  for (let column = 0; column < layout.cols; column++) {
    renderPlacementCell(cell.ctx, seed, SCENERY_PLACEMENT_CAMERA_DISTANCES_M[column]!)
    ctx.drawImage(
      cell.canvas,
      0, VIEWPORT_TOP, GAME_WIDTH, CELL_H,
      LABEL_W + column * layout.cellW, LABEL_H, layout.cellW, layout.cellH,
    )
  }

  if (scanlines) drawScanlines(ctx, SCANLINE_ALPHA)
  return layout
}

export function sceneryMatrixOptionsFromSearch(
  search: string,
): Partial<SceneryMatrixOptions> {
  const query = new URLSearchParams(search)
  const out: { -readonly [Key in keyof SceneryMatrixOptions]?: SceneryMatrixOptions[Key] } = {}

  const surface = query.get('surface')
  if (surface && ['asphalt', 'snow', 'ice', 'sand', 'mud'].includes(surface)) {
    out.surface = surface as Surface
  }

  const numberFrom = (key: string): number | undefined => {
    const raw = query.get(key)?.trim()
    if (!raw) return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const curvature = numberFrom('curve')
  if (curvature !== undefined) out.curvature = Math.max(-2, Math.min(2, curvature))

  const offset = numberFrom('offset')
  if (offset !== undefined) out.offsetRoadWidths = Math.max(0, Math.min(3, offset))

  const zoom = numberFrom('zoom')
  if (zoom !== undefined && Number.isInteger(zoom) && zoom >= 1 && zoom <= 8) out.zoom = zoom

  if (query.get('scanlines') === '1') out.scanlines = true

  const types = query.get('types')?.split(',')
    .filter(type => (SCENERY_MATRIX_TYPES as readonly string[]).includes(type))
  if (types?.length) out.types = types as RoadsideType[]

  const distances = query.get('dist')?.split(',').map(Number)
    .filter(distance => Number.isFinite(distance) && distance > 0)
  if (distances?.length) out.distances = distances

  return out
}

export function isSceneryMatrixRequested(search: string): boolean {
  return new URLSearchParams(search).get('sceneryMatrix') === '1'
}

/** `placement=<seed>` opts the scenery debug page into true generated windows. */
export function sceneryPlacementSeedFromSearch(search: string): number | undefined {
  const raw = new URLSearchParams(search).get('placement')?.trim()
  if (!raw || !/^\d+$/.test(raw)) return undefined
  const seed = Number(raw)
  return Number.isSafeInteger(seed) && seed <= 0xffff_ffff ? seed : undefined
}
