/**
 * Traffic contact sheet — the fixed comparison harness for renderer work.
 *
 * Step 0 of the graphics order in `AGENTS.md`: everything after it is a judgement
 * about how something *looks*, and those judgements are worthless without the
 * same frames to compare. This renders traffic at a fixed ladder of distances,
 * for every type and direction, over a chosen surface, and tiles the results into
 * one image.
 *
 * It draws through the real path — `drawRoad`, `drawTraffic`, `drawTruck` — with
 * synthetic vehicles at exact distances. Nothing here reimplements projection or
 * sprite drawing, so a change to the renderer shows up here by construction. If
 * this file ever needs its own copy of that logic, the copy is the bug.
 *
 * Deliberately not part of the game: reached only via `?matrix=1`, and it never
 * touches the scene manager or the input system.
 */

import { C } from 'zx-kit'
import {
  GAME_WIDTH, GAME_HEIGHT, VIEWPORT_TOP, VIEWPORT_BOTTOM,
  type Surface,
} from '../../config.ts'
import { drawRoad, drawTraffic } from '../road3d.ts'
import { drawTruck } from '../truck.ts'
import type { TrafficVehicle, TrafficDir, VehicleType } from '../../game/traffic.ts'

/**
 * Distances sampled, in metres. Chosen where the projection changes character
 * rather than at round numbers: 220 is `TRAFFIC_VIEW_DISTANCE_M`, the far end;
 * 2 is the last frame before a vehicle passes the camera.
 */
export const MATRIX_DISTANCES_M = [220, 100, 50, 25, 10, 5, 2] as const

export const MATRIX_TYPES: readonly VehicleType[] = ['mini', 'car', 'bus']
export const MATRIX_DIRS: readonly TrafficDir[] = ['same', 'oncoming']

/** Which cells the sheet covers. Filtering keeps a zoomed sheet small enough to
 *  actually look at — a full 4x sheet is over 7000 px wide and unreadable. */
export interface MatrixSelection {
  types: readonly VehicleType[]
  dirs: readonly TrafficDir[]
  distances: readonly number[]
}

/** One row per type/direction pair, one column per distance. */
export interface MatrixLayout {
  cols: number
  rows: number
  cellW: number
  cellH: number
  width: number
  height: number
}

/** Height of the road viewport — the sheet crops to it, the HUD is not the subject. */
const CELL_W = GAME_WIDTH
const CELL_H = VIEWPORT_BOTTOM - VIEWPORT_TOP
/** Room for the column/row captions. */
const LABEL_W = 64
const LABEL_H = 10

export const DEFAULT_SELECTION: MatrixSelection = {
  types: MATRIX_TYPES,
  dirs: MATRIX_DIRS,
  distances: MATRIX_DISTANCES_M,
}

export function matrixLayout(zoom = 1, selection?: MatrixSelection): MatrixLayout {
  const sel = selection ?? DEFAULT_SELECTION
  const cols = sel.distances.length
  const rows = sel.types.length * sel.dirs.length
  return {
    cols,
    rows,
    cellW: CELL_W * zoom,
    cellH: CELL_H * zoom,
    width: LABEL_W + cols * CELL_W * zoom,
    height: LABEL_H + rows * CELL_H * zoom,
  }
}

export interface MatrixOptions extends MatrixSelection {
  surface: Surface
  /** Constant curvature for every cell — 0 is straight, 2.0 the sharpest turn. */
  curvature: number
  /** Player lateral position, so a lane-edge pass can be compared with a centred one. */
  playerX: number
  /** Integer nearest-neighbour magnification of the whole sheet. */
  zoom: number
  /** Draw the player truck for scale reference. */
  showTruck: boolean
  /**
   * Lateral position of the drawn vehicle, magnitude only — the sign follows the
   * direction. `vehicle.x = ±1` is the road edge, so 0.5 is the lane centre.
   *
   * The sheet used to hardcode 0.35, which is tidier than the game has ever
   * been: same-direction traffic spawned centred on +0.05 until the lane fix,
   * so the harness was quietly understating how far into the centre line a
   * vehicle sat. Keep this settable, and compare against the spawner.
   */
  vehicleX: number
}

export const MATRIX_DEFAULTS: MatrixOptions = {
  ...DEFAULT_SELECTION,
  surface: 'asphalt',
  curvature: 0,
  playerX: 0,
  zoom: 1,
  showTruck: true,
  vehicleX: 0.5,
}

/**
 * Layout for a partial set of options — the same merge `drawTrafficMatrix` does.
 * Callers must size the canvas through this, or a filtered sheet is drawn into a
 * canvas sized for the full grid.
 */
export function matrixLayoutFor(options: Partial<MatrixOptions> = {}): MatrixLayout {
  const opts = { ...MATRIX_DEFAULTS, ...options }
  return matrixLayout(opts.zoom, opts)
}

/** A single vehicle placed at an exact distance, everything else neutral. */
function cellVehicle(
  type: VehicleType, dir: TrafficDir, distM: number, vehicleX: number,
): TrafficVehicle {
  return {
    spawnDist: 0,
    distM,
    // Each direction sits in its own lane, as it would on the road.
    x: dir === 'oncoming' ? -vehicleX : vehicleX,
    speed: 0,
    dir,
    type,
    gone: false,
  }
}

/**
 * Render one cell at native size into `cellCtx`, which must be a 256-wide context
 * with no transform applied.
 */
function renderCell(
  cellCtx: CanvasRenderingContext2D,
  opts: MatrixOptions,
  type: VehicleType,
  dir: TrafficDir,
  distM: number,
): void {
  const surfaceAt = () => opts.surface
  const curvatureAt = () => opts.curvature

  cellCtx.fillStyle = C.BLACK
  cellCtx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)

  drawRoad(cellCtx, VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, opts.playerX, surfaceAt, curvatureAt)
  drawTraffic(
    cellCtx, VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, opts.playerX,
    [cellVehicle(type, dir, distM, opts.vehicleX)], curvatureAt,
  )
  if (opts.showTruck) {
    drawTruck(cellCtx, GAME_WIDTH / 2 + opts.playerX * 50, VIEWPORT_BOTTOM - 2, 0, 0)
  }
}

/**
 * Draw the whole contact sheet into `ctx`, whose canvas must already be sized to
 * {@link matrixLayout}. `makeCellCanvas` exists so the caller supplies the
 * offscreen surface — the browser passes a real canvas, a test can pass a stub.
 */
export function drawTrafficMatrix(
  ctx: CanvasRenderingContext2D,
  makeCellCanvas: () => HTMLCanvasElement,
  options: Partial<MatrixOptions> = {},
): MatrixLayout {
  const opts: MatrixOptions = { ...MATRIX_DEFAULTS, ...options }
  const layout = matrixLayout(opts.zoom, opts)

  const cell = makeCellCanvas()
  cell.width = GAME_WIDTH
  cell.height = GAME_HEIGHT
  const cellCtx = cell.getContext('2d')
  if (!cellCtx) throw new Error('matrix: no 2d context for the cell canvas')

  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = C.BLACK
  ctx.fillRect(0, 0, layout.width, layout.height)

  // Column captions: the distance ladder.
  ctx.fillStyle = C.B_WHITE
  ctx.font = '8px monospace'
  ctx.textBaseline = 'top'
  for (let c = 0; c < layout.cols; c++) {
    ctx.fillText(`${opts.distances[c]}m`, LABEL_W + c * layout.cellW + 2, 1)
  }

  let row = 0
  for (const type of opts.types) {
    for (const dir of opts.dirs) {
      const y = LABEL_H + row * layout.cellH
      ctx.fillStyle = C.B_WHITE
      ctx.fillText(`${type}/${dir === 'oncoming' ? 'onc' : 'same'}`, 1, y + 2)

      for (let c = 0; c < layout.cols; c++) {
        renderCell(cellCtx, opts, type, dir, opts.distances[c]!)
        // Crop to the road viewport — the HUD is not what this sheet is about.
        ctx.drawImage(
          cell,
          0, VIEWPORT_TOP, GAME_WIDTH, CELL_H,
          LABEL_W + c * layout.cellW, y, layout.cellW, layout.cellH,
        )
      }
      row++
    }
  }

  return layout
}

/** Parse the sheet's configuration out of a URL query string. */
export function matrixOptionsFromSearch(search: string): Partial<MatrixOptions> {
  const q = new URLSearchParams(search)
  const out: Partial<MatrixOptions> = {}

  const surface = q.get('surface')
  if (surface && ['asphalt', 'snow', 'ice', 'sand', 'mud'].includes(surface)) {
    out.surface = surface as Surface
  }

  // Read through a helper rather than Number(q.get(...)) directly: Number(null)
  // and Number('') are both 0, so an absent parameter would look like a supplied
  // zero and silently override whatever the default becomes later.
  const num = (key: string): number | null => {
    const raw = q.get(key)?.trim()
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }

  const curvature = num('curve')
  if (curvature !== null) out.curvature = Math.max(-2, Math.min(2, curvature))

  const playerX = num('lane')
  if (playerX !== null) out.playerX = Math.max(-1, Math.min(1, playerX))

  const vehicleX = num('vx')
  if (vehicleX !== null) out.vehicleX = Math.max(0, Math.min(1, vehicleX))

  const zoom = num('zoom')
  if (zoom !== null && Number.isInteger(zoom) && zoom >= 1 && zoom <= 8) out.zoom = zoom

  if (q.get('truck') === '0') out.showTruck = false

  const types = q.get('types')?.split(',').filter(t => (MATRIX_TYPES as readonly string[]).includes(t))
  if (types?.length) out.types = types as VehicleType[]

  const dirs = q.get('dirs')?.split(',').filter(d => (MATRIX_DIRS as readonly string[]).includes(d))
  if (dirs?.length) out.dirs = dirs as TrafficDir[]

  const distances = q.get('dist')?.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0)
  if (distances?.length) out.distances = distances

  return out
}

/** True when the URL asks for the contact sheet instead of the game. */
export function isMatrixRequested(search: string): boolean {
  return new URLSearchParams(search).get('matrix') === '1'
}

/**
 * `?outline=0` draws traffic without its dark outline and contact shadow.
 *
 * Opt-*out*, unlike every other switch here: the outline is the intended look,
 * and the flag exists so the same frame can be captured both ways. Only the
 * exact string `0` turns it off — a typo should not silently change the picture
 * a judgement is about to be made on.
 */
export function contourEnabledFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('outline') !== '0'
}
