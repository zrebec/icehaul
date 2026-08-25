import { C } from 'zx-kit'
import { describe, expect, it } from 'vitest'
import {
  TRUCK_BMP_DATA,
  TRUCK_BMP_H,
  TRUCK_BMP_LEFT_DATA,
  TRUCK_BMP_RIGHT_DATA,
  TRUCK_BMP_W,
  TRUCK_LAMP_COLORS,
  TRUCK_LAMPS,
  drawTruck,
  pushTruckLampSpots,
} from '../truck.ts'

function reverseByte(value: number): number {
  let out = 0
  for (let bit = 0; bit < 8; bit++) if (value & (1 << bit)) out |= 1 << (7 - bit)
  return out
}

describe('legacy truck facade', () => {
  it('exposes the new packed 40x64 collision poses', () => {
    expect(TRUCK_BMP_W).toBe(40)
    expect(TRUCK_BMP_H).toBe(64)
    expect(TRUCK_BMP_DATA).toBeInstanceOf(Uint8Array)
    expect(TRUCK_BMP_DATA).toHaveLength((TRUCK_BMP_W / 8) * TRUCK_BMP_H)
    expect(TRUCK_BMP_LEFT_DATA).toHaveLength(TRUCK_BMP_DATA.length)
    expect(TRUCK_BMP_RIGHT_DATA).toHaveLength(TRUCK_BMP_DATA.length)
  })

  it('keeps hard-left and hard-right collision masks mirrored', () => {
    const bytesPerRow = TRUCK_BMP_W / 8
    for (let y = 0; y < TRUCK_BMP_H; y++) {
      for (let byte = 0; byte < bytesPerRow; byte++) {
        expect(TRUCK_BMP_RIGHT_DATA[y * bytesPerRow + byte])
          .toBe(reverseByte(TRUCK_BMP_LEFT_DATA[y * bytesPerRow + bytesPerRow - 1 - byte]!))
      }
    }
  })

  it('keeps rolling and braking lamp colours distinct', () => {
    expect(TRUCK_LAMP_COLORS).toEqual({ rolling: C.RED, braking: C.B_RED })
    for (const lamps of Object.values(TRUCK_LAMPS)) {
      expect(lamps).toHaveLength(2)
      expect(lamps[0]!.dx).toBeLessThan(TRUCK_BMP_W / 2)
      expect(lamps[1]!.dx).toBeGreaterThan(TRUCK_BMP_W / 2)
    }
  })

  it.each([false, true])('places glow directly over the two lamps (braking=%s)', (braking) => {
    const spots: Parameters<typeof pushTruckLampSpots>[0] = []
    pushTruckLampSpots(spots, 128, 120, 0, 0, braking)
    expect(spots).toHaveLength(braking ? 4 : 2)
    const expected = TRUCK_LAMPS.straight
    const left = 128 - TRUCK_BMP_W / 2
    const top = 120 - TRUCK_BMP_H
    const lampSpotIndices = braking ? [0, 2] : [0, 1]
    expect(spots[lampSpotIndices[0]!]!.x).toBeCloseTo(left + expected[0]!.dx)
    expect(spots[lampSpotIndices[0]!]!.y).toBeCloseTo(top + expected[0]!.dy)
    expect(spots[lampSpotIndices[1]!]!.x).toBeCloseTo(left + expected[1]!.dx)
    expect(spots[lampSpotIndices[1]!]!.y).toBeCloseTo(top + expected[1]!.dy)
  })

  it('draws through the new road-train renderer', () => {
    const colors = new Set<string>()
    let fillStyle = ''
    const ctx = {
      get fillStyle() { return fillStyle },
      set fillStyle(value: string | CanvasGradient | CanvasPattern) {
        fillStyle = String(value)
        colors.add(fillStyle)
      },
      fillRect() {},
    } as unknown as CanvasRenderingContext2D
    drawTruck(ctx, 128, 120, 0, 0, true)
    expect(colors).toEqual(new Set([C.BLACK, C.RED, C.B_RED, C.BLUE, C.B_BLUE, C.B_CYAN, C.B_WHITE, C.B_YELLOW]))
  })
})
