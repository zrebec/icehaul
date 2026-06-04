import { describe, it, expect } from 'vitest'
import { TRUCK_BMP_DATA, TRUCK_BMP_LEFT_DATA, TRUCK_BMP_RIGHT_DATA, TRUCK_BMP_W, TRUCK_BMP_H } from '../truck.ts'

describe('truck bitmap exports', () => {
  it('dimensions match ZX Spectrum 8px multiples', () => {
    expect(TRUCK_BMP_W).toBe(24)
    expect(TRUCK_BMP_H).toBe(32)
    expect(TRUCK_BMP_W % 8).toBe(0)
  })

  it('data length matches width × height', () => {
    const expected = (TRUCK_BMP_W / 8) * TRUCK_BMP_H
    expect(TRUCK_BMP_DATA.length).toBe(expected)
  })

  it('is a Uint8Array', () => {
    expect(TRUCK_BMP_DATA).toBeInstanceOf(Uint8Array)
  })

  it('cab roof row 0 is narrow (only centre byte)', () => {
    expect(TRUCK_BMP_DATA[0]).toBe(0x00)
    expect(TRUCK_BMP_DATA[1]).toBe(0xFF)
    expect(TRUCK_BMP_DATA[2]).toBe(0x00)
  })

  it('full-width body rows have all bytes set', () => {
    const row8 = 8 * 3
    expect(TRUCK_BMP_DATA[row8]).toBe(0xFF)
    expect(TRUCK_BMP_DATA[row8 + 1]).toBe(0xFF)
    expect(TRUCK_BMP_DATA[row8 + 2]).toBe(0xFF)
  })

  it('ground clearance rows are empty', () => {
    const row30 = 30 * 3
    expect(TRUCK_BMP_DATA[row30]).toBe(0x00)
    expect(TRUCK_BMP_DATA[row30 + 1]).toBe(0x00)
    expect(TRUCK_BMP_DATA[row30 + 2]).toBe(0x00)
  })
})

describe('truck steering sprite variants', () => {
  const bpr = TRUCK_BMP_W / 8 // 3 bytes per row

  it('LEFT variant row 0 is shifted 2px left: [0x03, 0xFC, 0x00]', () => {
    // Base: ........XXXXXXXX........ → [0x00, 0xFF, 0x00]
    // Left: ......XXXXXXXX.......... → [0x03, 0xFC, 0x00]
    expect(TRUCK_BMP_LEFT_DATA[0]).toBe(0x03)
    expect(TRUCK_BMP_LEFT_DATA[1]).toBe(0xFC)
    expect(TRUCK_BMP_LEFT_DATA[2]).toBe(0x00)
  })

  it('RIGHT variant row 0 is shifted 2px right: [0x00, 0x3F, 0xC0]', () => {
    // Right: ..........XXXXXXXX...... → [0x00, 0x3F, 0xC0]
    expect(TRUCK_BMP_RIGHT_DATA[0]).toBe(0x00)
    expect(TRUCK_BMP_RIGHT_DATA[1]).toBe(0x3F)
    expect(TRUCK_BMP_RIGHT_DATA[2]).toBe(0xC0)
  })

  it('LEFT variant full-width body row 8 trims right edge: [0xFF, 0xFF, 0xFC]', () => {
    // Base row 8: XXXXXXXXXXXXXXXXXXXXXXXX → [0xFF, 0xFF, 0xFF]
    // Left shift: XXXXXXXXXXXXXXXXXXXXXX.. → [0xFF, 0xFF, 0xFC]
    const idx = 8 * bpr
    expect(TRUCK_BMP_LEFT_DATA[idx]).toBe(0xFF)
    expect(TRUCK_BMP_LEFT_DATA[idx + 1]).toBe(0xFF)
    expect(TRUCK_BMP_LEFT_DATA[idx + 2]).toBe(0xFC)
  })

  it('RIGHT variant full-width body row 8 trims left edge: [0x3F, 0xFF, 0xFF]', () => {
    // Right shift: ..XXXXXXXXXXXXXXXXXXXXXX → [0x3F, 0xFF, 0xFF]
    const idx = 8 * bpr
    expect(TRUCK_BMP_RIGHT_DATA[idx]).toBe(0x3F)
    expect(TRUCK_BMP_RIGHT_DATA[idx + 1]).toBe(0xFF)
    expect(TRUCK_BMP_RIGHT_DATA[idx + 2]).toBe(0xFF)
  })

  it('LEFT and RIGHT variants have same byte count as base', () => {
    expect(TRUCK_BMP_LEFT_DATA.length).toBe(TRUCK_BMP_DATA.length)
    expect(TRUCK_BMP_RIGHT_DATA.length).toBe(TRUCK_BMP_DATA.length)
  })
})
