import { describe, expect, it } from 'vitest'
import { getRoadsideObjects, type RoadsideObject, type SceneryBand } from '../roadside.ts'

const SEED = (42 + 3) >>> 0

const key = (object: RoadsideObject): string => [
  object.distM.toFixed(9), object.side, object.type, object.band,
  object.offsetRoadWidths.toFixed(9),
].join(':')

describe('seeded roadside scenery', () => {
  it('repeats the same route and changes with a different stream seed', () => {
    const a = getRoadsideObjects(SEED, 0, 5000)
    expect(getRoadsideObjects(SEED, 0, 5000)).toEqual(a)
    expect(getRoadsideObjects(SEED + 1, 0, 5000)).not.toEqual(a)
  })

  it('returns the same objects from overlapping query windows', () => {
    const whole = getRoadsideObjects(SEED, 0, 5000)
    const slice = getRoadsideObjects(SEED, 1375, 2840)
    expect(slice).toEqual(whole.filter(object => object.distM >= 1375 && object.distM <= 2840))
  })

  it('never emits the same object twice', () => {
    const objects = getRoadsideObjects(SEED, 0, 20_000)
    expect(new Set(objects.map(key)).size).toBe(objects.length)
  })
})

describe('natural clusters', () => {
  const natural = (seed: number, km = 5) =>
    getRoadsideObjects(seed, 0, km * 1000).filter(object =>
      object.type === 'deciduous' || object.type === 'conifer' || object.type === 'rocks')

  it('shows both sides and all three lateral bands in the first 5 km', () => {
    const objects = natural(SEED)
    expect(new Set(objects.map(object => object.side))).toEqual(new Set([-1, 1]))
    expect(new Set(objects.map(object => object.band))).toEqual(new Set<SceneryBand>(['verge', 'field', 'far']))
  })

  it('keeps natural density between 20 and 32 objects per kilometre', () => {
    for (const routeSeed of [0, 1, 42, 1443866, 0xFFFFFFFF]) {
      const perKm = natural((routeSeed + 3) >>> 0, 20).length / 20
      expect(perKm, `route seed ${routeSeed}`).toBeGreaterThanOrEqual(20)
      expect(perKm, `route seed ${routeSeed}`).toBeLessThanOrEqual(32)
    }
  })

  it('uses the specified type and band weights over a long route', () => {
    const objects = natural(SEED, 100)
    const share = (predicate: (object: RoadsideObject) => boolean) =>
      objects.filter(predicate).length / objects.length

    expect(share(object => object.type === 'deciduous')).toBeCloseTo(0.55, 1)
    expect(share(object => object.type === 'conifer')).toBeCloseTo(0.30, 1)
    expect(share(object => object.type === 'rocks')).toBeCloseTo(0.15, 1)
    expect(share(object => object.band === 'verge')).toBeCloseTo(0.45, 1)
    expect(share(object => object.band === 'field')).toBeCloseTo(0.35, 1)
    expect(share(object => object.band === 'far')).toBeCloseTo(0.20, 1)
  })

  it('places every natural object inside its band', () => {
    const range: Record<SceneryBand, readonly [number, number]> = {
      verge: [0.15, 0.55], field: [0.75, 1.60], far: [1.80, 3.00],
    }
    for (const object of natural(SEED, 20)) {
      const [min, max] = range[object.band]
      expect(object.offsetRoadWidths, key(object)).toBeGreaterThanOrEqual(min)
      expect(object.offsetRoadWidths, key(object)).toBeLessThanOrEqual(max)
    }
  })
})

describe('functional roadside objects', () => {
  const objects = getRoadsideObjects(SEED, 0, 5000)

  it('keeps every lamp and sign in the verge band', () => {
    const functional = objects.filter(object => object.type === 'lamp' || object.type === 'sign')
    expect(functional.length).toBeGreaterThan(0)
    expect(functional.every(object => object.band === 'verge')).toBe(true)
    expect(functional.every(object => object.offsetRoadWidths >= 0.15 && object.offsetRoadWidths <= 0.55)).toBe(true)
  })

  it('places lamps as left/right pairs every 180 metres', () => {
    const lamps = objects.filter(object => object.type === 'lamp')
    const byDistance = new Map<number, RoadsideObject[]>()
    for (const lamp of lamps) {
      const pair = byDistance.get(lamp.distM) ?? []
      pair.push(lamp)
      byDistance.set(lamp.distM, pair)
    }
    expect(byDistance.size).toBeGreaterThan(20)
    for (const [distance, pair] of byDistance) {
      expect(distance % 180).toBe(0)
      expect(pair.map(lamp => lamp.side).sort()).toEqual([-1, 1])
    }
  })

  it('seeds sign jitter, side, and verge offset independently of the lamp grid', () => {
    const signs = objects.filter(object => object.type === 'sign')
    expect(signs.length).toBeGreaterThan(8)
    expect(new Set(signs.map(sign => sign.side))).toEqual(new Set([-1, 1]))
    expect(new Set(signs.map(sign => sign.offsetRoadWidths.toFixed(3))).size).toBeGreaterThan(5)
    expect(signs.some(sign => sign.distM % 400 !== 0)).toBe(true)
  })
})
