import {
  C, beep, flashBorder, isHeld, getAudioContext, type Scene,
} from 'zx-kit'

import {
  GAME_HEIGHT, GAME_WIDTH, VIEWPORT_BOTTOM, VIEWPORT_TOP,
  BLINK_MS, SCREECH_COOLDOWN_S, OFFROAD_BEEP_COOLDOWN_S,
  EDGE_WARN_THRESHOLD, ROAD_EDGE,
} from '../config.ts'
import {
  createVehicle, tickVehicle, offRoadAmount, MAX_SPEED,
  type Vehicle, type VehicleInput,
} from '../game/vehicle.ts'
import { getSurfaceAt, gripFor, isIceAhead, getCurvatureAt, type Surface } from '../game/road.ts'
import { drawRoad, drawStarField } from '../render/road3d.ts'
import { drawTruck } from '../render/truck.ts'
import { drawHUD } from '../render/hud.ts'
import { drawTopBar } from '../render/topbar.ts'
import { startEngine, setEngineRPM } from '../audio/engine.ts'

export function createDriveScene(): Scene {
  const v: Vehicle = createVehicle()
  let elapsedMs = 0
  let blinkPhase = true
  let blinkAccum = 0
  let engineStarted = false
  let lastScreechAtS = -1
  let lastOffroadBeepS = -1
  let wasOffRoad = false

  return {
    name: 'drive',

    update(dt) {
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
      const curvature = getCurvatureAt(v.distance)
      tickVehicle(v, input, grip, dt, curvature)

      if (engineStarted) setEngineRPM(v.speed, MAX_SPEED)

      // Tire screech on ice
      const ctxAudio = getAudioContext()
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
    },

    render(ctx) {
      ctx.fillStyle = C.BLACK
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)

      drawTopBar(ctx, {
        distance: v.distance, score: 0, elapsedMs,
        iceAhead: isIceAhead(v.distance), iceAheadBlink: blinkPhase,
      })

      drawStarField(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM)
      drawRoad(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, v.distance, v.x,
        (d) => getSurfaceAt(d), (d) => getCurvatureAt(d))

      // Player truck — fixed near bottom of viewport, shifts with player.x
      const truckX = GAME_WIDTH / 2 + v.x * 50
      drawTruck(ctx, truckX, VIEWPORT_BOTTOM - 2, -v.vx * 1.5)

      drawHUD(ctx, { speed: v.speed })
    },
  }
}
