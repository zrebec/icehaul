import { C, createBitmap, createAttrMap, drawBitmapAttrs, type Bitmap, type AttrMap } from 'zx-kit'

/**
 * 16×32 rear-view truck bitmap — 2×4 attribute cells.
 *
 * Layout:
 *   Row 0: cab roof (tapers inward at top)
 *   Row 1: cab body with rear window (cyan glow)
 *   Row 2: trailer/box body (solid white outline)
 *   Row 3: undercarriage + taillights (red)
 */
const TRUCK_BMP: Bitmap = createBitmap(new Uint8Array([
  // Row 0 — cab roof (narrows toward top)
  0x07, 0xE0,  // ....0111 1110....
  0x0F, 0xF0,  // ....1111 1111....
  0x1F, 0xF8,  // ...11111 11111...
  0x1F, 0xF8,  // ...11111 11111...
  0x3F, 0xFC,  // ..111111 111111..
  0x3F, 0xFC,  // ..111111 111111..
  0x7F, 0xFE,  // .1111111 1111111.
  0xFF, 0xFF,  // 11111111 11111111

  // Row 1 — cab body + rear window
  0xFF, 0xFF,  // 11111111 11111111
  0xCF, 0xF3,  // 11..1111 1111..11  (window frame)
  0xC6, 0x63,  // 11...11. .11...11  (window panes)
  0xC6, 0x63,
  0xC6, 0x63,
  0xCF, 0xF3,  // 11..1111 1111..11  (window bottom)
  0xFF, 0xFF,
  0xFF, 0xFF,

  // Row 2 — trailer body
  0xFF, 0xFF,
  0xFF, 0xFF,
  0xE0, 0x07,  // 111..... .....111  (door gap suggestion)
  0xE0, 0x07,
  0xE0, 0x07,
  0xE0, 0x07,
  0xFF, 0xFF,
  0xFF, 0xFF,

  // Row 3 — wheels + taillights
  0xE0, 0x07,  // 111..... .....111  (taillight strip)
  0xE0, 0x07,
  0x60, 0x06,  // .11..... .....11.
  0x70, 0x0E,  // .111.... ....111.
  0x3C, 0x3C,  // ..1111.. ..1111..  (wheel pairs)
  0x3C, 0x3C,
  0x00, 0x00,
  0x00, 0x00,
]), 16, 32)

const TRUCK_ATTRS: AttrMap = createAttrMap(2, 4, [
  C.B_WHITE,  C.B_WHITE,    // cab roof
  C.B_CYAN,   C.B_CYAN,     // cab body — window glow colour-clashes
  C.B_WHITE,  C.B_WHITE,    // trailer body
  C.B_RED,    C.B_RED,      // taillights + wheels
], C.BLACK)

/**
 * Draw the rear-view truck at the given centre-bottom position.
 * `lean` shifts the sprite horizontally by a few pixels (body roll).
 */
export function drawTruck(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  lean = 0,
): void {
  const x = Math.round(cx - 8 + lean)
  const y = Math.round(baseY - 32)
  drawBitmapAttrs(ctx, TRUCK_BMP, TRUCK_ATTRS, x, y)
}
