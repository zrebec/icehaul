/**
 * Central configuration — every tunable constant lives here.
 * Grouped by system. Import what you need, tune in one place.
 */

// ── Canvas & layout ─────────────────────────────────────────────────────────

/** Game canvas width in pixels. ZX Spectrum native: 256. */
export const GAME_WIDTH = 256
/** Game canvas height in pixels. ZX Spectrum native: 192. */
export const GAME_HEIGHT = 192
/** Character columns (GAME_WIDTH / 8). */
export const COLS = GAME_WIDTH / 8
/** Character rows (GAME_HEIGHT / 8). */
export const ROWS = GAME_HEIGHT / 8
/** CSS-pixel scale factor passed to setupCanvas. */
export const CANVAS_SCALE = 4

/** Top status bar height in cell rows. */
export const STATUS_BAR_ROWS = 2
/** Bottom HUD instrument panel height in cell rows. */
export const HUD_ROWS = 9
/** First pixel row of the driving viewport. */
export const VIEWPORT_TOP = STATUS_BAR_ROWS * 8
/** Last+1 pixel row of the driving viewport. */
export const VIEWPORT_BOTTOM = GAME_HEIGHT - HUD_ROWS * 8
/** Driving viewport height in pixels. */
export const VIEWPORT_HEIGHT = VIEWPORT_BOTTOM - VIEWPORT_TOP
/** Horizon as fraction of viewport height from top. */
export const HORIZON_PCT = 0.15

// ── Road shape — the dials worth playing with ───────────────────────────────
//
// Deliberately at the top of the file rather than filed under "Road rendering"
// further down: these five decide what the road *looks* like, they interact,
// and they are the ones that get re-tuned by eye. Everything else about the
// road is downstream of them.
//
// Together with HORIZON_PCT above they define the whole ribbon. Substituting
// `i = round(PERSPECTIVE_K / z) - 1` and `t = (i+1)/roadHeight` collapses the
// renderer's per-scanline arithmetic into one law:
//
//     half(z) = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * (PERSPECTIVE_K/z) / roadHeight
//             = ROAD_HALF_TOP + 178.652 / z            (at today's values)
//
// Six places compute that expression — road3d.ts (road, canisters, traffic,
// roadside) and roadgeometry.ts (the off-road boundary) — so a change here
// moves the painted road and the boundary the player is judged against
// together, which is the only way they may ever move.

/**
 * Road half-width at the horizon, in game pixels. The ribbon is `2 x` this wide
 * where it meets the sky.
 *
 * Not a perspective quantity — true perspective would converge to zero and the
 * road would vanish into a point three scanlines up. This additive floor is what
 * keeps a readable ribbon at the horizon, and it is the `ROAD_HALF_TOP` term in
 * the law above.
 *
 * ── Why it moved from 14 to 24 ──────────────────────────────────────────────
 * A vehicle's size is a different fake: `scale(z) = A / (z + B)`, which never
 * grows past `A/B`. Divide the two and the share of a lane a vehicle covers has
 * an interior maximum with a closed form,
 *
 *     z* = sqrt(TRAFFIC_SCALE_B * 178.652 / ROAD_HALF_TOP)
 *
 * so the hump is structural rather than a tuning slip — the ratio goes to zero
 * at both ends and has to peak somewhere in between. At 14 it peaked at 20.9 m
 * holding **1.21 lanes for a bus**, which is what the owner saw: a vehicle drawn
 * wider than the lane it sits in, between roughly 40 m and 10 m.
 *
 * Raising this floor is the one lever that fixes the ratio without touching
 * vehicle scale, so the growth curve (#30), the approach cadence (#34), the LOD
 * thresholds and every collision raster stay byte-identical. At 24 the bus peaks
 * at 0.84 of a lane and z* moves to 16.0 m.
 *
 * ── The open question, kept here on purpose ─────────────────────────────────
 * 24 costs a 48 px ribbon at the horizon instead of 28 — a less funnel-like
 * perspective. Owner accepted that for now and wants to revisit narrowing it.
 * The dial is continuous, and the bus's peak lane share moves with it:
 *
 *     20 -> 0.94    22 -> 0.89    24 -> 0.84    26 -> 0.80
 *
 * Anything at or below about 26 keeps every vehicle inside its lane.
 * `laneFit.test.ts` holds the property, not the number, so it will follow a
 * re-tune rather than fight it — but it fails below roughly 18, which is the
 * point of it.
 */
export const ROAD_HALF_TOP = 24
/**
 * Road half-width at the bottom of the viewport, in game pixels.
 *
 * 120 makes the road 240 px across a 256 px screen — a very wide ribbon, and
 * the reason a vehicle beside the player covers only a third of its lane while
 * the player's own truck (a fixed 32 x 40 px box) covers a quarter. Narrowing
 * it would improve that end and make the middle worse, and it moves the
 * off-road boundary, so it is a difficulty change and invalidates the seed
 * catalogue in AGENTS.md. Not a dial to turn casually.
 */
export const ROAD_HALF_BOTTOM = 120
/**
 * Projection depth constant, in metres. Sets how fast the world rushes at you:
 * a scanline `dy` below the horizon is `PERSPECTIVE_K / dy` metres away.
 *
 * At 150 the first three scanlines carry 220 m, 75 m and 50 m, so the entire
 * far field lives in two pixels of height. That is why traffic size cannot be
 * a function of the scanline and is hyperbolic in true world depth instead
 * (see TRAFFIC_SCALE_* below). Raising it stretches the far field down the
 * screen and compresses the near one.
 */
export const PERSPECTIVE_K = 150
/**
 * How hard a bend pushes the road sideways per unit of curvature. The bend the
 * player steers against and the bend they see are the same number, so this is
 * a difficulty dial as much as a visual one.
 */
export const CURVE_STRENGTH = 1.0
/**
 * How far the vanishing point slides per unit of player lateral position.
 *
 * Note it is not the axis the truck itself moves on: the truck is drawn at
 * `GAME_WIDTH/2 + v.x * 50` (drive.ts), so the player moves 50 + 22 = 72 px per
 * unit relative to the road, while a traffic vehicle's `x` moves it `half` px
 * per unit with +/-1 being the road edge exactly. The player's `x` and traffic's
 * `x` therefore mean two different things — see AGENTS.md.
 */
export const LATERAL_SHIFT = 22

// ── Surface types & per-surface physics ─────────────────────────────────────

export type Surface = 'asphalt' | 'snow' | 'ice' | 'sand' | 'mud'

/** Per-surface acceleration multiplier applied to base ACCEL. */
export const SURFACE_ACCEL: Record<Surface, number> = {
  asphalt: 1.0,
  snow: 0.55,
  ice: 1.8,
  sand: 0.35,
  mud: 0.35,
}

/** Per-surface grip (0–1). Steering + damping + centrifugal drift. */
export const SURFACE_GRIP: Record<Surface, number> = {
  asphalt: 1.0,
  snow: 0.45,
  ice: 0.25,
  sand: 0.35,
  mud: 0.45,
}

/**
 * Per-surface passive speed drag — km/h lost per second (velocity-proportional).
 *
 * ── HOW IT WORKS ────────────────────────────────────────────────────────────
 * Applied every physics tick regardless of throttle, in vehicle.ts:
 *
 *   Δspeed = −SURFACE_DRAG[s] × (speed / MAX_SPEED) × dt
 *
 * Linear drag: proportional to current speed. Think of it as wheel-ploughing
 * (mud, sand) or surface compaction resistance (snow). It is separate from and
 * stacks with the other resistive forces:
 *   • AERO_DRAG        quadratic, all surfaces, dominates at high speed
 *   • ROLLING_RESISTANCE  linear, all surfaces, small
 *   • ENGINE_BRAKE     throttle released — engine compression, all surfaces
 *   • SURFACE_ACCEL    scales engine OUTPUT (not drag); see below
 *
 * ── DOUBLE-PENALTY INTERACTION WITH SURFACE_ACCEL ───────────────────────────
 * SURFACE_ACCEL reduces how much force the engine can produce on that surface.
 * SURFACE_DRAG adds how much resistance the surface imposes passively.
 * Both stack multiplicatively, creating a strong "terrain difficulty" effect.
 *
 * At full throttle in the power band, drag and engine force balance at:
 *
 *   v_eq = GEARS[G].accel × SURFACE_ACCEL[S] × MAX_SPEED / SURFACE_DRAG[S]
 *
 *   v_eq ≥ GEARS[G].to  → gear is drag-free: top speed is gear-limited.
 *   v_eq < GEARS[G].to  → gear is drag-limited: you never reach the gear's
 *                          rated top speed on this surface.
 *
 * CRITICAL WARNING — if SURFACE_DRAG is set too high, the double-penalty
 * overwhelms all gears except 1st. The pre-fix values (mud=8, sand=7)
 * produced the following drag-limited tops in 2nd gear:
 *   mud: 4.2 × 0.35 × 120 / 8  = 22 km/h   ← below any usable speed
 *   sand: 4.2 × 0.35 × 120 / 7 = 25 km/h   ← same trap
 * With mud=4 and sand=3, 2nd gear equilibrium is now ~44 and ~59 km/h
 * respectively — 2nd/3rd work, 4th/5th are meaningfully drag-limited.
 * The invariant to preserve: 2nd gear must be able to sustain its lower
 * speed range. Safe upper bound: SURFACE_DRAG < GEARS[1].accel ×
 * SURFACE_ACCEL × MAX_SPEED / GEARS[1].to  (i.e. drag-free threshold for
 * 2nd). For mud that is 4.2 × 0.35 × 120 / 52 ≈ 3.4; mud=4 deliberately
 * exceeds it slightly (drag-limited at 44 km/h) for realism.
 *
 * ── BALLISTIC TRAJECTORY (coasting behaviour) ───────────────────────────────
 * SURFACE_DRAG is active whether you are on throttle or not. On asphalt and
 * ice (drag=0) the truck coasts freely — its trajectory is shaped only by
 * AERO_DRAG and ENGINE_BRAKE, and it barely slows over a few seconds. On mud
 * and sand you cannot glide: releasing the throttle at 60 km/h on mud loses
 * ~2.0 km/h/s from surface drag alone (4 × 60/120 = 2.0), so the truck sheds
 * ~10 km/h in 5 seconds of coasting. This creates a "keep the power on"
 * commitment feel on heavy terrain, especially approaching corners.
 *
 * ── ENGINE LOAD AND TORQUE (RPM BAR BEHAVIOUR) ──────────────────────────────
 * SURFACE_DRAG does not raise engine RPM directly (RPM is always speed/gear.to).
 * However, drag lowers equilibrium speed → the truck sits at a lower rpm fraction
 * → deeper in the bog zone → torque multiplier is weaker → the engine strains
 * without actually showing high RPM. The RPM bar reading low on mud/sand is the
 * correct read-out of this state: surface drag is pulling the truck back faster
 * than the engine can push it forward in a tall gear, and the engine is doing all
 * it can. Downshifting raises rpm into the power band, restoring torque.
 *
 * ── PER-SURFACE VALUES AND RATIONALE ────────────────────────────────────────
 *
 * asphalt  0   Hard, sealed road. No wheel-ploughing, no surface deformation.
 *              Rolling resistance and aero drag are already modelled separately
 *              (ROLLING_RESISTANCE, AERO_DRAG). The truck coasts freely — a 20 t
 *              vehicle on asphalt genuinely does. Do not add drag here; it would
 *              fight the existing resistance model.
 *
 * snow     4   Compacted snow packs under the tyres but offers real resistance from
 *              surface deformation and small ploughing effect. Paired with
 *              SURFACE_ACCEL=0.55 the combined effect feels "slowed but manageable."
 *              Equilibrium by gear at full throttle (power band):
 *                1st  28 km/h (drag-free, gear-limited)
 *                2nd  52 km/h (drag-free: v_eq = 4.2 × 0.55 × 120/4 = 69)
 *                3rd  ~53 km/h (drag-limited: v_eq = 3.2 × 0.55 × 120/4 = 52.8)
 *                4th  ~40 km/h    5th  ~30 km/h
 *              Raise toward 6–8 for loose deep powder; lower toward 2 for
 *              hard-packed ice-road snow.
 *
 * ice      0   Frictionless rolling surface — ice roads have very low tyre
 *              rolling resistance. No drag. The hazard on ice is SURFACE_GRIP=0.25
 *              (steering nearly gone) and SURFACE_ACCEL=1.8 (engine pulls hard —
 *              wheel-spin, fast acceleration). You zoom and cannot steer. Intentional
 *              asymmetry: ice is fast and uncontrollable, not slow and slippery.
 *              Adding drag here would contradict the "grip is the danger" design.
 *
 * sand     3   Dry sand lets wheels sink slightly and displaces easily. Less viscous
 *              suction than mud (drier, non-cohesive), so drag is lower. Paired with
 *              SURFACE_ACCEL=0.35:
 *                1st  28 km/h (gear-limited)
 *                2nd  52 km/h (drag-free: v_eq = 4.2 × 0.35 × 120/3 = 58.8)
 *                3rd  ~45 km/h (v_eq = 3.2 × 0.35 × 120/3 = 44.8)
 *                4th  ~34 km/h    5th  ~25 km/h
 *              Raise toward 5 for deep loose dunes; lower toward 1 for
 *              hard-packed desert track.
 *
 * mud      4   Most punishing surface. Wet clay/silt causes deep wheel-ploughing and
 *              viscous suction when the wheel lifts. Combined with SURFACE_ACCEL=0.35
 *              (weakest engine output) this is the hardest terrain in the game.
 *              Equilibrium by gear at full throttle (power band):
 *                1st  28 km/h (gear-limited: v_eq = 5.5 × 0.35 × 120/4 = 57.8)
 *                2nd  ~44 km/h (drag-limited: v_eq = 4.2 × 0.35 × 120/4 = 44.1)
 *                3rd  ~34 km/h    4th  ~25 km/h    5th  ~19 km/h
 *              Optimal strategy: stay in 2nd on mud. 3rd is possible but slow;
 *              4th+ drain speed. Raising toward 6+ risks the double-penalty trap
 *              (1st-gear-only). Never set above ~5 with SURFACE_ACCEL=0.35.
 * Values before: 0, 4, 0, 7, 8
 * New values: 0, 4, 0, 3, 4
 */
export const SURFACE_DRAG: Record<Surface, number> = {
  asphalt: 0,
  snow: 4,
  ice: 0,
  sand: 3,
  mud: 4,
}

/**
 * Per-surface brake profile — comprehensive braking model.
 *
 * decel:       Base deceleration in km/h/s. Heavy truck = 25-35.
 * speedFade:   How much speed reduces braking (0–1). At 1: zero brakes at MAX_SPEED.
 * lockSpeed:   Above this km/h, wheels tend to lock under full braking.
 * lateralLoss: Lateral grip loss when braking (0=none, 1=total).
 *              Increases further when speed > lockSpeed (locked wheels).
 * sound:       Brake sound type for AY chip.
 */
export interface BrakeProfile {
  decel: number
  speedFade: number
  lockSpeed: number
  lateralLoss: number
  sound: 'screech' | 'grind' | 'none'
}

/**
 * Stopping time from 120 km/h (approx):
 *   asphalt: ~10s    snow: ~14s    ice: ~25s+    sand: ~16s    mud: ~15s
 *
 * Compare: car = 3-4s, real 20t truck = 6-8s.
 * We're slightly slower than reality for HEAVY feel.
 */
export const SURFACE_BRAKE: Record<Surface, BrakeProfile> = {
  asphalt: { decel: 18, speedFade: 0.40, lockSpeed: 100, lateralLoss: 0.10, sound: 'screech' },
  snow: { decel: 12, speedFade: 0.40, lockSpeed: 55, lateralLoss: 0.30, sound: 'none' },
  // ── Ice: harsh on purpose, and the harshness is the correct model ──────────
  // lateralLoss IS the friction circle. A tyre has one force budget of μ·N, and
  // whatever braking spends is not available to turn; on ice that budget is tiny,
  // so braking and steering at once genuinely does not work. 0.50 already leaves
  // half the wheel, which is generous against the physics.
  //
  // A 0.35 / lockSpeed 45 variant was tried and reverted. It made braking mid-
  // corner work, which is the one thing real ice forbids, and raising lockSpeed
  // had it backwards — wheels lock at LOWER speeds on ice, not higher. The
  // player's counter is not a better brake, it is the ICE AHEAD warning: brake
  // early, in a straight line, then coast the corner.
  //
  // ── KNOWN INCONSISTENCY, worth fixing after a playtest ─────────────────────
  // Cornering implies μ_ice ≈ 0.155 (see SURFACE_CURVE_DRIFT_MULT), but
  // decel 8 km/h/s = 2.22 m/s² implies μ ≈ 0.227. Today it is easier to stop on
  // ice than to turn on it, which is backwards. The consistent value is
  // decel ≈ 5.5, taking the 40 km/h stopping distance from ~28 m to ~42 m — the
  // real figure for bare ice. That is a difficulty increase, so it needs a
  // playtest and a check that ICE_AHEAD_LOOK_M still gives room to act.
  ice: { decel: 8, speedFade: 0.55, lockSpeed: 30, lateralLoss: 0.50, sound: 'grind' },
  sand: { decel: 10, speedFade: 0.30, lockSpeed: 80, lateralLoss: 0.15, sound: 'none' },
  mud: { decel: 11, speedFade: 0.35, lockSpeed: 65, lateralLoss: 0.25, sound: 'none' },
}

/**
 * Per-surface skid enabled flag.
 * On sand: no skid (problem is resistance, not slipperiness).
 * On ice/snow/mud: skid active (slippery).
 */
export const SURFACE_SKID_ENABLED: Record<Surface, boolean> = {
  asphalt: false,
  snow: true,
  ice: true,
  sand: false,
  mud: true,
}

/**
 * Per-surface steering damping multiplier. Applied on top of grip-based damping.
 * Sand has extra-high damping (steering feels heavy, resists turning).
 */
export const SURFACE_STEER_DAMP_MULT: Record<Surface, number> = {
  asphalt: 1.0,
  snow: 1.0,
  ice: 1.0,
  sand: 2.5,
  mud: 1.5,
}

/**
 * Per-surface multiplier on the centrifugal push out of a curve, scaling
 * {@link CURVE_DRIFT}. See `game/vehicle.ts` — the lateral force block.
 *
 * ── WHY THIS IS A TABLE AND NOT DERIVED FROM GRIP ───────────────────────────
 * It used to be `(1 − grip × 0.7)`, which made ice 0.825 against asphalt's 0.30.
 * Grip was therefore counted twice: once weakening the steering that fights the
 * curve, once strengthening the curve itself. Ice ended up 11× worse than
 * asphalt off a 4× grip difference, and the sharpest curve was unholdable above
 * 13 km/h — see `__tests__/controllability.test.ts`.
 *
 * It was also wrong in principle. Centrifugal force does not depend on grip at
 * all; grip is what lets the tyre resist it, and that already lives in the
 * steering and damping terms. Two effects, two knobs.
 *
 * ── WHERE THE ICE NUMBER COMES FROM ────────────────────────────────────────
 * Maximum cornering force is `μ·g`, so safe curve speed scales as `√μ`. Asphalt
 * holds the sharpest curve (c=2.0) at 85 km/h, so an ice figure of X km/h claims
 * a friction ratio of `(X/85)²`:
 *
 *   40 km/h → μ_ice ≈ 0.155 · bare ice, no studs      ← what we model
 *   45 km/h → μ_ice ≈ 0.19  · studded or chained ice
 *   51 km/h → μ_ice ≈ 0.25  · good winter tyres on ice
 *
 * 0.42 lands ice at 40. A briefly-tried 0.36 gave 45 and measurably drained the
 * tension out of a playtest — it was also quietly claiming studs the truck does
 * not have. Ice being the worst entry here is therefore not double-counting
 * grip; it is the surface genuinely having the least of it.
 */
export const SURFACE_CURVE_DRIFT_MULT: Record<Surface, number> = {
  asphalt: 0.30,
  snow: 0.36,
  ice: 0.42,
  sand: 0.38,
  mud: 0.35,
}

/**
 * Per-surface fuel consumption multiplier.
 * Sand/mud burn more (engine works harder). Ice burns slightly less (low resistance).
 */
export const SURFACE_FUEL_MULT: Record<Surface, number> = {
  asphalt: 1.0,
  snow: 1.2,
  ice: 0.9,
  sand: 1.2,  // was 1.5 — two large sand segments were eating 36% of tank
  mud: 1.3,
}

/** Per-surface tire wear rate multiplier (future mechanic). */
export const SURFACE_WEAR: Record<Surface, number> = {
  asphalt: 1.0,
  snow: 1.6,
  ice: 2.5,
  sand: 1.8,
  mud: 1.4,
}

/** Probability weights for surface generation (~sums to 1.0). */
export const SURFACE_PROBABILITY: Record<Surface, number> = {
  asphalt: 0.30,
  snow: 0.22,
  ice: 0.22,
  sand: 0.10,
  mud: 0.16,
}

// ── Vehicle physics ─────────────────────────────────────────────────────────

/**
 * Truck gross weight in tonnes. Displayed on dashboard and used as the starting
 * weight. The cargo system will eventually vary it; for now the W debug key cycles
 * {@link TRUCK_WEIGHTS_T}.
 */
export const TRUCK_WEIGHT_T = 20

/**
 * Tuning baseline gross weight in tonnes. At this mass `massAccelMult` (see
 * `game/vehicle.ts`) returns 1.0, so every hand-tuned GEARS/ACCEL value keeps its
 * current feel. Heavier than this accelerates slower, lighter quicker.
 */
export const REFERENCE_MASS_T = 20

/**
 * Debug weight presets cycled by the W key: light cab / standard / heavy load.
 * 20 t is the default ({@link TRUCK_WEIGHT_T}) so the cycle starts at today's feel.
 */
export const TRUCK_WEIGHTS_T = [10, 20, 30] as const

/** Maximum forward speed in km/h (dial range 0–120). */
export const MAX_SPEED = 120
/**
 * Base throttle acceleration in km/h per second (on asphalt).
 * 20t truck: real ~2 km/h/s, we use 8 for gameplay (0→120 in ~15s).
 * Still feels heavy — you plan overtakes well in advance.
 */
export const ACCEL = 8
/** Steering lateral acceleration at grip=1 (units/s²). */
export const STEER_ACCEL = 3.2
/** Lateral velocity damping per second at grip=1 (no steering input). */
export const STEER_DAMP = 5.0
/** Max lateral velocity (clamp). */
export const MAX_LATERAL_V = 2.5

/**
 * Aerodynamic drag applied on ALL surfaces (km/h lost per second at MAX_SPEED).
 * Scales with speed². At 80 km/h asphalt: ~1.6 km/h/s. Gentle but real.
 * Ensures speed always decays without throttle, even on asphalt.
 */
/**
 * Aerodynamic drag (km/h/s at MAX_SPEED). Scales with speed².
 * Real 20t truck at 120 km/h: ~0.86 km/h/s. We use 0.5 for heavy feel.
 */
export const AERO_DRAG = 0.5
/**
 * Rolling resistance (km/h lost per km/h of speed per second).
 * Real truck Crr ≈ 0.007 → ~0.25 km/h/s at 120.
 */
export const ROLLING_RESISTANCE = 0.001
/**
 * Engine braking when throttle released (km/h/s at MAX_SPEED).
 * Minimal for a 20t truck in gear — mass dominates over engine friction.
 * The truck GLIDES. You must brake manually to stop.
 */
export const ENGINE_BRAKE = 0.3
/** Speed reduces steering (0–1). At 0.6: steering at MAX is 40% of standstill. */
export const SPEED_STEER_PENALTY = 0.6

/**
 * Per-surface slip peak: lateral velocity where grip is maximum.
 * Below peak: full grip. Above peak: grip drops with 1/x² (oversteer).
 * Low = slippery (ice 0.20). High = stable (asphalt 0.90).
 * Replaces binary SKID_THRESHOLD with a realistic tire grip curve.
 */
export const SURFACE_SLIP_PEAK: Record<Surface, number> = {
  asphalt: 0.90,
  snow: 0.35,
  ice: 0.25,
  sand: 0.50,
  mud: 0.30,
}

// ── Gearbox (manual) ─────────────────────────────────────────────────────────

/**
 * Manual 5-speed gearbox. Each gear is defined by its top speed `to` (km/h) and a
 * peak throttle torque `accel` (km/h/s at full power).
 *
 * Design intent:
 *   - Low gears: strong pull, low top speed. You MUST shift up to go fast.
 *   - High gears: high top speed, weak pull. Drivable from low speed but slow.
 *   - First gear tops out at ~28 km/h — it physically cannot reach 120.
 *
 * RPM is proportional to road speed within the gear, exactly like a real engine:
 *   rpm = speed / gear.to     (0 at standstill, 1.0 = redline at the gear's top)
 * It never goes negative; the dashboard shows it raw, so it CAN drop to 0 bars when you
 * lug. Torque over rpm — the power band starts high (BOG_RPM), so a too-tall gear pulls
 * weakly even before it lugs:
 *     rpm < BOG_RPM       low end → weak; floored at BOG_FLOOR. A too-tall gear is sluggish.
 *     BOG_RPM..POWER_RPM  power band → full torque
 *     POWER_RPM..1        approaching redline → torque tapers
 *     rpm >= 1            redline → no pull, must upshift
 *
 * Acceleration is deliberately slow: reaching top speed means shifting up through
 * every gear and takes ~30 s of clean driving.
 */
export interface GearSpec {
  /** Top speed reachable in this gear (km/h); also the redline reference for rpm. */
  to: number
  /** Peak throttle acceleration in this gear (km/h/s) at full torque. */
  accel: number
  /**
   * Synchro limit — the maximum road speed (km/h) at which you may DOWNSHIFT into
   * this gear. `null` = no synchro (engage at any speed). A number engages the
   * limiter: dropping into the gear above this speed is refused (grind). Set every
   * gear to `null` to remove synchro entirely, or all to numbers for a fully
   * synchro'd box — the logic is purely config-driven.
   */
  maxSpeedToShift: number | null
}

export const GEARS: readonly GearSpec[] = [
  { to: 28, accel: 5.5, maxSpeedToShift: 35 },   // 1 — pull away; synchro: engage only below 35
  { to: 52, accel: 4.2, maxSpeedToShift: 60 },   // 2 — synchro: engage only below 60
  { to: 76, accel: 3.2, maxSpeedToShift: 85 },   // 3 — main cruising gear; synchro: below 85
  { to: 100, accel: 2.4, maxSpeedToShift: null }, // 4 — non-synchro, engage at any speed
  { to: 130, accel: 1.8, maxSpeedToShift: null }, // 5 — top gear; MAX_SPEED caps real speed at 120
]

/** Number of forward gears. */
export const GEAR_COUNT = GEARS.length

/**
 * Real engine revs shown on the tachometer at redline (`rpm` fraction 1.0). Display only.
 * With 2600 the lug line (LUG_RPM 0.25) reads ~650 rpm — matching "below ~800 you lug".
 */
export const RPM_DISPLAY_REDLINE = 2600
/**
 * Below this rpm the engine is off the power band → weak torque (floored at BOG_FLOOR).
 * Raised so a too-tall gear (5th at 30 km/h ≈ 0.23) pulls sluggishly, not at full power.
 */
export const BOG_RPM = 0.50
/** Torque multiplier floor at idle / when lugging — diesel low-end grunt. */
export const BOG_FLOOR = 0.12
/** Top of the flat power band; above this, torque tapers toward redline. */
export const POWER_RPM = 0.82
/** Torque multiplier just before redline (rpm → 1). */
export const REDLINE_FLOOR = 0.10
/**
 * Engine-braking pull (km/h/s) applied when speed sits above the current gear's
 * top (e.g. you downshifted at speed). Compression drags you back to the gear top.
 */
export const OVERREV_ENGINE_BRAKE = 7

/**
 * Lug threshold on rpm (`speed / gear.to`). Below this in a gear the engine lugs toward a
 * stall — you slowed/braked or sat in too tall a gear without downshifting. First gear is
 * exempt (you can always idle and pull away in 1st). With `LUG_RPM = 0.25` (≈ 650 rpm):
 * 2nd lugs below ~13 km/h, 3rd below ~19, 4th below ~25, 5th below ~32 — so cruising 30 in
 * 5th lugs and pressures you to downshift. A stalled engine must be restarted with ENTER.
 */
export const LUG_RPM = 0.25

/**
 * Grace period (ms) the engine lugs and **coughs** with an "ENGINE STALLING"
 * warning before it actually dies — time for the driver to downshift. Long
 * enough to react mid-corner on snow while braking (≈ 3.5 s).
 */
export const STALL_GRACE_MS = 3500

/** rpm at/above which the engine is on the redline (sitting at the gear's ceiling). */
export const REDLINE_RPM = 0.95
/**
 * Milliseconds held at the redline UNDER THROTTLE before the engine burns out
 * (stalls). At redline you're already at the gear's top and not accelerating, so
 * this is the backstop for refusing to upshift, not a twitch timer. Only applies
 * in gears you can upshift out of — the top gear's redline is just the limiter.
 */
export const REDLINE_BURN_MS = 6000
/**
 * Delay (ms) at the redline before the audible "SHIFT UP" buzzer starts, so normal
 * quick upshifts through the gears don't blare an alarm every time.
 */
export const REDLINE_WARN_DELAY_MS = 900

/** Milliseconds ENTER must be held to crank the engine to a start. */
export const CRANK_NEEDED_MS = 1800

// ── Clutch (SHIFT) ──────────────────────────────────────────────────────────
//
// The clutch is the one thing that lets the engine and the wheels turn at
// DIFFERENT speeds. Before it existed, `rpm` was a pure function of road speed
// (`speed / gear.to`) — engine welded to the drivetrain. Now the engine carries
// its own revs (`Vehicle.engineRpm`) whenever SHIFT is held.
//
// THE SKILL IS REV-MATCHING, NOT TIMING. There is deliberately no "correct"
// number of milliseconds to hold the pedal. The clean release point is wherever
// the engine's revs equal what the wheels will demand in the gear you selected:
//
//     targetRpm = speed / GEARS[gear].to
//
// That target MOVES while you are declutched, because a truck in neutral is
// still slowing down — fast on mud (SURFACE_DRAG), barely at all on asphalt,
// and differently again under braking or with 30 t behind you. So the window is
// situational by construction; none of it is special-cased.
//
// Direction matters and falls out of the gear table for free. Downshifting
// raises the demanded revs (3rd→2nd at 50 km/h: 0.59 → 0.96), so you must BLIP
// THE THROTTLE while declutched or the wheels will drag the engine up and the
// truck lurches — that is a real double-clutch. Upshifting lowers them, so you
// simply wait for the revs to fall.

/** Idle revs (rpm fraction) the engine settles to when declutched off throttle. */
export const CLUTCH_IDLE_RPM = 0.20
/**
 * Governed no-load rpm under full throttle with the clutch disengaged.
 * A truck diesel cannot free-rev through its limiter; 0.90 leaves deliberate
 * headroom below {@link REDLINE_RPM} while still covering normal downshift
 * targets inside {@link CLUTCH_MATCH_TOLERANCE}.
 */
export const CLUTCH_GOVERNOR_RPM = 0.90
/**
 * First-order engine response toward idle/governed rpm, in 1/s.
 * Applied through `1 - exp(-response * dt)`, so a long frame cannot overshoot
 * and the same elapsed time gives the same response at every frame rate.
 */
export const CLUTCH_REV_RESPONSE = 3.0
/**
 * Mismatch (|engineRpm − targetRpm|) inside which a release counts as CLEAN: no
 * jolt at all. Wide enough that a deliberate rev-match is reliably rewarded,
 * narrow enough that mashing SHIFT without looking is not.
 */
export const CLUTCH_MATCH_TOLERANCE = 0.10
/**
 * Speed shock (km/h) per unit of rpm mismatch when the clutch bites badly.
 * Engine slower than the wheels demand → the drivetrain drags the truck down;
 * faster → a brief shove. Scaled by mass at the call site: a 30 t load shrugs
 * off the same mismatch that snaps a 10 t cab.
 *
 * Small on purpose, and it was not at first. The mass ratio here is about
 * 1000:1 — spinning an engine's flywheel up cannot meaningfully slow twenty
 * tonnes, so **the engine follows the truck, not the other way round.** At the
 * original 26 a driver who merely dipped the pedal and let it out again in the
 * SAME gear lost 6.7 km/h, which made SHIFT feel like a brake pedal (owner,
 * 2026-08-01). At 6 that same dip costs ~1.5 km/h: a jerk you feel and do not
 * plan around.
 *
 * The mechanic keeps its teeth elsewhere, which is where they belong: you are
 * coasting the whole time the pedal is down (no drive, no engine braking), and
 * a release into a gear that cannot sustain the speed still kills the engine.
 */
export const CLUTCH_SHOCK = 6
/**
 * How much of an OVER-revved bite reaches the road (the rest is wheelspin and a
 * slipping plate). The two directions are deliberately asymmetric.
 *
 * Engine slower than the wheels demand is a rigid coupling: 20 tonnes of truck
 * wins, the engine is dragged up, and the truck really does lose that speed.
 * Engine faster is not symmetric — a dumped clutch spins the wheels and cooks
 * the friction plate; almost none of those revs become road speed.
 *
 * Found by driving it (2026-08-01): at 1.0 the first real test lurched from
 * 3 km/h to 30 km/h on one dumped clutch, which made revving in neutral and
 * side-stepping the pedal *faster* than driving properly. A launch should feel
 * like a lurch, not like a gear you skipped.
 */
export const CLUTCH_LAUNCH_FRACTION = 0.15
/**
 * Engine revs below which letting the clutch out kills the motor on the spot,
 * with none of the STALL_GRACE_MS cough the gradual lug gets.
 *
 * A floor, not a mismatch — that was the first attempt and it was the wrong
 * question. Whether the engine survives depends on WHERE IT LANDS, not on how
 * far it fell: dip the pedal at 10 km/h with 5th selected and the wheels can
 * only turn it at 0.08, so twenty tonnes drag the motor under idle and it dies,
 * even though the engine was merely idling and the "mismatch" was tiny.
 *
 * Set at 60 % of LUG_RPM so the mercy sits in the right place: land a little
 * under the lug line (18 km/h in 3rd → 0.24) and you still get the normal
 * warning and 3.5 s to fix it; land nowhere near it and you have simply killed
 * the engine, which is exactly what happens in the cab. Never fires in 1st.
 */
export const CLUTCH_STALL_RPM = LUG_RPM * 0.6

// ── Fuel ────────────────────────────────────────────────────────────────────

// export const FUEL_BURN_RATE = 0.00012  // original — tight but completable with canisters
export const FUEL_BURN_RATE = 0.000110
export const FUEL_IDLE_THRESHOLD = 5

// ── Road generation ─────────────────────────────────────────────────────────

/** First segment is always asphalt, this many metres. */
export const START_ASPHALT_M = 1000

/** Per-surface segment length range [min, max] in metres. */
export const SURFACE_LENGTH_RANGE: Record<Surface, readonly [number, number]> = {
  asphalt: [200, 800],
  snow: [100, 800],
  ice: [100, 300],
  sand: [100, 800],
  mud: [100, 800],
}

/**
 * After a non-asphalt surface, probability of a recovery asphalt segment.
 * Gives the driver a breather. 0.85 = 85% chance.
 */
/**
 * Length of the grip blend across a surface boundary, in metres, centred on the
 * boundary itself (half before, half after).
 *
 * A real road does not change grip on a painted line — ice starts patchy and the
 * asphalt on its far side stays glazed for a while. Mechanically this matters
 * because the jump used to be one tick wide: grip 1.0, then 0.25, with no moment
 * in between where the truck felt light and the player could still act.
 *
 * Only the grip *number* is blended. {@link SURFACE_LENGTH_RANGE} segment
 * identity stays hard-edged, because it also drives the visuals, drag, fuel burn
 * and skid audio — smearing those would desync what you see from what you feel.
 */
export const SURFACE_TRANSITION_M = 20

/**
 * Curvature at or above which a warning carries a direction arrow. The midpoint
 * of {@link CURVE_INTENSITY_RANGE}: gentler bends are not worth the ink, since
 * ice holds a 0.4 bend at 120 km/h and a 1.0 bend at ~70.
 */
export const CURVE_WARN_CURVATURE = 1.0

/**
 * How far ahead a sharp bend is announced while the truck is already on a
 * slippery surface — see `road.ts` `sharpCurveAhead`.
 *
 * Derived from the worst realistic case rather than picked: shedding 80 → 40 km/h
 * on ice, where `decel` is 8 km/h/s against `speedFade` 0.55, takes about 7.9 s
 * and eats ~132 m. 180 leaves room to notice and react on top of that.
 *
 * Shorter than {@link ICE_AHEAD_LOOK_M} (220) on purpose. A surface change needs
 * the longer horizon because you must brake *before* reaching it; a bend is
 * already visible in the road itself, so this only has to beat the reaction gap.
 */
export const CURVE_AHEAD_LOOK_M = 180

/**
 * Projected height, in pixels, at or below which traffic is drawn as the far
 * symbol rather than the detailed sprite. See `render/vehicleLod.ts`.
 *
 * 9 px covers roughly 220 m down to 25 m — most of the approach, and exactly the
 * stretch where a shrunken detailed sprite stops meaning anything: at 8 x 6 the
 * lights that carry direction lose their vote to bodywork and blink in and out.
 */
/**
 * Traffic sprite scale as a function of world depth: `A / (z + B)`, with `A` and
 * `B` solved from the two anchors below. Hyperbolic, because that is what
 * perspective is — apparent size falls as 1/distance — with `B` as the offset
 * that keeps the near end finite instead of infinite.
 *
 * ── Why this replaced the old curve ─────────────────────────────────────────
 * It used to be `0.28 + sqrt(tScale) * 1.15`, whose floor of 0.28 and square root
 * flattened the far field almost to nothing. Measured widths for a car:
 *
 *     distance   220  100   50   25   10    5    2
 *     old          8    9   11   13   17   21   29
 *     new          4    8   13   18   25   28   30
 *
 * Over the 170 m from 220 to 50 the old curve grew a car by 3 px — 1.4x across
 * three quarters of the approach — and then trebled it in the last 48 m. That is
 * the reported "I see it the same for ages and then it is suddenly on me": the
 * growth cue arrives far too late to read as closing speed. The new curve spreads
 * that same stretch over 3.2x.
 *
 * The near anchor is deliberately unchanged. A vehicle beside the player is the
 * one place the old sizing was right, and the owner asked to keep it.
 */
export const TRAFFIC_SCALE_NEAR = 1.43
/** Depth, in metres, at which {@link TRAFFIC_SCALE_NEAR} applies. */
export const TRAFFIC_SCALE_NEAR_Z_M = 1.2
/**
 * Scale at {@link TRAFFIC_SCALE_FAR_Z_M}. 0.20 puts a car at 4 px wide — small
 * enough to read as far away, large enough that the far tier's two lamps still
 * land in separate columns. Lower it and distant traffic becomes a single dot.
 */
export const TRAFFIC_SCALE_FAR = 0.20
/** Depth the far anchor is measured at — the end of `TRAFFIC_VIEW_DISTANCE_M`. */
export const TRAFFIC_SCALE_FAR_Z_M = 220

/** Solved from the anchors: `scale(z) = A / (z + B)` passes through both. */
export const TRAFFIC_SCALE_B =
  (TRAFFIC_SCALE_FAR * TRAFFIC_SCALE_FAR_Z_M - TRAFFIC_SCALE_NEAR * TRAFFIC_SCALE_NEAR_Z_M) /
  (TRAFFIC_SCALE_NEAR - TRAFFIC_SCALE_FAR)
export const TRAFFIC_SCALE_A = TRAFFIC_SCALE_NEAR * (TRAFFIC_SCALE_NEAR_Z_M + TRAFFIC_SCALE_B)

/**
 * Tallest projected height still drawn by the far tier, in pixels.
 *
 * Raised from 9 to 10 when the sprite started being sampled at a fractional
 * size: the height is now the box that *contains* the sprite (`ceil`) rather
 * than the sprite rounded to whole pixels, so the same physical vehicle reports
 * about one pixel more. The extra pixel keeps the boundary where it was — a car
 * hands over at roughly 50 m, as before — rather than moving it.
 */
export const LOD_FAR_MAX_HEIGHT = 10

/**
 * Dead-band around {@link LOD_FAR_MAX_HEIGHT}, in pixels. Same-direction traffic
 * closes and falls back as it brakes, so the projected height wobbles by a pixel;
 * without this the vehicle would flicker between two different drawings.
 */
export const LOD_HYSTERESIS_PX = 1

/**
 * Shortest projected vehicle, in pixels, that still gets a dark outline.
 *
 * The outline exists because a bright road — ice, snow, sand — leaves a pale
 * vehicle with nothing marking where it ends. Below this height it starts
 * costing more than it buys: a halo around a 3 × 2 blob is more pixels than the
 * blob, so the vehicle would read as *larger* the further away it is, undoing
 * the growth curve the whole approach depends on.
 */
export const CONTOUR_MIN_HEIGHT = 5

/**
 * Shortest projected vehicle that also gets a contact shadow.
 *
 * Higher than the outline's threshold on purpose: an outline needs a silhouette
 * and a shadow needs a *ground line*, and at four or five pixels there is no
 * room to tell "under the vehicle" from "part of the vehicle".
 */
export const SHADOW_MIN_HEIGHT = 7

/**
 * Only surfaces at or below this grip get the bend warning. Snow 0.55, ice 0.25,
 * sand 0.35 and mud 0.45 qualify; asphalt at 1.0 does not — on a road that grips,
 * reading the bend yourself is the game.
 */
export const CURVE_WARN_GRIP_MAX = 0.6

export const RECOVERY_ASPHALT_PCT = 0.85
/** Recovery asphalt segment length range [min, max] in metres. */
export const RECOVERY_ASPHALT_RANGE: readonly [number, number] = [150, 400]

// ── Curvature pattern ───────────────────────────────────────────────────────

/** Centrifugal drift force from road curvature. */
export const CURVE_DRIFT = 0.035
/** Curvature intensity range for turns (0 = straight, higher = sharper). */
export const CURVE_INTENSITY_RANGE: readonly [number, number] = [0.4, 2.0]
/** Length of straight sections between turns [min, max] metres. */
export const STRAIGHT_LENGTH_RANGE: readonly [number, number] = [80, 250]
/** Length of the full-curvature portion of a turn [min, max] metres. */
export const TURN_LENGTH_RANGE: readonly [number, number] = [120, 450]
/** Length of the smooth ramp into/out of a turn (metres). */
export const TURN_RAMP_M = 60

// ── Off-road penalties ──────────────────────────────────────────────────────

export const OFF_ROAD_DRAG = 55
export const OFF_ROAD_RETURN = 1.8

/** Severity (0–1) at which off-road becomes an instant crash. */
export const OFFROAD_CRASH_SEVERITY = 0.4
/** Seconds of ANY off-road before game over. */
export const OFFROAD_TIMEOUT_S = 3.0
/** Pixel margin to road edge that triggers "approaching edge" warning. */
export const EDGE_MARGIN_WARN_PX = 8
/** Crash animation duration in ms before game-over screen. */
export const CRASH_ANIM_MS = 1200

// ── Road rendering ──────────────────────────────────────────────────────────

/**
 * Traffic look-ahead distance in metres.
 * Kept separate from road scanline projection so vehicles can be introduced
 * earlier than the short visible road texture depth.
 */
export const TRAFFIC_VIEW_DISTANCE_M = 220
export const KERB_STRIPE_M = 2.0
/**
 * Driveable kerb/shoulder width in projected game pixels.
 *
 * Shared by `render/road3d.ts` and `game/roadgeometry.ts`, so the painted
 * shoulder and the off-road boundary stay pixel-identical — if these ever drift
 * apart the player leaves the road somewhere other than where it looks like they
 * do, which is the worst kind of unfair.
 *
 * The foreground kerb is deliberately broad. Its inner part is calm recovery
 * space for an ordinary wobble; its outer 8 px overlap EDGE_MARGIN_WARN_PX, so
 * the edge warning fires while there is still shoulder left rather than at the
 * moment terrain begins. Widening it does not change the controllability
 * envelope — a slide on ice runs to the lateral clamp rather than stopping just
 * over the line — it buys room for small mistakes, which is a different thing.
 */
export const KERB_WIDTH_TOP = 1
export const KERB_WIDTH_BOTTOM = 16
/**
 * Road segment marker spacing in metres. Thin horizontal lines across
 * the road that rush toward the player — primary speed perception cue.
 * At 120 km/h: ~1.3 markers/s. At 30 km/h: ~0.33 markers/s.
 */
export const ROAD_MARKER_SPACING_M = 25
/**
 * How far ahead markers are drawn, in metres.
 *
 * Deliberately equal to the spacing, so exactly ONE marker is on screen at a
 * time: it appears near the horizon, walks down, and the next one only shows up
 * after it has passed under the cab. Raising this to 37.5 puts two markers on
 * screen (the far one parked a few pixels under the horizon), which reads as
 * clutter rather than speed.
 */
export const ROAD_MARKER_VIEW_M = 25
/** Depth of the painted band in metres — gives near markers perspective thickness. */
export const ROAD_MARKER_DEPTH_M = 0.4
/** Thickness cap in pixels, so a marker at the player's feet stays a line, not a slab. */
export const ROAD_MARKER_MAX_PX = 3
/** Centre line: painted dash length in metres. */
export const CENTRE_DASH_M = 2
/** Centre line: gap between dashes in metres. */
export const CENTRE_GAP_M = 4

// ── Audio ───────────────────────────────────────────────────────────────────

export const ENGINE_GAIN = 0.06
export const SCREECH_COOLDOWN_S = 0.35
export const OFFROAD_BEEP_COOLDOWN_S = 0.25

/**
 * Per-surface engine sound: [oscillator type, idle Hz, top Hz].
 * Asphalt: clean square. Snow: muffled triangle. Ice: sharp sawtooth.
 * Sand: deep square. Mud: modulated triangle.
 */
export const SURFACE_ENGINE_SOUND: Record<Surface, readonly [OscillatorType, number, number]> = {
  asphalt: ['square', 40, 235],
  snow: ['triangle', 35, 180],
  ice: ['sawtooth', 50, 280],
  sand: ['square', 25, 140],
  mud: ['triangle', 30, 160],
}

// ── Fuel canisters ──────────────────────────────────────────────────────────

/** Average spacing between fuel canisters on the road (metres). */
export const CANISTER_SPACING_M = 700
/** Random variation on canister spacing: actual = spacing × (1 ± this). */
export const CANISTER_SPACING_JITTER = 0.4
/** Lateral position range for canisters: 0 = centre, 1.0 = road edge. */
export const CANISTER_X_RANGE = 0.9
/** Fuel added per canister pickup (fraction of full tank). 1 segment = 1/5. */
export const CANISTER_FUEL = 1 / 5
/** Pickup distance threshold in player.x units (how close you must be). */
export const CANISTER_PICKUP_RADIUS = 0.25
/** World-distance tolerance for pickup (metres ahead/behind truck). */
export const CANISTER_PICKUP_DEPTH_M = 15

/** Low-fuel warning threshold (fraction 0–1). Below this: blink + beep. */
export const LOW_FUEL_WARN = 0.20
/** Critical fuel threshold. Below this: faster blink + urgent beep. */
export const LOW_FUEL_CRITICAL = 0.10
/** Low-fuel warning beep cooldown (seconds). */
export const LOW_FUEL_BEEP_COOLDOWN_S = 0.8
/** Critical fuel beep cooldown (faster). */
export const LOW_FUEL_CRIT_BEEP_COOLDOWN_S = 0.4

// ── Route planning — the clock that knows the road ──────────────────────────
//
// The route is a deterministic function of the seed, so the game knows what is
// coming before the player does: which surfaces, how long, how tight the bends.
// The delivery clock is built from *that* rather than from a flat pace, which
// means a leg over ice is granted the time ice costs, and a leg over asphalt is
// not granted time it does not need.
//
// ── What this changes about the game, stated once ───────────────────────────
// A flat pace punishes **slowness**. A route-aware budget punishes **caution**.
// An ice route becomes calmer (the plan knows you must crawl) and an asphalt
// route becomes tense (the plan expects you to use the grip you have). That is
// Fox's decision, made with the consequence in front of him, and it is the whole
// point of the feature — not a side effect to tune away later.
//
// ── The rule that keeps the safety net honest ───────────────────────────────
// `completability.test.ts` drives a deliberately crude human heuristic and its
// own comment explains why: a bot steering by the physics it is meant to audit
// proves nothing. The same trap sits here, one level up. **The planner and the
// bot must not share a single constant.** The planner is physics-anchored; the
// bot stays a human guess; the slack below is calibrated by running one against
// the other.

/**
 * Reference speed for the safe-speed law, km/h.
 *
 * Not invented — read off the measured envelope in `controllability.test.ts`.
 * That table has twenty cells (five surfaces x four curvatures) and one formula
 * reproduces all of them to within about 5 %:
 *
 *     v_safe = min(MAX_SPEED, PLAN_V_REF / sqrt(max(c, PLAN_C_MIN)) * sqrt(grip))
 *
 *     surface   c=2 measured   formula     grip
 *     asphalt        85          84.9      1.00
 *     snow           55          56.9      0.45
 *     ice            40          42.4      0.25
 *     sand           50          50.2      0.35
 *     mud            60          56.9      0.45
 *
 * The `sqrt(grip)` half is not a fit, it is the friction circle — `AGENTS.md`
 * already argues that safe curve speed scales as `sqrt(mu)` when it explains why
 * ice holds 40 and not 45.
 */
export const PLAN_V_REF = 120
/**
 * Curvature floor for the law above. Below this the formula would divide by
 * almost nothing and hand a straight road an infinite speed; `MAX_SPEED` caps it
 * anyway, and this keeps the arithmetic finite rather than relying on the cap.
 */
export const PLAN_C_MIN = 0.35

/**
 * Highest speed the truck can actually hold on each surface, km/h.
 *
 * The cornering law above answers "how fast may I go round this bend" and says
 * nothing about drag — on sand and mud the truck cannot reach 120 on a straight,
 * so a sandy leg would be handed a budget nobody could drive. These are measured
 * by `routeplan.test.ts`, which runs the real `tickVehicle` flat out on a
 * straight and fails if any number here is optimistic by more than 2 km/h — the
 * sweep stops when ten seconds of throttle buys under 0.05 km/h, so it lands
 * just under the true asymptote. Deliberately measured
 * rather than copied from the completability bot's strategy table — see the
 * no-shared-constants rule above.
 *
 * The numbers were a surprise and are the reason the measurement exists:
 *
 *     asphalt  120.0    ice  120.0    snow  45.7    sand  44.4    mud  41.0
 *
 * **Snow, sand and mud top out in the forties.** The lateral envelope says snow
 * holds the road at 120 through a gentle bend, and that is true and irrelevant —
 * the truck cannot get there, because `SURFACE_DRAG` takes the engine's output
 * long before the bend does. A plan built on the cornering law alone would have
 * budgeted a snow leg at twice the speed the truck can reach.
 */
export const PLAN_SURFACE_VMAX: Record<Surface, number> = {
  asphalt: 120,
  snow: 47,
  ice: 120,
  sand: 46,
  mud: 43,
}

/**
 * Acceleration the plan assumes, m/s².
 *
 * Deliberately far below what the engine can do on paper. The plan does not
 * model the gearbox — a shift takes time, a missed one takes more, and the
 * torque curve means the truck pulls hardest in the middle of a gear — so this
 * is the *effective* figure a competent driver achieves through the gears.
 * Modelling the box properly here would mean a second copy of `vehicle.ts`, and
 * the copy would drift.
 */
export const PLAN_ACCEL_MS2 = 1.1
/**
 * Distance between plan samples, metres. Fine enough that a 100 m ice segment is
 * ten samples and coarse enough that an 8 km leg is 800 — computed once per leg,
 * never per frame.
 */
export const PLAN_STEP_M = 10

/**
 * How much more time than the ideal line the clock grants.
 *
 * The ideal is a driver who knows every metre of the route in advance, never
 * misses a shift and never lifts out of doubt. Nobody is that driver, and a
 * first-time visitor to a seed is a long way from it. This is the whole margin
 * for imperfect shifting, hesitation, a cautious line and reading the road
 * through the windscreen instead of from the seed.
 *
 * Calibrated, not guessed: `completability.test.ts` runs three strategies across
 * the seed catalogue, and the target Fox set is **moderate passes with a small
 * margin, conservative fails on the harder routes**.
 */
export const PLAN_SLACK = 1.6
/**
 * Extra seconds on the first leg only, on top of the slack.
 *
 * The plan reads the route from the seed; a player on their first run of it
 * cannot. That gap is widest at the very start, before anyone has learned where
 * the ice is — and the first leg is also the one that begins from a standstill
 * with a cold engine.
 */
export const PLAN_FIRST_LEG_BONUS_S = 45
/** Seconds granted for the standing start, the crank and the first two shifts. */
export const PLAN_START_ALLOWANCE_S = 15
/**
 * Seconds per kilometre for traffic, which the plan cannot see.
 *
 * Traffic is seeded, but it reacts to the player, so it is not a function of
 * distance the way the road is. A flat allowance is the honest shape. It will
 * need raising when traffic density starts scaling with distance travelled.
 */
export const PLAN_TRAFFIC_ALLOWANCE_S_PER_KM = 6

/** Seconds added to the clock by one canister, on top of its fuel. */
export const CANISTER_TIME_BONUS_S = 10
/**
 * The share of a leg's canisters the budget assumes will be collected.
 *
 * Not 1.0, and that is the design: some canisters sit at the road edge, in a
 * bend or on ice, and a sensible driver leaves those. Budgeting for all of them
 * would make the clock unaffordable for anyone who drives sanely; budgeting for
 * none of them would hand back **+14.3 s per kilometre** at today's spacing —
 * more than the surplus this whole feature exists to remove.
 *
 * So the clock is priced for a driver who takes the easy ones. Taking a hard one
 * buys time; leaving them all costs it.
 */
export const PLAN_EXPECTED_CANISTER_PCT = 0.6

/**
 * Hard bounds on the average speed a leg may ever demand, km/h.
 *
 * The guard rail that makes a planner bug survivable. 0.8.1 shipped a mission
 * asking for 188 km/h against a 120 km/h truck, and it shipped because nothing
 * stood between an arithmetic slip and the player. `PLAN_PACE_MAX` is that
 * something. The lower bound stops an over-generous plan from making a leg free.
 */
export const PLAN_PACE_MIN_KMH = 22
export const PLAN_PACE_MAX_KMH = 80

// ── Mission / delivery ──────────────────────────────────────────────────────

/** Distance of the first delivery target from start (metres). */
export const FIRST_TARGET_DIST_M = 5000
/**
 * Range for subsequent leg lengths [min, max] metres beyond the delivery point.
 *
 * Was [15000, 25000] against a flat 8-minute budget, which asked for an average
 * of 113 to 188 km/h — `MAX_SPEED` is 120, so nine of those ten kilometres were
 * unreachable at any skill level and the tenth needed the truck flat out from
 * the first frame. Now the budget scales with the leg (`MISSION_PACE_KMH`), so
 * the range only has to be a length worth driving rather than a length that
 * happens to fit a fixed clock.
 */
export const NEXT_TARGET_RANGE: readonly [number, number] = [5000, 8000]
/** Fuel refill fraction awarded on successful delivery (0–1). */
export const DELIVERY_FUEL_REFILL = 0.50
/** Score points awarded per delivery, on top of what the driving earned. */
export const DELIVERY_SCORE = 500
/**
 * The average speed a leg's time budget assumes, in km/h.
 *
 * 37.5 km/h is not a new number: it is exactly what the tuned first leg already
 * asks for (5 km in 8 minutes), so deriving every budget from it leaves the
 * first leg untouched and gives every later leg the same promise. For scale,
 * the ideal driver in `completability.test.ts` averages ~46 km/h across the seed
 * catalogue and the owner's human run of the reference seed averaged ~38.5.
 */
export const MISSION_PACE_KMH = 37.5
/**
 * Time limit for the first delivery in milliseconds.
 *
 * Derived rather than written down, so "the first leg's budget does not change"
 * is an equation a test can check instead of a promise in a comment. Works out
 * at exactly 8 minutes, which is what it was before the pace existed — raised
 * from 7 when the manual gearbox made acceleration much slower.
 */
export const DELIVERY_TIME_LIMIT_MS =
  Math.round(FIRST_TARGET_DIST_M / 1000 / MISSION_PACE_KMH * 3_600_000)
/**
 * How much of a leg's unused time carries into the next one (0–1).
 *
 * 1.0 — drive well and you bank every second of it, which is what the owner
 * chose and what the delivery jingle implies. Watch it across a long run: time
 * saved compounds, so by the fifth delivery the clock may have stopped being a
 * pressure at all. If it does, this is the dial — no code changes with it.
 */
export const DELIVERY_TIME_CARRY_PCT = 1.0

// ── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Points for every 100 m covered, before the surface multiplier.
 *
 * Delivery used to be the only thing that ever moved the score, so 5 km of
 * driving and every hazard survived along the way read as a flat 500 whatever
 * happened. Distance is what the player actually spends, so distance is what
 * pays.
 */
export const SCORE_PER_100M = 10
/**
 * What each surface multiplies those points by — the risk premium.
 *
 * Sized so the bonus is a real signal without dominating: on the measured mean
 * surface mix of a route the weighted multiplier is about 1.085, so a 5 km leg
 * scores ~543. The extremes are 500 (all asphalt) against 700 (all ice), which
 * is the shape wanted — ice is worth driving, not worth farming.
 */
export const SURFACE_SCORE_MULT: Record<Surface, number> = {
  asphalt: 1.0,
  snow: 1.2,
  ice: 1.4,
  sand: 1.3,
  mud: 1.1,
}

// ── Traffic ─────────────────────────────────────────────────────────────────

/** Average spacing between traffic vehicles (metres). */
export const TRAFFIC_SPACING_M = 220
/** Random jitter on spacing (±fraction). */
export const TRAFFIC_SPACING_JITTER = 0.4
/** Probability that a vehicle goes in the same direction (rest = oncoming). */
export const TRAFFIC_SAME_DIR_PCT = 0.55
/** Speed range for same-direction vehicles [min, max] km/h. */
export const TRAFFIC_SAME_SPEED: readonly [number, number] = [30, 55]
/** Speed range for oncoming vehicles [min, max] km/h. */
export const TRAFFIC_ONCOMING_SPEED: readonly [number, number] = [60, 90]
/** Desired same-direction following time behind a slow player. */
export const TRAFFIC_FOLLOW_TIME_S = 2.2
/** Minimum same-direction gap when following the player, in metres. */
export const TRAFFIC_MIN_FOLLOW_GAP_M = 10
/** Maximum same-direction AI braking when closing on the player, in km/h/s. */
export const TRAFFIC_FOLLOW_BRAKE_KMH_S = 45
/**
 * Pre-filter range for visual traffic collision (metres ahead of player).
 * Vehicles outside this range cannot overlap the player truck on screen.
 */
export const TRAFFIC_COLLISION_DEPTH_M = 6
/** First traffic vehicle appears after this many metres (safe start). */
export const TRAFFIC_START_M = 800

// ── Traffic driver behaviour ────────────────────────────────────────────────
//
// What a driver in traffic *does*, as opposed to what the tyres *allow*. The
// cornering law in `game/safespeed.ts` answers the second question and this block
// answers the first, and the gap between them is the whole reason this block
// exists: traffic cruises at 30-55 km/h, which is nowhere near the friction limit
// of any bend on asphalt (the sharpest asks 84.9 km/h), so a model built on grip
// alone would never light a single brake light.

/**
 * Share of the physics cornering limit a driver in traffic actually uses.
 *
 * Real traffic corners at roughly a quarter of a g against a limit near 0.8 g.
 * 0.55 is picked so the numbers land either side of `TRAFFIC_SAME_SPEED`, which
 * is what makes two cars meeting one bend look like two decisions:
 *
 *     surface   c=0.4   c=1.0   c=1.5   c=2.0     (km/h, this factor applied)
 *     asphalt   104.4    66.0    53.9    46.7
 *     snow       70.0    44.3    36.1    31.3
 *     ice        52.2    33.0    26.9    23.3
 *     sand       61.7    39.0    31.9    27.6
 *     mud        70.0    44.3    36.1    31.3
 *
 * So the sharpest asphalt bend is braked for by the fast half of the fleet and
 * ignored by the slow half, and everything on ice slows for everything.
 */
export const TRAFFIC_CORNER_COMFORT_PCT = 0.55

/**
 * Fastest a traffic driver will go on each surface whatever the road is doing,
 * km/h. `null` means the surface never caps anything by itself.
 *
 * The cornering law is silent about a straight — `PLAN_C_MIN` floors the
 * curvature, so bare ice comes out at 55.8 km/h, which is a car doing 55 on ice
 * and a lie the player can see. This table is the second half of the answer.
 *
 * Deliberately **not** `PLAN_SURFACE_VMAX`: that is what the truck's engine can
 * hold against `SURFACE_DRAG`, and it puts ice at 120 because ice is not draggy —
 * true of the drivetrain, exactly backwards as a statement about a driver.
 *
 * These are a design decision, not physics, and they are the first dial to turn
 * if traffic on ice ends up blocking the player more than it warns them.
 */
export const TRAFFIC_SURFACE_MAX_KPH: Record<Surface, number | null> = {
  asphalt: null,
  snow: 45,
  ice: 30,
  sand: 40,
  mud: 38,
}

/**
 * Per-vehicle caution, drawn once at spawn: above 1 reads further ahead and
 * accepts a lower speed, below 1 is the driver who brakes late.
 *
 * Drawn from the seed rather than from `Math.random`, because a route *is* a
 * seed and that has to include what the traffic on it does — otherwise the same
 * playtest cannot be run twice and no test can pin any of this.
 */
export const TRAFFIC_CAUTION_RANGE: readonly [number, number] = [0.85, 1.25]
/**
 * Per-vehicle braking vigour, drawn once at spawn — how hard this driver leans
 * on the pedal once they have decided to. Separate from caution so that "brakes
 * early and gently" and "brakes late and hard" are both drivers that exist.
 */
export const TRAFFIC_VIGOUR_RANGE: readonly [number, number] = [0.85, 1.20]

/**
 * Seconds of travel a driver reads ahead. At 45 km/h that is 75 m.
 *
 * A time rather than a distance, because the honest braking distance at these
 * speeds is tiny — shedding 45 to 30 km/h takes about 6 m — and a light that came
 * on 6 m before the ice would be a blink, not a warning. Drivers lift early; this
 * is that, and it is what makes the lamps readable from behind.
 */
export const TRAFFIC_LOOKAHEAD_S = 6
export const TRAFFIC_LOOKAHEAD_MIN_M = 25
export const TRAFFIC_LOOKAHEAD_MAX_M = 140
/** Sample spacing of the look-ahead, metres. Same as `PLAN_STEP_M`, same reason. */
export const TRAFFIC_LOOKAHEAD_STEP_M = 10
/**
 * How often a vehicle re-reads the road, ms.
 *
 * Not every frame: the road does not change under it, so the answer would be the
 * same at sixty times the cost — and a target that only moves ten times a second
 * is also what keeps the brake lamp from strobing.
 */
export const TRAFFIC_PLAN_INTERVAL_MS = 100

/**
 * Seconds over which a driver sheds the excess speed. This is what sets the
 * deceleration: the gap to the target divided by this, then clamped and scaled
 * by the driver's vigour. A driver braking for a bend 100 m off does not stand on
 * the pedal, and one that has left it late does.
 */
export const TRAFFIC_BRAKE_RESPONSE_S = 1.8
/** Gentlest deceleration still worth calling braking, km/h/s. */
export const TRAFFIC_BRAKE_MIN_KMH_S = 8
/**
 * Hardest a traffic driver ever brakes, for any reason, km/h/s.
 *
 * Defined as the rear-end guard's rate rather than as a new number: that rate was
 * already chosen for exactly this question, and two constants for one limit is
 * how two limits start. Step 5 folds the guard into the general model, at which
 * point `TRAFFIC_FOLLOW_BRAKE_KMH_S` becomes the older name for this.
 */
export const TRAFFIC_BRAKE_MAX_KMH_S = TRAFFIC_FOLLOW_BRAKE_KMH_S
/**
 * Below this deceleration the lamps stay dark — it is a lift, not a brake.
 * Real pedals work this way and it keeps a driver who is merely easing off from
 * telling the player there is ice ahead.
 */
export const TRAFFIC_BRAKE_LAMP_MIN_KMH_S = 6
/**
 * Minimum time the lamp stays lit once lit, ms.
 *
 * A real pedal is not tapped for one frame. Without this, a target that crosses
 * back and forth over the current speed strobes the lights, and a strobing brake
 * light reads as a rendering fault rather than as a car.
 */
export const TRAFFIC_BRAKE_LAMP_HOLD_MS = 250
/** Getting back up to cruise once the reason to slow is behind, km/h/s. */
export const TRAFFIC_ACCEL_KMH_S = 6
/**
 * How far under the leader a follower settles, km/h.
 *
 * Was a bare `- 2` inside `followPlayerSpeed`. Named because it is the difference
 * between a queue that holds station and one that creeps forward until it touches.
 */
export const TRAFFIC_FOLLOW_UNDERSHOOT_KMH = 2

// ── UI timing ───────────────────────────────────────────────────────────────

export const BLINK_MS = 400
export const ICE_AHEAD_LOOK_M = 220

// ── CRT effect ─────────────────────────────────────────────────────────────

export const SCANLINE_ALPHA = 0.7
export const CRT_CURVE_INTENSITY = 0.6

// ── Emissive glow (lamps) ───────────────────────────────────────────────────
//
// Filed with the CRT effect rather than with traffic on purpose: like scanlines
// and the screen curve, glow happens **on the glass**. The framebuffer keeps the
// flat 15-colour palette — nothing here recolours a single game pixel — and the
// bloom is composited over the finished frame with `'lighter'`. `?glow=0` blits
// nothing, and the frame is then byte-for-byte what it was before this existed.
//
// Sizes these are tuned against: a car is about 3 px tall at 220 m and 21 px at
// the last metre, a bus 26 px. The whole road viewport is 88 px.
//
// ── Why the second set of numbers is so much larger than the first ──────────
// Everything here was first tuned on the contact sheet and then failed in the
// game, for a reason worth stating once: **`?matrix=1` never draws scanlines**,
// and the game draws them over every frame at `SCANLINE_ALPHA = 0.7`. That is
// two of the four device rows of every game pixel taken to 30% brightness, so
// the whole picture — bloom included — plays at **0.65** of what the sheet
// showed. Judging a brightness on the sheet therefore over-read by 1.54x. The
// sheet can now draw them too (`?scanlines=1`), and the glow is now blitted
// *after* them, which is where the biggest single gain came from.

/**
 * Bloom strength — the `globalAlpha` of the additive blit.
 *
 * `AGENTS.md` costed this at 0.2-0.35 before anything emitted glow. Measured on
 * an oncoming car at zoom 6 against `?glow=0`:
 *
 *     alpha   pixels changed   mean delta   peak delta
 *     0.28        0.61 %           14           66 / 765
 *     0.35        0.64 %           17           82
 *     0.60        0.72 %           26          142
 *     0.90        0.77 %           37          214
 *
 * The reason the low end vanishes is worth keeping: the blob's peak lands on the
 * **lamp**, and a lamp is already `#FFFF00`. Additive light cannot brighten a
 * saturated channel, so everything the player actually sees is the blob's tail
 * falling on the dark road around it — a small fraction of the energy.
 *
 * 0.60 measured well on the sheet and was still invisible in the game (see the
 * scanline note above). 0.8 with two passes is the owner's "must be visible to
 * the naked eye". Overridable per-run with `?glow=0.5`.
 */
export const GLOW_ALPHA = 0.4
/** Emissive layer is scaled down by this before the bilinear upscale spreads it —
 *  that scaling IS the blur. 2 gives a 128 x 96 buffer: soft, still local. */
export const GLOW_DOWNSCALE = 2
/**
 * Additive blits per frame.
 *
 * The honest way past `alpha`'s ceiling of 1: a second blit of the same buffer
 * adds the same light again, so two passes is roughly twice the halo without
 * touching its shape. Three starts to flatten the falloff into a disc.
 */
export const GLOW_PASSES = 2

/**
 * Halo radius as a fraction of the vehicle's drawn height.
 *
 * Derived from the vehicle rather than fixed, or a bus at 200 m would wear the
 * same halo as a car at arm's length and distance would stop reading. The height
 * is the *drawn* height, which is an output of the resampler — see the rule in
 * `AGENTS.md`: a vehicle's size is never an input.
 *
 * 1.4 makes the halo wider than the vehicle is tall, which is what "modern
 * bloom" means and what the owner asked for. A near car's lower body ends up
 * washed in its own light; that is the effect, not a defect.
 */
export const GLOW_RADIUS_PER_HEIGHT = 1.4
/**
 * Floor, in pixels.
 *
 * At 4 px the two lamps of a distant car **merge into one glowing point**, which
 * `AGENTS.md` used to forbid as a smear. Deliberately reversed: at 220 m a car
 * is 3 px tall, and one point that can be seen beats two that cannot. Direction
 * still reads, because it is carried by the halo's colour and never by having
 * two of them.
 */
export const GLOW_RADIUS_MIN = 3
/**
 * Hard cap, in pixels. Still a cap — without one a bus in the last metres would
 * light half the viewport — but set where the bloom is allowed to be obvious.
 */
export const GLOW_RADIUS_MAX = 18
/** Brightness of a traffic lamp's halo, 0..1, before the layer alpha. */
export const GLOW_INTENSITY_TRAFFIC = 1

/**
 * The white-hot core: a second, small source drawn in `B_WHITE` on top of the
 * coloured halo.
 *
 * This is the one place the game puts a colour on screen that is not in the
 * palette, and it is deliberate — see `CLAUDE.md`. Additive white raises the
 * green and blue channels of a red lamp, so the lamp itself blows out toward
 * white instead of staying a flat red rectangle with a glow beside it. Nothing
 * in the framebuffer changes; it happens on the glass, like the scanlines.
 */
export const GLOW_CORE_INTENSITY = 0.5
/** Core radius as a fraction of the vehicle's drawn height, floored and capped
 *  much tighter than the halo — a core that spreads is just a second halo. */
export const GLOW_CORE_RADIUS_PER_HEIGHT = 0.3
export const GLOW_CORE_RADIUS_MIN = 2
export const GLOW_CORE_RADIUS_MAX = 4
/**
 * Shortest drawn vehicle that gets a core, in pixels.
 *
 * Set at the far/detail LOD boundary (`LOD_FAR_MAX_HEIGHT`, roughly 50 m for a
 * car) because of what the core costs: it desaturates the halo toward white, and
 * far away the halo's **colour is the only thing that says which way the vehicle
 * is going**. Close up the shape already says it, so the light may blow out.
 */
export const GLOW_CORE_MIN_HEIGHT = 8

/**
 * The player's own tail lamps, which are on screen every single frame.
 *
 * Dimmer than traffic on purpose: it is a constant in the corner of the eye and
 * must not compete with the road. Braking is the exception — that is real
 * feedback about a real input.
 *
 * The brake is now carried **twice over**: the lamps themselves swap `RED` for
 * `B_RED` in the framebuffer (see `TRUCK_LAMP_COLORS` in `render/truck.ts`), and
 * the halo brightens, grows and gains a core on top of that. The raster half is
 * what makes the brake readable with `?glow=0`; the glow half is what makes it
 * obvious with glow on. One signal alone is what made the first attempt
 * unnoticeable — intensity 0.65 -> 1.0 was a peak of 61 -> 93 out of 765, before
 * the scanlines took a further third of it.
 */
export const TRUCK_GLOW_INTENSITY = 0.55
export const TRUCK_GLOW_BRAKE_INTENSITY = 1
/**
 * Fixed — the truck sprite never changes size, so nothing can derive it — and
 * larger than a traffic halo, for a reason that only applies to this sprite: its
 * lamps are **surrounded by its own bright pixels**, a white bumper above and
 * cyan wheels below. Additive light cannot brighten white, so a halo that only
 * reaches its neighbours is spent before it finds anything dark. These radii
 * reach the road either side, which is where the light becomes visible at all.
 * 
 * Rrmeber: TRUCK_GLOW_BRAKE_RADIUS must be greater than TRUCK_GLOW_RADIUS
 */
export const TRUCK_GLOW_RADIUS = 8
export const TRUCK_GLOW_BRAKE_RADIUS = 10
/** Brake-light core radius. Fixed for the same reason as the radii above. */
export const TRUCK_GLOW_CORE_RADIUS = 2
