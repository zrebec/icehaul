import { C, createBitmap, createAttrMap, drawBitmapAttrs, type Bitmap, type AttrMap } from 'zx-kit'

/**
 * 24×32 rear-view truck — 3 cols × 4 rows of 8×8 attribute cells.
 * TALLER than wide (32 > 24) — as real trucks are.
 * Paper omitted → transparent background, road shows through.
 *
 * Colour clash layout:
 *   [WHITE] [WHITE] [WHITE]   row 0: cab roof taper
 *   [WHITE] [CYAN ] [WHITE]   row 1: cab body + rear window (clash!)
 *   [WHITE] [WHITE] [WHITE]   row 2: trailer body outline
 *   [RED  ] [WHITE] [RED  ]   row 3: taillights + license plate + wheels
 *
 * Per-row anatomy:
 *   0-7:   Cab roof (narrows at top from 8px to 20px)
 *   8-15:  Cab body + rear window (cyan centre, white pillar sides)
 *   16-23: Trailer box (outline, hollow interior)
 *   24-31: Taillights (red corners) + white plate + wheel pairs
 */

// prettier-ignore
const TRUCK_BMP: Bitmap = createBitmap(new Uint8Array([
  // Row 0 — cab roof (y=0-7): WHITE across all 3 cells
  0x00, 0xFF, 0x00,  // y0:  ........XXXXXXXX........  narrow 8px
  0x03, 0xFF, 0xC0,  // y1:  ......XXXXXXXXXXXX......  12px
  0x07, 0xFF, 0xE0,  // y2:  .....XXXXXXXXXXXXXX.....  14px
  0x0F, 0xFF, 0xF0,  // y3:  ....XXXXXXXXXXXXXXXX....  16px
  0x1F, 0xFF, 0xF8,  // y4:  ...XXXXXXXXXXXXXXXXXXXX.  18px
  0x1F, 0xFF, 0xF8,  // y5:  ...XXXXXXXXXXXXXXXXXXXX.
  0x3F, 0xFF, 0xFC,  // y6:  ..XXXXXXXXXXXXXXXXXXXXXX  20px
  0x3F, 0xFF, 0xFC,  // y7:  ..XXXXXXXXXXXXXXXXXXXXXX

  // Row 1 — cab body + window (y=8-15): WHITE sides, CYAN centre
  0xFF, 0xFF, 0xFF,  // y8:  XXXXXXXXXXXXXXXXXXXXXXXX  full width 24px
  0xEF, 0xFF, 0xF7,  // y9:  XXX.XXXXXXXXXXXXXXXX.XXX  pillars + window
  0xEF, 0xFF, 0xF7,  // y10: XXX.XXXXXXXXXXXXXXXX.XXX
  0xEF, 0xFF, 0xF7,  // y11: XXX.XXXXXXXXXXXXXXXX.XXX
  0xEF, 0xFF, 0xF7,  // y12: XXX.XXXXXXXXXXXXXXXX.XXX
  0xFF, 0xFF, 0xFF,  // y13: XXXXXXXXXXXXXXXXXXXXXXXX  window bottom
  0xFF, 0xFF, 0xFF,  // y14: XXXXXXXXXXXXXXXXXXXXXXXX
  0xFF, 0xFF, 0xFF,  // y15: XXXXXXXXXXXXXXXXXXXXXXXX

  // Row 2 — trailer body (y=16-23): WHITE across all 3 cells
  0xFF, 0xFF, 0xFF,  // y16: XXXXXXXXXXXXXXXXXXXXXXXX  top
  0xFF, 0xFF, 0xFF,  // y17: XXXXXXXXXXXXXXXXXXXXXXXX
  0xC0, 0x00, 0x03,  // y18: XX....................XX  outline
  0xC0, 0x00, 0x03,  // y19: XX....................XX
  0xC0, 0x00, 0x03,  // y20: XX....................XX
  0xC0, 0x00, 0x03,  // y21: XX....................XX
  0xFF, 0xFF, 0xFF,  // y22: XXXXXXXXXXXXXXXXXXXXXXXX  bottom
  0xFF, 0xFF, 0xFF,  // y23: XXXXXXXXXXXXXXXXXXXXXXXX

  // Row 3 — taillights + plate + wheels (y=24-31): RED sides, WHITE centre
  0xC0, 0x00, 0x03,  // y24: XX....................XX  taillights (red)
  0xC0, 0x00, 0x03,  // y25: XX....................XX
  0x00, 0xFF, 0x00,  // y26: ........XXXXXXXX........  license plate (white centre)
  0x00, 0xB6, 0x00,  // y27: ........X.XX.XX.........  plate text marks
  0x30, 0x00, 0x0C,  // y28: ..XX..................XX  wheels
  0x30, 0x00, 0x0C,  // y29: ..XX..................XX
  0x00, 0x00, 0x00,  // y30: ........................  ground clearance
  0x00, 0x00, 0x00,  // y31: ........................
]), 24, 32)

// No paper → transparent background. Road surface shows through.
const TRUCK_ATTRS: AttrMap = createAttrMap(3, 4, [
  C.B_WHITE, C.B_WHITE, C.B_WHITE,    // row 0: cab roof
  C.B_WHITE, C.B_CYAN,  C.B_WHITE,    // row 1: cab body — cyan window, white pillars
  C.B_WHITE, C.B_WHITE, C.B_WHITE,    // row 2: trailer body
  C.B_RED,   C.B_WHITE, C.B_RED,      // row 3: taillights + plate
])

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
  const y = Math.round(baseY - 32)
  drawBitmapAttrs(ctx, TRUCK_BMP, TRUCK_ATTRS, x, y)
}
