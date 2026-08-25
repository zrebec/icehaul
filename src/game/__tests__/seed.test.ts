import { describe, expect, it } from 'vitest'
import { dailyRoadSeed, formatSeedRoute, roadSeedFromSearch, seedToDate } from '../seed.ts'

// Local noon, so no timezone can push this across a day boundary in either
// direction — which is the whole point of reading calendar components.
const DATE = new Date(2026, 7, 9, 12, 0, 0)

describe('dailyRoadSeed', () => {
  it('encodes the local calendar date as YYYYMMDD', () => {
    expect(dailyRoadSeed(DATE)).toBe(20_260_809)
  })

  it('changes on the next local calendar day', () => {
    expect(dailyRoadSeed(new Date(2026, 7, 10, 12, 0, 0))).toBe(20_260_810)
  })

  it('does not roll over for a player just before local midnight', () => {
    expect(dailyRoadSeed(new Date(2026, 7, 9, 23, 59, 59))).toBe(20_260_809)
    expect(dailyRoadSeed(new Date(2026, 7, 10, 0, 0, 1))).toBe(20_260_810)
  })
})

describe('roadSeedFromSearch', () => {
  it('uses the daily route when no override is present', () => {
    expect(roadSeedFromSearch('', DATE)).toBe(20_260_809)
    expect(roadSeedFromSearch('?lang=sk', DATE)).toBe(20_260_809)
  })

  it('accepts a decimal override', () => {
    expect(roadSeedFromSearch('?seed=1443866', DATE)).toBe(1_443_866)
  })

  it('accepts zero and the full unsigned 32-bit range', () => {
    expect(roadSeedFromSearch('?seed=0', DATE)).toBe(0)
    expect(roadSeedFromSearch('?seed=4294967295', DATE)).toBe(0xffff_ffff)
  })

  it('survives extra query parameters in any order', () => {
    expect(roadSeedFromSearch('?debug=1&seed=42&x=y', DATE)).toBe(42)
  })

  it.each(['', ' ', '-1', '1.5', '1e3', '0x10', 'ice', '4294967296'])(
    'falls back to the daily route for invalid seed %j',
    (seed) => {
      expect(roadSeedFromSearch(`?seed=${seed}`, DATE)).toBe(20_260_809)
    },
  )
})

// ── seedToDate / formatSeedRoute ─────────────────────────────────────────────

describe('seedToDate', () => {
  it('decodes a daily seed back into the date it was built from', () => {
    expect(seedToDate(dailyRoadSeed(DATE))).toEqual({ year: 2026, month: 8, day: 9 })
  })

  it('round-trips every day of a leap year', () => {
    for (let month = 1; month <= 12; month++) {
      const daysInMonth = new Date(2024, month, 0).getDate()
      for (let day = 1; day <= daysInMonth; day++) {
        const seed = dailyRoadSeed(new Date(2024, month - 1, day, 12))
        expect(seedToDate(seed)).toEqual({ year: 2024, month, day })
      }
    }
  })

  it('rejects a date that does not exist rather than rolling it forward', () => {
    // Constructing 31 February gives 3 March, so the components stop matching.
    expect(seedToDate(20_260_231)).toBeNull()
    expect(seedToDate(20_250_229)).toBeNull() // 2025 is not a leap year
    expect(seedToDate(20_260_431)).toBeNull()
  })

  it('accepts 29 February in a leap year', () => {
    expect(seedToDate(20_240_229)).toEqual({ year: 2024, month: 2, day: 29 })
  })

  it('rejects impossible month and day fields', () => {
    expect(seedToDate(20_261_301)).toBeNull() // month 13
    expect(seedToDate(20_260_800)).toBeNull() // day 0
    expect(seedToDate(20_260_000)).toBeNull() // month 0
  })

  it('rejects seeds that are not a date at all', () => {
    expect(seedToDate(1_443_866)).toBeNull() // the ice playtest seed
    expect(seedToDate(0)).toBeNull()
    expect(seedToDate(-20_260_825)).toBeNull()
    expect(seedToDate(20_260_825.5)).toBeNull()
    expect(seedToDate(Number.NaN)).toBeNull()
  })
})

describe('formatSeedRoute', () => {
  it('names a daily route by its date, in ROM-font ASCII', () => {
    expect(formatSeedRoute(20_260_825)).toBe('25 AUG 2026')
    expect(formatSeedRoute(20_260_101)).toBe('1 JAN 2026')
    expect(formatSeedRoute(20_261_231)).toBe('31 DEC 2026')
  })

  it('calls anything else CUSTOM, so the screen keeps a fixed layout', () => {
    expect(formatSeedRoute(1_443_866)).toBe('CUSTOM')
    expect(formatSeedRoute(0)).toBe('CUSTOM')
  })

  it('never emits a character the ROM font cannot draw', () => {
    for (const seed of [20_260_825, 20_260_101, 1_443_866]) {
      for (const ch of formatSeedRoute(seed)) {
        expect(ch.charCodeAt(0)).toBeGreaterThanOrEqual(32)
        expect(ch.charCodeAt(0)).toBeLessThanOrEqual(127)
      }
    }
  })

  it('fits the 32-column screen once the label is added', () => {
    // The screen draws `ROUTE: <name>`, so the longest name still has to fit.
    expect(`ROUTE: ${formatSeedRoute(20_261_231)}`.length).toBeLessThanOrEqual(32)
  })
})
