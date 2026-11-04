import { describe, expect, it } from 'vitest'
import { bestLine } from '../gameover.ts'

const BEST = { name: 'DRIVER', score: 1500, seed: 20_261_104 }

describe('game over — the best-run line', () => {
  it('announces a new best', () => {
    expect(bestLine({ newBest: true, rank: 1, best: BEST })).toBe('NEW BEST SCORE!')
  })

  it('shows the best this run did not beat, with its seed', () => {
    expect(bestLine({ newBest: false, rank: 2, best: BEST })).toBe('BEST: 1500  SEED 20261104')
  })

  it('says nothing before anything has been stored', () => {
    expect(bestLine({ newBest: false, rank: null, best: null })).toBeNull()
  })

  it('fits the 32-column screen even for the largest seed', () => {
    const line = bestLine({ newBest: false, rank: null, best: { ...BEST, score: 999_999, seed: 0xffff_ffff } })!
    expect(line.length).toBeLessThanOrEqual(32)
  })
})
