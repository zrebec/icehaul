import { describe, it, expect } from 'vitest'
import { TRUCK_BMP_DATA, TRUCK_BMP_LEFT_DATA, TRUCK_BMP_RIGHT_DATA, TRUCK_BMP_W, TRUCK_BMP_H } from '../truck.ts'

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
