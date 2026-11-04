import { beforeEach, describe, expect, it } from 'vitest'
import { DRIVER_NAME, HISCORE_KEY, bestRun, recordRun, storedRuns } from '../hiscore.ts'

/** zx-kit namespaces the table as `zxkit:<key>:hiscore`. */
const STORAGE_KEY = `zxkit:${HISCORE_KEY}:hiscore`

beforeEach(() => {
  localStorage.clear()
})

describe('hiscore — recording a run', () => {
  it('stores the first scoring run as the best, together with its seed', () => {
    const outcome = recordRun(1234, 20_261_104)

    expect(outcome.newBest).toBe(true)
    expect(outcome.rank).toBe(1)
    expect(outcome.best).toEqual({ name: DRIVER_NAME, score: 1234, seed: 20_261_104 })
    expect(bestRun()).toEqual({ name: DRIVER_NAME, score: 1234, seed: 20_261_104 })
  })

  it('reports a better run as the new best and keeps the older one below it', () => {
    recordRun(800, 42)
    const outcome = recordRun(1500, 1_443_866)

    expect(outcome.newBest).toBe(true)
    expect(outcome.best?.seed).toBe(1_443_866)
    expect(storedRuns().map((r) => r.score)).toEqual([1500, 800])
  })

  it('places a weaker run without calling it a new best', () => {
    recordRun(1500, 42)
    const outcome = recordRun(900, 20_261_104)

    expect(outcome.newBest).toBe(false)
    expect(outcome.rank).toBe(2)
    expect(outcome.best?.score).toBe(1500)
  })

  it('does not call a tie a new best', () => {
    recordRun(1000, 42)
    const outcome = recordRun(1000, 43)

    expect(outcome.newBest).toBe(false)
    expect(outcome.best?.seed).toBe(42)
  })

  it('stores nothing for a run that scored nothing', () => {
    const outcome = recordRun(0, 42)

    expect(outcome).toEqual({ newBest: false, rank: null, best: null })
    expect(storedRuns()).toEqual([])
  })

  it('stores nothing for a seed the road would not accept', () => {
    expect(recordRun(500, -1).rank).toBeNull()
    expect(recordRun(500, 1.5).rank).toBeNull()
    expect(storedRuns()).toEqual([])
  })

  it('keeps the five best runs and drops the rest', () => {
    for (const score of [100, 200, 300, 400, 500, 600]) recordRun(score, 42)

    expect(storedRuns().map((r) => r.score)).toEqual([600, 500, 400, 300, 200])
    expect(recordRun(50, 42).rank).toBeNull()
  })
})

describe('hiscore — storage', () => {
  it('survives a reload: what was written is what is read back', () => {
    recordRun(2222, 20_261_104)
    const raw = localStorage.getItem(STORAGE_KEY)

    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).data).toEqual([{ name: DRIVER_NAME, score: 2222, seed: 20_261_104 }])
  })

  it('treats storage it cannot read as an empty table', () => {
    localStorage.setItem(STORAGE_KEY, '{ not json')

    expect(() => bestRun()).not.toThrow()
    expect(bestRun()).toBeNull()
  })

  it('drops a stored row without a usable seed', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        timestamp: Date.now(),
        data: [
          { name: DRIVER_NAME, score: 9000, seed: 'today' },
          { name: DRIVER_NAME, score: 700, seed: 42 },
        ],
      }),
    )

    expect(storedRuns()).toEqual([{ name: DRIVER_NAME, score: 700, seed: 42 }])
  })
})
