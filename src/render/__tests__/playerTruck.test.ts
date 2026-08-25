import { C, mirrorBitmap, type Bitmap } from 'zx-kit'
import { describe, expect, it } from 'vitest'
import {
  PLAYER_TRUCK_ANGLES,
  PLAYER_TRUCK_COLLISION_BITMAPS,
  PLAYER_TRUCK_COLLISION_MASKS,
  PLAYER_TRUCK_H,
  PLAYER_TRUCK_LAMP_COLORS,
  PLAYER_TRUCK_LAYOUT,
  PLAYER_TRUCK_POSES,
  PLAYER_TRUCK_W,
  createPlayerTruckArticulation,
  drawPlayerTruck,
  getPlayerTruckCollisionBitmap,
  getPlayerTruckCollisionMask,
  getPlayerTruckLampPositions,
  getPlayerTruckWheelPositions,
  quantizeTruckAngle,
  updatePlayerTruckArticulation,
  type PlayerTruckArticulation,
  type PlayerTruckLayer,
  type TruckAngle,
} from '../sprites/playerTruck.ts'

function bit(bitmap: Bitmap, x: number, y: number): boolean {
  const bytesPerRow = bitmap.width / 8
  return (bitmap.data[y * bytesPerRow + (x >> 3)]! & (0x80 >> (x & 7))) !== 0
}

function state(cabAngle: TruckAngle, trailerAngle: TruckAngle): PlayerTruckArticulation {
  return { cabYaw: cabAngle / 2, trailerYaw: trailerAngle / 2, cabAngle, trailerAngle }
}

function renderedPixels(articulation: PlayerTruckArticulation, braking: boolean): ReadonlyMap<string, string> {
  const pixels = new Map<string, string>()
  let fillStyle = ''
  const ctx = {
    get fillStyle() { return fillStyle },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) { fillStyle = String(value) },
    fillRect(x: number, y: number, width: number, height: number) {
      for (let py = y; py < y + height; py++) {
        for (let px = x; px < x + width; px++) pixels.set(`${px},${py}`, fillStyle)
      }
    },
  } as unknown as CanvasRenderingContext2D
  drawPlayerTruck(ctx, PLAYER_TRUCK_W / 2, PLAYER_TRUCK_H, articulation, braking)
  return pixels
}

function layersOf(pose: object): readonly PlayerTruckLayer[] {
  return Object.values(pose) as PlayerTruckLayer[]
}

describe('player road-train packed sprite data', () => {
  it('uses a 40x64 logical frame and only small Uint8Array bitmaps', () => {
    expect(PLAYER_TRUCK_W).toBe(40)
    expect(PLAYER_TRUCK_H).toBe(64)
    expect(PLAYER_TRUCK_ANGLES).toEqual([-2, -1, 0, 1, 2])

    for (const angle of PLAYER_TRUCK_ANGLES) {
      for (const layer of layersOf(PLAYER_TRUCK_POSES.cab[angle])) {
        expect(layer.bitmap.data).toBeInstanceOf(Uint8Array)
        expect(layer.bitmap.width % 8).toBe(0)
        expect(layer.bitmap.width).toBeLessThanOrEqual(PLAYER_TRUCK_LAYOUT.cab.width)
        expect(layer.bitmap.height).toBeLessThanOrEqual(PLAYER_TRUCK_LAYOUT.cab.height)
        expect(layer.x + layer.bitmap.width).toBeLessThanOrEqual(PLAYER_TRUCK_LAYOUT.cab.width)
        expect(layer.y + layer.bitmap.height).toBeLessThanOrEqual(PLAYER_TRUCK_LAYOUT.cab.height)
      }
      for (const layer of layersOf(PLAYER_TRUCK_POSES.trailer[angle])) {
        expect(layer.bitmap.data).toBeInstanceOf(Uint8Array)
        expect(layer.bitmap.width % 8).toBe(0)
        expect(layer.bitmap.width).toBeLessThanOrEqual(PLAYER_TRUCK_LAYOUT.trailer.width)
        expect(layer.bitmap.height).toBeLessThanOrEqual(PLAYER_TRUCK_LAYOUT.trailer.height)
        expect(layer.x + layer.bitmap.width).toBeLessThanOrEqual(PLAYER_TRUCK_LAYOUT.trailer.width)
        expect(layer.y + layer.bitmap.height).toBeLessThanOrEqual(PLAYER_TRUCK_LAYOUT.trailer.height)
      }
    }
  })

  it('derives both right-hand component poses by pixel-exact mirroring', () => {
    for (const [leftAngle, rightAngle] of [[-1, 1], [-2, 2]] as const) {
      for (const [kind, width] of [['cab', 24], ['trailer', 40]] as const) {
        const left = PLAYER_TRUCK_POSES[kind][leftAngle]
        const right = PLAYER_TRUCK_POSES[kind][rightAngle]
        for (const key of Object.keys(left) as Array<keyof typeof left>) {
          const leftLayer = left[key]
          const rightLayer = right[key]
          expect(rightLayer.x).toBe(width - leftLayer.x - leftLayer.bitmap.width)
          expect(rightLayer.y).toBe(leftLayer.y)
          expect(rightLayer.bitmap.data).toEqual(mirrorBitmap(leftLayer.bitmap).data)
        }
      }
    }
  })

  it('keeps all painted pixels inside the common frame', () => {
    for (const cabAngle of PLAYER_TRUCK_ANGLES) {
      for (const trailerAngle of PLAYER_TRUCK_ANGLES) {
        const pixels = renderedPixels(state(cabAngle, trailerAngle), false)
        expect(pixels.size).toBeGreaterThan(0)
        for (const key of pixels.keys()) {
          const [x, y] = key.split(',').map(Number)
          expect(x).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThan(PLAYER_TRUCK_W)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(y).toBeLessThan(PLAYER_TRUCK_H)
        }
      }
    }
  })

  it('reveals the red cab as a side wedge during transient and settled turns', () => {
    const straight = renderedPixels(state(0, 0), true)
    const enteringLeft = renderedPixels(state(-2, 0), true)
    const enteringRight = renderedPixels(state(2, 0), true)
    const settledLeft = renderedPixels(state(-2, -2), true)
    const settledRight = renderedPixels(state(2, 2), true)
    const countRed = (pixels: ReadonlyMap<string, string>) =>
      [...pixels.values()].filter((color) => color === C.RED).length

    expect(countRed(straight)).toBe(0)
    expect(countRed(enteringLeft)).toBeGreaterThan(10)
    expect(countRed(enteringRight)).toBe(countRed(enteringLeft))
    expect(countRed(settledLeft)).toBeGreaterThan(10)
    expect(countRed(settledRight)).toBe(countRed(settledLeft))
  })

  it('brightens only the two lamp masks when braking', () => {
    expect(PLAYER_TRUCK_LAMP_COLORS).toEqual({ rolling: C.RED, braking: C.B_RED })
    const rolling = renderedPixels(state(0, 0), false)
    const braking = renderedPixels(state(0, 0), true)
    const changed: string[] = []
    for (const [key, color] of braking) if (rolling.get(key) !== color) changed.push(key)
    expect(changed.length).toBeGreaterThan(0)
    for (const key of changed) {
      expect(rolling.get(key)).toBe(C.RED)
      expect(braking.get(key)).toBe(C.B_RED)
    }
  })
})

describe('player road-train articulation', () => {
  it('quantises symmetrically into exactly five angles and clamps input', () => {
    expect(quantizeTruckAngle(-9)).toBe(-2)
    expect(quantizeTruckAngle(-0.75)).toBe(-2)
    expect(quantizeTruckAngle(-0.25)).toBe(-1)
    expect(quantizeTruckAngle(0)).toBe(0)
    expect(quantizeTruckAngle(0.25)).toBe(1)
    expect(quantizeTruckAngle(0.75)).toBe(2)
    expect(quantizeTruckAngle(9)).toBe(2)
  })

  it('mutates one state while the cab responds before the trailer', () => {
    const articulation = createPlayerTruckArticulation()
    const returned = updatePlayerTruckArticulation(articulation, -1, 50)
    expect(returned).toBe(articulation)
    expect(articulation.cabYaw).toBeLessThan(articulation.trailerYaw)
    expect(articulation.cabAngle).toBe(-1)
    expect(articulation.trailerAngle).toBe(0)

    for (let i = 0; i < 30; i++) updatePlayerTruckArticulation(articulation, -1, 16)
    expect(articulation.cabAngle).toBe(-2)
    expect(articulation.trailerAngle).toBe(-2)
  })

  it('clamps dt to 50ms and ignores negative dt', () => {
    const a = createPlayerTruckArticulation()
    const b = createPlayerTruckArticulation()
    updatePlayerTruckArticulation(a, 1, 10_000)
    updatePlayerTruckArticulation(b, 1, 50)
    expect(a).toEqual(b)

    const before = { ...a }
    updatePlayerTruckArticulation(a, -1, -100)
    expect(a).toEqual(before)
  })
})

describe('player road-train collision and anchors', () => {
  it('precomputes all 25 compact bitmap and pixel-mask combinations', () => {
    expect(PLAYER_TRUCK_COLLISION_BITMAPS).toHaveLength(5)
    expect(PLAYER_TRUCK_COLLISION_MASKS).toHaveLength(5)
    for (let cab = 0; cab < 5; cab++) {
      expect(PLAYER_TRUCK_COLLISION_BITMAPS[cab]).toHaveLength(5)
      expect(PLAYER_TRUCK_COLLISION_MASKS[cab]).toHaveLength(5)
      for (let trailer = 0; trailer < 5; trailer++) {
        const bitmap = PLAYER_TRUCK_COLLISION_BITMAPS[cab]![trailer]!
        const mask = PLAYER_TRUCK_COLLISION_MASKS[cab]![trailer]!
        expect(bitmap.width).toBe(PLAYER_TRUCK_W)
        expect(bitmap.height).toBe(PLAYER_TRUCK_H)
        expect(bitmap.data).toBeInstanceOf(Uint8Array)
        expect(bitmap.data).toHaveLength((PLAYER_TRUCK_W / 8) * PLAYER_TRUCK_H)
        expect(mask.width).toBe(PLAYER_TRUCK_W)
        expect(mask.height).toBe(PLAYER_TRUCK_H)
        expect(mask.totalPixels).toBeGreaterThan(500)
      }
    }
  })

  it('builds every collision bitmap as the exact union of cab and trailer bases', () => {
    for (const cabAngle of PLAYER_TRUCK_ANGLES) {
      for (const trailerAngle of PLAYER_TRUCK_ANGLES) {
        const expected = new Set<string>()
        const add = (source: PlayerTruckLayer, ox: number, oy: number) => {
          for (let y = 0; y < source.bitmap.height; y++) {
            for (let x = 0; x < source.bitmap.width; x++) {
              if (bit(source.bitmap, x, y)) expected.add(`${ox + source.x + x},${oy + source.y + y}`)
            }
          }
        }
        add(
          PLAYER_TRUCK_POSES.cab[cabAngle].base,
          PLAYER_TRUCK_LAYOUT.cab.xByAngle[cabAngle],
          PLAYER_TRUCK_LAYOUT.cab.y,
        )
        add(
          PLAYER_TRUCK_POSES.trailer[trailerAngle].base,
          PLAYER_TRUCK_LAYOUT.trailer.x,
          PLAYER_TRUCK_LAYOUT.trailer.y,
        )

        const actual = getPlayerTruckCollisionBitmap(state(cabAngle, trailerAngle))
        for (let y = 0; y < PLAYER_TRUCK_H; y++) {
          for (let x = 0; x < PLAYER_TRUCK_W; x++) {
            expect(bit(actual, x, y), `${cabAngle}/${trailerAngle} at ${x},${y}`)
              .toBe(expected.has(`${x},${y}`))
          }
        }
        expect(getPlayerTruckCollisionBitmap(state(cabAngle, trailerAngle))).toBe(actual)
        expect(getPlayerTruckCollisionMask(state(cabAngle, trailerAngle)))
          .toBe(PLAYER_TRUCK_COLLISION_MASKS[cabAngle + 2]![trailerAngle + 2])
      }
    }
  })

  it('keeps two mirrored lamps and two lower wheel anchors in the frame', () => {
    for (const angle of PLAYER_TRUCK_ANGLES) {
      const lamps = getPlayerTruckLampPositions(state(0, angle))
      const wheels = getPlayerTruckWheelPositions(state(0, angle))
      expect(lamps).toHaveLength(2)
      expect(wheels).toHaveLength(2)
      expect(lamps[0]!.dx).toBeLessThan(PLAYER_TRUCK_W / 2)
      expect(lamps[1]!.dx).toBeGreaterThan(PLAYER_TRUCK_W / 2)
      for (const point of [...lamps, ...wheels]) {
        expect(point.dx).toBeGreaterThanOrEqual(0)
        expect(point.dx).toBeLessThan(PLAYER_TRUCK_W)
        expect(point.dy).toBeGreaterThan(PLAYER_TRUCK_H * 0.65)
        expect(point.dy).toBeLessThan(PLAYER_TRUCK_H)
      }
    }
    const left = getPlayerTruckLampPositions(state(0, -2))
    const right = getPlayerTruckLampPositions(state(0, 2))
    expect(PLAYER_TRUCK_W - left[0]!.dx).toBeCloseTo(right[1]!.dx)
    expect(PLAYER_TRUCK_W - left[1]!.dx).toBeCloseTo(right[0]!.dx)
  })
})
