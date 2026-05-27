import { describe, it, expect, beforeEach } from 'vitest'
import { resetCanisters, getVisibleCanisters, checkCanisterPickup } from '../canisters.ts'

const SEED = 77

beforeEach(() => {
  resetCanisters(SEED)
})

describe('resetCanisters', () => {
  it('initially no canisters near start', () => {
    const visible = getVisibleCanisters(0, 100)
    expect(visible.length).toBe(0)
  })
})

describe('getVisibleCanisters', () => {
  it('returns canisters within range', () => {
    const visible = getVisibleCanisters(800, 300)
    if (visible.length > 0) {
      for (const c of visible) {
        expect(c.distM).toBeGreaterThanOrEqual(788)
        expect(c.distM).toBeLessThanOrEqual(1100)
      }
    }
  })

  it('deterministic with same seed', () => {
    const v1 = getVisibleCanisters(1000, 500).map(c => c.distM)
    resetCanisters(SEED)
    const v2 = getVisibleCanisters(1000, 500).map(c => c.distM)
    expect(v1).toEqual(v2)
  })
})

describe('checkCanisterPickup', () => {
  it('returns 0 when no canister nearby', () => {
    expect(checkCanisterPickup(0, 0)).toBe(0)
  })

  it('picking up a canister returns fuel amount', () => {
    const visible = getVisibleCanisters(500, 1000)
    if (visible.length > 0) {
      const can = visible[0]!
      const fuel = checkCanisterPickup(can.distM, can.x)
      expect(fuel).toBeGreaterThanOrEqual(0)
    }
  })
})
