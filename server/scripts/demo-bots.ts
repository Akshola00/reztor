// Demo day: three bots join a lobby a phone opened, play the whole match, and stop.
//
//   pnpm demo:bots --code ABCD
//
// See scripts/DEMO.md for the full sequence. Against the hosted server by default; --url for any
// other. Each bot plays a different strategy so the board looks like people, not a script: one taps
// hard, one taps and switches tier, one builds a lead in round 1 and sits on it. Whoever the server
// makes the Hollow drains instead, whatever its strategy.
//
// Options (all but --code optional):
//   --code ABCD          the lobby to join
//   --url URL            server (default https://reztor.onrender.com, or REZTOR_URL)
//   --names A,B,C        seat names (default Ash,Wren,Sable)
//   --rate N             taps per second (default 4; a fast thumb is 5-6)
//   --chat N             chat lines per Discuss stage, per bot (default 2)
//   --vote-delay MS      how long into a vote stage each bot waits to vote (default 4000)
//   --vote-for NAME      every bot votes for NAME ('skip' to skip) ...
//   --vote-from-round N  ... from round N on (default 1); before that, a random vote
//   --vote-plan FILE     lines of "round=NAME" or "round=skip", read at vote time, so it can be
//                        written mid-match once you know who the Hollow is; overrides --vote-for
//   --keys a.json,b,c    wallet key files, one per bot (default the contract's test players 0-2)
//   --rpc URL            devnet RPC for staking (default https://api.devnet.solana.com, or RPC_URL)
//
// Ctrl-C stops every bot and closes its socket.
import { existsSync, readFileSync } from 'node:fs'
import { Keypair } from '@solana/web3.js'
import { createBot, type Bot, type Strategy } from '../src/sim/bot.js'

const DEFAULT_URL = 'https://reztor.onrender.com'
const STRATEGIES: Strategy[] = ['masher', 'optimal', 'conserver']
const SETTLEMENT_WAIT_MS = 120_000

const arg = (flag: string): string | undefined => {
  const args = process.argv.slice(2)
  const index = args.findIndex((entry) => entry === `--${flag}` || entry.startsWith(`--${flag}=`))
  const found = args[index]
  if (found === undefined) return undefined
  return found === `--${flag}` ? args[index + 1] : found.slice(flag.length + 3)
}

function keys(): Keypair[] | undefined {
  const named = arg('keys') ?? (process.env.BOT_KEYS || undefined)
  const files =
    named?.split(',') ??
    [0, 1, 2].map((i) => new URL(`../../contract/scripts/keys/player-${i}.json`, import.meta.url).pathname)
  if (named === undefined && !files.every((file) => existsSync(file))) return undefined
  return files
    .slice(0, 3)
    .map((file) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8')) as number[])))
}

function voteChooser(): ((round: number) => string | undefined) | undefined {
  const plan = arg('vote-plan')
  const name = arg('vote-for')
  const fromRound = Number(arg('vote-from-round') ?? 1)
  if (plan === undefined && name === undefined) return undefined
  return (round) => {
    if (plan !== undefined && existsSync(plan)) {
      const line = readFileSync(plan, 'utf8')
        .split('\n')
        .map((l) => l.trim().split('='))
        .find(([r]) => Number(r) === round)
      if (line?.[1] !== undefined) return line[1]
    }
    return name !== undefined && round >= fromRound ? name : undefined
  }
}

async function main(): Promise<void> {
  const code = arg('code')?.toUpperCase()
  if (code === undefined) {
    console.error('usage: pnpm demo:bots --code ABCD   (the code the phone shows in the lobby)')
    process.exit(1)
  }
  const url = arg('url') ?? process.env.REZTOR_URL ?? DEFAULT_URL
  const names = (arg('names') ?? 'Ash,Wren,Sable').split(',')
  const rpcUrl = arg('rpc') ?? process.env.RPC_URL ?? 'https://api.devnet.solana.com'
  const wallets = keys()
  const voteFor = voteChooser()

  console.log(`joining ${code} on ${url}`)
  if (wallets === undefined) console.log('  no key files: bots send no wallet, which only a fake-escrow server accepts')

  const bots: Bot[] = []
  const stopAll = (): void => {
    for (const bot of bots) bot.stop()
  }
  process.on('SIGINT', () => {
    console.log('\nstopping bots')
    stopAll()
    process.exit(0)
  })

  for (const [index, strategy] of STRATEGIES.entries()) {
    const bot = await createBot({
      url,
      name: names[index] ?? `${strategy}-${index + 1}`,
      strategy,
      rate: Number(arg('rate') ?? 4),
      jitter: 0.3,
      code,
      chatPerStage: Number(arg('chat') ?? 2),
      voteDelayMs: Number(arg('vote-delay') ?? 4000),
      ...(voteFor === undefined ? {} : { voteFor }),
      ...(wallets?.[index] === undefined ? {} : { keypair: wallets[index], rpcUrl }),
      onLog: (line) => console.log(`  ${line}`),
    })
    bots.push(bot)
    console.log(`  ${bot.name} seated (${strategy})`)
  }
  console.log('all three seated. Stake on the phone when it asks; the match starts once all four have staked.')

  const end = (await Promise.race(bots.map((bot) => bot.ended()))) as {
    reveal?: { resolution: { reason?: string } }
    reason?: string
    disconnected?: string
  }
  if (end.disconnected !== undefined) console.log(`server went away: ${end.disconnected}`)
  else if (end.reveal === undefined) console.log(`lobby dissolved: ${end.reason ?? 'unknown'}`)
  else {
    console.log(`match over: ${end.reveal.resolution.reason ?? 'voided'}`)
    if (wallets !== undefined && bots[0] !== undefined) {
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), SETTLEMENT_WAIT_MS))
      const confirmed = (await Promise.race([bots[0].settlement(), timeout])) as { signature: string } | null
      console.log(
        confirmed === null
          ? `no settlement confirmation within ${SETTLEMENT_WAIT_MS / 1000}s`
          : `paid on-chain: https://explorer.solana.com/tx/${confirmed.signature}?cluster=devnet`,
      )
    }
  }
  for (const bot of bots) {
    const { taps, siphons, votes, rejections } = bot.stats()
    const refused = Object.entries(rejections)
      .map(([c, n]) => `${c}:${n}`)
      .join(' ')
    console.log(`  ${bot.name}${bot.isImpostor ? ' (Hollow)' : ''}: taps=${taps} drains=${siphons} votes=${votes} rejected=${refused || 'none'}`)
  }
  stopAll()
  process.exit(0)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
