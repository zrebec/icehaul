import { describe, expect, it } from 'vitest'
import { dailyRoadSeed, roadSeedFromSearch } from '../seed.ts'

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
