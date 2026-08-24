import {
  C,
  CELL,
  blinkVisible,
  consumeFlag,
  drawBitmapAttrs,
  drawMenuOptions,
  drawText,
  isHeld,
  parseSCR,
  resetInput,
  tickMovement,
  type Scene,
} from 'zx-kit'
import { ICEHAUL_LOADING_SCR } from '../assets/icehaul-loading.ts'
import { COLS, GAME_WIDTH } from '../config.ts'
import { getPrefs, updatePrefs, VOLUME_STEP, type Prefs } from '../game/prefs.ts'

/**
 * The loading screen, decoded once at import.
 *
 * The asset is a native `.scr` compiled into the bundle rather than a PNG fetched
 * at runtime, and both halves of that matter. A `.scr` spends three bits on INK
 * and three on PAPER, so it *cannot* express a colour outside the 16 or a cell
 * with three of them — a PNG can hold anything and `drawImage` paints it. And a
 * module cannot half-arrive: the previous version gated the scene on
 * `image.complete && image.naturalWidth > 0`, which meant a missing file left the
 * player on a black screen that never accepted a keypress.
 */
const SCREEN = parseSCR(ICEHAUL_LOADING_SCR)

/**
 * Cell rows 0–5 — the night sky.
 *
 * Measured, not guessed: the truck's own colours (yellow marker lamps, red grille)
 * appear only on cell rows 8–18, so the sky above and the ice below are the two
 * places a panel can go. The ice was rejected because rows 20–21 hold the lamp
 * reflections, and those are what make the picture read as *a truck on ice at
 * night* rather than a truck on a grey field. The aurora is atmosphere; the
 * reflections are the subject.
 */
const PANEL_ROWS = 6

/** Items start on row 1, leaving row 0 as the panel's top margin. */
const MENU_TOP = CELL
const MENU_X = CELL

/** Labels are padded to this width so every value starts in the same column. */
const LABEL_WIDTH = 10

/** Slow enough to read as a cursor rather than a fault. */
const CURSOR_BLINK_MS = 400

type ItemId = 'start' | 'glow' | 'contour' | 'volume'

const ITEMS: readonly ItemId[] = ['start', 'glow', 'contour', 'volume']

export const INTRO_HINT = 'CURSOR KEYS - ENTER'

/**
 * The ROM font is ASCII 32–127 and nothing else: `getCharRow` returns an empty row
 * for anything outside it, so a diacritic renders as a blank cell rather than as a
 * wrong glyph. Labels stay ASCII, which also keeps them consistent with the rest of
 * the game's screens.
 */
function labelFor(id: ItemId, prefs: Readonly<Prefs>): string {
  switch (id) {
    case 'start':
      return 'START'
    case 'glow':
      return 'GLOW'.padEnd(LABEL_WIDTH) + (prefs.glow ? 'ON' : 'OFF')
    case 'contour':
      return 'CONTOUR'.padEnd(LABEL_WIDTH) + (prefs.contour ? 'ON' : 'OFF')
    case 'volume':
      return 'VOLUME'.padEnd(LABEL_WIDTH) + String(Math.round(prefs.volume * 10))
  }
}

/** `step` is -1 or +1. START has nothing to adjust; the caller activates it instead. */
function adjust(id: ItemId, step: number): void {
  const prefs = getPrefs()
  switch (id) {
    case 'glow':
      updatePrefs({ glow: step > 0 })
      break
    case 'contour':
      updatePrefs({ contour: step > 0 })
      break
    case 'volume':
      updatePrefs({ volume: prefs.volume + step * VOLUME_STEP })
      break
    case 'start':
      break
  }
}

/**
 * Title screen: the loading picture with a menu panel over the sky.
 *
 * Input goes through zx-kit and nowhere else. The previous version ran its own
 * `window.addEventListener('keydown')` *beside* `isHeld()`, which is why it also
 * needed `resetInput()` three times — two mechanisms disagreeing about what had
 * been pressed. `tickMovement` already owns key repeat for both keyboard and
 * gamepad, so the menu gets held-arrow repeat for free.
 *
 * @param onStart - Called once, when the player picks START.
 */
export function createIntroScene(onStart: () => void): Scene {
  let started = false
  let index = 0
  let elapsedMs = 0
  // Enter is the game's own action key (drive.ts cranks the engine with it), so the
  // menu honours it too. Edge-detected against zx-kit's held state rather than a
  // second listener: holding Enter must select once, not once per frame.
  let enterWasHeld = false

  const activate = (): void => {
    const id = ITEMS[index]!
    if (id === 'start') {
      started = true
      onStart()
      return
    }
    // A toggle activates by flipping; volume wraps back to silence past the top.
    const prefs = getPrefs()
    if (id === 'glow') updatePrefs({ glow: !prefs.glow })
    else if (id === 'contour') updatePrefs({ contour: !prefs.contour })
    else if (id === 'volume') updatePrefs({ volume: prefs.volume >= 1 ? 0 : prefs.volume + VOLUME_STEP })
  }

  return {
    name: 'intro',

    update(dt) {
      if (started) return
      elapsedMs += dt

      const dir = tickMovement(dt)
      if (dir === 'up') index = (index + ITEMS.length - 1) % ITEMS.length
      else if (dir === 'down') index = (index + 1) % ITEMS.length
      else if (dir === 'left') adjust(ITEMS[index]!, -1)
      else if (dir === 'right') adjust(ITEMS[index]!, 1)

      const enterHeld = isHeld('Enter')
      const enterPressed = enterHeld && !enterWasHeld
      enterWasHeld = enterHeld

      if (consumeFlag() || enterPressed) activate()
    },

    onExit() {
      // The documented use of resetInput: a phase boundary. Without it the Enter
      // that picked START is still held when drive.ts reads it as the ignition.
      resetInput()
    },

    render(ctx) {
      drawBitmapAttrs(ctx, SCREEN.bitmap, SCREEN.attrs, 0, 0)

      // A solid panel, not text floating on the artwork. Filling whole cells is
      // also what keeps the screen hardware-valid: every cell the menu touches is
      // replaced outright, so none of them ends up holding a third colour.
      ctx.fillStyle = C.BLACK
      ctx.fillRect(0, 0, GAME_WIDTH, PANEL_ROWS * CELL)

      const prefs = getPrefs()
      drawMenuOptions(
        ctx,
        ITEMS.map((id) => labelFor(id, prefs)),
        index,
        MENU_X,
        MENU_TOP,
        {
          // The default gap of 2 makes a 10px line height, which would push every
          // row after the first off the 8px cell grid and break the colour rules.
          gap: 0,
          paper: C.BLACK,
          ink: C.WHITE,
          selectedInk: C.B_YELLOW,
          // Padding keeps the columns aligned while the marker blinks away.
          prefix: blinkVisible(elapsedMs, CURSOR_BLINK_MS) ? '> ' : '  ',
        },
      )

      // Bottom row of the panel, right-aligned so it reads as a footnote. One
      // cell of right margin keeps it off the screen edge.
      const hintX = (COLS - INTRO_HINT.length - 1) * CELL
      drawText(ctx, INTRO_HINT, hintX, MENU_TOP + 4 * CELL, C.CYAN, C.BLACK)
    },
  }
}
