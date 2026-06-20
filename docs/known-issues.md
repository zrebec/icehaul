# Known issues

## undici 6.26.0 — high `npm audit` warning (bundled in the npm CLI) · dev/CI-only · NOT shipped

**Status:** open, **unfixable downstream**, waiting on upstream npm. Flagged 2026-06-20.
Affects this game + zx-kit + all retro games (anything using semantic-release).

`npm audit` reports 1 high-severity vulnerability:

```
undici  <=6.26.0   (high) — 4 GHSA advisories: Set-Cookie header injection, WebSocket DoS,
                            response-queue poisoning, SameSite downgrade
node_modules/npm/node_modules/undici
```

### Where it comes from
`undici@6.26.0` is a **bundled dependency of the `npm` CLI** (v11.17.0 — the latest published npm),
which is pulled into the **dev** tree by **semantic-release** (`@semantic-release/npm`). It lives
*inside* the npm tarball.

### Why it cannot be fixed here
npm bundles its own dependencies, so a downstream project cannot override them. `npm audit fix`
says so itself:

```
npm warn audit fix undici@6.26.0 is a bundled dependency of npm@11.17.0 at node_modules/npm
npm warn audit fix It cannot be fixed automatically. Check for updates to the npm package.
```

Verified ineffective (2026-06-20): `npm audit fix`, `npm audit fix --force`, package.json
`overrides`, deleting `package-lock.json` + `node_modules` and reinstalling, and upgrading the
global npm. **The fix must come from upstream npm** — a new npm release that bundles a patched
undici (≥ 6.27 / 7.x / 8.x; undici's latest is 8.5.0).

### Why the real risk is negligible
It is a **dev/CI-only** transitive dependency, used only by semantic-release in CI (a trusted
GitHub Actions runner, talking to the trusted npm registry / GitHub API). It is **not in the
shipped artifact**: the game ships a static Vite bundle to GitHub Pages — semantic-release / npm /
undici never reach the browser. The advisories require processing untrusted HTTP, which never
happens here.

### Verified not propagated (2026-06-20)
- this game's `dependencies: { "zx-kit": "^x.y.z" }` — and nothing else.
- zx-kit itself has `dependencies: {}` (zero runtime deps).

### Plan
Accept; re-check `npm audit` on each release / periodically. It clears automatically once npm ships
a release bundling a patched undici. **No change needed in our code** — overrides / audit fix /
nuke were all tried and proven ineffective; do not re-investigate.
