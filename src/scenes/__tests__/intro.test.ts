import { describe, expect, it, vi } from 'vitest'
import { createIntroScene, INTRO_PROMPT } from '../intro.ts'

function loadedImage(): HTMLImageElement {
  return { complete: true, naturalWidth: 256 } as HTMLImageElement
}

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

describe('intro scene', () => {
  it('waits for Enter and starts only once', () => {
    let enter = false
    const onStart = vi.fn()
    const scene = createIntroScene(onStart, loadedImage(), () => enter)

    scene.update(16)
    expect(onStart).not.toHaveBeenCalled()

    enter = true
    scene.update(16)
    scene.update(16)
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('does not leave before the loading image is ready', () => {
    const image = { complete: false, naturalWidth: 0 } as HTMLImageElement
    const onStart = vi.fn()
    const scene = createIntroScene(onStart, image, () => true)

    scene.update(16)
    expect(onStart).not.toHaveBeenCalled()

    Object.assign(image, { complete: true, naturalWidth: 256 })
    scene.update(16)
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('queues a short Enter keydown even when it is released between frames', () => {
    const onStart = vi.fn()
    const scene = createIntroScene(onStart, loadedImage(), () => false)
    scene.onEnter?.(null)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }))
    scene.update(16)
    expect(onStart).not.toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    scene.update(16)
    expect(onStart).toHaveBeenCalledOnce()

    scene.onExit?.(null)
  })

  it('draws the native image without smoothing and overlays the ROM prompt', () => {
    const image = loadedImage()
    const ctx = mockContext()
    const scene = createIntroScene(() => undefined, image, () => false)

    scene.render(ctx)

    expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0, 256, 192)
    expect(INTRO_PROMPT).toBe('Press Enter to start')
    expect(ctx.imageSmoothingEnabled).toBe(false)
    expect(ctx.fillRect).toHaveBeenCalled()
  })
})
