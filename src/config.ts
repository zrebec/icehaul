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
export const COLS = GAME_WIDTH / 8   // 32
/** Character rows (GAME_HEIGHT / 8). */
export const ROWS = GAME_HEIGHT / 8  // 24
/** CSS-pixel scale factor passed to setupCanvas. */
export const CANVAS_SCALE = 4

/** Top status bar height in cell rows. Contains SCORE, DIST, TIME, ICE AHEAD. */
export const STATUS_BAR_ROWS = 2
/** Bottom HUD instrument panel height in cell rows. */
export const HUD_ROWS = 9
/** First pixel row of the driving viewport (below status bar). */
export const VIEWPORT_TOP = STATUS_BAR_ROWS * 8            // 16
/** Last+1 pixel row of the driving viewport (above HUD). */
export const VIEWPORT_BOTTOM = GAME_HEIGHT - HUD_ROWS * 8  // 120
/** Driving viewport height in pixels. */
export const VIEWPORT_HEIGHT = VIEWPORT_BOTTOM - VIEWPORT_TOP  // 104

/**
 * Horizon position as a fraction of viewport height from the top.
 * 0.15 = very compact sky, mostly road.
 */
export const HORIZON_PCT = 0.15

// ── Surface types & per-surface physics ─────────────────────────────────────

export type Surface = 'asphalt' | 'snow' | 'ice' | 'sand' | 'mud'

/**
 * Per-surface acceleration multiplier. Applied to base ACCEL.
 * >1 = easier to accelerate (e.g. ice — wheels spin freely).
 * <1 = harder (e.g. sand — wheels dig in).
 */
export const SURFACE_ACCEL: Record<Surface, number> = {
  asphalt: 1.0,
  snow:    0.55,
  ice:     1.8,
  sand:    0.2,
  mud:     0.35,
}

/**
 * Per-surface grip (0–1). Affects steering responsiveness, lateral damping,
 * skid threshold behaviour, and centrifugal curve drift.
 * 1.0 = full grip (asphalt). Lower = less control.
 */
export const SURFACE_GRIP: Record<Surface, number> = {
  asphalt: 1.0,
  snow:    0.55,
  ice:     0.25,
  sand:    0.35,
  mud:     0.45,
}

/**
 * Per-surface tire wear rate multiplier. Applied to a future tire-wear
 * mechanic. Higher = tires degrade faster on this surface.
 */
export const SURFACE_WEAR: Record<Surface, number> = {
  asphalt: 1.0,
  snow:    1.6,
  ice:     2.5,
  sand:    1.8,
  mud:     1.4,
}

/**
 * Probability weights for surface generation (must sum to ~1.0).
 * The generator picks a surface based on cumulative probability bands.
 */
export const SURFACE_PROBABILITY: Record<Surface, number> = {
  asphalt: 0.30,
  snow:    0.22,
  ice:     0.22,
  sand:    0.10,
  mud:     0.16,
}

// ── Vehicle physics ─────────────────────────────────────────────────────────

/** Maximum forward speed in km/h. Matches the speed dial range (0–120). */
export const MAX_SPEED = 120
/** Base throttle acceleration in km/h gained per second (on asphalt). */
export const ACCEL = 25
/** Brake deceleration in km/h lost per second. */
export const BRAKE_DECEL = 90
/** Steering lateral acceleration in normalised x-units per second² at grip=1. */
export const STEER_ACCEL = 3.2
/** Lateral velocity damping per second at grip=1 when not steering. */
export const STEER_DAMP = 5.0
/** Maximum lateral velocity (clamp). */
export const MAX_LATERAL_V = 2.5

/**
 * Lateral velocity threshold at which oversteer kicks in on low-grip surfaces.
 * Below: controlled. Above: drift amplifies → skid.
 * Tapping keeps vx below threshold. Holding → skid.
 */
export const SKID_THRESHOLD = 0.4
/**
 * How aggressively skid self-amplifies past SKID_THRESHOLD.
 * Force = (|vx| - threshold) × SKID_AMPLIFY × (1 - grip).
 */
export const SKID_AMPLIFY = 3.0

// ── Fuel ────────────────────────────────────────────────────────────────────

/**
 * Fuel burn rate: fraction consumed per km/h per second.
 * At 80 km/h: ~0.0096/s → full tank lasts ~104 s.
 */
export const FUEL_BURN_RATE = 0.00012
/** Min speed below which no fuel is consumed. */
export const FUEL_IDLE_THRESHOLD = 5

// ── Road generation ─────────────────────────────────────────────────────────

/** Length of one road segment in metres. */
export const SEGMENT_LENGTH_M = 180

// ── Curvature ───────────────────────────────────────────────────────────────

/** Centrifugal drift force from road curvature. */
export const CURVE_DRIFT = 0.035
/** Max curvature range for segment generation. */
export const CURVATURE_RANGE = 4.2
/** Fraction of straight segments. */
export const STRAIGHT_SEGMENT_PCT = 0.12

// ── Off-road penalties ──────────────────────────────────────────────────────

/** Player.x beyond ±ROAD_EDGE triggers off-road penalty. */
export const ROAD_EDGE = 1.1
/** Edge-warning beep threshold (must be < ROAD_EDGE). */
export const EDGE_WARN_THRESHOLD = 0.9
/** Off-road speed drag: km/h lost per second per unit overshoot. */
export const OFF_ROAD_DRAG = 55
/** Off-road lateral push-back toward centre. */
export const OFF_ROAD_RETURN = 1.8

// ── Road rendering ──────────────────────────────────────────────────────────

/** Lateral pixel shift of vanishing point per unit of player.x. */
export const LATERAL_SHIFT = 22
/** Visual road curvature strength per scanline. */
export const CURVE_STRENGTH = 1.0
/** Perspective depth constant. */
export const PERSPECTIVE_K = 90
/** Road half-width at horizon (px). */
export const ROAD_HALF_TOP = 14
/** Road half-width at viewport bottom (px). */
export const ROAD_HALF_BOTTOM = 120
/** Kerb stripe world-length in metres. */
export const KERB_STRIPE_M = 3.0
/** Kerb width at viewport bottom (px). */
export const KERB_WIDTH_BOTTOM = 4
/** Kerb width at horizon (px). */
export const KERB_WIDTH_TOP = 1

// ── Audio ───────────────────────────────────────────────────────────────────

export const ENGINE_IDLE_HZ = 40
export const ENGINE_TOP_HZ = 235
export const ENGINE_GAIN = 0.06
export const SCREECH_COOLDOWN_S = 0.35
export const OFFROAD_BEEP_COOLDOWN_S = 0.25

// ── UI timing ───────────────────────────────────────────────────────────────

export const BLINK_MS = 400
export const ICE_AHEAD_LOOK_M = 120

// ── CRT effect ─────────────────────────────────────────────────────────────

export const SCANLINE_ALPHA = 0.7
export const CRT_CURVE_INTENSITY = 0.6
