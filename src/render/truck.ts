import { C, createBitmap, createAttrMap, drawBitmapAttrs, type Bitmap, type AttrMap, type SpectrumColor } from 'zx-kit'

/**
 * 24x32 rear view of a black box truck.
 *
 * Each colour is a separate 1-bit ZX bitmap layer. This keeps the sprite
 * compatible with createBitmap/drawBitmapAttrs while allowing the dark trailer
 * mass, frame, lamps and wheels to stay visually distinct.
 */

const SOURCE_W = 24
const SOURCE_H = 32

export const TRUCK_BMP_W = 32
export const TRUCK_BMP_H = 40

type PixelLayer = boolean[][]
type TruckLayers = {
  black: PixelLayer
  white: PixelLayer
  cyan: PixelLayer
  red: PixelLayer
  yellow: PixelLayer
}

function emptyLayer(): PixelLayer {
  return Array.from({ length: SOURCE_H }, () => Array<boolean>(SOURCE_W).fill(false))
}

function createLayers(): TruckLayers {
  return {
    black: emptyLayer(),
    white: emptyLayer(),
    cyan: emptyLayer(),
    red: emptyLayer(),
    yellow: emptyLayer(),
  }
}

function pixel(layer: PixelLayer, x: number, y: number): void {
  if (x >= 0 && x < SOURCE_W && y >= 0 && y < SOURCE_H) layer[y]![x] = true
}

function hline(layer: PixelLayer, x1: number, x2: number, y: number): void {
  for (let x = x1; x <= x2; x++) pixel(layer, x, y)
}

function vline(layer: PixelLayer, x: number, y1: number, y2: number): void {
  for (let y = y1; y <= y2; y++) pixel(layer, x, y)
}

function fill(layer: PixelLayer, x1: number, y1: number, x2: number, y2: number): void {
  for (let y = y1; y <= y2; y++) hline(layer, x1, x2, y)
}

function buildStraightLayers(): TruckLayers {
  const l = createLayers()

  // Large square trailer mass.
  fill(l.black, 3, 1, 20, 2)
  fill(l.black, 2, 3, 21, 22)
  fill(l.black, 1, 23, 22, 26)
  fill(l.black, 3, 27, 7, 31)
  fill(l.black, 16, 27, 20, 31)

  // Cold metal outer frame and rear door frame.
  hline(l.cyan, 5, 18, 0)
  pixel(l.cyan, 4, 1)
  pixel(l.cyan, 19, 1)
  vline(l.cyan, 1, 8, 14)
  vline(l.cyan, 22, 8, 14)
  hline(l.cyan, 1, 22, 26)
  vline(l.cyan, 7, 24, 26)
  vline(l.cyan, 16, 24, 26)

  hline(l.white, 4, 19, 2)
  hline(l.white, 3, 20, 3)
  vline(l.white, 2, 4, 21)
  vline(l.white, 21, 4, 21)
  hline(l.white, 3, 20, 22)
  hline(l.white, 4, 19, 4)
  vline(l.white, 4, 5, 20)
  vline(l.white, 19, 5, 20)
  hline(l.white, 5, 18, 21)

  // Twin rear doors, hinges and latches.
  vline(l.cyan, 11, 5, 20)
  vline(l.cyan, 12, 5, 20)
  for (const y of [7, 15]) {
    hline(l.cyan, 3, 5, y)
    hline(l.cyan, 18, 20, y)
  }
  hline(l.cyan, 9, 13, 18)
  vline(l.cyan, 9, 16, 19)
  vline(l.cyan, 14, 16, 19)

  fill(l.red, 2, 24, 6, 25)
  fill(l.red, 17, 24, 21, 25)
  fill(l.yellow, 9, 24, 14, 25)

  // Four visibly separated tyre pairs.
  for (const x of [3, 5, 17, 19]) {
    vline(l.cyan, x, 28, 31)
    pixel(l.cyan, x + 1, 28)
    pixel(l.cyan, x + 1, 30)
  }

  return l
}

function buildLeftLayers(): TruckLayers {
  const l = createLayers()

  // The near left side grows while the far right edge stays almost vertical.
  fill(l.black, 6, 1, 19, 1)
  fill(l.black, 4, 2, 20, 2)
  fill(l.black, 2, 3, 21, 4)
  fill(l.black, 1, 5, 22, 21)
  fill(l.black, 2, 22, 22, 26)
  fill(l.black, 1, 27, 6, 31)
  fill(l.black, 17, 27, 20, 31)

  hline(l.cyan, 7, 18, 0)
  pixel(l.cyan, 6, 1)
  pixel(l.cyan, 19, 1)
  vline(l.cyan, 0, 8, 16)
  pixel(l.cyan, 1, 7)
  pixel(l.cyan, 1, 17)
  hline(l.cyan, 2, 22, 26)
  vline(l.cyan, 7, 24, 26)
  vline(l.cyan, 16, 24, 26)

  hline(l.white, 7, 19, 2)
  hline(l.white, 4, 21, 3)
  pixel(l.white, 3, 4)
  pixel(l.white, 2, 5)
  vline(l.white, 1, 6, 19)
  pixel(l.white, 2, 20)
  hline(l.white, 3, 7, 21)
  vline(l.white, 7, 4, 21)
  hline(l.white, 8, 20, 4)
  vline(l.white, 20, 5, 21)
  hline(l.white, 8, 20, 22)

  // Door geometry is compressed toward the far edge.
  vline(l.cyan, 12, 5, 20)
  vline(l.cyan, 13, 5, 20)
  for (const y of [7, 15]) {
    hline(l.cyan, 6, 8, y)
    hline(l.cyan, 19, 21, y)
  }
  hline(l.cyan, 10, 15, 18)
  vline(l.cyan, 10, 16, 19)
  vline(l.cyan, 16, 16, 19)

  fill(l.red, 3, 24, 7, 25)
  fill(l.red, 17, 24, 21, 25)
  fill(l.yellow, 10, 24, 15, 25)

  // Near wheels are larger and more exposed.
  vline(l.cyan, 1, 27, 30)
  vline(l.cyan, 2, 28, 31)
  vline(l.cyan, 4, 28, 31)
  vline(l.cyan, 6, 28, 31)
  vline(l.cyan, 17, 28, 31)
  vline(l.cyan, 19, 28, 31)

  return l
}

function mirrorLayer(source: PixelLayer): PixelLayer {
  return source.map(row => [...row].reverse())
}

function mirrorLayers(source: TruckLayers): TruckLayers {
  return {
    black: mirrorLayer(source.black),
    white: mirrorLayer(source.white),
    cyan: mirrorLayer(source.cyan),
    red: mirrorLayer(source.red),
    yellow: mirrorLayer(source.yellow),
  }
}

function scaleLayer(source: PixelLayer): PixelLayer {
  return Array.from({ length: TRUCK_BMP_H }, (_, y) => {
    const sourceY = Math.min(SOURCE_H - 1, Math.floor(y * SOURCE_H / TRUCK_BMP_H))
    return Array.from({ length: TRUCK_BMP_W }, (_, x) => {
      const sourceX = Math.min(SOURCE_W - 1, Math.floor(x * SOURCE_W / TRUCK_BMP_W))
      return source[sourceY]![sourceX]!
    })
  })
}

function scaleLayers(source: TruckLayers): TruckLayers {
  return {
    black: scaleLayer(source.black),
    white: scaleLayer(source.white),
    cyan: scaleLayer(source.cyan),
    red: scaleLayer(source.red),
    yellow: scaleLayer(source.yellow),
  }
}

function layersToSolidData(layers: TruckLayers): Uint8Array {
  const solid = Array.from(
    { length: TRUCK_BMP_H },
    () => Array<boolean>(TRUCK_BMP_W).fill(false),
  )
  for (const layer of Object.values(layers)) {
    for (let y = 0; y < TRUCK_BMP_H; y++) {
      for (let x = 0; x < TRUCK_BMP_W; x++) solid[y]![x] ||= layer[y]![x]!
    }
  }
  return layerToBitmapData(solid)
}

function layerToBitmapData(layer: PixelLayer): Uint8Array {
  const bytesPerRow = TRUCK_BMP_W / 8
  const out = new Uint8Array(bytesPerRow * TRUCK_BMP_H)
  for (let y = 0; y < TRUCK_BMP_H; y++) {
    for (let x = 0; x < TRUCK_BMP_W; x++) {
      if (!layer[y]![x]) continue
      out[y * bytesPerRow + Math.floor(x / 8)]! |= 1 << (7 - (x % 8))
    }
  }
  return out
}

const STRAIGHT_LAYERS = scaleLayers(buildStraightLayers())
const LEFT_LAYERS = scaleLayers(buildLeftLayers())
const RIGHT_LAYERS = mirrorLayers(LEFT_LAYERS)

export const TRUCK_BMP_DATA = layersToSolidData(STRAIGHT_LAYERS)
export const TRUCK_BMP_LEFT_DATA = layersToSolidData(LEFT_LAYERS)
export const TRUCK_BMP_RIGHT_DATA = layersToSolidData(RIGHT_LAYERS)

export const TRUCK_COLLISION_BMP: Bitmap = createBitmap(
  TRUCK_BMP_DATA,
  TRUCK_BMP_W,
  TRUCK_BMP_H,
)

type RenderLayers = Record<keyof TruckLayers, Bitmap>

function createRenderLayers(layers: TruckLayers): RenderLayers {
  return {
    black: createBitmap(layerToBitmapData(layers.black), TRUCK_BMP_W, TRUCK_BMP_H),
    white: createBitmap(layerToBitmapData(layers.white), TRUCK_BMP_W, TRUCK_BMP_H),
    cyan: createBitmap(layerToBitmapData(layers.cyan), TRUCK_BMP_W, TRUCK_BMP_H),
    red: createBitmap(layerToBitmapData(layers.red), TRUCK_BMP_W, TRUCK_BMP_H),
    yellow: createBitmap(layerToBitmapData(layers.yellow), TRUCK_BMP_W, TRUCK_BMP_H),
  }
}

function solidAttrs(color: SpectrumColor): AttrMap {
  const attrCols = TRUCK_BMP_W / 8
  const attrRows = TRUCK_BMP_H / 8
  return createAttrMap(
    attrCols,
    attrRows,
    Array<SpectrumColor>(attrCols * attrRows).fill(color),
  )
}

const STRAIGHT_RENDER = createRenderLayers(STRAIGHT_LAYERS)
const LEFT_RENDER = createRenderLayers(LEFT_LAYERS)
const RIGHT_RENDER = createRenderLayers(RIGHT_LAYERS)

const BLACK_ATTRS = solidAttrs(C.BLACK)
const WHITE_ATTRS = solidAttrs(C.B_WHITE)
const CYAN_ATTRS = solidAttrs(C.B_CYAN)
const RED_ATTRS = solidAttrs(C.B_RED)
const YELLOW_ATTRS = solidAttrs(C.B_YELLOW)

/**
 * Draw the truck at centre-bottom position.
 * `lean` shifts it horizontally; `steerDir` selects a true perspective sprite.
 */
export function drawTruck(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  lean = 0,
  steerDir: -1 | 0 | 1 = 0,
): void {
  const x = Math.round(cx - TRUCK_BMP_W / 2 + lean)
  const y = Math.round(baseY - TRUCK_BMP_H)
  const layers = steerDir < 0 ? LEFT_RENDER : steerDir > 0 ? RIGHT_RENDER : STRAIGHT_RENDER

  drawBitmapAttrs(ctx, layers.black, BLACK_ATTRS, x, y)
  drawBitmapAttrs(ctx, layers.white, WHITE_ATTRS, x, y)
  drawBitmapAttrs(ctx, layers.cyan, CYAN_ATTRS, x, y)
  drawBitmapAttrs(ctx, layers.red, RED_ATTRS, x, y)
  drawBitmapAttrs(ctx, layers.yellow, YELLOW_ATTRS, x, y)
}
