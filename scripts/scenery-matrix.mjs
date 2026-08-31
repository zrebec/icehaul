#!/usr/bin/env node
/**
 * Roadside contact sheets through the production road and scenery renderer.
 *
 * Synthetic sheets isolate every type over a fixed depth ladder. Placement
 * sheets instead ask the real seeded generator for four windows into a route.
 * The dev server must be running (`npm run dev`).
 *
 * Usage:
 *   node scripts/scenery-matrix.mjs [outDir]
 *   node scripts/scenery-matrix.mjs out --only placement-42
 */
import puppeteer from 'puppeteer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.ICEROADS_URL ?? 'http://localhost:5174/'
const OUT_DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'matrix'
const onlyIndex = process.argv.indexOf('--only')
const ONLY = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null

const SHEETS = [
  { name: 'asphalt', params: { surface: 'asphalt', curve: 0, zoom: 1, scanlines: 1 } },
  { name: 'snow', params: { surface: 'snow', curve: 0, zoom: 1, scanlines: 1 } },
  { name: 'ice', params: { surface: 'ice', curve: 0, zoom: 1, scanlines: 1 } },
  { name: 'ice-curve', params: { surface: 'ice', curve: 2, zoom: 1, scanlines: 1 } },
  // Three representative tiers at 4x, kept to three columns so the output is
  // large enough to inspect pixels but still practical to open.
  {
    name: 'details-4x',
    params: { surface: 'ice', curve: 0, zoom: 4, dist: '50,20,3', scanlines: 1 },
  },
  // True generated placement: real bands, clusters, sign jitter, paired lamps,
  // road surface and curvature. These are not synthetic matrix objects.
  { name: 'placement-42', params: { placement: 42, zoom: 2, scanlines: 1 } },
  { name: 'placement-1443866', params: { placement: 1443866, zoom: 2, scanlines: 1 } },
]

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function waitForSheet(page) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const painted = await page.evaluate(() => {
      const canvas = document.querySelector('#game')
      if (!canvas || canvas.width < 64) return false
      const data = canvas.getContext('2d')
        .getImageData(0, 0, canvas.width, Math.min(canvas.height, 64)).data
      for (let index = 0; index < data.length; index += 4) {
        if (data[index] || data[index + 1] || data[index + 2]) return true
      }
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
  page.on('pageerror', error => errors.push(error.message))

  const sheets = ONLY ? SHEETS.filter(sheet => sheet.name === ONLY) : SHEETS
  if (sheets.length === 0) {
    console.error(`no sheet named "${ONLY}". Available: ${SHEETS.map(sheet => sheet.name).join(', ')}`)
    process.exit(1)
  }

  for (const sheet of sheets) {
    const query = new URLSearchParams({
      sceneryMatrix: '1',
      ...Object.fromEntries(Object.entries(sheet.params).map(([key, value]) => [key, String(value)])),
    })
    await page.goto(`${BASE}?${query}`, { waitUntil: 'networkidle0' })

    if (!await waitForSheet(page)) {
      console.error(`${sheet.name}: canvas stayed blank — the sheet did not render`)
      if (errors.length) console.error(errors.join('\n'))
      process.exit(1)
    }

    const { dataUrl, width, height } = await page.evaluate(() => {
      const canvas = document.querySelector('#game')
      return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
      }
    })
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64')
    const file = join(OUT_DIR, `scenery-${sheet.name}.png`)
    writeFileSync(file, buffer)
    console.log(`${file}  ${width}x${height}  ${(buffer.length / 1024).toFixed(0)} kB`)
  }

  if (errors.length) {
    console.error(`\npage errors:\n${errors.join('\n')}`)
    process.exit(1)
  }
} finally {
  await browser.close()
}
