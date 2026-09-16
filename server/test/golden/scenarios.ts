import type { Intent } from '../../src/engine/events.js'
import type { MatchState } from '../../src/engine/state.js'
import {
  CREW,
  EVERYONE,
  IMPOSTOR,
  LAST_TICK,
  board,
  castVote,
  common,
  endPlayer,
  isAlive,
  pay,
  siphon,
  start,
  tapInto,
  tapOwn,
  type Golden,
} from './script.js'

const ROUND_TICKS = 480
const skipAll = { p1: 'skip', p2: 'skip', p3: 'skip', p4: 'skip' }

// True for the first `n` ticks of the current round's tap stage. Only "crew board win" runs a full
// match; every other scenario taps for a few ticks, just enough to drive its rule path.
const tapping = (state: MatchState, tick: number, n: number): boolean =>
  state.stage === 'tap' && tick - (state.round - 1) * ROUND_TICKS <= n

// The one full-length record: rounds 1–2 crew tap 240 each (1440). p1 traces the idle impostor in
// round 2 (natural, −200). Round 3 the crew switch to tier 2, +9 per tick; after 106 ticks the
// board is 2394, and on tick 1067 p1 takes it to 2397 and p3 to 2400, which latches the win, so
// p4's tap in that same tick is MATCH_OVER. Pot 1108 + 908 + 904 = 2920 → 973 each, 1 dust.
const crewBoardWin: Golden = {
  scenario: {
    name: 'crew-board-win',
    started: start('crew-board-win'),
    lastTick: LAST_TICK,
    intentsAt: (tick, state) => {
      if (state.stage !== 'tap') return []
      const intents: Intent[] = []
      if (tick === 481) intents.push({ kind: 'TRACE', playerId: 'p1', target: IMPOSTOR })
      if (tick === 961) for (const id of CREW) intents.push({ kind: 'SET_TIER', playerId: id, tier: 2 })
      for (const id of CREW) intents.push(tapOwn(id))
      return intents
    },
  },
  expected: {
    rejections: [{ tick: 1067, action: 'TAP_BATCH', code: 'MATCH_OVER' }],
    resolution: { kind: 'won', winner: 'crew', reason: 'BOARD_TARGET', tick: 1067 },
    boardTotal: 2400,
    settlement: {
      matchId: 'crew-board-win',
      resolution: { kind: 'won', winner: 'crew', reason: 'BOARD_TARGET', tick: 1067 },
      escrowCredits: 4800,
      potCredits: 2920,
      rakeBps: 0,
      rakeCredits: 0,
      dustCredits: 1,
      winners: ['p1', 'p3', 'p4'],
      lines: [pay('p1', 1108, 92, 973), pay('p2', 0, 1200, 0), pay('p3', 908, 292, 973), pay('p4', 904, 296, 973)],
    },
    matchEnd: {
      ...common('crew-board-win'),
      resolution: { kind: 'won', winner: 'crew', reason: 'BOARD_TARGET', tick: 1067 },
      board: board(2400),
      players: [
        endPlayer('p1', 'alive', 1108, 801, 801),
        endPlayer('p2', 'alive', 0, 0, 0),
        endPlayer('p3', 'alive', 908, 801, 801),
        endPlayer('p4', 'alive', 904, 798, 798),
      ],
      impostor: { unitsDestroyed: 0, siphons: 0, selfSinks: 0 },
      traces: [{ round: 2, tick: 481, purchaser: 'p1', target: IMPOSTOR, result: 'natural' }],
      voteHistory: [
        { round: 1, votes: skipAll, ejected: null },
        { round: 2, votes: skipAll, ejected: null },
      ],
    },
  },
}

// Round 1: crew tap 30 each while the impostor frames p1→p3 on ticks 10, 20 and 30 — p1 has
// exactly 10 to give each time, the source floor's boundary, and ends the round at 0 with
// natural 30 = drained 30. Round 2: p4's trace on p1 reads that tie as drained, and the impostor
// self-sinks p3→p2. Three crew vote the impostor out. Pot 320 → 106 each, 2 dust.
const crewEjectionWin: Golden = {
  scenario: {
    name: 'crew-ejection-win',
    started: start('crew-ejection-win'),
    lastTick: LAST_TICK,
    intentsAt: (tick, state) => {
      const intents: Intent[] = []
      if (state.round === 1 && tapping(state, tick, 30)) {
        for (const id of CREW) intents.push(tapOwn(id))
        if (tick % 10 === 0) intents.push(siphon('p1', 'p3'))
      }
      if (tick === 481) intents.push({ kind: 'TRACE', playerId: 'p4', target: 'p1' })
      if (tick === 482) intents.push(siphon('p3', IMPOSTOR))
      if (tick === 901) {
        intents.push(castVote('p1', IMPOSTOR), castVote('p3', IMPOSTOR), castVote('p4', IMPOSTOR), castVote(IMPOSTOR, 'p1'))
      }
      return intents
    },
  },
  expected: {
    rejections: [],
    resolution: { kind: 'won', winner: 'crew', reason: 'IMPOSTOR_EJECTED', tick: 960 },
    boardTotal: 74,
    settlement: {
      matchId: 'crew-ejection-win',
      resolution: { kind: 'won', winner: 'crew', reason: 'IMPOSTOR_EJECTED', tick: 960 },
      escrowCredits: 4800,
      potCredits: 320,
      rakeBps: 0,
      rakeCredits: 0,
      dustCredits: 2,
      winners: ['p1', 'p3', 'p4'],
      lines: [pay('p1', 30, 1170, 106), pay('p2', 30, 1170, 0), pay('p3', 30, 1170, 106), pay('p4', 230, 970, 106)],
    },
    matchEnd: {
      ...common('crew-ejection-win'),
      resolution: { kind: 'won', winner: 'crew', reason: 'IMPOSTOR_EJECTED', tick: 960 },
      board: board(74),
      players: [
        endPlayer('p1', 'alive', 30, 30, 0),
        endPlayer('p2', 'ejected', 30, 0, 6),
        endPlayer('p3', 'alive', 30, 30, 38),
        endPlayer('p4', 'alive', 230, 30, 30),
      ],
      impostor: { unitsDestroyed: 16, siphons: 4, selfSinks: 1 },
      traces: [{ round: 2, tick: 481, purchaser: 'p4', target: 'p1', result: 'drained' }],
      voteHistory: [
        { round: 1, votes: skipAll, ejected: null },
        { round: 2, votes: { p1: IMPOSTOR, p2: 'p1', p3: IMPOSTOR, p4: IMPOSTOR }, ejected: IMPOSTOR },
      ],
    },
  },
}

// Crew tap 20 a round for three rounds (60 each). In round 3 the impostor frames p4→p1 twice.
// Votes in rounds 2 and 3 split, so round 3's close resolves below target. Pot 192, all impostor.
const impostorTimeoutWin: Golden = {
  scenario: {
    name: 'impostor-timeout-win',
    started: start('impostor-timeout-win'),
    lastTick: LAST_TICK,
    intentsAt: (tick, state) => {
      const intents: Intent[] = []
      if (tapping(state, tick, 20)) {
        for (const id of CREW) intents.push(tapOwn(id))
        if (tick === 970 || tick === 980) intents.push(siphon('p4', 'p1'))
      }
      if (tick === 901) intents.push(castVote('p1', 'p4'), castVote('p3', 'p4'), castVote('p4', 'p1'))
      if (tick === 1381) {
        intents.push(castVote('p1', IMPOSTOR), castVote('p3', 'p4'), castVote('p4', 'p3'), castVote(IMPOSTOR, 'p1'))
      }
      return intents
    },
  },
  expected: {
    rejections: [],
    resolution: { kind: 'won', winner: 'impostor', reason: 'ROUNDS_EXHAUSTED', tick: 1440 },
    boardTotal: 172,
    settlement: {
      matchId: 'impostor-timeout-win',
      resolution: { kind: 'won', winner: 'impostor', reason: 'ROUNDS_EXHAUSTED', tick: 1440 },
      escrowCredits: 4800,
      potCredits: 192,
      rakeBps: 0,
      rakeCredits: 0,
      dustCredits: 0,
      winners: [IMPOSTOR],
      lines: [pay('p1', 60, 1140, 0), pay('p2', 12, 1188, 192), pay('p3', 60, 1140, 0), pay('p4', 60, 1140, 0)],
    },
    matchEnd: {
      ...common('impostor-timeout-win'),
      resolution: { kind: 'won', winner: 'impostor', reason: 'ROUNDS_EXHAUSTED', tick: 1440 },
      board: board(172),
      players: [
        endPlayer('p1', 'alive', 60, 60, 72),
        endPlayer('p2', 'alive', 12, 0, 0),
        endPlayer('p3', 'alive', 60, 60, 60),
        endPlayer('p4', 'alive', 60, 60, 40),
      ],
      impostor: { unitsDestroyed: 8, siphons: 2, selfSinks: 0 },
      traces: [],
      voteHistory: [
        { round: 1, votes: skipAll, ejected: null },
        { round: 2, votes: { p1: 'p4', p2: 'skip', p3: 'p4', p4: 'p1' }, ejected: null },
        { round: 3, votes: { p1: IMPOSTOR, p2: 'p1', p3: 'p4', p4: 'p3' }, ejected: null },
      ],
    },
  },
}

// Round 1: crew tap 20 each and p1 is voted out 3–1. Round 2: p3 taps its own lane, p4 taps p1's
// dormant lane (20 tier-1 taps at 50% → 10 units), the impostor taps cover. p3 goes 2 of 3 at the
// round 2 close, which is the second crew ejection. Pot 120, all impostor.
const impostorDoubleEjectionWin: Golden = {
  scenario: {
    name: 'impostor-double-ejection-win',
    started: start('impostor-double-ejection-win'),
    lastTick: LAST_TICK,
    intentsAt: (tick, state) => {
      const intents: Intent[] = []
      if (state.round === 1 && tapping(state, tick, 20)) for (const id of CREW) intents.push(tapOwn(id))
      if (state.round === 2 && tapping(state, tick, 20)) {
        intents.push(tapOwn('p3'), tapInto('p4', 'p1'), tapOwn(IMPOSTOR))
      }
      if (tick === 421) intents.push(castVote(IMPOSTOR, 'p1'), castVote('p3', 'p1'), castVote('p4', 'p1'), castVote('p1', 'p3'))
      if (tick === 901) intents.push(castVote(IMPOSTOR, 'p3'), castVote('p4', 'p3'), castVote('p3', IMPOSTOR))
      return intents
    },
  },
  expected: {
    rejections: [],
    resolution: { kind: 'won', winner: 'impostor', reason: 'CREW_EJECTED', tick: 960 },
    boardTotal: 110,
    settlement: {
      matchId: 'impostor-double-ejection-win',
      resolution: { kind: 'won', winner: 'impostor', reason: 'CREW_EJECTED', tick: 960 },
      escrowCredits: 4800,
      potCredits: 120,
      rakeBps: 0,
      rakeCredits: 0,
      dustCredits: 0,
      winners: [IMPOSTOR],
      lines: [pay('p1', 20, 1180, 0), pay('p2', 20, 1180, 120), pay('p3', 40, 1160, 0), pay('p4', 40, 1160, 0)],
    },
    matchEnd: {
      ...common('impostor-double-ejection-win'),
      resolution: { kind: 'won', winner: 'impostor', reason: 'CREW_EJECTED', tick: 960 },
      board: board(110),
      players: [
        endPlayer('p1', 'ejected', 20, 20, 30),
        endPlayer('p2', 'alive', 20, 20, 20),
        endPlayer('p3', 'ejected', 40, 40, 40),
        endPlayer('p4', 'alive', 40, 30, 20),
      ],
      impostor: { unitsDestroyed: 0, siphons: 0, selfSinks: 0 },
      traces: [],
      voteHistory: [
        { round: 1, votes: { p1: 'p3', p2: 'p1', p3: 'p1', p4: 'p1' }, ejected: 'p1' },
        { round: 2, votes: { p2: 'p3', p3: IMPOSTOR, p4: 'p3' }, ejected: 'p3' },
      ],
    },
  },
}

// Everyone taps for 20 ticks while alive. p1 drops on tick 10 and p3 on 30; their grace periods
// expire on 130 and 150. The first expiry resolves nothing; the second voids the match.
const voidByAbandonment: Golden = {
  scenario: {
    name: 'void-by-abandonment',
    started: start('void-by-abandonment'),
    lastTick: LAST_TICK,
    intentsAt: (tick, state) => {
      const intents: Intent[] = []
      if (tapping(state, tick, 20)) for (const id of EVERYONE) if (isAlive(state, id)) intents.push(tapOwn(id))
      if (tick === 10) intents.push({ kind: 'DISCONNECT', playerId: 'p1' })
      if (tick === 30) intents.push({ kind: 'DISCONNECT', playerId: 'p3' })
      return intents
    },
  },
  expected: {
    rejections: [],
    resolution: { kind: 'voided', reason: 'ABANDONED', tick: 150 },
    boardTotal: 70,
    settlement: {
      matchId: 'void-by-abandonment',
      resolution: { kind: 'voided', reason: 'ABANDONED', tick: 150 },
      escrowCredits: 4800,
      potCredits: 0,
      rakeBps: 0,
      rakeCredits: 0,
      dustCredits: 0,
      winners: [],
      lines: [pay('p1', 10, 1200, 0), pay('p2', 20, 1200, 0), pay('p3', 20, 1200, 0), pay('p4', 20, 1200, 0)],
    },
    matchEnd: {
      ...common('void-by-abandonment'),
      resolution: { kind: 'voided', reason: 'ABANDONED', tick: 150 },
      board: board(70),
      players: [
        endPlayer('p1', 'ejected', 10, 10, 10),
        endPlayer('p2', 'alive', 20, 20, 20),
        endPlayer('p3', 'ejected', 20, 20, 20),
        endPlayer('p4', 'alive', 20, 20, 20),
      ],
      impostor: { unitsDestroyed: 0, siphons: 0, selfSinks: 0 },
      traces: [],
      voteHistory: [],
    },
  },
}

// p1 taps ticks 1–10, drops on tick 10, and rejoins on tick 40 (grace would have expired on 130),
// then taps 40–49: 20 taps in all. The impostor's siphon out of p1's frozen lane on tick 20 is
// rejected; the same siphon on tick 50 lands. Crew vote the impostor out at the round 1 close.
const reconnectMidRound: Golden = {
  scenario: {
    name: 'reconnect-mid-round',
    started: start('reconnect-mid-round'),
    lastTick: LAST_TICK,
    intentsAt: (tick, state) => {
      const intents: Intent[] = []
      if (tick === 40) intents.push({ kind: 'RECONNECT', playerId: 'p1' })
      if (state.round === 1 && state.stage === 'tap') {
        if (tick <= 10 || (tick >= 40 && tick <= 49)) intents.push(tapOwn('p1'))
        if (tick <= 20) intents.push(tapOwn('p3'), tapOwn('p4'))
      }
      if (tick === 10) intents.push({ kind: 'DISCONNECT', playerId: 'p1' })
      if (tick === 20 || tick === 50) intents.push(siphon('p1', 'p3'))
      if (tick === 421) intents.push(castVote('p1', IMPOSTOR), castVote('p3', IMPOSTOR), castVote('p4', IMPOSTOR))
      return intents
    },
  },
  expected: {
    rejections: [{ tick: 20, action: 'SIPHON', code: 'LANE_FROZEN' }],
    resolution: { kind: 'won', winner: 'crew', reason: 'IMPOSTOR_EJECTED', tick: 480 },
    boardTotal: 56,
    settlement: {
      matchId: 'reconnect-mid-round',
      resolution: { kind: 'won', winner: 'crew', reason: 'IMPOSTOR_EJECTED', tick: 480 },
      escrowCredits: 4800,
      potCredits: 66,
      rakeBps: 0,
      rakeCredits: 0,
      dustCredits: 0,
      winners: ['p1', 'p3', 'p4'],
      lines: [pay('p1', 20, 1180, 22), pay('p2', 6, 1194, 0), pay('p3', 20, 1180, 22), pay('p4', 20, 1180, 22)],
    },
    matchEnd: {
      ...common('reconnect-mid-round'),
      resolution: { kind: 'won', winner: 'crew', reason: 'IMPOSTOR_EJECTED', tick: 480 },
      board: board(56),
      players: [
        endPlayer('p1', 'alive', 20, 20, 10),
        endPlayer('p2', 'ejected', 6, 0, 0),
        endPlayer('p3', 'alive', 20, 20, 26),
        endPlayer('p4', 'alive', 20, 20, 20),
      ],
      impostor: { unitsDestroyed: 4, siphons: 1, selfSinks: 0 },
      traces: [],
      voteHistory: [{ round: 1, votes: { p1: IMPOSTOR, p2: 'skip', p3: IMPOSTOR, p4: IMPOSTOR }, ejected: IMPOSTOR }],
    },
  },
}

export const GOLDENS: readonly Golden[] = [
  crewBoardWin,
  crewEjectionWin,
  impostorTimeoutWin,
  impostorDoubleEjectionWin,
  voidByAbandonment,
  reconnectMidRound,
]
