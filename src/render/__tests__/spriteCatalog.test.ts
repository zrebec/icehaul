import { C } from 'zx-kit'
import { describe, expect, it } from 'vitest'
import manifest from '../sprites/assets/manifest.json'
import {
  ROADSIDE_SPRITES,
  TRAFFIC_SPRITES,
  loadZxSprite,
  type LoadedZxSpriteAsset,
} from '../sprites/catalog.ts'

const ASCII_SYMBOL = /^[A-Za-z]$/

function usedPaletteNames(asset: LoadedZxSpriteAsset): Set<string> {
  return new Set(
    asset.rows.flatMap(row => [...row])
      .filter(symbol => symbol !== '.')
      .map(symbol => asset.legend[symbol]!),
  )
}

function localCellColourCounts(asset: LoadedZxSpriteAsset): number[] {
  const counts: number[] = []
  for (let y0 = 0; y0 < asset.h; y0 += 8) {
    for (let x0 = 0; x0 < asset.w; x0 += 8) {
      const colours = new Set<string>()
      for (let y = y0; y < Math.min(y0 + 8, asset.h); y++) {
        for (let x = x0; x < Math.min(x0 + 8, asset.w); x++) {
          const symbol = asset.rows[y]![x]!
          if (symbol !== '.') colours.add(asset.legend[symbol]!)
        }
      }
      counts.push(colours.size)
    }
  }
  return counts
}

describe('the runtime ZX sprite catalogue', () => {
  it('loads every manifest entry with its declared grid and exact ZX colours', () => {
    expect(manifest.count).toBe(33)
    expect(manifest.sprites).toHaveLength(33)
    expect(new Set(manifest.sprites.map(entry => entry.name)).size).toBe(33)
    expect(Object.keys(TRAFFIC_SPRITES)).toHaveLength(18)
    expect(Object.keys(ROADSIDE_SPRITES)).toHaveLength(15)

    const zxColours = new Set(Object.values(C))
    for (const entry of manifest.sprites) {
      const family = entry.family === 'traffic' ? TRAFFIC_SPRITES : ROADSIDE_SPRITES
      const asset = family[entry.name]

      expect(asset, `${entry.name} is missing`).toBeDefined()
      expect([asset!.w, asset!.h], `${entry.name} dimensions`).toEqual([entry.w, entry.h])
      expect(asset!.rows, `${entry.name} row count`).toHaveLength(entry.h)
      expect(asset!.rows.every(row => row.length === entry.w), `${entry.name} row width`).toBe(true)

      const usedSymbols = new Set(asset!.rows.join('').replaceAll('.', ''))
      for (const symbol of usedSymbols) {
        expect(symbol, `${entry.name} symbol`).toMatch(ASCII_SYMBOL)
        expect(asset!.legend[symbol], `${entry.name} legend for ${symbol}`).toBeDefined()
        expect(asset!.colors[symbol], `${entry.name} runtime colour for ${symbol}`).toBeDefined()
        expect(zxColours.has(asset!.colors[symbol]!), `${entry.name} exact ZX colour`).toBe(true)
      }
    }
  })

  it('keeps authored detail richer than a flattened two-colour cell export', () => {
    for (const entry of manifest.sprites) {
      if (entry.lod === 'far') continue
      const family = entry.family === 'traffic' ? TRAFFIC_SPRITES : ROADSIDE_SPRITES
      const asset = family[entry.name]!
      const minimumColours = entry.family === 'traffic'
        ? 5
        : entry.lod === 'near' ? 4 : 3

      expect(usedPaletteNames(asset).size, `${entry.name} palette richness`)
        .toBeGreaterThanOrEqual(minimumColours)

      const needsRichCell = entry.family === 'traffic' || entry.lod === 'near'
      if (needsRichCell) {
        expect(Math.max(...localCellColourCounts(asset)), `${entry.name} local cell richness`)
          .toBeGreaterThanOrEqual(3)
      }
    }
  })
})

describe('loadZxSprite', () => {
  const valid = {
    w: 2,
    h: 2,
    rows: ['X.', '.W'],
    legend: { X: 'C.BLACK', W: 'C.B_WHITE' },
  }

  it('maps validated palette names to runtime Spectrum colours', () => {
    const loaded = loadZxSprite(valid, 'fixture')
    expect(loaded.colors).toEqual({ X: C.BLACK, W: C.B_WHITE })
  })

  it.each([
    ['unknown palette name', { ...valid, legend: { X: 'C.INVISIBLE', W: 'C.B_WHITE' } }],
    ['missing legend symbol', { ...valid, legend: { X: 'C.BLACK' } }],
    ['non-ASCII grid symbol', { ...valid, rows: ['X.', '.1'] }],
    ['wrong row width', { ...valid, rows: ['X.', 'W'] }],
    ['wrong row count', { ...valid, rows: ['X.'] }],
  ])('rejects %s instead of silently loading it', (_case, payload) => {
    expect(() => loadZxSprite(payload, 'broken-fixture')).toThrow(/broken-fixture/)
  })
})
