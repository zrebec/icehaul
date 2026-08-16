/**
 * What the halo is allowed to be, expressed as properties of the art and of the
 * projection rather than as pixel positions.
 *
 * Nothing here checks what the bloom *looks* like — jsdom has no 2D context and
 * a snapshot of a blur would be worthless anyway. That judgement is made on the
 * contact sheets. What is checked is everything a wrong answer would ruin
 * silently: that a lamp is found where the drawing actually put one, that the
 * halo lands on the vehicle at every distance, that it cannot grow without
 * bound, and that switching it off really does mean nothing is emitted.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { C } from 'zx-kit'
import type { GlowSource } from 'zx-kit'
import {
  findLampPair, glowCoreRadiusFor, glowRadiusFor, lampChar, lampColor, lampPairFor,
  pushTrafficLampSpots, renderLampGlow, setGlowSettings, wantsGlowCore,
} from '../vehicleGlow.ts'
import { drawTraffic, getTrafficSpriteRows, projectTrafficVehicle } from '../road3d.ts'
import { resetVehicleRasterCache } from '../vehicleRaster.ts'
import { MATRIX_DISTANCES_M, glowSettingsFromSearch } from '../debug/trafficMatrix.ts'
import {
  GLOW_ALPHA, GLOW_CORE_MIN_HEIGHT, GLOW_CORE_RADIUS_MAX, GLOW_CORE_RADIUS_MIN,
  GLOW_RADIUS_MAX, GLOW_RADIUS_MIN, VIEWPORT_BOTTOM, VIEWPORT_TOP,
} from '../../config.ts'
import type { TrafficDir, TrafficVehicle, VehicleType } from '../../game/traffic.ts'

const DIRS: readonly TrafficDir[] = ['same', 'oncoming']
const TYPES: readonly VehicleType[] = ['mini', 'car', 'bus']
const SPRITES = DIRS.flatMap(dir => TYPES.map(type => ({ dir, type, name: `${dir} ${type}` })))

const noCurve = () => 0
const veh = (distM: number, dir: TrafficDir, type: VehicleType): TrafficVehicle =>
  ({ spawnDist: 0, distM, x: dir === 'oncoming' ? -0.5 : 0.5, speed: 0, dir, type, gone: false })

beforeEach(() => {
  resetVehicleRasterCache()
  setGlowSettings({ enabled: true, alpha: GLOW_ALPHA, radiusScale: 1 })
})

afterEach(() => {
  setGlowSettings({ enabled: true, alpha: GLOW_ALPHA, radiusScale: 1 })
})

describe('the lamps are found in the art, not declared', () => {
  it.each(SPRITES)('$name has a lamp on each side', ({ dir, type }) => {
    expect(lampPairFor(dir, type)).not.toBeNull()
  })

  it.each(SPRITES)('$name puts them in the outer third of the drawing', ({ dir, type }) => {
    // The redraw's rule is "lamps occupy the outermost columns". A lamp char
    // that turned up in the middle of a future sprite would drag the centroid
    // inward, and the halo would drift off the light it belongs to — which is
    // the one failure this whole module has to be protected from.
    const pair = lampPairFor(dir, type)!
    expect(pair.left.u, 'left lamp').toBeLessThan(1 / 3)
    expect(pair.right.u, 'right lamp').toBeGreaterThan(2 / 3)
  })

  it.each(SPRITES)('$name is symmetric about its own centre', ({ dir, type }) => {
    // Every row of every sprite is a palindrome (`vehicleArt.test.ts`), so the
    // two centroids must mirror. If they stop mirroring, the art broke first.
    const pair = lampPairFor(dir, type)!
    expect(pair.left.u).toBeCloseTo(1 - pair.right.u, 6)
    expect(pair.left.v).toBeCloseTo(pair.right.v, 6)
  })

  it.each(SPRITES)('$name puts them on the body, not the roof or the wheels', ({ dir, type }) => {
    const pair = lampPairFor(dir, type)!
    expect(pair.left.v).toBeGreaterThan(0.3)
    expect(pair.left.v).toBeLessThan(0.8)
  })

  it('reads the direction it is asked about, not the one in the art', () => {
    // Same-direction sprites use Y for a number plate, which is not a lamp, and
    // asking for the wrong direction's char must find no pair rather than
    // reporting the plate as two lights.
    expect(lampChar('same')).toBe('R')
    expect(lampChar('oncoming')).toBe('Y')
    expect(findLampPair(getTrafficSpriteRows('oncoming', 'car'), 'same')).toBeNull()
  })

  it('gives a drawing with no lamps no halo at all', () => {
    expect(findLampPair(['XXXX', 'XXXX'], 'same')).toBeNull()
    expect(findLampPair([], 'oncoming')).toBeNull()
  })

  it('finds a one-pixel lamp at its centre, not at its left edge', () => {
    // Cell centres, so a lamp in column 0 of a four-wide sprite is at 0.125 —
    // an eighth in from the edge, which is the middle of that pixel.
    const pair = findLampPair(['R..R'], 'same')!
    expect(pair.left.u).toBeCloseTo(0.125, 6)
    expect(pair.right.u).toBeCloseTo(0.875, 6)
  })

  it('says which way it is going in the halo colour too', () => {
    expect(lampColor('oncoming')).toBe(C.B_YELLOW)
    expect(lampColor('same')).toBe(C.B_RED)
  })
})

describe('the halo lands on the vehicle', () => {
  it.each(SPRITES)('$name keeps both lamps inside its drawn box', ({ dir, type }) => {
    for (const distM of MATRIX_DISTANCES_M) {
      const p = projectTrafficVehicle(
        VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, veh(distM, dir, type), noCurve,
      )
      if (!p) continue

      const spots: GlowSource[] = []
      pushTrafficLampSpots(spots, p, dir)
      // Two lamps, each with a core once the vehicle is close enough.
      expect(spots, `${distM} m`).toHaveLength(wantsGlowCore(p.h) ? 4 : 2)

      for (const spot of spots) {
        expect(spot.x, `${distM} m: x`).toBeGreaterThanOrEqual(p.left)
        expect(spot.x, `${distM} m: x`).toBeLessThanOrEqual(p.left + p.w)
        expect(spot.y, `${distM} m: y`).toBeGreaterThanOrEqual(p.top)
        expect(spot.y, `${distM} m: y`).toBeLessThanOrEqual(p.top + p.h)
      }
    }
  })

  it.each(SPRITES)('$name spreads its lamps apart as it gets closer', ({ dir, type }) => {
    // The gap between the two haloes is the drawn width times a constant, so it
    // grows with the vehicle. If it ever stopped growing, the halo would have
    // come loose from the projection and be sitting at a fixed screen offset.
    const gapAt = (distM: number): number => {
      const p = projectTrafficVehicle(
        VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, veh(distM, dir, type), noCurve,
      )!
      const spots: GlowSource[] = []
      pushTrafficLampSpots(spots, p, dir)
      // Haloes only: a core sits on top of its own lamp, so including them
      // would measure the distance from a lamp to itself.
      const haloes = spots.filter(s => s.color !== C.B_WHITE)
      return Math.abs(haloes[1]!.x - haloes[0]!.x)
    }
    expect(gapAt(10)).toBeGreaterThan(gapAt(220))
  })
})

describe('the radius is tied to the vehicle and capped', () => {
  it('never goes below the floor or above the cap', () => {
    for (const h of [0, 1, 2, 5, 10, 20, 40, 500]) {
      expect(glowRadiusFor(h)).toBeGreaterThanOrEqual(GLOW_RADIUS_MIN)
      expect(glowRadiusFor(h)).toBeLessThanOrEqual(GLOW_RADIUS_MAX)
    }
  })

  it('grows with the vehicle between the two', () => {
    let previous = 0
    for (let h = 0; h <= 40; h++) {
      const r = glowRadiusFor(h)
      expect(r, `h=${h}`).toBeGreaterThanOrEqual(previous)
      previous = r
    }
  })

  it('reaches the cap before a vehicle fills the viewport', () => {
    // A bus in the last metres is about 26 px tall against an 88 px viewport.
    expect(glowRadiusFor(26)).toBe(GLOW_RADIUS_MAX)
  })
})

describe('switched off, nothing is emitted', () => {
  /**
   * Counts calls without pretending to be a canvas. This is not a rendering
   * test — it is here to tell "drew the vehicle and collected no lamps" apart
   * from "drew nothing at all", which are the same empty array otherwise.
   */
  function stubCtx(): { ctx: CanvasRenderingContext2D; calls: { rects: number; saves: number } } {
    const calls = { rects: 0, saves: 0 }
    const ctx = {
      fillStyle: '',
      fillRect: () => { calls.rects++ },
      save: () => { calls.saves++ },
      restore: () => {},
      beginPath: () => {},
      rect: () => {},
      clip: () => {},
    } as unknown as CanvasRenderingContext2D
    return { ctx, calls }
  }

  it('collects lamps while the vehicle is still drawn', () => {
    const spy = stubCtx()
    const spots: GlowSource[] = []
    drawTraffic(
      spy.ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0,
      [veh(25, 'oncoming', 'car')], noCurve, spots,
    )
    expect(spots.length).toBeGreaterThanOrEqual(2)
    expect(spy.calls.rects, 'the vehicle itself was drawn').toBeGreaterThan(0)
  })

  it('collects nothing at all when glow is off', () => {
    setGlowSettings({ enabled: false, alpha: GLOW_ALPHA, radiusScale: 1 })
    const spy = stubCtx()
    const spots: GlowSource[] = []
    drawTraffic(
      spy.ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0,
      [veh(25, 'oncoming', 'car')], noCurve, spots,
    )
    // The promise the kit's glow module makes, held to here: a frame that does
    // not use glow is the frame it was before glow existed.
    expect(spots).toHaveLength(0)
    expect(spy.calls.rects, 'the vehicle is drawn exactly as before').toBeGreaterThan(0)
  })

  it('does not touch the canvas when there is nothing to blit', () => {
    const spy = stubCtx()
    renderLampGlow(spy.ctx, [])
    setGlowSettings({ enabled: false, alpha: GLOW_ALPHA, radiusScale: 1 })
    renderLampGlow(spy.ctx, [{ x: 10, y: 10, radius: 4, color: C.B_RED, intensity: 1 }])
    expect(spy.calls.saves).toBe(0)
  })
})

describe('glowSettingsFromSearch', () => {
  it('is on by default', () => {
    expect(glowSettingsFromSearch('')).toEqual({ enabled: true, alpha: GLOW_ALPHA, radiusScale: 1 })
    expect(glowSettingsFromSearch('?seed=1443866')).toEqual({ enabled: true, alpha: GLOW_ALPHA, radiusScale: 1 })
  })

  it('turns off on zero, in either spelling', () => {
    expect(glowSettingsFromSearch('?glow=0').enabled).toBe(false)
    expect(glowSettingsFromSearch('?glow=0.0').enabled).toBe(false)
  })

  it('reads a fraction as the strength', () => {
    expect(glowSettingsFromSearch('?glow=0.35')).toEqual({ enabled: true, alpha: 0.35, radiusScale: 1 })
    expect(glowSettingsFromSearch('?matrix=1&glow=0.5').alpha).toBe(0.5)
  })

  it('treats one and above as "on", not as full white', () => {
    expect(glowSettingsFromSearch('?glow=1')).toEqual({ enabled: true, alpha: GLOW_ALPHA, radiusScale: 1 })
    expect(glowSettingsFromSearch('?glow=7')).toEqual({ enabled: true, alpha: GLOW_ALPHA, radiusScale: 1 })
  })

  it('falls back to on when it cannot read the value', () => {
    // A typo must not silently remove the thing being judged.
    expect(glowSettingsFromSearch('?glow=abc')).toEqual({ enabled: true, alpha: GLOW_ALPHA, radiusScale: 1 })
    expect(glowSettingsFromSearch('?glow=')).toEqual({ enabled: true, alpha: GLOW_ALPHA, radiusScale: 1 })
  })
})

describe('the white-hot core', () => {
  it('waits until the vehicle is close enough to carry it', () => {
    // The core is white, and white desaturates the halo it sits in. Far away
    // that colour is the only thing saying which way the vehicle is going, so
    // the core is not allowed there — see GLOW_CORE_MIN_HEIGHT.
    expect(wantsGlowCore(GLOW_CORE_MIN_HEIGHT - 1)).toBe(false)
    expect(wantsGlowCore(GLOW_CORE_MIN_HEIGHT)).toBe(true)
  })

  it('is drawn on the lamp, not beside it', () => {
    const p = projectTrafficVehicle(
      VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, veh(10, 'oncoming', 'bus'), noCurve,
    )!
    const spots: GlowSource[] = []
    pushTrafficLampSpots(spots, p, 'oncoming')

    const cores = spots.filter(s => s.color === C.B_WHITE)
    const haloes = spots.filter(s => s.color !== C.B_WHITE)
    expect(cores).toHaveLength(2)
    for (const core of cores) {
      const halo = haloes.find(h => h.x === core.x && h.y === core.y)
      expect(halo, 'a core with no lamp under it').toBeDefined()
      expect(core.radius).toBeLessThan(halo!.radius)
    }
  })

  it('stays small however large the vehicle gets', () => {
    for (const h of [0, 5, 12, 30, 400]) {
      expect(glowCoreRadiusFor(h)).toBeGreaterThanOrEqual(GLOW_CORE_RADIUS_MIN)
      expect(glowCoreRadiusFor(h)).toBeLessThanOrEqual(GLOW_CORE_RADIUS_MAX)
    }
  })

  it('never carries the direction on its own', () => {
    // Far tier: colour is the whole message, so no white is emitted at all.
    const p = projectTrafficVehicle(
      VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, veh(220, 'same', 'mini'), noCurve,
    )!
    const spots: GlowSource[] = []
    pushTrafficLampSpots(spots, p, 'same')
    expect(spots.every(s => s.color === C.B_RED)).toBe(true)
  })
})

describe('the radius multiplier from ?glow=alpha,radius', () => {
  it('scales halo and core together', () => {
    const halo = glowRadiusFor(12)
    const core = glowCoreRadiusFor(12)
    setGlowSettings({ enabled: true, alpha: GLOW_ALPHA, radiusScale: 2 })
    expect(glowRadiusFor(12)).toBeCloseTo(halo * 2, 6)
    expect(glowCoreRadiusFor(12)).toBeCloseTo(core * 2, 6)
  })

  it('scales past the cap, because the cap is the thing being questioned', () => {
    // The clamp is applied first and the multiplier after, so `?glow=0.8,2` can
    // actually show what a bigger cap would look like. Without that the switch
    // would be silently inert for every near vehicle, which is where it matters.
    setGlowSettings({ enabled: true, alpha: GLOW_ALPHA, radiusScale: 2 })
    expect(glowRadiusFor(1000)).toBeCloseTo(GLOW_RADIUS_MAX * 2, 6)
  })

  it('is 1 unless the URL says otherwise', () => {
    expect(glowSettingsFromSearch('?glow=0.8').radiusScale).toBe(1)
    expect(glowSettingsFromSearch('?glow=0.8,1.5').radiusScale).toBe(1.5)
    expect(glowSettingsFromSearch('?glow=0.8,abc').radiusScale).toBe(1)
    expect(glowSettingsFromSearch('?glow=0.8,-2').radiusScale).toBe(1)
    expect(glowSettingsFromSearch('?glow=0.8,99').radiusScale, 'clamped').toBe(4)
  })
})
