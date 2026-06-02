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
  MAX_SPEED,
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
  STALL_RPM, STALL_GRACE_MS,
  type Surface,
} from '../config.ts'

export { MAX_SPEED }

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
  }
}

/**
 * Pick a sensible gear to re-engage on restart so the engine does not instantly
 * re-stall (too tall) or redline (too short). Falls back to 1st at low speed.
 */
function startableGear(speed: number): number {
  for (let g = GEAR_COUNT; g >= 1; g--) {
    const spec = GEARS[g - 1]!
    const span = spec.to - spec.from
    const rpm = span > 0 ? (speed - spec.from) / span : 0
    if (rpm >= 0 && rpm < 0.9) return g
  }
  return 1
}

/**
 * Throttle torque multiplier from engine rpm (0..1+ inside the current gear band).
 * Lugging below the power band is weak; the flat band is full power; near redline
 * torque tapers; at/above redline the engine cannot pull the gear any faster.
 */
function gearTorqueMult(rpm: number): number {
  if (rpm >= 1) return 0
  const r = Math.max(0, rpm)
  if (r < BOG_RPM) return BOG_FLOOR + (r / BOG_RPM) * (1 - BOG_FLOOR)
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
): void {
  const dt = dtMs / 1000
  const speedRatio = v.speed / MAX_SPEED

  // ── Gearbox (manual) — shift, optional restart, then derive rpm + torque ──
  if (input.shiftUp && v.gear < GEAR_COUNT) v.gear++
  if (input.shiftDown && v.gear > 1) v.gear--

  // ENTER ignition — restart a stalled engine in a sensible gear.
  if (v.stalled && input.restart) {
    v.stalled = false
    v.stallWarnMs = 0
    v.gear = startableGear(v.speed)
  }

  const gear = GEARS[v.gear - 1]!
  const gearSpan = gear.to - gear.from
  const rpmRaw = gearSpan > 0 ? (v.speed - gear.from) / gearSpan : 0

  // Stall — lugging far below a gear's band kills the engine, but only after a
  // grace period during which an "ENGINE STALLING" warning shows, giving the
  // driver time to downshift. First gear (from = 0) never lugs this low.
  if (v.stalled) {
    v.stallWarnMs = 0
  } else if (rpmRaw < STALL_RPM) {
    v.stallWarnMs += dtMs
    if (v.stallWarnMs >= STALL_GRACE_MS) {
      v.stalled = true
      v.stallWarnMs = 0
    }
  } else {
    v.stallWarnMs = 0
  }
  v.stallWarning = !v.stalled && v.stallWarnMs > 0

  v.rpm = v.stalled ? 0 : Math.max(0, Math.min(1, rpmRaw))
  const torque = v.stalled ? 0 : gearTorqueMult(rpmRaw)

  // ── Longitudinal forces ────────────────────────────────────────────────

  // Engine force (throttle) — torque-scaled, capped at the current gear's top.
  // A stalled engine produces nothing; the truck just freewheels.
  if (!v.stalled && input.throttle && v.fuel > 0 && v.speed < gear.to) {
    v.speed = Math.min(gear.to, v.speed + gear.accel * torque * accelMult * dt)
  }

  // Over-rev engine braking — too low a gear for this speed (e.g. after a
  // downshift) drags speed back down toward the gear's top. Compression, not brake.
  if (!v.stalled && v.speed > gear.to) {
    v.speed = Math.max(gear.to, v.speed - OVERREV_ENGINE_BRAKE * dt)
  }

  // Manual brake — per-surface profile with speed fade and wheel lock
  const bp = SURFACE_BRAKE[surface]
  if (input.brake) {
    const speedFade = 1 - speedRatio * bp.speedFade
    v.speed = Math.max(0, v.speed - bp.decel * speedFade * dt)
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
