import { C, type SpectrumColor } from 'zx-kit'
import {
  type Surface,
  GAME_WIDTH, HORIZON_PCT,
  LATERAL_SHIFT, CURVE_STRENGTH, PERSPECTIVE_K,
  TRAFFIC_VIEW_DISTANCE_M,
  ROAD_HALF_TOP, ROAD_HALF_BOTTOM,
  KERB_STRIPE_M, KERB_WIDTH_BOTTOM, KERB_WIDTH_TOP, ROAD_MARKER_SPACING_M,
} from '../config.ts'

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

  const curveOffset = new Float32Array(scanlines)
  let acc = 0
  for (let i = scanlines - 1; i >= 0; i--) {
    const distFromBottom = (scanlines - 1 - i) / scanlines
    const dy = i + 1
    const worldZ = PERSPECTIVE_K / dy
    const absDist = cameraDistance + worldZ
    acc += getCurvature(absDist) * CURVE_STRENGTH * distFromBottom
    curveOffset[i] = acc
  }

  for (let i = 0; i < scanlines; i++) {
    const dy = i + 1
    const y = horizonY + dy
    const worldZ = PERSPECTIVE_K / dy
    const absDist = cameraDistance + worldZ
    const surface = getSurface(absDist)

    const t = dy / roadHeight
    const half = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * t
    const centerX = baseVanX + (curveOffset[i] ?? 0)
    const leftX = Math.round(centerX - half)
    const rightX = Math.round(centerX + half)

    drawSurfaceScanline(ctx, surface, left(leftX), clampW(leftX, rightX), y, absDist)

    // Kerb stripes
    const stripeIdx = Math.floor(absDist / KERB_STRIPE_M)
    const kerbColor: SpectrumColor = stripeIdx % 2 === 0 ? KERB_A : KERB_B
    const kerbW = Math.max(1, Math.round(KERB_WIDTH_TOP + (KERB_WIDTH_BOTTOM - KERB_WIDTH_TOP) * t))
    ctx.fillStyle = kerbColor
    const kl = leftX - kerbW
    const kr = rightX + 1
    if (kl + kerbW > 0 && kl < GAME_WIDTH) ctx.fillRect(Math.max(0, kl), y, Math.min(kerbW, GAME_WIDTH - kl), 1)
    if (kr >= 0 && kr < GAME_WIDTH) ctx.fillRect(kr, y, Math.min(kerbW, GAME_WIDTH - kr), 1)

    // Road segment markers — horizontal lines that rush toward the player
    const markerPhase = absDist % ROAD_MARKER_SPACING_M
    if (markerPhase < 0.8) {
      ctx.fillStyle = C.WHITE
      const ml = Math.max(0, leftX + 2)
      const mr = Math.min(GAME_WIDTH, rightX - 1)
      if (mr > ml) ctx.fillRect(ml, y, mr - ml, 1)
    }

    // Centre dashed line
    if ((dy + Math.floor(cameraDistance * 8)) % 10 < 5) {
      const cx = Math.round(centerX)
      if (cx >= 0 && cx < GAME_WIDTH) {
        ctx.fillStyle = C.B_WHITE
        ctx.fillRect(cx, y, 1, 1)
      }
    }
  }
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

  // Re-compute curve offsets (same as drawRoad — needed for correct x placement)
  const curveOffset = new Float32Array(scanlines)
  let acc = 0
  for (let i = scanlines - 1; i >= 0; i--) {
    const distFromBottom = (scanlines - 1 - i) / scanlines
    const dy = i + 1
    const worldZ = PERSPECTIVE_K / dy
    acc += getCurvature(cameraDistance + worldZ) * CURVE_STRENGTH * distFromBottom
    curveOffset[i] = acc
  }

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
 */
export function drawTraffic(
  ctx: CanvasRenderingContext2D,
  viewportTop: number,
  viewportBottom: number,
  cameraDistance: number,
  playerX: number,
  vehicles: readonly TrafficVehicle[],
  getCurvature: (distM: number) => number,
): void {
  for (const v of vehicles) {
    const p = projectTrafficVehicle(viewportTop, viewportBottom, cameraDistance, playerX, v, getCurvature)
    if (!p) continue
    if (p.x < -20 || p.x > GAME_WIDTH + 20) continue

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
    const t = 1
    const pass = Math.min(1, -worldZ / TRAFFIC_PASS_BEHIND_M)
    const half = ROAD_HALF_BOTTOM
    const centerX = GAME_WIDTH / 2 - playerX * LATERAL_SHIFT
    const x = Math.round(centerX + vehicle.x * half)
    const y = Math.round(viewportBottom - 1 + pass * 14)
    const scale = 1.45 + pass * 0.15
    const dims = trafficSpriteSize(vehicle.type)
    const w = Math.max(3, Math.round(dims.w * scale))
    const h = Math.max(3, Math.round(dims.h * scale))

    return {
      x, y,
      left: x - Math.floor(w / 2),
      top: y - h,
      w, h, scale,
      type: vehicle.type,
    }
  }

  const projectedScanline = trafficDepthToScanline(worldZ, scanlines)
  if (projectedScanline === null) return null
  const i = Math.min(scanlines - 1, projectedScanline)

  const baseVanX = GAME_WIDTH / 2 - playerX * LATERAL_SHIFT
  let curveOffset = 0
  for (let ci = scanlines - 1; ci >= i; ci--) {
    const distFromBottom = (scanlines - 1 - ci) / scanlines
    const cdy = ci + 1
    curveOffset += getCurvature(cameraDistance + PERSPECTIVE_K / cdy) * CURVE_STRENGTH * distFromBottom
  }

  const y = horizonY + i + 1
  const t = (i + 1) / roadHeight
  const half = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * t
  const x = Math.round(baseVanX + curveOffset + vehicle.x * half)
  // Scale from true world depth (1/z), not clamped scanline — stays monotonic
  // even for vehicles beyond PERSPECTIVE_K where multiple worldZ values share scanline 0.
  const tScale = Math.min(1, (PERSPECTIVE_K / worldZ) / roadHeight)
  const scale = 0.28 + Math.pow(tScale, 0.5) * 1.15
  const dims = trafficSpriteSize(vehicle.type)
  const w = Math.max(3, Math.round(dims.w * scale))
  const h = Math.max(3, Math.round(dims.h * scale))

  return {
    x, y,
    left: x - Math.floor(w / 2),
    top: y - h,
    w, h, scale,
    type: vehicle.type,
  }
}

function drawSameDirVehicle(ctx: CanvasRenderingContext2D, p: TrafficProjection): void {
  drawTrafficRows(ctx, getTrafficSpriteRows('same', p.type), getTrafficSpriteColors('same', p.type), p)
}

function drawOncomingVehicle(ctx: CanvasRenderingContext2D, p: TrafficProjection): void {
  drawTrafficRows(ctx, getTrafficSpriteRows('oncoming', p.type), getTrafficSpriteColors('oncoming', p.type), p)
}

function trafficSpriteSize(type: VehicleType): { w: number; h: number } {
  switch (type) {
    case 'mini': return { w: 14, h: 11 }
    case 'car': return { w: 22, h: 15 }
    case 'bus': return { w: 28, h: 18 }
  }
}

type RowColors = Record<string, SpectrumColor>

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
  rows: readonly string[],
  colors: RowColors,
  p: SpriteBox,
): void {
  const srcH = rows.length
  const srcW = rows[0]?.length ?? 0

  for (let sy = 0; sy < srcH; sy++) {
    const row = rows[sy]!
    const y0 = p.top + Math.floor(sy * p.h / srcH)
    const y1 = p.top + Math.floor((sy + 1) * p.h / srcH)
    const ph = Math.max(1, y1 - y0)

    for (let sx = 0; sx < srcW; sx++) {
      const color = colors[row[sx]!]
      if (!color) continue
      const x0 = p.left + Math.floor(sx * p.w / srcW)
      const x1 = p.left + Math.floor((sx + 1) * p.w / srcW)
      ctx.fillStyle = color
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), ph)
    }
  }
}

export function scaleRoadsideRows(
  rows: readonly string[],
  targetW: number,
  targetH: number,
): string[] {
  const srcH = rows.length
  const srcW = rows[0]?.length ?? 0
  if (srcW === 0 || srcH === 0 || targetW <= 0 || targetH <= 0) return []

  const scaled: string[] = []
  for (let dy = 0; dy < targetH; dy++) {
    const sy0 = Math.floor(dy * srcH / targetH)
    const sy1 = Math.max(sy0 + 1, Math.ceil((dy + 1) * srcH / targetH))
    let row = ''

    for (let dx = 0; dx < targetW; dx++) {
      const sx0 = Math.floor(dx * srcW / targetW)
      const sx1 = Math.max(sx0 + 1, Math.ceil((dx + 1) * srcW / targetW))
      const counts = new Map<string, number>()
      let samples = 0
      let opaqueSamples = 0

      for (let sy = sy0; sy < Math.min(sy1, srcH); sy++) {
        const sourceRow = rows[sy]!
        for (let sx = sx0; sx < Math.min(sx1, srcW); sx++) {
          const char = sourceRow[sx] ?? '.'
          samples++
          if (char !== '.') opaqueSamples++
          counts.set(char, (counts.get(char) ?? 0) + 1)
        }
      }

      if (opaqueSamples / samples < 0.2) {
        row += '.'
        continue
      }

      let winner = ''
      let winnerCount = 0
      for (const [char, count] of counts) {
        if (char === '.') continue
        if (count > winnerCount) {
          winner = char
          winnerCount = count
        }
      }
      row += winner || '.'
    }
    scaled.push(row)
  }

  return scaled
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

const SAME_MINI_ROWS = [
  '...XXXXXXXX...',
  '..XXXXXXXXXX..',
  '.XXXWWWWXXXX..',
  '.XXXXXXXXXXXX.',
  'XXXXXXXXXXXXXX',
  'XXXXRRRRXXXXXX',
  'XXXRRRRRRXXXXX',
  'XXXXYYYYXXXXXX',
  '.XXBBXXXXBBXX.',
  '..BBB....BBB..',
  '..............',
] as const

const ONCOMING_MINI_ROWS = [
  '....XXXXXX....',
  '...XXXXXXXX...',
  '..XXWWWWWWXX..',
  '.XXWWWWWWWWXX.',
  'XXXXXXXXXXXXXX',
  'XXBBBXXBBBXXXX',
  'XYYBBXXBBYYXXX',
  '.XXXBBBBXXXX..',
  '.XXYYYYYYYYXX.',
  '..BB......BB..',
  '..............',
] as const

const SAME_CAR_ROWS = [
  '....XXXXXXXXXXXXXX....',
  '...XXXXXXXXXXXXXXXX...',
  '..XXXXWWWWWWXXXXXX....',
  '.XXXXXWWWWWWXXXXXXX...',
  '.XXXXXXXXXXXXXXXXXXX..',
  'XXXXXXXXXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXXXXXXXX',
  'XXXXXXRRRRRRRRXXXXXXX.',
  'XXXXXRRRRRRRRRRXXXXXX.',
  'XXXXXXXYYYYYYXXXXXXXX.',
  '.XXXXBBBBXXXXBBBBXXX..',
  '..XXXBBBBXXXXBBBBXX...',
  '..XXXXXX......XXXX....',
  '...BBBB......BBBB.....',
  '......................',
] as const

const ONCOMING_CAR_ROWS = [
  '.......XXXXXXXX.......',
  '.....XXXXXXXXXXXX.....',
  '....XXWWWWWWWWWWXX....',
  '...XXWWWWWWWWWWWWXX...',
  '..XXXXXXXXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXXXXXXXX.',
  'XXXBBBXXXXXXXXBBBXXXXX',
  'XXYYYYXXXXXXXXYYYYXXXX',
  'XXXYYYBBBBBBBBYYYXXXXX',
  '.XXXXBBBBBBBBBBXXXXXX.',
  '.XXXXXXYYYYYYXXXXXXXX.',
  '..XXXXYYYYYYYYXXXXXX..',
  '..BBBXXXXXXXXXXXXBBB..',
  '...BBB..........BBB...',
  '......................',
] as const

const SAME_BUS_ROWS = [
  '..XXXXXXXXXXXXXXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXXXXXXXXXXXXXX.',
  'XXXWWWWWWWWWWWWWWWWWWWWXXX..',
  'XXXWWWWWWWWWWWWWWWWWWWWXXX..',
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'XXYYXXYYXXYYXXYYXXYYXXYYXXXX',
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'XXXXRRRRRRRRRRRRRRRRRRXXXXXX',
  'XXXRRRRRRRRRRRRRRRRRRRRXXXXX',
  'XXXRRRRRRRRRRRRRRRRRRRRXXXXX',
  'XXXXXYYYYYYYYYYYYYYYYXXXXXXX',
  'XXXXBBBBXXXXXXXXBBBBXXXXXXX.',
  'XXXBBBBBBXXXXXXBBBBBBXXXX...',
  'XXXXBBBBXXXXXXXXBBBBXXXX....',
  '..XXXXXX........XXXXXX......',
  '...BBBB........BBBB.........',
  '............................',
] as const

const ONCOMING_BUS_ROWS = [
  '....XXXXXXXXXXXXXXXXXXXX....',
  '..XXXXXXXXXXXXXXXXXXXXXXXX..',
  '.XXWWWWWWWWWWWWWWWWWWWWWWXX.',
  'XXWWWWWWWWWWWWWWWWWWWWWWWWXX',
  'XXWWWWWWWWWWWWWWWWWWWWWWWWXX',
  'XXWWWWWWWWWWWWWWWWWWWWWWWWXX',
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'XXXBBBBBBBBBBBBBBBBBBBBBBXXX',
  'XXBBBBBBBBBBBBBBBBBBBBBBBBXX',
  'XXYYYBBBBBBBBBBBBBBBBBBYYYXX',
  'XYYYYYBBBBBBBBBBBBBBBBYYYYYX',
  'XXXXXXYYYYYYYYYYYYYYYYXXXXXX',
  'XXXXYYYYYYYYYYYYYYYYYYYYXXXX',
  'XXXBBBBXXXXXXXXXXXXBBBBXXXXX',
  'XXBBBBBBXXXXXXXXXXBBBBBBXXXX',
  '.XXXXXX............XXXXXX...',
  '..BBBB..............BBBB....',
  '............................',
] as const

const SAME_MINI_COLORS: RowColors = {
  X: C.B_GREEN, W: C.CYAN, R: C.B_RED, B: C.BLACK, Y: C.B_YELLOW,
}
const ONCOMING_MINI_COLORS: RowColors = {
  X: C.B_WHITE, W: C.CYAN, B: C.BLACK, Y: C.B_YELLOW,
}
const SAME_CAR_COLORS: RowColors = {
  X: C.B_GREEN, W: C.CYAN, R: C.B_RED, B: C.BLACK, Y: C.B_YELLOW,
}
const ONCOMING_CAR_COLORS: RowColors = {
  X: C.B_WHITE, W: C.CYAN, B: C.BLACK, Y: C.B_YELLOW,
}
const SAME_BUS_COLORS: RowColors = {
  X: C.B_RED, W: C.CYAN, Y: C.B_YELLOW, R: C.RED, B: C.BLACK,
}
const ONCOMING_BUS_COLORS: RowColors = {
  X: C.B_RED, W: C.CYAN, B: C.BLACK, Y: C.B_YELLOW,
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

  // Curve offsets (same accumulation as drawRoad)
  const curveOffset = new Float32Array(scanlines)
  let acc = 0
  for (let i = scanlines - 1; i >= 0; i--) {
    const distFromBottom = (scanlines - 1 - i) / scanlines
    const dy = i + 1
    acc += getCurvature(cameraDistance + PERSPECTIVE_K / dy) * CURVE_STRENGTH * distFromBottom
    curveOffset[i] = acc
  }

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
