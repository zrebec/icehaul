import { getAudioContext, getMasterGain } from 'zx-kit'
import { type Surface, SURFACE_ENGINE_SOUND, ENGINE_GAIN } from '../config.ts'

let osc: OscillatorNode | null = null
let gain: GainNode | null = null
let currentSurface: Surface | null = null

export function startEngine(): void {
  const ctx = getAudioContext()
  const master = getMasterGain()
  if (!ctx || !master || osc) return

  osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.value = SURFACE_ENGINE_SOUND.asphalt[1]

  gain = ctx.createGain()
  gain.gain.value = ENGINE_GAIN

  osc.connect(gain)
  gain.connect(master)
  osc.start()
  currentSurface = 'asphalt'
}

export function updateEngine(speed: number, maxSpeed: number, surface: Surface): void {
  if (!osc) return

  const [type, idleHz, topHz] = SURFACE_ENGINE_SOUND[surface]
  const t = Math.max(0, Math.min(1, speed / maxSpeed))
  const targetFreq = idleHz + (topHz - idleHz) * t

  // Switch oscillator type when surface changes
  if (surface !== currentSurface) {
    osc.type = type
    currentSurface = surface
  }

  osc.frequency.setTargetAtTime(targetFreq, osc.context.currentTime, 0.05)
}

export function stopEngine(): void {
  if (!osc) return
  try { osc.stop() } catch { /* already stopped */ }
  osc.disconnect()
  gain?.disconnect()
  osc = null
  gain = null
  currentSurface = null
}
