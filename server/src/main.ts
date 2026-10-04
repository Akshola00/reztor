import { chainConfigFrom, escrowModeFrom } from './chain/config.js'
import { connectChain } from './chain/escrow.js'
import { chainFaucet, openFaucet } from './chain/faucet.js'
import { consoleLogger } from './log.js'
import { createGameServer, type ServerOptions } from './net/server.js'

// Dev entry point. Not the production process: no signal handling, and config from the environment
// only for the port and the escrow. ESCROW_MODE=fake (the default) is the in-memory escrow;
// ESCROW_MODE=chain is the Solana program, configured by RPC_URL, PROGRAM_ID, MINT and
// AUTHORITY_SECRET_KEY. FAUCET_ENABLED=true adds the devnet faucet, paid from FAUCET_SECRET_KEY.
const port = Number(process.env.PORT ?? 3000)

function fail(problems: string[]): never {
  for (const problem of problems) console.error(`could not start: ${problem}`)
  process.exit(1)
}

const mode = escrowModeFrom(process.env)
if (!mode.ok) fail([mode.error])

let options: ServerOptions = {}
if (mode.value === 'chain') {
  const config = chainConfigFrom(process.env)
  if (!config.ok) fail(config.error)
  const chain = await connectChain(config.value, consoleLogger)
  if (!chain.ok) fail([chain.error])
  // Before listening: nothing may stake into a match while its predecessors are being voided.
  try {
    await chain.value.recover()
  } catch (error) {
    fail([`startup recovery could not list open matches: ${error instanceof Error ? error.message : String(error)}`])
  }
  options = { escrow: chain.value.escrow, wallets: chain.value.wallets }

  const { connection, buyIn } = chain.value
  const mint = config.value.mint
  const faucet = await openFaucet({
    env: process.env,
    mint,
    buyIn,
    connect: (key) => chainFaucet(connection, key, mint),
    logger: consoleLogger,
  })
  if (faucet.ok) {
    options.faucet = faucet.value
    consoleLogger('info', 'faucet on', { faucet: faucet.value.address })
  } else {
    consoleLogger('info', 'faucet off', { reason: faucet.error })
  }
} else if (process.env.FAUCET_ENABLED === 'true') {
  consoleLogger('warn', 'faucet off', { reason: 'the faucet needs ESCROW_MODE=chain' })
}

const server = createGameServer(options)

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

console.log(`reztor server listening on http://localhost:${port} (escrow: ${mode.value})`)
console.log(`dev client:  http://localhost:${port}/dev`)
