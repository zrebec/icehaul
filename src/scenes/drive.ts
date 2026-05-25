import {
  C, beep, flashBorder, isHeld, getAudioContext, type Scene,
} from 'zx-kit'

import {
  GAME_HEIGHT, GAME_WIDTH, VIEWPORT_BOTTOM, VIEWPORT_TOP,
  BLINK_MS, SCREECH_COOLDOWN_S, OFFROAD_BEEP_COOLDOWN_S,
  EDGE_WARN_THRESHOLD,
} from '../config.ts'
import {
  createVehicle, tickVehicle, offRoadAmount, MAX_SPEED,
  type Vehicle, type VehicleInput,
} from '../game/vehicle.ts'
import { getSurfaceAt, gripFor, accelFor, isDangerAhead, getCurvatureAt, type Surface } from '../game/road.ts'
import { drawRoad, drawStarField } from '../render/road3d.ts'
import { drawTruck } from '../render/truck.ts'
import { drawHUD } from '../render/hud.ts'
import { drawTopBar } from '../render/topbar.ts'
import { startEngine, setEngineRPM, stopEngine } from '../audio/engine.ts'

/** Seconds of continuous off-road before forced game over. */
const OFFROAD_TIMEOUT_S = 3.0

export function createDriveScene(
  onGameOver: (stats: { distance: number; elapsedMs: number; reason: 'fuel' | 'offroad' }) => void,
): Scene {
  const v: Vehicle = createVehicle()
  let elapsedMs = 0
  let blinkPhase = true
  let blinkAccum = 0
  let engineStarted = false
  let lastScreechAtS = -1
  let lastOffroadBeepS = -1
  let wasOffRoad = false
  let offroadAccumS = 0
  let gameOverFired = false

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
      tickVehicle(v, input, grip, accel, dt, curvature)

      if (engineStarted) setEngineRPM(v.speed, MAX_SPEED)

      const ctxAudio = getAudioContext()

      // Tire screech on ice
      if (ctxAudio && surface === 'ice' && v.speed > 45 && (input.steerLeft || input.steerRight)) {
        const now = ctxAudio.currentTime
        if (now - lastScreechAtS > SCREECH_COOLDOWN_S) {
          beep(160 + Math.random() * 60, 60, now)
          lastScreechAtS = now
        }
      }

      // Off-road + edge warning
      const offRoad = offRoadAmount(v)
      const atEdge = Math.abs(v.x) > EDGE_WARN_THRESHOLD && offRoad === 0

      if (offRoad > 0) {
        offroadAccumS += dt / 1000
      } else {
        offroadAccumS = 0
      }

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

      // Game over conditions
      if (v.fuel <= 0 && v.speed < 1) {
        triggerGameOver('fuel')
      } else if (offroadAccumS > OFFROAD_TIMEOUT_S) {
        triggerGameOver('offroad')
      }

      function triggerGameOver(reason: 'fuel' | 'offroad') {
        gameOverFired = true
        stopEngine()
        onGameOver({ distance: v.distance, elapsedMs, reason })
      }
    },

    render(ctx) {
      ctx.fillStyle = C.BLACK
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)

      drawTopBar(ctx, {
        distance: v.distance, score: 0, elapsedMs,
        dangerAhead: isDangerAhead(v.distance), iceAheadBlink: blinkPhase,
      })

      drawStarField(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM)
      drawRoad(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, v.distance, v.x,
        (d) => getSurfaceAt(d), (d) => getCurvatureAt(d))

      const truckX = GAME_WIDTH / 2 + v.x * 50
      drawTruck(ctx, truckX, VIEWPORT_BOTTOM - 2, -v.vx * 1.5)

      const currentGrip = gripFor(getSurfaceAt(v.distance))
      drawHUD(ctx, {
        speed: v.speed,
        fuelPct: v.fuel,
        gripPct: currentGrip,
      })
    },
  }
}
