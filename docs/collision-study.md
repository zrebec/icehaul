# Ice Haul: štúdia kolízií

Tento dokument opisuje aktuálny kolízny model v Ice Haul, matematiku, ktorá ho
riadi, konštanty, ktoré sa dajú ladiť, a možné ďalšie smerovanie. Je to
technická poznámka, nie finálny dizajn. Cieľ je, aby sa budúce zmeny kolízií
dali testovať, kontrolovať a meniť po malých krokoch.

## Zhrnutie

Ice Haul dnes používa hybridný kolízny model:

- kamión vs. okraj cesty: pixelová maska kamiónu proti vygenerovaným okrajom
  cesty pre jednotlivé scanline riadky,
- kamión vs. premávka: pixelová maska kamiónu proti pixelovým riadkom traffic
  spriteu,
- zber kanistrov: world-space tolerancia v hĺbke a bočnej osi,
- viditeľnosť a blízkosť premávky: pseudo-3D projekcia zo svetovej vzdialenosti
  do screen-space obdĺžnika.

Najsilnejšia časť systému je, že hráčov kamión má reálnu pixelovú masku.
Najslabšia časť je, že traffic kolízia stále závisí od pseudo-3D projekcie,
ktorá sa pri kamere mení veľmi rýchlo. Inými slovami: finálny kontakt je
pixelový, ale poloha cudzieho vozidla je stále herná projekcia.

Krátkodobo nedáva zmysel pridávať plný rigid-body fyzikálny engine. Ice Haul je
ZX-style pseudo-3D hra. Správny smer je:

1. lacný world/depth broad-phase,
2. finálny kontakt v screen-space pixeloch,
3. stabilná a vysvetliteľná near-field projekcia,
4. prechod z boolean `crash` na klasifikáciu kontaktu: škrtnutie, nárazník,
   koleso na koleso, bočný ťukanec, tvrdý náraz,
5. debug/verification UI, aby hráč videl, prečo sa kolízia stala.

## Aktuálne kolízne systémy

### 1. Kamión vs. okraj cesty

Implementované v:

- `src/game/offroad.ts`
- `src/render/truck.ts`
- `src/game/roadgeometry.ts`
- konštanty v `src/config.ts`

Kolízna bitmapa kamiónu je `TRUCK_COLLISION_BMP`. Z nej sa cez zx-kit vytvorí
pixelová maska:

```ts
const TRUCK_PIXEL_MASK = bitmapPixelMask(TRUCK_COLLISION_BMP)
```

Pre každý riadok solid pixelov kamiónu:

```ts
screenY = truckDrawY + row
edges = getEdges(screenY)
outerLeft = edges.leftRoad - edges.kerbW
outerRight = edges.rightRoad + edges.kerbW
truckLeft = truckDrawX + firstSolidCol
truckRight = truckDrawX + lastSolidCol
```

Ak riadok nie je celý vnútri vonkajšieho okraja cesty, spočítajú sa pixely mimo:

```ts
sx = truckDrawX + col
if (sx < outerLeft) leftOff++
else if (sx > outerRight) rightOff++
```

Závažnosť off-road stavu:

```ts
offRoadPixels = leftOff + rightOff
severity = offRoadPixels / TRUCK_PIXEL_MASK.totalPixels
```

Toto je dobrý model pre ZX pseudo-3D hru, pretože hráč vidí kamión v screen
pixeloch a okraj cesty je tiež screen-space tvar.

### 2. Kamión vs. premávka

Implementované v:

- `src/game/offroad.ts`
- `src/render/road3d.ts`
- `src/scenes/drive.ts`

Hlavná funkcia je:

```ts
checkTruckTrafficCollision(
  truckDrawX, truckDrawY,
  trafficLeft, trafficTop, trafficW, trafficH,
  trafficRows,
)
```

Prechádza solid pixely kamiónu a mapuje ich do zdrojového gridu traffic spriteu:

```ts
trafficX = floor((sx - trafficLeft) * srcW / trafficW)
trafficY = floor((screenY - trafficTop) * srcH / trafficH)
solid = trafficRows[trafficY][trafficX] !== '.'
```

Kolízia nastane iba vtedy, keď je solid pixel kamiónu aj solid pixel traffic
spriteu. Bodka `.` je transparentný pixel a nepočíta sa ako hmota.

Toto je pixel-perfect vo finálnom kontakte. Platí však len v rámci správnosti
premietnutého `trafficLeft/top/w/h`.

### 3. Projekcia premávky

Implementované v `projectTrafficVehicle()` v `src/render/road3d.ts`.

Kľúčová premenná:

```ts
worldZ = vehicle.distM - cameraDistance
```

Kladné `worldZ` znamená, že vozidlo je pred kamerou/kamiónom. Záporné `worldZ`
znamená, že vozidlo už práve prešlo za kameru.

Normálna projekcia pred hráčom:

```ts
dy = PERSPECTIVE_K / worldZ
rawI = round(dy) - 1
i = min(scanlines - 1, rawI)
y = horizonY + i + 1
t = (i + 1) / roadHeight
half = ROAD_HALF_TOP + (ROAD_HALF_BOTTOM - ROAD_HALF_TOP) * t
baseVanX = GAME_WIDTH / 2 - playerX * LATERAL_SHIFT
x = round(baseVanX + curveOffset + vehicle.x * half)
scale = 0.35 + t * t * 1.1
```

Potom:

```ts
w = round(spriteBaseW * scale)
h = round(spriteBaseH * scale)
left = x - floor(w / 2)
top = y - h
```

Near/pass-by fáza:

```ts
if (worldZ <= 0 && worldZ >= -TRAFFIC_PASS_BEHIND_M) {
  pass = min(1, -worldZ / TRAFFIC_PASS_BEHIND_M)
  x = round(centerX + vehicle.x * ROAD_HALF_BOTTOM)
  y = round(viewportBottom - 1 + pass * 14)
  scale = 1.45 + pass * 0.15
}
```

Táto fáza je zámerne krátka. Jej účel je, aby vozidlo nezmizlo presne v momente,
keď príde ku kabíne. Zároveň dáva bočnému kontaktu ešte pár frameov existencie.

### 4. Zber kanistrov

Kanistre nemajú pixel-perfect kolíziu. Používajú jednoduchú world-space toleranciu
v hĺbke a bočnej osi. Je to v poriadku, pretože kanister je odmena, nie tvrdá
prekážka. Pri zbere je férovejšia mierne veľkorysá kolízia.

## Konštanty

Projekcia a premávka:

```ts
PERSPECTIVE_K = 90
ROAD_HALF_TOP = 14
ROAD_HALF_BOTTOM = 120
LATERAL_SHIFT = 22
CURVE_STRENGTH = 1.0
TRAFFIC_COLLISION_DEPTH_M = 6
TRAFFIC_PASS_BEHIND_M = 5
```

Off-road:

```ts
OFF_ROAD_DRAG = 55
OFF_ROAD_RETURN = 1.8
OFFROAD_CRASH_SEVERITY = 0.4
OFFROAD_TIMEOUT_S = 3.0
EDGE_MARGIN_WARN_PX = 8
```

Fyzika vozidla:

```ts
MAX_SPEED = 120
ACCEL = 8
STEER_ACCEL = 3.2
STEER_DAMP = 5.0
MAX_LATERAL_V = 2.5
SPEED_STEER_PENALTY = 0.6
CURVE_DRIFT = 0.035
```

Varovanie pred povrchom:

```ts
ICE_AHEAD_LOOK_M = 220
```

Pri rýchlosti `vKmh` je čas varovania približne:

```ts
warningSeconds = ICE_AHEAD_LOOK_M / (vKmh / 3.6)
```

Pri 120 km/h:

```ts
220 / (120 / 3.6) = 6.6 s
```

## Známe slabiny

### 1. Vozidlo sa opticky posunulo bokom a vyhlo sa kolízii

Toto sa môže stať, keď sa premietnutá poloha trafficu mení rýchlejšie, než hráč
očakáva. Pred poslednou opravou bola v pass-by fáze aj umelá bočná zložka:

```ts
x += side * pass * 18
```

Bol to vizuálny trik, aby auto pri míňaní odišlo zo záberu. Pre kolízie to však
bolo zlé, pretože blízky bočný kontakt sa mohol v momente prechodu do pass-by
fázy zmeniť na miss.

Aktuálny stav: umelý bočný odsun je odstránený. Pass-by vozidlo drží:

```ts
x = centerX + vehicle.x * ROAD_HALF_BOTTOM
```

Je to lepšie, ale nie dokonalé. Väčší problém ostáva: projekcia trafficu je
kvantovaná scanline riadkami a zaokrúhľovaná na celé pixely.

### 2. Tunneling

Premávka sa najprv posunie a kolízia sa testuje raz za frame:

```ts
tickTraffic(...)
projectTrafficVehicle(...)
checkTruckTrafficCollision(...)
```

Ak je relatívna rýchlosť vysoká, oncoming auto môže medzi dvoma framami prejsť
zo stavu "ešte sa nedotýka" do stavu "už je za kamerou". Pass-by fáza riziko
znižuje, ale nerieši plne continuous collision.

Robustnejšie riešenie by bolo swept collision:

```ts
previousProjection -> currentProjection
test interpolated positions or swept mask/rect
```

Pre Ice Haul pravdepodobne stačí lacnejšia aproximácia:

- pri blízkych vozidlách testovať kolíziu dvakrát alebo trikrát za frame,
- držať predchádzajúci premietnutý rect a testovať starý aj nový,
- pri prechode cez `worldZ = 0` vynútiť kontakt sample presne v nulovej hĺbke.

### 3. Pixel-perfect, ale nie pocitovo férové

Pixel-perfect kolízia môže stále pôsobiť zle, keď:

- sprite art má veľké transparentné diery,
- projekcia položí sprite inde, než hráč pocitovo čaká,
- objekt zmizne príliš skoro,
- výsledok je iba binárny game over.

Hráč neposudzuje kolíziu podľa zdrojového bitmapového gridu, ale podľa vnímaného
tvaru a pohybu. Preto je debug overlay veľmi dôležitý.

## Jednoduché tuning body

### Premávka sa má dať ľahšie obísť

Zmenšiť projekčnú šírku:

```ts
trafficSpriteSize('car').w
```

Alebo zúžiť iba kolíziu:

```ts
collisionW = visualW * 0.85
```

Druhá možnosť je menej poctivá vizuálne, ale často pôsobí férovejšie.

### Bočné ťukance majú byť pravdepodobnejšie

Predĺžiť pass-by fázu alebo zväčšiť near-field sprite:

```ts
TRAFFIC_PASS_BEHIND_M = 6 or 7
scale = 1.55 + pass * 0.15
```

Alebo pridať dodatočné sample testy, keď `worldZ < 2`.

### Menej okamžitých crashov

Namiesto boolean kolízie zaviesť počet prekrytých pixelov:

```ts
overlapPixels = count truck/traffic solid overlap
severity = overlapPixels / min(truckSolidPixels, trafficSolidPixels)
```

Potom:

```ts
if severity < scrapeThreshold -> iskry/zvuk/vx impulse/damage
else if severity < crashThreshold -> šmyk + poškodenie
else crash
```

### Mäkkší off-road

Zvýšiť:

```ts
OFFROAD_CRASH_SEVERITY
OFFROAD_TIMEOUT_S
```

alebo znížiť:

```ts
OFF_ROAD_DRAG
OFF_ROAD_RETURN
```

### Hooky pre obtiažnosť

Dobré kandidáty:

```ts
trafficDensityMultiplier
trafficSpeedMultiplier
fuelMultiplier
warningLookAheadM
gripMultiplier
chainsDurationS
chainsCooldownS
chainsScorePenalty
```

Varovanie by neskôr malo byť skôr časové než iba metrové:

```ts
warningLookAheadM = baseLookAheadM + (speedKmh / 3.6) * extraWarningSeconds
```

Tak hráč dostane podobný čas na reakciu pri rôznych rýchlostiach.

## Odporúčaný roadmap pre kolízie

### Fáza 1: debug viditeľnosť

Pridať collision proof overlay:

- solid maska kamiónu jednou farbou,
- solid maska trafficu druhou farbou,
- prekryté pixely červeno/žlto,
- hodnoty `worldZ`, `trafficLeft/top/w/h`, `overlapPixels`.

Toto priamo rieši problémy typu "nedotkol som sa" alebo "mal som sa dotknúť".

### Fáza 2: klasifikácia kontaktu

Zmeniť traffic kolíziu z boolean na výsledok:

```ts
interface TrafficCollisionResult {
  hit: boolean
  overlapPixels: number
  severity: number
  centerX: number
  centerY: number
  side: 'front' | 'rear' | 'left' | 'right' | 'unknown'
}
```

Tým vzniknú:

- bočné škrtnutie,
- koleso na koleso,
- ťuknutie do nárazníka,
- tvrdý crash.

### Fáza 3: swept near-field sampling

Ukladať predchádzajúcu projekciu traffic vozidla. Pre blízke vozidlá:

```ts
for alpha of [0, 0.5, 1]:
  sample = lerp(previousProjection, currentProjection, alpha)
  test sample
```

Je to lacnejšie než plný fyzikálny engine a malo by zachytiť väčšinu tunnelingu.

### Fáza 4: poškodenie a šmyk namiesto okamžitého game over

Slabý overlap by mal:

- postrčiť `v.vx`,
- znížiť rýchlosť,
- pustiť častice,
- poškodiť náklad/kamión,
- prípadne spustiť šmyk.

Silný overlap má stále skončiť crashom.

### Fáza 5: vina za kontakt

ETS2 frustrácia často vzniká preto, že hráč dostane pokutu aj keď konflikt
spôsobila AI. Ice Haul zatiaľ nemá právny/fine systém, ale ak niekedy bude,
treba oddeliť "kontakt nastal" od "hráč je vinný".

Vina by mala brať do úvahy:

- kto menil pruh,
- kto už pruh obsadzoval,
- relatívnu rýchlosť,
- či bol hráč v legálnom pruhu,
- či traffic predbiehal alebo šiel v protismere.

## Porovnanie s inými hrami

### OutRun / OutRun 2006

OutRun 2006 je primárne arkáda. Recenzie zdôrazňujú powersliding, premávku a
"priateľskejší kolízny systém" v OutRun2 SP / Coast 2 Coast. Poučenie pre Ice
Haul nie je realizmus, ale čitateľnosť a odpustenie. Arkádová kolízia môže byť
zámerne mäkšia, ak hra stojí na flow.

Použiteľné pre Ice Haul:

- zúžiť kolíziu pri vysokej rýchlosti,
- povoliť side rubs,
- použiť kontakt na spomalenie/odklonenie namiesto okamžitého zničenia.

Zdroj:

- Pocket Gamer recenzia OutRun 2006: Coast to Coast:
  https://www.pocketgamer.com/outrun-2006-coast-to-coast/review/

### Forza Motorsport / Forza Horizon

Forza-like hry oddeľujú kolíziu, kozmetické poškodenie, mechanické poškodenie a
difficulty/assist nastavenia. GameSpot preview prvého Forza Motorsport opisuje
lokalizované poškodenie podľa miesta kontaktu a dopad na výkon auta hlavne pri
maximum damage nastavení. Turnajové pravidlá pre Forza 7 zároveň ukazujú, že
hra vie pracovať s oddelenými nastaveniami typu steering, damage difficulty a
collision mode.

Použiteľné pre Ice Haul:

- oddeliť vizuálny kontakt od mechanického následku,
- mať difficulty nastavenia,
- kontakt môže degradovať ovládanie, náklad, palivo alebo stav kamiónu namiesto
  okamžitého konca.

Zdroje:

- GameSpot Forza Motorsport preview:
  https://www.gamespot.com/articles/forza-motorsport-updated-hands-on/1100-6117786/
- príklad Forza 7 tournament nastavení:
  https://afbn.me/wp-content/uploads/2023/02/A-Few-Bad-Newbies-Complete-Whitepaper-Document-2.pdf

### Assetto Corsa Competizione

ACC stojí na detailnej práci s pneumatikami a dynamikou vozidla. Fyzikálne
poznámky k verzii 1.9 riešia tlak, teplotu, flex, surface temperature, camber,
toe a správanie pri brzdení, akcelerácii a zatáčaní.

Použiteľné pre Ice Haul:

- nesnažiť sa o plný tire simulator,
- ale držať slip/grip model explicitný a laditeľný,
- robiť rozdiely povrchov viditeľné a počuteľné.

Zdroj:

- ACC v1.9 physics notes:
  https://assettocorsa.gg/wp-content/uploads/ACCv19-physics_notes.pdf

### BeamNG.drive

BeamNG je opačný extrém: soft-body node/beam simulácia. Vozidlá sú deformovateľné
štruktúry z uzlov a nosníkov; komponenty sa simulujú a deformujú v reálnom čase.

Použiteľné pre Ice Haul:

- nie implementácia,
- ale princíp: poškodenie má byť priestorové a napojené na ovládanie,
- bočný zásah nemá mať rovnaký následok ako čelný náraz.

Zdroj:

- BeamNG soft-body physics overview:
  https://beamng.com/game/about/physics/

### Wreckfest / deštrukčné závodné hry

Wreckfest a podobné hry robia z poškodenia súčasť spektáklu aj gameplayu.
Rozhovory a coverage zdôrazňujú rozdiel medzi forgiving a realistic damage,
lokalizované poškodenie a spätnú väzbu do ovládania.

Použiteľné pre Ice Haul:

- mať difficulty/damage módy,
- slabé kolízie môžu byť zábavné, ak vytvoria riešiteľný chaos,
- realistické poškodenie bude príliš trestajúce bez stupňov obtiažnosti.

Zdroje:

- Red Bull rozhovor s Wreckfest dizajnérom:
  https://www.redbull.com/us-en/wreckfest-game-developer-interview
- Hardcore Gamer o location-based damage:
  https://hardcoregamer.com/news/bugbears-next-car-game-finally-gets-official-title-wreckfest/109791/

### Destruction Derby

Destruction Derby postavilo kolízie do stredu hry. Dôležité nie je len poškodenie,
ale predvídateľnosť výsledku. Ak hráč nerozumie tomu, čo sa stane pri kontakte,
kolízia pôsobí nefér.

Použiteľné pre Ice Haul:

- hráč musí vedieť predvídať následok kontaktu,
- debug overlay a stabilná near-field projekcia sú dôležitejšie než ďalšia
  komplexita.

Referencia:

- Destruction Derby overview:
  https://en.wikipedia.org/wiki/Destruction_Derby

### ETS2 / American Truck Simulator

ETS2/ATS sú relevantné preto, že Ice Haul je kamiónová hra. Poučenie nie je iba
fyzika, ale vnímanie viny. Hráči často reportujú frustráciu, keď do nich narazí
AI, najmä na kruhových objazdoch, ale pokutu dostane hráč. To je problém
ownership/fault logiky, nie len hit detection.

Použiteľné pre Ice Haul:

- ak pribudnú pokuty alebo hodnotenie jazdy, treba oddeliť "kontakt nastal" od
  "hráč je vinný",
- zámer AI a obsadenie pruhu sú dôležité,
- pravidlá pruhov/kruhových objazdov potrebujú explicitnú logiku.

Zdroje:

- Truck Simulator Wiki fines:
  https://trucksimulator.wiki.gg/wiki/Fines
- Steam diskusia o ETS2 roundabout AI:
  https://steamcommunity.com/app/227300/discussions/0/350542683188607682/

## Teória kolíznej odozvy

Plné fyzikálne enginy zvyčajne oddeľujú:

1. collision detection,
2. contact manifold,
3. penetration resolution,
4. impulse/friction response,
5. gameplay side effects.

Ice Haul dnes robí detection a okamžitý herný následok, ale nemá samostatnú
response fázu. Poznámky Newcastle University ku game physics opisujú bežný
postup: projekciou oddeliť preniknuté objekty a potom impulse metódou vyriešiť
pohybovú odozvu. Pre Ice Haul je to príliš ťažké ako plný systém, ale architektúra
oddelených krokov je použiteľná.

Zdroj:

- Newcastle collision response notes:
  https://research.ncl.ac.uk/game/mastersdegree/gametechnologies/physicstutorials/5collisionresponse/Physics%20-%20Collision%20Response.pdf

## Navrhovaný Ice Haul model

Najvhodnejší model:

```text
broad phase:
  traffic v hĺbkovom rozsahu
  near screen rect približne prekrýva truck rect

narrow phase:
  truck pixel mask vs traffic pixel mask

classification:
  počet overlap pixelov
  stred overlapu
  relatívny pohyb
  strana kontaktu

response:
  škrtnutie -> častice, zvuk, malý vx/speed zásah
  bočný ťukanec -> šmyk, damage, silnejší vx impulse
  nárazník -> silné spomalenie, damage
  tvrdý overlap / vysoká rýchlosť -> crash
```

Navrhované vzorce:

```ts
relativeSpeedMps = abs(playerSpeedKmh - trafficSpeedKmh) / 3.6
impactEnergyProxy = overlapPixels * relativeSpeedMps * relativeSpeedMps
severity = clamp01(impactEnergyProxy / ENERGY_CRASH_SCALE)
```

Klasifikácia strany:

```ts
overlapCenterX = average(overlapPixelX)
truckCenterX = truckDrawX + TRUCK_BMP_W / 2
sideBias = (overlapCenterX - truckCenterX) / (TRUCK_BMP_W / 2)

if sideBias < -0.4 -> ľavá strana
if sideBias >  0.4 -> pravá strana
else front/rear/center contact
```

Odozva:

```ts
v.speed -= speedLossKmh
v.vx += sideImpulse
damage += severity
```

Kde:

```ts
speedLossKmh = relativeSpeedMps * severity * SPEED_LOSS_SCALE
sideImpulse = sign(sideBias) * severity * SIDE_IMPULSE_SCALE
```

## Testovací plán

Existujúce testy už pokrývajú:

- rozmery masky kamiónu,
- off-road severity,
- transparentné traffic pixely,
- centrovanú traffic kolíziu,
- ľavý pruh bez kolízie,
- pass-by bočný kontakt,
- rast traffic projekcie a near visibility.

Odporúčané nové testy:

1. Swept crossing:
   vozidlo sa za frame presunie z `worldZ = 1` na `worldZ = -1` a stále sa
   zachytí kontakt.

2. Side scrape:
   malý overlap vráti non-crash severity.

3. Koleso na koleso:
   nízky, bočne posunutý overlap vráti side kontakt.

4. Debug consistency:
   rovnaké rows sa používajú na kreslenie aj kolíziu.

5. Difficulty:
   warning lookahead a traffic density sa menia podľa obtiažnosti.

## Praktické odporúčania

Najbližšie kroky:

1. pridať collision debug overlay,
2. zmeniť `checkTruckTrafficCollision()` z boolean na overlap result,
3. pridať 2-sample alebo 3-sample near-field collision pre `worldZ < 2`,
4. pridať scrape/skid response pred plným crashom,
5. všetky zmeny projekcie kryť testami.

Čomu sa vyhnúť:

- plný rigid-body physics,
- skryté world-space crash radiusy,
- kolízia väčšia než viditeľný sprite bez debug vysvetlenia,
- vizuálny pass-by pohyb, ktorý nenasleduje kolízia.

Hlavné pravidlo:

```text
World-space môže rozhodnúť, čo sa oplatí testovať.
Screen-space pixely rozhodujú, či sa hráč dotkol objektu.
Gameplay response rozhoduje, aký vážny kontakt bol.
```
