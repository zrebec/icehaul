import { describe, expect, it } from 'vitest'
import { DEFAULT_DRIVE_AUDIO_MIX_DB } from '../../audio/engine.ts'
import {
  advanceAudioLabState,
  audioLabStateAfterKey,
  createAudioLabState,
  type AudioLabAxes,
  type AudioLabState,
} from '../audioLab.ts'

const IDLE_AXES: AudioLabAxes = { left: false, right: false, down: false, up: false }

function stateWith(over: Partial<AudioLabState> = {}): AudioLabState {
  return { ...createAudioLabState(), ...over }
}

describe('audio lab controls', () => {
  it('starts at a useful, repeatable listening point with a fresh mix', () => {
    const state = createAudioLabState()

    expect(state).toEqual({
      speedKmh: 60,
      rpm: 0.5,
      surface: 'asphalt',
      mode: 'free',
      gear: 3,
      mixTarget: 'engine',
      mixDb: DEFAULT_DRIVE_AUDIO_MIX_DB,
      throttle: true,
      clutch: false,
      brake: false,
      running: true,
    })
    expect(createAudioLabState().mixDb).not.toBe(state.mixDb)
  })

  it.each([
    ['1', 'asphalt'],
    ['2', 'snow'],
    ['3', 'ice'],
    ['4', 'sand'],
    ['5', 'mud'],
  ] as const)('maps %s to %s and selects its mix trim', (key, surface) => {
    const state = audioLabStateAfterKey(createAudioLabState(), key)
    expect(state.surface).toBe(surface)
    expect(state.mixTarget).toBe(surface)
  })

  it('selects the engine trim without changing the active surface', () => {
    const ice = audioLabStateAfterKey(createAudioLabState(), '3')
    const engine = audioLabStateAfterKey(ice, '0')

    expect(engine.surface).toBe('ice')
    expect(engine.mixTarget).toBe('engine')
  })

  it('toggles throttle, clutch, brake and engine on key edges', () => {
    let state = createAudioLabState()
    state = audioLabStateAfterKey(state, 'T')
    state = audioLabStateAfterKey(state, 'c')
    state = audioLabStateAfterKey(state, 'B')
    state = audioLabStateAfterKey(state, 'R')

    expect(state).toMatchObject({
      throttle: false,
      clutch: true,
      brake: true,
      running: false,
    })
  })

  it('changes wheel speed and RPM independently in free mode', () => {
    const initial = createAudioLabState()
    const afterOneSecond = advanceAudioLabState(initial, {
      left: false, right: true, down: false, up: true,
    }, 1000)
    const afterTwoHalves = advanceAudioLabState(
      advanceAudioLabState(initial, {
        left: false, right: true, down: false, up: true,
      }, 500),
      { left: false, right: true, down: false, up: true },
      500,
    )

    expect(afterOneSecond.speedKmh).toBe(90)
    expect(afterOneSecond.rpm).toBeCloseTo(0.85)
    expect(afterTwoHalves.speedKmh).toBe(afterOneSecond.speedKmh)
    expect(afterTwoHalves.rpm).toBeCloseTo(afterOneSecond.rpm)
  })

  it('links RPM to speed and production gear while ignoring the free RPM axis', () => {
    const linked = audioLabStateAfterKey(createAudioLabState(), 'g')
    expect(linked.mode).toBe('linked')
    expect(linked.rpm).toBeCloseTo(60 / 76)

    const advanced = advanceAudioLabState(linked, {
      left: true, right: false, down: false, up: true,
    }, 1000)
    expect(advanced.speedKmh).toBe(30)
    expect(advanced.rpm).toBeCloseTo(30 / 76)

    const freeAgain = audioLabStateAfterKey(advanced, 'G')
    expect(freeAgain.mode).toBe('free')
    expect(freeAgain.rpm).toBe(advanced.rpm)
  })

  it('changes linked gears at fixed speed and clamps the resulting RPM', () => {
    const linked = stateWith({ mode: 'linked', speedKmh: 60, rpm: 60 / 76, gear: 3 })
    const upshift = audioLabStateAfterKey(linked, 'd')
    expect(upshift).toMatchObject({ speedKmh: 60, gear: 4, rpm: 0.6 })

    const downshift = audioLabStateAfterKey(linked, 'A')
    expect(downshift).toMatchObject({ speedKmh: 60, gear: 2, rpm: 1 })

    const free = stateWith({ mode: 'free' })
    expect(audioLabStateAfterKey(free, 'd')).toBe(free)

    const first = stateWith({ mode: 'linked', gear: 1 })
    const fifth = stateWith({ mode: 'linked', gear: 5 })
    expect(audioLabStateAfterKey(first, 'a')).toBe(first)
    expect(audioLabStateAfterKey(fifth, 'd')).toBe(fifth)
  })

  it('adjusts the selected trim immutably in one-decibel steps', () => {
    const initial = createAudioLabState()
    const quieter = audioLabStateAfterKey(initial, 'q')
    const louder = audioLabStateAfterKey(initial, 'E')
    const snow = audioLabStateAfterKey(initial, '2')
    const louderSnow = audioLabStateAfterKey(snow, 'e')

    expect(quieter.mixDb.engine).toBe(initial.mixDb.engine - 1)
    expect(louder.mixDb.engine).toBe(initial.mixDb.engine + 1)
    expect(louderSnow.mixDb.snow).toBe(initial.mixDb.snow + 1)
    expect(louderSnow.surface).toBe('snow')
    expect(initial.mixDb).toEqual(DEFAULT_DRIVE_AUDIO_MIX_DB)
    expect(quieter.mixDb).not.toBe(initial.mixDb)
  })

  it('clamps engine to -40..0 dB and rolling surfaces to -40..+12 dB', () => {
    const engineLow = stateWith({
      mixDb: { ...DEFAULT_DRIVE_AUDIO_MIX_DB, engine: -40 },
    })
    const engineHigh = stateWith({
      mixDb: { ...DEFAULT_DRIVE_AUDIO_MIX_DB, engine: 0 },
    })
    expect(audioLabStateAfterKey(engineLow, 'q')).toBe(engineLow)
    expect(audioLabStateAfterKey(engineHigh, 'e')).toBe(engineHigh)

    const asphaltLow = stateWith({
      mixTarget: 'asphalt',
      mixDb: { ...DEFAULT_DRIVE_AUDIO_MIX_DB, asphalt: -40 },
    })
    const asphaltHigh = stateWith({
      mixTarget: 'asphalt',
      mixDb: { ...DEFAULT_DRIVE_AUDIO_MIX_DB, asphalt: 12 },
    })
    expect(audioLabStateAfterKey(asphaltLow, 'q')).toBe(asphaltLow)
    expect(audioLabStateAfterKey(asphaltHigh, 'e')).toBe(asphaltHigh)
  })

  it('keeps ice fixed off when its trim is selected', () => {
    const ice = audioLabStateAfterKey(createAudioLabState(), '3')
    expect(audioLabStateAfterKey(ice, 'q')).toBe(ice)
    expect(audioLabStateAfterKey(ice, 'e')).toBe(ice)
  })

  it('clamps both free axes to their real ranges', () => {
    const high = advanceAudioLabState(
      stateWith({ speedKmh: 119, rpm: 0.99 }),
      { left: false, right: true, down: false, up: true },
      1000,
    )
    expect(high.speedKmh).toBe(120)
    expect(high.rpm).toBe(1)

    const low = advanceAudioLabState(
      stateWith({ speedKmh: 1, rpm: 0.01 }),
      { left: true, right: false, down: true, up: false },
      1000,
    )
    expect(low.speedKmh).toBe(0)
    expect(low.rpm).toBe(0)
  })

  it('does not move when opposite directions cancel or time goes backwards', () => {
    const initial = createAudioLabState()
    expect(advanceAudioLabState(initial, {
      left: true, right: true, down: true, up: true,
    }, 500)).toEqual(initial)
    expect(advanceAudioLabState(initial, IDLE_AXES, -100)).toEqual(initial)
  })

  it.each([NaN, Infinity, -Infinity])('treats non-finite dt %s as zero', (dtMs) => {
    const initial = createAudioLabState()
    expect(advanceAudioLabState(initial, {
      left: false, right: true, down: false, up: true,
    }, dtMs)).toEqual(initial)
  })

  it('ignores unrelated and removed controls', () => {
    const initial = createAudioLabState()
    expect(audioLabStateAfterKey(initial, 'z')).toBe(initial)
    expect(audioLabStateAfterKey(initial, 'x')).toBe(initial)
  })
})
