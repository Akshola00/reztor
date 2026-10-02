import { Keypair, PublicKey } from '@solana/web3.js'
import { io as connect, type Socket as ClientSocket } from 'socket.io-client'
import { afterEach, describe, expect, it } from 'vitest'
import { isWalletAddress } from '../../src/chain/escrow.js'
import { silentLogger } from '../../src/log.js'
import type { WalletPolicy } from '../../src/match/lobby.js'
import { createGameServer, type GameServer } from '../../src/net/server.js'

// Who may sit down in chain mode. The address check is the real one; the balance is injected, so
// nothing here touches an RPC.

let server: GameServer | null = null
const sockets: ClientSocket[] = []

afterEach(async () => {
  for (const socket of sockets) socket.disconnect()
  sockets.length = 0
  await server?.close()
  server = null
})

const newWallet = (): string => Keypair.generate().publicKey.toBase58()

async function start(wallets?: WalletPolicy): Promise<number> {
  server = createGameServer({ logger: silentLogger, ...(wallets === undefined ? {} : { wallets }) })
  const port = await server.listen(0)
  server.loop.stop()
  return port
}

async function open(port: number): Promise<ClientSocket> {
  const socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true })
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('connect_error', reject)
  })
  return socket
}

type Ack = { ok: boolean; error?: string; ticket?: { code: string; seated: number } }

describe('wallets with on-chain escrow', () => {
  const broke = newWallet()
  const checked: string[] = []
  const policy: WalletPolicy = {
    isAddress: isWalletAddress,
    isFunded: async (wallet) => {
      checked.push(wallet)
      return wallet !== broke
    },
  }

  it('requires a wallet that parses as a signing Solana address', async () => {
    const port = await start(policy)
    const socket = await open(port)
    const pda = PublicKey.findProgramAddressSync([Buffer.from('match')], Keypair.generate().publicKey)[0].toBase58()

    for (const wallet of [undefined, null, '', 'not-a-key', 'x'.repeat(44), pda, PublicKey.default.toBase58()]) {
      const ack = (await socket.emitWithAck('CREATE_LOBBY', { name: 'Ada', ...(wallet === undefined ? {} : { wallet }) })) as Ack
      expect(ack, `wallet ${String(wallet)}`).toEqual({ ok: false, error: 'INVALID_PAYLOAD' })
    }
    const created = (await socket.emitWithAck('CREATE_LOBBY', { name: 'Ada', wallet: newWallet() })) as Ack
    expect(created.ok).toBe(true)

    const joiner = await open(port)
    expect(await joiner.emitWithAck('JOIN_LOBBY', { code: created.ticket?.code, name: 'Bo' })).toEqual({
      ok: false,
      error: 'INVALID_PAYLOAD',
    })
  }, 30_000)

  it('refuses an unfunded wallet with WALLET_UNFUNDED and seats nobody', async () => {
    const port = await start(policy)
    const ada = await open(port)
    expect(await ada.emitWithAck('CREATE_LOBBY', { name: 'Ada', wallet: broke })).toEqual({
      ok: false,
      error: 'WALLET_UNFUNDED',
    })
    expect(server?.lobby.open()).toEqual([])

    const created = (await ada.emitWithAck('CREATE_LOBBY', { name: 'Ada', wallet: newWallet() })) as Ack
    const bo = await open(port)
    expect(await bo.emitWithAck('JOIN_LOBBY', { code: created.ticket?.code, name: 'Bo', wallet: broke })).toEqual({
      ok: false,
      error: 'WALLET_UNFUNDED',
    })
    expect(server?.lobby.open()[0]?.seats).toHaveLength(1)
    expect(checked).toContain(broke)
  }, 30_000)

  it('refuses a wallet already seated in the lobby with WALLET_TAKEN', async () => {
    const port = await start(policy)
    const wallet = newWallet()
    const created = (await (await open(port)).emitWithAck('CREATE_LOBBY', { name: 'Ada', wallet })) as Ack
    expect(await (await open(port)).emitWithAck('JOIN_LOBBY', { code: created.ticket?.code, name: 'Bo', wallet })).toEqual({
      ok: false,
      error: 'WALLET_TAKEN',
    })
  }, 30_000)

  it('answers ESCROW_FAILED, rather than never, when the balance cannot be read', async () => {
    const port = await start({
      isAddress: isWalletAddress,
      isFunded: async () => {
        throw new Error('429 Too Many Requests')
      },
    })
    expect(await (await open(port)).emitWithAck('CREATE_LOBBY', { name: 'Ada', wallet: newWallet() })).toEqual({
      ok: false,
      error: 'ESCROW_FAILED',
    })
  }, 30_000)
})

describe('wallets with the fake escrow', () => {
  it('stay optional, and any string is accepted unchecked as before', async () => {
    const port = await start()
    const socket = await open(port)
    expect(((await socket.emitWithAck('CREATE_LOBBY', { name: 'Ada' })) as Ack).ok).toBe(true)
    const created = (await socket.emitWithAck('CREATE_LOBBY', { name: 'Ada', wallet: 'not-a-key' })) as Ack
    expect(created.ok).toBe(true)
    expect(((await (await open(port)).emitWithAck('JOIN_LOBBY', { code: created.ticket?.code, name: 'Bo', wallet: 'not-a-key' })) as Ack).ok).toBe(
      true,
    )
  }, 30_000)
})
