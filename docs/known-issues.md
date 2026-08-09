# Known issues

## `undici` / `ip-address` / `tar` / `brace-expansion` bundled in the npm CLI · dev/CI-only · NOT shipped

**Status:** open, **unfixable downstream**, waiting on upstream npm. First flagged 2026-06-20,
re-verified 2026-08-09. Affects this game + zx-kit + every retro repo using semantic-release.

`npm audit` reports 7 vulnerabilities (5 moderate, 2 high). GitHub has 6 matching Dependabot
alerts. **All of them live inside `node_modules/npm/node_modules/`.**

### Where it comes from

```
semantic-release@25.0.9            ← latest published
└─ @semantic-release/npm@13.1.5    ← latest published, pins npm@^11.6.2
   └─ npm@11.18.0
      ├─ undici@6.27.0           bundled   3 × moderate (GHSA-v3r7 / -8xcm / -m8rv)
      ├─ ip-address@10.2.0       bundled   1 × high + 2 × moderate (GHSA-mwp4 / -4xrf / -22jq)
      ├─ tar@7.5.19              bundled
      └─ brace-expansion@5.0.7   bundled
```

### Why it cannot be fixed here

npm ships its whole dependency tree **bundled inside its own tarball**. `node_modules/npm/node_modules/*`
is unpacked from that tarball on install, so no edit to `package-lock.json` — and no `overrides`
entry — can change those versions. npm says so itself (`npm audit fix --dry-run`, 2026-08-09):

```
npm warn audit fix undici@6.27.0 is a bundled dependency of
npm warn audit fix undici@6.27.0 npm@11.18.0 at node_modules/npm
npm warn audit fix undici@6.27.0 It cannot be fixed automatically.
npm warn audit fix undici@6.27.0 Check for updates to the npm package.
```

There is currently **no upstream version to move to**, verified 2026-08-09:

- `semantic-release@25.0.9` and `@semantic-release/npm@13.1.5` are the latest published.
- `@semantic-release/npm` pins `npm@^11.6.2`, so npm 12 is out of range anyway.
- `npm@12.0.2` (latest) bundles the **identical** versions — `undici@6.27.0`, `ip-address@10.2.0`,
  `tar@7.5.19`, `brace-expansion@5.0.7`. Unpacked and checked, not assumed.

Verified ineffective: `npm audit fix`, `npm audit fix --force`, `overrides`, deleting
`package-lock.json` + `node_modules` and reinstalling, upgrading global npm. **Do not
re-investigate** — the fix must come from an npm release that bundles patched dependencies.

### What WAS fixable, and is already fixed

A second, **non-bundled** copy of `undici` existed at `node_modules/@actions/http-client/node_modules/undici`
(via `@semantic-release/npm` → `@actions/core` → `@actions/http-client`). That one was a genuine
lockfile-level fix and landed in `a8063c9` (#18): 6.27.0 → 6.28.0.

A nested `overrides` entry for it was tested on 2026-08-09 and is now a **no-op** — the tree already
resolves to 6.28.0 — so none was added. Note the distinction if this comes up again: overrides work
on ordinary transitive dependencies and do nothing at all for bundled ones.

### Why Dependabot's security job crashes

The `npm-security` group batches every open security alert into one job. Since some members are
unfixable-by-construction, the grouped run dies in
`dependabot/updater/operations/create_group_update_pull_request.rb:63` with `unknown_error` and a
null detail, after logging `VulnerabilityAuditor: audit result not viable: downgrades_dependencies`
(a blanket `undici` bump would have downgraded the root 7.x and jsdom's 8.x copies). That is a
Dependabot limitation, not a misconfiguration here.

**Do not "fix" it with `allow:` or `ignore:` in `.github/dependabot.yml`.** Both filter *security*
updates as well as version updates — that is exactly the trap `da058ef` removed, and the errata
comment at the top of `dependabot.yml` explains it. The alerts were **dismissed as `tolerable_risk`
on 2026-08-09** instead, which is the mechanism designed for "real but not actionable".

### Why the real risk is negligible

Dev/CI-only, `scope: development`. `semantic-release` runs in exactly one place: the `release` job
of `.github/workflows/ci-deploy.yml`, on a GitHub-hosted runner, talking to the npm registry and
the GitHub API. It is **not in the shipped artifact** — the game deploys a static Vite bundle to
GitHub Pages, so npm, semantic-release and undici never reach a browser. The advisories require
processing untrusted HTTP, which never happens on that path.

Runtime dependency surface, for the record: this game depends on `zx-kit` and nothing else, and
zx-kit ships `dependencies: {}`.

### Plan

Accept. Re-check when npm publishes a release with patched bundled dependencies, then un-dismiss.
No code change here.

---

## ~~`scripts/drive-shot.mjs` cannot start the engine~~ · fixed 2026-08-09

**Status:** closed. The script now holds ENTER and asserts the truck actually moved.

Original diagnosis was right — `keyboard.press('Enter')` is a tap, and the crank needs ENTER
**held** for `CRANK_NEEDED_MS = 1800` — but the suggested "~2 s" hold is not enough, and two
further faults were hiding behind the first:

1. **The crank counts game `dt`, not wall clock.** `main.ts` clamps `dt` to 50 ms per frame, so
   every longer frame is under-counted and game time drifts behind real time — measured ~10%
   behind on a headless page still warming up, i.e. `crankMs` was 1799.9 after 2000 ms of holding.
   Releasing ENTER even fractionally early makes the keyup handler reset the crank to zero, so the
   run silently starts over. The hold is now 3500 ms.
2. **Holding ArrowRight the whole time drove the truck off the road.** Lateral authority barely
   scales with speed, so steering from a standstill reached the kerb in under two seconds and
   crashed at 0.25 m. This fault predates the ignition bug; it was simply unreachable while the
   engine never started. Steering is now a 300 ms pulse just before the capture.

The script also asserts movement now: two frame signatures across 1 s must differ by at least 0.5%
of sampled pixels. Driving measures ~2.3%, a parked truck 0.00%, so a stalled capture fails loudly
instead of producing a plausible-looking PNG.

**Remaining limitation:** the run stays in 1st gear (~25 km/h), so it cannot reach the first
non-asphalt segment at `START_ASPHALT_M = 1000`. Capturing ice or a surface transition would need
clutch + upshift automation.

## Route seeds are mixed into the hash additively · generation · low priority

**Status:** open by choice, 2026-08-09. Cosmetic today, but it constrains any future change.

`game/road.ts` derives every roll as `hash(idx * K + C + _seed)` — the seed is *added* to the
index term rather than mixed independently. Two consequences:

- Seed `S + 17` produces, for segment `idx`, the same surface roll that seed `S` produces for
  `idx + 1`. Certain seed pairs are therefore shifted copies of one another rather than
  independent routes. The same holds for the length rolls at their own multipliers (31, 37, 53).
- Structured seed families sample this lattice rather than the hash's full space. The daily seed
  (`YYYYMMDD`) steps by 1 per day, which the avalanche decorrelates fine, so this is not a
  practical problem — but a future "seed = level number" scheme stepping by 17 would be.

The fix is to mix the seed separately, e.g. `hash(idx * 17 + 3 + hash32(seed))`. **Not applied on
purpose:** it changes what every existing seed means, including `ICE_PLAYTEST_SEED = 1443866`,
which is the owner's hand-verified difficulty benchmark and the reference the parallel codex
working copy is compared against. Worth doing only alongside a deliberate re-hunt for benchmark
seeds.

## Puppeteer's browser is not installed by `npm ci` · dev tooling

**Status:** open, 2026-08-09.

`allowScripts` in `package.json` pins `puppeteer@25.2.1`, but the installed version is `25.5.0`, so
puppeteer's `postinstall` never runs and Chrome is never downloaded:

```
npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn allow-scripts   puppeteer@25.5.0 (postinstall: node install.mjs)
```

Any script documented in `CLAUDE.md` under "Build & run" that uses puppeteer fails with
`Could not find Chrome`. Workaround: `npx puppeteer browsers install chrome`. Proper fix: widen the
`allowScripts` entry so it does not pin an exact patch version that dependency bumps immediately
invalidate.
