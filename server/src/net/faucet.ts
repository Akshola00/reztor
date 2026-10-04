import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { Faucet, FaucetError, FaucetResponse } from '../chain/faucet.js'

// POST /faucet { wallet }. The body is the whole answer; the status is for curl and logs.

const MAX_BODY_BYTES = 1024

const FaucetRequestSchema = z.strictObject({ wallet: z.string().max(64) })

const STATUS: Record<FaucetError, number> = {
  FAUCET_DISABLED: 503,
  RATE_LIMITED: 429,
  ALREADY_FUNDED: 409,
  INVALID_WALLET: 400,
  FAUCET_EMPTY: 503,
  CHAIN_ERROR: 502,
}

const reply = (response: ServerResponse, body: FaucetResponse): void => {
  response.writeHead(body.ok ? 200 : STATUS[body.error], { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

// Behind Render's proxy every socket comes from the proxy, so the client is the address the proxy
// appended last. Earlier entries are whatever the client claimed and are ignored.
function clientIp(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for']
  const last = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '')).split(',').pop()?.trim()
  return last !== undefined && last !== '' ? last : (request.socket.remoteAddress ?? 'unknown')
}

async function body(request: IncomingMessage): Promise<string | null> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function faucetRoute(faucet: Faucet | undefined, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (faucet === undefined) return reply(response, { ok: false, error: 'FAUCET_DISABLED' })
  const text = await body(request)
  let parsed: unknown = null
  try {
    parsed = text === null ? null : JSON.parse(text)
  } catch {
    // Falls through to the schema, which refuses it.
  }
  const payload = FaucetRequestSchema.safeParse(parsed)
  if (!payload.success) return reply(response, { ok: false, error: 'INVALID_WALLET' })
  reply(response, await faucet.grant(payload.data.wallet, clientIp(request)))
}
