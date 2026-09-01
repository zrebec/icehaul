/**
 * The halo around a lamp — the only thing in this game that is allowed to be
 * brighter than the palette.
 *
 * ── Why lights, and only lights ─────────────────────────────────────────────
 * The road is driven at dusk, so a lamp is the one object in the frame that is
 * a *source* of light rather than a lit surface, and flat pixels cannot say so.
 * A halo can, and it costs nothing in the framebuffer: the emissive layer is a
 * separate canvas, blurred by being scaled down and back up, and blitted over
 * the finished frame with `'lighter'`. Not one game pixel changes colour.
 *
 * `AGENTS.md` set the limits before this was written and they are not
 * negotiable here: **glow only on lights, never the body** — bloom over a whole
 * vehicle is just a bigger blob, and at the horizon it welds two lamps into one
 * smear — one pass, downscale 2, alpha 0.2-0.35, radius from the vehicle's
 * height and hard-capped.
 *
 * ── Where the lamps are: read off the art, never declared ───────────────────
 * This module was planned around a hand-written table of lamp coordinates,
 * because the imported sprites used `Y` and `R` for bodywork as well as for
 * lamps — a same-direction bus is `B_RED` all over — so a rule that looked for
 * the colour would have lit the whole vehicle.
 *
 * All eighteen authored views follow two rules that make derivation exact:
 * lamps sit at the outer sides, and direction is carried by the lamp mark rather
 * than body colour. `R` going away and `Y` coming at you appear only where a
 * lamp is. A redraw therefore moves the halo with the lamp for free.
 *
 * Runtime positions are measured from the final resampled raster carried by the
 * projection. That same raster is drawn and collided, so a lamp moved by one
 * target pixel cannot leave its halo behind. `lampPairFor` exposes the equivalent
 * source-grid measurement for art contract tests.
 *
 * ── The halo is not the vehicle ─────────────────────────────────────────────
 * Same rule as the contour in `vehicleContour.ts`: decoration drawn around a
 * vehicle stays out of its raster. Here it falls out for free — the halo never
 * touches the raster at all, so no hitbox can grow a pixel because a light got
 * brighter.
 */

import {
  C, createGlowLayer, drawGlowSource, renderGlow,
  type GlowLayer, type GlowSource, type SpectrumColor,
} from 'zx-kit'
import {
  GAME_HEIGHT, GAME_WIDTH, VIEWPORT_HEIGHT, VIEWPORT_TOP,
  GLOW_ALPHA, GLOW_DOWNSCALE, GLOW_PASSES,
  GLOW_INTENSITY_TRAFFIC, GLOW_RADIUS_MAX, GLOW_RADIUS_MIN, GLOW_RADIUS_PER_HEIGHT,
  GLOW_CORE_INTENSITY, GLOW_CORE_MIN_HEIGHT,
  GLOW_CORE_RADIUS_MAX, GLOW_CORE_RADIUS_MIN, GLOW_CORE_RADIUS_PER_HEIGHT,
  GLOW_RADIUS_BRAKE_MULT, GLOW_BRAKE_PASSES,
} from '../config.ts'
import type { TrafficProjection } from './road3d.ts'
import { getTrafficSprite } from './sprites/catalog.ts'
import type { LodTier } from './vehicleLod.ts'
import type { TrafficDir, VehicleType } from '../game/traffic.ts'

/** A lamp's centre inside the sprite box, as a fraction of its width and height. */
export interface LampPosition {
  u: number
  v: number
}

/** Both lamps of one sprite, or `null` for a drawing that has none. */
export interface LampPair {
  left: LampPosition
  right: LampPosition
}

/** The char that means "lamp" for a direction. Nothing else in the art uses it. */
export function lampChar(dir: TrafficDir): string {
  return dir === 'oncoming' ? 'Y' : 'R'
}

/** Halo colour. Red is going away, yellow is coming at you — the same language
 *  the lamps themselves speak, so the halo cannot contradict the drawing. */
export function lampColor(dir: TrafficDir): SpectrumColor {
  return dir === 'oncoming' ? C.B_YELLOW : C.B_RED
}

/**
 * Where a sprite's two lamps sit, measured off its own pixels.
 *
 * Every cell of the direction's lamp char votes, and the two sides are split at
 * the sprite's centre line — which is exact rather than approximate, because the
 * redraw holds every row to a palindrome. A cluster's centroid is used rather
 * than its edge so that widening a lamp moves the halo to the middle of the new
 * lamp instead of leaving it on the old rim.
 *
 * Returns `null` when either side has no lamp at all: a drawing without lights
 * gets no halo rather than a halo in an invented place.
 */
export function findLampPair(rows: readonly string[], dir: TrafficDir): LampPair | null {
  const h = rows.length
  const w = rows[0]?.length ?? 0
  if (w === 0 || h === 0) return null

  const lamp = lampChar(dir)
  const mid = w / 2
  let lx = 0, ly = 0, ln = 0
  let rx = 0, ry = 0, rn = 0

  for (let y = 0; y < h; y++) {
    const row = rows[y]!
    for (let x = 0; x < w; x++) {
      if (row[x] !== lamp) continue
      // Cell centres, so a lamp one pixel wide is not reported at its left edge.
      if (x + 0.5 < mid) { lx += x + 0.5; ly += y + 0.5; ln++ } else { rx += x + 0.5; ry += y + 0.5; rn++ }
    }
  }
  if (ln === 0 || rn === 0) return null

  return {
    left: { u: lx / ln / w, v: ly / ln / h },
    right: { u: rx / rn / w, v: ry / rn / h },
  }
}

/** Measured once per sprite: the art cannot change while the game is running. */
const lampCache = new Map<string, LampPair | null>()

export function lampPairFor(dir: TrafficDir, type: VehicleType, lod: LodTier = 'mid'): LampPair | null {
  const key = `${dir}:${type}:${lod}`
  let hit = lampCache.get(key)
  if (hit === undefined) {
    hit = findLampPair(getTrafficSprite(dir, type, lod).rows, dir)
    lampCache.set(key, hit)
  }
  return hit
}

/**
 * Halo radius for a vehicle drawn `height` pixels tall.
 *
 * Tied to the vehicle so distance keeps reading, floored so it cannot vanish
 * inside a single blur cell, and capped so the last metres of an approaching bus
 * do not light half the viewport. `?glow=0.8,1.5` scales the result, because the
 * size of a bloom is judged by eye and a rebuild between two looks is how the
 * comparison gets lost.
 */
export function glowRadiusFor(height: number): number {
  const r = Math.min(GLOW_RADIUS_MAX, Math.max(GLOW_RADIUS_MIN, height * GLOW_RADIUS_PER_HEIGHT))
  return r * radiusScale
}

/** Radius of the white-hot core for a vehicle drawn `height` pixels tall. */
export function glowCoreRadiusFor(height: number): number {
  const r = Math.min(
    GLOW_CORE_RADIUS_MAX,
    Math.max(GLOW_CORE_RADIUS_MIN, height * GLOW_CORE_RADIUS_PER_HEIGHT),
  )
  return r * radiusScale
}

/**
 * Whether a vehicle this tall gets a core on top of its halo.
 *
 * The core is white, and white desaturates the halo it sits in. Far away that
 * halo's colour is the only thing carrying *which way the vehicle is going*, so
 * the core waits until the vehicle is close enough for its shape to say it —
 * see `GLOW_CORE_MIN_HEIGHT`.
 */
export function wantsGlowCore(height: number): boolean {
  return height >= GLOW_CORE_MIN_HEIGHT
}

/**
 * Append the lamp haloes of one drawn vehicle to `out` — two per vehicle, plus
 * a white core each once it is close enough to have earned one.
 *
 * Reads the projection's own `left`/`top`/`w`/`h` — the box the vehicle was
 * actually drawn into — so the halo is placed by the same numbers as the pixels
 * it belongs to and cannot drift from them.
 */
export function pushTrafficLampSpots(
  out: GlowSource[],
  p: TrafficProjection,
  dir: TrafficDir,
  braking = false,
): void {
  // Read the raster that was actually drawn. This keeps glow, collision and the
  // framebuffer on one answer even when resampling moves a lamp by a pixel.
  const lamps = findLampPair(p.raster, dir)
  if (!lamps) return

  // A braking vehicle's halo is wider and denser, and that is the whole signal.
  // The raster swap underneath it (RED -> B_RED) is invisible once the bloom is
  // on: `'lighter'` saturates the red channel either way, measured as a
  // byte-identical frame. See GLOW_RADIUS_BRAKE_MULT. Oncoming traffic never
  // brakes — its lamps face away from whatever it is doing.
  const lit = braking && dir === 'same'
  const radius = glowRadiusFor(p.h) * (lit ? GLOW_RADIUS_BRAKE_MULT : 1)
  const passes = lit ? GLOW_BRAKE_PASSES : 1
  const coreRadius = glowCoreRadiusFor(p.h)
  const core = wantsGlowCore(p.h)
  const color = lampColor(dir)

  for (const lamp of [lamps.left, lamps.right]) {
    const x = p.left + lamp.u * p.w
    const y = p.top + lamp.v * p.h
    for (let i = 0; i < passes; i++) {
      out.push({ x, y, radius, color, intensity: GLOW_INTENSITY_TRAFFIC })
    }
    // The core goes on top of the halo, not instead of it: the halo is the light
    // in the air, the core is the filament being too bright to have a colour.
    if (core) {
      out.push({ x, y, radius: coreRadius, color: C.B_WHITE, intensity: GLOW_CORE_INTENSITY })
    }
  }
}

// ── The layer, and the switch that decides whether it is ever used ──────────

let enabled = true
let alpha = GLOW_ALPHA
let radiusScale = 1
let layer: GlowLayer | null = null
let layerAlpha = alpha

/**
 * `?glow=0` off, `?glow=1` on, `?glow=0.5` on at that strength, `?glow=0.8,1.5`
 * also half again the radius — parsed in `debug/trafficMatrix.ts` beside the
 * other switches and applied once at boot.
 */
export function setGlowSettings(
  settings: { enabled: boolean; alpha: number; radiusScale?: number },
): void {
  enabled = settings.enabled
  alpha = settings.alpha
  radiusScale = settings.radiusScale ?? 1
}

export function isGlowEnabled(): boolean {
  return enabled
}

export function glowAlpha(): number {
  return alpha
}

export function glowRadiusScale(): number {
  return radiusScale
}

/** Cleared between tests so one case's layer cannot outlive its settings. */
export function resetGlowLayer(): void {
  layer = null
}

function getLayer(): GlowLayer | null {
  if (typeof document === 'undefined') return null
  if (!layer || layerAlpha !== alpha) {
    layer = createGlowLayer(GAME_WIDTH, GAME_HEIGHT, {
      downscale: GLOW_DOWNSCALE,
      passes: GLOW_PASSES,
      alpha,
    })
    layerAlpha = alpha
  }
  return layer
}

// ── The pending buffer: collected during the scene, blitted after scanlines ──
//
// The kit's advice is "after the scene, before scanlines", and that is what the
// first version did — with the result that the bloom sat *underneath* an overlay
// that takes two of every four device rows to 30% brightness. The whole picture
// plays at 0.65, and a bloom is exactly the thing that cannot afford it.
//
// So the scene no longer blits; it fills this buffer, and `main.ts` empties it
// after `drawScanlines`. Light belongs on the glass, in front of the mask, and
// the halo now fills the dark rows instead of being dimmed by them — which is
// also, conveniently, what a real CRT does when a phosphor is driven hard.

const pending: GlowSource[] = []

/** Emptied at the start of every scene render, so a paused or replaced scene
 *  cannot leave its lights burning over the next one. */
export function clearPendingGlow(): void {
  pending.length = 0
}

/** The buffer a scene fills. Handed out rather than copied — it is refilled
 *  every frame and must not allocate. */
export function pendingGlow(): GlowSource[] {
  return pending
}

/**
 * Blit everything collected this frame, then drop it. Called by `main.ts` after
 * the scenes, the UI and the scanlines — see the note above.
 */
export function renderPendingLampGlow(ctx: CanvasRenderingContext2D): void {
  renderLampGlow(ctx, pending)
  pending.length = 0
}

/**
 * Blit a given set of haloes over the finished frame.
 *
 * Clipped to the viewport on purpose: `renderGlow` blits the full canvas, and a
 * vehicle sitting just under the horizon would otherwise wash the status bar.
 * Instruments stay flat and readable whatever the road is doing.
 */
export function renderLampGlow(
  ctx: CanvasRenderingContext2D,
  spots: readonly GlowSource[],
): void {
  if (!enabled || spots.length === 0) return
  const glow = getLayer()
  if (!glow) return

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, VIEWPORT_TOP, GAME_WIDTH, VIEWPORT_HEIGHT)
  ctx.clip()
  renderGlow(glow, ctx, (g) => {
    for (const spot of spots) drawGlowSource(g, spot)
  })
  ctx.restore()
}
