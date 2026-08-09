import { describe, it, expect } from 'vitest'
import {
  visibleMarkers, visibleKerbStripes, visibleCentreDashes,
  kerbDetailScanline, centreDetailScanline,
} from '../roadpattern.ts'
import { depthToScanline, patternDepthLimit } from '../projection.ts'
import {
  PERSPECTIVE_K, KERB_STRIPE_M,
  ROAD_MARKER_SPACING_M, ROAD_MARKER_VIEW_M, ROAD_MARKER_MAX_PX,
  CENTRE_DASH_M, CENTRE_GAP_M,
  VIEWPORT_TOP, VIEWPORT_BOTTOM, HORIZON_PCT,
} from '../../config.ts'

// Real viewport geometry: horizon at 31, road 89 px tall, 88 scanlines,
// so dy 1..88 samples 150 m down to 1.70 m ahead.
const horizonY = VIEWPORT_TOP + Math.floor((VIEWPORT_BOTTOM - VIEWPORT_TOP) * HORIZON_PCT)
const SCANLINES = VIEWPORT_BOTTOM - horizonY - 1

/** 90 km/h at 50 fps — the speed the owner reported the flashing at. */
const STEP_M = 25 / 50
const FRAMES = 400

function cameraSweep(frames = FRAMES, step = STEP_M): number[] {
  return Array.from({ length: frames }, (_, f) => f * step)
}

describe('visibleMarkers', () => {
  it('projects a marker onto the scanline its world depth maps to', () => {
    // 25 m ahead → dy = 150/25 = 6.
    const [marker] = visibleMarkers(0, SCANLINES)
    expect(marker).toBeDefined()
    expect(marker!.index).toBe(1)
    expect(marker!.worldZ).toBeCloseTo(25, 6)
    expect(marker!.dy).toBe(6)
  })

  it('never shows more than one marker at a time', () => {
    // ROAD_MARKER_VIEW_M === spacing is what buys this; the assert pins the
    // relationship so raising the view distance cannot silently add clutter.
    expect(ROAD_MARKER_VIEW_M).toBe(ROAD_MARKER_SPACING_M)
    for (const cam of cameraSweep()) {
      expect(visibleMarkers(cam, SCANLINES).length).toBeLessThanOrEqual(1)
    }
  })

  it('moves each marker monotonically down the screen', () => {
    // The bug: scanlines jumped around and markers reappeared above where they
    // had been. Per world index, dy must only ever grow.
    const lastDy = new Map<number, number>()
    for (const cam of cameraSweep()) {
      for (const m of visibleMarkers(cam, SCANLINES)) {
        const prev = lastDy.get(m.index)
        if (prev !== undefined) expect(m.dy).toBeGreaterThanOrEqual(prev)
        lastDy.set(m.index, m.dy)
      }
    }
    expect(lastDy.size).toBeGreaterThan(3)
  })

  it('shows each marker over one contiguous run of frames, never in blinks', () => {
    // This is the flicker guard. The old screen-space test lit dy=1,2,3,6 for
    // two frames, went dark for six, then flickered with 1–5 frame gaps.
    const seen = new Map<number, number[]>()
    cameraSweep().forEach((cam, f) => {
      for (const m of visibleMarkers(cam, SCANLINES)) {
        const frames = seen.get(m.index) ?? []
        frames.push(f)
        seen.set(m.index, frames)
      }
    })

    for (const [index, frames] of seen) {
      const span = frames[frames.length - 1]! - frames[0]! + 1
      expect(span, `marker ${index} blinked: appeared in ${frames.length} of ${span} frames`)
        .toBe(frames.length)
    }
  })

  it('accelerates toward the player as 1/z steepens', () => {
    // The owner's ask: slow approach that speeds up. Sample one marker's whole
    // life and check the per-frame drop never gets smaller.
    const path: number[] = []
    for (const cam of cameraSweep(50)) {
      const m = visibleMarkers(cam, SCANLINES).find(x => x.index === 1)
      if (m) path.push(m.dy)
    }
    expect(path.length).toBeGreaterThan(30)
    expect(path[0]).toBe(6)
    expect(path[path.length - 1]).toBeGreaterThan(50)

    // Deltas are non-decreasing once smoothed over the pixel quantisation.
    const early = path[10]! - path[0]!
    const late = path[path.length - 1]! - path[path.length - 11]!
    expect(late).toBeGreaterThan(early)
  })

  it('thickens with perspective but never becomes a slab', () => {
    const far = visibleMarkers(0, SCANLINES)[0]!
    expect(far.thicknessPx).toBe(1)

    let maxThickness = 0
    for (const cam of cameraSweep()) {
      for (const m of visibleMarkers(cam, SCANLINES)) {
        maxThickness = Math.max(maxThickness, m.thicknessPx)
        expect(m.thicknessPx).toBeGreaterThanOrEqual(1)
        expect(m.thicknessPx).toBeLessThanOrEqual(ROAD_MARKER_MAX_PX)
      }
    }
    expect(maxThickness).toBe(ROAD_MARKER_MAX_PX)
  })

  it('keeps every marker inside the viewport', () => {
    for (const cam of cameraSweep()) {
      for (const m of visibleMarkers(cam, SCANLINES)) {
        expect(m.dy).toBeGreaterThanOrEqual(1)
        expect(m.dy).toBeLessThanOrEqual(SCANLINES)
      }
    }
  })
})

describe('visibleKerbStripes', () => {
  it('tiles scanlines without gaps or overlap', () => {
    for (const cam of cameraSweep(60)) {
      const spans = visibleKerbStripes(cam, SCANLINES)
      expect(spans.length).toBeGreaterThan(0)
      // Emitted nearest-first, so each span sits directly above the previous one.
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i]!.toDy).toBe(spans[i - 1]!.fromDy - 1)
      }
    }
  })

  it('alternates colour between neighbouring stripes', () => {
    const spans = visibleKerbStripes(137.5, SCANLINES)
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.alt).not.toBe(spans[i - 1]!.alt)
    }
  })

  it('emits nothing above the resolvable distance', () => {
    // Past ~16.3 m a 2 m stripe is sub-pixel; drawing it there is pure noise.
    const detail = kerbDetailScanline()
    expect(detail).toBe(Math.floor(depthToScanline(patternDepthLimit(KERB_STRIPE_M))) + 1)
    for (const cam of cameraSweep(60)) {
      for (const span of visibleKerbStripes(cam, SCANLINES)) {
        expect(span.fromDy).toBeGreaterThanOrEqual(detail)
      }
    }
  })

  it('walks each stripe monotonically down the screen', () => {
    const lastFrom = new Map<number, number>()
    for (const cam of cameraSweep(120)) {
      for (const span of visibleKerbStripes(cam, SCANLINES)) {
        const prev = lastFrom.get(span.index)
        if (prev !== undefined) expect(span.fromDy).toBeGreaterThanOrEqual(prev)
        lastFrom.set(span.index, span.fromDy)
        expect(span.toDy).toBeGreaterThanOrEqual(span.fromDy)
      }
    }
    expect(lastFrom.size).toBeGreaterThan(10)
  })
})

describe('visibleCentreDashes', () => {
  it('paints dashes shorter than the gaps between them', () => {
    expect(CENTRE_DASH_M).toBeLessThan(CENTRE_GAP_M)
    const spans = visibleCentreDashes(60, SCANLINES)
    expect(spans.length).toBeGreaterThan(0)
    for (let i = 1; i < spans.length; i++) {
      // A real gap separates consecutive dashes — they must not touch.
      expect(spans[i]!.toDy).toBeLessThan(spans[i - 1]!.fromDy - 1)
    }
  })

  it('emits nothing above the resolvable distance', () => {
    const detail = centreDetailScanline()
    for (const cam of cameraSweep(60)) {
      for (const span of visibleCentreDashes(cam, SCANLINES)) {
        expect(span.fromDy).toBeGreaterThanOrEqual(detail)
        expect(span.toDy).toBeLessThanOrEqual(SCANLINES)
      }
    }
  })

  it('walks each dash monotonically down the screen', () => {
    const lastFrom = new Map<number, number>()
    for (const cam of cameraSweep(120)) {
      for (const span of visibleCentreDashes(cam, SCANLINES)) {
        const prev = lastFrom.get(span.index)
        if (prev !== undefined) expect(span.fromDy).toBeGreaterThanOrEqual(prev)
        lastFrom.set(span.index, span.fromDy)
      }
    }
    expect(lastFrom.size).toBeGreaterThan(5)
  })
})

describe('patternDepthLimit', () => {
  it('returns the depth at which one period spans exactly one scanline', () => {
    for (const period of [0.5, 2, 6, 25]) {
      const z = patternDepthLimit(period)
      expect(PERSPECTIVE_K / z - PERSPECTIVE_K / (z + period)).toBeCloseTo(1, 9)
    }
  })

  it('is monotonic — coarser patterns stay resolvable further out', () => {
    expect(patternDepthLimit(2)).toBeLessThan(patternDepthLimit(6))
    expect(patternDepthLimit(6)).toBeLessThan(patternDepthLimit(25))
  })
})

describe('screen-space sampling (the bug this replaces)', () => {
  it('demonstrates the old predicate blinking where the new one does not', () => {
    // Kept as executable documentation: the pre-fix renderer asked every
    // scanline "is my depth within 0.8 m of a marker?". Reproduced here to show
    // the failure is in the sampling, not in tuning.
    const oldHits = (cam: number): number[] => {
      const rows: number[] = []
      for (let dy = 1; dy <= SCANLINES; dy++) {
        if ((cam + PERSPECTIVE_K / dy) % ROAD_MARKER_SPACING_M < 0.8) rows.push(dy)
      }
      return rows
    }

    const sweep = cameraSweep(52)
    const oldBlankFrames = sweep.filter(cam => oldHits(cam).length === 0).length
    const newBlankFrames = sweep.filter(cam => visibleMarkers(cam, SCANLINES).length === 0).length
    const oldMaxLines = Math.max(...sweep.map(cam => oldHits(cam).length))

    expect(oldBlankFrames).toBeGreaterThan(10)   // 15 of 52 frames had no marker at all
    expect(oldMaxLines).toBeGreaterThan(10)      // and 23 scanlines lit at once elsewhere
    expect(newBlankFrames).toBeLessThan(oldBlankFrames / 3)
  })
})
