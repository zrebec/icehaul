import { C, CELL, drawText, drawTextCentered } from 'zx-kit'
import { COLS, GAME_WIDTH, STATUS_BAR_ROWS } from '../config.ts'

function fmtKm(distM: number): string {
  return (distM / 1000).toFixed(1)
}

/**
 * 2-row status bar (16 px). Fits 32 cols at 256 px width.
 * Line 1: SCORE + DIST.  Line 2: TIME + ICE AHEAD (blinks when active).
 */
export function drawTopBar(
  ctx: CanvasRenderingContext2D,
  state: {
    distance: number
    score: number
    elapsedMs: number
    iceAhead: boolean
    iceAheadBlink: boolean
  },
): void {
  const barH = STATUS_BAR_ROWS * CELL
  ctx.fillStyle = C.BLACK
  ctx.fillRect(0, 0, GAME_WIDTH, barH)

  // Row 0 — SCORE left, DIST right
  const scoreStr = state.score.toString().padStart(6, '0')
  drawText(ctx, `SCORE ${scoreStr}`, 0, 0, C.B_WHITE, C.BLACK)

  const distStr = `DIST ${fmtKm(state.distance).padStart(5)}km`
  drawText(ctx, distStr, GAME_WIDTH - distStr.length * CELL, 0, C.B_WHITE, C.BLACK)

  // Row 1 — TIME left, ICE AHEAD centre-right (blinks)
  const totalSec = Math.floor(state.elapsedMs / 1000)
  const mm = Math.floor(totalSec / 60).toString().padStart(2, '0')
  const ss = (totalSec % 60).toString().padStart(2, '0')
  drawText(ctx, `TIME ${mm}:${ss}`, 0, CELL, C.B_WHITE, C.BLACK)

  if (state.iceAhead && state.iceAheadBlink) {
    drawTextCentered(ctx, 'ICE AHEAD', CELL, COLS, C.B_RED, C.B_YELLOW)
  }
}
