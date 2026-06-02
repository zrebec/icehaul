import {
  C, CELL,
  drawText, drawDial, drawSegmentedBar,
} from 'zx-kit'
import { GAME_HEIGHT, GAME_WIDTH, HUD_ROWS, MAX_SPEED, TRUCK_WEIGHT_T, GEAR_COUNT } from '../config.ts'

/**
 * Bottom instrument cluster — 3 equal-width panels in 9 rows (72 px):
 *   Left:   FUEL + RPM + GEAR + GRIP (drivetrain readouts, short labels)
 *   Centre: speed dial
 *   Right:  mission info (placeholder for phase 1)
 */
export function drawHUD(
  ctx: CanvasRenderingContext2D,
  state: {
    speed: number
    rpm?: number
    gear?: number
    fuelPct?: number
    gripPct?: number
    missionText?: string
    missionDist?: number
    missionTimeLeft?: string
    buildNumber?: string
  },
): void {
  const hudY = GAME_HEIGHT - HUD_ROWS * CELL
  const hudH = HUD_ROWS * CELL
  const panelW = Math.floor(GAME_WIDTH / 3)  // 85
  const x0 = 0
  const x1 = panelW                           // 85
  const x2 = panelW * 2                       // 170

  ctx.fillStyle = C.BLACK
  ctx.fillRect(0, hudY, GAME_WIDTH, hudH)

  drawInstrumentsPanel(ctx, x0, hudY, panelW, hudH, state)
  drawSpeedPanel(ctx, x1, hudY, panelW, hudH, state.speed)
  drawMissionPanel(ctx, x2, hudY, GAME_WIDTH - x2, hudH, state)

  // Panel dividers + top border
  ctx.fillStyle = C.B_WHITE
  ctx.fillRect(x1, hudY, 1, hudH)
  ctx.fillRect(x2, hudY, 1, hudH)
  ctx.fillRect(0, hudY, GAME_WIDTH, 1)
}

// ── Left panel: FUEL + RPM + GEAR + GRIP (drivetrain) ───────────────────────

function drawInstrumentsPanel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, _w: number, _h: number,
  state: { fuelPct?: number; gripPct?: number; rpm?: number; gear?: number },
): void {
  const fuelPct = state.fuelPct ?? 0.75
  const gripPct = state.gripPct ?? 0.87
  const rpm = state.rpm ?? 0
  const gear = state.gear ?? 1

  // FUEL — horizontal, row 1
  const fuelSegs = 6
  const fuelY = y + 5
  drawText(ctx, 'E', x + 2, fuelY, C.B_RED, C.BLACK)
  drawSegmentedBar(ctx, {
    x: x + 10, y: fuelY,
    segments: fuelSegs, value: Math.round(fuelPct * fuelSegs), max: fuelSegs,
    segmentWidth: 6, segmentHeight: 8, gap: 1,
    color: C.B_YELLOW, paper: C.BLACK, orientation: 'horizontal',
  })
  drawText(ctx, 'F', x + 10 + fuelSegs * 7 + 2, fuelY, C.B_GREEN, C.BLACK)

  // RPM — horizontal, row 2. Green → yellow → red as revs climb to redline.
  const rpmSegs = 7
  const rpmY = y + 22
  drawText(ctx, 'RPM', x + 2, rpmY, C.B_WHITE, C.BLACK)
  drawSegmentedBar(ctx, {
    x: x + 28, y: rpmY,
    segments: rpmSegs, value: Math.round(rpm * rpmSegs), max: rpmSegs,
    segmentWidth: 6, segmentHeight: 8, gap: 1,
    colors: [C.B_GREEN, C.B_YELLOW, C.B_RED], paper: C.BLACK, orientation: 'horizontal',
  })

  // GEAR — row 3. Label + current gear over total.
  const gearY = y + 39
  drawText(ctx, 'GEAR', x + 2, gearY, C.B_WHITE, C.BLACK)
  drawText(ctx, String(gear), x + 42, gearY, C.B_CYAN, C.BLACK)
  drawText(ctx, `/${GEAR_COUNT}`, x + 50, gearY, C.WHITE, C.BLACK)

  // GRIP — horizontal, row 4. Single bar: red (low) → yellow → green (high).
  const gripSegs = 6
  const gripY = y + 56
  drawText(ctx, 'GRIP', x + 2, gripY, C.B_WHITE, C.BLACK)
  drawSegmentedBar(ctx, {
    x: x + 36, y: gripY,
    segments: gripSegs, value: Math.round(gripPct * gripSegs), max: gripSegs,
    segmentWidth: 6, segmentHeight: 8, gap: 1,
    colors: [C.B_RED, C.B_YELLOW, C.B_GREEN], paper: C.BLACK, orientation: 'horizontal',
  })
}

// ── Centre panel: speed dial ────────────────────────────────────────────────

function drawSpeedPanel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  speed: number,
): void {
  const cx = x + Math.floor(w / 2)
  const cy = y + Math.floor(h / 2) + 4
  const radius = 20

  drawDial(ctx, {
    cx, cy, radius,
    value: speed, min: 0, max: MAX_SPEED,
    needleColor: C.B_YELLOW, rimColor: C.B_WHITE,
    tickColor: C.B_WHITE, ticks: 5, faceColor: C.BLACK,
  })

  drawText(ctx, '0',   cx - radius - 4,  cy + radius - 2, C.B_WHITE, C.BLACK)
  drawText(ctx, '30',  cx - radius - 8,  cy - radius / 2, C.B_WHITE, C.BLACK)
  drawText(ctx, '60',  cx - 8,           cy - radius - 6, C.B_WHITE, C.BLACK)
  drawText(ctx, '90',  cx + radius - 4,  cy - radius / 2, C.B_WHITE, C.BLACK)
  drawText(ctx, '120', cx + radius - 10, cy + radius - 2, C.B_WHITE, C.BLACK)

  drawText(ctx, 'km/h', cx - 16, cy + 6, C.B_WHITE, C.BLACK)
}

// ── Right panel: mission info (placeholder) ─────────────────────────────────

function drawMissionPanel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  state: { missionText?: string; missionDist?: number; missionTimeLeft?: string; buildNumber?: string },
): void {
  const text = state.missionText ?? 'DELIVER'
  const dist = state.missionDist
  const timeLeft = state.missionTimeLeft

  // Line 1: mission label
  const textX = x + Math.max(2, Math.floor((w - text.length * CELL) / 2))
  drawText(ctx, text, textX, y + 8, C.B_CYAN, C.BLACK)

  // Line 2: remaining distance
  if (dist != null) {
    const distStr = `${dist.toFixed(1)}km`
    const distX = x + Math.floor((w - distStr.length * CELL) / 2)
    drawText(ctx, distStr, distX, y + 24, C.B_YELLOW, C.BLACK)
  }

  // Line 3: time remaining
  if (timeLeft) {
    const timeX = x + Math.floor((w - timeLeft.length * CELL) / 2)
    drawText(ctx, timeLeft, timeX, y + 40, C.B_WHITE, C.BLACK)
  }

  // Weight + build number — bottom area
  const wt = `${TRUCK_WEIGHT_T}t`
  drawText(ctx, wt, x + 2, y + h - 18, C.B_WHITE, C.BLACK)

  if (state.buildNumber) {
    const bld = `B${state.buildNumber}`
    drawText(ctx, bld, x + w - bld.length * CELL - 1, y + h - 9, C.WHITE, C.BLACK)
  }
}
