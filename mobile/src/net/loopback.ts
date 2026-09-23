import type { PlayerId, Tier } from '../../protocol/generated'
import type { MatchStore } from '../state/match'
import type { Outbox } from './outbox'

// Dev only: a stand-in for the server during a rehearsal, when no socket is connected. It writes
// state/match.ts through the same doors the socket handlers use — applyBoard and applyCredits —
// so the match screen cannot tell the difference. net/session.ts refuses to start it while a
// socket is connected, and stops it the moment one connects.
//
// It applies no game rules — no bucket, no credit clamp, no headroom. It accepts whatever the
// client batched, which the client has already clamped, and reports it back. Its one lever is
// "drop 30%": accept only 70% of each batch's taps, so the settle-back can be felt without a
// server.
//
// Like the server it applies the tier it has stored from SET_TIER, not the advisory tier in a
// batch (PROTOCOL.md §4).

/** Share of each batch's taps accepted while "drop 30%" is on. */
const DROP_ACCEPT = 0.7

export type Loopback = {
  /** One server tick: accept everything sent since the last one, then emit. */
  tick: () => void
  setDrop: (on: boolean) => void
}

export function createLoopback(outbox: Outbox, match: MatchStore, you: PlayerId): Loopback {
  let cursor = 0
  let tier: Tier = 1
  let drop = false
  // The fraction of a tap carried between batches, so 70% holds over a burst of one- and
  // two-tap batches instead of flooring every single-tap batch to zero.
  let carry = 0

  return {
    tick() {
      const snapshot = match.snapshot()
      if (snapshot === null) return

      const entries = outbox.entries()
      let units = 0
      let cost = 0
      for (; cursor < entries.length; cursor++) {
        const entry = entries[cursor]
        if (entry.type === 'SET_TIER') {
          tier = entry.payload.tier
          continue
        }
        let accepted = entry.payload.count
        if (drop) {
          const exact = carry + accepted * DROP_ACCEPT
          accepted = Math.floor(exact)
          carry = exact - accepted
        }
        units += accepted * snapshot.config.tapTiers[tier].units
        cost += accepted * snapshot.config.tapTiers[tier].cost
      }

      // A rehearsal's clock stands still: the stage never closes, so tapping never stops.
      const serverTick = snapshot.serverTick
      const lanes = snapshot.lanes.map((lane) => (lane.owner === you ? { ...lane, units: lane.units + units } : lane))

      // BOARD_UPDATE before CREDITS, so a reconcile run between the two sees the new lane.
      match.applyBoard(
        {
          round: snapshot.round,
          stage: snapshot.stage,
          secondsLeft: snapshot.secondsLeft,
          lanes,
          boardTotal: lanes.reduce((sum, lane) => sum + lane.units, 0),
          players: snapshot.players,
        },
        serverTick,
      )
      match.applyCredits({ credits: snapshot.credits - cost, spent: snapshot.spent + cost, tier }, serverTick)
    },

    setDrop(on) {
      drop = on
      carry = 0
    },
  }
}
