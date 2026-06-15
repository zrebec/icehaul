/**
 * Roadside decoration generator — trees, lampposts, signs.
 * Purely visual, no collision. Deterministic from distance (hash-based).
 */

export type RoadsideType = 'deciduous' | 'conifer' | 'rocks' | 'lamp' | 'sign'

export interface RoadsideObject {
  distM: number
  side: -1 | 1       // -1 = left, +1 = right
  type: RoadsideType
  /** Distance from road edge in normalised units (0.1 = close, 0.4 = far). */
  offset: number
}

function hash(n: number): number {
  let x = (n + 0x9E3779B9) | 0
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B)
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35)
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000
}

/** Pick a scenery kind with variety: mostly trees, occasionally rocks. */
function sceneryKind(seed: number): RoadsideType {
  const r = hash(seed)
  return r < 0.55 ? 'deciduous' : r < 0.85 ? 'conifer' : 'rocks'
}

const TREE_SPACING = 60
const LAMP_SPACING = 180
const SIGN_SPACING = 400

/**
 * Returns all roadside objects visible in the given distance range.
 * Computed on the fly from deterministic hashes — no stored state.
 */
export function getRoadsideObjects(fromDist: number, toDist: number): RoadsideObject[] {
  const result: RoadsideObject[] = []

  // Trees — dense, alternating sides
  const treeStart = Math.floor(fromDist / TREE_SPACING)
  const treeEnd = Math.ceil(toDist / TREE_SPACING)
  for (let i = treeStart; i <= treeEnd; i++) {
    const d = i * TREE_SPACING + hash(i * 7) * 30
    if (d < fromDist || d > toDist) continue
    const side = hash(i * 13) < 0.5 ? -1 as const : 1 as const
    // offset = lateral distance beyond the road edge, in road-half-width units.
    // Squared hash biases most scenery near the shoulder, with the occasional
    // piece set well back in the field (perspective scales it correctly).
    result.push({ distM: d, side, type: sceneryKind(i * 17), offset: 0.15 + Math.pow(hash(i * 19), 2) * 2.4 })
    // Sometimes scenery on both sides
    if (hash(i * 23) < 0.3) {
      result.push({ distM: d + 5, side: (side * -1) as -1 | 1, type: sceneryKind(i * 31), offset: 0.25 + Math.pow(hash(i * 29), 2) * 1.8 })
    }
  }

  // Lampposts — both sides, evenly spaced
  const lampStart = Math.floor(fromDist / LAMP_SPACING)
  const lampEnd = Math.ceil(toDist / LAMP_SPACING)
  for (let i = lampStart; i <= lampEnd; i++) {
    const d = i * LAMP_SPACING
    if (d < fromDist || d > toDist) continue
    result.push({ distM: d, side: -1, type: 'lamp', offset: 0.08 })
    result.push({ distM: d, side: 1,  type: 'lamp', offset: 0.08 })
  }

  // Signs — occasional, one side
  const signStart = Math.floor(fromDist / SIGN_SPACING)
  const signEnd = Math.ceil(toDist / SIGN_SPACING)
  for (let i = signStart; i <= signEnd; i++) {
    const d = i * SIGN_SPACING + hash(i * 37) * 80
    if (d < fromDist || d > toDist) continue
    result.push({ distM: d, side: hash(i * 41) < 0.5 ? -1 : 1, type: 'sign', offset: 0.08 + hash(i * 43) * 0.3 })
  }

  return result
}
