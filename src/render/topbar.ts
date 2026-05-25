import { C, CELL, drawText, drawTextCentered } from 'zx-kit'
import { type Surface, COLS, GAME_WIDTH, STATUS_BAR_ROWS } from '../config.ts'

function fmtKm(distM: number): string {
  return (distM / 1000).toFixed(1)
}

const SURFACE_WARN_LABEL: Record<Surface, string> = {
  asphalt: '', snow: 'SNOW AHEAD', ice: 'ICE AHEAD', sand: 'SAND AHEAD', mud: 'MUD AHEAD',
}

export function drawTopBar(
  ctx: CanvasRenderingContext2D,
  state: {
    distance: number
    score: number
    elapsedMs: number
    dangerAhead: Surface | null
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
    const label = SURFACE_WARN_LABEL[state.dangerAhead]
    if (label) drawTextCentered(ctx, label, CELL, COLS, C.B_RED, C.B_YELLOW)
  }
}
