/**
 * "How much of the picture changed", as opposed to "how many cells moved".
 *
 * Comparing two rasters cell by cell answers the wrong question once they are
 * different sizes: a sprite that grew by stretching evenly has every cell to the
 * right of the insertion sitting one column over, and a cell-wise diff scores
 * that as change even though the eye sees exactly the growth it expects.
 *
 * Blowing both rasters up to one common fine grid removes the question of which
 * cell is which. What survives is the part that matters — whether the two depict
 * the same picture at different resolutions, or genuinely different pictures.
 *
 * The grid is far finer than any raster in play, so quantisation of the
 * comparison itself contributes well under a percent.
 */

const GRID_W = 660
const GRID_H = 450

/** Nearest-neighbour blow-up. Also used to build a finer *source* — see below. */
export function upsample(rows: readonly string[], w: number, h: number): string[] {
  const srcH = rows.length
  const srcW = rows[0]?.length ?? 0
  if (srcW === 0 || srcH === 0) return []

  const out: string[] = []
  for (let y = 0; y < h; y++) {
    const row = rows[Math.min(srcH - 1, Math.floor(y * srcH / h))]!
    let line = ''
    for (let x = 0; x < w; x++) line += row[Math.min(srcW - 1, Math.floor(x * srcW / w))]!
    out.push(line)
  }
  return out
}

/** Share of the picture that differs between two rasters of any two sizes. */
export function pictureChurn(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0

  const fineA = upsample(a, GRID_W, GRID_H)
  const fineB = upsample(b, GRID_W, GRID_H)
  let diff = 0
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) if (fineA[y]![x] !== fineB[y]![x]) diff++
  }
  return diff / (GRID_W * GRID_H)
}

/**
 * The same sprite as a much finer source. Resampling *this* to a target size is
 * the best any resampler could do at that size, because the source grid has
 * stopped being the limit — so it is the floor a real resample is judged against.
 */
export function finerSource(rows: readonly string[], factor = 8): string[] {
  return upsample(rows, (rows[0]?.length ?? 0) * factor, rows.length * factor)
}
