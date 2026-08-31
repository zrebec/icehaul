/** Fraction of a target cell that must be opaque for it to be drawn at all. */
const COVERAGE_THRESHOLD = 0.2

/** Where each target cell reads from, in source coordinates. */
interface SampleGrid {
  readonly w: number
  readonly h: number
  readonly x0: number
  readonly y0: number
  readonly stepX: number
  readonly stepY: number
  /** Semantic marks that must win a colour vote when they cover this cell. */
  readonly priorityChars?: ReadonlySet<string>
}

function resampleRows(rows: readonly string[], grid: SampleGrid): string[] {
  const srcH = rows.length
  const srcW = rows[0]?.length ?? 0
  if (srcW === 0 || srcH === 0 || grid.w <= 0 || grid.h <= 0) return []

  // Count the whole target cell. A cell straddling the sprite edge is mostly
  // transparent; normalising only by the part inside the source would fatten
  // every downscaled silhouette.
  const cellArea = grid.stepX * grid.stepY
  if (cellArea <= 0) return []

  const scaled: string[] = []
  for (let dy = 0; dy < grid.h; dy++) {
    const top = grid.y0 + dy * grid.stepY
    const bottom = top + grid.stepY
    let row = ''

    for (let dx = 0; dx < grid.w; dx++) {
      const left = grid.x0 + dx * grid.stepX
      const right = left + grid.stepX
      const area = new Map<string, number>()
      let opaque = 0

      for (let sy = Math.max(0, Math.floor(top)); sy < Math.min(Math.ceil(bottom), srcH); sy++) {
        const rowOverlap = Math.min(bottom, sy + 1) - Math.max(top, sy)
        if (rowOverlap <= 0) continue
        const sourceRow = rows[sy]!

        for (let sx = Math.max(0, Math.floor(left)); sx < Math.min(Math.ceil(right), srcW); sx++) {
          const colOverlap = Math.min(right, sx + 1) - Math.max(left, sx)
          if (colOverlap <= 0) continue

          const char = sourceRow[sx] ?? '.'
          if (char === '.') continue

          const covered = colOverlap * rowOverlap
          opaque += covered
          area.set(char, (area.get(char) ?? 0) + covered)
        }
      }

      if (opaque / cellArea < COVERAGE_THRESHOLD) {
        row += '.'
        continue
      }

      let winner = ''
      let winnerArea = 0
      let priorityWinner = ''
      let priorityArea = 0
      for (const [char, covered] of area) {
        if (grid.priorityChars?.has(char) && covered > priorityArea) {
          priorityWinner = char
          priorityArea = covered
        }
        if (covered > winnerArea) {
          winner = char
          winnerArea = covered
        }
      }
      row += priorityWinner || winner || '.'
    }
    scaled.push(row)
  }

  return scaled
}

/** Resample a character sprite to exactly `targetW × targetH`. */
export function scaleRoadsideRows(
  rows: readonly string[],
  targetW: number,
  targetH: number,
): string[] {
  const srcH = rows.length
  const srcW = rows[0]?.length ?? 0
  if (srcW === 0 || srcH === 0 || targetW <= 0 || targetH <= 0) return []

  return resampleRows(rows, {
    w: targetW,
    h: targetH,
    x0: 0,
    y0: 0,
    stepX: srcW / targetW,
    stepY: srcH / targetH,
  })
}

export interface SpriteRaster {
  readonly raster: string[]
  readonly left: number
  readonly top: number
  readonly w: number
  readonly h: number
}

/**
 * Resample a sprite into a fractional physical span, anchored bottom-centre.
 *
 * `spanW` and `spanH` are already projected screen-space dimensions. Source
 * resolution is only the sampling grid: a 22×15 and a 44×30 rendering of the
 * same normalized art occupy the same box when given the same span.
 */
export function resampleSpriteAtSpan(
  rows: readonly string[],
  spanW: number,
  spanH: number,
  anchorX: number,
  anchorBottomY: number,
  priorityChars: readonly string[] = [],
): SpriteRaster | null {
  const srcH = rows.length
  const srcW = rows[0]?.length ?? 0
  if (srcW === 0 || srcH === 0 || spanW <= 0 || spanH <= 0) return null

  const w = Math.max(1, Math.ceil(spanW))
  const h = Math.max(1, Math.ceil(spanH))
  const insetX = (w - spanW) / 2
  const insetY = h - spanH
  const scaleX = spanW / srcW
  const scaleY = spanH / srcH

  const raster = resampleRows(rows, {
    w,
    h,
    x0: -insetX / scaleX,
    y0: -insetY / scaleY,
    stepX: 1 / scaleX,
    stepY: 1 / scaleY,
    priorityChars: priorityChars.length > 0 ? new Set(priorityChars) : undefined,
  })
  if (raster.length === 0) return null

  return {
    raster,
    // Exact centring forces an even box and therefore two-column growth. The
    // rounded left edge lets `w` follow ceil(spanW), within half a pixel of the
    // requested anchor.
    left: anchorX - Math.round(w / 2),
    top: anchorBottomY - h,
    w,
    h,
  }
}

/** Backwards-compatible uniform-scale wrapper. */
export function resampleSpriteAtScale(
  rows: readonly string[],
  scale: number,
  anchorX: number,
  anchorBottomY: number,
): SpriteRaster | null {
  const srcH = rows.length
  const srcW = rows[0]?.length ?? 0
  return resampleSpriteAtSpan(rows, srcW * scale, srcH * scale, anchorX, anchorBottomY)
}
