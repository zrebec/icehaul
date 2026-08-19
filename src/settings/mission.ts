/**
 * The job: the clock read off the road ahead, the drop-offs, and the fuel economy
 * that pays for them.
 *
 * Canisters are here rather than with the road because the planner prices them:
 * a leg's budget already assumes a share of them will be taken, so the two sets
 * of numbers cannot be moved independently.
 */

import type { Surface } from './surfaces.ts'

/**
 * Average spacing between fuel canisters on the road (metres).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Priemerný rozostup kanistrov na ceste.
 *
 * **↓ nižšie:** palivo prestane byť téma úplne — a už dnes ňou nie je.
 * **↑ vyššie:** kanistre sa stanú udalosťou. Pozor: rozpočet času s nimi **počíta**
 * (viď {@link PLAN_EXPECTED_CANISTER_PCT}), takže zriedenie kanistrov sprísni aj
 * hodiny, nielen palivo.
 */
export const CANISTER_SPACING_M = 700

/**
 * Random variation on canister spacing: actual = spacing × (1 ± this).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Náhodné rozhádzanie rozostupu kanistrov (±podiel).
 */
export const CANISTER_SPACING_JITTER = 0.4

/**
 * Lateral position range for canisters: 0 = centre, 1.0 = road edge.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Kde naprieč cestou kanistre ležia.
 *
 * **Toto je páka, ktorá z paliva spraví rozhodnutie.** Dnes ležia tak, že sa dajú
 * brať mimochodom. Keby ležali pri krajnici, v zákrute alebo na ľade, zbieranie by
 * niečo stálo — a to je presne to, čo z dane robí voľbu.
 */
export const CANISTER_X_RANGE = 0.9

/**
 * Fuel added per canister pickup (fraction of full tank). 1 segment = 1/5.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Koľko paliva jeden kanister doplní (podiel nádrže).
 *
 * **↓ nižšie:** treba ich viac, palivo je tesnejšie.
 * **↑ vyššie:** jeden kanister vyrieši etapu. Nad ~0.4 prestane mať zmysel brať
 * druhý.
 */
export const CANISTER_FUEL = 1 / 5

/**
 * Pickup distance threshold in player.x units (how close you must be).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako presne treba na kanister trafiť naprieč cestou.
 *
 * **↓ nižšie:** treba mieriť — spolu s {@link CANISTER_X_RANGE} je to celý
 * mechanizmus toho, či je zbieranie zručnosť alebo formalita.
 * **↑ vyššie:** stačí ísť približne tade.
 */
export const CANISTER_PICKUP_RADIUS = 0.25

/**
 * World-distance tolerance for pickup (metres ahead/behind truck).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako hlboko v smere jazdy sa kanister ešte počíta ako zobratý.
 *
 * **↓ nižšie:** pri vysokej rýchlosti sa dá cez kanister preletieť bez toho, aby si
 * ho zobral — simulácia ho preskočí medzi dvoma tikmi.
 * **↑ vyššie:** bezpečnejšie, ale zbieranie prestane byť presné.
 */
export const CANISTER_PICKUP_DEPTH_M = 15

/**
 * Low-fuel warning threshold (fraction 0–1). Below this: blink + beep.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Podiel nádrže, pod ktorým sa rozsvieti varovanie.
 */
export const LOW_FUEL_WARN = 0.20

/**
 * Critical fuel threshold. Below this: faster blink + urgent beep.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Podiel nádrže, pod ktorým varovanie zrýchli a zvážnie.
 *
 * **↓ nižšie:** varuje neskoro a hráč nestihne nič urobiť.
 * **↑ vyššie:** varuje skoro. Nad ~0.3 svieti skoro stále a prestane byť varovaním.
 */
export const LOW_FUEL_CRITICAL = 0.10

/**
 * Low-fuel warning beep cooldown (seconds).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Odstup pípnutí pri nízkom palive.
 */
export const LOW_FUEL_BEEP_COOLDOWN_S = 0.8

/**
 * Critical fuel beep cooldown (faster).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Odstup pípnutí pri kritickom palive — kratší, a to je celá jeho práca.
 */
export const LOW_FUEL_CRIT_BEEP_COOLDOWN_S = 0.4

//
// The route is a deterministic function of the seed, so the game knows what is
// coming before the player does: which surfaces, how long, how tight the bends.
// The delivery clock is built from *that* rather than from a flat pace, which
// means a leg over ice is granted the time ice costs, and a leg over asphalt is
// not granted time it does not need.
//
// A flat pace punishes **slowness**. A route-aware budget punishes **caution**.
// An ice route becomes calmer (the plan knows you must crawl) and an asphalt
// route becomes tense (the plan expects you to use the grip you have). That is
// Fox's decision, made with the consequence in front of him, and it is the whole
// point of the feature — not a side effect to tune away later.
//
// `completability.test.ts` drives a deliberately crude human heuristic and its
// own comment explains why: a bot steering by the physics it is meant to audit
// proves nothing. The same trap sits here, one level up. **The planner and the
// bot must not share a single constant.** The planner is physics-anchored; the
// bot stays a human guess; the slack below is calibrated by running one against
// the other.

/**
 * Reference speed for the safe-speed law, km/h.
 *
 * Not invented — read off the measured envelope in `controllability.test.ts`.
 * That table has twenty cells (five surfaces x four curvatures) and one formula
 * reproduces all of them to within about 5 %:
 *
 *     v_safe = min(MAX_SPEED, PLAN_V_REF / sqrt(max(c, PLAN_C_MIN)) * sqrt(grip))
 *
 *     surface   c=2 measured   formula     grip
 *     asphalt        85          84.9      1.00
 *     snow           55          56.9      0.45
 *     ice            40          42.4      0.25
 *     sand           50          50.2      0.35
 *     mud            60          56.9      0.45
 *
 * The `sqrt(grip)` half is not a fit, it is the friction circle — `AGENTS.md`
 * already argues that safe curve speed scales as `sqrt(mu)` when it explains why
 * ice holds 40 and not 45.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Referenčná rýchlosť zákona bezpečnej rýchlosti, km/h.
 *
 * **Nie je vymyslená — je odčítaná** z nameranej obálky v `controllability.test.ts`.
 * Tá tabuľka má dvadsať buniek (päť povrchov × štyri zakrivenia) a jeden vzorec ich
 * reprodukuje do ~5 %.
 *
 * **↓ / ↑:** posúva celý rozpočet naraz. Meniť len vtedy, keď sa zmení fyzika a
 * zmeria sa nová obálka — inak plánovač prestane hovoriť o hre, ktorú hráš.
 */
export const PLAN_V_REF = 120

/**
 * Curvature floor for the law above. Below this the formula would divide by
 * almost nothing and hand a straight road an infinite speed; `MAX_SPEED` caps it
 * anyway, and this keeps the arithmetic finite rather than relying on the cap.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Spodná hranica zakrivenia v tom vzorci.
 *
 * Bez nej by rovná cesta dostala nekonečnú rýchlosť. `MAX_SPEED` to aj tak zastropuje,
 * ale toto drží aritmetiku konečnú namiesto spoliehania sa na strop.
 */
export const PLAN_C_MIN = 0.35

/**
 * Highest speed the truck can actually hold on each surface, km/h.
 *
 * The cornering law above answers "how fast may I go round this bend" and says
 * nothing about drag — on sand and mud the truck cannot reach 120 on a straight,
 * so a sandy leg would be handed a budget nobody could drive. These are measured
 * by `routeplan.test.ts`, which runs the real `tickVehicle` flat out on a
 * straight and fails if any number here is optimistic by more than 2 km/h — the
 * sweep stops when ten seconds of throttle buys under 0.05 km/h, so it lands
 * just under the true asymptote. Deliberately measured
 * rather than copied from the completability bot's strategy table — see the
 * no-shared-constants rule above.
 *
 * The numbers were a surprise and are the reason the measurement exists:
 *
 *     asphalt  120.0    ice  120.0    snow  45.7    sand  44.4    mud  41.0
 *
 * **Snow, sand and mud top out in the forties.** The lateral envelope says snow
 * holds the road at 120 through a gentle bend, and that is true and irrelevant —
 * the truck cannot get there, because `SURFACE_DRAG` takes the engine's output
 * long before the bend does. A plan built on the cornering law alone would have
 * budgeted a snow leg at twice the speed the truck can reach.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Najvyššia rýchlosť, akú kamión na povrchu skutočne udrží, km/h.
 *
 * Zákon zákruty odpovedá na otázku *„ako rýchlo smiem cez tento oblúk"* a o odpore
 * nehovorí nič. Namerané naplno v priamom smere cez prevodovku:
 *
 *     asfalt 120,0   ľad 120,0   sneh 45,7   piesok 44,4   blato 41,0
 *
 * **Sneh, piesok a blato končia v štyridsiatkach** a to bolo prekvapenie, kvôli
 * ktorému toto meranie existuje. Plán postavený len na zákone zákruty by snehovej
 * etape pridelil dvojnásobok rýchlosti, akú kamión vôbec dosiahne.
 *
 * **↓ nižšie:** rozpočet je štedrejší, hodiny prestanú tlačiť.
 * **↑ vyššie:** rozpočet žiada rýchlosť, ktorú kamión nedosiahne — presne tá chyba,
 * ktorá v 0.8.1 vypýtala 188 km/h od 120 km/h stroja. `routeplan.test.ts` to stráži
 * s toleranciou 2 km/h.
 */
export const PLAN_SURFACE_VMAX: Record<Surface, number> = {
  asphalt: 120,
  snow: 47,
  ice: 120,
  sand: 46,
  mud: 43,
}

/**
 * Acceleration the plan assumes, m/s².
 *
 * Deliberately far below what the engine can do on paper. The plan does not
 * model the gearbox — a shift takes time, a missed one takes more, and the
 * torque curve means the truck pulls hardest in the middle of a gear — so this
 * is the *effective* figure a competent driver achieves through the gears.
 * Modelling the box properly here would mean a second copy of `vehicle.ts`, and
 * the copy would drift.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Zrýchlenie, s ktorým plán počíta, m/s².
 *
 * Zámerne hlboko pod tým, čo motor na papieri vie: plán nemodeluje prevodovku
 * (radenie stojí čas, zmeškané radenie viac), takže je to *efektívne* číslo
 * kompetentného vodiča. Modelovať prevodovku tu by znamenalo druhú kópiu
 * `vehicle.ts` — a tá kópia by driftovala.
 *
 * **↓ nižšie:** viac času, benevolentnejšie hodiny.
 * **↑ vyššie:** plán očakáva rozjazd, aký sa cez prevodovku nedá spraviť.
 */
export const PLAN_ACCEL_MS2 = 1.1

/**
 * Distance between plan samples, metres. Fine enough that a 100 m ice segment is
 * ten samples and coarse enough that an 8 km leg is 800 — computed once per leg,
 * never per frame.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Krok vzorkovania plánu, v metroch.
 *
 * Dosť jemný na to, aby 100 m ľadu bolo desať vzoriek, a dosť hrubý na to, aby 8 km
 * etapa bola 800 — počíta sa raz na etapu, nie každý snímok.
 */
export const PLAN_STEP_M = 10

/**
 * How much more time than the ideal line the clock grants.
 *
 * The ideal is a driver who knows every metre of the route in advance, never
 * misses a shift and never lifts out of doubt. Nobody is that driver, and a
 * first-time visitor to a seed is a long way from it. This is the whole margin
 * for imperfect shifting, hesitation, a cautious line and reading the road
 * through the windscreen instead of from the seed.
 *
 * Calibrated, not guessed: `completability.test.ts` runs three strategies across
 * the seed catalogue, and the target Fox set is **moderate passes with a small
 * margin, conservative fails on the harder routes**.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Koľkokrát viac času než ideálna stopa hodiny pridelia (1.6).
 *
 * **Toto je hlavná páka rozpočtu.** Ideál je vodič, ktorý pozná každý meter vopred,
 * nezmešká radenie a nikdy nezaváha z pochybností. Nikto taký nie je.
 *
 * Nakalibrované, nie odhadnuté — proti zadaniu *moderate prejde, conservative padne
 * na ťažších trasách*:
 *
 *     1.35 → 43,9 km/h    moderate padá      conservative padá
 *     1.50 → 40,0 km/h    moderate prejde    conservative padá
 *     1.60 → 37,7 km/h    moderate prejde    conservative padá   ← nasadené
 *     1.70 → 35,7 km/h    obaja prejdú
 *
 * **↓ nižšie:** hodiny tlačia. Pod ~1.4 začne byť trasa nedokončiteľná pre kohokoľvek,
 * kto jazdí opatrne.
 * **↑ vyššie:** hodiny prestanú byť prekážkou — čo je stav pred #47 a Fox ho označil
 * za priveľkú benevolenciu.
 */
export const PLAN_SLACK = 1.6

/**
 * Extra seconds on the first leg only, on top of the slack.
 *
 * The plan reads the route from the seed; a player on their first run of it
 * cannot. That gap is widest at the very start, before anyone has learned where
 * the ice is — and the first leg is also the one that begins from a standstill
 * with a cold engine.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Sekundy navyše len pre prvú etapu.
 *
 * Plán číta trasu zo seedu; hráč pri prvom behu nie. Tá medzera je najväčšia práve
 * na začiatku — a prvá etapa sa navyše rozbieha z miesta so studeným motorom.
 */
export const PLAN_FIRST_LEG_BONUS_S = 45

/**
 * Seconds granted for the standing start, the crank and the first two shifts.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Sekundy na rozjazd z miesta, natočenie a prvé dve preradenia.
 */
export const PLAN_START_ALLOWANCE_S = 15

/**
 * Seconds per kilometre for traffic, which the plan cannot see.
 *
 * Traffic is seeded, but it reacts to the player, so it is not a function of
 * distance the way the road is. A flat allowance is the honest shape. It will
 * need raising when traffic density starts scaling with distance travelled.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Sekundy na kilometer za dopravu, ktorú plán nevidí.
 *
 * Doprava je zo seedu, ale **reaguje na hráča**, takže nie je funkciou vzdialenosti
 * tak ako cesta. Plochý príspevok je poctivý tvar.
 *
 * **↑ bude ho treba zdvihnúť**, keď hustota začne rásť so vzdialenosťou — a možno
 * už teraz, lebo brzdiaca doprava zdržuje viac než tá, pre ktorú sa toto číslo
 * volilo.
 */
export const PLAN_TRAFFIC_ALLOWANCE_S_PER_KM = 6

/**
 * Seconds added to the clock by one canister, on top of its fuel.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Sekundy, ktoré kanister pridá na hodiny, navrch k palivu.
 *
 * Foxovo číslo a to cinknutie je zmyslom veci.
 */
export const CANISTER_TIME_BONUS_S = 10

/**
 * The share of a leg's canisters the budget assumes will be collected.
 *
 * Not 1.0, and that is the design: some canisters sit at the road edge, in a
 * bend or on ice, and a sensible driver leaves those. Budgeting for all of them
 * would make the clock unaffordable for anyone who drives sanely; budgeting for
 * none of them would hand back **+14.3 s per kilometre** at today's spacing —
 * more than the surplus this whole feature exists to remove.
 *
 * So the clock is priced for a driver who takes the easy ones. Taking a hard one
 * buys time; leaving them all costs it.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Aký podiel kanistrov rozpočet predpokladá, že zoberieš.
 *
 * **Nie 1.0, a to je zámer:** niektoré ležia pri krajnici, v zákrute alebo na ľade
 * a rozumný vodič ich nechá. Počítať so všetkými by spravilo hodiny nedostupné pre
 * každého, kto jazdí príčetne; nepočítať so žiadnymi by vrátilo **+14,3 s na
 * kilometer** — viac, než je celý prebytok, kvôli ktorému táto funkcia vznikla.
 *
 * **↓ nižšie:** štedrejšie hodiny, kanistre sú bonus.
 * **↑ vyššie:** prísnejšie — hodiny predpokladajú, že ich zbieraš, a nezbieranie
 * sa stane trestom.
 */
export const PLAN_EXPECTED_CANISTER_PCT = 0.6

/**
 * Hard bounds on the average speed a leg may ever demand, km/h.
 *
 * The guard rail that makes a planner bug survivable. 0.8.1 shipped a mission
 * asking for 188 km/h against a 120 km/h truck, and it shipped because nothing
 * stood between an arithmetic slip and the player. `PLAN_PACE_MAX` is that
 * something. The lower bound stops an over-generous plan from making a leg free.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Najnižšie priemerné tempo, aké smie etapa kedy žiadať.
 *
 * Zabraňuje tomu, aby prehnane štedrý plán spravil etapu zadarmo.
 */
export const PLAN_PACE_MIN_KMH = 22

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Najvyššie priemerné tempo, aké smie etapa kedy žiadať.
 *
 * **Toto je zábradlie, ktoré 0.8.1 nemala.** Vtedy hra vydala misiu žiadajúcu
 * 188 km/h od 120 km/h kamióna, a vydala ju preto, že medzi aritmetickým prešľapom
 * a hráčom nestálo nič.
 *
 * **↑ vyššie:** zábradlie sa vzďaľuje a chyba v plánovači sa opäť dostane k hráčovi.
 */
export const PLAN_PACE_MAX_KMH = 80

/**
 * Distance of the first delivery target from start (metres).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Vzdialenosť prvého odovzdania od štartu.
 *
 * **↓ nižšie:** rýchlejší prvý úspech, hra sa skôr rozbehne.
 * **↑ vyššie:** dlhší úvod. Päť kilometrov je číslo, na ktorom stojí celý
 * kalibračný katalóg seedov — zmena tu prepíše, čo znamenajú namerané tempá.
 */
export const FIRST_TARGET_DIST_M = 5000

/**
 * Range for subsequent leg lengths [min, max] metres beyond the delivery point.
 *
 * Was [15000, 25000] against a flat 8-minute budget, which asked for an average
 * of 113 to 188 km/h — `MAX_SPEED` is 120, so nine of those ten kilometres were
 * unreachable at any skill level and the tenth needed the truck flat out from
 * the first frame. Now the budget scales with the leg (`MISSION_PACE_KMH`), so
 * the range only has to be a length worth driving rather than a length that
 * happens to fit a fixed clock.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Rozsah dĺžky ďalších etáp, [min, max] v metroch.
 *
 * Bolo to [15000, 25000] proti plochému osemminútovému rozpočtu, čo žiadalo priemer
 * 113 až 188 km/h — deväť z desiatich takých etáp bolo nedosiahnuteľných pri
 * akejkoľvek zručnosti.
 *
 * **↓ nižšie:** častejšie odovzdania, viac doplnení paliva a bodov.
 * **↑ vyššie:** dlhé etapy. Rozpočet sa škáluje s dĺžkou, takže dnes je to voľba
 * o *rytme*, nie o tom, či sa to dá stihnúť.
 */
export const NEXT_TARGET_RANGE: readonly [number, number] = [5000, 8000]

/**
 * Fuel refill fraction awarded on successful delivery (0–1).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Koľko paliva doplní úspešné odovzdanie.
 *
 * **↓ nižšie:** palivo sa stane témou medzi etapami.
 * **↑ vyššie:** odovzdanie je plná nádrž a palivo prestane existovať.
 */
export const DELIVERY_FUEL_REFILL = 0.50

/**
 * Score points awarded per delivery, on top of what the driving earned.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Body za odovzdanie, navrch k tomu, čo zarobila jazda.
 */
export const DELIVERY_SCORE = 500

/**
 * The average speed a leg's time budget assumes, in km/h.
 *
 * 37.5 km/h is not a new number: it is exactly what the tuned first leg already
 * asks for (5 km in 8 minutes), so deriving every budget from it leaves the
 * first leg untouched and gives every later leg the same promise. For scale,
 * the ideal driver in `completability.test.ts` averages ~46 km/h across the seed
 * catalogue and the owner's human run of the reference seed averaged ~38.5.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ploché tempo, z ktorého sa kedysi počítal rozpočet.
 *
 * **Už ho nečíta žiadny kód** — od #47 sa rozpočet číta z konkrétnej cesty. Zostáva
 * tu ako záznam o tom, prečo ploché tempo existovalo a čo bolo jeho chybou: 37,5
 * vzniklo z prvej etapy a držalo sa, kým sa kompetentná jazda naučila 42–46, takže
 * sa sporilo asi desať sekúnd na kilometer, kým hodiny prestali niečo znamenať.
 */
export const MISSION_PACE_KMH = 37.5

/**
 * Time limit for the first delivery in milliseconds.
 *
 * Derived rather than written down, so "the first leg's budget does not change"
 * is an equation a test can check instead of a promise in a comment. Works out
 * at exactly 8 minutes, which is what it was before the pace existed — raised
 * from 7 when the manual gearbox made acceleration much slower.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Odvodený limit prvej etapy. **Už ho nečíta žiadny kód** — viď
 * {@link MISSION_PACE_KMH}.
 */
export const DELIVERY_TIME_LIMIT_MS =
  Math.round(FIRST_TARGET_DIST_M / 1000 / MISSION_PACE_KMH * 3_600_000)

/**
 * How much of a leg's unused time carries into the next one (0–1).
 *
 * 1.0 — drive well and you bank every second of it, which is what the owner
 * chose and what the delivery jingle implies. Watch it across a long run: time
 * saved compounds, so by the fifth delivery the clock may have stopped being a
 * pressure at all. If it does, this is the dial — no code changes with it.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Koľko nevyužitého času sa prenáša do ďalšej etapy (1.0).
 *
 * **Foxovo rozhodnutie a nemá sa meniť bez opýtania.** Jazdi dobre a nasporíš každú
 * sekundu — to je zámer a to hovorí aj tá znelka pri odovzdaní.
 *
 * **Čo ale ostáva otvorené, je strop na banku:** nasporený čas sa kumuluje —
 * seed 42 dá 15,2 → 16,6 → 19,6 min do tretieho odovzdania. Zastropovať banku
 * necháva prenos štedrý a berie mu len to kumulovanie; znížiť tento podiel by trestalo
 * práve dobrého vodiča, čo je iná vec a Fox ju už raz zamietol.
 */
export const DELIVERY_TIME_CARRY_PCT = 1.0
