import {
  MAX_SPEED, ACCEL, BRAKE_DECEL,
  CURVE_DRIFT,
  STEER_ACCEL, STEER_DAMP, MAX_LATERAL_V,
  ROAD_EDGE, OFF_ROAD_DRAG, OFF_ROAD_RETURN,
  SKID_THRESHOLD, SKID_AMPLIFY,
  FUEL_BURN_RATE, FUEL_IDLE_THRESHOLD,
} from '../config.ts'

export { MAX_SPEED }

export interface Vehicle {
  x: number
  vx: number
  speed: number
  distance: number
  /** Fuel level 0..1. Drains with speed. 0 = empty → game over. */
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
  grip: number,
  accelMult: number,
  dtMs: number,
  curvature = 0,
): void {
  const dt = dtMs / 1000

  // Forward — accelMult varies by surface (ice=fast, sand=very slow)
  if (input.throttle && v.fuel > 0) v.speed = Math.min(MAX_SPEED, v.speed + ACCEL * accelMult * dt)
  if (input.brake) v.speed = Math.max(0, v.speed - BRAKE_DECEL * dt)

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

  // Steering
  if (input.steerLeft)  v.vx -= STEER_ACCEL * grip * dt
  if (input.steerRight) v.vx += STEER_ACCEL * grip * dt
  if (!input.steerLeft && !input.steerRight) {
    v.vx *= 1 - Math.min(1, STEER_DAMP * grip * dt)
  }

  // Skid: on low-grip surfaces, once |vx| exceeds threshold, drift amplifies itself.
  // This makes HOLDING the steering key on ice → oversteer → skid → crash.
  // TAPPING keeps vx below threshold → controlled corrections.
  if (grip < 1 && Math.abs(v.vx) > SKID_THRESHOLD) {
    const excess = Math.abs(v.vx) - SKID_THRESHOLD
    const amplify = excess * SKID_AMPLIFY * (1 - grip)
    v.vx += Math.sign(v.vx) * amplify * dt
  }

  v.vx = Math.max(-MAX_LATERAL_V, Math.min(MAX_LATERAL_V, v.vx))

  v.x += v.vx * (0.35 + v.speed / 220) * dt
  v.x = Math.max(-2.0, Math.min(2.0, v.x))

  v.distance += (v.speed / 3.6) * dt

  // Fuel burn — proportional to speed
  if (v.speed > FUEL_IDLE_THRESHOLD && v.fuel > 0) {
    v.fuel = Math.max(0, v.fuel - v.speed * FUEL_BURN_RATE * dt)
  }
}
