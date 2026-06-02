# Drivetrain Roadmap — Gearbox, Stall, and What Comes Next

Status doc for Ice Haul's manual-drivetrain line of work. Captures what is **done**,
the owner's **future ideas** (with an honest assessment of each), and a handful of
**agent-proposed ideas**. This is a planning doc — backlog, not committed work.

Date: 2026-06-02.

---

## 1. Implemented

- **Manual 5-speed gearbox** (`config.ts: GEARS`, `game/vehicle.ts`). Each gear has a
  speed band `[from, to]` and a torque value. **1st caps at ~28 km/h — you cannot reach
  120 in a low gear.** Acceleration is deliberately slow (0→120 ≈ 30 s through the gears).
- **RPM model + gauge.** `rpm = (speed - gear.from) / gear.span`. Lugging below the band
  = weak torque; redline (`rpm ≥ 1`) = no pull, must upshift. Shown as the left-panel
  RPM bar (green → red).
- **Controls.** `A` = shift up, `D` = shift down (edge-triggered); `ENTER` = ignition.
- **Stall mechanic** (`STALL_RPM = -0.35`). Brake/slow without downshifting and revs fall
  below the gear band → engine dies. 1st gear (`from = 0`) is immune. A stalled engine
  **freewheels** (no power, no fuel burn) until restarted with **ENTER**, which re-engages
  a sensible gear (`startableGear`).
- **Stall warning + grace** (`STALL_GRACE_MS = 3500`). Before the engine actually dies it
  lugs and **coughs** for ~3.5 s with an `ENGINE STALLING / SHIFT DOWN D` overlay —
  enough time to react mid-corner on snow. Downshifting in time cancels it.
- **RPM-driven engine audio** (`audio/engine.ts`). Engine pitch follows RPM within the
  gear, so revs **drop on an upshift** and climb as you accelerate. Silent when stalled
  (tyres roll on). Shift blip, stall "dying" sound, ignition crank.
- **HUD left panel reworked** to a drivetrain cluster: FUEL · RPM · GEAR · GRIP (the old
  static compass + double GRIP bar were removed).
- **Delivery time budget 7 → 8 min** to suit the slower acceleration (a careful driver
  must still finish 5 km on time; verified by `completability.test.ts`).

---

## 2. Owner's future ideas — honest assessment

> Verdicts are objective: endorse where it's good, push back where there's a real reason.

### 2.1 Non-instant engine start (few seconds + AY/beeper crank sound)
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

---

## 3. Agent-proposed ideas (easiest → hardest)

1. **Redline upshift warning (easiest).** The symmetric twin of the new stall/downshift
   warning: when `rpm` pins at redline, flash the RPM bar + a buzzer + a `SHIFT UP` hint.
   Teaches both ends of the band. Pure UI + audio off the existing `rpm`. ~30 min.

2. **Downshift rev-protection / no money-shifts (easy).** Refuse a downshift that would slam
   revs past redline at the current speed (e.g. 5th→2nd at 90): play a "grind/clunk" reject
   SFX and don't change gear. Prevents accidental engine-killing downshifts and teaches the
   gear map. A few lines in the shift logic, reusing the gear bands.

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

## 4. Suggested sequencing

Cheap feel-wins first, the economy layer last:

```
1. Redline upshift warning            (agent #1)   — easiest, complements stall warning
2. Downshift rev-protection           (agent #2)
3. Non-instant engine start           (owner 2.1)  — deepens the stall penalty
4. Weight-based acceleration          (owner 2.2)  — small; enables cargo variety
5. Tach dial + prominent speed number (owner 2.5, middle-ground form)
6. Damage accumulators + % display    (owner 2.3a)
7. Low-speed bump = damage + continue (owner 2.4)  — needs #6
8. Money + repair + pit-stop          (owner 2.3c) — career layer
9. Road gradients                     (agent #4)   — hardest, biggest gameplay change
10. Shift-assist hint                 (agent #3)   — anytime after an options menu exists
```

The decision filter (same as the kit roadmap): does the change make the *manual gearbox
matter more* or read *more clearly*? If yes, prioritise; if it's just more surface, park it.
