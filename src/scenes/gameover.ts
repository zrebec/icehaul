import {
  C,
  drawTextCentered,
  drawText,
  consumeAnyKey,
  type Scene,
} from 'zx-kit'
import { COLS, GAME_HEIGHT, GAME_WIDTH } from '../config.ts'

export function createGameOverScene(stats: {
  distance: number
  elapsedMs: number
  reason: 'fuel' | 'offroad' | 'timeout' | 'crash'
  score: number
}): Scene {
  let ready = false
  let readyTimer = 0

  return {
    name: 'gameover',

    update(dt) {
      readyTimer += dt
      if (readyTimer > 1500) ready = true
      if (ready && consumeAnyKey()) {
        // Reload page to restart — simple for phase 2
        window.location.reload()
      }
    },

    render(ctx) {
      ctx.fillStyle = C.BLACK
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)

      drawTextCentered(ctx, 'GAME OVER', 40, COLS, C.B_RED)

      const reasonText = stats.reason === 'fuel' ? 'OUT OF FUEL'
        : stats.reason === 'timeout' ? 'TIME IS UP'
        : stats.reason === 'crash' ? 'COLLISION' : 'LOST CONTROL'
      drawTextCentered(ctx, reasonText, 64, COLS, C.B_YELLOW)

      const distKm = (stats.distance / 1000).toFixed(1)
      drawTextCentered(ctx, `DISTANCE: ${distKm} km`, 88, COLS, C.B_WHITE)

      const sec = Math.floor(stats.elapsedMs / 1000)
      const mm = Math.floor(sec / 60).toString().padStart(2, '0')
      const ss = (sec % 60).toString().padStart(2, '0')
      drawTextCentered(ctx, `TIME: ${mm}:${ss}`, 104, COLS, C.B_WHITE)

      if (stats.score > 0) {
        drawTextCentered(ctx, `SCORE: ${stats.score}`, 120, COLS, C.B_YELLOW)
      }

      if (ready) {
        drawTextCentered(ctx, 'PRESS ANY KEY', 140, COLS, C.B_CYAN)
      }
    },
  }
}
