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
export const VIEWPORT_TOP = STATUS_BAR_ROWS * 8            // 32
/** Last+1 pixel row of the driving viewport (above HUD). */
export const VIEWPORT_BOTTOM = GAME_HEIGHT - HUD_ROWS * 8  // 120
/** Driving viewport height in pixels. */
export const VIEWPORT_HEIGHT = VIEWPORT_BOTTOM - VIEWPORT_TOP  // 88

/**
 * Horizon position as a fraction of viewport height from the top.
 * 0.25 = compact sky (25% sky, 75% road). Lower = more road visible.
 */
export const HORIZON_PCT = 0.15

// ── Vehicle physics ─────────────────────────────────────────────────────────

/** Maximum forward speed in km/h. Matches the speed dial range. */
export const MAX_SPEED = 160
/** Throttle acceleration in km/h gained per second. */
export const ACCEL = 25
/** Brake deceleration in km/h lost per second. */
export const BRAKE_DECEL = 90
/** Steering lateral acceleration in normalised x-units per second² at grip=1. */
export const STEER_ACCEL = 3.2
/** Lateral velocity damping per second at grip=1 when not steering. Higher = snappier return to centre. */
export const STEER_DAMP = 5.0
/** Maximum lateral velocity (clamp). Prevents infinite drift accumulation. */
export const MAX_LATERAL_V = 2.5

// ── Surface & grip ──────────────────────────────────────────────────────────

/**
 * Ice grip multiplier (0–1). Affects steering response AND lateral damping.
 * At 0.15, steering acceleration drops to 15% and drift persists ~6× longer.
 * Asphalt is always 1.0.
 */
export const ICE_GRIP = 0.25

// ── Road generation ─────────────────────────────────────────────────────────

/** Length of one road segment in metres. Surface and curvature change at segment boundaries. */
export const SEGMENT_LENGTH_M = 180
/** Probability (0–1) that any given segment is ice. Rest is asphalt. */
export const ICE_PROBABILITY = 0.40

// ── Curvature ───────────────────────────────────────────────────────────────

/**
 * Centrifugal drift force from road curvature.
 * Formula: `curvature × speed × CURVE_DRIFT × (1 − grip×0.7)`.
 * At 40 km/h on ice (grip=0.25), curvature 1.0: drift ≈ 1.16 /s².
 * Counter-steer on ice = 0.8 /s² → tight but doable at low speed.
 * At 80 km/h same conditions: drift ≈ 2.31 → must brake.
 * Asphalt at 80 km/h curvature 1.5: drift ≈ 1.26 → comfortable.
 */
export const CURVE_DRIFT = 0.035
/** Maximum curvature range multiplier for segment generation. Higher = sharper possible bends. */
export const CURVATURE_RANGE = 3.6
/** Fraction of segments that are perfectly straight (0–1). */
export const STRAIGHT_SEGMENT_PCT = 0.12

// ── Off-road penalties ──────────────────────────────────────────────────────

/**
 * Player.x threshold where the road ends. Values beyond ±ROAD_EDGE are off-road.
 * The road renders from −halfBottom to +halfBottom in pixels; ROAD_EDGE maps to the
 * visual edge. 1.0 = exactly at the kerb. 1.3 = small shoulder before penalty.
 */
export const ROAD_EDGE = 1.1
/**
 * Player.x threshold where the edge-warning beep starts.
 * Must be LESS than ROAD_EDGE to give an audible cue BEFORE full penalty.
 */
export const EDGE_WARN_THRESHOLD = 0.9
/** Speed drag when off-road: km/h lost per second per unit of overshoot beyond ROAD_EDGE. */
export const OFF_ROAD_DRAG = 55
/** Lateral push-back force toward road centre when off-road (units/s² per unit overshoot). */
export const OFF_ROAD_RETURN = 1.8

// ── Road rendering ──────────────────────────────────────────────────────────

/**
 * Lateral pixel shift of the vanishing point per unit of player.x.
 * When player drifts right (x>0), the vanishing point shifts LEFT by this many pixels.
 * Gives the driver visual feedback of their lateral position.
 */
export const LATERAL_SHIFT = 22
/**
 * Visual strength of road curvature accumulation per scanline.
 * Higher = sharper visible bends. Weighted by distance-from-bottom so the
 * road stays flat under the driver and curves appear only in the distance.
 */
export const CURVE_STRENGTH = 0.8
/** Perspective depth constant: world-metres at the horizon's first scanline. */
export const PERSPECTIVE_K = 90
/** Road half-width at the horizon in game pixels. */
export const ROAD_HALF_TOP = 14
/** Road half-width at the bottom of the viewport in game pixels. */
export const ROAD_HALF_BOTTOM = 120
/** Kerb stripe length in world-metres. Controls the alternation speed. */
export const KERB_STRIPE_M = 3.0
/** Kerb width in pixels at the bottom of the viewport. */
export const KERB_WIDTH_BOTTOM = 4
/** Kerb width in pixels at the horizon. */
export const KERB_WIDTH_TOP = 1

// ── Audio ───────────────────────────────────────────────────────────────────

/** Engine drone frequency at idle (0 km/h). Hz. */
export const ENGINE_IDLE_HZ = 40
/** Engine drone frequency at MAX_SPEED. Hz. */
export const ENGINE_TOP_HZ = 235
/** Engine drone gain (0–1). Keep subtle so beeper SFX remain audible. */
export const ENGINE_GAIN = 0.06
/** Ice tire-screech minimum cooldown in seconds. */
export const SCREECH_COOLDOWN_S = 0.35
/** Off-road rumble beep cooldown in seconds. */
export const OFFROAD_BEEP_COOLDOWN_S = 0.25

// ── UI timing ───────────────────────────────────────────────────────────────

/** ICE AHEAD blink toggle interval in milliseconds. */
export const BLINK_MS = 400
/** Look-ahead distance for the ICE AHEAD warning in metres. */
export const ICE_AHEAD_LOOK_M = 120

// ── CRT effect ─────────────────────────────────────────────────────────────

/**
 * Scanline overlay opacity (0–1). Drawn every frame after all game rendering.
 * 0 = disabled, 0.25 = subtle, 0.7 = strong authentic CRT look.
 */
export const SCANLINE_ALPHA = 0.7
/**
 * CRT display curvature intensity (0–1). Applied once at startup via CSS.
 * 0 = flat screen, 1 = full barrel distortion + vignette.
 */
export const CRT_CURVE_INTENSITY = 0.6
