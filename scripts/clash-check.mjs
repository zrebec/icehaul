#!/usr/bin/env node
/**
 * Attribute-clash validator for the title screen.
 *
 * The loading picture is hardware-valid by construction — it comes from a `.scr`,
 * and that format cannot express an invalid screen. **The menu drawn over it is
 * not.** Text at a coordinate that is not a multiple of 8, a line height that is
 * not 8, or an ink and paper from different brightness banks all put a third
 * colour into an 8×8 cell, and nothing in the type system catches any of them.
 *
 * So this checks the rendered frame rather than the source:
 *
 *   - every pixel is one of the 16 palette colours;
 *   - no 8×8 cell holds more than two distinct colours;
 *   - no cell mixes a BRIGHT colour with a normal one.
 *
 * Both cursor positions are captured, because the selected row uses `B_YELLOW`
 * from the bright bank while the others use `WHITE` from the normal one — a
 * mistake there would only show on one of the two frames.
 *
 * Prereq: dev server on http://localhost:5174/ (`npm run dev`).
 * Usage:  node scripts/clash-check.mjs [--save-frames]
 */
import puppeteer from 'puppeteer'
import { writeFileSync } from 'node:fs'

const URL = process.env.ICEROADS_URL ?? 'http://localhost:5174/'
const SAVE = process.argv.includes('--save-frames')

const PALETTE = new Map([
  ['0,0,0', 'BLACK'], ['0,0,205', 'BLUE'], ['205,0,0', 'RED'], ['205,0,205', 'MAGENTA'],
  ['0,205,0', 'GREEN'], ['0,205,205', 'CYAN'], ['205,205,0', 'YELLOW'], ['205,205,205', 'WHITE'],
  ['0,0,255', 'B_BLUE'], ['255,0,0', 'B_RED'], ['255,0,255', 'B_MAGENTA'], ['0,255,0', 'B_GREEN'],
  ['0,255,255', 'B_CYAN'], ['255,255,0', 'B_YELLOW'], ['255,255,255', 'B_WHITE'],
])
// Black is identical in both banks, so it never forces a bank and is excluded.
const BRIGHT = new Set(['B_BLUE', 'B_RED', 'B_MAGENTA', 'B_GREEN', 'B_CYAN', 'B_YELLOW', 'B_WHITE'])

/**
 * Reads the canvas back at one sample per game pixel.
 *
 * The sample must land on an **even** device row. `drawScanlines` paints 70% black
 * over every odd row, so an odd sample reports a blend of two palette entries and
 * every cell in the picture would come back as a clash — the overlay would be
 * measured instead of the game. Even rows are untouched by it.
 */
async function grabFrame(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#game')
    if (!canvas) return null
    const scale = canvas.width / 256
    const src = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    const out = new Array(256 * 192)
    for (let y = 0; y < 192; y++) {
      const block = y * scale
      const sy = block % 2 === 0 ? block : block + 1 // first unscanlined row of the block
      for (let x = 0; x < 256; x++) {
        const i = (sy * canvas.width + x * scale) * 4
        out[y * 256 + x] = `${src[i]},${src[i + 1]},${src[i + 2]}`
      }
    }
    return out
  })
}

function validate(pixels, label) {
  const offPalette = new Map()
  const clashCells = []
  const bankCells = []

  for (let cy = 0; cy < 24; cy++) {
    for (let cx = 0; cx < 32; cx++) {
      const colours = new Set()
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const rgb = pixels[(cy * 8 + py) * 256 + cx * 8 + px]
          colours.add(rgb)
          if (!PALETTE.has(rgb)) offPalette.set(rgb, (offPalette.get(rgb) ?? 0) + 1)
        }
      }
      if (colours.size > 2) clashCells.push([cx, cy, colours.size])
      const names = [...colours].map((c) => PALETTE.get(c)).filter(Boolean)
      const bright = names.filter((n) => BRIGHT.has(n))
      const normal = names.filter((n) => !BRIGHT.has(n) && n !== 'BLACK')
      if (bright.length > 0 && normal.length > 0) bankCells.push([cx, cy, names.join('+')])
    }
  }

  const ok = offPalette.size === 0 && clashCells.length === 0 && bankCells.length === 0
  console.log(`\n── ${label} ──`)
  console.log(`  off-palette pixels : ${[...offPalette.values()].reduce((a, b) => a + b, 0)}`)
  if (offPalette.size) console.log(`      ${[...offPalette.keys()].slice(0, 5).join('  ')}`)
  console.log(`  cells over 2 colours: ${clashCells.length}`)
  if (clashCells.length) console.log(`      ${JSON.stringify(clashCells.slice(0, 6))}`)
  console.log(`  cells mixing banks  : ${bankCells.length}`)
  if (bankCells.length) console.log(`      ${JSON.stringify(bankCells.slice(0, 6))}`)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}`)
  return ok
}

const browser = await puppeteer.launch({ headless: true })
let allOk = true
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1024, deviceScaleFactor: 1 })
  await page.goto(URL, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 400))

  // The cursor blinks on a 400 ms cycle, so two captures 400 ms apart land on
  // opposite halves of it and cover both the marker and the gap.
  for (const [label, waitMs] of [['cursor visible', 0], ['cursor hidden', 400]]) {
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs))
    const pixels = await grabFrame(page)
    if (!pixels) throw new Error(`No #game canvas at ${URL}`)
    if (!validate(pixels, label)) allOk = false
    if (SAVE) {
      const dataUrl = await page.evaluate(() => document.querySelector('#game').toDataURL('image/png'))
      const name = `clash-${label.replace(/\s+/g, '-')}.png`
      writeFileSync(name, Buffer.from(dataUrl.split(',')[1], 'base64'))
      console.log(`  saved ${name}`)
    }
  }
} finally {
  await browser.close()
}

console.log(allOk ? '\nTitle screen is hardware-valid.' : '\nTitle screen breaks the attribute rules.')
process.exit(allOk ? 0 : 1)
