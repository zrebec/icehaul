/**
 * The `O` debug overlay — frame pacing, route identity, and proof that the
 * collision is the shape and not the box around it.
 *
 * ── Why it composites last, like the glow ───────────────────────────────────
 * `main.ts` lays a 70 %-black scanline over every odd device row, which takes
 * the whole picture to 0.65. A debug readout dimmed by a third is a debug
 * readout you squint at, so this draws *after* the scanlines for the same
 * reason `renderPendingLampGlow` does — and, like the glow, it is a decoration
 * on the glass rather than something the game draws. Off, it leaves a
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
 * ── Four corners, not one column ────────────────────────────────────────────
 * The first version stacked everything at the top left, where the frame time
 * and the load ran into one another and the whole block sat over the road it
 * was describing. The four groups are four different questions and they now
 * live in four different places: **frame** top left, **load** top right,
 * **route** bottom left, **scene and collision** bottom right. Nothing is over
 * the drive viewport's centre, which is the part being looked at.
 *
 * ── Three modes, not a toggle ───────────────────────────────────────────────
 * Minefield's `O` is a toggle because it has one page worth of numbers. This
 * game has two genuinely different questions — *is the frame healthy* and
 * *what does the collision think it is touching* — and the second one draws
 * over the road, so it cannot be always-on while the first one is useful. `O`
 * cycles `off → stats → collision → off`; collision keeps the stats corners
 * because you almost always want the frame time next to the boxes.
 */
import {
  C, CELL, beginFrame, createDebugMonitor, drawFrame, drawText,
  endFrame, sampleDebug,
  type SpectrumColor,
} from 'zx-kit'
import { GAME_HEIGHT, GAME_WIDTH } from '../../config.ts'

export type DebugMode = 'off' | 'stats' | 'collision'

/** The cycle `O` walks. Exported so the test states the order, not the code. */
export const DEBUG_MODE_CYCLE: readonly DebugMode[] = ['off', 'stats', 'collision']

export function nextDebugMode(mode: DebugMode): DebugMode {
  const index = DEBUG_MODE_CYCLE.indexOf(mode)
  return DEBUG_MODE_CYCLE[(index + 1) % DEBUG_MODE_CYCLE.length]!
}

/**
 * What a box is claiming.
 *
 * `aabb` is the cheap rectangle a boxed collision would use; `pixel` is the
 * silhouette the real one walks. Drawn together and in different colours they
 * are the whole argument: where the two disagree is exactly the crash the
 * player would have suffered for nothing.
 */
export type DebugBoxKind = 'aabb' | 'pixel' | 'plain'

export interface DebugBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly color: SpectrumColor
  readonly kind?: DebugBoxKind
  /** Drawn above the box. Say what the thing *is* — `TRUCK`, `CAR`, not `ROAD`. */
  readonly label?: string
  /**
   * For `pixel` boxes: the occupied cells, one string per row, `.` transparent.
   * The overlay traces each row's outermost solid cell, which is the silhouette
   * edge — the thing the AABB rectangle is not.
   */
  readonly raster?: readonly string[]
  /** For `pixel` boxes built from a `PixelMask`: occupied columns per row. */
  readonly columns?: readonly (readonly number[])[]
}

/**
 * Rolling load statistics.
 *
 * A single instantaneous CPU figure says nothing — it is the frame you happened
 * to sample. Min, max, mean and the worst 1 % over a window say whether the
 * budget is comfortable, occasionally tight, or being missed. The 1 % is the
 * *worst* one per cent, which is what a stutter actually is: the mean can sit
 * at 6 % while one frame in a hundred lands at 90 and that is the one you feel.
 */
export const LOAD_WINDOW = 600 // ten seconds at 60 fps

export interface LoadStats {
  readonly samples: number
  readonly min: number
  readonly max: number
  readonly avg: number
  /** Load exceeded by only 1 % of frames in the window — the "1 % low". */
  readonly worstOnePercent: number
}

export function loadStatsFrom(window: readonly number[]): LoadStats {
  if (window.length === 0) return { samples: 0, min: 0, max: 0, avg: 0, worstOnePercent: 0 }
  let min = Infinity, max = -Infinity, sum = 0
  for (const value of window) {
    if (value < min) min = value
    if (value > max) max = value
    sum += value
  }
  // The *worst* one per cent, counted from the top — which is what a stutter is.
  // Nearest rank, not an interpolated percentile: with fewer than a hundred
  // samples the worst one per cent is simply the worst sample, and saying so is
  // more honest than inventing a number between two frames that both happened.
  const sorted = [...window].sort((a, b) => a - b)
  const worstCount = Math.max(1, Math.ceil(sorted.length * 0.01))
  const index = Math.max(0, sorted.length - worstCount)
  return {
    samples: window.length,
    min, max,
    avg: sum / window.length,
    worstOnePercent: sorted[index]!,
  }
}

const monitor = createDebugMonitor({ targetFps: 60 })

let mode: DebugMode = 'off'
let facts: Record<string, string | number> = {}
let boxes: DebugBox[] = []
const loadWindow: number[] = []

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
  // Sampled every frame, not only while visible: opening the overlay to look at
  // a stutter that has already happened should show the window it happened in.
  loadWindow.push(sampleDebug(monitor).cpuLoad)
  if (loadWindow.length > LOAD_WINDOW) loadWindow.shift()
}

export function debugLoadStats(): LoadStats {
  return loadStatsFrom(loadWindow)
}

/** Called by the scene each frame with whatever it wants on the readout. */
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

const pct = (value: number) => `${Math.round(value * 100)}%`

/** Right-aligned so a growing number does not walk off the edge of the screen. */
function drawRight(
  ctx: CanvasRenderingContext2D, text: string, y: number, ink: SpectrumColor,
): void {
  drawText(ctx, text, GAME_WIDTH - text.length * CELL, y, ink, C.BLACK)
}

function drawCorner(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
  corner: 'tl' | 'tr' | 'bl' | 'br',
  ink: SpectrumColor,
): void {
  const bottom = corner === 'bl' || corner === 'br'
  const top = bottom ? GAME_HEIGHT - lines.length * CELL : 0
  for (const [index, line] of lines.entries()) {
    const y = top + index * CELL
    if (corner === 'tr' || corner === 'br') drawRight(ctx, line, y, ink)
    else drawText(ctx, line, 0, y, ink, C.BLACK)
  }
}

/**
 * The silhouette edge, one pixel per row per side.
 *
 * Not the whole mask: filling it would bury the vehicle under the thing
 * describing it. The outermost solid cell of each row is the boundary the
 * pixel test actually uses, and seeing it curve inside a straight AABB is the
 * entire point of drawing both.
 */
function traceSilhouette(ctx: CanvasRenderingContext2D, box: DebugBox): void {
  const paint = (x: number, y: number) => {
    ctx.fillStyle = box.color
    ctx.fillRect(x, y, 1, 1)
  }
  if (box.columns) {
    for (const [row, cols] of box.columns.entries()) {
      if (cols.length === 0) continue
      paint(box.x + cols[0]!, box.y + row)
      paint(box.x + cols[cols.length - 1]!, box.y + row)
    }
    return
  }
  if (!box.raster) return
  for (const [row, cells] of box.raster.entries()) {
    const first = cells.search(/[^.]/)
    if (first < 0) continue
    const last = cells.length - 1 - [...cells].reverse().join('').search(/[^.]/)
    paint(box.x + first, box.y + row)
    paint(box.x + last, box.y + row)
  }
}

export function renderDebugOverlay(ctx: CanvasRenderingContext2D): void {
  if (mode === 'off') return

  if (mode === 'collision') {
    for (const box of boxes) {
      if (box.w <= 0 || box.h <= 0) continue
      if (box.kind === 'pixel') traceSilhouette(ctx, box)
      else drawFrame(ctx, { x: box.x, y: box.y, width: box.w, height: box.h, color: box.color })
      // Labels go above the box so they never sit on the thing being inspected.
      // Below the top of the screen there is no room, so those are dropped
      // rather than clamped — a label in the wrong place is worse than none.
      if (box.label !== undefined && box.y >= CELL) {
        drawText(ctx, box.label, box.x, box.y - CELL, box.color, C.BLACK)
      }
    }
  }

  const info = sampleDebug(monitor)
  const load = debugLoadStats()
  const str = (key: string) => String(facts[key] ?? '-')

  drawCorner(ctx, [
    `FPS ${info.fps.toFixed(0)}`,
    `${info.frameMs.toFixed(1)}MS`,
  ], 'tl', C.B_YELLOW)

  drawCorner(ctx, [
    `CPU ${pct(info.cpuLoad)}`,
    `AVG ${pct(load.avg)}`,
    `MIN ${pct(load.min)}`,
    `MAX ${pct(load.max)}`,
    `1%  ${pct(load.worstOnePercent)}`,
  ], 'tr', load.worstOnePercent >= 1 ? C.B_RED : C.B_YELLOW)

  drawCorner(ctx, [
    `SEED ${str('seed')}`,
    `${str('dist')} ${str('surf')}`,
    `GRIP ${str('grip')} OFF ${str('off')}`,
  ], 'bl', C.B_CYAN)

  const collisionLines = mode === 'collision'
    ? [`AABB ${str('aabb')} PIX ${str('pix')}`]
    : []
  drawCorner(ctx, [
    ...collisionLines,
    `TRAF ${str('traf')} SCEN ${str('scen')}`,
    `CAB ${str('cab')}`,
    `TRL ${str('trl')}`,
  ], 'br', C.B_GREEN)
}
