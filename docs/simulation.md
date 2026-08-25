# Ice Haul: simulácia

Ako sa správa kamión a ako sa stretáva so svetom. Zlúčené z pôvodných
`collision-study.md` a `DRIVETRAIN_ROADMAP.md`, lebo to bola vždy jedna téma
rozdelená do dvoch súborov: pohon rozhoduje, ako rýchlo do niečoho vojdeš, a
kolízie rozhodujú, čo sa vtedy stane.

**Stav k 25. augusta 2026** (verzia 0.20.0). Konštanty overené proti kódu.

Sesterské dokumenty: [manual](manual.md) pre hráča · [grafika](graphics.md) ·
[seedy](seeds.md) · [známe problémy](known-issues.md)

---

## Obsah

1. [Pohon: prevodovka, spojka, hmotnosť](#1-pohon)
2. [Bočná dynamika](#2-bočná-dynamika)
3. [Kolízny model](#3-kolízny-model)
4. [Konštanty](#konštanty)
5. [Roadmap](#roadmap)

---

# 1. Pohon

## Čo je hotové

- **Manual 5-speed gearbox** (`config.ts: GEARS`, `game/vehicle.ts`). Each gear is its top
  speed `to` + a torque value. **1st caps at ~28 km/h — you cannot reach 120 in a low
  gear.** Acceleration is deliberately slow (0→120 ≈ 30 s through the gears).
- **RPM model + gauges.** `rpm = speed / gear.to` — proportional to road speed like a real
  engine (0 at standstill, 1.0 = redline at the gear's top); never negative, shown **raw**
  so a too-tall gear reads low and the left RPM bar can drop to **0 bars** (the lugging cue).
  The power band starts high (`BOG_RPM = 0.45`), so a too-tall gear is *sluggish* (weak pull)
  before it lugs. Shown two ways: the left **RPM bar** (green → red) and the centre
  **tachometer** (dial needle = real revs via `RPM_DISPLAY_REDLINE`, plus numeric RPM + SPD).
- **Controls.** `D` = shift up, `A` = shift down (edge-triggered); `ENTER` = ignition.
- **Synchro shift limits** (per-gear `GEARS[].maxSpeedToShift`). You can only **downshift
  into** a gear below its limit (1st < 35 km/h, 2nd < 60, 3rd < 85; 4th/5th `null` = no
  limit). A refused downshift keeps the current gear and signals a **grind/clunk** + a red
  GEAR flash (`v.shiftBlocked`). Upshifts are always allowed. Fully config-driven — set all
  limits to `null` to remove synchro, or all to numbers for a fully synchro'd box. This lets
  you walk down the gears as you brake for ice (low gears unlock as you slow), without ever
  being able to slam into a gear that would over-rev.
- **Stall mechanic** (`LUG_RPM = 0.25` ≈ 650 rpm). Lug the engine below idle in a gear it
  can't sustain (too tall for the speed) → it dies. Realistic: e.g. **cruising 30 km/h in 5th
  lugs**. **1st gear is exempt** (`v.gear > 1` guard) so you can always idle and pull away in
  1st. A stalled engine **freewheels** (no power, no fuel burn) until restarted with **ENTER**,
  which re-engages a sensible gear (`startableGear`).
- **Stall warning + grace** (`STALL_GRACE_MS = 3500`). Before the engine actually dies it
  lugs and **coughs** for ~3.5 s with an `ENGINE STALLING / SHIFT DOWN A` overlay —
  enough time to react mid-corner on snow. Downshifting in time cancels it.
- **Redline burn-out** (`REDLINE_RPM = 0.95`, `REDLINE_BURN_MS = 6000`). Sit on the redline
  under throttle without upshifting and the engine over-revs: an `ENGINE REDLINE / SHIFT UP D`
  overlay + buzzer (after `REDLINE_WARN_DELAY_MS = 900`), then it stalls after ~6 s. Only in
  gears you can upshift out of — the top gear's redline is just the limiter (5th's band tops
  at 130 km/h so the 120 km/h cap sits below redline). `v.stallCause` = `'lug'` | `'overrev'`
  for the future damage model.
- **RPM-driven engine audio** (`audio/engine.ts`). Engine pitch follows RPM within the
  gear, so revs **drop on an upshift** and climb as you accelerate. Silent when stalled
  (tyres roll on). Shift blip, stall "dying" sound, ignition crank.
- **HUD left panel reworked** to a drivetrain cluster: FUEL · RPM · GEAR · GRIP (the old
  static compass + double GRIP bar were removed).
- **Delivery time budget 7 → 8 min** to suit the slower acceleration (a careful driver
  must still finish 5 km on time; verified by `completability.test.ts`).
- **Non-instant crank start** (`CRANK_NEEDED_MS = 1800`, `scenes/drive.ts`). Hold **ENTER**
  for ~1.8 s to crank the engine — both on the initial start screen and after a stall.
  Releasing early resets the crank; you must try again. `STARTING...` overlay while cranking;
  irregular beeper pulses simulate the diesel starter; a short rising beep on ignition. The
  vehicle physics restart path is unchanged — `input.restart` is only sent to `tickVehicle`
  after the crank completes. `PRESS ENTER` overlays renamed to `HOLD ENTER`.
- **Harder torque curve** (`BOG_FLOOR = 0.12`, `BOG_RPM = 0.50`, `game/vehicle.ts`). The
  multiplier below the power band changed from linear to **quadratic** and the floor was
  lowered from 0.40 to 0.12. 5th gear at 30 km/h now stalls: torque is too low to escape
  the 3.5 s grace period (~5.1 s needed to build enough revs). 5th at 40 km/h pulls at
  ~0.72 km/h/s vs 4th's ~1.54 km/h/s — clearly slower, RPM bar visibly low.
- **Surface drag double-penalty fix** (`SURFACE_DRAG` in `config.ts`). The old values
  (mud=8, sand=7) combined with `SURFACE_ACCEL=0.35` made 2nd gear drag-limited to ~22 km/h
  on mud and ~25 km/h on sand — the engine could not overcome surface resistance at any
  normal speed. Fixed: **mud 8→4, sand 7→3**. 2nd gear equilibrium is now ~44 km/h (mud)
  and ~59 km/h (sand). Higher gears remain drag-limited (3rd→~34/~45 km/h). `SURFACE_DRAG`
  now carries a full in-code reference comment with formula, per-gear equilibrium tables,
  double-penalty invariant, coasting behaviour, and per-surface tuning bounds.

---

## Vlastníkove nápady — úprimné posúdenie

> Verdicts are objective: endorse where it's good, push back where there's a real reason.

### 2.1 Non-instant engine start (few seconds + AY/beeper crank sound)
**✓ IMPLEMENTED (2026-06-03) — crank starter, `CRANK_NEEDED_MS = 1800` ms, hold ENTER.**

**Verdict: do it. Low effort, good payoff.** A 1.5–2.5 s "STARTING…" crank (no throttle
during cranking) makes stalling genuinely costly — you can't instantly recover mid-corner,
which is exactly the discouragement intended. The AY/beeper crank is very ZX. Pairs
naturally with the stall + warning already in place.
**Watch:** tune duration so it punishes without frustrating; reuse the same crank for the
initial game start to set the tone. **Rebuild: small** (a "cranking" sub-state + timer + SFX).

### 2.2 Weight-based acceleration (10 t fast-ish, 20 t = now, 30 t very slow)
**Verdict: good and cheap. How big a rebuild? Small.** The engine-force term is already
`gear.accel × torque × accelMult × dt`; add one `massMult` factor (a tuned curve or
`20 / mass`). ~10 lines + a config table. **The real work is tuning, not architecture.**
Heavier mass should also (a) stall more easily (more load), (b) lengthen braking distance.
**One honest nit:** "30 t only OK at higher gear" is slightly backwards — heavy loads need
*low* gears to pull away (torque) and struggle in *high* gears. If the intent is "30 t
accelerates so slowly that it only *feels* fine once you've finally climbed into 4th/5th,"
that's fair — just note the heavy truck still **starts in 1st** (even more so). Ties into
cargo/damage below.

**✓ IMPLEMENTED (2026-06-10):**
- **Acceleration (I1, 2026-06-09):** `massAccelMult(massT) = REFERENCE_MASS_T / massT`, folded
  into the engine-force term at the call site (`scenes/drive.ts`). `W` debug key cycles 10/20/30 t.
- **(b) Braking distance (I2a):** `massBrakeMult(massT) = ref/massT` scales the **manual brake**
  decel inside `tickVehicle` (new trailing `massT` param, defaulting to `REFERENCE_MASS_T` →
  20 t bit-identical). 30 t ≈ 0.67× decel (~1.5× stopping distance), 10 t ≈ 2×. Scoped to the
  manual brake only — aero/rolling/`SURFACE_DRAG` stay mass-independent so the surface-drag
  equilibria keep their tuning. Owner playtested 2026-06-10: linear coupling feels right.
- **(a) Stall-ease (I2b):** `massStallMult(massT) = ref/massT` scales `STALL_GRACE_MS`. A 30 t
  load lugs to a stall in ~2.3 s vs the 20 t ~3.5 s; 10 t gets a forgiving ~7 s. 20 t unchanged,
  so the 20-seed completability sim is untouched.

- **(c) Steering (0.20.0):** `massSteerMult(massT) = sqrt(ref/massT)` scales the steering rate
  and the damping alike, inside `tickVehicle`. Deliberately **softer** than the three above:
  they are `ref/mass` because engine and brake force are fixed and a heavier truck gets less
  out of them, whereas steady cornering is grip-limited and the mass cancels there. One lateral
  term does both the grip-limited and the inertia-limited job, so the honest multiplier is the
  geometric mean. 20 t bit-identical, pinned by a test. See [Hmotnosť v riadení](#hmotnosť-v-riadení).

**◻ DEFERRED — (a′) lug-zone widening (I2c):** make a heavier truck *lug at a higher rpm* (raise
the effective `LUG_RPM` with mass), so the lug zone widens for heavy loads, not just the grace
window after lugging starts. **Not done on purpose:** it changes *when* lugging begins, so it must
be re-validated against `completability.test.ts` (the 20-seed time/fuel budget) and may need a
small `LUG_RPM`/`STALL_GRACE_MS` re-tune. Optional polish — I2 is considered done without it.
Reach for it only if heavy loads should feel like they need a downshift *earlier*, not just *die
faster*.

### 2.3 Damage model — truck + cargo, money, repairs (ETS2-like)
**Verdict: right long-term direction, but the biggest item — this is the career/economy
layer.** Build it incrementally, not in one go.
**Honest critique on one detail:** a flat passive `+2 %/5 km` truck-damage tax risks feeling
grindy and agency-free. In ETS2, wear is slow and mostly from collisions / terrain / abuse,
not the odometer. Recommend damage be **mostly event-driven** (collisions, off-road,
ice-crack hits, redline/over-rev abuse, hard landings) with at most a tiny passive baseline
— that rewards skill. Cargo damage from jolts/collisions/harsh braking → delivery payout
penalty; truck damage → repair cost + degrading performance + eventual breakdown. The right
HUD panel (currently a placeholder) is a good home for the `%` readouts.
**Sequence:** (a) damage accumulators + `%` display → (b) collisions/off-road add damage →
(c) money from deliveries + repair flow (needs a pit-stop scene). **Rebuild: large / multi-phase.**

### 2.4 Rework crash: low-speed bump (<50 km/h) = damage + cargo damage + stall, continue
**Verdict: strongly agree.** The current binary crash → game-over is harsh and fights the
"every metre a small decision" fantasy. Low-speed bump → take damage, jolt the cargo, stall
the engine, keep driving; high-speed → still a real crash/game-over. **Depends on the damage
model** (needs a damage sink). Interim without economy: bump = stall + damage flash + time
loss. **Rebuild: medium** once damage exists. Big feel improvement.

### 2.5 Swap speed dial ↔ tachometer (RPM = dial, speed = bar + text)
**✓ IMPLEMENTED (2026-06-03) as the middle ground below.** The centre dial is now a
tachometer (needle = real revs) with numeric RPM + numeric SPD; the left RPM bar stayed.
Speed is a clear number, not a thin bar.

**Verdict: don't do the full swap — but the instinct is half-right.** In a driving game the
player *acts on speed*: every surface rule is a speed ("ice = 20–30 km/h"), braking points
are speed-based. RPM drives the shift/stall layer, which is secondary. Burying speed in a
thin progressbar hides the number the player needs most.
**However**, with a manual box the revs *are* what you manage moment-to-moment, and a big
tach is the iconic manual instrument. **Recommended middle ground:** make the centre dial a
**tachometer** AND keep a **bold numeric speed** beside/under it — real dashboards show both
prominently. Promote RPM from the current 7-seg sliver to the dial; give speed a clear big
number; don't reduce it to a tiny bar. **Rebuild: medium** (HUD reflow; the dial widget
already exists — point it at `rpm`).

### 2.6 Manual clutch (SHIFT) — ✓ IMPLEMENTED (2026-08-01)

**The skill is rev-matching, not timing.** There is deliberately no correct number
of milliseconds to hold the pedal. The clean release point is wherever the engine's
revs equal what the wheels will demand in the selected gear:

```
targetRpm = speed / GEARS[gear].to
```

Everything the owner asked for falls out of that one line, with no special cases:

- **The window moves while you are declutched.** A truck in neutral keeps slowing —
  fast on mud (`SURFACE_DRAG`), barely at all on asphalt, differently again under
  braking or with 30 t behind you.
- **Mass changes it.** `massBrakeMult` already scales how the shock lands, and drag
  bleeds a heavy load's speed differently.
- **Direction matters, from the gear table alone.** Downshifting *raises* the
  demanded revs (3rd→2nd at 50 km/h: 0.59 → 0.96), so you must **blip the throttle**
  while declutched — a real double-clutch. Upshifting lowers them, so you wait.
- **You can hear it.** `audio/engine.ts` already follows rpm, so the match is an
  audio skill first and a dial second.

**What was built:** `Vehicle.engineRpm` as an independent quantity (before this,
`rpm` was a pure function of road speed — engine welded to the wheels, which is
precisely what a clutch is not). `clutchIn`/`targetRpm`/`lastBite`/`clutchJolt`
alongside it; `CLUTCH_*` in `config.ts`; a rev-match marker on the tachometer;
SHIFT tracked as a **level** in `drive.ts` (plus a `blur` handler, or alt-tabbing
away leaves you coasting in neutral for ever).

**Decisions taken (owner, 2026-08-01)** — the alternatives are recorded below
because they are all still reachable from here:

| Decision | Chosen | Rejected, and still open |
|---|---|---|
| Punishment | **Jolt, and a big mismatch can stall it** — tuned mercifully | Jolt-only; traction loss into `v.vx`; all three scaled by error size |
| Clutchless shifting | **Removed entirely** — no gear moves without SHIFT | Keep it as punished *float shifting*; expose as a difficulty setting |
| Assist | **Engine note + a tach marker** | Audio only; marker plus a green "release now" lamp |
| Inputs | **Speed + gear + mass** (all already in the physics) | Curvature as a *direct* factor; per-truck clutch characteristics |

Owner's rule for the tuning: *"usually it jolts you, sometimes you don't recover —
but let's be merciful for now. It is easier to tighten than to add and then tune."*

**Retuned 2026-08-01 after the first playtest, and both changes were real errors
rather than taste.** The owner's report was *"SHIFT automatically starts braking
the truck… practically at 0."*

- **`CLUTCH_SHOCK` 26 → 6.** The shock was scaled as if a 20 t truck had to spend
  its own momentum spinning the engine up. The mass ratio is about 1000:1, so the
  engine follows the truck, not the reverse. Measured: a half-second dip of the
  pedal with **no gear change at all** cost 6.7 km/h, which is why the pedal read
  as a brake. It now costs 0.7 km/h. An unblipped 3→2 at 50 km/h costs 3.0 km/h —
  a lurch you feel — and the same shift *with* a blip costs 0.0.
- **`CLUTCH_STALL_MISMATCH` → `CLUTCH_STALL_RPM` (= 0.6 × `LUG_RPM`).** The stall
  test asked the wrong question. Whether the engine survives depends on **where it
  lands**, not how far it fell: dip the pedal at 10 km/h with 5th selected and the
  wheels can only turn it at 0.08, so it dies — even though the engine was merely
  idling and the "mismatch" was tiny. Sign was inverted too. Now: 10 km/h in 5th
  stalls on the spot; 18 km/h in 3rd (just under the lug line) still gets the
  normal 3.5 s warning, which is where the mercy belongs.

The teeth were never meant to be in raw speed loss. They are in **coasting for as
long as the pedal is down** (no drive, no engine braking, and the target drifting
away as the truck slows) and in **killing the engine if you engage a gear the
speed cannot sustain**.

**◻ Deferred, in the order they would be worth trying:**

1. **Traction loss on a bad bite** — feed `clutchJolt` into `v.vx` so a dumped
   clutch mid-corner on ice breaks the back loose. The most realistic of the
   rejected options and the natural next tightening; needs `curvature` to be a
   direct input (below) to avoid punishing straight-line mistakes twice.
2. **Curvature as a direct factor** — a narrower clean window and a harsher shock
   mid-corner. Today the corner only matters *indirectly*, because you brake in it.
3. **Cargo shock** — a bad bite jolts the load. Nothing to feed yet; it is the
   natural first customer for the damage model (§2.3) and for the "living cargo"
   idea (a beehive whose hum sours on every jolt).
4. **Difficulty setting** — auto / today's synchro-only box / full clutch. Cheap,
   but it means maintaining three physics modes and deciding which one the
   leaderboard believes.
5. **Per-truck clutch feel** — different bite windows and shock scaling per truck.
   Wants a vehicle-selection feature first; there is exactly one truck today.

**One trap, found by driving it rather than by testing it:** the first cut treated
the two mismatch directions symmetrically, so winding the engine to the limiter in
neutral and side-stepping the pedal threw the truck from 3 km/h to 30 — revving in
neutral was *faster* than driving. Real clutches are not symmetric: being dragged
down is rigid, over-revving mostly spins the wheels and cooks the plate. Hence
`CLUTCH_LAUNCH_FRACTION = 0.15`, a regression test, and a note here.

**The completability sim now drives a clutch.** `completability.test.ts` used to
send `shiftUp`/`shiftDown` straight into the physics; with the clutch mandatory it
had to learn to press, select, blip and release like a human. That makes it the
real balance harness: **if the ideal driver cannot finish 5 km inside the budget,
the mechanic is not completable.** At this tuning the moderate strategy finishes in
344 s of 480 s, so there is ~136 s of headroom for a human being worse at it.

---

## Nápady od agenta (od najľahšieho)

1. **Redline upshift warning — ✓ IMPLEMENTED (2026-06-03).** The symmetric twin of the
   stall/downshift warning: at the redline a buzzer + an `ENGINE REDLINE / SHIFT UP D`
   overlay, and — by the owner's request — the engine **burns out** (stalls) after ~6 s if
   you keep flooring it without upshifting. Safe in the top gear. `v.stallCause`
   distinguishes `'lug'` vs `'overrev'` for the future damage model. (Burn-out → stall now;
   later it can feed damage instead.)

2. **Downshift rev-protection / synchro limits — ✓ IMPLEMENTED (2026-06-03).** Realised as
   per-gear `maxSpeedToShift` synchros (1st < 35, 2nd < 60, 3rd < 85; 4th/5th free): a
   downshift into a gear above its limit is refused with a grind/clunk + red GEAR flash.
   Config-driven and universal (`null` = no limit). Designed around the ice scenario — you
   walk the gears down as you brake, low gears unlocking as you slow.

3. **Optional shift-assist / "best gear" hint (medium).** A small ▲/▼ glyph next to GEAR
   suggesting up/down when you're lugging or over-revving (toggleable in a future options
   menu; off for purists). Big onboarding win for a manual box that can feel opaque.

4. **Road gradients / hills that make gear choice tactical (hardest).** Give the pseudo-3D
   road a vertical pitch: climbs sap speed and demand low gears (torque), descents build
   speed and make engine-braking + downshifting matter. Today the road is flat, so gears are
   mostly about top speed; slopes give the gearbox a *tactical* reason every segment —
   highest value for "make the manual box matter," but needs road-geometry + rendering work
   and physics re-tuning for grade.

---

## Navrhované poradie

Cheap feel-wins first, the economy layer last:

```
1. Redline upshift warning + burn-out  (agent #1)   — ✓ DONE (2026-06-03)
2. Synchro downshift limits           (agent #2)   — ✓ DONE (2026-06-03)
3. Tach dial + prominent speed number (owner 2.5)   — ✓ DONE (2026-06-03)
4. Non-instant engine start           (owner 2.1)   — ✓ DONE (2026-06-03)
4a. Surface drag / torque curve tune  (B45–B46)    — ✓ DONE (2026-06-03)
5. Weight-based acceleration          (owner 2.2)  — ✓ DONE (I1, 2026-06-09)
5b. Mass → braking dist + stall-ease  (owner 2.2)  — ✓ DONE (I2a/I2b, 2026-06-10)
5c. Mass → lug-zone widening          (owner 2.2)  — ◻ DEFERRED (I2c; needs sim re-validation)
6. Damage accumulators + % display    (owner 2.3a)
7. Low-speed bump = damage + continue (owner 2.4)  — needs #6
8. Money + repair + pit-stop          (owner 2.3c) — career layer
9. Road gradients                     (agent #4)   — hardest, biggest gameplay change
10. Shift-assist hint                 (agent #3)   — anytime after an options menu exists
```

The decision filter (same as the kit roadmap): does the change make the *manual gearbox
matter more* or read *more clearly*? If yes, prioritise; if it's just more surface, park it.


---

# 2. Bočná dynamika

Toto je časť, ktorá v pôvodných dokumentoch chýbala úplne, hoci rozhoduje o
každej zákrute.

## Model

```ts
// Zatacanie — tlmenie sa NEuplatnuje, kym je klavesa drzana
const speedSteerFactor = 1 - speedRatio * SPEED_STEER_PENALTY
const steerMass = massSteerMult(massT)
if (input.steerLeft)  v.vx -= STEER_ACCEL * steeringGrip * speedSteerFactor * steerMass * dt
if (input.steerRight) v.vx += STEER_ACCEL * steeringGrip * speedSteerFactor * steerMass * dt

// Tlmenie — az ked hrac pusti
if (!input.steerLeft && !input.steerRight) {
  v.vx *= 1 - Math.min(1, STEER_DAMP * effectiveGrip * dampMult * steerMass * dt)
}

v.vx = clamp(v.vx, -MAX_LATERAL_V, MAX_LATERAL_V)
v.x += v.vx * (0.35 + v.speed / 220) * dt
```

**Detail, ktorý sa ľahko prehliadne a mení celý výpočet:** tlmenie je vnútri
`if (!input.steerLeft && !input.steerRight)`. Kým držíš šípku, **netlmí sa nič**
a `v.vx` sa integruje priamo až po `MAX_LATERAL_V`. Tlmenie je návrat do rovnováhy
po pustení, nie protisila počas zatáčania.

Z toho vyplýva:

- počas zatáčania rastie `v.vx` **lineárne** rýchlosťou
  `STEER_ACCEL · steeringGrip · speedSteerFactor · massSteerMult`
- po pustení klesá s časovou konštantou `1 / (STEER_DAMP · grip · massSteerMult)`,
  čo je 200 ms na suchom asfalte pri referenčných 20 t
- `speedSteerFactor = 1 − speedRatio · SPEED_STEER_PENALTY`, takže pri 120 km/h
  zatáčaš **40 %** silou oproti státiu

## Mierka

Kamión je 40 px široký a v skutočnosti má náves 2,55 m, takže **1 px = 6,38 cm**.
Jedna jednotka `v.x` je 50 px, teda **3,19 m** — zhruba jeden jazdný pruh.

## Čo z toho vychádza

Pri 20 t na suchom asfalte:

| Rýchlosť | speedSteerFactor | Rast `v.vx` | Čas do stropu | Bočné zrýchlenie |
|---|---:|---:|---:|---:|
| 40 km/h | 0,80 | 2,56 /s | 0,98 s | 4,34 m/s² = **0,44 g** |
| 60 km/h | 0,70 | 2,24 /s | 1,12 s | 4,45 m/s² = **0,45 g** |
| 90 km/h | 0,55 | 1,76 /s | 1,42 s | 4,26 m/s² = **0,43 g** |
| 120 km/h | 0,40 | 1,28 /s | 1,95 s | 3,65 m/s² = **0,37 g** |

## Porovnanie so skutočným 20 t návesom

| Veličina | Ice Haul | Skutočnosť |
|---|---:|---|
| Špičkové bočné zrýchlenie | **0,37–0,45 g** | **0,30–0,40 g** = prevrátenie |
| Bežná zmena pruhu na diaľnici | — | 0,10–0,15 g |
| Čas na plné vytočenie | 1,0–2,0 s | rovnaký rád |

**Je to bližšie k pravde, než sa čakalo.** Špičkové bočné zrýchlenie sedí tesne
nad hranicou, za ktorou by sa skutočný ložený náves prevrátil — čo je pre hru
dobrá poloha: dosť rýchle, aby sa dalo hrať, dosť pomalé, aby ťažoba bola cítiť.

Zároveň to znamená, že **prevrátenie ako spôsob prehry by nastávalo prirodzene**,
bez naťahovania konštánt: prah je `(rozchod / 2) / výška_ťažiska · g`, teda okolo
0,30 g pri plnom náklade — a tam sa hra už dnes dostáva.

> **Oprava.** Skoršia verzia tohto dokumentu uvádzala 0,60–0,79 g a záver, že
> stroj je „2–2,5× hbitejší než skutočný náves". Bolo to zle a stálo to na dvoch
> chybách naraz: výpočet vynechal `speedSteerFactor` a predpokladal, že tlmenie
> beží aj počas zatáčania. Čísla vyššie sú prepočítané proti kódu.

## Hmotnosť v riadení

Do 0.20.0 boli všetky tri hmotnostné násobiče — `massAccelMult`, `massBrakeMult`,
`massStallMult` — **pozdĺžne**, takže 40 t kamión zatáčal presne ako 10 t. Presne
tam, kde hráč hmotnosť čaká najviac.

`massSteerMult` (0.20.0) to zatvára, a je **zámerne mäkší** než ostatné tri. Tie
sú `referencia / hmotnosť`, lebo ťah motora a brzdná sila sú dané a ťažší stroj
z nich dostane menej. **Zatáčanie tak nefunguje.**

V ustálenej zákrute je dostupná sila pneumatiky zhruba `μ · m · g`, takže bočné
zrýchlenie je `μ · g` — **hmotnosť sa vykráti**. Ložený kamión nezatáča pomalšie
preto, že je ťažký; zatáča pomalšie preto, že by sa prevrátil skôr. V prechodovom
deji hmotnosť naopak platí naplno: stúpne moment zotrvačnosti, takže sa dlhšie
natáča do zákruty aj z nej.

Hra má **jeden bočný člen na obe úlohy**, takže poctivý násobič leží medzi
odpoveďami — 1,0 pre časť limitovanú prilnavosťou, `ref / m` pre časť limitovanú
zotrvačnosťou. Ich geometrický priemer je odmocnina:

```ts
massSteerMult(massT) = Math.sqrt(REFERENCE_MASS_T / massT)
```

| Hmotnosť | Násobič | Čas do stropu pri 90 km/h |
|---|---:|---:|
| 10 t | 1,41 | 1,00 s |
| **20 t** | **1,00** | 1,42 s |
| 30 t | 0,82 | 1,74 s |
| 40 t | 0,71 | 2,01 s |

Aplikovaný je na **rast aj na tlmenie**, takže ťažký kamión je rovnako pomalý do
zákruty ako z nej. Samotný postih rastu by tú druhú polovicu pocitu minul.

**Zámerne nie na `MAX_LATERAL_V`.** Ako rýchlo sa dá šmýkať do strany je limit
prilnavosti a tam sa hmotnosť naozaj vykráti — 40 t dosiahne rovnakú bočnú
rýchlosť ako 20 t, len neskôr. Test to stráži.

## Kĺb visí na tejto rovnici

Od 0.19.0 sa artikulácia kabíny neriadi klávesou, ale `v.vx / MAX_LATERAL_V`.
Dôsledky patria sem, lebo sú to dôsledky bočnej dynamiky, nie kresby:

- prvá póza príde po **244 ms** pri 40 km/h a **488 ms** pri 120, namiesto 29 ms
- rýchlostná citlivosť je zadarmo — `speedSteerFactor` nedovolí rýchlemu kamiónu
  zatočiť tak tvrdo, takže sa menej artikuluje
- hmotnosť sa prejaví aj vizuálne, bez jediného riadku navyše
- šmyk, do ktorého hráč nezatáčal, sa **ukáže na kabíne**, lebo kamión sa naozaj
  hýbe do strany

Kvantizácia má hysterézu 0,05, lebo `v.vx` sa cez prah plazí tam, kde ho klávesa
preskakovala, a póza by inak blikala každý snímok.

---

# 3. Kolízny model

## Aktuálne kolízne systémy

### 1. Kamión vs. okraj cesty

Implementované v:

- `src/game/offroad.ts`
- `src/render/truck.ts`
- `src/game/roadgeometry.ts`
- konštanty v `src/settings/` (re-exportované cez `src/config.ts`)

Kamión je od #59 kĺbová súprava 40×64 s piatimi pózami kabíny a piatimi pózami
návesu, takže **maska nie je jedna** — je ich pole a vyberá sa podľa aktuálnej
pózy:

```ts
// render/sprites/playerTruck.ts
PLAYER_TRUCK_COLLISION_MASKS[cabAngle][trailerAngle]
PLAYER_TRUCK_ROAD_MASKS[cabAngle][trailerAngle]
```

`drive.ts` vyberie pózu raz za snímok a **tú istú** posiela do kreslenia, do
častíc aj do oboch kolíznych ciest. To je dôležitejšie, než sa zdá: keby sa
kreslila otočená súprava a kolidovala rovná, hitbox by nesedel s tým, čo hráč
vidí, a nedalo by sa to odladiť ničím okrem pocitu.

Pre každý riadok solid pixelov kamiónu:

```ts
screenY = truckDrawY + row
edges = getEdges(screenY)
outerLeft = edges.leftRoad - edges.kerbW
outerRight = edges.rightRoad + edges.kerbW
truckLeft = truckDrawX + firstSolidCol
truckRight = truckDrawX + lastSolidCol
```

Ak riadok nie je celý vnútri vonkajšieho okraja cesty, spočítajú sa pixely mimo:

```ts
sx = truckDrawX + col
if (sx < outerLeft) leftOff++
else if (sx > outerRight) rightOff++
```

Závažnosť off-road stavu:

```ts
offRoadPixels = leftOff + rightOff
severity = offRoadPixels / TRUCK_PIXEL_MASK.totalPixels
```

Toto je dobrý model pre ZX pseudo-3D hru, pretože hráč vidí kamión v screen
pixeloch a okraj cesty je tiež screen-space tvar.

### 2. Kamión vs. premávka

Implementované v:

- `src/game/offroad.ts`
- `src/render/road3d.ts`
- `src/scenes/drive.ts`

Hlavná funkcia je:

```ts
checkTruckTrafficCollision(
  truckDrawX, truckDrawY,
  trafficLeft, trafficTop, trafficW, trafficH,
  trafficRows,
)
```

Prechádza solid pixely kamiónu a mapuje ich do zdrojového gridu traffic spriteu:

```ts
trafficX = floor((sx - trafficLeft) * srcW / trafficW)
trafficY = floor((screenY - trafficTop) * srcH / trafficH)
solid = trafficRows[trafficY][trafficX] !== '.'
```

Kolízia nastane iba vtedy, keď je solid pixel kamiónu aj solid pixel traffic
spriteu. Bodka `.` je transparentný pixel a nepočíta sa ako hmota.

Toto je pixel-perfect vo finálnom kontakte. Platí však len v rámci správnosti
premietnutého `trafficLeft/top/w/h`.

### 3. Projekcia premávky

Implementované v `projectTrafficVehicle()` v `src/render/road3d.ts`.

Kľúčová premenná:

```ts
worldZ = vehicle.distM - cameraDistance
```

Kladné `worldZ` znamená, že vozidlo je pred kamerou/kamiónom. Záporné `worldZ`
znamená, že vozidlo už práve prešlo za kameru.

Normálna projekcia pred hráčom:

```ts
dy = PERSPECTIVE_K / worldZ
rawI = round(dy) - 1
i = min(scanlines - 1, rawI)
y = horizonY + i + 1
t = (i + 1) / roadHeight
half = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * t
baseVanX = GAME_WIDTH / 2 - playerX * LATERAL_SHIFT
x = round(baseVanX + curveOffset + vehicle.x * half)
scale = 0.35 + t * t * 1.1
```

Potom:

```ts
w = round(spriteBaseW * scale)
h = round(spriteBaseH * scale)
left = x - floor(w / 2)
top = y - h
```

Near/pass-by fáza:

```ts
if (worldZ <= 0 && worldZ >= -TRAFFIC_PASS_BEHIND_M) {
  pass = min(1, -worldZ / TRAFFIC_PASS_BEHIND_M)
  x = round(centerX + vehicle.x * ROAD_HALF_BOTTOM)
  y = round(viewportBottom - 1 + pass * 14)
  scale = 1.45 + pass * 0.15
}
```

Táto fáza je zámerne krátka. Jej účel je, aby vozidlo nezmizlo presne v momente,
keď príde ku kabíne. Zároveň dáva bočnému kontaktu ešte pár frameov existencie.

### 4. Zber kanistrov

Kanistre nemajú pixel-perfect kolíziu. Používajú jednoduchú world-space toleranciu
v hĺbke a bočnej osi. Je to v poriadku, pretože kanister je odmena, nie tvrdá
prekážka. Pri zbere je férovejšia mierne veľkorysá kolízia.

## Konštanty

Projekcia a premávka:

```ts
PERSPECTIVE_K = 150               // settings/view.ts
ROAD_HALF_TOP = 24
ROAD_HALF_BOTTOM = 120
LATERAL_SHIFT = 22
CURVE_STRENGTH = 1.0
TRAFFIC_COLLISION_DEPTH_M = 6     // settings/traffic.ts
TRAFFIC_PASS_BEHIND_M = 5         // render/road3d.ts, lokálna
```

Swept vzorkovanie blízkeho poľa (`settings/traffic.ts`):

```ts
TRAFFIC_SWEEP_NEAR_M = 8          // odkiaľ sa vzorkuje viackrát za snímok
TRAFFIC_SWEEP_MAX_STEP_M = 0.2    // najväčší krok v hĺbke medzi vzorkami
TRAFFIC_SWEEP_MAX_SAMPLES = 8     // poistka proti dlhému snímku
```

Off-road:

```ts
OFF_ROAD_DRAG = 55
OFF_ROAD_RETURN = 1.8
OFFROAD_CRASH_SEVERITY = 0.4
OFFROAD_TIMEOUT_S = 3.0
EDGE_MARGIN_WARN_PX = 8
```

Fyzika vozidla:

```ts
MAX_SPEED = 120
ACCEL = 8
STEER_ACCEL = 3.2                 // -> tau = 200 ms, ustalene vx = 0,64
STEER_DAMP = 5.0
MAX_LATERAL_V = 2.5
SPEED_STEER_PENALTY = 0.6
CURVE_DRIFT = 0.035
TRUCK_WEIGHT_T = 20               // settings/drivetrain.ts
REFERENCE_MASS_T = 20             // pri tejto hmotnosti su vsetky nasobice 1.0
TRUCK_WEIGHTS_T                   // presety pod klavesou W: 10 / 20 / 30 t
CRANK_NEEDED_MS = 1800            // ako dlho drzat Enter pri stare
```

**Pozor:** hmotnosť vstupuje do každého z týchto členov inak. Zrýchlenie, brzdenie
a zadusenie motora dostávajú `referencia / hmotnosť`; riadenie dostáva jej odmocninu,
lebo v ustálenej zákrute sa hmotnosť vykráti. `MAX_LATERAL_V` nedostáva nič — viď
[Hmotnosť v riadení](#hmotnosť-v-riadení).

Varovanie pred povrchom:

```ts
ICE_AHEAD_LOOK_M = 220
```

Pri rýchlosti `vKmh` je čas varovania približne:

```ts
warningSeconds = ICE_AHEAD_LOOK_M / (vKmh / 3.6)
```

Pri 120 km/h:

```ts
220 / (120 / 3.6) = 6.6 s
```

## Známe slabiny

### 1. Vozidlo sa opticky posunulo bokom a vyhlo sa kolízii

Toto sa môže stať, keď sa premietnutá poloha trafficu mení rýchlejšie, než hráč
očakáva. Pred poslednou opravou bola v pass-by fáze aj umelá bočná zložka:

```ts
x += side * pass * 18
```

Bol to vizuálny trik, aby auto pri míňaní odišlo zo záberu. Pre kolízie to však
bolo zlé, pretože blízky bočný kontakt sa mohol v momente prechodu do pass-by
fázy zmeniť na miss.

Aktuálny stav: umelý bočný odsun je odstránený. Pass-by vozidlo drží:

```ts
x = centerX + vehicle.x * ROAD_HALF_BOTTOM
```

Je to lepšie, ale nie dokonalé. Väčší problém ostáva: projekcia trafficu je
kvantovaná scanline riadkami a zaokrúhľovaná na celé pixely.

### 2. Tunneling — VYRIEŠENÉ v 0.17.1

Premávka sa najprv posunie a kolízia sa testuje raz za frame:

```ts
tickTraffic(...)
projectTrafficVehicle(...)
checkTruckTrafficCollision(...)
```

Ak je relatívna rýchlosť vysoká, oncoming auto môže medzi dvoma framami prejsť
zo stavu "ešte sa nedotýka" do stavu "už je za kamerou". Pass-by fáza riziko
znižuje, ale nerieši plne continuous collision.

Robustnejšie riešenie by bolo swept collision:

```ts
previousProjection -> currentProjection
test interpolated positions or swept mask/rect
```

Pre Ice Haul pravdepodobne stačí lacnejšia aproximácia:

- pri blízkych vozidlách testovať kolíziu dvakrát alebo trikrát za frame,
- držať predchádzajúci premietnutý rect a testovať starý aj nový,
- pri prechode cez `worldZ = 0` vynútiť kontakt sample presne v nulovej hĺbke.


### Ako je tunneling vyriešený

Od 0.17.1 sa blízke pole **nevzorkuje raz, ale prechádza**. Implementácia je
`src/game/collisionSweep.ts` a napojenie v `drive.ts`.

Prečo to bolo treba, v číslach nameraných pri 60 fps:

| | Rovnaký smer (rozdiel 20 km/h) | **Protismer (90 + 80 km/h)** |
|---|---:|---:|
| Zbližovanie | 5,6 m/s | **47,2 m/s** |
| Posun za snímok | 0,093 m | **0,787 m** |
| Snímkov v celom 6 m okne | **64,8** | **7,6** |
| Skok na snímok pri 3 m | 2 riadky | **18 riadkov** |

Kamión je vysoký 64 px, takže protiidúce auto preskočilo **28 % jeho výšky medzi
dvoma snímkami**. Kontakt nerozhodovala geometria, ale to, kam tých pár vzoriek
náhodou padlo — čo je jedna chyba s dvoma tvárami: nespravodlivá havária a
minutie, ktoré malo byť zásahom.

Riešenie má tri vlastnosti, ktoré stoja za zapamätanie:

1. **Zbližovanie sa počíta z rýchlostí, nie z pamätanej polohy.** `tickTraffic`
   hýbe protiidúcimi o `-speed/3.6 * dt` a kamerou o `+speed/3.6 * dt`, takže
   rýchlosť je presná a nepotrebuje históriu na vozidlo.
2. **Počet vzoriek sa odvodí zo zbližovania**, takže cena rastie len tam, kde
   rastie riziko: protiidúce auto pri kabíne dostane 4 vzorky, doprava v rovnakom
   smere a čokoľvek za 8 m dostane jednu — teda pôvodnú cenu.
3. **Hĺbka `worldZ = 0` sa testuje presne**, nie sa nechá na to, kam padne
   rovnomerné delenie. Je to najhorší prípad a hráč ho cíti najviac.

Najhorší skok tým klesol z 18 riadkov na ≤ 6. Test to stráži z oboch strán:
nevzorkovaný skok je stále 18, prejdený najviac 6.

### 3. Pixel-perfect, ale nie pocitovo férové

Pixel-perfect kolízia môže stále pôsobiť zle, keď:

- sprite art má veľké transparentné diery,
- projekcia položí sprite inde, než hráč pocitovo čaká,
- objekt zmizne príliš skoro,
- výsledok je iba binárny game over.

Hráč neposudzuje kolíziu podľa zdrojového bitmapového gridu, ale podľa vnímaného
tvaru a pohybu. Preto je debug overlay veľmi dôležitý.

## Jednoduché tuning body

### Premávka sa má dať ľahšie obísť

Zmenšiť projekčnú šírku:

```ts
trafficSpriteSize('car').w
```

Alebo zúžiť iba kolíziu:

```ts
collisionW = visualW * 0.85
```

Druhá možnosť je menej poctivá vizuálne, ale často pôsobí férovejšie.

### Bočné ťukance majú byť pravdepodobnejšie

Predĺžiť pass-by fázu alebo zväčšiť near-field sprite:

```ts
TRAFFIC_PASS_BEHIND_M = 6 or 7
scale = 1.55 + pass * 0.15
```

Alebo pridať dodatočné sample testy, keď `worldZ < 2`.

### Menej okamžitých crashov

Namiesto boolean kolízie zaviesť počet prekrytých pixelov:

```ts
overlapPixels = count truck/traffic solid overlap
severity = overlapPixels / min(truckSolidPixels, trafficSolidPixels)
```

Potom:

```ts
if severity < scrapeThreshold -> iskry/zvuk/vx impulse/damage
else if severity < crashThreshold -> šmyk + poškodenie
else crash
```

### Mäkkší off-road

Zvýšiť:

```ts
OFFROAD_CRASH_SEVERITY
OFFROAD_TIMEOUT_S
```

alebo znížiť:

```ts
OFF_ROAD_DRAG
OFF_ROAD_RETURN
```

### Hooky pre obtiažnosť

Dobré kandidáty:

```ts
trafficDensityMultiplier
trafficSpeedMultiplier
fuelMultiplier
warningLookAheadM
gripMultiplier
chainsDurationS
chainsCooldownS
chainsScorePenalty
```

Varovanie by neskôr malo byť skôr časové než iba metrové:

```ts
warningLookAheadM = baseLookAheadM + (speedKmh / 3.6) * extraWarningSeconds
```

Tak hráč dostane podobný čas na reakciu pri rôznych rýchlostiach.



---

# Roadmap

Nasledujúce sekcie sú pôvodný plán pre kolízie. Fáza 3 (swept near-field
sampling) je **hotová** — viď vyššie. Ostatné zostávajú otvorené.

## Odporúčaný roadmap pre kolízie

### Fáza 1: debug viditeľnosť

Pridať collision proof overlay:

- solid maska kamiónu jednou farbou,
- solid maska trafficu druhou farbou,
- prekryté pixely červeno/žlto,
- hodnoty `worldZ`, `trafficLeft/top/w/h`, `overlapPixels`.

Toto priamo rieši problémy typu "nedotkol som sa" alebo "mal som sa dotknúť".

### Fáza 2: klasifikácia kontaktu

Zmeniť traffic kolíziu z boolean na výsledok:

```ts
interface TrafficCollisionResult {
  hit: boolean
  overlapPixels: number
  severity: number
  centerX: number
  centerY: number
  side: 'front' | 'rear' | 'left' | 'right' | 'unknown'
}
```

Tým vzniknú:

- bočné škrtnutie,
- koleso na koleso,
- ťuknutie do nárazníka,
- tvrdý crash.

### Fáza 3: swept near-field sampling

Ukladať predchádzajúcu projekciu traffic vozidla. Pre blízke vozidlá:

```ts
for alpha of [0, 0.5, 1]:
  sample = lerp(previousProjection, currentProjection, alpha)
  test sample
```

Je to lacnejšie než plný fyzikálny engine a malo by zachytiť väčšinu tunnelingu.

### Fáza 4: poškodenie a šmyk namiesto okamžitého game over

Slabý overlap by mal:

- postrčiť `v.vx`,
- znížiť rýchlosť,
- pustiť častice,
- poškodiť náklad/kamión,
- prípadne spustiť šmyk.

Silný overlap má stále skončiť crashom.

### Fáza 5: vina za kontakt

ETS2 frustrácia často vzniká preto, že hráč dostane pokutu aj keď konflikt
spôsobila AI. Ice Haul zatiaľ nemá právny/fine systém, ale ak niekedy bude,
treba oddeliť "kontakt nastal" od "hráč je vinný".

Vina by mala brať do úvahy:

- kto menil pruh,
- kto už pruh obsadzoval,
- relatívnu rýchlosť,
- či bol hráč v legálnom pruhu,
- či traffic predbiehal alebo šiel v protismere.

## Porovnanie s inými hrami

### OutRun / OutRun 2006

OutRun 2006 je primárne arkáda. Recenzie zdôrazňujú powersliding, premávku a
"priateľskejší kolízny systém" v OutRun2 SP / Coast 2 Coast. Poučenie pre Ice
Haul nie je realizmus, ale čitateľnosť a odpustenie. Arkádová kolízia môže byť
zámerne mäkšia, ak hra stojí na flow.

Použiteľné pre Ice Haul:

- zúžiť kolíziu pri vysokej rýchlosti,
- povoliť side rubs,
- použiť kontakt na spomalenie/odklonenie namiesto okamžitého zničenia.

Zdroj:

- Pocket Gamer recenzia OutRun 2006: Coast to Coast:
  https://www.pocketgamer.com/outrun-2006-coast-to-coast/review/

### Forza Motorsport / Forza Horizon

Forza-like hry oddeľujú kolíziu, kozmetické poškodenie, mechanické poškodenie a
difficulty/assist nastavenia. GameSpot preview prvého Forza Motorsport opisuje
lokalizované poškodenie podľa miesta kontaktu a dopad na výkon auta hlavne pri
maximum damage nastavení. Turnajové pravidlá pre Forza 7 zároveň ukazujú, že
hra vie pracovať s oddelenými nastaveniami typu steering, damage difficulty a
collision mode.

Použiteľné pre Ice Haul:

- oddeliť vizuálny kontakt od mechanického následku,
- mať difficulty nastavenia,
- kontakt môže degradovať ovládanie, náklad, palivo alebo stav kamiónu namiesto
  okamžitého konca.

Zdroje:

- GameSpot Forza Motorsport preview:
  https://www.gamespot.com/articles/forza-motorsport-updated-hands-on/1100-6117786/
- príklad Forza 7 tournament nastavení:
  https://afbn.me/wp-content/uploads/2023/02/A-Few-Bad-Newbies-Complete-Whitepaper-Document-2.pdf

### Assetto Corsa Competizione

ACC stojí na detailnej práci s pneumatikami a dynamikou vozidla. Fyzikálne
poznámky k verzii 1.9 riešia tlak, teplotu, flex, surface temperature, camber,
toe a správanie pri brzdení, akcelerácii a zatáčaní.

Použiteľné pre Ice Haul:

- nesnažiť sa o plný tire simulator,
- ale držať slip/grip model explicitný a laditeľný,
- robiť rozdiely povrchov viditeľné a počuteľné.

Zdroj:

- ACC v1.9 physics notes:
  https://assettocorsa.gg/wp-content/uploads/ACCv19-physics_notes.pdf

### BeamNG.drive

BeamNG je opačný extrém: soft-body node/beam simulácia. Vozidlá sú deformovateľné
štruktúry z uzlov a nosníkov; komponenty sa simulujú a deformujú v reálnom čase.

Použiteľné pre Ice Haul:

- nie implementácia,
- ale princíp: poškodenie má byť priestorové a napojené na ovládanie,
- bočný zásah nemá mať rovnaký následok ako čelný náraz.

Zdroj:

- BeamNG soft-body physics overview:
  https://beamng.com/game/about/physics/

### Wreckfest / deštrukčné závodné hry

Wreckfest a podobné hry robia z poškodenia súčasť spektáklu aj gameplayu.
Rozhovory a coverage zdôrazňujú rozdiel medzi forgiving a realistic damage,
lokalizované poškodenie a spätnú väzbu do ovládania.

Použiteľné pre Ice Haul:

- mať difficulty/damage módy,
- slabé kolízie môžu byť zábavné, ak vytvoria riešiteľný chaos,
- realistické poškodenie bude príliš trestajúce bez stupňov obtiažnosti.

Zdroje:

- Red Bull rozhovor s Wreckfest dizajnérom:
  https://www.redbull.com/us-en/wreckfest-game-developer-interview
- Hardcore Gamer o location-based damage:
  https://hardcoregamer.com/news/bugbears-next-car-game-finally-gets-official-title-wreckfest/109791/

### Destruction Derby

Destruction Derby postavilo kolízie do stredu hry. Dôležité nie je len poškodenie,
ale predvídateľnosť výsledku. Ak hráč nerozumie tomu, čo sa stane pri kontakte,
kolízia pôsobí nefér.

Použiteľné pre Ice Haul:

- hráč musí vedieť predvídať následok kontaktu,
- debug overlay a stabilná near-field projekcia sú dôležitejšie než ďalšia
  komplexita.

Referencia:

- Destruction Derby overview:
  https://en.wikipedia.org/wiki/Destruction_Derby

### ETS2 / American Truck Simulator

ETS2/ATS sú relevantné preto, že Ice Haul je kamiónová hra. Poučenie nie je iba
fyzika, ale vnímanie viny. Hráči často reportujú frustráciu, keď do nich narazí
AI, najmä na kruhových objazdoch, ale pokutu dostane hráč. To je problém
ownership/fault logiky, nie len hit detection.

Použiteľné pre Ice Haul:

- ak pribudnú pokuty alebo hodnotenie jazdy, treba oddeliť "kontakt nastal" od
  "hráč je vinný",
- zámer AI a obsadenie pruhu sú dôležité,
- pravidlá pruhov/kruhových objazdov potrebujú explicitnú logiku.

Zdroje:

- Truck Simulator Wiki fines:
  https://trucksimulator.wiki.gg/wiki/Fines
- Steam diskusia o ETS2 roundabout AI:
  https://steamcommunity.com/app/227300/discussions/0/350542683188607682/

## Teória kolíznej odozvy

Plné fyzikálne enginy zvyčajne oddeľujú:

1. collision detection,
2. contact manifold,
3. penetration resolution,
4. impulse/friction response,
5. gameplay side effects.

Ice Haul dnes robí detection a okamžitý herný následok, ale nemá samostatnú
response fázu. Poznámky Newcastle University ku game physics opisujú bežný
postup: projekciou oddeliť preniknuté objekty a potom impulse metódou vyriešiť
pohybovú odozvu. Pre Ice Haul je to príliš ťažké ako plný systém, ale architektúra
oddelených krokov je použiteľná.

Zdroj:

- Newcastle collision response notes:
  https://research.ncl.ac.uk/game/mastersdegree/gametechnologies/physicstutorials/5collisionresponse/Physics%20-%20Collision%20Response.pdf

## Navrhovaný Ice Haul model

Najvhodnejší model:

```text
broad phase:
  traffic v hĺbkovom rozsahu
  near screen rect približne prekrýva truck rect

narrow phase:
  truck pixel mask vs traffic pixel mask

classification:
  počet overlap pixelov
  stred overlapu
  relatívny pohyb
  strana kontaktu

response:
  škrtnutie -> častice, zvuk, malý vx/speed zásah
  bočný ťukanec -> šmyk, damage, silnejší vx impulse
  nárazník -> silné spomalenie, damage
  tvrdý overlap / vysoká rýchlosť -> crash
```

Navrhované vzorce:

```ts
relativeSpeedMps = abs(playerSpeedKmh - trafficSpeedKmh) / 3.6
impactEnergyProxy = overlapPixels * relativeSpeedMps * relativeSpeedMps
severity = clamp01(impactEnergyProxy / ENERGY_CRASH_SCALE)
```

Klasifikácia strany:

```ts
overlapCenterX = average(overlapPixelX)
truckCenterX = truckDrawX + TRUCK_BMP_W / 2
sideBias = (overlapCenterX - truckCenterX) / (TRUCK_BMP_W / 2)

if sideBias < -0.4 -> ľavá strana
if sideBias >  0.4 -> pravá strana
else front/rear/center contact
```

Odozva:

```ts
v.speed -= speedLossKmh
v.vx += sideImpulse
damage += severity
```

Kde:

```ts
speedLossKmh = relativeSpeedMps * severity * SPEED_LOSS_SCALE
sideImpulse = sign(sideBias) * severity * SIDE_IMPULSE_SCALE
```

## Testovací plán

Existujúce testy už pokrývajú:

- rozmery masky kamiónu,
- off-road severity,
- transparentné traffic pixely,
- centrovanú traffic kolíziu,
- ľavý pruh bez kolízie,
- pass-by bočný kontakt,
- rast traffic projekcie a near visibility.

Odporúčané nové testy:

1. Swept crossing:
   vozidlo sa za frame presunie z `worldZ = 1` na `worldZ = -1` a stále sa
   zachytí kontakt.

2. Side scrape:
   malý overlap vráti non-crash severity.

3. Koleso na koleso:
   nízky, bočne posunutý overlap vráti side kontakt.

4. Debug consistency:
   rovnaké rows sa používajú na kreslenie aj kolíziu.

5. Difficulty:
   warning lookahead a traffic density sa menia podľa obtiažnosti.

## Praktické odporúčania

Najbližšie kroky:

1. pridať collision debug overlay,
2. zmeniť `checkTruckTrafficCollision()` z boolean na overlap result,
3. pridať 2-sample alebo 3-sample near-field collision pre `worldZ < 2`,
4. pridať scrape/skid response pred plným crashom,
5. všetky zmeny projekcie kryť testami.

Čomu sa vyhnúť:

- plný rigid-body physics,
- skryté world-space crash radiusy,
- kolízia väčšia než viditeľný sprite bez debug vysvetlenia,
- vizuálny pass-by pohyb, ktorý nenasleduje kolízia.

Hlavné pravidlo:

```text
World-space môže rozhodnúť, čo sa oplatí testovať.
Screen-space pixely rozhodujú, či sa hráč dotkol objektu.
Gameplay response rozhoduje, aký vážny kontakt bol.
```
