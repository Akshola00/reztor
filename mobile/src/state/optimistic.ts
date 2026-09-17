import type { MatchConfig, Tier } from '../../protocol/generated'

// CLAUDE.md: local prediction for this player's taps and credits, written only by input and
// reconciled against the authoritative layer. It must never be merged with state/match.ts —
// every bug in this class of game comes from optimistic values leaking into what the player
// believes is the truth.
//
// This module has no React in it on purpose. The tap handler runs synchronously inside
// `onTouchStart` (see CLAUDE.md hard rule 3 on why the handler is on the JS thread), so it
// cannot afford a hook, a context read or a setState. Components subscribe if they want to,
// and the tap path does not.
//
// The clamps mirror the server exactly. Read from ../server/src/engine/rules.ts:102-111:
//
//     const byTokens   = Math.min(intent.count, Math.floor(available / TOKEN_SCALE))
//     const byCredits  = Math.min(byTokens, Math.floor(player.credits / tier.cost))
//     const byHeadroom = Math.floor(headroom / tier.units)          // own lane
//     const applied    = Math.max(0, Math.min(byCredits, byHeadroom))
//
// Three things that matter for predicting it correctly:
//
//   1. The order is tokens, then credits, then headroom. Predicting a different order would
//      mispredict which clamp bites first and the frontier would settle backwards.
//   2. **A tap whose units do not fully fit is dropped uncharged, never clipped**
//      (rules.ts:105). With 2 units of headroom and a tier-2 tap worth 3, `floor(2/3)` is 0:
//      the tap does not apply and costs nothing. Never partially fill.
//   3. Rate-clamped taps are the only silent drop in the protocol (PROTOCOL.md §4), so an
//      empty bucket means do nothing at all — no spark, no haptic, no credit change.
//
// The server's bucket is integer quarter-tokens (capacity tapRatePerSec x 4, refilling
// tapRatePerSec per 250ms tick). Whole taps at a continuous refill is the same bucket seen from
// the client, and avoids pretending we know the server's tick boundaries.

export type TapOutcome =
  { applied: false; reason: 'rate' | 'credits' | 'laneFull' } | { applied: true; units: number; cost: number }

export type OptimisticSnapshot = {
  credits: number
  ownUnits: number
  pending: number
  tier: Tier
}

export type OptimisticStore = {
  /** Synchronous, allocation-light, safe to call from a touch handler. */
  tap: (nowMs: number) => TapOutcome
  /** Reads and zeroes the pending count, for the 250ms batch timer. */
  takePending: () => number
  /** How many taps are batched but not yet acknowledged. */
  pendingCount: () => number
  setTier: (tier: Tier) => void
  tier: () => Tier
  /**
   * Re-base prediction on an authoritative value, then re-apply whatever is still pending so
   * the player's own taps are not lost between a batch leaving and its acknowledgement.
   */
  rebase: (authoritative: { credits: number; ownUnits: number }) => void
  snapshot: () => OptimisticSnapshot
  subscribe: (listener: () => void) => () => void
}

export function createOptimisticStore(config: MatchConfig, startingCredits: number): OptimisticStore {
  // Whole taps, refilled continuously. Starts full, matching the server, which seeds the bucket
  // at capacity when the match starts.
  const capacity = config.tapRatePerSec
  let tokens = capacity
  let lastRefillMs = 0

  let credits = startingCredits
  let ownUnits = 0
  let pending = 0
  let tier: Tier = 1

  // Base values from the last authoritative message, so `rebase` can re-apply pending taps
  // rather than double-counting them.
  let pendingUnits = 0
  let pendingCost = 0

  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }

  const refill = (nowMs: number) => {
    if (lastRefillMs === 0) {
      lastRefillMs = nowMs
      return
    }
    const elapsed = (nowMs - lastRefillMs) / 1000
    if (elapsed <= 0) return
    tokens = Math.min(capacity, tokens + elapsed * config.tapRatePerSec)
    lastRefillMs = nowMs
  }

  return {
    tap(nowMs) {
      refill(nowMs)

      // 1. Rate. Silent per PROTOCOL.md §4 — the only silent drop there is.
      if (tokens < 1) return { applied: false, reason: 'rate' }

      const { cost, units } = config.tapTiers[tier]

      // 2. Credits.
      if (credits < cost) return { applied: false, reason: 'credits' }

      // 3. Lane headroom, and never a partial tap (rules.ts:105).
      const headroom = config.laneCapacity - ownUnits
      if (Math.floor(headroom / units) < 1) return { applied: false, reason: 'laneFull' }

      tokens -= 1
      credits -= cost
      ownUnits += units
      pending += 1
      pendingUnits += units
      pendingCost += cost
      notify()
      return { applied: true, units, cost }
    },

    takePending() {
      const count = pending
      pending = 0
      // The unit/cost accumulators are zeroed here too, not just in `rebase`. Leaving them set
      // was a real over-count bug: tap x3, batch, tap x2 left them reading 5, and the next
      // rebase re-applied the 3 already sent, inflating the lane by 3 units every cycle.
      //
      // The consequence is that a batch which has been sent but not yet acknowledged is not
      // re-applied on top of an authoritative value. That is the honest behaviour without
      // sequence numbers on the wire: those taps settle by lerping up when the server's value
      // arrives, which is exactly what hard rule 2's reconciliation is for.
      pendingUnits = 0
      pendingCost = 0
      return count
    },

    pendingCount() {
      return pending
    },

    setTier(next) {
      tier = next
      notify()
    },

    tier() {
      return tier
    },

    rebase({ credits: authoritativeCredits, ownUnits: authoritativeUnits }) {
      // The authoritative value already accounts for every batch the server accepted. What is
      // still in `pending` has not been sent yet, so it is re-applied on top: its units are
      // added and its cost is taken off, exactly as the local taps did.
      //
      // `takePending` clears these accumulators, so they only ever describe unsent taps and
      // cannot double-count a batch that is already reflected in the authoritative value.
      credits = authoritativeCredits - pendingCost
      ownUnits = Math.min(config.laneCapacity, authoritativeUnits + pendingUnits)
      notify()
    },

    snapshot() {
      return { credits, ownUnits, pending, tier }
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
