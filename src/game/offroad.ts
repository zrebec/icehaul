import { bitmapPixelMask, type PixelMask } from 'zx-kit'
import { TRUCK_COLLISION_BMP, TRUCK_ROAD_MASK } from '../render/truck.ts'
import type { ScanlineEdges } from './roadgeometry.ts'

/** A rectangle in game pixels. */
export interface Bounds {
  readonly left: number
  readonly top: number
  readonly w: number
  readonly h: number
}

export interface OffroadResult {
  offRoadPixels: number
  totalPixels: number
  severity: number
  leftOff: number
  rightOff: number
  marginLeft: number
  marginRight: number
}

const DEFAULT_TRUCK_PIXEL_MASK = TRUCK_ROAD_MASK
const DEFAULT_TRAFFIC_PIXEL_MASK = bitmapPixelMask(TRUCK_COLLISION_BMP)

export function checkTruckOffroad(
  truckDrawX: number,
  truckDrawY: number,
  getEdges: (screenY: number) => ScanlineEdges | undefined,
  truckPixelMask: PixelMask = DEFAULT_TRUCK_PIXEL_MASK,
): OffroadResult {
  let leftOff = 0
  let rightOff = 0
  let minMarginLeft = Infinity
  let minMarginRight = Infinity

  for (let row = 0; row < truckPixelMask.height; row++) {
    const screenY = truckDrawY + row
    const edges = getEdges(screenY)
    if (!edges) continue

    const maskRow = truckPixelMask.rows[row]!
    if (maskRow.length === 0) continue

    const outerLeft = edges.leftRoad - edges.kerbW
    const outerRight = edges.rightRoad + edges.kerbW

    const truckLeft = truckDrawX + maskRow[0]!
    const truckRight = truckDrawX + maskRow[maskRow.length - 1]!

    const marginL = truckLeft - outerLeft
    const marginR = outerRight - truckRight
    if (marginL < minMarginLeft) minMarginLeft = marginL
    if (marginR < minMarginRight) minMarginRight = marginR

    if (truckLeft >= outerLeft && truckRight <= outerRight) continue

    for (const col of maskRow) {
      const sx = truckDrawX + col
      if (sx < outerLeft) leftOff++
      else if (sx > outerRight) rightOff++
    }
  }

  const offRoadPixels = leftOff + rightOff
  return {
    offRoadPixels,
    totalPixels: truckPixelMask.totalPixels,
    severity: offRoadPixels > 0 ? offRoadPixels / truckPixelMask.totalPixels : 0,
    leftOff,
    rightOff,
    marginLeft: minMarginLeft,
    marginRight: minMarginRight,
  }
}

/**
 * Pixel-perfect check: does any solid truck bitmap pixel touch a solid traffic
 * pixel? Without `trafficRaster` this falls back to the full-rect check.
 *
 * `trafficRaster` must be the raster the vehicle was **drawn** from — already at
 * the projected size, one raster pixel per screen pixel — not the source sprite.
 * This used to take the source and rescale it here, in the opposite direction to
 * the renderer, and the two never agreed: at a metre 45 pixels collided without
 * ever being drawn and 19 drawn pixels passed straight through. Indexing the
 * shared raster directly makes "pixel-perfect" true of what is actually on
 * screen. See `render/vehicleRaster.ts`.
 *
 * truckDrawX/Y — top-left of the truck bitmap in game pixels.
 * trafficLeft/Top, trafficW/H — the rendered vehicle rectangle.
 */
/**
 * The tight box around everything a mask actually occupies.
 *
 * Deliberately tighter than `width`/`height`: an articulated truck's mask is
 * 40 wide and its widest row is not, so the declared size would flatter the
 * cheap test it exists to be compared against. `null` for an empty mask.
 */
export function pixelMaskBounds(mask: PixelMask): Bounds | null {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
  for (let row = 0; row < mask.height; row++) {
    const cols = mask.rows[row]!
    if (cols.length === 0) continue
    left = Math.min(left, cols[0]!)
    right = Math.max(right, cols[cols.length - 1]!)
    top = Math.min(top, row)
    bottom = Math.max(bottom, row)
  }
  return right < left ? null : { left, top, w: right - left + 1, h: bottom - top + 1 }
}

/** The same, for a drawn traffic raster: `.` is transparent, anything else is not. */
export function rasterBounds(rows: readonly string[]): Bounds | null {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!
    const first = row.search(/[^.]/)
    if (first < 0) continue
    const last = row.length - 1 - [...row].reverse().join('').search(/[^.]/)
    left = Math.min(left, first)
    right = Math.max(right, last)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  return right < left ? null : { left, top, w: right - left + 1, h: bottom - top + 1 }
}

/**
 * The cheap test the real one is not.
 *
 * This is what the collision *would* be if the game boxed its sprites, and it
 * exists so the debug overlay can show the daylight between the two: every
 * frame where this says "touching" and {@link checkTruckTrafficCollision} says
 * "not touching" is a crash the player would have suffered for nothing.
 */
export function aabbOverlap(a: Bounds, b: Bounds): boolean {
  return a.left < b.left + b.w && b.left < a.left + a.w
    && a.top < b.top + b.h && b.top < a.top + a.h
}

export function checkTruckTrafficCollision(
  truckDrawX: number, truckDrawY: number,
  trafficLeft: number, trafficTop: number,
  trafficW: number, trafficH: number,
  trafficRaster?: readonly string[],
  truckPixelMask: PixelMask = DEFAULT_TRAFFIC_PIXEL_MASK,
): boolean {
  if (trafficW <= 0 || trafficH <= 0) return false

  const trafficRight  = trafficLeft + trafficW
  const trafficBottom = trafficTop  + trafficH
  const useTrafficMask = (trafficRaster?.length ?? 0) > 0

  for (let row = 0; row < truckPixelMask.height; row++) {
    const screenY = truckDrawY + row
    if (screenY < trafficTop || screenY >= trafficBottom) continue

    const maskRow = truckPixelMask.rows[row]!
    if (maskRow.length === 0) continue

    // Quick horizontal reject before per-pixel scan
    const leftPx  = truckDrawX + maskRow[0]!
    const rightPx = truckDrawX + maskRow[maskRow.length - 1]!
    if (rightPx < trafficLeft || leftPx >= trafficRight) continue

    const rasterRow = useTrafficMask ? trafficRaster![screenY - trafficTop] : undefined

    for (const col of maskRow) {
      const sx = truckDrawX + col
      if (sx < trafficLeft || sx >= trafficRight) continue
      if (!useTrafficMask) return true

      const ch = rasterRow?.[sx - trafficLeft]
      if (ch && ch !== '.') return true
    }
  }
  return false
}
