import type { MatchConfig, Tier } from './config.js'
import type {
  ChatMessage,
  MatchPhase,
  MatchState,
  PlayerId,
  PlayerStatus,
  Resolution,
  Side,
  Stage,
  TraceResult,
  VoteRound,
  VoteTarget,
} from './state.js'

export type PublicView = {
  matchId: string
  config: MatchConfig
  phase: MatchPhase
  round: number
  stage: Stage
  stageEndsAtTick: number
  lanes: { owner: PlayerId; units: number; dormant: boolean }[]
  boardTotal: number
  players: { id: PlayerId; name: string; status: PlayerStatus }[]
  chat: ChatMessage[]
  voteHistory: RevealedVoteRound[]
  resolution: Resolution | null
}

export type RevealedVoteRound = { round: number; votes: Record<PlayerId, VoteTarget>; ejected: PlayerId | null }

export type SiphonActivity = { siphons: number; selfSinks: number; destroyed: number }

export type PrivateView = PublicView & {
  you: { id: PlayerId; role: Side; credits: number; spent: number; tier: Tier; traceUsed: boolean }
  currentVote: VoteTarget | null
  traces: { tick: number; target: PlayerId; result: TraceResult }[]
  siphonActivity: SiphonActivity | null
}

// Spec §15: everything, once the match is over.
export type MatchEndView = {
  matchId: string
  resolution: Resolution
  impostorId: PlayerId
  roleSeed: string
  // Percentage as integer basis points (6375 = 63.75%) so the engine stays float-free.
  board: { total: number; capacity: number; winTarget: number; basisPoints: number }
  players: {
    id: PlayerId
    name: string
    role: Side
    status: PlayerStatus
    creditsSpent: number
    unitsContributed: number
    finalLane: number
  }[]
  impostor: { unitsDestroyed: number; siphons: number; selfSinks: number }
  traces: { round: number; tick: number; purchaser: PlayerId; target: PlayerId; result: TraceResult }[]
  voteHistory: RevealedVoteRound[]
}

function sortedById<T>(record: Record<PlayerId, T>): T[] {
  return Object.keys(record)
    .sort()
    .flatMap((id) => {
      const value = record[id]
      return value === undefined ? [] : [value]
    })
}

// CLAUDE.md §5.5: the reveal shows what each player cast, never the tallied `counted` value.
function revealVotes(history: readonly VoteRound[]): RevealedVoteRound[] {
  return history.map(({ round, votes, ejected }) => {
    const revealed: Record<PlayerId, VoteTarget> = {}
    for (const [voter, record] of Object.entries(votes)) revealed[voter] = record.cast
    return { round, votes: revealed, ejected }
  })
}

function siphonActivity(state: MatchState): SiphonActivity {
  const activity = { siphons: 0, selfSinks: 0, destroyed: 0 }
  for (const event of state.eventLog) {
    if (event.type !== 'SIPHONED') continue
    activity.siphons += 1
    if (event.sink === event.playerId) activity.selfSinks += 1
    activity.destroyed += event.destroyed
  }
  return activity
}

// What every player sees, live (spec §6). Built field by field from public state only: it never
// reads the event log, roles, the seed, credits, tiers, lane deltas, or votes still open.
export function publicView(state: MatchState): PublicView {
  const lanes = sortedById(state.lanes).map(({ owner, units, dormant }) => ({ owner, units, dormant }))
  return {
    matchId: state.matchId,
    config: state.config,
    phase: state.phase,
    round: state.round,
    stage: state.stage,
    stageEndsAtTick: state.stageEndsAtTick,
    lanes,
    boardTotal: lanes.reduce((sum, lane) => sum + lane.units, 0),
    players: sortedById(state.players).map(({ id, name, status }) => ({ id, name, status })),
    chat: state.chat,
    voteHistory: revealVotes(state.voteHistory),
    resolution: state.resolution,
  }
}

// The public view plus what only `playerId` may see (spec §6). Siphon events are read for the
// impostor alone; a crew member's view never looks at them.
export function privateView(state: MatchState, playerId: PlayerId): PrivateView | null {
  const player = state.players[playerId]
  if (player === undefined) return null
  const isImpostor = playerId === state.impostorId

  const traces: PrivateView['traces'] = []
  for (const event of state.eventLog) {
    if (event.type === 'TRACED' && event.playerId === playerId) {
      traces.push({ tick: event.tick, target: event.target, result: event.result })
    }
  }

  return {
    ...publicView(state),
    you: {
      id: player.id,
      role: isImpostor ? 'impostor' : 'crew',
      credits: player.credits,
      spent: player.spent,
      tier: player.tier,
      traceUsed: player.traceUsed,
    },
    // Votes persist in state after their stage closes; only an open vote is the player's current one.
    currentVote: state.stage === 'vote' ? (state.votes[playerId] ?? null) : null,
    traces,
    siphonActivity: isImpostor ? siphonActivity(state) : null,
  }
}

// The post-match reveal (spec §15). Null until the match resolves, then hides nothing.
export function matchEndView(state: MatchState): MatchEndView | null {
  const { resolution, config } = state
  if (resolution === null) return null

  const total = Object.values(state.lanes).reduce((sum, lane) => sum + lane.units, 0)
  const capacity = config.laneCapacity * Object.keys(state.lanes).length

  const traces: MatchEndView['traces'] = []
  let round = 1
  for (const event of state.eventLog) {
    if (event.type === 'STAGE_ADVANCED') round = event.round
    else if (event.type === 'TRACED') {
      traces.push({ round, tick: event.tick, purchaser: event.playerId, target: event.target, result: event.result })
    }
  }
  const { siphons, selfSinks, destroyed } = siphonActivity(state)

  return {
    matchId: state.matchId,
    resolution,
    impostorId: state.impostorId,
    roleSeed: state.roleSeed,
    board: {
      total,
      capacity,
      winTarget: config.winTarget,
      basisPoints: capacity === 0 ? 0 : Math.floor((total * 10_000) / capacity),
    },
    players: sortedById(state.players).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.id === state.impostorId ? 'impostor' : 'crew',
      status: p.status,
      creditsSpent: p.spent,
      unitsContributed: p.unitsTapped,
      finalLane: state.lanes[p.id]?.units ?? 0,
    })),
    impostor: { unitsDestroyed: destroyed, siphons, selfSinks },
    traces,
    voteHistory: revealVotes(state.voteHistory),
  }
}
