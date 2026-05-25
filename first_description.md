# IceRoads
## Žáner: 
mikro-simulátor kamióna / risk management

##Čo by vtedy nešlo (odôvodnenie prečo zx-kit)
dynamická fyzika povrchu, generované počasie, dlhé trasy, deformujúce sa podmienky.

## Popis
Nie ETS2, ale jeho ZX halucinácia. Jazdíš s ťažkým vozidlom cez zamrznutú krajinu. Nejde o rýchlosť, ale o rozhodnutia: tlak v pneumatikách, hmotnosť nákladu, ľad, vietor, benzín, únava vodiča. Obrazovka by mala kokpitové UI: kompas, tachometer, palivo, poškodenie, náklon.

## Prečo sedí na zx-kit: 
verzia 0.20.0 pridala prístrojové widgety ako segmented bar, tank, dial a compass.

## Čo doplniť:
vehicle.ts s veľmi jednoduchou fyzikou: traction, inertia, steering lag, surface friction. Tiež weather.ts.

