/**
 * The `O` debug overlay — frame pacing, route identity, and what the collision
 * checks are actually looking at.
 *
 * ── Why it composites last, like the glow ───────────────────────────────────
 * `main.ts` lays a 70 %-black scanline over every odd device row, which takes
 * the whole picture to 0.65. A debug readout dimmed by a third is a debug
 * readout you squint at, so this draws *after* the scanlines for the same
 * reason `renderPendingLampGlow` does — and, like the glow, it is a decoration
 * on the glass rather than something the game draws. `?debug=` off leaves a
 * byte-identical frame.
 *
 * ── Why the scene pushes rather than the overlay pulling ────────────────────
 * The frame monitor has to bracket the whole `requestAnimationFrame` callback,
 * so it lives in `main.ts`. The interesting numbers — which surface, which LOD
 * tier, where the collision boxes ended up — only exist inside the drive
 * scene's render, and several of them are intermediate values that no scene API
 * exposes. Rather than widen the `Scene` interface for a debug feature, the
 * scene publishes into this module and `main.ts` renders whatever arrived. It
 * is the pattern `vehicleGlow.ts` already uses for lamp spots.
 *
 * ── Three modes, not a toggle ───────────────────────────────────────────────
 * Minefield's `O` is a toggle because it has one page worth of numbers. This
 * game has two genuinely different questions — *is the frame healthy* and
 * *what does the collision think it is touching* — and the second one draws
 * over the road, so it cannot be always-on while the first one is useful. `O`
 * cycles `off → stats → collision → off`; collision keeps the stats page
 * because you almost always want the frame time next to the boxes.
 */
import {
  C, CELL, beginFrame, createDebugMonitor, drawDebugOverlay, drawFrame,
  drawText, endFrame, sampleDebug,
  type SpectrumColor,
} from 'zx-kit'

export type DebugMode = 'off' | 'stats' | 'collision'

/** The cycle `O` walks. Exported so the test states the order, not the code. */
export const DEBUG_MODE_CYCLE: readonly DebugMode[] = ['off', 'stats', 'collision']

export function nextDebugMode(mode: DebugMode): DebugMode {
  const index = DEBUG_MODE_CYCLE.indexOf(mode)
  return DEBUG_MODE_CYCLE[(index + 1) % DEBUG_MODE_CYCLE.length]!
}

/** One rectangle a collision check considered, in game pixels. */
export interface DebugBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly color: SpectrumColor
  /** Two or three characters drawn above the box, or nothing. */
  readonly label?: string
}

const monitor = createDebugMonitor({ targetFps: 60 })

let mode: DebugMode = 'off'
let facts: Record<string, string | number> = {}
let boxes: DebugBox[] = []

export function debugMode(): DebugMode {
  return mode
}

/** True while the scene should bother computing debug-only geometry. */
export function debugWantsCollision(): boolean {
  return mode === 'collision'
}

export function setDebugMode(next: DebugMode): void {
  mode = next
  if (mode !== 'collision') boxes = []
}

export function cycleDebugMode(): DebugMode {
  setDebugMode(nextDebugMode(mode))
  return mode
}

/**
 * `O` cycles the overlay. Modifier chords are left alone so browser and OS
 * shortcuts keep working, and `repeat` is ignored so holding the key does not
 * spin through the cycle.
 */
export function initDebugOverlay(startMode: DebugMode = 'off'): void {
  mode = startMode
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.repeat) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key !== 'o' && event.key !== 'O') return
    cycleDebugMode()
    event.preventDefault()
  })
}

/** `?debug=stats` or `?debug=collision` opens the overlay without a keypress. */
export function debugModeFromSearch(search: string): DebugMode {
  const raw = new URLSearchParams(search).get('debug')
  if (raw === null) return 'off'
  if (raw === '1' || raw === 'stats') return 'stats'
  if (raw === '2' || raw === 'collision') return 'collision'
  return 'off'
}

export function beginDebugFrame(now: number): void {
  beginFrame(monitor, now)
  boxes = []
}

export function endDebugFrame(): void {
  endFrame(monitor)
}

/** Called by the scene each frame with whatever it wants on the stats page. */
export function setDebugFacts(next: Record<string, string | number>): void {
  facts = next
}

/** Called by the scene during render, once per rectangle a check looked at. */
export function pushDebugBox(box: DebugBox): void {
  if (mode === 'collision') boxes.push(box)
}

export function debugBoxes(): readonly DebugBox[] {
  return boxes
}

export function renderDebugOverlay(ctx: CanvasRenderingContext2D): void {
  if (mode === 'off') return

  if (mode === 'collision') {
    for (const box of boxes) {
      if (box.w <= 0 || box.h <= 0) continue
      drawFrame(ctx, { x: box.x, y: box.y, width: box.w, height: box.h, color: box.color })
      // Labels go above the box so they never sit on the thing being inspected.
      // Below the top of the screen there is no room, so those are dropped
      // rather than clamped — a label in the wrong place is worse than none.
      if (box.label !== undefined && box.y >= CELL) {
        drawText(ctx, box.label, box.x, box.y - CELL, box.color, C.BLACK)
      }
    }
  }

  drawDebugOverlay(ctx, sampleDebug(monitor, facts))
}
