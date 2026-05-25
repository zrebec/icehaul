#!/usr/bin/env node
/**
 * Headless-Chrome capture of the running dev server.
 * Saves the canvas bitmap at its native 1280×960 resolution so what we see
 * matches game pixels 1:1.
 *
 * Prereq: dev server must be running on http://localhost:5173/.
 * Usage:  node scripts/screenshot.mjs [out.png]
 */
import puppeteer from 'puppeteer'
import { writeFileSync } from 'node:fs'

const URL = process.env.ICEROADS_URL ?? 'http://localhost:5173/'
const OUT = process.argv[2] ?? 'screenshot.png'

const browser = await puppeteer.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1024, deviceScaleFactor: 1 })
  await page.goto(URL, { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 250))

  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector('#game')
    return canvas ? canvas.toDataURL('image/png') : null
  })
  if (!dataUrl) throw new Error('No #game canvas found at ' + URL)

  const buf = Buffer.from(dataUrl.split(',')[1], 'base64')
  writeFileSync(OUT, buf)
  console.log(`saved ${OUT} (${buf.length} bytes)`)
} finally {
  await browser.close()
}
