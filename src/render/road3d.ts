import { C, type GlowSource, type SpectrumColor } from 'zx-kit'
import {
  type Surface,
  GAME_WIDTH, HORIZON_PCT,
  LATERAL_SHIFT, PERSPECTIVE_K,
  TRAFFIC_SCALE_A, TRAFFIC_SCALE_B,
  TRAFFIC_CANONICAL_SIZE,
  TRAFFIC_VIEW_DISTANCE_M,
  SCENERY_CANONICAL_SIZE, SCENERY_SCALE_NEAR_Z_M, SCENERY_VIEW_DISTANCE_M,
  ROAD_HALF_TOP, ROAD_HALF_BOTTOM,
  KERB_WIDTH_BOTTOM, KERB_WIDTH_TOP,
} from '../config.ts'
import { computeCurveOffsets } from './projection.ts'
import { projectedVehicleSize, rasteriseVehicleAtScale } from './vehicleRaster.ts'
import { scaleRoadsideRows } from './spriteRaster.ts'
export { scaleRoadsideRows, resampleSpriteAtScale } from './spriteRaster.ts'
import { chooseLodTier, type LodTier } from './vehicleLod.ts'
import { CONTOUR_CHAR, type VehicleContour } from './vehicleContour.ts'
import {
  getRoadsideSprite, getTrafficSprite, roadsideSpriteName, trafficSpriteName,
} from './sprites/catalog.ts'
import {
  chooseSceneryLod, rasteriseRoadsideAtScale, roadsideScaleForDepth,
} from './roadsideRaster.ts'
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

type RowColors = Readonly<Record<string, SpectrumColor>>

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

  // Painter's order: furthest first, so a near vehicle covers a far one.
  //
  // This used to draw in spawn order, which is *nearest* first among the traffic
  // ahead — exactly backwards — so a distant car was painted over the bus in
  // front of it and read as being through it. Reported from a playtest: "vidím
  // aj zelené auto pred autobusom bez toho aby som predbehol autobus". Sorting a
  // copy, because the caller's array is the live traffic list.
  const ordered = [...vehicles].sort((a, b) => b.distM - a.distM)

  for (const v of ordered) {
    const p = projectTrafficVehicle(viewportTop, viewportBottom, cameraDistance, playerX, v, getCurvature)
    if (!p) continue
    if (p.x < -20 || p.x > GAME_WIDTH + 20) continue

    if (glowSink) pushTrafficLampSpots(glowSink, p, v.dir, v.braking === true)

    if (v.dir === 'oncoming') {
      drawOncomingVehicle(ctx, p)
    } else {
      drawSameDirVehicle(ctx, p, v.braking === true)
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

    // Beside or behind the player: always the authored near drawing.
    vehicle.lodTier = 'near'
    const drawn = scaleTrafficSprite(vehicle.dir, vehicle.type, scale, x, y, 'near')
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
 * The tier is decided from the canonical physical span *before* rasterising.
 * Authored resolution therefore cannot move a boundary or change the box: the
 * selected far/mid/near grid is only a source sampled into that fixed span.
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
  const physicalSize = TRAFFIC_CANONICAL_SIZE[type]
  const projected = projectedVehicleSize(physicalSize, scale)
  if (!projected) return null

  const lod = chooseLodTier(projected.h, previousTier)
  const sprite = getTrafficSprite(dir, type, lod)
  const drawn = rasteriseVehicleAtScale(
    trafficSpriteName(dir, type, lod), sprite.rows, scale, x, y,
    { physicalSize, priorityChars: [dir === 'same' ? 'R' : 'Y'] },
  )
  return drawn ? { ...drawn, lod } : null
}

function drawSameDirVehicle(
  ctx: CanvasRenderingContext2D,
  p: TrafficProjection,
  braking = false,
): void {
  drawVehicleContour(ctx, p)
  drawRasterRows(ctx, p.raster, getTrafficSprite('same', p.type, p.lod, braking).colors, p)
}

function drawOncomingVehicle(ctx: CanvasRenderingContext2D, p: TrafficProjection): void {
  drawVehicleContour(ctx, p)
  drawRasterRows(ctx, p.raster, getTrafficSprite('oncoming', p.type, p.lod).colors, p)
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

// Physical dimensions and art resolution are deliberately separate. The
// canonical 14x11 / 22x15 / 28x18 boxes drive projection and collision; an
// authored far, mid or near grid is only sampled into that box.

// Compatibility accessors for diagnostics that inspect source art directly.
// Runtime rendering uses `getTrafficSprite` with the projection's selected tier.
export function getTrafficSpriteRows(
  dir: TrafficVehicle['dir'],
  type: VehicleType,
  lod: LodTier = 'mid',
): readonly string[] {
  return getTrafficSprite(dir, type, lod).rows
}

/**
 * `braking` swaps the tail lamps from `RED` to `B_RED` — the ZX BRIGHT bit, and
 * a change in the framebuffer rather than in the bloom, so it survives
 * `?glow=0`. All three same-direction vehicles have it since the bus was
 * repainted yellow; before that its `B_RED` bodywork made a bright red lamp a
 * brake light nobody could see. Oncoming vehicles still have no brake state at
 * all — their lamps face away from whatever they are doing.
 */
export function getTrafficSpriteColors(
  dir: TrafficVehicle['dir'],
  type: VehicleType,
  braking = false,
  lod: LodTier = 'mid',
): RowColors {
  return getTrafficSprite(dir, type, lod, braking).colors
}

/** Minimal placement box for scaled row-string sprites (TrafficProjection fits). */
interface SpriteBox { left: number; top: number; w: number; h: number }

function drawRasterRows(
  ctx: CanvasRenderingContext2D,
  raster: readonly string[],
  colors: RowColors,
  p: SpriteBox,
): void {
  // The raster is already projected: one raster pixel is one screen pixel.
  // Equal-mark runs reduce canvas calls without changing any ZX cell.
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

// ── Roadside objects rendering ───────────────────────────────────────────────

export interface RoadsideProjection {
  readonly x: number
  readonly y: number
  readonly left: number
  readonly top: number
  readonly w: number
  readonly h: number
  readonly worldZ: number
  readonly scale: number
  readonly type: RoadsideType
  readonly lod: LodTier
  readonly raster: readonly string[]
  readonly colors: RowColors
}

/**
 * Project all visible scenery once, in painter's order. Source grids are chosen
 * after physical scale, so the three authored resolutions cannot move an object.
 */
export function projectRoadsideObjects(
  viewportTop: number,
  viewportBottom: number,
  cameraDistance: number,
  playerX: number,
  objects: readonly RoadsideObject[],
  getCurvature: (distM: number) => number,
): RoadsideProjection[] {
  const horizonY = viewportTop + Math.floor((viewportBottom - viewportTop) * HORIZON_PCT)
  const roadHeight = viewportBottom - horizonY
  const scanlines = roadHeight - 1
  const baseVanX = GAME_WIDTH / 2 - playerX * LATERAL_SHIFT
  const curveOffset = computeCurveOffsets(cameraDistance, scanlines, getCurvature)
  const projected: RoadsideProjection[] = []

  for (const object of [...objects].sort((a, b) => b.distM - a.distM)) {
    const worldZ = object.distM - cameraDistance
    if (worldZ < SCENERY_SCALE_NEAR_Z_M || worldZ > SCENERY_VIEW_DISTANCE_M) continue

    const i = Math.max(0, Math.min(scanlines - 1, Math.round(PERSPECTIVE_K / worldZ) - 1))
    const y = horizonY + i + 1
    const t = (i + 1) / roadHeight
    const half = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * t
    const centerX = baseVanX + (curveOffset[i] ?? 0)
    const edgeX = object.side === -1
      ? centerX - half - object.offsetRoadWidths * half
      : centerX + half + object.offsetRoadWidths * half
    const x = Math.round(edgeX)

    const scale = roadsideScaleForDepth(worldZ)
    const lod = chooseSceneryLod(scale)
    const sprite = getRoadsideSprite(object.type, lod)
    const raster = rasteriseRoadsideAtScale(
      roadsideSpriteName(object.type, lod),
      sprite.rows,
      scale,
      x,
      y,
      SCENERY_CANONICAL_SIZE[object.type],
      object.type === 'lamp' ? ['Y'] : [],
    )
    if (!raster) continue
    projected.push({
      x, y, worldZ, scale, type: object.type, lod, colors: sprite.colors,
      ...raster,
    })
  }
  return projected
}

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
  for (const projection of projectRoadsideObjects(
    viewportTop, viewportBottom, cameraDistance, playerX, objects, getCurvature,
  )) {
    if (projection.left + projection.w < 0 || projection.left >= GAME_WIDTH) continue
    drawRasterRows(ctx, projection.raster, projection.colors, projection)
  }
}

function left(x: number): number { return Math.max(0, x) }
function clampW(l: number, r: number): number {
  const cl = Math.max(0, l)
  const cr = Math.min(GAME_WIDTH, r + 1)
  return Math.max(0, cr - cl)
}
