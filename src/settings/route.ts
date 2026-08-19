/**
 * How a route is generated from its seed: surface segments, the bends, and how
 * far ahead each hazard is announced.
 *
 * The seed *is* the route, so every number here changes what a given seed means.
 * Moving one invalidates the catalogue in `AGENTS.md`.
 */

import type { Surface } from './surfaces.ts'

/**
 * First segment is always asphalt, this many metres.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Prvý kilometer je vždy asfalt.
 *
 * **↓ nižšie:** hráč naráža na prekážku skôr, než sa rozbehne cez prevodovku — pri
 * 0 sa dá začať jazdu na ľade s vychladnutým motorom.
 * **↑ vyššie:** pokojnejší rozjazd, ale zožerie to trasu. Pri 5 km trase to už dnes
 * znamená, že prvá pätina je bez prekážok.
 */
export const START_ASPHALT_M = 1000

/**
 * Per-surface segment length range [min, max] in metres.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Dĺžka úseku podľa povrchu, [min, max] v metroch.
 *
 * **Toto je dôvod, prečo ľad *vyzerá* zriedkavejší, než je.** Jeho úseky sú o
 * polovicu kratšie než ostatné, takže aj pri rovnakej pravdepodobnosti zaberie na
 * trase polovicu miesta.
 *
 * **↓ nižšie:** povrch sa mihne a zmizne — nedá sa naň nastaviť, len ho prežiť.
 * **↑ vyššie:** stane sa z neho krajina, nie prekážka. Pri dlhom ľade prestane byť
 * rozhodnutie „ako doň vojsť" a začne to byť vytrvalostná skúška.
 */
export const SURFACE_LENGTH_RANGE: Record<Surface, readonly [number, number]> = {
  asphalt: [200, 800],
  snow: [100, 800],
  ice: [200, 800],
  sand: [100, 400],
  mud: [100, 600],
}

/**
 * Length of the grip blend across a surface boundary, in metres, centred on the
 * boundary itself (half before, half after).
 *
 * A real road does not change grip on a painted line — ice starts patchy and the
 * asphalt on its far side stays glazed for a while. Mechanically this matters
 * because the jump used to be one tick wide: grip 1.0, then 0.25, with no moment
 * in between where the truck felt light and the player could still act.
 *
 * Only the grip *number* is blended. {@link SURFACE_LENGTH_RANGE} segment
 * identity stays hard-edged, because it also drives the visuals, drag, fuel burn
 * and skid audio — smearing those would desync what you see from what you feel.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Dĺžka prelínania gripu cez švík medzi povrchmi (polovica pred, polovica za).
 *
 * **↓ nižšie:** hrana je ostrejšia. Pri 0 sa grip zmení za jeden tik — 1.0, potom
 * 0.25 — a hráč nemá jediný moment, keď je auto ľahké a ešte sa dá zareagovať.
 * **↑ vyššie:** mäkší prechod, viac času. Nad ~40 m sa ale povrchy začnú do seba
 * rozmazávať a prestane platiť, že vieš, na čom stojíš.
 */
export const SURFACE_TRANSITION_M = 20

/**
 * Curvature at or above which a warning carries a direction arrow. The midpoint
 * of {@link CURVE_INTENSITY_RANGE}: gentler bends are not worth the ink, since
 * ice holds a 0.4 bend at 120 km/h and a 1.0 bend at ~70.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Od akého zakrivenia nesie varovanie šípku smeru.
 *
 * **↓ nižšie:** šípka svieti skoro vždy a prestane niečo znamenať — pri rovnomernom
 * rozdelení 0.4–2.0 už dnes prekročí prah **62,5 % zákrut**.
 * **↑ vyššie:** šípka je vzácna a o to viac hovorí, ale mierne zákruty prestanú byť
 * ohlásené úplne.
 */
export const CURVE_WARN_CURVATURE = 1.0

/**
 * How far ahead a sharp bend is announced while the truck is already on a
 * slippery surface — see `road.ts` `sharpCurveAhead`.
 *
 * Derived from the worst realistic case rather than picked: shedding 80 → 40 km/h
 * on ice, where `decel` is 8 km/h/s against `speedFade` 0.55, takes about 7.9 s
 * and eats ~132 m. 180 leaves room to notice and react on top of that.
 *
 * Shorter than {@link ICE_AHEAD_LOOK_M} (220) on purpose. A surface change needs
 * the longer horizon because you must brake *before* reaching it; a bend is
 * already visible in the road itself, so this only has to beat the reaction gap.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako ďaleko dopredu sa ohlasuje ostrá zákruta, keď už stojíš na klzkom.
 *
 * Odvodené, nie zvolené: zhodenie 80 → 40 km/h na ľade trvá asi 7,9 s a zožerie
 * ~132 m. 180 necháva priestor si to všimnúť a zareagovať.
 *
 * **↓ nižšie:** varovanie príde neskoro na to, aby sa dalo použiť.
 * **↑ vyššie:** varuje sa priskoro a hráč prestane vedieť, ktorej zákruty sa to
 * týka.
 */
export const CURVE_AHEAD_LOOK_M = 180

/**
 * Only surfaces at or below this grip get the bend warning. Snow 0.55, ice 0.25,
 * sand 0.35 and mud 0.45 qualify; asphalt at 1.0 does not — on a road that grips,
 * reading the bend yourself is the game.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Do akého gripu sa zákruty ešte ohlasujú.
 *
 * Pri 0.6 sa kvalifikuje sneh 0.45, ľad 0.25, piesok 0.35 aj blato 0.45; asfalt
 * s 1.0 nie — na ceste, ktorá drží, je prečítanie zákruty tvoja práca.
 *
 * **↓ nižšie:** varuje sa len na najklzkejšom.
 * **↑ vyššie:** varuje sa aj na asfalte a hra začne hrať za teba.
 */
export const CURVE_WARN_GRIP_MAX = 0.6

/**
 * After a non-asphalt surface, probability of a recovery asphalt segment.
 * Gives the driver a breather. 0.85 = 85% chance.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Pravdepodobnosť, že po neasfaltovom úseku príde regeneračný asfalt.
 *
 * **↓ nižšie:** prekážky sa začnú reťaziť — ľad hneď po blate. Trasa zhustne
 * a prestane dávať priestor na nadýchnutie.
 * **↑ vyššie:** po každej prekážke oddych. Pri 1.0 sa neasfaltové povrchy nikdy
 * nedotknú a hra stratí najťažšiu situáciu, akú vie postaviť.
 */
export const RECOVERY_ASPHALT_PCT = 0.85

/**
 * Recovery asphalt segment length range [min, max] in metres.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Dĺžka regeneračného asfaltu, [min, max] v metroch.
 *
 * **↓ nižšie:** oddych medzi prekážkami je krátky a trasa je nervóznejšia.
 * **↑ vyššie:** trasa sa zriedi. Spolu s {@link RECOVERY_ASPHALT_PCT} to
 * rozhoduje, koľko neasfaltových úsekov sa vôbec zmestí do 5 km — dnes asi päť.
 */
export const RECOVERY_ASPHALT_RANGE: readonly [number, number] = [150, 400]

/**
 * Centrifugal drift force from road curvature.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako silno zákruta ťahá kamión do vonkajšej strany.
 *
 * **↓ nižšie:** zákruty sa dajú prejsť bez korekcie a prestanú byť rozhodnutím.
 * **↑ vyššie:** odstredivá sila je cítiť. Vysoké hodnoty spravia zo zákruty na ľade
 * lotériu namiesto zručnosti — a to je presne to, čo `controllability.test.ts`
 * stráži.
 */
export const CURVE_DRIFT = 0.035

/**
 * Curvature intensity range for turns (0 = straight, higher = sharper).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Rozsah ostrosti zákrut, [min, max].
 *
 * Generátor si z neho ťahá **rovnomerne**, takže rozsah priamo hovorí, aká je
 * priemerná zákruta. Ostrosť je spojitá — hra nemá dva stupne zákrut, len jeden
 * prah pre šípku vo varovaní.
 *
 * **↓ nižšie hore:** cesta sa narovná a zákruty prestanú byť prekážkou.
 * **↑ vyššie hore:** ostrejšie zákruty. Nad ~2.5 sa začnú objavovať oblúky, ktoré
 * sa na ľade nedajú prejsť žiadnou rýchlosťou — čo je iný druh nefér než rýchly ľad.
 */
export const CURVE_INTENSITY_RANGE: readonly [number, number] = [0.4, 2.0]

/**
 * Length of straight sections between turns [min, max] metres.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Dĺžka rovných úsekov medzi zákrutami, [min, max] v metroch.
 *
 * **↓ nižšie:** zákruta za zákrutou, žiadny oddych, žiadne miesto na predbiehanie.
 * **↑ vyššie:** dlhé rovinky. Cesta začne byť nudná a zároveň rýchlejšia, lebo na
 * rovine sa dá držať strop prevodového stupňa.
 */
export const STRAIGHT_LENGTH_RANGE: readonly [number, number] = [80, 250]

/**
 * Length of the full-curvature portion of a turn [min, max] metres.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Dĺžka plne zakrivenej časti zákruty, [min, max] v metroch.
 *
 * **↓ nižšie:** zákruty sú krátke a dá sa cez ne prejsť zotrvačnosťou.
 * **↑ vyššie:** dlhé oblúky, v ktorých treba držať stopu — na ľade je to najtvrdšia
 * vec, akú hra vie postaviť.
 */
export const TURN_LENGTH_RANGE: readonly [number, number] = [120, 450]

/**
 * Length of the smooth ramp into/out of a turn (metres).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Dĺžka plynulého nábehu do zákruty a z nej.
 *
 * **↓ nižšie:** zákruta udrie naraz. Pri veľmi nízkych hodnotách je to zlom, nie
 * oblúk, a nedá sa naň pripraviť.
 * **↑ vyššie:** mäkší nábeh, viac času. Nad ~100 m sa ale zákruta rozplynie a
 * prestane byť udalosťou.
 */
export const TURN_RAMP_M = 60

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako ďaleko dopredu sa ohlasuje zmena povrchu.
 *
 * Dlhšie než {@link CURVE_AHEAD_LOOK_M} zámerne: pred povrchom musíš brzdiť *skôr,
 * než naň prídeš*, kým zákruta je vidieť v samotnej ceste.
 *
 * **↓ nižšie:** varovanie príde neskoro na to, aby sa dalo použiť.
 * **↑ vyššie:** varuje sa priskoro; strip svieti stále a hráč ho prestane čítať.
 */
export const ICE_AHEAD_LOOK_M = 220
