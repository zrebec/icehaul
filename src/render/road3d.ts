import { C, type SpectrumColor } from 'zx-kit'
import {
  GAME_WIDTH, HORIZON_PCT,
  LATERAL_SHIFT, CURVE_STRENGTH, PERSPECTIVE_K,
  ROAD_HALF_TOP, ROAD_HALF_BOTTOM,
  KERB_STRIPE_M, KERB_WIDTH_BOTTOM, KERB_WIDTH_TOP,
} from '../config.ts'
import type { Surface } from '../game/road.ts'

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

    if (surface === 'ice') {
      const phaseShift = Math.floor(absDist * 2)
      ctx.fillStyle = (y + phaseShift) % 4 < 2 ? C.B_CYAN : C.CYAN
      ctx.fillRect(left(leftX), y, clampW(leftX, rightX), 1)
      if (y % 5 === 0) {
        ctx.fillStyle = C.B_WHITE
        for (let x = leftX + 6; x < rightX - 6; x += 14) {
          if (x >= 0 && x < GAME_WIDTH) ctx.fillRect(x, y, 1, 1)
        }
      }
    } else {
      ctx.fillStyle = C.BLUE
      ctx.fillRect(left(leftX), y, clampW(leftX, rightX), 1)
    }

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

function left(x: number): number { return Math.max(0, x) }
function clampW(l: number, r: number): number {
  const cl = Math.max(0, l)
  const cr = Math.min(GAME_WIDTH, r + 1)
  return Math.max(0, cr - cl)
}
