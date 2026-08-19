/**
 * The truck: what it weighs, what the engine does, and everything between the
 * crank and the road.
 *
 * Kept together because they are tuned together — a gear ratio that feels wrong
 * is usually a torque curve that is wrong, and neither can be judged without the
 * clutch behaviour beside it.
 */

import type { Surface } from './surfaces.ts'

/**
 * Truck gross weight in tonnes. Displayed on dashboard and used as the starting
 * weight. The cargo system will eventually vary it; for now the W debug key cycles
 * {@link TRUCK_WEIGHTS_T}.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Hmotnosť kamióna v tonách (20).
 *
 * Vstupuje do zrýchlenia aj brzdenia — ťažší kamión sa rozbieha aj zastavuje horšie.
 *
 * **↓ nižšie:** hbitejší stroj. Pod ~10 t prestane hra pôsobiť ako ťahanie nákladu
 * a začne byť pretekárska.
 * **↑ vyššie:** ťažší a zotrvačnejší. Nad ~30 t sa každá zákruta stane plánovaním
 * na sto metrov dopredu — čo je zaujímavé, ale mení to hru na inú.
 */
export const TRUCK_WEIGHT_T = 20

/**
 * Tuning baseline gross weight in tonnes. At this mass `massAccelMult` (see
 * `game/vehicle.ts`) returns 1.0, so every hand-tuned GEARS/ACCEL value keeps its
 * current feel. Heavier than this accelerates slower, lighter quicker.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Referenčná hmotnosť, voči ktorej sa hmotnostné násobiče počítajú. Meniť ju
 * znamená posunúť *všetky* hmotnosti naraz — obyčajne nie to, čo chceš.
 */
export const REFERENCE_MASS_T = 20

/**
 * Debug weight presets cycled by the W key: light cab / standard / heavy load.
 * 20 t is the default ({@link TRUCK_WEIGHT_T}) so the cycle starts at today's feel.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Hmotnosti, ktoré si hráč bude môcť vybrať, keď príde nakladanie. Zatiaľ príprava.
 */
export const TRUCK_WEIGHTS_T = [10, 20, 30] as const

/**
 * Maximum forward speed in km/h (dial range 0–120).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Maximálna rýchlosť kamióna, km/h (120).
 *
 * **Je to referenčná rýchlosť pre polovicu fyziky** — aerodynamický odpor, brzdný
 * útlm aj plánovač sa počítajú ako podiel z nej. Nie je to len strop.
 *
 * **↓ nižšie:** všetko sa spomalí, ale aj odpory zosilnejú, lebo sa merajú voči nej.
 * **↑ vyššie:** vyšší strop, ktorý beztak nedosiahneš — 5. stupeň končí na 130 a
 * ostatné povrchy na štyridsiatkach.
 */
export const MAX_SPEED = 120

/**
 * Base throttle acceleration in km/h per second (on asphalt).
 * 20t truck: real ~2 km/h/s, we use 8 for gameplay (0→120 in ~15s).
 * Still feels heavy — you plan overtakes well in advance.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Základné zrýchlenie motora, ktoré ešte škáluje prevodový stupeň a povrch.
 *
 * **↓ nižšie:** rozjazd je bolestivý a preraďovanie stráca zmysel, lebo sa nemáš
 * čím rozbehnúť.
 * **↑ vyššie:** rezkejšie. Nad ~15 prestane byť ťažká akcelerácia témou — a práve tá
 * je dôvodom, prečo hra má manuálnu prevodovku.
 */
export const ACCEL = 8

/**
 * Steering lateral acceleration at grip=1 (units/s²).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako rýchlo volant naberá bočnú rýchlosť.
 *
 * **↓ nižšie:** riadenie je lenivé, reakcia príde neskoro.
 * **↑ vyššie:** ostrejšie. Nad ~6 sa kamión začne správať ako auto a stratí sa
 * pocit dvadsiatich ton.
 */
export const STEER_ACCEL = 3.2

/**
 * Lateral velocity damping per second at grip=1 (no steering input).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako rýchlo bočná rýchlosť sama odumiera.
 *
 * Toto je to, čo drží kamión v stope, keď pustíš volant. Na ľade je zoslabené
 * gripom, a preto zmyk pokračuje.
 *
 * **↓ nižšie:** vybočenie trvá dlhšie a treba ho korigovať — presne to robí ľad.
 * **↑ vyššie:** kamión sa sám narovná. Pri vysokých hodnotách sa zmyk nedá vyvolať
 * ani na ľade a hra stratí svoju hlavnú hrozbu.
 */
export const STEER_DAMP = 5.0

/**
 * Max lateral velocity (clamp).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Strop bočnej rýchlosti.
 *
 * **↓ nižšie:** vybočiť sa dá len málo, cesta je bezpečnejšia.
 * **↑ vyššie:** dá sa preletieť cez celú cestu jedným pohybom. Spolu so
 * {@link STEER_DAMP} to určuje, ako ďaleko ťa zmyk vôbec vie odniesť.
 */
export const MAX_LATERAL_V = 2.5

/**
 * Aerodynamic drag (km/h/s at MAX_SPEED). Scales with speed².
 * Real 20t truck at 120 km/h: ~0.86 km/h/s. We use 0.5 for heavy feel.
 *
 * Applies on every surface, which is what guarantees speed decays without
 * throttle even on asphalt — nothing else in the model does that.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Aerodynamický odpor, km/h/s pri {@link MAX_SPEED}. Rastie s druhou mocninou
 * rýchlosti.
 *
 * **↓ nižšie:** kamión sa vezie ďalej a vysoké rýchlosti sú lacnejšie.
 * **↑ vyššie:** rýchlosť sa platí. Je to jediná vec, ktorá garantuje, že bez plynu
 * rýchlosť klesá aj na asfalte.
 */
export const AERO_DRAG = 0.5

/**
 * Rolling resistance (km/h lost per km/h of speed per second).
 * Real truck Crr ≈ 0.007 → ~0.25 km/h/s at 120.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Valivý odpor — km/h za sekundu na každý km/h rýchlosti.
 *
 * Malý, ale platí všade. Reálny kamión má Crr ≈ 0.007, čo je ~0,25 km/h/s pri 120.
 *
 * **↓ nižšie:** kamión sa ešte viac vezie zotrvačnosťou.
 * **↑ vyššie:** rýchlosť odpadá aj bez plynu — v kombinácii s
 * {@link AERO_DRAG} sa to sčítava a stroj prestane kĺzať.
 */
export const ROLLING_RESISTANCE = 0.001

/**
 * Engine braking when throttle released (km/h/s at MAX_SPEED).
 * Minimal for a 20t truck in gear — mass dominates over engine friction.
 * The truck GLIDES. You must brake manually to stop.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Brzdenie motorom po pustení plynu, km/h/s pri {@link MAX_SPEED}.
 *
 * Minimálne pre 20 t v zaradenom stupni — hmotnosť prevláda nad trením motora.
 * **Kamión sa vezie.** Zastaviť ho musíš brzdou.
 *
 * **↓ nižšie:** ešte viac sa vezie; pustenie plynu prestane byť nástrojom.
 * **↑ vyššie:** pustenie plynu sa stane brzdou. Nad ~2 sa z hry vytratí potreba
 * brzdiť vopred, čo je jej ústredná myšlienka.
 */
export const ENGINE_BRAKE = 0.3

/**
 * Speed reduces steering (0–1). At 0.6: steering at MAX is 40% of standstill.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * O koľko sa riadenie stráca s rastúcou rýchlosťou.
 *
 * **↓ nižšie:** aj pri 120 km/h sa dá zatáčať naplno — nerealistické a bezpečné.
 * **↑ vyššie:** pri vysokej rýchlosti kamión takmer nezatáča. Je to jediná vec, ktorá
 * robí z rýchlej jazdy záväzok a nie voľbu.
 */
export const SPEED_STEER_PENALTY = 0.6

/**
 * Per-surface slip peak: lateral velocity where grip is maximum.
 * Below peak: full grip. Above peak: grip drops with 1/x² (oversteer).
 * Low = slippery (ice 0.20). High = stable (asphalt 0.90).
 * Replaces binary SKID_THRESHOLD with a realistic tire grip curve.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Kde na povrchu leží vrchol sklzu — pri akom pomere sa trakcia láme.
 *
 * **↓ nižšie:** povrch stráca priľnavosť skôr, roztočiť kolesá je ľahšie.
 * **↑ vyššie:** znesie viac, než sa začne šmýkať.
 */
export const SURFACE_SLIP_PEAK: Record<Surface, number> = {
  asphalt: 0.90,
  snow: 0.35,
  ice: 0.25,
  sand: 0.50,
  mud: 0.30,
}

/**
 * Manual 5-speed gearbox. Each gear is defined by its top speed `to` (km/h) and a
 * peak throttle torque `accel` (km/h/s at full power).
 *
 * Design intent:
 *   - Low gears: strong pull, low top speed. You MUST shift up to go fast.
 *   - High gears: high top speed, weak pull. Drivable from low speed but slow.
 *   - First gear tops out at ~28 km/h — it physically cannot reach 120.
 *
 * RPM is proportional to road speed within the gear, exactly like a real engine:
 *   rpm = speed / gear.to     (0 at standstill, 1.0 = redline at the gear's top)
 * It never goes negative; the dashboard shows it raw, so it CAN drop to 0 bars when you
 * lug. Torque over rpm — the power band starts high (BOG_RPM), so a too-tall gear pulls
 * weakly even before it lugs:
 *     rpm < BOG_RPM       low end → weak; floored at BOG_FLOOR. A too-tall gear is sluggish.
 *     BOG_RPM..POWER_RPM  power band → full torque
 *     POWER_RPM..1        approaching redline → torque tapers
 *     rpm >= 1            redline → no pull, must upshift
 *
 * Acceleration is deliberately slow: reaching top speed means shifting up through
 * every gear and takes ~30 s of clean driving.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Jeden prevodový stupeň: rozsah rýchlosti, zrýchlenie a strop pre synchronizované
 * podradenie.
 *
 * `maxSpeedToShift` je **plne konfiguračné**: samé čísla dajú plne synchronizovanú
 * prevodovku, samé `null` prevodovku bez synchronov.
 */
export interface GearSpec {
  /** Top speed reachable in this gear (km/h); also the redline reference for rpm. */
  to: number
  /** Peak throttle acceleration in this gear (km/h/s) at full torque. */
  accel: number
  /**
   * Synchro limit — the maximum road speed (km/h) at which you may DOWNSHIFT into
   * this gear. `null` = no synchro (engage at any speed). A number engages the
   * limiter: dropping into the gear above this speed is refused (grind). Set every
   * gear to `null` to remove synchro entirely, or all to numbers for a fully
   * synchro'd box — the logic is purely config-driven.
   */
  maxSpeedToShift: number | null
}

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Päť stupňov — jadro hry, nie doplnok.
 *
 * Každý stupeň má strop rýchlosti (**jednotka končí na ~28 km/h, takže sa fyzicky
 * nedá ísť 120 v jednotke**) a momentové pásmo, ktoré vidíš na otáčkomeri.
 *
 * **↓ nižšie stropy:** viac radenia, kratšie pásma, hektickejšia jazda.
 * **↑ vyššie stropy:** menej radenia. Pri veľkých pásmach prestane mať prevodovka
 * zmysel a hra sa stane automatom.
 *
 * Podradzovacie limity (1. pod 35 km/h, 2. pod 60, 3. pod 85) sú to, čo ti dovolí
 * schádzať prevodovkou nadol počas brzdenia pred ľadom bez toho, aby si vletel do
 * stupňa, ktorý sa hneď pretočí.
 */
export const GEARS: readonly GearSpec[] = [
  { to: 28, accel: 5.5, maxSpeedToShift: 35 },   // 1 — pull away; synchro: engage only below 35
  { to: 52, accel: 4.2, maxSpeedToShift: 60 },   // 2 — synchro: engage only below 60
  { to: 76, accel: 3.2, maxSpeedToShift: 85 },   // 3 — main cruising gear; synchro: below 85
  { to: 100, accel: 2.4, maxSpeedToShift: null }, // 4 — non-synchro, engage at any speed
  { to: 130, accel: 1.8, maxSpeedToShift: null }, // 5 — top gear; MAX_SPEED caps real speed at 120
]

/**
 * Number of forward gears.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Počet stupňov. Odvodené z {@link GEARS}.
 */
export const GEAR_COUNT = GEARS.length

/**
 * Real engine revs shown on the tachometer at redline (`rpm` fraction 1.0). Display only.
 * With 2600 the lug line (LUG_RPM 0.25) reads ~650 rpm — matching "below ~800 you lug".
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Na aké otáčky sa pomer prepočíta pre ciferník (2600).
 *
 * Iba zobrazenie — fyzika pracuje s pomerom 0–1. Meniť len ak chceš, aby otáčkomer
 * ukazoval iné čísla.
 */
export const RPM_DISPLAY_REDLINE = 2600

/**
 * Below this rpm the engine is off the power band → weak torque (floored at BOG_FLOOR).
 * Raised so a too-tall gear (5th at 30 km/h ≈ 0.23) pulls sluggishly, not at full power.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Pod týmto pomerom otáčok motor stráca ťah kvadraticky.
 *
 * **↓ nižšie:** motor ťahá aj z nízkych otáčok — prevodovka odpúšťa.
 * **↑ vyššie:** treba držať otáčky hore. Nad ~0.6 sa z každého preradenia stane
 * riziko, že si spadol pod pásmo.
 */
export const BOG_RPM = 0.50

/**
 * Torque multiplier floor at idle / when lugging — diesel low-end grunt.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Koľko ťahu zostane úplne dole (0.12).
 *
 * **↓ nižšie:** pri nízkych otáčkach nemáš prakticky nič a rozjazd zo zastavenia
 * na kopci je nemožný.
 * **↑ vyššie:** motor ťahá aj v podťahu a lug prestane byť trestom.
 */
export const BOG_FLOOR = 0.12

/**
 * Top of the flat power band; above this, torque tapers toward redline.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Kde leží vrchol momentu (0.82 pomeru).
 *
 * **↓ nižšie:** sila je nižšie v pásme, radí sa skôr.
 * **↑ vyššie:** treba vytáčať bližšie k červenej — odvážnejšia jazda, ale bližšie
 * k prepálenému motoru.
 */
export const POWER_RPM = 0.82

/**
 * Torque multiplier just before redline (rpm → 1).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Koľko ťahu zostane za červenou.
 *
 * **↓ nižšie:** pretočený motor prestane ťahať úplne a sám sa spomalí.
 * **↑ vyššie:** dá sa jazdiť na červenej bez straty — čo z prevodovky spraví
 * ozdobu.
 */
export const REDLINE_FLOOR = 0.10

/**
 * Engine-braking pull (km/h/s) applied when speed sits above the current gear's
 * top (e.g. you downshifted at speed). Compression drags you back to the gear top.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako silno motor brzdí, keď si v priveľmi nízkom stupni.
 *
 * **↑ vyššie:** podradenie do nízkeho stupňa pri vysokej rýchlosti kamión doslova
 * zahryzne. Je to trest za nedbanlivé radenie — a zároveň nástroj, ak vieš, čo robíš.
 */
export const OVERREV_ENGINE_BRAKE = 7

/**
 * Lug threshold on rpm (`speed / gear.to`). Below this in a gear the engine lugs toward a
 * stall — you slowed/braked or sat in too tall a gear without downshifting. First gear is
 * exempt (you can always idle and pull away in 1st). With `LUG_RPM = 0.25` (≈ 650 rpm):
 * 2nd lugs below ~13 km/h, 3rd below ~19, 4th below ~25, 5th below ~32 — so cruising 30 in
 * 5th lugs and pressures you to downshift. A stalled engine must be restarted with ENTER.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Pod týmito otáčkami motor zhasne (0.25 ≈ 650 ot./min).
 *
 * Jednotka je proti tomu imúnna. Reálne to znamená, že **jazda 30 km/h v päťke motor
 * uškrtí** — musíš podradiť.
 *
 * **↓ nižšie:** motor znesie viac podťahu a prevodovka prestane byť hrozbou.
 * **↑ vyššie:** zhasína ochotne. Nad ~0.35 začne kamión hasnúť aj pri bežnom
 * spomalení pred zákrutou, čo je frustrujúce, nie ťažké.
 */
export const LUG_RPM = 0.25

/**
 * Grace period (ms) the engine lugs and **coughs** with an "ENGINE STALLING"
 * warning before it actually dies — time for the driver to downshift. Long
 * enough to react mid-corner on snow while braking (≈ 3.5 s).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako dlho motor kašle, než zhasne (3500 ms).
 *
 * **↓ nižšie:** menej času zareagovať; varovanie prestane byť varovaním.
 * **↑ vyššie:** viac času podradiť. Pri veľkých hodnotách sa dá lug ignorovať.
 */
export const STALL_GRACE_MS = 3500

/**
 * rpm at/above which the engine is on the redline (sitting at the gear's ceiling).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Od akého pomeru sa motor považuje za pretočený.
 */
export const REDLINE_RPM = 0.95

/**
 * Milliseconds held at the redline UNDER THROTTLE before the engine burns out
 * (stalls). At redline you're already at the gear's top and not accelerating, so
 * this is the backstop for refusing to upshift, not a twitch timer. Only applies
 * in gears you can upshift out of — the top gear's redline is just the limiter.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako dlho vydrží na červenej, než sa uvarí (6000 ms).
 *
 * Platí len v stupňoch, z ktorých sa dá preradiť nahor — červená v najvyššom stupni
 * je len obmedzovač a je bezpečná.
 *
 * **↓ nižšie:** prísnejšie; nevšimnutá červená znamená koniec.
 * **↑ vyššie:** dá sa na nej jazdiť. Pri veľmi vysokých hodnotách prestane mať
 * zmysel preraďovať nahor.
 */
export const REDLINE_BURN_MS = 6000

/**
 * Delay (ms) at the redline before the audible "SHIFT UP" buzzer starts, so normal
 * quick upshifts through the gears don't blare an alarm every time.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako dlho trvá, než sa varovanie o červenej objaví.
 *
 * **↓ nižšie:** varuje hneď, aj pri krátkom vytočení pri preradení — otravné.
 * **↑ vyššie:** varuje neskoro a zostane menej času konať.
 */
export const REDLINE_WARN_DELAY_MS = 900

/**
 * Milliseconds ENTER must be held to crank the engine to a start.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako dlho treba držať ENTER na naštartovanie (1800 ms).
 *
 * **↓ nižšie:** reštart je formalita a zhasnutie prestane byť trestom.
 * **↑ vyššie:** ťažšie. Nad ~3 s sa zo zhasnutia stane koniec jazdy, aj keď to hra
 * nikde nepovie.
 */
export const CRANK_NEEDED_MS = 1800

//
// The clutch is the one thing that lets the engine and the wheels turn at
// DIFFERENT speeds. Before it existed, `rpm` was a pure function of road speed
// (`speed / gear.to`) — engine welded to the drivetrain. Now the engine carries
// its own revs (`Vehicle.engineRpm`) whenever SHIFT is held.
//
// THE SKILL IS REV-MATCHING, NOT TIMING. There is deliberately no "correct"
// number of milliseconds to hold the pedal. The clean release point is wherever
// the engine's revs equal what the wheels will demand in the gear you selected:
//
//     targetRpm = speed / GEARS[gear].to
//
// That target MOVES while you are declutched, because a truck in neutral is
// still slowing down — fast on mud (SURFACE_DRAG), barely at all on asphalt,
// and differently again under braking or with 30 t behind you. So the window is
// situational by construction; none of it is special-cased.
//
// Direction matters and falls out of the gear table for free. Downshifting
// raises the demanded revs (3rd→2nd at 50 km/h: 0.59 → 0.96), so you must BLIP
// THE THROTTLE while declutched or the wheels will drag the engine up and the
// truck lurches — that is a real double-clutch. Upshifting lowers them, so you
// simply wait for the revs to fall.

/**
 * Idle revs (rpm fraction) the engine settles to when declutched off throttle.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Otáčky, na ktoré motor spadne pri zošliapnutej spojke.
 */
export const CLUTCH_IDLE_RPM = 0.20

/**
 * Governed no-load rpm under full throttle with the clutch disengaged.
 * A truck diesel cannot free-rev through its limiter; 0.90 leaves deliberate
 * headroom below {@link REDLINE_RPM} while still covering normal downshift
 * targets inside {@link CLUTCH_MATCH_TOLERANCE}.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Strop otáčok pri zošliapnutej spojke — obmedzovač, ktorý bráni prevýšeniu.
 */
export const CLUTCH_GOVERNOR_RPM = 0.90

/**
 * First-order engine response toward idle/governed rpm, in 1/s.
 * Applied through `1 - exp(-response * dt)`, so a long frame cannot overshoot
 * and the same elapsed time gives the same response at every frame rate.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako rýchlo motor reaguje na plyn pri zošliapnutej spojke.
 *
 * **↓ nižšie:** medziplyn trvá dlho a preradenie sa naťahuje.
 * **↑ vyššie:** motor reaguje okamžite; zrovnanie otáčok je ľahšie.
 */
export const CLUTCH_REV_RESPONSE = 3.0

/**
 * Mismatch (|engineRpm − targetRpm|) inside which a release counts as CLEAN: no
 * jolt at all. Wide enough that a deliberate rev-match is reliably rewarded,
 * narrow enough that mashing SHIFT without looking is not.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako presne treba trafiť otáčky pri púšťaní spojky (0.10).
 *
 * **↓ nižšie:** treba trafiť presne — plynulé radenie sa stane zručnosťou.
 * **↑ vyššie:** stačí približne. Nad ~0.3 prestane mať medziplyn zmysel.
 */
export const CLUTCH_MATCH_TOLERANCE = 0.10

/**
 * Speed shock (km/h) per unit of rpm mismatch when the clutch bites badly.
 * Engine slower than the wheels demand → the drivetrain drags the truck down;
 * faster → a brief shove. Scaled by mass at the call site: a 30 t load shrugs
 * off the same mismatch that snaps a 10 t cab.
 *
 * Small on purpose, and it was not at first. The mass ratio here is about
 * 1000:1 — spinning an engine's flywheel up cannot meaningfully slow twenty
 * tonnes, so **the engine follows the truck, not the other way round.** At the
 * original 26 a driver who merely dipped the pedal and let it out again in the
 * SAME gear lost 6.7 km/h, which made SHIFT feel like a brake pedal (owner,
 * 2026-08-01). At 6 that same dip costs ~1.5 km/h: a jerk you feel and do not
 * plan around.
 *
 * The mechanic keeps its teeth elsewhere, which is where they belong: you are
 * coasting the whole time the pedal is down (no drive, no engine braking), and
 * a release into a gear that cannot sustain the speed still kills the engine.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Aký šok dostane prevodovka pri zlom zrovnaní otáčok.
 *
 * **↓ nižšie:** zlé radenie nič nestojí.
 * **↑ vyššie:** kopne to. Je to jediná spätná väzba, ktorá učí radiť poriadne — ale
 * pri vysokých hodnotách je z každej chyby stratený rozbeh.
 */
export const CLUTCH_SHOCK = 6

/**
 * How much of an OVER-revved bite reaches the road (the rest is wheelspin and a
 * slipping plate). The two directions are deliberately asymmetric.
 *
 * Engine slower than the wheels demand is a rigid coupling: 20 tonnes of truck
 * wins, the engine is dragged up, and the truck really does lose that speed.
 * Engine faster is not symmetric — a dumped clutch spins the wheels and cooks
 * the friction plate; almost none of those revs become road speed.
 *
 * Found by driving it (2026-08-01): at 1.0 the first real test lurched from
 * 3 km/h to 30 km/h on one dumped clutch, which made revving in neutral and
 * side-stepping the pedal *faster* than driving properly. A launch should feel
 * like a lurch, not like a gear you skipped.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Koľko ťahu prejde pri rozjazde s čiastočne pustenou spojkou.
 *
 * **↓ nižšie:** rozjazd z miesta je tvrdší a treba naň cit.
 * **↑ vyššie:** kamión sa rozbehne aj bez práce so spojkou.
 */
export const CLUTCH_LAUNCH_FRACTION = 0.15

/**
 * Engine revs below which letting the clutch out kills the motor on the spot,
 * with none of the STALL_GRACE_MS cough the gradual lug gets.
 *
 * A floor, not a mismatch — that was the first attempt and it was the wrong
 * question. Whether the engine survives depends on WHERE IT LANDS, not on how
 * far it fell: dip the pedal at 10 km/h with 5th selected and the wheels can
 * only turn it at 0.08, so twenty tonnes drag the motor under idle and it dies,
 * even though the engine was merely idling and the "mismatch" was tiny.
 *
 * Set at 60 % of LUG_RPM so the mercy sits in the right place: land a little
 * under the lug line (18 km/h in 3rd → 0.24) and you still get the normal
 * warning and 3.5 s to fix it; land nowhere near it and you have simply killed
 * the engine, which is exactly what happens in the cab. Never fires in 1st.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Otáčky, pod ktorými zhasne aj pri zošliapnutej spojke. Odvodené z
 * {@link LUG_RPM} — držané pod ním zámerne, aby spojka bola východisko, nie pasca.
 */
export const CLUTCH_STALL_RPM = LUG_RPM * 0.6

// export const FUEL_BURN_RATE = 0.00012  // original — tight but completable with canisters
/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Základná spotreba paliva.
 *
 * **Vedz, kde je strop:** horenie je kvadratické v rýchlosti, ale čas na kilometer
 * je nepriamo úmerný, takže **palivo nemôže hrýzť pod ~87 km/h**. Pri dnešných
 * 39 km/h je to daň, nie rozhodnutie, a zdvihnutie tohto čísla to nezmení — len
 * urobí tankovanie častejším.
 *
 * **↓ nižšie:** palivo prestane existovať.
 * **↑ vyššie:** nádrž na kratšie. Ak má byť palivo rozhodnutím, páka je
 * {@link CANISTER_X_RANGE}, nie toto.
 */
export const FUEL_BURN_RATE = 0.000110

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Pod akou rýchlosťou sa spotreba počíta ako voľnobeh.
 */
export const FUEL_IDLE_THRESHOLD = 5
