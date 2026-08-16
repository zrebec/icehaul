import { describe, it, expect } from 'vitest'
import { C } from 'zx-kit'
import type { GlowSource } from 'zx-kit'
import {
  TRUCK_BMP_DATA, TRUCK_BMP_LEFT_DATA, TRUCK_BMP_RIGHT_DATA, TRUCK_BMP_W, TRUCK_BMP_H,
  TRUCK_LAMPS, pushTruckLampSpots,
} from '../truck.ts'
import {
  TRUCK_GLOW_BRAKE_INTENSITY, TRUCK_GLOW_BRAKE_RADIUS,
  TRUCK_GLOW_INTENSITY, TRUCK_GLOW_RADIUS,
} from '../../config.ts'

describe('truck bitmap exports', () => {
  it('dimensions match ZX Spectrum 8px multiples', () => {
    expect(TRUCK_BMP_W).toBe(32)
    expect(TRUCK_BMP_H).toBe(40)
    expect(TRUCK_BMP_W % 8).toBe(0)
    expect(TRUCK_BMP_H % 8).toBe(0)
  })

  it('data length matches width × height', () => {
    const expected = (TRUCK_BMP_W / 8) * TRUCK_BMP_H
    expect(TRUCK_BMP_DATA.length).toBe(expected)
  })

  it('is a Uint8Array', () => {
    expect(TRUCK_BMP_DATA).toBeInstanceOf(Uint8Array)
  })

  it('has transparent corners and a broad centred roof line', () => {
    const firstRow = Array.from(TRUCK_BMP_DATA.slice(0, TRUCK_BMP_W / 8))
    expect(firstRow[0]! & 0x80).toBe(0)
    expect(firstRow.at(-1)! & 0x01).toBe(0)
    expect(firstRow.some(byte => byte !== 0)).toBe(true)
  })

  it('keeps the square trailer body nearly full-width', () => {
    const bpr = TRUCK_BMP_W / 8
    const row20 = 20 * bpr
    expect(TRUCK_BMP_DATA[row20]).not.toBe(0x00)
    expect(TRUCK_BMP_DATA[row20 + 1]).toBe(0xFF)
    expect(TRUCK_BMP_DATA[row20 + 2]).toBe(0xFF)
    expect(TRUCK_BMP_DATA[row20 + 3]).not.toBe(0x00)
  })

  it('bottom rows contain separated left and right wheel pairs', () => {
    const bpr = TRUCK_BMP_W / 8
    const row38 = 38 * bpr
    expect(TRUCK_BMP_DATA[row38]).not.toBe(0x00)
    expect(TRUCK_BMP_DATA[row38 + 1]).not.toBe(0x00)
    expect(TRUCK_BMP_DATA[row38 + 2]).not.toBe(0x00)
    expect(TRUCK_BMP_DATA[row38 + 3]).not.toBe(0x00)
  })
})

describe('truck steering sprite variants', () => {
  const bpr = TRUCK_BMP_W / 8

  it('LEFT variant shifts the roof toward the near side', () => {
    const leftHalf = TRUCK_BMP_LEFT_DATA.slice(0, bpr / 2)
    const rightHalf = TRUCK_BMP_LEFT_DATA.slice(bpr / 2, bpr)
    expect(Array.from(leftHalf).some(byte => byte !== 0)).toBe(true)
    expect(Array.from(rightHalf).some(byte => byte !== 0)).toBe(true)
  })

  it('RIGHT variant mirrors the left-facing roof', () => {
    expect(TRUCK_BMP_RIGHT_DATA.slice(0, bpr)).not.toEqual(TRUCK_BMP_LEFT_DATA.slice(0, bpr))
  })

  it('turning variants are real perspective silhouettes, not translated base rows', () => {
    const row = 21 * bpr
    expect(Array.from(TRUCK_BMP_LEFT_DATA.slice(row, row + bpr)))
      .not.toEqual(Array.from(TRUCK_BMP_DATA.slice(row, row + bpr)))
    expect(Array.from(TRUCK_BMP_RIGHT_DATA.slice(row, row + bpr)))
      .not.toEqual(Array.from(TRUCK_BMP_DATA.slice(row, row + bpr)))
  })

  it('LEFT and RIGHT variants have same byte count as base', () => {
    expect(TRUCK_BMP_LEFT_DATA.length).toBe(TRUCK_BMP_DATA.length)
    expect(TRUCK_BMP_RIGHT_DATA.length).toBe(TRUCK_BMP_DATA.length)
  })

  it('LEFT and RIGHT variants mirror each other pixel-for-pixel', () => {
    const reverseByte = (byte: number) => Number.parseInt(
      byte.toString(2).padStart(8, '0').split('').reverse().join(''),
      2,
    )

    for (let row = 0; row < TRUCK_BMP_H; row++) {
      const idx = row * bpr
      for (let byte = 0; byte < bpr; byte++) {
        expect(TRUCK_BMP_RIGHT_DATA[idx + byte])
          .toBe(reverseByte(TRUCK_BMP_LEFT_DATA[idx + bpr - 1 - byte]!))
      }
    }
  })
})

describe('the truck knows where its own tail lamps are', () => {
  // Measured off the red layer rather than written down, because the red layer
  // of this drawing *is* the lamps. These hold the properties that makes the
  // measurement safe to trust — a redraw that broke any of them would put the
  // halo somewhere the truck has no light.
  const VARIANTS = ['left', 'straight', 'right'] as const

  it.each(VARIANTS)('%s has exactly two of them', (variant) => {
    expect(TRUCK_LAMPS[variant]).toHaveLength(2)
  })

  it.each(VARIANTS)('%s puts them either side of the centre line', (variant) => {
    const [left, right] = TRUCK_LAMPS[variant]
    expect(left!.dx).toBeLessThan(TRUCK_BMP_W / 2)
    expect(right!.dx).toBeGreaterThan(TRUCK_BMP_W / 2)
  })

  it.each(VARIANTS)('%s puts them low on the back, not up the trailer', (variant) => {
    // The rear cluster sits just above the wheels. Anything in the upper half
    // would be the trailer, and a glowing trailer is the "bigger blob" failure.
    for (const lamp of TRUCK_LAMPS[variant]) {
      expect(lamp.dy).toBeGreaterThan(TRUCK_BMP_H * 0.6)
      expect(lamp.dy).toBeLessThan(TRUCK_BMP_H)
    }
  })

  it('mirrors the turning variants, as the sprites themselves do', () => {
    const [ll, lr] = TRUCK_LAMPS.left
    const [rl, rr] = TRUCK_LAMPS.right
    expect(TRUCK_BMP_W - ll!.dx).toBeCloseTo(rr!.dx, 6)
    expect(TRUCK_BMP_W - lr!.dx).toBeCloseTo(rl!.dx, 6)
  })
})

describe('pushTruckLampSpots', () => {
  const spots = (braking: boolean): GlowSource[] => {
    const out: GlowSource[] = []
    pushTruckLampSpots(out, 128, 120, 0, 0, braking)
    return out
  }

  it('places both lamps inside the sprite it is drawn from', () => {
    // drawTruck anchors at cx - W/2, baseY - H; the halo must use the same box
    // or it would sit a pixel off the light on every frame.
    const left = 128 - TRUCK_BMP_W / 2
    const top = 120 - TRUCK_BMP_H
    for (const spot of spots(false)) {
      expect(spot.x).toBeGreaterThanOrEqual(left)
      expect(spot.x).toBeLessThanOrEqual(left + TRUCK_BMP_W)
      expect(spot.y).toBeGreaterThanOrEqual(top)
      expect(spot.y).toBeLessThanOrEqual(top + TRUCK_BMP_H)
    }
  })

  it('is red while cruising — the player is always going away', () => {
    for (const spot of spots(false)) expect(spot.color).toBe(C.B_RED)
    expect(spots(false)).toHaveLength(2)
  })

  it('changes three things on the brake, not one', () => {
    // The truck's raster does not change when braking, so the light carries the
    // whole signal. One number moving is what made the first attempt invisible:
    // brighter, bigger and white-cored is the difference between "warmer" and
    // "the brakes are on".
    const cruise = spots(false).filter(s => s.color === C.B_RED)
    const brake = spots(true).filter(s => s.color === C.B_RED)

    expect(brake[0]!.intensity, 'brighter').toBeGreaterThan(cruise[0]!.intensity!)
    expect(brake[0]!.radius, 'bigger').toBeGreaterThan(cruise[0]!.radius)
    expect(spots(true).some(s => s.color === C.B_WHITE), 'white core').toBe(true)

    expect(TRUCK_GLOW_BRAKE_INTENSITY).toBeGreaterThan(TRUCK_GLOW_INTENSITY)
    expect(TRUCK_GLOW_BRAKE_RADIUS).toBeGreaterThan(TRUCK_GLOW_RADIUS)
  })

  it('puts a core on each lamp and nowhere else', () => {
    const cores = spots(true).filter(s => s.color === C.B_WHITE)
    const haloes = spots(true).filter(s => s.color === C.B_RED)
    expect(cores).toHaveLength(2)
    for (const core of cores) {
      expect(haloes.some(h => h.x === core.x && h.y === core.y)).toBe(true)
      expect(core.radius).toBeLessThan(haloes[0]!.radius)
    }
  })

  it('follows the lean, so the halo does not float off a leaning truck', () => {
    const out: GlowSource[] = []
    pushTruckLampSpots(out, 128, 120, 6, 0, false)
    expect(out[0]!.x).toBeCloseTo(spots(false)[0]!.x + 6, 6)
  })

  it('leaves the raster alone on the brake — the light does the talking', () => {
    // Recorded as a test because it is a decision, not an oversight: the lamps
    // stay B_RED in the framebuffer whether or not the player is braking, so
    // nothing here may start depending on a raster change.
    expect(spots(true).filter(s => s.color === C.B_RED)).toHaveLength(2)
  })
})
