/**
 * The two numbers the results screen derives rather than reports.
 *
 * Everything else on that screen is a value carried straight through from the
 * drive. These two are computed, which means they can be wrong — and one of them
 * can be wrong in the specific way that puts `Infinity` in front of a player.
 */

import { describe, it, expect } from 'vitest'
import { averageSpeedKph, formatClock } from '../runStats.ts'

describe('averageSpeedKph', () => {
  it('is distance over time, in whole km/h', () => {
    // 5 km in 6 minutes is 50 km/h — hand-checked, not derived from the code.
    expect(averageSpeedKph(5000, 6 * 60 * 1000)).toBe(50)
    // The tuned first leg: 5 km in 8 minutes.
    expect(averageSpeedKph(5000, 8 * 60 * 1000)).toBe(38)
  })

  it('never divides by zero', () => {
    // A game over on the first frame is rare. `Infinity km/h` on the results
    // screen would not be, and it is the kind of thing that only shows up in
    // front of someone else.
    expect(averageSpeedKph(0, 0)).toBe(0)
    expect(averageSpeedKph(100, 0)).toBe(0)
    expect(averageSpeedKph(0, 5000)).toBe(0)
    expect(Number.isFinite(averageSpeedKph(1, 0))).toBe(true)
  })

  it('rounds — the screen has no room for a decimal and no use for one', () => {
    // 1 km in 47 s is 76.59 km/h.
    expect(averageSpeedKph(1000, 47_000)).toBe(77)
    expect(Number.isInteger(averageSpeedKph(1234, 98_765))).toBe(true)
  })

  it('reads lower for a run that spent its time stopped', () => {
    // The whole point of the number: two runs, same distance, different story.
    const quick = averageSpeedKph(5000, 6 * 60 * 1000)
    const slow = averageSpeedKph(5000, 12 * 60 * 1000)
    expect(slow).toBeLessThan(quick)
  })
})

describe('formatClock', () => {
  it('is mm:ss, zero-padded', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(9_000)).toBe('00:09')
    expect(formatClock(65_000)).toBe('01:05')
  })

  it('lets the minutes run past sixty rather than wrapping', () => {
    // A long run is exactly when the number matters, and `01:04` for an hour and
    // four minutes would be a lie told to the one player who earned it.
    expect(formatClock(64 * 60 * 1000)).toBe('64:00')
    expect(formatClock(125 * 60 * 1000 + 7_000)).toBe('125:07')
  })

  it('truncates rather than rounds, so the clock never shows a second it has not reached', () => {
    expect(formatClock(1_999)).toBe('00:01')
  })

  it('does not print a negative clock', () => {
    expect(formatClock(-5_000)).toBe('00:00')
  })
})
