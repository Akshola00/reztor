import { pathToFileURL } from 'node:url'
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
type Board = { round: number; stage: 'tap' | 'chat' | 'vote'; lanes: Lane[]; players: Player[] }

type Ticket = { code: string; matchId: string; playerId: string; sessionToken: string; started: boolean }

export type BotOptions = {
  url: string
  name: string
  strategy: Strategy
  // Taps per second. The tap bucket sustains 6/sec, so anything above that is deliberately wasteful.
  rate: number
  jitter: number
  code?: string
  onLog?: (line: string) => void
}

export type BotStats = { taps: number; siphons: number; traces: number; votes: number; rejections: number }

export type Bot = {
  name: string
  code: string
  playerId: string
  isImpostor: boolean
  stats(): BotStats
  ended(): Promise<unknown>
  stop(): void
}

const jittered = (ms: number, jitter: number): number => ms * (1 + (Math.random() * 2 - 1) * jitter)
const pick = <T>(items: readonly T[]): T | undefined => items[Math.floor(Math.random() * items.length)]

async function ackOf<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  const response = (await socket.emitWithAck(event, payload)) as { ok: boolean; error?: string } & T
  if (!response.ok) throw new Error(`${event} failed: ${response.error ?? 'unknown'}`)
  return response
}

export async function createBot(options: BotOptions): Promise<Bot> {
  const { url, name, strategy, rate, jitter, onLog = () => {} } = options
  const stats: BotStats = { taps: 0, siphons: 0, traces: 0, votes: 0, rejections: 0 }

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

  const ticket = await (options.code === undefined
    ? ackOf<{ ticket: Ticket }>(socket, 'CREATE_LOBBY', { name })
    : ackOf<{ ticket: Ticket }>(socket, 'JOIN_LOBBY', { code: options.code, name }))
  const { matchId, playerId, sessionToken, code } = ticket.ticket

  let board: Board | null = null
  let isImpostor = false
  let tier: 1 | 2 = 1
  let tapsSent = 0
  let stageKey = ''
  let tracedInRound2 = false
  let running = true
  let resolveEnd: (value: unknown) => void = () => {}
  const ended = new Promise<unknown>((resolve) => {
    resolveEnd = resolve
  })

  socket.on('MATCH_STARTED', (message: { view: { you: { role: string } } }) => {
    // A bot cannot choose to be the impostor — the seed does. Whoever it lands on plays the
    // impostor script regardless of the strategy they were configured with.
    isImpostor = message.view.you.role === 'impostor'
    onLog(`${name} is ${isImpostor ? 'IMPOSTOR' : 'crew'}`)
  })
  socket.on('BOARD_UPDATE', (message: { board: Board }) => {
    board = message.board
  })
  socket.on('ACTION_REJECTED', (message: { action: string; code: string }) => {
    stats.rejections += 1
    onLog(`${name} rejected ${message.action}: ${message.code}`)
  })
  socket.on('MATCH_END', (message: unknown) => {
    running = false
    resolveEnd(message)
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

  const tap = (): void => {
    if (board === null || board.stage !== 'tap') return
    if (isImpostor && board.round > 1) return
    if (!wantsToTap(board.round)) return
    if (strategy === 'optimal') setTier(tapsSent < TIER_2_TAPS ? 2 : 1)
    socket.emit('TAP_BATCH', { tier, count: 1, clientTs: Date.now() })
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

  const otherLanes = (): Lane[] => (board?.lanes ?? []).filter((lane) => lane.owner !== playerId)
  const fullest = (lanes: Lane[]): Lane | undefined => [...lanes].sort((a, b) => b.units - a.units)[0]

  const sabotage = (): void => {
    if (!isImpostor || board === null || board.stage !== 'tap' || board.round < 2) return
    const targets = otherLanes().filter((lane) => !lane.dormant)
    const source = fullest(targets)
    if (source === undefined) return

    if (board.round === 2) {
      // Frame: move units from the fullest crew lane into another crew lane, so the beneficiary
      // surge points at someone who did nothing.
      const sink = fullest(targets.filter((lane) => lane.owner !== source.owner))
      if (sink !== undefined) {
        socket.emit('SIPHON', { source: source.owner, sink: sink.owner })
        stats.siphons += 1
      }
      if (!tracedInRound2) {
        tracedInRound2 = true
        const target = pick(targets)
        if (target !== undefined) {
          socket.emit('TRACE', { target: target.owner })
          stats.traces += 1
        }
      }
      return
    }

    // Round 3: sink into own lane. Costs double and looks terrible if traced, which is the point.
    socket.emit('SIPHON', { source: source.owner, sink: playerId })
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

  const stop = (): void => {
    running = false
    clearTimeout(timer)
    clearInterval(heartbeat)
    clearInterval(sabotageTimer)
    clearInterval(perStage)
    socket.disconnect()
  }

  void ended.then(stop)

  return {
    name,
    code,
    playerId,
    get isImpostor() {
      return isImpostor
    },
    stats: () => ({ ...stats }),
    ended: () => ended,
    stop,
  }
}

// ---- CLI ----------------------------------------------------------------------------------

const arg = (flag: string): string | undefined => {
  const found = process.argv.slice(2).find((entry) => entry.startsWith(`--${flag}=`))
  return found?.slice(flag.length + 3)
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

  console.log(`starting ${count} ${strategy} bot(s) at ${rate}/sec against ${url}`)
  const bots: Bot[] = []
  for (let index = 0; index < count; index++) {
    const bot = await createBot({
      url,
      name: `${strategy}-${index + 1}`,
      strategy,
      rate,
      jitter,
      ...(code === undefined ? {} : { code }),
      onLog: (line) => console.log(`  ${line}`),
    })
    // Without --code the first bot opens a lobby and the rest fill in behind it.
    code = bot.code
    bots.push(bot)
    console.log(`  ${bot.name} seated in lobby ${bot.code} as ${bot.playerId}`)
  }

  console.log(`lobby code: ${code}${count < 4 ? `  — ${4 - count} seat(s) left for a human` : ''}`)

  const end = await Promise.race(bots.map((bot) => bot.ended()))
  const summary = end as { reveal?: { resolution: { reason?: string }; impostorId: string } }
  console.log(`match over: ${summary.reveal?.resolution.reason ?? 'voided'}`)
  for (const bot of bots) {
    const { taps, siphons, traces, votes, rejections } = bot.stats()
    console.log(`  ${bot.name}: taps=${taps} siphons=${siphons} traces=${traces} votes=${votes} rejected=${rejections}`)
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
