import type { Intent } from '../../src/engine/events.js'
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

const skipAll = { p1: 'skip', p2: 'skip', p3: 'skip', p4: 'skip' }

// Rounds 1–2: crew tap 240 each (1440). p1 traces the idle impostor in round 2 (natural, −200).
// Round 3: crew switch to tier 2, +9 per tick. After 106 ticks the board is 2394; on tick 1067 p1
// takes it to 2397 and p3 to 2400, which latches the win, so p4's tap in that tick is MATCH_OVER.
// Pot 1108 + 908 + 904 = 2920 → 973 each, 1 dust.
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

// Round 1: crew tap 240 each; the impostor frames p1→p3 every 10 ticks (24 siphons), so p1 always
// has exactly 10 to give and ends the round at 0 (natural 240 = drained 240). p3 ends at 384.
// Round 2: p4 traces p1 — the tie reads drained. The impostor self-sinks p3→p2 once at tick 500.
// Three crew vote the impostor out at the round 2 close. Pot 1796 → 598 each, 2 dust.
const crewEjectionWin: Golden = {
  scenario: {
    name: 'crew-ejection-win',
    started: start('crew-ejection-win'),
    lastTick: LAST_TICK,
    intentsAt: (tick, state) => {
      const intents: Intent[] = []
      if (state.stage === 'tap') {
        if (tick === 481) intents.push({ kind: 'TRACE', playerId: 'p4', target: 'p1' })
        for (const id of CREW) intents.push(tapOwn(id))
        if (state.round === 1 && tick % 10 === 0) intents.push(siphon('p1', 'p3'))
        if (tick === 500) intents.push(siphon('p3', IMPOSTOR))
      }
      if (tick === 901) {
        intents.push(castVote('p1', IMPOSTOR), castVote('p3', IMPOSTOR), castVote('p4', IMPOSTOR), castVote(IMPOSTOR, 'p1'))
      }
      return intents
    },
  },
  expected: {
    rejections: [],
    resolution: { kind: 'won', winner: 'crew', reason: 'IMPOSTOR_EJECTED', tick: 960 },
    boardTotal: 1340,
    settlement: {
      matchId: 'crew-ejection-win',
      resolution: { kind: 'won', winner: 'crew', reason: 'IMPOSTOR_EJECTED', tick: 960 },
      escrowCredits: 4800,
      potCredits: 1796,
      rakeBps: 0,
      rakeCredits: 0,
      dustCredits: 2,
      winners: ['p1', 'p3', 'p4'],
      lines: [pay('p1', 480, 720, 598), pay('p2', 156, 1044, 0), pay('p3', 480, 720, 598), pay('p4', 680, 520, 598)],
    },
    matchEnd: {
      ...common('crew-ejection-win'),
      resolution: { kind: 'won', winner: 'crew', reason: 'IMPOSTOR_EJECTED', tick: 960 },
      board: board(1340),
      players: [
        endPlayer('p1', 'alive', 480, 480, 240),
        endPlayer('p2', 'ejected', 156, 0, 6),
        endPlayer('p3', 'alive', 480, 480, 614),
        endPlayer('p4', 'alive', 680, 480, 480),
      ],
      impostor: { unitsDestroyed: 100, siphons: 25, selfSinks: 1 },
      traces: [{ round: 2, tick: 481, purchaser: 'p4', target: 'p1', result: 'drained' }],
      voteHistory: [
        { round: 1, votes: skipAll, ejected: null },
        { round: 2, votes: { p1: IMPOSTOR, p2: 'p1', p3: IMPOSTOR, p4: IMPOSTOR }, ejected: IMPOSTOR },
      ],
    },
  },
}

// Crew tap 240 a round for three rounds (2160). In round 3 the impostor frames p4→p1 ten times
// (−40 net). Votes in rounds 2 and 3 split, so round 3's close resolves at 2120 < 2400.
// Pot 2160 + 60 = 2220, all to the impostor.
const impostorTimeoutWin: Golden = {
  scenario: {
    name: 'impostor-timeout-win',
    started: start('impostor-timeout-win'),
    lastTick: LAST_TICK,
    intentsAt: (tick, state) => {
      const intents: Intent[] = []
      if (state.stage === 'tap') {
        for (const id of CREW) intents.push(tapOwn(id))
        if (tick >= 1000 && tick <= 1090 && tick % 10 === 0) intents.push(siphon('p4', 'p1'))
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
    boardTotal: 2120,
    settlement: {
      matchId: 'impostor-timeout-win',
      resolution: { kind: 'won', winner: 'impostor', reason: 'ROUNDS_EXHAUSTED', tick: 1440 },
      escrowCredits: 4800,
      potCredits: 2220,
      rakeBps: 0,
      rakeCredits: 0,
      dustCredits: 0,
      winners: [IMPOSTOR],
      lines: [pay('p1', 720, 480, 0), pay('p2', 60, 1140, 2220), pay('p3', 720, 480, 0), pay('p4', 720, 480, 0)],
    },
    matchEnd: {
      ...common('impostor-timeout-win'),
      resolution: { kind: 'won', winner: 'impostor', reason: 'ROUNDS_EXHAUSTED', tick: 1440 },
      board: board(2120),
      players: [
        endPlayer('p1', 'alive', 720, 720, 780),
        endPlayer('p2', 'alive', 60, 0, 0),
        endPlayer('p3', 'alive', 720, 720, 720),
        endPlayer('p4', 'alive', 720, 720, 620),
      ],
      impostor: { unitsDestroyed: 40, siphons: 10, selfSinks: 0 },
      traces: [],
      voteHistory: [
        { round: 1, votes: skipAll, ejected: null },
        { round: 2, votes: { p1: 'p4', p2: 'skip', p3: 'p4', p4: 'p1' }, ejected: null },
        { round: 3, votes: { p1: IMPOSTOR, p2: 'p1', p3: 'p4', p4: 'p3' }, ejected: null },
      ],
    },
  },
}

// Round 1: crew tap 240 each; p1 is voted out 3–1. Round 2: p3 taps its own lane, p4 taps p1's
// dormant lane (240 tier-1 taps at 50% → 120 units), the impostor taps cover. p3 is voted out
// 2 of 3 at the round 2 close. Pot 1440, all to the impostor.
const impostorDoubleEjectionWin: Golden = {
  scenario: {
    name: 'impostor-double-ejection-win',
    started: start('impostor-double-ejection-win'),
    lastTick: LAST_TICK,
    intentsAt: (tick, state) => {
      const intents: Intent[] = []
      if (state.stage === 'tap' && state.round === 1) for (const id of CREW) intents.push(tapOwn(id))
      if (state.stage === 'tap' && state.round === 2) intents.push(tapOwn('p3'), tapInto('p4', 'p1'), tapOwn(IMPOSTOR))
      if (tick === 421) intents.push(castVote(IMPOSTOR, 'p1'), castVote('p3', 'p1'), castVote('p4', 'p1'), castVote('p1', 'p3'))
      if (tick === 901) intents.push(castVote(IMPOSTOR, 'p3'), castVote('p4', 'p3'), castVote('p3', IMPOSTOR))
      return intents
    },
  },
  expected: {
    rejections: [],
    resolution: { kind: 'won', winner: 'impostor', reason: 'CREW_EJECTED', tick: 960 },
    boardTotal: 1320,
    settlement: {
      matchId: 'impostor-double-ejection-win',
      resolution: { kind: 'won', winner: 'impostor', reason: 'CREW_EJECTED', tick: 960 },
      escrowCredits: 4800,
      potCredits: 1440,
      rakeBps: 0,
      rakeCredits: 0,
      dustCredits: 0,
      winners: [IMPOSTOR],
      lines: [pay('p1', 240, 960, 0), pay('p2', 240, 960, 1440), pay('p3', 480, 720, 0), pay('p4', 480, 720, 0)],
    },
    matchEnd: {
      ...common('impostor-double-ejection-win'),
      resolution: { kind: 'won', winner: 'impostor', reason: 'CREW_EJECTED', tick: 960 },
      board: board(1320),
      players: [
        endPlayer('p1', 'ejected', 240, 240, 360),
        endPlayer('p2', 'alive', 240, 240, 240),
        endPlayer('p3', 'ejected', 480, 480, 480),
        endPlayer('p4', 'alive', 480, 360, 240),
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

// Everyone taps while alive. p1 drops at tick 100 and p3 at 150; their grace periods expire at 220
// and 270. The first expiry resolves nothing; the second voids the match in the chat stage.
const voidByAbandonment: Golden = {
  scenario: {
    name: 'void-by-abandonment',
    started: start('void-by-abandonment'),
    lastTick: LAST_TICK,
    intentsAt: (tick, state) => {
      const intents: Intent[] = []
      if (state.stage === 'tap') for (const id of EVERYONE) if (isAlive(state, id)) intents.push(tapOwn(id))
      if (tick === 100) intents.push({ kind: 'DISCONNECT', playerId: 'p1' })
      if (tick === 150) intents.push({ kind: 'DISCONNECT', playerId: 'p3' })
      return intents
    },
  },
  expected: {
    rejections: [],
    resolution: { kind: 'voided', reason: 'ABANDONED', tick: 270 },
    boardTotal: 730,
    settlement: {
      matchId: 'void-by-abandonment',
      resolution: { kind: 'voided', reason: 'ABANDONED', tick: 270 },
      escrowCredits: 4800,
      potCredits: 0,
      rakeBps: 0,
      rakeCredits: 0,
      dustCredits: 0,
      winners: [],
      lines: [pay('p1', 100, 1200, 0), pay('p2', 240, 1200, 0), pay('p3', 150, 1200, 0), pay('p4', 240, 1200, 0)],
    },
    matchEnd: {
      ...common('void-by-abandonment'),
      resolution: { kind: 'voided', reason: 'ABANDONED', tick: 270 },
      board: board(730),
      players: [
        endPlayer('p1', 'ejected', 100, 100, 100),
        endPlayer('p2', 'alive', 240, 240, 240),
        endPlayer('p3', 'ejected', 150, 150, 150),
        endPlayer('p4', 'alive', 240, 240, 240),
      ],
      impostor: { unitsDestroyed: 0, siphons: 0, selfSinks: 0 },
      traces: [],
      voteHistory: [],
    },
  },
}

// p1 taps 1–100, drops at 100, and rejoins at 160 (grace would have expired at 220), then taps
// 160–240: 181 taps. The impostor's siphon out of p1's frozen lane at 130 is rejected; the same
// siphon at 200 lands. Crew vote the impostor out at the round 1 close. Pot 667 → 222 each, 1 dust.
const reconnectMidRound: Golden = {
  scenario: {
    name: 'reconnect-mid-round',
    started: start('reconnect-mid-round'),
    lastTick: LAST_TICK,
    intentsAt: (tick, state) => {
      const intents: Intent[] = []
      if (tick === 160) intents.push({ kind: 'RECONNECT', playerId: 'p1' })
      if (state.stage === 'tap') {
        for (const id of CREW) if (isAlive(state, id) || (id === 'p1' && tick === 160)) intents.push(tapOwn(id))
      }
      if (tick === 100) intents.push({ kind: 'DISCONNECT', playerId: 'p1' })
      if (tick === 130 || tick === 200) intents.push(siphon('p1', 'p3'))
      if (tick === 421) intents.push(castVote('p1', IMPOSTOR), castVote('p3', IMPOSTOR), castVote('p4', IMPOSTOR))
      return intents
    },
  },
  expected: {
    rejections: [{ tick: 130, action: 'SIPHON', code: 'LANE_FROZEN' }],
    resolution: { kind: 'won', winner: 'crew', reason: 'IMPOSTOR_EJECTED', tick: 480 },
    boardTotal: 657,
    settlement: {
      matchId: 'reconnect-mid-round',
      resolution: { kind: 'won', winner: 'crew', reason: 'IMPOSTOR_EJECTED', tick: 480 },
      escrowCredits: 4800,
      potCredits: 667,
      rakeBps: 0,
      rakeCredits: 0,
      dustCredits: 1,
      winners: ['p1', 'p3', 'p4'],
      lines: [pay('p1', 181, 1019, 222), pay('p2', 6, 1194, 0), pay('p3', 240, 960, 222), pay('p4', 240, 960, 222)],
    },
    matchEnd: {
      ...common('reconnect-mid-round'),
      resolution: { kind: 'won', winner: 'crew', reason: 'IMPOSTOR_EJECTED', tick: 480 },
      board: board(657),
      players: [
        endPlayer('p1', 'alive', 181, 181, 171),
        endPlayer('p2', 'ejected', 6, 0, 0),
        endPlayer('p3', 'alive', 240, 240, 246),
        endPlayer('p4', 'alive', 240, 240, 240),
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
