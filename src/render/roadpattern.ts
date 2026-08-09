import {
  KERB_STRIPE_M,
  ROAD_MARKER_SPACING_M, ROAD_MARKER_VIEW_M, ROAD_MARKER_DEPTH_M, ROAD_MARKER_MAX_PX,
  CENTRE_DASH_M, CENTRE_GAP_M,
} from '../config.ts'
import { depthToScanline, patternDepthLimit } from './projection.ts'

/**
 * World-space generators for the repeating patterns painted on the road:
 * segment markers, kerb stripes and the centre line.
 *
 * All three used to be sampled per scanline ("is there a marker at my depth?"),
 * which aliases badly: a scanline near the horizon spans 75 m of world, so a
 * 0.8 m marker window was hit in about one frame in forty and the line appeared
 * to flash on and off. These functions invert the problem — they walk the
 * pattern's own world indices and project each occurrence onto the screen — so
 * every marker is emitted exactly once and its scanline moves monotonically
 * down as the camera approaches. No canvas involved, which is what makes the
 * behaviour testable.
 */

/** One road segment marker, projected. */
export interface RoadMarker {
  /** World index — the marker is painted at `index * ROAD_MARKER_SPACING_M`. */
  index: number
  /** Metres ahead of the camera. */
  worldZ: number
  /** Scanline below the horizon, 1-based. */
  dy: number
  /** Height in pixels; grows with perspective, capped by ROAD_MARKER_MAX_PX. */
  thicknessPx: number
}

/** A run of scanlines covered by one repetition of a pattern. */
export interface PatternSpan {
  /** World index of the repetition. */
  index: number
  /** Topmost scanline, 1-based, inclusive. */
  fromDy: number
  /** Bottommost scanline, 1-based, inclusive. */
  toDy: number
}

/** Kerb stripe span; `alt` selects the second of the two alternating colours. */
export interface KerbSpan extends PatternSpan {
  alt: boolean
}

const CENTRE_PERIOD_M = CENTRE_DASH_M + CENTRE_GAP_M

/**
 * First scanline (1-based) at which kerb stripes are at least one pixel long.
 * Above it the 2 m stripes are sub-pixel and are drawn as one flat colour.
 */
export function kerbDetailScanline(): number {
  return Math.floor(depthToScanline(patternDepthLimit(KERB_STRIPE_M))) + 1
}

/**
 * First scanline (1-based) at which centre-line dashes are resolvable.
 * Above it the line is drawn solid — which is also how a dashed line looks
 * from far away in the real world.
 */
export function centreDetailScanline(): number {
  return Math.floor(depthToScanline(patternDepthLimit(CENTRE_PERIOD_M))) + 1
}

/**
 * Markers visible from `cameraDistance`, nearest first.
 *
 * With ROAD_MARKER_VIEW_M equal to the spacing this yields at most one marker:
 * it enters near the horizon, accelerates down the screen as 1/z steepens, and
 * the next one appears only once it has swept past the bottom.
 */
export function visibleMarkers(cameraDistance: number, scanlines: number): RoadMarker[] {
  const markers: RoadMarker[] = []

  for (let index = Math.ceil(cameraDistance / ROAD_MARKER_SPACING_M); ; index++) {
    const worldZ = index * ROAD_MARKER_SPACING_M - cameraDistance
    if (worldZ > ROAD_MARKER_VIEW_M) break
    if (worldZ <= 0) continue

    const dyExact = depthToScanline(worldZ)
    const dy = Math.round(dyExact)
    if (dy < 1 || dy > scanlines) continue // already swept under the cab

    const farEdge = depthToScanline(worldZ + ROAD_MARKER_DEPTH_M)
    const thicknessPx = Math.max(1, Math.min(ROAD_MARKER_MAX_PX, Math.round(dyExact - farEdge)))

    markers.push({ index, worldZ, dy, thicknessPx })
  }

  return markers
}

/**
 * Kerb stripes visible from `cameraDistance`, nearest first.
 *
 * Spans tile without gaps or overlap: stripe `n` ends where stripe `n+1` begins,
 * because both derive their boundary from `floor(depthToScanline(sharedEdge))`.
 */
export function visibleKerbStripes(cameraDistance: number, scanlines: number): KerbSpan[] {
  const spans: KerbSpan[] = []
  const limit = patternDepthLimit(KERB_STRIPE_M)
  const detailDy = kerbDetailScanline()

  for (let index = Math.floor(cameraDistance / KERB_STRIPE_M); ; index++) {
    const near = index * KERB_STRIPE_M - cameraDistance
    if (near > limit) break

    const far = near + KERB_STRIPE_M
    const toDy = near <= 0 ? scanlines : Math.min(scanlines, Math.floor(depthToScanline(near)))
    const fromDy = Math.max(detailDy, Math.floor(depthToScanline(far)) + 1)
    if (toDy < fromDy) continue

    spans.push({ index, fromDy, toDy, alt: index % 2 === 1 })
  }

  return spans
}

/** Centre-line dashes visible from `cameraDistance`, nearest first. */
export function visibleCentreDashes(cameraDistance: number, scanlines: number): PatternSpan[] {
  const spans: PatternSpan[] = []
  const limit = patternDepthLimit(CENTRE_PERIOD_M)
  const detailDy = centreDetailScanline()

  for (let index = Math.floor(cameraDistance / CENTRE_PERIOD_M); ; index++) {
    const near = index * CENTRE_PERIOD_M - cameraDistance
    if (near > limit) break

    const far = near + CENTRE_DASH_M
    if (far <= 0) continue // whole dash is behind the camera

    const toDy = near <= 0 ? scanlines : Math.min(scanlines, Math.floor(depthToScanline(near)))
    const fromDy = Math.max(detailDy, Math.floor(depthToScanline(far)) + 1)
    if (toDy < fromDy) continue

    spans.push({ index, fromDy, toDy })
  }

  return spans
}
