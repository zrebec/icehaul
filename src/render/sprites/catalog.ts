import { C } from 'zx-kit'
import type { SpectrumColor } from 'zx-kit'
import manifest from './assets/manifest.json'

export const ZX_COLOR_BY_NAME = {
  'C.BLACK': C.BLACK,
  'C.BLUE': C.BLUE,
  'C.RED': C.RED,
  'C.MAGENTA': C.MAGENTA,
  'C.GREEN': C.GREEN,
  'C.CYAN': C.CYAN,
  'C.YELLOW': C.YELLOW,
  'C.WHITE': C.WHITE,
  'C.B_BLACK': C.B_BLACK,
  'C.B_BLUE': C.B_BLUE,
  'C.B_RED': C.B_RED,
  'C.B_MAGENTA': C.B_MAGENTA,
  'C.B_GREEN': C.B_GREEN,
  'C.B_CYAN': C.B_CYAN,
  'C.B_YELLOW': C.B_YELLOW,
  'C.B_WHITE': C.B_WHITE,
} as const satisfies Readonly<Record<string, SpectrumColor>>

export type ZxColorName = keyof typeof ZX_COLOR_BY_NAME

export interface ZxSpriteAsset {
  readonly w: number
  readonly h: number
  readonly rows: readonly string[]
  readonly legend: Readonly<Record<string, ZxColorName>>
}

export interface LoadedZxSpriteAsset extends ZxSpriteAsset {
  readonly colors: Readonly<Record<string, SpectrumColor>>
}

const JSON_KEYS = ['h', 'legend', 'rows', 'w'] as const
const ASCII_SYMBOL = /^[A-Za-z]$/

function fail(name: string, reason: string): never {
  throw new Error(`${name}: ${reason}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isZxColorName(value: string): value is ZxColorName {
  return Object.hasOwn(ZX_COLOR_BY_NAME, value)
}

/**
 * Validate the portable JSON form and resolve its palette names for rendering.
 * This mirrors the bundled `zx_sprite.py` contract so malformed art fails at
 * startup instead of silently dropping a colour from the framebuffer.
 */
export function loadZxSprite(value: unknown, name = 'sprite'): LoadedZxSpriteAsset {
  if (!isRecord(value)) fail(name, 'expected a JSON object')

  const keys = Object.keys(value).sort()
  if (keys.length !== JSON_KEYS.length || keys.some((key, index) => key !== JSON_KEYS[index])) {
    fail(name, 'expected exactly {w,h,rows,legend}')
  }

  const { w, h, rows, legend } = value
  if (!Number.isInteger(w) || (w as number) < 1) fail(name, 'width must be a positive integer')
  if (!Number.isInteger(h) || (h as number) < 1) fail(name, 'height must be a positive integer')
  if (!Array.isArray(rows) || !rows.every(row => typeof row === 'string')) {
    fail(name, 'rows must be an array of strings')
  }
  if (rows.length !== h) fail(name, `expected ${String(h)} rows, got ${rows.length}`)
  if (!isRecord(legend) || Object.keys(legend).length === 0) {
    fail(name, 'legend must contain at least one mapping')
  }

  const typedLegend: Record<string, ZxColorName> = {}
  const colors: Record<string, SpectrumColor> = {}
  for (const [symbol, paletteName] of Object.entries(legend)) {
    if (!ASCII_SYMBOL.test(symbol)) fail(name, `legend symbol ${JSON.stringify(symbol)} must be one ASCII letter`)
    if (typeof paletteName !== 'string' || !isZxColorName(paletteName)) {
      fail(name, `unknown ZX palette name ${JSON.stringify(paletteName)}`)
    }
    typedLegend[symbol] = paletteName
    colors[symbol] = ZX_COLOR_BY_NAME[paletteName]
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!
    if (row.length !== w) fail(name, `row ${rowIndex + 1} must contain exactly ${String(w)} characters`)
    for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
      const symbol = row[columnIndex]!
      if (symbol === '.') continue
      if (!ASCII_SYMBOL.test(symbol)) {
        fail(name, `row ${rowIndex + 1}, column ${columnIndex + 1}: invalid symbol ${JSON.stringify(symbol)}`)
      }
      if (!Object.hasOwn(typedLegend, symbol)) {
        fail(name, `row ${rowIndex + 1}, column ${columnIndex + 1}: symbol ${symbol} is missing from the legend`)
      }
    }
  }

  return {
    w: w as number,
    h: h as number,
    rows: rows as string[],
    legend: typedLegend,
    colors,
  }
}

const rawModules: Record<string, unknown> = import.meta.glob(
  './assets/{traffic,roadside}/*.json',
  { eager: true, import: 'default' },
)

const trafficSprites: Record<string, LoadedZxSpriteAsset> = {}
const roadsideSprites: Record<string, LoadedZxSpriteAsset> = {}
const names = new Set<string>()

if (manifest.count !== manifest.sprites.length) {
  fail('sprite manifest', `declares ${manifest.count} sprites but lists ${manifest.sprites.length}`)
}
if (Object.keys(rawModules).length !== manifest.count) {
  fail('sprite manifest', `lists ${manifest.count} sprites but found ${Object.keys(rawModules).length} JSON assets`)
}

for (const entry of manifest.sprites) {
  if (names.has(entry.name)) fail('sprite manifest', `duplicate name ${entry.name}`)
  names.add(entry.name)

  const modulePath = `./assets/${entry.files.json}`
  const raw = rawModules[modulePath]
  if (raw === undefined) fail(entry.name, `missing ${entry.files.json}`)

  const loaded = loadZxSprite(raw, entry.name)
  if (loaded.w !== entry.w || loaded.h !== entry.h) {
    fail(entry.name, `manifest says ${entry.w}x${entry.h}, JSON says ${loaded.w}x${loaded.h}`)
  }

  if (entry.family === 'traffic') trafficSprites[entry.name] = loaded
  else if (entry.family === 'roadside') roadsideSprites[entry.name] = loaded
  else fail(entry.name, `unknown family ${entry.family}`)
}

export const TRAFFIC_SPRITES: Readonly<Record<string, LoadedZxSpriteAsset>> = Object.freeze(trafficSprites)
export const ROADSIDE_SPRITES: Readonly<Record<string, LoadedZxSpriteAsset>> = Object.freeze(roadsideSprites)
