/**
 * Vehicle physics — based on Marco Monster's "Car Physics for Games" model,
 * adapted for pseudo-3D (1 axis lateral + forward speed).
 *
 * Key forces (longitudinal):
 *   F_engine    = gear.accel × torque(rpm) × surface_mult  (throttle, gear-limited)
 *   F_brake     = SURFACE_BRAKE[surface].decel × speedFade  (manual brake)
 *   F_aero      = AERO_DRAG × (v/MAX)²          (quadratic, dominates at high speed)
 *   F_rolling   = ROLLING_RESISTANCE × v         (linear, dominates at low speed)
 *   F_engine_br = ENGINE_BRAKE × (v/MAX)         (throttle released = engine compression)
 *   F_surface   = SURFACE_DRAG × (v/MAX)         (sand/mud/snow resistance)
 *
 * Key forces (lateral):
 *   Steering    = STEER_ACCEL × grip × gripMult × speedFactor
 *   Damping     = STEER_DAMP × grip × gripMult × dampMult
 *   Centrifugal = curvature × speed × CURVE_DRIFT × (1 - grip×0.7)
 *
 * Grip curve (slip angle approximation):
 *   gripMult = 1.0                      if |vx| ≤ SLIP_PEAK  (linear zone)
 *   gripMult = (SLIP_PEAK / |vx|)²      if |vx| > SLIP_PEAK  (drop-off zone)
 *   Minimum 5% residual grip to prevent infinite slides.
 *
 * This naturally produces understeer/oversteer without explicit thresholds.
 */

import {
  MAX_SPEED, REFERENCE_MASS_T,
  AERO_DRAG, ROLLING_RESISTANCE, ENGINE_BRAKE,
  CURVE_DRIFT,
  STEER_ACCEL, STEER_DAMP, MAX_LATERAL_V,
  SPEED_STEER_PENALTY,
  OFF_ROAD_DRAG, OFF_ROAD_RETURN,
  FUEL_BURN_RATE, FUEL_IDLE_THRESHOLD,
  SURFACE_DRAG, SURFACE_BRAKE,
  SURFACE_STEER_DAMP_MULT, SURFACE_FUEL_MULT,
  SURFACE_SLIP_PEAK,
  GEARS, GEAR_COUNT, BOG_RPM, BOG_FLOOR, POWER_RPM, REDLINE_FLOOR, OVERREV_ENGINE_BRAKE,
  LUG_RPM, STALL_GRACE_MS, REDLINE_RPM, REDLINE_BURN_MS, REDLINE_WARN_DELAY_MS,
  type Surface,
} from '../config.ts'

export { MAX_SPEED }

/**
 * Mass-based acceleration multiplier. Engine pull scales inversely with gross
 * weight relative to the tuning baseline ({@link REFERENCE_MASS_T}): the 20 t
 * reference truck returns 1.0 (today's feel unchanged), a 10 t empty cab ~2.0
 * (sprightly), a 30 t heavy load ~0.67 (a slog). Heavy loads therefore lean even
 * harder on the low gears to pull away — the manual box matters more.
 *
 * Pure → unit-testable. Folded into the engine-force term at the call site
 * (`scenes/drive.ts`) for now; a later step will also let mass make the engine
 * (a) lug/stall more easily and (b) take longer to brake.
 */
export function massAccelMult(massT: number, referenceMassT = REFERENCE_MASS_T): number {
  return referenceMassT / massT
}

/**
 * Mass-based braking multiplier. Manual-brake deceleration scales inversely with
 * gross weight relative to {@link REFERENCE_MASS_T}: the 20 t reference truck
 * returns 1.0 (today's stopping power unchanged), a 10 t empty cab ~2.0 (pulls up
 * sharply), a 30 t load ~0.67 (carries its momentum — stops ~1.5× later). Same
 * inertia intuition as {@link massAccelMult}, applied to the brake instead of the
 * engine. Deliberately scoped to the *manual brake* only — aero/rolling/surface
 * drag stay mass-independent so the SURFACE_DRAG equilibria keep their tuning.
 *
 * Pure → unit-testable. Threaded into {@link tickVehicle} via the `massT` param.
 */
export function massBrakeMult(massT: number, referenceMassT = REFERENCE_MASS_T): number {
  return referenceMassT / massT
}

/**
 * Mass-based stall-grace multiplier. Scales the lugging grace period (see
 * {@link STALL_GRACE_MS}) inversely with gross weight relative to
 * {@link REFERENCE_MASS_T}: 20 t returns 1.0 (today's ~3.5 s unchanged), a heavy
 * 30 t load ~0.67 (only ~2.3 s before it dies — more load lugs the engine to a
 * stall sooner), a light 10 t cab ~2.0 (~7 s, forgiving). Same inertia intuition
 * as {@link massAccelMult}/{@link massBrakeMult}, applied to the stall timer.
 *
 * Pure → unit-testable. Threaded into {@link tickVehicle} via the `massT` param.
 */
export function massStallMult(massT: number, referenceMassT = REFERENCE_MASS_T): number {
  return referenceMassT / massT
}

export interface Vehicle {
  x: number
  vx: number
  speed: number
  distance: number
  fuel: number
  /** Current engaged gear (1..GEAR_COUNT). */
  gear: number
  /** Engine revs within the current gear's band (0..1, 1 = redline). For display. */
  rpm: number
  /** True when the engine has stalled (lugged below idle). Restart with ENTER. */
  stalled: boolean
  /** Milliseconds the engine has lugged below the stall threshold (grace countdown). */
  stallWarnMs: number
  /** True while the "ENGINE STALLING" warning shows — lugging, not dead yet. */
  stallWarning: boolean
  /** Milliseconds held at the redline under throttle (burn-out countdown). */
  redlineMs: number
  /** True while the "REDLINE / SHIFT UP" warning shows — over-revving, not dead yet. */
  redlineWarning: boolean
  /** Why the engine last stalled — kept so a future damage model can differentiate. */
  stallCause: 'lug' | 'overrev' | null
  /** True only on the tick a downshift was refused by a synchro speed limit. */
  shiftBlocked: boolean
}

export interface VehicleInput {
  throttle: boolean
  brake: boolean
  steerLeft: boolean
  steerRight: boolean
  /** Edge-triggered: shift up one gear this tick. */
  shiftUp?: boolean
  /** Edge-triggered: shift down one gear this tick. */
  shiftDown?: boolean
  /** Edge-triggered: ENTER ignition — restart a stalled engine. */
  restart?: boolean
}

export function createVehicle(): Vehicle {
  return {
    x: 0, vx: 0, speed: 0, distance: 0, fuel: 1.0,
    gear: 1, rpm: 0, stalled: false, stallWarnMs: 0, stallWarning: false,
    redlineMs: 0, redlineWarning: false, stallCause: null, shiftBlocked: false,
  }
}

/**
 * Synchro check — may you downshift INTO `targetGear` at this speed? A gear with a
 * numeric `maxSpeedToShift` refuses engagement above it; `null` = no limit.
 */
function canDownshiftInto(targetGear: number, speed: number): boolean {
  const limit = GEARS[targetGear - 1]!.maxSpeedToShift
  return limit === null || speed <= limit
}

/**
 * Pick a sensible gear to re-engage on restart so the engine does not instantly
 * re-stall (too tall) or redline (too short). Falls back to 1st at low speed.
 */
function startableGear(speed: number): number {
  // Lowest gear that isn't near the redline at this speed — gives the most pull.
  for (let g = 1; g <= GEAR_COUNT; g++) {
    if (speed / GEARS[g - 1]!.to <= 0.9) return g
  }
  return GEAR_COUNT
}

/**
 * Throttle torque multiplier from engine rpm (0..1+ inside the current gear band).
 * Lugging below the power band is weak; the flat band is full power; near redline
 * torque tapers; at/above redline the engine cannot pull the gear any faster.
 */
function gearTorqueMult(rpm: number): number {
  if (rpm >= 1) return 0
  const r = Math.max(0, rpm)
  if (r < BOG_RPM) return BOG_FLOOR + (r / BOG_RPM) ** 2 * (1 - BOG_FLOOR)
  if (r <= POWER_RPM) return 1
  return 1 - ((r - POWER_RPM) / (1 - POWER_RPM)) * (1 - REDLINE_FLOOR)
}

/**
 * Slip angle grip curve. Returns 1.0 in the linear zone,
 * drops off as 1/x² beyond the peak. Minimum 5% residual grip.
 */
function slipGripMult(vx: number, slipPeak: number): number {
  const ratio = Math.abs(vx) / slipPeak
  if (ratio <= 1) return 1.0
  return Math.max(0.05, 1 / (ratio * ratio))
}

export function tickVehicle(
  v: Vehicle,
  input: VehicleInput,
  surface: Surface,
  grip: number,
  accelMult: number,
  dtMs: number,
  curvature = 0,
  offroadSeverity = 0,
  offroadReturnDir = 0,
  massT: number = REFERENCE_MASS_T,
): void {
  const dt = dtMs / 1000
  const speedRatio = v.speed / MAX_SPEED

  // ── Gearbox (manual) — shift, optional restart, then derive rpm + torque ──
  v.shiftBlocked = false
  if (input.shiftUp && v.gear < GEAR_COUNT) v.gear++   // upshifts are always allowed
  if (input.shiftDown && v.gear > 1) {
    if (canDownshiftInto(v.gear - 1, v.speed)) v.gear--
    else v.shiftBlocked = true                          // synchro refused the downshift
  }

  // ENTER ignition — restart a stalled engine in a sensible gear.
  if (v.stalled && input.restart) {
    v.stalled = false
    v.stallWarnMs = 0
    v.redlineMs = 0
    v.stallCause = null
    v.gear = startableGear(v.speed)
  }

  const gear = GEARS[v.gear - 1]!
  // RPM is proportional to road speed within the gear (like a real engine):
  // 0 at standstill, 1.0 = redline at the gear's top. Never negative.
  const rpmRaw = gear.to > 0 ? v.speed / gear.to : 0

  // Stall — lugging far below idle in a gear it can't sustain kills the engine,
  // but only after a grace period with an "ENGINE STALLING" warning so you can
  // downshift. First gear is exempt — you can always idle and pull away in 1st.
  if (v.stalled) {
    v.stallWarnMs = 0
  } else if (rpmRaw < LUG_RPM && v.gear > 1) {
    // Heavier loads lug to a stall sooner: massStallMult shrinks the grace window
    // (20 t = full ~3.5 s, 30 t ≈ 2.3 s, 10 t ≈ 7 s).
    v.stallWarnMs += dtMs
    if (v.stallWarnMs >= STALL_GRACE_MS * massStallMult(massT)) {
      v.stalled = true
      v.stallCause = 'lug'
      v.stallWarnMs = 0
    }
  } else {
    v.stallWarnMs = 0
  }
  v.stallWarning = !v.stalled && v.stallWarnMs > 0

  // Redline burn-out — sitting on the limiter under throttle without upshifting
  // cooks the engine. Only in gears you can upshift out of: the top gear's redline
  // is just the speed limiter (no recourse), so it never burns out.
  const atRedline = !v.stalled && rpmRaw >= REDLINE_RPM && v.gear < GEAR_COUNT
  if (atRedline && input.throttle) {
    v.redlineMs += dtMs
    if (v.redlineMs >= REDLINE_BURN_MS) {
      v.stalled = true
      v.stallCause = 'overrev'
      v.redlineMs = 0
    }
  } else {
    v.redlineMs = 0
  }
  v.redlineWarning = !v.stalled && atRedline && input.throttle && v.redlineMs >= REDLINE_WARN_DELAY_MS

  // Dashboard RPM is the raw ratio (it CAN drop to 0 bars when lugging), clamped to
  // redline at the top. Zero only when actually stalled.
  v.rpm = v.stalled ? 0 : Math.min(1, rpmRaw)
  const torque = v.stalled ? 0 : gearTorqueMult(rpmRaw)

  // ── Longitudinal forces ────────────────────────────────────────────────

  // Engine force (throttle) — torque-scaled, capped at the current gear's top
  // (and never above MAX_SPEED). A stalled engine produces nothing; freewheels.
  const speedCap = Math.min(gear.to, MAX_SPEED)
  if (!v.stalled && input.throttle && v.fuel > 0 && v.speed < speedCap) {
    v.speed = Math.min(speedCap, v.speed + gear.accel * torque * accelMult * dt)
  }

  // Over-rev engine braking — too low a gear for this speed (e.g. after a
  // downshift) drags speed back down toward the gear's top. Compression, not brake.
  if (!v.stalled && v.speed > gear.to) {
    v.speed = Math.max(gear.to, v.speed - OVERREV_ENGINE_BRAKE * dt)
  }

  // Manual brake — per-surface profile with speed fade and wheel lock. Heavier
  // loads carry their momentum: massBrakeMult shrinks the deceleration so a 30 t
  // truck needs a longer stopping distance than a 10 t cab (20 t = unchanged).
  const bp = SURFACE_BRAKE[surface]
  if (input.brake) {
    const speedFade = 1 - speedRatio * bp.speedFade
    v.speed = Math.max(0, v.speed - bp.decel * speedFade * massBrakeMult(massT) * dt)
  }

  // Engine braking (throttle released, engine compression resists motion)
  if (!v.stalled && !input.throttle && !input.brake && v.fuel > 0 && v.speed > 0) {
    v.speed = Math.max(0, v.speed - ENGINE_BRAKE * speedRatio * dt)
  }

  // Rolling resistance (linear with speed, all surfaces)
  if (v.speed > 0) {
    v.speed = Math.max(0, v.speed - ROLLING_RESISTANCE * v.speed * dt)
  }

  // Aerodynamic drag (quadratic with speed, all surfaces)
  if (v.speed > 0) {
    v.speed = Math.max(0, v.speed - AERO_DRAG * speedRatio * speedRatio * dt)
  }

  // Surface drag (sand/mud/snow specific, proportional to speed)
  const surfDrag = SURFACE_DRAG[surface]
  if (surfDrag > 0 && v.speed > 0) {
    v.speed = Math.max(0, v.speed - surfDrag * speedRatio * dt)
  }

  // Empty tank coast-down (engine dead)
  if (v.fuel <= 0 && v.speed > 0) {
    v.speed = Math.max(0, v.speed - 8 * dt)
  }

  // Off-road drag (pixel-perfect severity from offroad.ts)
  if (offroadSeverity > 0) {
    v.speed = Math.max(0, v.speed - OFF_ROAD_DRAG * offroadSeverity * dt)
    v.vx += offroadReturnDir * OFF_ROAD_RETURN * offroadSeverity * dt
  }

  // ── Lateral forces (slip angle model) ──────────────────────────────────

  // Grip multiplier from slip curve (replaces binary skid threshold)
  const slipPeak = SURFACE_SLIP_PEAK[surface]
  const gripMult = slipGripMult(v.vx, slipPeak)

  // Brake lateral loss — locked wheels reduce steering authority.
  let brakeLoss = 0
  if (input.brake) {
    brakeLoss = bp.lateralLoss
    if (v.speed > bp.lockSpeed) {
      const lockExcess = (v.speed - bp.lockSpeed) / (MAX_SPEED - bp.lockSpeed)
      brakeLoss = Math.min(0.9, brakeLoss + lockExcess * 0.4)
    }
  }

  // steeringGrip: what the driver's input can do — base grip minus brake loss.
  // NOT reduced by the slip curve: the wheel is still turned, force still exists.
  const steeringGrip = grip * (1 - brakeLoss)

  // effectiveGrip: physics self-correction — full model including slip collapse.
  // When sliding, the tire cannot self-correct (this is the "drift persists" behaviour).
  const effectiveGrip = grip * gripMult * (1 - brakeLoss)

  // Centrifugal drift from road curvature
  if (curvature !== 0 && v.speed > 5) {
    v.vx += -curvature * v.speed * CURVE_DRIFT * (1 - grip * 0.7) * dt
  }

  // Steering input — uses steeringGrip so the player always has agency
  // proportional to base surface grip. On ice it is weak (grip=0.25) but present.
  const speedSteerFactor = 1 - speedRatio * SPEED_STEER_PENALTY
  if (input.steerLeft)  v.vx -= STEER_ACCEL * steeringGrip * speedSteerFactor * dt
  if (input.steerRight) v.vx += STEER_ACCEL * steeringGrip * speedSteerFactor * dt

  // Damping — uses effectiveGrip: past the slip peak, drift persists (ice doesn't forgive)
  if (!input.steerLeft && !input.steerRight) {
    const dampMult = SURFACE_STEER_DAMP_MULT[surface]
    v.vx *= 1 - Math.min(1, STEER_DAMP * effectiveGrip * dampMult * dt)
  }

  v.vx = Math.max(-MAX_LATERAL_V, Math.min(MAX_LATERAL_V, v.vx))
  v.x += v.vx * (0.35 + v.speed / 220) * dt
  v.x = Math.max(-2.0, Math.min(2.0, v.x))

  // ── Distance + fuel ────────────────────────────────────────────────────

  v.distance += (v.speed / 3.6) * dt

  if (!v.stalled && v.speed > FUEL_IDLE_THRESHOLD && v.fuel > 0) {
    const speedFactor = v.speed * (v.speed / MAX_SPEED)
    v.fuel = Math.max(0, v.fuel - speedFactor * FUEL_BURN_RATE * SURFACE_FUEL_MULT[surface] * dt)
  }
}
