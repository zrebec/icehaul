#!/usr/bin/env node
/**
 * Sprite import — converts an AI-drawn contact sheet (PNG) into zx-kit row-string
 * sprites (same format as the oncoming-traffic sprites in `render/road3d.ts`,
 * rendered via `drawScaledRows`).
 *
 * STANDARD (Ice Haul sprite import):
 *   - Source = a contact sheet laid out in a 2×2 grid of sprites on a black
 *     background. The drawing is AI-generated (imagegen), so it is imprecise and
 *     the visible 8×8 grid is DECORATIVE ONLY — we never align to it.
 *   - Each sprite's art blob is found per quadrant by block-density segmentation
 *     (robust to dithering, labels and dimension marks: the art is the largest
 *     connected blob; thin labels/ticks fall out as smaller blobs).
 *   - That blob is downsampled (area-average + transparency) to the target
 *     game-pixel size (multiple of 8, min 24), and each cell snapped to the 16
 *     zx-kit palette colours; near-black = transparent ('.').
 *   - Output = `src/render/sprites/<name>.ts` with `<NAME>_ROWS` / `<NAME>_COLORS`
 *     / `<NAME>_W` / `<NAME>_H`.
 *
 * Usage: node scripts/sprite-import.mjs [sheet.png] [--write]
 *   (no --write = dry run: prints geometry + ASCII preview only)
 */
import puppeteer from 'puppeteer'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const ARGS = process.argv.slice(2)
const WRITE = ARGS.includes('--write')
const SHEET = ARGS.find(a => !a.startsWith('--')) ?? 'docs/assets/decorations-v2.png'
const OUT_DIR = 'src/render/sprites'

// name, target game width/height (multiple of 8, ≥24), quadrant in the 2×2 sheet.
// Sizes are the intended sizes (from the sheet labels); the importer fits the
// detected art blob to them — they are easy to tweak if a sprite wants more room.
const EXPECTED = [
  { name: 'deciduous', gw: 40, gh: 56, quad: 'TL' },
  { name: 'conifer',   gw: 32, gh: 56, quad: 'TR' },
  { name: 'rocks',     gw: 40, gh: 24, quad: 'BL' },
  { name: 'signpost',  gw: 32, gh: 40, quad: 'BR' },
]

// zx-kit palette (normal 0xCD, bright 0xFF). char = row-string symbol, cname = the
// emitted `C.*` reference. BLACK is the transparent background ('.').
const PALETTE = [
  { name: 'BLACK',     rgb: [0x00, 0x00, 0x00], char: '.', cname: null, bg: true },
  { name: 'BLUE',      rgb: [0x00, 0x00, 0xCD], char: 'u', cname: 'C.BLUE' },
  { name: 'RED',       rgb: [0xCD, 0x00, 0x00], char: 'r', cname: 'C.RED' },
  { name: 'MAGENTA',   rgb: [0xCD, 0x00, 0xCD], char: 'm', cname: 'C.MAGENTA' },
  { name: 'GREEN',     rgb: [0x00, 0xCD, 0x00], char: 'g', cname: 'C.GREEN' },
  { name: 'CYAN',      rgb: [0x00, 0xCD, 0xCD], char: 'c', cname: 'C.CYAN' },
  { name: 'YELLOW',    rgb: [0xCD, 0xCD, 0x00], char: 'y', cname: 'C.YELLOW' },
  { name: 'WHITE',     rgb: [0xCD, 0xCD, 0xCD], char: 'w', cname: 'C.WHITE' },
  { name: 'B_BLUE',    rgb: [0x00, 0x00, 0xFF], char: 'U', cname: 'C.B_BLUE' },
  { name: 'B_RED',     rgb: [0xFF, 0x00, 0x00], char: 'R', cname: 'C.B_RED' },
  { name: 'B_MAGENTA', rgb: [0xFF, 0x00, 0xFF], char: 'M', cname: 'C.B_MAGENTA' },
  { name: 'B_GREEN',   rgb: [0x00, 0xFF, 0x00], char: 'G', cname: 'C.B_GREEN' },
  { name: 'B_CYAN',    rgb: [0x00, 0xFF, 0xFF], char: 'C', cname: 'C.B_CYAN' },
  { name: 'B_YELLOW',  rgb: [0xFF, 0xFF, 0x00], char: 'Y', cname: 'C.B_YELLOW' },
  { name: 'B_WHITE',   rgb: [0xFF, 0xFF, 0xFF], char: 'W', cname: 'C.B_WHITE' },
]

const pngB64 = readFileSync(SHEET).toString('base64')

const browser = await puppeteer.launch({ headless: true })
try {
  const page = await browser.newPage()
  const sprites = await page.evaluate(async (b64, EXPECTED, PALETTE) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const cv = document.createElement('canvas')
    cv.width = img.naturalWidth; cv.height = img.naturalHeight
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, 0, 0)
    const W = cv.width, H = cv.height
    const px = ctx.getImageData(0, 0, W, H).data
    const R = (x, y) => px[(y * W + x) * 4]
    const G = (x, y) => px[(y * W + x) * 4 + 1]
    const B = (x, y) => px[(y * W + x) * 4 + 2]
    const maxc = (x, y) => Math.max(R(x, y), G(x, y), B(x, y))
    const isContent = (x, y) => maxc(x, y) > 140   // strong colour = art (incl. dim red 0xCD)
    const isInk = (x, y) => maxc(x, y) > 70         // any real colour (excludes black bg + faint grid)

    const snap = (r, g, b) => {
      let best = PALETTE[0], bd = Infinity
      for (const p of PALETTE) {
        const dr = r - p.rgb[0], dg = g - p.rgb[1], db = b - p.rgb[2]
        const d = dr * dr + dg * dg + db * db
        if (d < bd) { bd = d; best = p }
      }
      return best
    }
    const quadBox = (quad) => ({
      x0: quad[1] === 'L' ? 0 : (W >> 1), y0: quad[0] === 'T' ? 0 : (H >> 1),
      x1: quad[1] === 'L' ? (W >> 1) : W, y1: quad[0] === 'T' ? (H >> 1) : H,
    })

    // Largest connected blob of "occupied" blocks in a quadrant (block-density
    // segmentation bridges dither gaps; thin labels/ticks are smaller blobs).
    const findBlob = (q) => {
      const BS = 12
      const bw = Math.ceil((q.x1 - q.x0) / BS), bh = Math.ceil((q.y1 - q.y0) / BS)
      const occ = new Uint8Array(bw * bh)
      for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
        let c = 0
        const px0 = q.x0 + bx * BS, py0 = q.y0 + by * BS
        for (let y = py0; y < Math.min(py0 + BS, q.y1); y++)
          for (let x = px0; x < Math.min(px0 + BS, q.x1); x++)
            if (isContent(x, y)) c++
        if (c >= 4) occ[by * bw + bx] = 1
      }
      const seen = new Uint8Array(bw * bh)
      let best = null, bestN = 0
      for (let s = 0; s < occ.length; s++) {
        if (!occ[s] || seen[s]) continue
        const stack = [s]; seen[s] = 1
        let n = 0, minx = bw, maxx = 0, miny = bh, maxy = 0
        while (stack.length) {
          const k = stack.pop(); n++
          const kx = k % bw, ky = (k / bw) | 0
          if (kx < minx) minx = kx; if (kx > maxx) maxx = kx
          if (ky < miny) miny = ky; if (ky > maxy) maxy = ky
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = kx + dx, ny = ky + dy
            if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue
            const nk = ny * bw + nx
            if (occ[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk) }
          }
        }
        if (n > bestN) { bestN = n; best = { minx, maxx, miny, maxy } }
      }
      if (!best) return null
      // Tighten the block bbox to exact content pixels.
      const rx0 = q.x0 + best.minx * BS, ry0 = q.y0 + best.miny * BS
      const rx1 = Math.min(q.x1, q.x0 + (best.maxx + 1) * BS), ry1 = Math.min(q.y1, q.y0 + (best.maxy + 1) * BS)
      let xL = rx1, xR = rx0, yT = ry1, yB = ry0
      for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) if (isContent(x, y)) {
        if (x < xL) xL = x; if (x > xR) xR = x; if (y < yT) yT = y; if (y > yB) yB = y
      }
      return { xL, xR, yT, yB }
    }

    const out = []
    for (const spec of EXPECTED) {
      const box = findBlob(quadBox(spec.quad))
      if (!box) { out.push({ ...spec, fail: true }); continue }
      const bw = box.xR - box.xL + 1, bh = box.yB - box.yT + 1
      const rows = [], usedChars = {}
      for (let gy = 0; gy < spec.gh; gy++) {
        let row = ''
        for (let gx = 0; gx < spec.gw; gx++) {
          // Source rect for this game-pixel cell; area-average the ink pixels.
          const sx0 = Math.floor(box.xL + gx / spec.gw * bw)
          const sx1 = Math.max(sx0 + 1, Math.floor(box.xL + (gx + 1) / spec.gw * bw))
          const sy0 = Math.floor(box.yT + gy / spec.gh * bh)
          const sy1 = Math.max(sy0 + 1, Math.floor(box.yT + (gy + 1) / spec.gh * bh))
          let rs = 0, gs = 0, bs = 0, ink = 0, total = 0
          for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) {
            total++
            if (isInk(x, y)) { rs += R(x, y); gs += G(x, y); bs += B(x, y); ink++ }
          }
          if (ink === 0 || ink / total < 0.34) { row += '.'; continue }
          const p = snap(rs / ink, gs / ink, bs / ink)
          row += p.bg ? '.' : p.char
          if (!p.bg) usedChars[p.char] = p.name
        }
        rows.push(row)
      }
      out.push({ ...spec, ...box, rows, usedChars })
    }
    return out
  }, pngB64, EXPECTED, PALETTE)

  mkdirSync(OUT_DIR, { recursive: true })
  for (const s of sprites) {
    console.log(`\n=== ${s.name} ${s.gw}×${s.gh} [${s.quad}] ===`)
    if (s.fail) { console.log('  !! no art blob found'); continue }
    console.log(`  art box x:${s.xL}-${s.xR} y:${s.yT}-${s.yB}`)
    console.log(`  colours: ${Object.entries(s.usedChars).map(([c, n]) => `${c}=${n}`).join(' ')}`)
    console.log(s.rows.map(r => '  ' + r).join('\n'))

    if (WRITE) {
      const charToCname = Object.fromEntries(PALETTE.map(p => [p.char, p.cname]))
      const used = Object.keys(s.usedChars).sort()
      const N = s.name.toUpperCase()
      const file = `// AUTO-GENERATED by scripts/sprite-import.mjs from ${SHEET} — do not edit by hand.
import { C, type SpectrumColor } from 'zx-kit'

export const ${N}_W = ${s.gw}
export const ${N}_H = ${s.gh}

export const ${N}_ROWS = [
${s.rows.map(r => `  '${r}',`).join('\n')}
] as const

export const ${N}_COLORS: Record<string, SpectrumColor> = {
${used.map(ch => `  ${ch}: ${charToCname[ch]},`).join('\n')}
}
`
      writeFileSync(`${OUT_DIR}/${s.name}.ts`, file)
      console.log(`  → wrote ${OUT_DIR}/${s.name}.ts`)
    }
  }
} finally {
  await browser.close()
}
