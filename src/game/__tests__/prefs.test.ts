import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, getPrefs, loadPrefs, updatePrefs, _resetPrefs } from '../prefs.ts'
import { isContourEnabled } from '../../render/road3d.ts'

/** zx-kit namespaces every save as `zxkit:<profile>:<slot>`. */
const SAVE_KEY = 'zxkit:iceroads-prefs:default'

beforeEach(() => {
  localStorage.clear()
  _resetPrefs()
})

describe('prefs — loading', () => {
  it('falls back to defaults on a first run', () => {
    expect(loadPrefs('')).toEqual(DEFAULT_PREFS)
  })

  it('restores what was saved', () => {
    updatePrefs({ glow: false, volume: 0.7 })
    _resetPrefs()

    const loaded = loadPrefs('')
    expect(loaded.glow).toBe(false)
    expect(loaded.volume).toBeCloseTo(0.7, 5)
  })

  it('survives storage holding something it did not write', () => {
    // Half-written, hand-edited or left by an older build — all the same to us.
    localStorage.setItem(SAVE_KEY, '{ not json')
    expect(() => loadPrefs('')).not.toThrow()
    expect(getPrefs()).toEqual(DEFAULT_PREFS)
  })

  it('replaces individually wrong fields rather than the whole record', () => {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 1,
        timestamp: Date.now(),
        data: { glow: 'yes', contour: false, volume: 'loud' },
      }),
    )

    expect(() => loadPrefs('')).not.toThrow()
    const prefs = getPrefs()
    // The one good field survives; the two nonsense ones fall back on their own.
    expect(prefs.contour).toBe(false)
    expect(prefs.glow).toBe(DEFAULT_PREFS.glow)
    expect(prefs.volume).toBe(DEFAULT_PREFS.volume)
  })
})

describe('prefs — URL overrides', () => {
  it('lets an explicit switch beat the stored choice', () => {
    updatePrefs({ glow: true, contour: true })
    _resetPrefs()

    const loaded = loadPrefs('?glow=0&outline=0')
    expect(loaded.glow).toBe(false)
    expect(loaded.contour).toBe(false)
  })

  it('leaves the stored choice alone when the switch is absent', () => {
    updatePrefs({ glow: false })
    _resetPrefs()

    expect(loadPrefs('?seed=123').glow).toBe(false)
  })

  it('does not write the override back to storage', () => {
    // An A/B run is for this load only; it must not change what the player saved.
    updatePrefs({ glow: true })
    loadPrefs('?glow=0')
    expect(getPrefs().glow).toBe(false)

    _resetPrefs()
    expect(loadPrefs('').glow).toBe(true)
  })
})

describe('prefs — clamping', () => {
  it('keeps volume inside 0..1', () => {
    expect(updatePrefs({ volume: 5 }).volume).toBe(1)
    expect(updatePrefs({ volume: -3 }).volume).toBe(0)
  })

  it('ignores a non-finite volume instead of storing it', () => {
    updatePrefs({ volume: 0.5 })
    expect(updatePrefs({ volume: Number.NaN }).volume).toBe(DEFAULT_PREFS.volume)
  })
})

describe('prefs — application', () => {
  it('pushes contour into the renderer that owns it', () => {
    updatePrefs({ contour: false })
    expect(isContourEnabled()).toBe(false)

    updatePrefs({ contour: true })
    expect(isContourEnabled()).toBe(true)
  })

  it('keeps working when storage refuses to write', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    try {
      // A full or blocked localStorage is the player's problem, not the game's.
      expect(() => updatePrefs({ glow: false })).not.toThrow()
      expect(getPrefs().glow).toBe(false)
    } finally {
      setItem.mockRestore()
    }
  })
})
