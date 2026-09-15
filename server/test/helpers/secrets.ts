import { isDeepStrictEqual } from 'node:util'
import { privateView, publicView, type PrivateView } from '../../src/engine/selectors.js'
import type { MatchState, PlayerId, RoundDelta } from '../../src/engine/state.js'

export type Views = {
  publicView: (state: MatchState) => unknown
  privateView: (state: MatchState, playerId: PlayerId) => PrivateView | null
}

// CLAUDE.md §13.2: field names that must never appear anywhere inside a public view.
const PUBLIC_FORBIDDEN_KEYS = new Set([
  'impostorId',
  'roleSeed',
  'role',
  'credits',
  'spent',
  'tier',
  'traceUsed',
  'tapsAccepted',
  'tapsDropped',
  'unitsTapped',
  'roundStartUnits',
  'roundDelta',
  'prevRoundDelta',
  'dormantRemainder',
  'you',
  'currentVote',
  'traces',
  'siphonActivity',
])

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, into)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      into.add(key)
      keysOf(child, into)
    }
  }
  return into
}

function mapValues<T>(record: Record<string, T>, f: (value: T, key: string) => T): Record<string, T> {
  const mapped: Record<string, T> = {}
  for (const [key, value] of Object.entries(record)) mapped[key] = f(value, key)
  return mapped
}

const bump = (d: RoundDelta): RoundDelta => ({
  natural: d.natural + 1,
  foreign: d.foreign + 2,
  received: d.received + 3,
  drained: d.drained + 4,
})

// Rewrites everything `viewer` must not be able to see (`null` is the public). A view that is a
// function of visible state alone comes out identical; any difference is a leak. This catches
// leaks no field-name list can, such as a renamed impostor flag or a "3 of 4 voted" counter.
function scramble(state: MatchState, viewer: PlayerId | null): MatchState {
  const viewerIsImpostor = viewer === state.impostorId
  const decoyImpostor = Object.keys(state.players).find((id) => id !== viewer && id !== state.impostorId)
  const ownVote = viewer === null ? undefined : state.votes[viewer]

  return {
    ...state,
    roleSeed: state.roleSeed === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64),
    impostorId: viewerIsImpostor || decoyImpostor === undefined ? state.impostorId : decoyImpostor,
    votes: viewer !== null && ownVote !== undefined ? { [viewer]: ownVote } : {},
    players: mapValues(state.players, (p, id) =>
      id === viewer
        ? p
        : {
            ...p,
            credits: p.credits + 1,
            spent: p.spent + 1,
            tier: p.tier === 1 ? 2 : 1,
            traceUsed: !p.traceUsed,
            tapsAccepted: p.tapsAccepted + 1,
            tapsDropped: p.tapsDropped + 1,
            unitsTapped: p.unitsTapped + 1,
            tapBucket: { tokens: p.tapBucket.tokens + 1, updatedAtTick: p.tapBucket.updatedAtTick + 1 },
            siphonBucket: { tokens: p.siphonBucket.tokens + 1, updatedAtTick: p.siphonBucket.updatedAtTick + 1 },
            lastChatTick: (p.lastChatTick ?? 0) + 1,
          },
    ),
    lanes: mapValues(state.lanes, (lane) => ({
      ...lane,
      roundStartUnits: lane.roundStartUnits + 1,
      roundDelta: bump(lane.roundDelta),
      prevRoundDelta: bump(lane.prevRoundDelta ?? lane.roundDelta),
      dormantRemainder: { scrambled: 1 },
    })),
    eventLog: state.eventLog.filter(
      (event) =>
        viewer !== null &&
        ((event.type === 'TRACED' && event.playerId === viewer) || (event.type === 'SIPHONED' && viewerIsImpostor)),
    ),
  }
}

// CLAUDE.md §13.2: secrets never leak, vote tallies never leak before close, and siphon activity
// reaches the impostor alone.
export function assertSecretsHidden(state: MatchState, views: Views = { publicView, privateView }): void {
  const fail = (message: string): never => {
    throw new Error(`Secret leaked (match ${state.matchId}, tick ${state.tick}): ${message}`)
  }

  const shown = views.publicView(state)
  const leakedKeys = [...keysOf(shown)].filter((key) => PUBLIC_FORBIDDEN_KEYS.has(key))
  if (leakedKeys.length > 0) fail(`publicView exposes ${leakedKeys.join(', ')}`)
  if (JSON.stringify(shown).includes(state.roleSeed)) fail('publicView exposes roleSeed')
  if (!isDeepStrictEqual(shown, views.publicView(scramble(state, null)))) fail('publicView depends on hidden state')

  const siphons = state.eventLog.filter((event) => event.type === 'SIPHONED').length
  for (const id of Object.keys(state.players)) {
    const mine = views.privateView(state, id)
    if (mine === null) return fail(`privateView(${id}) is missing`)
    const isImpostor = id === state.impostorId
    if (mine.you.role !== (isImpostor ? 'impostor' : 'crew')) fail(`privateView(${id}) shows the wrong role`)
    if (isImpostor && mine.siphonActivity?.siphons !== siphons) {
      fail(`privateView(${id}) hides the impostor’s own siphon activity`)
    }
    if (!isImpostor && mine.siphonActivity !== null) fail(`privateView(${id}) shows siphon activity to crew`)
    if (!isDeepStrictEqual(mine, views.privateView(scramble(state, id), id))) {
      fail(`privateView(${id}) depends on hidden state`)
    }
  }
}
