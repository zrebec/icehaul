#!/usr/bin/env node
/**
 * Drive-state screenshot — boots the page, holds ArrowUp + ArrowRight for a few
 * seconds so the truck accelerates and drifts, then captures the bitmap.
 *
 * Useful for verifying scrolling, surface transitions, and steering visuals.
 *
 * Usage: node scripts/drive-shot.mjs [out.png] [holdSeconds]
 */
import puppeteer from 'puppeteer'
import { writeFileSync } from 'node:fs'

const URL = process.env.ICEROADS_URL ?? 'http://localhost:5173/'
const OUT = process.argv[2] ?? 'drive.png'
const HOLD_S = Number(process.argv[3] ?? '3')

const browser = await puppeteer.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1024, deviceScaleFactor: 1 })
  await page.goto(URL, { waitUntil: 'networkidle0' })
  await page.click('canvas#game')  // unlocks audio context
  await new Promise(r => setTimeout(r, 500))
  await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)
    document.dispatchEvent(event)
  })
  await page.keyboard.press('Enter')
  await page.keyboard.press('s')
  await new Promise(r => setTimeout(r, 100))

  await page.keyboard.down('ArrowUp')
  await page.keyboard.down('ArrowRight')
  await new Promise(r => setTimeout(r, HOLD_S * 1000))
  await page.keyboard.up('ArrowRight')
  await page.keyboard.up('ArrowUp')
  // Settle one more frame
  await new Promise(r => setTimeout(r, 50))

  const dataUrl = await page.evaluate(() => {
    const c = document.querySelector('#game')
    return c ? c.toDataURL('image/png') : null
  })
  if (!dataUrl) throw new Error('No #game canvas')
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64')
  writeFileSync(OUT, buf)
  console.log(`saved ${OUT} (${buf.length} bytes), held ${HOLD_S}s`)
} finally {
  await browser.close()
}
