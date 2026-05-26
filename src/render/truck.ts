import { C, createBitmap, createAttrMap, drawBitmapAttrs, type Bitmap, type AttrMap } from 'zx-kit'

/**
 * 24×16 rear-view truck — 3×2 attribute cells.
 * Based on ChatGPT's sprite specification + manual pixel layout.
 *
 * Colour clash layout:
 *   [WHITE/BLK] [CYAN/BLK] [WHITE/BLK]   cab roof + window
 *   [RED/BLK  ] [WHITE/BLK] [RED/BLK  ]   taillights + trailer
 *
 * Per-row anatomy:
 *   0-1:  Roof taper (narrow at top, widening)
 *   2-3:  Cab body (full width)
 *   4-5:  Rear window (cyan centre, white pillars — colour clash!)
 *   6-7:  Cab bottom → trailer transition
 *   8-9:  Trailer top (widest)
 *   10-11: Trailer body outline (hollow)
 *   12-13: Taillights (red in outer cells)
 *   14-15: Wheels
 */
const TRUCK_BMP: Bitmap = createBitmap(new Uint8Array([
  // Row 0-7: top cell row (cab + window)
  0x00, 0xFF, 0x00,  // 0:  ........XXXXXXXX........  (narrow roof 8px)
  0x03, 0xFF, 0xC0,  // 1:  ......XXXXXXXXXXXX......  (wider 12px)
  0x07, 0xFF, 0xE0,  // 2:  .....XXXXXXXXXXXXXX.....  (14px)
  0x0F, 0xFF, 0xF0,  // 3:  ....XXXXXXXXXXXXXXXX....  (cab full 16px)
  0x0C, 0xFF, 0x30,  // 4:  ....XX..XXXXXXXX..XX....  (window + pillars)
  0x0C, 0xFF, 0x30,  // 5:  ....XX..XXXXXXXX..XX....
  0x0F, 0xFF, 0xF0,  // 6:  ....XXXXXXXXXXXXXXXX....  (cab bottom)
  0x1F, 0xFF, 0xF8,  // 7:  ...XXXXXXXXXXXXXXXXXXXX.  (transition 18px)

  // Row 8-15: bottom cell row (trailer + wheels)
  0x3F, 0xFF, 0xFC,  // 8:  ..XXXXXXXXXXXXXXXXXXXXXX  (trailer top 20px)
  0x3F, 0xFF, 0xFC,  // 9:  ..XXXXXXXXXXXXXXXXXXXXXX
  0x30, 0x00, 0x0C,  // 10: ..XX..................XX  (trailer outline)
  0x30, 0x00, 0x0C,  // 11: ..XX..................XX
  0x38, 0x00, 0x1C,  // 12: ..XXX..............XXX..  (taillights)
  0x38, 0x00, 0x1C,  // 13: ..XXX..............XXX..
  0x1C, 0x00, 0x38,  // 14: ...XXX............XXX...  (wheel arches)
  0x0E, 0x00, 0x70,  // 15: ....XXX..........XXX....  (wheels)
]), 24, 16)

const TRUCK_ATTRS: AttrMap = createAttrMap(3, 2, [
  // Top row: cab
  C.B_WHITE, C.B_CYAN, C.B_WHITE,
  // Bottom row: trailer + taillights
  C.B_RED,   C.B_WHITE, C.B_RED,
], C.BLACK)

/**
 * Draw the rear-view truck at centre-bottom position.
 * `lean` shifts horizontally (body roll from lateral velocity).
 */
export function drawTruck(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  lean = 0,
): void {
  const x = Math.round(cx - 12 + lean)
  const y = Math.round(baseY - 16)
  drawBitmapAttrs(ctx, TRUCK_BMP, TRUCK_ATTRS, x, y)
}
