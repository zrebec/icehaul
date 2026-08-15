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
  AUDIO_MIX_DB_MIN,
  DEFAULT_DRIVE_AUDIO_MIX_DB,
  ENGINE_MIX_DB_MAX,
  SURFACE_MIX_DB_MAX,
  audioMixDbToPercent,
  ayLevelToChannelGain,
  calculateEngineVoice,
  clampAudioMixDb,
  muteEngine,
  startEngine,
  stopEngine,
  unmuteEngine,
  updateEngine,
  type DriveAudioMixDb,
  type DriveAudioState,
} from '../engine.ts'

function driveState(over: Partial<DriveAudioState> = {}): DriveAudioState {
  return {
    dtMs: 16,
    speedKmh: 60,
    rpm: 0.5,
    surface: 'asphalt',
    throttle: false,
    clutch: false,
    brake: false,
    slipIntensity: 0,
    running: true,
    ...over,
  }
}

function mixDb(over: Partial<DriveAudioMixDb> = {}): DriveAudioMixDb {
  return { ...DEFAULT_DRIVE_AUDIO_MIX_DB, ...over }
}

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
 * Establish a known asphalt source before each transition assertion.
 */
function startOnAsphalt(): void {
  startEngine()
  updateEngine(driveState())
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

describe('drive audio mix', () => {
  it('ships the accepted engine attenuation and neutral surface trims', () => {
    expect(DEFAULT_DRIVE_AUDIO_MIX_DB).toEqual({
      engine: -20,
      asphalt: 0,
      snow: 0,
      ice: 0,
      sand: 0,
      mud: 0,
    })
  })

  it('clamps engine and surface controls to their separate safe ranges', () => {
    expect(clampAudioMixDb('engine', -100)).toBe(AUDIO_MIX_DB_MIN)
    expect(clampAudioMixDb('engine', 12)).toBe(ENGINE_MIX_DB_MAX)
    expect(clampAudioMixDb('snow', -100)).toBe(AUDIO_MIX_DB_MIN)
    expect(clampAudioMixDb('snow', 100)).toBe(SURFACE_MIX_DB_MAX)
  })

  it('falls back to the production value for non-finite controls', () => {
    expect(clampAudioMixDb('engine', NaN)).toBe(-20)
    expect(clampAudioMixDb('sand', Infinity)).toBe(0)
  })

  it('reports dB trims as their linear amplitude percentage', () => {
    expect(audioMixDbToPercent(-20)).toBeCloseTo(10)
    expect(audioMixDbToPercent(0)).toBe(100)
    expect(audioMixDbToPercent(12)).toBeCloseTo(398.107, 3)
    expect(audioMixDbToPercent(NaN)).toBe(0)
  })
})

describe('diesel engine voices', () => {
  it.each([
    [0, 45, 90],
    [1, 140, 280],
  ] as const)('maps rpm %s to a %s Hz fundamental and exact second harmonic', (rpm, aHz, bHz) => {
    const voice = calculateEngineVoice(driveState({ rpm }), null)

    expect(voice.audioRpm).toBe(rpm)
    expect(voice.fundamentalHz).toBe(aHz)
    expect(voice.harmonicHz).toBe(bHz)
    expect(voice.harmonicHz).toBe(voice.fundamentalHz * 2)
  })

  it('produces the same engine voice at the same rpm on every surface', () => {
    const surfaces = ['asphalt', 'snow', 'ice', 'sand', 'mud'] as const
    const voices = surfaces.map(surface => calculateEngineVoice(
      driveState({ dtMs: 16, rpm: 0.63, surface, throttle: true }),
      0.4,
    ))

    for (const voice of voices.slice(1)) expect(voice).toEqual(voices[0])
  })

  it('uses frame-rate-independent 40 ms inertia without overshooting', () => {
    let steppedRpm = 0.2
    for (let i = 0; i < 4; i++) {
      steppedRpm = calculateEngineVoice(
        driveState({ dtMs: 10, rpm: 0.9 }),
        steppedRpm,
      ).audioRpm
    }
    const singleStep = calculateEngineVoice(
      driveState({ dtMs: 40, rpm: 0.9 }),
      0.2,
    ).audioRpm

    expect(steppedRpm).toBeCloseTo(singleStep, 12)
    expect(singleStep).toBeGreaterThan(0.2)
    expect(singleStep).toBeLessThan(0.9)

    const falling = calculateEngineVoice(driveState({ dtMs: 50, rpm: 0.1 }), 0.9)
    expect(falling.audioRpm).toBeGreaterThan(0.1)
    expect(falling.audioRpm).toBeLessThan(0.9)
  })

  it('makes an upshift lower pitch smoothly instead of snapping', () => {
    const before = calculateEngineVoice(driveState({ rpm: 0.85 }), null)
    const after = calculateEngineVoice(
      driveState({ dtMs: 16, rpm: 0.45 }),
      before.audioRpm,
    )

    expect(after.audioRpm).toBeGreaterThan(0.45)
    expect(after.audioRpm).toBeLessThan(before.audioRpm)
    expect(after.fundamentalHz).toBeLessThan(before.fundamentalHz)
  })

  it('keeps clutch out of pitch while load makes coupled throttle louder', () => {
    const coast = calculateEngineVoice(driveState({ rpm: 0.5 }), null)
    const freeRev = calculateEngineVoice(
      driveState({ rpm: 0.5, throttle: true, clutch: true }),
      null,
    )
    const loaded = calculateEngineVoice(
      driveState({ rpm: 0.5, throttle: true, clutch: false }),
      null,
    )

    expect(freeRev.fundamentalHz).toBe(loaded.fundamentalHz)
    expect(freeRev.harmonicHz).toBe(loaded.harmonicHz)
    expect(loaded.load).toBeGreaterThan(freeRev.load)
    expect(loaded.fundamentalLevel).toBeGreaterThan(freeRev.fundamentalLevel)
    expect(freeRev.fundamentalLevel).toBeGreaterThan(coast.fundamentalLevel)
    expect(loaded.harmonicLevel).toBeGreaterThan(freeRev.harmonicLevel)
    expect(freeRev.harmonicLevel).toBeGreaterThan(coast.harmonicLevel)
  })

  it('keeps the accepted voice balance at the 600 RPM listening benchmark', () => {
    const rpm = 600 / 2600
    const coast = calculateEngineVoice(driveState({ rpm }), null)
    const freeRev = calculateEngineVoice(
      driveState({ rpm, throttle: true, clutch: true }),
      null,
    )
    const loaded = calculateEngineVoice(
      driveState({ rpm, throttle: true, clutch: false }),
      null,
    )

    expect([coast.fundamentalLevel, coast.harmonicLevel]).toEqual([7, 4])
    expect([freeRev.fundamentalLevel, freeRev.harmonicLevel]).toEqual([8, 5])
    expect([loaded.fundamentalLevel, loaded.harmonicLevel]).toEqual([10, 7])
  })

  it('silences both engine channels when the motor is not running', () => {
    const voice = calculateEngineVoice(
      driveState({ throttle: true, running: false }),
      null,
    )

    expect(voice.fundamentalLevel).toBe(0)
    expect(voice.harmonicLevel).toBe(0)
    expect(voice.load).toBe(0)
  })

  it('only sends finite frequencies and integer AY levels to A and B', () => {
    startEngine()
    clearChipCalls()

    for (const rpm of [-1, 0, 0.37, 1, 2]) {
      updateEngine(driveState({ rpm, throttle: true }))
    }

    const engineCalls = audio.chip.tone.mock.calls.filter(([channel]) => channel !== 'C')
    expect(engineCalls).toHaveLength(10)
    for (const [, frequency, level] of engineCalls) {
      expect(Number.isFinite(frequency)).toBe(true)
      expect(Number.isFinite(level)).toBe(true)
      expect(Number.isInteger(level)).toBe(true)
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThanOrEqual(15)
    }
  })
})

describe('Channel C surface gain', () => {
  it.each([
    ['snow', 24, 2, 6],
    ['sand', 12, 3, 9],
    ['mud', 18, 2, 7],
  ] as const)(
    '%s follows wheel speed and applies its logarithmic level at the channel',
    (surface, noisePeriod, lowLevel, highLevel) => {
      startOnAsphalt()

      updateEngine(driveState({ speedKmh: 1, rpm: 1, surface }))
      vi.advanceTimersByTime(20)

      expect(audio.chip.enableNoise).toHaveBeenCalledWith('C', noisePeriod)
      expect(channelCToneCalls()).toContainEqual(['C', 0, 15])
      expect(audio.chip.fade).toHaveBeenCalledWith(
        'C', ayLevelToChannelGain(lowLevel), 40,
      )

      vi.advanceTimersByTime(40)
      updateEngine(driveState({ speedKmh: 120, rpm: 0, surface }))

      expect(audio.chip.volume).toHaveBeenLastCalledWith(
        'C', ayLevelToChannelGain(highLevel),
      )
    },
  )

  it('configures a quiet asphalt rolling-noise source on the first real frame', () => {
    startEngine()
    clearChipCalls()

    updateEngine(driveState({ speedKmh: 60, surface: 'asphalt' }))
    vi.advanceTimersByTime(20)

    expect(audio.chip.enableNoise).toHaveBeenCalledWith('C', 31)
    expect(channelCToneCalls()).toContainEqual(['C', 0, 15])
    expect(audio.chip.fade).toHaveBeenCalledWith(
      'C', ayLevelToChannelGain(1), 40,
    )
  })

  it('removes the stable ice tone and leaves Channel C silent', () => {
    startOnAsphalt()

    updateEngine(driveState({
      speedKmh: 120,
      surface: 'ice',
      mixDb: mixDb({ ice: 12 }),
    }))
    vi.advanceTimersByTime(20)

    expect(audio.chip.disableNoise).toHaveBeenCalledWith('C')
    expect(channelCToneCalls()).toContainEqual(['C', 0, 15])
    expect(audio.chip.fade).toHaveBeenCalledWith('C', 0, 40)
  })

  it.each(['asphalt', 'snow', 'ice', 'sand', 'mud'] as const)(
    'keeps %s rolling texture silent at standstill',
    (surface) => {
      startEngine()
      clearChipCalls()

      updateEngine(driveState({ speedKmh: 0, rpm: 1, surface }))
      vi.advanceTimersByTime(20)

      expect(audio.chip.fade).toHaveBeenCalledWith('C', 0, 40)
    },
  )

  it('does not change rolling gain when only engine RPM changes', () => {
    startOnAsphalt()
    updateEngine(driveState({ speedKmh: 60, rpm: 0, surface: 'sand' }))
    vi.advanceTimersByTime(60)
    clearChipCalls()

    updateEngine(driveState({ speedKmh: 60, rpm: 1, surface: 'sand' }))

    expect(audio.chip.volume).not.toHaveBeenCalled()
    expect(audio.chip.fade).not.toHaveBeenCalled()
  })

  it('applies an active surface dB trim after the logarithmic AY level', () => {
    startOnAsphalt()
    const boosted = mixDb({ sand: 6 })

    updateEngine(driveState({ speedKmh: 60, surface: 'sand', mixDb: boosted }))
    vi.advanceTimersByTime(20)

    const expectedBoosted = ayLevelToChannelGain(6) * 10 ** (6 / 20)
    expect(audio.chip.fade).toHaveBeenCalledWith('C', expectedBoosted, 40)

    vi.advanceTimersByTime(40)
    clearChipCalls()
    const cut = mixDb({ sand: -6 })
    updateEngine(driveState({ speedKmh: 60, surface: 'sand', mixDb: cut }))

    expect(audio.chip.volume).toHaveBeenCalledWith(
      'C', ayLevelToChannelGain(6) * 10 ** (-6 / 20),
    )
  })

  it.each([
    ['asphalt', 6, 1020],
    ['ice', 3, 0],
  ] as const)(
    '%s braking applies the shared gain to its full-strength tone/noise source',
    (surface, noisePeriod, toneHz) => {
      startOnAsphalt()

      updateEngine(
        driveState({ surface, brake: true, mixDb: mixDb({ [surface]: -40 }) }),
      )
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
  it('keeps A and B following RPM while Channel C is fading', () => {
    startOnAsphalt()

    updateEngine(driveState({ rpm: 0.2, surface: 'sand' }))
    updateEngine(driveState({ rpm: 0.9, surface: 'sand', throttle: true }))

    const aCalls = audio.chip.tone.mock.calls.filter(([channel]) => channel === 'A')
    const bCalls = audio.chip.tone.mock.calls.filter(([channel]) => channel === 'B')
    expect(aCalls).toHaveLength(2)
    expect(bCalls).toHaveLength(2)
    expect(aCalls[1]![1]).toBeGreaterThan(aCalls[0]![1])
    expect(bCalls[1]![1]).toBeGreaterThan(bCalls[0]![1])
    expect(audio.chip.enableNoise).not.toHaveBeenCalled()
    expect(audio.chip.fade).toHaveBeenCalledTimes(1)
  })

  it('fades out for 20 ms, switches while silent, then fades in for 40 ms exactly once', () => {
    startOnAsphalt()

    updateEngine(driveState({ surface: 'sand' }))

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

    updateEngine(driveState({ rpm: 0, surface: 'sand' }))
    updateEngine(driveState({ rpm: 0.5, surface: 'sand' }))
    updateEngine(driveState({ rpm: 1, surface: 'sand' }))

    expect(audio.chip.fade).toHaveBeenCalledTimes(1)
    expect(audio.chip.fade).toHaveBeenLastCalledWith('C', 0, 20)

    vi.advanceTimersByTime(20)
    expect(audio.chip.enableNoise).toHaveBeenCalledTimes(1)
    expect(audio.chip.fade).toHaveBeenCalledTimes(2)
    expect(audio.chip.fade).toHaveBeenLastCalledWith(
      'C', ayLevelToChannelGain(6), 40,
    )

    updateEngine(driveState({ rpm: 0.75, surface: 'sand' }))
    vi.advanceTimersByTime(40)
    updateEngine(driveState({ rpm: 0.25, surface: 'sand' }))

    expect(audio.chip.enableNoise).toHaveBeenCalledTimes(1)
    expect(audio.chip.fade).toHaveBeenCalledTimes(2)
  })

  it('never applies a stale source when a rapid change supersedes it', () => {
    startOnAsphalt()

    updateEngine(driveState({ surface: 'snow' }))
    vi.advanceTimersByTime(10)
    updateEngine(driveState({ surface: 'mud' }))
    vi.advanceTimersByTime(100)

    const noisePeriods = audio.chip.enableNoise.mock.calls.map(([, period]) => period)
    expect(noisePeriods).not.toContain(24)
    expect(noisePeriods).toEqual([18])
  })

  it('cancels a pending source change when muted', () => {
    startOnAsphalt()

    updateEngine(driveState({ surface: 'sand' }))
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
    updateEngine(driveState({ surface: 'sand' }))
    vi.advanceTimersByTime(60)
    clearChipCalls()

    muteEngine()
    unmuteEngine()
    updateEngine(driveState({ surface: 'sand' }))

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

    updateEngine(driveState({ surface: 'sand' }))
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
  it('starts A and B silently at the diesel range floor', () => {
    startEngine()

    expect(audio.chip.tone).toHaveBeenCalledWith('A', 45, 0)
    expect(audio.chip.tone).toHaveBeenCalledWith('B', 90, 0)
  })

  it('mixes A and B equally behind the road layer once per AY instance', () => {
    startEngine()

    expect(audio.chip.volume).toHaveBeenCalledWith('A', 15 * 10 ** (-20 / 20))
    expect(audio.chip.volume).toHaveBeenCalledWith('B', 15 * 10 ** (-20 / 20))

    startEngine()
    expect(audio.chip.volume.mock.calls.filter(([channel]) => channel === 'A')).toHaveLength(1)
    expect(audio.chip.volume.mock.calls.filter(([channel]) => channel === 'B')).toHaveLength(1)
  })

  it('updates the shared A/B dB trim once when the lab changes it', () => {
    startEngine()
    clearChipCalls()
    const quieter = mixDb({ engine: -30 })

    updateEngine(driveState({ mixDb: quieter }))
    updateEngine(driveState({ mixDb: quieter }))

    const expected = 15 * 10 ** (-30 / 20)
    expect(audio.chip.volume.mock.calls.filter(([channel]) => channel === 'A'))
      .toEqual([['A', expected]])
    expect(audio.chip.volume.mock.calls.filter(([channel]) => channel === 'B'))
      .toEqual([['B', expected]])
  })

  it('clamps an engine start mix at 0 dB', () => {
    startEngine(mixDb({ engine: 12 }))

    expect(audio.chip.volume).toHaveBeenCalledWith('A', 15)
    expect(audio.chip.volume).toHaveBeenCalledWith('B', 15)
  })

  it('starts and stops idempotently', () => {
    startEngine()
    startEngine()

    expect(audio.createAY).toHaveBeenCalledTimes(1)

    stopEngine()
    stopEngine()

    expect(audio.chip.muteAll).toHaveBeenCalledTimes(1)
    expect(audio.chip.stop).toHaveBeenCalledTimes(1)
  })

  it('resets RPM smoothing across stop and a fresh start', () => {
    startEngine()
    updateEngine(driveState({ rpm: 1 }))
    stopEngine()
    startEngine()
    clearChipCalls()

    updateEngine(driveState({ rpm: 0 }))

    expect(audio.chip.tone).toHaveBeenCalledWith('A', 45, expect.any(Number))
    expect(audio.chip.tone).toHaveBeenCalledWith('B', 90, expect.any(Number))
  })

  it('does not append Channel C automation while speed and mix stay unchanged', () => {
    startOnAsphalt()
    updateEngine(driveState({ surface: 'sand' }))
    vi.advanceTimersByTime(60)
    clearChipCalls()

    updateEngine(driveState({ rpm: 0.50, surface: 'sand' }))
    updateEngine(driveState({ rpm: 0.51, surface: 'sand' }))
    updateEngine(driveState({ rpm: 0.54, surface: 'sand' }))

    expect(audio.chip.volume).not.toHaveBeenCalled()
  })
})
