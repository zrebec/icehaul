/**
 * Engine + brake sound via AY-3-8912 chip (3 channels) + beeper.
 *
 * Channel A: main engine tone (pitch tracks speed)
 * Channel B: detuned harmonic (chorus thickness)
 * Channel C: dual purpose:
 *   - NOT braking: surface texture (noise for snow/sand/mud, tone for ice)
 *   - BRAKING: brake screech (asphalt: tone+noise, ice: noise only)
 *
 * Beeper: simultaneous brake judder pops (short clicks).
 */
import { AY_VOL, createAY, beep, getAudioContext, type AYChip } from 'zx-kit'
import { type Surface, SURFACE_ENGINE_SOUND, SURFACE_BRAKE } from '../config.ts'

let ay: AYChip | null = null

const CHANNEL_C_FADE_OUT_MS = 20
const CHANNEL_C_FADE_IN_MS = 40

type ChannelCKey = `surface:${Surface}` | `brake:${Surface}`

interface ChannelCSpec {
  key: ChannelCKey
  noisePeriod: number | null
}

interface ChannelCFrame {
  spec: ChannelCSpec
  toneHz: number
  level: number
}

let channelCActiveKey: ChannelCKey | null = null
let channelCTransitionKey: ChannelCKey | null = null
let channelCLatestFrame: ChannelCFrame | null = null
let channelCAppliedToneHz: number | null = null
let channelCAppliedLevel: number | null = null
let channelCTransitionGeneration = 0
let channelCSwapTimer: ReturnType<typeof setTimeout> | null = null
let channelCSettleTimer: ReturnType<typeof setTimeout> | null = null

/** Convert an AY register level to zx-kit's linear per-channel fader range. */
export function ayLevelToChannelGain(level: number): number {
  const registerLevel = Math.max(0, Math.min(15, Math.round(level)))
  return 15 * AY_VOL[registerLevel]!
}

export function startEngine(): void {
  if (ay) return
  ay = createAY()
  ay.tone('A', 40, 8)
  ay.tone('B', 45, 5)
  resetChannelCState('surface:asphalt')
  ay.volume('C', 0)
}

export function updateEngine(
  speed: number, rpm: number, surface: Surface, braking: boolean, running: boolean,
): void {
  if (!ay) return

  const [, idleHz, topHz] = SURFACE_ENGINE_SOUND[surface]
  // Pitch tracks engine RPM within the current gear: revs climb as you
  // accelerate in a gear, then DROP on an upshift — the manual-gearbox sound.
  const t = Math.max(0, Math.min(1, rpm))
  const baseFreq = idleHz + (topHz - idleHz) * t

  if (running) {
    // Channel A — main engine tone (quieter when braking)
    const mainVol = braking ? Math.round(3 + t * 4) : Math.round(6 + t * 6)
    ay.tone('A', baseFreq, mainVol)
    // Channel B — detuned harmonic
    const detune = 4 + t * 6
    ay.tone('B', baseFreq + detune, Math.round(mainVol * 0.6))
  } else {
    // Engine off (stalled) — silence the engine tone; tyres (Channel C) roll on.
    ay.tone('A', baseFreq, 0)
    ay.tone('B', baseFreq, 0)
  }

  // Channel C — brake sound OR surface texture. Source changes cross-fade via
  // the channel fader; steady frames update the full-level source underneath it.
  const brakeSound = SURFACE_BRAKE[surface].sound
  const shouldBrake = braking && speed > 15 && brakeSound !== 'none'
  updateChannelC(channelCFrame(surface, shouldBrake, t, baseFreq, speed))
  if (shouldBrake) updateBrakePops(surface, speed)
}

// ── AY Channel C ────────────────────────────────────────────────────────────

function channelCFrame(
  surface: Surface,
  braking: boolean,
  t: number,
  baseFreq: number,
  speed: number,
): ChannelCFrame {
  if (braking) {
    const level = Math.round(6 + t * 8)
    if (SURFACE_BRAKE[surface].sound === 'screech') {
      return {
        spec: { key: `brake:${surface}`, noisePeriod: 6 },
        // Descending tone: high pitch at high speed → low as truck slows.
        toneHz: 300 + speed * 12,
        level,
      }
    }
    return {
      spec: { key: `brake:${surface}`, noisePeriod: 3 },
      toneHz: 0,
      level,
    }
  }

  switch (surface) {
    case 'asphalt':
      return { spec: { key: 'surface:asphalt', noisePeriod: null }, toneHz: 0, level: 0 }
    case 'snow':
      return {
        spec: { key: 'surface:snow', noisePeriod: 24 },
        toneHz: 0,
        level: Math.round(2 + t * 4),
      }
    case 'ice':
      return {
        spec: { key: 'surface:ice', noisePeriod: null },
        toneHz: baseFreq * 2.5,
        level: Math.round(3 + t * 5),
      }
    case 'sand':
      return {
        spec: { key: 'surface:sand', noisePeriod: 12 },
        toneHz: 0,
        level: Math.round(3 + t * 6),
      }
    case 'mud':
      return {
        spec: { key: 'surface:mud', noisePeriod: 18 },
        toneHz: 0,
        level: Math.round(2 + t * 5),
      }
  }
}

function updateChannelC(frame: ChannelCFrame): void {
  if (!ay) return
  channelCLatestFrame = frame

  // During either fade, retain only the newest dynamic frequency/level. Calling
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
  channelCAppliedLevel = null
  const generation = channelCTransitionGeneration

  chip.fade('C', 0, CHANNEL_C_FADE_OUT_MS)
  channelCSwapTimer = setTimeout(() => {
    if (!isCurrentChannelCTransition(chip, generation, key)) return
    channelCSwapTimer = null

    const frame = channelCLatestFrame
    if (!frame || frame.spec.key !== key) return

    applyChannelCSource(chip, frame)
    channelCActiveKey = key
    chip.fade('C', ayLevelToChannelGain(frame.level), CHANNEL_C_FADE_IN_MS)
    channelCAppliedLevel = frame.level

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
  if (frame.level !== channelCAppliedLevel) {
    chip.volume('C', ayLevelToChannelGain(frame.level))
    channelCAppliedLevel = frame.level
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
  channelCAppliedLevel = null
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
  resetChannelCState()
  if (!chip) return
  chip.muteAll()
  chip.stop()
  ay = null
}
