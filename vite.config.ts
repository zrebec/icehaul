import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'

const commitCount = (() => {
  try { return execSync('git rev-list --count HEAD', { encoding: 'utf-8' }).trim() }
  catch { return '0' }
})()

export default defineConfig({
  base: './',
  define: {
    __BUILD_NUMBER__: JSON.stringify(commitCount),
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
