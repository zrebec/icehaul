/**
 * Every tunable constant in the game — as one import, from twelve files.
 *
 * This was a single 1612-line file with 192 exports, and the reason it had to be
 * broken up is not its length but that its own headings had stopped being true:
 * `TRAFFIC_SCALE_*` and the LOD thresholds sat under "Road generation", so the
 * numbers that decide how a vehicle grows on approach were filed under how the
 * road is made. Fox, after a playtest: *"pre človeka je to nečitateľné."*
 *
 * ── Why this file still exists ──────────────────────────────────────────────
 * It re-exports everything, so **nothing outside `src/settings/` changed**. Every
 * `import { X } from '../config.ts'` in the game and in the tests still resolves,
 * which is what makes a move of this size reviewable: the diff is a move, and
 * `tsc` plus 626 tests are enough to prove it.
 *
 * ── How the twelve are divided ──────────────────────────────────────────────
 * By **what gets tuned in one sitting**, not by subject. A gear ratio that feels
 * wrong is usually a torque curve that is wrong, so gearbox, clutch and engine
 * are one file. What the road *is* and what it *looks like* are almost never
 * touched together, so they are two.
 *
 *   screen       the 256x192 frame, the three bands, the CRT glass
 *   surfaces     what asphalt/snow/ice/sand/mud do to a vehicle
 *   drivetrain   mass, engine, gearbox, clutch, fuel burn
 *   route        how a seed becomes a road: segments, bends, warnings
 *   view         how that road is drawn: perspective, kerbs, markers
 *   vehicleView  how a vehicle's depth becomes pixels: growth, LOD, contour
 *   glow         the lamp bloom, on the glass and never in the framebuffer
 *   traffic      where the other vehicles are, and how they drive
 *   mission      the clock read off the road, the drop-offs, the canisters
 *   scoring      what the driving pays
 *   offroad      leaving the road, and what it costs
 *   audio        three AY channels and a beeper
 *
 * The dependency order is a tree, not a web: `surfaces` knows nothing about
 * anyone, and everything that needs a `Surface` imports it from there.
 */

export * from './settings/screen.ts'
export * from './settings/surfaces.ts'
export * from './settings/drivetrain.ts'
export * from './settings/route.ts'
export * from './settings/view.ts'
export * from './settings/vehicleView.ts'
export * from './settings/glow.ts'
export * from './settings/traffic.ts'
export * from './settings/mission.ts'
export * from './settings/scoring.ts'
export * from './settings/offroad.ts'
export * from './settings/audio.ts'
