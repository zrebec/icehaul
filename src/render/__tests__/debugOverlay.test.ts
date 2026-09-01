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
  debugWantsCollision, loadStatsFrom, nextDebugMode, pushDebugBox, renderDebugOverlay,
  setDebugFacts, setDebugMode, type DebugMode,
} from '../debug/overlay.ts'
import { aabbOverlap, pixelMaskBounds, rasterBounds } from '../../game/offroad.ts'
import type { PixelMask } from 'zx-kit'

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


describe('rolling load statistics', () => {
  /**
   * A single instantaneous CPU figure is the frame you happened to sample. The
   * four numbers next to it are there so a stutter that has already happened is
   * still visible, which is why the window is filled every frame rather than
   * only while the overlay is open.
   */
  it('is all zeroes before any frame has run', () => {
    expect(loadStatsFrom([])).toEqual({ samples: 0, min: 0, max: 0, avg: 0, worstOnePercent: 0 })
  })

  it('reports the range and the mean of what it was given', () => {
    const stats = loadStatsFrom([0.1, 0.2, 0.3, 0.4])
    expect(stats.samples).toBe(4)
    expect(stats.min).toBeCloseTo(0.1)
    expect(stats.max).toBeCloseTo(0.4)
    expect(stats.avg).toBeCloseTo(0.25)
  })

  it('reports the WORST one percent, which is the frame you actually feel', () => {
    // Ninety-nine comfortable frames and one that overran. The mean hides it;
    // the 1% is the whole reason this row exists.
    const window = [...Array<number>(99).fill(0.06), 0.9]
    const stats = loadStatsFrom(window)
    expect(stats.avg).toBeLessThan(0.1)
    expect(stats.worstOnePercent).toBeCloseTo(0.9)
  })

  it('falls back to the single worst sample below a hundred frames', () => {
    // Not an interpolated fiction: with five samples the worst 1% is the worst.
    expect(loadStatsFrom([0.1, 0.2, 0.9, 0.3, 0.4]).worstOnePercent).toBeCloseTo(0.9)
  })
})

describe('AABB against pixel-perfect', () => {
  /**
   * The overlay's whole claim is that the game collides on the shape and not on
   * the box around it. These hold the two primitives it draws that claim with.
   */
  const mask = (rows: readonly (readonly number[])[]): PixelMask => ({
    width: 10, height: rows.length, rows,
    totalPixels: rows.reduce((sum, row) => sum + row.length, 0),
  })

  it('takes a mask bound from what it occupies, not from what it declares', () => {
    // A 10-wide mask whose widest row is three cells. Using the declared width
    // would flatter the cheap test it is drawn next to.
    expect(pixelMaskBounds(mask([[], [4, 5, 6], [5]]))).toEqual({ left: 4, top: 1, w: 3, h: 2 })
  })

  it('returns nothing for a mask that occupies nothing', () => {
    expect(pixelMaskBounds(mask([[], []]))).toBeNull()
  })

  it('reads a raster the same way, treating a dot as empty', () => {
    expect(rasterBounds(['....', '.XX.', '..X.'])).toEqual({ left: 1, top: 1, w: 2, h: 2 })
    expect(rasterBounds(['....', '....'])).toBeNull()
  })

  it('overlaps boxes that touch and not boxes that only abut', () => {
    const a = { left: 0, top: 0, w: 4, h: 4 }
    expect(aabbOverlap(a, { left: 3, top: 3, w: 4, h: 4 })).toBe(true)
    // Sharing an edge is not overlapping: at 4 the first box's last cell is 3.
    expect(aabbOverlap(a, { left: 4, top: 0, w: 4, h: 4 })).toBe(false)
    expect(aabbOverlap(a, { left: 0, top: 4, w: 4, h: 4 })).toBe(false)
  })

  it('is the pair the overlay draws: a box can touch where the pixels do not', () => {
    // Two L-shapes whose bounding boxes overlap while no occupied cell does.
    // This is the case the pixel test exists for, and the case the overlay's
    // AABB/PIX counters are there to make visible while driving.
    const truck = { left: 0, top: 0, w: 3, h: 3 }
    const other = { left: 2, top: 2, w: 3, h: 3 }
    expect(aabbOverlap(truck, other)).toBe(true)
    expect(rasterBounds(['XX.', 'XX.', '...'])).toEqual({ left: 0, top: 0, w: 2, h: 2 })
    expect(aabbOverlap({ left: 0, top: 0, w: 2, h: 2 }, other)).toBe(false)
  })
})
