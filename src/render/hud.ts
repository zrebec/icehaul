import {
  C, CELL,
  drawText, drawDial, drawSegmentedBar, drawFrame,
} from 'zx-kit'
import { GAME_HEIGHT, GAME_WIDTH, HUD_ROWS, MAX_SPEED } from '../config.ts'

/**
 * Bottom instrument cluster — 3 equal-width panels in 9 rows (72 px):
 *   Left:   FUEL + compass + GRIP (no labels, widgets speak for themselves)
 *   Centre: speed dial
 *   Right:  mission info (placeholder for phase 1)
 */
export function drawHUD(
  ctx: CanvasRenderingContext2D,
  state: {
    speed: number
    heading?: number
    fuelPct?: number
    gripPct?: number
    missionText?: string
    missionDist?: number
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

// ── Left panel: FUEL + compass + GRIP (no labels) ──────────────────────────

function drawInstrumentsPanel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  state: { heading?: number; fuelPct?: number; gripPct?: number },
): void {
  const fuelPct = state.fuelPct ?? 0.75
  const gripPct = state.gripPct ?? 0.87
  const heading = state.heading ?? 0

  // FUEL bar — horizontal, top third
  const fuelSegs = 6
  const fuelY = y + 6
  drawText(ctx, 'E', x + 2, fuelY, C.B_RED, C.BLACK)
  drawSegmentedBar(ctx, {
    x: x + 10, y: fuelY,
    segments: fuelSegs,
    value: Math.round(fuelPct * fuelSegs), max: fuelSegs,
    segmentWidth: 6, segmentHeight: 8, gap: 1,
    color: C.B_YELLOW, paper: C.BLACK,
    orientation: 'horizontal',
  })
  drawText(ctx, 'F', x + 10 + fuelSegs * 7 + 2, fuelY, C.B_GREEN, C.BLACK)

  // Compass — middle third. Show 3 directions: prev CURRENT next.
  // drawCompassText (5 dirs) overflows 85px panel, so we render manually.
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
  const compassY = y + 26
  const idx = Math.round(((heading % 360 + 360) % 360) / 45) % 8
  const prev = dirs[(idx + 7) % 8]!
  const curr = dirs[idx]!
  const next = dirs[(idx + 1) % 8]!
  const label = `${prev} ${curr} ${next}`
  const labelX = x + Math.floor((w - label.length * CELL) / 2)
  drawText(ctx, prev, labelX, compassY, C.B_WHITE, C.BLACK)
  drawText(ctx, curr, labelX + (prev.length + 1) * CELL, compassY, C.B_YELLOW, C.BLACK)
  drawText(ctx, next, labelX + (prev.length + 1 + curr.length + 1) * CELL, compassY, C.B_WHITE, C.BLACK)

  // GRIP — two small vertical bars, bottom third
  const gripSegs = 6
  const segH = 3
  const gap = 1
  const totalH = gripSegs * segH + (gripSegs - 1) * gap
  const gripY = y + h - totalH - 4
  const gripX = x + Math.floor((w - 20) / 2)
  const val = Math.round(gripPct * gripSegs)

  for (let strip = 0; strip < 2; strip++) {
    drawSegmentedBar(ctx, {
      x: gripX + strip * 12, y: gripY,
      segments: gripSegs, value: val, max: gripSegs,
      segmentWidth: 6, segmentHeight: segH, gap,
      colors: [C.B_RED, C.B_YELLOW, C.B_GREEN],
      paper: C.BLACK, orientation: 'vertical',
    })
  }
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
  state: { missionText?: string; missionDist?: number },
): void {
  const text = state.missionText ?? 'FREE DRIVE'
  const dist = state.missionDist

  drawFrame(ctx, { x: x + 2, y: y + 4, width: w - 4, height: h - 8, color: C.B_WHITE })

  const textX = x + Math.max(2, Math.floor((w - text.length * CELL) / 2))
  drawText(ctx, text, textX, y + 10, C.B_CYAN, C.BLACK)

  if (dist != null) {
    const distStr = `${dist.toFixed(1)}km`
    const distX = x + Math.floor((w - distStr.length * CELL) / 2)
    drawText(ctx, distStr, distX, y + 28, C.B_YELLOW, C.BLACK)
  }
}
