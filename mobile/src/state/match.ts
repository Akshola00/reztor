import type { LaneSnapshot, PlayerId, Stage, Tier } from '../../protocol/generated'

// CLAUDE.md: the last authoritative snapshot from the server, written only by socket messages.
// It must never be merged with state/optimistic.ts.
//
// Item 2 has no socket. A dev loopback writes here instead, standing in for BOARD_UPDATE and
// CREDITS until item 3 — which is exactly why this module exists now rather than later: the
// loopback writes through the same door the socket will, so item 3 replaces the writer and
// nothing downstream changes.
//
// This module holds no prediction and applies no rules. It is a record of what the server last
// said, nothing more.

export type MatchSnapshot = {
  round: number
  stage: Stage
  secondsLeft: number
  lanes: LaneSnapshot[]
  boardTotal: number
  /** This player's authoritative credits, from CREDITS. */
  credits: number
  /** The tier the server has stored for this player, from CREDITS. */
  tier: Tier
}

export type MatchStore = {
  snapshot: () => MatchSnapshot
  /** BOARD_UPDATE: lane positions and the clock. */
  applyBoard: (board: Pick<MatchSnapshot, 'round' | 'stage' | 'secondsLeft' | 'lanes' | 'boardTotal'>) => void
  /** CREDITS: this player's balance and stored tier. */
  applyCredits: (credits: { credits: number; tier: Tier }) => void
  laneUnits: (owner: PlayerId) => number
  subscribe: (listener: () => void) => () => void
}

export function createMatchStore(initial: MatchSnapshot): MatchStore {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }

  return {
    snapshot() {
      return snapshot
    },

    applyBoard(board) {
      snapshot = { ...snapshot, ...board }
      notify()
    },

    applyCredits({ credits, tier }) {
      snapshot = { ...snapshot, credits, tier }
      notify()
    },

    laneUnits(owner) {
      return snapshot.lanes.find((lane) => lane.owner === owner)?.units ?? 0
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
