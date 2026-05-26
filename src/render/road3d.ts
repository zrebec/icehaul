import { C, type SpectrumColor } from 'zx-kit'
import {
  type Surface,
  GAME_WIDTH, HORIZON_PCT,
  LATERAL_SHIFT, CURVE_STRENGTH, PERSPECTIVE_K,
  ROAD_HALF_TOP, ROAD_HALF_BOTTOM,
  KERB_STRIPE_M, KERB_WIDTH_BOTTOM, KERB_WIDTH_TOP,
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
  const phase = Math.floor(absDist * 2)

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
 * Same-direction cars: green/yellow. Oncoming cars: white (headlights).
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
  const horizonY = viewportTop + Math.floor((viewportBottom - viewportTop) * HORIZON_PCT)
  const roadHeight = viewportBottom - horizonY
  const scanlines = roadHeight - 1
  const baseVanX = GAME_WIDTH / 2 - playerX * LATERAL_SHIFT

  // Curve offsets
  const curveOffset = new Float32Array(scanlines)
  let acc = 0
  for (let i = scanlines - 1; i >= 0; i--) {
    const distFromBottom = (scanlines - 1 - i) / scanlines
    const dy = i + 1
    acc += getCurvature(cameraDistance + PERSPECTIVE_K / dy) * CURVE_STRENGTH * distFromBottom
    curveOffset[i] = acc
  }

  for (const v of vehicles) {
    const worldZ = v.distM - cameraDistance
    if (worldZ < 3 || worldZ > PERSPECTIVE_K) continue

    const dy = PERSPECTIVE_K / worldZ
    const i = Math.round(dy) - 1
    if (i < 0 || i >= scanlines) continue

    const y = horizonY + i + 1
    const t = (i + 1) / roadHeight
    const half = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * t
    const centerX = baseVanX + (curveOffset[i] ?? 0)
    const screenX = Math.round(centerX + v.x * half)

    if (screenX < -20 || screenX > GAME_WIDTH + 20) continue

    const scale = Math.max(0.3, t)

    if (v.dir === 'oncoming') {
      drawOncomingVehicle(ctx, screenX, y, scale, v.type)
    } else {
      drawSameDirVehicle(ctx, screenX, y, scale, v.type)
    }
  }
}

function drawSameDirVehicle(
  ctx: CanvasRenderingContext2D, x: number, baseY: number, scale: number, type: VehicleType,
): void {
  const isTruck = type === 'truck'
  const w = Math.max(3, Math.round((isTruck ? 16 : 12) * scale))
  const h = Math.max(4, Math.round((isTruck ? 22 : 14) * scale))

  // Body
  ctx.fillStyle = isTruck ? C.B_YELLOW : C.B_GREEN
  ctx.fillRect(x - Math.floor(w / 2), baseY - h, w, h)

  // Roof (darker, narrower)
  const roofW = Math.max(1, w - 2)
  ctx.fillStyle = isTruck ? C.YELLOW : C.GREEN
  ctx.fillRect(x - Math.floor(roofW / 2), baseY - h - Math.max(1, Math.round(2 * scale)), roofW, Math.max(1, Math.round(2 * scale)))

  // Taillights (red dots)
  if (scale > 0.4) {
    ctx.fillStyle = C.B_RED
    ctx.fillRect(x - Math.floor(w / 2), baseY - 1, 1, 1)
    ctx.fillRect(x + Math.floor(w / 2) - 1, baseY - 1, 1, 1)
  }
}

function drawOncomingVehicle(
  ctx: CanvasRenderingContext2D, x: number, baseY: number, scale: number, type: VehicleType,
): void {
  const isTruck = type === 'truck'
  const w = Math.max(3, Math.round((isTruck ? 16 : 12) * scale))
  const h = Math.max(4, Math.round((isTruck ? 22 : 14) * scale))

  // Body (darker — seen from front)
  ctx.fillStyle = C.WHITE
  ctx.fillRect(x - Math.floor(w / 2), baseY - h, w, h)

  // Windscreen
  const wsW = Math.max(1, w - 2)
  ctx.fillStyle = C.CYAN
  ctx.fillRect(x - Math.floor(wsW / 2), baseY - h + Math.max(1, Math.round(2 * scale)), wsW, Math.max(1, Math.round(2 * scale)))

  // Headlights (bright yellow — the key visual cue for oncoming)
  if (scale > 0.35) {
    ctx.fillStyle = C.B_YELLOW
    ctx.fillRect(x - Math.floor(w / 2), baseY - Math.round(2 * scale), Math.max(1, Math.round(2 * scale)), Math.max(1, Math.round(scale)))
    ctx.fillRect(x + Math.floor(w / 2) - Math.max(1, Math.round(2 * scale)), baseY - Math.round(2 * scale), Math.max(1, Math.round(2 * scale)), Math.max(1, Math.round(scale)))
  }
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
