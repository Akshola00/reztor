import {
  REMAINDER_SCALE,
  siphonBucketParams,
  startingCredits,
  tapBucketParams,
} from '../../src/engine/config.js'
import { deriveImpostor } from '../../src/engine/rules.js'
import { matchEndView } from '../../src/engine/selectors.js'
import type { MatchState, PlayerId, TokenBucket } from '../../src/engine/state.js'

function fail(state: MatchState, message: string): never {
  const last = state.eventLog.at(-1)
  throw new Error(
    `Invariant violated (match ${state.matchId}, tick ${state.tick}, after ${last?.type ?? 'nothing'}): ${message}`,
  )
}

const isInt = Number.isInteger

// CLAUDE.md §13.2. Called after every reduce.
export function assertInvariants(prev: MatchState | null, next: MatchState): void {
  const { config, eventLog } = next

  const last = eventLog.at(-1)
  if (eventLog[0]?.type !== 'MATCH_STARTED') fail(next, 'log must open with MATCH_STARTED')
  if (last === undefined || next.tick !== last.tick) fail(next, 'state.tick must equal the last event tick')
  for (let i = 1; i < eventLog.length; i++) {
    const before = eventLog[i - 1]
    const current = eventLog[i]
    if (before !== undefined && current !== undefined && current.tick < before.tick) {
      fail(next, 'event ticks must never decrease')
    }
  }

  if (prev !== null) {
    if (prev.resolution !== null) fail(next, 'no event may follow a resolution')
    if (eventLog.length <= prev.eventLog.length) fail(next, 'every change must append to the log')
    if (prev.eventLog.some((event, i) => eventLog[i] !== event)) fail(next, 'the log is append-only')
  }

  const derived = deriveImpostor(next.roleSeed, Object.keys(next.players))
  if (!derived.ok || derived.value !== next.impostorId) fail(next, 'impostorId does not match roleSeed')

  for (const lane of Object.values(next.lanes)) {
    const { owner, units, roundDelta: d } = lane
    if (!isInt(units) || units < 0 || units > config.laneCapacity) {
      fail(next, `lane ${owner} units ${units} outside [0, ${config.laneCapacity}]`)
    }
    if (units !== lane.roundStartUnits + d.natural + d.foreign + d.received - d.drained) {
      fail(next, `lane ${owner}: units ≠ roundStartUnits + natural + foreign + received − drained`)
    }
    const ownerState = next.players[owner]
    if (ownerState === undefined) fail(next, `lane ${owner} has no owner`)
    if (lane.dormant !== (ownerState.status === 'ejected')) {
      fail(next, `lane ${owner}: dormant must equal owner ejected`)
    }
    for (const [tapper, remainder] of Object.entries(lane.dormantRemainder)) {
      if (!isInt(remainder) || remainder < 0 || remainder >= REMAINDER_SCALE) {
        fail(next, `lane ${owner}: remainder for ${tapper} out of range`)
      }
    }
  }

  const buyIn = startingCredits(config)
  const checkBucket = (id: PlayerId, bucket: TokenBucket, capacity: number, name: string) => {
    if (!isInt(bucket.tokens) || bucket.tokens < 0 || bucket.tokens > capacity || bucket.updatedAtTick > next.tick) {
      fail(next, `player ${id}: ${name} bucket out of range`)
    }
  }
  for (const p of Object.values(next.players)) {
    if (!isInt(p.credits) || p.credits < 0) fail(next, `player ${p.id}: credits must be a non-negative integer`)
    if (!isInt(p.spent) || p.credits + p.spent !== buyIn) fail(next, `player ${p.id}: credits + spent must equal ${buyIn}`)
    checkBucket(p.id, p.tapBucket, tapBucketParams(config).capacity, 'tap')
    checkBucket(p.id, p.siphonBucket, siphonBucketParams(config).capacity, 'siphon')

    const before = prev?.players[p.id]
    if (before !== undefined) {
      if (p.spent < before.spent) fail(next, `player ${p.id}: spent decreased`)
      if (before.status === 'ejected' && p.status !== 'ejected') fail(next, `player ${p.id}: ejection is final`)
      if (before.traceUsed && !p.traceUsed) fail(next, `player ${p.id}: traceUsed cannot be undone`)
    }
  }

  // Both conservation identities are folded from the log, independently of live state.
  let tapped = 0
  let destroyed = 0
  const spentFromLog = new Map<PlayerId, number>()
  const charge = (id: PlayerId, cost: number) => spentFromLog.set(id, (spentFromLog.get(id) ?? 0) + cost)
  for (const event of eventLog) {
    if (event.type === 'TAPS_APPLIED') {
      tapped += event.units
      charge(event.playerId, event.cost)
    } else if (event.type === 'SIPHONED') {
      if (event.destroyed !== event.pulled - event.delivered) fail(next, 'siphon destroyed ≠ pulled − delivered')
      destroyed += event.destroyed
      charge(event.playerId, event.cost)
    } else if (event.type === 'TRACED') {
      charge(event.playerId, event.cost)
    }
  }
  const board = Object.values(next.lanes).reduce((sum, lane) => sum + lane.units, 0)
  if (board !== tapped - destroyed) {
    fail(next, `unit conservation: board ${board} ≠ tapped ${tapped} − destroyed ${destroyed}`)
  }
  for (const p of Object.values(next.players)) {
    const logged = spentFromLog.get(p.id) ?? 0
    if (p.spent !== logged) fail(next, `credit conservation: player ${p.id} spent ${p.spent} ≠ logged ${logged}`)
  }

  // The reveal exists exactly once the match is over, never before.
  if ((matchEndView(next) === null) !== (next.resolution === null)) {
    fail(next, 'matchEndView must be null exactly when resolution is null')
  }
}
