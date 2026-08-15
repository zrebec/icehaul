import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __BUILD_NUMBER__: JSON.stringify('0'),
  },
  test: {
    environment: 'jsdom',
    /**
     * Vitest's default is 5 s, which this suite outgrew without anyone noticing.
     *
     * The resampling measurements are deliberately expensive: `resampleStability`
     * and `approachChurn` resample every sprite across twenty size steps and
     * compare each against an eight-times finer copy of itself, so a single `it`
     * does tens of thousands of picture comparisons. Measured on an M-series Mac,
     * `prints the profile` takes 1.5 s alone and **3.3 s when the suite runs in
     * parallel** and the files compete for cores — 66% of the old budget. A CI
     * runner is slower and has fewer cores, so the margin was under 1x and the
     * build failed on `main` after #36 with a 5 s timeout rather than a real
     * defect.
     *
     * 30 s is not a guess at how long they take; it is a bound on how long a test
     * may run before something is genuinely wrong. If a test ever approaches it,
     * that is a signal to make the test cheaper, not to raise this again.
     */
    testTimeout: 30_000,
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
