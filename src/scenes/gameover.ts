import {
  C,
  drawTextCentered,
  consumeAnyKey,
  type Scene,
  resetInput,
} from 'zx-kit'
import { COLS, GAME_HEIGHT, GAME_WIDTH } from '../config.ts'
import { averageSpeedKph, formatClock, type RunSummary } from '../game/runStats.ts'
import { formatSeedRoute } from '../game/seed.ts'

/**
 * The results screen.
 *
 * `resetInput()` on the way in is not tidiness: `pendingAnyKey` is set by every
 * keydown and nothing else in the game ever consumes it, so the flag left over
 * from the last gear change would dismiss this screen the instant the guard
 * below expires — which is exactly what it used to do.
 */
export function createGameOverScene(stats: RunSummary): Scene {
  resetInput()
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

      drawTextCentered(ctx, 'GAME OVER', 32, COLS, C.B_RED)

      const reasonText = stats.reason === 'fuel' ? 'OUT OF FUEL'
        : stats.reason === 'timeout' ? 'TIME IS UP'
          : stats.reason === 'crash' ? 'COLLISION' : 'LOST CONTROL'
      drawTextCentered(ctx, reasonText, 52, COLS, C.B_YELLOW)

      // Five lines on a 12 px pitch, so the block reads as one table rather than
      // as a list of unrelated facts. Distance and time say what happened;
      // average speed and canisters are the two that say how it went.
      const distKm = (stats.distance / 1000).toFixed(1)
      drawTextCentered(ctx, `DISTANCE: ${distKm} km`, 80, COLS, C.B_WHITE)
      drawTextCentered(ctx, `TOTAL TIME: ${formatClock(stats.elapsedMs)}`, 92, COLS, C.B_WHITE)

      const avg = averageSpeedKph(stats.distance, stats.elapsedMs)
      drawTextCentered(ctx, `AVG SPEED: ${avg} km/h`, 104, COLS, C.B_WHITE)
      drawTextCentered(ctx, `CANISTERS: ${stats.canisters}`, 116, COLS, C.B_WHITE)

      // Always shown, unlike before: a zero after a crash at 200 m is a fact
      // about the run, and a line that comes and goes moves everything under it.
      drawTextCentered(ctx, `SCORE: ${stats.score}`, 128, COLS, C.B_YELLOW)

      // Which road this was, set apart from how it went by a wider gap. Both
      // halves earn their place: the date is what a player repeats to someone
      // else, the number is what they type into `?seed=`. Only one of them is
      // memorable and only one of them is actionable.
      //
      // Not left to the URL, which may be absent and will not exist at all if
      // this becomes an app. A run has to be able to name itself.
      drawTextCentered(ctx, `ROUTE: ${formatSeedRoute(stats.seed)}`, 148, COLS, C.CYAN)
      drawTextCentered(ctx, `SEED: ${stats.seed}`, 160, COLS, C.CYAN)

      if (ready) {
        drawTextCentered(ctx, 'PRESS ANY KEY', 176, COLS, C.B_CYAN)
      }
    },
  }
}
