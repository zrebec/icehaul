#!/usr/bin/env node
/**
 * Where a frame actually goes — measured in the running game, not guessed.
 *
 * Drives the real page for a few seconds with the throttle held, and reports the
 * only three numbers that decide whether a 256x192 game has any business making
 * a fan spin: how long the frame callback takes, how many canvas draw calls it
 * makes, and whether the heap grows while it does.
 *
 * Usage:
 *   ICEROADS_URL=http://localhost:5174/ node scripts/frame-profile.mjs [seconds]
 */
import puppeteer from 'puppeteer'

const BASE = process.env.ICEROADS_URL ?? 'http://localhost:5173/'
const SECONDS = Number(process.argv[2] ?? 12)

const browser = await puppeteer.launch({ headless: true })
try {
  const page = await browser.newPage()

  // Counters installed before any game code runs.
  await page.evaluateOnNewDocument(() => {
    const w = window
    w.__prof = { frames: [], calls: {}, longest: 0 }
    const proto = CanvasRenderingContext2D.prototype
    for (const name of ['fillRect', 'drawImage', 'putImageData', 'getImageData', 'fillText', 'clearRect']) {
      const original = proto[name]
      proto[name] = function (...args) {
        w.__prof.calls[name] = (w.__prof.calls[name] ?? 0) + 1
        return original.apply(this, args)
      }
    }
    const raf = w.requestAnimationFrame.bind(w)
    w.requestAnimationFrame = (cb) => raf((t) => {
      const before = { ...w.__prof.calls }
      const t0 = performance.now()
      cb(t)
      const ms = performance.now() - t0
      const delta = {}
      for (const k of Object.keys(w.__prof.calls)) delta[k] = w.__prof.calls[k] - (before[k] ?? 0)
      w.__prof.frames.push({ ms, delta })
    })
  })

  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await page.evaluate(() => new Promise(r => setTimeout(r, 800)))

  // Dismiss the loading screen, then crank with a separate held ENTER so the
  // profile starts in the same state as a real run.
  await page.keyboard.press('Enter')
  await page.evaluate(() => new Promise(r => setTimeout(r, 150)))
  await page.keyboard.down('Enter')
  await page.evaluate(() => new Promise(r => setTimeout(r, 2200)))
  await page.keyboard.up('Enter')
  await page.keyboard.down('ArrowUp')

  const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)
  await page.evaluate(s => new Promise(r => setTimeout(r, s * 1000)), SECONDS)
  const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)
  await page.keyboard.up('ArrowUp')

  const out = await page.evaluate(() => {
    const f = window.__prof.frames.slice(-600)
    const ms = f.map(x => x.ms).sort((a, b) => a - b)
    const sum = (k) => f.reduce((a, x) => a + (x.delta[k] ?? 0), 0)
    const at = (p) => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))] ?? 0
    return {
      frames: f.length,
      mean: ms.reduce((a, b) => a + b, 0) / (ms.length || 1),
      p50: at(0.5), p95: at(0.95), max: ms[ms.length - 1] ?? 0,
      perFrame: Object.fromEntries(
        ['fillRect', 'drawImage', 'putImageData', 'getImageData', 'fillText', 'clearRect']
          .map(k => [k, +(sum(k) / (f.length || 1)).toFixed(1)]),
      ),
    }
  })

  console.log(`\nframes sampled: ${out.frames}`)
  console.log(`frame callback: mean ${out.mean.toFixed(2)} ms · p50 ${out.p50.toFixed(2)} · `
    + `p95 ${out.p95.toFixed(2)} · max ${out.max.toFixed(2)}   (16.7 ms is the budget at 60 fps)`)
  console.log('canvas calls per frame:', out.perFrame)
  if (heapBefore && heapAfter) {
    const growthKb = (heapAfter - heapBefore) / 1024
    console.log(`JS heap: ${(heapBefore / 1048576).toFixed(1)} MB -> ${(heapAfter / 1048576).toFixed(1)} MB`
      + `  (${growthKb >= 0 ? '+' : ''}${growthKb.toFixed(0)} KB over ${SECONDS}s)`)
  }
} finally {
  await browser.close()
}
