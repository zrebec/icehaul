# Agent notes — Ice Haul

Working notes that are not derivable from the code. `CLAUDE.md` describes how the game is built;
this file records decisions, benchmarks and open questions. Do not duplicate content between them.

---

## Where to pick up

State on `main` at `3012ce7` — #76 merged 2026-09-01, package `0.24.0`, **853 tests / 41 files**.
The three-tier graphics work is landed, and so is everything the audit of it raised except the
drawings themselves. Older entries below remain the history that explains its constraints; where
one has been overtaken by the code, it now says so on the spot rather than reading as current.

> **The sprite *pipeline* is finished. The drawings inside it are not.** There are 18 traffic and
> 15 roadside `far / mid / near` JSON assets, all passed through the official ZX sprite validator.
> Their source-grid resolution is independent of the physical projection box, so the extra detail
> did not move traffic in its lane or create a second collision shape — that part is done, and it
> is the win. What the 33 grids *contain* is produced by `scripts/author-lod-sprites.py`: one
> parametric function per family, not nine hand-cut grids. A vehicle's front and rear views share
> their entire upper body. Numbers, and what that leaves open, are in "What the three-tier pass
> established" below. The old decision that a middle tier was closed was explicitly reversed by Fox
> on 2026-08-31.
>
> **§1 (impossible mission) and §2 (continuous score) are both fixed** — the mission rules and the
> scoring rules are now pure modules with their own tests, and the bot simulates three legs. §2½
> records what the 0.8.2 playtest said about where the difficulty actually lives. §3 (snow) and §4
> (surface dominance, not a bug) stand. **The sprite plumbing is done; the art is not** — the
> catalogue, the projection order and the LOD selection are finished and correct, and the drawings
> in them are generated rather than cut. Read "What the three-tier pass established" before adding
> to the graphics queue: two of its five open items are art, not renderer.

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
| 4 | All six vehicles redrawn by hand, and moved to `sprites/vehicles.ts` | #42 |
| 3c | Lamps bloom through the `glow` layer — traffic and the player's own tail lights | #43 |
| — | 33 validated JSON sprite assets and a strict runtime catalogue | `1a817fb` |
| — | Authored grid resolution decoupled from projected physical size | `f6067bd` |
| — | Three authored traffic tiers, with one shared draw/collide/glow raster | `c3df343` |
| — | Seeded roadside bands and clusters | `6f0e88c` |
| — | Perspective `far / mid / near` roadside renderer | `a9031a0` |
| — | Traffic/scenery LOD sheets and real placement captures | `69ff332` |
| — | Review-hardening: hysteretic sheets, production glow order, exact PNG validation | `a1af000` |
| — | The bus drawn as a box, not a stretched saloon | #72 |
| — | The `O` debug overlay, with a collision page | #73 |
| — | A front view and a rear view made two drawings | #74 |
| — | Four overlay corners, load statistics, AABB against pixel-perfect | #75 |
| — | The JSON catalogue made the only source of objects | #76 |
| — | Guards on the scenery approach, and the three artefacts they covered | *this branch* |

**The pipeline was done before the drawings were** — the story of why, and the one measurement the
redraw turned up, are under "The sprites themselves are the bottleneck now" below.

Fox after #35: *"the game really has a look now and it comes across a lot better."* The outline
was the cheapest item on the whole list and the first change since #29 that read as an improvement
without needing a measurement to argue for it. Worth remembering when the next item looks expensive.

> **The fleet is frozen until the sprite-or-polygon decision.** More vehicle types are wanted —
> Fox asked for them explicitly — but **not yet**. Every new type is an asset that would have to
> be made twice if the answer turns out to be polygons, and the decision is deliberately weeks away
> rather than days. So: redraw the six that exist, do not add a seventh. This is a scope gate, not a
> lack of interest.

> **Open, and Fox's, since 2026-08-27:** *Mathematics and geometry — the open questions* near the
> end of this file. Six questions (Q-G1..Q-G6) about the four different projection laws the game
> uses today, written down because they outlive a session. **Q-G4 is the cheap one and the one
> that gates the rest** — it is paper, not code. None of them is scheduled; the queue below rules.

**Next, in order.** Reviewed 2026-09-04, after the audit of the three-tier work closed eight of its
twelve points. The renumbering is the finding rather than a tidy-up: **this is no longer mostly a
graphics queue.** The renderer is measured and closed, its remainder is two art items and one
decision — and meanwhile three *game* resources measurably do not bite.

Done, kept here because the reasons outlive them:

- ~~**Vehicle detail — interior keylines.**~~ **Done 2026-09-01.** The near sources are authored at
  2× the canonical grid and carry black internal structure; mid carries the silhouette/type; far
  keeps direction in its paired lamps. The source grid never grows the projected box.
- ~~**Snow grip.**~~ **Done in #44:** `SURFACE_GRIP.snow` 0.55 → 0.45, exactly the experiment §3
  below asked for, plus the controllability re-pin it warned about (the ordering test now derives
  its expectation from `SURFACE_GRIP` instead of carrying a copy of it).
- ~~**Roadside artefacts, and the guards that should have caught them.**~~ **Done 2026-09-04.**
  See "Scenery hands over for free" above.

Open:

1. **The player's truck has five poses across the whole steering range** (`PLAYER_TRUCK_ANGLES`),
   and yaw is continuous. The only open item Fox reported as a *game* rather than as a picture —
   *„animácie sú skákavé, aj pri zatočení kamióna."* Nine poses is authoring work and does not
   touch the no-rotated-sprites rule, but **collision masks are cab × trailer combinations, so
   nine poses is 81 masks** — check the cache and the module load time before drawing anything.
   Note `docs/smerovanie.sk.md` says the opposite ("the problem is not the number of sprites but
   what drives the joint"); that was written **before #63**, which put the joint on lateral
   velocity, so pose count is genuinely the ceiling now.
2. **Traffic density scaling with distance** — Fox's, from the 0.8.2 playtest (§2½).
   `TRAFFIC_SPACING_M` is the lever; a distance term goes in `game/traffic.ts` where spacing is
   drawn. **Now more valuable than when it was written:** traffic has behaviour worth seeing more
   of, and a queue that forms behind a braking vehicle is a decision the player has to make rather
   than scenery. The gate this sat behind — *"redraw first, then raise the density"* — is **open**:
   the bus reads as a bus (#72) and the two views are two drawings (#74). What is still true is
   that the drawings are generated rather than cut, which is a different objection from the one
   that set the gate.
3. **Local best-per-route.** Nothing stores a score against a seed, so a daily route cannot be
   beaten — which is the whole point of a daily route. The results screen already names the route
   (#61) and `game/prefs.ts` already owns a zx-kit save profile. Half of proposal 4 below, and the
   half that never shipped.
4. **Canisters that cost something to take.** §B is measured: below 87 km/h the road hands out more
   fuel than the truck burns, by 2.1× at the speed Fox actually drives. Fuel is not a resource
   today. Turning a constant is the dull answer; placing canisters where a detour costs something
   is the one that matches what this game is about.
5. **Draw the nine grids by hand.** The pipeline is finished and the drawings inside it are not —
   `author-lod-sprites.py` is one parametric function per family, and a formula cannot make the
   judgement *"this feature has to be wide enough to survive down to four pixels"* that the
   hand-drawn pass made one feature at a time. Needs an eye, so it is a session rather than a task.
   It blocks nothing, and **item 8 of the audit (the mini's cadence) is closed as FAILED, so it
   cannot be used as the reason.**
6. **Decide the fleet colours.** The bus lost `B_YELLOW` — chosen so the brake state existed at all
   — and is `MAGENTA`, which carries the red channel. #72 halved the urgency by doubling the brake
   signal in the framebuffer, but the decision has still never been made or measured. **One drive
   behind a bus, not a task.**
7. **Distance fog**, then night per the open decision below. Glow is in (#43), so the cheap half of
   the "daylight only" path in the night table below is already paid for. After 2–4, though: it is
   polish on a road whose difficulty is being retuned.
8. **Parametric near vehicle** — the gated spike, and note it is *not* the same as 3D vector; see
   "Parametric, vector, and what each would actually buy".
9. **The far field's remaining stillness** — the redraw took the worst case from 1.97 s to 1.28 s
   (a mini at ~192 m) by widening its interior features; the generated grids put it back to 1.83 s
   and two measured attempts failed to move it. A four-pixel-wide vehicle whose true size grows by a
   tenth of a pixel has nothing left to draw differently. The remaining levers are still
   `TRAFFIC_SCALE_FAR` and `TRAFFIC_VIEW_DISTANCE_M`, and both change how distance reads.
   **Fox's call, deliberately not pulled.**
10. **Resolution** — still rejected; revisit only for HUD space. Phase 1 of
    `retro/docs/sk/iceroads-rozlisenie.md` (normalise the constants, kill the three copies of the
    magic `50`) is worth 3–4 h on its own merits and turns the decision into one number. Pairs with
    **Q-G4**, which is paper rather than code and gates the whole "infinite resolution" direction.

#### Five proposals off the 0.11.1 playtest — ideas, not decisions

Written down so they stop living in a chat window. None is scheduled; the queue above still rules.

1. ~~**`feat(traffic)`: traffic that slows for what is ahead**~~ — **DONE 2026-08-19.** It paid two of
   the three ways predicted. The brake lights gained a purpose and the overtake gained a reason; what
   it did not do is read as strongly as hoped, and the measurement says why — see "The brake light was
   erased by its own glow" below. Fox: *"úprimne som asi čakal väčší efekt... je vidno, že brzdia,
   naozaj tá žiara, ale `RED` a `B_RED` v strednom alebo ďalekom LOD prakticky nevidno."* That verdict
   is what put vehicle detail at the top of the queue above.
2. **`feat(mission)`: make the clock bite again** *(2-4 h, but a decision first)*. See §A above for
   the arithmetic and the three levers. Recommendation: pace to 42 and a cap on the bank; leave
   `DELIVERY_TIME_CARRY_PCT` alone, because Fox already decided that once.
3. **`feat(fuel)`: canisters that cost something to take** *(~0.5 day)*. §B shows fuel cannot bite
   below 87 km/h. Turning a constant is the dull answer; the interesting one is to stop scattering
   canisters uniformly and place them where a detour costs something — road edge, mid-bend, on the
   ice — and to thin them out with distance travelled. Fuel stops being a tax and becomes a
   decision, which is the fantasy this game is actually about.
4. **`feat(scene)`: a title screen and a local best-per-route** — **half done.** The title screen
   shipped in #58: `scenes/intro.ts` decodes a native `.scr` at import and carries a menu whose
   options persist through a zx-kit save profile (`game/prefs.ts`), which is also where the glow and
   contour switches ended up. **The local best-per-route did not ship** and is still the whole point
   of the item: the results screen names the route (#61) but nothing stores a score against a seed,
   so a daily route cannot yet be beaten. *(~0.5 day for what is left.)*
5. **`feat(render)`: distance fog** *(4-6 h)*. Next in the graphics queue and glow already paid half
   of it — the layer and the blit order exist. Strongest depth cue available, and it turns "smear on
   the horizon" from a defect into an intention, which is what still reads worst about the far field.

A **middle LOD tier is now shipped**, after Fox explicitly reversed the earlier closure on
2026-08-31 while reviewing the prepared art. The rejected version treated a tier as a second size
law, so it would have reintroduced a visible boundary. The shipped version does not: projection
chooses the physical box first, then selects an authored source grid and resamples it into that box.
At a handover both assets therefore have the same lane position, bottom anchor, outline and collision
extent. The extra boundary buys actual type information without buying a geometry jump.

**"Geometry" is the operative word, and the rest of the trade is real.** The box does not move; the
picture inside it does, because far, mid and near are genuinely different grids. Measured on the
same walk that produced the two-tier figures: **45 % of the picture changes at the far/mid handover
and 36 % at mid/near**, against **17 %** for the arrangement this replaced. That is inherent to
having three drawings rather than one drawing recoloured — it is the price of the tier, not a
defect in it — but it is a price, it is larger than the 35 % that #34 was raised to remove, and
**it has not been playtested yet**. See the record below.

#### What the three-tier pass established — 2026-09-01

- The catalogue is deliberately finite: **18 traffic + 15 roadside = 33** assets. A new vehicle type
  still stays behind the fleet gate because it now costs six drawings, not one.
- JSON is the runtime source of truth. `.rows.txt` is the inspectable exact grid; native and 4× PNG are
  previews only. All 33 passed the official `zx_sprite.py` validator again after implementation.
- Traffic still has one final raster per frame for drawing, collision and lamps; contour remains a
  parallel non-colliding mask. `laneFit`, cadence, churn and resample stability stayed green.
- `?matrix=1&lod=1` samples the real hysteretic traffic handovers from one continuous approach per
  row. Traffic sheets apply scanlines before their deferred glow, matching `main.ts`.
  `?sceneryMatrix=1` covers all five types and
  eight depths; `placement=42` and `placement=1443866` show the real generator rather than synthetic
  objects. Brightness acceptance is always done with `scanlines=1`.

##### Where the tier boundaries actually are

Vehicles switch on **projected height in pixels**, with a one-pixel dead-band, in
`chooseLodTier` (`render/vehicleLod.ts`):

    LOD_FAR_MAX_HEIGHT = 7     LOD_MID_MAX_HEIGHT = 13     LOD_HYSTERESIS_PX = 1

Height is `canonical.h × TRAFFIC_SCALE_A / (worldZ + TRAFFIC_SCALE_B)`, so the same two thresholds
land at a different **distance** for each type. Closing from the far tier the switch happens above
8 px and above 14 px:

| | far → mid | mid → near | share of the 220 m approach spent on `far` |
|---|---:|---:|---:|
| mini | 35.6 m | 5.6 m | **85 %** |
| car | 61.0 m | 20.1 m | 73 % |
| bus | 80.1 m | 31.0 m | 64 % |

Confirmed against the renderer: `approachChurn` reports the car's handovers at 60.8 m and 20.0 m.

**Two consequences to keep in mind before drawing anything else.** The `far` grid does most of the
work — for a mini, a 7 × 6 grid carries five sixths of every approach. And the mini's `near`
28 × 22 grid only appears inside 5.6 m, which at 60 km/h closing is about **0.2 s** before the
vehicle is past; the detail authored into it is very nearly never seen. If a tier's art budget has
to be spent somewhere, `far` and `mid` are where it pays.

Roadside scenery uses the same three names but a **different rule** — `chooseSceneryLod` switches on
*scale*, not pixels, and has **no hysteresis**:

    SCENERY_LOD_FAR_MAX_SCALE = 0.30   →  far → mid at 79.0 m
    SCENERY_LOD_MID_MAX_SCALE = 0.50   →  mid → near at 22.5 m

No dead-band is correct here and the asymmetry is deliberate: scenery only ever approaches, so its
scale is monotonic and cannot oscillate across a boundary. Traffic can close and fall back as it
brakes, which is exactly why vehicles need the dead-band.

##### What the 33 grids actually contain

They are **generated, not drawn**. `scripts/author-lod-sprites.py` builds every vehicle from a
single function `vehicle_sprite(kind, view, lod)`: a trapezoid whose width ramp is three constants
per type, with `detail = {far: 0, mid: 1, near: 2}` gating glass depth, pillars, keylines and the
shaded panel. Roadside types have one function each, of the same nature.

`view` touches only the bottom of the grid. Measured across all nine pairs — share of pixels that
differ between the front and rear view of the same vehicle at the same tier:

| | far | mid | near |
|---|---:|---:|---:|
| mini | 11.9 % | 3.9 % | 4.5 % |
| car | 8.0 % | 3.6 % | 2.9 % |
| bus | 4.8 % | 2.8 % | **2.5 %** |

Roof, glass, pillars, flanks and arches are byte-identical; what differs is the lamp colour
(`R` ↔ `Y`) and one band — plate versus grille. So the catalogue is 18 files and **nine drawings**,
and the tier with the most room for a difference has the least. This matters because of a rule this
file already established and did not repeal: *brightness is exhausted as a carrier, so anything a
vehicle still needs to say has to be said with shape.* After #70, direction is said with **colour
alone** — on the `far` tier, which is 64–85 % of every approach, an oncoming and a receding vehicle
are the same drawing. Lane position still carries it. Nothing else does.

The fleet palette was also re-dealt, without a decision being written for any of the five changes:

| | before #70 | after #70 | what the earlier choice was for |
|---|---|---|---|
| bus, same | `B_YELLOW` | `MAGENTA` | yellow freed red **so the brake state existed at all** (2026-08-19, below) |
| bus, oncoming | `B_RED` | `MAGENTA` | oncoming bus had its own body colour |
| mini, same | `B_MAGENTA` | `B_GREEN` | magenta was picked because *nothing else in the frame uses it*; green was the **car's** colour |
| car, same | `B_GREEN` | `B_BLUE` | new to the fleet |
| mini/car, oncoming | `B_WHITE` | same as their own same-direction body | white was the direction cue |

One of those is an improvement and should be kept: dropping `B_WHITE` bodies removes the pale
oncoming vehicle that dissolves into a snow surface — the defect the contrast contour (#35) was
built to paper over. The other four undo measured decisions as a side effect of replacing the art
pipeline. Glass is now `B_CYAN`/`CYAN` over **13–30 %** of a sprite (`bus-rear-mid` is 30 %), and
an ice surface is dithered `B_CYAN`/`CYAN`; the contour should hold it, but that has not been
looked at on an ice segment.

##### What it cost, measured

Run `npx vitest run --disable-console-intercept -t "prints the profile"
src/render/__tests__/approachChurn.test.ts` and `… approachCadence.test.ts` to reproduce all of this.

- **Handover: 17 % → 45 %.** `same/car`, 220 → 2 m: the far/mid crossing at 60.8 m changes **45 %**
  of the picture and mid/near at 20.0 m changes **36 %**. The handover is once again the largest
  single-frame change of the whole approach, which is the property #34 was raised to remove. It is
  unavoidable once three genuinely different grids exist — but it went unrecorded for a day, and
  that, not the number, was the failure.
- **The outer shape is guarded, the interior is not.** `vehicleArt.test.ts` holds normalized
  silhouette **IoU ≥ 0.85** between adjacent tiers, and `approachChurn` holds the box and ground
  anchor to within 1 px. Both are computed on the outer envelope. The 45 % is interior: `mid` adds
  pillars, a waistline and a shaded panel that `far` does not have, and they arrive in one frame.
  The old assertion *"hands over … without changing shape"* was removed, correctly — it could not
  survive three distinct grids — but nothing replaced what it guarded.
- **Cadence went backwards on the mini**, and the generator is why. *(Attacked on 2026-09-01 and
  closed as **not fixable in the art** — see "The mini's far-field freeze is the floor" below.
  Do not re-investigate.)* Longest hold of one drawing
  against the 2.0 s budget: **1.83 s** for both minis, against 1.17 s / 1.05 s for the hand-drawn
  art; car 0.83 → 1.10 s, bus 0.55 → 0.92 s. All pass. 1.83 s is also the exact figure the
  2026-08-19 redraw rejected twice while tuning the mini's grille and arches. Root cause is old and
  still true: **perfect bilateral symmetry costs far-field motion**, and a formula is perfectly
  symmetric. Splitting the mini's bumper recovered 2.03 → 1.83 s and no further; a hand-cut grid
  recovered it to 1.17 s by widening features one at a time.
- **Silhouette give-back: 16.7 % → 25.0 %** worst share (2 px off a 4 × 3 mini). The assertion is
  unchanged and still passes because the `max(prev.w, solid × 0.1)` column term absorbs it, but the
  comment inside `approachChurn.test.ts` still quotes the old figures.

##### Roadside placement

Decoration is now part of route identity. The scene passes a dedicated stream `(gameSeed + 3) >>> 0`
into a pure `getRoadsideObjects(seed, from, to)`; the renderer grows objects through the whole 220 m
approach and painter-sorts every type together.

- **Nature comes in clusters**, not a uniform scatter: one cluster per 120 m ± 30 m jitter, 2–4
  members each spread ±25 m, 80 % of them on the cluster's primary side.
- **Three bands**, in multiples of road width: `verge` 0.15–0.55 (45 % of rolls), `field` 0.75–1.60
  (35 %), `far` 1.80–3.00 (20 %). Type mix is deciduous 55 %, conifer 30 %, rocks 15 %.
- **Signs are seeded** — every 400 m ± 80 m, either side, in the verge. **Lamps are not**: a fixed
  pair every 180 m at offset 0.15, both sides, identical on every route. That is a deliberate split
  — functional furniture stays predictable, nature carries the identity — but it does mean lamps
  contribute nothing to telling two seeds apart.

##### Scenery hands over for free — 2026-09-04

Traffic had three guards on its approach and scenery had none, which is how a generated tree could
carry a black line through its own crown for three days without a test noticing. It now walks
through the same helper (`walkSceneryApproach` beside `walkApproach`), so the two can never
disagree about what an approach was, and `freezeRuns`/`sameDrawing` needed no change — they work
over `{w, h, raster}`, which `RoadsideProjection` already carries.

Two findings, and the first is stronger than traffic manages:

- **The box and the ground anchor move by exactly zero pixels at both handovers**, for all five
  types, where traffic is only held to within one. The assertion is therefore `0`, not `<= 1`.
  This is what "projection computes the physical box before choosing an asset" buys when the scale
  law is also monotonic — and it is the same monotonicity that makes `chooseSceneryLod` right to
  have no dead-band.
- **`rocks` holds one drawing for 1.83 s**, the worst of the five and the same figure the mini
  reaches. The cause is the same one, recorded above as the floor: its `far` grid is 8 × 5 and
  projects to a **4 × 2** box, the flattest in the game. Nothing there can change while the true
  size grows by a tenth of a pixel. **Not an art defect and not fixable by drawing** — do not
  spend a redraw on it.

| | deciduous | conifer | rocks | sign | lamp |
|---|---:|---:|---:|---:|---:|
| longest freeze | 0.88 s | 0.88 s | **1.83 s** | 1.25 s | 1.22 s |
| changes / 782 frames | 120 | 106 | 87 | 85 | 74 |

The budget is **2.0 s** — the same measured-worst-plus-headroom rule traffic uses, landing on the
same number because both worst cases are the same floor rather than the same tuning. It is not
borrowed from traffic's calibration and must not be re-derived from it.

**One art call in that change is Fox's to veto on sight.** Removing cyan from the rocks left
`rocks-near` with three palette names, and `spriteCatalog.test.ts` requires four of a `near` asset
so that one cannot degenerate into what a two-colour flattener would produce. The test is right and
was not weakened; the fourth colour is two pixels of `B_CYAN` per boulder where the snow cap ends —
cyan as a glint at an edge, which is the one place it belongs on stone. **Also unexamined, and
noticed on the same sheet:** `lamp-near` carries cyan dashes down its pole. Nobody has asked whether
that reads as a metal highlight or as more ice.

##### Runtime consequences worth knowing

- **The glow now measures the lamps off the raster that was drawn.** `pushTrafficLampSpots` calls
  `findLampPair(p.raster, dir)` per vehicle per frame instead of reading a per-sprite cache, so a
  lamp moved one target pixel by the resampler cannot leave its halo behind. Correct, and cheap at
  this size. *(`lampPairFor` and its cache survived for a while as test-only exports carrying a
  comment that claimed they were what the runtime measured. Both were deleted in #76.)*
- **Glow constants did not move.** `GLOW_CORE_MIN_HEIGHT` is still 8 px; it merely stopped being
  described in terms of the old `far/detail` boundary. The glow remains closed.
- ~~**Five modules are now orphaned**~~ **Done in #76.** `render/sprites/{vehicles,conifer,
  deciduous,rocks,signpost}.ts` are gone, and what `vehicles.ts` knew that was nowhere else is
  migrated into this file under "What `sprites/vehicles.ts` knew". `lampPairFor` and its cache went
  with them, so the stale comment noted above no longer exists either.

##### The bus became a box — 2026-09-01

Fox, reviewing the catalogue: the bus does not read as a bus. It did not, and the cause was
structural rather than a matter of taste — every vehicle came out of one `vehicle_sprite` whose
silhouette is a trapezoid, so the bus was the car's shape with a gentler width ramp. It now has its
own law in `bus_sprite`, and the mini and car grids are byte-identical across the change.

**The physical box stays 28 × 18.** It feeds lane fit, growth and collision, so the bus is still
half again wider than it is tall and *height is not available as a cue*. Everything that changed is
something which survives that.

| | before | after |
|---|---|---|
| Sides | taper 0.72 → 1.0 | **vertical**, under a domed roof |
| Glass | 0.42 of the body | **0.28** going away, **0.40** coming at you |
| Lamps | horizontal pair | **stacked corner clusters** |
| Wheels | ~10 % inset | **22 %**, where a bus's rear axle sits |
| Rear only | — | **engine louvres**, low and centred |

**Two things were decided by measurement, and both are worth not rediscovering.**

*The roof is domed because a flat top froze the far field.* A perfect rectangle has edges at only
two x positions, so as it grows every edge cell crosses its coverage threshold at nearly the same
scale — the horizontal form of the symmetry cost this file already records for the mini.

| | longest freeze (budget 2.0 s) | changes / 785 | worst give-back |
|---|---:|---:|---:|
| trapezoid | 0.92 s | 193 | 12.0 % |
| box, flat roof | **1.47 s** | 164 | 8.0 % |
| box, domed roof | **0.83 s** | 176 | 8.0 % |

Flat-topped it was *worse than the shape it replaced*. A coach roof is domed anyway, and the dome
gives the silhouette two more edge positions to move through; the result beats the trapezoid on both
freeze and give-back. **A box that has to grow smoothly needs its corners taken off** — that is the
general form.

*The lamp stack roughly doubles the brake signal in the framebuffer,* which is the answer to the
2026-08-19 finding that a braking bus could only be read from its halo. Cells that change when the
brake comes on:

| | 35 m | 25 m | 15 m | 8 m | 3 m |
|---|---:|---:|---:|---:|---:|
| before | 8 | 8 | 8 | 12 | 18 |
| after | **16** | **12** | **24** | **30** | **40** |

**The front is no longer the rear with recoloured lamps.** A coach head-on is mostly windscreen, so
the front's glass runs deeper and the louvres belong to the back. At `far` the two fractions round to
the same row, so the windscreen is forced one row deeper there explicitly — without it the only thing
separating an oncoming bus from a receding one over 64 % of its approach was the lamp colour and a
four-pixel mask.

##### The front stopped being the rear — 2026-09-01

The catalogue shipped with the two views of a vehicle differing by **2.5-4.5 %** of the grid at
`mid` and `near`, all of it the lamp colour and one band: plate going away, grille coming at you.
Direction was carried by four pixels of colour on a tier that covers most of an approach, in a game
whose own record says brightness is exhausted as a carrier and anything left has to be said with
shape.

| share of the grid that differs | far | mid | near |
|---|---:|---:|---:|
| mini, before | 11.9 % | 3.9 % | 4.5 % |
| **mini, after** | **16.7 %** | **11.7 %** | **10.1 %** |
| car, before | 8.0 % | 3.6 % | 2.9 % |
| **car, after** | **10.2 %** | **10.3 %** | **7.4 %** |
| bus (reshaped in the same day's work) | 14.3 % | 18.7 % | 26.7 % |

**What the front gained, and why each one:**

- **Wing mirrors.** The only difference that reaches the *silhouette* rather than the colours inside
  it, and that is the point: interior detail is what the resample eats first, while an outline pixel
  survives where a body pixel is outvoted — the same reason lamps sit in the outermost columns.
  They hang off the shoulder row, or off the last glass row where the shoulder is already full
  width. **That fallback is the whole reason `far` works**: at `far` the shoulder touches the canvas
  edge on every type, and a mirror clipped against it is not a mirror, it is a missing pixel.
- **Wider headlights.** A headlight is bigger than a tail light on every car ever built.
- **A real grille at `near`** — two dark rows with the plate as a bright bar through them, against
  the rear's single white plate on a plain panel.

**What the rear gained:** the boot lid's shut line, a horizontal seam across the panel. A front's
equivalent is hidden under the glass from head-on, so this is a difference that exists in the real
object rather than one invented to satisfy a threshold.

**The rule now has a test**, in `vehicleArt.test.ts`: the two views of a vehicle at a tier must
differ in **at least 5 %** of the grid, *and* at least one of those differences must lie outside the
rows the lamps occupy. The threshold catches the defect — 7 of 9 pairs failed it as originally
shipped — and the second clause exists to catch the wrong fix, since a share alone could be
satisfied by making the lamps enormous, which is the same mistake in a larger font.

**One thing this did not buy, stated because the opposite was expected.** Mirrors add edge positions
to the silhouette, and on the bus that was exactly what cured a frozen far field. Here it changed
nothing: the mini still holds one drawing for **1.83 s** and the car for 1.10 s, unmoved. At `far` a
mirror is a single pixel and the resample swallows it, so the freeze stays where it was. The mini's
cadence remains open on its own terms.

##### What this leaves open

1. ~~**Is 45 % at 60 m acceptable?**~~ **Accepted 2026-09-01.** The playtest answered it and did
   not reject it — Fox: *„je to plynulé, je to v poriadku."* Accepted is not solved: it means the
   number is known, the reason is known, and we live with it. Three tiers are three drawings, so
   the picture at a handover *must* change; three drawings were the brief. It reopens on one thing
   only — a playtest saying it is visible at 60 m and it grates. The lever then is making `mid` a
   closer relative of `far`, which is again a drawing rather than a constant.
2. ~~**Front and rear need to differ in shape, not only in lamp colour.**~~ **Done 2026-09-01** for
   the whole fleet — the bus as a side effect of its reshape, then the mini and car deliberately.
   See "The front stopped being the rear" below; the rule now has a test.
3. ~~**The bus does not read as a bus.**~~ **Done 2026-09-01** — it had the car's tapering
   trapezoid with a gentler ramp, and now has its own shape law. See "The bus became a box" below.
4. ~~**Two roadside types have visible artefacts**~~ **Done 2026-09-04** — three, in fact, and the
   entry undercounted its own list. `conifer-near`'s black keyline started at 18 % of the grid and
   split the crown; `deciduous-near` drew branches in the trunk's red over the foliage; `rocks-*`
   filled its middle boulder with the cyan this game dithers ice out of. Each was one condition in
   `author-lod-sprites.py`. The scenery approach got its first guards in the same change — see
   "Scenery hands over for free" above.
5. **The colour re-deal needs a decision, not an accident** — the bus especially, where yellow had a
   functional reason recorded below.

### Playtest findings, 0.11.1 — the longest run so far

Fox drove the longest route yet and read the numbers off the new results screen:

| | |
|---|---|
| distance | **9.3 km** |
| total time | 13:21 |
| average speed | 42 km/h |
| canisters | 11 |
| score | 1609 |

Seed **1443866** — the ice-heavy one from the catalogue below, which is why the average is 42 rather
than the bot's 46. Two resources stopped being resources, and both are worth the arithmetic because
they say *where the difficulty is not*.

#### A · The clock stops biting after the first delivery

`MISSION_PACE_KMH = 37.5` is not a guess: it is exactly what the original first leg asked (5 km in
8 minutes). Every later leg gets `length / 37.5` and `DELIVERY_TIME_CARRY_PCT = 1.0` carries all the
slack forward. So the surplus a driver banks per kilometre is

    3600 x (1/37.5 - 1/S)  seconds per km

which at Fox's 42 km/h is **+10.3 s per km, forever** — and at the bot's 46 km/h, +17.7 s. The pace
is set 12-20% below what a competent run actually holds, so the margin does not merely survive, it
compounds. Over this run: about 17.6 minutes granted against 13.4 used.

Three levers, and they are *not* equivalent:

- **`MISSION_PACE_KMH` up** (42-45) — the clock bites again on every leg equally. Simplest, and it
  is the number that is actually wrong.
- **`DELIVERY_TIME_CARRY_PCT` down** — punishes the good driver specifically, and **§2½ is an
  explicit decision by Fox that this stays at 1.0**. Do not touch it without asking again.
- **Cap the bank** (say two legs' worth) — keeps carry-over generous and stops it compounding.

**This reopens §2½ rather than overturning it.** There, Fox decided banked time was not a fault
because the clock was never meant to be the difficulty. Here, Fox calls the same slack "too
benevolent". Both were said after playing; the difference is that the runs are now long enough for
compounding to show. It is Fox's call which way it goes, and it should be made once rather than
drifted into.

##### What was done — the clock now reads the road (0.12)

Fox's call, and not a tune of the constant: the route is a deterministic function of the seed, so
the budget is computed from **this** road. `game/routeplan.ts` is the whole of it, and three things
in it are worth keeping.

**The safe-speed law is read off the measured envelope, not invented.** One line reproduces all
twenty cells of `controllability.test.ts` to within 5%:

    v_safe = min(MAX_SPEED, PLAN_SURFACE_VMAX, 120 / sqrt(max(c, 0.35)) * sqrt(grip))

**The second cap was the surprise.** The cornering law answers "how fast may I take this bend" and
says nothing about drag, so the plan measures what the truck can actually *hold* — full throttle, in
a straight line, through the gears — and the answer is not what the lateral envelope suggests:

    asphalt >=118    ice >=118    snow 45.7    sand 44.4    mud 41.0

**Snow, sand and mud top out in the forties.** Snow holds the road at 120 through a gentle bend and
cannot get anywhere near it. A plan built on cornering alone would have budgeted a snow leg at twice
the truck's actual speed.

**The budget is a speed profile, not a sum.** `Σ(distance / v_safe)` assumes instant speed changes,
and a route alternating asphalt at 120 with ice at 40 spends most of its time doing neither. Two
passes — backwards for braking, forwards for acceleration — so a limit ahead reaches back up the
road as the braking distance it really needs. That is also the game's thesis expressed as
arithmetic: the plan starts slowing about 99 m before the ice, and so must the player.

Plus a standing-start allowance, a flat traffic allowance, a first-leg beginner bonus, and **minus
the time the road is about to hand back**: canisters now pay **+10 s** each (Fox's, and the "cink"
is the point), which at today's spacing is +14.3 s per kilometre — *more* than the 10.3 s/km surplus
this whole feature exists to remove. The budget therefore prices in 60% of them. Never 100%: some
canisters sit at the edge, in a bend or on ice, and budgeting for those would make the clock
unaffordable for anyone driving sanely. Taking a hard one buys time; leaving them all costs it.

Finally the whole thing is clamped to a demanded average between 22 and 80 km/h. **That clamp is
what 0.8.1 did not have.**

##### The calibration table, and what it exposed

`PLAN_SLACK` was picked by measurement, at Fox's brief of *moderate passes, conservative fails*:

| PLAN_SLACK | demanded on seed 42 | moderate | conservative |
|---|---|---|---|
| 1.35 | 43.9 km/h | fails at 4769 m | fails at 4115 m |
| 1.50 | 40.0 km/h | passes, 429 s | fails at 4571 m |
| **1.60** | **37.7 km/h** | **passes, 429 s** | **fails at 4892 m** |
| 1.70 | 35.7 km/h | passes | passes, 487 s |

Across the 21-seed sweep the demanded pace now runs from **33.0 to 45.1 km/h** — the point of the
feature, in one range: the clock is a different number on a different road.

**The table also exposed something structural, and it is the most useful thing to come out of this
work.** At first, four seeds could not be completed by *any* strategy — and they were the
**asphalt-heavy** ones, where the plan demands 40-45 km/h. None of the three bots could deliver it,
because none of them drives differentially: `aggressive` is quick on asphalt and also reckless on
ice (it dies on fuel), `moderate` and `conservative` are uniformly careful and never exceed 65 km/h
anywhere. With a flat pace that never mattered. **With a budget read off the road, using the grip
where there is grip is the entire skill, and there was no bot that could express it.**

So a fourth strategy exists now — `smart` (asphalt 100, snow 42, ice 34, sand 42, mud 38) — and with
it every seed in the sweep is completed by someone. Completion counts at the shipped slack:

    aggressive 8/21 · moderate 13/21 · conservative 2/21 · smart 16/21

`moderate` failing on eight of twenty-one is not a defect. It is the clock biting, which is what was
asked for.

**Two things to watch in the next playtest,** both consequences rather than bugs. Timeout will
become a more common death than fuel or a crash — the results screen's average speed is the
diagnostic for it. And the seed catalogue below now has a second axis: a seed's difficulty is no
longer only what it does to the truck, it is also what the clock asks of it.

#### B · Fuel cannot bite below about 87 km/h

The burn is quadratic in speed but the *time* to cover a kilometre is inversely proportional to it,
so the two collapse into something much simpler than the model looks:

    burn per km = S x (S / MAX_SPEED) x FUEL_BURN_RATE x 3600 / S
                = S x 0.0033          (fraction of tank, asphalt, at today's constants)

Meanwhile the road *pays* a fixed amount per kilometre, because canisters are spaced by distance and
not by time: `1000 / CANISTER_SPACING_M x CANISTER_FUEL` = **28.6% of a tank per km**, if you take
them all. Setting the two equal:

    0.0033 x S = 0.286   ->   S = 87 km/h

**Below 87 km/h the road hands out more fuel than the truck burns**, and it does so by a wider
margin the slower you go — 2.1x at Fox's 42 km/h. Per surface the break-even moves with
`SURFACE_FUEL_MULT`: 72 km/h on sand, 96 km/h on ice. And 87 km/h is above what the controllability
envelope allows on anything but asphalt, so on a careful route fuel is not a constraint at any point.

That matches the run exactly: 11 canisters (220% of a tank) plus a delivery refill (50%) against
about 129% burnt.

Levers, cheapest first: **`CANISTER_SPACING_M` up** (the road pays less often), **`CANISTER_FUEL`
down** (each one is worth less), or **`FUEL_BURN_RATE` up** (which also shortens the range of a
flat-out run, so it is the one that changes the game's shape most). A fourth option is to stop
scattering canisters uniformly and put them where a detour costs something — which is a mechanic
rather than a constant, and probably the interesting answer.

Neither of these is tuned yet. Both are recorded so the next tuning pass starts from numbers.

### Playtest findings, 0.8.1

Fox played the released 0.8.1 end to end and reported four things. All four are recorded here
with the arithmetic behind them; none is fixed yet. The first is the one that matters.

#### 1 · The mission is impossible after the first delivery — **fixed, see the end of this section**

Reported as: *"5 km is doable in 8 minutes, but when you get there you only gain 2 minutes and you
are asked for 22 km, which is impossible."*

It is worse than that, and the "2 minutes" is a misreading of a timer that does not add at all.

- `FIRST_TARGET_DIST_M = 5000`, `DELIVERY_TIME_LIMIT_MS = 8 min` — 5 km at an average of **38 km/h**.
  The bot in `completability.test.ts` runs the catalogue at ~46 km/h and finishes with ~60 s spare,
  so the first leg is correctly tuned.
- On delivery, `drive.ts` does `missionTimerMs = DELIVERY_TIME_LIMIT_MS` — a **reset to 8 minutes,
  not an addition**. What Fox read as "+2 minutes" was the clock jumping from whatever was
  left back up to a full budget.
- `NEXT_TARGET_RANGE = [15000, 25000]`. The same 8 minutes now has to cover **15 to 25 km**.

`MAX_SPEED = 120 km/h`, so the absolute ceiling in 8 minutes — flat out, from the first frame, never
lifting for ice or a bend — is **16.0 km**:

| target | average speed required | |
|---|---|---|
| 5 km | 38 km/h | the tuned first leg |
| 15 km | 113 km/h | theoretically inside the cap, practically not |
| 20 km | 150 km/h | **impossible** |
| 22 km | 165 km/h | **impossible** |
| 25 km | 188 km/h | **impossible** |

So **9 of the 10 km of the target range cannot be reached at any skill level**, and the remaining
1 km requires a speed no route with ice and bends allows. At the bot's demonstrated 46 km/h the
realistic reach in 8 minutes is **6.1 km**.

Two ways to fix it, and they are not equivalent:

- **Scale the budget with the distance** — a km/minute allowance rather than a flat 8 minutes. Keeps
  long legs, makes the clock mean the same thing on every leg.
- **Shrink the targets** to roughly `[5000, 8000]` and keep the flat budget. Simpler, and closer to
  what the first leg already proves works.

Recommend the first: a flat budget is what created the discontinuity, and it will create it again
the next time leg length changes. Either way `completability.test.ts` has to grow a case that walks
**past** the first delivery — today it stops at 5 km, which is exactly why nobody caught this.

Related, and worth fixing in the same pass: the next target is drawn with `hash(deliveryCount * 71)`
— **no `_seed`** — so every route in the game asks for the same sequence of distances. Everything
else about a route is seeded; this is not.

##### What was done

Both fixes, not one: a proportional budget **and** shorter targets. `MISSION_PACE_KMH = 37.5` is not
a new number — it is exactly what the tuned first leg already asks (5 km in 8 min), so
`DELIVERY_TIME_LIMIT_MS` is now *derived* from it and comes out at the same 480 000 ms it always was.
Every later leg gets `length / pace`, so the clock makes one promise everywhere. `NEXT_TARGET_RANGE`
went to `[5000, 8000]`, the draw now mixes in the route seed, and unused time carries over in full
(`DELIVERY_TIME_CARRY_PCT = 1.0`, Fox's call) instead of the clock jumping back to a fixed budget.

The rules left `drive.ts` and became **`src/game/mission.ts`** — a plain state machine with no
canvas, audio or vehicle in it. That is the structural half of the fix: while the mission lived as
three locals inside a scene closure there was nothing to unit-test, which is the real reason this
shipped. `mission.test.ts` now pins the arithmetic and `completability.test.ts` walks **three legs**
through that same state machine.

Measured across five seeds after the fix (aggressive strategy, 3 legs each):

| | |
|---|---|
| legs completed | 15/15, none on banked time — every leg fits its own budget |
| fuel | never ran dry; +50 % refill plus canisters is enough |
| off-road | severity 0.00 — the refuelling detour never leaves the road |
| leg lengths drawn | 5100 – 7470 m, spread across the range |

**One number to watch, and it is a design consequence rather than a defect.** Full carry-over banks
a lot: the ideal driver arrives at drop-off 3 with **15.8 to 21.8 minutes** on the clock, against a
leg budget of 8 to 12. By the third delivery the timer has stopped being a pressure. Fox chose
full carry deliberately and it is one constant to turn down — `DELIVERY_TIME_CARRY_PCT` — but it
wants a playtest verdict rather than a quiet tune. `completability.test.ts` prints the banked figure
per leg on every run so the trend stays visible.

Two things the multi-leg sweep found that are **not** new and were not touched: `moderate` and
`conservative` cannot finish the first leg at all on the ice-heavy catalogue seeds (measured
identical with the canister detour disabled, so it is the strategies, not the detour), and the
single-leg sweep still proves the FUEL OUT path because a one-leg run never collects canisters.

#### 2 · Score is a single lump, and should be continuous — **fixed, see the end of this section**

`score += DELIVERY_SCORE` (500) on delivery is the only thing that ever moves the score. 5 km of
driving, every hazard survived, and the number reads 500 whatever happened along the way.

Fox's proposal, recorded as specified: **10 points per 100 m, multiplied by the surface** —
asphalt ×1.0, ice ×1.4, sand ×1.3, snow ×1.2, mud ×1.1. (Fox wrote "dust"; the surface enum calls
it `sand`.)

It scales sensibly against what exists. Using the measured mean surface mix of a 5 km route
(§4 below), the weighted mean multiplier is **1.085**:

| | continuous | + delivery 500 |
|---|---|---|
| 5 km | 543 | 1043 |
| 10 km | 1085 | 1585 |
| 22 km | 2387 | 2887 |

A 5 km leg entirely on asphalt scores 500, entirely on ice 700 — so the surface bonus is a real but
not dominant signal, which is the right shape. The delivery lump can stay as a completion bonus.

Note the interaction with §1: continuous score makes distance intrinsically worth something, which
weakens the argument for long legs and strengthens "shrink the targets".

##### What was done

Built as specified, in `src/game/score.ts`. Two implementation choices are worth knowing because
neither is visible from the config:

- **Points land in whole 100 m blocks, not per frame.** A `dt`-scaled payout would make the final
  score depend on the frame rate, so the same route would score differently on a slow machine — the
  kind of bug that surfaces months later on someone else's hardware with no way to reproduce.
- **A block is valued at its midpoint**, so one block is worth one surface, chosen deterministically,
  rather than whichever surface was under the wheels on the frame the block ticked over.

Each block's payout is rounded to a whole point. Not cosmetic: `10 * 1.1` is `11.000000000000002` in
binary floating point, and the top bar prints the score with `toString()`.

Measured on real routes, 5 km of driving before the delivery bonus:

| | |
|---|---|
| all asphalt / all ice | 500 / 700 — the control numbers from the spec |
| seed 42 (ordinary mix) | 565 |
| seed 1443866 (48.5 % ice) | 608 |

So the ice premium is worth about 8 % on a heavy route against an ordinary one — present, readable,
and nowhere near enough to make farming ice a strategy. Which is the shape that was wanted.

#### 2½ · What the clock is actually for — 0.8.2 playtest

Fox, after playing the proportional budget: *"time was not the brake. The brake was that I nearly
crashed several times because of the traffic — and that is fine, that is how it should be."*

Two things follow, and both are decisions rather than observations:

- **The banked-time figure is not a problem to fix.** The measurement stands — the ideal driver
  reaches drop-off 3 with 15.8 to 21.8 minutes on the clock — but a slack clock is only a fault if
  the clock was meant to be the difficulty. It is not. `DELIVERY_TIME_CARRY_PCT` stays at 1.0 and
  nothing here gets tightened to compensate. **Do not "fix" this without being asked.**
- **Traffic is the difficulty, and it is under-supplied.** Fox wants more of it, scaling with
  distance travelled: the longer a run, the busier the road. That is a real mechanic and not a
  tuning tweak — it interacts with the frozen fleet (six sprites, no seventh until the
  sprite-or-polygon decision) because more traffic means seeing the same six drawings more often,
  which raises the cost of them being wrong. So: **redraw first, then raise the density.**

Recorded as a decision by Fox, not yet implemented. `TRAFFIC_SPACING_M` is the lever; a distance
term would go in `game/traffic.ts` where spacing is drawn.

#### 3 · Snow is too easy

Fox: *"snow is honestly quite easy to steer on."*

`SURFACE_GRIP.snow = 0.55` sits halfway between asphalt (1.0) and ice (0.25), and the real penalty
on snow is `SURFACE_DRAG.snow = 4` — it slows you rather than loosening you. That is a defensible
model of packed snow, but it means snow never asks the player to change what they are *doing*, only
to wait. Ice is the only surface that demands a decision.

Not tuned yet, and it should not be tuned blind — `controllability.test.ts` pins what each surface
holds at each curvature, so the change is "pick the target numbers, then move the constant", not the
other way round. Cheapest experiment: drop grip toward 0.45 and drop drag, so snow becomes mildly
slippery rather than merely slow.

**Done in #44**, and the cheap half of it: `SURFACE_GRIP.snow` 0.55 → 0.45, drag left alone. Snow
now holds 55 km/h through the sharpest curve against mud's 60 — *below* mud, which is new and is
what the ordering test caught. At equal grip `SURFACE_STEER_DAMP_MULT` (1.0 vs mud's 1.5) and
`SURFACE_CURVE_DRIFT_MULT` (0.36 vs 0.35) decide, and they both favour mud. That is a defensible
model — mud is sticky, snow is slippery — but it means **snow is now the third-hardest surface
rather than the second**, which nobody has played enough to have an opinion about yet.

#### 4 · Why one surface dominates a route — measured, and not a bug

Fox: *"if the first surface is mud, most of the route ends up mud. I do not think it is a bug but
I want the explanation."*

The observation is real, the generator is fine, and the cause is sample size. Swept 3000 seeds over
the first 5 km, sampling every 5 m:

```
mean surface segments per route            10.5   (about half of them recovery asphalt)
mean share of the whole route: asphalt 62.0%  snow 14.4%  mud 10.5%  ice 6.6%  sand 6.5%
largest single special surface holds       55.2% of all non-asphalt metres
```

**The hash is not biased.** Measured pick frequency against what `SURFACE_PROBABILITY` asks for:

| | measured | config |
|---|---|---|
| snow | 31.7 % | 31.4 % |
| ice | 31.3 % | 31.4 % |
| mud | 22.9 % | 22.9 % |
| sand | 14.1 % | 14.3 % |

So three things stack, and none of them is a defect:

- **A 5 km route contains only ~5 special segments.** `START_ASPHALT_M = 1000` eats the first
  fifth, and `RECOVERY_ASPHALT_PCT = 0.85` puts asphalt after almost every hazard. Five draws from
  four surfaces will look lopsided most of the time — that is what five draws do.
- **The first special is one of those five**, so conditioning on it moves the average mechanically.
  Measured: first = snow → snow holds 52.0 % of special metres (against 31.4 % unconditionally);
  first = mud → 43.9 % (against 22.9 %); first = sand → 37.2 % (against 14.3 %).
- **Ice is the exception, and it is deliberate.** first = ice → ice holds only **29.0 %**, *below*
  its unconditional share. `SURFACE_LENGTH_RANGE.ice = [100, 300]` against `[100, 800]` for
  everything else, so ice segments average 200 m where others average 450 m. Ice is picked as often
  as snow and covers half the ground.

**So a route is a small sample by design, and ice is short by design.** If routes should feel more
mixed the lever is route length or `START_ASPHALT_M`, not the hash — and note that changing either
reshuffles every seed in the catalogue below.

The sweep was a throwaway test in `src/game/__tests__/`, deleted after reading, per "Adding more".

### Two ways a vehicle was not in its lane (#37)

Fox, playing 0.8.0: *"cars are still wider than they should be at some close points — it feels
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
Fox pinned or the far size below the 4 px the far-tier lamps need.

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
`TRUCK_BMP_W/H`. Separate, larger, Fox's call.

One more thing worth not rediscovering: **the player's lateral axis is not the road's.** The truck
moves `GAME_WIDTH/2 + v.x * 50` and the vanishing point shifts `LATERAL_SHIFT = 22`, so 72 px per
unit, while traffic's `vehicle.x` moves it `half` px per unit with ±1 the road edge exactly. `x = 0.3`
means two different things for the player and for a traffic vehicle. The `50` is written out four
times (`drive.ts:270`, `drive.ts:551`, `trafficMatrix.ts`, `completability.test.ts`).

### The sprites themselves are the bottleneck now — **redrawn, see the end of this section**

Fox, after #34: *"we are at a better level but honestly the sprites are terrible — not even a
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

#### What the redraw did, and the one thing it taught

All six are hand-drawn in **`src/render/sprites/vehicles.ts`** — moved out of `road3d.ts`, next to
the roadside sprites, because a hundred lines of art inside a renderer is a hundred lines nobody
edits. Dimensions are untouched (mini 14×11, car 22×15, bus 28×18, trailing empty row kept), so the
projection, the LOD boundary, the lane-fit property and every collision raster are undisturbed:
this is a redraw, not a re-scale. Colours are untouched for the same reason.

`vehicleArt.test.ts` pins the rules as properties rather than pixels — symmetry, lamps at the
outermost columns, nothing but wheels below the bumper, road between them, a colour defined for
every char drawn, and the size box. It was checked against the old art and fails on four of them,
which is the only way to know a test of this kind is worth having.

**The finding worth keeping: symmetry costs far-field motion, and the cure is feature width.**

The first symmetric mini failed `approachCadence` — it held one drawing for **2.58 s** at 204 m,
against a 2 s budget and against **1.97 s** for the sprite it replaced. That is not a regression in
the renderer. The old mini's off-centre window flipped on and off as the sampling grid drifted and
each flip counted as a change, so part of what the far field had been reading as *motion* was the
asymmetry flickering — the exact noise the redraw exists to remove.

The fix was art, not budget. The same mini's rear window and plate were six pixels wide where the
oncoming mini's were eight, and the oncoming mini was already fine at 0.95 s. Widening both to eight
gave **1.28 s** — better than the sprite it replaced, symmetry kept. **A feature has to be wide
enough to survive down to four pixels, or it stops contributing at the distance where contribution
is scarcest.** Longest hold across the fleet afterwards:

```
same      mini 1.28 s   car 0.83 s   bus 0.57 s
oncoming  mini 0.95 s   car 0.83 s   bus 0.82 s
```

One renderer change came with it, and it is the far tier honouring what its own comment already
promised. `applyFarLamps` picks the row above the base "so the lamps sit on the body rather than in
the wheels", and it tested only for a row that was *entirely* transparent. Now that wheels are
genuinely separated, the row is often *split* — opaque at both ends, road between — and the bus at
half scale was getting red lamps painted onto its tyres. It now walks up to the first unbroken run
of body.

**Still open, and deliberately not taken:** the same-direction bus is `B_RED` bodywork with `RED`
lamps, the weakest lamp contrast in the fleet, and `applyFarLamps` writes exactly that near-invisible
colour. The redraw works around it with a black inboard edge on each lamp cluster. The real fix is a
body colour that is not red — `B_YELLOW` frees red entirely and no other vehicle is yellow — but
that is a repaint and a visible one, so it is Fox's call rather than something smuggled in
with a redraw.

### Parametric, vector, and what each would actually buy

Fox has raised 3D vector graphics — *"it would be smoother"*. Three different things get conflated
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
  is Fox's.
- **It would not remove the LOD tier.** A polygon car at six pixels of height is two or three
  visible faces. Vector helps up close and is worse than a symbol far away, so the far tier stays
  whatever happens.
- **It would slot into the current architecture cleanly.** #34 made the raster an *output* of the
  projection at a fractional scale, so a model rasterised into that same raster keeps draw, collision
  and glow sharing one set of pixels. This is why the spike is cheap to try and cheap to throw away.

**Recommendation: draw the sprites properly first.** A vector model with the same proportions — lamps
in the middle, no ground contact — would read exactly as badly, and would have cost a week to find
that out.

**Timing (Fox, 2026-08-15):** the decision is *weeks* away, not days, and it gates the fleet — see
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
"at the floor the grid forces". Fox still read the approach as steppy. The question nobody had
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
| *and today (#70)* | *121 / 175 / 193* | *2 frames* | *1.83 / 1.10 / 0.92 s* | *45% far→mid, 36% mid→near* |

> **The last row is not this pull request's result — it is what three authored tiers did to it
> later.** The freeze and handover columns both moved the wrong way, for reasons recorded under
> "What the three-tier pass established" at the top of this file. Everything the rest of this
> section explains about *why* the numbers behave as they do still holds; only the "after" figures
> stopped being the current state.

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
  corner — at a larger scale slides those holes. A whole approach gave back 152 pixels; the worst
  share was 16.7%, which is two pixels off a 5 × 4 mini. *With the authored grids it is 137 pixels
  and a worst share of **25.0%** — still two pixels, now off a 4 × 3 mini, so it is the same floor
  measured on a smaller box. The assertion is unchanged and passes on its column term.*
- ~~**The far tier changes colour and never shape**, which is what makes the handover cheap.~~
  **Superseded 2026-09-01.** With three authored grids the far tier draws its own art again, so the
  handover changes shape by construction and costs 45% of the picture. The guarantee that replaced
  this one is weaker on purpose: silhouette IoU ≥ 0.85 across a handover, plus a box and ground
  anchor that may not move more than a pixel. The interior is no longer held by anything.

**What is left is the floor, and it is in the far field.** A mini at 200 m is a 4 × 3 box whose true
size grows by a tenth of a pixel over two seconds. No resampler can invent a change there. The levers
are `TRAFFIC_SCALE_FAR` and `TRAFFIC_VIEW_DISTANCE_M`, both of which change how distance reads.

### The debug overlay, and what it is for — 2026-09-01

`O` cycles `off → stats → collision`. The frame monitor is zx-kit's; the rest is this game's, and
two parts of it are decisions rather than plumbing.

**The load corner is four numbers, not one.** An instantaneous CPU figure is the frame you happened
to sample. `MIN`/`MAX`/`AVG` and the **worst one per cent** over a 600-frame window say whether the
budget is comfortable, occasionally tight, or being missed — and the 1 % is the one that matters,
because a mean of 6 % with one frame in a hundred at 90 % is a stutter you feel and a mean you
cannot see it in. Nearest rank, not an interpolated percentile: below a hundred samples the worst
one per cent is simply the worst sample, and saying so beats inventing a number between two frames
that both happened. The window fills every frame, not only while the overlay is open, so opening it
to look at a stutter that has already happened shows the window it happened in.

**Collision mode exists to make "pixel-perfect" testable by driving.** The rule has always been that
collision reads the same final raster the renderer drew, but until now the only way to check it was
to trust a unit test. Every vehicle now draws two things at once:

- a **yellow AABB**, tight around what the mask actually occupies rather than its declared size —
  an articulated 40-wide truck has no 40-wide row, and using the declared width would flatter the
  cheap model;
- a **cyan silhouette trace**, the outermost solid cell of each row, which is the boundary
  `checkTruckTrafficCollision` really walks.

`AABB n / PIX n` counts how many vehicles the boxed model would have called a crash against how many
the real one did. **`PIX` must never lead `AABB`** — a pixel overlap without a box overlap is
geometrically impossible and would mean one of the two is reading the wrong raster. The gap in the
other direction is the point: every frame where `AABB` is 1 and `PIX` is 0 is a crash the player
would have suffered for nothing.

`pixelMaskBounds`, `rasterBounds` and `aabbOverlap` live in `game/offroad.ts` beside the real check,
are pure, and are tested — including the L-shape case where two boxes overlap and no occupied cell
does, which is the whole argument in four lines.

**Labels name the thing, not the test.** The first version wrote `ROAD` over the truck, which is the
name of the check rather than the name of the object; read back, it is simply wrong. Boxes now say
`TRUCK`, `CAR`, `BUS`, `MINI`.

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

The road, traffic, canisters and roadside placement are deterministic functions of one seed, so **a seed is the
whole route**. Load one with `?seed=<decimal>`:

```
http://localhost:5174/?seed=1443866          dev
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
  it: Fox drove it end to end on the pre-fix physics and finished with about 12 s to spare,
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

**These two columns are still a 5 km, single-leg measurement** — that run collects no canisters, so
the numbers stay comparable with everything recorded before the mission fix.

The bot no longer stops there, though. A separate block walks **three legs** on five of these seeds
through the real `game/mission.ts`, refuelling from canisters on the way; that is what now answers
"can the game be finished", and it is the block that would have caught §1 of the playtest findings.
Its per-leg table prints on every run.

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

Decided 2026-08-09, after Fox reported that traffic reads as a blob at the horizon and still
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
| 220 m | 0.20 | ~4 × 3 px |
| 100 m | 0.38 | ~8 × 6 px |
| 50 m | 0.60 | ~13 × 9 px |
| 25 m | 0.86 | ~19 × 13 px |
| 10 m | 1.15 | ~25 × 18 px |
| 1.2 m anchor | 1.43 | **~32 × 22 px** |

The **canonical physical boxes** are 14 × 11 (mini), 22 × 15 (car), 28 × 18 (bus); the authored
source grids may be half-size, canonical-size or 2× without changing those numbers. At 4 × 3 px no
body, windows, grille, wheels and lights can coexist — so at the horizon the goal is not to recognise
a model. The player needs lane, direction, closing speed and threat. Type arrives in mid.

### Raising the resolution is rejected for this purpose

Vehicle scale never touches `GAME_WIDTH`. The current law is:

```
scale = TRAFFIC_SCALE_A / (worldZ + TRAFFIC_SCALE_B)
```

The hyperbola is anchored in world depth, not viewport height, and the canonical box—not the LOD
source grid—turns it into pixels. Raising framebuffer resolution would still require redefining the
anchors, road geometry, HUD and player truck together; merely supplying a larger source asset now
proves that source resolution alone does not enlarge an object.

Distant vehicles are also *supposed* to be blobs — that is what distance looks like. The fix there
is silhouette and lights, not detail.

If the resolution is ever raised it will be for HUD space, and to 320 × 240 rather than 320 × 200.

### Three faults in how the sprite reaches the screen

**1 · Downscale throws information away, arbitrarily.** `drawTrafficRows` draws a minimum 1 × 1
rect per *source* pixel. Scaling 22 px down to 8, several source pixels land on the same target and
**the last colour wins** — lights, windows and outline have no priority over body. This is the
horizon mush, and it is the fault Fox actually reported.

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
| 0 | Screenshot matrix, fixed seed from the catalogue above — so every later change is judged against the same frames | **DONE** #26. `?matrix=1` plus `scripts/traffic-matrix.mjs`. `?trafficRenderer=` was never built — there was never a second renderer to switch to. `?glow=` **built in #43**, and it takes a strength and a radius as well as an on/off. **#43 also found the sheet's one lie** — it drew no scanlines, so every brightness judgement made on it over-read by 1.54x; `?scanlines=1` and `?brake=1` close that | 2–4 h |
| 1 | **One shared raster.** The same raster feeds draw, collision and emissive; cache it | **DONE** #28, and gone further in #34 — the raster now rides on the projection, so there is no size for two readers to re-derive it from | 4–8 h |
| 2 | Far LOD by meaning, tier chosen by **projected height** with hysteresis | **DONE** #29/#34, then superseded by Fox's 2026-08-31 decision. `c3df343` ships three authored source grids selected after physical projection; far/mid/near share one box and one final raster | 1–2 days |
| — | *(not in the original order)* Hyperbolic growth curve in world depth | **DONE** #30 | — |
| — | *(not in the original order)* Area-weighted resample | **DONE** #33 | — |
| — | *(not in the original order)* Fractional scale — growth a pixel at a time | **DONE** #34 | — |
| 3a | Contact shadow + contrast outline | **DONE** #35. Derived from the raster, no art. Kept *outside* the raster so the hitbox is unchanged; `?outline=0` for A/B | 0.5 day |
| 3b | Traffic fits its lane, and sits in it | **DONE** #37. `ROAD_HALF_TOP` 14 → 24 plus the spawn lane fix. Jumped the queue — it came out of a playtest. See "Two ways a vehicle was not in its lane" | 0.5 day |
| 3b′ | **Redraw the six traffic sprites by hand** | **DONE** #42. All six redrawn and moved to `sprites/vehicles.ts`; the five rules are held as tests rather than as pixels. See "The sprites themselves are the bottleneck now" | 1–2 days |
| 3c | Lights through restrained `glow` | **DONE #43 and CLOSED 2026-08-19** — playtested and signed off, see "The glow is finished" below. Traffic lamps and the player's own tail lights; positions read off the art, halo clipped to the viewport, `?glow=0` for A/B. `lighting` still has no consumer | 0.5 day |
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

`glow` (`createGlowLayer` / `drawGlowSource` / `renderGlow`) has one consumer since #43 —
`render/vehicleGlow.ts`. `lighting` (`ditherBlack`, `brightnessAt`, `DarknessLayer`) still has none,
and is the module night would be built on. Ice Haul does not use `AttrScreen`, so
`stampMono(glow: true)` is not available — go through the layer.

### What the glow landed as (#43)

Half a day, as costed. Four decisions are worth keeping:

- **The lamps are read off the art, never declared.** This was planned as a hand-written table of
  lamp coordinates, because the *imported* sprites used `Y` and `R` for bodywork as well as for
  lamps and a rule that looked for the colour would have lit the whole vehicle. #42 landed first and
  removed the need: the redrawn sprites put lamps in the outermost columns and use the direction's
  lamp char nowhere else, so the position is now a measurement — the centroid of each side's lamp
  cells, normalised to the sprite box. **A redraw moves the halo with the lamp for free.** The
  planned table would have been one more thing to keep in step with the pixels, which is the
  mistake `road3d.ts` already made once with sprite dimensions.
- **The same trick works on the player's truck** and for a stronger reason: its `red` layer contains
  its two tail lamps and nothing else, so the centroids are exact. They brighten on the brake, which
  is the only light in the game that answers an input.
- **The blit is clipped to the road viewport, and happens last of all.** `renderGlow` covers the
  whole canvas, and a vehicle sitting under the horizon would otherwise wash the status bar.
  Instruments stay flat. And since the scanline finding below, it goes on *after* the scanlines
  too — from `main.ts` rather than from the scene, which now only fills a buffer.
- **`?glow=` takes a strength and a radius, not just an on/off** (`0` off, `1` on, `0.5` on at that
  alpha, `0.8,1.5` also half again the radius). Both are judged by eye, and needing a rebuild between
  two comparisons is how a comparison gets lost. Anything ≥ 1 in the first slot means "on" rather
  than alpha 1.0. It paid for itself immediately — the four alpha rows below were four page loads,
  not four builds.

#### The costed alpha was too low, and the reason generalises

`AGENTS.md` costed the bloom at **alpha 0.2–0.35** before anything emitted glow. The sheets say
that is too low for this frame, and the arithmetic behind it is worth keeping because it applies to
any future emissive work here:

| alpha | pixels changed | mean delta | peak delta | reads as |
|---|---|---|---|---|
| 0.28 | 0.61 % | 14 | 66 / 765 | present in the diff, invisible to the eye |
| 0.35 | 0.64 % | 17 | 82 | still a hint |
| **0.60** | 0.72 % | 26 | 142 | **light, at 100 m and at 25 m** |
| 0.90 | 0.77 % | 37 | 214 | starts smearing the vehicle |

*(oncoming car, zoom 6, asphalt, `?glow=` against `?glow=0`.)*

**A lamp is already `#FFFF00`, and additive light cannot brighten a saturated channel.** The blob's
peak lands exactly where it can do nothing; everything the player sees is the *tail* of it falling
on the dark road. A guideline borrowed from bloom over photographic content therefore under-reads
badly on flat palette art.

The same effect, worse, on **the player's own truck**: its lamps are ringed by a white bumper and
cyan wheels, so a halo sized for a distant car is spent on pixels it cannot change. `radius 5,
intensity 0.45` measured a peak of **32 / 765** — not a dim halo, *no* halo.

#### And even 0.60 was invisible in the game, because the harness was lying

Fox played the branch: *"glow brzdových svetiel prakticky nevidno, a keď brzdím, žiadna zmena."*
The table above was right about the sheet and wrong about the game, and the gap is a property of the
harness rather than of the renderer:

- **`main.ts` draws `drawScanlines(ctx, SCANLINE_ALPHA = 0.7)` over every finished frame.** That is
  a 70 %-black line on every odd *device* row; at `CANVAS_SCALE = 4` it darkens two of the four rows
  of every game pixel, so **the whole picture plays at 0.65** — bloom included, because the bloom
  was underneath it.
- **`?matrix=1` draws no scanlines at all.** It is a static path with no frame loop. Every number in
  the table above was therefore measured **1.54× brighter than the game**.

Two fixes, and the first is worth more than all the tuning:

1. **The bloom is blitted after the scanlines.** The scene now fills a pending buffer
   (`pendingGlow()`), `main.ts` empties it with `renderPendingLampGlow(ctx)` after `drawScanlines`.
   Free brightness, and truer: light belongs on the glass, in front of the mask. The halo fills the
   dark rows instead of being cut by them, which is what a hard-driven phosphor actually does.
2. **The sheet can wear the scanlines** — `?matrix=1&scanlines=1`, applied to the *output* rows so
   it holds at any zoom. **Use it for anything about brightness.** Off by default so the reference
   sheets from #26 onward stay comparable.

The sheet had a second blind spot: it drew the truck cruising only, so the brake could not be judged
without driving. `?brake=1` fixes that.

#### Where it ended up

Fox's call, explicitly: *"trochu modernejšie, aj za cenu malej straty ZX identity"*. So the bloom
is now arcade-sized — `alpha 0.8`, **two passes**, radius `1.4 × drawn height` capped at 18 px — and
each lamp gains a **white-hot core**: a second, small `B_WHITE` source on the same spot. White raises
the green and blue channels of a red lamp, so the lamp itself blows out toward white instead of
staying a flat rectangle with a glow beside it. That is the change that makes it read instantly.

Measured after all of it, **with scanlines on**, so these are numbers about the game and not about
the sheet:

| | changed | mean delta | peak |
|---|---|---|---|
| traffic, round 1 (no scanlines, over-read) | 2.5 % | 15.7 | 142 / 765 |
| **traffic, round 2 (with scanlines)** | **5.6 %** | **47.3** | **606** |
| **player braking vs cruising** | **4.3 %** | **42.0** | **292** |

Two constraints on the core, both deliberate:

- **Only above `GLOW_CORE_MIN_HEIGHT` (10 px, ~50 m for a car).** This is a light-core threshold,
  independent of the later far/mid/near asset boundaries. White
  desaturates the halo it sits in, and far away that halo's *colour* is the only thing carrying
  which way the vehicle is going. Close up the shape already says it, so the light may blow out.
- **The brake carries three changes at once** — brighter, bigger, and cored. A signal carried by one
  number is exactly what round 1 was.

Since then the brake is carried in the **framebuffer** as well, and that is the more important half:
a same-direction vehicle's tail lamps are `RED` rolling and `B_RED` braking, and so are the player's
(`TRUCK_LAMP_COLORS`). `?glow=0` is a setting a player may choose, and "the vehicle ahead is
stopping" is safety information rather than decoration, so it has to survive the lights being off.
Two vehicles are deliberately left out: **oncoming traffic** (its lamps face the player, whatever it
is doing with its brakes is behind it) and the **same-direction bus**, whose bodywork *is* `B_RED` —
a bright red lamp on it would be a brake light nobody can see, so it waits for the repaint #42 asked
for.

**Measured limit worth knowing before this gets reported as broken:** traffic braking is plumbed but
has almost nowhere to show. The car-following guard only slows vehicles *behind* the player, it
starts doing so at roughly `TRAFFIC_MIN_FOLLOW_GAP_M + speed x TRAFFIC_FOLLOW_TIME_S` ≈ 28 m back,
and `getVisibleTraffic` only returns vehicles from 10 m behind — so by the time one is on screen it
has settled at the player's speed and stopped braking. **A vehicle ahead never brakes at all**;
nothing in the model slows it. The colour swap is correct and free, and it becomes visible the day
traffic ahead gets a reason to slow down (a curve, a hazard, the density work).

One side effect worth knowing before it gets reported as a fix: the same-direction bus is `B_RED`
bodywork with `RED` lamps, which #42 recorded as the weakest lamp contrast in the fleet and left
alone. Its halo is drawn in `B_RED`, so the glow is *brighter than the lamp it comes from* and does
more for that vehicle than for any other. That is a workaround, not the repaint the note asks for.

#### The glow is finished — closed 2026-08-19, and it does not reopen

Fox, after playing it: **the glow is now recorded as playing excellently.** That closes the item.
It is no longer a thing awaiting his playtest, and it should not be listed as one anywhere — the
tuning happened, over three rounds (#43 the first pass, the scanline correction that showed round one
had been measured 1.54x too bright, then #44 pulling the constants back), and it ended where he
wanted it.

**What that means for anyone reading this later.** Do not propose "one more pass on the glow", do not
re-run the brightness tables to see whether they still hold, and do not treat the numbers in this
chapter as provisional. They are where a person who played the game put them. The one thing that
legitimately reopens it is a **change to what the lamps are saying** — and exactly one such change is
in flight: once traffic ahead has a reason to brake, brake lights start appearing at distances they
never appeared at before, and Fox has said he will tune from there. That is a new question about a
new signal, not the old question again.

Still true, and still not a defect: `?glow=0` must keep restoring a byte-identical frame, and the
raster must keep carrying the meaning on its own (`RED` → `B_RED` for a braking vehicle). Those are
invariants of the design rather than open tuning.

#### The brake light was erased by its own glow — measured 2026-08-19

Traffic braking shipped and Fox could not see it: *"auto predo mnou stále nevidím brzdiť... buď
nevidím alebo ide o LOD."* It was neither the behaviour nor the LOD tier. The same frame, rendered
twice through the real path with `scripts/frame-delta.mjs` (new, and the reason it now exists):

    glow off   0.03 % of pixels changed · peak 50 / 765
    glow on    0.00 % of pixels changed · byte-identical

The raster swaps `RED` (#CD0000) for `B_RED` (#FF0000) — **50 units on one channel**, across two
cells at 200 m. The bloom is composited with `'lighter'`, so it drives the red channel to 255 on and
around the lamp *whether the lamp began at 205 or at 255*. **This is the same trap as the first glow
pass** ("a lamp is already #FFFF00 and additive light cannot brighten a saturated channel"), one
vehicle further out, and it will happen again to anything that tries to signal by brightening a
colour the glow already saturates.

The fix is that the halo carries it: **wider (`GLOW_RADIUS_BRAKE_MULT` 1.7) and stacked
(`GLOW_BRAKE_PASSES` 2), never a different colour.** Deliberately not the white core the player's
truck gets — white desaturates the halo, and at distance that halo's colour is the only thing saying
which way a vehicle is pointing. A braking car reads as *more* red, never as a different red.

    car, braking vs rolling, with scanlines
    220 m   0.72 % of pixels · mean 19.7 · peak 80
    100 m   2.34 %           · mean 23.4 · peak 88
     50 m   5.10 %           · mean 27.2 · peak 90
     25 m   7.91 %           · mean 28.3 · peak 90
     10 m   9.90 %           · mean 27.9 · peak 92

For scale, the player's own brake is 4.3 % / 42.0 / 292 — traffic covers **more area at a lower
peak**, which is right: the truck's peak is its white core.

#### The bus is yellow now — Fox's call, 2026-08-19

> **The bus is no longer yellow.** #70 repainted the whole fleet as a side effect of replacing the
> art pipeline: the bus is `MAGENTA`/`B_MAGENTA` in both directions. The reasoning below is the
> reason yellow was chosen and it has not been answered — **magenta carries the red channel**, which
> is the exact property `B_RED` bodywork had when the brake light was found to be lying. It is
> probably better than `B_RED` and probably worse than `B_YELLOW`, and nobody has measured it.
> Re-run `brakeSignal.test.ts` and a `?trafficBrake=1` sheet before calling this closed.

`SAME_BUS_COLORS.X` was `B_RED` with `RED` lamps, so the bus had **no brake state at all**: a bright
red lamp on bright red bodywork is a brake light that lies, and `vehicles.ts` had spent two
paragraphs asking for the repaint it needed. Fox was behind a bus when he reported seeing nothing.

`B_YELLOW` frees red entirely and no other vehicle is yellow. The `Y` strip across the rear panel
went black in the same change, since on a yellow body it was invisible. Measured after:

    bus, braking vs rolling      glow on              glow off
    220 m                        1.03 % · peak 82     0.01 % · peak 50
    100 m                        2.89 % · peak 88     0.03 % · peak 50
     25 m                        7.70 % · peak 92     0.05 % · peak 50

The `glow off` column is the one that matters for the rule: the bus now signals in the framebuffer
too, so **the glow is no longer carrying that meaning alone**. It was, for one afternoon, and that
was a knowing breach.

**One cost, stated rather than discovered later: `B_YELLOW` is also the oncoming lamp colour.** At
220 m a yellow body is the same hue as an oncoming vehicle's lights. Direction survives because it
was never carried by the body — a same-direction bus wears a red halo and red lamps, an oncoming one
a yellow halo — and the halo is far larger than the body at exactly the distance where the body is
too small to read. Worth watching in a playtest anyway.

#### Two defects found on the way, neither of them the one being chased

- **Traffic was drawn in the wrong order.** `drawTraffic` iterated the live array, which is spawn
  order — *nearest first* among the traffic ahead — so a distant vehicle was painted over the one in
  front of it. Fox: *"vidím aj zelené auto pred autobusom bez toho aby som predbehol autobus."*
  Painter's order (furthest first) is one `sort`.
- **New vehicles were spawned on top of existing ones.** Spawn spacing is measured from the previous
  *spawn point*, which is not where the previous vehicle is: a car spawned at 4507 m landed **0.35 m**
  behind one that had started 286 m further back and driven past the spot. Across five seeds the
  closest two same-direction vehicles ever got was **0.00 m**, on a road where a vehicle is 6 m long.
  `TRAFFIC_MIN_SPAWN_GAP_M = 25` fixed it — the same measurement now reads **22.5 m and zero
  overlaps**. The car-following model was the obvious suspect and was never the cause.

#### New tooling, because the harness could not show the thing being judged

- **`scripts/frame-delta.mjs`** — loads two URLs of one scene and reports what moved: share of pixels
  changed, mean delta, peak. The methodology the glow tables above use, made repeatable. Every
  "can you see it?" from here on gets answered this way.
- **`?trafficBrake=1`** — the contact sheet can draw braking traffic. The same hole `?brake=1` closed
  for the player's truck: traffic only brakes when the road gives it a reason, so no static sheet
  could ever contain the state most in need of looking at.
- **`traffic-brake-on` / `-off` sheets**, with the bus in the set on purpose.
- **`brakeSignal.test.ts`** — counts the cells that change when the brake comes on, per type, across
  the whole approach. It is what turned "is it LOD?" into a table in five minutes.

#### What `sprites/vehicles.ts` knew — migrated here on deletion, 2026-09-01

The hand-drawn fleet stopped being loaded when #70 made the JSON catalogue the runtime source, and
the module was deleted on 2026-09-01. Three things in its docblock were nowhere else, and they are
the reasons rather than the pixels — the pixels are in git.

**Why the redraw happened at all.** Six pull requests had fixed how a sprite *reaches* the screen —
one shared raster, a far tier, a hyperbolic growth curve, an area-weighted resample, fractional
scaling, a contrast outline — and none of them touched what the sprite *was*. Fox, after all of it:
*"we are at a better level but honestly the sprites are terrible — not even a person with
imagination could tell it is a car if they did not already know."* Every graphics decision since has
been downstream of that sentence.

**Why `scripts/sprite-import.mjs` earns its keep on scenery and cannot be used on vehicles.** It
segments an image by block density. On a tree, lumpiness reads as nature. On a vehicle it produced
three defects no renderer can fix:

- **Rear lamps as a bar across the middle.** On a real car, and on every readable 8-bit car, they
  sit at the outer corners — and they are the single feature that says *car, going away from me*.
  The far tier had to re-add corner lamps precisely because the art got this wrong.
- **No bilateral symmetry**, because block-density segmentation has no reason to be symmetric. At
  this size the asymmetry reads as noise rather than as a manufactured object.
- **Wheels that never separated from the body**, so nothing showed the road underneath and the
  vehicle had no visible ground contact.

**The seven rules the drawings followed.** Rules 6 and 7 are recorded in their own sections above;
these five were only in the module:

1. **Every row is a palindrome.** Symmetry is cheap to hold and it is what makes thirty pixels read
   as a manufactured object. It costs far-field motion — see the mini's cadence — and it was
   still judged worth it.
2. **Lamps occupy the outermost columns of the widest rows.** Not inset: an edge pixel survives the
   resample where an interior one is outvoted by bodywork.
3. **Direction is carried by lamp colour, never by body colour.**
4. **The wheels have road between them** — two dark blocks with a gap, below a solid bumper row.
5. **Dimensions are fixed.** Width and height feed the projection, the LOD thresholds and the
   collision raster, so changing them would be a gameplay change wearing an art change's clothes.

The four scenery modules (`deciduous`, `conifer`, `rocks`, `signpost`) went in the same commit and
carried no reasoning at all — they were `sprite-import.mjs` output, pure data, superseded by the
validated JSON grids.

#### The second redraw: structure, not shape — 2026-08-19

The first redraw (#42) fixed what the six vehicles *were*: symmetry, lamps at the corners, wheels
with road under them. It deliberately left them as flat slabs of colour. Fox, after the
traffic-braking playtest: *"hre chýbajú detaily (hlavne vozidiel). Také čierne outlines, ktoré sa
všeobecne robili."*

The aesthetic reason is his. The hard one is that **brightness is exhausted as a carrier** — `RED`
and `B_RED` are 50 units apart on one channel and the halo saturates them into each other, which is
why traffic braking had to be moved into the glow. Anything a vehicle still needs to say has to be
said with shape.

So each of the six gained **interior keylines**, in the language the player's own truck already
speaks: a mass of colour described by dark structural lines rather than a slab with a window in it.
A waist line under the glass, a dark inboard edge on each lamp cluster, a bumper band, a shut line
across the boot or bonnet, wheel arches over the tyres, and — on the buses — window pillars that
split one long band into three windows. The outer contour (#35) was already there and lives outside
the raster; these are the interior lines it never had.

**Bodies stopped sharing colours.** The mini and the car were both `B_GREEN`, so at the distance
where their silhouettes stop differing there was nothing left to tell them apart. The mini is
`B_MAGENTA` now — no vehicle, surface, kerb or marker uses it.

> **Superseded 2026-09-01, and the principle is the part to keep.** #70 re-dealt the fleet: mini
> `B_GREEN`, car `B_BLUE`, bus `MAGENTA`, and oncoming bodies no longer differ from same-direction
> ones. The mini therefore wears the colour this paragraph took *off* it. The rule that produced the
> original choice — *two vehicles that stop differing in silhouette must not share a colour* — is
> still satisfied, since all three differ. What is no longer satisfied is direction: it left the
> body entirely and now rides on the lamps alone.

**Two things the drawing gave up, both to measurement rather than taste.**

- *The oncoming mini has no wheel arches.* Its front is a full-width dark grille and an arch row
  under one merges into a single dark mass at 4 px: **1.05 s → 1.83 s** of freeze against a 2.0 s
  budget, for that one row. A narrower grille (1.47 s) and arches pushed to the edges (1.83 s) were
  both tried and neither recovered it.
- *Number plates are `WHITE`, not `B_YELLOW`.* Yellow is the **oncoming lamp colour**, and at 14 px
  a bright yellow bar across a same-direction car's rear outshone the red lamps that carry direction
  and the brake. Plain `WHITE` was the one unused entry left in the palette. Removing the plate
  entirely was also tried and costs the same mini **1.17 s → 1.83 s** — the plate is what stops the
  bumper and the arches reading as one dark band.

Longest hold of one drawing, against the 2.0 s budget:

    first redraw    with keylines    authored tiers (#70)
    same mini  1.28 s -> 1.17 s   -> 1.83 s      oncoming mini  0.95 s -> 1.05 s -> 1.83 s
    same car   0.83 s -> 0.83 s   -> 1.10 s      oncoming car   0.83 s -> 0.83 s -> 0.98 s
    same bus   0.57 s -> 0.55 s   -> 0.92 s      oncoming bus   0.82 s -> 0.83 s -> 0.92 s

The third column is where the generated grids landed. Still inside budget, and still the best
argument in this file for why a formula cannot replace a hand-cut grid: every recovery in the
second column came from widening **one** feature at a time until it survived down to four pixels,
which is a judgement a width ratio cannot make.

The count of *changes* per approach rose where it mattered — car 168 → 177, bus 182 → 195 — so the
structure is not only visible up close, it does work in the far field too. Dimensions, silhouettes,
the collision raster and every LOD threshold are untouched: this is a repaint inside the same boxes.

### The mini's far-field freeze is the floor — closed as failed, 2026-09-01

**Do not re-investigate.** The mini holds one drawing for **1.83 s** at 204 m against a 2.0 s
budget. Two art fixes were tried and measured, both rejected, and the conclusion is that this is not
an art problem.

| | longest freeze |
|---|---:|
| shipped | **1.83 s** |
| far grid 7×6 → 7×7, extra row left transparent at the top | 1.30 s — **rejected** |
| 7×7 with the body kept against the top edge | 1.90 s — **rejected** |

**Why the 1.30 s was a mirage, and it is the more useful of the two results.** It is not a cadence
fix at all: the resample maps the *whole* grid, so a transparent row is padding, and padding draws
the vehicle smaller. `vehicleContour` caught it immediately — "the outline is no smaller than the
thing it surrounds" — because the silhouette had shrunk while the outline had not. Any future
attempt that improves this number by changing a far grid's height should be checked against the
drawn size before it is believed.

**The second attempt tested a theory and killed it.** At 7×6 the occupied height is 5 rows and the
projected height at the freeze is 3 — very nearly 2:1 — so the guess was that every row crosses its
coverage threshold at the same scale, the horizontal form of the dome finding on the bus. Keeping
the body against the top edge at 7×7 makes the ratio 2.33:1 and it got **worse**. The integer-ratio
theory is wrong; the bus's dome worked because it added *edge positions*, and the mini has no room
for any.

What is left is what this file already said before the attempt: a mini at 200 m is a 4 × 3 box whose
true size grows by a tenth of a pixel over two seconds, and no resampler can invent a change there.
The remaining levers are `TRAFFIC_SCALE_FAR` and `TRAFFIC_VIEW_DISTANCE_M`, both of which change how
distance reads — a gameplay decision, not a rendering one, and Fox's to make.

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

### What the far tier settled before authored LOD

Before the 2026-08-31 decision, two tiers existed: `far` and `detail`. What separated them was
**colour in one row and nothing else**.
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

That rule was written to stop direction being *confused* by bodywork, when the drawings themselves
also differed front from rear. After #70 they do not — the two views share their whole upper body —
so the rule has quietly become the *whole* mechanism rather than a safeguard on it. It is still the
right rule; it is no longer sufficient on its own. See the front/rear table at the top of the file.

Type was not really distinguished at this size — the silhouettes existed, but at six pixels of
height they carried no more than the size difference already did. The conclusion that a middle tier
was closed was **reversed by Fox on 2026-08-31** after reviewing real prepared art. The current
far/mid/near sources keep the same physical box at handover; see the 2026-09-01 record near the top.

### Rules that hold whatever gets built

- **The JSON catalogue is the only source of objects.** Fox, 2026-09-01, on deleting the last
  hand-written sprite modules: *„JSON je jediný katalóg objektov."* A drawing that is not in
  `sprites/assets/manifest.json` is not in the game. No module may hold sprite rows of its own, and
  a second source would mean two answers to "what does this look like" with only one of them
  validated at load.
- **One raster, three consumers.** Draw, collision and glow must read the same rendered raster.
  Collision must never independently rescale the source sprite. Test that every solid pixel of the
  collision mask corresponds to a drawn solid pixel.
- **A front view and a rear view are two drawings, not one drawing with a recoloured strip.** They
  must differ in silhouette or in interior structure, not only in lamp colour — most of all on the
  tier the approach actually spends its time in. This is the rule #70 broke, and it is testable
  without judging art: *the two views of one vehicle at one tier must differ in at least N% of their
  opaque pixels, and at least one of those differences must lie outside the lamp rows.* Today all
  nine pairs would fail it at any N above 12%.
- **Glow only on lights, never the body.** Bloom over a whole vehicle just makes a bigger blob. Two
  lamps per vehicle is still a hard limit. **The rest of this rule was measured and reversed in #43**
  (see above): 0.2–0.35 alpha is invisible on flat palette art seen through a 0.65 scanline overlay,
  the shipped values are `alpha 0.8` with **two passes** and a radius of 1.4x the drawn height, and
  the lamps **may merge into one glowing point at the horizon** — one light that can be seen beats
  two that cannot, and direction is carried by colour, never by there being two of them.
- **Glow stays opt-in** and never widens the palette; the module promises a byte-identical frame
  when unused, so assert it. Keep `?glow=0` for instant A/B. *Asserted in `vehicleGlow.test.ts`:
  with glow off, `drawTraffic` emits no sources at all while still drawing the vehicle — the two
  are otherwise the same empty array.*
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
- **Collisions stay pixel-perfect and screen-space** — `ROADMAP.md` and `docs/simulation.md`.
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

Do not retune clutch or throttle behaviour without an explicit decision from Fox.

---

## Mathematics and geometry — the open questions

Fox's, 2026-08-27, and written down because they outlive any one session. He wants to head for
"infinite resolution" — a world described by numbers rather than by pixels — and asked what the
right questions are. These are them, each anchored to something measured in the code today.

### The one thing to know first

**The sprite is not what stands in the way.** A perfect vector truck would still be drawn through
a camera that does not exist, because Ice Haul does not have one projection. It has four laws,
and only one of them is a projection:

| What | Law today | Where |
|---|---|---|
| depth to scanline | `dy = PERSPECTIVE_K / z` | `render/projection.ts` |
| road half-width | `half(dy) = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * dy/roadHeight` | `roadgeometry.ts`, `road3d.ts` |
| vehicle size | `scale(z) = A / (z + B)` | `road3d.ts:428`, anchors in `settings/vehicleView.ts` |
| lateral position | `centerX = W/2 - playerX * LATERAL_SHIFT` | four places in `road3d.ts` |

The first is a true pinhole. The second is linear in `dy` with a **non-zero intercept at the
horizon**, deliberately: `settings/view.ts` says "true perspective would converge to zero and the
road would vanish into a point three scanlines up". The third is `1/z` with its own softening
offset. The fourth does not depend on depth at all.

A real camera has one law — `f * X / z` for everything — and three numbers behind it: focal
length, camera height, road width in metres. Ice Haul has `ROAD_HALF_TOP = 24` **pixels**,
`TRAFFIC_SCALE_NEAR = 1.43` at 1.2 m, and `PERSPECTIVE_K = 150`, each tuned by eye against the
others. That is the real reason a resolution change is a re-tune of the driving rather than a
graphics change: **three of the four laws are written in pixels, so changing the pixel grid
changes the geometry.**

So the order is: **one camera first, geometry-native objects second.** The questions below are
about the camera.

### Q-G1 — should the road converge to a point?

`ROAD_HALF_TOP` is an explicit anti-perspective floor, and it is also the term that makes the
lane-share hump structural (`z* = sqrt(TRAFFIC_SCALE_B * 178.652 / ROAD_HALF_TOP)`; a bus once
covered 1.21 lanes because of it).

The question is what that floor is *for*. If a readable ribbon at the horizon is a **gameplay
need** — the player must see where the road goes — then it is not geometry at all, it is a
legibility device wearing geometry's clothes, and it might be honest to draw it as one. If it is
only there because a vanishing point looks bad, distance fog can take that job (already queued)
and the geometry can be true.

Nobody has asked which it is. The answer decides whether the floor survives a camera.

### Q-G2 — what is `B` compensating for?

`scale(z) = A / (z + B)`. `A` and `B` are solved from two hand-picked anchors, not derived. Under
a pinhole camera the size law is `f * H / z` — no offset. So `B` is buying something.

Hypothesis worth testing on paper: **the camera has no height.** A pseudo-3D racer's camera sits
`h` metres above the road, so a vehicle of height `H` at depth `z` projects to `f*H/z` while its
*base* sits at `f*h/z` — the two are coupled, and `h` is exactly the kind of parameter whose
absence gets papered over by a `+B` in the denominator. There is no `h` anywhere in Ice Haul.

If that is right, one physical number replaces both `B` and possibly Q-G1's floor.

### Q-G3 — should sliding sideways move the vanishing point?

`centerX = W/2 - playerX * LATERAL_SHIFT` shifts **every** scanline by the same amount, so the
whole road slides rigidly. In a camera, moving sideways shifts near rows a lot and far rows barely
(`f*X/z`), so the road *rotates about the horizon* instead of sliding.

Is the rigid slide part of the arcade feel and deliberately kept, or is it why a slide on ice
reads as "the road moved" rather than "the truck moved"? Cheap to A/B: make `LATERAL_SHIFT`
depth-scaled and drive one ice seed.

### Q-G4 — how many of today's constants are outputs?

The paper exercise, and the cheapest real step in this whole direction. Give the camera three
honest numbers — focal length, height above the road, road width in metres — and work out which
of `PERSPECTIVE_K`, `ROAD_HALF_TOP`, `ROAD_HALF_BOTTOM`, `TRAFFIC_SCALE_A`, `TRAFFIC_SCALE_B`,
`LATERAL_SHIFT` fall out as **derived** rather than tuned.

No code, no risk, and it answers the only question that matters before any rewrite: *can the
current look be produced by a real camera at all, or does the game look the way it does precisely
because the laws disagree?* If it is the latter, that is a finding, not a failure — and it ends
the "infinite resolution" idea honestly instead of after a month of work.

### Q-G5 — is the truck's articulation geometry, or is it drawing?

`render/sprites/playerTruck.ts` is **52 hand-drawn bitmap layers**: three cab poses and three
trailer poses, each split by colour, plus two more by mirroring. `CAB_X_BY_ANGLE` only says where
to paste the cab. Nothing is computed. (The header says "Generated workbench output; copy byte
data into Ice Haul" — it came from zx-art as bytes, one way.)

A geometric cab would be a body rotated about the fifth wheel and projected, at any angle rather
than five. The question is what the sprite gives that geometry could not — **the silhouette**, or
**the drawing**? If it is the drawing (the hand-placed dither, the ZX hatching), then the split is
available: let geometry decide the outline and the placement, and let hand-drawn fill live inside
it. That is a road to resolution independence that does not cost the look.

### Q-G6 — should collision live in the world instead of on the screen?

`game/roadgeometry.ts` repeats `computeCurveOffsets`'s loop verbatim, and its comment says the two
must stay bit-identical because "render and collision disagreeing about where the road is has
already cost this project three debugging rounds".

That duplication is a symptom of a screen-space world: two things independently computing pixels
and being policed for agreement. In a metre-space world, collision is the truth and the render is
derived, so the class of bug cannot exist. Is that worth the move on its own, independent of
everything above?

### What is *not* being asked

Whether to make the truck a vector model. That is downstream of Q-G1 to Q-G4 and cannot be
answered before them — see also "Parametric, vector, and what each would actually buy" above,
which remains the record of the rendering side of the question.

---

## Parallel working copy

`../iceroads-codex` is a second working copy of this game with its own unpublished branches and a
map editor. **It is read-only: never write to it** — no edits, no commits, no branch switching, no
git state changes. Read and compare only, and note it has several branches, so comparisons are
usually against a feature branch rather than `main`.
