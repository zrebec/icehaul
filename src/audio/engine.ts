/**
 * Engine + brake sound via AY-3-8912 chip (3 channels) + beeper.
 *
 * Channel A: diesel fundamental (pitch tracks engine RPM)
 * Channel B: second harmonic (keeps the low fundamental audible on small speakers)
 * Channel C: dual purpose:
 *   - NOT braking: rolling texture (noise for asphalt/snow/sand/mud; ice is quiet)
 *   - BRAKING: brake screech (asphalt: tone+noise, ice: noise only)
 *
 * Beeper: simultaneous brake judder pops (short clicks).
 */
import { AY_VOL, createAY, beep, getAudioContext, type AYChip } from 'zx-kit'
import { MAX_SPEED, type Surface, SURFACE_BRAKE } from '../config.ts'

let ay: AYChip | null = null
let audioRpm: number | null = null
let engineAppliedGain: number | null = null

const ENGINE_MIN_HZ = 45
const ENGINE_MAX_HZ = 140
const ENGINE_RPM_RESPONSE_MS = 40

const CHANNEL_C_FADE_OUT_MS = 20
const CHANNEL_C_FADE_IN_MS = 40

export type AudioMixElement = 'engine' | Surface
export type DriveAudioMixDb = Readonly<Record<AudioMixElement, number>>

/** Production mix. The lab passes a complete replacement without mutating it. */
export const DEFAULT_DRIVE_AUDIO_MIX_DB: DriveAudioMixDb = Object.freeze({
  engine: -20,
  asphalt: 0,
  snow: 0,
  ice: 0,
  sand: 0,
  mud: 0,
})

export const AUDIO_MIX_DB_MIN = -40
export const ENGINE_MIX_DB_MAX = 0
export const SURFACE_MIX_DB_MAX = 12

type ChannelCKey = `surface:${Surface}` | `brake:${Surface}`

interface ChannelCSpec {
  key: ChannelCKey
  noisePeriod: number | null
}

interface ChannelCFrame {
  spec: ChannelCSpec
  toneHz: number
  gain: number
}

/** Complete instantaneous drive state shared by the game and the audio lab. */
export interface DriveAudioState {
  dtMs: number
  speedKmh: number
  /** Engine RPM normalised to 0..1, where 1 is the redline. */
  rpm: number
  surface: Surface
  throttle: boolean
  /** True while the clutch pedal is down and the engine is disconnected. */
  clutch: boolean
  brake: boolean
  /** Combined lateral/wheel-slip intensity, normalised to 0..1. */
  slipIntensity: number
  running: boolean
  /** Optional lab-only mix; the normal drive path inherits production defaults. */
  mixDb?: DriveAudioMixDb
}

/** Pure result for the two AY engine voices and the next smoothing state. */
export interface EngineVoice {
  audioRpm: number
  fundamentalHz: number
  harmonicHz: number
  fundamentalLevel: number
  harmonicLevel: number
  load: number
}

let channelCActiveKey: ChannelCKey | null = null
let channelCTransitionKey: ChannelCKey | null = null
let channelCLatestFrame: ChannelCFrame | null = null
let channelCAppliedToneHz: number | null = null
let channelCAppliedGain: number | null = null
let channelCTransitionGeneration = 0
let channelCSwapTimer: ReturnType<typeof setTimeout> | null = null
let channelCSettleTimer: ReturnType<typeof setTimeout> | null = null

/** Convert an AY register level to zx-kit's linear per-channel fader range. */
export function ayLevelToChannelGain(level: number): number {
  const registerLevel = Math.max(0, Math.min(15, Math.round(level)))
  return 15 * AY_VOL[registerLevel]!
}

/** Clamp one lab mix control to the range that its physical source supports. */
export function clampAudioMixDb(element: AudioMixElement, value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DRIVE_AUDIO_MIX_DB[element]
  const max = element === 'engine' ? ENGINE_MIX_DB_MAX : SURFACE_MIX_DB_MAX
  return Math.max(AUDIO_MIX_DB_MIN, Math.min(max, value))
}

/** Human-readable linear amplitude percentage: -20 dB = 10%, 0 dB = 100%. */
export function audioMixDbToPercent(db: number): number {
  if (!Number.isFinite(db)) return 0
  return 100 * dbToLinearGain(db)
}

function dbToLinearGain(db: number): number {
  return 10 ** (db / 20)
}

function engineChannelGain(mixDb: DriveAudioMixDb): number {
  return 15 * dbToLinearGain(clampAudioMixDb('engine', mixDb.engine))
}

function surfaceChannelGain(
  level: number,
  surface: Surface,
  mixDb: DriveAudioMixDb,
): number {
  const gain = ayLevelToChannelGain(level)
    * dbToLinearGain(clampAudioMixDb(surface, mixDb[surface]))
  return Math.max(0, Math.min(15, gain))
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/**
 * Calculate the diesel voices without touching Web Audio state.
 *
 * `previousAudioRpm === null` snaps the first frame to the real engine so start
 * and resume never invent a pitch sweep. Later frames use an exact exponential
 * response: four 10 ms steps are identical to one 40 ms step.
 */
export function calculateEngineVoice(
  state: DriveAudioState,
  previousAudioRpm: number | null,
): EngineVoice {
  const targetRpm = clamp01(state.rpm)
  const previousRpm = previousAudioRpm === null || !Number.isFinite(previousAudioRpm)
    ? targetRpm
    : clamp01(previousAudioRpm)
  const dtMs = Number.isFinite(state.dtMs) ? Math.max(0, state.dtMs) : 0
  const response = 1 - Math.exp(-dtMs / ENGINE_RPM_RESPONSE_MS)
  const nextAudioRpm = previousRpm + (targetRpm - previousRpm) * response

  const fundamentalHz = ENGINE_MIN_HZ + (ENGINE_MAX_HZ - ENGINE_MIN_HZ) * nextAudioRpm
  const throttle = state.running && state.throttle ? 1 : 0
  // A disconnected engine can rev but carries no drivetrain load. When coupled,
  // low RPM sounds more laboured without making pitch depend on the road surface.
  const load = throttle > 0 && !state.clutch
    ? 0.65 + 0.35 * (1 - nextAudioRpm)
    : 0

  const fundamentalLevel = state.running
    ? Math.min(12, Math.max(0, Math.round(7 + 2 * nextAudioRpm + throttle + 2 * load)))
    : 0
  const harmonicLevel = state.running
    ? Math.min(8, Math.max(0, Math.round(4 + nextAudioRpm + throttle + 2 * load)))
    : 0

  return {
    audioRpm: nextAudioRpm,
    fundamentalHz,
    harmonicHz: fundamentalHz * 2,
    fundamentalLevel,
    harmonicLevel,
    load,
  }
}

export function startEngine(mixDb: DriveAudioMixDb = DEFAULT_DRIVE_AUDIO_MIX_DB): void {
  if (ay) return
  audioRpm = null
  engineAppliedGain = null
  ay = createAY()
  applyEngineMix(ay, mixDb)
  // The first real drive frame supplies both pitch and gain. Starting silent
  // avoids a brief arbitrary note between createAY() and that update.
  ay.tone('A', ENGINE_MIN_HZ, 0)
  ay.tone('B', ENGINE_MIN_HZ * 2, 0)
  // No source is assumed active: asphalt is audible now and its noise generator
  // must be configured on the first real drive frame like every other surface.
  resetChannelCState()
  ay.volume('C', 0)
}

export function updateEngine(state: DriveAudioState): void {
  if (!ay) return

  const effectiveMixDb = state.mixDb ?? DEFAULT_DRIVE_AUDIO_MIX_DB
  applyEngineMix(ay, effectiveMixDb)
  const voice = calculateEngineVoice(state, audioRpm)
  audioRpm = voice.audioRpm
  ay.tone('A', voice.fundamentalHz, voice.fundamentalLevel)
  ay.tone('B', voice.harmonicHz, voice.harmonicLevel)

  // Channel C — brake sound OR surface texture. Source changes cross-fade via
  // the channel fader; steady frames update the full-level source underneath it.
  // Rolling and braking sources follow wheel speed, never engine RPM: an
  // upshift must not make the road quieter beneath a truck moving just as fast.
  const speedRatio = clamp01(state.speedKmh / MAX_SPEED)
  const brakeSound = SURFACE_BRAKE[state.surface].sound
  const shouldBrake = state.brake && state.speedKmh > 15 && brakeSound !== 'none'
  updateChannelC(channelCFrame(
    state.surface, shouldBrake, speedRatio, state.speedKmh, effectiveMixDb,
  ))
  if (shouldBrake) updateBrakePops(state.surface, state.speedKmh)
}

function applyEngineMix(chip: AYChip, mixDb: DriveAudioMixDb): void {
  const gain = engineChannelGain(mixDb)
  if (gain === engineAppliedGain) return
  chip.volume('A', gain)
  chip.volume('B', gain)
  engineAppliedGain = gain
}

// ── AY Channel C ────────────────────────────────────────────────────────────

function channelCFrame(
  surface: Surface,
  braking: boolean,
  speedRatio: number,
  speed: number,
  mixDb: DriveAudioMixDb,
): ChannelCFrame {
  if (braking) {
    // Braking is a separate element which deliberately ignores rolling-surface
    // trims. It keeps the pre-lab production gain on every surface.
    const gain = ayLevelToChannelGain(Math.round(6 + speedRatio * 8))
    if (SURFACE_BRAKE[surface].sound === 'screech') {
      return {
        spec: { key: `brake:${surface}`, noisePeriod: 6 },
        // Descending tone: high pitch at high speed → low as truck slows.
        toneHz: 300 + speed * 12,
        gain,
      }
    }
    return {
      spec: { key: `brake:${surface}`, noisePeriod: 3 },
      toneHz: 0,
      gain,
    }
  }

  const movingLevel = (min: number, max: number): number => (
    speedRatio <= 0 ? 0 : Math.round(min + speedRatio * (max - min))
  )

  switch (surface) {
    case 'asphalt': {
      const level = Math.round(speedRatio * 2)
      return {
        spec: { key: 'surface:asphalt', noisePeriod: 31 },
        toneHz: 0,
        gain: surfaceChannelGain(level, surface, mixDb),
      }
    }
    case 'snow':
      return {
        spec: { key: 'surface:snow', noisePeriod: 24 },
        toneHz: 0,
        gain: surfaceChannelGain(movingLevel(2, 6), surface, mixDb),
      }
    case 'ice':
      return {
        spec: { key: 'surface:ice', noisePeriod: null },
        toneHz: 0,
        gain: 0,
      }
    case 'sand':
      return {
        spec: { key: 'surface:sand', noisePeriod: 12 },
        toneHz: 0,
        gain: surfaceChannelGain(movingLevel(3, 9), surface, mixDb),
      }
    case 'mud':
      return {
        spec: { key: 'surface:mud', noisePeriod: 18 },
        toneHz: 0,
        gain: surfaceChannelGain(movingLevel(2, 7), surface, mixDb),
      }
  }
}

function updateChannelC(frame: ChannelCFrame): void {
  if (!ay) return
  channelCLatestFrame = frame

  // During either fade, retain only the newest dynamic frequency/gain. Calling
  // tone() or volume() here would disturb the scheduled channel automation.
  if (channelCTransitionKey === frame.spec.key) return

  if (channelCTransitionKey !== null || channelCActiveKey !== frame.spec.key) {
    beginChannelCTransition(frame.spec.key)
    return
  }

  applyChannelCSteadyFrame(ay, frame)
}

function beginChannelCTransition(key: ChannelCKey): void {
  const chip = ay
  if (!chip) return

  cancelChannelCTransition()
  channelCTransitionKey = key
  channelCAppliedToneHz = null
  channelCAppliedGain = null
  const generation = channelCTransitionGeneration

  chip.fade('C', 0, CHANNEL_C_FADE_OUT_MS)
  channelCSwapTimer = setTimeout(() => {
    if (!isCurrentChannelCTransition(chip, generation, key)) return
    channelCSwapTimer = null

    const frame = channelCLatestFrame
    if (!frame || frame.spec.key !== key) return

    applyChannelCSource(chip, frame)
    channelCActiveKey = key
    chip.fade('C', frame.gain, CHANNEL_C_FADE_IN_MS)
    channelCAppliedGain = frame.gain

    channelCSettleTimer = setTimeout(() => {
      if (!isCurrentChannelCTransition(chip, generation, key)) return
      channelCSettleTimer = null
      channelCTransitionKey = null

      const latest = channelCLatestFrame
      if (latest && latest.spec.key === key) applyChannelCSteadyFrame(chip, latest)
    }, CHANNEL_C_FADE_IN_MS)
  }, CHANNEL_C_FADE_OUT_MS)
}

function isCurrentChannelCTransition(
  chip: AYChip,
  generation: number,
  key: ChannelCKey,
): boolean {
  return ay === chip && channelCTransitionGeneration === generation && channelCTransitionKey === key
}

function applyChannelCSource(chip: AYChip, frame: ChannelCFrame): void {
  if (frame.spec.noisePeriod === null) chip.disableNoise('C')
  else chip.enableNoise('C', frame.spec.noisePeriod)

  // The channel fader owns amplitude for both generators. Keeping the internal
  // source at 15 avoids applying AY's logarithmic curve twice to tone sources.
  chip.tone('C', frame.toneHz, 15)
  channelCAppliedToneHz = frame.toneHz
}

function applyChannelCSteadyFrame(chip: AYChip, frame: ChannelCFrame): void {
  if (frame.toneHz !== channelCAppliedToneHz) {
    chip.tone('C', frame.toneHz, 15)
    channelCAppliedToneHz = frame.toneHz
  }
  if (frame.gain !== channelCAppliedGain) {
    chip.volume('C', frame.gain)
    channelCAppliedGain = frame.gain
  }
}

function cancelChannelCTransition(): void {
  channelCTransitionGeneration++
  if (channelCSwapTimer !== null) clearTimeout(channelCSwapTimer)
  if (channelCSettleTimer !== null) clearTimeout(channelCSettleTimer)
  channelCSwapTimer = null
  channelCSettleTimer = null
  channelCTransitionKey = null
}

function resetChannelCState(activeKey: ChannelCKey | null = null): void {
  cancelChannelCTransition()
  channelCActiveKey = activeKey
  channelCLatestFrame = null
  channelCAppliedToneHz = null
  channelCAppliedGain = null
}

// ── Brake beeper ────────────────────────────────────────────────────────────

let lastBrakePopS = 0

function updateBrakePops(surface: Surface, speed: number): void {
  const sound = SURFACE_BRAKE[surface].sound

  // Beeper: simultaneous brake judder pops
  const ctx = getAudioContext()
  if (ctx && speed > 25) {
    const now = ctx.currentTime
    const popInterval = sound === 'grind' ? 0.12 : 0.18
    if (now - lastBrakePopS > popInterval) {
      const popFreq = sound === 'grind' ? 80 + Math.random() * 40 : 250 + Math.random() * 150
      beep(popFreq, 20, now)
      lastBrakePopS = now
    }
  }
}

// ── Control ─────────────────────────────────────────────────────────────────

export function muteEngine(): void {
  resetChannelCState()
  if (ay) ay.muteAll()
}

export function unmuteEngine(): void {
  resetChannelCState()
}

export function stopEngine(): void {
  const chip = ay
  audioRpm = null
  engineAppliedGain = null
  resetChannelCState()
  if (!chip) return
  chip.muteAll()
  chip.stop()
  ay = null
}
