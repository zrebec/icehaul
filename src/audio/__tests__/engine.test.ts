import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => {
  const chip = {
    tone: vi.fn(),
    enableNoise: vi.fn(),
    disableNoise: vi.fn(),
    envelope: vi.fn(),
    mute: vi.fn(),
    muteAll: vi.fn(),
    pan: vi.fn(),
    setStereoMode: vi.fn(),
    volume: vi.fn(),
    fade: vi.fn(),
    stop: vi.fn(),
  }

  return {
    chip,
    createAY: vi.fn(() => chip),
    beep: vi.fn(),
    getAudioContext: vi.fn(() => null),
  }
})

vi.mock('zx-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('zx-kit')>()
  return {
    ...actual,
    createAY: audio.createAY,
    beep: audio.beep,
    getAudioContext: audio.getAudioContext,
  }
})

import { AY_VOL } from 'zx-kit'
import {
  ayLevelToChannelGain,
  muteEngine,
  startEngine,
  stopEngine,
  unmuteEngine,
  updateEngine,
} from '../engine.ts'

function clearChipCalls(): void {
  audio.chip.tone.mockClear()
  audio.chip.enableNoise.mockClear()
  audio.chip.disableNoise.mockClear()
  audio.chip.envelope.mockClear()
  audio.chip.mute.mockClear()
  audio.chip.muteAll.mockClear()
  audio.chip.pan.mockClear()
  audio.chip.setStereoMode.mockClear()
  audio.chip.volume.mockClear()
  audio.chip.fade.mockClear()
  audio.chip.stop.mockClear()
}

/**
 * Establish a known, silent Channel C before each transition assertion. This
 * also tolerates an implementation that treats the first asphalt frame as a
 * source transition instead of initialising it eagerly in startEngine().
 */
function startOnAsphalt(): void {
  startEngine()
  updateEngine(60, 0.5, 'asphalt', false, true)
  vi.advanceTimersByTime(60)
  clearChipCalls()
}

function channelCToneCalls(): unknown[][] {
  return audio.chip.tone.mock.calls.filter(([channel]) => channel === 'C')
}

beforeEach(() => {
  vi.useFakeTimers()
  stopEngine()
  vi.clearAllTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  stopEngine()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('ayLevelToChannelGain', () => {
  it('maps every AY register level to the equivalent linear channel gain', () => {
    for (let level = 0; level <= 15; level++) {
      expect(ayLevelToChannelGain(level)).toBe(15 * AY_VOL[level]!)
    }
  })

  it('clamps out-of-range levels and remains strictly monotonic', () => {
    expect(ayLevelToChannelGain(-100)).toBe(15 * AY_VOL[0]!)
    expect(ayLevelToChannelGain(100)).toBe(15 * AY_VOL[15]!)

    for (let level = 1; level <= 15; level++) {
      expect(ayLevelToChannelGain(level)).toBeGreaterThan(ayLevelToChannelGain(level - 1))
    }
  })
})

describe('Channel C surface gain', () => {
  it.each([
    ['snow', 24, 2, 6],
    ['sand', 12, 3, 9],
    ['mud', 18, 2, 7],
  ] as const)(
    '%s keeps noise full internally and applies the logarithmic level at the channel',
    (surface, noisePeriod, idleLevel, highLevel) => {
      startOnAsphalt()

      updateEngine(60, 0, surface, false, true)
      vi.advanceTimersByTime(20)

      expect(audio.chip.enableNoise).toHaveBeenCalledWith('C', noisePeriod)
      expect(channelCToneCalls()).toContainEqual(['C', 0, 15])
      expect(audio.chip.fade).toHaveBeenCalledWith(
        'C', ayLevelToChannelGain(idleLevel), 40,
      )

      vi.advanceTimersByTime(40)
      updateEngine(60, 1, surface, false, true)

      expect(audio.chip.volume).toHaveBeenLastCalledWith(
        'C', ayLevelToChannelGain(highLevel),
      )
    },
  )

  it('runs the ice tone at full internal strength and controls it through Channel C gain', () => {
    startOnAsphalt()

    updateEngine(60, 0.5, 'ice', false, true)
    vi.advanceTimersByTime(20)

    // Ice: (50 Hz + (280 - 50) * 0.5) * 2.5 = 412.5 Hz; level rounds to 6.
    expect(audio.chip.disableNoise).toHaveBeenCalledWith('C')
    expect(channelCToneCalls()).toContainEqual(['C', 412.5, 15])
    expect(audio.chip.fade).toHaveBeenCalledWith(
      'C', ayLevelToChannelGain(6), 40,
    )
  })

  it.each([
    ['asphalt', 6, 1020],
    ['ice', 3, 0],
  ] as const)(
    '%s braking applies the shared gain to its full-strength tone/noise source',
    (surface, noisePeriod, toneHz) => {
      startOnAsphalt()

      updateEngine(60, 0.5, surface, true, true)
      vi.advanceTimersByTime(20)

      expect(audio.chip.enableNoise).toHaveBeenCalledWith('C', noisePeriod)
      expect(channelCToneCalls()).toContainEqual(['C', toneHz, 15])
      expect(audio.chip.fade).toHaveBeenCalledWith(
        'C', ayLevelToChannelGain(10), 40,
      )
    },
  )
})

describe('Channel C source transitions', () => {
  it('fades out for 20 ms, switches while silent, then fades in for 40 ms exactly once', () => {
    startOnAsphalt()

    updateEngine(60, 0.5, 'sand', false, true)

    expect(audio.chip.fade).toHaveBeenCalledTimes(1)
    expect(audio.chip.fade).toHaveBeenLastCalledWith('C', 0, 20)
    expect(audio.chip.enableNoise).not.toHaveBeenCalled()

    vi.advanceTimersByTime(19)
    expect(audio.chip.enableNoise).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(audio.chip.enableNoise).toHaveBeenCalledTimes(1)
    expect(audio.chip.enableNoise).toHaveBeenCalledWith('C', 12)
    expect(audio.chip.fade).toHaveBeenCalledTimes(2)
    expect(audio.chip.fade).toHaveBeenLastCalledWith(
      'C', ayLevelToChannelGain(6), 40,
    )

    vi.advanceTimersByTime(40)
    expect(audio.chip.fade).toHaveBeenCalledTimes(2)
  })

  it('does not retrigger a transition for repeated frames of the same source', () => {
    startOnAsphalt()

    updateEngine(60, 0, 'sand', false, true)
    updateEngine(60, 0.5, 'sand', false, true)
    updateEngine(60, 1, 'sand', false, true)

    expect(audio.chip.fade).toHaveBeenCalledTimes(1)
    expect(audio.chip.fade).toHaveBeenLastCalledWith('C', 0, 20)

    vi.advanceTimersByTime(20)
    expect(audio.chip.enableNoise).toHaveBeenCalledTimes(1)
    expect(audio.chip.fade).toHaveBeenCalledTimes(2)
    expect(audio.chip.fade).toHaveBeenLastCalledWith(
      'C', ayLevelToChannelGain(9), 40,
    )

    updateEngine(60, 0.75, 'sand', false, true)
    vi.advanceTimersByTime(40)
    updateEngine(60, 0.25, 'sand', false, true)

    expect(audio.chip.enableNoise).toHaveBeenCalledTimes(1)
    expect(audio.chip.fade).toHaveBeenCalledTimes(2)
  })

  it('never applies a stale source when a rapid change supersedes it', () => {
    startOnAsphalt()

    updateEngine(60, 0.5, 'snow', false, true)
    vi.advanceTimersByTime(10)
    updateEngine(60, 0.5, 'mud', false, true)
    vi.advanceTimersByTime(100)

    const noisePeriods = audio.chip.enableNoise.mock.calls.map(([, period]) => period)
    expect(noisePeriods).not.toContain(24)
    expect(noisePeriods).toEqual([18])
  })

  it('cancels a pending source change when muted', () => {
    startOnAsphalt()

    updateEngine(60, 0.5, 'sand', false, true)
    muteEngine()
    vi.advanceTimersByTime(100)

    expect(audio.chip.muteAll).toHaveBeenCalledTimes(1)
    expect(audio.chip.enableNoise).not.toHaveBeenCalled()
    expect(audio.chip.fade).not.toHaveBeenCalledWith(
      'C', ayLevelToChannelGain(6), 40,
    )
  })

  it('restores the Channel C source on the first update after pause', () => {
    startOnAsphalt()
    updateEngine(60, 0.5, 'sand', false, true)
    vi.advanceTimersByTime(60)
    clearChipCalls()

    muteEngine()
    unmuteEngine()
    updateEngine(60, 0.5, 'sand', false, true)

    expect(audio.chip.fade).toHaveBeenCalledWith('C', 0, 20)
    expect(audio.chip.enableNoise).not.toHaveBeenCalled()

    vi.advanceTimersByTime(20)
    expect(audio.chip.enableNoise).toHaveBeenCalledWith('C', 12)
    expect(audio.chip.fade).toHaveBeenLastCalledWith(
      'C', ayLevelToChannelGain(6), 40,
    )
  })

  it('cancels a pending source change when stopped', () => {
    startOnAsphalt()

    updateEngine(60, 0.5, 'sand', false, true)
    stopEngine()
    vi.advanceTimersByTime(100)

    expect(audio.chip.stop).toHaveBeenCalledTimes(1)
    expect(audio.chip.enableNoise).not.toHaveBeenCalled()
    expect(audio.chip.fade).not.toHaveBeenCalledWith(
      'C', ayLevelToChannelGain(6), 40,
    )
  })
})

describe('engine lifecycle', () => {
  it('starts and stops idempotently', () => {
    startEngine()
    startEngine()

    expect(audio.createAY).toHaveBeenCalledTimes(1)

    stopEngine()
    stopEngine()

    expect(audio.chip.muteAll).toHaveBeenCalledTimes(1)
    expect(audio.chip.stop).toHaveBeenCalledTimes(1)
  })

  it('does not append volume automation while the rounded level is unchanged', () => {
    startOnAsphalt()
    updateEngine(60, 0.5, 'sand', false, true)
    vi.advanceTimersByTime(60)
    clearChipCalls()

    updateEngine(60, 0.50, 'sand', false, true)
    updateEngine(60, 0.51, 'sand', false, true)
    updateEngine(60, 0.54, 'sand', false, true)

    expect(audio.chip.volume).not.toHaveBeenCalled()
  })
})
