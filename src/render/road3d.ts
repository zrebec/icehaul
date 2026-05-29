import { C, type SpectrumColor } from 'zx-kit'
import {
  type Surface,
  GAME_WIDTH, HORIZON_PCT,
  LATERAL_SHIFT, CURVE_STRENGTH, PERSPECTIVE_K,
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
    if (kr >= 0 && kr < GAME_WIDTH)         ctx.fillRect(kr, y, Math.min(kerbW, GAME_WIDTH - kr), 1)

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
      ctx.fillStyle = C.BLUE
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
import type { RoadsideObject } from '../game/roadside.ts'
import type { TrafficVehicle, VehicleType } from '../game/traffic.ts'

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
  if (worldZ < -TRAFFIC_PASS_BEHIND_M || worldZ > PERSPECTIVE_K) return null

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

  const dy = PERSPECTIVE_K / worldZ
  const rawI = Math.round(dy) - 1
  if (rawI < 0) return null
  const i = Math.min(scanlines - 1, rawI)

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
  const scale = 0.35 + t * t * 1.1
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
  drawScaledRows(ctx, getTrafficSpriteRows('same', p.type), getTrafficSpriteColors('same', p.type), p)
}

function drawOncomingVehicle(ctx: CanvasRenderingContext2D, p: TrafficProjection): void {
  drawScaledRows(ctx, getTrafficSpriteRows('oncoming', p.type), getTrafficSpriteColors('oncoming', p.type), p)
}

function trafficSpriteSize(type: VehicleType): { w: number; h: number } {
  switch (type) {
    case 'mini': return { w: 14, h: 11 }
    case 'car':  return { w: 22, h: 15 }
    case 'bus':  return { w: 28, h: 18 }
  }
}

type RowColors = Record<string, SpectrumColor>

export function getTrafficSpriteRows(dir: TrafficVehicle['dir'], type: VehicleType): readonly string[] {
  if (dir === 'oncoming') {
    switch (type) {
      case 'mini': return ONCOMING_MINI_ROWS
      case 'car':  return ONCOMING_CAR_ROWS
      case 'bus':  return ONCOMING_BUS_ROWS
    }
  }

  switch (type) {
    case 'mini': return SAME_MINI_ROWS
    case 'car':  return SAME_CAR_ROWS
    case 'bus':  return SAME_BUS_ROWS
  }
}

function getTrafficSpriteColors(dir: TrafficVehicle['dir'], type: VehicleType): RowColors {
  if (dir === 'oncoming') {
    switch (type) {
      case 'mini': return ONCOMING_MINI_COLORS
      case 'car':  return ONCOMING_CAR_COLORS
      case 'bus':  return ONCOMING_BUS_COLORS
    }
  }

  switch (type) {
    case 'mini': return SAME_MINI_COLORS
    case 'car':  return SAME_CAR_COLORS
    case 'bus':  return SAME_BUS_COLORS
  }
}

function drawScaledRows(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  colors: RowColors,
  p: TrafficProjection,
): void {
  const srcH = rows.length
  const srcW = rows[0]?.length ?? 0
  const left = p.left
  const top = p.top

  for (let sy = 0; sy < srcH; sy++) {
    const row = rows[sy]!
    const y0 = top + Math.floor(sy * p.h / srcH)
    const y1 = top + Math.floor((sy + 1) * p.h / srcH)
    const ph = Math.max(1, y1 - y0)

    for (let sx = 0; sx < srcW; sx++) {
      const color = colors[row[sx]!]
      if (!color) continue
      const x0 = left + Math.floor(sx * p.w / srcW)
      const x1 = left + Math.floor((sx + 1) * p.w / srcW)
      ctx.fillStyle = color
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), ph)
    }
  }
}

const SAME_MINI_ROWS = [
  '...GGGGGG...',
  '..GCCCCCCG..',
  '.GGGGGGGGGG.',
  'GGGGGGGGGGGG',
  'GGG......GGG',
  'GG..RRRR..GG',
  'GGG..YY..GGG',
  '.BB......BB.',
  '.BB......BB.',
  '............',
] as const

const ONCOMING_MINI_ROWS = [
  '...WWWWWW...',
  '..WCCCCCCW..',
  '.WWWWWWWWWW.',
  'WWWWWWWWWWWW',
  'WW..BBBB..WW',
  'WY..BBBB..YW',
  'WW........WW',
  '.BB......BB.',
  '.BB......BB.',
  '............',
] as const

const SAME_CAR_ROWS = [
  '.....GGGGGGGG.....',
  '....GCCCCCCCCG....',
  '...GCCCCCCCCCCG...',
  '..GGGGGGGGGGGGGG..',
  '.GGGGGGGGGGGGGGGG.',
  'GGGGGGGGGGGGGGGGGG',
  'GGG............GGG',
  'GG...RRRRRRRR...GG',
  'GGG.....YY.....GGG',
  '.BBB..........BBB.',
  '.BBB..........BBB.',
  '..................',
] as const

const ONCOMING_CAR_ROWS = [
  '.....WWWWWWWW.....',
  '....WCCCCCCCCW....',
  '...WCCCCCCCCCCW...',
  '..WWWWWWWWWWWWWW..',
  '.WWWWWWWWWWWWWWWW.',
  'WWWBBBBBBBBBBBBWWW',
  'WWBBBBBBBBBBBBBBWW',
  'YYWWBBBBBBBBBBWWYY',
  'WWWWWWWWWWWWWWWWWW',
  '.BBBB........BBBB.',
  '.BBBB........BBBB.',
  '..................',
] as const

const SAME_BUS_ROWS = [
  '....RRRRRRRRRRRRRRRR....',
  '...RCCCCCCCCCCCCCCCCR...',
  '..RCCCCCCCCCCCCCCCCCCR..',
  '.RRCCCCCCCCCCCCCCCCCCRR.',
  'RRRRRRRRRRRRRRRRRRRRRRRR',
  'RRYYYYYYYYYYYYYYYYYYYYRR',
  'RRRRRRRRRRRRRRRRRRRRRRRR',
  'RRR..................RRR',
  'RR..RRRRRRRRRRRRRRRR..RR',
  'RR..RRRRRRRRRRRRRRRR..RR',
  'RR..RRRRRRRRRRRRRRRR..RR',
  'RRBBBBBBBBBBBBBBBBBBBBRR',
  'RRR....RRRRRRRRRR....RRR',
  '.BBBB..............BBBB.',
  '.BBBB..............BBBB.',
  '........................',
] as const

const ONCOMING_BUS_ROWS = [
  '....RRRRRRRRRRRRRRRR....',
  '...RCCCCCCCCCCCCCCCCR...',
  '..RCCCCCCCCCCCCCCCCCCR..',
  '.RRCCCCCCCCCCCCCCCCCCRR.',
  'RRRRRRRRRRRRRRRRRRRRRRRR',
  'RRRWWWWWWWWWWWWWWWWWWRRR',
  'RRRRRRRRRRRRRRRRRRRRRRRR',
  'RRBBBBBBBBBBBBBBBBBBBBRR',
  'YY..BBBBBBBBBBBBBBBB..YY',
  'RR....................RR',
  'RR..RRRRRRRRRRRRRRRR..RR',
  'RR..RRRRRRRRRRRRRRRR..RR',
  'RRR....RRRRRRRRRR....RRR',
  '.BBBB..............BBBB.',
  '.BBBB..............BBBB.',
  '........................',
] as const

const SAME_MINI_COLORS: RowColors = {
  G: C.B_GREEN, C: C.CYAN, R: C.B_RED, B: C.BLACK, Y: C.B_YELLOW,
}
const ONCOMING_MINI_COLORS: RowColors = {
  W: C.B_WHITE, C: C.CYAN, B: C.BLACK, Y: C.B_YELLOW,
}
const SAME_CAR_COLORS: RowColors = {
  G: C.B_GREEN, C: C.CYAN, R: C.B_RED, B: C.BLACK,
}
const ONCOMING_CAR_COLORS: RowColors = {
  W: C.B_WHITE, C: C.CYAN, B: C.BLACK, Y: C.B_YELLOW,
}
const SAME_BUS_COLORS: RowColors = {
  R: C.B_RED, C: C.CYAN, Y: C.B_YELLOW, B: C.BLACK,
}
const ONCOMING_BUS_COLORS: RowColors = {
  R: C.B_RED, C: C.CYAN, W: C.B_WHITE, B: C.BLACK, Y: C.B_YELLOW,
}

// ── Roadside objects rendering ───────────────────────────────────────────────

/**
 * Draw roadside decorations (trees, lampposts, signs) in perspective.
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

    if (screenX < -10 || screenX > GAME_WIDTH + 10) continue

    // Scale factor: 0 at horizon → 1 at bottom
    const scale = Math.max(0.3, t)

    switch (obj.type) {
      case 'tree':   drawTree(ctx, screenX, y, scale); break
      case 'lamp':   drawLamp(ctx, screenX, y, scale); break
      case 'sign':   drawSign(ctx, screenX, y, scale); break
    }
  }
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, baseY: number, scale: number): void {
  const h = Math.round(8 * scale)
  const w = Math.round(5 * scale)
  // Trunk
  ctx.fillStyle = C.RED
  ctx.fillRect(x, baseY - Math.round(2 * scale), Math.max(1, Math.round(scale)), Math.round(2 * scale))
  // Canopy — triangle approximation (3 horizontal strips)
  ctx.fillStyle = C.B_GREEN
  for (let row = 0; row < h; row++) {
    const rowW = Math.max(1, Math.round(w * (1 - row / h)))
    ctx.fillRect(x - Math.floor(rowW / 2), baseY - Math.round(2 * scale) - row, rowW, 1)
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

function drawSign(ctx: CanvasRenderingContext2D, x: number, baseY: number, scale: number): void {
  const poleH = Math.round(8 * scale)
  const signW = Math.max(2, Math.round(5 * scale))
  const signH = Math.max(2, Math.round(3 * scale))
  // Pole
  ctx.fillStyle = C.B_WHITE
  ctx.fillRect(x, baseY - poleH, 1, poleH)
  // Sign plate
  ctx.fillStyle = C.B_YELLOW
  ctx.fillRect(x - Math.floor(signW / 2), baseY - poleH - signH, signW, signH)
}

function left(x: number): number { return Math.max(0, x) }
function clampW(l: number, r: number): number {
  const cl = Math.max(0, l)
  const cr = Math.min(GAME_WIDTH, r + 1)
  return Math.max(0, cr - cl)
}
