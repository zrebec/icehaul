/**
 * Engine sound via AY-3-8912 chip (3 channels).
 *
 * Channel A: main engine tone (pitch tracks speed)
 * Channel B: detuned harmonic (+5-8 Hz offset for thickness)
 * Channel C: surface-specific texture (noise for snow/sand/mud, tone for ice)
 */
import { createAY, type AYChip } from 'zx-kit'
import { type Surface, SURFACE_ENGINE_SOUND, ENGINE_GAIN } from '../config.ts'

let ay: AYChip | null = null
let currentSurface: Surface | null = null

export function startEngine(): void {
  if (ay) return
  ay = createAY()
  // Start with silent channels
  ay.tone('A', 40, 8)
  ay.tone('B', 45, 5)
  currentSurface = 'asphalt'
}

export function updateEngine(speed: number, maxSpeed: number, surface: Surface): void {
  if (!ay) return

  const [, idleHz, topHz] = SURFACE_ENGINE_SOUND[surface]
  const t = Math.max(0, Math.min(1, speed / maxSpeed))
  const baseFreq = idleHz + (topHz - idleHz) * t

  // Channel A — main engine tone
  const mainVol = Math.round(6 + t * 6)  // 6-12 (louder at speed)
  ay.tone('A', baseFreq, mainVol)

  // Channel B — detuned harmonic (richer sound, slight chorus)
  const detune = 4 + t * 6
  ay.tone('B', baseFreq + detune, Math.round(mainVol * 0.6))

  // Channel C — surface texture (changes on surface transition)
  if (surface !== currentSurface) {
    applySurfaceTexture(surface, t)
    currentSurface = surface
  }
  updateSurfaceTexture(surface, t, baseFreq)
}

function applySurfaceTexture(surface: Surface, _t: number): void {
  if (!ay) return
  switch (surface) {
    case 'asphalt':
      ay.disableNoise('C')
      ay.tone('C', 0, 0)
      break
    case 'snow':
      ay.enableNoise('C', 24)  // dark, muffled crunch
      ay.tone('C', 0, 0)
      break
    case 'ice':
      ay.disableNoise('C')     // sharp tonal whine, no noise
      break
    case 'sand':
      ay.enableNoise('C', 12)  // gritty, medium texture
      ay.tone('C', 0, 0)
      break
    case 'mud':
      ay.enableNoise('C', 18)  // darker, bubbling
      ay.tone('C', 0, 0)
      break
  }
}

function updateSurfaceTexture(surface: Surface, t: number, baseFreq: number): void {
  if (!ay) return
  switch (surface) {
    case 'asphalt':
      break
    case 'snow':
      // Noise volume rises slightly with speed
      ay.tone('C', 0, Math.round(2 + t * 4))
      break
    case 'ice':
      // High-pitched whine that rises with speed
      ay.tone('C', baseFreq * 2.5, Math.round(3 + t * 5))
      break
    case 'sand':
      // Grit noise grows with speed
      ay.tone('C', 0, Math.round(3 + t * 6))
      break
    case 'mud':
      // Bubble noise, moderate
      ay.tone('C', 0, Math.round(2 + t * 5))
      break
  }
}

export function stopEngine(): void {
  if (!ay) return
  ay.muteAll()
  ay.stop()
  ay = null
  currentSurface = null
}
