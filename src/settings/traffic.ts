/**
 * The other vehicles: where they appear, how fast they go, and how they drive.
 *
 * Two halves, and the split is worth keeping in mind when tuning. The first is
 * the *world* — spacing, direction split, speeds — and changes how busy the road
 * is. The second is the *driver* — what a car brakes for and how hard — and
 * changes what the road tells you.
 */

import type { Surface } from './surfaces.ts'

/**
 * Average spacing between traffic vehicles (metres).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Priemerný rozostup medzi vozidlami pri generovaní, v metroch.
 *
 * **Nie je to rozostup, ktorý uvidíš.** Zmerané: rozostup pri zrode neprežije drift
 * — súbežné autá idú 30–55 km/h, hráč ~45, takže pomalé zaostávajú a rýchle
 * uchádzajú. Skutočná priemerná medzera medzi dvoma súbežnými autami vyšla
 * **61–178 m** podľa seedu, nie 400, ako hovorí aritmetika.
 *
 * **↓ nižšie:** hustejšia doprava. Toto je páka pre hustotu rastúcu so
 * vzdialenosťou, ktorá čaká vo fronte.
 * **↑ vyššie:** prázdnejšia cesta. Nad ~400 m prestane byť doprava obtiažnosťou
 * a hra sa vráti k tomu, že prekážkou je len povrch.
 */
export const TRAFFIC_SPACING_M = 220

/**
 * Random jitter on spacing (±fraction).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Náhodné rozhádzanie rozostupu (±podiel).
 *
 * **↓ nižšie:** pravidelné rozostupy — doprava pôsobí ako plot, nie ako premávka.
 * **↑ vyššie:** nepravidelnejšie. Nad ~0.7 sa začnú tvoriť zhluky a dlhé prázdne
 * úseky, čo je realistické, ale ťažko sa to ladí.
 */
export const TRAFFIC_SPACING_JITTER = 0.4

/**
 * Probability that a vehicle goes in the same direction (rest = oncoming).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Podiel vozidiel idúcich tvojím smerom (zvyšok je protismer).
 *
 * **↓ nižšie:** viac protiidúcich — obtiažnosť sa presunie na *vyhýbanie sa*.
 * **↑ vyššie:** viac súbežných — obtiažnosť sa presunie na *predbiehanie*, a s ňou
 * aj brzdové svetlá, kolóny a všetko, čo z toho vyplýva.
 */
export const TRAFFIC_SAME_DIR_PCT = 0.55

/**
 * Speed range for same-direction vehicles [min, max] km/h.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Rozsah krížnej rýchlosti súbežných vozidiel, [min, max] km/h.
 *
 * **Toto je najdôležitejšie číslo pre brzdenie dopravy**, aj keď to tak nevyzerá.
 * Auto má dôvod brzdiť len vtedy, keď je jeho krížna rýchlosť nad tým, čo povrch
 * alebo zákruta dovolí — pri úzkom rozsahu brzdia buď všetky, alebo žiadne.
 *
 * **↓ nižšie:** pomalšia doprava, viac predbiehania, menej brzdení.
 * **↑ vyššie:** rýchlejšia doprava. Keď sa horná hranica priblíži k tvojej
 * rýchlosti, predbiehanie prestane byť možné a cesta sa zablokuje.
 */
export const TRAFFIC_SAME_SPEED: readonly [number, number] = [30, 55]

/**
 * Speed range for oncoming vehicles [min, max] km/h.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Rozsah rýchlosti protiidúcich vozidiel, [min, max] km/h.
 *
 * **↓ nižšie:** viac času na úhyb.
 * **↑ vyššie:** protismer sa mihne a je preč — rýchlosť zbližovania je súčet oboch,
 * takže 90 proti tvojim 45 znamená 135 km/h a asi sekundu na rozhodnutie.
 */
export const TRAFFIC_ONCOMING_SPEED: readonly [number, number] = [60, 90]

/**
 * Desired same-direction following time behind a slow player.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Bezpečný časový odstup, ktorý si vodič drží za tým, čo je pred ním.
 *
 * Je to časový, nie metrický odstup — pri vyššej rýchlosti automaticky znamená viac
 * metrov, presne ako v skutočnej premávke.
 *
 * **↓ nižšie:** autá lepia na seba a na teba. Pod ~1 s je to agresívna premávka,
 * ktorá ťa bude tlačiť.
 * **↑ vyššie:** ustupujú skôr a ochotnejšie. Nad ~4 s prestanú tvoriť kolóny
 * a začnú sa navzájom obchádzať širokým oblúkom v čase.
 */
export const TRAFFIC_FOLLOW_TIME_S = 2.2

/**
 * Minimum same-direction gap when following the player, in metres.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Najmenší odstup v metroch, pod ktorý sa vodič nikdy nedostane dobrovoľne.
 *
 * Pod touto hranicou cieľová rýchlosť klesá **pod** rýchlosť auta vpredu — inak by
 * sa raz zatvorená medzera už nikdy neotvorila.
 *
 * **↓ nižšie:** tesnejšie kolóny, viac napätia.
 * **↑ vyššie:** vzdušnejšie. Nad ~30 m sa autá začnú zdržiavať navzájom aj tam, kde
 * by prešli.
 */
export const TRAFFIC_MIN_FOLLOW_GAP_M = 10

/**
 * Maximum same-direction AI braking when closing on the player, in km/h/s.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Najtvrdšie brzdenie, aké vodič použije — núdzová sadzba.
 *
 * Je to zároveň {@link TRAFFIC_BRAKE_MAX_KMH_S}: jeden limit, jedno číslo.
 *
 * **↓ nižšie:** autá nestíhajú a narazia do teba zozadu, keď tvrdo zabrzdíš na
 * blate. Presne pred tým tento strážca vznikol.
 * **↑ vyššie:** brzdia nadľudsky. Pri veľmi vysokých hodnotách sa cesta správa ako
 * by mala ABS z budúcnosti.
 */
export const TRAFFIC_FOLLOW_BRAKE_KMH_S = 45

/**
 * Pre-filter range for visual traffic collision (metres ahead of player).
 * Vehicles outside this range cannot overlap the player truck on screen.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Predfilter pre kolíziu — dokedy vpredu má zmysel kolíziu vôbec počítať.
 *
 * Nie je to hitbox; ten je pixelový a v obrazovom priestore. Toto je len hrubé sito.
 *
 * **↓ nižšie:** rýchlejšie, ale pri veľkom kroku simulácie sa dá kolíziu preskočiť.
 * **↑ vyššie:** bezpečnejšie, o kúsok drahšie.
 */
export const TRAFFIC_COLLISION_DEPTH_M = 6

/**
 * First traffic vehicle appears after this many metres (safe start).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Po koľkých metroch sa objaví prvé vozidlo.
 *
 * **↓ nižšie:** premávka hneď od štartu — kým sa preradíš na tretí stupeň, už máš
 * niekoho pred sebou.
 * **↑ vyššie:** pokojnejší rozjazd. Pri 800 m to vychádza tak, že prvé auto stretneš
 * zhruba vtedy, keď skončí štartovací asfalt.
 */
export const TRAFFIC_START_M = 800

/**
 * Clearance a new vehicle needs from one already on the road, metres.
 *
 * Spawn spacing is measured from the previous *spawn point*, which is not where
 * the previous vehicle is: same-direction traffic cruises anywhere from 30 to
 * 55 km/h, so a quick one drives well past the spot the next one is due at.
 * Measured before this existed — a car spawned at 4507 m landed **0.35 m** behind
 * one that had started 286 m further back and overtaken the spot. That is two
 * vehicles inside each other, and it was the real reason traffic looked like it
 * was drawn through itself; the car-following model was never the cause.
 *
 * 25 m rather than a vehicle length: they must not merely miss, they must not
 * look stacked either.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Odstup, ktorý nové vozidlo potrebuje od toho, čo už na ceste je.
 *
 * **Bez tohto sa autá rodili jedno na druhom** — zmerané: auto vzniklo 0,35 m za
 * autom, ktoré štartovalo o 286 m ďalej a to miesto medzitým prešlo. Naprieč
 * piatimi seedmi bolo minimum **0,00 m** pri dĺžke vozidla 6 m.
 *
 * **↓ nižšie:** vráti sa prekrývanie.
 * **↑ vyššie:** doprava sa zriedi bez toho, aby si menil rozostup — nové auto sa
 * tlačí dopredu, kým nenájde miesto.
 */
export const TRAFFIC_MIN_SPAWN_GAP_M = 25

//
// What a driver in traffic *does*, as opposed to what the tyres *allow*. The
// cornering law in `game/safespeed.ts` answers the second question and this block
// answers the first, and the gap between them is the whole reason this block
// exists: traffic cruises at 30-55 km/h, which is nowhere near the friction limit
// of any bend on asphalt (the sharpest asks 84.9 km/h), so a model built on grip
// alone would never light a single brake light.

/**
 * Share of the physics cornering limit a driver in traffic actually uses.
 *
 * Real traffic corners at roughly a quarter of a g against a limit near 0.8 g.
 * 0.55 is picked so the numbers land either side of `TRAFFIC_SAME_SPEED`, which
 * is what makes two cars meeting one bend look like two decisions:
 *
 *     surface   c=0.4   c=1.0   c=1.5   c=2.0     (km/h, this factor applied)
 *     asphalt   104.4    66.0    53.9    46.7
 *     snow       70.0    44.3    36.1    31.3
 *     ice        52.2    33.0    26.9    23.3
 *     sand       61.7    39.0    31.9    27.6
 *     mud        70.0    44.3    36.1    31.3
 *
 * So the sharpest asphalt bend is braked for by the fast half of the fleet and
 * ignored by the slow half, and everything on ice slows for everything.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Podiel fyzikálneho limitu zákruty, ktorý vodič naozaj použije.
 *
 * **Bez tohto by nezabrzdilo ani jedno auto.** Fyzika hovorí, že najostrejšia
 * zákruta na asfalte dovolí 84,9 km/h — a doprava ide 30–55, takže na hranici
 * priľnavosti nemá dôvod spomaliť nikdy. Skutoční vodiči berú zákrutu asi na štvrtine
 * g proti limitu blízko 0,8 g.
 *
 * **↓ nižšie:** opatrnejšia premávka, brzdí sa skôr a viac; pri nízkych hodnotách
 * sa autá plazia aj cez mierne oblúky.
 * **↑ vyššie:** odvážnejšia. Nad ~0.8 prestanú brzdiť na asfalte úplne a brzdové
 * svetlá uvidíš len na ľade.
 */
export const TRAFFIC_CORNER_COMFORT_PCT = 0.55

/**
 * Fastest a traffic driver will go on each surface whatever the road is doing,
 * km/h. `null` means the surface never caps anything by itself.
 *
 * The cornering law is silent about a straight — `PLAN_C_MIN` floors the
 * curvature, so bare ice comes out at 55.8 km/h, which is a car doing 55 on ice
 * and a lie the player can see. This table is the second half of the answer.
 *
 * Deliberately **not** `PLAN_SURFACE_VMAX`: that is what the truck's engine can
 * hold against `SURFACE_DRAG`, and it puts ice at 120 because ice is not draggy —
 * true of the drivetrain, exactly backwards as a statement about a driver.
 *
 * These are a design decision, not physics, and they are the first dial to turn
 * if traffic on ice ends up blocking the player more than it warns them.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Najvyššia rýchlosť, akou vodič pôjde po danom povrchu, bez ohľadu na zákrutu.
 *
 * Zákon zákruty o rovinke nevie nič, takže bez tejto tabuľky by auto išlo 55 po
 * holom ľade. Zámerne to **nie je** `PLAN_SURFACE_VMAX` — to je aerodynamický strop
 * kamióna a ľad v ňom má 120, čo je pre túto otázku presne naopak.
 *
 * **↓ nižšie:** doprava na povrchu spomalí a začne ťa zdržiavať; na ľade sa z nej
 * stane zátka.
 * **↑ vyššie:** premávka sa povrchom netrápi. Pri vysokých hodnotách prestanú
 * brzdové svetlá pred prekážkou svietiť a stratíš varovný systém, ktorý ti dáva.
 */
export const TRAFFIC_SURFACE_MAX_KPH: Record<Surface, number | null> = {
  asphalt: null,
  snow: 45,
  ice: 30,
  sand: 40,
  mud: 38,
}

/**
 * How much of its own cruising speed a driver keeps on each surface.
 *
 * The cap above alone is not enough, and the measurement that showed it is worth
 * keeping: an absolute cap only slows the vehicles that were already above it, so
 * on snow (cap 45) **only 40 % of a `TRAFFIC_SAME_SPEED` fleet had any reason to
 * brake at all** — the rest were already slower, sailed onto the snow unchanged,
 * and never lit a lamp. Fox reported exactly that from the driving seat: *"a to
 * ani keď sme obaja prechádzali na sneh."*
 *
 * A share of cruise fixes it, because it is what a driver actually does: everyone
 * comes off their own pace by roughly the same proportion. The two rules are
 * taken together — `min(cap, cruise x this)` — so "nobody does 55 on bare ice"
 * and "everybody slows for ice" are both true.
 *
 * Ice is the sharpest cut on purpose: it is the surface the whole game is about,
 * and a lamp coming on ahead of it is the warning this feature exists to give.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Koľko zo *svojej* krížnej rýchlosti si vodič na povrchu ponechá.
 *
 * Absolútny strop vyššie spomalí len tých, čo už sú nad ním — zmerané: na snehu
 * (strop 45) mala dôvod brzdiť len **40 %** vozového parku a zvyšok naň vplával
 * nezmenene. Toto je tá druhá polovica: každý ide dolu zo *svojho* tempa.
 *
 * **↓ nižšie:** výraznejšie spomalenie na povrchu, viditeľnejšie brzdenie, väčšie
 * zdržanie.
 * **↑ vyššie:** povrch prestane byť pre dopravu udalosťou. Pri 1.0 sa vypne úplne
 * a ostane len absolútny strop.
 */
export const TRAFFIC_SURFACE_PACE_PCT: Record<Surface, number> = {
  asphalt: 1.0,
  snow: 0.78,
  ice: 0.55,
  sand: 0.70,
  mud: 0.66,
}

/**
 * Per-vehicle caution, drawn once at spawn: above 1 reads further ahead and
 * accepts a lower speed, below 1 is the driver who brakes late.
 *
 * Drawn from the seed rather than from `Math.random`, because a route *is* a
 * seed and that has to include what the traffic on it does — otherwise the same
 * playtest cannot be run twice and no test can pin any of this.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Opatrnosť vodiča, ťahaná raz pri zrode zo seedu.
 *
 * Nad 1 číta ďalej dopredu a akceptuje nižšiu rýchlosť; pod 1 je to ten, kto brzdí
 * neskoro. **Determinizmus je zámer** — trasa je seed a to zahŕňa aj to, ako sa na
 * nej správa premávka.
 *
 * **↓ užší rozsah:** všetky autá reagujú rovnako a v tej istej zákrute brzdia
 * naraz. Vyzerá to strojovo.
 * **↑ širší rozsah:** rôznorodejšia premávka. Pri veľkom rozptyle sa začnú objavovať
 * vodiči, ktorí brzdia tak skoro, že ich to zbytočne zdržiava.
 */
export const TRAFFIC_CAUTION_RANGE: readonly [number, number] = [0.85, 1.25]

/**
 * Per-vehicle braking vigour, drawn once at spawn — how hard this driver leans
 * on the pedal once they have decided to. Separate from caution so that "brakes
 * early and gently" and "brakes late and hard" are both drivers that exist.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Razancia brzdenia vodiča, ťahaná raz pri zrode.
 *
 * Oddelená od opatrnosti zámerne, aby existoval aj *„brzdí neskoro a tvrdo"* aj
 * *„brzdí skoro a mäkko"*. Jeden ciferník by dal len uhlopriečku cez ten štvorec.
 *
 * **↓ nižšie:** mäkšie brzdenie, dlhšie svietiace brzdovky, ale slabší signál.
 * **↑ vyššie:** rezkejšie. Nad ~1.5 pôsobí premávka nervózne.
 */
export const TRAFFIC_VIGOUR_RANGE: readonly [number, number] = [0.85, 1.20]

/**
 * Seconds of travel a driver reads ahead. At 45 km/h that is 75 m.
 *
 * A time rather than a distance, because the honest braking distance at these
 * speeds is tiny — shedding 45 to 30 km/h takes about 6 m — and a light that came
 * on 6 m before the ice would be a blink, not a warning. Drivers lift early; this
 * is that, and it is what makes the lamps readable from behind.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Koľko sekúnd jazdy vodič číta dopredu. Pri 45 km/h je to 75 m.
 *
 * Je to čas, nie vzdialenosť — pomalé auto nepotrebuje vidieť tak ďaleko.
 *
 * **↓ nižšie:** reaguje neskoro, brzdí tesne pred prekážkou.
 * **↑ vyššie:** predvídavejší. **Pozor: nie je to ciferník, ktorý rozsvieti
 * brzdovky skôr** — to robí {@link TRAFFIC_BRAKE_PLAN_KMH_S}. Predĺženie obzoru bez
 * zmeny plánovaného spomalenia neurobí nič.
 */
export const TRAFFIC_LOOKAHEAD_S = 6

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Spodná hranica obzoru v metroch — aj stojace auto sa pozerá aspoň takto ďaleko.
 */
export const TRAFFIC_LOOKAHEAD_MIN_M = 25

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Horná hranica obzoru v metroch. Drží cenu výpočtu konečnú.
 */
export const TRAFFIC_LOOKAHEAD_MAX_M = 140

/**
 * Sample spacing of the look-ahead, metres. Same as `PLAN_STEP_M`, same reason.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Krok vzorkovania obzoru, v metroch.
 *
 * **↓ nižšie:** presnejšie čítanie cesty, drahšie. Pod ~5 m sa presnosť už nezlepší,
 * lebo grip sa na kratšej vzdialenosti aj tak nemení.
 * **↑ vyššie:** lacnejšie, ale krátku prekážku môže vodič preskočiť úplne.
 */
export const TRAFFIC_LOOKAHEAD_STEP_M = 10

/**
 * How often a vehicle re-reads the road, ms.
 *
 * Not every frame: the road does not change under it, so the answer would be the
 * same at sixty times the cost — and a target that only moves ten times a second
 * is also what keeps the brake lamp from strobing.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako často si vodič znovu prečíta cestu.
 *
 * Nie každý snímok: cesta sa pod ním nemení, odpoveď by bola tá istá za šesťdesiat­
 * násobok ceny — a cieľ, ktorý sa hýbe desaťkrát za sekundu, zároveň drží brzdovú
 * lampu od blikania.
 *
 * **↓ nižšie:** reakcia je bezprostrednejšia, drahšia, a lampa začne kmitať.
 * **↑ vyššie:** lacnejšie, ale vodič si všimne prekážku s oneskorením.
 */
export const TRAFFIC_PLAN_INTERVAL_MS = 100

/**
 * The deceleration a driver *plans* with, km/h/s — what decides how far ahead of
 * a hazard the lamps come on.
 *
 * Separate from `TRAFFIC_BRAKE_MAX_KMH_S`, and the separation is the whole reason
 * the anticipation is visible at all. The look-ahead *time* is not what puts the
 * lights on early; the assumed deceleration is. Measured, for a car shedding
 * 55 → 30 km/h onto ice:
 *
 *     planned at 45 km/h/s   braking starts   6.6 m before the ice
 *     planned at 12 km/h/s                   24.6 m
 *     planned at  7 km/h/s                   42.2 m      <- this
 *     planned at  5 km/h/s                   59.0 m
 *
 * At 45 the brake light is a blink nobody can read, which defeats the point of
 * traffic braking being a signal. 7 km/h/s is about 0.2 g — what a driver who has
 * seen the ice coming actually does — and it lights the lamps roughly 40 m out,
 * which is a couple of seconds of warning at closing speed.
 *
 * `TRAFFIC_BRAKE_MAX_KMH_S` stays what it is: the ceiling for a driver who left
 * it late, or who had a car pull up in front of them.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Spomalenie, s ktorým vodič **plánuje** — a to rozhoduje, ako ďaleko pred prekážkou
 * sa rozsvietia brzdovky.
 *
 * Zmerané, pre auto zhadzujúce 55 → 30 km/h na ľad:
 *
 *     plánované 45 km/h/s   brzdiť začne  6,6 m pred ľadom
 *     plánované 12 km/h/s                24,6 m
 *     plánované  7 km/h/s                42,2 m   ← toto
 *     plánované  5 km/h/s                59,0 m
 *
 * **↓ nižšie:** brzdí sa skôr a jemnejšie — dlhšie varovanie pre teba, ale premávka
 * je pomalšia.
 * **↑ vyššie:** brzdí sa neskôr a tvrdšie. Pri 45 je brzdovka záblesk, ktorý nikto
 * neprečíta, a celý zmysel brzdiacej dopravy zmizne.
 */
export const TRAFFIC_BRAKE_PLAN_KMH_S = 7

/**
 * Seconds over which a driver sheds the excess speed. This is what sets the
 * deceleration: the gap to the target divided by this, then clamped and scaled
 * by the driver's vigour. A driver braking for a bend 100 m off does not stand on
 * the pedal, and one that has left it late does.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Za koľko sekúnd chce vodič zhodiť prebytočnú rýchlosť.
 *
 * Z tohto sa počíta okamžité spomalenie: rozdiel k cieľu delený týmto číslom,
 * orezaný a vynásobený razanciou vodiča.
 *
 * **↓ nižšie:** prudšie reakcie, tvrdé brzdenie aj pri malom rozdiele.
 * **↑ vyššie:** lenivejšie. Nad ~4 s vodič nestihne spomaliť na to, čo si naplánoval.
 */
export const TRAFFIC_BRAKE_RESPONSE_S = 1.8

/**
 * Gentlest deceleration still worth calling braking, km/h/s.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Najmiernejšie spomalenie, ktoré sa ešte volá brzdením.
 */
export const TRAFFIC_BRAKE_MIN_KMH_S = 8

/**
 * Hardest a traffic driver ever brakes, for any reason, km/h/s.
 *
 * Defined as the rear-end guard's rate rather than as a new number: that rate was
 * already chosen for exactly this question, and two constants for one limit is
 * how two limits start. Step 5 folds the guard into the general model, at which
 * point `TRAFFIC_FOLLOW_BRAKE_KMH_S` becomes the older name for this.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Strop spomalenia pre akýkoľvek dôvod. Zámerne definované *ako* sadzba núdzového
 * strážcu, nie ako nové číslo — dva ciferníky na jeden limit sú začiatok dvoch
 * limitov.
 */
export const TRAFFIC_BRAKE_MAX_KMH_S = TRAFFIC_FOLLOW_BRAKE_KMH_S

/**
 * Below this deceleration the lamps stay dark — it is a lift, not a brake.
 * Real pedals work this way and it keeps a driver who is merely easing off from
 * telling the player there is ice ahead.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Pod týmto spomalením lampy nesvietia — je to uvoľnenie plynu, nie brzda.
 *
 * **↓ nižšie:** brzdovky svietia takmer stále a prestanú niesť informáciu.
 * **↑ vyššie:** svietia len pri prudkom brzdení. Pri vysokých hodnotách zmizne
 * práve to jemné brzdenie pred prekážkou, ktoré má varovať.
 */
export const TRAFFIC_BRAKE_LAMP_MIN_KMH_S = 6

/**
 * Minimum time the lamp stays lit once lit, ms.
 *
 * Two jobs. The small one: a real pedal is not tapped for one frame, and without
 * a hold a target that crosses back and forth over the current speed strobes the
 * lights, which reads as a rendering fault rather than as a car.
 *
 * The larger one is Fox's, from the driving seat: *"brzdenie musí držať ešte aj
 * chvíľu na povrchu (stačí pár metrov)"* — a driver comes off the ice-warning
 * brake gradually, not the instant the tyres touch. 600 ms is about **5 m at
 * 30 km/h**, so the lamps are still lit as the vehicle crosses the seam, which
 * is the moment the player behind is looking straight at them. At 250 ms it was
 * two metres and they went dark just too early.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako dlho lampa svieti potom, čo vodič prestal brzdiť.
 *
 * Dve úlohy. Menšia: skutočný pedál sa nesťukne na jeden snímok, a bez podržania
 * by cieľ prechádzajúci tam a späť rozblikal svetlá. Väčšia je Foxova, zo sedadla —
 * vodič nepustí brzdu v okamihu, keď je na rýchlosti. 600 ms je asi **5 m pri
 * 30 km/h**, takže lampy svietia ešte pri prechode cez švík, čo je presne moment,
 * keď sa na ne pozeráš.
 *
 * **↓ nižšie:** svetlá zhasnú na hrane povrchu, teda priskoro.
 * **↑ vyššie:** svietia dlhšie, ale nad ~1,5 s prestane byť zrejmé, na čo sa brzdilo.
 */
export const TRAFFIC_BRAKE_LAMP_HOLD_MS = 600

/**
 * Getting back up to cruise once the reason to slow is behind, km/h/s.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako rýchlo sa vodič vracia na svoju krížnu rýchlosť, keď dôvod pominul.
 *
 * **↓ nižšie:** premávka sa po prekážke zbiera dlho a zdržuje ťa ešte dávno potom.
 * **↑ vyššie:** rezký návrat. Pri vysokých hodnotách autá vystrelia z ľadu spôsobom,
 * aký by si si sám nedovolil.
 */
export const TRAFFIC_ACCEL_KMH_S = 6

/**
 * How far under the leader a follower settles, km/h.
 *
 * Was a bare `- 2` inside `followPlayerSpeed`. Named because it is the difference
 * between a queue that holds station and one that creeps forward until it touches.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * O koľko pod rýchlosť auta vpredu sa vodič usadí.
 *
 * Bola to holá `- 2` vnútri funkcie. Je to rozdiel medzi kolónou, ktorá drží odstup,
 * a kolónou, ktorá sa pomaly zosúva do seba.
 *
 * **↓ nižšie:** k nule — kolóna sa lepí.
 * **↑ vyššie:** väčší odstup, ale kolóna sa začne postupne trhať.
 */
export const TRAFFIC_FOLLOW_UNDERSHOOT_KMH = 2
