import {
  C,
  CELL,
  drawTextCentered,
  isHeld,
  resetInput,
  type Scene,
} from 'zx-kit'
import { COLS, GAME_HEIGHT, GAME_WIDTH } from '../config.ts'

export const INTRO_PROMPT = 'Press Enter to start'
const PROMPT_Y = 21 * CELL

/**
 * Static loading screen shown before any gameplay state is created.
 *
 * The prompt starts on a CELL boundary and supplies an explicit black PAPER.
 * It therefore replaces complete 8x8 cells with one shared BRIGHT bank instead
 * of painting a third colour over the hardware-valid source image.
 */
export function createIntroScene(
  onStart: () => void,
  image: HTMLImageElement,
  enterHeld: () => boolean = () => isHeld('Enter'),
): Scene {
  let started = false
  let enterQueued = false
  const queueEnter = (event: KeyboardEvent) => {
    if (!event.repeat && event.key === 'Enter') enterQueued = true
  }

  return {
    name: 'intro',

    onEnter() {
      resetInput()
      window.addEventListener('keydown', queueEnter)
    },

    onExit() {
      window.removeEventListener('keydown', queueEnter)
      resetInput()
    },

    update() {
      if (
        started
        || !image.complete
        || image.naturalWidth === 0
        || (!enterQueued && !enterHeld())
      ) return
      started = true
      // Do not carry the dismissing Enter into the drive scene's ignition.
      resetInput()
      onStart()
    },

    render(ctx) {
      ctx.fillStyle = C.BLACK
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)

      if (image.complete && image.naturalWidth > 0) {
        ctx.save()
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(image, 0, 0, GAME_WIDTH, GAME_HEIGHT)
        ctx.restore()
      }

      drawTextCentered(ctx, INTRO_PROMPT, PROMPT_Y, COLS, C.B_WHITE, C.BLACK)
    },
  }
}
