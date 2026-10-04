import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Connection, Keypair, Transaction } from '@solana/web3.js'
import { io as connect, type Socket } from 'socket.io-client'

// A bot is a real Socket.IO client over a real port. Nothing here reaches into the server: if a
// bot can play, a phone can play, and anything that breaks here breaks in net/ rather than in a
// test harness.

export type Strategy = 'masher' | 'optimal' | 'conserver' | 'impostor'

// CLAUDE.md §12.1: 196 tier-2 taps then tier 1 spends exactly 1200 credits for 1004 units.
const TIER_2_TAPS = 196

const CHAT_LINES = [
  'my lane is clean, look at the deltas',
  'someone drained me last round',
  'traced and it came back received. explain that',
  'quiet round. too quiet',
  'I am not voting for whoever asks loudest',
]

const SKIP_VOTE_CHANCE = 0.3

type Lane = { owner: string; units: number; dormant: boolean }
type Player = { id: string; name: string; status: 'alive' | 'disconnected' | 'ejected' }
type Board = {
  round: number
  stage: 'tap' | 'chat' | 'vote'
  secondsLeft: number
  lanes: Lane[]
  players: Player[]
}

// Credits the impostor holds back during round 2 so round 3 can still be spent on self-sinks.
// 25 sinks at 12 credits: enough to be read as a pattern, not so much that framing is skipped.
const SELF_SINK_RESERVE = 25 * 12
const TAP_COST = { 1: 1, 2: 4 } as const
const TRACE_COST = 200

type Ticket = { code: string; matchId: string; playerId: string; sessionToken: string; started: boolean }

export type BotOptions = {
  url: string
  name: string
  strategy: Strategy
  // Taps per second. The tap bucket sustains 6/sec, so anything above that is deliberately wasteful.
  rate: number
  jitter: number
  code?: string
  // Chain mode: the bot sits down with this wallet and signs its STAKE_REQUEST, sending it through
  // rpcUrl. Without one it sends no wallet, which only a fake-escrow server accepts.
  keypair?: Keypair
  rpcUrl?: string
  // Ignore the STAKE_REQUEST, to let the funding stage time out.
  refuseStake?: boolean
  onLog?: (line: string) => void
}

export type BotStats = {
  taps: number
  siphons: number
  traces: number
  votes: number
  // By rejection code: a bot driver whose rejections are not near zero is noise, not a signal.
  rejections: Record<string, number>
}

export type Bot = {
  name: string
  code: string
  playerId: string
  isImpostor: boolean
  stats(): BotStats
  // MATCH_END, LOBBY_DISSOLVED, or { disconnected } if the server went away first.
  ended(): Promise<unknown>
  // SETTLEMENT_CONFIRMED, chain mode only.
  settlement(): Promise<unknown>
  stop(): void
}

const jittered = (ms: number, jitter: number): number => ms * (1 + (Math.random() * 2 - 1) * jitter)
const pick = <T>(items: readonly T[]): T | undefined => items[Math.floor(Math.random() * items.length)]

async function ackOf<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  const response = (await socket.emitWithAck(event, payload)) as { ok: boolean; error?: string } & T
  if (!response.ok) throw new Error(`${event} failed: ${response.error ?? 'unknown'}`)
  return response
}

const explorer = (signature: string): string => `https://explorer.solana.com/tx/${signature}?cluster=devnet`

export async function createBot(options: BotOptions): Promise<Bot> {
  const { url, name, strategy, rate, jitter, keypair, onLog = () => {} } = options
  const stats: BotStats = { taps: 0, siphons: 0, traces: 0, votes: 0, rejections: {} }

  // No reconnection: a bot driver pointed at a dead port should say so immediately rather than
  // retry in the background while engine.io prints stack traces over the output.
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false })
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('connect_error', () => {
      socket.close()
      reject(new Error(`could not connect to ${url} — is the server running? (pnpm serve)`))
    })
  })

  const seat = keypair === undefined ? { name } : { name, wallet: keypair.publicKey.toBase58() }
  const ticket = await (options.code === undefined
    ? ackOf<{ ticket: Ticket }>(socket, 'CREATE_LOBBY', seat)
    : ackOf<{ ticket: Ticket }>(socket, 'JOIN_LOBBY', { code: options.code, ...seat }))
  const { matchId, playerId, sessionToken, code } = ticket.ticket

  let board: Board | null = null
  let isImpostor = false
  let tier: 1 | 2 = 1
  let tapsSent = 0
  let stageKey = ''
  let tracedInRound2 = false
  let credits = 0
  // Costs emitted since the last CREDITS frame. Subtracting them is conservative — an action the
  // server has already charged for is counted twice until the next frame — and under-spending by a
  // few credits is the right way to be wrong when the point is to keep rejections at zero.
  let pending = 0
  let running = true
  let stopping = false
  let resolveEnd: (value: unknown) => void = () => {}
  const ended = new Promise<unknown>((resolve) => {
    resolveEnd = resolve
  })
  let resolveSettlement: (value: unknown) => void = () => {}
  const settlement = new Promise<unknown>((resolve) => {
    resolveSettlement = resolve
  })

  // Signs exactly what the server built, as the app's wallet would, and sends it. The server
  // watches the chain for the payment, so nothing goes back over the socket.
  const stake = async (base64: string): Promise<void> => {
    if (keypair === undefined) return onLog(`${name} got a STAKE_REQUEST but has no keypair`)
    try {
      const tx = Transaction.from(Buffer.from(base64, 'base64'))
      tx.sign(keypair)
      const connection = new Connection(options.rpcUrl ?? 'https://api.devnet.solana.com', 'confirmed')
      const signature = await connection.sendRawTransaction(tx.serialize())
      onLog(`${name} staked: ${explorer(signature)}`)
    } catch (error) {
      onLog(`${name} stake failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  socket.on('MATCH_STARTED', (message: { view: { you: { role: string; credits: number } } }) => {
    // A bot cannot choose to be the impostor — the seed does. Whoever it lands on plays the
    // impostor script regardless of the strategy they were configured with.
    isImpostor = message.view.you.role === 'impostor'
    credits = message.view.you.credits
    onLog(`${name} is ${isImpostor ? 'IMPOSTOR' : 'crew'}`)
  })
  socket.on('BOARD_UPDATE', (message: { board: Board }) => {
    board = message.board
  })
  // The server's number is authoritative and arrives after every accepted action, which also
  // clears whatever was in flight when it was computed.
  socket.on('CREDITS', (message: { credits: number }) => {
    credits = message.credits
    pending = 0
  })
  socket.on('ACTION_REJECTED', (message: { action: string; code: string }) => {
    stats.rejections[message.code] = (stats.rejections[message.code] ?? 0) + 1
    onLog(`${name} rejected ${message.action}: ${message.code}`)
  })
  socket.on('MATCH_END', (message: unknown) => {
    running = false
    resolveEnd(message)
  })
  socket.on('STAKE_REQUEST', (message: { tx: string }) => {
    if (options.refuseStake === true) return onLog(`${name} ignores its STAKE_REQUEST (--refuse-stake)`)
    void stake(message.tx)
  })
  socket.on('STAKE_UPDATE', (message: { staked: number[] }) => onLog(`${name} sees staked seats [${message.staked.join(', ')}]`))
  socket.on('SETTLEMENT_CONFIRMED', (message: unknown) => resolveSettlement(message))
  socket.on('LOBBY_DISSOLVED', (message: unknown) => {
    running = false
    resolveEnd(message)
  })
  socket.on('disconnect', (reason) => {
    running = false
    if (!stopping) resolveEnd({ disconnected: reason })
  })

  await ackOf(socket, 'JOIN', { matchId, sessionToken })

  const heartbeat = setInterval(() => socket.emit('HEARTBEAT', {}), 2000)

  const setTier = (next: 1 | 2): void => {
    if (tier === next) return
    tier = next
    socket.emit('SET_TIER', { tier: next })
  }

  const wantsToTap = (round: number): boolean => {
    switch (strategy) {
      case 'masher':
      case 'optimal':
        return true
      // The §6 honest-player trap: builds a lane in round 1 then sits on it.
      case 'conserver':
        return round === 1
      // Cover in round 1 only; rounds 2 and 3 are spent on sabotage.
      case 'impostor':
        return round === 1
    }
  }

  const affordable = (cost: number, reserve = 0): boolean => credits - pending - reserve >= cost

  const tap = (): void => {
    if (board === null || board.stage !== 'tap' || board.secondsLeft <= 0) return
    if (isImpostor && board.round > 1) return
    if (!wantsToTap(board.round)) return
    if (strategy === 'optimal') setTier(tapsSent < TIER_2_TAPS ? 2 : 1)
    // Stop when broke rather than sending batches the server can only refuse.
    const cost = TAP_COST[tier]
    if (!affordable(cost)) return
    socket.emit('TAP_BATCH', { tier, count: 1, clientTs: Date.now() })
    pending += cost
    tapsSent += 1
    stats.taps += 1
  }

  // Own timer rather than one tap per board frame, so --rate means taps per second and jitter
  // makes the arrival pattern look like a thumb instead of a metronome.
  const tapTimer = (): NodeJS.Timeout =>
    setTimeout(() => {
      if (!running) return
      tap()
      timer = tapTimer()
    }, jittered(1000 / rate, jitter))
  let timer = tapTimer()

  // MVP_CONFIG siphon costs. The bot only needs them to avoid overspending; the server charges.
  const costOther = 6
  const costSelf = 12

  const otherLanes = (): Lane[] => (board?.lanes ?? []).filter((lane) => lane.owner !== playerId)
  const fullest = (lanes: Lane[]): Lane | undefined => [...lanes].sort((a, b) => b.units - a.units)[0]

  const sabotage = (): void => {
    if (!isImpostor || board === null || board.stage !== 'tap' || board.round < 2) return
    if (board.secondsLeft <= 0) return
    const targets = otherLanes().filter((lane) => !lane.dormant)
    const source = fullest(targets)
    if (source === undefined) return

    if (board.round === 2) {
      // Round 2 spends down to the reserve and no further, so round 3 still has self-sinks to make.
      if (!tracedInRound2 && affordable(TRACE_COST, SELF_SINK_RESERVE)) {
        tracedInRound2 = true
        const target = pick(targets)
        if (target !== undefined) {
          socket.emit('TRACE', { target: target.owner })
          pending += TRACE_COST
          stats.traces += 1
        }
        return
      }
      // Frame: move units from the fullest crew lane into another crew lane, so the beneficiary
      // surge points at someone who did nothing.
      const sink = fullest(targets.filter((lane) => lane.owner !== source.owner))
      if (sink !== undefined && affordable(costOther, SELF_SINK_RESERVE)) {
        socket.emit('SIPHON', { source: source.owner, sink: sink.owner })
        pending += costOther
        stats.siphons += 1
      }
      return
    }

    // Round 3: sink into own lane. Costs double and looks terrible if traced, which is the point.
    if (!affordable(costSelf)) return
    socket.emit('SIPHON', { source: source.owner, sink: playerId })
    pending += costSelf
    stats.siphons += 1
  }

  // The siphon bucket sustains 4/sec, so this paces just under it.
  const sabotageTimer = setInterval(sabotage, 280)

  // Chat once per chat stage, vote once per vote stage.
  const perStage = setInterval(() => {
    if (board === null || !running) return
    const key = `${board.round}:${board.stage}`
    if (key === stageKey) return
    stageKey = key

    if (board.stage === 'chat') {
      socket.emit('CHAT', { text: pick(CHAT_LINES) ?? 'nothing to add' })
      return
    }
    if (board.stage !== 'vote') return

    const living = board.players.filter((player) => player.status !== 'ejected')
    const target = Math.random() < SKIP_VOTE_CHANCE ? 'skip' : (pick(living)?.id ?? 'skip')
    socket.emit('VOTE', { target })
    stats.votes += 1
  }, 200)

  const stopPlaying = (): void => {
    running = false
    clearTimeout(timer)
    clearInterval(heartbeat)
    clearInterval(sabotageTimer)
    clearInterval(perStage)
  }

  const stop = (): void => {
    stopping = true
    stopPlaying()
    socket.disconnect()
  }

  // The socket stays open after the match so SETTLEMENT_CONFIRMED can still arrive; stop() closes it.
  void ended.then(stopPlaying)

  return {
    name,
    code,
    playerId,
    get isImpostor() {
      return isImpostor
    },
    stats: () => ({ ...stats }),
    ended: () => ended,
    settlement: () => settlement,
    stop,
  }
}

// ---- CLI ----------------------------------------------------------------------------------

// --flag=value or --flag value.
const arg = (flag: string): string | undefined => {
  const args = process.argv.slice(2)
  const index = args.findIndex((entry) => entry === `--${flag}` || entry.startsWith(`--${flag}=`))
  const found = args[index]
  if (found === undefined) return undefined
  return found === `--${flag}` ? args[index + 1] : found.slice(flag.length + 3)
}

const DEFAULT_KEY = (index: number): string => new URL(`../../../contract/scripts/keys/player-${index}.json`, import.meta.url).pathname
const SETTLEMENT_WAIT_MS = 120_000

// --keys / BOT_KEYS name the files, comma-separated, one per bot. Without them the contract's test
// players are used when all of them exist, and otherwise the bots run keyless for a fake server.
function botKeys(count: number): Keypair[] | undefined {
  const named = arg('keys') ?? (process.env.BOT_KEYS || undefined)
  const files = named === undefined ? Array.from({ length: count }, (_, index) => DEFAULT_KEY(index)) : named.split(',')
  if (named === undefined && !files.every((file) => existsSync(file))) return undefined
  if (files.length < count) throw new Error(`${count} bots need ${count} key files, got ${files.length}`)
  return files
    .slice(0, count)
    .map((file) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8')) as number[])))
}

const STRATEGIES: Strategy[] = ['masher', 'optimal', 'conserver', 'impostor']

async function main(): Promise<void> {
  const strategy = (arg('strategy') ?? 'masher') as Strategy
  if (!STRATEGIES.includes(strategy)) {
    console.error(`Unknown strategy "${strategy}". One of: ${STRATEGIES.join(', ')}`)
    process.exit(1)
  }

  const url = arg('url') ?? 'http://localhost:3000'
  const count = Number(arg('count') ?? 3)
  const rate = Number(arg('rate') ?? 4)
  const jitter = Number(arg('jitter') ?? 0.25)
  let code = arg('code')
  const rpcUrl = arg('rpc') ?? process.env.RPC_URL ?? 'https://api.devnet.solana.com'
  // Bot indices from 0, as the key files are numbered. Comma-separated for more than one.
  const refusing = (arg('refuse-stake') ?? '').split(',').filter((entry) => entry !== '').map(Number)
  const keys = botKeys(count)

  console.log(`starting ${count} ${strategy} bot(s) at ${rate}/sec against ${url}`)
  if (keys === undefined) console.log('  no keys: bots send no wallet (fake escrow only)')
  else keys.forEach((key, index) => console.log(`  bot ${index} wallet ${key.publicKey.toBase58()}${refusing.includes(index) ? ' (refuses to stake)' : ''}`))
  const bots: Bot[] = []
  for (let index = 0; index < count; index++) {
    const bot = await createBot({
      url,
      name: `${strategy}-${index + 1}`,
      strategy,
      rate,
      jitter,
      ...(code === undefined ? {} : { code }),
      ...(keys?.[index] === undefined ? {} : { keypair: keys[index], rpcUrl }),
      refuseStake: refusing.includes(index),
      onLog: (line) => console.log(`  ${line}`),
    })
    // Without --code the first bot opens a lobby and the rest fill in behind it.
    code = bot.code
    bots.push(bot)
    console.log(`  ${bot.name} seated in lobby ${bot.code} as ${bot.playerId}`)
  }

  console.log(`lobby code: ${code}${count < 4 ? `  — ${4 - count} seat(s) left for a human` : ''}`)

  const end = await Promise.race(bots.map((bot) => bot.ended()))
  const summary = end as { reveal?: { resolution: { reason?: string }; impostorId: string }; reason?: string; disconnected?: string }
  if (summary.disconnected !== undefined) console.log(`server went away: ${summary.disconnected}`)
  else if (summary.reveal === undefined && summary.reason !== undefined) console.log(`lobby dissolved: ${summary.reason}`)
  else console.log(`match over: ${summary.reveal?.resolution.reason ?? 'voided'}`)
  const lines = (end as { settlement?: { lines: { playerId: string; refund: number; payout: number }[] } }).settlement?.lines
  for (const [seat, line] of (lines ?? []).entries()) {
    console.log(`  seat ${seat + 1} ${line.playerId}: refund ${line.refund} + payout ${line.payout} credits`)
  }
  if (keys !== undefined && summary.reveal !== undefined && bots[0] !== undefined) {
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), SETTLEMENT_WAIT_MS))
    const confirmed = (await Promise.race([bots[0].settlement(), timeout])) as { signature: string; payouts: string[] } | null
    if (confirmed === null) console.log(`no SETTLEMENT_CONFIRMED within ${SETTLEMENT_WAIT_MS / 1000}s`)
    else console.log(`settlement confirmed: ${explorer(confirmed.signature)}  payouts ${confirmed.payouts.join(' ')}`)
  }
  for (const bot of bots) {
    const { taps, siphons, traces, votes, rejections } = bot.stats()
    const refused = Object.entries(rejections)
      .map(([code, n]) => `${code}:${n}`)
      .join(' ')
    console.log(
      `  ${bot.name}: taps=${taps} siphons=${siphons} traces=${traces} votes=${votes} rejected=${refused || 'none'}`,
    )
  }
  for (const bot of bots) bot.stop()
  process.exit(0)
}

// Only run the CLI when this file is the entry point, so the soak test can import createBot.
const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
