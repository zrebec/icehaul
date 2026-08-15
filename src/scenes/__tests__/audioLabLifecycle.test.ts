import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => {
  const defaultMix = {
    engine: -20,
    asphalt: 0,
    snow: 0,
    ice: 0,
    sand: 0,
    mud: 0,
  }
  return {
    contextReady: false,
    defaultMix,
    resumeAudio: vi.fn(),
    startEngine: vi.fn(),
    stopEngine: vi.fn(),
    updateEngine: vi.fn(),
    drawText: vi.fn(),
    drawTextCentered: vi.fn(),
  }
})

vi.mock('zx-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('zx-kit')>()
  return {
    ...actual,
    drawText: audio.drawText,
    drawTextCentered: audio.drawTextCentered,
    getAudioContext: () => audio.contextReady ? ({} as AudioContext) : null,
    getMasterVolume: () => 0.3,
    resumeAudio: audio.resumeAudio,
  }
})

vi.mock('../../audio/engine.ts', () => ({
  DEFAULT_DRIVE_AUDIO_MIX_DB: audio.defaultMix,
  audioMixDbToPercent: (db: number) => 10 ** (db / 20) * 100,
  startEngine: audio.startEngine,
  stopEngine: audio.stopEngine,
  updateEngine: audio.updateEngine,
}))

import { createAudioLabScene } from '../audioLab.ts'
import type { Scene } from 'zx-kit'

let activeScene: Scene | null = null

function enterAudioLab(): Scene {
  const scene = createAudioLabScene()
  scene.onEnter?.(null)
  activeScene = scene
  return scene
}

function exitAudioLab(scene: Scene): void {
  scene.onExit?.(null)
  if (activeScene === scene) activeScene = null
}

beforeEach(() => {
  audio.contextReady = false
  vi.clearAllMocks()
})

afterEach(() => {
  if (activeScene) exitAudioLab(activeScene)
  vi.restoreAllMocks()
})

describe('audio lab scene lifecycle', () => {
  it('starts with the visible mix and updates through the shared drive state', () => {
    const scene = enterAudioLab()

    scene.update(16)
    expect(audio.startEngine).not.toHaveBeenCalled()
    expect(audio.updateEngine).not.toHaveBeenCalled()

    audio.contextReady = true
    scene.update(20)
    scene.update(25)

    expect(audio.startEngine).toHaveBeenCalledTimes(1)
    expect(audio.startEngine).toHaveBeenCalledWith(audio.defaultMix)
    expect(audio.updateEngine).toHaveBeenCalledTimes(2)
    expect(audio.updateEngine).toHaveBeenNthCalledWith(1, {
      dtMs: 20,
      speedKmh: 60,
      rpm: 0.5,
      surface: 'asphalt',
      throttle: true,
      clutch: false,
      brake: false,
      slipIntensity: 0,
      running: true,
      mixDb: audio.defaultMix,
    })
    expect(audio.updateEngine).toHaveBeenNthCalledWith(2, expect.objectContaining({
      dtMs: 25,
      mixDb: audio.defaultMix,
    }))

    exitAudioLab(scene)
    expect(audio.stopEngine).toHaveBeenCalledTimes(1)
  })

  it('accepts key-repeat for mix trims and starts with the adjusted value', () => {
    const scene = enterAudioLab()
    audio.contextReady = true

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', repeat: true }))
    scene.update(16)

    expect(audio.startEngine).toHaveBeenCalledWith({
      ...audio.defaultMix,
      engine: audio.defaultMix.engine - 1,
    })
    expect(audio.updateEngine).toHaveBeenCalledWith(expect.objectContaining({
      mixDb: { ...audio.defaultMix, engine: audio.defaultMix.engine - 1 },
    }))
  })

  it('clears held directions on blur', () => {
    const scene = enterAudioLab()
    audio.contextReady = true

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    window.dispatchEvent(new Event('blur'))
    scene.update(1000)

    expect(audio.updateEngine).toHaveBeenLastCalledWith(expect.objectContaining({
      speedKmh: 60,
    }))
  })

  it('renders every lab line inside the 32-column display', () => {
    const scene = enterAudioLab()
    const ctx = {
      fillStyle: '',
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D

    scene.render(ctx)

    const lines = [
      ...audio.drawTextCentered.mock.calls.map(([, text]) => text as string),
      ...audio.drawText.mock.calls.map(([, text]) => text as string),
    ]
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every(line => line.length <= 32)).toBe(true)
    expect(lines).toContain(' 3 ICE      OFF')
    expect(lines).toContain('-/+ MASTER 030%')
    expect(lines.some(line => line.startsWith('>0 ENGINE'))).toBe(true)
  })

  it('removes its key listeners on exit', () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const scene = enterAudioLab()
    const registrations = addListener.mock.calls.filter(([type]) => (
      type === 'keydown' || type === 'keyup' || type === 'blur'
    ))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T' }))
    expect(audio.resumeAudio).toHaveBeenCalledTimes(1)

    exitAudioLab(scene)
    expect(registrations.map(([type]) => type)).toEqual(['keydown', 'keyup', 'blur'])
    for (const [type, listener] of registrations) {
      expect(removeListener).toHaveBeenCalledWith(type, listener)
    }

    audio.resumeAudio.mockClear()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T' }))

    expect(audio.resumeAudio).not.toHaveBeenCalled()
  })
})
