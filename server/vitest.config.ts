import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The soak test runs a match at real duration — six minutes. It has its own config and script.
    exclude: ['test/soak/**', 'node_modules/**'],
    // Vitest buffers console output by default, which silently swallowed both things in this
    // suite that exist to be read: the balance probe's two lines and the integration server log.
    disableConsoleIntercept: true,
  },
})
