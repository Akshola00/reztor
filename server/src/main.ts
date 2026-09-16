import { createGameServer } from './net/server.js'

// Dev entry point. Not the production process: no signal handling, no config from the environment
// beyond the port, and the in-memory escrow fake.
const port = Number(process.env.PORT ?? 3000)
const server = createGameServer()

try {
  await server.listen(port)
} catch (error) {
  const { code } = error as NodeJS.ErrnoException
  console.error(
    code === 'EADDRINUSE'
      ? `port ${port} is already in use — stop the other server, or run with PORT=3001 pnpm serve`
      : `could not start: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
}

console.log(`reztor server listening on http://localhost:${port}`)
console.log(`dev client:  http://localhost:${port}/dev`)
