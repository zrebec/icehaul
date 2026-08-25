# Ice Haul Roadmap

Status as of 0.18.0 (25 August 2026). Detail lives in
[docs/simulation.md](docs/simulation.md) and [docs/graphics.md](docs/graphics.md).

## Done

**Graphics pass** — all six traffic vehicles hand-drawn as ZX-style sprites (rear-view
same-direction cars, minis, narrow 12×8 cars and buses; oncoming cars and buses with
headlights), every one inside the zx-kit palette and preserving the 8×8 attribute look.
Repeated pixel art moved to row strings and zx-kit bitmap data. One shared raster now
serves drawing, collision and glow; an LOD tier gives distant traffic meaning rather
than a shrunken car; a hyperbolic growth curve makes size read as distance across the
whole approach. Lamp bloom composites over the finished frame.

**Player truck** — revisited after traffic stabilised, as planned. Now a 40×64
articulated road train with five cab and five trailer poses, and the visual overlays
are separated from the collision mask: each pose carries its own, and `drive.ts` sends
the same pose to drawing, particles and both collision paths.

**Collision and projection** — traffic collision is screen-space and pixel-perfect,
drawing and collision share one projection, and world-space checks are broad-phase
only. Near-field contact is swept rather than sampled once per frame, so an oncoming
vehicle can no longer cross the truck between two frames.

**Title and results** — a native `.scr` loading screen with a settings menu that
remembers its choices, and a results screen that names the route the run was driven on.

## Next

- **Roadside decoration through zxart** — trees, signs and snow banks redrawn with the
  screen pipeline that now exists, at the sizes the LOD tiers actually ask for.
- **Cab articulation driven by lateral velocity** rather than by the arrow key. The five
  poses exist but only two are ever seen, because a held key saturates the yaw in 139 ms
  and crosses the first threshold in 29. Driving it from `v.vx` makes the intermediate
  poses real, shows a skid on the cab, and slows the player's response by nothing.
- **Mass in the lateral equation.** The three mass multipliers are all longitudinal, so a
  40 t truck currently corners exactly like a 10 t one — precisely where a player expects
  to feel the load.
- **Rollover as a failure mode**, once mass reaches the steering. Peak lateral
  acceleration is 0.60–0.79 g today against a real loaded artic's 0.30–0.40 g limit.

## Later

- Save state and a limited rewind: three per run, shown on the HUD beside fuel. The world
  is a pure function of seed and distance, so a snapshot is under a kilobyte.
- Split the title into TITLE, CONTINUE and OPTIONS screens — the panel cannot grow past
  six rows without eating the truck.
- Traffic density that scales with distance, then distance fog and night.
- A traffic-density sweep, so `docs/seeds.md` can record measurements instead of feelings.
- Lane intent, overtaking windows and explicit despawn states — but not during a graphics
  pass, and not before deterministic tests exist for two same-direction vehicles spawning
  close together in the player's lane.
- A headless collision smoke test: centred truck clears left-lane oncoming traffic,
  deliberate drift does not, near traffic stays visible until it leaves the viewport.
