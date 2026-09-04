/**
 * One approach, walked a physics tick at a time.
 *
 * Shared by every test that asks a question about *change between frames* —
 * the contact sheet cannot answer those, because it captures single frames.
 * Each caller derives its own metric from the same walk, so two tests can never
 * disagree about what the approach actually was.
 */

import { projectRoadsideObjects, projectTrafficVehicle } from '../road3d.ts'
import { resetVehicleRasterCache } from '../vehicleRaster.ts'
import { resetRoadsideRasterCache } from '../roadsideRaster.ts'
import {
  SCENERY_SCALE_NEAR_Z_M, SCENERY_VIEW_DISTANCE_M, VIEWPORT_BOTTOM, VIEWPORT_TOP,
} from '../../config.ts'
import type { LodTier } from '../vehicleLod.ts'
import type { TrafficDir, TrafficVehicle, VehicleType } from '../../game/traffic.ts'
import type { RoadsideObject, RoadsideType } from '../../game/roadside.ts'

/** One physics tick at 60 fps, closing at 60 km/h — an ordinary overtake. */
export const CLOSING_KPH = 60
export const FPS = 60
export const STEP_M = (CLOSING_KPH / 3.6) / FPS

export const DIRS: readonly TrafficDir[] = ['same', 'oncoming']
export const TYPES: readonly VehicleType[] = ['mini', 'car', 'bus']

export interface ApproachFrame {
  distM: number
  /** Screen position of the sprite's centre column and of its bottom edge. */
  x: number
  y: number
  left: number
  top: number
  w: number
  h: number
  scale: number
  lod: LodTier
  raster: readonly string[]
}

const noCurve = () => 0

/**
 * Walks a vehicle from `fromM` to `toM` down the centre of a straight road,
 * carrying the LOD tier forward exactly as the game does so hysteresis is
 * exercised rather than bypassed.
 */
export function walkApproach(
  dir: TrafficDir,
  type: VehicleType,
  fromM = 220,
  toM = 2,
): ApproachFrame[] {
  resetVehicleRasterCache()
  const frames: ApproachFrame[] = []

  for (let distM = fromM; distM >= toM; distM -= STEP_M) {
    const vehicle: TrafficVehicle =
      { spawnDist: 0, distM, x: 0, speed: 0, dir, type, gone: false }
    if (frames.length > 0) vehicle.lodTier = frames[frames.length - 1]!.lod

    const p = projectTrafficVehicle(VIEWPORT_TOP, VIEWPORT_BOTTOM, 0, 0, vehicle, noCurve)
    if (!p) continue

    frames.push({
      distM,
      x: p.x, y: p.y, left: p.left, top: p.top, w: p.w, h: p.h, scale: p.scale,
      lod: p.lod,
      raster: p.raster,
    })
  }
  return frames
}

/** True when two frames draw the identical raster at the identical size. */
export function sameDrawing(a: ApproachFrame, b: ApproachFrame): boolean {
  if (a.w !== b.w || a.h !== b.h) return false
  if (a.raster.length !== b.raster.length) return false
  for (let i = 0; i < a.raster.length; i++) if (a.raster[i] !== b.raster[i]) return false
  return true
}

/**
 * Runs of consecutive frames over which the drawing never changed, in frames.
 *
 * The headline number is the **longest** run: it is how long the vehicle stands
 * completely still while the player watches it, and it is what "steppy" means.
 * A count of changes hides it — a vehicle that changes forty times can still
 * spend three seconds frozen if the changes bunch up near the player.
 */
export function freezeRuns(frames: readonly ApproachFrame[]): number[] {
  if (frames.length === 0) return []
  const runs: number[] = []
  let run = 1
  for (let i = 1; i < frames.length; i++) {
    if (sameDrawing(frames[i - 1]!, frames[i]!)) run++
    else {
      runs.push(run)
      run = 1
    }
  }
  runs.push(run)
  return runs
}

/**
 * The five roadside types, in the order the contact sheet draws them.
 *
 * Scenery is walked by the same machinery as traffic because the question is
 * the same one — what changes between frames — and two helpers measuring one
 * approach two ways is how two tests come to disagree about what the approach
 * was.
 */
export const SCENERY_TYPES: readonly RoadsideType[] =
  ['deciduous', 'conifer', 'rocks', 'sign', 'lamp']

/**
 * One roadside object, walked past at `CLOSING_KPH`.
 *
 * The object stands still and the camera drives, which is the real motion: a
 * tree does not approach. That is also the whole reason `chooseSceneryLod`
 * needs no dead-band — scale is monotonic here and cannot oscillate across a
 * boundary the way braking traffic can.
 *
 * The walk runs between the two bounds `projectRoadsideObjects` itself honours,
 * so every frame it yields is one the game would have drawn.
 */
export function walkSceneryApproach(
  type: RoadsideType,
  side: 1 | -1 = 1,
  fromM = SCENERY_VIEW_DISTANCE_M,
  toM = SCENERY_SCALE_NEAR_Z_M,
): ApproachFrame[] {
  resetRoadsideRasterCache()
  const frames: ApproachFrame[] = []
  const object: RoadsideObject =
    { distM: fromM, side, type, band: 'verge', offsetRoadWidths: 0.15 }

  for (let camera = 0; camera <= fromM - toM; camera += STEP_M) {
    const [p] = projectRoadsideObjects(
      VIEWPORT_TOP, VIEWPORT_BOTTOM, camera, 0, [object], noCurve,
    )
    if (!p) continue
    frames.push({
      distM: p.worldZ,
      x: p.x, y: p.y, left: p.left, top: p.top, w: p.w, h: p.h, scale: p.scale,
      lod: p.lod,
      raster: p.raster,
    })
  }
  return frames
}
