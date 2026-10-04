// POST /faucet on the game server, devnet only (CHAIN-PROTOCOL-CHANGES.md §5). Plain HTTP, not a
// socket message, so its types are not in protocol/generated.ts; these mirror the doc's table.

export type FaucetError =
  'FAUCET_DISABLED' | 'INVALID_WALLET' | 'ALREADY_FUNDED' | 'RATE_LIMITED' | 'FAUCET_EMPTY' | 'CHAIN_ERROR'

/** `UNREACHABLE` is this app's: the request failed or the body was not the faucet's JSON. */
export type FaucetResult = { ok: true; signature: string } | { ok: false; error: FaucetError | 'UNREACHABLE' }

/** Answers after the grant confirms, so it can take a few seconds. Never throws. */
export async function requestFaucet(serverUrl: string, wallet: string): Promise<FaucetResult> {
  try {
    const response = await fetch(`${serverUrl}/faucet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet }),
    })
    // The body decides; the status is only a convenience.
    const body = (await response.json()) as Partial<{ ok: boolean; signature: string; error: FaucetError }>
    if (body.ok === true && typeof body.signature === 'string') return { ok: true, signature: body.signature }
    if (body.ok === false && typeof body.error === 'string') return { ok: false, error: body.error }
    return { ok: false, error: 'UNREACHABLE' }
  } catch {
    return { ok: false, error: 'UNREACHABLE' }
  }
}
