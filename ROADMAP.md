# Ice Haul Roadmap

## Graphics pass

- Replace hand-rect traffic with ZX-style vehicle sprites:
  - same-direction cars: rear view, green body, red tail lights
  - same-direction mini cars: compact 8x8 rear silhouettes
  - same-direction 12x8 cars: deliberately narrow collision target
  - same-direction buses: red CSAD-style rear silhouettes
  - oncoming cars: white/cyan front, bright yellow headlights
  - oncoming buses: red front, black grille, strong headlights
- Keep every sprite inside the zx-kit palette and preserve the 8x8 attribute-cell look.
- Move repeated pixel-art patterns toward readable row strings or zx-kit-native bitmap data.
- Redraw roadside objects after traffic:
  - lamp posts with stronger perspective shape
  - warning signs with readable silhouettes
  - trees/snow banks/road posts as small bitmap assets
- Revisit the player truck after traffic is stable:
  - separate visual overlays from collision mask
  - add a visual debug mode for solid collision pixels

## Collision and projection

- Keep traffic collision screen-space and pixel-perfect.
- Use one shared projection function for both drawing and collision.
- Avoid world-space collision radii unless they are only broad-phase filters.
- Near-field collision must be visual-mask based. World-space checks may only
  be used as broad-phase filters and must never decide a crash before visible
  pixel contact.
- Add a headless browser collision smoke test that starts a deterministic scene and confirms:
  - centered truck does not collide with left-lane oncoming traffic
  - deliberate lane drift does collide
  - near traffic remains visible until it leaves the viewport

## Logic later

- Do not redesign traffic behavior during the graphics pass.
- Later, consider lane intent, overtaking windows, and explicit despawn states.
- Later, investigate rare same-lane traffic clustering before changing behavior:
  add deterministic tests for two same-direction vehicles spawning close together
  in the player lane, then verify whether braking or overtaking leaves a fair
  gameplay escape.
- Later, extract shared perspective math for road, traffic, canisters, and roadside objects.
- Later, add save/high score support through zx-kit save APIs.
