import { bitmapPixelMask } from 'zx-kit'
import { TRUCK_COLLISION_BMP } from '../render/truck.ts'
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

const TRUCK_PIXEL_MASK = bitmapPixelMask(TRUCK_COLLISION_BMP)

export function checkTruckOffroad(
  truckDrawX: number,
  truckDrawY: number,
  getEdges: (screenY: number) => ScanlineEdges | undefined,
): OffroadResult {
  let leftOff = 0
  let rightOff = 0
  let minMarginLeft = Infinity
  let minMarginRight = Infinity

  for (let row = 0; row < TRUCK_PIXEL_MASK.height; row++) {
    const screenY = truckDrawY + row
    const edges = getEdges(screenY)
    if (!edges) continue

    const maskRow = TRUCK_PIXEL_MASK.rows[row]!
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
    totalPixels: TRUCK_PIXEL_MASK.totalPixels,
    severity: offRoadPixels > 0 ? offRoadPixels / TRUCK_PIXEL_MASK.totalPixels : 0,
    leftOff,
    rightOff,
    marginLeft: minMarginLeft,
    marginRight: minMarginRight,
  }
}

/**
 * Pixel-perfect check: does any solid truck bitmap pixel touch a solid traffic
 * sprite pixel? Without trafficRows this falls back to the old full-rect check.
 * truckDrawX/Y — top-left of the truck bitmap in game pixels.
 * trafficLeft/Top, trafficW/H — the rendered vehicle rectangle.
 * trafficRows — sprite row strings where "." is transparent.
 */
export function checkTruckTrafficCollision(
  truckDrawX: number, truckDrawY: number,
  trafficLeft: number, trafficTop: number,
  trafficW: number, trafficH: number,
  trafficRows?: readonly string[],
): boolean {
  if (trafficW <= 0 || trafficH <= 0) return false

  const trafficRight  = trafficLeft + trafficW
  const trafficBottom = trafficTop  + trafficH
  const srcH = trafficRows?.length ?? 0
  const srcW = srcH > 0 ? trafficRows![0]?.length ?? 0 : 0
  const useTrafficMask = srcW > 0 && srcH > 0

  for (let row = 0; row < TRUCK_PIXEL_MASK.height; row++) {
    const screenY = truckDrawY + row
    if (screenY < trafficTop || screenY >= trafficBottom) continue

    const maskRow = TRUCK_PIXEL_MASK.rows[row]!
    if (maskRow.length === 0) continue

    // Quick horizontal reject before per-pixel scan
    const leftPx  = truckDrawX + maskRow[0]!
    const rightPx = truckDrawX + maskRow[maskRow.length - 1]!
    if (rightPx < trafficLeft || leftPx >= trafficRight) continue

    for (const col of maskRow) {
      const sx = truckDrawX + col
      if (sx < trafficLeft || sx >= trafficRight) continue
      if (!useTrafficMask) return true

      const trafficX = Math.floor((sx - trafficLeft) * srcW / trafficW)
      const trafficY = Math.floor((screenY - trafficTop) * srcH / trafficH)
      const ch = trafficRows![trafficY]?.[trafficX]
      if (ch && ch !== '.') return true
    }
  }
  return false
}
