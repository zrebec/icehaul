# Ice Haul

ZX Spectrum-flavoured ice-road trucking micro-sim. Not ETS2 — its 8-bit hallucination. The fantasy is **risk management**, not speed. Every metre is a decision: when to brake, when to crawl, when to risk the ice.

Built on [zx-kit](https://github.com/zrebec/zx-kit) (`zx-kit@^0.46.0`).

## Play

**[Play in browser](https://zrebec.github.io/icehaul/)** (GitHub Pages)

> **CI note (2026-07-03):** GitHub Pages deploys require `actions/upload-pages-artifact@v5+` and
> `actions/deploy-pages@v5+`. The Pages backend started rejecting v3-era artifacts on 2026-07-03 —
> the deploy fails seconds after creation with a generic *"Deployment failed, try again later"*
> while build and tests stay green. If a Pages deploy ever fails like that, check these two action
> versions FIRST.

Or run locally:

```bash
npm install
npm run dev       # http://localhost:5174
```

## Controls

| Key | Action |
|-----|--------|
| Arrow Up | Throttle |
| Arrow Down | Brake |
| Arrow Left / Right | Steer |
| **SHIFT** | **Clutch** — hold it to change gear; the skill is *when you let it out* |
| D / A | Shift up / down (only while the clutch is held) |
| Enter | Confirm on the title screen · crank the engine · restart after a stall |
| P | Pause / unpause |
| W | Debug: cycle gross weight 10 → 20 → 30 t |

### Title screen

The game opens on a loading screen with a menu. Arrows move, Enter confirms.

| Item | What it does |
|------|--------------|
| START | Begin the run |
| GLOW | Lamp bloom on or off |
| CONTOUR | Traffic outline and contact shadow on or off |
| VOLUME | Master volume, 0–10 |

The three settings are remembered between sessions. A URL switch still overrides
them for the run it is given on, so an A B comparison never inherits whatever the
last session happened to save.

### URL switches

Work on the dev server and on the deployed build alike:

| Switch | Effect |
|--------|--------|
| `?seed=1443866` | drive a specific route. No parameter means today's daily route |
| `?glow=0` | turn the lamp bloom off. `?glow=0.5` sets its strength, `?glow=0.5,1.5` its radius too |
| `?outline=0` | traffic without its dark outline and contact shadow |
| `?matrix=1` | the traffic contact sheet instead of the game (a developer view) |
| `?sceneryMatrix=1` | the roadside LOD contact sheet; add `placement=<seed>` for real generated placement |

**The clutch is the whole game.** Gears do not move without **SHIFT** held — and
what matters is not how long you hold it, but the revs you let it out at. The clean
point is wherever the engine matches what the wheels will demand in the new gear,
and the tachometer shows that target as a second small needle while the pedal is
down. **Downshifting needs more revs than you have, so blip the throttle while
declutched** (yes, that is a real double-clutch); upshifting needs fewer, so wait for
them to fall. Let it out wrong and the truck lurches — badly wrong and the engine
dies. And every second you spend in neutral, you are coasting: no drive, no engine
braking, and the target moving away from you as the truck slows.

You can hear the match before you can see it — the engine note follows the revs.

**Manual 5-speed gearbox.** Each gear has its own top speed — **1st gear caps at ~28 km/h, so you can't reach 120 in a low gear** — and a power band shown on the **RPM** gauge (green → red toward redline). Acceleration is slow and heavy: climb through the gears with **D** (up) / **A** (down), watching the revs. Sit on the **redline** (red RPM) under throttle without upshifting and the engine over-revs and **burns out** — an `ENGINE REDLINE / SHIFT UP` warning gives you a few seconds before it stalls (the top gear is safe — its redline is just the speed limiter).

**Don't stall it.** Slow down or brake without downshifting and the revs fall below the gear's band — the engine **stalls** and dies (1st gear is the exception; it always idles). You get a few seconds of an **ENGINE STALLING** warning (the motor coughs) to drop a gear before it actually dies; miss it and the truck freewheels with no power until you press **Enter** to re-ignite. So as you slow for ice or traffic, **downshift** — that's the loop.

**Important:** The truck weighs 20 tonnes. It glides — engine braking is minimal, so you must **brake actively**. Braking from 120 on asphalt takes ~10 seconds; on ice ~25+.

On ice: **tap** the steering keys for controlled corrections. **Holding** the key causes oversteer — the drift self-amplifies and you lose control (skid). Same with brakes: **pump** (tap) on ice, don't hold — holding locks the wheels above 30 km/h.

## Screenshot

![Ice Haul screenshot](screenshot.png)

---

## Documentation

| Document | What is in it |
|----------|---------------|
| [docs/manual.md](docs/manual.md) | Survival guide and driver's manual — surfaces, fuel, skid, curves, scoring, HUD |
| [docs/simulation.md](docs/simulation.md) | How the truck and the world behave: drivetrain, lateral dynamics, collision |
| [docs/graphics.md](docs/graphics.md) | Sprite pipeline, AI prompts, and the zx-art screen route |
| [docs/seeds.md](docs/seeds.md) | Routes worth keeping, and why a daily seed can never be lost |
| [docs/known-issues.md](docs/known-issues.md) | Standing problems, and what has already been tried |
| [ROADMAP.md](ROADMAP.md) | What is next |
| [AGENTS.md](AGENTS.md) | Instructions for AI agents — the working source of truth |

## Tech

- **256 × 192** game pixels (ZX Spectrum native), integer-scaled ×4
- **15-colour ZX palette** in the framebuffer. 8×8 attribute colour clash is intentional
- **TypeScript + Vite** — no runtime dependencies besides zx-kit
- **AY-3-8912** chip emulation for 3-channel engine sound
- Tunable constants live in `src/settings/`, twelve files grouped by what gets tuned in
  one sitting, and are re-exported from `src/config.ts` so every existing import still resolves
- CRT scanlines (alpha 0.7) + barrel distortion (intensity 0.6)
- **Lamp bloom** composited over the finished frame — the one place off-palette colour appears, and
  it happens on the glass, in front of the scanlines, never in the framebuffer. `?glow=0` restores
  a byte-identical picture
- The title screen is a native **`.scr`** ZX screen dump compiled into the bundle. Three bits of INK
  and three of PAPER cannot express an off-palette or clash-breaking picture, so the format itself
  guarantees what a PNG could only be trusted about
- Headless capture: `node scripts/screenshot.mjs out.png`, contact sheets via
  `node scripts/traffic-matrix.mjs` and `node scripts/scenery-matrix.mjs`, attribute-clash
  validation via `node scripts/clash-check.mjs`

## Project structure

```
src/
  main.ts              entry: canvas, scene loop, CRT, audio, URL switches
  config.ts            re-exports every constant from settings/ — nothing imports settings directly
  settings/            twelve files of tunable constants, grouped by what is tuned together:
                       screen, view, vehicleView, drivetrain, surfaces, offroad,
                       traffic, route, mission, scoring, glow, audio
  assets/
    icehaul-loading.*  the .scr title screen and its generated module
  scenes/
    intro.ts           title screen: the .scr picture and the options menu
    drive.ts           main driving scene
    gameover.ts        results screen, including the route the run was driven on
  game/
    vehicle.ts         throttle/brake/steer/clutch + per-surface physics
    road.ts            surface + curvature generator
    roadgeometry.ts    where the road edge is, for off-road and for tests
    offroad.ts         off-road detection + pixel-perfect traffic collision
    collisionSweep.ts  near-field swept sampling, so contact is geometry and not luck
    traffic.ts         traffic spawner, car-following, brake state
    trafficDriver.ts   how a traffic vehicle decides to brake
    canisters.ts       fuel canister spawner + pickup
    roadside.ts        decorative objects (trees, lamps, signs)
    mission.ts         delivery targets, the clock and its carry-over
    routeplan.ts       the legs a route is made of
    score.ts           continuous scoring, paid by the block
    runStats.ts        what a finished run was worth
    seed.ts            one route per day, overridable with ?seed=
    prefs.ts           the three remembered player settings
  render/
    road3d.ts          pseudo-3D road + kerbs + canisters + roadside + traffic
    projection.ts      the shared curve-offset maths
    vehicleRaster.ts   one raster per drawn vehicle: draw, collide, glow
    vehicleLod.ts      far/detail tiers — meaning in the distance
    vehicleContour.ts  the dark outline and contact shadow
    vehicleGlow.ts     lamp bloom through zx-kit's glow layer
    truck.ts           the player truck's masks, shared by drawing and collision
    hud.ts             3-panel instrument cluster
    topbar.ts          score/dist/time/warnings
    sprites/
      playerTruck.ts   40×64 articulated road train, five cab and trailer poses
      vehicles.ts      the six hand-drawn traffic vehicles
    debug/             traffic and scenery contact sheets (?matrix=1 / ?sceneryMatrix=1)
  audio/
    engine.ts          AY chip engine drone (3 channels)
scripts/
  screenshot.mjs       headless Puppeteer capture
  drive-shot.mjs       automated drive + capture
  frame-profile.mjs    where a frame actually goes
  traffic-matrix.mjs   contact sheets — the renderer comparison harness
  scenery-matrix.mjs   roadside LOD sheets + real seeded placement captures
  sprite-import.mjs    AI contact sheet → zx-kit row-string sprites
  screen-import.mjs    .scr screen dump → an inlined TypeScript module
  clash-check.mjs      reads the rendered frame back and proves it is hardware-valid
```

## Status

Phases 1–5 are complete: five surfaces with a measured controllability envelope, the skid
mechanic, a manual clutched gearbox with stall and burn-out, fuel, traffic with pixel-perfect
collision, proportional delivery targets, continuous scoring, a results screen, AY sound and
roadside decoration.

Since then the graphics thread has been through one shared raster, an LOD tier, a hyperbolic
growth curve, a hand redraw of all six traffic vehicles, the lamp bloom, and an articulated
40×64 player road train whose five poses share their exact masks with collision. The title
screen arrived as a native `.scr` with a settings menu, the results screen now names the route
the run was driven on, and near-field collision is swept rather than sampled once per frame.

See [ROADMAP.md](ROADMAP.md) for what is next, and `AGENTS.md` for what is being worked on now.

## License

MIT
