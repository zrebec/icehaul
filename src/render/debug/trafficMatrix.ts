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

import { C, drawScanlines, type GlowSource } from 'zx-kit'
import {
  GAME_WIDTH, GAME_HEIGHT, VIEWPORT_TOP, VIEWPORT_BOTTOM,
  GLOW_ALPHA, SCANLINE_ALPHA, TRAFFIC_VIEW_DISTANCE_M,
  type Surface,
} from '../../config.ts'
import { drawRoad, drawTraffic, projectTrafficVehicle } from '../road3d.ts'
import { drawTruck, pushTruckLampSpots } from '../truck.ts'
import { renderLampGlow } from '../vehicleGlow.ts'
import type { TrafficVehicle, TrafficDir, VehicleType } from '../../game/traffic.ts'
import type { LodTier } from '../vehicleLod.ts'

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
  /**
   * Draw the game's scanline overlay on the finished sheet.
   *
   * Off by default so the reference sheets captured before it existed stay
   * comparable — but **on for anything about brightness**. The game draws
   * `drawScanlines(ctx, 0.7)` over every frame, which takes two of the four
   * device rows of each game pixel to 30%: the picture plays at 0.65 of what
   * this sheet showed, and the first glow pass was tuned against the 1.0.
   */
  scanlines: boolean
  /** Draw the player truck with its brake lights on. The brake is carried
   *  entirely by the glow, so it cannot be judged from a cruising frame. */
  brake: boolean
  /**
   * Draw the *traffic* with its brake lights on.
   *
   * The same hole `brake` was added to close, one vehicle further away: traffic
   * only brakes when the road ahead gives it a reason, so no static sheet could
   * ever show the state we most need to look at. Judging "is a brake light
   * readable at 200 m" without this means driving until a car happens to brake
   * at the right distance, which is not a measurement.
   */
  trafficBrake: boolean
}

export const MATRIX_DEFAULTS: MatrixOptions = {
  ...DEFAULT_SELECTION,
  surface: 'asphalt',
  curvature: 0,
  playerX: 0,
  zoom: 1,
  showTruck: true,
  vehicleX: 0.5,
  scanlines: false,
  brake: false,
  trafficBrake: false,
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
  type: VehicleType, dir: TrafficDir, distM: number, vehicleX: number, braking: boolean,
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
    braking,
  }
}

/** Refilled per cell, never reallocated. */
const glowSpots: GlowSource[] = []

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
): LodTier | undefined {
  const surfaceAt = () => opts.surface
  const curvatureAt = () => opts.curvature

  cellCtx.fillStyle = C.BLACK
  cellCtx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)

  // Reused across cells, like everything else here: one sheet is a few hundred
  // draws and none of them should be allocating.
  glowSpots.length = 0

  drawRoad(cellCtx, VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, opts.playerX, surfaceAt, curvatureAt)
  const vehicle = cellVehicle(type, dir, distM, opts.vehicleX, opts.trafficBrake)
  drawTraffic(
    cellCtx, VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, opts.playerX,
    [vehicle], curvatureAt, glowSpots,
  )
  if (opts.showTruck) {
    const truckX = GAME_WIDTH / 2 + opts.playerX * 50
    drawTruck(cellCtx, truckX, VIEWPORT_BOTTOM - 2, 0, 0, opts.brake)
    // The player's lamps are in every real frame, so they are in every cell too.
    // `?truck=0` takes the truck and its halo out together.
    pushTruckLampSpots(glowSpots, truckX, VIEWPORT_BOTTOM - 2, 0, 0, opts.brake)
  }
  renderLampGlow(cellCtx, glowSpots)
  return vehicle.lodTier
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
        const tier = renderCell(cellCtx, opts, type, dir, opts.distances[c]!)
        const x = LABEL_W + c * layout.cellW
        // Crop to the road viewport — the HUD is not what this sheet is about.
        ctx.drawImage(
          cell,
          0, VIEWPORT_TOP, GAME_WIDTH, CELL_H,
          x, y, layout.cellW, layout.cellH,
        )
        // Read back from the actual vehicle the renderer just projected. The
        // harness owns no scale law and cannot drift from the game unnoticed.
        drawTierBadge(ctx, tier, x, y)
      }
      row++
    }
  }

  // Last, over the whole sheet, exactly as `main.ts` draws it over the frame.
  // Applied to the *output* rows rather than to a cell before zooming: the game
  // darkens every other device row, so at any zoom half the rows of the final
  // image is the same 0.65 average brightness the player actually sees.
  if (opts.scanlines) drawScanlines(ctx, SCANLINE_ALPHA)

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
  if (q.get('scanlines') === '1') out.scanlines = true
  if (q.get('brake') === '1') out.brake = true
  if (q.get('trafficBrake') === '1') out.trafficBrake = true

  const types = q.get('types')?.split(',').filter(t => (MATRIX_TYPES as readonly string[]).includes(t))
  if (types?.length) out.types = types as VehicleType[]

  const dirs = q.get('dirs')?.split(',').filter(d => (MATRIX_DIRS as readonly string[]).includes(d))
  if (dirs?.length) out.dirs = dirs as TrafficDir[]

  if (q.get('lod') === '1') out.distances = trafficLodBoundaryDistances()

  // An explicit ladder wins over the generated boundary ladder. This makes
  // `lod=1` a useful default that can still be narrowed for a high-zoom crop.
  const distances = q.get('dist')?.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0)
  if (distances?.length) out.distances = distances

  return out
}

let lodBoundaryDistanceCache: readonly number[] | undefined

/**
 * Samples the real approach projector and returns the frame immediately before
 * and after every far/mid and mid/near handover for all three physical boxes.
 * Lazy by design: the normal game imports this debug module from `main.ts`, but
 * must not walk thousands of synthetic projection frames unless `?lod=1` asks.
 */
export function trafficLodBoundaryDistances(): readonly number[] {
  if (lodBoundaryDistanceCache) return lodBoundaryDistanceCache

  const found = new Set<number>()
  const stepM = 0.25
  const steps = Math.round((TRAFFIC_VIEW_DISTANCE_M - 2) / stepM)

  for (const type of MATRIX_TYPES) {
    const vehicle = cellVehicle(type, 'same', TRAFFIC_VIEW_DISTANCE_M, 0.5, false)
    let previousTier: LodTier | undefined
    let previousDistance = TRAFFIC_VIEW_DISTANCE_M

    for (let step = 0; step <= steps; step++) {
      const distance = TRAFFIC_VIEW_DISTANCE_M - step * stepM
      vehicle.distM = distance
      const projected = projectTrafficVehicle(
        VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, vehicle, () => 0,
      )
      if (!projected) continue
      if (previousTier && projected.lod !== previousTier) {
        found.add(previousDistance)
        found.add(distance)
      }
      previousTier = projected.lod
      previousDistance = distance
    }
  }

  lodBoundaryDistanceCache = Object.freeze([...found].sort((a, b) => b - a))
  return lodBoundaryDistanceCache
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

/** What `?glow=` asks for: whether lamps bloom at all, how strongly, how wide. */
export interface GlowSettings {
  enabled: boolean
  alpha: number
  radiusScale: number
}

/**
 * `?glow=0` off · `?glow=1` on · `?glow=0.5` on at that strength ·
 * `?glow=0.8,1.5` also half again the radius.
 *
 * Two dials rather than one because a bloom is judged on **how bright** and
 * **how big** independently, and needing a rebuild between two looks is how a
 * comparison gets lost. Anything at or above 1 in the first slot means "on"
 * rather than "alpha 1.0" — nobody types `?glow=1` wanting the screen white.
 *
 * A value that is not a number falls back to the default *on* rather than off:
 * a typo must not silently remove the thing a judgement is about to be made on.
 */
export function glowSettingsFromSearch(search: string): GlowSettings {
  const raw = new URLSearchParams(search).get('glow')?.trim()
  const off = { enabled: false, alpha: GLOW_ALPHA, radiusScale: 1 }
  if (!raw) return { enabled: true, alpha: GLOW_ALPHA, radiusScale: 1 }

  const [alphaRaw, radiusRaw] = raw.split(',')
  const value = Number(alphaRaw)
  if (!Number.isFinite(value)) return { enabled: true, alpha: GLOW_ALPHA, radiusScale: 1 }
  if (value <= 0) return off

  // The radius multiplier is clamped rather than trusted: it scales a cap, and
  // an unbounded one would put a halo across the whole viewport.
  const scale = Number(radiusRaw)
  const radiusScale = Number.isFinite(scale) && scale > 0 ? Math.min(4, scale) : 1

  return { enabled: true, alpha: value >= 1 ? GLOW_ALPHA : value, radiusScale }
}
