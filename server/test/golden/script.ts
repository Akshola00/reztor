import type { Intent } from '../../src/engine/events.js'
import type { MatchEndView } from '../../src/engine/selectors.js'
import type { Settlement, SettlementLine } from '../../src/engine/settlement.js'
import type { MatchState, PlayerId, PlayerStatus, Resolution, Side, VoteTarget } from '../../src/engine/state.js'
import type { Scenario } from '../../src/sim/replay.js'
import { matchStarted, SEED } from '../helpers/fixtures.js'

// p2 is the impostor for the fixture seed; p1, p3 and p4 are crew.
export const IMPOSTOR = 'p2'
export const CREW = ['p1', 'p3', 'p4'] as const
export const EVERYONE = ['p1', 'p2', 'p3', 'p4'] as const

// Tapping once per tick is exactly the spec §11 balance assumption of 4 taps per second, and never
// touches the 6-per-second clamp. Each tap stage admits it on 240 ticks.
export const tapOwn = (playerId: PlayerId): Intent => ({ kind: 'TAP_BATCH', playerId, count: 1 })
export const tapInto = (playerId: PlayerId, lane: PlayerId): Intent => ({ kind: 'TAP_BATCH', playerId, count: 1, lane })
export const siphon = (source: PlayerId, sink: PlayerId): Intent => ({ kind: 'SIPHON', playerId: IMPOSTOR, source, sink })
export const castVote = (playerId: PlayerId, target: VoteTarget): Intent => ({ kind: 'VOTE', playerId, target })
export const isAlive = (state: MatchState, id: PlayerId): boolean => state.players[id]?.status === 'alive'

export type GoldenExpectation = {
  rejections: { tick: number; action: Intent['kind']; code: string }[]
  resolution: Resolution
  boardTotal: number
  settlement: Settlement
  matchEnd: MatchEndView
}

export type Golden = { scenario: Scenario; expected: GoldenExpectation }

export const start = (matchId: string): Scenario['started'] => ({ ...matchStarted(), matchId })

export const LAST_TICK = 1440

export const endPlayer = (
  id: PlayerId,
  status: PlayerStatus,
  creditsSpent: number,
  unitsContributed: number,
  finalLane: number,
): MatchEndView['players'][number] => ({
  id,
  name: `Player ${id}`,
  role: (id === IMPOSTOR ? 'impostor' : 'crew') satisfies Side,
  status,
  creditsSpent,
  unitsContributed,
  finalLane,
})

export const board = (total: number): MatchEndView['board'] => ({
  total,
  capacity: 4000,
  winTarget: 2400,
  basisPoints: Math.floor((total * 10_000) / 4000),
})

export const pay = (playerId: PlayerId, spent: number, refund: number, payout: number): SettlementLine => ({
  playerId,
  spent,
  refund,
  payout,
})

export const common = (matchId: string) => ({ matchId, impostorId: IMPOSTOR, roleSeed: SEED })
