import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDriveScene, QUIT_KEY } from '../drive.ts'
import type { RunSummary } from '../../game/runStats.ts'

/**
 * Ending a run with ESC. The scene reads its own keys from `window`, so these
 * tests dispatch real DOM events for those; the two things it asks zx-kit —
 * whether Enter is held while cranking, and whether P was pressed — come from
 * the fake below.
 */
const input = vi.hoisted(() => ({ held: new Set<string>(), pause: false }))

vi.mock('zx-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('zx-kit')>()
  return {
    ...actual,
    isHeld: (key: string) => input.held.has(key),
    consumePause: () => {
      const p = input.pause
      input.pause = false
      return p
    },
  }
})

const SEED = 20_261_104

function press(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }))
}

/** A scene and everything it reported, ended by `onExit` after each test. */
function drive() {
  const ends: RunSummary[] = []
  const scene = createDriveScene((stats) => ends.push(stats), SEED)
  scenes.push(scene)
  return { scene, ends }
}

/** Holds Enter through the crank, so the scene is in its playing state. */
function startEngine(scene: ReturnType<typeof drive>['scene']): void {
  input.held.add('Enter')
  press('Enter')
  for (let ms = 0; ms < 2000; ms += 50) scene.update(50)
  input.held.delete('Enter')
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
}

const scenes: ReturnType<typeof createDriveScene>[] = []

beforeEach(() => {
  input.held.clear()
  input.pause = false
})

afterEach(() => {
  // Removes each scene's window listeners, so no test hears another's keys.
  for (const scene of scenes.splice(0)) scene.onExit?.(null)
})

describe('drive — ending a run with ESC', () => {
  it('ends at once before the engine is started, with nothing driven', () => {
    const { scene, ends } = drive()

    press(QUIT_KEY)
    scene.update(16)

    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ reason: 'quit', score: 0, distance: 0, seed: SEED })
  })

  it('asks first while driving, and ends on the second ESC', () => {
    const { scene, ends } = drive()
    startEngine(scene)

    press(QUIT_KEY)
    scene.update(16)
    scene.update(500)
    expect(ends).toHaveLength(0)

    press(QUIT_KEY)
    scene.update(16)
    expect(ends).toHaveLength(1)
    expect(ends[0]!.reason).toBe('quit')
  })

  it('keeps driving when the answer is any other key', () => {
    const { scene, ends } = drive()
    startEngine(scene)

    press(QUIT_KEY)
    scene.update(16)
    press('x')
    scene.update(16)

    // Back on the road: the clock runs again, and ESC asks again.
    for (let i = 0; i < 10; i++) scene.update(100)
    press(QUIT_KEY)
    scene.update(16)
    expect(ends).toHaveLength(0)
    press(QUIT_KEY)
    scene.update(16)
    expect(ends[0]!.elapsedMs).toBeGreaterThanOrEqual(1000)
  })

  it('does not let a P that answered no also pause the game', () => {
    const { scene, ends } = drive()
    startEngine(scene)

    press(QUIT_KEY)
    scene.update(16)
    input.pause = true
    press('p')
    scene.update(16)

    // Paused, the clock would stand still.
    for (let i = 0; i < 10; i++) scene.update(100)
    press(QUIT_KEY)
    scene.update(16)
    press(QUIT_KEY)
    scene.update(16)
    expect(ends[0]!.elapsedMs).toBeGreaterThanOrEqual(1000)
  })

  it('can also end a paused run, which asks first too', () => {
    const { scene, ends } = drive()
    startEngine(scene)

    input.pause = true
    scene.update(16)
    press(QUIT_KEY)
    scene.update(16)
    expect(ends).toHaveLength(0)

    press(QUIT_KEY)
    scene.update(16)
    expect(ends).toHaveLength(1)
  })

  it('reports the run once, however often ESC is pressed afterwards', () => {
    const { scene, ends } = drive()

    press(QUIT_KEY)
    scene.update(16)
    press(QUIT_KEY)
    scene.update(16)

    expect(ends).toHaveLength(1)
  })

  it('stops listening once it has been left, so a later run does not hear its keys', () => {
    const { scene, ends } = drive()
    scene.onExit?.(null)

    press(QUIT_KEY)
    scene.update(16)

    expect(ends).toHaveLength(0)
  })
})
