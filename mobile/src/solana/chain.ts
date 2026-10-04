// Devnet facts the app needs and the wire does not carry. See ../docs/CHAIN-PROTOCOL-CHANGES.md.
// The server builds every transaction, so there is no program id or mint here.

export const CLUSTER = {
  id: 'solana:devnet',
  url: 'https://api.devnet.solana.com',
} as const

/** What the wallet shows the player when it asks them to approve the app. */
export const IDENTITY = {
  name: 'Reztor',
  uri: 'https://reztor.onrender.com',
}

/**
 * The stake, in SKR. STAKE_REQUEST does not carry it and MatchConfig.buyInSkr arrives only with
 * MATCH_STARTED, after the stake is paid. Must match the server's MVP_CONFIG.
 */
export const BUY_IN_SKR = 12

/** Mock SKR's decimals. SETTLEMENT_CONFIRMED's payouts are base-unit strings. */
const SKR_DECIMALS = 6

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`
}

/** A base-unit string as SKR, e.g. "13000000" → "13". BigInt: a u64 does not fit a number. */
export function skrFromBaseUnits(units: string): string {
  const raw = BigInt(units)
  const scale = 10n ** BigInt(SKR_DECIMALS)
  const fraction = (raw % scale).toString().padStart(SKR_DECIMALS, '0').replace(/0+$/, '')
  return fraction === '' ? `${raw / scale}` : `${raw / scale}.${fraction}`
}

/** "AbCd…WxYz": enough of an address to recognise, not enough to crowd a line. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}
