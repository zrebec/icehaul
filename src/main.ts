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
import { roadSeedFromSearch } from './game/seed.ts'
import {
  drawTrafficMatrix, isMatrixRequested, matrixLayoutFor, matrixOptionsFromSearch,
} from './render/debug/trafficMatrix.ts'

const canvas = document.getElementById('game') as HTMLCanvasElement

// ?matrix=1 — the traffic contact sheet, not the game. Renders one static image
// and stops: no scene manager, no input, no audio, no frame loop. It exists so a
// renderer change can be judged against identical frames; see AGENTS.md step 0.
if (isMatrixRequested(window.location.search)) {
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

  window.addEventListener('keydown', () => {
    initAudio(0.3)
    resumeAudio()
  }, { once: true })

  const scenes = createSceneManager()

  // One route per local calendar day, overridable with ?seed= so a specific road,
  // traffic stream and canister layout can be replayed for physics A/B tests.
  // Read once at boot: the route must not change under the player at midnight.
  const gameSeed = roadSeedFromSearch(window.location.search)

  function startDrive() {
    const drive = createDriveScene((stats) => {
      replaceScene(scenes, createGameOverScene(stats))
    }, gameSeed)
    pushScene(scenes, drive)
  }

  startDrive()

  let last = performance.now()
  function frame(now: number) {
    const dt = Math.min(50, now - last)
    last = now

    updateScenes(scenes, dt)
    renderScenes(scenes, ctx)

    tickUI(dt)
    renderUI(ctx)

    if (SCANLINE_ALPHA > 0) drawScanlines(ctx, SCANLINE_ALPHA)

    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
