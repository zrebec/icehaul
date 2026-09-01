# Ice Haul: trojstupňový sprite LOD

> **Dokončený handoff:** implementácia bola používateľom schválená a dokončená po úlohách cez TDD.
> Tento dokument teraz uchováva pôvodné rozhodnutia, vykonané checklisty a reprodukovateľné
> výsledky. Pre ďalšiu prácu čítaj aj koreňové `AGENTS.md`, `CLAUDE.md` a
> `/Users/zrebec/.codex/skills/zx-spectrum-screen/SKILL.md`.

**Cieľ:** nahradiť dnešný významový dvojstupňový LOD dopravy a jednostupňové dekorácie pravými,
ručne navrhnutými ZX sprite sadami `far / mid / near`, bez zmeny fyzickej veľkosti vozidiel,
lane-fit pravidiel alebo princípu pixelovo presnej kolízie.

**Architektúra:** JSON mriežky validované nástrojom `zx_sprite.py` budú kanonickým zdrojom
grafiky. Projekcia najprv vypočíta fyzické rozmery objektu zo vzdialenosti a až potom vyberie
LOD asset, ktorý resampluje do vypočítaného zlomkového rozpätia. Rozmery autorskej mriežky preto
nebudú určovať hitbox ani šírku vozidla na ceste.

**Technológie:** TypeScript 7, Vite 8, Vitest 4, `zx-kit`, Python 3 + Pillow iba na validáciu
a export spriteov. Bez novej runtime závislosti.

**Dokument v repozitári:** `docs/codex-retro-icehaul.md`

**Externá zrkadlová kópia:** `~/Projects/retro/docs/sk/codex-retro-icehaul.md`

**Pracovná branch:** `feat/three-tier-sprite-lod`, odvodená priamo z `main` na commite
`1f4a03a373165cff57acbf3988aee24e4ea1b173`.

**Stav 2026-09-01:** Úlohy 1–7 sú dokončené. Implementačné commity sú `1a817fb`, `f6067bd`,
`c3df343`, `6f0e88c`, `a9031a0` a `69ff332`; dokumentácia je v `d84edce`. Nezávislý review
nenašiel kritický runtime problém a jeho tri dôležité acceptance-harness nálezy opravuje
`a1af000`.

## Globálne obmedzenia

- Herný framebuffer ostáva 256×192 a používa iba farby z `zx-kit` palety `C`.
- Toto je **sprite mode**, preto sa nevytvára `.scr` a neuplatňuje sa atribútové obmedzenie dvoch
  farieb na 8×8 bunku. Vlastník po vizuálnej skúške 2026-08-31 pôvodne požadované bunkové
  obmedzenie výslovne zrušil, pretože flattening robil `mid` a `near` kresby príliš ploché.
  Sprite môže používať viac ZX farieb kdekoľvek vo svojej mriežke; pozadie cesty sa naďalej
  kompozituje samostatne.
- Každý pixel spriteu je buď úplne transparentný, alebo jedna presná ZX farba. Bez antialiasingu,
  alfa prelínania, blur, gradientu a interpolácie.
- Hráčov 40×64 artikulovaný kamión sa nemení; je iba výtvarnou referenciou.
- Nepridávať nový typ vozidla, yaw pohľad, polygonálny renderer ani parametric 2D vozidlo.
- Zachovať dnešnú hyperbolickú rastovú krivku vozidiel, bottom-center kotvu a kanonické fyzické
  rozmery `mini 14×11`, `car 22×15`, `bus 28×18`.
- Kreslenie, glow a kolízia musia čítať ten istý finálny raster. Obrys a kontaktný tieň zostávajú
  mimo kolízneho rastra.
- Existujúce hodnoty glow a jeho core threshold sa nemenia. Táto práca znovu neotvára ladenie
  svetiel.
- Dekorácie sú vizuálne a naďalej nemajú kolíziu.
- Staré kontaktné PNG sú iba historická referencia. Nové validované JSON mriežky sú zdroj pravdy.

---

## 1. Stav projektu pred zmenou

### 1.1 Projekcia vozidiel

`src/render/road3d.ts` počíta `worldZ = vehicle.distM - cameraDistance`.

- Zvislá poloha používa inverznú perspektívu `PERSPECTIVE_K / worldZ`, kde
  `PERSPECTIVE_K = 150`.
- Veľkosť používa samostatnú hyperbolu `TRAFFIC_SCALE_A / (worldZ + TRAFFIC_SCALE_B)`.
- Kotvy krivky sú `0.20 @ 220 m` a `1.43 @ 1.2 m`.
- Zlomkový area-weighted resampling a cache po 1/256 mierky spôsobujú, že vozidlo rastie po
  jednotlivých obrazových pixeloch.
- Pri `worldZ <= 0` vozidlo ešte 5 m prechádza pod hráča; veľkosť nadväzuje na tú istú krivku.

Všetky typy používajú tú istú fyzickú projekciu. Protiidúce vozidlo má samostatný front sprite,
žlté svetlá a ľavý pruh. Vozidlo v rovnakom smere má rear sprite, červené koncové/brzdové svetlá
a pravý pruh. Rozdiel v rýchlosti priblíženia vzniká v simulácii: pri protiidúcom sa sčítavajú
rýchlosti, pri vozidle pred hráčom sa používa relatívna rýchlosť.

### 1.2 Dnešný LOD vozidiel

`src/render/vehicleLod.ts` pozná iba `far | detail`.

- Hranica je premietnutá výška 10 px, hysterézia 1 px.
- Nie sú to dve kresby. Oba stupne resamplujú ten istý zdroj.
- `far` iba prepíše krajné pixely jedného riadka na `R` alebo `Y`, aby prežil smer jazdy.
- `detail` používa resamplovaný raster bez tejto farebnej opravy.
- Výsledný raster zdieľajú renderer, glow a `checkTruckTrafficCollision`.

Nové rozhodnutie používateľa z 2026-08-31 vedome ruší staré rozhodnutie v `AGENTS.md`, podľa
ktorého bol middle LOD uzavretý.

### 1.3 Dnešné dekorácie

`src/game/roadside.ts` generuje `deciduous`, `conifer`, `rocks`, `lamp` a `sign`.

- Iba prvé štyri typy majú sprite; lampa je procedurálna.
- Každý typ má jeden zdrojový obrázok bez LOD.
- `drawRoadsideObjects` používa `scale = max(0.15, t)`. Dekorácie sú preto od približne 150 m
  až po približne 11 m prakticky rovnako veľké a rastú až tesne pri hráčovi.
- Resampling dostáva celočíselnú šírku a výšku, takže rast prichádza po celých riadkoch/stĺpcoch.
- Generátor nedostáva route seed; každá trasa má rovnaký vzor dekorácií.
- Príroda má síce náhodný násobok šírky cesty za krajnicou, ale väčšina rollov zostáva pri nej.
- Lampy sú párovo každých 180 m tesne pri ceste, značky približne každých 400 m.
- Objekty rôznych typov sa nekreslia v spoločnom far-to-near poradí.

---

## 2. Uzamknuté produktové rozhodnutia

1. Spoločné názvy LOD sú `far`, `mid`, `near`.
2. Vozidlá: tri typy × dva smery × tri LOD = 18 spriteov.
3. Dekorácie: päť typov vrátane lampy × tri LOD = 15 spriteov.
4. Vozidlá ostávajú rovné front/rear billboardy bez natočenia.
5. Výtvarný smer je čistý arcade ZX: silná silueta, veľké okná a svetlá, čierne vnútorné
   keylines, čitateľný sneh a minimum drobného šumu.
6. Fyzická veľkosť vozidiel a lane-fit zostávajú rovnaké.
7. Funkčné lampy a značky zostávajú pri ceste. Príroda sa rozdelí do bočných pásiem a zhlukov.
8. Hráčov kamión sa neprekresľuje.

---

## 3. Pripravené ZX sprite assety

### 3.1 Výstupný formát

Každý sprite musí mať v `src/render/sprites/assets/<family>/` tieto štyri výstupy:

- `<name>.rows.txt` — presná textová mriežka;
- `<name>.json` — presne `{w,h,rows,legend}`;
- `<name>.png` — natívny RGBA náhľad s transparentným pozadím;
- `<name>_4x.png` — jediný 4× nearest-neighbour resize.

Validátor:

```bash
python3 /Users/zrebec/.codex/skills/zx-spectrum-screen/scripts/zx_sprite.py \
  <name>.rows.txt --width W --height H \
  --legend X=C.BLACK W=C.B_WHITE --name <name> --out <output-directory>
```

Každý príkaz musí skončiť textom `PASS`. Pre sprite sa nikdy nevytvára `.scr`. Projektová
regresná kontrola `scripts/test-lod-sprites.py` navyše overuje inventár, mriežky, presnú ZX paletu,
rozmery PNG, nearest-neighbour preview a to, že detailné LOD neboli znovu sploštené na dve farby
v každej lokálnej bunke.

### 3.2 Rozmery vozidiel

| Typ a smer | far | mid | near |
|---|---:|---:|---:|
| `mini-rear`, `mini-front` | 7×6 | 14×11 | 28×22 |
| `car-rear`, `car-front` | 11×8 | 22×15 | 44×30 |
| `bus-rear`, `bus-front` | 14×9 | 28×18 | 56×36 |

Názvy sú `<type>-<front|rear>-<far|mid|near>`.

Výtvarné invarianty:

- front používa `Y=C.B_YELLOW` na vonkajších svetlách a nesmie obsahovať červené lampy;
- rear používa `R=C.RED`; runtime pri brzdení mení iba `R` na `C.B_RED`;
- far dáva prednosť dvom lampám, streche a oddeleným kolesám;
- mid rozlišuje typ karosérie, sklá, nárazník a polohu kolies;
- near pridáva kapotu alebo čelo, stĺpiky, deliace čiary, masku, blatníky a vnútorné keylines;
- každý pohľad je bilaterálne symetrický;
- medzi kolesami je transparentná cesta;
- normalizovaná vonkajšia silueta a ground line sú medzi LOD zhodné natoľko, aby ich IoU po
  projekcii bolo aspoň 0.85.

### 3.3 Rozmery dekorácií

| Typ | far | mid | near |
|---|---:|---:|---:|
| `deciduous` | 8×12 | 16×24 | 32×48 |
| `conifer` | 8×12 | 16×24 | 32×48 |
| `rocks` | 8×5 | 16×10 | 32×20 |
| `sign` | 8×12 | 16×24 | 24×32 |
| `lamp` | 3×8 | 5×16 | 9×32 |

Názvy sú `<type>-<far|mid|near>`.

Výtvarné invarianty:

- far je významový symbol bez ditheringu;
- mid pridáva charakter typu a veľké snehové plochy;
- near pridáva čierne keylines a niekoľko stabilných povrchových prvkov;
- listnáč má širokú nepravidelnú korunu, ihličnan jasný trojuholníkový profil;
- kamene ostávajú nízke a široké;
- značka je žltá a čitateľná siluetou/šípkou, nie drobným textom;
- lampa má jasný žltý vrch a jednobodový stĺp; samotný sprite neobsahuje blur ani glow.

### 3.4 Stav prípravy k 2026-08-31

- [x] Všetkých 33 `.rows.txt` mriežok vytvorených.
- [x] Všetkých 33 JSON súborov prešlo oficiálnym validátorom.
- [x] `mid/near` prešli regresnou kontrolou bohatej palety a viacfarebných lokálnych buniek.
- [x] Všetkých 33 natívnych PNG vytvorených.
- [x] Všetkých 33 štvor-násobných PNG vytvorených.
- [x] Kontaktné hárky vytvorené a skontrolované na rozmery, transparentnosť a zjavné poškodenie.

Vlastník výtvarný smer schválil 2026-09-01 a následne povolil celú implementáciu. Generátor a
opakovateľný validačný postup sú v
`scripts/author-lod-sprites.py`; súhrn výstupov je v
`src/render/sprites/assets/validation.txt` a strojový zoznam v
`src/render/sprites/assets/manifest.json`.

---

## 4. Cieľové verejné rozhrania

```ts
export type LodTier = 'far' | 'mid' | 'near'

export interface ZxSpriteAsset {
  readonly w: number
  readonly h: number
  readonly rows: readonly string[]
  readonly legend: Readonly<Record<string, ZxColorName>>
}

export interface TrafficSprite {
  readonly rows: readonly string[]
  readonly colors: Readonly<Record<string, SpectrumColor>>
}

export function getTrafficSprite(
  dir: TrafficDir,
  type: VehicleType,
  lod: LodTier,
  braking?: boolean,
): TrafficSprite

export function chooseLodTier(
  projectedHeight: number,
  previous?: LodTier,
): LodTier
```

`ZxColorName` je uzavretá únia presných názvov, ktoré prijíma `zx_sprite.py`, napríklad
`'C.BLACK' | 'C.B_WHITE' | ...`. Loader mapuje tieto názvy na hodnoty `C.*` a pri neznámom názve
zlyhá; nesmie potichu vynechať farbu.

Generalizovaný resampler:

```ts
export function resampleSpriteAtSpan(
  rows: readonly string[],
  spanW: number,
  spanH: number,
  anchorX: number,
  anchorBottomY: number,
): { raster: string[]; left: number; top: number; w: number; h: number } | null
```

`spanW` a `spanH` sú zlomkové fyzické rozpätia vypočítané z kanonickej veľkosti, nie rozmery
zdrojového JSON. Výstupný `w/h` zostáva `ceil(span)` a raster ostáva bottom-center ukotvený.

Dekorácie:

```ts
export type SceneryBand = 'verge' | 'field' | 'far'

export interface RoadsideObject {
  readonly distM: number
  readonly side: -1 | 1
  readonly type: RoadsideType
  readonly band: SceneryBand
  readonly offsetRoadWidths: number
}

export function getRoadsideObjects(
  routeSeed: number,
  fromDist: number,
  toDist: number,
): RoadsideObject[]
```

---

## 5. Implementačný plán

### Úloha 1: Načítať a kontraktovo overiť ZX JSON assety

**Súbory:**

- vytvoriť `src/render/sprites/catalog.ts`;
- vytvoriť `src/render/__tests__/spriteCatalog.test.ts`;
- použiť pripravené súbory v `src/render/sprites/assets/`.

**Výsledok:** repo vie bez externého pluginu overiť schému, rozmery, znaky a paletu každého
z 33 JSON súborov. Runtime loader poskytuje `rows` a `SpectrumColor` mapu.

- [x] Napísať failing test, ktorý importuje kompletný manifest 33 assetov a kontroluje počet,
  deklarované rozmery, presný počet/šírku riadkov, povolené ASCII symboly a definovanú legendu.
- [x] V tom istom teste vyžadovať iba presnú ZX paletu; pri `mid/near` zároveň kontrolovať, že
  katalóg obsahuje viacfarebné lokálne bunky a nevrátil sa k plochému dvojfarebnému exportu.
- [x] Spustiť `npm test -- src/render/__tests__/spriteCatalog.test.ts` a potvrdiť očakávaný fail.
- [x] Implementovať `ZxColorName`, uzavretú mapu názov → `C.*`, `loadZxSprite` a katalógy
  `TRAFFIC_SPRITES`/`ROADSIDE_SPRITES`.
- [x] Spustiť cielený test a celý `npm test`.
- [x] Commit: `feat(render): load validated zx sprite assets`.

### Úloha 2: Oddeliť fyzické rozpätie od rozlíšenia zdroja

**Súbory:**

- upraviť `src/render/road3d.ts` alebo vybrať resampler do `src/render/spriteRaster.ts`;
- upraviť `src/render/vehicleRaster.ts`;
- upraviť `src/render/__tests__/road3d-scaling.test.ts` a `vehicleRaster.test.ts`.

**Výsledok:** ľubovoľne veľký LOD asset sa vykreslí do rovnakého fyzického boxu ako dnešný
14×11/22×15/28×18 zdroj, bez návratu celočíselného scale kroku.

- [x] Pred zmenou doplniť charakterizačné testy pre `w/h/left/top` vozidiel na vzdialenostiach
  220, 100, 50, 25, 10, 5 a 2 m.
- [x] Napísať failing test: dve mriežky s rovnakou normalizovanou kresbou, ale 1× a 2× zdrojovým
  rozlíšením musia pri rovnakom `spanW/spanH` dať rovnaký box a ekvivalentnú siluetu.
- [x] Implementovať `resampleSpriteAtSpan`; zachovať area weighting, coverage threshold a
  zlomkový inset.
- [x] Zmeniť vehicle cache key na `asset-id + quantized physical scale + lod`.
- [x] Spustiť scaling, raster, cadence, churn a stability testy.
- [x] Commit: `refactor(render): decouple sprite art from projected size`.

### Úloha 3: Zaviesť pravý `far / mid / near` LOD vozidiel

**Súbory:**

- upraviť `src/render/vehicleLod.ts`, `vehicleRaster.ts`, `road3d.ts`;
- odstrániť runtime závislosť od starého `src/render/sprites/vehicles.ts`;
- upraviť testy `vehicleLod`, `vehicleArt`, `vehicleGlow`, `brakeSignal`, `laneFit`,
  `collisionSweep`, `approachCadence`, `approachChurn` a `resampleStability`.

**Konštanty:**

- `LOD_FAR_MAX_HEIGHT = 7`;
- `LOD_MID_MAX_HEIGHT = 13`;
- `LOD_HYSTERESIS_PX = 1`.

**Stavový prechod:** bez predchádzajúceho tieru vybrať `≤7 far`, `≤13 mid`, inak `near`.
Pri predchádzajúcom tiere ponechať jednotkový dead-band. Veľký skok výšky smie preskočiť priamo
cez susedný tier.

- [x] Najprv rozšíriť failing testy na tri monotónne stupne, oba smery pohybu a preskoky.
- [x] Doplniť test, že všetky tri LOD majú správne front/rear lampy a iba rear mení `R` pri brzde.
- [x] Doplniť normalizovaný handover test: IoU susedných siluet ≥ 0.85, ground line sa nepohne
  a fyzický box neskočí o viac než 1 px.
- [x] Implementovať výber assetu pred resamplingom a odstrániť `applyFarLamps`.
- [x] Zachovať jeden finálny raster pre draw/collision/glow a paralelný contour mask.
- [x] Potvrdiť lane peak ≤ 0.90 a cadence longest freeze ≤ 2.0 s.
- [x] Commit: `feat(render): add three authored traffic lod tiers`.

### Úloha 4: Zaviesť seedované pásma a zhluky dekorácií

**Súbory:**

- upraviť `src/game/roadside.ts`;
- vytvoriť `src/game/__tests__/roadside.test.ts`;
- upraviť volanie v `src/scenes/drive.ts`.

**Generovanie:**

- použiť stream `(gameSeed + 3) >>> 0`;
- stred prírodného zhluku približne každých 120 m so seedovaným jitterom;
- 2–4 objekty na zhluk a pozdĺžny rozptyl ±25 m;
- typy 55 % listnáč, 30 % ihličnan, 15 % kamene;
- zhluk zvolí primárnu stranu; 80 % členov je na nej, 20 % môže byť oproti;
- pásma: 45 % `verge` 0.15–0.55, 35 % `field` 0.75–1.60,
  20 % `far` 1.80–3.00 road-half-width za okrajom;
- lampy zostanú po oboch stranách každých 180 m v `verge`;
- značky zostanú približne každých 400 m v `verge`, ale ich jitter a strana sa miešajú so seedom.

- [x] Napísať failing testy pre deterministický rovnaký seed, odlišné seedy, stabilné
  prekrývajúce sa okná a nulové duplicity.
- [x] Testovať, že prvých 5 km obsahuje obe strany a všetky tri pásma; lampa/značka sú iba verge.
- [x] Testovať prirodzenú hustotu v pásme 20–32 objektov/km, aby nový layout nezvyšoval náklady
  bez kontroly.
- [x] Implementovať čistý generátor bez per-frame uloženého stavu.
- [x] Odovzdať seed z `drive.ts` cez novú signatúru.
- [x] Commit: `feat(scene): seed roadside scenery in bands and clusters`.

### Úloha 5: Perspektívny LOD renderer dekorácií

**Súbory:**

- vytvoriť `src/settings/sceneryView.ts` a exportovať ho z `src/config.ts`;
- vytvoriť `src/render/roadsideRaster.ts`;
- upraviť roadside časť `src/render/road3d.ts`;
- vytvoriť `src/render/__tests__/roadsideLod.test.ts`.

**Konštanty a metriky:**

- view distance 220 m;
- scale anchor `0.15 @ 220 m` a `0.65 @ 3 m`, s odvodenými `A/B`;
- LOD podľa scale: `far ≤ 0.30`, `mid ≤ 0.50`, inak `near`;
- kanonické rozmery: deciduous 22×31, conifer 18×31, rocks 22×13,
  sign 18×22, lamp 6×28.

- [x] Napísať failing testy pre obe kotvy, monotónny rast a poradie troch tierov.
- [x] Testovať, že scale pri vzdialenostiach 220, 120, 80, 50, 25, 20, 10 a 3 m nemá dnešnú
  dlhú konštantnú plošinu.
- [x] Implementovať zlomkový resampling z katalógu a cache podľa assetu/mierky.
- [x] Nahradiť per-pixel fill horizontálnymi spanmi.
- [x] Pred kreslením zoradiť všetky typy spoločne od najvzdialenejšieho po najbližší.
- [x] Odstrániť procedurálny `drawLamp`; lampa používa tri validované sprity.
- [x] Commit: `feat(render): add perspective lod to roadside scenery`.

### Úloha 6: Kontaktné hárky a vizuálna akceptácia

**Súbory:**

- rozšíriť `src/render/debug/trafficMatrix.ts` a jeho test;
- vytvoriť `src/render/debug/sceneryMatrix.ts` a test;
- vytvoriť `scripts/scenery-matrix.mjs`;
- upraviť `src/main.ts`, `scripts/traffic-matrix.mjs`, README a `docs/graphics.md`.

**Traffic matrix:** zachovať reálny renderer, pridať hranice LOD a viditeľný názov vybraného
tieru. Neimplementovať v harnessi vlastnú projekciu.

**Scenery matrix:** jeden riadok na typ, stĺpce 220, 120, 80, 50, 25, 20, 10 a 3 m, prepínače
pre zoom, surface, curve, offset a scanlines. Pridať reálne placement snímky pre seedy 42
a 1443866.

- [x] Napísať failing layout/parser testy pred debug rendererom.
- [x] Implementovať `?sceneryMatrix=1` a capture skript.
- [x] Vygenerovať traffic aj scenery hárky na asfalte, snehu, ľade a v najostrejšej zákrute.
- [x] Pri hodnotení jasu zapnúť `scanlines=1`.
- [x] Skontrolovať front/rear smer vo far, rozdiel mini/car/bus v mid, keylines v near,
  lane-fit, prechody tierov a rozmiestnenie prírody mimo krajnice.
- [x] Commit: `test(render): add lod contact sheets`.

### Úloha 7: Dokumentácia a úplná verifikácia

**Súbory:**

- aktualizovať `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/graphics.md`;
- ponechať tento dokument ako trvalý handoff a aktualizovať výsledné benchmarky.

- [x] V `AGENTS.md` nahradiť rozhodnutie „middle LOD closed“ novým rozhodnutím z 2026-08-31.
- [x] Zdokumentovať JSON/PNG pipeline a nový scenery matrix.
- [x] Spustiť `npm test`.
- [x] Spustiť `npm run build`.
- [x] Spustiť `node scripts/clash-check.mjs` nad hotovou scénou.
- [x] Znovu spustiť oficiálnu validáciu všetkých 33 JSON/PNG spriteov.
- [x] Vizuálne skontrolovať natívne aj 4× preview a reálne kontaktné hárky.
- [x] Commit: `docs(graphics): record three-tier sprite lod`.

### Výsledné benchmarky

- `npm test`: **39 súborov, 815 testov, všetko PASS**.
- `npm run build`: **136.84 kB**, 42.93 kB gzip; 119 modulov.
- Oficiálny sprite export: **33/33 PASS**; 18×4 traffic a 15×4 roadside súborov;
  opakovaný export nechal asset strom bez diffu.
- Clash-check titulky, kurzor viditeľný aj skrytý: **0** off-palette pixelov, **0** buniek nad
  dve farby, **0** buniek miešajúcich jasové banky.
- Vizuálna sada: **15 traffic + 7 scenery PNG**, vrátane reálnych placementov seedov 42 a
  1443866; jas kontrolovaný so `scanlines=1`.
- Najhorší nový traffic cadence prípad je far oncoming mini **1.83 s**, pod stropom 2.0 s.
- Post-review kontrola: boundary riadky zachovávajú hysteréziu z 220 m, glow sa kompozituje
  až po scanlines a export test byte-exaktne overuje `.rows.txt → JSON → native → 4× PNG`.

---

## 6. Akceptačné kritériá

- Existuje presne 18 vozidlových a 15 dekoračných validovaných sprite sád.
- Každý sprite má textovú mriežku, JSON, natívny PNG a 4× PNG.
- Sprites používajú iba presné ZX farby, ale nemajú limit dvoch farieb na lokálnu 8×8 bunku;
  detailné LOD preukázateľne využívajú bohatšiu paletu.
- Žiaden LOD asset neurčuje fyzickú veľkosť vozidla; tú stále určuje kanonický box × dnešná
  hyperbola.
- Vozidlá prejdú `far → mid → near` bez zmeny pruhu, skoku kotvy alebo neviditeľného hitboxu.
- Far vždy komunikuje smer lampami; mid rozlišuje mini/car/bus; near má čitateľné vnútorné
  keylines aj so scanlines.
- Brake stav je informácia vo framebufferi aj bez glow.
- Dekorácie rastú počas celého priblíženia a každý typ dosiahne všetky tri LOD.
- Route seed reprodukuje cestu, dopravu, kanistre aj nové dekorácie.
- Príroda je viditeľná v troch bočných pásmach a zhlukoch; funkčné značky/lampy zostávajú pri ceste.
- Všetky unit/regression testy, build, clash check a sprite validácie prejdú.

## 7. Pokračovanie v čistom kontexte

1. Over branch a pracovný strom:

   ```bash
   git branch --show-current
   git status --short
   ```

2. Prečítaj tento dokument, `AGENTS.md`, `CLAUDE.md` a skill `zx-spectrum-screen`.
3. Úlohy 1–7 neopakuj; ich commity a benchmarky sú vyššie. Pri podozrení na regresiu spusti
   rovnaké validácie a porovnaj kontaktné hárky.
4. Najbližšia schválená položka poradia v `AGENTS.md` je traffic density scaling. Fleet gate stále
   platí: nepridávaj siedmy typ vozidla bez nového rozhodnutia Foxa.
5. JSON je runtime zdroj pravdy; PNG je iba náhľad. Fyzickú veľkosť nikdy neodvodzuj z LOD mriežky.
