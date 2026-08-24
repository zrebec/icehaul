#!/usr/bin/env node
/**
 * Drive-state screenshot — boots the page, starts the engine, accelerates in a
 * straight line, adds a short steer pulse for the lean, then captures the bitmap.
 *
 * Useful for verifying scrolling, road rendering and steering visuals.
 *
 * Scope: the run stays in 1st gear (~25 km/h ceiling), so it cannot reach the
 * first non-asphalt segment at START_ASPHALT_M = 1000 m. Capturing ice or a
 * surface transition would need clutch + upshift automation.
 *
 * The first Enter tap dismisses the loading screen. Ignition is deliberately a
 * separate held Enter: starting the engine needs CRANK_NEEDED_MS, and combining
 * the two inputs would make the harness depend on scene-transition timing.
 *
 * Usage: node scripts/drive-shot.mjs [out.png] [holdSeconds]
 */
import puppeteer from 'puppeteer'
import { writeFileSync } from 'node:fs'

const URL = process.env.ICEROADS_URL ?? 'http://localhost:5173/'
const OUT = process.argv[2] ?? 'drive.png'
const HOLD_S = Number(process.argv[3] ?? '3')

/**
 * Generously above CRANK_NEEDED_MS (1800) in src/config.ts.
 *
 * The margin has to be large, not tidy. The crank counts *game* dt, and main.ts
 * clamps dt to 50 ms per frame, so any frame longer than that is under-counted
 * and game time falls behind the wall clock — measured at ~10% behind on a
 * headless page still warming up. Release ENTER even slightly early and the
 * keyup handler resets the crank to zero, so the run silently starts over.
 */
const CRANK_HOLD_MS = 3500
/**
 * Fraction of sampled pixels that must change across MOVEMENT_WINDOW_MS.
 *
 * Low, because the bar is "did anything move at all", not "did it move a lot":
 * the run never leaves 1st gear, and 8 km/h over a second shifts the road only a
 * couple of metres. A parked truck measures 0.0% — the blinking HOLD ENTER text
 * is under 0.1% of sampled pixels — so the gap is still unambiguous.
 */
const MIN_FRAME_CHANGE = 0.005
const MOVEMENT_WINDOW_MS = 1000
/** How long ArrowRight is held, just before the capture. Short on purpose. */
const STEER_PULSE_MS = 300

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Coarse per-frame signature: one channel from every 64th pixel. */
async function frameSignature(page) {
  return page.evaluate(() => {
    const c = document.querySelector('#game')
    if (!c) return null
    const ctx = c.getContext('2d')
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    const sig = []
    for (let i = 0; i < data.length; i += 4 * 64) sig.push(data[i])
    return sig
  })
}

function changedFraction(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0
  let changed = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++
  return changed / a.length
}

const browser = await puppeteer.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1024, deviceScaleFactor: 1 })
  await page.goto(URL, { waitUntil: 'networkidle0' })
  await page.click('canvas#game') // unlocks the audio context
  await sleep(500)

  // Loading screen: one edge-triggered Enter press.
  await page.keyboard.press('Enter')
  await sleep(150)

  // Ignition: hold, do not tap. drive.ts needs both the keydown edge and a
  // sustained isHeld('Enter') from zx-kit's input map, which a real key gives.
  await page.keyboard.down('Enter')
  await sleep(CRANK_HOLD_MS)
  await page.keyboard.up('Enter')
  await sleep(150)

  // Accelerate in a straight line. Steering is NOT held throughout: lateral
  // authority barely scales with speed, so ArrowRight from a standstill walks the
  // truck off the road in under two seconds and the capture is of a wreck. The
  // old script held both keys for the whole run and would have hit this the
  // moment the ignition was fixed.
  await page.keyboard.down('ArrowUp')
  await sleep(Math.max(0, HOLD_S * 1000 - MOVEMENT_WINDOW_MS - STEER_PULSE_MS))

  // A short steer pulse just before the capture, for the lean/drift visual.
  await page.keyboard.down('ArrowRight')
  await sleep(STEER_PULSE_MS)
  await page.keyboard.up('ArrowRight')

  // Still under throttle: the frame must change across the window, or nothing moved.
  const before = await frameSignature(page)
  await sleep(MOVEMENT_WINDOW_MS)
  const after = await frameSignature(page)

  await page.keyboard.up('ArrowUp')
  await sleep(50) // settle one more frame

  const dataUrl = await page.evaluate(() => {
    const c = document.querySelector('#game')
    return c ? c.toDataURL('image/png') : null
  })
  if (!dataUrl) throw new Error('No #game canvas')
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64')
  writeFileSync(OUT, buf)

  const moved = changedFraction(before, after)
  if (moved < MIN_FRAME_CHANGE) {
    console.error(
      `saved ${OUT}, but only ${(moved * 100).toFixed(1)}% of sampled pixels changed ` +
      `over ${MOVEMENT_WINDOW_MS} ms of throttle — the engine almost certainly never started.`,
    )
    process.exit(1)
  }

  console.log(
    `saved ${OUT} (${buf.length} bytes), held ${HOLD_S}s, ` +
    `frame delta ${(moved * 100).toFixed(1)}%`,
  )
} finally {
  await browser.close()
}
