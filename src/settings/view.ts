/**
 * How the road is drawn — perspective, kerbs, markers.
 *
 * Separate from `route.ts` on purpose: that file decides what the road *is*, this
 * one decides what it *looks like*, and they are almost never tuned in the same
 * sitting.
 */

//
// Deliberately at the top of the file rather than filed under "Road rendering"
// further down: these five decide what the road *looks* like, they interact,
// and they are the ones that get re-tuned by eye. Everything else about the
// road is downstream of them.
//
// Together with HORIZON_PCT above they define the whole ribbon. Substituting
// `i = round(PERSPECTIVE_K / z) - 1` and `t = (i+1)/roadHeight` collapses the
// renderer's per-scanline arithmetic into one law:
//
//     half(z) = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * (PERSPECTIVE_K/z) / roadHeight
//             = ROAD_HALF_TOP + 178.652 / z            (at today's values)
//
// Six places compute that expression — road3d.ts (road, canisters, traffic,
// roadside) and roadgeometry.ts (the off-road boundary) — so a change here
// moves the painted road and the boundary the player is judged against
// together, which is the only way they may ever move.

/**
 * Road half-width at the horizon, in game pixels. The ribbon is `2 x` this wide
 * where it meets the sky.
 *
 * Not a perspective quantity — true perspective would converge to zero and the
 * road would vanish into a point three scanlines up. This additive floor is what
 * keeps a readable ribbon at the horizon, and it is the `ROAD_HALF_TOP` term in
 * the law above.
 *
 * ── Why it moved from 14 to 24 ──────────────────────────────────────────────
 * A vehicle's size is a different fake: `scale(z) = A / (z + B)`, which never
 * grows past `A/B`. Divide the two and the share of a lane a vehicle covers has
 * an interior maximum with a closed form,
 *
 *     z* = sqrt(TRAFFIC_SCALE_B * 178.652 / ROAD_HALF_TOP)
 *
 * so the hump is structural rather than a tuning slip — the ratio goes to zero
 * at both ends and has to peak somewhere in between. At 14 it peaked at 20.9 m
 * holding **1.21 lanes for a bus**, which is what the owner saw: a vehicle drawn
 * wider than the lane it sits in, between roughly 40 m and 10 m.
 *
 * Raising this floor is the one lever that fixes the ratio without touching
 * vehicle scale, so the growth curve (#30), the approach cadence (#34), the LOD
 * thresholds and every collision raster stay byte-identical. At 24 the bus peaks
 * at 0.84 of a lane and z* moves to 16.0 m.
 *
 * ── The open question, kept here on purpose ─────────────────────────────────
 * 24 costs a 48 px ribbon at the horizon instead of 28 — a less funnel-like
 * perspective. Owner accepted that for now and wants to revisit narrowing it.
 * The dial is continuous, and the bus's peak lane share moves with it:
 *
 *     20 -> 0.94    22 -> 0.89    24 -> 0.84    26 -> 0.80
 *
 * Anything at or below about 26 keeps every vehicle inside its lane.
 * `laneFit.test.ts` holds the property, not the number, so it will follow a
 * re-tune rather than fight it — but it fails below roughly 18, which is the
 * point of it.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Polovičná šírka cesty na horizonte, v pixeloch.
 *
 * **Prijaté dočasne na 24** a Fox sa s tým chce hrať. Zvýšenie zo 14 na 24 opravilo
 * autobus kreslený na 1,21 jazdného pruhu — pomer šírky cesty a veľkosti vozidla má
 * vrchol uprostred nájazdu a tento ciferník ho posúva bez toho, aby sa dotkol
 * spritov.
 *
 * **↓ nižšie:** cesta sa v diaľke zúži, perspektíva je dramatickejšia — a vozidlá
 * začnú pôsobiť priširoko.
 * **↑ vyššie:** cesta na horizonte je širšia, vozidlá sa doň pohodlne zmestia, ale
 * stráca sa hĺbka.
 */
export const ROAD_HALF_TOP = 24

/**
 * Road half-width at the bottom of the viewport, in game pixels.
 *
 * 120 makes the road 240 px across a 256 px screen — a very wide ribbon, and
 * the reason a vehicle beside the player covers only a third of its lane while
 * the player's own truck (a fixed 32 x 40 px box) covers a quarter. Narrowing
 * it would improve that end and make the middle worse, and it moves the
 * off-road boundary, so it is a difficulty change and invalidates the seed
 * catalogue in AGENTS.md. Not a dial to turn casually.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Polovičná šírka cesty pri spodnej hrane výhľadu.
 *
 * **↓ nižšie:** úzka cesta pod kolesami — prísnejšie na držanie stopy.
 * **↑ vyššie:** široká. Spolu s {@link ROAD_HALF_TOP} to určuje celý perspektívny
 * lievik; meniť ich treba spolu, inak sa cesta začne rozbiehať alebo zbiehať.
 */
export const ROAD_HALF_BOTTOM = 120

/**
 * Projection depth constant, in metres. Sets how fast the world rushes at you:
 * a scanline `dy` below the horizon is `PERSPECTIVE_K / dy` metres away.
 *
 * At 150 the first three scanlines carry 220 m, 75 m and 50 m, so the entire
 * far field lives in two pixels of height. That is why traffic size cannot be
 * a function of the scanline and is hyperbolic in true world depth instead
 * (see TRAFFIC_SCALE_* below). Raising it stretches the far field down the
 * screen and compresses the near one.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Konštanta perspektívy — ako sa hĺbka mapuje na scanline.
 *
 * **↓ nižšie:** horizont sa priblíži, dohľad sa skráti.
 * **↑ vyššie:** dlhší dohľad. Pozor: pri 150 ležia 220/75/50 m na scanlinoch 1/2/3,
 * takže **žiadna funkcia scanlinu nevie ďaleké pole rozprestrieť** — je to dôvod,
 * prečo krivka rastu vozidiel počíta v skutočnej hĺbke a nie v riadku obrazovky.
 */
export const PERSPECTIVE_K = 150

/**
 * How hard a bend pushes the road sideways per unit of curvature. The bend the
 * player steers against and the bend they see are the same number, so this is
 * a difficulty dial as much as a visual one.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako silno sa zákruta prejaví v kresbe cesty.
 *
 * **↓ nižšie:** cesta vyzerá rovnejšie, než sa správa — hráč je trestaný za zákrutu,
 * ktorú nevidel.
 * **↑ vyššie:** zákruty sú výraznejšie. Nad ~1.5 sa cesta začne vlniť viac, než jej
 * fyzika zodpovedá, a odhad stopy prestane sedieť.
 */
export const CURVE_STRENGTH = 1.0

/**
 * How far the vanishing point slides per unit of player lateral position.
 *
 * Note it is not the axis the truck itself moves on: the truck is drawn at
 * `GAME_WIDTH/2 + v.x * 50` (drive.ts), so the player moves 50 + 22 = 72 px per
 * unit relative to the road, while a traffic vehicle's `x` moves it `half` px
 * per unit with +/-1 being the road edge exactly. The player's `x` and traffic's
 * `x` therefore mean two different things — see AGENTS.md.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * O koľko pixelov sa obraz cesty posunie za jednotku bočnej polohy.
 *
 * **↓ nižšie:** pohyb do strán je sotva vidieť a hra pôsobí ako na koľajniciach.
 * **↑ vyššie:** silnejší pocit vybočenia, ale pri vysokých hodnotách sa cesta pri
 * zatáčaní hádže po obrazovke.
 */
export const LATERAL_SHIFT = 22

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Dĺžka jedného obrubníkového pruhu v metroch.
 *
 * Obrubník je **najsilnejší ukazovateľ rýchlosti**, aký hra má — pri konštantnej
 * rýchlosti bliká konštantne.
 *
 * **↓ nižšie:** pruhy sú husté a v diaľke splynú do jednej šedej čiary.
 * **↑ vyššie:** dlhé pruhy, pomalšie blikanie — hra bude pôsobiť pomalšie, aj keď
 * ideš rovnako rýchlo.
 */
export const KERB_STRIPE_M = 2.0

/**
 * Driveable kerb/shoulder width in projected game pixels.
 *
 * Shared by `render/road3d.ts` and `game/roadgeometry.ts`, so the painted
 * shoulder and the off-road boundary stay pixel-identical — if these ever drift
 * apart the player leaves the road somewhere other than where it looks like they
 * do, which is the worst kind of unfair.
 *
 * The foreground kerb is deliberately broad. Its inner part is calm recovery
 * space for an ordinary wobble; its outer 8 px overlap EDGE_MARGIN_WARN_PX, so
 * the edge warning fires while there is still shoulder left rather than at the
 * moment terrain begins. Widening it does not change the controllability
 * envelope — a slide on ice runs to the lateral clamp rather than stopping just
 * over the line — it buys room for small mistakes, which is a different thing.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Šírka obrubníka na horizonte, v pixeloch.
 *
 * **↓ nižšie:** pri 0 obrubník v diaľke zmizne a s ním aj pocit rýchlosti.
 * **↑ vyššie:** hrubý okraj v diaľke ukradne cestu, ktorej je tam beztak málo.
 */
export const KERB_WIDTH_TOP = 1

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Šírka obrubníka pri spodnej hrane, v pixeloch.
 *
 * **↓ nižšie:** okraj cesty je jemnejší, viac miesta na jazdu.
 * **↑ vyššie:** výrazný okraj priamo pod kolesami — dobré na odhad polohy, ale
 * zožerie šírku jazdného pruhu.
 */
export const KERB_WIDTH_BOTTOM = 16

/**
 * Road segment marker spacing in metres. Thin horizontal lines across
 * the road that rush toward the player — primary speed perception cue.
 * At 120 km/h: ~1.3 markers/s. At 30 km/h: ~0.33 markers/s.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Rozostup smerových stĺpikov pri ceste, v metroch.
 *
 * **↓ nižšie:** hustý plot stĺpikov — silný pocit rýchlosti, ale vizuálny šum.
 * **↑ vyššie:** riedke stĺpiky. Nad ~60 m prestanú niesť rýchlosť a stanú sa
 * náhodnou dekoráciou.
 */
export const ROAD_MARKER_SPACING_M = 25

/**
 * How far ahead markers are drawn, in metres.
 *
 * Deliberately equal to the spacing, so exactly ONE marker is on screen at a
 * time: it appears near the horizon, walks down, and the next one only shows up
 * after it has passed under the cab. Raising this to 37.5 puts two markers on
 * screen (the far one parked a few pixels under the horizon), which reads as
 * clutter rather than speed.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako ďaleko sa stĺpiky kreslia.
 */
export const ROAD_MARKER_VIEW_M = 25

/**
 * Depth of the painted band in metres — gives near markers perspective thickness.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Hĺbka stĺpika v metroch — aký hrubý je v smere jazdy.
 */
export const ROAD_MARKER_DEPTH_M = 0.4

/**
 * Thickness cap in pixels, so a marker at the player's feet stays a line, not a slab.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Strop šírky stĺpika v pixeloch, aby zblízka neprerástol.
 */
export const ROAD_MARKER_MAX_PX = 3

/**
 * Centre line: painted dash length in metres.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Dĺžka jednej čiarky stredovej deliacej čiary.
 *
 * **↓ nižšie / ↑ vyššie:** spolu s {@link CENTRE_GAP_M} určuje rytmus stredovej
 * čiary. Je to druhý ukazovateľ rýchlosti po obrubníku — a jediný, ktorý hovorí,
 * kde končí tvoj pruh a začína protismer.
 */
export const CENTRE_DASH_M = 2

/**
 * Centre line: gap between dashes in metres.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Medzera medzi čiarkami stredovej čiary.
 *
 * **↓ nižšie:** čiara sa blíži k plnej — pruh je zreteľnejší, rytmus slabší.
 * **↑ vyššie:** riedka prerušovaná čiara. Pri veľkých medzerách sa stredová čiara
 * v diaľke stratí a s ňou aj informácia, kam patríš.
 */
export const CENTRE_GAP_M = 4
