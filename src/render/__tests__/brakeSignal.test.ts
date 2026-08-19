/**
 * How much of a vehicle actually changes when it brakes.
 *
 * The brake is a raster change — `RED` → `B_RED` on the tail lamps — so the size
 * of the signal is exactly *how many cells hold lamp colour*, and that is a
 * number rather than an opinion. Fox, from the driving seat: "buď nevidím alebo
 * ide o LOD."
 *
 * Measured across the whole approach because the answer is not the same at both
 * ends: the far tier writes its own lamps onto the resampled sprite, the detail
 * tier inherits whatever survived the resample from the art.
 */

import { describe, it, expect } from 'vitest'
import { projectTrafficVehicle, getTrafficSpriteColors } from '../road3d.ts'
import { VIEWPORT_TOP, VIEWPORT_BOTTOM } from '../../config.ts'
import type { TrafficVehicle, VehicleType } from '../../game/traffic.ts'

const CAMERA = 1000
const TYPES: readonly VehicleType[] = ['mini', 'car', 'bus']

function vehicleAt(type: VehicleType, distanceM: number): TrafficVehicle {
  return {
    spawnDist: CAMERA + distanceM,
    distM: CAMERA + distanceM,
    x: 0.5,
    speed: 40,
    dir: 'same',
    type,
    gone: false,
  }
}

interface Signal {
  /** Cells whose colour differs between rolling and braking. */
  changed: number
  /** Cells the vehicle occupies at all. */
  solid: number
  w: number
  h: number
  lod: string
}

function signalAt(type: VehicleType, distanceM: number): Signal | null {
  const p = projectTrafficVehicle(
    VIEWPORT_TOP, VIEWPORT_BOTTOM, CAMERA, 0, vehicleAt(type, distanceM), () => 0,
  )
  if (!p) return null

  const rolling = getTrafficSpriteColors('same', type, false)
  const braking = getTrafficSpriteColors('same', type, true)

  let changed = 0
  let solid = 0
  for (const row of p.raster) {
    for (const cell of row) {
      if (cell === '.') continue
      solid++
      if (rolling[cell] !== braking[cell]) changed++
    }
  }
  return { changed, solid, w: p.w, h: p.h, lod: p.lod }
}

describe('the brake signal, measured across the approach', () => {
  const DISTANCES = [200, 150, 100, 70, 50, 35, 25, 15, 8, 3]

  it('prints how many cells the brake actually changes', () => {
    const lines: string[] = []
    for (const type of TYPES) {
      lines.push(`\n${type}`)
      lines.push(`  ${'dist'.padStart(5)} ${'size'.padStart(7)} ${'tier'.padStart(7)}`
        + ` ${'cells'.padStart(6)} ${'changed'.padStart(8)} ${'share'.padStart(7)}`)
      for (const d of DISTANCES) {
        const s = signalAt(type, d)
        if (!s) { lines.push(`  ${String(d).padStart(5)} — not drawn`); continue }
        const share = s.solid > 0 ? (s.changed / s.solid * 100).toFixed(1) : '0.0'
        lines.push(
          `  ${String(d).padStart(4)}m ${`${s.w}x${s.h}`.padStart(7)} ${s.lod.padStart(7)}`
          + ` ${String(s.solid).padStart(6)} ${String(s.changed).padStart(8)} ${`${share}%`.padStart(7)}`,
        )
      }
    }
    console.log(`\n═══ Cells that change when the brake comes on ═══${lines.join('\n')}`)
    expect(lines.length).toBeGreaterThan(0)
  })

  it('every same-direction vehicle can signal it, everywhere it is drawn', () => {
    // The bus is in this list as of 2026-08-19, and the reason it was not is the
    // whole point of the repaint: its bodywork was `B_RED`, so it was given no
    // brake state at all rather than a lamp nobody could see. This assertion was
    // its opposite — "the bus can never signal braking" — and it flipped the day
    // the body went yellow. A player stuck behind a bus, which is what Fox was,
    // now gets the same signal as behind anything else.
    for (const type of TYPES) {
      for (const d of DISTANCES) {
        const s = signalAt(type, d)
        if (!s) continue
        expect(s.changed, `${type} at ${d}m has no lamp cells`).toBeGreaterThan(0)
      }
    }
  })
})
