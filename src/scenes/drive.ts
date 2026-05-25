import {
  C, beep, flashBorder, isHeld, getAudioContext, playPattern, type Scene,
} from 'zx-kit'

import {
  GAME_HEIGHT, GAME_WIDTH, VIEWPORT_BOTTOM, VIEWPORT_TOP, PERSPECTIVE_K,
  BLINK_MS, SCREECH_COOLDOWN_S, OFFROAD_BEEP_COOLDOWN_S,
  EDGE_WARN_THRESHOLD,
  LOW_FUEL_WARN, LOW_FUEL_CRITICAL,
  LOW_FUEL_BEEP_COOLDOWN_S, LOW_FUEL_CRIT_BEEP_COOLDOWN_S,
  FIRST_TARGET_DIST_M, NEXT_TARGET_RANGE,
  DELIVERY_FUEL_REFILL, DELIVERY_SCORE,
} from '../config.ts'
import {
  createVehicle, tickVehicle, offRoadAmount, MAX_SPEED,
  type Vehicle, type VehicleInput,
} from '../game/vehicle.ts'
import { getSurfaceAt, gripFor, accelFor, isDangerAhead, getCurvatureAt, type Surface } from '../game/road.ts'
import { drawRoad, drawStarField, drawCanisters } from '../render/road3d.ts'
import { drawTruck } from '../render/truck.ts'
import { drawHUD } from '../render/hud.ts'
import { drawTopBar } from '../render/topbar.ts'
import { startEngine, updateEngine, stopEngine } from '../audio/engine.ts'
import { checkCanisterPickup, getVisibleCanisters } from '../game/canisters.ts'

const OFFROAD_TIMEOUT_S = 3.0

function hash(n: number): number {
  let x = (n + 0x9E3779B9) | 0
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B)
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35)
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000
}

export function createDriveScene(
  onGameOver: (stats: { distance: number; elapsedMs: number; reason: 'fuel' | 'offroad'; score: number }) => void,
): Scene {
  const v: Vehicle = createVehicle()
  let elapsedMs = 0
  let score = 0
  let blinkPhase = true
  let blinkAccum = 0
  let engineStarted = false
  let lastScreechAtS = -1
  let lastOffroadBeepS = -1
  let lastFuelBeepS = -1
  let wasOffRoad = false
  let offroadAccumS = 0
  let gameOverFired = false

  // Delivery system
  let targetDist = FIRST_TARGET_DIST_M
  let deliveryCount = 0

  return {
    name: 'drive',

    update(dt) {
      if (gameOverFired) return
      elapsedMs += dt

      if (!engineStarted && getAudioContext() != null) {
        startEngine()
        engineStarted = true
      }

      blinkAccum += dt
      while (blinkAccum >= BLINK_MS) { blinkAccum -= BLINK_MS; blinkPhase = !blinkPhase }

      const input: VehicleInput = {
        throttle:   isHeld('ArrowUp'),
        brake:      isHeld('ArrowDown'),
        steerLeft:  isHeld('ArrowLeft'),
        steerRight: isHeld('ArrowRight'),
      }

      const surface: Surface = getSurfaceAt(v.distance)
      const grip = gripFor(surface)
      const accel = accelFor(surface)
      const curvature = getCurvatureAt(v.distance)
      tickVehicle(v, input, surface, grip, accel, dt, curvature)

      if (engineStarted) updateEngine(v.speed, MAX_SPEED, surface)

      const ctxAudio = getAudioContext()

      // Tire screech on slippery surfaces
      if (ctxAudio && (surface === 'ice' || surface === 'snow') && v.speed > 45 && (input.steerLeft || input.steerRight)) {
        const now = ctxAudio.currentTime
        if (now - lastScreechAtS > SCREECH_COOLDOWN_S) {
          beep(160 + Math.random() * 60, 60, now)
          lastScreechAtS = now
        }
      }

      // Off-road penalties
      const offRoad = offRoadAmount(v)
      const atEdge = Math.abs(v.x) > EDGE_WARN_THRESHOLD && offRoad === 0

      if (offRoad > 0) offroadAccumS += dt / 1000
      else offroadAccumS = 0

      if (ctxAudio && v.speed > 10) {
        const now = ctxAudio.currentTime
        if (offRoad > 0) {
          if (now - lastOffroadBeepS > OFFROAD_BEEP_COOLDOWN_S) {
            beep(80 + offRoad * 40, 100, now)
            lastOffroadBeepS = now
          }
          if (!wasOffRoad) flashBorder(C.B_RED, 2, 120)
        } else if (atEdge) {
          if (now - lastOffroadBeepS > 0.5) {
            beep(200, 30, now)
            lastOffroadBeepS = now
          }
        }
      }
      wasOffRoad = offRoad > 0

      // Low-fuel warning
      if (ctxAudio && v.fuel > 0) {
        const now = ctxAudio.currentTime
        if (v.fuel < LOW_FUEL_CRITICAL) {
          if (now - lastFuelBeepS > LOW_FUEL_CRIT_BEEP_COOLDOWN_S) {
            beep(300, 40, now)
            beep(200, 40, now + 0.05)
            lastFuelBeepS = now
          }
        } else if (v.fuel < LOW_FUEL_WARN) {
          if (now - lastFuelBeepS > LOW_FUEL_BEEP_COOLDOWN_S) {
            beep(260, 60, now)
            lastFuelBeepS = now
          }
        }
      }

      // Fuel canister pickup
      const fuelGained = checkCanisterPickup(v.distance, v.x)
      if (fuelGained > 0) {
        v.fuel = Math.min(1, v.fuel + fuelGained)
        if (ctxAudio) beep(880, 40, ctxAudio.currentTime)
        flashBorder(C.B_YELLOW, 1, 100)
      }

      // Delivery check
      if (v.distance >= targetDist) {
        deliveryCount++
        score += DELIVERY_SCORE
        v.fuel = Math.min(1, v.fuel + DELIVERY_FUEL_REFILL)
        // Celebration jingle
        if (ctxAudio) {
          playPattern([
            { freq: 523, dur: 80 }, { freq: 0, dur: 20 },
            { freq: 659, dur: 80 }, { freq: 0, dur: 20 },
            { freq: 784, dur: 120 },
          ])
        }
        flashBorder(C.B_GREEN, 3, 150)
        // Next target
        const [minD, maxD] = NEXT_TARGET_RANGE
        targetDist = v.distance + minD + (maxD - minD) * hash(deliveryCount * 71)
      }

      // Game over
      if (v.fuel <= 0 && v.speed < 1) triggerGameOver('fuel')
      else if (offroadAccumS > OFFROAD_TIMEOUT_S) triggerGameOver('offroad')

      function triggerGameOver(reason: 'fuel' | 'offroad') {
        gameOverFired = true
        stopEngine()
        onGameOver({ distance: v.distance, elapsedMs, reason, score })
      }
    },

    render(ctx) {
      ctx.fillStyle = C.BLACK
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)

      const fuelWarn = v.fuel < LOW_FUEL_WARN
      const fuelCrit = v.fuel < LOW_FUEL_CRITICAL

      drawTopBar(ctx, {
        distance: v.distance, score, elapsedMs,
        dangerAhead: isDangerAhead(v.distance), iceAheadBlink: blinkPhase,
        lowFuel: fuelWarn,
        lowFuelBlink: fuelCrit ? blinkPhase : (fuelWarn && !blinkPhase),
      })

      drawStarField(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM)
      drawRoad(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, v.distance, v.x,
        (d) => getSurfaceAt(d), (d) => getCurvatureAt(d))

      // Fuel canisters (draw before truck so truck renders on top)
      const visible = getVisibleCanisters(v.distance, PERSPECTIVE_K)
      drawCanisters(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, v.distance, v.x, visible,
        (d) => getCurvatureAt(d))

      const truckX = GAME_WIDTH / 2 + v.x * 50
      drawTruck(ctx, truckX, VIEWPORT_BOTTOM - 2, -v.vx * 1.5)

      const currentGrip = gripFor(getSurfaceAt(v.distance))
      drawHUD(ctx, {
        speed: v.speed,
        fuelPct: v.fuel,
        gripPct: currentGrip,
        missionText: 'DELIVER',
        missionDist: Math.max(0, (targetDist - v.distance) / 1000),
      })
    },
  }
}
