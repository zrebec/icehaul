import { C, createBitmap, createAttrMap, drawBitmapAttrs, type Bitmap, type AttrMap } from 'zx-kit'

/**
 * 24x32 rear-view ice-road truck.
 *
 * The base bitmap keeps to ZX rules: 3 columns x 4 rows of 8x8 attributes,
 * transparent paper, one ink per cell. Extra fillRect details use only zx-kit
 * palette colours and are mirrored in the collision mask where they are solid.
 */

export const TRUCK_BMP_W = 24
export const TRUCK_BMP_H = 32

const TRUCK_ROWS = [
  '........XXXXXXXX........',
  '......XXXXXXXXXXXX......',
  '.....XXXXXXXXXXXXXX.....',
  '....XXXXXXXXXXXXXXXX....',
  '...XXXXXXXXXXXXXXXXXX...',
  '...XXXX..XXXXXX..XXXX...',
  '..XXXXXXXXXXXXXXXXXXXX..',
  '..XXXXXXXXXXXXXXXXXXXX..',

  'XXXXXXXXXXXXXXXXXXXXXXXX',
  '.XXX....XXXXXXXX....XXX.',
  '.XXX....XXXXXXXX....XXX.',
  '.XXX....XXXXXXXX....XXX.',
  '.XXXXXXXXXXXXXXXXXXXXXX.',
  '.XX.XXXXXXXXXXXXXXXX.XX.',
  '.XXXXXXXXXXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXXXXXXXXXX',

  'XXXXXXXXXXXXXXXXXXXXXXXX',
  'XX..XXXXXXXXXXXXXXXX..XX',
  'XX..XX............XX..XX',
  'XX..XX............XX..XX',
  'XX..XX............XX..XX',
  'XX..XXXXXXXXXXXXXXXX..XX',
  'XXXXXXXXXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXXXXXXXXX',

  'XX....................XX',
  'XXX..................XXX',
  '....XXXXXXXXXXXXXXXX....',
  '.....XXXXXXXXXXXXXX.....',
  '........................',
  '........................',
  '........................',
  '........................',
] as const

function rowsToBitmapData(rows: readonly string[], width: number, height: number): Uint8Array {
  if (rows.length !== height) throw new Error(`truck bitmap: expected ${height} rows, got ${rows.length}`)

  const bytesPerRow = width / 8
  const out = new Uint8Array(bytesPerRow * height)
  for (let row = 0; row < height; row++) {
    const line = rows[row]!
    if (line.length !== width) throw new Error(`truck bitmap row ${row}: expected ${width} cols, got ${line.length}`)

    for (let col = 0; col < width; col++) {
      const ch = line[col]
      if (ch === '.') continue
      if (ch !== 'X') throw new Error(`truck bitmap row ${row}: invalid char ${ch}`)

      const byteIdx = row * bytesPerRow + Math.floor(col / 8)
      out[byteIdx]! |= 1 << (7 - (col % 8))
    }
  }
  return out
}

export const TRUCK_BMP_DATA = rowsToBitmapData(TRUCK_ROWS, TRUCK_BMP_W, TRUCK_BMP_H)

const TRUCK_BMP: Bitmap = createBitmap(TRUCK_BMP_DATA, TRUCK_BMP_W, TRUCK_BMP_H)

// Shift every row of a sprite left (dx<0) or right (dx>0) within the fixed-width frame.
// Pixels shifted off one edge are replaced with transparent dots on the other.
function shiftRow(row: string, dx: number): string {
  if (dx === 0) return row
  if (dx < 0) return row.slice(-dx) + '.'.repeat(-dx)
  return '.'.repeat(dx) + row.slice(0, TRUCK_BMP_W - dx)
}

export const TRUCK_BMP_LEFT_DATA = rowsToBitmapData(
  TRUCK_ROWS.map(r => shiftRow(r, -2)), TRUCK_BMP_W, TRUCK_BMP_H,
)
export const TRUCK_BMP_RIGHT_DATA = rowsToBitmapData(
  TRUCK_ROWS.map(r => shiftRow(r, 2)), TRUCK_BMP_W, TRUCK_BMP_H,
)

const TRUCK_BMP_LEFT: Bitmap = createBitmap(TRUCK_BMP_LEFT_DATA, TRUCK_BMP_W, TRUCK_BMP_H)
const TRUCK_BMP_RIGHT: Bitmap = createBitmap(TRUCK_BMP_RIGHT_DATA, TRUCK_BMP_W, TRUCK_BMP_H)

function buildCollisionData(): Uint8Array {
  const data = new Uint8Array(TRUCK_BMP_DATA)
  const bpr = TRUCK_BMP_W / 8

  const setBit = (row: number, col: number) => {
    const byteIdx = row * bpr + Math.floor(col / 8)
    data[byteIdx]! |= 1 << (7 - (col % 8))
  }
  const fillSpan = (row: number, left: number, right: number) => {
    for (let col = left; col <= right; col++) setBit(row, col)
  }

  // Visually black but physically solid: glass, rear door shadow, bumper, tyres.
  for (let row = 9; row <= 12; row++) {
    fillSpan(row, 5, 9)
    fillSpan(row, 14, 18)
  }
  for (let row = 18; row <= 21; row++) fillSpan(row, 6, 17)
  for (let row = 24; row <= 27; row++) fillSpan(row, 4, 19)
  for (let row = 26; row <= 31; row++) {
    fillSpan(row, 2, 6)
    fillSpan(row, 17, 21)
  }

  return data
}

export const TRUCK_COLLISION_BMP: Bitmap = createBitmap(buildCollisionData(), TRUCK_BMP_W, TRUCK_BMP_H)

const TRUCK_ATTRS: AttrMap = createAttrMap(3, 4, [
  C.B_WHITE, C.B_WHITE, C.B_WHITE,
  C.B_WHITE, C.B_CYAN,  C.B_WHITE,
  C.B_WHITE, C.B_WHITE, C.B_WHITE,
  C.B_RED,   C.B_YELLOW, C.B_RED,
])

/**
 * Draw the rear-view truck at centre-bottom position.
 * `lean` shifts horizontally (body roll from lateral velocity).
 * `steerDir` selects the whole-truck sprite variant: -1 left, 0 straight, 1 right.
 */
export function drawTruck(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  lean = 0,
  steerDir: -1 | 0 | 1 = 0,
): void {
  const x = Math.round(cx - 12 + lean)
  const y = Math.round(baseY - 32)
  const o = steerDir * 2  // pixel offset matching the whole-truck sprite shift

  // Opaque dark mass first: the road must not show through the truck body.
  ctx.fillStyle = C.BLACK
  ctx.fillRect(x + 5 + o, y + 9, 5, 4)
  ctx.fillRect(x + 14 + o, y + 9, 5, 4)
  ctx.fillRect(x + 6 + o, y + 18, 12, 4)
  ctx.fillRect(x + 4 + o, y + 24, 16, 4)
  ctx.fillRect(x + 2 + o, y + 26, 5, 6)
  ctx.fillRect(x + 17 + o, y + 26, 5, 6)

  const bmp = steerDir < 0 ? TRUCK_BMP_LEFT : steerDir > 0 ? TRUCK_BMP_RIGHT : TRUCK_BMP
  drawBitmapAttrs(ctx, bmp, TRUCK_ATTRS, x, y)

  // Pixel accents: frosty rear glass, box seams, red lights, yellow plate.
  // All offsets follow the sprite shift so accents stay locked to the body.
  ctx.fillStyle = C.BLACK
  ctx.fillRect(x + 11 + o, y + 17, 1, 6)
  ctx.fillRect(x + 6 + o, y + 19, 12, 1)
  ctx.fillRect(x + 6 + o, y + 21, 12, 1)

  ctx.fillStyle = C.B_CYAN
  ctx.fillRect(x + 7 + o, y + 9, 3, 4)
  ctx.fillRect(x + 14 + o, y + 9, 3, 4)
  ctx.fillRect(x + 11 + o, y + 8, 2, 1)
  ctx.fillRect(x + 3 + o, y + 15, 18, 1)

  ctx.fillStyle = C.B_WHITE
  ctx.fillRect(x + 8 + o, y + 0, 8, 1)
  ctx.fillRect(x + 2 + o, y + 16, 20, 1)
  ctx.fillRect(x + 3 + o, y + 23, 18, 1)

  ctx.fillStyle = C.B_RED
  ctx.fillRect(x + 1 + o, y + 24, 3, 3)
  ctx.fillRect(x + 20 + o, y + 24, 3, 3)
  ctx.fillRect(x + 5 + o, y + 5, 2, 1)
  ctx.fillRect(x + 17 + o, y + 5, 2, 1)

  ctx.fillStyle = C.B_YELLOW
  ctx.fillRect(x + 9 + o, y + 26, 6, 2)

  ctx.fillStyle = C.WHITE
  ctx.fillRect(x + 7 + o, y + 30, 10, 1)
}
