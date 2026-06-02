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
import { createAY, beep, getAudioContext, type AYChip } from 'zx-kit'
import { type Surface, SURFACE_ENGINE_SOUND, SURFACE_BRAKE } from '../config.ts'

let ay: AYChip | null = null
let currentSurface: Surface | null = null
let isBraking = false

export function startEngine(): void {
  if (ay) return
  ay = createAY()
  ay.tone('A', 40, 8)
  ay.tone('B', 45, 5)
  currentSurface = 'asphalt'
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

  // Channel C — brake sound OR surface texture
  const brakeSound = SURFACE_BRAKE[surface].sound
  const shouldBrake = braking && speed > 15 && brakeSound !== 'none'

  if (shouldBrake !== isBraking || surface !== currentSurface) {
    if (shouldBrake) {
      applyBrakeSound(surface, t)
    } else {
      applySurfaceTexture(surface, t)
    }
    isBraking = shouldBrake
    currentSurface = surface
  }

  if (shouldBrake) {
    updateBrakeSound(surface, t, speed)
  } else {
    if (surface !== currentSurface) {
      applySurfaceTexture(surface, t)
      currentSurface = surface
    }
    updateSurfaceTexture(surface, t, baseFreq)
  }

  currentSurface = surface
}

// ── Brake sounds on AY Channel C ────────────────────────────────────────────

function applyBrakeSound(surface: Surface, _t: number): void {
  if (!ay) return
  const sound = SURFACE_BRAKE[surface].sound
  if (sound === 'screech') {
    // Asphalt: tone + noise mixed (rubber screech)
    ay.enableNoise('C', 6)
  } else if (sound === 'grind') {
    // Ice: pure noise (metal scraping, very harsh)
    ay.enableNoise('C', 3)
  }
}

let lastBrakePopS = 0

function updateBrakeSound(surface: Surface, t: number, speed: number): void {
  if (!ay) return
  const sound = SURFACE_BRAKE[surface].sound
  const vol = Math.round(6 + t * 8)  // louder at higher speed

  if (sound === 'screech') {
    // Descending tone: high pitch at high speed → low as truck slows
    const screechFreq = 300 + speed * 12
    ay.tone('C', screechFreq, vol)
  } else if (sound === 'grind') {
    // No tone, just noise — volume tracks speed
    ay.tone('C', 0, vol)
  }

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

// ── Surface texture on AY Channel C (when NOT braking) ──────────────────────

function applySurfaceTexture(surface: Surface, _t: number): void {
  if (!ay) return
  switch (surface) {
    case 'asphalt':
      ay.disableNoise('C')
      ay.tone('C', 0, 0)
      break
    case 'snow':
      ay.enableNoise('C', 24)
      ay.tone('C', 0, 0)
      break
    case 'ice':
      ay.disableNoise('C')
      break
    case 'sand':
      ay.enableNoise('C', 12)
      ay.tone('C', 0, 0)
      break
    case 'mud':
      ay.enableNoise('C', 18)
      ay.tone('C', 0, 0)
      break
  }
}

function updateSurfaceTexture(surface: Surface, t: number, baseFreq: number): void {
  if (!ay) return
  switch (surface) {
    case 'asphalt': break
    case 'snow': ay.tone('C', 0, Math.round(2 + t * 4)); break
    case 'ice':  ay.tone('C', baseFreq * 2.5, Math.round(3 + t * 5)); break
    case 'sand': ay.tone('C', 0, Math.round(3 + t * 6)); break
    case 'mud':  ay.tone('C', 0, Math.round(2 + t * 5)); break
  }
}

// ── Control ─────────────────────────────────────────────────────────────────

export function muteEngine(): void {
  if (ay) ay.muteAll()
}

export function unmuteEngine(): void {
  if (ay) { currentSurface = null; isBraking = false }
}

export function stopEngine(): void {
  if (!ay) return
  ay.muteAll()
  ay.stop()
  ay = null
  currentSurface = null
  isBraking = false
}
