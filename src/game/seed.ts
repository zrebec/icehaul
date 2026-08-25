/**
 * Route seed selection.
 *
 * The road, traffic and canisters are all deterministic functions of one number,
 * so a seed is the whole route. Two ways to pick it:
 *
 *   - one route per local calendar day, so everyone gets the same road today and
 *     a different one tomorrow;
 *   - `?seed=` in the URL, which makes a specific route replayable for physics
 *     A/B tests and playtests without touching surface probabilities.
 *
 * Ported from the parallel codex working copy.
 */

/**
 * Hand-verified worst case: a mostly-ice route for repeatable physics playtests.
 * Load it with `?seed=1443866`.
 *
 * Measured over the first 5 km on the current generator: **48.5% ice**, 56.5%
 * non-asphalt overall, and 475 m of that ice sitting inside a bend of |c| >= 1.5
 * — which is the combination worth testing, and which the generator is allowed
 * to produce precisely because the lateral model now survives it.
 *
 * The best of 13 candidates found by sweeping two million seeds for 35-60% ice
 * with at least 300 m of it in a sharp curve. Alternatives, all confirmed
 * completable: 534501 (725 m of ice in sharp bends), 1399375 (650 m), 52662
 * (625 m).
 *
 * Owner playtested this seed end to end on the pre-fix physics and finished with
 * roughly 12 seconds to spare, so it is a real difficulty benchmark rather than
 * a synthetic one.
 */
export const ICE_PLAYTEST_SEED = 1_443_866

/**
 * Build the daily route seed from local calendar components (`YYYYMMDD`).
 *
 * Read as components rather than from a UTC timestamp: a player east or west of
 * UTC would otherwise get tomorrow's road before midnight, or yesterday's after.
 * Taking a Date keeps it testable without moving the system clock.
 */
export function dailyRoadSeed(date: Date = new Date()): number {
  return date.getFullYear() * 10_000
    + (date.getMonth() + 1) * 100
    + date.getDate()
}

/** Largest seed the road's 32-bit hash accepts without losing precision. */
const MAX_SEED = 0xffff_ffff

/**
 * Resolve an optional decimal `?seed=` override, otherwise today's route.
 * Anything malformed — empty, negative, fractional, exponent notation, or past
 * the 32-bit ceiling — falls back to the daily seed rather than failing.
 */
export function roadSeedFromSearch(search: string, date: Date = new Date()): number {
  const raw = new URLSearchParams(search).get('seed')?.trim()
  if (!raw || !/^\d+$/.test(raw)) return dailyRoadSeed(date)

  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed <= MAX_SEED
    ? parsed
    : dailyRoadSeed(date)
}

/** ROM-font-safe month names: the font is ASCII 32-127 and has no glyph above it. */
const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const

/**
 * Decodes a daily seed back into its calendar date, or `null` if it is not one.
 *
 * A daily seed *is* the date — {@link dailyRoadSeed} builds `YYYYMMDD` and nothing
 * else — so a route from any day is recoverable from the calendar alone. That makes
 * the decode worth doing rather than storing a date alongside: there is only ever
 * one number, and it cannot fall out of step with itself.
 *
 * The round trip through `Date` is what rejects `20260231`: constructing 31 February
 * rolls forward to 3 March, and the components then no longer match what went in.
 */
export function seedToDate(seed: number): { year: number; month: number; day: number } | null {
  if (!Number.isInteger(seed) || seed < 1_000_00_00 || seed > 9999_12_31) return null
  const year = Math.floor(seed / 10_000)
  const month = Math.floor(seed / 100) % 100
  const day = seed % 100
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const probe = new Date(year, month - 1, day)
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return null
  }
  return { year, month, day }
}

/**
 * The route's human name: `25 AUG 2026` for a daily seed, `CUSTOM` for anything else.
 *
 * Paired with the raw number on the results screen rather than replacing it. The
 * date is what a player says out loud; the number is what they type into `?seed=`.
 * Both are shown because only one of them is actionable and only one of them is
 * memorable.
 */
export function formatSeedRoute(seed: number): string {
  const date = seedToDate(seed)
  if (!date) return 'CUSTOM'
  return `${date.day} ${MONTHS[date.month - 1]} ${date.year}`
}
