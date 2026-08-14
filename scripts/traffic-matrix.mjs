#!/usr/bin/env node
/**
 * Traffic contact sheets — the fixed comparison harness for renderer work.
 *
 * Step 0 of the graphics order in AGENTS.md. Captures the same frames before and
 * after a renderer change, so "does this look better" stops being an argument and
 * becomes a diff. Every sheet is one PNG: rows are type/direction, columns are the
 * distance ladder, and the cell is the road viewport at native size.
 *
 * By default it writes the set worth having: three surfaces straight, ice through
 * the sharpest bend, and a 4x zoom of ice for looking at actual pixels.
 *
 * Usage:
 *   node scripts/traffic-matrix.mjs [outDir]           # the default set
 *   node scripts/traffic-matrix.mjs out --only ice-4x  # one sheet by name
 *
 * The dev server must be running (npm run dev).
 */
import puppeteer from 'puppeteer'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.ICEROADS_URL ?? 'http://localhost:5173/'
const OUT_DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'matrix'
const onlyIdx = process.argv.indexOf('--only')
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null

/**
 * `curve: 2` is the sharpest the generator produces, and since hazards are
 * allowed to start inside a bend it is a real case rather than a stress test.
 */
const SHEETS = [
  { name: 'asphalt', params: { surface: 'asphalt', curve: 0, zoom: 1 } },
  { name: 'ice', params: { surface: 'ice', curve: 0, zoom: 1 } },
  { name: 'snow', params: { surface: 'snow', curve: 0, zoom: 1 } },
  { name: 'ice-curve', params: { surface: 'ice', curve: 2, zoom: 1 } },
  // Zoomed sheets are filtered on purpose: an unfiltered 4x sheet is over 7000 px
  // wide, which is not something anyone can actually look at.
  { name: 'car-4x', params: { surface: 'ice', curve: 0, zoom: 4, types: 'car', dist: '220,50,10,2' } },
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** The sheet is one static draw, so "ready" means the canvas stopped being blank. */
async function waitForSheet(page) {
  for (let i = 0; i < 60; i++) {
    const painted = await page.evaluate(() => {
      const c = document.querySelector('#game')
      if (!c || c.width < 64) return false
      const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 64)).data
      for (let k = 0; k < d.length; k += 4) if (d[k] || d[k + 1] || d[k + 2]) return true
      return false
    })
    if (painted) return true
    await sleep(100)
  }
  return false
}

mkdirSync(OUT_DIR, { recursive: true })

const browser = await puppeteer.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  const sheets = ONLY ? SHEETS.filter(s => s.name === ONLY) : SHEETS
  if (sheets.length === 0) {
    console.error(`no sheet named "${ONLY}". Available: ${SHEETS.map(s => s.name).join(', ')}`)
    process.exit(1)
  }

  for (const sheet of sheets) {
    const query = new URLSearchParams({ matrix: '1', ...Object.fromEntries(
      Object.entries(sheet.params).map(([k, v]) => [k, String(v)]),
    ) })
    await page.goto(`${BASE}?${query}`, { waitUntil: 'networkidle0' })

    if (!await waitForSheet(page)) {
      console.error(`${sheet.name}: canvas stayed blank — the sheet did not render`)
      if (errors.length) console.error(errors.join('\n'))
      process.exit(1)
    }

    const { dataUrl, w, h } = await page.evaluate(() => {
      const c = document.querySelector('#game')
      return { dataUrl: c.toDataURL('image/png'), w: c.width, h: c.height }
    })
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64')
    const file = join(OUT_DIR, `traffic-${sheet.name}.png`)
    writeFileSync(file, buf)
    console.log(`${file}  ${w}x${h}  ${(buf.length / 1024).toFixed(0)} kB`)
  }

  if (errors.length) {
    console.error(`\npage errors:\n${errors.join('\n')}`)
    process.exit(1)
  }
} finally {
  await browser.close()
}
