import { C, type GlowSource, type SpectrumColor } from 'zx-kit'
import {
  type Surface,
  GAME_WIDTH, HORIZON_PCT,
  LATERAL_SHIFT, PERSPECTIVE_K,
  TRAFFIC_SCALE_A, TRAFFIC_SCALE_B,
  TRAFFIC_VIEW_DISTANCE_M,
  ROAD_HALF_TOP, ROAD_HALF_BOTTOM,
  KERB_WIDTH_BOTTOM, KERB_WIDTH_TOP,
} from '../config.ts'
import { computeCurveOffsets } from './projection.ts'
import { rasteriseVehicleAtScale } from './vehicleRaster.ts'
import { applyFarLamps, chooseLodTier, type LodTier } from './vehicleLod.ts'
import { CONTOUR_CHAR, type VehicleContour } from './vehicleContour.ts'
// Circular by design, the same shape as `vehicleRaster.ts` above: the glow needs
// the art to find the lamps, the renderer needs the glow to place them. Both
// sides only read through functions, so nothing is touched at module load.
import { isGlowEnabled, pushTrafficLampSpots } from './vehicleGlow.ts'
import {
  visibleMarkers, visibleKerbStripes, visibleCentreDashes,
  kerbDetailScanline, centreDetailScanline,
} from './roadpattern.ts'

// ── Star field ──────────────────────────────────────────────────────────────

const STAR_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [10, 4], [44, 6], [90, 3], [136, 8], [180, 5], [230, 7], [248, 4],
  [22, 10], [68, 12], [118, 14], [168, 10], [214, 13],
  [34, 18], [76, 16], [128, 20], [172, 18], [220, 16],
]

export function drawStarField(
  ctx: CanvasRenderingContext2D,
  viewportTop: number,
  viewportBottom: number,
): void {
  const horizonY = viewportTop + Math.floor((viewportBottom - viewportTop) * HORIZON_PCT)
  ctx.fillStyle = C.B_WHITE
  for (const [sx, sy] of STAR_POSITIONS) {
    const y = viewportTop + sy
    if (y < horizonY && sx < GAME_WIDTH) ctx.fillRect(sx, y, 1, 1)
  }
}

// ── Kerb colours ────────────────────────────────────────────────────────────

const KERB_A: SpectrumColor = C.B_WHITE
const KERB_B: SpectrumColor = C.B_YELLOW
/** Kerb beyond the resolvable distance: one flat colour, dimmed to read as depth. */
const KERB_FAR: SpectrumColor = C.WHITE
/** Centre line beyond the resolvable distance — solid, dimmed, same reason. */
const CENTRE_FAR: SpectrumColor = C.WHITE
const CENTRE_NEAR: SpectrumColor = C.B_WHITE
const MARKER_COLOR: SpectrumColor = C.WHITE

// ── Road ────────────────────────────────────────────────────────────────────

export function drawRoad(
  ctx: CanvasRenderingContext2D,
  viewportTop: number,
  viewportBottom: number,
  cameraDistance: number,
  playerX: number,
  getSurface: (distM: number) => Surface,
  getCurvature: (distM: number) => number,
): void {
  const horizonY = viewportTop + Math.floor((viewportBottom - viewportTop) * HORIZON_PCT)
  const roadHeight = viewportBottom - horizonY
  const scanlines = roadHeight - 1

  const baseVanX = GAME_WIDTH / 2 - playerX * LATERAL_SHIFT

  ctx.fillStyle = C.BLUE
  ctx.fillRect(0, horizonY, GAME_WIDTH, 1)

  const curveOffset = computeCurveOffsets(cameraDistance, scanlines, getCurvature)

  // ── Pass 0: per-scanline geometry ──
  // Cached once so the pattern passes below can address any scanline directly
  // instead of re-deriving edges while walking world indices.
  const leftX = new Int16Array(scanlines)
  const rightX = new Int16Array(scanlines)
  const centreX = new Int16Array(scanlines)
  const kerbW = new Int16Array(scanlines)

  for (let i = 0; i < scanlines; i++) {
    const t = (i + 1) / roadHeight
    const half = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * t
    const cx = baseVanX + (curveOffset[i] ?? 0)
    leftX[i] = Math.round(cx - half)
    rightX[i] = Math.round(cx + half)
    centreX[i] = Math.round(cx)
    kerbW[i] = Math.max(1, Math.round(KERB_WIDTH_TOP + (KERB_WIDTH_BOTTOM - KERB_WIDTH_TOP) * t))
  }

  // ── Pass 1: surface ──
  for (let i = 0; i < scanlines; i++) {
    const dy = i + 1
    const absDist = cameraDistance + PERSPECTIVE_K / dy
    const l = leftX[i] ?? 0
    const r = rightX[i] ?? 0
    drawSurfaceScanline(ctx, getSurface(absDist), left(l), clampW(l, r), horizonY + dy, absDist)
  }

  // ── Pass 2: kerb stripes ──
  // Flat colour where a 2 m stripe would be sub-pixel, real stripes below that.
  // The flat fill covers every scanline so the stripe spans can only paint over
  // it — no seam is possible between the two regions.
  ctx.fillStyle = KERB_FAR
  for (let dy = 1; dy <= scanlines; dy++) drawKerbPair(ctx, dy, horizonY, leftX, rightX, kerbW)

  for (const stripe of visibleKerbStripes(cameraDistance, scanlines)) {
    ctx.fillStyle = stripe.alt ? KERB_B : KERB_A
    for (let dy = stripe.fromDy; dy <= stripe.toDy; dy++) {
      drawKerbPair(ctx, dy, horizonY, leftX, rightX, kerbW)
    }
  }

  // ── Pass 3: segment markers ──
  // One line per world marker, thickened upward by the painted band's depth.
  ctx.fillStyle = MARKER_COLOR
  for (const marker of visibleMarkers(cameraDistance, scanlines)) {
    for (let k = 0; k < marker.thicknessPx; k++) {
      const dy = marker.dy - k
      if (dy < 1) break
      const i = dy - 1
      const ml = Math.max(0, (leftX[i] ?? 0) + 2)
      const mr = Math.min(GAME_WIDTH, (rightX[i] ?? 0) - 1)
      if (mr > ml) ctx.fillRect(ml, horizonY + dy, mr - ml, 1)
    }
  }

  // ── Pass 4: centre line ──
  // Solid where the dashes would be sub-pixel — which is how a dashed line
  // reads at distance anyway — then real dashes nearer the camera.
  const centreDetail = centreDetailScanline()
  ctx.fillStyle = CENTRE_FAR
  for (let dy = 1; dy < centreDetail && dy <= scanlines; dy++) {
    drawCentrePixel(ctx, dy, horizonY, centreX)
  }

  ctx.fillStyle = CENTRE_NEAR
  for (const dash of visibleCentreDashes(cameraDistance, scanlines)) {
    for (let dy = dash.fromDy; dy <= dash.toDy; dy++) {
      drawCentrePixel(ctx, dy, horizonY, centreX)
    }
  }
}

/** Paints both kerbs on one scanline in the current fillStyle. */
function drawKerbPair(
  ctx: CanvasRenderingContext2D,
  dy: number,
  horizonY: number,
  leftX: Int16Array,
  rightX: Int16Array,
  kerbW: Int16Array,
): void {
  const i = dy - 1
  const y = horizonY + dy
  const w = kerbW[i] ?? 1
  const kl = (leftX[i] ?? 0) - w
  const kr = (rightX[i] ?? 0) + 1
  if (kl + w > 0 && kl < GAME_WIDTH) ctx.fillRect(Math.max(0, kl), y, Math.min(w, GAME_WIDTH - kl), 1)
  if (kr >= 0 && kr < GAME_WIDTH) ctx.fillRect(kr, y, Math.min(w, GAME_WIDTH - kr), 1)
}

/** Paints the centre-line pixel on one scanline in the current fillStyle. */
function drawCentrePixel(
  ctx: CanvasRenderingContext2D,
  dy: number,
  horizonY: number,
  centreX: Int16Array,
): void {
  const cx = centreX[dy - 1] ?? 0
  if (cx >= 0 && cx < GAME_WIDTH) ctx.fillRect(cx, horizonY + dy, 1, 1)
}

// ── Surface scanline renderers ──────────────────────────────────────────────

function drawSurfaceScanline(
  ctx: CanvasRenderingContext2D,
  surface: Surface,
  x: number, w: number, y: number,
  absDist: number,
): void {
  if (w <= 0) return
  const phase = Math.floor(absDist * 5)

  switch (surface) {
    case 'asphalt':
      ctx.fillStyle = C.BLACK
      ctx.fillRect(x, y, w, 1)
      break

    case 'ice':
      ctx.fillStyle = (y + phase) % 4 < 2 ? C.B_CYAN : C.CYAN
      ctx.fillRect(x, y, w, 1)
      if (y % 5 === 0) {
        ctx.fillStyle = C.B_WHITE
        for (let px = x + 6; px < x + w - 6; px += 14) ctx.fillRect(px, y, 1, 1)
      }
      break

    case 'snow':
      ctx.fillStyle = (y + phase) % 3 === 0 ? C.WHITE : C.B_WHITE
      ctx.fillRect(x, y, w, 1)
      break

    case 'sand':
      ctx.fillStyle = (y + phase) % 3 === 0 ? C.YELLOW : C.B_YELLOW
      ctx.fillRect(x, y, w, 1)
      break

    case 'mud':
      // Dithered RED + YELLOW → ZX colour-clash "brown"
      ctx.fillStyle = (y + phase) % 2 === 0 ? C.RED : C.YELLOW
      ctx.fillRect(x, y, w, 1)
      break
  }
}

// ── Fuel canister rendering ──────────────────────────────────────────────────

import type { Canister } from '../game/canisters.ts'
import type { RoadsideObject, RoadsideType } from '../game/roadside.ts'
import type { TrafficVehicle, VehicleType } from '../game/traffic.ts'
import { DECIDUOUS_ROWS, DECIDUOUS_COLORS, DECIDUOUS_W, DECIDUOUS_H } from './sprites/deciduous.ts'
import { CONIFER_ROWS, CONIFER_COLORS, CONIFER_W, CONIFER_H } from './sprites/conifer.ts'
import { ROCKS_ROWS, ROCKS_COLORS, ROCKS_W, ROCKS_H } from './sprites/rocks.ts'
import { SIGNPOST_ROWS, SIGNPOST_COLORS, SIGNPOST_W, SIGNPOST_H } from './sprites/signpost.ts'
import {
  SAME_MINI_ROWS, ONCOMING_MINI_ROWS, SAME_CAR_ROWS, ONCOMING_CAR_ROWS,
  SAME_BUS_ROWS, ONCOMING_BUS_ROWS,
  SAME_MINI_COLORS, ONCOMING_MINI_COLORS, SAME_CAR_COLORS, ONCOMING_CAR_COLORS,
  SAME_BUS_COLORS, ONCOMING_BUS_COLORS,
  type RowColors,
} from './sprites/vehicles.ts'

/**
 * Draws fuel canisters on the road in perspective. Call AFTER drawRoad.
 * Each canister: small red rectangle with yellow cap — visible from afar.
 */
export function drawCanisters(
  ctx: CanvasRenderingContext2D,
  viewportTop: number,
  viewportBottom: number,
  cameraDistance: number,
  playerX: number,
  canisters: readonly Canister[],
  getCurvature: (distM: number) => number,
): void {
  const horizonY = viewportTop + Math.floor((viewportBottom - viewportTop) * HORIZON_PCT)
  const roadHeight = viewportBottom - horizonY
  const scanlines = roadHeight - 1
  const baseVanX = GAME_WIDTH / 2 - playerX * LATERAL_SHIFT

  const curveOffset = computeCurveOffsets(cameraDistance, scanlines, getCurvature)

  for (const can of canisters) {
    const worldZ = can.distM - cameraDistance
    if (worldZ < 2 || worldZ > PERSPECTIVE_K) continue

    // Inverse perspective: which scanline does this world-Z map to?
    const dy = PERSPECTIVE_K / worldZ
    const i = Math.round(dy) - 1
    if (i < 0 || i >= scanlines) continue

    const y = horizonY + i + 1
    const t = (i + 1) / roadHeight
    const half = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * t
    const centerX = baseVanX + (curveOffset[i] ?? 0)

    // Canister x position on the road
    const screenX = Math.round(centerX + can.x * half)
    if (screenX < 0 || screenX >= GAME_WIDTH) continue

    // Size scales with perspective
    const size = Math.max(1, Math.round(3 * t))

    // Red body + yellow cap
    ctx.fillStyle = C.B_RED
    ctx.fillRect(screenX - size, y - size * 2, size * 2, size * 2)
    ctx.fillStyle = C.B_YELLOW
    ctx.fillRect(screenX - size, y - size * 2 - 1, size * 2, 1)
  }
}

// ── Traffic vehicle rendering ────────────────────────────────────────────────

/**
 * Draw traffic vehicles in perspective. Call AFTER drawRoad, BEFORE drawTruck.
 * Same-direction traffic: rear views. Oncoming traffic: front views with headlights.
 *
 * `glowOut` collects the lamp haloes of everything actually drawn, for the
 * caller to blit once the rest of the scene is down. It is filled here rather
 * than re-derived later because this is the only place that knows which vehicles
 * survived projection and clipping — and projecting them a second time to find
 * out would be two answers to one question.
 */
export function drawTraffic(
  ctx: CanvasRenderingContext2D,
  viewportTop: number,
  viewportBottom: number,
  cameraDistance: number,
  playerX: number,
  vehicles: readonly TrafficVehicle[],
  getCurvature: (distM: number) => number,
  glowOut?: GlowSource[],
): void {
  const glowSink = glowOut && isGlowEnabled() ? glowOut : null

  for (const v of vehicles) {
    const p = projectTrafficVehicle(viewportTop, viewportBottom, cameraDistance, playerX, v, getCurvature)
    if (!p) continue
    if (p.x < -20 || p.x > GAME_WIDTH + 20) continue

    if (glowSink) pushTrafficLampSpots(glowSink, p, v.dir)

    if (v.dir === 'oncoming') {
      drawOncomingVehicle(ctx, p)
    } else {
      drawSameDirVehicle(ctx, p)
    }
  }
}

export interface TrafficProjection {
  x: number
  y: number
  left: number
  top: number
  w: number
  h: number
  scale: number
  type: VehicleType
  /** Which drawing was used — see `vehicleLod.ts`. */
  lod: LodTier
  /**
   * The pixels, one raster cell per screen pixel. Carried on the projection so
   * the renderer and the collision check cannot end up with different ones —
   * they used to re-derive it from `w`/`h`, which stopped being enough once the
   * sprite was sampled at a fractional scale and two frames of the same integer
   * size could hold different drawings.
   */
  raster: readonly string[]
  /**
   * Dark outline and contact shadow, drawn behind the vehicle. Separate from
   * `raster` so the collision check cannot see it — see `vehicleContour.ts`.
   */
  contour: VehicleContour | null
}

const TRAFFIC_PASS_BEHIND_M = 5

// Same inverse-perspective formula as canisters and roadside objects:
//   i = round(PERSPECTIVE_K / worldZ) - 1
// This maps worldZ correctly to scanline: distant objects cluster near the
// horizon (scanline 0) and rush downward in the final metres — giving true
// perspective acceleration and ensuring canisters + traffic share the same
// depth ordering on screen.
function trafficDepthToScanline(worldZ: number, scanlines: number): number | null {
  if (worldZ <= 0) return scanlines - 1
  if (worldZ > TRAFFIC_VIEW_DISTANCE_M) return null
  const i = Math.round(PERSPECTIVE_K / worldZ) - 1
  return Math.max(0, Math.min(scanlines - 1, i))
}

export function projectTrafficVehicle(
  viewportTop: number,
  viewportBottom: number,
  cameraDistance: number,
  playerX: number,
  vehicle: TrafficVehicle,
  getCurvature: (distM: number) => number,
): TrafficProjection | null {
  const horizonY = viewportTop + Math.floor((viewportBottom - viewportTop) * HORIZON_PCT)
  const roadHeight = viewportBottom - horizonY
  const scanlines = roadHeight - 1
  const worldZ = vehicle.distM - cameraDistance
  if (worldZ < -TRAFFIC_PASS_BEHIND_M || worldZ > TRAFFIC_VIEW_DISTANCE_M) return null

  if (worldZ <= 0) {
    const pass = Math.min(1, -worldZ / TRAFFIC_PASS_BEHIND_M)
    const half = ROAD_HALF_BOTTOM
    const centerX = GAME_WIDTH / 2 - playerX * LATERAL_SHIFT
    const x = Math.round(centerX + vehicle.x * half)
    const y = Math.round(viewportBottom - 1 + pass * 14)
    // Continue the depth curve from where it ends at worldZ = 0, so a vehicle
    // does not change size on the frame it draws level with the player.
    const scale = TRAFFIC_SCALE_A / TRAFFIC_SCALE_B + pass * 0.15

    // Beside or behind the player: always the detailed drawing.
    vehicle.lodTier = 'detail'
    const drawn = scaleTrafficSprite(vehicle.dir, vehicle.type, scale, x, y, 'detail')
    if (!drawn) return null
    return { x, y, scale, type: vehicle.type, ...drawn }
  }

  const projectedScanline = trafficDepthToScanline(worldZ, scanlines)
  if (projectedScanline === null) return null
  const i = Math.min(scanlines - 1, projectedScanline)

  const baseVanX = GAME_WIDTH / 2 - playerX * LATERAL_SHIFT
  // Accumulating from the bottom down to scanline `i` is exactly curveOffset[i].
  const curveOffset = computeCurveOffsets(cameraDistance, scanlines, getCurvature)[i] ?? 0

  const y = horizonY + i + 1
  const t = (i + 1) / roadHeight
  const half = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * t
  const x = Math.round(baseVanX + curveOffset + vehicle.x * half)
  // Scale from true world depth (1/z), not clamped scanline — stays monotonic
  // even for vehicles beyond PERSPECTIVE_K where multiple worldZ values share scanline 0.
  // Hyperbolic in true world depth — see TRAFFIC_SCALE_* in config.ts. The screen
  // projection cannot carry this: PERSPECTIVE_K = 150 puts 220 m, 75 m and 50 m on
  // scanlines 1, 2 and 3, so the whole far field lives in two pixels of height and
  // no function of the scanline can spread it.
  const scale = TRAFFIC_SCALE_A / (worldZ + TRAFFIC_SCALE_B)

  const drawn = scaleTrafficSprite(vehicle.dir, vehicle.type, scale, x, y, vehicle.lodTier)
  if (!drawn) return null
  // Remembered on the vehicle so the choice can be hysteretic. Idempotent within
  // a frame: update and render both project, and the second call sees a settled
  // tier and keeps it.
  vehicle.lodTier = drawn.lod

  return { x, y, scale, type: vehicle.type, ...drawn }
}

/**
 * The sprite at this scale, its screen box, and which tier it ended up in.
 *
 * The tier is decided *after* rasterising, because the projected height is now
 * read off the raster rather than computed ahead of it. That costs nothing: the
 * far tier only recolours, so both tiers have the same silhouette and the same
 * height, and the second lookup is a cache hit from the first frame onward.
 */
function scaleTrafficSprite(
  dir: TrafficVehicle['dir'],
  type: VehicleType,
  scale: number,
  x: number,
  y: number,
  previousTier: LodTier | undefined,
): {
  left: number; top: number; w: number; h: number
  lod: LodTier; raster: readonly string[]; contour: VehicleContour | null
} | null {
  const key = `${dir}:${type}`
  const rows = getTrafficSpriteRows(dir, type)
  const detail = rasteriseVehicleAtScale(key, rows, scale, x, y)
  if (!detail) return null

  const lod = chooseLodTier(detail.h, previousTier)
  if (lod === 'detail') return { ...detail, lod }

  const far = rasteriseVehicleAtScale(
    `${key}:far`, rows, scale, x, y, raster => applyFarLamps(raster, dir),
  )
  return far ? { ...far, lod } : { ...detail, lod: 'detail' }
}

function drawSameDirVehicle(ctx: CanvasRenderingContext2D, p: TrafficProjection): void {
  drawVehicleContour(ctx, p)
  drawTrafficRows(ctx, p.raster, getTrafficSpriteColors('same', p.type), p)
}

function drawOncomingVehicle(ctx: CanvasRenderingContext2D, p: TrafficProjection): void {
  drawVehicleContour(ctx, p)
  drawTrafficRows(ctx, p.raster, getTrafficSpriteColors('oncoming', p.type), p)
}

/**
 * The dark pass, painted before the vehicle so the body covers any cell the two
 * disagree about. Drawn per vehicle rather than as one sweep over all of them:
 * traffic is painted far to near, and a global pass would let a nearer vehicle's
 * outline sit on top of a farther one's body.
 */
function drawVehicleContour(ctx: CanvasRenderingContext2D, p: TrafficProjection): void {
  if (!p.contour || !contourEnabled) return
  const { rows, dx, dy } = p.contour
  ctx.fillStyle = C.BLACK
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!
    let x = 0
    while (x < row.length) {
      if (row[x] !== CONTOUR_CHAR) { x++; continue }
      let run = 1
      while (x + run < row.length && row[x + run] === CONTOUR_CHAR) run++
      ctx.fillRect(p.left + dx + x, p.top + dy + y, run, 1)
      x += run
    }
  }
}

/**
 * `?outline=0` turns the dark pass off for an instant A/B, the same way the
 * contact sheet is used to judge every other visual change here. It is a module
 * flag rather than a parameter because it exists to be compared, not tuned.
 */
let contourEnabled = true

export function setContourEnabled(on: boolean): void {
  contourEnabled = on
}

export function isContourEnabled(): boolean {
  return contourEnabled
}

// The sprite's own dimensions are no longer declared separately from its art:
// the drawn size is `ceil(sourceDimension * scale)`, read straight off the rows.
// A table that had to be kept in step with the pixel data could only ever drift.

// The art itself lives in `sprites/vehicles.ts`, next to the roadside sprites
// and away from the renderer that draws it. Read the header there before
// changing a pixel: the drawings follow rules the resampler and the far LOD
// tier depend on.

export function getTrafficSpriteRows(dir: TrafficVehicle['dir'], type: VehicleType): readonly string[] {
  if (dir === 'oncoming') {
    switch (type) {
      case 'mini': return ONCOMING_MINI_ROWS
      case 'car': return ONCOMING_CAR_ROWS
      case 'bus': return ONCOMING_BUS_ROWS
    }
  }

  switch (type) {
    case 'mini': return SAME_MINI_ROWS
    case 'car': return SAME_CAR_ROWS
    case 'bus': return SAME_BUS_ROWS
  }
}

function getTrafficSpriteColors(dir: TrafficVehicle['dir'], type: VehicleType): RowColors {
  if (dir === 'oncoming') {
    switch (type) {
      case 'mini': return ONCOMING_MINI_COLORS
      case 'car': return ONCOMING_CAR_COLORS
      case 'bus': return ONCOMING_BUS_COLORS
    }
  }

  switch (type) {
    case 'mini': return SAME_MINI_COLORS
    case 'car': return SAME_CAR_COLORS
    case 'bus': return SAME_BUS_COLORS
  }
}

/** Minimal placement box for scaled row-string sprites (TrafficProjection fits). */
interface SpriteBox { left: number; top: number; w: number; h: number }

function drawTrafficRows(
  ctx: CanvasRenderingContext2D,
  raster: readonly string[],
  colors: RowColors,
  p: SpriteBox,
): void {
  // `raster` is already the projected size: one raster pixel is one screen pixel.
  // There is no scaling arithmetic left here, and therefore none left to disagree
  // with the collision check, which reads the very same raster. The measurements
  // behind that change are in vehicleRaster.ts.
  for (let y = 0; y < raster.length; y++) {
    const row = raster[y]!
    let x = 0
    while (x < row.length) {
      const char = row[x]!
      const color = colors[char]
      if (!color) { x++; continue }
      // Equal-coloured runs go out as one fillRect rather than one per pixel.
      let run = 1
      while (x + run < row.length && row[x + run] === char) run++
      ctx.fillStyle = color
      ctx.fillRect(p.left + x, p.top + y, run, 1)
      x += run
    }
  }
}

/** Fraction of a target cell that must be opaque for it to be drawn at all. */
const COVERAGE_THRESHOLD = 0.2

/**
 * Resample a character sprite to exactly `targetW × targetH`.
 *
 * Each target cell covers a rectangle of the source, and every source pixel it
 * touches votes **by how much of that pixel actually falls inside** — the
 * dominant colour by area wins, and the cell is dropped when opaque area is
 * under {@link COVERAGE_THRESHOLD}.
 *
 * ── Why the weighting is not optional ───────────────────────────────────────
 * Counting each touched pixel once instead was stable at plain ratios and wrong
 * everywhere else. Scaling 22 px to 21, most target cells sit inside one source
 * pixel, but each cell whose interval straddles a boundary took *both* pixels at
 * equal weight — a local 2:1 downscale inside an otherwise 1:1 image. That was
 * measurable twice over:
 *
 * - **A step that grew the sprite past 1:1 replaced a quarter of the picture.**
 *   The inflation vanished in a single frame at `w = srcW`. Weighting removes
 *   the whole excess: no size step now changes the picture more than an eight-
 *   times finer source would force (worst 13.6 pp of excess → 0.5 pp).
 * - **Rasters were far off the source.** 16.5% of a car's picture wrong at a
 *   typical width, against 11.2% weighted — and what was wrong was silhouette:
 *   a 20%-covered edge cell counted as a full pixel, so every downscale drew the
 *   vehicle fatter than it is.
 *
 * The dominant-colour vote is unchanged and still loses small features to
 * bodywork; that is the far tier's job, not this function's.
 */
export function scaleRoadsideRows(
  rows: readonly string[],
  targetW: number,
  targetH: number,
): string[] {
  const srcH = rows.length
  const srcW = rows[0]?.length ?? 0
  if (srcW === 0 || srcH === 0 || targetW <= 0 || targetH <= 0) return []

  return resampleRows(rows, {
    w: targetW, h: targetH,
    x0: 0, y0: 0,
    stepX: srcW / targetW, stepY: srcH / targetH,
  })
}

/**
 * Where each target cell reads from, in source coordinates.
 *
 * Splitting this out from {@link scaleRoadsideRows} is what lets a sprite be
 * sampled at a size the integer grid cannot express. `scaleRoadsideRows` fits a
 * sprite to a whole number of cells, so the only way it can grow is a whole
 * column at a time; a grid whose `step` and origin are free can put the sprite's
 * edge *between* cells, and then growth arrives one pixel at a time as each edge
 * cell in turn crosses {@link COVERAGE_THRESHOLD}. See `vehicleRaster.ts`.
 */
interface SampleGrid {
  /** Target cells across and down. */
  w: number
  h: number
  /** Source coordinate at the left/top edge of target cell 0. May be negative. */
  x0: number
  y0: number
  /** Source units spanned by one target cell. `1 / scale` for a uniform scale. */
  stepX: number
  stepY: number
}

function resampleRows(rows: readonly string[], grid: SampleGrid): string[] {
  const srcH = rows.length
  const srcW = rows[0]?.length ?? 0
  if (srcW === 0 || srcH === 0 || grid.w <= 0 || grid.h <= 0) return []

  // The denominator is the cell's **whole** area, not the part of it that found
  // source pixels to sample. A cell straddling the sprite's edge is mostly
  // outside it, and counting only the inside would let a sliver of bodywork fill
  // the cell — the same "drawn fatter than it is" fault the area weighting was
  // introduced to remove, reappearing at the silhouette instead of inside it.
  const cellArea = grid.stepX * grid.stepY
  if (cellArea <= 0) return []

  const scaled: string[] = []
  for (let dy = 0; dy < grid.h; dy++) {
    const top = grid.y0 + dy * grid.stepY
    const bottom = top + grid.stepY
    let row = ''

    for (let dx = 0; dx < grid.w; dx++) {
      const left = grid.x0 + dx * grid.stepX
      const right = left + grid.stepX
      const area = new Map<string, number>()
      let opaque = 0

      for (let sy = Math.max(0, Math.floor(top)); sy < Math.min(Math.ceil(bottom), srcH); sy++) {
        const rowOverlap = Math.min(bottom, sy + 1) - Math.max(top, sy)
        if (rowOverlap <= 0) continue
        const sourceRow = rows[sy]!

        for (let sx = Math.max(0, Math.floor(left)); sx < Math.min(Math.ceil(right), srcW); sx++) {
          const colOverlap = Math.min(right, sx + 1) - Math.max(left, sx)
          if (colOverlap <= 0) continue

          const char = sourceRow[sx] ?? '.'
          if (char === '.') continue

          const covered = colOverlap * rowOverlap
          opaque += covered
          area.set(char, (area.get(char) ?? 0) + covered)
        }
      }

      if (opaque / cellArea < COVERAGE_THRESHOLD) {
        row += '.'
        continue
      }

      let winner = ''
      let winnerArea = 0
      for (const [char, covered] of area) {
        if (covered > winnerArea) {
          winner = char
          winnerArea = covered
        }
      }
      row += winner || '.'
    }
    scaled.push(row)
  }

  return scaled
}

/**
 * Resample a sprite at a **fractional** size, anchored bottom-centre.
 *
 * The box is `ceil(span)` cells on each axis and the sprite sits inside it at a
 * fractional offset, so growing `scale` by a hair moves one edge cell past the
 * coverage threshold and lights *it* — not the whole column its neighbours
 * share. That is where the pixel-at-a-time growth comes from.
 *
 * ── Why the box is not simply centred on the anchor ─────────────────────────
 * Centring it exactly forces an even width. `floor(x - span/2)` and
 * `ceil(x + span/2)` are mirror images about a whole pixel, so the box can only
 * ever be `2 * ceil(span / 2)` wide — it grows two columns at a time, which is
 * twice as coarse as the quantisation this function exists to remove.
 *
 * Rounding the box's left edge instead lets the width follow `ceil(span)`, and
 * the vehicle grows alternately leftward and rightward as the parity changes.
 * The cost is that the drawn centre sits within half a pixel of the anchor
 * rather than exactly on it, which is below what the display can show — and the
 * vertical axis needs none of this, being anchored on an edge and not a centre.
 */
export function resampleSpriteAtScale(
  rows: readonly string[],
  scale: number,
  anchorX: number,
  anchorBottomY: number,
): { raster: string[]; left: number; top: number; w: number; h: number } | null {
  const srcH = rows.length
  const srcW = rows[0]?.length ?? 0
  if (srcW === 0 || srcH === 0 || scale <= 0) return null

  const spanW = srcW * scale
  const spanH = srcH * scale
  const w = Math.max(1, Math.ceil(spanW))
  const h = Math.max(1, Math.ceil(spanH))

  // Where the sprite's own edges sit inside the box, in cells.
  const insetX = (w - spanW) / 2
  const insetY = h - spanH

  const raster = resampleRows(rows, {
    w, h,
    x0: -insetX / scale,
    y0: -insetY / scale,
    stepX: 1 / scale,
    stepY: 1 / scale,
  })
  if (raster.length === 0) return null

  return {
    raster,
    left: anchorX - Math.round(w / 2),
    top: anchorBottomY - h,
    w, h,
  }
}

function drawRoadsideRows(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  colors: RowColors,
  p: SpriteBox,
): void {
  const scaled = scaleRoadsideRows(rows, p.w, p.h)
  for (let y = 0; y < scaled.length; y++) {
    const row = scaled[y]!
    for (let x = 0; x < row.length; x++) {
      const color = colors[row[x]!]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(p.left + x, p.top + y, 1, 1)
    }
  }
}

// ── Roadside objects rendering ───────────────────────────────────────────────

interface RoadsideSprite { rows: readonly string[]; colors: RowColors; w: number; h: number }

// Imported sprite per scenery kind (`lamp` stays procedural — no sprite). On-screen
// size derives from each sprite's own W/H, so relative sizes come from the art itself
// (see docs/sprites.md), scaled by ROADSIDE_WORLD_UNIT × perspective depth.
const ROADSIDE_SPRITES: Record<Exclude<RoadsideType, 'lamp'>, RoadsideSprite> = {
  deciduous: { rows: DECIDUOUS_ROWS, colors: DECIDUOUS_COLORS, w: DECIDUOUS_W, h: DECIDUOUS_H },
  conifer:   { rows: CONIFER_ROWS,   colors: CONIFER_COLORS,   w: CONIFER_W,   h: CONIFER_H },
  rocks:     { rows: ROCKS_ROWS,     colors: ROCKS_COLORS,     w: ROCKS_W,     h: ROCKS_H },
  sign:      { rows: SIGNPOST_ROWS,  colors: SIGNPOST_COLORS,  w: SIGNPOST_W,  h: SIGNPOST_H },
}

/** Sprite-pixel → screen-pixel size at full perspective depth (scale = 1). Tune for legibility. */
const ROADSIDE_WORLD_UNIT = 0.55

/**
 * Draw roadside decorations (trees, rocks, signs, lampposts) in perspective.
 * Call AFTER drawRoad, BEFORE drawCanisters/drawTruck.
 */
export function drawRoadsideObjects(
  ctx: CanvasRenderingContext2D,
  viewportTop: number,
  viewportBottom: number,
  cameraDistance: number,
  playerX: number,
  objects: readonly RoadsideObject[],
  getCurvature: (distM: number) => number,
): void {
  const horizonY = viewportTop + Math.floor((viewportBottom - viewportTop) * HORIZON_PCT)
  const roadHeight = viewportBottom - horizonY
  const scanlines = roadHeight - 1
  const baseVanX = GAME_WIDTH / 2 - playerX * LATERAL_SHIFT

  const curveOffset = computeCurveOffsets(cameraDistance, scanlines, getCurvature)

  for (const obj of objects) {
    const worldZ = obj.distM - cameraDistance
    if (worldZ < 3 || worldZ > PERSPECTIVE_K) continue

    const dy = PERSPECTIVE_K / worldZ
    const i = Math.round(dy) - 1
    if (i < 0 || i >= scanlines) continue

    const y = horizonY + i + 1
    const t = (i + 1) / roadHeight
    const half = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * t
    const centerX = baseVanX + (curveOffset[i] ?? 0)

    // Position outside the road edge
    const edgeX = obj.side === -1
      ? centerX - half - obj.offset * half
      : centerX + half + obj.offset * half
    const screenX = Math.round(edgeX)

    if (screenX < -90 || screenX > GAME_WIDTH + 90) continue

    // Perspective depth scale: small far at the horizon → large up close.
    const scale = Math.max(0.15, t)

    if (obj.type === 'lamp') {
      drawLamp(ctx, screenX, y, scale)
      continue
    }
    // Size from the sprite's own dimensions × world unit × depth — keeps aspect and
    // relative sizes (a 56-tall tree is naturally bigger than 24-tall rocks).
    const spr = ROADSIDE_SPRITES[obj.type]
    const w = Math.max(2, Math.round(spr.w * ROADSIDE_WORLD_UNIT * scale))
    const h = Math.max(2, Math.round(spr.h * ROADSIDE_WORLD_UNIT * scale))
    drawRoadsideRows(ctx, spr.rows, spr.colors, { left: screenX - (w >> 1), top: y - h, w, h })
  }
}

function drawLamp(ctx: CanvasRenderingContext2D, x: number, baseY: number, scale: number): void {
  const h = Math.round(12 * scale)
  // Pole
  ctx.fillStyle = C.WHITE
  ctx.fillRect(x, baseY - h, 1, h)
  // Light
  ctx.fillStyle = C.B_YELLOW
  const lightW = Math.max(1, Math.round(2 * scale))
  ctx.fillRect(x - Math.floor(lightW / 2), baseY - h - 1, lightW, 1)
  // Glow pixel
  if (scale > 0.5) {
    ctx.fillRect(x - Math.floor(lightW / 2), baseY - h - 2, lightW, 1)
  }
}

function left(x: number): number { return Math.max(0, x) }
function clampW(l: number, r: number): number {
  const cl = Math.max(0, l)
  const cr = Math.min(GAME_WIDTH, r + 1)
  return Math.max(0, cr - cl)
}
