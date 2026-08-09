/**
 * Vehicle physics — based on Marco Monster's "Car Physics for Games" model,
 * adapted for pseudo-3D (1 axis lateral + forward speed).
 *
 * Key forces (longitudinal):
 *   F_engine    = gear.accel × torque(rpm) × surface_mult  (throttle, gear-limited)
 *   F_brake     = SURFACE_BRAKE[surface].decel × speedFade  (manual brake)
 *   F_aero      = AERO_DRAG × (v/MAX)²          (quadratic, dominates at high speed)
 *   F_rolling   = ROLLING_RESISTANCE × v         (linear, dominates at low speed)
 *   F_engine_br = ENGINE_BRAKE × (v/MAX)         (throttle released = engine compression)
 *   F_surface   = SURFACE_DRAG × (v/MAX)         (sand/mud/snow resistance)
 *
 * Key forces (lateral):
 *   Steering    = STEER_ACCEL × √grip × speedFactor
 *   Damping     = STEER_DAMP × grip × gripMult × dampMult
 *   Centrifugal = curvature × speed × CURVE_DRIFT × SURFACE_CURVE_DRIFT_MULT
 *
 * Grip curve (slip angle approximation):
 *   gripMult = 1.0                      if |vx| ≤ SLIP_PEAK  (linear zone)
 *   gripMult = (SLIP_PEAK / |vx|)²      if |vx| > SLIP_PEAK  (drop-off zone)
 *   Minimum 5% residual grip to prevent infinite slides.
 *
 * This naturally produces understeer/oversteer without explicit thresholds.
 *
 * ── Why steering uses √grip while damping uses grip ─────────────────────────
 * Low grip lowers the *limit* of lateral force a tyre can pass, but the wheel is
 * still turned and the contact patch still transmits something — the response
 * does not fade in proportion. Damping is different: it is the tyre correcting
 * *itself*, so it keeps the linear grip and the full slip collapse, which is why
 * a slide on ice still persists once you are past the slip peak.
 *
 * With both on linear grip, ice was 4× weaker at steering AND 2.75× stronger at
 * being pushed out (the old grip-derived centrifugal term) — 11× worse than
 * asphalt in a curve, and mathematically unholdable. `controllability.test.ts`
 * pins the resulting envelope so this cannot silently regress.
 */

import {
  MAX_SPEED, REFERENCE_MASS_T,
  AERO_DRAG, ROLLING_RESISTANCE, ENGINE_BRAKE,
  CURVE_DRIFT,
  STEER_ACCEL, STEER_DAMP, MAX_LATERAL_V,
  SPEED_STEER_PENALTY,
  OFF_ROAD_DRAG, OFF_ROAD_RETURN,
  FUEL_BURN_RATE, FUEL_IDLE_THRESHOLD,
  SURFACE_DRAG, SURFACE_BRAKE,
  SURFACE_STEER_DAMP_MULT, SURFACE_FUEL_MULT, SURFACE_CURVE_DRIFT_MULT,
  SURFACE_SLIP_PEAK,
  GEARS, GEAR_COUNT, BOG_RPM, BOG_FLOOR, POWER_RPM, REDLINE_FLOOR, OVERREV_ENGINE_BRAKE,
  LUG_RPM, STALL_GRACE_MS, REDLINE_RPM, REDLINE_BURN_MS, REDLINE_WARN_DELAY_MS,
  CLUTCH_IDLE_RPM, CLUTCH_GOVERNOR_RPM, CLUTCH_REV_RESPONSE, CLUTCH_MATCH_TOLERANCE,
  CLUTCH_SHOCK, CLUTCH_STALL_RPM, CLUTCH_LAUNCH_FRACTION,
  type Surface,
} from '../config.ts'

export { MAX_SPEED }

/**
 * Mass-based acceleration multiplier. Engine pull scales inversely with gross
 * weight relative to the tuning baseline ({@link REFERENCE_MASS_T}): the 20 t
 * reference truck returns 1.0 (today's feel unchanged), a 10 t empty cab ~2.0
 * (sprightly), a 30 t heavy load ~0.67 (a slog). Heavy loads therefore lean even
 * harder on the low gears to pull away — the manual box matters more.
 *
 * Pure → unit-testable. Folded into the engine-force term at the call site
 * (`scenes/drive.ts`) for now; a later step will also let mass make the engine
 * (a) lug/stall more easily and (b) take longer to brake.
 */
export function massAccelMult(massT: number, referenceMassT = REFERENCE_MASS_T): number {
  return referenceMassT / massT
}

/**
 * Mass-based braking multiplier. Manual-brake deceleration scales inversely with
 * gross weight relative to {@link REFERENCE_MASS_T}: the 20 t reference truck
 * returns 1.0 (today's stopping power unchanged), a 10 t empty cab ~2.0 (pulls up
 * sharply), a 30 t load ~0.67 (carries its momentum — stops ~1.5× later). Same
 * inertia intuition as {@link massAccelMult}, applied to the brake instead of the
 * engine. Deliberately scoped to the *manual brake* only — aero/rolling/surface
 * drag stay mass-independent so the SURFACE_DRAG equilibria keep their tuning.
 *
 * Pure → unit-testable. Threaded into {@link tickVehicle} via the `massT` param.
 */
export function massBrakeMult(massT: number, referenceMassT = REFERENCE_MASS_T): number {
  return referenceMassT / massT
}

/**
 * Mass-based stall-grace multiplier. Scales the lugging grace period (see
 * {@link STALL_GRACE_MS}) inversely with gross weight relative to
 * {@link REFERENCE_MASS_T}: 20 t returns 1.0 (today's ~3.5 s unchanged), a heavy
 * 30 t load ~0.67 (only ~2.3 s before it dies — more load lugs the engine to a
 * stall sooner), a light 10 t cab ~2.0 (~7 s, forgiving). Same inertia intuition
 * as {@link massAccelMult}/{@link massBrakeMult}, applied to the stall timer.
 *
 * Pure → unit-testable. Threaded into {@link tickVehicle} via the `massT` param.
 */
export function massStallMult(massT: number, referenceMassT = REFERENCE_MASS_T): number {
  return referenceMassT / massT
}

export interface Vehicle {
  x: number
  vx: number
  speed: number
  distance: number
  fuel: number
  /** Current engaged gear (1..GEAR_COUNT). */
  gear: number
  /** Engine revs within the current gear's band (0..1, 1 = redline). For display. */
  rpm: number
  /** True when the engine has stalled (lugged below idle). Restart with ENTER. */
  stalled: boolean
  /** Milliseconds the engine has lugged below the stall threshold (grace countdown). */
  stallWarnMs: number
  /** True while the "ENGINE STALLING" warning shows — lugging, not dead yet. */
  stallWarning: boolean
  /** Milliseconds held at the redline under throttle (burn-out countdown). */
  redlineMs: number
  /** True while the "REDLINE / SHIFT UP" warning shows — over-revving, not dead yet. */
  redlineWarning: boolean
  /** Why the engine last stalled — kept so a future damage model can differentiate. */
  stallCause: 'lug' | 'overrev' | 'clutch' | null
  /** True only on the tick a downshift was refused by a synchro speed limit. */
  shiftBlocked: boolean

  // ── Clutch ────────────────────────────────────────────────────────────────
  /** True while SHIFT is held: the engine is disconnected from the wheels. */
  clutchIn: boolean
  /**
   * Engine revs (0..1, 1 = redline) as an INDEPENDENT quantity. While the clutch
   * is in, this free-revs on the throttle and decays to idle off it; while it is
   * out, it is locked to what the wheels demand (`speed / gear.to`). The whole
   * clutch mechanic exists in the gap between those two.
   */
  engineRpm: number
  /**
   * Revs the wheels will demand the moment the clutch bites, i.e. the number the
   * player is trying to match. Live even while declutched (speed keeps changing),
   * which is what makes the window move. Drives the tachometer's target marker.
   */
  targetRpm: number
  /** Signed rpm error of the last clutch release; 0 if it was clean. For the HUD/audio. */
  lastBite: number
  /** True only on the tick the clutch bit badly enough to shock the drivetrain. */
  clutchJolt: boolean
}

export interface VehicleInput {
  throttle: boolean
  brake: boolean
  steerLeft: boolean
  steerRight: boolean
  /** Edge-triggered: shift up one gear this tick. Ignored unless {@link clutch} is held. */
  shiftUp?: boolean
  /** Edge-triggered: shift down one gear this tick. Ignored unless {@link clutch} is held. */
  shiftDown?: boolean
  /** Edge-triggered: ENTER ignition — restart a stalled engine. */
  restart?: boolean
  /** Held state of the clutch pedal (SHIFT). Level, not an edge — the release moment is the skill. */
  clutch?: boolean
}

export function createVehicle(): Vehicle {
  return {
    x: 0, vx: 0, speed: 0, distance: 0, fuel: 1.0,
    gear: 1, rpm: 0, stalled: false, stallWarnMs: 0, stallWarning: false,
    redlineMs: 0, redlineWarning: false, stallCause: null, shiftBlocked: false,
    clutchIn: false, engineRpm: CLUTCH_IDLE_RPM, targetRpm: 0, lastBite: 0, clutchJolt: false,
  }
}

/**
 * Synchro check — may you downshift INTO `targetGear` at this speed? A gear with a
 * numeric `maxSpeedToShift` refuses engagement above it; `null` = no limit.
 */
function canDownshiftInto(targetGear: number, speed: number): boolean {
  const limit = GEARS[targetGear - 1]!.maxSpeedToShift
  return limit === null || speed <= limit
}

/**
 * Pick a sensible gear to re-engage on restart so the engine does not instantly
 * re-stall (too tall) or redline (too short). Falls back to 1st at low speed.
 */
function startableGear(speed: number): number {
  // Lowest gear that isn't near the redline at this speed — gives the most pull.
  for (let g = 1; g <= GEAR_COUNT; g++) {
    if (speed / GEARS[g - 1]!.to <= 0.9) return g
  }
  return GEAR_COUNT
}

/**
 * Throttle torque multiplier from engine rpm (0..1+ inside the current gear band).
 * Lugging below the power band is weak; the flat band is full power; near redline
 * torque tapers; at/above redline the engine cannot pull the gear any faster.
 */
function gearTorqueMult(rpm: number): number {
  if (rpm >= 1) return 0
  const r = Math.max(0, rpm)
  if (r < BOG_RPM) return BOG_FLOOR + (r / BOG_RPM) ** 2 * (1 - BOG_FLOOR)
  if (r <= POWER_RPM) return 1
  return 1 - ((r - POWER_RPM) / (1 - POWER_RPM)) * (1 - REDLINE_FLOOR)
}

/**
 * Slip angle grip curve. Returns 1.0 in the linear zone,
 * drops off as 1/x² beyond the peak. Minimum 5% residual grip.
 */
function slipGripMult(vx: number, slipPeak: number): number {
  const ratio = Math.abs(vx) / slipPeak
  if (ratio <= 1) return 1.0
  return Math.max(0.05, 1 / (ratio * ratio))
}

export function tickVehicle(
  v: Vehicle,
  input: VehicleInput,
  surface: Surface,
  grip: number,
  accelMult: number,
  dtMs: number,
  curvature = 0,
  offroadSeverity = 0,
  offroadReturnDir = 0,
  massT: number = REFERENCE_MASS_T,
): void {
  const dt = dtMs / 1000
  const speedRatio = v.speed / MAX_SPEED

  // ── Gearbox (manual, clutched) ───────────────────────────────────────────
  // The clutch is a LEVEL, not an edge: what the player is timing is the moment
  // they let it out, so both the held state and the release edge matter here.
  v.shiftBlocked = false
  v.clutchJolt = false
  const clutchIn = input.clutch === true
  const clutchReleased = v.clutchIn && !clutchIn   // the bite happens on this tick
  v.clutchIn = clutchIn

  // Gears only move with the pedal down. There is no clutchless shifting — see
  // DRIVETRAIN_ROADMAP §2.6; float-shifting was considered and deliberately cut.
  if (clutchIn) {
    if (input.shiftUp && v.gear < GEAR_COUNT) v.gear++   // upshifts are always allowed
    if (input.shiftDown && v.gear > 1) {
      if (canDownshiftInto(v.gear - 1, v.speed)) v.gear--
      else v.shiftBlocked = true                          // synchro refused the downshift
    }
  } else if (input.shiftUp || input.shiftDown) {
    v.shiftBlocked = true   // "you didn't press the clutch" — same grind cue as a refused synchro
  }

  // ENTER ignition — restart a stalled engine in a sensible gear.
  if (v.stalled && input.restart) {
    v.stalled = false
    v.stallWarnMs = 0
    v.redlineMs = 0
    v.stallCause = null
    v.gear = startableGear(v.speed)
    v.engineRpm = CLUTCH_IDLE_RPM
  }

  const gear = GEARS[v.gear - 1]!
  // What the WHEELS demand in this gear: proportional to road speed, like a real
  // engine — 0 at standstill, 1.0 = redline at the gear's top. Never negative.
  // With the clutch out this simply IS the engine speed; with it in, it is the
  // number the player is chasing, and it keeps moving because the truck is still
  // slowing down (drag, brakes, mass) the whole time they are declutched.
  const rpmRaw = gear.to > 0 ? v.speed / gear.to : 0
  v.targetRpm = Math.min(1, rpmRaw)

  // ── Clutch: free-revving, then the bite ──────────────────────────────────
  if (v.stalled) {
    v.engineRpm = 0
  } else if (clutchIn) {
    // Disconnected: engine inertia approaches idle or the no-load governor.
    // Exact exponential smoothing is frame-rate stable and cannot overshoot,
    // unlike the old constant ramp that hit the limiter in a fraction of a
    // second when SHIFT was pressed while the road already held revs high.
    const freeRevTarget = input.throttle && v.fuel > 0
      ? CLUTCH_GOVERNOR_RPM
      : CLUTCH_IDLE_RPM
    const response = 1 - Math.exp(-CLUTCH_REV_RESPONSE * dt)
    v.engineRpm += (freeRevTarget - v.engineRpm) * response
  } else if (clutchReleased) {
    // THE BITE. Everything the mechanic is about happens on this one tick.
    const bite = v.engineRpm - rpmRaw
    v.lastBite = Math.abs(bite) <= CLUTCH_MATCH_TOLERANCE ? 0 : bite

    if (v.lastBite !== 0) {
      // Mismatch is taken out on the truck. Engine slower than the wheels demand
      // (the un-blipped downshift) drags the speed down; faster gives a shove.
      // A heavier load absorbs the same mismatch more calmly — same inertia
      // intuition as massBrakeMult, and the reason a 10 t cab feels twitchy.
      const excess = bite > 0 ? bite - CLUTCH_MATCH_TOLERANCE : bite + CLUTCH_MATCH_TOLERANCE
      // Asymmetric on purpose — see CLUTCH_LAUNCH_FRACTION. Being dragged down
      // is rigid and costs the full amount; over-revving mostly spins the wheels
      // and must never become a cheaper way to accelerate than driving.
      const transfer = excess > 0 ? excess * CLUTCH_LAUNCH_FRACTION : excess
      const gained = transfer * CLUTCH_SHOCK * massBrakeMult(massT)
      // A launch can never carry you past what the gear itself could pull.
      v.speed = Math.max(0, Math.min(gained > 0 ? Math.min(gear.to, MAX_SPEED) : MAX_SPEED, v.speed + gained))
      v.clutchJolt = true

      // Where the engine LANDS is what kills it, not how far it fell: the wheels
      // can only turn it at `speed / gear.to`, and if that is far under idle,
      // twenty tonnes drag the motor under and it dies on the spot — no gradual
      // lug, so no STALL_GRACE_MS cough either. Landing just below the lug line
      // is left to the normal warning.
      const draggedTo = gear.to > 0 ? v.speed / gear.to : 0
      if (draggedTo < CLUTCH_STALL_RPM && v.gear > 1) {
        v.stalled = true
        v.stallCause = 'clutch'
      }
    }
    // Whatever happened, the engine is now locked to the wheels again.
    v.engineRpm = Math.min(1, gear.to > 0 ? v.speed / gear.to : 0)
  } else {
    v.engineRpm = Math.min(1, rpmRaw)
  }

  // Stall — lugging far below idle in a gear it can't sustain kills the engine,
  // but only after a grace period with an "ENGINE STALLING" warning so you can
  // downshift. First gear is exempt — you can always idle and pull away in 1st.
  // A declutched engine cannot lug: nothing is loading it, which is precisely
  // why pushing the pedal in is the correct move when you are about to stall.
  if (v.stalled) {
    v.stallWarnMs = 0
  } else if (clutchIn) {
    v.stallWarnMs = 0
  } else if (rpmRaw < LUG_RPM && v.gear > 1) {
    // Heavier loads lug to a stall sooner: massStallMult shrinks the grace window
    // (20 t = full ~3.5 s, 30 t ≈ 2.3 s, 10 t ≈ 7 s).
    v.stallWarnMs += dtMs
    if (v.stallWarnMs >= STALL_GRACE_MS * massStallMult(massT)) {
      v.stalled = true
      v.stallCause = 'lug'
      v.stallWarnMs = 0
    }
  } else {
    v.stallWarnMs = 0
  }
  v.stallWarning = !v.stalled && v.stallWarnMs > 0

  // Redline burn-out — sitting on the limiter under throttle without upshifting
  // cooks the engine. Only in gears you can upshift out of: the top gear's redline
  // is just the speed limiter (no recourse), so it never burns out.
  //
  // Measured on ENGINE revs, not road speed. A disconnected engine is protected
  // by CLUTCH_GOVERNOR_RPM; damaging over-rev therefore only comes from an
  // engaged, non-top gear whose wheels force the engine through the limiter.
  const overRevving = !v.stalled && v.engineRpm >= REDLINE_RPM
  const atRedline = overRevving && !clutchIn && v.gear < GEAR_COUNT
  if (atRedline && input.throttle) {
    v.redlineMs += dtMs
    if (v.redlineMs >= REDLINE_BURN_MS) {
      v.stalled = true
      v.stallCause = 'overrev'
      v.redlineMs = 0
    }
  } else {
    v.redlineMs = 0
  }
  v.redlineWarning = !v.stalled && atRedline && input.throttle && v.redlineMs >= REDLINE_WARN_DELAY_MS

  // Dashboard RPM follows the ENGINE, which is the whole point of a tachometer:
  // with the clutch in it shows your free revs (so you can watch yourself close
  // on the target), with it out it is the wheel-driven ratio as before — and it
  // can still drop to 0 bars when lugging. Zero only when actually stalled.
  v.rpm = v.stalled ? 0 : v.engineRpm
  // No drive through a disengaged clutch, however hard you rev.
  const torque = v.stalled || clutchIn ? 0 : gearTorqueMult(rpmRaw)

  // ── Longitudinal forces ────────────────────────────────────────────────

  // Engine force (throttle) — torque-scaled, capped at the current gear's top
  // (and never above MAX_SPEED). A stalled engine produces nothing; freewheels.
  const speedCap = Math.min(gear.to, MAX_SPEED)
  if (!v.stalled && input.throttle && v.fuel > 0 && v.speed < speedCap) {
    v.speed = Math.min(speedCap, v.speed + gear.accel * torque * accelMult * dt)
  }

  // Over-rev engine braking — too low a gear for this speed (e.g. after a
  // downshift) drags speed back down toward the gear's top. Compression, not
  // brake — so it needs the clutch engaged to reach the wheels at all.
  if (!v.stalled && !clutchIn && v.speed > gear.to) {
    v.speed = Math.max(gear.to, v.speed - OVERREV_ENGINE_BRAKE * dt)
  }

  // Manual brake — per-surface profile with speed fade and wheel lock. Heavier
  // loads carry their momentum: massBrakeMult shrinks the deceleration so a 30 t
  // truck needs a longer stopping distance than a 10 t cab (20 t = unchanged).
  const bp = SURFACE_BRAKE[surface]
  if (input.brake) {
    const speedFade = 1 - speedRatio * bp.speedFade
    v.speed = Math.max(0, v.speed - bp.decel * speedFade * massBrakeMult(massT) * dt)
  }

  // Engine braking (throttle released, engine compression resists motion).
  // Gone the moment the clutch goes in — that is what "coasting in neutral"
  // means, and it is the hidden cost of holding the pedal down too long: on ice
  // you have given up the one retarding force you had.
  if (!v.stalled && !clutchIn && !input.throttle && !input.brake && v.fuel > 0 && v.speed > 0) {
    v.speed = Math.max(0, v.speed - ENGINE_BRAKE * speedRatio * dt)
  }

  // Rolling resistance (linear with speed, all surfaces)
  if (v.speed > 0) {
    v.speed = Math.max(0, v.speed - ROLLING_RESISTANCE * v.speed * dt)
  }

  // Aerodynamic drag (quadratic with speed, all surfaces)
  if (v.speed > 0) {
    v.speed = Math.max(0, v.speed - AERO_DRAG * speedRatio * speedRatio * dt)
  }

  // Surface drag (sand/mud/snow specific, proportional to speed)
  const surfDrag = SURFACE_DRAG[surface]
  if (surfDrag > 0 && v.speed > 0) {
    v.speed = Math.max(0, v.speed - surfDrag * speedRatio * dt)
  }

  // Empty tank coast-down (engine dead)
  if (v.fuel <= 0 && v.speed > 0) {
    v.speed = Math.max(0, v.speed - 8 * dt)
  }

  // Off-road drag (pixel-perfect severity from offroad.ts)
  if (offroadSeverity > 0) {
    v.speed = Math.max(0, v.speed - OFF_ROAD_DRAG * offroadSeverity * dt)
    v.vx += offroadReturnDir * OFF_ROAD_RETURN * offroadSeverity * dt
  }

  // ── Lateral forces (slip angle model) ──────────────────────────────────

  // Grip multiplier from slip curve (replaces binary skid threshold)
  const slipPeak = SURFACE_SLIP_PEAK[surface]
  const gripMult = slipGripMult(v.vx, slipPeak)

  // Brake lateral loss — locked wheels reduce steering authority.
  let brakeLoss = 0
  if (input.brake) {
    brakeLoss = bp.lateralLoss
    if (v.speed > bp.lockSpeed) {
      const lockExcess = (v.speed - bp.lockSpeed) / (MAX_SPEED - bp.lockSpeed)
      brakeLoss = Math.min(0.9, brakeLoss + lockExcess * 0.4)
    }
  }

  // steeringGrip: what the driver's input can do — steering authority minus brake
  // loss. NOT reduced by the slip curve: the wheel is still turned, force still
  // exists. √grip, not grip: see the header note on why response does not fade
  // in proportion to grip.
  const steeringGrip = Math.sqrt(grip) * (1 - brakeLoss)

  // effectiveGrip: physics self-correction — full model including slip collapse.
  // When sliding, the tire cannot self-correct (this is the "drift persists" behaviour).
  const effectiveGrip = grip * gripMult * (1 - brakeLoss)

  // Centrifugal drift from road curvature. Independent of grip by design —
  // see SURFACE_CURVE_DRIFT_MULT in config.ts.
  if (curvature !== 0 && v.speed > 5) {
    v.vx += -curvature * v.speed * CURVE_DRIFT * SURFACE_CURVE_DRIFT_MULT[surface] * dt
  }

  // Steering input — uses steeringGrip so the player always has agency
  // proportional to base surface grip. On ice it is weak (grip=0.25) but present.
  const speedSteerFactor = 1 - speedRatio * SPEED_STEER_PENALTY
  if (input.steerLeft)  v.vx -= STEER_ACCEL * steeringGrip * speedSteerFactor * dt
  if (input.steerRight) v.vx += STEER_ACCEL * steeringGrip * speedSteerFactor * dt

  // Damping — uses effectiveGrip: past the slip peak, drift persists (ice doesn't forgive)
  if (!input.steerLeft && !input.steerRight) {
    const dampMult = SURFACE_STEER_DAMP_MULT[surface]
    v.vx *= 1 - Math.min(1, STEER_DAMP * effectiveGrip * dampMult * dt)
  }

  v.vx = Math.max(-MAX_LATERAL_V, Math.min(MAX_LATERAL_V, v.vx))
  v.x += v.vx * (0.35 + v.speed / 220) * dt
  v.x = Math.max(-2.0, Math.min(2.0, v.x))

  // ── Distance + fuel ────────────────────────────────────────────────────

  v.distance += (v.speed / 3.6) * dt

  if (!v.stalled && v.speed > FUEL_IDLE_THRESHOLD && v.fuel > 0) {
    const speedFactor = v.speed * (v.speed / MAX_SPEED)
    v.fuel = Math.max(0, v.fuel - speedFactor * FUEL_BURN_RATE * SURFACE_FUEL_MULT[surface] * dt)
  }
}
