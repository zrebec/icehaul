import {
  MAX_SPEED, ACCEL, BRAKE_DECEL,
  CURVE_DRIFT,
  STEER_ACCEL, STEER_DAMP, MAX_LATERAL_V,
  ROAD_EDGE, OFF_ROAD_DRAG, OFF_ROAD_RETURN,
  SKID_THRESHOLD, SKID_AMPLIFY,
  FUEL_BURN_RATE, FUEL_IDLE_THRESHOLD,
  SURFACE_DRAG, SURFACE_BRAKE_MULT,
  SURFACE_SKID_ENABLED, SURFACE_STEER_DAMP_MULT,
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

  // Forward — accelMult varies by surface
  if (input.throttle && v.fuel > 0) v.speed = Math.min(MAX_SPEED, v.speed + ACCEL * accelMult * dt)
  // Brake — effectiveness varies by surface (ice: weak brakes)
  if (input.brake) v.speed = Math.max(0, v.speed - BRAKE_DECEL * SURFACE_BRAKE_MULT[surface] * dt)

  // Passive surface drag — proportional to speed so you can always start moving.
  // At 0 km/h drag is 0; at MAX_SPEED drag reaches full SURFACE_DRAG value.
  // Creates a natural equilibrium speed per surface (sand ≈ 50 km/h, mud ≈ higher).
  const drag = SURFACE_DRAG[surface]
  if (drag > 0 && v.speed > 0) {
    v.speed = Math.max(0, v.speed - drag * (v.speed / MAX_SPEED) * dt)
  }

  // Off-road penalty
  const offRoad = offRoadAmount(v)
  if (offRoad > 0) {
    v.speed = Math.max(0, v.speed - OFF_ROAD_DRAG * offRoad * dt)
    v.vx += (v.x > 0 ? -1 : 1) * OFF_ROAD_RETURN * offRoad * dt
  }

  // Centrifugal drift from curvature
  if (curvature !== 0 && v.speed > 5) {
    v.vx += -curvature * v.speed * CURVE_DRIFT * (1 - grip * 0.7) * dt
  }

  // Steering — with per-surface damping multiplier (sand: extra heavy)
  if (input.steerLeft)  v.vx -= STEER_ACCEL * grip * dt
  if (input.steerRight) v.vx += STEER_ACCEL * grip * dt
  if (!input.steerLeft && !input.steerRight) {
    const dampMult = SURFACE_STEER_DAMP_MULT[surface]
    v.vx *= 1 - Math.min(1, STEER_DAMP * grip * dampMult * dt)
  }

  // Skid: only on surfaces where skid is enabled (not sand — sand is resistance, not slip)
  if (SURFACE_SKID_ENABLED[surface] && Math.abs(v.vx) > SKID_THRESHOLD) {
    const excess = Math.abs(v.vx) - SKID_THRESHOLD
    v.vx += Math.sign(v.vx) * excess * SKID_AMPLIFY * (1 - grip) * dt
  }

  v.vx = Math.max(-MAX_LATERAL_V, Math.min(MAX_LATERAL_V, v.vx))

  v.x += v.vx * (0.35 + v.speed / 220) * dt
  v.x = Math.max(-2.0, Math.min(2.0, v.x))

  v.distance += (v.speed / 3.6) * dt

  if (v.speed > FUEL_IDLE_THRESHOLD && v.fuel > 0) {
    v.fuel = Math.max(0, v.fuel - v.speed * FUEL_BURN_RATE * dt)
  }
}
