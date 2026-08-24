import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createIntroScene, INTRO_HINT } from '../intro.ts'
import { DEFAULT_PREFS, getPrefs, loadPrefs } from '../../game/prefs.ts'

/**
 * The menu reads input only through zx-kit, so the tests drive zx-kit rather than
 * dispatching DOM events. That is the point of the rewrite: there is one input
 * path now, and a test that fakes it proves the scene has no second one.
 */
const input = vi.hoisted(() => ({
  direction: null as 'up' | 'down' | 'left' | 'right' | null,
  flag: false,
  enter: false,
}))

vi.mock('zx-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('zx-kit')>()
  return {
    ...actual,
    tickMovement: () => {
      const d = input.direction
      input.direction = null
      return d
    },
    consumeFlag: () => {
      const f = input.flag
      input.flag = false
      return f
    },
    isHeld: (key: string) => key === 'Enter' && input.enter,
    resetInput: vi.fn(),
  }
})

function mockContext() {
  return {
    fillStyle: '',
    imageSmoothingEnabled: true,
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

beforeEach(() => {
  localStorage.clear()
  input.direction = null
  input.flag = false
  input.enter = false
  loadPrefs('')
})

describe('intro scene — starting', () => {
  it('starts on the first confirm and never twice', () => {
    const onStart = vi.fn()
    const scene = createIntroScene(onStart)

    scene.update(16)
    expect(onStart).not.toHaveBeenCalled()

    input.flag = true
    scene.update(16)
    input.flag = true
    scene.update(16)
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('accepts Enter as well, and only on the press rather than every frame', () => {
    const onStart = vi.fn()
    const scene = createIntroScene(onStart)

    input.enter = true
    scene.update(16)
    scene.update(16) // still held
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('needs no image to be ready — a missing asset cannot strand the player', () => {
    // The old scene gated on image.complete; there is nothing left to wait for.
    const onStart = vi.fn()
    const scene = createIntroScene(onStart)
    input.flag = true
    scene.update(16)
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('clears input on the way out so the held Enter does not crank the engine', async () => {
    const { resetInput } = await import('zx-kit')
    const scene = createIntroScene(() => undefined)
    scene.onExit?.(null)
    expect(resetInput).toHaveBeenCalled()
  })
})

describe('intro scene — navigation', () => {
  /** Confirming is the only way to observe which item the cursor is on. */
  function confirmStarts(steps: readonly ('up' | 'down')[]): boolean {
    const onStart = vi.fn()
    const scene = createIntroScene(onStart)
    for (const step of steps) {
      input.direction = step
      scene.update(16)
    }
    input.flag = true
    scene.update(16)
    return onStart.mock.calls.length > 0
  }

  it('wraps in both directions across the four items', () => {
    expect(confirmStarts([])).toBe(true)                    // START is first
    expect(confirmStarts(['up'])).toBe(false)               // wraps to VOLUME
    expect(confirmStarts(['down', 'down', 'down', 'down'])).toBe(true) // full circle
    expect(confirmStarts(['up', 'down'])).toBe(true)        // and back again
  })

  it('ignores input once the game has started', () => {
    const onStart = vi.fn()
    const scene = createIntroScene(onStart)
    input.flag = true
    scene.update(16)

    input.direction = 'down'
    input.flag = true
    scene.update(16)
    expect(onStart).toHaveBeenCalledOnce()
  })
})

describe('intro scene — settings', () => {
  /** Moves the cursor down `n` times. Item order is START, GLOW, CONTOUR, VOLUME. */
  function selectItem(scene: ReturnType<typeof createIntroScene>, n: number) {
    for (let i = 0; i < n; i++) {
      input.direction = 'down'
      scene.update(16)
    }
  }

  it('left and right set GLOW off and on', () => {
    const scene = createIntroScene(() => undefined)
    selectItem(scene, 1)

    input.direction = 'left'
    scene.update(16)
    expect(getPrefs().glow).toBe(false)

    input.direction = 'right'
    scene.update(16)
    expect(getPrefs().glow).toBe(true)
  })

  it('confirm toggles CONTOUR instead of starting the game', () => {
    const onStart = vi.fn()
    const scene = createIntroScene(onStart)
    selectItem(scene, 2)

    input.flag = true
    scene.update(16)
    expect(getPrefs().contour).toBe(false)
    expect(onStart).not.toHaveBeenCalled()
  })

  it('steps VOLUME in tenths and clamps at the ends', () => {
    const scene = createIntroScene(() => undefined)
    selectItem(scene, 3)

    input.direction = 'right'
    scene.update(16)
    expect(getPrefs().volume).toBeCloseTo(DEFAULT_PREFS.volume + 0.1, 5)

    for (let i = 0; i < 20; i++) {
      input.direction = 'left'
      scene.update(16)
    }
    expect(getPrefs().volume).toBe(0)
  })

  it('persists a change across a reload', () => {
    const scene = createIntroScene(() => undefined)
    selectItem(scene, 1)
    input.direction = 'left'
    scene.update(16)
    expect(getPrefs().glow).toBe(false)

    loadPrefs('')
    expect(getPrefs().glow).toBe(false)
  })
})

describe('intro scene — rendering', () => {
  it('paints the decoded screen and a solid panel over the sky', () => {
    const ctx = mockContext()
    const scene = createIntroScene(() => undefined)

    scene.render(ctx)

    const fills = (ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls
    // The picture itself is drawn cell by cell, so the panel is one wide fill
    // across the full 256px width and exactly six cell rows tall.
    expect(fills.some(([x, y, w, h]) => x === 0 && y === 0 && w === 256 && h === 48)).toBe(true)
    // Every menu cell is a filled 8x8 paper block, so the panel is far from the
    // only fill: the picture and the four labels are all in there too.
    expect(fills.length).toBeGreaterThan(100)
  })

  it('keeps the hint inside the 32-column screen', () => {
    expect(INTRO_HINT.length).toBeLessThanOrEqual(31)
    // ASCII only: the ROM font has no glyph above code 127.
    expect([...INTRO_HINT].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 127)).toBe(true)
  })

  it('renders without touching an image element at all', () => {
    const ctx = mockContext()
    createIntroScene(() => undefined).render(ctx)
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })
})
