import type { ClientMessages, Tier } from '../../protocol/generated'

// Client intents waiting to go to the server, in the order they were made. Item 2 has no socket:
// intents only accumulate here, and the dev loopback reads them. Item 3 sends them.

/** The spec's batch interval — one server tick. PROTOCOL.md §4, TICKS_PER_SEC = 4. */
export const BATCH_INTERVAL_MS = 250

/** PROTOCOL.md §4: `count` is 1–60. */
export const TAP_BATCH_MAX = 60

export type OutboxEntry =
  | { type: 'TAP_BATCH'; payload: ClientMessages['TAP_BATCH'] }
  | { type: 'SET_TIER'; payload: ClientMessages['SET_TIER'] }

export type Outbox = {
  /** Pushes `count` taps as one or more batches, none larger than the protocol allows. */
  pushTaps: (tier: Tier, count: number) => void
  pushSetTier: (tier: Tier) => void
  entries: () => readonly OutboxEntry[]
}

export function createOutbox(): Outbox {
  const entries: OutboxEntry[] = []

  return {
    pushTaps(tier, count) {
      // Splits rather than truncates. At 6 taps/sec a 250ms batch cannot approach 60, so this
      // never runs twice in practice — but a cap that dropped taps would lose them silently.
      let remaining = count
      while (remaining > 0) {
        const chunk = Math.min(remaining, TAP_BATCH_MAX)
        entries.push({ type: 'TAP_BATCH', payload: { tier, count: chunk, clientTs: Date.now() } })
        remaining -= chunk
      }
    },

    pushSetTier(tier) {
      entries.push({ type: 'SET_TIER', payload: { tier } })
    },

    entries() {
      return entries
    },
  }
}
