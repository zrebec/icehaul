import { describe, it, expect, beforeEach } from 'vitest'
import { resetTraffic, tickTraffic, getVisibleTraffic } from '../traffic.ts'

const SEED = 123

beforeEach(() => {
  resetTraffic(SEED)
})

describe('resetTraffic', () => {
  it('starts with no visible vehicles', () => {
    const visible = getVisibleTraffic(0, 100)
    expect(visible.length).toBe(0)
  })
})

describe('tickTraffic', () => {
  it('returns null when no collision', () => {
    const result = tickTraffic(0, 0, 60, 16)
    expect(result).toBeNull()
  })

  it('spawns vehicles ahead of the player', () => {
    tickTraffic(900, 0, 60, 16)
    const visible = getVisibleTraffic(900, 200)
    expect(visible.length).toBeGreaterThan(0)
  })

  it('vehicles have valid properties', () => {
    tickTraffic(900, 0, 60, 16)
    const visible = getVisibleTraffic(900, 500)
    for (const v of visible) {
      expect(v.speed).toBeGreaterThan(0)
      expect(['same', 'oncoming']).toContain(v.dir)
      expect(['car', 'truck']).toContain(v.type)
    }
  })

  it('deterministic with same seed', () => {
    tickTraffic(900, 0, 60, 16)
    const v1 = getVisibleTraffic(900, 500).map(v => v.distM)

    resetTraffic(SEED)
    tickTraffic(900, 0, 60, 16)
    const v2 = getVisibleTraffic(900, 500).map(v => v.distM)

    expect(v1).toEqual(v2)
  })

  it('oncoming vehicles move toward player', () => {
    tickTraffic(900, 0, 60, 16)
    const before = getVisibleTraffic(900, 500)
    const oncoming = before.find(v => v.dir === 'oncoming')
    if (oncoming) {
      const distBefore = oncoming.distM
      tickTraffic(900, 0, 60, 500)
      expect(oncoming.distM).toBeLessThan(distBefore)
    }
  })

  it('vehicles behind player are cleaned up', () => {
    for (let i = 0; i < 20; i++) tickTraffic(900 + i * 100, 0, 60, 500)
    const visible = getVisibleTraffic(2800, 300)
    for (const v of visible) {
      expect(v.distM).toBeGreaterThan(2600)
    }
  })
})
