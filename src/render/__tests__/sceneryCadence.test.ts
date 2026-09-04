/**
 * The guards roadside scenery did not have.
 *
 * Traffic has three: silhouette IoU across a handover, a box and ground anchor
 * that may not move more than a pixel, and a ceiling on how long one drawing
 * may be held. Scenery had none — and it switches tier at 78.9 m and 22.5 m, on
 * both sides of the road, for the whole drive. Nothing measured it, which meant
 * an art change to a tree could quietly cost what an art change to a vehicle
 * could not.
 *
 * Everything here comes off `walkSceneryApproach`, the same machinery traffic
 * uses, so the two can never disagree about what an approach was. The object
 * stands still and the camera drives, which is the real motion.
 *
 * Only one side is walked. `side` reaches the raster through nothing but
 * `anchorX`, so it moves the drawing across the screen and cannot change what
 * the drawing is.
 *
 * ── Two things the first measurement found ─────────────────────────────────
 * **Scenery hands over for free**, which is stronger than traffic manages. At
 * both boundaries the box and the ground anchor move by *exactly* zero pixels
 * for all five types, where traffic is only held to within one. So the
 * assertion below is `0` rather than `<= 1`: it is what the code does, and
 * writing the weaker number would licence a regression nobody would see.
 *
 * **`rocks` freezes for 1.83 s**, the worst in the set and the same figure the
 * mini reaches — for the same reason, recorded in AGENTS.md as the floor. Its
 * `far` grid is 8 x 5 and projects to a 4 x 2 box, the flattest in the game;
 * a box that small has nothing left to draw differently while its true size
 * grows by a tenth of a pixel. It is not an art defect and it is not fixable
 * by drawing.
 */

import { describe, it, expect } from 'vitest'
import { FPS, SCENERY_TYPES, freezeRuns, walkSceneryApproach } from './approachWalk.ts'

/**
 * The longest a roadside object may hold one drawing, in seconds.
 *
 * Not borrowed from traffic's budget. It is the same rule — measured worst case
 * plus headroom — applied to scenery's own numbers, and it lands in the same
 * place because both worst cases are the same floor rather than the same
 * tuning. Measured at 60 km/h: rocks 1.83 s, sign 1.25 s, lamp 1.22 s,
 * deciduous and conifer 0.88 s.
 */
const MAX_FREEZE_S = 2.0

describe('what changes as a roadside object is driven past', () => {
  it('prints the scenery profile', () => {
    console.log(`\n  longest run of frames holding one drawing, at 60 km/h closing`)
    for (const type of SCENERY_TYPES) {
      const frames = walkSceneryApproach(type)
      const runs = freezeRuns(frames)
      const worst = Math.max(...runs)
      let index = 0
      for (const run of runs) {
        if (run === worst) break
        index += run
      }
      const perTier = (tier: string) => {
        const tierRuns = freezeRuns(frames.filter(f => f.lod === tier))
        return tierRuns.length ? Math.max(...tierRuns) : 0
      }
      console.log(
        `    ${type.padEnd(10)} ${runs.length - 1} changes / ${frames.length} frames` +
        `   worst ${String(worst).padStart(3)} = ${(worst / FPS).toFixed(2)} s` +
        ` at ${frames[index]!.distM.toFixed(0).padStart(3)} m` +
        `   ${frames[0]!.w}x${frames[0]!.h} -> ${frames.at(-1)!.w}x${frames.at(-1)!.h}` +
        `   far ${(perTier('far') / FPS).toFixed(2)} s` +
        ` / mid ${(perTier('mid') / FPS).toFixed(2)} s` +
        ` / near ${(perTier('near') / FPS).toFixed(2)} s`,
      )
    }
    expect(true).toBe(true)
  })

  it('never holds one drawing longer than the budget', () => {
    for (const type of SCENERY_TYPES) {
      const worst = Math.max(...freezeRuns(walkSceneryApproach(type)))
      expect(worst / FPS, `${type} longest freeze`).toBeLessThanOrEqual(MAX_FREEZE_S)
    }
  })

  it('grows without ever shrinking, and never by more than a pixel at a time', () => {
    // Scale is monotonic in depth here — an object only ever approaches — so
    // this is exact rather than a tolerance. It is also why `chooseSceneryLod`
    // is right to have no dead-band: there is nothing to oscillate.
    for (const type of SCENERY_TYPES) {
      const frames = walkSceneryApproach(type)
      for (let i = 1; i < frames.length; i++) {
        const prev = frames[i - 1]!
        const cur = frames[i]!
        const where = `${type} at ${cur.distM.toFixed(1)} m`
        expect(cur.w, `${where} width`).toBeGreaterThanOrEqual(prev.w)
        expect(cur.h, `${where} height`).toBeGreaterThanOrEqual(prev.h)
        expect(Math.max(cur.w - prev.w, cur.h - prev.h), `${where} step`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('hands over far -> mid -> near without moving its box or ground anchor', () => {
    // The three authored grids have three different resolutions; the physical
    // box is canonical and the anchor belongs to projection. Neither may move.
    for (const type of SCENERY_TYPES) {
      const frames = walkSceneryApproach(type)
      const at = frames.flatMap((frame, index) =>
        index > 0 && frame.lod !== frames[index - 1]!.lod ? [index] : [])
      expect(at.map(index => frames[index]!.lod), `${type} tier switches`)
        .toEqual(['mid', 'near'])

      for (const index of at) {
        const before = frames[index - 1]!
        const after = frames[index]!
        const where = `${type} at the ${after.lod} handover`
        expect(after.w - before.w, `${where}: width`).toBe(0)
        expect(after.h - before.h, `${where}: height`).toBe(0)
        expect((after.top + after.h) - (before.top + before.h), `${where}: ground`).toBe(0)
        expect(after.x - before.x, `${where}: lateral anchor`).toBe(0)
      }
    }
  })
})
