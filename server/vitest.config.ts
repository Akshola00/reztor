import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Vitest buffers console output by default, which silently swallowed both things in this
    // suite that exist to be read: the balance probe's two lines and the integration server log.
    disableConsoleIntercept: true,
  },
})
