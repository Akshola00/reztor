export type Tier = 1 | 2

export type MatchConfig = {
  laneCapacity: number
  winTarget: number
  tapTiers: Record<Tier, { cost: number; units: number }>
  tapRatePerSec: number
  siphon: { pull: number; deliver: number; costOther: number; costSelf: number; ratePerSec: number }
  // perPlayer is pinned to 1 because PlayerState.traceUsed is a boolean.
  trace: { cost: number; perPlayer: 1 }
  dormantEfficiencyPct: number
  rounds: number
  stageDurations: { tap: number; chat: number; vote: number }
  buyInSkr: number
  creditsPerSkr: number
  rakeBps: number
  disconnectGraceSec: number
  lobbyFillTimeoutSec: number
}

export const MVP_CONFIG: MatchConfig = {
  laneCapacity: 1000,
  winTarget: 2400,
  tapTiers: { 1: { cost: 1, units: 1 }, 2: { cost: 4, units: 3 } },
  tapRatePerSec: 6,
  siphon: { pull: 10, deliver: 6, costOther: 6, costSelf: 12, ratePerSec: 4 },
  trace: { cost: 200, perPlayer: 1 },
  dormantEfficiencyPct: 50,
  rounds: 3,
  stageDurations: { tap: 60, chat: 45, vote: 15 },
  buyInSkr: 12,
  creditsPerSkr: 100,
  rakeBps: 0,
  disconnectGraceSec: 30,
  lobbyFillTimeoutSec: 60,
}

export const TICKS_PER_SEC = 4

// Tokens are integer quarter-tokens (CLAUDE.md §6). The scale equals TICKS_PER_SEC, so a
// rate of N per second refills exactly N quarter-tokens per tick with no fractional state.
export const TOKEN_SCALE = 4

// Dormant remainders are hundredths of a unit so any dormantEfficiencyPct stays integer-exact.
// At 50% this behaves identically to CLAUDE.md §5.4's `% 2` accumulator.
export const REMAINDER_SCALE = 100

export type BucketParams = { capacity: number; refillPerTick: number }

export const ticksFor = (seconds: number): number => seconds * TICKS_PER_SEC

// CLAUDE.md §7: one chat message per player per 2 seconds.
export const CHAT_INTERVAL_TICKS = ticksFor(2)

export const startingCredits = (config: MatchConfig): number => config.buyInSkr * config.creditsPerSkr

export const tapBucketParams = (config: MatchConfig): BucketParams => ({
  capacity: config.tapRatePerSec * TOKEN_SCALE,
  refillPerTick: config.tapRatePerSec,
})

export const siphonBucketParams = (config: MatchConfig): BucketParams => ({
  capacity: config.siphon.ratePerSec * TOKEN_SCALE,
  refillPerTick: config.siphon.ratePerSec,
})
