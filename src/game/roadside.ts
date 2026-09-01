/** Pure, route-seeded roadside layout. Decorations remain visual only. */

export type RoadsideType = 'deciduous' | 'conifer' | 'rocks' | 'lamp' | 'sign'
export type SceneryBand = 'verge' | 'field' | 'far'

export interface RoadsideObject {
  readonly distM: number
  readonly side: -1 | 1
  readonly type: RoadsideType
  readonly band: SceneryBand
  /** Lateral distance beyond the road edge, in road-half-width units. */
  readonly offsetRoadWidths: number
}

function hash(n: number): number {
  let x = (n + 0x9E3779B9) | 0
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B)
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35)
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000
}

/** Independent deterministic roll for an indexed object property. */
function roll(seed: number, index: number, salt: number): number {
  return hash((seed + Math.imul(index, salt)) | 0)
}

function naturalType(value: number): Exclude<RoadsideType, 'lamp' | 'sign'> {
  return value < 0.55 ? 'deciduous' : value < 0.85 ? 'conifer' : 'rocks'
}

const BAND_RANGE = {
  verge: [0.15, 0.55],
  field: [0.75, 1.60],
  far: [1.80, 3.00],
} as const satisfies Record<SceneryBand, readonly [number, number]>

function bandFor(value: number): SceneryBand {
  return value < 0.45 ? 'verge' : value < 0.80 ? 'field' : 'far'
}

function offsetInBand(band: SceneryBand, value: number): number {
  const [min, max] = BAND_RANGE[band]
  return min + (max - min) * value
}

const CLUSTER_SPACING_M = 120
const CLUSTER_JITTER_M = 30
const MEMBER_SPREAD_M = 25
const LAMP_SPACING_M = 180
const SIGN_SPACING_M = 400
const SIGN_JITTER_M = 80

function appendNaturalClusters(
  out: RoadsideObject[],
  seed: number,
  fromDist: number,
  toDist: number,
): void {
  const margin = CLUSTER_JITTER_M + MEMBER_SPREAD_M
  const start = Math.floor((fromDist - margin) / CLUSTER_SPACING_M - 0.5) - 1
  const end = Math.ceil((toDist + margin) / CLUSTER_SPACING_M - 0.5) + 1

  for (let cluster = start; cluster <= end; cluster++) {
    const centre = (cluster + 0.5) * CLUSTER_SPACING_M
      + (roll(seed, cluster, 0x45D9F3B) * 2 - 1) * CLUSTER_JITTER_M
    const count = 2 + Math.floor(roll(seed, cluster, 0x119DE1F3) * 3)
    const primarySide: -1 | 1 = roll(seed, cluster, 0x1B873593) < 0.5 ? -1 : 1

    for (let member = 0; member < count; member++) {
      const index = cluster * 4 + member
      const distM = centre + (roll(seed, index, 0x27D4EB2D) * 2 - 1) * MEMBER_SPREAD_M
      if (distM < fromDist || distM > toDist) continue

      const side = roll(seed, index, 0x165667B1) < 0.8
        ? primarySide
        : (primarySide * -1) as -1 | 1
      const band = bandFor(roll(seed, index, 0x7FEB352D))
      out.push({
        distM,
        side,
        type: naturalType(roll(seed, index, 0x6C8E9CF5)),
        band,
        offsetRoadWidths: offsetInBand(band, roll(seed, index, 0x2C1B3C6D)),
      })
    }
  }
}

function appendLamps(out: RoadsideObject[], fromDist: number, toDist: number): void {
  const start = Math.ceil(fromDist / LAMP_SPACING_M)
  const end = Math.floor(toDist / LAMP_SPACING_M)
  for (let index = start; index <= end; index++) {
    const distM = index * LAMP_SPACING_M
    out.push({ distM, side: -1, type: 'lamp', band: 'verge', offsetRoadWidths: 0.15 })
    out.push({ distM, side: 1, type: 'lamp', band: 'verge', offsetRoadWidths: 0.15 })
  }
}

function appendSigns(
  out: RoadsideObject[],
  seed: number,
  fromDist: number,
  toDist: number,
): void {
  const start = Math.floor((fromDist - SIGN_JITTER_M) / SIGN_SPACING_M - 0.5) - 1
  const end = Math.ceil((toDist + SIGN_JITTER_M) / SIGN_SPACING_M - 0.5) + 1
  for (let index = start; index <= end; index++) {
    const distM = (index + 0.5) * SIGN_SPACING_M
      + (roll(seed, index, 0x9E3779B1) * 2 - 1) * SIGN_JITTER_M
    if (distM < fromDist || distM > toDist) continue
    out.push({
      distM,
      side: roll(seed, index, 0x85EBCA77) < 0.5 ? -1 : 1,
      type: 'sign',
      band: 'verge',
      offsetRoadWidths: offsetInBand('verge', roll(seed, index, 0xC2B2AE3D)),
    })
  }
}

/**
 * Return every object in an inclusive distance window. The function stores no
 * cursor: asking for an overlapping window reproduces byte-identical objects.
 * `seed` is the dedicated scenery stream, `(gameSeed + 3) >>> 0` in the scene.
 */
export function getRoadsideObjects(
  seed: number,
  fromDist: number,
  toDist: number,
): RoadsideObject[] {
  if (!Number.isFinite(seed) || !Number.isFinite(fromDist) || !Number.isFinite(toDist)) return []
  if (toDist < fromDist) return []

  const from = Math.max(0, fromDist)
  const out: RoadsideObject[] = []
  appendNaturalClusters(out, seed >>> 0, from, toDist)
  appendLamps(out, from, toDist)
  appendSigns(out, seed >>> 0, from, toDist)

  const typeOrder: Record<RoadsideType, number> = {
    deciduous: 0, conifer: 1, rocks: 2, lamp: 3, sign: 4,
  }
  return out.sort((a, b) =>
    a.distM - b.distM
    || typeOrder[a.type] - typeOrder[b.type]
    || a.side - b.side
    || a.offsetRoadWidths - b.offsetRoadWidths)
}
