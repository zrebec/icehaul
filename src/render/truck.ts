import type { GlowSource } from 'zx-kit'
import {
  PLAYER_TRUCK_H,
  PLAYER_TRUCK_LAMP_COLORS,
  PLAYER_TRUCK_STRAIGHT_COLLISION,
  PLAYER_TRUCK_W,
  drawPlayerTruck,
  getPlayerTruckCollisionBitmap,
  getPlayerTruckLampPositions,
  getPlayerTruckRoadMask,
  pushPlayerTruckLampSpots,
  type PlayerTruckArticulation,
  type PlayerTruckPoint,
} from './sprites/playerTruck.ts'

/**
 * Compatibility facade for renderer/debug consumers that still use the old
 * three-position truck API. The real game scene owns a continuous articulation
 * state and imports `sprites/playerTruck.ts` directly.
 */

export const TRUCK_BMP_W = PLAYER_TRUCK_W
export const TRUCK_BMP_H = PLAYER_TRUCK_H

const DISCRETE_STATES: Readonly<Record<-1 | 0 | 1, Readonly<PlayerTruckArticulation>>> = {
  [-1]: { cabYaw: -1, trailerYaw: -1, cabAngle: -2, trailerAngle: -2 },
  [0]: { cabYaw: 0, trailerYaw: 0, cabAngle: 0, trailerAngle: 0 },
  [1]: { cabYaw: 1, trailerYaw: 1, cabAngle: 2, trailerAngle: 2 },
}

export const TRUCK_COLLISION_BMP = PLAYER_TRUCK_STRAIGHT_COLLISION
export const TRUCK_ROAD_MASK = getPlayerTruckRoadMask(DISCRETE_STATES[0])
export const TRUCK_BMP_DATA = TRUCK_COLLISION_BMP.data
export const TRUCK_BMP_LEFT_DATA = getPlayerTruckCollisionBitmap(DISCRETE_STATES[-1]).data
export const TRUCK_BMP_RIGHT_DATA = getPlayerTruckCollisionBitmap(DISCRETE_STATES[1]).data

export type TruckLamp = PlayerTruckPoint
export const TRUCK_LAMP_COLORS = PLAYER_TRUCK_LAMP_COLORS
export const TRUCK_LAMPS = {
  left: getPlayerTruckLampPositions(DISCRETE_STATES[-1]),
  straight: getPlayerTruckLampPositions(DISCRETE_STATES[0]),
  right: getPlayerTruckLampPositions(DISCRETE_STATES[1]),
} as const

export function pushTruckLampSpots(
  out: GlowSource[],
  cx: number,
  baseY: number,
  lean: number,
  steerDir: -1 | 0 | 1,
  braking: boolean,
): void {
  pushPlayerTruckLampSpots(out, cx, baseY, DISCRETE_STATES[steerDir], braking, lean)
}

export function drawTruck(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  lean = 0,
  steerDir: -1 | 0 | 1 = 0,
  braking = false,
): void {
  drawPlayerTruck(ctx, cx, baseY, DISCRETE_STATES[steerDir], braking, lean)
}
