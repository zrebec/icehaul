/**
 * What each surface does to a vehicle — and the most-tuned file in the project.
 *
 * One `Surface` type and a table per property, rather than one table of objects:
 * a tuning session changes *one property across all five surfaces* far more often
 * than it changes five properties of one surface, and this shape puts the numbers
 * being compared on adjacent lines.
 *
 * `controllability.test.ts` pins what each of these holds at each curvature, so a
 * change here is answered by a measurement rather than by an opinion.
 *
 * ── SK ──────────────────────────────────────────────────────────────────────
 * Čo povrch robí s vozidlom — a najladenejší súbor v projekte.
 *
 * Jeden typ `Surface` a tabuľka na každú vlastnosť, nie tabuľka objektov: pri
 * ladení oveľa častejšie meníš *jednu vlastnosť naprieč piatimi povrchmi* než päť
 * vlastností jedného povrchu, a tento tvar dáva porovnávané čísla na susedné
 * riadky.
 *
 * **Než tu čokoľvek pohneš:** `controllability.test.ts` pripína, akú rýchlosť
 * každý povrch udrží v ktorej zákrute. Zmena sa tu nepotvrdzuje pocitom, ale tým,
 * že prebehneš ten test a pozrieš sa na novú tabuľku.
 */

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Päť povrchov, z ktorých je cesta zložená. Ich **identita je tvrdá hrana** — vidno
 * ju, počuť ju, mení spotrebu aj skóre. Prelína sa len samotné číslo gripu, a to na
 * 20 m okolo švíku.
 */
export type Surface = 'asphalt' | 'snow' | 'ice' | 'sand' | 'mud'

/**
 * Per-surface acceleration multiplier applied to base ACCEL.
 *
 * ── SK ──────────────────────────────────────────────────────────────────────
 * Násobič zrýchlenia pre povrch — škáluje **výkon motora**, nie odpor. Ľad má
 * 1.8 zámerne: „rýchly a neovládateľný" je zaujímavejšia hrozba než „pomalý
 * a neovládateľný", a spomalenie si hra vynúti zákrutou, nie motorom.
 *
 * **↓ nižšie:** povrch sa rozbieha ťažšie; v kombinácii so `SURFACE_DRAG` je
 * dvojitý trest a auto na ňom nemusí dosiahnuť ani strop prevodového stupňa.
 * **↑ vyššie:** rýchlejší rozjazd. Nad ~1.5 začne povrch pôsobiť „ľahko" aj keď
 * má nízky grip — čo je presne zámer pri ľade a chyba pri blate.
 */
export const SURFACE_ACCEL: Record<Surface, number> = {
  asphalt: 1.0,
  snow: 0.55,
  ice: 1.8,
  sand: 0.35,
  mud: 0.35,
}

/**
 * Per-surface grip (0–1). Steering + damping + centrifugal drift.
 *
 * ── SK ──────────────────────────────────────────────────────────────────────
 * Priľnavosť povrchu (0–1). Vstupuje do troch vecí naraz: sily zatáčania,
 * tlmenia bočnej rýchlosti a odstredivého zmyku v zákrute. **Je to najsilnejší
 * ciferník v hre** — bezpečná rýchlosť v zákrute rastie so `sqrt(grip)`, takže
 * polovičný grip neznamená polovičnú rýchlosť, ale asi 71 %.
 *
 * Číta sa cez `getGripAt`, nie priamo: na 20 m okolo švíku medzi povrchmi sa
 * hodnota plynulo prelína, aby ľad nezačínal na namaľovanej čiare.
 *
 * **↓ nižšie:** povrch je klzkejší, zákruty treba brať pomalšie, zmyk trvá
 * dlhšie. Pod ~0.20 sa auto stáva neovládateľným aj v priamom smere.
 * **↑ vyššie:** drží lepšie. Pozor na **poradie povrchov** — sneh 0.45 sa dnes
 * rovná blatu a rozhoduje až `SURFACE_STEER_DAMP_MULT`; test si poradie odvodzuje
 * z tejto tabuľky, takže zmena tu prepíše, ktorý povrch je druhý najťažší.
 */
export const SURFACE_GRIP: Record<Surface, number> = {
  asphalt: 1.0,
  snow: 0.45,
  ice: 0.25,
  sand: 0.35,
  mud: 0.45,
}

/**
 * Per-surface passive speed drag — km/h lost per second (velocity-proportional).
 *
 * ── HOW IT WORKS ────────────────────────────────────────────────────────────
 * Applied every physics tick regardless of throttle, in vehicle.ts:
 *
 *   Δspeed = −SURFACE_DRAG[s] × (speed / MAX_SPEED) × dt
 *
 * Linear drag: proportional to current speed. Think of it as wheel-ploughing
 * (mud, sand) or surface compaction resistance (snow). It is separate from and
 * stacks with the other resistive forces:
 *   • AERO_DRAG        quadratic, all surfaces, dominates at high speed
 *   • ROLLING_RESISTANCE  linear, all surfaces, small
 *   • ENGINE_BRAKE     throttle released — engine compression, all surfaces
 *   • SURFACE_ACCEL    scales engine OUTPUT (not drag); see below
 *
 * ── DOUBLE-PENALTY INTERACTION WITH SURFACE_ACCEL ───────────────────────────
 * SURFACE_ACCEL reduces how much force the engine can produce on that surface.
 * SURFACE_DRAG adds how much resistance the surface imposes passively.
 * Both stack multiplicatively, creating a strong "terrain difficulty" effect.
 *
 * At full throttle in the power band, drag and engine force balance at:
 *
 *   v_eq = GEARS[G].accel × SURFACE_ACCEL[S] × MAX_SPEED / SURFACE_DRAG[S]
 *
 *   v_eq ≥ GEARS[G].to  → gear is drag-free: top speed is gear-limited.
 *   v_eq < GEARS[G].to  → gear is drag-limited: you never reach the gear's
 *                          rated top speed on this surface. *
 * ── SK ──────────────────────────────────────────────────────────────────────
 * Pasívny odpor povrchu — koľko km/h za sekundu ubudne bez ohľadu na plyn.
 * Predstav si to ako oranie kolies (piesok, blato) alebo odpor utláčaného snehu.
 *
 * **Toto je tá druhá polovica dvojitého trestu.** `SURFACE_ACCEL` uberá motoru
 * *silu*, `SURFACE_DRAG` pridáva *odpor*, a násobia sa. Preto sa na piesku
 * nedostaneš na strop prevodového stupňa, aj keď ti prevodovka hovorí, že máš.
 *
 * **↓ nižšie:** povrch prestane brzdiť, autá aj kamión na ňom držia vyššiu
 * rýchlosť. Pri 0 (ľad) je jazda voľná a o rýchlosti rozhoduje len zákruta.
 * **↑ vyššie:** povrch sa stane močiarom. Nad ~6 prestane byť prekážkou a stane
 * sa stenou — hráč nemá čo urobiť inak, len čakať, kým to prejde.
 *
 * CRITICAL WARNING — if SURFACE_DRAG is set too high, the double-penalty
 * overwhelms all gears except 1st. The pre-fix values (mud=8, sand=7)
 * produced the following drag-limited tops in 2nd gear:
 *   mud: 4.2 × 0.35 × 120 / 8  = 22 km/h   ← below any usable speed
 *   sand: 4.2 × 0.35 × 120 / 7 = 25 km/h   ← same trap
 * With mud=4 and sand=3, 2nd gear equilibrium is now ~44 and ~59 km/h
 * respectively — 2nd/3rd work, 4th/5th are meaningfully drag-limited.
 * The invariant to preserve: 2nd gear must be able to sustain its lower
 * speed range. Safe upper bound: SURFACE_DRAG < GEARS[1].accel ×
 * SURFACE_ACCEL × MAX_SPEED / GEARS[1].to  (i.e. drag-free threshold for
 * 2nd). For mud that is 4.2 × 0.35 × 120 / 52 ≈ 3.4; mud=4 deliberately
 * exceeds it slightly (drag-limited at 44 km/h) for realism.
 *
 * ── BALLISTIC TRAJECTORY (coasting behaviour) ───────────────────────────────
 * SURFACE_DRAG is active whether you are on throttle or not. On asphalt and
 * ice (drag=0) the truck coasts freely — its trajectory is shaped only by
 * AERO_DRAG and ENGINE_BRAKE, and it barely slows over a few seconds. On mud
 * and sand you cannot glide: releasing the throttle at 60 km/h on mud loses
 * ~2.0 km/h/s from surface drag alone (4 × 60/120 = 2.0), so the truck sheds
 * ~10 km/h in 5 seconds of coasting. This creates a "keep the power on"
 * commitment feel on heavy terrain, especially approaching corners.
 *
 * ── ENGINE LOAD AND TORQUE (RPM BAR BEHAVIOUR) ──────────────────────────────
 * SURFACE_DRAG does not raise engine RPM directly (RPM is always speed/gear.to).
 * However, drag lowers equilibrium speed → the truck sits at a lower rpm fraction
 * → deeper in the bog zone → torque multiplier is weaker → the engine strains
 * without actually showing high RPM. The RPM bar reading low on mud/sand is the
 * correct read-out of this state: surface drag is pulling the truck back faster
 * than the engine can push it forward in a tall gear, and the engine is doing all
 * it can. Downshifting raises rpm into the power band, restoring torque.
 *
 * ── PER-SURFACE VALUES AND RATIONALE ────────────────────────────────────────
 *
 * asphalt  0   Hard, sealed road. No wheel-ploughing, no surface deformation.
 *              Rolling resistance and aero drag are already modelled separately
 *              (ROLLING_RESISTANCE, AERO_DRAG). The truck coasts freely — a 20 t
 *              vehicle on asphalt genuinely does. Do not add drag here; it would
 *              fight the existing resistance model.
 *
 * snow     4   Compacted snow packs under the tyres but offers real resistance from
 *              surface deformation and small ploughing effect. Paired with
 *              SURFACE_ACCEL=0.55 the combined effect feels "slowed but manageable."
 *              Equilibrium by gear at full throttle (power band):
 *                1st  28 km/h (drag-free, gear-limited)
 *                2nd  52 km/h (drag-free: v_eq = 4.2 × 0.55 × 120/4 = 69)
 *                3rd  ~53 km/h (drag-limited: v_eq = 3.2 × 0.55 × 120/4 = 52.8)
 *                4th  ~40 km/h    5th  ~30 km/h
 *              Raise toward 6–8 for loose deep powder; lower toward 2 for
 *              hard-packed ice-road snow.
 *
 * ice      0   Frictionless rolling surface — ice roads have very low tyre
 *              rolling resistance. No drag. The hazard on ice is SURFACE_GRIP=0.25
 *              (steering nearly gone) and SURFACE_ACCEL=1.8 (engine pulls hard —
 *              wheel-spin, fast acceleration). You zoom and cannot steer. Intentional
 *              asymmetry: ice is fast and uncontrollable, not slow and slippery.
 *              Adding drag here would contradict the "grip is the danger" design.
 *
 * sand     3   Dry sand lets wheels sink slightly and displaces easily. Less viscous
 *              suction than mud (drier, non-cohesive), so drag is lower. Paired with
 *              SURFACE_ACCEL=0.35:
 *                1st  28 km/h (gear-limited)
 *                2nd  52 km/h (drag-free: v_eq = 4.2 × 0.35 × 120/3 = 58.8)
 *                3rd  ~45 km/h (v_eq = 3.2 × 0.35 × 120/3 = 44.8)
 *                4th  ~34 km/h    5th  ~25 km/h
 *              Raise toward 5 for deep loose dunes; lower toward 1 for
 *              hard-packed desert track.
 *
 * mud      4   Most punishing surface. Wet clay/silt causes deep wheel-ploughing and
 *              viscous suction when the wheel lifts. Combined with SURFACE_ACCEL=0.35
 *              (weakest engine output) this is the hardest terrain in the game.
 *              Equilibrium by gear at full throttle (power band):
 *                1st  28 km/h (gear-limited: v_eq = 5.5 × 0.35 × 120/4 = 57.8)
 *                2nd  ~44 km/h (drag-limited: v_eq = 4.2 × 0.35 × 120/4 = 44.1)
 *                3rd  ~34 km/h    4th  ~25 km/h    5th  ~19 km/h
 *              Optimal strategy: stay in 2nd on mud. 3rd is possible but slow;
 *              4th+ drain speed. Raising toward 6+ risks the double-penalty trap
 *              (1st-gear-only). Never set above ~5 with SURFACE_ACCEL=0.35.
 * Values before: 0, 4, 0, 7, 8
 * New values: 0, 4, 0, 3, 4
 */
export const SURFACE_DRAG: Record<Surface, number> = {
  asphalt: 0,
  snow: 4,
  ice: 0,
  sand: 3,
  mud: 4,
}

/**
 * Per-surface brake profile — comprehensive braking model.
 *
 * decel:       Base deceleration in km/h/s. Heavy truck = 25-35.
 * speedFade:   How much speed reduces braking (0–1). At 1: zero brakes at MAX_SPEED.
 * lockSpeed:   Above this km/h, wheels tend to lock under full braking.
 * lateralLoss: Lateral grip loss when braking (0=none, 1=total).
 *              Increases further when speed > lockSpeed (locked wheels).
 * sound:       Brake sound type for AY chip.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Brzdný profil povrchu — päť čísel, ktoré spolu hovoria, ako sa na ňom zastavuje.
 *
 * `decel` je surová sila, `speedFade` koľko z nej ubudne pri vysokej rýchlosti,
 * `lockSpeed` odkiaľ sa kolesá začnú blokovať, `lateralLoss` koľko zo zatáčania
 * brzdenie zožerie, a `sound` čo pri tom počuť.
 *
 * **`lateralLoss` je trecí kruh v jednom čísle:** pneumatika má jeden rozpočet sily
 * a čo minie brzda, to nemá zatáčanie. Preto na ľade brzdiť a zatáčať naraz naozaj
 * nejde.
 */
export interface BrakeProfile {
  decel: number
  speedFade: number
  lockSpeed: number
  lateralLoss: number
  sound: 'screech' | 'grind' | 'none'
}

/**
 * Stopping time from 120 km/h (approx):
 *   asphalt: ~10s    snow: ~14s    ice: ~25s+    sand: ~16s    mud: ~15s
 *
 * Compare: car = 3-4s, real 20t truck = 6-8s.
 * We're slightly slower than reality for HEAVY feel.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Brzdný profil pre každý povrch.
 *
 * **Zapísaná nezrovnalosť, ktorá čaká na playtest:** zatáčanie na ľade zodpovedá
 * μ ≈ 0,155, ale `decel` 8 km/h/s zodpovedá μ ≈ 0,227. **Dnes sa na ľade ľahšie
 * zastaví než zatočí, čo je naopak.** Konzistentná hodnota by bola ~5,5, čo posúva
 * brzdnú dráhu zo 40 km/h z ~28 m na ~42 m — reálne číslo pre holý ľad. Je to
 * sprísnenie, takže to potrebuje playtest a kontrolu, či {@link ICE_AHEAD_LOOK_M}
 * stále dáva priestor konať.
 *
 * **↓ nižšie `decel`:** dlhšia brzdná dráha, treba brzdiť skôr.
 * **↑ vyššie `decel`:** kratšia. Pozor — hráčova protizbraň nie je lepšia brzda, je
 * to varovanie: zabrzdiť skoro, v priamom smere, a zákrutu prejsť zotrvačnosťou.
 */
export const SURFACE_BRAKE: Record<Surface, BrakeProfile> = {
  asphalt: { decel: 18, speedFade: 0.40, lockSpeed: 100, lateralLoss: 0.10, sound: 'screech' },
  snow: { decel: 12, speedFade: 0.40, lockSpeed: 55, lateralLoss: 0.30, sound: 'none' },
  // ── Ice: harsh on purpose, and the harshness is the correct model ──────────
  // lateralLoss IS the friction circle. A tyre has one force budget of μ·N, and
  // whatever braking spends is not available to turn; on ice that budget is tiny,
  // so braking and steering at once genuinely does not work. 0.50 already leaves
  // half the wheel, which is generous against the physics.
  //
  // A 0.35 / lockSpeed 45 variant was tried and reverted. It made braking mid-
  // corner work, which is the one thing real ice forbids, and raising lockSpeed
  // had it backwards — wheels lock at LOWER speeds on ice, not higher. The
  // player's counter is not a better brake, it is the ICE AHEAD warning: brake
  // early, in a straight line, then coast the corner.
  //
  // ── KNOWN INCONSISTENCY, worth fixing after a playtest ─────────────────────
  // Cornering implies μ_ice ≈ 0.155 (see SURFACE_CURVE_DRIFT_MULT), but
  // decel 8 km/h/s = 2.22 m/s² implies μ ≈ 0.227. Today it is easier to stop on
  // ice than to turn on it, which is backwards. The consistent value is
  // decel ≈ 5.5, taking the 40 km/h stopping distance from ~28 m to ~42 m — the
  // real figure for bare ice. That is a difficulty increase, so it needs a
  // playtest and a check that ICE_AHEAD_LOOK_M still gives room to act.
  ice: { decel: 8, speedFade: 0.55, lockSpeed: 30, lateralLoss: 0.50, sound: 'grind' },
  sand: { decel: 10, speedFade: 0.30, lockSpeed: 80, lateralLoss: 0.15, sound: 'none' },
  mud: { decel: 11, speedFade: 0.35, lockSpeed: 65, lateralLoss: 0.25, sound: 'none' },
}

/**
 * Per-surface skid enabled flag.
 * On sand: no skid (problem is resistance, not slipperiness).
 * On ice/snow/mud: skid active (slippery).
 *
 * ── SK ──────────────────────────────────────────────────────────────────────
 * Či na povrchu vôbec vzniká zmyk. Piesok ho nemá zámerne — jeho problém je
 * odpor, nie klzkosť, a šmýkajúci sa piesok by bol iný povrch.
 *
 * **false → true:** povrch dostane bočný sklz a s ním aj zvuk. Je to skokový
 * prepínač, nie ciferník: zapnutie na piesku alebo asfalte zmení charakter
 * povrchu, nie jeho obtiažnosť.
 */
export const SURFACE_SKID_ENABLED: Record<Surface, boolean> = {
  asphalt: false,
  snow: true,
  ice: true,
  sand: false,
  mud: true,
}

/**
 * Per-surface steering damping multiplier. Applied on top of grip-based damping.
 * Sand has extra-high damping (steering feels heavy, resists turning).
 *
 * ── SK ──────────────────────────────────────────────────────────────────────
 * Násobič tlmenia riadenia, navrch k tlmeniu z gripu. Rozhoduje o tom, ako
 * **ťažko** sa volant otáča — nie o tom, koľko drží.
 *
 * Pri rovnakom gripe je to práve toto číslo, čo rozhodne poradie povrchov: sneh
 * a blato majú oba grip 0.45, ale blato tlmí 1.5 proti snehovej 1.0, a preto
 * blato drží zákrutu lepšie.
 *
 * **↓ nižšie:** riadenie je ľahšie a reaguje rýchlejšie — auto sa dá hodiť do
 * zákruty, ale aj prehodiť cez ňu.
 * **↑ vyššie:** volant „ťažkne", zákruta chce viac času a viac predvídavosti.
 * Nad ~2.0 už hráč netočí autom, ale presviedča ho.
 */
export const SURFACE_STEER_DAMP_MULT: Record<Surface, number> = {
  asphalt: 1.0,
  snow: 1.0,
  ice: 1.0,
  sand: 2.5,
  mud: 1.5,
}

/**
 * Per-surface multiplier on the centrifugal push out of a curve, scaling
 * {@link CURVE_DRIFT}. See `game/vehicle.ts` — the lateral force block.
 *
 * ── WHY THIS IS A TABLE AND NOT DERIVED FROM GRIP ───────────────────────────
 * It used to be `(1 − grip × 0.7)`, which made ice 0.825 against asphalt's 0.30.
 * Grip was therefore counted twice: once weakening the steering that fights the
 * curve, once strengthening the curve itself. Ice ended up 11× worse than
 * asphalt off a 4× grip difference, and the sharpest curve was unholdable above
 * 13 km/h — see `__tests__/controllability.test.ts`.
 *
 * It was also wrong in principle. Centrifugal force does not depend on grip at
 * all; grip is what lets the tyre resist it, and that already lives in the
 * steering and damping terms. Two effects, two knobs.
 *
 * ── WHERE THE ICE NUMBER COMES FROM ────────────────────────────────────────
 * Maximum cornering force is `μ·g`, so safe curve speed scales as `√μ`. Asphalt
 * holds the sharpest curve (c=2.0) at 85 km/h, so an ice figure of X km/h claims
 * a friction ratio of `(X/85)²`:
 *
 *   40 km/h → μ_ice ≈ 0.155 · bare ice, no studs      ← what we model
 *   45 km/h → μ_ice ≈ 0.19  · studded or chained ice
 *   51 km/h → μ_ice ≈ 0.25  · good winter tyres on ice
 *
 * 0.42 lands ice at 40. A briefly-tried 0.36 gave 45 and measurably drained the
 * tension out of a playtest — it was also quietly claiming studs the truck does
 * not have. Ice being the worst entry here is therefore not double-counting
 * grip; it is the surface genuinely having the least of it.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Násobič odstredivého zmyku v zákrute podľa povrchu.
 *
 * **Toto číslo je odčítané z fyziky, nie zvolené.** Zodpovedá súčiniteľu trenia:
 * 0,42 posadí ľad na 40 km/h v najostrejšej zákrute. Krátko skúšaných 0,36 dalo 45
 * a **merateľne to vypustilo napätie z playtestu** — a zároveň to ticho tvrdilo, že
 * kamión má hroty, ktoré nemá.
 *
 * **↓ nižšie:** povrch drží v zákrute lepšie, dá sa cez ňu ísť rýchlejšie.
 * **↑ vyššie:** vytláča von. Ľad je tu najvyšší zámerne a nie je to dvojité počítanie
 * gripu — je to povrch, ktorý ho má naozaj najmenej.
 */
export const SURFACE_CURVE_DRIFT_MULT: Record<Surface, number> = {
  asphalt: 0.30,
  snow: 0.36,
  ice: 0.42,
  sand: 0.38,
  mud: 0.35,
}

/**
 * Per-surface fuel consumption multiplier.
 * Sand/mud burn more (engine works harder). Ice burns slightly less (low resistance).
 *
 * ── SK ──────────────────────────────────────────────────────────────────────
 * Násobič spotreby. Piesok a blato žerú viac (motor pracuje ťažšie), ľad menej.
 *
 * **Vedz, kde je strop:** spotreba nemôže hrýzť pod ~87 km/h, lebo horenie je
 * kvadratické v rýchlosti, ale *čas* na kilometer je nepriamo úmerný — pri
 * dnešných 39 km/h je palivo daň, nie rozhodnutie. Zdvihnutie týchto čísel to
 * nezmení, len urobí tankovanie častejším.
 *
 * **↓ nižšie:** povrch prestane stáť palivo, kanistre sa stanú zbytočnými.
 * **↑ vyššie:** dlhý úsek povrchu vyprázdni nádrž — sand bol na 1.5 a dva veľké
 * úseky brali 36 % nádrže, čo bolo priveľa na to, aby sa s tým dalo počítať.
 */
export const SURFACE_FUEL_MULT: Record<Surface, number> = {
  asphalt: 1.0,
  snow: 1.2,
  ice: 0.9,
  sand: 1.2,  // was 1.5 — two large sand segments were eating 36% of tank
  mud: 1.3,
}

/** Per-surface tire wear rate multiplier (future mechanic).
 *
 * ── SK ──────────────────────────────────────────────────────────────────────
 * Násobič opotrebenia pneumatík. **Zatiaľ ho nikto nečíta** — je to príprava na
 * mechaniku, ktorá príde s pit-stopom. Meniť ho dnes nemá žiadny účinok.
 */
export const SURFACE_WEAR: Record<Surface, number> = {
  asphalt: 1.0,
  snow: 1.6,
  ice: 2.5,
  sand: 1.8,
  mud: 1.4,
}

/** Probability weights for surface generation (~sums to 1.0).
 *
 * ── SK ──────────────────────────────────────────────────────────────────────
 * Váhy pri generovaní povrchov, dokopy ~1.0. Toto rozhoduje, **z čoho je trasa
 * vyrobená**, nie aká je ťažká.
 *
 * Jedna vec, ktorá sa inak nahlási ako chyba: 5 km obsahuje asi **päť**
 * neasfaltových úsekov (`START_ASPHALT_M` zožerie prvý kilometer a po každej
 * prekážke nasleduje regeneračný asfalt), takže na jednej trase to skoro vždy
 * vyzerá, že jeden povrch prevláda. Hash je nestranný — overené proti tejto
 * tabuľke na 0,3 percentuálneho bodu.
 *
 * **↓ nižšie u povrchu:** objaví sa zriedkavejšie; pri malých číslach ho na
 * jednej trase nemusíš stretnúť vôbec.
 * **↑ vyššie:** častejšie. Pozor, dĺžku úseku to nemení — tú drží
 * `SURFACE_LENGTH_RANGE`, a preto ľad *vyzerá* zriedkavejší, než je: jeho úseky
 * sú o polovicu kratšie než ostatné.
 */
export const SURFACE_PROBABILITY: Record<Surface, number> = {
  asphalt: 0.30,
  snow: 0.22,
  ice: 0.22,
  sand: 0.10,
  mud: 0.16,
}
