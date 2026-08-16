/**
 * The drawing rules the six traffic vehicles are held to.
 *
 * These are properties, not pixels. Nothing here says what a car looks like —
 * that is a judgement made by eye, and a snapshot of it would only ever get in
 * the way of the next redraw. What it does say is that whatever gets drawn is
 * symmetric, carries its lamps where the renderer and the player both expect
 * them, has road showing under it, and fits the box the projection was tuned
 * against. Every one of those is a defect the imported sprites actually had.
 */

import { describe, it, expect } from 'vitest'
import { getTrafficSpriteRows } from '../road3d.ts'
import {
  SAME_MINI_ROWS, ONCOMING_MINI_ROWS, SAME_CAR_ROWS, ONCOMING_CAR_ROWS,
  SAME_BUS_ROWS, ONCOMING_BUS_ROWS,
  SAME_MINI_COLORS, ONCOMING_MINI_COLORS, SAME_CAR_COLORS, ONCOMING_CAR_COLORS,
  SAME_BUS_COLORS, ONCOMING_BUS_COLORS,
  type RowColors,
} from '../sprites/vehicles.ts'
import type { VehicleType } from '../../game/traffic.ts'

const DIRS = ['same', 'oncoming'] as const
const TYPES: readonly VehicleType[] = ['mini', 'car', 'bus']

const SPRITES: readonly {
  name: string
  dir: 'same' | 'oncoming'
  rows: readonly string[]
  colors: RowColors
}[] = [
  { name: 'same mini', dir: 'same', rows: SAME_MINI_ROWS, colors: SAME_MINI_COLORS },
  { name: 'same car', dir: 'same', rows: SAME_CAR_ROWS, colors: SAME_CAR_COLORS },
  { name: 'same bus', dir: 'same', rows: SAME_BUS_ROWS, colors: SAME_BUS_COLORS },
  { name: 'oncoming mini', dir: 'oncoming', rows: ONCOMING_MINI_ROWS, colors: ONCOMING_MINI_COLORS },
  { name: 'oncoming car', dir: 'oncoming', rows: ONCOMING_CAR_ROWS, colors: ONCOMING_CAR_COLORS },
  { name: 'oncoming bus', dir: 'oncoming', rows: ONCOMING_BUS_ROWS, colors: ONCOMING_BUS_COLORS },
]

/** The size the projection, the LOD thresholds and the collision raster expect. */
const EXPECTED_SIZE: Record<VehicleType, readonly [number, number]> = {
  mini: [14, 11],
  car: [22, 15],
  bus: [28, 18],
}

describe('every vehicle is symmetric', () => {
  // The imported sprites were not, because block-density segmentation of an
  // image has no reason to be. At thirty meaningful pixels that reads as noise.
  it.each(SPRITES)('$name has a palindrome on every row', ({ rows }) => {
    for (const [i, row] of rows.entries()) {
      expect([...row].reverse().join(''), `row ${i}`).toBe(row)
    }
  })

  it.each(SPRITES)('$name is a rectangle', ({ rows }) => {
    const w = rows[0]!.length
    for (const [i, row] of rows.entries()) expect(row.length, `row ${i}`).toBe(w)
  })
})

describe('lamps say which way it is going', () => {
  // The one feature that carries direction. The imported car had them as a bar
  // across the middle, which is why the far tier had to re-add corner lamps —
  // and when the two tiers disagree about where lamps are, the art is wrong.
  it.each(SPRITES)('$name puts its lamps in the outermost columns', ({ rows, dir }) => {
    const lamp = dir === 'same' ? 'R' : 'Y'
    const lampRows = rows.filter(r => r.includes(lamp))
    expect(lampRows.length, 'no lamp row at all').toBeGreaterThan(0)

    for (const row of lampRows) {
      const first = row.search(/[^.]/)
      const last = row.length - 1 - [...row].reverse().join('').search(/[^.]/)
      // A lamp row must start and end in lamp colour: an interior lamp loses
      // its vote to bodywork the moment the sprite is resampled.
      expect(row[first], `left edge of "${row}"`).toBe(lamp)
      expect(row[last], `right edge of "${row}"`).toBe(lamp)
    }
  })

  it.each(SPRITES)('$name uses only its own direction\'s lamp colour', ({ rows, dir }) => {
    const wrong = dir === 'same' ? 'Y' : 'R'
    const body = rows.join('')
    if (dir === 'oncoming') {
      // Oncoming vehicles must never show red: red is "going away".
      expect(body).not.toContain(wrong)
    }
    // Same-direction vehicles may use Y for a number plate, which is not a lamp.
  })
})

describe('the wheels touch the road', () => {
  // The imported car's wheels were black patches embedded in bodywork — rows of
  // mixed B and X with no road showing — so it had no visible ground contact.
  // Note it *did* have one clean split row at the very bottom, which is why the
  // property that catches it is not "is there a gap somewhere" but "is there
  // anything except wheels below the bumper".
  const bumperRow = (rows: readonly string[]) => {
    let last = -1
    for (const [i, row] of rows.entries()) if (!row.includes('.')) last = i
    return last
  }

  it.each(SPRITES)('$name has a full-width bumper to hang them from', ({ rows }) => {
    expect(bumperRow(rows), 'no full-width row at all').toBeGreaterThanOrEqual(0)
  })

  it.each(SPRITES)('$name has nothing but wheels below the bumper', ({ rows }) => {
    const below = rows.slice(bumperRow(rows) + 1).filter(r => r.includes('B') || /[^.]/.test(r))
    expect(below.length, 'no rows below the bumper — the vehicle has no wheels').toBeGreaterThan(0)
    for (const row of below) {
      expect(row, `"${row}" below the bumper is not wheels`).toMatch(/^[B.]+$/)
    }
  })

  it.each(SPRITES)('$name shows road between its wheels', ({ rows }) => {
    const below = rows.slice(bumperRow(rows) + 1).filter(r => /[^.]/.test(r))
    for (const row of below) {
      const first = row.search(/[^.]/)
      const last = row.length - 1 - [...row].reverse().join('').search(/[^.]/)
      expect(row.slice(first, last + 1), `"${row}" is one solid block, not two wheels`)
        .toContain('.')
    }
  })
})

describe('the drawing and the colour map agree', () => {
  it.each(SPRITES)('$name defines a colour for every char it draws', ({ rows, colors }) => {
    for (const char of new Set(rows.join('').replace(/\./g, ''))) {
      expect(colors[char], `char "${char}" has no colour and would draw nothing`).toBeDefined()
    }
  })

  it.each(SPRITES)('$name defines the lamp colour the far tier writes', ({ colors, dir }) => {
    // `applyFarLamps` writes R (same) or Y (oncoming) into the resampled raster
    // whether or not the art itself uses that char. A missing key would silently
    // drop the far tier's only readable feature.
    expect(colors[dir === 'same' ? 'R' : 'Y']).toBeDefined()
  })
})

describe('the box the rest of the renderer was tuned against', () => {
  // Width and height are read straight off these tables — nothing declares them
  // separately — so they feed the projection, the LOD tier boundary and the
  // collision raster. Changing one is a gameplay change, not an art change.
  it.each(TYPES)('%s keeps its size in both directions', (type) => {
    const [w, h] = EXPECTED_SIZE[type]
    for (const dir of DIRS) {
      const rows = getTrafficSpriteRows(dir, type)
      expect(rows.length, `${dir} ${type} height`).toBe(h)
      expect(rows[0]!.length, `${dir} ${type} width`).toBe(w)
    }
  })

  it.each(TYPES)('%s ends on an empty row in both directions', (type) => {
    // The trailing empty row is part of the height the projection uses, so the
    // vehicle sits a scaled pixel clear of its anchor. Losing it would drop
    // every vehicle by that much.
    for (const dir of DIRS) {
      const rows = getTrafficSpriteRows(dir, type)
      expect(rows.at(-1), `${dir} ${type}`).toMatch(/^\.+$/)
    }
  })
})
