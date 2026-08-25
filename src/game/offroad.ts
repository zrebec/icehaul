import { bitmapPixelMask, type PixelMask } from 'zx-kit'
import { TRUCK_COLLISION_BMP, TRUCK_ROAD_MASK } from '../render/truck.ts'
import type { ScanlineEdges } from './roadgeometry.ts'

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
