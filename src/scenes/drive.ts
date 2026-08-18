import {
  C, beep, flashBorder, isHeld, getAudioContext, consumePause,
  playPattern, drawTextCentered,
  createParticleSystem, emitParticles, tickParticles, renderParticles,
  type ParticleSystem, type Scene, type SpectrumColor,
} from 'zx-kit'

import {
  GAME_HEIGHT, GAME_WIDTH, VIEWPORT_BOTTOM, VIEWPORT_TOP, PERSPECTIVE_K, TRAFFIC_VIEW_DISTANCE_M,
  COLS, BLINK_MS, SCREECH_COOLDOWN_S, OFFROAD_BEEP_COOLDOWN_S,
  EDGE_MARGIN_WARN_PX,
  LOW_FUEL_WARN, LOW_FUEL_CRITICAL,
  LOW_FUEL_BEEP_COOLDOWN_S, LOW_FUEL_CRIT_BEEP_COOLDOWN_S,
  DELIVERY_FUEL_REFILL, DELIVERY_SCORE,
  OFFROAD_CRASH_SEVERITY, OFFROAD_TIMEOUT_S, CRASH_ANIM_MS,
  TRAFFIC_COLLISION_DEPTH_M,
  CRANK_NEEDED_MS, CANISTER_TIME_BONUS_S,
  TRUCK_WEIGHT_T, TRUCK_WEIGHTS_T,
} from '../config.ts'
import {
  createVehicle, tickVehicle, massAccelMult,
  type Vehicle, type VehicleInput,
} from '../game/vehicle.ts'
import { getSurfaceAt, getGripAt, accelFor, isDangerAhead, sharpCurveAhead, getCurvatureAt, resetRoad, type Surface } from '../game/road.ts'
import {
  drawRoad, drawStarField, drawCanisters, drawRoadsideObjects, drawTraffic,
  projectTrafficVehicle,
} from '../render/road3d.ts'
import { drawTruck, pushTruckLampSpots, TRUCK_BMP_H, TRUCK_BMP_W } from '../render/truck.ts'
import { clearPendingGlow, pendingGlow } from '../render/vehicleGlow.ts'
import { drawHUD } from '../render/hud.ts'
import { drawTopBar } from '../render/topbar.ts'
import { startEngine, updateEngine, stopEngine, muteEngine, unmuteEngine } from '../audio/engine.ts'
import { checkCanisterPickup, getVisibleCanisters, resetCanisters } from '../game/canisters.ts'
import { getRoadsideObjects } from '../game/roadside.ts'
import { tickTraffic, getVisibleTraffic, resetTraffic } from '../game/traffic.ts'
import { computeRoadEdges } from '../game/roadgeometry.ts'
import {
  addMissionTime, createMission, tickMission, deliverIfArrived, isMissionExpired, remainingM,
} from '../game/mission.ts'
import type { RoadSampler } from '../game/routeplan.ts'
import { createScore, accrueScore, addScoreBonus } from '../game/score.ts'
import type { RunSummary } from '../game/runStats.ts'
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
    { x: truckDrawX + Math.round(TRUCK_BMP_W * 0.18), count: leftCount, angle: -Math.PI * 0.78 + sideBias },
    { x: truckDrawX + Math.round(TRUCK_BMP_W * 0.82), count: rightCount, angle: -Math.PI * 0.22 + sideBias },
  ] as const

  for (const wheel of wheels) {
    const wheelCount = wheel.count
    if (wheelCount <= 0) continue
    emitParticles(particles, {
      x: wheel.x,
      y: truckDrawY + Math.round(TRUCK_BMP_H * 0.85),
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
  onGameOver: (stats: RunSummary) => void,
  gameSeed: number,
): Scene {
  const v: Vehicle = createVehicle()
  let elapsedMs = 0
  const score = createScore()
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
  // Every procedural stream hangs off the route seed, so a seed reproduces the
  // whole run. The offsets keep the streams independent: changing traffic must
  // not reshape the road. `>>> 0` keeps them inside the hash's unsigned range.
  resetRoad(gameSeed)
  resetTraffic((gameSeed + 1) >>> 0)
  resetCanisters((gameSeed + 2) >>> 0)

  let driveState: DriveState = 'waiting'
  // Manual gearbox — D = shift up, A = shift down. Edge-triggered (ignore key-repeat).
  // Both are inert unless the clutch (SHIFT) is held; see game/vehicle.ts.
  let shiftUpQueued = false
  let shiftDownQueued = false
  // Clutch pedal. A LEVEL, not an edge: the skill is *when you let it out*, so the
  // physics needs the held state every tick, not a one-shot. Read from the event
  // rather than isHeld() because zx-kit's input map is arrow/letter keys only.
  let clutchHeld = false
  // ENTER ignition — crank the engine (hold to start). wasStalled tracks audio transition.
  let restartQueued = false
  let wasStalled = false
  let isCranking = false
  let crankMs = 0
  let lastCrankBeepMs = 0
  let lastCoughS = -1
  let lastBuzzS = -1
  let gearBlockFlashMs = 0
  let braking = false
  /** Canisters picked up this run — a game-over statistic, not a game rule. */
  let canistersCollected = 0
  // Debug: W cycles gross weight (10/20/30 t) so the mass→accel effect is feelable
  // before the cargo system exists. 20 t = default = today's tuned feel.
  let weightT: number = TRUCK_WEIGHT_T

  // Only Enter or S starts the game — not Command, not any random key.
  // While playing, A/D queue a gear shift; ENTER cranks a stalled engine.
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (driveState === 'waiting') {
      if (e.key === 'Enter' || e.key === 's' || e.key === 'S') isCranking = true
      return
    }
    if (driveState === 'playing' && v.stalled && e.key === 'Enter') {
      isCranking = true
      return
    }
    // Tracked before the key-repeat guard: holding SHIFT fires repeats, and an
    // early return there would leave the clutch stuck out while the player is
    // very much standing on it.
    if (e.key === 'Shift') clutchHeld = true
    if (e.repeat) return
    if (e.key === 'a' || e.key === 'A') shiftDownQueued = true
    else if (e.key === 'd' || e.key === 'D') shiftUpQueued = true
    else if (e.key === 'w' || e.key === 'W') {
      // Debug weight cycle: 10 → 20 → 30 → 10 t.
      const i = TRUCK_WEIGHTS_T.indexOf(weightT as typeof TRUCK_WEIGHTS_T[number])
      weightT = TRUCK_WEIGHTS_T[(i + 1) % TRUCK_WEIGHTS_T.length]!
    }
  })

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    if (e.key === 'Shift') clutchHeld = false
    if (e.key === 'Enter' || e.key === 's' || e.key === 'S') {
      if (crankMs < CRANK_NEEDED_MS) { isCranking = false; crankMs = 0; lastCrankBeepMs = 0 }
    }
  })

  // Alt-tabbing away with SHIFT down would otherwise leave the clutch held for
  // ever — the browser never sends the keyup. Coasting in neutral until the
  // player notices is a nasty way to lose a delivery.
  window.addEventListener('blur', () => { clutchHeld = false })

  /**
   * The road, as the mission planner asks about it. The clock is built from what
   * is actually coming — see `game/routeplan.ts` — so this is the one place the
   * two systems meet.
   */
  const road: RoadSampler = {
    surfaceAt: (d) => getSurfaceAt(d),
    gripAt: (d) => getGripAt(d),
    curvatureAt: (d) => getCurvatureAt(d),
  }
  const mission = createMission(gameSeed, road)

  /** Centre-screen note with its own life, in ms: NEW LOAD, +10s and the like. */
  let flashText: string | null = null
  let flashMs = 0
  const flash = (text: string, ms = 2200) => { flashText = text; flashMs = ms }

  return {
    name: 'drive',

    update(dt) {
      // Blink always ticks (for PRESS ENTER / PAUSED overlay)
      blinkAccum += dt
      while (blinkAccum >= BLINK_MS) { blinkAccum -= BLINK_MS; blinkPhase = !blinkPhase }

      // ── Waiting state: hold Enter/S to crank the engine ──
      if (driveState === 'waiting') {
        if (isCranking && (isHeld('Enter') || isHeld('s'))) {
          crankMs += dt
          const ctxCrank = getAudioContext()
          if (ctxCrank && crankMs - lastCrankBeepMs > 200) {
            lastCrankBeepMs = crankMs
            beep(80 + Math.random() * 25, 25, ctxCrank.currentTime)
          }
          if (crankMs >= CRANK_NEEDED_MS) {
            isCranking = false; crankMs = 0; lastCrankBeepMs = 0
            driveState = 'playing'
            if (!engineStarted && getAudioContext() != null) {
              startEngine()
              engineStarted = true
            }
            const ctxStart = getAudioContext()
            if (ctxStart) beep(220, 60, ctxStart.currentTime)
          }
        } else if (!isHeld('Enter') && !isHeld('s')) {
          crankMs = 0; lastCrankBeepMs = 0
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
      gearBlockFlashMs = Math.max(0, gearBlockFlashMs - dt)
      if (flashMs > 0) { flashMs = Math.max(0, flashMs - dt); if (flashMs === 0) flashText = null }

      if (!engineStarted && getAudioContext() != null) {
        startEngine()
        engineStarted = true
      }

      // ── Crank tick (stalled engine restart) ──
      if (v.stalled && isCranking && isHeld('Enter')) {
        crankMs += dt
        const ctxCrank = getAudioContext()
        if (ctxCrank && crankMs - lastCrankBeepMs > 200) {
          lastCrankBeepMs = crankMs
          beep(80 + Math.random() * 25, 25, ctxCrank.currentTime)
        }
        if (crankMs >= CRANK_NEEDED_MS) {
          isCranking = false; crankMs = 0; lastCrankBeepMs = 0
          restartQueued = true
        }
      } else if (!isHeld('Enter')) {
        if (!v.stalled) { isCranking = false; crankMs = 0; lastCrankBeepMs = 0 }
        else { crankMs = 0; lastCrankBeepMs = 0 }
      }

      // ── Pixel-perfect off-road detection (before physics tick) ──
      const truckScreenX = GAME_WIDTH / 2 + v.x * 50
      const truckDrawX = Math.round(truckScreenX - TRUCK_BMP_W / 2 + (-v.vx * 1.5))
      const truckDrawY = Math.round(VIEWPORT_BOTTOM - 2 - TRUCK_BMP_H)
      const edgesLookup = computeRoadEdges(v.distance, v.x, (d) => getCurvatureAt(d))
      lastOffroad = checkTruckOffroad(truckDrawX, truckDrawY, edgesLookup)

      let offroadReturnDir = 0
      if (lastOffroad.severity > 0) {
        offroadReturnDir = lastOffroad.rightOff > lastOffroad.leftOff ? -1 : 1
      }

      const input: VehicleInput = {
        throttle: isHeld('ArrowUp'),
        brake: isHeld('ArrowDown'),
        steerLeft: isHeld('ArrowLeft'),
        steerRight: isHeld('ArrowRight'),
        shiftUp: shiftUpQueued,
        shiftDown: shiftDownQueued,
        restart: restartQueued,
        clutch: clutchHeld,
      }
      shiftUpQueued = false
      shiftDownQueued = false
      restartQueued = false
      // Remembered for the render pass: the tail lamps brighten on the brake, and
      // input belongs to the update tick rather than being polled again below.
      braking = input.brake
      const gearBefore = v.gear

      const surface: Surface = getSurfaceAt(v.distance)
      const grip = getGripAt(v.distance)
      // Engine pull = surface grip × mass: a heavier truck accelerates slower.
      const accel = accelFor(surface) * massAccelMult(weightT)
      const curvature = getCurvatureAt(v.distance)
      tickVehicle(v, input, surface, grip, accel, dt, curvature,
        lastOffroad.severity, offroadReturnDir, weightT)
      tickParticles(surfaceParticles, dt, 0.00022)

      if (engineStarted) updateEngine(v.speed, v.rpm, surface, input.brake, !v.stalled)

      const ctxAudio = getAudioContext()

      // Gear-shift feedback beep — only when a shift actually changed gear.
      if (v.gear !== gearBefore && !v.stalled && ctxAudio) {
        beep(v.gear > gearBefore ? 320 : 200, 35, ctxAudio.currentTime)
      }

      // Synchro refused a downshift — grind/clunk + flash the GEAR readout red.
      if (v.shiftBlocked) {
        gearBlockFlashMs = 300
        if (ctxAudio) {
          const now = ctxAudio.currentTime
          beep(80, 70, now); beep(52, 90, now + 0.05)
        }
      }

      // Engine stall / restart audio cues
      if (v.stalled && !wasStalled && ctxAudio) {
        const now = ctxAudio.currentTime
        beep(120, 120, now); beep(70, 200, now + 0.1); beep(45, 260, now + 0.25)
        flashBorder(C.B_RED, 2, 120)
      } else if (!v.stalled && wasStalled && ctxAudio) {
        beep(180, 70, ctxAudio.currentTime)  // ignition crank
      }
      wasStalled = v.stalled

      // Engine stalling — periodic cough/splutter while lugging (grace period)
      if (v.stallWarning && ctxAudio) {
        const now = ctxAudio.currentTime
        if (now - lastCoughS > 0.4) {
          beep(60 + Math.random() * 30, 55, now)
          lastCoughS = now
        }
      }

      // Redline — insistent high buzzer while over-revving (before burn-out)
      if (v.redlineWarning && ctxAudio) {
        const now = ctxAudio.currentTime
        if (now - lastBuzzS > 0.16) {
          beep(540, 35, now)
          lastBuzzS = now
        }
      }

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
          projected.raster,
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
        canistersCollected++
        v.fuel = Math.min(1, v.fuel + fuelGained)
        // Canisters pay in seconds as well as in fuel. The budget already
        // expects a share of them to be taken (PLAN_EXPECTED_CANISTER_PCT), so
        // this is not free time — it is time the plan has already spent.
        addMissionTime(mission, CANISTER_TIME_BONUS_S * 1000)
        flash(`+${CANISTER_TIME_BONUS_S}s`, 900)
        if (ctxAudio) beep(880, 40, ctxAudio.currentTime)
        flashBorder(C.B_YELLOW, 1, 100)
      }

      // The road pays by the block covered, weighted by what it asked of you.
      accrueScore(score, v.distance, getSurfaceAt)

      // Mission timer
      tickMission(mission, dt)

      // Delivery — the clock, the next target and the carry-over all live in
      // game/mission.ts, so the completability bot walks the same rules.
      if (deliverIfArrived(mission, v.distance, road)) {
        addScoreBonus(score, DELIVERY_SCORE)
        v.fuel = Math.min(1, v.fuel + DELIVERY_FUEL_REFILL)
        // The new leg's budget, shown once. Without this the clock only ever
        // counts down and a veteran cannot read what the route is going to be —
        // which is half the reason the budget knows the road at all.
        const budgetS = Math.round(mission.lastBudgetMs / 1000)
        const bm = Math.floor(budgetS / 60).toString().padStart(2, '0')
        const bs = (budgetS % 60).toString().padStart(2, '0')
        flash(`NEW LOAD  ${bm}:${bs}`)
        if (ctxAudio) {
          playPattern([
            { freq: 523, dur: 80 }, { freq: 0, dur: 20 },
            { freq: 659, dur: 80 }, { freq: 0, dur: 20 },
            { freq: 784, dur: 120 },
          ])
        }
        flashBorder(C.B_GREEN, 3, 150)
      }

      // Game over
      if (v.fuel <= 0 && v.speed < 1) triggerGameOver('fuel')
      else if (offroadAccumS > OFFROAD_TIMEOUT_S) startCrash('offroad')
      else if (isMissionExpired(mission)) triggerGameOver('timeout')

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
        onGameOver({
          distance: v.distance,
          elapsedMs,
          canisters: canistersCollected,
          score: score.points,
          reason,
        })
      }
    },

    render(ctx) {
      ctx.fillStyle = C.BLACK
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)

      const fuelWarn = v.fuel < LOW_FUEL_WARN
      const fuelCrit = v.fuel < LOW_FUEL_CRITICAL

      drawTopBar(ctx, {
        distance: v.distance, score: score.points, elapsedMs,
        dangerAhead: isDangerAhead(v.distance),
        curveAhead: sharpCurveAhead(v.distance),
        iceAheadBlink: blinkPhase,
        lowFuel: fuelWarn,
        lowFuelBlink: fuelCrit ? blinkPhase : (fuelWarn && !blinkPhase),
      })

      drawStarField(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM)
      drawRoad(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, v.distance, v.x,
        (d) => getSurfaceAt(d), (d) => getCurvatureAt(d))

      const roadside = getRoadsideObjects(v.distance - 10, v.distance + PERSPECTIVE_K)
      drawRoadsideObjects(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, v.distance, v.x, roadside,
        (d) => getCurvatureAt(d))

      clearPendingGlow()
      const glowSpots = pendingGlow()
      const traffic = getVisibleTraffic(v.distance, TRAFFIC_VIEW_DISTANCE_M)
      drawTraffic(ctx, VIEWPORT_TOP, VIEWPORT_BOTTOM, v.distance, v.x, traffic,
        (d) => getCurvatureAt(d), glowSpots)

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
      const steerDir: -1 | 0 | 1 = v.vx < -0.1 ? -1 : v.vx > 0.1 ? 1 : 0
      // The brake reaches the sprite as well as the glow: the lamps go BRIGHT in
      // the framebuffer, so it reads with `?glow=0` too. Only while actually
      // driving — a paused or crashing frame is not the player standing on the
      // pedal. The stalled engine is deliberately not a condition: pressing the
      // brake lights the lamps whether or not the engine is running.
      const brakeLightsOn = driveState === 'playing' && braking
      drawTruck(ctx, truckX + shakeX, VIEWPORT_BOTTOM - 2 + shakeY, -v.vx * 1.5, steerDir, brakeLightsOn)

      // The truck's own lamps are dead metal while the engine is out — a stalled
      // truck on the ice is exactly the moment the game should stop reassuring.
      if (driveState === 'playing' && !v.stalled) {
        pushTruckLampSpots(
          glowSpots, truckX + shakeX, VIEWPORT_BOTTOM - 2 + shakeY, -v.vx * 1.5, steerDir, braking,
        )
      }
      // Nothing is blitted here. The lights are handed to `main.ts`, which lays
      // them over the frame *after* the scanlines — see `vehicleGlow.ts`.

      const timeLeftSec = Math.ceil(mission.timerMs / 1000)
      const tlMin = Math.floor(timeLeftSec / 60).toString().padStart(2, '0')
      const tlSec = (timeLeftSec % 60).toString().padStart(2, '0')

      const currentGrip = getGripAt(v.distance)
      drawHUD(ctx, {
        speed: v.speed,
        rpm: v.rpm,
        gear: v.gear,
        gearAlert: gearBlockFlashMs > 0,
        fuelPct: v.fuel,
        gripPct: currentGrip,
        missionText: 'DELIVER',
        missionDist: remainingM(mission, v.distance) / 1000,
        missionTimeLeft: `${tlMin}:${tlSec}`,
        buildNumber: __BUILD_NUMBER__,
        weightT,
        clutchIn: v.clutchIn,
        targetRpm: v.targetRpm,
      })

      // ── Overlays ──
      if (flashText && driveState === 'playing') {
        drawTextCentered(ctx, flashText, 36, COLS, C.B_GREEN, C.BLACK)
      }
      if (driveState === 'waiting') {
        if (isCranking) {
          drawTextCentered(ctx, 'STARTING...', 56, COLS, C.B_GREEN, C.BLACK)
        } else if (blinkPhase) {
          drawTextCentered(ctx, 'HOLD ENTER', 56, COLS, C.B_YELLOW, C.BLACK)
        }
      }
      if (driveState === 'playing' && v.stalled) {
        drawTextCentered(ctx, 'ENGINE STALLED', 44, COLS, C.B_RED, C.BLACK)
        if (isCranking) {
          drawTextCentered(ctx, 'STARTING...', 60, COLS, C.B_GREEN, C.BLACK)
        } else if (blinkPhase) {
          drawTextCentered(ctx, 'HOLD ENTER', 60, COLS, C.B_YELLOW, C.BLACK)
        }
      } else if (driveState === 'playing' && v.stallWarning && blinkPhase) {
        drawTextCentered(ctx, 'ENGINE STALLING', 44, COLS, C.B_YELLOW, C.BLACK)
        drawTextCentered(ctx, 'SHIFT DOWN  A', 60, COLS, C.B_YELLOW, C.BLACK)
      } else if (driveState === 'playing' && v.redlineWarning && blinkPhase) {
        drawTextCentered(ctx, 'ENGINE REDLINE', 44, COLS, C.B_RED, C.BLACK)
        drawTextCentered(ctx, 'SHIFT UP  D', 60, COLS, C.B_YELLOW, C.BLACK)
      }
      if (driveState === 'paused' && blinkPhase) {
        drawTextCentered(ctx, 'PAUSED', 56, COLS, C.B_RED, C.B_YELLOW)
      }
    },
  }
}
