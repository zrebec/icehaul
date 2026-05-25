import {
  MAX_SPEED, ACCEL, BRAKE_DECEL,
  ICE_GRIP, CURVE_DRIFT,
  STEER_ACCEL, STEER_DAMP, MAX_LATERAL_V,
  ROAD_EDGE, OFF_ROAD_DRAG, OFF_ROAD_RETURN,
} from '../config.ts'

export { MAX_SPEED, ICE_GRIP }

export interface Vehicle {
  x: number
  vx: number
  speed: number
  distance: number
}

export interface VehicleInput {
  throttle: boolean
  brake: boolean
  steerLeft: boolean
  steerRight: boolean
}

export function createVehicle(): Vehicle {
  return { x: 0, vx: 0, speed: 0, distance: 0 }
}

export function offRoadAmount(v: Vehicle): number {
  return Math.max(0, Math.abs(v.x) - ROAD_EDGE)
}

export function tickVehicle(
  v: Vehicle,
  input: VehicleInput,
  grip: number,
  dtMs: number,
  curvature = 0,
): void {
  const dt = dtMs / 1000

  if (input.throttle) v.speed = Math.min(MAX_SPEED, v.speed + ACCEL * dt)
  if (input.brake)    v.speed = Math.max(0, v.speed - BRAKE_DECEL * dt)

  const offRoad = offRoadAmount(v)
  if (offRoad > 0) {
    v.speed = Math.max(0, v.speed - OFF_ROAD_DRAG * offRoad * dt)
    const pushDir = v.x > 0 ? -1 : 1
    v.vx += pushDir * OFF_ROAD_RETURN * offRoad * dt
  }

  if (curvature !== 0 && v.speed > 5) {
    v.vx += -curvature * v.speed * CURVE_DRIFT * (1 - grip * 0.7) * dt
  }

  if (input.steerLeft)  v.vx -= STEER_ACCEL * grip * dt
  if (input.steerRight) v.vx += STEER_ACCEL * grip * dt
  if (!input.steerLeft && !input.steerRight) {
    v.vx *= 1 - Math.min(1, STEER_DAMP * grip * dt)
  }
  v.vx = Math.max(-MAX_LATERAL_V, Math.min(MAX_LATERAL_V, v.vx))

  v.x += v.vx * (0.35 + v.speed / 220) * dt
  v.x = Math.max(-2.0, Math.min(2.0, v.x))

  v.distance += (v.speed / 3.6) * dt
}
