/**
 * The engine, the tyres and the beeps.
 *
 * Three AY channels and a beeper is the whole budget, so every number here is
 * really a decision about what gets to be heard at the same time as what.
 */

import type { Surface } from './surfaces.ts'

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Celková hlasitosť motora (0.06).
 *
 * **↓ nižšie:** motor ustúpi do pozadia. Pozor — už dnes ho prehlušuje povrch, a
 * nie kvôli mixu, ale kvôli **frekvencii**: motor beží na 40–235 Hz, čo reproduktor
 * notebooku sotva reprodukuje a ucho je v tom pásme o ~25 dB menej citlivé než na
 * 1 kHz. Šum povrchu je širokopásmový a sadne presne tam, kde ucho žije.
 * **↑ vyššie:** hlasnejší, ale nie *prítomnejší*. Riešenie je harmonická o oktávu
 * vyššie na kanáli B, nie tento ciferník.
 */
export const ENGINE_GAIN = 0.06

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Najkratší odstup medzi dvoma pisknutiami pneumatík.
 *
 * **↓ nižšie:** piskot pri každom zaváhaní — po chvíli prestane niesť informáciu.
 * **↑ vyššie:** piskot je udalosť. Nad ~1 s ale zmeškáš tú, ktorá naozaj varovala.
 */
export const SCREECH_COOLDOWN_S = 0.35

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Najkratší odstup medzi pípnutiami mimo cesty.
 *
 * **↓ nižšie:** neprestajné pípanie, ktoré hráč vypne v hlave.
 * **↑ vyššie:** pokojnejšie, ale hrozí, že si vyjazdenie nevšimne včas.
 */
export const OFFROAD_BEEP_COOLDOWN_S = 0.25

/**
 * Per-surface engine sound: [oscillator type, idle Hz, top Hz].
 * Asphalt: clean square. Snow: muffled triangle. Ice: sharp sawtooth.
 * Sand: deep square. Mud: modulated triangle.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Zvuk motora podľa povrchu: [typ oscilátora, voľnobežné Hz, maximálne Hz].
 *
 * Nie je to hlasitosť, je to **farba a rozsah**. Asfalt čistý štvorec, sneh tlmený
 * trojuholník, ľad ostrá píla, piesok hlboký štvorec, blato modulovaný trojuholník.
 *
 * **↓ nižšie Hz:** ťažší, hlbší stroj — ale hlbšie do pásma, ktoré reproduktor
 * neprenesie, takže *tichší* aj keď je hlasnejší.
 * **↑ vyššie Hz:** ostrejší a lepšie počuteľný motor, ale stráca hmotnosť
 * dvadsaťtonového kamióna. Rozdiel medzi voľnobehom a maximom je to, čo dáva
 * otáčkam sluchový zmysel — pri malom rozpätí prestaneš počuť, že radíš.
 */
export const SURFACE_ENGINE_SOUND: Record<Surface, readonly [OscillatorType, number, number]> = {
  asphalt: ['square', 40, 235],
  snow: ['triangle', 35, 180],
  ice: ['sawtooth', 50, 280],
  sand: ['square', 25, 140],
  mud: ['triangle', 30, 160],
}
