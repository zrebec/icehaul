# Route seeds worth keeping

A seed is the whole route: road, surfaces, traffic stream and canister layout are
all deterministic functions of one number. Replay any of these with `?seed=N`.

## You cannot lose a daily seed

The daily route seed is **the date itself**, as `YYYYMMDD` — `dailyRoadSeed()` in
`src/game/seed.ts` builds it from local calendar components and nothing else.

So a route from any day is recoverable from the calendar alone:

| Day | Seed |
|---|---|
| 25 August 2026 | `20260825` |
| 1 January 2027 | `20270101` |

`?seed=20260825` replays that day's road exactly, on any machine, forever.

That also means daily seeds are a narrow, predictable slice of the seed space —
every one is a number near 20 million with a date's shape. The hand-picked seeds
below come from sweeping the full 32-bit space and are not reachable by waiting.

## Catalogue

| Seed | Why it is worth keeping | Verified |
|---|---|---|
| `20260825` | **Traffic density.** The daily route for 25 Aug 2026; noted during the title-screen work for how busy the road felt. Density not yet measured — see below. | Owner, by feel |
| `1443866` | **Worst-case ice.** 48.5% ice over the first 5 km, 56.5% non-asphalt, 475 m of ice inside bends of \|c\| >= 1.5. The difficulty benchmark. | Owner, completed end to end |
| `534501` | 725 m of ice in sharp bends. | Confirmed completable |
| `1399375` | 650 m of ice in sharp bends. | Confirmed completable |
| `52662` | 625 m of ice in sharp bends. | Confirmed completable |

The four ice seeds are the survivors of a two-million-seed sweep for 35–60% ice
with at least 300 m of it in a sharp curve; the full reasoning lives in
`src/game/seed.ts` beside `ICE_PLAYTEST_SEED`.

## Adding one

Note the seed, what makes it interesting, and how you know. "Felt busy" is a
perfectly good entry — it is a lead for a later measurement, and an unrecorded
route is gone once the day turns.

What is missing for `20260825` is a number: vehicles per kilometre, or seconds
between overtakes. There is no traffic-density sweep yet, the way there is one
for ice. If density becomes a thing worth tuning, that sweep is the tool, and
this seed is its first reference point.
