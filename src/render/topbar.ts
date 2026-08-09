import { C, CELL, drawText, drawTextCentered } from 'zx-kit'
import { type Surface, COLS, GAME_WIDTH, STATUS_BAR_ROWS, CURVE_WARN_CURVATURE } from '../config.ts'
import type { DangerAhead } from '../game/road.ts'

function fmtKm(distM: number): string {
  return (distM / 1000).toFixed(1)
}

const SURFACE_WARN_LABEL: Record<Surface, string> = {
  asphalt: '', snow: 'SNOW', ice: 'ICE', sand: 'SAND', mud: 'MUD',
}

/**
 * `ICE 120m >>` — what it is, how far, and whether it bends.
 *
 * The distance is the point: the strip used to read identically at 220 m and at
 * 10 m, so it announced danger without ever saying when. Rounded to 10 m because
 * the player is reading a warning light, not a rangefinder, and a digit
 * twitching every frame is harder to read than a coarse one that is not.
 *
 * The arrow is only drawn for a bend sharp enough to matter — see
 * {@link CURVE_WARN_CURVATURE}. Doubled because one chevron at 8x8 in the ROM
 * font is easy to miss at a glance.
 */
export function formatDangerLabel(danger: DangerAhead): string {
  const label = SURFACE_WARN_LABEL[danger.surface]
  if (!label) return ''

  const metres = Math.max(0, Math.round(danger.distanceM / 10) * 10)
  let text = `${label} ${metres}m`
  if (Math.abs(danger.curvature) >= CURVE_WARN_CURVATURE) {
    text += danger.curvature < 0 ? ' <<' : ' >>'
  }
  return text
}

export function drawTopBar(
  ctx: CanvasRenderingContext2D,
  state: {
    distance: number
    score: number
    elapsedMs: number
    dangerAhead: DangerAhead | null
    iceAheadBlink: boolean
    lowFuel?: boolean
    lowFuelBlink?: boolean
  },
): void {
  const barH = STATUS_BAR_ROWS * CELL
  ctx.fillStyle = C.BLACK
  ctx.fillRect(0, 0, GAME_WIDTH, barH)

  const scoreStr = state.score.toString().padStart(6, '0')
  drawText(ctx, `SCORE ${scoreStr}`, 0, 0, C.B_WHITE, C.BLACK)

  const distStr = `DIST ${fmtKm(state.distance).padStart(5)}km`
  drawText(ctx, distStr, GAME_WIDTH - distStr.length * CELL, 0, C.B_WHITE, C.BLACK)

  const totalSec = Math.floor(state.elapsedMs / 1000)
  const mm = Math.floor(totalSec / 60).toString().padStart(2, '0')
  const ss = (totalSec % 60).toString().padStart(2, '0')
  drawText(ctx, `TIME ${mm}:${ss}`, 0, CELL, C.B_WHITE, C.BLACK)

  // Right side of row 2: danger ahead OR low fuel warning
  if (state.lowFuel && state.lowFuelBlink) {
    drawTextCentered(ctx, 'LOW FUEL', CELL, COLS, C.B_RED, C.BLACK)
  } else if (state.dangerAhead && state.iceAheadBlink) {
    const label = formatDangerLabel(state.dangerAhead)
    if (label) drawTextCentered(ctx, label, CELL, COLS, C.B_RED, C.B_YELLOW)
  }
}
