# Changelog

All notable changes to Ice Haul are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] — 2026-06-02

### Added

#### Manual 5-speed gearbox
The truck now has a manual gearbox (`GEARS` table in `config.ts`, logic in
`game/vehicle.ts`). Each gear has a speed band `[from, to]` and a torque value:
low gears pull hard but top out early — **1st gear caps at ~28 km/h, so you
physically cannot reach 120 km/h in a low gear** — while high gears have a high
top speed but weak pull. Engine `rpm = (speed − gear.from) / gear.span` drives a
torque curve: lugging below the band is weak, the mid-band is full power, and at
redline (`rpm ≥ 1`) the engine can't pull the gear any faster, so you must shift
up. Shift with **A** (up) / **D** (down). Reaching top speed now means climbing
through every gear and takes ~30 s of clean driving.

New tunables in `config.ts`: `GEARS`, `GEAR_COUNT`, `BOG_RPM`, `BOG_FLOOR`,
`POWER_RPM`, `REDLINE_FLOOR`, `OVERREV_ENGINE_BRAKE`.

#### Engine stall + ENTER restart, with a "stalling" grace warning
Slow down or brake without downshifting and the revs fall below the gear's band
(`STALL_RPM = −0.35`) — the engine **stalls** and dies. First gear (`from = 0`)
is immune, so you can always idle and pull away in 1st. A stalled engine
freewheels with no power (and burns no fuel) until you press **ENTER** to
re-ignite, which re-engages a sensible gear for the current speed
(`startableGear`).

Before it actually dies, the engine lugs and **coughs** for `STALL_GRACE_MS`
(3.5 s) with an `ENGINE STALLING / SHIFT DOWN D` overlay — enough time to react
mid-corner on snow. Downshifting in time cancels the stall.

#### RPM-driven engine audio
`audio/engine.ts` now pitches the AY engine tone by **engine RPM within the
current gear** instead of absolute speed, so revs audibly climb as you accelerate
in a gear and **drop on an upshift** — the manual-gearbox sound. The engine tone
is silenced while stalled (tyre/surface noise rolls on). Added a shift-blip beep,
a descending "engine dying" cue on stall, and an ignition crank on restart.

#### Drivetrain HUD panel
The left HUD panel was reworked into a drivetrain cluster: **FUEL · RPM · GEAR ·
GRIP**. The RPM bar is a 7-segment gauge that reddens toward redline
(`[B_GREEN, B_YELLOW, B_RED]`); GEAR shows current/total; GRIP is now a single
horizontal bar.

#### Drivetrain roadmap doc
`docs/DRIVETRAIN_ROADMAP.md` — implemented features, the owner's future ideas
(non-instant engine start, weight-based acceleration, damage model,
low-speed-crash rework, speed↔tachometer swap) each with an honest assessment,
four agent-proposed ideas ordered by effort, and a suggested build sequence.
(A Slovak `*.sk.md` mirror exists locally; `*.sk.md` is gitignored by project
convention.)

#### Tests
- `vehicle.test.ts` — new `manual gearbox + stall` block: 1st-gear top-speed cap,
  shift up/down, lug → stalling warning → stall after the grace period,
  downshifting in time avoids the stall, 1st gear never stalls, a stalled engine
  produces no throttle power, and ENTER restart re-engages 1st.

### Changed

#### Acceleration is now gear-limited and much slower
The old single-speed model (`ACCEL = 8`, 0→120 in ~15 s, capped only at
`MAX_SPEED`) was replaced by per-gear torque capped at each gear's top speed.
Engine force is now `gear.accel × torque(rpm) × surface_mult`, plus over-rev
engine braking (`OVERREV_ENGINE_BRAKE`) that drags speed back to the gear top
after a downshift at speed. `ACCEL` is no longer used by `vehicle.ts`.

#### Delivery time limit 7 → 8 minutes
`DELIVERY_TIME_LIMIT_MS`: 7 → **8 min**. With the slower gear-limited
acceleration a careful (conservative) driver was timing out short of 5 km. After
the bump, both the moderate and conservative strategies complete the first
delivery with margin (confirmed by the completability simulation).

#### Completability simulation now shifts gears
The ideal-driver simulation (`completability.test.ts`) gained an auto-gearbox
(upshift near redline, downshift at low rpm) so it can use the full speed range —
without it the simulated driver would be stuck in 1st at ~28 km/h. The required
average speed for the 5 km / 8 min budget is now ~37.5 km/h.

#### HUD left panel — compass and double GRIP bar removed
The static 3-direction compass (heading was always "N") and the twin vertical
GRIP bars were removed to make room for the RPM and GEAR readouts. If `heading`
ever becomes dynamic, restore the compass in the top status bar instead.

#### Docs
`CLAUDE.md` and `README.md` updated for the new controls (A/D, ENTER), the
drivetrain HUD layout, the stall + warning mechanic, and the 8-minute budget.
Corrected a stale `ICE_GRIP = 0.15` reference to `SURFACE_GRIP.ice`.

---

## [2026-05-27]

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
