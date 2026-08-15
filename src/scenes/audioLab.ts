import {
  C,
  drawText,
  drawTextCentered,
  getAudioContext,
  getMasterVolume,
  resumeAudio,
  type Scene,
} from 'zx-kit'
import {
  COLS,
  GAME_HEIGHT,
  GAME_WIDTH,
  GEARS,
  MAX_SPEED,
  RPM_DISPLAY_REDLINE,
  type Surface,
} from '../config.ts'
import {
  DEFAULT_DRIVE_AUDIO_MIX_DB,
  audioMixDbToPercent,
  startEngine,
  stopEngine,
  updateEngine,
  type AudioMixElement,
  type DriveAudioMixDb,
  type DriveAudioState,
} from '../audio/engine.ts'

const SPEED_CHANGE_KMH_S = 30
const RPM_CHANGE_RATIO_S = 0.35

const SURFACE_KEYS: Readonly<Record<string, Surface>> = {
  '1': 'asphalt',
  '2': 'snow',
  '3': 'ice',
  '4': 'sand',
  '5': 'mud',
}

const DIRECTION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'])

export interface AudioLabState {
  speedKmh: number
  rpm: number
  surface: Surface
  mode: 'free' | 'linked'
  gear: number
  mixTarget: AudioMixElement
  mixDb: DriveAudioMixDb
  throttle: boolean
  clutch: boolean
  brake: boolean
  running: boolean
}

export interface AudioLabAxes {
  left: boolean
  right: boolean
  down: boolean
  up: boolean
}

export function createAudioLabState(): AudioLabState {
  return {
    speedKmh: 60,
    rpm: 0.5,
    surface: 'asphalt',
    mode: 'free',
    gear: 3,
    mixTarget: 'engine',
    mixDb: { ...DEFAULT_DRIVE_AUDIO_MIX_DB },
    throttle: true,
    clutch: false,
    brake: false,
    running: true,
  }
}

/** Apply one edge-triggered lab key without coupling the controls to the DOM. */
export function audioLabStateAfterKey(state: AudioLabState, key: string): AudioLabState {
  const surface = SURFACE_KEYS[key]
  if (surface) return { ...state, surface, mixTarget: surface }

  if (key === '0') return { ...state, mixTarget: 'engine' }

  switch (key.toLowerCase()) {
    case 'q': return stateAfterMixAdjustment(state, -1)
    case 'e': return stateAfterMixAdjustment(state, 1)
    case 'g': {
      const mode = state.mode === 'free' ? 'linked' : 'free'
      return {
        ...state,
        mode,
        rpm: mode === 'linked' ? linkedRpm(state.speedKmh, state.gear) : state.rpm,
      }
    }
    case 'a': return stateAfterGearChange(state, -1)
    case 'd': return stateAfterGearChange(state, 1)
    case 't': return { ...state, throttle: !state.throttle }
    case 'c': return { ...state, clutch: !state.clutch }
    case 'b': return { ...state, brake: !state.brake }
    case 'r': return { ...state, running: !state.running }
    default: return state
  }
}

/** Advance the listening axes at frame-rate-independent rates. */
export function advanceAudioLabState(
  state: AudioLabState,
  axes: AudioLabAxes,
  dtMs: number,
): AudioLabState {
  const finiteDtMs = Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0
  const dtS = finiteDtMs / 1000
  const speedDirection = Number(axes.right) - Number(axes.left)
  const rpmDirection = Number(axes.up) - Number(axes.down)
  const speedKmh = clamp(
    state.speedKmh + speedDirection * SPEED_CHANGE_KMH_S * dtS,
    0,
    MAX_SPEED,
  )

  return {
    ...state,
    speedKmh,
    rpm: state.mode === 'linked'
      ? linkedRpm(speedKmh, state.gear)
      : clamp(state.rpm + rpmDirection * RPM_CHANGE_RATIO_S * dtS, 0, 1),
  }
}

function linkedRpm(speedKmh: number, gear: number): number {
  const gearTopKmh = GEARS[gear - 1]?.to ?? GEARS[0]!.to
  return clamp(speedKmh / gearTopKmh, 0, 1)
}

function stateAfterGearChange(state: AudioLabState, direction: -1 | 1): AudioLabState {
  if (state.mode !== 'linked') return state
  const gear = clamp(state.gear + direction, 1, GEARS.length)
  if (gear === state.gear) return state
  return { ...state, gear, rpm: linkedRpm(state.speedKmh, gear) }
}

function stateAfterMixAdjustment(state: AudioLabState, deltaDb: -1 | 1): AudioLabState {
  if (state.mixTarget === 'ice') return state
  const maxDb = state.mixTarget === 'engine' ? 0 : 12
  const db = clamp(state.mixDb[state.mixTarget] + deltaDb, -40, maxDb)
  if (db === state.mixDb[state.mixTarget]) return state
  return {
    ...state,
    mixDb: { ...state.mixDb, [state.mixTarget]: db },
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function onOff(value: boolean): string {
  return value ? 'ON' : 'OFF'
}

function shortSurface(surface: Surface): string {
  return surface === 'asphalt' ? 'ASPH' : surface.toUpperCase()
}

function formatMixLine(
  state: AudioLabState,
  key: string,
  element: AudioMixElement,
  label: string,
): string {
  const selected = state.mixTarget === element ? '>' : ' '
  if (element === 'ice') return `${selected}${key} ${label.padEnd(8, ' ')} OFF`
  const db = state.mixDb[element]
  const percent = Math.round(audioMixDbToPercent(db)).toString().padStart(3, '0')
  const formattedDb = `${db >= 0 ? '+' : '-'}${Math.abs(db).toString().padStart(2, '0')}DB`
  return `${selected}${key} ${label.padEnd(8, ' ')} ${percent}% ${formattedDb}`
}

/**
 * Standalone listening harness for the real driving-audio path.
 * FREE keeps wheel speed and RPM independent for controlled comparisons. LINK
 * derives RPM from speed and the selected production gear, so a fixed-speed
 * A/D shift auditions the real pitch drop/rise without recreating vehicle
 * physics inside the lab.
 */
export function createAudioLabScene(): Scene {
  let state = createAudioLabState()
  let audioStarted = false
  const heldDirections = new Set<string>()

  const onKeyDown = (event: KeyboardEvent): void => {
    // A suspended context can recur after tab switching, so every deliberate
    // lab input resumes it rather than relying only on the first-key boot hook.
    resumeAudio()

    if (DIRECTION_KEYS.has(event.key)) {
      heldDirections.add(event.key)
      event.preventDefault()
      return
    }
    const lowerKey = event.key.toLowerCase()
    // Mix trims deliberately follow keyboard repeat. Toggles, surface changes
    // and gear shifts remain edge-triggered.
    if (event.repeat && lowerKey !== 'q' && lowerKey !== 'e') return

    const next = audioLabStateAfterKey(state, event.key)
    if (next !== state) {
      state = next
      event.preventDefault()
    }
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    if (DIRECTION_KEYS.has(event.key)) event.preventDefault()
    heldDirections.delete(event.key)
  }

  const onBlur = (): void => {
    heldDirections.clear()
  }

  return {
    name: 'audio-lab',

    onEnter() {
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      window.addEventListener('blur', onBlur)
    },

    onExit() {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      heldDirections.clear()
      stopEngine()
      audioStarted = false
    },

    update(dtMs) {
      state = advanceAudioLabState(state, {
        left: heldDirections.has('ArrowLeft'),
        right: heldDirections.has('ArrowRight'),
        down: heldDirections.has('ArrowDown'),
        up: heldDirections.has('ArrowUp'),
      }, dtMs)

      if (!audioStarted && getAudioContext() !== null) {
        startEngine(state.mixDb)
        audioStarted = true
      }

      if (audioStarted) {
        const audioState: DriveAudioState = {
          dtMs,
          speedKmh: state.speedKmh,
          rpm: state.rpm,
          surface: state.surface,
          throttle: state.throttle,
          clutch: state.clutch,
          brake: state.brake,
          slipIntensity: 0,
          running: state.running,
          mixDb: state.mixDb,
        }
        updateEngine(audioState)
      }
    },

    render(ctx) {
      ctx.fillStyle = C.BLACK
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)

      drawTextCentered(ctx, 'ICE HAUL AUDIO LAB', 0, COLS, C.B_YELLOW, C.BLACK)
      const displayRpm = Math.round(state.rpm * RPM_DISPLAY_REDLINE)
      const masterPercent = Math.round(getMasterVolume() * 100).toString().padStart(3, '0')

      drawText(ctx, `MODE ${state.mode.toUpperCase()} SURF ${shortSurface(state.surface)} ENG ${onOff(state.running)}`, 8, 8, C.B_CYAN, C.BLACK)
      drawText(ctx, '1 ASPH 2 SNOW 3 ICE', 8, 16, C.B_WHITE, C.BLACK)
      drawText(ctx, '4 SAND 5 MUD', 8, 24, C.B_WHITE, C.BLACK)

      drawText(ctx, `SPD ${Math.round(state.speedKmh).toString().padStart(3, '0')}KM/H RPM ${displayRpm.toString().padStart(4, '0')}/${RPM_DISPLAY_REDLINE}`, 8, 40, C.B_GREEN, C.BLACK)
      drawText(ctx, `GEAR ${state.gear} THR ${onOff(state.throttle)} CL ${onOff(state.clutch)} BRK ${onOff(state.brake)}`, 8, 48, C.B_GREEN, C.BLACK)
      drawText(ctx, 'FREE LR SPEED DU RPM', 8, 56, C.WHITE, C.BLACK)
      drawText(ctx, 'LINK LR SPEED A/D AUTO SHIFT', 8, 64, C.WHITE, C.BLACK)
      drawText(ctx, 'T THR C CLUT B BRK R ENGINE', 8, 72, C.B_WHITE, C.BLACK)
      drawText(ctx, 'G FREE/LINK', 8, 80, C.B_WHITE, C.BLACK)

      drawText(ctx, 'MIX 0-5 SELECT', 8, 96, C.B_YELLOW, C.BLACK)
      const mixLines: ReadonlyArray<readonly [string, AudioMixElement, string]> = [
        ['0', 'engine', 'ENGINE'],
        ['1', 'asphalt', 'ASPHALT'],
        ['2', 'snow', 'SNOW'],
        ['3', 'ice', 'ICE'],
        ['4', 'sand', 'SAND'],
        ['5', 'mud', 'MUD'],
      ]
      for (let i = 0; i < mixLines.length; i++) {
        const [key, element, label] = mixLines[i]!
        const color = state.mixTarget === element ? C.B_YELLOW : C.B_WHITE
        drawText(ctx, formatMixLine(state, key, element, label), 8, 104 + i * 8, color, C.BLACK)
      }

      drawText(ctx, 'Q/E MIX -/+1DB', 8, 152, C.B_YELLOW, C.BLACK)
      drawText(ctx, `-/+ MASTER ${masterPercent}%`, 8, 160, C.B_YELLOW, C.BLACK)
      drawText(ctx, 'SURFACE = ROAD SPEED', 8, 176, C.CYAN, C.BLACK)
      drawText(ctx, 'FREE VALUES INDEPENDENT', 8, 184, C.CYAN, C.BLACK)
    },
  }
}
