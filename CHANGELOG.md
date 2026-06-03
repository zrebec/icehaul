# Changelog

All notable changes to Ice Haul are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] — 2026-06-03

### Added

#### Non-instant engine start — crank starter
Hold **ENTER** for ~1.8 s to crank the engine. Releasing before it fires resets
the crank — you must try again. Works both for the initial game start and for
restarting a stalled engine mid-drive. While cranking, the overlay shows
`STARTING...` (green, steady) and irregular beeper pulses simulate a diesel
starter motor. On a successful fire, a short rising beep confirms ignition.

`CRANK_NEEDED_MS = 1800` in `config.ts` controls the hold time. The vehicle
itself is unchanged — `input.restart` is only sent to `tickVehicle` after the
crank completes, so the physics restart path is identical to before.

"PRESS ENTER" overlays (start screen and stall screen) renamed to `HOLD ENTER`.

#### Harder torque curve — high gears genuinely struggle at low speed
The torque multiplier below the power band was reworked so that driving in too
tall a gear has real consequences:

- **`BOG_FLOOR`**: `0.40 → 0.12` — diesel floor at idle is now genuinely weak.
- **`BOG_RPM`**: `0.45 → 0.50` — wider bog zone (5th gear at 40 km/h sits inside it).
- **Curve shape**: linear interpolation below `BOG_RPM` changed to **quadratic** —
  torque drops steeply as rpm falls toward idle.

Net effect:
- **5th @ 30 km/h** → stall warning fires, torque too low to escape the grace
  period (needs 5.1 s to gain enough revs; grace is 3.5 s) → engine stalls. ✓
- **5th @ 40 km/h** → pulls at ~0.72 km/h/s vs 4th's ~1.54 km/h/s (2× faster) —
  clearly noticeable, RPM bar sits low, player is nudged to downshift. ✓
- **5th @ 65+ km/h** → above `BOG_RPM`, full power band, unchanged. ✓

#### Multi-seed completability sweep (20 seeds)
The `completability.test.ts` simulation now runs 20 diverse seeds (covering
layouts with 2× ICE, 2× MUD, 3× SNOW, etc.) instead of the single seed 42.

Per-seed summary table is printed for human inspection. Two new assertions:
- **"aggressive never times out"** — aggressive may run dry on fuel on heavy
  surface routes (by design), but it must never hit the 8-min wall.
- **"at least one strategy completes every seed"** — the 8-min budget holds
  across all 20 layouts (worst case: 428 s = 7.1 min, 52 s inside the limit).

#### Node 22 / `.nvmrc`
`.nvmrc` added (`22`); `package.json` `engines` updated to `>=22.12.0`. Vite 7
and jsdom 29 require Node ≥ 20.19 / ≥ 22.12 — Node 20.11 was breaking all tests.

---

### Added

#### Synchro downshift limits (per-gear `maxSpeedToShift`)
You can only **downshift into** a gear below its synchro speed: **1st < 35 km/h,
2nd < 60, 3rd < 85**; 4th and 5th are `null` (no limit, engage at any speed). A
refused downshift keeps the current gear and signals a **grind/clunk** plus a red
flash on the GEAR readout (`v.shiftBlocked`). Upshifts are never blocked. The rule
is fully config-driven via a new `GearSpec.maxSpeedToShift: number | null` — set
every gear to `null` to remove synchro, or all to numbers for a fully synchro'd
box, without touching the logic. Designed for the ice scenario: as you brake, the
lower gears unlock as you slow, so you can walk the box down for engine braking
without ever slamming into a gear that would over-rev. Four new `vehicle.test.ts`
cases cover refuse-above-limit, allow-below, `null`-never-blocks, and
upshift-never-blocked.

#### Engine redline burn-out (over-rev warning)
Symmetric twin of the stall warning, for the *upper* end of the band. Sit on the
**redline** under throttle without upshifting and the engine over-revs: an
`ENGINE REDLINE / SHIFT UP D` overlay + an insistent buzzer (after
`REDLINE_WARN_DELAY_MS = 900` ms), then it **burns out** and stalls after
`REDLINE_BURN_MS = 6000` ms. It only applies in gears you can upshift out of —
the top gear's redline is just the speed limiter, with no recourse, so it never
burns out. To keep the top-gear cruise off the red, 5th gear's band was widened
to `to: 130` and engine force is now clamped to `MAX_SPEED` (`speedCap`), so
120 km/h in 5th reads ~0.75 RPM instead of pinned redline. `v.stallCause` now
records `'lug'` vs `'overrev'` so a future damage model can treat them
differently. New `vehicle.test.ts` cases cover warn → burn-out, upshift-avoids-it,
coasting-at-the-limiter-is-safe, and the top-gear exemption.

**Controls note:** gear shifting was remapped to **A = shift down, D = shift up**;
the stall overlay (`SHIFT DOWN A`), the new redline overlay (`SHIFT UP D`),
`README.md`, and `CLAUDE.md` were all updated to match.

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

#### Realistic lugging in tall gears + tachometer HUD (feel pass)
Playtest follow-up: in a high gear the truck pulled fine at low speed (e.g. cruising
30 km/h in 5th, with no pressure to downshift), which felt wrong. Three tied changes:
- **Lug line raised to a realistic point** — `LUG_RPM` 0.06 → **0.25** (≈ 650 rpm). Too-tall
  gears now lug at real speeds (5th below ~32 km/h, 4th below ~25, …), so cruising 30 in 5th
  builds the `ENGINE STALLING` warning and you must downshift.
- **Weaker low-end torque** — `BOG_RPM` 0.22 → **0.45**: the power band starts higher, so a
  too-tall gear is *sluggish* (5th at 30 ≈ 0.7 torque vs full), not just stall-pressured.
  Pulling away in a low gear still works (low-end is weak but enough; the 3.5 s grace covers
  the brief lug as you accelerate out).
- **RPM gauge reads raw** — the dashboard idle-floor (`IDLE_RPM`) was removed, so the left
  RPM bar can drop to **0 bars** when lugging.

**Tachometer HUD.** The centre panel's speed dial became a **tachometer** (needle = real
engine revs, reddens at redline) with numeric **RPM** (real revs via `RPM_DISPLAY_REDLINE`
= 2600, so the lug line reads ~650) and numeric **SPD**. Realises owner idea 2.5 (tach dial
+ prominent speed number). The completability sim's auto-gearbox downshifts earlier
(`rpm < 0.33`) to stay off the lug; all three strategies now complete with margin.

#### RPM model reworked to be proportional to road speed (feel fix)
The original `rpm = (speed − gear.from) / gear.span` modelled *position within the
gear's band*, which fell to zero — and negative — below the band. That made an
early upshift feel like the revs "dropped to zero" (harsh bog), and made a
slightly-too-tall gear at low speed undrivable (e.g. 2nd at 6 km/h computed a
*negative* rpm and actually began stalling).

Now `rpm = speed / gear.to`, proportional to road speed like a real engine: it
never goes negative, and the dashboard idles at `IDLE_RPM` so a moving gear never
shows a dead zero (only a true stall reads zero). Low-end torque was strengthened
(`BOG_FLOOR` 0.30 → 0.40) so a slightly-tall gear still pulls — slowly, but it
moves, the way you can pull away in 2nd from a crawl in a real car. Knock-on
changes:
- The gear `from` field was removed; each gear is now just `{ to, accel }`.
- `STALL_RPM` (−0.35) → `LUG_RPM` (0.06): the engine lugs toward a stall only when
  rpm falls below idle in a gear it can't sustain, with 1st gear exempt via a
  `v.gear > 1` guard.
- `startableGear` (restart) now picks the lowest gear that isn't near redline.
- The completability simulation's auto-gearbox uses the new `speed / to` rpm.

**Tuning note:** with the gentler low-end the *conservative* sim strategy now
times out by a hair (~35.7 vs 37.5 km/h required); aggressive and moderate still
finish. The constants (`GEARS[].accel`, `BOG_FLOOR`, `BOG_RPM`, `LUG_RPM`) are
starting points pending a real-browser playtest.

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
