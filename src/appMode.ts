export type AppMode = 'matrix' | 'audioLab' | 'game'

/**
 * Pick the one production entry path requested by the URL.
 *
 * The traffic matrix keeps priority because it predates the audio lab and is a
 * deliberately static render path: it must never initialise input, audio or a
 * scene loop. Hidden modes are opt-in on the exact value `1`; malformed flags
 * fall through to the normal game rather than changing what boots.
 */
export function appModeFromSearch(search: string): AppMode {
  const query = new URLSearchParams(search)
  if (query.get('matrix') === '1') return 'matrix'
  if (query.get('audioLab') === '1') return 'audioLab'
  return 'game'
}
