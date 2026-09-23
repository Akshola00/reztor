import type { ClientMessages, Tier } from '../../protocol/generated'

// Client intents in the order they were made. Over a socket they are sent as they are made; in a
// dev rehearsal they accumulate here for the loopback to read.

/** The spec's batch interval — one server tick. PROTOCOL.md §4 and §7. */
export const BATCH_INTERVAL_MS = 250

/** PROTOCOL.md §4: `count` is 1–60. */
export const TAP_BATCH_MAX = 60

export type OutboxEntry =
  | { type: 'TAP_BATCH'; payload: ClientMessages['TAP_BATCH'] }
  | { type: 'SET_TIER'; payload: ClientMessages['SET_TIER'] }

/**
 * `count` taps as one or more batches, none larger than the protocol allows. Splits rather than
 * truncates: at 6 taps/sec a 250ms batch cannot approach 60, but a cap that dropped taps would
 * lose them silently.
 */
export function tapBatches(tier: Tier, count: number): ClientMessages['TAP_BATCH'][] {
  const batches: ClientMessages['TAP_BATCH'][] = []
  let remaining = count
  while (remaining > 0) {
    const chunk = Math.min(remaining, TAP_BATCH_MAX)
    batches.push({ tier, count: chunk, clientTs: Date.now() })
    remaining -= chunk
  }
  return batches
}

export type Outbox = {
  pushTaps: (tier: Tier, count: number) => void
  pushSetTier: (tier: Tier) => void
  entries: () => readonly OutboxEntry[]
}

export function createOutbox(): Outbox {
  const entries: OutboxEntry[] = []

  return {
    pushTaps(tier, count) {
      for (const payload of tapBatches(tier, count)) entries.push({ type: 'TAP_BATCH', payload })
    },

    pushSetTier(tier) {
      entries.push({ type: 'SET_TIER', payload: { tier } })
    },

    entries() {
      return entries
    },
  }
}
