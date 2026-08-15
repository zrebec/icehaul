# Agent notes — Ice Haul

Working notes that are not derivable from the code. `CLAUDE.md` describes how the game is built;
this file records decisions, benchmarks and open questions. Do not duplicate content between them.

---

## Where to pick up

State at 0.8.0 (2026-08-15), 355 tests. Everything below is done and merged unless marked.

**Controllability** — finished and playtested. Ice at the sharpest curvature holds 40 km/h and every
speed below it, braking included at 30. Grip ramps across surface seams over 20 m. Hazards may start
inside a bend, which is deliberate. `?seed=` and a daily route make any run reproducible; the seed
catalogue below is the benchmark set.

**Graphics** — steps 0 to 2 of the order below are done, plus the growth curve, which was not in the
order and came out of a playtest:

| | what landed | PR |
|---|---|---|
| 0 | Contact sheet harness, `?matrix=1` | #26 |
| 1 | One shared raster for draw and collide | #28 |
| 2 | Far LOD tier — meaning, not a shrunken car | #29 |
| — | Hyperbolic growth curve in world depth | #30 |
| — | Area-weighted resample: growth costs only what the grid forces | #33 |
| — | Fractional scale: the drawing grows a pixel at a time, and the far tier only recolours | #34 |
| 3a | Contrast outline + contact shadow, drawn behind the vehicle | #35 |

| 3b | Traffic fits its lane, and sits in it | #37 |

**The pipeline is done. The drawings are not** — see "The sprites themselves are the bottleneck now"
below, which is the finding that should drive everything next.

Owner after #35: *"the game really has a look now and it comes across a lot better."* The outline
was the cheapest item on the whole list and the first change since #29 that read as an improvement
without needing a measurement to argue for it. Worth remembering when the next item looks expensive.

> **The fleet is frozen until the sprite-or-polygon decision.** More vehicle types are wanted —
> owner asked for them explicitly — but **not yet**. Every new type is an asset that would have to
> be made twice if the answer turns out to be polygons, and the decision is deliberately weeks away
> rather than days. So: redraw the six that exist, do not add a seventh. This is a scope gate, not a
> lack of interest.

**Next, in order:**

0. ~~**Lane fit**~~ — done in #37, and it jumped the queue because the owner reported it while
   playing 0.8.0. See "Two ways a vehicle was not in its lane" below.
1. **Redraw the six traffic sprites by hand.** They were auto-imported and are asymmetric, have
   their rear lamps in the middle of the car, and have no wheel gap. No renderer can fix that, and
   after #35 it is unambiguously the largest thing left.
2. **Lamps through the `glow` layer.** `glow` and `lighting` ship in zx-kit 0.42 with zero consumers
   here.
3. **Distance fog**, then night per the open decision below.
4. **Parametric near vehicle** — the gated spike, and note it is *not* the same as 3D vector; see
   "Parametric, vector, and what each would actually buy".
5. **The far field's remaining stillness** — a mini at 200 m holds one drawing for 1.97 s because
   it is four pixels wide and its true size grows by a tenth of a pixel in that time. The
   resampler cannot touch this; the levers are `TRAFFIC_SCALE_FAR` and `TRAFFIC_VIEW_DISTANCE_M`,
   and both change how distance reads. **Owner's call, deliberately not pulled.**
6. **Resolution** — still rejected; revisit only for HUD space.

A **middle LOD tier is now closed**, not deferred. It existed to soften a handover that no longer
costs anything, and a third tier would only put back a boundary where there is currently none.

### Two ways a vehicle was not in its lane (#37)

Owner, playing 0.8.0: *"cars are still wider than they should be at some close points — it feels
wider than half the road — but we usually don't meet if I keep to my side."* Both halves of that
sentence turned out to be a separate defect, and neither had a test.

**1 · The lane share had a structural hump.** Road width and vehicle size are two different fakes.
Substituting `i = round(150/z) - 1` into the road's law gives

```
half(z)  = ROAD_HALF_TOP + 178.652 / z        additive floor: the ribbon stays readable at the horizon
scale(z) = TRAFFIC_SCALE_A / (z + TRAFFIC_SCALE_B)   additive offset: a vehicle never grows past A/B
```

so the ratio is zero at both limits and must peak in between, at a closed form:

```
z* = sqrt(TRAFFIC_SCALE_B * 178.652 / ROAD_HALF_TOP)
```

At `ROAD_HALF_TOP = 14` that is 20.9 m, and the measured peak of painted silhouette over one lane
was **mini 0.63 · car 0.95 · bus 1.21** — a bus drawn wider than the lane it occupied, from about
40 m to 10 m. Real-world values would be roughly constant at 0.51 and 0.73.

**A constant ratio is not available, and the reason matters.** `half` grows only **1.19×** from
220 m to 50 m while the car grows 2.80×. Pinning size to `half` would put three quarters of the
approach back at 1.2× of growth — exactly the flat far field #30 was built to remove. Re-solving the
two `TRAFFIC_SCALE_*` anchors cannot help either: `z*` depends on `B`, `B` is fully determined by the
anchors, and every combination that lowers the peak below 1.0 collapses the near size below the 29 px
the owner pinned or the far size below the 4 px the far-tier lamps need.

**The lever chosen was `ROAD_HALF_TOP` 14 → 24**, which raises `c0` in the formula above: peak falls
to 0.84, `z*` moves to 16.0 m. It was chosen over reshaping the scale curve because it **does not
touch vehicle scale at all** — the growth curve, the approach cadence (mini sits at 1.97 s of a 2.00 s
budget), the LOD thresholds and every collision raster stay byte-identical, and no existing test
needed its expectations moved. On the truck's own scanline `half` changes by **0.13 px**, so off-road
detection is untouched. The cost is a 48 px ribbon at the horizon instead of 28.

The dial is continuous and may be re-tuned by eye: 20 → 0.94, 22 → 0.89, 26 → 0.80. `laneFit.test.ts`
holds the *property* — never wider than the lane, peak ≤ 0.90, peak interior — not the number.

**2 · Same-direction traffic was never in a lane at all.** `traffic.ts` spawned it at
`x = -0.2 + h4 * 0.5`, range [−0.20, +0.30], centred on **+0.05** — the centre line. The right lane's
centre is +0.50. A bus at the old median put **44 % of its body in the oncoming lane** at 25 m, and no
width curve could make that read as "in its lane". Oncoming was always correct (centre −0.45).

Rewritten to `x = 0.30 + h4 * 0.40`. It consumes the **same `h4` roll**, so the roll sequence is
untouched and the seed catalogue still names the same routes. It **is** a difficulty change —
overtaking now means crossing the centre line — hence its own commit.

**The contact sheet was hiding this.** It hardcoded `x = ±0.35`, tidier than the game has ever been.
`vehicleX` is now an option (`?vx=`), defaulting to the lane centre, and there are `lane-fit` and
`lane-old-vs-new` sheets.

**Correction to what counts as the regression net.** `completability.test.ts` **does not simulate
traffic** — it imports `road`, `vehicle`, `roadgeometry`, `offroad`, `truck` and nothing else. The
seed catalogue is therefore *not* cover for traffic-renderer changes, whatever the wording elsewhere
in this file implies. The real net is `approachCadence` + `approachChurn` + `resampleStability` +
`vehicleLod` + `laneFit` + the contact sheets. It *is* cover for `ROAD_HALF_TOP`, which reaches
`roadgeometry.ts`.

**What is still not right, and is deliberately left.** Even after #37 a bus is 0.84 of a lane at 15 m
and 0.38 at 2 m — a 2.2× swing where reality says 1.0×. The residue is `ROAD_HALF_BOTTOM` (240 px of
road across a 256 px screen) and the player's truck, which is a fixed 32 × 40 px box and occupies
**0.25 of a lane**. Traffic beside the player is consequently still drawn wider than the player's own
truck (bus 41 px against ~29 px). Fixing the truck means a redraw plus a full re-sweep of the seed
catalogue, because `completability.test.ts` and `drive.ts` both derive the off-road box from
`TRUCK_BMP_W/H`. Separate, larger, owner's call.

One more thing worth not rediscovering: **the player's lateral axis is not the road's.** The truck
moves `GAME_WIDTH/2 + v.x * 50` and the vanishing point shifts `LATERAL_SHIFT = 22`, so 72 px per
unit, while traffic's `vehicle.x` moves it `half` px per unit with ±1 the road edge exactly. `x = 0.3`
means two different things for the player and for a traffic vehicle. The `50` is written out four
times (`drive.ts:270`, `drive.ts:551`, `trafficMatrix.ts`, `completability.test.ts`).

### The sprites themselves are the bottleneck now

Owner, after #34: *"we are at a better level but honestly the sprites are terrible — not even a
person with imagination could tell it is a car if they did not already know."*

That is a fair reading and it is **not** a rendering fault. Six PRs fixed how a sprite reaches the
screen; none of them touched what the sprite *is*. Here is `SAME_CAR_ROWS`, the rear of a car, which
is the drawing the player looks at most:

```
....XXXXXXXXXXXXXX....
...XXXXXXXXXXXXXXXX...
..XXXXWWWWWWXXXXXX....   ← window is off-centre: 2 columns of margin left, 4 right
.XXXXXWWWWWWXXXXXXX...
.XXXXXXXXXXXXXXXXXXX..
XXXXXXXXXXXXXXXXXXXXX.
XXXXXXXXXXXXXXXXXXXXXX
XXXXXXRRRRRRRRXXXXXXX.   ← rear lamps as a bar across the MIDDLE
XXXXXRRRRRRRRRRXXXXXX.
XXXXXXXYYYYYYXXXXXXXX.
.XXXXBBBBXXXXBBBBXXX..   ← wheels never separate from the body
..XXXBBBBXXXXBBBBXX...
```

Four defects, all in the art:

- **The rear lamps are in the middle.** On a real car, and on every readable 8-bit car, they are at
  the outer corners — and they are the single feature that says "car, going away from me". The far
  tier has to *re-add* corner lamps precisely because the source art gets this wrong. When the two
  tiers disagree about where the lamps are, the art is the one that is wrong.
- **It is not symmetric.** A car is bilaterally symmetric and this one is not, because it came out
  of `sprite-import.mjs` block-density segmentation of an AI image. Asymmetry at this size reads as
  noise, not as a vehicle.
- ~~**No outline.**~~ **Fixed in #35** — and it was the cheapest of the four by a wide margin. The
  outline is derived from the silhouette, so it needed no art at all. The other three still stand.
- **The wheels never separate.** Rows 10–13 mix black and body colour with no gap for the road to
  show through, so the car has no visible ground contact.

The oncoming sprites are noticeably better — symmetric, headlights at the corners — which is itself
evidence that the problem is the drawing and not the pipeline.

**Do not re-import these from generated images.** The importer earns its keep on roadside scenery,
where lumpiness reads as nature. A vehicle at 16 × 11 has about thirty pixels that matter and each
one has to be placed deliberately.

### Parametric, vector, and what each would actually buy

Owner has raised 3D vector graphics — *"it would be smoother"*. Three different things get conflated
here and they differ by an order of magnitude in cost, so keep them apart:

| | What it is | Buys | Costs |
|---|---|---|---|
| **Hand-drawn sprites** | What exists, drawn properly | Reads as a car. Nothing else changes | 1–2 days |
| **Parametric 2D** | Body drawn from a few filled shapes whose coordinates are fractions of `w`/`h` | Exact at every scale, no source grid at all, no art to redraw per size | 1–2 days for one type behind a flag |
| **3D vector** | Polygon model, projected and filled per frame | All of the above **plus** continuous yaw, which billboards cannot do | Model + filled-polygon rasteriser + z-sorting + palette discipline: a week or more |

Three things worth being clear about before that decision:

- **It would not violate the ZX identity.** The Spectrum had filled-vector driving games — Stunt Car
  Racer, Hard Drivin', the Freescape titles. But it is a *different* Spectrum: Freescape solid-3D
  rather than Pole Position sprite-scaling. That is an aesthetic choice, not a technical one, and it
  is the owner's.
- **It would not remove the LOD tier.** A polygon car at six pixels of height is two or three
  visible faces. Vector helps up close and is worse than a symbol far away, so the far tier stays
  whatever happens.
- **It would slot into the current architecture cleanly.** #34 made the raster an *output* of the
  projection at a fractional scale, so a model rasterised into that same raster keeps draw, collision
  and glow sharing one set of pixels. This is why the spike is cheap to try and cheap to throw away.

**Recommendation: draw the sprites properly first.** A vector model with the same proportions — lamps
in the middle, no ground contact — would read exactly as badly, and would have cost a week to find
that out.

**Timing (owner, 2026-08-15):** the decision is *weeks* away, not days, and it gates the fleet — see
the note under "Where to pick up". Nothing about this needs deciding to keep working: redrawing the
six existing sprites is worth doing under either answer, because it is the only way to learn what a
properly drawn one at this size actually looks like, which is the evidence the decision needs.

### What the approach measurement found

`approachChurn.test.ts` walks a vehicle in one physics tick at a time and compares each frame's
raster with the one before it — the thing the contact sheet cannot see, because it captures single
frames. Both original suspects were wrong, and the real one is neither:

- **The tier pop is not the cause.** Zero frames redraw at a constant size, including the handover,
  which lands on a frame that resizes anyway. It costs 29% of the sprite, but it is explained by
  motion and happens once.
- **The drawing is static, then jumps.** Across 785 frames from 220 m to 2 m at 60 km/h it changes
  only **44 times** — still for about 18 frames, then a fifth to two fifths replaced at once. That
  is the tick.
- **It looked worst where the sprite is smallest** — one pixel of growth is a large share of a
  20-cell raster. That part is real and unavoidable.

### The measurement was counting the wrong thing (#33)

`approachChurn` compared **cells**, aligned top-left. A sprite that grew by stretching evenly has
every cell past the growth sitting one column over, so an honest stretch scores as change. On a car
the two numbers are about **16% of cells against 10% of the picture** — and the conclusion drawn
from the first, that the resampler had two to five times the floor in headroom, does not survive
the second.

The fix is to compare the *picture*: blow both rasters up to one common fine grid, so which cell is
which stops mattering (`__tests__/pictureChurn.ts`). And the floor is measurable rather than
estimated — resample the same sprite from an eight-times finer copy of itself, where the source grid
has stopped being the limit, and whatever change is left is what the target grid forces.

**Against that floor the resampler had almost no headroom at all — except in one specific way.**
Excess over the floor, per one-pixel step, worst case:

| | mini | car | bus |
|---|---|---|---|
| unweighted (through 0.6.0) | 12.1 pp | **13.6 pp** | 9.0 pp |
| area-weighted (#33) | 0.0 pp | 0.5 pp | 0.2 pp |

The fault was not "the resample redistributes columns", which is what the earlier reading suggested
and which no amount of scale quantisation would have fixed. It was that **every source pixel a
target cell touched voted at full strength however little of it was inside**. Scaling 22 px to 21,
most cells sit within one source pixel but the ones straddling a boundary took both at equal weight
— a local 2:1 downscale inside an otherwise 1:1 image. Two consequences, both measured:

- Every downscale drew the vehicle **fatter than it is** — at 13 px wide a mini covered 94% of its
  box against the source's 75% — and the inflation then vanished in a single frame as the sprite
  grew past 1:1. That was the largest step in the whole approach.
- Rasters sat far off the source picture: 16.5% wrong for a car, against 11.2% weighted.

Weighting each source pixel by the area actually covered removes the excess entirely and needs no
new state, no quantisation and no cache changes. `resampleStability.test.ts` holds it: no size step
may change the picture more than a far finer source would, and no downscale may cover more of its
box than the source does.

**Scale quantisation is now off the table** — there is nothing left for it to buy. So is a nested or
column-stable resample: the property those were reaching for is what area weighting already gives.

### The last suspect was the rate, not the cleanliness (#34)

Every measurement up to here asked how *cleanly* each change was made, and by 0.6.1 the answer was
"at the floor the grid forces". The owner still read the approach as steppy. The question nobody had
asked was how *often* a change arrives, and asked in those terms the fault was obvious:

| | changes / 785 frames | median run | **longest freeze** |
|---|---|---|---|
| mini | 28 | 10 frames | **3.07 s** at 220 m |
| car | 44 | 7 | 1.87 s at 169 m |
| bus | 51 | 6 | 2.12 s at 220 m |

Three seconds of a completely motionless vehicle. Counting changes hid it — 44 sounds continuous —
because they bunch up near the player. `approachCadence.test.ts` measures the longest run instead,
and that is the number that matches what a player feels.

**The ceiling had already been reached.** A car takes 28 distinct widths and 19 heights over an
approach, so at most 47 of 785 frames can differ from the one before while *integer size* is the
quantisation. The renderer was using 44 of them. No scale curve could have bought more; the
quantisation itself had to go.

**Two things then had to change together, and measuring told us so.** Splitting by tier showed the
detail tier was already fine — worst freeze 0.22–0.30 s — and the far tier owned the whole fault at
1.87–3.07 s. The far tier covers 220 m down to 28 m (mini), 50 m (car), 67 m (bus), and it composed a
near-rectangle at integer size, which can only grow a whole column at a time. So fixing the resampler
alone would have polished the part that was not broken.

What landed:

- **Sprites are sampled at a fractional scale.** `w`/`h` became outputs — the box is `ceil(span)`
  and the sprite sits inside it at a sub-pixel offset, so each edge cell crosses the coverage
  threshold at its own scale and the drawing grows a pixel at a time.
- **The far tier stopped composing a symbol** and now writes the lamps back onto the resampled
  sprite: outermost body pixels of one row, colour only, never shape. It inherits the fractional
  growth, and the handover has no shape left to change.

| | changes | median run | longest freeze | handover |
|---|---|---|---|---|
| before | 28 / 44 / 51 | 10 / 7 / 6 | 3.07 / 1.87 / 2.12 s | 35% of the picture |
| after | 124 / 187 / 211 | **2 frames** | **1.97 / 0.98 / 0.83 s** | 17%, and no shape change |

**One geometry detail is worth not rediscovering.** Centring the box exactly on the anchor forces an
*even* width — `floor(x - span/2)` and `ceil(x + span/2)` are mirror images about a whole pixel — so
it grows two columns at a time, twice as coarse as the thing being removed. Rounding the box's left
edge instead lets the width follow `ceil(span)` and the vehicle grows alternately leftward and
rightward. The cost is a drawn centre within half a pixel of the anchor, which the display cannot
show. The vertical axis needs none of this, being anchored on an edge rather than a centre.

**What the new tests hold**, replacing "the drawing may only change when the size changes" — a rule
that was right about the symptom and, it turned out, was the fault:

- **The box never shrinks.** Exact, by construction.
- **A frame gives back at most one column's worth of pixels, or a tenth of the silhouette.** Not
  zero, and the reason is honest: resampling a sprite with interior holes — a wheel gap, a tapered
  corner — at a larger scale slides those holes. A whole approach gives back 152 pixels; the worst
  share is 16.7%, which is two pixels off a 5 × 4 mini.
- **The far tier changes colour and never shape**, which is what makes the handover cheap.

**What is left is the floor, and it is in the far field.** A mini at 200 m is a 4 × 3 box whose true
size grows by a tenth of a pixel over two seconds. No resampler can invent a change there. The levers
are `TRAFFIC_SCALE_FAR` and `TRAFFIC_VIEW_DISTANCE_M`, both of which change how distance reads.

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
`w` changes *which* source columns get doubled, so the pattern boils. ~~Measured after the shared
raster landed: a one-pixel size step still redraws 8.9% of the sprite, against 9.0% before, so
quantising the scale is still needed as its own step.~~ **Closed by #33, and the measurement behind
that sentence was counting cells rather than picture** — see "The measurement was counting the wrong
thing" above. Area weighting puts every size step at the floor a far finer source would force, and
scale quantisation has nothing left to buy.

*(Postscript, #34: the instinct behind "quantise the scale" was pointed the wrong way round. The
integer size was not too coarsely quantised — quantising to an integer size **at all** was the
fault. Sampling at the fractional scale removes the step rather than tidying it.)*

**3 · Render and collision do not build the same raster.** The renderer maps source → target with
overdraw; collision maps target → source. At downscale these are **not the same algorithm**, so
"pixel-perfect collision" is weaker than claimed at small sprite sizes. This one is a correctness
bug, not an aesthetic one, and it decides the architecture: **one raster per vehicle, feeding draw,
collision and the emissive mask alike.**

`scaleRoadsideRows()` already implements the correct target-driven coverage resampler — aggregate
the source region, track coverage, pick the dominant opaque colour. Roadside uses it; traffic does
not. The fix is largely reuse, not invention. *(It was correct in shape but not in weight — see
#33 above. Roadside inherited the fix and comes out 3–6% leaner at small sizes, nothing lost.)*

### Agreed order

| # | Item | State | Effort |
|---|---|---|---|
| 0 | Screenshot matrix, fixed seed from the catalogue above — so every later change is judged against the same frames | **DONE** #26. `?matrix=1` plus `scripts/traffic-matrix.mjs`. `?trafficRenderer=` was never built — there was never a second renderer to switch to. `?glow=0` **not built**, nothing emits glow yet | 2–4 h |
| 1 | **One shared raster.** The same raster feeds draw, collision and emissive; cache it | **DONE** #28, and gone further in #34 — the raster now rides on the projection, so there is no size for two readers to re-derive it from | 4–8 h |
| 2 | Far LOD by meaning, tier chosen by **projected height** with hysteresis | **DONE** #29, reshaped in #34 — the far tier now recolours the real silhouette instead of drawing its own. A middle tier is **closed, not deferred** | 1–2 days |
| — | *(not in the original order)* Hyperbolic growth curve in world depth | **DONE** #30 | — |
| — | *(not in the original order)* Area-weighted resample | **DONE** #33 | — |
| — | *(not in the original order)* Fractional scale — growth a pixel at a time | **DONE** #34 | — |
| 3a | Contact shadow + contrast outline | **DONE** #35. Derived from the raster, no art. Kept *outside* the raster so the hitbox is unchanged; `?outline=0` for A/B | 0.5 day |
| 3b | Traffic fits its lane, and sits in it | **DONE** #37. `ROAD_HALF_TOP` 14 → 24 plus the spawn lane fix. Jumped the queue — it came out of a playtest. See "Two ways a vehicle was not in its lane" | 0.5 day |
| 3b′ | **Redraw the six traffic sprites by hand** | **TODO** — the top of the list. See "The sprites themselves are the bottleneck now" | 1–2 days |
| 3c | Lights through restrained `glow` | **TODO** — `glow` and `lighting` still have zero consumers | 0.5 day |
| 4 | Parametric near-vehicle prototype, one type, behind a flag, with an explicit gate | **TODO**, and easier than when it was written: #34 already made size an output. Not the same as 3D vector — see the table above | 1–2 days |
| 5 | Distance fog; night per the decision below | **TODO** | 4–6 h + night |
| 6 | Resolution decision — only here, and probably no | **Still no** | — |

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

### The growth curve, and why the projection could not carry it

Not in the original order — it came out of a playtest report, *"I see it the same
for ages and then it is suddenly on me"*, which measured true:

| distance | 220 | 100 | 50 | 25 | 10 | 2 | 220 → 50 |
|---|---|---|---|---|---|---|---|
| old | 8 | 9 | 11 | 13 | 17 | 29 | **1.4×** |
| new | 4 | 8 | 13 | 19 | 25 | 31 | **3.3×** |

The old `0.28 + sqrt(tScale) * 1.15` had a floor and a square root, and between
them they flattened the far field: three quarters of the approach was worth 3 px
of growth, and the last 48 m trebled the sprite.

**The screen projection cannot express distance here and no scale formula reading
it can help.** `worldZ = PERSPECTIVE_K / dy` with `K = 150` puts 220 m, 75 m and
50 m on scanlines 1, 2 and 3 — the whole far field lives in two pixels of height.
So vehicle scale is now hyperbolic in *world depth*, `A / (z + B)`, with `A` and
`B` solved from two anchors expressed as intent rather than as magic numbers: the
near size is pinned to what it already was, and the far size is set where a car is
4 px wide — small enough to read as distant, wide enough that the far tier's two
lamps still land in separate columns.

The pass-behind branch continues the same curve instead of restarting at a
hardcoded 1.45, so a vehicle no longer changes size on the frame it draws level
with the player.

Canisters and roadside objects still use their own scaling and were left alone.

### What the far tier settled

Two tiers exist: `far` and `detail`. What separates them is **colour in one row and nothing else**.
The far tier takes the resampled sprite and writes lamp colour into the outermost body pixels of a
row near the base, where an edge pixel survives and an interior one is swallowed.

It reached that shape in two steps, and both are worth keeping straight:

- **First it composed a blob at the target size** rather than resampling one down, because a mini at
  220 m projects to about 5 × 4 and the dominant-colour vote deletes a one-pixel lamp exactly where
  it is the only thing that matters. That reasoning was right and still is — the lamps must be
  *placed*, not hoped for.
- **Then it stopped drawing its own shape** (#34). Composing a separate drawing cost 35% of the
  picture at the handover, and being a near-rectangle it could only grow a column at a time, which
  made it the source of the whole approach's steppiness. Recolouring the real silhouette keeps the
  guarantee and drops both costs.

Direction is carried by **lamp colour, never body colour**: a same-direction bus is red bodywork, so
"red means going away" only holds if it is the lamps that are red. Note the source art also puts red
and yellow *inside* the bodywork, so a test looking for the lamps must look for the flanking pair at
the ends of a row, not for the colour anywhere.

Type is still not really distinguished at this size — the silhouettes exist now, but at six pixels of
height they carry no more than the size difference already did. **A middle tier is closed**, not
deferred: it existed to soften a handover that no longer costs anything.

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
  than five interior details. **Built in #35**, and the contact sheets settle it: on snow the lower
  half of an oncoming car used to dissolve into the road, leaving a windscreen and two lamps
  floating. Black on black asphalt is invisible, so the outline costs nothing on the one surface
  where the body already separated — it is self-limiting rather than something to switch per surface.
- **A vehicle's drawn width is only meaningful against its lane.** The road's width law and the
  vehicle's size law are separate fakes, each with its own additive term, so their ratio has an
  interior peak whatever the constants are. Measure the share, not the pixels, and measure it against
  `computeRoadEdges` rather than re-deriving the road.
- **Decoration drawn around a vehicle must stay out of its raster.** Outline, shadow and anything
  else that is *not* the vehicle goes in a parallel mask. Put it in the raster and every hitbox
  quietly grows a pixel on all four sides, which turns a graphics change into a difficulty change.
- **Vehicles are flat billboards even when passing.** Three yaw buckets (left / straight / right)
  would help more than pixel count up close; no continuous 3D yaw needed.
- **Performance:** horizontal spans rather than per-pixel `fillRect`, rasterise only on a cache-key
  change, allocate the glow layer once, never `getImageData` in the game loop.
- **Collisions stay pixel-perfect and screen-space** — `ROADMAP.md` and `docs/collision-study.md`.
  World-space may filter, never decide.
- No bilinear filtering, no full-screen antialiasing. If distant sprites shimmer, the answer is a
  deterministic dither and a stable raster.
- **Resampling weights by area covered, never by pixels touched.** Weighting is what keeps a sprite
  the size it really is at every scale and what keeps growth free of jumps the world cannot explain.
  Anything that resolves a target cell from a source region obeys this.
- **A vehicle's size is an output, never an input.** Rounding a scale to whole pixels and rasterising
  into that box makes growth arrive a column at a time, and that is measurably what "steppy" means.
  Sample at the fractional scale and read `w`/`h` off the result. Anything that wants a size first —
  a cache key, a tier boundary, a collision box — reads it afterwards.
- **Growth may add pixels and must not rearrange them.** The eye reads added pixels as motion and
  moved ones as substitution. Test it in the sprite's *own* frame, anchored bottom-centre: raster-
  local coordinates call growth a rearrangement, and screen coordinates call the vehicle's rush down
  the frame a loss.
- **Judge a change of size by the picture, not by the cells.** Two rasters of different sizes have
  no shared cell identity; compare them on a common fine grid (`__tests__/pictureChurn.ts`), and
  measure against what an eight-times finer source would force rather than against a guess.

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
