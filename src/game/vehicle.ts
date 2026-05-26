/**
 * Vehicle physics — based on Marco Monster's "Car Physics for Games" model,
 * adapted for pseudo-3D (1 axis lateral + forward speed).
 *
 * Key forces (longitudinal):
 *   F_engine    = ACCEL × surface_mult          (throttle)
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
  MAX_SPEED, ACCEL,
  AERO_DRAG, ROLLING_RESISTANCE, ENGINE_BRAKE,
  CURVE_DRIFT,
  STEER_ACCEL, STEER_DAMP, MAX_LATERAL_V,
  SPEED_STEER_PENALTY,
  ROAD_EDGE, OFF_ROAD_DRAG, OFF_ROAD_RETURN,
  FUEL_BURN_RATE, FUEL_IDLE_THRESHOLD,
  SURFACE_DRAG, SURFACE_BRAKE,
  SURFACE_STEER_DAMP_MULT, SURFACE_FUEL_MULT,
  SURFACE_SLIP_PEAK,
  type Surface,
} from '../config.ts'

export { MAX_SPEED }

export interface Vehicle {
  x: number
  vx: number
  speed: number
  distance: number
  fuel: number
}

export interface VehicleInput {
  throttle: boolean
  brake: boolean
  steerLeft: boolean
  steerRight: boolean
}

export function createVehicle(): Vehicle {
  return { x: 0, vx: 0, speed: 0, distance: 0, fuel: 1.0 }
}

export function offRoadAmount(v: Vehicle): number {
  return Math.max(0, Math.abs(v.x) - ROAD_EDGE)
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
): void {
  const dt = dtMs / 1000
  const speedRatio = v.speed / MAX_SPEED

  // ── Longitudinal forces ────────────────────────────────────────────────

  // Engine force (throttle)
  if (input.throttle && v.fuel > 0) {
    v.speed = Math.min(MAX_SPEED, v.speed + ACCEL * accelMult * dt)
  }

  // Manual brake — per-surface profile with speed fade and wheel lock
  const bp = SURFACE_BRAKE[surface]
  if (input.brake) {
    const speedFade = 1 - speedRatio * bp.speedFade
    v.speed = Math.max(0, v.speed - bp.decel * speedFade * dt)
  }

  // Engine braking (throttle released, engine compression resists motion)
  if (!input.throttle && !input.brake && v.fuel > 0 && v.speed > 0) {
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

  // Off-road drag
  const offRoad = offRoadAmount(v)
  if (offRoad > 0) {
    v.speed = Math.max(0, v.speed - OFF_ROAD_DRAG * offRoad * dt)
    v.vx += (v.x > 0 ? -1 : 1) * OFF_ROAD_RETURN * offRoad * dt
  }

  // ── Lateral forces (slip angle model) ──────────────────────────────────

  // Grip multiplier from slip curve (replaces binary skid threshold)
  const slipPeak = SURFACE_SLIP_PEAK[surface]
  const gripMult = slipGripMult(v.vx, slipPeak)

  // Effective grip — reduced when braking (locked wheels = less lateral control).
  // Worse when speed exceeds lockSpeed (wheels actually lock on that surface).
  let effectiveGrip = grip * gripMult
  if (input.brake) {
    let brakeLateralLoss = bp.lateralLoss
    if (v.speed > bp.lockSpeed) {
      // Wheels locked: lateral loss intensifies proportionally to excess speed
      const lockExcess = (v.speed - bp.lockSpeed) / (MAX_SPEED - bp.lockSpeed)
      brakeLateralLoss = Math.min(0.9, bp.lateralLoss + lockExcess * 0.4)
    }
    effectiveGrip *= (1 - brakeLateralLoss)
  }

  // Centrifugal drift from road curvature
  if (curvature !== 0 && v.speed > 5) {
    v.vx += -curvature * v.speed * CURVE_DRIFT * (1 - grip * 0.7) * dt
  }

  // Steering — weakens with speed AND with slip (past peak = less control)
  const speedSteerFactor = 1 - speedRatio * SPEED_STEER_PENALTY
  if (input.steerLeft)  v.vx -= STEER_ACCEL * effectiveGrip * speedSteerFactor * dt
  if (input.steerRight) v.vx += STEER_ACCEL * effectiveGrip * speedSteerFactor * dt

  // Damping — also weakened by slip (past peak = drift persists)
  if (!input.steerLeft && !input.steerRight) {
    const dampMult = SURFACE_STEER_DAMP_MULT[surface]
    v.vx *= 1 - Math.min(1, STEER_DAMP * effectiveGrip * dampMult * dt)
  }

  v.vx = Math.max(-MAX_LATERAL_V, Math.min(MAX_LATERAL_V, v.vx))
  v.x += v.vx * (0.35 + v.speed / 220) * dt
  v.x = Math.max(-2.0, Math.min(2.0, v.x))

  // ── Distance + fuel ────────────────────────────────────────────────────

  v.distance += (v.speed / 3.6) * dt

  if (v.speed > FUEL_IDLE_THRESHOLD && v.fuel > 0) {
    const speedFactor = v.speed * (v.speed / MAX_SPEED)
    v.fuel = Math.max(0, v.fuel - speedFactor * FUEL_BURN_RATE * SURFACE_FUEL_MULT[surface] * dt)
  }
}
