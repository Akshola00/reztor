import { getBase64Encoder, getTransactionDecoder, type Transaction } from '@solana/kit'
import { transact } from '@wallet-ui/react-native-kit'

import { CLUSTER, IDENTITY } from './chain'

// The stake: STAKE_REQUEST's unsigned transaction, decoded for the wallet to sign and send.
// The server builds it; the app never modifies it and never reports back (CHAIN-PROTOCOL-CHANGES.md
// §3). @solana/kit's decoder stands in for web3.js's Transaction.from: same wire bytes, and the
// wallet re-encodes them unchanged.

export function decodeStakeTx(base64: string): Transaction {
  return getTransactionDecoder().decode(getBase64Encoder().encode(base64))
}

/**
 * Signs and sends the stake in one wallet session, authorizing afresh with the devnet chain first.
 *
 * Not Wallet UI's signAndSendTransactions: that reuses the cached auth token, which the MWA
 * protocol turns into a bare `reauthorize` for legacy-protocol wallets, dropping the cluster. The
 * wallet then treats the session as mainnet and refuses a devnet transaction ("network mismatch"
 * in Solflare). A fresh `authorize` always carries the chain, at the cost of one more approval.
 */
export async function signAndSendStake(base64: string): Promise<void> {
  await transact(async (wallet) => {
    await wallet.authorize({ chain: CLUSTER.id, identity: IDENTITY })
    await wallet.signAndSendTransactions({ transactions: [decodeStakeTx(base64)] })
  })
}

/**
 * Why a signing attempt failed, for the copy. Either way the cure is the same: JOIN again for a
 * freshly built transaction and let the player retry.
 */
export type StakeFailure = 'declined' | 'stale' | 'other'

export function classifyStakeError(error: unknown): StakeFailure {
  const message = error instanceof Error ? error.message : String(error)
  // MWA's ERROR_NOT_SIGNED is -3; wallets word a cancel differently, so the message is checked too.
  const code = (error as { code?: unknown } | null)?.code
  if (/blockhash/i.test(message)) return 'stale'
  if (code === -3 || code === 'ERROR_NOT_SIGNED' || /declin|reject|cancel|denied/i.test(message)) return 'declined'
  return 'other'
}
