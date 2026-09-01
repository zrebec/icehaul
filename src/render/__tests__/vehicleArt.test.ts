/** Structural contracts for the 18 authored traffic drawings. */

import { describe, expect, it } from 'vitest'
import { C } from 'zx-kit'
import { scaleRoadsideRows } from '../spriteRaster.ts'
import {
  getTrafficSprite, trafficSpriteName, TRAFFIC_SPRITES,
} from '../sprites/catalog.ts'
import type { LodTier } from '../vehicleLod.ts'
import type { TrafficDir, VehicleType } from '../../game/traffic.ts'

const DIRS: readonly TrafficDir[] = ['same', 'oncoming']
const TYPES: readonly VehicleType[] = ['mini', 'car', 'bus']
const TIERS: readonly LodTier[] = ['far', 'mid', 'near']

const EXPECTED_SIZE: Record<VehicleType, Record<LodTier, readonly [number, number]>> = {
  mini: { far: [7, 6], mid: [14, 11], near: [28, 22] },
  car: { far: [11, 8], mid: [22, 15], near: [44, 30] },
  bus: { far: [14, 9], mid: [28, 18], near: [56, 36] },
}

const CASES = DIRS.flatMap(dir => TYPES.flatMap(type => TIERS.map(lod => ({
  dir, type, lod, name: `${dir}/${type}/${lod}`,
}))))

describe('the authored grids agree with the renderer contract', () => {
  it.each(CASES)('$name is a symmetric rectangle at its declared resolution', ({ dir, type, lod }) => {
    const asset = TRAFFIC_SPRITES[trafficSpriteName(dir, type, lod)]!
    expect([asset.w, asset.h]).toEqual(EXPECTED_SIZE[type][lod])
    expect(asset.rows).toHaveLength(asset.h)
    for (const [index, row] of asset.rows.entries()) {
      expect(row, `row ${index} width`).toHaveLength(asset.w)
      expect([...row].reverse().join(''), `row ${index} symmetry`).toBe(row)
    }
  })

  it.each(CASES)('$name defines every colour it draws', ({ dir, type, lod }) => {
    const sprite = getTrafficSprite(dir, type, lod)
    for (const char of new Set(sprite.rows.join('').replace(/\./g, ''))) {
      expect(sprite.colors[char], `missing colour for ${char}`).toBeDefined()
    }
  })

  it.each(CASES)('$name ends on transparent ground with separated wheels above it', ({ dir, type, lod }) => {
    const rows = getTrafficSprite(dir, type, lod).rows
    expect(rows.at(-1)).toMatch(/^\.+$/)
    const wheelRow = rows.at(-2)!
    const left = wheelRow.search(/[^.]/)
    const right = wheelRow.length - 1 - [...wheelRow].reverse().join('').search(/[^.]/)
    expect(left, 'no wheel pixels').toBeGreaterThanOrEqual(0)
    expect(wheelRow.slice(left, right + 1), 'no road between the wheels').toContain('.')
  })
})

describe('direction and brake state live in the framebuffer', () => {
  it.each(CASES)('$name carries only the lamp for its view', ({ dir, type, lod }) => {
    const body = getTrafficSprite(dir, type, lod).rows.join('')
    const lamp = dir === 'same' ? 'R' : 'Y'
    expect(body).toContain(lamp)
    if (dir === 'oncoming') expect(body).not.toContain('R')
  })

  it.each(TYPES.flatMap(type => TIERS.map(lod => [type, lod] as const)))(
    '%s/%s brightens only rear R under braking', (type, lod) => {
      const rolling = getTrafficSprite('same', type, lod)
      const braking = getTrafficSprite('same', type, lod, true)
      expect(rolling.colors.R).toBe(C.RED)
      expect(braking.colors.R).toBe(C.B_RED)
      for (const char of Object.keys(rolling.colors)) {
        if (char !== 'R') expect(braking.colors[char]).toBe(rolling.colors[char])
      }
      expect(getTrafficSprite('oncoming', type, lod, true))
        .toBe(getTrafficSprite('oncoming', type, lod, false))
    },
  )

  it.each(TYPES.flatMap(type => (['mid', 'near'] as const).map(lod => [type, lod] as const)))(
    '%s/%s keeps a type-specific body colour', (type, lod) => {
      const expected = { mini: 'G', car: 'B', bus: 'M' }[type]
      for (const dir of DIRS) expect(getTrafficSprite(dir, type, lod).rows.join('')).toContain(expected)
    },
  )
})

/** Fill internal holes row-by-row: this test compares the outside contour only. */
function outerEnvelope(rows: readonly string[]): string[] {
  return rows.map(row => {
    const left = row.search(/[^.]/)
    if (left < 0) return row
    const right = row.length - 1 - [...row].reverse().join('').search(/[^.]/)
    return '.'.repeat(left) + 'X'.repeat(right - left + 1) + '.'.repeat(row.length - right - 1)
  })
}

function crop(rows: readonly string[]): string[] {
  let left = Infinity, right = -1, top = Infinity, bottom = -1
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y]!.length; x++) {
      if (rows[y]![x] === '.') continue
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
  }
  if (right < left) return []
  return rows.slice(top, bottom + 1).map(row => row.slice(left, right + 1))
}

function normalizedOuter(rows: readonly string[]): string[] {
  return scaleRoadsideRows(crop(outerEnvelope(rows)), 112, 72)
}

function silhouetteIou(a: readonly string[], b: readonly string[]): number {
  let intersection = 0, union = 0
  for (let y = 0; y < a.length; y++) {
    for (let x = 0; x < a[y]!.length; x++) {
      const solidA = a[y]![x] !== '.'
      const solidB = b[y]![x] !== '.'
      if (solidA && solidB) intersection++
      if (solidA || solidB) union++
    }
  }
  return union === 0 ? 1 : intersection / union
}

describe('a front view and a rear view are two drawings', () => {
  /**
   * The rule this holds is in `AGENTS.md`, and it was written because the
   * catalogue once broke it everywhere: the two views of a vehicle differed by
   * 2.5-4.5% of the grid at `mid` and `near`, all of it the lamp colour and one
   * band. Direction was carried by four pixels of colour on a tier that covers
   * most of an approach, on a game whose own record says brightness is
   * exhausted as a carrier and anything left has to be said with shape.
   *
   * Two clauses, and the second is the one that matters. A share alone could be
   * satisfied by making the lamps enormous, which would be the same mistake in
   * a larger font. Requiring a difference **outside the rows the lamps occupy**
   * is what forces the drawings to actually differ.
   */
  const MIN_VIEW_DIFFERENCE = 0.05

  function lampRows(rows: readonly string[], lamp: string): Set<number> {
    const hit = new Set<number>()
    rows.forEach((row, index) => { if (row.includes(lamp)) hit.add(index) })
    return hit
  }

  it.each(TYPES.flatMap(type => TIERS.map(lod => [type, lod] as const)))(
    '%s/%s differs between front and rear, and not only at the lamps', (type, lod) => {
      const rear = getTrafficSprite('same', type, lod).rows
      const front = getTrafficSprite('oncoming', type, lod).rows
      expect(front).toHaveLength(rear.length)

      const skip = new Set([...lampRows(rear, 'R'), ...lampRows(front, 'Y')])
      let differing = 0
      let outsideLampRows = 0
      let cells = 0

      for (let y = 0; y < rear.length; y++) {
        const a = rear[y]!, b = front[y]!
        for (let x = 0; x < a.length; x++) {
          cells++
          if (a[x] === b[x]) continue
          differing++
          if (!skip.has(y)) outsideLampRows++
        }
      }

      expect(differing / cells, `${type}/${lod} share of the grid that differs`)
        .toBeGreaterThanOrEqual(MIN_VIEW_DIFFERENCE)
      expect(outsideLampRows, `${type}/${lod} differences away from the lamp rows`)
        .toBeGreaterThan(0)
    },
  )
})

describe('adjacent LOD drawings hand over the same outer vehicle', () => {
  it.each(DIRS.flatMap(dir => TYPES.map(type => [dir, type] as const)))(
    '%s/%s has normalized silhouette IoU of at least 0.85', (dir, type) => {
      for (const [from, to] of [['far', 'mid'], ['mid', 'near']] as const) {
        const a = normalizedOuter(getTrafficSprite(dir, type, from).rows)
        const b = normalizedOuter(getTrafficSprite(dir, type, to).rows)
        expect(silhouetteIou(a, b), `${from} -> ${to}`).toBeGreaterThanOrEqual(0.85)
      }
    },
  )
})
