import {
  GAME_WIDTH, VIEWPORT_TOP, VIEWPORT_BOTTOM, HORIZON_PCT,
  LATERAL_SHIFT, CURVE_STRENGTH, PERSPECTIVE_K,
  ROAD_HALF_TOP, ROAD_HALF_BOTTOM,
  KERB_WIDTH_TOP, KERB_WIDTH_BOTTOM,
} from '../config.ts'

export interface ScanlineEdges {
  leftRoad: number
  rightRoad: number
  centerX: number
  kerbW: number
}

/**
 * Compute road edges for every road scanline in the viewport.
 * Same math as road3d.ts drawRoad — pixel-identical results.
 * Returns a lookup by screen Y coordinate.
 */
export function computeRoadEdges(
  cameraDistance: number,
  playerX: number,
  getCurvature: (dist: number) => number,
): (screenY: number) => ScanlineEdges | undefined {
  const horizonY = VIEWPORT_TOP + Math.floor((VIEWPORT_BOTTOM - VIEWPORT_TOP) * HORIZON_PCT)
  const roadHeight = VIEWPORT_BOTTOM - horizonY
  const scanlines = roadHeight - 1
  const baseVanX = GAME_WIDTH / 2 - playerX * LATERAL_SHIFT

  const curveOffset = new Float32Array(scanlines)
  let acc = 0
  for (let i = scanlines - 1; i >= 0; i--) {
    const distFromBottom = (scanlines - 1 - i) / scanlines
    const dy = i + 1
    const worldZ = PERSPECTIVE_K / dy
    acc += getCurvature(cameraDistance + worldZ) * CURVE_STRENGTH * distFromBottom
    curveOffset[i] = acc
  }

  const edgesByY = new Array<ScanlineEdges | undefined>(VIEWPORT_BOTTOM + 1)
  for (let i = 0; i < scanlines; i++) {
    const dy = i + 1
    const y = horizonY + dy
    const t = dy / roadHeight
    const half = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * t
    const centerX = baseVanX + (curveOffset[i] ?? 0)
    edgesByY[y] = {
      leftRoad: Math.round(centerX - half),
      rightRoad: Math.round(centerX + half),
      centerX,
      kerbW: Math.max(1, Math.round(KERB_WIDTH_TOP + (KERB_WIDTH_BOTTOM - KERB_WIDTH_TOP) * t)),
    }
  }

  return (screenY: number) => edgesByY[screenY]
}
