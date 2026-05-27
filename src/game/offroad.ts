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
