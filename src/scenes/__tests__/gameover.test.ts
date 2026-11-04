import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bestLine, createGameOverScene } from '../gameover.ts'
import type { RunSummary } from '../../game/runStats.ts'

/** Stands in for zx-kit's any-key flag, the only input this screen reads. */
const input = vi.hoisted(() => ({ anyKey: false }))

vi.mock('zx-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('zx-kit')>()
  return {
    ...actual,
    consumeAnyKey: () => {
      const k = input.anyKey
      input.anyKey = false
      return k
    },
    resetInput: vi.fn(),
  }
})

beforeEach(() => {
  input.anyKey = false
})

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

describe('game over — leaving the screen', () => {
  const STATS: RunSummary = {
    distance: 5200, elapsedMs: 480_000, canisters: 3, score: 1500, reason: 'fuel', seed: 42,
  }
  const OUTCOME = { newBest: true, rank: 1, best: BEST }

  it('ignores keys during the guard, so the last steering input cannot skip the results', () => {
    const onContinue = vi.fn()
    const scene = createGameOverScene(STATS, OUTCOME, onContinue)

    input.anyKey = true
    scene.update(1000)
    expect(onContinue).not.toHaveBeenCalled()
  })

  it('continues on the first key after the guard, and only once', () => {
    const onContinue = vi.fn()
    const scene = createGameOverScene(STATS, OUTCOME, onContinue)

    scene.update(1600)
    input.anyKey = true
    scene.update(16)
    input.anyKey = true
    scene.update(16)
    expect(onContinue).toHaveBeenCalledOnce()
  })
})
