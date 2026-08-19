/**
 * How fast a thing may go here — the one law, shared.
 *
 * It was written inside `routeplan.ts`, because the mission planner was the only
 * thing that needed it. Traffic needs the same answer about the same road, and
 * two copies of one piece of physics drift: the moment `SURFACE_GRIP` moves, one
 * copy gets updated and the other becomes a lie that still passes its tests.
 *
 * Anchored on the measured envelope in `controllability.test.ts` — one line
 * reproduces all twenty of its cells to within about 5 %. The `sqrt(grip)` half
 * is not a fit but the friction circle, which is also why ice holds 40 km/h
 * through the sharpest bend and not 45.
 */

import {
  MAX_SPEED, PLAN_C_MIN, PLAN_SURFACE_VMAX, PLAN_V_REF,
  type Surface,
} from '../config.ts'

/**
 * Everything a caller needs to know about the road, and nothing more.
 *
 * Injected rather than imported so the modules that ask these questions stay
 * pure and can be tested over a road that does not exist. It also keeps the
 * dependency pointing one way: the mission and the traffic ask the road
 * questions, never the other way round.
 */
export interface RoadSampler {
  surfaceAt(distM: number): Surface
  gripAt(distM: number): number
  curvatureAt(distM: number): number
}

/**
 * The friction circle on its own: how fast this bend may be taken at this grip.
 *
 * Split out of {@link safeSpeedKph} because traffic needs this half and must not
 * have the other. `PLAN_SURFACE_VMAX` is what *the truck* can hold against
 * `SURFACE_DRAG` — it says ice is fine at 120 because ice is not draggy, which is
 * true of the truck's engine and useless as a statement about a car.
 */
export function corneringSpeedKph(curvature: number, grip: number): number {
  const bend = PLAN_V_REF / Math.sqrt(Math.max(Math.abs(curvature), PLAN_C_MIN))
  return bend * Math.sqrt(Math.max(0, grip))
}

/**
 * The truck's version: the bend, the truck's own top speed, and what the
 * surface's drag lets it hold on a straight.
 *
 * Grip is expected to come from `getGripAt` rather than `SURFACE_GRIP[surface]`,
 * so the 20 m ramp across a seam is already in it — a plan must not assume an
 * edge the physics does not have.
 */
export function safeSpeedKph(curvature: number, grip: number, surface: Surface): number {
  return Math.min(MAX_SPEED, PLAN_SURFACE_VMAX[surface], corneringSpeedKph(curvature, grip))
}
