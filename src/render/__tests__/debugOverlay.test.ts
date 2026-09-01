/**
 * What the `O` overlay promises, stated as properties rather than as pixels.
 *
 * jsdom has no 2D context, and a screenshot of a debug readout would be worth
 * nothing anyway — the judgement that it is *legible* is made by looking at the
 * game. What is checked here is everything a wrong answer would ruin silently:
 * that the cycle returns to where it started, that a URL cannot open a mode
 * that does not exist, that boxes pushed outside collision mode are dropped
 * rather than accumulated, and that switched off the overlay really does draw
 * nothing at all.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { C } from 'zx-kit'
import type { SpectrumColor } from 'zx-kit'
import {
  DEBUG_MODE_CYCLE, cycleDebugMode, debugBoxes, debugMode, debugModeFromSearch,
  debugWantsCollision, nextDebugMode, pushDebugBox, renderDebugOverlay, setDebugFacts,
  setDebugMode, type DebugMode,
} from '../debug/overlay.ts'

/** Counts calls without pretending to be a canvas — see `vehicleGlow.test.ts`. */
function stubCtx(): { ctx: CanvasRenderingContext2D; calls: { rects: number } } {
  const calls = { rects: 0 }
  const ctx = {
    fillStyle: '',
    fillRect: () => { calls.rects++ },
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    drawImage: () => {},
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

const box = (color: SpectrumColor = C.B_CYAN) => ({ x: 10, y: 20, w: 8, h: 6, color })

beforeEach(() => { setDebugMode('off') })

describe('the O cycle', () => {
  it('is off, stats, collision, and returns to off', () => {
    expect(DEBUG_MODE_CYCLE).toEqual(['off', 'stats', 'collision'])
    let mode: DebugMode = 'off'
    const seen: DebugMode[] = []
    for (let i = 0; i < DEBUG_MODE_CYCLE.length; i++) {
      mode = nextDebugMode(mode)
      seen.push(mode)
    }
    expect(seen).toEqual(['stats', 'collision', 'off'])
  })

  it('drives the module state the same way the key does', () => {
    expect(debugMode()).toBe('off')
    expect(cycleDebugMode()).toBe('stats')
    expect(cycleDebugMode()).toBe('collision')
    expect(cycleDebugMode()).toBe('off')
  })

  it('reports collision only in collision mode', () => {
    setDebugMode('stats')
    expect(debugWantsCollision()).toBe(false)
    setDebugMode('collision')
    expect(debugWantsCollision()).toBe(true)
  })
})

describe('?debug= opens a mode without a keypress', () => {
  it.each([
    ['', 'off'],
    ['?debug=1', 'stats'],
    ['?debug=stats', 'stats'],
    ['?debug=2', 'collision'],
    ['?debug=collision', 'collision'],
    // An unknown value must not open an overlay the caller did not ask for.
    ['?debug=yes', 'off'],
    ['?debug=', 'off'],
    ['?seed=42', 'off'],
  ] as const)('%s reads as %s', (search, expected) => {
    expect(debugModeFromSearch(search)).toBe(expected)
  })
})

describe('boxes belong to collision mode only', () => {
  it('drops what is pushed while off or on stats', () => {
    pushDebugBox(box())
    expect(debugBoxes()).toHaveLength(0)
    setDebugMode('stats')
    pushDebugBox(box())
    expect(debugBoxes()).toHaveLength(0)
  })

  it('keeps them in collision mode', () => {
    setDebugMode('collision')
    pushDebugBox(box())
    pushDebugBox(box(C.B_RED))
    expect(debugBoxes()).toHaveLength(2)
  })

  it('clears them when the mode leaves collision, so none survive into the next frame', () => {
    setDebugMode('collision')
    pushDebugBox(box())
    expect(debugBoxes()).toHaveLength(1)
    setDebugMode('stats')
    expect(debugBoxes()).toHaveLength(0)
  })
})

describe('switched off, nothing is drawn', () => {
  it('emits no canvas calls at all', () => {
    const spy = stubCtx()
    setDebugFacts({ seed: 42 })
    setDebugMode('collision')
    pushDebugBox(box())
    setDebugMode('off')
    renderDebugOverlay(spy.ctx)
    expect(spy.calls.rects).toBe(0)
  })

  it('draws once the mode is on, so the zero above means off and not broken', () => {
    const spy = stubCtx()
    setDebugMode('stats')
    setDebugFacts({ seed: 42 })
    renderDebugOverlay(spy.ctx)
    expect(spy.calls.rects).toBeGreaterThan(0)
  })
})
