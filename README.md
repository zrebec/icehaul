# Ice Haul

ZX Spectrum-flavoured ice-road trucking micro-sim. Not ETS2 — its 8-bit hallucination. The fantasy is **risk management**, not speed: tyre pressure, cargo balance, ice patches, wind, fuel, driver fatigue. Every metre is a small decision.

Built on [zx-kit](https://github.com/zrebec/zx-kit) (`zx-kit@^0.21.0`).

## Play

**[Play in browser](https://zrebec.github.io/ice-haul/)** (GitHub Pages)

Or run locally:

```bash
npm install
npm run dev       # http://localhost:5173
```

## Controls

| Key | Action |
|-----|--------|
| Arrow Up | Throttle (speed never decays on its own — you must brake) |
| Arrow Down | Brake |
| Arrow Left / Right | Steer |

## Gameplay

- **First/third-person hybrid** — you see the road from behind the truck.
- **Ice patches** appear randomly. On ice, steering barely responds and lateral velocity persists (drift). Watch for the blinking **ICE AHEAD** warning in the top bar.
- **Curves** push the truck off-road via centrifugal force. On asphalt, curves are comfortable. On ice at speed, they're deadly — **brake before ice**.
- **Off-road** penalties: heavy speed drag, rumble beep, red border flash.
- **Kerb stripes** (Pole Position-style white/yellow) mark road edges.
- **CRT scanlines** + barrel distortion for authentic TV look.

## Screenshot

![Ice Haul screenshot](screenshot.png)

## Tech

- **256 x 192** game pixels (pure ZX Spectrum resolution), integer-scaled x4.
- **15-colour ZX palette** only. 8x8 attribute colour clash is intentional.
- **TypeScript + Vite** (no runtime dependencies besides zx-kit).
- All tunable constants in one file: `src/config.ts`.
- Headless screenshot capture: `node scripts/screenshot.mjs out.png`

## Project structure

```
src/
  main.ts              entry: setupCanvas, scene loop, CRT effects, audio init
  config.ts            ALL tunable constants with JSDoc
  scenes/drive.ts      main driving scene
  game/
    vehicle.ts         throttle/brake/steer + grip-scaled physics
    road.ts            deterministic surface + curvature generator
  render/
    road3d.ts          scrolling pseudo-3D road with curves + kerbs
    truck.ts           16x32 rear-view truck bitmap with AttrMap
    hud.ts             3-panel instrument cluster
    topbar.ts          score/dist/time/ice-ahead status bar
  audio/
    engine.ts          continuous square-wave drone modulated by speed
scripts/
  screenshot.mjs       headless Puppeteer canvas capture
  drive-shot.mjs       automated drive + capture (holds keys for N seconds)
```

## Roadmap

See `CLAUDE.md` for the full 14-phase roadmap. Current status: **Phase 1 complete** (drive scene with scrolling road, curves, ice/asphalt surfaces, truck sprite, engine drone, off-road penalties, CRT effects).

## License

MIT
