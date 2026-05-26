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
  snow:    0.55,
  ice:     1.8,
  sand:    0.2,
  mud:     0.35,
}

/** Per-surface grip (0–1). Steering + damping + centrifugal drift. */
export const SURFACE_GRIP: Record<Surface, number> = {
  asphalt: 1.0,
  snow:    0.55,
  ice:     0.25,
  sand:    0.35,
  mud:     0.45,
}

/**
 * Per-surface passive speed drag in km/h lost per second.
 * 0 = no drag (asphalt — heavy truck, rolls freely).
 * Sand has strong drag (wheels dig in), snow mild, ice none.
 */
export const SURFACE_DRAG: Record<Surface, number> = {
  asphalt: 0,
  snow:    4,
  ice:     0,
  sand:    12,
  mud:     8,
}

/**
 * Per-surface brake effectiveness multiplier.
 * 1.0 = full braking (asphalt). On ice brakes are weak (0.5).
 */
export const SURFACE_BRAKE_MULT: Record<Surface, number> = {
  asphalt: 1.0,
  snow:    0.8,
  ice:     0.5,
  sand:    0.7,
  mud:     0.75,
}

/**
 * Per-surface skid enabled flag.
 * On sand: no skid (problem is resistance, not slipperiness).
 * On ice/snow/mud: skid active (slippery).
 */
export const SURFACE_SKID_ENABLED: Record<Surface, boolean> = {
  asphalt: false,
  snow:    true,
  ice:     true,
  sand:    false,
  mud:     true,
}

/**
 * Per-surface steering damping multiplier. Applied on top of grip-based damping.
 * Sand has extra-high damping (steering feels heavy, resists turning).
 */
export const SURFACE_STEER_DAMP_MULT: Record<Surface, number> = {
  asphalt: 1.0,
  snow:    1.0,
  ice:     1.0,
  sand:    2.5,
  mud:     1.5,
}

/**
 * Per-surface fuel consumption multiplier.
 * Sand/mud burn more (engine works harder). Ice burns slightly less (low resistance).
 */
export const SURFACE_FUEL_MULT: Record<Surface, number> = {
  asphalt: 1.0,
  snow:    1.2,
  ice:     0.9,
  sand:    1.5,
  mud:     1.3,
}

/** Per-surface tire wear rate multiplier (future mechanic). */
export const SURFACE_WEAR: Record<Surface, number> = {
  asphalt: 1.0,
  snow:    1.6,
  ice:     2.5,
  sand:    1.8,
  mud:     1.4,
}

/** Probability weights for surface generation (~sums to 1.0). */
export const SURFACE_PROBABILITY: Record<Surface, number> = {
  asphalt: 0.30,
  snow:    0.22,
  ice:     0.22,
  sand:    0.10,
  mud:     0.16,
}

// ── Vehicle physics ─────────────────────────────────────────────────────────

/** Maximum forward speed in km/h (dial range 0–120). */
export const MAX_SPEED = 120
/** Base throttle acceleration in km/h per second (on asphalt). */
export const ACCEL = 25
/** Base brake deceleration in km/h per second (on asphalt). */
export const BRAKE_DECEL = 90
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
export const AERO_DRAG = 3.5

/**
 * How much speed reduces steering effectiveness (0–1).
 * At 0: speed has no effect. At 0.6: steering at MAX_SPEED is 40% of standstill.
 * Simulates: higher speed → more inertia → harder to turn.
 */
export const SPEED_STEER_PENALTY = 0.6

/**
 * How much speed lowers the skid threshold (0–1).
 * At 0.5: threshold at MAX_SPEED is 50% of standstill value.
 * Simulates: higher speed → easier to lose traction.
 */
export const SPEED_SKID_PENALTY = 0.5

/** Lateral vx threshold for oversteer on slippery surfaces (at standstill). */
export const SKID_THRESHOLD = 0.4
/** Skid self-amplification strength. */
export const SKID_AMPLIFY = 3.0

// ── Fuel ────────────────────────────────────────────────────────────────────

export const FUEL_BURN_RATE = 0.00012
export const FUEL_IDLE_THRESHOLD = 5

// ── Road generation ─────────────────────────────────────────────────────────

/** First segment is always asphalt, this many metres. */
export const START_ASPHALT_M = 1000

/** Per-surface segment length range [min, max] in metres. */
export const SURFACE_LENGTH_RANGE: Record<Surface, readonly [number, number]> = {
  asphalt: [200, 800],
  snow:    [100, 800],
  ice:     [100, 300],
  sand:    [100, 800],
  mud:     [100, 800],
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
export const STRAIGHT_LENGTH_RANGE: readonly [number, number] = [200, 600]
/** Length of the full-curvature portion of a turn [min, max] metres. */
export const TURN_LENGTH_RANGE: readonly [number, number] = [100, 400]
/** Length of the smooth ramp into/out of a turn (metres). */
export const TURN_RAMP_M = 80

// ── Off-road penalties ──────────────────────────────────────────────────────

export const ROAD_EDGE = 1.1
export const EDGE_WARN_THRESHOLD = 0.9
export const OFF_ROAD_DRAG = 55
export const OFF_ROAD_RETURN = 1.8

// ── Road rendering ──────────────────────────────────────────────────────────

export const LATERAL_SHIFT = 22
export const CURVE_STRENGTH = 1.0
export const PERSPECTIVE_K = 90
export const ROAD_HALF_TOP = 14
export const ROAD_HALF_BOTTOM = 120
export const KERB_STRIPE_M = 3.0
export const KERB_WIDTH_BOTTOM = 4
export const KERB_WIDTH_TOP = 1

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
  asphalt: ['square',   40, 235],
  snow:    ['triangle', 35, 180],
  ice:     ['sawtooth', 50, 280],
  sand:    ['square',   25, 140],
  mud:     ['triangle', 30, 160],
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
/** Time limit per delivery in milliseconds (7 minutes). */
export const DELIVERY_TIME_LIMIT_MS = 7 * 60 * 1000

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
/** Lateral collision radius for cars in player.x units. */
export const TRAFFIC_COLLISION_RADIUS_CAR = 0.12
/** Lateral collision radius for trucks (wider). */
export const TRAFFIC_COLLISION_RADIUS_TRUCK = 0.16
/** World-distance collision depth (metres). Must match visual sprite depth. */
export const TRAFFIC_COLLISION_DEPTH_M = 4
/** First traffic vehicle appears after this many metres (safe start). */
export const TRAFFIC_START_M = 800

// ── UI timing ───────────────────────────────────────────────────────────────

export const BLINK_MS = 400
export const ICE_AHEAD_LOOK_M = 120

// ── CRT effect ─────────────────────────────────────────────────────────────

export const SCANLINE_ALPHA = 0.7
export const CRT_CURVE_INTENSITY = 0.6
