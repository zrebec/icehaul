#!/usr/bin/env node
/**
 * How much of the picture actually changed — the measurement, not the opinion.
 *
 * Loads two URLs of the same scene, reads both canvases back pixel for pixel and
 * reports what moved: the share of pixels that differ at all, the mean change
 * across those pixels, and the largest single one. This is the shape the glow
 * work in `AGENTS.md` reports its numbers in, made repeatable so the next
 * question of the form "can you see it?" is answered the same way.
 *
 * Usage:
 *   node scripts/frame-delta.mjs "matrix=1&types=car&dist=220" trafficBrake=1
 *   node scripts/frame-delta.mjs "<base query>" "<extra params for the B frame>"
 *
 * The dev server must be running. Port matters: Ice Haul is often on 5174.
 *   ICEROADS_URL=http://127.0.0.1:5174/ node scripts/frame-delta.mjs ...
 *
 * **Judge brightness only with `scanlines=1` in the query.** The game lays a
 * 70%-black line over every odd device row, taking the whole picture to 0.65; a
 * bare sheet over-reads by 1.54x, and the first lamp glow was tuned on one.
 */
import puppeteer from 'puppeteer'

const BASE = process.env.ICEROADS_URL ?? 'http://localhost:5173/'
const QUERY = process.argv[2]
const EXTRA = process.argv[3]

if (!QUERY || !EXTRA) {
  console.error('usage: node scripts/frame-delta.mjs "<query>" "<extra params>"')
  process.exit(1)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function grab(page, url) {
  await page.goto(url, { waitUntil: 'networkidle0' })
  // The sheet is one static draw; "ready" means the canvas stopped being blank.
  for (let i = 0; i < 60; i++) {
    const painted = await page.evaluate(() => {
      const c = document.querySelector('#game')
      if (!c || c.width < 64) return false
      const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 64)).data
      for (let k = 0; k < d.length; k += 4) if (d[k] || d[k + 1] || d[k + 2]) return true
      return false
    })
    if (painted) break
    await sleep(100)
  }
  await sleep(150)
  return page.evaluate(() => {
    const c = document.querySelector('#game')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height)
    return { w: d.width, h: d.height, data: Array.from(d.data) }
  })
}

const browser = await puppeteer.launch({ headless: true })
try {
  const page = await browser.newPage()
  const a = await grab(page, `${BASE}?${QUERY}`)
  const b = await grab(page, `${BASE}?${QUERY}&${EXTRA}`)

  if (a.w !== b.w || a.h !== b.h) {
    console.error(`frames differ in size: ${a.w}x${a.h} vs ${b.w}x${b.h}`)
    process.exit(1)
  }

  let changed = 0
  let sum = 0
  let peak = 0
  const total = a.w * a.h
  for (let i = 0; i < a.data.length; i += 4) {
    // Summed across the three channels, as the glow tables in AGENTS.md report
    // it: the scale is 0-765 and a lone channel moving shows up honestly.
    const d = Math.abs(a.data[i] - b.data[i])
      + Math.abs(a.data[i + 1] - b.data[i + 1])
      + Math.abs(a.data[i + 2] - b.data[i + 2])
    if (d === 0) continue
    changed++
    sum += d
    if (d > peak) peak = d
  }

  const pct = (changed / total * 100).toFixed(2)
  const mean = changed > 0 ? (sum / changed).toFixed(1) : '0.0'
  console.log(`${a.w}x${a.h}  changed ${pct}% of pixels  ·  mean delta ${mean}  ·  peak ${peak} / 765`)
  if (changed === 0) console.log('  → the two frames are byte-identical')
} finally {
  await browser.close()
}
