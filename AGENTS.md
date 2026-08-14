# Agent notes — Ice Haul

Working notes that are not derivable from the code. `CLAUDE.md` describes how the game is built;
this file records decisions, benchmarks and open questions. Do not duplicate content between them.

---

## Branch workflow

**One branch is one pull request. Once the PR is open, that branch is finished — go back to `main`.**

Start every piece of work from a fresh branch off an up-to-date `main`:

```
git checkout main && git pull
git checkout -b <type>/<short-name>
```

The reason is specific to how this repository merges. `main` takes **squash merges only**, which
collapse a branch's commits into one *new* commit; the branch's own commits never appear on `main`.
Carry on committing to a branch whose PR has merged and it now holds work already applied under a
different hash, so the next diff offers those lines a second time and the PR goes `DIRTY`. That
happened twice — #25 had to be rebuilt as #27, and #30 was rebuilt pre-emptively — and both times
the cost was rework, not a lost change.

Two habits that avoid it entirely:

- **Check before branching, not after.** `git log --oneline -3 origin/main` should already contain
  the previous piece of work. If it does not, the PR is not merged yet and the new work either waits
  or branches from the old branch deliberately, knowing it stacks.
- **Never reuse a branch as a workbench.** Its life ends at the PR. `delete_branch_on_merge` is on,
  so the remote tidies itself; a local leftover needs `git branch -D` rather than `-d`, because
  squash means git cannot see its commits on `main` and will refuse the safe delete.

## Playtest seed catalogue

The road, traffic and canisters are all deterministic functions of one seed, so **a seed is the
whole route**. Load one with `?seed=<decimal>`:

```
http://localhost:5173/?seed=1443866          dev
https://zrebec.github.io/icehaul/?seed=534501  deployed
```

No parameter → today's route (`YYYYMMDD`, local calendar day).

### Ice-heavy routes

Found by sweeping seeds 1–2 000 000 for **≥ 35 % ice in the first 5 km with ≥ 300 m of that ice
inside a bend of |curvature| ≥ 1.5**. Thirteen survived. Ice never starts before 1000 m
(`START_ASPHALT_M`), so every route opens on asphalt.

| Seed | Ice % | Hazard % | Ice in sharp bend | Surfaces | Bot time | Fuel left |
|---|---|---|---|---|---|---|
| **534501** | 35.5 | 35.5 | **725 m** | ice | 390 s | 14.5 % |
| **1399375** | 36.5 | 41.5 | 650 m | ice, mud | 397 s | 16.5 % |
| **52662** | 35.5 | 40.5 | 625 m | ice, snow | 396 s | 17.2 % |
| 455932 | 37.5 | 43.0 | 550 m | ice, mud | 401 s | 17.4 % |
| 1989443 | 35.0 | 43.0 | 550 m | ice, sand, snow | 402 s | 16.4 % |
| 1802200 | 39.5 | 51.0 | 525 m | ice, mud, sand | 413 s | 18.9 % |
| 655671 | 35.5 | 49.5 | 500 m | ice, sand, snow | 415 s | 20.0 % |
| 769785 | 35.5 | 40.0 | 500 m | ice, sand | 389 s | 15.3 % |
| **1443866** | **48.5** | **56.5** | 475 m | ice, mud, sand | 419 s | 25.4 % |
| 859682 | 38.0 | 38.0 | 450 m | ice | 390 s | 17.7 % |
| 47841 | 36.5 | 47.0 | 450 m | ice, snow | 395 s | 16.5 % |
| 1885185 | 37.0 | 50.5 | 375 m | ice, snow | 383 s | 15.9 % |
| 1327161 | 35.5 | 35.5 | 325 m | ice | 377 s | 13.0 % |

### Which one to pick

- **`1443866` — the reference.** Most ice overall (48.5 %) and the only entry with a human behind
  it: owner drove it end to end on the pre-fix physics and finished with about 12 s to spare,
  needing to exceed the safe ice speed in places. Use it whenever a change needs comparing against
  a known feel, and when comparing against the parallel codex working copy, which uses the same
  seed.
- **`534501` — the hardest corners.** 725 m of ice sitting inside a bend of |c| ≥ 1.5, half again
  as much as the reference. Ice and asphalt only, so nothing else muddies what you are feeling.
  This is the one for testing the lateral model.
- **`1802200` / `655671` — mixed surfaces.** Four surfaces each with high hazard share; use when
  the change touches surface transitions or the grip ramp rather than ice specifically.
- **`52662` / `47841` / `1885185` — ice against snow.** Snow at 0.55 grip sits between asphalt and
  ice, so these expose whether a change reads as a gradient or as a cliff.
- **`1327161` — tightest fuel.** Bot finishes with 13 % left, the thinnest margin in the set.
  Use for economy and range work.

### Reading the last two columns

**Bot time and fuel are an ideal-driver lower bound, not your run.** They come from
`completability.test.ts`, whose driver anticipates the surface 150 m ahead, eases off for bends,
never overshoots a target speed and never has to recover from a slide. Every seed here completes
5 km inside the 480 s budget with zero off-road excursions. A human will be slower and will use
more fuel — the reference seed's human margin was 12 s against the bot's 61 s. Treat these as
"the route is not impossible", not as a par score.

### Adding more

Sweep with a throwaway test in `src/game/__tests__/` (delete it afterwards) that calls
`resetRoad(seed)` and samples `getSurfaceAt` / `getCurvatureAt` every 25 m. Then **confirm
completability before recording anything here** by temporarily adding the candidates to
`MULTI_SEEDS` in `completability.test.ts` and reading the sweep table — a seed that cannot be
finished is worse than no seed.

**A seed only means something as long as the roll sequence is untouched.** A "hazards must start on
a straight" constraint was tried and reverted precisely because its inserted asphalt fillers
shifted every later roll and turned 1443866 from 48 % ice into 29 % — same number, different road.
If a future change must insert segments, key the rolls off a decision counter rather than
`_segments.length`. The seed is also mixed into the hash additively; see `docs/known-issues.md`.

---

## Graphics direction

Decided 2026-08-09, after the owner reported that traffic reads as a blob at the horizon and still
does not read as a car up close, and proposed three routes: raise the resolution, draw vehicles
mathematically like the road, or reach for glow + dither + LOD.

Two design notes were written independently and then merged; the order below is the merged one.
Full measurements, the disagreements and where each note was wrong are in
`retro/docs/sk/iceroads-grafika.md` (§9 compares them) and
`retro/docs/sk/iceroads-graficky-smer-codex.md`. Decisions and their order live here.

Its one-line summary is worth keeping: **draw meaning in the distance, silhouette in the middle,
geometry up close.**

### What the vehicle actually gets, in pixels

| Distance | Scale | Car on screen |
|---|---|---|
| 220 m | 0.38 | ~8 × 6 px |
| 100 m | 0.43 | ~9 × 6 px |
| 50 m | 0.49 | ~11 × 7 px |
| 10 m | 0.75 | ~17 × 11 px |
| beside you | 1.43 | **~31 × 21 px** |

Sources are 14 × 11 (mini), 22 × 15 (car), 28 × 18 (bus). At 8 × 6 px no body, windows, grille,
wheels and lights can coexist — so at the horizon the goal is not to recognise a model. The player
needs lane, direction, closing speed and threat. Type can wait for a bigger tier.

### Raising the resolution is rejected for this purpose

Vehicle scale never touches `GAME_WIDTH`. From `road3d.ts`:

```
tScale = min(1, (PERSPECTIVE_K / worldZ) / roadHeight)
scale  = 0.28 + sqrt(tScale) * 1.15
```

`roadHeight` is in the **denominator**, so a taller viewport makes distant vehicles *smaller*:

| | 256 × 192 | 320 × 240 |
|---|---|---|
| `roadHeight` | 89 | 130 |
| Car at 50 m | ~11 px | **~10 px** |
| Car right beside you | 31 px | **31 px** — scale saturates at 1.43 |

More pixels changes nothing up close and makes distance worse. Any real gain would need the
projection redefined, the sources redrawn and collisions re-verified together — 10–20 h (nine
pixel-tuned constants plus a truck redraw; see `iceroads-rozlisenie.md`).

Distant vehicles are also *supposed* to be blobs — that is what distance looks like. The fix there
is silhouette and lights, not detail.

If the resolution is ever raised it will be for HUD space, and to 320 × 240 rather than 320 × 200.

### Three faults in how the sprite reaches the screen

**1 · Downscale throws information away, arbitrarily.** `drawTrafficRows` draws a minimum 1 × 1
rect per *source* pixel. Scaling 22 px down to 8, several source pixels land on the same target and
**the last colour wins** — lights, windows and outline have no priority over body. This is the
horizon mush, and it is the fault the owner actually reported.

**2 · Upscale reshuffles between frames.** Near the player `w > srcW`, and every one-pixel change in
`w` changes *which* source columns get doubled, so the pattern boils. **Measured after the shared
raster landed: a one-pixel size step still redraws 8.9% of the sprite, against 9.0% before.** The
coverage resampler was expected to soften this and does not — averaged over widths 8 to 30 the two
are indistinguishable. Quantising the scale is therefore still needed as its own step, and this
note is corrected from the earlier claim that fault 1's fix would carry it.

**3 · Render and collision do not build the same raster.** The renderer maps source → target with
overdraw; collision maps target → source. At downscale these are **not the same algorithm**, so
"pixel-perfect collision" is weaker than claimed at small sprite sizes. This one is a correctness
bug, not an aesthetic one, and it decides the architecture: **one raster per vehicle, feeding draw,
collision and the emissive mask alike.**

`scaleRoadsideRows()` already implements the correct target-driven coverage resampler — aggregate
the source region, track coverage, pick the dominant opaque colour. Roadside uses it; traffic does
not. The fix is largely reuse, not invention.

### Agreed order

| # | Item | Effort |
|---|---|---|
| 0 | Screenshot matrix + `?trafficRenderer=` / `?glow=0` switches, fixed seed from the catalogue above — so every later change is judged against the same frames | 2–4 h |
| 1 | **One shared raster.** `scaleRoadsideRows` for traffic too; the same raster feeds draw, collision and emissive; cache by size | 4–8 h |
| 2 | ~~Far LOD by meaning, tier chosen by **projected height** with hysteresis~~ **far tier done**; a middle tier is still open | 1–2 days |
| 3 | Cheap wins: contact shadow, contrast outline, lights through restrained `glow` | 0.5–1 day |
| 4 | Parametric near-vehicle prototype, one type, behind a flag, with an explicit gate | 1–2 days |
| 5 | Distance fog; night per the decision below | 4–6 h + night |
| 6 | Resolution decision — only here, and probably no | — |

Step 0 first because everything after it is a judgement call about how something *looks*, and those
are worthless without a fixed comparison. Step 1 before any art because it fixes faults 1–3 at once
and may remove much of the problem on today's sprites — measuring the sampler change alone is the
point. Starting with sprite art would be the mistake: 3 types × 2 directions × 3 tiers is already
18 assets before yaw variants.

Step 4 has a gate, and it is a real one: *does a ~20–31 px parametric car look clearly better than a
properly resampled sprite?* If not, stop the procedural direction there rather than widening it.

`glow` (`createGlowLayer` / `drawGlowSource` / `renderGlow`) and `lighting` (`ditherBlack`,
`brightnessAt`, `DarknessLayer`) both ship in zx-kit 0.42 with **zero consumers here**. Ice Haul
does not use `AttrScreen`, so `stampMono(glow: true)` is not available — go through the layer.

### Night mode — open, both paths costed

| Path | Contents | Effort |
|---|---|---|
| Night soon | glow lights → minimal dusk (fixed darkness + headlight cone) → distance fog | 11–17 h |
| Daylight only | glow at low alpha (oncoming lights are on anyway) + distance fog | 7–11 h |

A full day/night cycle is a further 10–16 h and belongs with roadmap phase 9. Distance fog is worth
doing on either path — the strongest depth cue available, and it turns "blob in the distance" from a
defect into an intention.

### What the far tier settled

Two tiers exist today: `far` and `detail`. The far one is **composed at the target size, not
resampled down to it** — the first attempt drew it from a 7 × 5 source and lost, because a mini at
220 m projects to 5 × 4 and the dominant-colour vote deletes a one-pixel lamp exactly where it is
the only thing that matters. Anything whose meaning lives in a handful of pixels has to be built for
the size it will occupy.

Direction is carried by **lamp colour, never body colour**: a same-direction bus is red bodywork, so
"red means going away" only holds if it is the lamps that are red. Type is deliberately not
distinguished in the far tier — mini, car and bus already differ in projected size, and at six
pixels of height nothing else about them can be told apart honestly.

A middle tier — silhouette enough to tell the three types apart — is still open.

### Rules that hold whatever gets built

- **One raster, three consumers.** Draw, collision and glow must read the same rendered raster.
  Collision must never independently rescale the source sprite. Test that every solid pixel of the
  collision mask corresponds to a drawn solid pixel.
- **Glow only on lights, never the body.** Bloom over a whole vehicle just makes a bigger blob, and
  at the horizon two lamps merge into one smear. Start at alpha 0.2–0.35, one pass, downscale 2,
  radius derived from vehicle height and hard-capped.
- **Glow stays opt-in** and never widens the palette; the module promises a byte-identical frame
  when unused, so assert it. Keep `?glow=0` for instant A/B.
- **Dither is for surfaces big enough to hold it** — medium and near tiers only. On a 5–8 px car it
  eats half the pixels and reads as noise. Tie the pattern to vehicle-local coordinates so it never
  changes between frames.
- **Pick the LOD tier by projected height, not `worldZ`** — that survives a future viewport change.
  Needs hysteresis or stable integer boundaries; test that the tier is monotonic and that
  `mini < car < bus` holds inside each tier.
- **A white oncoming vehicle disappears on snow and ice.** A one-pixel dark outline is worth more
  than five interior details.
- **Vehicles are flat billboards even when passing.** Three yaw buckets (left / straight / right)
  would help more than pixel count up close; no continuous 3D yaw needed.
- **Performance:** horizontal spans rather than per-pixel `fillRect`, rasterise only on a cache-key
  change, allocate the glow layer once, never `getImageData` in the game loop.
- **Collisions stay pixel-perfect and screen-space** — `ROADMAP.md` and `docs/collision-study.md`.
  World-space may filter, never decide.
- No bilinear filtering, no full-screen antialiasing. If distant sprites shimmer, the answer is a
  deterministic dither and a stable raster.

## Open decisions

### Braking on ice is deliberately harsh

`SURFACE_BRAKE.ice.lateralLoss = 0.50` means holding the brake costs half the steering. That is
the friction circle and it is correct: a tyre has one force budget, and braking spends what
turning needs. A gentler 0.35 variant was tried and reverted — it made mid-corner braking work,
which is the one thing real ice forbids. The player's counter is the `ICE AHEAD` warning: brake
early, in a straight line, then coast the corner.

**Known inconsistency, deliberately unfixed.** Cornering implies μ ≈ 0.155 (bare ice), but
`decel: 8 km/h/s` implies μ ≈ 0.227 — today it is easier to stop on ice than to turn on it. The
consistent value is `decel ≈ 5.5`, taking the 40 km/h stopping distance from ~28 m to ~42 m. It is
a difficulty increase, so it needs a playtest and a check that `ICE_AHEAD_LOOK_M` still leaves room
to act. Full derivation is in the `SURFACE_BRAKE` comment in `config.ts`.

### Clutch and throttle interaction

Holding `ArrowUp` while pressing `Shift` keeps the throttle open, so the declutched engine rises
toward its 90 % no-load governor; releasing `ArrowUp` lets the revs settle. This matches real pedal
work — most drivers lift for an upshift and manage the throttle deliberately for a rev-matched
downshift. Whether the game should teach that or offer input assistance is open, and deliberately
deferred until it has been played more.

Do not retune clutch or throttle behaviour without an explicit decision from the owner.

---

## Parallel working copy

`../iceroads-codex` is a second working copy of this game with its own unpublished branches and a
map editor. **It is read-only: never write to it** — no edits, no commits, no branch switching, no
git state changes. Read and compare only, and note it has several branches, so comparisons are
usually against a feature branch rather than `main`.
