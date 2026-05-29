import {
  C, beep, flashBorder, isHeld, getAudioContext, consumePause,
  playPattern, drawTextCentered,
  createParticleSystem, emitParticles, tickParticles, renderParticles,
  type ParticleSystem, type Scene, type SpectrumColor,
} from 'zx-kit'

import {
  GAME_HEIGHT, GAME_WIDTH, VIEWPORT_BOTTOM, VIEWPORT_TOP, PERSPECTIVE_K,
  COLS, BLINK_MS, SCREECH_COOLDOWN_S, OFFROAD_BEEP_COOLDOWN_S,
  EDGE_MARGIN_WARN_PX,
  LOW_FUEL_WARN, LOW_FUEL_CRITICAL,
  LOW_FUEL_BEEP_COOLDOWN_S, LOW_FUEL_CRIT_BEEP_COOLDOWN_S,
  FIRST_TARGET_DIST_M, NEXT_TARGET_RANGE,
  DELIVERY_FUEL_REFILL, DELIVERY_SCORE, DELIVERY_TIME_LIMIT_MS,
  OFFROAD_CRASH_SEVERITY, OFFROAD_TIMEOUT_S, CRASH_ANIM_MS,
  TRAFFIC_COLLISION_DEPTH_M,
} from '../config.ts'
import {
  createVehicle, tickVehicle, MAX_SPEED,
  type Vehicle, type VehicleInput,
} from '../game/vehicle.ts'
import { getSurfaceAt, gripFor, accelFor, isDangerAhead, getCurvatureAt, resetRoad, type Surface } from '../game/road.ts'
import {
  drawRoad, drawStarField, drawCanisters, drawRoadsideObjects, drawTraffic,
  getTrafficSpriteRows, projectTrafficVehicle,
} from '../render/road3d.ts'
import { drawTruck } from '../render/truck.ts'
import { drawHUD } from '../render/hud.ts'
import { drawTopBar } from '../render/topbar.ts'
import { startEngine, updateEngine, stopEngine, muteEngine, unmuteEngine } from '../audio/engine.ts'
import { checkCanisterPickup, getVisibleCanisters, resetCanisters } from '../game/canisters.ts'
import { getRoadsideObjects } from '../game/roadside.ts'
import { tickTraffic, getVisibleTraffic, resetTraffic } from '../game/traffic.ts'
import { computeRoadEdges } from '../game/roadgeometry.ts'
import { checkTruckOffroad, checkTruckTrafficCollision, type OffroadResult } from '../game/offroad.ts'

function hash(n: number): number {
  let x = (n + 0x9E3779B9) | 0
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B)
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35)
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000
}

function emitWheelSpray(
  particles: ParticleSystem,
  truckDrawX: number,
  truckDrawY: number,
  lateralV: number,
  count: number,
  color: readonly SpectrumColor[],
  speed: readonly [number, number],
  life: readonly [number, number],
  size = 1,
): void {
  if (count <= 0) return

  const sideBias = Math.max(-0.45, Math.min(0.45, lateralV * 0.22))
  const leftCount = Math.ceil(count / 2)
  const rightCount = count - leftCount
  const wheels = [
    { x: truckDrawX + 4, count: leftCount, angle: -Math.PI * 0.78 + sideBias },
    { x: truckDrawX + 20, count: rightCount, angle: -Math.PI * 0.22 + sideBias },
  ] as const

  for (const wheel of wheels) {
    const wheelCount = wheel.count
    if (wheelCount <= 0) continue
    emitParticles(particles, {
      x: wheel.x,
      y: truckDrawY + 27,
      count: wheelCount,
      color,
      speed,
      angle: wheel.angle,
      spread: Math.PI * 0.7,
      life,
      size,
    })
  }
}

type DriveState = 'waiting' | 'playing' | 'paused' | 'crashing'

export function createDriveScene(
  onGameOver: (stats: { distance: number; elapsedMs: number; reason: 'fuel' | 'offroad' | 'timeout' | 'crash'; score: number }) => void,
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
  const surfaceParticles = createParticleSystem(420)
  let snowSprayAccum = 0
  let skidSprayAccum = 0

  let lastOffroad: OffroadResult = {
    offRoadPixels: 0, totalPixels: 1, severity: 0,
    leftOff: 0, rightOff: 0, marginLeft: Infinity, marginRight: Infinity,
  }
  let crashTimerMs = 0
  let crashReason: 'offroad' | 'crash' | null = null
  // Seed all generators — every game is unique
  const gameSeed = Date.now()
  resetRoad(gameSeed)
  resetTraffic(gameSeed + 1)
  resetCanisters(gameSeed + 2)

  let driveState: DriveState = 'waiting'
  let startKeyPending = false

  // Only Enter or S starts the game — not Command, not any random key
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (driveState === 'waiting') {
      if (e.key === 'Enter' || e.key === 's' || e.key === 'S') {
        startKeyPending = true
      }
    }
  })

  let targetDist = FIRST_TARGET_DIST_M
  let deliveryCount = 0
  let missionTimerMs = DELIVERY_TIME_LIMIT_MS

  return {
    name: 'drive',

    update(dt) {
      // Blink always ticks (for PRESS ENTER / PAUSED overlay)
      blinkAccum += dt
      while (blinkAccum >= BLINK_MS) { blinkAccum -= BLINK_MS; blinkPhase = !blinkPhase }

      // ── Waiting state: only Enter / S starts the game ──
      if (driveState === 'waiting') {
        if (startKeyPending) {
          startKeyPending = false
          driveState = 'playing'
          if (!engineStarted && getAudioContext() != null) {
            startEngine()
            engineStarted = true
          }
        }
        return
      }

      // ── Paused state: only P unpauses ──
      if (driveState === 'paused') {
        if (consumePause()) { driveState = 'playing'; unmuteEngine() }
        return
      }

      // ── Crashing state: slide + shake until animation ends ──
      if (driveState === 'crashing') {
        if (gameOverFired) return
        crashTimerMs += dt
        tickParticles(surfaceParticles, dt, 0.00025)
        v.speed = Math.max(0, v.speed - v.speed * 3 * (dt / 1000))
        v.x += v.vx * (dt / 1000) * 0.3
        v.vx *= 0.95
        if (crashTimerMs >= CRASH_ANIM_MS) {
          triggerGameOver(crashReason ?? 'crash')
        }
        return
      }

      // ── Playing state: check for pause ──
      if (consumePause()) {
        driveState = 'paused'
        muteEngine()
        return
      }

      if (gameOverFired) return
      elapsedMs += dt

      if (!engineStarted && getAudioContext() != null) {
        startEngine()
        engineStarted = true
      }

      // ── Pixel-perfect off-road detection (before physics tick) ──
      const truckScreenX = GAME_WIDTH / 2 + v.x * 50
      const truckDrawX = Math.round(truckScreenX - 12 + (-v.vx * 1.5))
      const truckDrawY = Math.round(VIEWPORT_BOTTOM - 2 - 32)
      const edgesLookup = computeRoadEdges(v.distance, v.x, (d) => getCurvatureAt(d))
      lastOffroad = checkTruckOffroad(truckDrawX, truckDrawY, edgesLookup)

      let offroadReturnDir = 0
      if (lastOffroad.severity > 0) {
        offroadReturnDir = lastOffroad.rightOff > lastOffroad.leftOff ? -1 : 1
      }

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
      tickVehicle(v, input, surface, grip, accel, dt, curvature,
        lastOffroad.severity, offroadReturnDir)
      tickParticles(surfaceParticles, dt, 0.00022)

      if (engineStarted) updateEngine(v.speed, MAX_SPEED, surface, input.brake)

      const ctxAudio = getAudioContext()

      // Traffic — move vehicles, then visual screen-space collision.
      tickTraffic(v.distance, v.x, v.speed, dt)

      for (const tv of getVisibleTraffic(v.distance, TRAFFIC_COLLISION_DEPTH_M)) {
        const projected = projectTrafficVehicle(
          VIEWPORT_TOP, VIEWPORT_BOTTOM, v.distance, v.x, tv,
          (d) => getCurvatureAt(d),
        )
        if (!projected) continue

        if (checkTruckTrafficCollision(
          truckDrawX, truckDrawY,
          projected.left, projected.top, projected.w, projected.h,
          getTrafficSpriteRows(tv.dir, tv.type),
        )) {
          startCrash('crash')
          return
        }
      }

      // Tire screech — steering on slippery surfaces
      if (ctxAudio && (surface === 'ice' || surface === 'snow') && v.speed > 45 && (input.steerLeft || input.steerRight)) {
        const now = ctxAudio.currentTime
        if (now - lastScreechAtS > SCREECH_COOLDOWN_S) {
          beep(160 + Math.random() * 60, 60, now)
          lastScreechAtS = now
        }
      }

      const skidIntensity = Math.min(1, Math.max(0, (Math.abs(v.vx) - 0.08) / 0.65))
      if (surface === 'snow' && v.speed > 8) {
        snowSprayAccum += dt * (0.085 + v.speed * 0.0016 + skidIntensity * 0.12)
        const count = Math.floor(snowSprayAccum)
        snowSprayAccum -= count
        emitWheelSpray(
          surfaceParticles, truckDrawX, truckDrawY, v.vx, count,
          [C.CYAN, C.B_CYAN, C.B_WHITE],
          [0.07, 0.2],
          [360, 850],
        )
      }

      if ((surface === 'ice' || surface === 'snow') && skidIntensity > 0 && v.speed > 25) {
        skidSprayAccum += dt * skidIntensity * (input.brake ? 0.22 : 0.12)
        const count = Math.floor(skidSprayAccum)
        skidSprayAccum -= count
        emitWheelSpray(
          surfaceParticles, truckDrawX, truckDrawY, v.vx, count,
          surface === 'ice' ? [C.B_CYAN, C.B_WHITE, C.B_YELLOW] : [C.B_WHITE, C.B_YELLOW],
          [0.13, 0.34],
          [180, 420],
          surface === 'ice' ? 2 : 1,
        )
      }

      if ((surface === 'sand' || surface === 'mud') && v.speed > 10) {
        snowSprayAccum += dt * (0.05 + v.speed * 0.001 + skidIntensity * 0.08)
        const count = Math.floor(snowSprayAccum)
        snowSprayAccum -= count
        emitWheelSpray(
          surfaceParticles, truckDrawX, truckDrawY, v.vx, count,
          surface === 'sand' ? [C.YELLOW, C.B_YELLOW, C.WHITE] : [C.RED, C.B_RED, C.YELLOW],
          [0.045, 0.16],
          [300, 700],
        )
      }

      // ── Off-road warnings (pixel-perfect) ──
      const isOffRoad = lastOffroad.severity > 0
      const nearEdge = !isOffRoad && Math.min(lastOffroad.marginLeft, lastOffroad.marginRight) < EDGE_MARGIN_WARN_PX
      if (isOffRoad) offroadAccumS += dt / 1000
      else offroadAccumS = 0

      if (ctxAudio && v.speed > 10) {
        const now = ctxAudio.currentTime
        if (isOffRoad) {
          if (now - lastOffroadBeepS > OFFROAD_BEEP_COOLDOWN_S) {
            beep(80 + lastOffroad.severity * 120, 100, now)
            lastOffroadBeepS = now
          }
          if (!wasOffRoad) flashBorder(C.B_RED, 2, 120)
        } else if (nearEdge) {
          if (now - lastOffroadBeepS > 0.5) {
            beep(200, 30, now)
            lastOffroadBeepS = now
          }
        }
      }
      wasOffRoad = isOffRoad

      // Instant crash at high severity
      if (lastOffroad.severity >= OFFROAD_CRASH_SEVERITY) {
        startCrash('offroad')
        return
      }

      // Low fuel
      if (ctxAudio && v.fuel > 0) {
        const now = ctxAudio.currentTime
        if (v.fuel < LOW_FUEL_CRITICAL) {
          if (now - lastFuelBeepS > LOW_FUEL_CRIT_BEEP_COOLDOWN_S) {
            beep(300, 40, now); beep(200, 40, now + 0.05)
            lastFuelBeepS = now
          }
        } else if (v.fuel < LOW_FUEL_WARN) {
          if (now - lastFuelBeepS > LOW_FUEL_BEEP_COOLDOWN_S) {
            beep(260, 60, now)
            lastFuelBeepS = now
          }
        }
      }

      // Canister pickup
      const fuelGained = checkCanisterPickup(v.distance, v.x)
      if (fuelGained > 0) {
        v.fuel = Math.min(1, v.fuel + fuelGained)
        if (ctxAudio) beep(880, 40, ctxAudio.currentTime)
        flashBorder(C.B_YELLOW, 1, 100)
      }

      // Mission timer
      missionTimerMs = Math.max(0, missionTimerMs - dt)

      // Delivery
      if (v.distance >= targetDist) {
        deliveryCount++
        score += DELIVERY_SCORE
        v.fuel = Math.min(1, v.fuel + DELIVERY_FUEL_REFILL)
        missionTimerMs = DELIVERY_TIME_LIMIT_MS
        if (ctxAudio) {
          playPattern([
            { freq: 523, dur: 80 }, { freq: 0, dur: 20 },
            { freq: 659, dur: 80 }, { freq: 0, dur: 20 },
            { freq: 784, dur: 120 },
          ])
        }
        flashBorder(C.B_GREEN, 3, 150)
        const [minD, maxD] = NEXT_TARGET_RANGE
        targetDist = v.distance + minD + (maxD - minD) * hash(deliveryCount * 71)
      }

      // Game over
      if (v.fuel <= 0 && v.speed < 1) triggerGameOver('fuel')
      else if (offroadAccumS > OFFROAD_TIMEOUT_S) startCrash('offroad')
      else if (missionTimerMs <= 0) triggerGameOver('timeout')

      function startCrash(reason: 'offroad' | 'crash') {
        crashReason = reason
        crashTimerMs = 0
        driveState = 'crashing'
        muteEngine()
        const audio = getAudioContext()
        if (audio) {
          beep(100, 200, audio.currentTime)
          beep(60, 300, audio.currentTime + 0.1)
          beep(40, 400, audio.currentTime + 0.3)
        }
        flashBorder(C.B_RED, 6, 80)
      }

      function triggerGameOver(reason: 'fuel' | 'offroad' | 'timeout' | 'crash') {
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

      const roadside = getRoadsideObjects(v.distance - 10, v.distance + PERSPECTIVE_K)
      drawRoadsideObjects(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, v.distance, v.x, roadside,
        (d) => getCurvatureAt(d))

      const traffic = getVisibleTraffic(v.distance, PERSPECTIVE_K)
      drawTraffic(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, v.distance, v.x, traffic,
        (d) => getCurvatureAt(d))

      const visible = getVisibleCanisters(v.distance, PERSPECTIVE_K)
      drawCanisters(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, v.distance, v.x, visible,
        (d) => getCurvatureAt(d))
      renderParticles(ctx, surfaceParticles)

      const truckX = GAME_WIDTH / 2 + v.x * 50
      let shakeX = 0
      let shakeY = 0
      if (driveState === 'crashing') {
        const tick = Math.floor(crashTimerMs / 33)
        shakeX = ((hash(tick) * 8) | 0) - 4
        shakeY = ((hash(tick + 7) * 4) | 0) - 2
      }
      drawTruck(ctx, truckX + shakeX, VIEWPORT_BOTTOM - 2 + shakeY, -v.vx * 1.5)

      const timeLeftSec = Math.ceil(missionTimerMs / 1000)
      const tlMin = Math.floor(timeLeftSec / 60).toString().padStart(2, '0')
      const tlSec = (timeLeftSec % 60).toString().padStart(2, '0')

      const currentGrip = gripFor(getSurfaceAt(v.distance))
      drawHUD(ctx, {
        speed: v.speed,
        fuelPct: v.fuel,
        gripPct: currentGrip,
        missionText: 'DELIVER',
        missionDist: Math.max(0, (targetDist - v.distance) / 1000),
        missionTimeLeft: `${tlMin}:${tlSec}`,
        buildNumber: __BUILD_NUMBER__,
      })

      // ── Overlays ──
      if (driveState === 'waiting' && blinkPhase) {
        drawTextCentered(ctx, 'PRESS ENTER', 56, COLS, C.B_YELLOW, C.BLACK)
      }
      if (driveState === 'paused' && blinkPhase) {
        drawTextCentered(ctx, 'PAUSED', 56, COLS, C.B_RED, C.B_YELLOW)
      }
    },
  }
}
