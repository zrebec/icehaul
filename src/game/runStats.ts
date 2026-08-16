/**
 * What one run was worth, in the numbers a player can act on next time.
 *
 * The game-over screen used to print distance and time, which say *what
 * happened* without saying *how it went*. Average speed is the one derived
 * number that turns a run into feedback: 5 km in 8 minutes is 38 km/h, and a
 * player who reads 24 knows the ice cost them the delivery long before the clock
 * did. Canisters say the same thing about the other resource.
 *
 * Pure on purpose. The scene it feeds cannot be unit-tested — jsdom has no 2D
 * context — so everything that can be got wrong lives here instead, where a test
 * can hold it: the division that can be by zero, and the clock that has to keep
 * counting past an hour.
 */

/** Everything the game-over screen is given. One shape, declared once. */
export interface RunSummary {
  /** Metres actually driven. */
  distance: number
  /** Driving time only — `drive.ts` does not accumulate while waiting, paused
   *  or crashing, and never resets it on a delivery. So it is the whole run. */
  elapsedMs: number
  /** Fuel canisters picked up across the whole run. */
  canisters: number
  score: number
  reason: 'fuel' | 'offroad' | 'timeout' | 'crash'
}

/**
 * Average speed over the whole run, in whole km/h.
 *
 * Zero elapsed time returns 0 rather than dividing: a game over on the first
 * frame is rare, `Infinity km/h` on the results screen would not be, and it is
 * the kind of defect that only ever shows up in front of someone else.
 *
 * Rounded because the screen has no room for a decimal and no use for one — the
 * player is comparing 24 with 46, not 46.3 with 46.4.
 */
export function averageSpeedKph(distanceM: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || distanceM <= 0) return 0
  return Math.round((distanceM / 1000) / (elapsedMs / 3_600_000))
}

/**
 * `mm:ss`, with the minutes allowed to run past 60 rather than wrapping.
 *
 * A long run is exactly when the number matters, and `01:04` for an hour and
 * four minutes would be a lie told to the one player who earned it.
 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(total / 60).toString().padStart(2, '0')
  const ss = (total % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}
