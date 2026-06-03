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
  snow: 0.55,
  ice: 0.25,
  sand: 0.35,
  mud: 0.45,
}

/**
 * Per-surface passive speed drag in km/h lost per second.
 * 0 = no drag (asphalt — heavy truck, rolls freely).
 * Sand has strong drag (wheels dig in), snow mild, ice none.
 */
export const SURFACE_DRAG: Record<Surface, number> = {
  asphalt: 0,
  snow: 4,
  ice: 0,
  sand: 7,
  mud: 8,
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
 * Truck gross weight in tonnes. Displayed on dashboard.
 * Affects feel (all physics tuned for this mass). Future: cargo system varies it.
 */
export const TRUCK_WEIGHT_T = 20

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
 * It never goes negative, and on the dashboard it idles at IDLE_RPM while running
 * (so a moving gear never shows a dead zero). Torque over rpm:
 *     rpm < BOG_RPM       low end → grunt floored at BOG_FLOOR (pull away in a tall gear)
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
}

export const GEARS: readonly GearSpec[] = [
  { to: 28,  accel: 5.5 },  // 1 — pull away, careful starts on snow/ice
  { to: 52,  accel: 4.2 },  // 2
  { to: 76,  accel: 3.2 },  // 3 — main cruising gear
  { to: 100, accel: 2.4 },  // 4
  { to: 130, accel: 1.8 },  // 5 — top gear; MAX_SPEED caps real speed at 120, so cruise sits below redline
]

/** Number of forward gears. */
export const GEAR_COUNT = GEARS.length

/** Dashboard idle floor — while running the RPM gauge never drops below this (~1 segment). */
export const IDLE_RPM = 0.14
/** Below this rpm the engine lugs (too-tall gear); torque is floored at BOG_FLOOR. */
export const BOG_RPM = 0.22
/** Torque multiplier floor at idle / when lugging — diesel low-end grunt. */
export const BOG_FLOOR = 0.40
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
 * Lug threshold on rpm (`speed / gear.to`). When revs fall below this in a gear the
 * engine lugs toward a stall — i.e. you slowed/braked without downshifting. First
 * gear is exempt (you can always idle and pull away in 1st). With `LUG_RPM = 0.06`:
 * 2nd lugs below ~3 km/h, 3rd below ~5, 4th below ~6, 5th below ~8. A stalled engine
 * must be restarted with ENTER (ignition).
 */
export const LUG_RPM = 0.06

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

export const LATERAL_SHIFT = 22
export const CURVE_STRENGTH = 1.0
/** Road texture/canister/roadside projection depth in metres. */
export const PERSPECTIVE_K = 150
/**
 * Traffic look-ahead distance in metres.
 * Kept separate from road scanline projection so vehicles can be introduced
 * earlier than the short visible road texture depth.
 */
export const TRAFFIC_VIEW_DISTANCE_M = 220
export const ROAD_HALF_TOP = 14
export const ROAD_HALF_BOTTOM = 120
export const KERB_STRIPE_M = 2.0
export const KERB_WIDTH_BOTTOM = 4
export const KERB_WIDTH_TOP = 1
/**
 * Road segment marker spacing in metres. Thin horizontal lines across
 * the road that rush toward the player — primary speed perception cue.
 * At 120 km/h: ~1.3 markers/s. At 30 km/h: ~0.33 markers/s.
 */
export const ROAD_MARKER_SPACING_M = 25

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

// ── Mission / delivery ──────────────────────────────────────────────────────

/** Distance of the first delivery target from start (metres). */
export const FIRST_TARGET_DIST_M = 5000
/** Range for subsequent targets [min, max] metres beyond current position. */
export const NEXT_TARGET_RANGE: readonly [number, number] = [15000, 25000]
/** Fuel refill fraction awarded on successful delivery (0–1). */
export const DELIVERY_FUEL_REFILL = 0.50
/** Score points awarded per delivery. */
export const DELIVERY_SCORE = 500
/**
 * Time limit per delivery in milliseconds (8 minutes).
 * Raised from 7 → 8 min when the manual gearbox made acceleration much slower:
 * a careful (conservative) driver must still be able to finish 5 km on time.
 */
export const DELIVERY_TIME_LIMIT_MS = 8 * 60 * 1000

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

// ── UI timing ───────────────────────────────────────────────────────────────

export const BLINK_MS = 400
export const ICE_AHEAD_LOOK_M = 220

// ── CRT effect ─────────────────────────────────────────────────────────────

export const SCANLINE_ALPHA = 0.7
export const CRT_CURVE_INTENSITY = 0.6
