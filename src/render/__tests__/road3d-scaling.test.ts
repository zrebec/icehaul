import { describe, expect, it } from 'vitest'
import { scaleRoadsideRows } from '../road3d.ts'
import { resampleSpriteAtSpan } from '../spriteRaster.ts'

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

describe('resampleSpriteAtSpan', () => {
  it('makes source resolution irrelevant to the projected box and silhouette', () => {
    const oneX = [
      '.XX.',
      'XXXX',
      'X..X',
    ]
    const twoX = [
      '..XXXX..',
      '..XXXX..',
      'XXXXXXXX',
      'XXXXXXXX',
      'XX....XX',
      'XX....XX',
    ]

    const low = resampleSpriteAtSpan(oneX, 7.25, 5.5, 100, 80)
    const high = resampleSpriteAtSpan(twoX, 7.25, 5.5, 100, 80)

    expect(low).not.toBeNull()
    expect(high).toEqual(low)
    expect({ left: low!.left, top: low!.top, w: low!.w, h: low!.h })
      .toEqual({ left: 96, top: 74, w: 8, h: 6 })
  })
})
