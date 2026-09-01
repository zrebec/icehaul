# Ice Haul: grafika

Ako sa obrázok dostane z nápadu do hry. Zlúčené z pôvodných `sprites.md` a
`sprite-prompts.md`, doplnené o obrazovkovú linku cez zx-art.

Sesterské dokumenty: [simulácia](simulation.md) · [manuál](manual.md)

---

## Dve linky, nie jedna

Projekt má **dve nezávislé cesty**, ktorými sa kresba dostane do hry, a je dôležité
nemiešať ich:

| | Sprity | Celé obrazovky |
|---|---|---|
| Čo | Vozidlá, stromy, značky | Titulka, neskôr aj pozadie po havárii |
| Zdroj | kódovo vytvorená presná `.rows.txt` mriežka | zx-art → **`.scr`** |
| Nástroj | `scripts/author-lod-sprites.py` → oficiálny `zx_sprite.py` | `scripts/screen-import.mjs` |
| Runtime výstup | validovaný JSON cez `sprites/catalog.ts` | `src/assets/<meno>.ts` (base64) |
| Náhľady | natívny transparentný PNG + jediný 4× nearest-neighbour PNG | PNG iba na kontrolu `.scr` |
| Záruka palety | **validovaná** uzavretou mapou názvov `C.*` | **konštrukčná** — formát ju nevie porušiť |

Ten posledný riadok je celý dôvod, prečo obrazovky nechodia cez PNG. Atribútový
bajt `.scr` má tri bity na INK a tri na PAPER, takže **sedemnásta farba ani tretia
farba v bunke nie sú vyjadriteľné**. Do PNG sa dá dať čokoľvek a `drawImage` to
poslušne namaľuje.

**Pravidlo:** PNG smie byť vstupná predloha pre generátor alebo výstupná
vizualizácia. Nikdy nie asset, ktorý hra dodáva.

## Overenie hotového obrazu

Kresba je platná z konštrukcie; **to, čo sa nad ňu nakreslí, nie je**. Text na
súradnici, ktorá nie je násobkom osmičky, alebo ink a paper z rôznych jasových
bánk vloží do bunky tretiu farbu a typový systém z toho nechytí nič.

```bash
npm run dev
node scripts/clash-check.mjs          # --save-frames ulozi aj PNG
```

Číta hotový snímok späť a kontroluje, že žiadna bunka 8×8 nemá viac než dve farby
a nemieša jasové banky. Vzorkuje **párne** riadky zariadenia — `drawScanlines`
stmavuje nepárne, a vzorka na nich by merala prekryv namiesto hry.

## Kontaktné hárky reálneho renderera

Oba debug režimy kreslia cez produkčný `drawRoad` a príslušný objektový renderer;
nemajú vlastnú kópiu perspektívy. Názov `far`/`mid`/`near` v bunke je výsledok,
ktorý práve vrátil skutočný projektor.

```bash
npm run dev
node scripts/traffic-matrix.mjs .shots/traffic
node scripts/scenery-matrix.mjs .shots/scenery
```

- `?matrix=1&lod=1` nájde snímku tesne pred a po každom LOD prechode cez reálny
  traffic projektor. Každý riadok je jeden súvislý príchod od 220 m, takže sa zachová
  aj produkčná LOD hysterézia. Explicitné `dist=` môže výber zúžiť.
- `?sceneryMatrix=1` má riadok pre každý typ a stĺpce 220, 120, 80, 50, 25, 20,
  10 a 3 m. Podporuje `zoom`, `surface`, `curve`, `offset`, `types`, `dist` a
  `scanlines=1`.
- `?sceneryMatrix=1&placement=42` namiesto izolovaných objektov ukáže štyri
  skutočné okná seedovanej cesty. Capture sada obsahuje seed 42 aj ľadový benchmark
  1443866.

Jas sa hodnotí so `scanlines=1`; bez neho je hárok svetlejší než hra. Traffic hárok
rovnako ako `main.ts` najprv nanesie scanline masku a až potom deferred lamp glow — bloom
sa preto maskou znovu nestlmí.

---

## Trojstupňová sprite pipeline

```text
scripts/author-lod-sprites.py
        │  presná kódová pixelová konštrukcia
        ▼
<name>.rows.txt
        │  zx-spectrum-screen / zx_sprite.py
        ├────────▶ <name>.json       runtime zdroj
        ├────────▶ <name>.png        natívny RGBA náhľad
        └────────▶ <name>_4x.png     nearest-neighbour kontrola pixelov
                         │
manifest.json ───────────┴──▶ sprites/catalog.ts ──▶ renderer
```

Celý katalóg sa reprodukuje jedným príkazom:

```bash
python3 scripts/author-lod-sprites.py
```

Skript vyžaduje presne **33** položiek, zavolá oficiálny validátor pre každú z nich,
obnoví `manifest.json`, `validation.txt` a rodinné kontaktné hárky. Úspešný druhý beh
musí nechať `git diff` prázdny.

`scripts/test-lod-sprites.py` potom byte-exaktne overí celý derivovaný reťazec: textové
riadky sa musia rovnať JSON `rows`, natívny RGBA PNG sa znovu zostaví z JSON legendy a
4× PNG musí byť presný nearest-neighbour resize. Porovnanie zahŕňa RGB aj alpha kanál.

`sprites/catalog.ts` potom pri štarte kontroluje presný tvar `{w,h,rows,legend}`,
rozmery, jednopísmenové symboly, úplnú legendu a uzavretý zoznam názvov ZX farieb.
PNG sa neimportuje do bundlu.

### Softvérový sprite nie je `.scr` bunka

Každý nepriehľadný pixel musí byť jedna presná farba `C.*`; antialiasing, polopriehľadná
hrana, blur a interpolácia sú zakázané. Na rozdiel od `.scr` však softvérovo kompozitovaný
sprite **nemá limit dvoch farieb v lokálnej 8×8 bunke**. Fox tento pôvodný limit zrušil
2026-08-31 po vizuálnej kontrole, pretože z `mid` a `near` odstraňoval práve vnútorné
keylines a farebné roviny, pre ktoré existujú.

### Katalóg a rozmery zdrojov

Traffic: tri typy × front/rear × tri LOD = **18**.

| typ | far | mid | near | kanonický fyzický box |
|---|---:|---:|---:|---:|
| mini | 7×6 | 14×11 | 28×22 | 14×11 |
| car | 11×8 | 22×15 | 44×30 | 22×15 |
| bus | 14×9 | 28×18 | 56×36 | 28×18 |

Roadside: päť typov × tri LOD = **15**.

| typ | far | mid | near | kanonický fyzický box |
|---|---:|---:|---:|---:|
| deciduous | 8×12 | 16×24 | 32×48 | 22×31 |
| conifer | 8×12 | 16×24 | 32×48 | 18×31 |
| rocks | 8×5 | 16×10 | 32×20 | 22×13 |
| sign | 8×12 | 16×24 | 24×32 | 18×22 |
| lamp | 3×8 | 5×16 | 9×32 | 6×28 |

Zdrojová mriežka a fyzický box sú zámerne dve veci. Renderer najprv určí box z
kanonického rozmeru a world-depth mierky, až potom vyberie LOD JSON a resampluje ho
do už určeného rozpätia. Handover preto nemení pruh, bottom-center kotvu ani hitbox.

### Starý PNG importer

`scripts/sprite-import.mjs` zostáva historickým nástrojom pre experimenty so starými
AI kontaktnými hárkami. Nie je zdrojom dnešných 33 assetov a jeho výstupné `.ts` sprity
runtime renderer nepoužíva.


---

# Historické sprite prompty pre AI image generation

> Táto sekcia predchádza validovanému JSON katalógu. Je referenciou výtvarného smeru,
> nie návodom na úpravu dnešných traffic/roadside assetov; jej atribútové obmedzenia sa
> na softvérovo kompozitované sprity nevzťahujú.

Use these prompts with ChatGPT (DALL-E) or similar AI image generators.
After generation, manually convert the result to a zx-kit `createBitmap` byte array.

## Constraints for ALL sprites

Every prompt should include this preamble:

> ZX Spectrum 8-bit pixel art. Strict constraints:
> - Only these colours: black (#000), blue (#0000CD), red (#CD0000), magenta (#CD00CD), green (#00CD00), cyan (#00CDCD), yellow (#CDCD00), white (#CDCDCD), and their bright variants.
> - Maximum 2 colours per 8×8 pixel cell (ink + paper) — this is "colour clash."
> - No anti-aliasing, no gradients, no transparency. Each pixel is exactly one colour.
> - Dark background (black paper) for most cells.
> - Show the result as a zoomed pixel grid so I can read individual pixels.

---

## 1. Truck — rear view (16×32 px)

This is the main player sprite. Copy the full prompt below into ChatGPT:

---

I need you to draw a pixel-art sprite for a ZX Spectrum game. The sprite is a **rear view of a heavy ice-road truck** (like a Peterbilt 379 or Kenworth W900 with a box trailer), seen from directly behind as if you are driving behind it on a dark arctic highway at night.

**Technical constraints (CRITICAL — follow exactly):**

- Canvas: exactly **16 pixels wide × 32 pixels tall**
- The sprite is divided into a **2×4 grid of 8×8 pixel cells** (2 columns, 4 rows)
- **Each 8×8 cell may use ONLY 2 colours**: one "ink" (foreground) and one "paper" (background)
- This is the ZX Spectrum "colour clash" constraint — it's the defining visual characteristic
- Background (paper) for ALL cells is **black (#000000)**
- No anti-aliasing, no gradients, no sub-pixel blending. Every pixel is exactly one colour
- Please show the final result as a **zoomed pixel grid** where I can clearly see and count each individual pixel

**Cell colour assignments (row 0 = top, row 3 = bottom):**

| Cell position | Ink colour | What it shows |
|---------------|-----------|---------------|
| Row 0 (y=0-7): both columns | Bright white (#FFFFFF) | Cab roof |
| Row 1 (y=8-15): both columns | Bright cyan (#00FFFF) | Cab body + rear window |
| Row 2 (y=16-23): both columns | Bright white (#FFFFFF) | Trailer/box body |
| Row 3 (y=24-31): both columns | Bright red (#FF0000) | Taillights + wheels |

**Detailed anatomy of the truck, top to bottom:**

**Row 0 — Cab roof (white on black, rows 0-7):**
- Rows 0-1: narrow, only 6-8 pixels wide centred (the cab roof narrows toward the top like a real truck cab)
- Rows 2-3: wider, 10-12 pixels
- Rows 4-5: nearly full width, 13-14 pixels
- Rows 6-7: full 16 pixels wide (where cab meets the body)
- The shape should taper upward like a trapezoid — wider at the bottom, narrower at the top
- This is the most recognisable silhouette of the truck from behind

**Row 1 — Cab body with rear window (cyan on black, rows 8-15):**
- Row 8: full-width solid line (top of cab body)
- Rows 9-13: cab body outline with a **rear window** in the centre
- The window is a rectangular cutout, roughly 8×4 pixels, centred in the cab
- Window pixels are INK colour (cyan) — they represent the glow of dashboard instruments reflecting in the glass
- The window frame (2 pixels on each side) is also ink but solid, creating the door pillars
- Rows 14-15: full-width solid lines (bottom of cab body)
- The colour clash between the white roof above and cyan body creates that classic ZX Spectrum look where two sections of the sprite have different colours

**Row 2 — Trailer body (white on black, rows 16-23):**
- Full-width rectangle, 16 pixels wide
- Rows 16-17: solid top edge of the trailer
- Rows 18-21: trailer body — outline only (1-2 pixel border), hollow inside (black)
- This creates the look of a large cargo box with metal edges
- Optional: a thin horizontal line at row 19-20 suggesting trailer doors
- Rows 22-23: solid bottom edge

**Row 3 — Undercarriage, wheels, taillights (red on black, rows 24-31):**
- Rows 24-25: two bright red rectangles at the left and right edges (2×2 pixels each) — these are the **taillights**. They should be at the very corners of the trailer width. The middle is black (gap between lights)
- Rows 26-27: narrower body (transition to undercarriage)
- Rows 28-29: two **wheel pairs** visible at the sides — each wheel is a small cluster of 3-4 red pixels. Wheels are roughly at x=2-5 (left pair) and x=10-13 (right pair)
- Rows 30-31: empty (black) — ground clearance

**Overall feel:**
- The truck should look HEAVY, BOXY, INDUSTRIAL — not sleek or sporty
- Think "working vehicle in the arctic" not "racing car"
- The silhouette from behind should be instantly recognisable as a large truck
- At ZX Spectrum resolution, simplicity is key — every pixel counts
- The colour transitions between rows (white→cyan→white→red) will create the characteristic "colour clash" banding that defines ZX Spectrum graphics

**Output format:**
Please show the 16×32 pixel grid zoomed to at least 10× magnification. Use a visible grid overlay so I can count pixels. Label the row boundaries (row 0/1/2/3) and mark the ink colour for each section.

## 2. Fuel canister (8×8 px)

> [preamble above]
> Draw a small fuel jerrycan, 8×8 pixels. Viewed from the side, slightly angled.
> Red body (bright red ink), yellow cap/handle at top (bright yellow).
> Should be instantly recognisable as "fuel" even at tiny size.
> Single 8×8 cell: ink=bright red, paper=black. Yellow cap drawn as 1-2 pixels.

## 3. Warning sign — ice (8×16 px, 1×2 cells)

> [preamble above]
> Draw a diamond-shaped warning road sign, 8 pixels wide × 16 pixels tall.
> Top cell: yellow diamond with a black snowflake or "!" symbol inside.
> Bottom cell: thin white post/pole on black background.
> Cell 0: ink=bright yellow, paper=black. Cell 1: ink=bright white, paper=black.

## 4. Fallen tree obstacle (24×8 px, 3×1 cells)

> [preamble above]
> Draw a fallen tree trunk lying across the road, 24 pixels wide × 8 pixels tall.
> Dark green trunk with lighter green branch stubs.
> Left cell: ink=green, paper=black. Middle cell: ink=bright green, paper=black. Right: ink=green, paper=black.

## 5. Boulder obstacle (16×16 px, 2×2 cells)

> [preamble above]
> Draw a large rock/boulder on the road, 16×16 pixels. Viewed from slightly above.
> Grey/white body with darker shadow on one side.
> All 4 cells: ink=bright white, paper=black. Use varying pixel density for shadow effect.

## 6. Dashboard hood/bonnet (256×16 px)

> [preamble above]
> Draw the top edge of a truck dashboard/bonnet as seen from the driver's seat,
> 256 pixels wide × 16 pixels tall. Mostly black with a thin bright white or
> cyan outline along the top edge suggesting the dashboard curve.
> The centre should dip slightly (windscreen A-pillar gap).
> This sits at the bottom of the driving viewport, above the instrument panel.
