import { afterEach, describe, expect, it } from 'vitest'
import { silentLogger } from '../../src/log.js'
import { createGameServer, type GameServer } from '../../src/net/server.js'

let server: GameServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

describe('GET /health', () => {
  it('returns a JSON liveness response', async () => {
    server = createGameServer({ logger: silentLogger })
    const url = `http://127.0.0.1:${await server.listen(0)}/health`

    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('only accepts GET requests', async () => {
    server = createGameServer({ logger: silentLogger })
    const url = `http://127.0.0.1:${await server.listen(0)}/health`

    const response = await fetch(url, { method: 'POST' })
    expect(response.status).toBe(404)
  })
})