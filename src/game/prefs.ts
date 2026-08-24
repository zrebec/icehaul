/**
 * Player preferences — the three things the title menu can change, and the only
 * game state that outlives a run.
 *
 * These were `?outline=` and `?glow=` in the URL, which is a fine switch for an
 * A/B test and a poor one for a player. They keep working and still win, because
 * a URL is an explicit instruction for this one load: a comparison run must not
 * silently inherit whatever the last session happened to save.
 *
 * Volume is here for a duller reason. `setMasterVolume()` is a no-op until an
 * `AudioContext` exists, and the context cannot exist before a user gesture — so
 * something has to hold the number across that gap and hand it to `initAudio()`.
 * That something is this module.
 */
import { createSaveProfile, readSave, writeSave, setMasterVolume } from 'zx-kit'
import { contourEnabledFromSearch, glowSettingsFromSearch } from '../render/debug/trafficMatrix.ts'
import { setContourEnabled } from '../render/road3d.ts'
import { setGlowSettings } from '../render/vehicleGlow.ts'
import { GLOW_ALPHA } from '../config.ts'

/** What the title menu owns. Everything else about a run is derived from the seed. */
export interface Prefs {
  glow: boolean
  contour: boolean
  /** Master volume, 0–1. Seeds `initAudio()` before any context exists. */
  volume: number
}

export const DEFAULT_PREFS: Prefs = { glow: true, contour: true, volume: 0.3 }

/** Volume moves in tenths, so the menu can show it as a whole number 0–10. */
export const VOLUME_STEP = 0.1

let current: Prefs = { ...DEFAULT_PREFS }

const profile = createSaveProfile<Prefs>({
  key: 'iceroads-prefs',
  version: 1,
  serialize: () => ({ ...current }),
  deserialize: (data) => {
    current = sanitize(data)
  },
})

/**
 * Storage is the least trustworthy input in the game — hand-edited, half-written,
 * or left behind by an older build. Anything unrecognised falls back to a default
 * rather than propagating: a bad preference must never be able to stop a run.
 */
function sanitize(data: Partial<Prefs> | null | undefined): Prefs {
  const raw = data ?? {}
  return {
    glow: typeof raw.glow === 'boolean' ? raw.glow : DEFAULT_PREFS.glow,
    contour: typeof raw.contour === 'boolean' ? raw.contour : DEFAULT_PREFS.contour,
    volume: Number.isFinite(raw.volume)
      ? Math.max(0, Math.min(1, raw.volume as number))
      : DEFAULT_PREFS.volume,
  }
}

/** The live preferences. Never mutate the result — go through {@link updatePrefs}. */
export function getPrefs(): Readonly<Prefs> {
  return current
}

/**
 * Loads stored preferences, then lets the URL override what it names.
 *
 * A failed read is not an error worth surfacing: no save yet is the normal first
 * run, and a corrupt one is nothing the player can act on. Both mean defaults.
 */
export function loadPrefs(search = ''): Readonly<Prefs> {
  current = { ...DEFAULT_PREFS }
  readSave(profile) // deserialize() installs the result; failure leaves the defaults

  const params = new URLSearchParams(search)
  if (params.has('outline')) current.contour = contourEnabledFromSearch(search)
  if (params.has('glow')) current.glow = glowSettingsFromSearch(search).enabled

  applyPrefs()
  return current
}

/** Applies a change, pushes it into the renderers and audio, and persists it. */
export function updatePrefs(patch: Partial<Prefs>): Readonly<Prefs> {
  current = sanitize({ ...current, ...patch })
  applyPrefs()
  writeSave(profile) // a storage failure must not interrupt play
  return current
}

/**
 * Pushes the current values into the systems that own them.
 *
 * `setGlowSettings` wants a whole settings object, so the menu's on/off drives
 * `enabled` and the tuned constants supply the rest — the menu is a switch, not
 * a second place to tune bloom.
 */
export function applyPrefs(): void {
  setContourEnabled(current.contour)
  setGlowSettings({ enabled: current.glow, alpha: GLOW_ALPHA, radiusScale: 1 })
  setMasterVolume(current.volume) // no-op until initAudio(); seeded there instead
}

/** Test seam: forget what was loaded without touching storage. */
export function _resetPrefs(): void {
  current = { ...DEFAULT_PREFS }
}
