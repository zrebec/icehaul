import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __BUILD_NUMBER__: JSON.stringify('0'),
  },
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: [
        'src/game/**/*.ts',
        'src/render/truck.ts',
      ],
      exclude: [
        'src/game/roadside.ts',
      ],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 70,
        statements: 75,
      },
    },
  },
})
