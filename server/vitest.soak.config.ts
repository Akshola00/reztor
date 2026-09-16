import { defineConfig } from 'vitest/config'

// The soak runs one match at real MVP duration: 3 rounds of 60/45/15 seconds, 1440 ticks, six
// minutes of wall clock. Kept out of `pnpm test` and run on its own with `pnpm soak`.
export default defineConfig({
  test: {
    include: ['test/soak/**/*.soak.test.ts'],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    disableConsoleIntercept: true,
    // A six-minute match measured against a wall clock must not share a core with another suite.
    fileParallelism: false,
  },
})
