/**
 * The frame itself: 256 x 192 game pixels, where the three bands sit inside it,
 * and the glass in front of them.
 *
 * Nothing here is a gameplay dial. Everything else measures itself against these
 * numbers, which is why they come first and why they move last.
 */

/**
 * Central configuration — every tunable constant lives here.
 * Grouped by system. Import what you need, tune in one place.
 */


/**
 * Game canvas width in pixels. ZX Spectrum native: 256.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Šírka herného plátna v pixeloch. **Konštrukčné číslo, nie ciferník** — 256×192
 * je natívne rozlíšenie ZX Spectra a celá hra sa proti nemu meria.
 *
 * **↓ / ↑:** je to zmena rozlíšenia. Posunie projekciu, tri LOD prahy, kolízny
 * raster aj rozmery spritov naraz — nie je to grafická zmena, je to **reset
 * ladenia jazdy**. Zamietnuté; revidovať len kvôli miestu na HUD.
 */
export const GAME_WIDTH = 256

/**
 * Game canvas height in pixels. ZX Spectrum native: 192.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Výška herného plátna. Viď {@link GAME_WIDTH} — to isté konštrukčné číslo a tá
 * istá cena za jeho zmenu.
 */
export const GAME_HEIGHT = 192

/**
 * Character columns (GAME_WIDTH / 8).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Počet znakových buniek na šírku (256 / 8). Odvodené, nie voliteľné.
 */
export const COLS = GAME_WIDTH / 8

/**
 * Character rows (GAME_HEIGHT / 8).
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Počet znakových buniek na výšku (192 / 8). Odvodené, nie voliteľné.
 */
export const ROWS = GAME_HEIGHT / 8

/**
 * CSS-pixel scale factor passed to setupCanvas.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Celočíselné zväčšenie na obrazovku: 4 dá 1024×768 CSS pixelov.
 *
 * **↓ nižšie:** menšie okno, ostrejšie na hustých displejoch, ale hra je fyzicky
 * drobná.
 * **↑ vyššie:** väčšie okno. **Musí zostať celé číslo** — necelé škálovanie rozmaže
 * pixely, a to je presne to, čo tento projekt nikdy nerobí.
 */
export const CANVAS_SCALE = 4

/**
 * Top status bar height in cell rows.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Výška horného stavového pásu v bunkách (4 = 32 px).
 *
 * **↓ nižšie:** viac miesta pre cestu, ale skóre a varovania sa nemajú kam zmestiť.
 * **↑ vyššie:** pohodlnejší HUD za cenu výhľadu.
 *
 * Súčet troch pásov musí dať {@link ROWS} — keď pohneš týmto, musíš pohnúť aj
 * ostatnými dvoma.
 */
export const STATUS_BAR_ROWS = 2

/**
 * Bottom HUD instrument panel height in cell rows.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Výška spodného prístrojového panela v bunkách (9 = 72 px). Delí sa na tri rovnaké
 * stĺpce po 85/85/86 px.
 *
 * **↓ nižšie:** väčší výhľad, ale otáčkomer a ukazovatele sa musia preskladať.
 * **↑ vyššie:** čitateľnejšie prístroje, kratšia cesta pred tebou.
 */
export const HUD_ROWS = 9

/**
 * First pixel row of the driving viewport.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Prvý riadok jazdného výhľadu. Odvodené z {@link STATUS_BAR_ROWS}.
 */
export const VIEWPORT_TOP = STATUS_BAR_ROWS * 8

/**
 * Last+1 pixel row of the driving viewport.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Prvý riadok pod jazdným výhľadom. Odvodené z {@link HUD_ROWS}.
 */
export const VIEWPORT_BOTTOM = GAME_HEIGHT - HUD_ROWS * 8

/**
 * Driving viewport height in pixels.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Výška výhľadu v pixeloch (88).
 *
 * **Je v menovateli mierky vozidiel**, takže vyšší výhľad robí vzdialené autá
 * *menšie*, nie väčšie. Je to proti intuícii a je to jeden z troch dôvodov, prečo
 * sa zvýšenie rozlíšenia zamietlo.
 */
export const VIEWPORT_HEIGHT = VIEWPORT_BOTTOM - VIEWPORT_TOP

/**
 * Horizon as fraction of viewport height from top.
 *
 * ── SK ────────────────────────────────────────────────────────────────────
 * Kde vo výhľade leží horizont (0.25 = obloha zaberá horných 25 %).
 *
 * **↓ nižšie:** viac oblohy, kratšia cesta — pôsobí to stiesnene.
 * **↑ vyššie:** viac cesty, menej neba. Nad ~0.4 zmizne pocit diaľky, lebo hviezdy
 * aj horizont sa stlačia do pásika.
 */
export const HORIZON_PCT = 0.15

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Perióda blikania varovaní v hornom páse.
 *
 * **↓ nižšie:** naliehavejšie, pri veľmi nízkych hodnotách už nečitateľné.
 * **↑ vyššie:** pokojnejšie. Nad ~800 ms hráč varovanie prehliadne, lebo zhasne
 * práve vtedy, keď sa naň pozrie.
 */
export const BLINK_MS = 400

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Krytie čiernej riadkovej mriežky cez hotovú snímku (0.7).
 *
 * **Toto je číslo, ktoré pokazí každé meranie jasu, na ktoré zabudneš.** Mriežka
 * berie dva zo štyroch zariadených riadkov každého herného pixelu, takže celý obraz
 * beží na 0,65 — hárok bez nej nadhodnocuje jas 1,54× a prvé kolo glow sa na
 * takom hárku ladilo naslepo.
 *
 * **↓ nižšie:** jasnejší a čistejší obraz, ale stráca CRT charakter.
 * **↑ vyššie:** silnejší dobový dojem, tmavší obraz. Nad ~0.8 začne mriežka žrať
 * detaily, ktoré si v spritoch draho vybojoval.
 */
export const SCANLINE_ALPHA = 0.7

/**
 * ── SK ────────────────────────────────────────────────────────────────────
 * Sila zakrivenia obrazovky (0.6).
 *
 * **↓ nižšie:** plochšie, modernejšie.
 * **↑ vyššie:** vypuklejšia obrazovka. Nad ~1.0 sa rohy začnú odrezávať a HUD v
 * nich prestane byť čitateľný.
 */
export const CRT_CURVE_INTENSITY = 0.6
