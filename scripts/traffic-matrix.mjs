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
  // The band where a bus used to overflow its lane. The standard ladder samples
  // 40-10 m at only one point, which is where the fault lived.
  {
    name: 'lane-fit',
    params: { surface: 'snow', curve: 0, zoom: 2, types: 'bus', dist: '100,60,40,25,15,10' },
  },
  // The old spawn position against the lane centre — same width, different
  // place, so it separates "drawn too wide" from "not in its lane".
  {
    name: 'lane-old-vs-new',
    params: { surface: 'snow', curve: 0, zoom: 2, types: 'bus', dirs: 'same', vx: 0.05, dist: '100,40,25,10' },
  },
  // The lamp bloom, on and off, over identical frames. Asphalt because a halo
  // shows least against a bright road and most against a dark one, and if it is
  // worth having it has to earn its keep on the surface that flatters it before
  // anything is claimed about the others. Zoom 2: a halo is a few pixels wide.
  //
  // `scanlines: 1` is not optional on these two. The game lays a 70% black grid
  // over every frame — two of the four device rows of each game pixel — so it
  // plays at 0.65 of what a bare sheet shows. The first glow pass was tuned on a
  // bare sheet and came out invisible in the game; that is the whole story.
  {
    name: 'glow-on',
    params: { surface: 'asphalt', curve: 0, zoom: 2, types: 'car', dist: '220,100,50,25,10', scanlines: 1 },
  },
  {
    name: 'glow-off',
    params: { surface: 'asphalt', curve: 0, zoom: 2, types: 'car', dist: '220,100,50,25,10', scanlines: 1, glow: 0 },
  },
  // The player's own brake lights, which no driving frame can show on demand:
  // the brake is carried entirely by the glow, so `?brake=1` is the only way to
  // put the two states side by side. One distant vehicle, because the subject is
  // the bottom of the frame.
  {
    name: 'brake-on',
    params: { surface: 'asphalt', curve: 0, zoom: 4, types: 'car', dirs: 'same', dist: '220', scanlines: 1, brake: 1 },
  },
  {
    name: 'brake-off',
    params: { surface: 'asphalt', curve: 0, zoom: 4, types: 'car', dirs: 'same', dist: '220', scanlines: 1 },
  },
  // Traffic braking, the same problem one vehicle further out. It only happens
  // when the road ahead gives a vehicle a reason, so no driving frame can be
  // relied on to contain it — `?trafficBrake=1` is the only way to put the two
  // states side by side.
  //
  // The bus is in these on purpose: its bodywork is `B_RED`, so it has no raster
  // brake at all and the halo is its entire signal. If a change ever makes the
  // bus's two states look alike again, it shows here first.
  {
    name: 'traffic-brake-on',
    params: {
      surface: 'asphalt', curve: 0, zoom: 2, types: 'car,bus', dirs: 'same',
      dist: '220,100,50,25', scanlines: 1, truck: 0, trafficBrake: 1,
    },
  },
  {
    name: 'traffic-brake-off',
    params: {
      surface: 'asphalt', curve: 0, zoom: 2, types: 'car,bus', dirs: 'same',
      dist: '220,100,50,25', scanlines: 1, truck: 0,
    },
  },
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
