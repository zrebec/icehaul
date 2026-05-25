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

const canvas = document.getElementById('game') as HTMLCanvasElement
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

function startDrive() {
  const drive = createDriveScene((stats) => {
    replaceScene(scenes, createGameOverScene(stats))
  })
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
