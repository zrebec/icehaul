/** Leaving the road, and what it costs. */

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Spomalenie mimo cesty, km/h za sekundu.
 *
 * **↓ nižšie:** krajnica prestane trestať a dá sa cez ňu skracovať zákruty.
 * **↑ vyššie:** vyjazdenie z cesty je takmer zastavenie. Pozor na súčin s časovým
 * limitom — vysoké čísla menia chybu na koniec jazdy bez toho, aby to hra povedala.
 */
export const OFF_ROAD_DRAG = 55

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako rýchlo hra tlačí kamión späť na cestu.
 *
 * **↓ nižšie:** hráč sa musí vrátiť sám a mimo cesty sa dá zostať dlho.
 * **↑ vyššie:** cesta si ťa pritiahne. Príliš vysoké číslo pôsobí, akoby volant
 * nebol tvoj.
 */
export const OFF_ROAD_RETURN = 1.8

/**
 * Severity (0–1) at which off-road becomes an instant crash.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako hlboko mimo cesty už ide o haváriu, nie o krajnicu.
 *
 * **↓ nižšie:** prísnejšie — zavadiť o krajnicu znamená koniec jazdy.
 * **↑ vyššie:** zhovievavejšie, dá sa vyjsť a vrátiť sa.
 */
export const OFFROAD_CRASH_SEVERITY = 0.4

/**
 * Seconds of ANY off-road before game over.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Koľko sekúnd smieš byť mimo cesty, než to hra vyhodnotí ako haváriu.
 *
 * **↓ nižšie:** okamžitý trest, žiadny priestor na nápravu.
 * **↑ vyššie:** dá sa mimo cesty jazdiť. Nad ~5 s prestane byť cesta cestou.
 */
export const OFFROAD_TIMEOUT_S = 3.0

/**
 * Pixel margin to road edge that triggers "approaching edge" warning.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Ako blízko k okraju ešte hra mlčí, v pixeloch.
 *
 * **↓ nižšie:** varovanie príde neskoro a je z neho oznam o nehode.
 * **↑ vyššie:** varuje skôr, ale pri vysokých hodnotách kričí aj vtedy, keď ideš
 * správne stredom svojho pruhu.
 */
export const EDGE_MARGIN_WARN_PX = 8

/**
 * Crash animation duration in ms before game-over screen.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Dĺžka nárazovej animácie.
 *
 * **↓ nižšie:** rýchly prechod na výsledkovku — menej dramatické, plynulejšie
 * opakovanie.
 * **↑ vyššie:** náraz má váhu, ale opakované pokusy sa naťahujú.
 */
export const CRASH_ANIM_MS = 1200
