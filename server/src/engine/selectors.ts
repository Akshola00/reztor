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
  voteHistory: { round: number; votes: Record<PlayerId, VoteTarget>; ejected: PlayerId | null }[]
  resolution: Resolution | null
}

export type PrivateView = PublicView & {
  you: { id: PlayerId; role: Side; credits: number; spent: number; tier: Tier; traceUsed: boolean }
  currentVote: VoteTarget | null
  traces: { tick: number; target: PlayerId; result: TraceResult }[]
  siphonActivity: { siphons: number; selfSinks: number; destroyed: number } | null
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
function revealCast(votes: VoteRound['votes']): Record<PlayerId, VoteTarget> {
  const revealed: Record<PlayerId, VoteTarget> = {}
  for (const [voter, record] of Object.entries(votes)) revealed[voter] = record.cast
  return revealed
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
    voteHistory: state.voteHistory.map(({ round, votes, ejected }) => ({ round, votes: revealCast(votes), ejected })),
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
  const siphonActivity = { siphons: 0, selfSinks: 0, destroyed: 0 }
  for (const event of state.eventLog) {
    if (event.type === 'TRACED' && event.playerId === playerId) {
      traces.push({ tick: event.tick, target: event.target, result: event.result })
    } else if (isImpostor && event.type === 'SIPHONED') {
      siphonActivity.siphons += 1
      if (event.sink === playerId) siphonActivity.selfSinks += 1
      siphonActivity.destroyed += event.destroyed
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
    siphonActivity: isImpostor ? siphonActivity : null,
  }
}
