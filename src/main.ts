import {
  setupCanvas,
  curveDisplay,
  drawScanlines,
  initInput,
  initAudio,
  resumeAudio,
  createSceneManager,
  pushScene,
  replaceScene,
  updateScenes,
  renderScenes,
  tickUI,
  renderUI,
} from 'zx-kit'

import { CANVAS_SCALE, GAME_HEIGHT, GAME_WIDTH, SCANLINE_ALPHA, CRT_CURVE_INTENSITY } from './config.ts'
import { createDriveScene } from './scenes/drive.ts'
import { createGameOverScene } from './scenes/gameover.ts'
import { createIntroScene } from './scenes/intro.ts'
import { roadSeedFromSearch } from './game/seed.ts'
import { loadPrefs } from './game/prefs.ts'
import {
  contourEnabledFromSearch, glowSettingsFromSearch,
  drawTrafficMatrix, isMatrixRequested, matrixLayoutFor, matrixOptionsFromSearch,
} from './render/debug/trafficMatrix.ts'
import {
  drawSceneryMatrix, drawSceneryPlacement, isSceneryMatrixRequested,
  sceneryMatrixLayoutFor, sceneryMatrixOptionsFromSearch,
  sceneryPlacementLayoutFor, sceneryPlacementSeedFromSearch,
} from './render/debug/sceneryMatrix.ts'
import { setContourEnabled } from './render/road3d.ts'
import { renderPendingLampGlow, setGlowSettings } from './render/vehicleGlow.ts'
import {
  beginDebugFrame, debugModeFromSearch, endDebugFrame, initDebugOverlay, renderDebugOverlay,
} from './render/debug/overlay.ts'

const canvas = document.getElementById('game') as HTMLCanvasElement

// ?outline=0 and ?glow=0 — the two render switches, settled before anything
// reaches the glass.
//
// The contact sheet reads them straight from the URL and never from storage. It
// exists to be compared against another run of itself, so an absent switch has to
// mean *the default*, not "whatever this machine last saved". The game takes the
// same two switches through `loadPrefs()` instead, where the player's choice is
// remembered and the URL still overrides it for an A/B run.
setContourEnabled(contourEnabledFromSearch(window.location.search))
setGlowSettings(glowSettingsFromSearch(window.location.search))

// ?matrix=1 — the traffic contact sheet, not the game. Renders one static image
// and stops: no scene manager, no input, no audio, no frame loop. It exists so a
// renderer change can be judged against identical frames; see AGENTS.md step 0.
if (isSceneryMatrixRequested(window.location.search)) {
  const options = sceneryMatrixOptionsFromSearch(window.location.search)
  const placementSeed = sceneryPlacementSeedFromSearch(window.location.search)
  const layout = placementSeed === undefined
    ? sceneryMatrixLayoutFor(options)
    : sceneryPlacementLayoutFor(options)
  canvas.width = layout.width
  canvas.height = layout.height
  canvas.style.width = `${layout.width}px`
  canvas.style.height = `${layout.height}px`
  const sheetCtx = canvas.getContext('2d')
  if (!sheetCtx) throw new Error('scenery matrix: no 2d context')
  if (placementSeed === undefined) {
    drawSceneryMatrix(sheetCtx, () => document.createElement('canvas'), options)
  } else {
    drawSceneryPlacement(sheetCtx, () => document.createElement('canvas'), placementSeed, options)
  }
} else if (isMatrixRequested(window.location.search)) {
  const options = matrixOptionsFromSearch(window.location.search)
  const layout = matrixLayoutFor(options)
  canvas.width = layout.width
  canvas.height = layout.height
  canvas.style.width = `${layout.width}px`
  canvas.style.height = `${layout.height}px`
  const sheetCtx = canvas.getContext('2d')
  if (!sheetCtx) throw new Error('matrix: no 2d context')
  drawTrafficMatrix(sheetCtx, () => document.createElement('canvas'), options)
} else {
  bootGame()
}

function bootGame(): void {
  const ctx = setupCanvas(canvas, CANVAS_SCALE, GAME_WIDTH, GAME_HEIGHT)
  canvas.style.width = ''
  canvas.style.height = ''

  curveDisplay(canvas, CRT_CURVE_INTENSITY)

  initInput()

  // Stored choices first, URL last — see the note at the top of this file.
  const prefs = loadPrefs(window.location.search)

  // Browsers refuse an AudioContext before a gesture, so the master volume cannot
  // be set until the player touches something. `setMasterVolume` is a no-op until
  // then, which is why the saved value has to be handed to `initAudio` here rather
  // than applied earlier and hoped for.
  window.addEventListener('keydown', () => {
    initAudio(prefs.volume)
    resumeAudio()
  }, { once: true })

  // `O` cycles the debug overlay; `?debug=` opens it without a keypress. It
  // composites after the scanlines for the same reason the glow does — see
  // render/debug/overlay.ts.
  initDebugOverlay(debugModeFromSearch(window.location.search))

  const scenes = createSceneManager()

  // One route per local calendar day, overridable with ?seed= so a specific road,
  // traffic stream and canister layout can be replayed for physics A/B tests.
  // Read once at boot: the route must not change under the player at midnight.
  const gameSeed = roadSeedFromSearch(window.location.search)

  function startDrive(): void {
    const drive = createDriveScene((stats) => {
      replaceScene(scenes, createGameOverScene(stats))
    }, gameSeed)
    replaceScene(scenes, drive)
  }

  pushScene(scenes, createIntroScene(startDrive))

  let last = performance.now()
  function frame(now: number) {
    beginDebugFrame(now)
    const dt = Math.min(50, now - last)
    last = now

    updateScenes(scenes, dt)
    renderScenes(scenes, ctx)

    tickUI(dt)
    renderUI(ctx)

    if (SCANLINE_ALPHA > 0) drawScanlines(ctx, SCANLINE_ALPHA)

    // Last, and after the scanlines on purpose. A lamp's bloom is light on the
    // glass; drawn any earlier it sits under an overlay that takes the whole
    // picture to 65% brightness, which is how the first version came out
    // invisible in the game while looking right on the contact sheet.
    renderPendingLampGlow(ctx)

    // After the glow, so the readout is never the thing a halo washes out.
    endDebugFrame()
    renderDebugOverlay(ctx)

    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
