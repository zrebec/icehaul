import { getAudioContext, getMasterGain } from 'zx-kit'
import { ENGINE_IDLE_HZ, ENGINE_TOP_HZ, ENGINE_GAIN } from '../config.ts'

let osc: OscillatorNode | null = null
let gain: GainNode | null = null

export function startEngine(): void {
  const ctx = getAudioContext()
  const master = getMasterGain()
  if (!ctx || !master || osc) return

  osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.value = ENGINE_IDLE_HZ

  gain = ctx.createGain()
  gain.gain.value = ENGINE_GAIN

  osc.connect(gain)
  gain.connect(master)
  osc.start()
}

export function setEngineRPM(speed: number, maxSpeed: number): void {
  if (!osc) return
  const t = Math.max(0, Math.min(1, speed / maxSpeed))
  osc.frequency.setTargetAtTime(
    ENGINE_IDLE_HZ + (ENGINE_TOP_HZ - ENGINE_IDLE_HZ) * t,
    osc.context.currentTime,
    0.05,
  )
}

export function stopEngine(): void {
  if (!osc) return
  try { osc.stop() } catch { /* already stopped */ }
  osc.disconnect()
  gain?.disconnect()
  osc = null
  gain = null
}
