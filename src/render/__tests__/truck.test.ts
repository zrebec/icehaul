import { describe, it, expect } from 'vitest'
import { TRUCK_BMP_DATA, TRUCK_BMP_W, TRUCK_BMP_H } from '../truck.ts'

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
