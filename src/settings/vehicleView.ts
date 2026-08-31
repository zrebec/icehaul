/**
 * How a vehicle is drawn at distance: the growth curve, the LOD boundary, and the
 * dark pass behind it.
 *
 * These lived under a heading that said "Road generation", which is a good part
 * of why nobody could find them. They belong to neither the road nor the traffic
 * model — they are what turns a vehicle's depth into pixels, and six pull
 * requests were spent getting them right.
 */

/**
 * Traffic sprite scale as a function of world depth: `A / (z + B)`, with `A` and
 * `B` solved from the two anchors below. Hyperbolic, because that is what
 * perspective is — apparent size falls as 1/distance — with `B` as the offset
 * that keeps the near end finite instead of infinite.
 *
 * ── Why this replaced the old curve ─────────────────────────────────────────
 * It used to be `0.28 + sqrt(tScale) * 1.15`, whose floor of 0.28 and square root
 * flattened the far field almost to nothing. Measured widths for a car:
 *
 *     distance   220  100   50   25   10    5    2
 *     old          8    9   11   13   17   21   29
 *     new          4    8   13   18   25   28   30
 *
 * Over the 170 m from 220 to 50 the old curve grew a car by 3 px — 1.4x across
 * three quarters of the approach — and then trebled it in the last 48 m. That is
 * the reported "I see it the same for ages and then it is suddenly on me": the
 * growth cue arrives far too late to read as closing speed. The new curve spreads
 * that same stretch over 3.2x.
 *
 * The near anchor is deliberately unchanged. A vehicle beside the player is the
 * one place the old sizing was right, and the owner asked to keep it.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Mierka spritu v blízkej kotve — aké veľké je vozidlo tesne pred tebou.
 *
 * Krivka rastu je hyperbola `A / (z + B)` prevedená cez dve kotvy, tú blízku a
 * {@link TRAFFIC_SCALE_FAR}. Toto je jej blízky koniec.
 *
 * **↓ nižšie:** autá zblízka pôsobia menšie a menej hrozivo, ale poslednú chvíľu
 * pred kolíziou zle odhadneš.
 * **↑ vyššie:** väčšie a dramatickejšie zblízka. Nad ~1.8 začne autobus prerastať
 * svoj jazdný pruh a rozbije to, čo šesť PR-iek opravovalo.
 */
export const TRAFFIC_SCALE_NEAR = 1.43

/**
 * Depth, in metres, at which {@link TRAFFIC_SCALE_NEAR} applies.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Hĺbka, v ktorej platí {@link TRAFFIC_SCALE_NEAR}.
 *
 * **↓ nižšie:** kotva sa priblíži, krivka je strmšia — vozidlá narastú až na
 * poslednú chvíľu.
 * **↑ vyššie:** rast sa rozloží skôr a plynulejšie.
 */
export const TRAFFIC_SCALE_NEAR_Z_M = 1.2

/**
 * Scale at {@link TRAFFIC_SCALE_FAR_Z_M}. 0.20 puts a car at 4 px wide — small
 * enough to read as far away, large enough that the far tier's two lamps still
 * land in separate columns. Lower it and distant traffic becomes a single dot.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Mierka spritu v ďalekej kotve — 0.20 dá autu 4 px šírky.
 *
 * **↓ nižšie:** vzdialené autá sú menšie bodky. Pod ~0.15 už nesú len farbu lampy
 * a nič viac, takže typ sa stratí úplne.
 * **↑ vyššie:** vidno ich lepšie, ale stratí sa čitateľnosť polohy v pruhu — a to
 * je jediná vec, ktorú na 220 m naozaj potrebuješ vedieť.
 */
export const TRAFFIC_SCALE_FAR = 0.20

/**
 * Depth the far anchor is measured at — the end of `TRAFFIC_VIEW_DISTANCE_M`.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Hĺbka, v ktorej sa meria ďaleká kotva — koniec dohľadu.
 */
export const TRAFFIC_SCALE_FAR_Z_M = 220

/**
 * Solved from the anchors: `scale(z) = A / (z + B)` passes through both.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Odvodené z kotiev, neladí sa priamo. Posunutie, ktoré drží blízky koniec krivky
 * konečný namiesto nekonečného.
 */
export const TRAFFIC_SCALE_B =
  (TRAFFIC_SCALE_FAR * TRAFFIC_SCALE_FAR_Z_M - TRAFFIC_SCALE_NEAR * TRAFFIC_SCALE_NEAR_Z_M) /
  (TRAFFIC_SCALE_NEAR - TRAFFIC_SCALE_FAR)

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Odvodené z kotiev, neladí sa priamo. Čitateľ krivky `scale(z) = A / (z + B)`.
 */
export const TRAFFIC_SCALE_A = TRAFFIC_SCALE_NEAR * (TRAFFIC_SCALE_NEAR_Z_M + TRAFFIC_SCALE_B)

/**
 * Physical sprite boxes before projection. Authored LOD grids may be smaller or
 * larger, but lane fit, growth and collision continue to use these dimensions.
 */
export const TRAFFIC_CANONICAL_SIZE = {
  mini: { w: 14, h: 11 },
  car: { w: 22, h: 15 },
  bus: { w: 28, h: 18 },
} as const

/**
 * Tallest projected height still drawn by the far tier, in pixels.
 *
 * Raised from 9 to 10 when the sprite started being sampled at a fractional
 * size: the height is now the box that *contains* the sprite (`ceil`) rather
 * than the sprite rounded to whole pixels, so the same physical vehicle reports
 * about one pixel more. The extra pixel keeps the boundary where it was — a car
 * hands over at roughly 50 m, as before — rather than moving it.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Najvyššia premietnutá výška, ktorú ešte kreslí ďaleký stupeň, v pixeloch.
 *
 * **↓ nižšie:** detailný sprite začne skôr — viac kresby, ale pri malých veľkostiach
 * sa lampy stratia v karosérii a smer prestane byť čitateľný.
 * **↑ vyššie:** ďaleký stupeň drží dlhšie. Ten *garantuje* lampy tým, že ich zapíše
 * do vonkajších stĺpcov, takže smer prežije — za cenu toho, že vnútorné keylines
 * uvidíš až neskôr.
 */
export const LOD_FAR_MAX_HEIGHT = 10

/**
 * Dead-band around {@link LOD_FAR_MAX_HEIGHT}, in pixels. Same-direction traffic
 * closes and falls back as it brakes, so the projected height wobbles by a pixel;
 * without this the vehicle would flicker between two different drawings.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Šírka pásma, v ktorom sa stupeň neprepína, v pixeloch.
 *
 * **↓ nižšie:** vozidlo pri hranici bliká medzi dvoma kresbami. Pri 0 to bliká vždy,
 * keď sa výška zachveje o pixel — a súbežná doprava, ktorá brzdí, sa práve takto
 * chveje.
 * **↑ vyššie:** pokojnejšie, ale prepnutie príde citeľne neskôr, než by malo.
 */
export const LOD_HYSTERESIS_PX = 1

/**
 * Shortest projected vehicle, in pixels, that still gets a dark outline.
 *
 * The outline exists because a bright road — ice, snow, sand — leaves a pale
 * vehicle with nothing marking where it ends. Below this height it starts
 * costing more than it buys: a halo around a 3 × 2 blob is more pixels than the
 * blob, so the vehicle would read as *larger* the further away it is, undoing
 * the growth curve the whole approach depends on.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Od akej výšky vozidlo dostane tmavý obrys.
 *
 * **↓ nižšie:** obrys aj na najmenších — jednopixelový lem okolo štvorpixelového
 * auta ale zožerie samotné auto.
 * **↑ vyššie:** obrys až zblízka. Pozor: **obrys je to, čo oddeľuje biele
 * protiidúce auto od snehu**, takže vysoká hodnota vráti presne tú chybu, kvôli
 * ktorej vznikol.
 */
export const CONTOUR_MIN_HEIGHT = 5

/**
 * Shortest projected vehicle that also gets a contact shadow.
 *
 * Higher than the outline's threshold on purpose: an outline needs a silhouette
 * and a shadow needs a *ground line*, and at four or five pixels there is no
 * room to tell "under the vehicle" from "part of the vehicle".
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Od akej výšky vozidlo dostane kontaktný tieň.
 *
 * **↓ nižšie:** tieň aj v diaľke, kde je z neho len tmavý pixel navyše.
 * **↑ vyššie:** bez tieňa vozidlo *pláva* nad cestou, lebo nič nehovorí, kade pod
 * ním prechádza povrch.
 */
export const SHADOW_MIN_HEIGHT = 7

/**
 * Traffic look-ahead distance in metres.
 * Kept separate from road scanline projection so vehicles can be introduced
 * earlier than the short visible road texture depth.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako ďaleko sa doprava vôbec kreslí.
 *
 * **↓ nižšie:** cesta pôsobí prázdnejšie a na predbiehanie máš menej času na
 * rozmyslenie.
 * **↑ vyššie:** vidíš ďalej, ale vozidlá za týmto bodom sú tak či tak pár pixelov
 * a stoja výkon. Je to zároveň ďaleká kotva krivky rastu — zmena tu posunie aj to,
 * ako rýchlo vozidlá rastú.
 */
export const TRAFFIC_VIEW_DISTANCE_M = 220
