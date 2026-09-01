/**
 * The lamp bloom — the one thing in this game allowed to be brighter than the
 * palette, and the only place off-palette colour appears.
 *
 * It is composited over the finished frame, after the scanlines, so it lives on
 * the glass rather than in the framebuffer. `?glow=0` must keep restoring a
 * byte-identical picture.
 */

//
// Filed with the CRT effect rather than with traffic on purpose: like scanlines
// and the screen curve, glow happens **on the glass**. The framebuffer keeps the
// flat 15-colour palette — nothing here recolours a single game pixel — and the
// bloom is composited over the finished frame with `'lighter'`. `?glow=0` blits
// nothing, and the frame is then byte-for-byte what it was before this existed.
//
// Sizes these are tuned against: a car is about 3 px tall at 220 m and 21 px at
// the last metre, a bus 26 px. The whole road viewport is 88 px.
//
// Everything here was first tuned on the contact sheet and then failed in the
// game, for a reason worth stating once: **`?matrix=1` never draws scanlines**,
// and the game draws them over every frame at `SCANLINE_ALPHA = 0.7`. That is
// two of the four device rows of every game pixel taken to 30% brightness, so
// the whole picture — bloom included — plays at **0.65** of what the sheet
// showed. Judging a brightness on the sheet therefore over-read by 1.54x. The
// sheet can now draw them too (`?scanlines=1`), and the glow is now blitted
// *after* them, which is where the biggest single gain came from.

/**
 * Bloom strength — the `globalAlpha` of the additive blit.
 *
 * `AGENTS.md` costed this at 0.2-0.35 before anything emitted glow. Measured on
 * an oncoming car at zoom 6 against `?glow=0`:
 *
 *     alpha   pixels changed   mean delta   peak delta
 *     0.28        0.61 %           14           66 / 765
 *     0.35        0.64 %           17           82
 *     0.60        0.72 %           26          142
 *     0.90        0.77 %           37          214
 *
 * The reason the low end vanishes is worth keeping: the blob's peak lands on the
 * **lamp**, and a lamp is already `#FFFF00`. Additive light cannot brighten a
 * saturated channel, so everything the player actually sees is the blob's tail
 * falling on the dark road around it — a small fraction of the energy.
 *
 * 0.60 measured well on the sheet and was still invisible in the game (see the
 * scanline note above). 0.8 with two passes is the owner's "must be visible to
 * the naked eye". Overridable per-run with `?glow=0.5`.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Celkové krytie žiary pri blitovaní na hotovú snímku (0.8).
 *
 * **Žiara je uzavretá kapitola** — Fox ju 2026-08-19 po playteste zavrel a nemá sa
 * viesť ako položka na ladenie. Toto tu je preto, aby si vedel, čo ktoré číslo robí,
 * nie ako pozvánka.
 *
 * **↓ nižšie:** decentnejšie, bližšie k ZX. Pri 0 je snímka bajtovo identická
 * s vypnutou žiarou — a to je invariant, nie ciferník.
 * **↑ vyššie:** arkádovejšie. Nad ~1.2 sa lampy zlejú do machule a v diaľke splynú
 * dve svetlá do jedného.
 */
export const GLOW_ALPHA = 0.4

/** Emissive layer is scaled down by this before the bilinear upscale spreads it —
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * O koľko sa emisná vrstva zmenší pred rozmazaním.
 *
 * **↓ nižšie:** ostrejšia žiara, drahšie.
 * **↑ vyššie:** mäkšie a lacnejšie, ale halo stratí tvar a stane sa z neho hmla.
 */
export const GLOW_DOWNSCALE = 2

/**
 * Additive blits per frame.
 *
 * The honest way past `alpha`'s ceiling of 1: a second blit of the same buffer
 * adds the same light again, so two passes is roughly twice the halo without
 * touching its shape. Three starts to flatten the falloff into a disc.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Koľkokrát sa emisná vrstva prekreslí (2).
 *
 * **↓ nižšie:** slabšia a plochejšia žiara.
 * **↑ vyššie:** hustejšia. Je to násobenie ceny, nie sčítanie — každý prechod je
 * celý blit.
 */
export const GLOW_PASSES = 2

/**
 * Halo radius as a fraction of the vehicle's drawn height.
 *
 * Derived from the vehicle rather than fixed, or a bus at 200 m would wear the
 * same halo as a car at arm's length and distance would stop reading. The height
 * is the *drawn* height, which is an output of the resampler — see the rule in
 * `AGENTS.md`: a vehicle's size is never an input.
 *
 * 1.4 makes the halo wider than the vehicle is tall, which is what "modern
 * bloom" means and what the owner asked for. A near car's lower body ends up
 * washed in its own light; that is the effect, not a defect.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Polomer hala ako násobok kreslenej výšky vozidla (1.4).
 *
 * Viazané na vozidlo zámerne, aby vzdialenosť ostala čitateľná — vzdialené auto má
 * malé halo, blízke veľké.
 *
 * **↓ nižšie:** tesnejšie halo, menej dramatické.
 * **↑ vyššie:** halo prerastie vozidlo a v diaľke zlepí obe lampy do jedného bodu.
 */
export const GLOW_RADIUS_PER_HEIGHT = 1.4

/**
 * Floor, in pixels.
 *
 * At 4 px the two lamps of a distant car **merge into one glowing point**, which
 * `AGENTS.md` used to forbid as a smear. Deliberately reversed: at 220 m a car
 * is 3 px tall, and one point that can be seen beats two that cannot. Direction
 * still reads, because it is carried by the halo's colour and never by having
 * two of them.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Spodná hranica polomeru hala v pixeloch.
 *
 * **↓ nižšie:** v diaľke žiara zmizne vnútri jednej rozmazávacej bunky.
 * **↑ vyššie:** aj najvzdialenejšie auto má viditeľné svetlo — ale prestane byť
 * malé.
 */
export const GLOW_RADIUS_MIN = 3

/**
 * Hard cap, in pixels. Still a cap — without one a bus in the last metres would
 * light half the viewport — but set where the bloom is allowed to be obvious.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Strop polomeru hala v pixeloch.
 *
 * **↓ nižšie:** blízke vozidlá stratia dramatickosť.
 * **↑ vyššie:** posledné metre autobusu rozsvietia polovicu výhľadu.
 */
export const GLOW_RADIUS_MAX = 18

/**
 * Brightness of a traffic lamp's halo, 0..1, before the layer alpha.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Intenzita hala lámp dopravy (1).
 */
export const GLOW_INTENSITY_TRAFFIC = 1

/**
 * How much wider a same-direction lamp's halo gets when the vehicle is braking,
 * and how many times its source is stacked.
 *
 * **This is what carries the brake at any distance, and the measurement that
 * says so is worth keeping.** The raster swaps `RED` (#CD0000) for `B_RED`
 * (#FF0000) — 50 units on one channel, across two cells at 200 m. Measured
 * through the real render path with `frame-delta.mjs`:
 *
 *     glow off   0.03 % of pixels changed · peak 50 / 765
 *     glow on    0.00 % of pixels changed · byte-identical
 *
 * The bloom is composited with `'lighter'`, so it drives the red channel to 255
 * on and around the lamp **whether the lamp began at 205 or at 255**. The brake
 * was not faint; it was erased. This is the same trap `AGENTS.md` records from
 * the first glow pass — "a lamp is already #FFFF00 and additive light cannot
 * brighten a saturated channel" — biting a second time, one vehicle further out.
 *
 * The signal therefore has to be in the halo's *size and density*, not in the
 * lamp's colour. Deliberately **not** a white core the way the player's truck
 * gets one: white desaturates the halo, and at distance that halo's colour is
 * the only thing saying which way the vehicle is pointing. A braking car reads
 * as more red, never as a different red.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * O koľko sa halo rozšíri pri brzdení (1.7).
 *
 * **Toto nesie brzdu na každej vzdialenosti** a je to tak preto, že raster ju
 * neunesie: prehodenie `RED` (#CD0000) na `B_RED` (#FF0000) je 50 jednotiek na
 * jedinom kanáli a `'lighter'` ich do seba nasýti — snímka vyšla **bajtovo
 * identická**.
 *
 * **↓ nižšie:** brzdenie prestane byť vidieť; pri 1.0 zmizne úplne.
 * **↑ vyššie:** výraznejšie. Nad ~2.5 halo prerastie vozidlo natoľko, že prestane
 * byť jasné, ktoré auto brzdí.
 */
export const GLOW_RADIUS_BRAKE_MULT = 1.7

/**
 * How many times a braking lamp's halo is stacked. Density without new colour.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Koľkokrát sa halo brzdiacej lampy prekreslí navrch (2).
 *
 * Hustota bez novej farby. **Zámerne nie biele jadro** ako má kamión — biela odsycuje
 * halo a v diaľke je jeho farba jediné, čo nesie smer. Brzdiace auto je *viac*
 * červené, nikdy *inak* červené.
 */
export const GLOW_BRAKE_PASSES = 2

/**
 * The white-hot core: a second, small source drawn in `B_WHITE` on top of the
 * coloured halo.
 *
 * This is the one place the game puts a colour on screen that is not in the
 * palette, and it is deliberate — see `CLAUDE.md`. Additive white raises the
 * green and blue channels of a red lamp, so the lamp itself blows out toward
 * white instead of staying a flat red rectangle with a glow beside it. Nothing
 * in the framebuffer changes; it happens on the glass, like the scanlines.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Intenzita bieleho jadra v strede lampy.
 *
 * **↓ nižšie:** lampa ostane plochý farebný obdĺžnik s halom vedľa.
 * **↑ vyššie:** lampa sa prepáli do biela. Práve to jej dáva ten okamžitý čitateľný
 * dojem zblízka — a práve preto sa v diaľke nepoužíva.
 */
export const GLOW_CORE_INTENSITY = 0.5

/** Core radius as a fraction of the vehicle's drawn height, floored and capped
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Polomer bieleho jadra ako násobok kreslenej výšky.
 */
export const GLOW_CORE_RADIUS_PER_HEIGHT = 0.3

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Spodná hranica polomeru jadra.
 */
export const GLOW_CORE_RADIUS_MIN = 2

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Strop polomeru jadra.
 */
export const GLOW_CORE_RADIUS_MAX = 4

/**
 * Shortest drawn vehicle that gets a core, in pixels.
 *
 * Kept at 8 px, now the plain far/mid handover, because of what the core costs:
 * it desaturates the halo toward white, and
 * far away the halo's **colour is the only thing that says which way the vehicle
 * is going**. Close up the shape already says it, so the light may blow out.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Od akej kreslenej výšky vozidlo vôbec dostane biele jadro (10 px).
 *
 * **↓ nižšie:** jadro aj v diaľke — a tam **biela odsýti farbu hala, ktorá je
 * jediné, čo hovorí, ktorým smerom vozidlo ide**. Preto je táto hranica pravidlo,
 * nie preferencia.
 * **↑ vyššie:** jadro až celkom zblízka; lampy stratia ostrosť v strednom poli.
 */
export const GLOW_CORE_MIN_HEIGHT = 8

/**
 * The player's own tail lamps, which are on screen every single frame.
 *
 * Dimmer than traffic on purpose: it is a constant in the corner of the eye and
 * must not compete with the road. Braking is the exception — that is real
 * feedback about a real input.
 *
 * The brake is now carried **twice over**: the lamps themselves swap `RED` for
 * `B_RED` in the framebuffer (see `TRUCK_LAMP_COLORS` in `render/truck.ts`), and
 * the halo brightens, grows and gains a core on top of that. The raster half is
 * what makes the brake readable with `?glow=0`; the glow half is what makes it
 * obvious with glow on. One signal alone is what made the first attempt
 * unnoticeable — intensity 0.65 -> 1.0 was a peak of 61 -> 93 out of 765, before
 * the scanlines took a further third of it.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Intenzita hala vlastných lámp kamióna pri jazde.
 *
 * Nižšia než pri doprave zámerne: kamión je vždy na obrazovke a jeho svetlá nesmú
 * prehlušiť to, čo sa deje pred ním.
 */
export const TRUCK_GLOW_INTENSITY = 0.55

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Intenzita hala kamióna pri brzdení.
 *
 * **↓ nižšie:** brzda vlastného kamióna prestane byť vidieť — a s `?glow=0` ju nesie
 * už len raster.
 * **↑ vyššie:** výraznejšia. Musí zostať nad {@link TRUCK_GLOW_INTENSITY}, inak
 * brzda *stlmí* svetlá namiesto toho, aby ich rozžiarila.
 */
export const TRUCK_GLOW_BRAKE_INTENSITY = 1

/**
 * Fixed — the truck sprite never changes size, so nothing can derive it — and
 * larger than a traffic halo, for a reason that only applies to this sprite: its
 * lamps are **surrounded by its own bright pixels**, a white bumper above and
 * cyan wheels below. Additive light cannot brighten white, so a halo that only
 * reaches its neighbours is spent before it finds anything dark. These radii
 * reach the road either side, which is where the light becomes visible at all.
 * 
 * Rrmeber: TRUCK_GLOW_BRAKE_RADIUS must be greater than TRUCK_GLOW_RADIUS
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Polomer hala kamióna pri jazde, v pixeloch.
 */
export const TRUCK_GLOW_RADIUS = 8

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Polomer hala kamióna pri brzdení.
 *
 * **Musí byť väčší než {@link TRUCK_GLOW_RADIUS}** — brzda nesie tri zmeny naraz
 * (jasnejšie, väčšie, s jadrom), lebo signál nesený jedným číslom bolo presne to,
 * čo v prvom kole nebolo vidieť.
 */
export const TRUCK_GLOW_BRAKE_RADIUS = 10

/**
 * Brake-light core radius. Fixed for the same reason as the radii above.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Polomer bieleho jadra kamióna pri brzdení.
 */
export const TRUCK_GLOW_CORE_RADIUS = 2
