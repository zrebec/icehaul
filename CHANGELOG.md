# Changelog

All notable changes to Ice Haul are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] — 2026-05-27

### Fixed

#### `isDangerAhead` — cross-surface warnings broken
`isDangerAhead` used to return `null` whenever the player was already on a
non-asphalt surface. This meant `SNOW → DUST AHEAD` (and any non-asphalt →
non-asphalt transition) was silent. The warning also lingered after the player
had already entered the new surface.

**Fix:** Replaced the `current !== 'asphalt' → return null` guard with two
precise rules: suppress when the surface ahead is safe (asphalt), and suppress
when it matches the current surface (already on it). Any *different* dangerous
surface ahead now warns correctly regardless of what the player is currently on.

#### Sand/dust surface — unable to accelerate from a stop
`SURFACE_ACCEL.sand = 0.2` was too low and `SURFACE_DRAG.sand = 12` was too
high. Combined effect: the truck couldn't build speed from rest on sand, and
large sand segments were consuming ~36 % of the fuel tank at the 1.5× multiplier.

**Fix:**
- `SURFACE_ACCEL.sand`: 0.2 → **0.35**
- `SURFACE_DRAG.sand`: 12 → **7**
- `SURFACE_FUEL_MULT.sand`: 1.5 → **1.2** (old value kept commented in source)

#### Ice + curve — steering completely unresponsive
On ice inside a curve the truck was totally unresponsive to left/right input.
Root cause: `effectiveGrip` (reduced by the slip-angle curve) was used for both
the player's steering force *and* the self-correcting damping force. Past the
slip peak on ice, `effectiveGrip` collapses to near zero — killing steering
authority entirely.

**Fix:** Split into two separate grip values:
- `steeringGrip = grip × (1 − brakeLoss)` — player input. Uses base surface
  grip only, *not* reduced by the slip curve. On ice this is 0.25 — weak but
  always present.
- `effectiveGrip = grip × gripMult × (1 − brakeLoss)` — damping / physics
  self-correction. Uses the full slip model; past the peak, drift persists
  (ice doesn't forgive).

Result: steering is ~21 % of the centrifugal force on ice in a hard slide —
the car responds, but you won't catch a full drift without planning ahead.

#### Traffic collision — never triggered
Three compounding bugs prevented any collision with traffic vehicles:
1. `TRAFFIC_COLLISION_RADIUS_CAR = 0.12` was ~2.5× too small. At the
   perspective depth where the truck sprite and a vehicle visually meet
   (`worldZ ≈ 1–2 m`), the road-half scale is ~50 px — combined half-widths
   are (12 + 6) / 50 = 0.36; the old value of 0.12 never reached it.
2. Oncoming vehicles spawned at `x ∈ [−0.6, −0.2]`. The minimum lateral
   distance to a centred player was 0.2 — always greater than the old radius.
3. The world-space check (`|v.x − playerX| < radius`) used different scale
   factors for the player truck (`× 50 px`) and the traffic vehicle renderer
   (`× half`, which varies 43–120 px with perspective). The two coordinate
   systems were never reconciled.

**Fix:** Replaced the world-space radius check with **pixel-perfect
screen-space collision** — the same philosophy as off-road detection:
- `tickTraffic` now returns `void`. It only moves vehicles.
- `drive.ts` projects each vehicle within 6 m using the **identical**
  `PERSPECTIVE_K / worldZ → i → t → half → screenX` formula used by the
  renderer. This guarantees the collision rect matches the drawn rect exactly.
- Collision is detected by `checkTruckTrafficCollision` (new export in
  `offroad.ts`): iterates the pre-computed `TRUCK_PIXEL_MASK` row by row,
  skips rows outside the vehicle rect's Y range, quick column reject, then
  per-pixel scan. Collision fires at the exact frame a solid truck pixel
  enters the vehicle rectangle.
- Oncoming spawn range tightened: `x ∈ [−0.6, −0.3]`. Player must drift
  meaningfully into the left lane to collide; vehicles no longer crash a
  centred player without warning.
- Removed dead `TRAFFIC_COLLISION_RADIUS_CAR` and `TRAFFIC_COLLISION_RADIUS_TRUCK`
  constants from `config.ts`.

### Changed

#### Fuel balance — first delivery completable without luck
`FUEL_BURN_RATE`: 0.00012 → **0.000110** (original value kept commented).
`SURFACE_SLIP_PEAK.ice`: 0.20 → **0.25** (slightly wider linear grip zone).
Combined with the sand rebalance above, at least the *moderate* strategy
(asphalt 65, snow 50, ice 32, sand 50, mud 45 km/h) now completes the
first 5 km within budget — confirmed by the completability simulation.

### Added

#### Completability simulation (`src/game/__tests__/completability.test.ts`)
Permanent frame-by-frame test (16 ms ticks, ~60 fps) that drives the first
5 km with a proportional speed controller and P-controller steering. Three
strategies are compared — `aggressive`, `moderate`, `conservative` — each
with per-surface target speeds. Always prints a surface/speed/fuel table for
human inspection. Asserts that at least one strategy completes the delivery
within the 7-minute time limit without running out of fuel.

#### `checkTruckTrafficCollision` in `offroad.ts`
Pixel-exact check between the truck bitmap mask and an arbitrary screen-space
rectangle. Exported so it can be unit-tested independently of the scene loop.

#### Tests
- **`offroad.test.ts`** — 9 new tests for `checkTruckTrafficCollision` covering
  spatial exclusion (above/below/left/right), solid-area overlap, offset truck
  position, and zero-width degenerate rect.
- **`road.test.ts`** — `isDangerAhead` describe block rewritten: added tests for
  "already on surface → no warning", "cross-surface transition warns", and
  "approaching asphalt → no warning". Removed the old asphalt-only test that
  missed the snow→dust case.
- **`traffic.test.ts`** — removed the world-space collision test (no longer
  applicable after the pixel-perfect rewrite).

---

## [0.1.0] — earlier

Initial playable build: pseudo-3D road, truck sprite, throttle/brake/steer,
per-surface physics (asphalt/ice/snow/sand/mud), fuel + canisters, traffic
vehicles, off-road detection, crash animation, delivery mission loop, AY engine
drone.
