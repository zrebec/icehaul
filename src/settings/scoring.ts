/**
 * What the driving pays.
 *
 * Two numbers, kept apart from the mission because they answer a different
 * question: the mission decides whether a run continues, scoring decides what it
 * was worth.
 */

import type { Surface } from './surfaces.ts'

/**
 * Points for every 100 m covered, before the surface multiplier.
 *
 * Delivery used to be the only thing that ever moved the score, so 5 km of
 * driving and every hazard survived along the way read as a flat 500 whatever
 * happened. Distance is what the player actually spends, so distance is what
 * pays.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Body za každých 100 prejdených metrov.
 *
 * Skóre je **spojité** zámerne — platí sa za prejdenú cestu, nie za odovzdanie, aby
 * jazda, ktorá skončí 200 m pred cieľom, nebola nula.
 *
 * **↓ nižšie:** dodávky a povrchový bonus získajú na váhe.
 * **↑ vyššie:** hra začne odmeňovať samotnú vzdialenosť a riskovať sa prestane
 * oplácať.
 */
export const SCORE_PER_100M = 10

/**
 * What each surface multiplies those points by — the risk premium.
 *
 * Sized so the bonus is a real signal without dominating: on the measured mean
 * surface mix of a route the weighted multiplier is about 1.085, so a 5 km leg
 * scores ~543. The extremes are 500 (all asphalt) against 700 (all ice), which
 * is the shape wanted — ice is worth driving, not worth farming.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Násobič bodov podľa povrchu — koľko sa platí za to, že si tadiaľ šiel.
 *
 * Toto je jediné miesto, kde hra hovorí, že ľad je hodnotnejší než asfalt. Nie je to
 * fyzika, je to **odmena za riziko**.
 *
 * **↓ nižšie u povrchu:** prestane sa oplácať a hráč ho bude len prežívať.
 * **↑ vyššie:** stane sa cieľom. Pri veľkých rozdieloch začne mať zmysel ľad
 * vyhľadávať namiesto prežívať — a to je iná hra, než akú dnes hráme.
 */
export const SURFACE_SCORE_MULT: Record<Surface, number> = {
  asphalt: 1.0,
  snow: 1.2,
  ice: 1.4,
  sand: 1.3,
  mud: 1.1,
}
