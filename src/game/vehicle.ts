import {
  MAX_SPEED, ACCEL, BRAKE_DECEL,
  AERO_DRAG, CURVE_DRIFT,
  STEER_ACCEL, STEER_DAMP, MAX_LATERAL_V,
  SPEED_STEER_PENALTY, SPEED_SKID_PENALTY,
  ROAD_EDGE, OFF_ROAD_DRAG, OFF_ROAD_RETURN,
  SKID_THRESHOLD, SKID_AMPLIFY,
  FUEL_BURN_RATE, FUEL_IDLE_THRESHOLD,
  SURFACE_DRAG, SURFACE_BRAKE_MULT,
  SURFACE_SKID_ENABLED, SURFACE_STEER_DAMP_MULT,
  SURFACE_FUEL_MULT,
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
  const speedRatio = v.speed / MAX_SPEED  // 0..1

  // ── Forward speed ──────────────────────────────────────────────────────
  if (input.throttle && v.fuel > 0) v.speed = Math.min(MAX_SPEED, v.speed + ACCEL * accelMult * dt)
  if (input.brake) v.speed = Math.max(0, v.speed - BRAKE_DECEL * SURFACE_BRAKE_MULT[surface] * dt)

  // Surface drag (proportional to speed — sand/mud/snow)
  const surfDrag = SURFACE_DRAG[surface]
  if (surfDrag > 0 && v.speed > 0) {
    v.speed = Math.max(0, v.speed - surfDrag * speedRatio * dt)
  }

  // Aerodynamic drag (ALL surfaces, proportional to speed²)
  // At 80 km/h: 3.5 × (80/120)² ≈ 1.56 km/h/s
  if (v.speed > 0) {
    v.speed = Math.max(0, v.speed - AERO_DRAG * speedRatio * speedRatio * dt)
  }

  // Empty tank coast-down
  if (v.fuel <= 0 && v.speed > 0) {
    v.speed = Math.max(0, v.speed - 8 * dt)
  }

  // Off-road penalty
  const offRoad = offRoadAmount(v)
  if (offRoad > 0) {
    v.speed = Math.max(0, v.speed - OFF_ROAD_DRAG * offRoad * dt)
    v.vx += (v.x > 0 ? -1 : 1) * OFF_ROAD_RETURN * offRoad * dt
  }

  // ── Lateral physics ────────────────────────────────────────────────────

  // Centrifugal drift from curvature
  if (curvature !== 0 && v.speed > 5) {
    v.vx += -curvature * v.speed * CURVE_DRIFT * (1 - grip * 0.7) * dt
  }

  // Steering — effectiveness DECREASES with speed (more inertia at high speed)
  const speedSteerFactor = 1 - speedRatio * SPEED_STEER_PENALTY
  if (input.steerLeft)  v.vx -= STEER_ACCEL * grip * speedSteerFactor * dt
  if (input.steerRight) v.vx += STEER_ACCEL * grip * speedSteerFactor * dt
  if (!input.steerLeft && !input.steerRight) {
    const dampMult = SURFACE_STEER_DAMP_MULT[surface]
    v.vx *= 1 - Math.min(1, STEER_DAMP * grip * dampMult * dt)
  }

  // Skid — threshold DECREASES with speed (easier to skid when fast)
  if (SURFACE_SKID_ENABLED[surface]) {
    const effectiveThreshold = SKID_THRESHOLD * (1 - speedRatio * SPEED_SKID_PENALTY)
    if (Math.abs(v.vx) > effectiveThreshold) {
      const excess = Math.abs(v.vx) - effectiveThreshold
      v.vx += Math.sign(v.vx) * excess * SKID_AMPLIFY * (1 - grip) * dt
    }
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
