# Agent notes — Ice Haul

Working notes that are not derivable from the code. `CLAUDE.md` describes how the game is built;
this file records decisions, benchmarks and open questions. Do not duplicate content between them.

---

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
does not read as a car up close. Full measurements and reasoning live in the Slovak note
`retro/docs/sk/iceroads-grafika.md`; the decisions and their order live here.

### The measured constraint is the source sprite, not the screen

| | |
|---|---|
| Car source sprite | **22 × 15** (`SAME_CAR_ROWS`, `road3d.ts`) |
| Peak draw scale | **1.45 → 1.60** (`projectTrafficVehicle`) |
| Closest car on screen | **~35 × 24 px**, on a 256 px-wide canvas |

A car occupies 35 of 256 pixels. Nothing stops it being drawn 60 px wide today. The limit is that a
22 px source is upscaled 1.6×.

### Raising the resolution is rejected for this purpose

At 320 × 240 the car becomes 44 px **from the same 22 px source** — an upscale ratio of 2.0 instead
of 1.6, so it would look *more* mushy, not less. The cost is 10–20 h (nine pixel-tuned constants
plus a truck redraw; see `iceroads-rozlisenie.md`) for the opposite of the intended effect.

Distant vehicles are also *supposed* to be blobs — that is what distance looks like. The fix there
is silhouette and lights, not detail.

If the resolution is ever raised it will be for HUD space, and to 320 × 240 rather than 320 × 200.

### Likely the biggest single culprit, and it is in none of the proposals

`drawScaledRows` maps source to destination through `floor(sx * w / srcW)`, and `w` grows
continuously with distance. Every one-pixel change in `w` reshuffles *which* source columns get
doubled, so the sprite boils between frames. The eye reads that as an unstable smear long before it
gets to judging detail. Quantising the scale to a small ladder fixes it in a few lines.

### Agreed order

| # | Item | Effort |
|---|---|---|
| A | Quantise sprite scale to a ladder (0.5 / 0.75 / 1.0 / 1.25 / 1.5) | S · 2–3 h |
| B | Contact shadow under each vehicle | XS · 1 h |
| C | Head/tail lights through the `glow` layer | S/M · 3–5 h |
| D | Far LOD tier — clean silhouette plus lights, *less* detail | S · 2–4 h |
| E | Near LOD tier at ~36 × 24 source, tier chosen by `worldZ` | M/L · 8–14 h |
| H | Timeboxed maths-drawn vehicle spike, one type, behind a flag | S/M · 4–6 h |

**20–33 h before night mode.** The order matters: A and B are cheap and change how everything else
looks, so D and E should be re-judged after them. Starting with sprite art would be the mistake.

`glow` (`createGlowLayer` / `drawGlowSource` / `renderGlow`) and `lighting` (`ditherBlack`,
`brightnessAt`, `DarknessLayer`) both ship in zx-kit 0.42 and have **zero consumers here**.

### Night mode — open, both paths costed

| Path | Contents | Effort |
|---|---|---|
| Night soon | glow lights → minimal dusk (fixed darkness + headlight cone) → distance fog | 11–17 h |
| Daylight only | glow at low alpha (oncoming lights are on anyway) + distance fog | 7–11 h |

A full day/night cycle is a further 10–16 h and belongs with roadmap phase 9. Distance fog is worth
doing on either path — it is the strongest depth cue available and it turns "blob in the distance"
from a defect into an intention.

### Rules that hold whatever gets built

- **Glow stays opt-in.** The module promises a byte-identical frame when unused; assert it. Glow is
  an effect on the glass and never widens the palette.
- **Collisions stay pixel-perfect and screen-space** — `ROADMAP.md` and `docs/collision-study.md`.
  World-space may filter, never decide.
- **Quantising the scale changes the collision rect.** Re-check `offroad.test.ts` and
  `road3d-scaling.test.ts`, and add a test for the property itself: sprite width must be *stable*
  across a range of `worldZ`.
- **LOD tier switching flickers at the boundary** without hysteresis. Test that the tier is
  monotonic in `worldZ` and that `mini < car < bus` holds inside each tier.
- No bilinear filtering, no full-screen antialiasing. If distant sprites shimmer, the answer is
  deterministic dither and a stable scale.

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
