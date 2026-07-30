import { describe, expect, it } from 'vitest'
import { scaleRoadsideRows } from '../road3d.ts'

describe('scaleRoadsideRows', () => {
  it('preserves transparent gaps when reducing a sprite', () => {
    const rows = [
      'GG..GG',
      'GG..GG',
      'GG..GG',
      'GG..GG',
    ]

    expect(scaleRoadsideRows(rows, 3, 2)).toEqual([
      'G.G',
      'G.G',
    ])
  })

  it('keeps a visible coloured feature above the coverage threshold', () => {
    expect(scaleRoadsideRows(['G.'], 1, 1)).toEqual(['G'])
  })

  it('drops isolated noise below the coverage threshold', () => {
    expect(scaleRoadsideRows([
      'G....',
      '.....',
      '.....',
      '.....',
      '.....',
    ], 1, 1)).toEqual(['.'])
  })

  it('keeps nearest source pixels when enlarging', () => {
    expect(scaleRoadsideRows(['G.'], 4, 2)).toEqual([
      'GG..',
      'GG..',
    ])
  })
})
