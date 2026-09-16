import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { MatchConfig } from '../../src/engine/config.js'
import type { PayloadSchemas, Rejection, RejectionCode } from '../../src/engine/events.js'
import type { MatchEndPayloadError } from '../../src/engine/match-end.js'
import type {
  BoardView,
  MatchEndView,
  PrivateView,
  PublicView,
  RevealedVoteRound,
  SiphonActivity,
} from '../../src/engine/selectors.js'
import type { Settlement, SettlementLine } from '../../src/engine/settlement.js'
import type { ChatMessage, Resolution } from '../../src/engine/state.js'
import type { JoinTicket, LobbyError } from '../../src/match/lobby.js'
import type { JoinError } from '../../src/net/handlers.js'
import { GAME_EVENTS } from '../../src/net/handlers.js'
import { CLIENT_EVENTS, GENERATED_PATH, SERVER_EVENTS, emitProtocol } from '../../src/protocol/emit.js'
import type * as G from '../../../mobile/protocol/generated.js'

// Two guards, and they catch different things.
//
// 1. The committed file is byte-identical to what the emitter produces, so nobody can hand-edit
//    mobile/protocol/generated.ts or forget to regenerate after changing the emitter.
// 2. Every generated type is mutually assignable with the server type it mirrors. This is the one
//    that matters: change a selector and this file stops compiling, which is exactly when someone
//    should be forced to look at the wire contract.
//
// What (2) does not catch: `a?: X` against `a: X | undefined`. Everything else — a renamed field, a
// dropped field, a widened union — fails.

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const same = <_Proof extends true>(): void => {}

type Infer<K extends keyof typeof PayloadSchemas> = z.infer<(typeof PayloadSchemas)[K]>

// ---- client -> server payloads, against the Zod schemas the server actually validates with ----
same<MutuallyAssignable<G.TapBatchPayload, Infer<'TAP_BATCH'>>>()
same<MutuallyAssignable<G.SetTierPayload, Infer<'SET_TIER'>>>()
same<MutuallyAssignable<G.SiphonPayload, Infer<'SIPHON'>>>()
same<MutuallyAssignable<G.TracePayload, Infer<'TRACE'>>>()
same<MutuallyAssignable<G.ChatPayload, Infer<'CHAT'>>>()
same<MutuallyAssignable<G.VotePayload, Infer<'VOTE'>>>()

// ---- views, against the selectors ----
same<MutuallyAssignable<G.BoardView, BoardView>>()
same<MutuallyAssignable<G.PublicView, PublicView>>()
same<MutuallyAssignable<G.PrivateView, PrivateView>>()
same<MutuallyAssignable<G.MatchEndView, MatchEndView>>()
same<MutuallyAssignable<G.RevealedVoteRound, RevealedVoteRound>>()
same<MutuallyAssignable<G.SiphonActivity, SiphonActivity>>()
same<MutuallyAssignable<G.ChatMessage, ChatMessage>>()
same<MutuallyAssignable<G.Resolution, Resolution>>()
same<MutuallyAssignable<G.MatchConfig, MatchConfig>>()

// ---- settlement and lobby ----
same<MutuallyAssignable<G.Settlement, Settlement>>()
same<MutuallyAssignable<G.SettlementLine, SettlementLine>>()
same<MutuallyAssignable<G.JoinTicket, JoinTicket>>()

// ---- error and rejection unions ----
same<MutuallyAssignable<G.RejectionCode, RejectionCode>>()
same<MutuallyAssignable<G.LobbyError, LobbyError>>()
same<MutuallyAssignable<G.JoinError, JoinError>>()
same<MutuallyAssignable<G.MatchEndError, MatchEndPayloadError>>()

// ACTION_REJECTED is assembled by hand in broadcast.ts rather than being a Rejection, so pin the
// three fields that come from one.
same<MutuallyAssignable<G.ActionRejectedMessage['code'] | Rejection['code'], G.ActionRejectedMessage['code']>>()
same<MutuallyAssignable<G.ActionRejectedMessage['reason'], Rejection['reason']>>()

describe('mobile/protocol/generated.ts', () => {
  const committed = (): string => readFileSync(GENERATED_PATH, 'utf8')

  it('is exactly what the emitter produces', () => {
    expect(committed()).toBe(emitProtocol())
  })

  it('says it is generated, and imports nothing', () => {
    const source = committed()
    expect(source).toContain('DO NOT EDIT BY HAND')
    // Self-contained: the mobile package must never compile a path back into the server.
    expect(source).not.toMatch(/^\s*import\s/m)
  })

  it('declares types only, so it contributes no runtime code', () => {
    // Also a hard constraint, not just a preference: mobile has no "type": "module", so under
    // NodeNext this file is CommonJS and a top-level `export const` fails to compile there.
    expect(committed()).not.toMatch(/^export (const|function|class|let|var|enum)\s/m)
  })

  it('covers every game message the server wires up', () => {
    for (const event of GAME_EVENTS) expect(CLIENT_EVENTS).toContain(event)
    expect(CLIENT_EVENTS).toEqual(['CREATE_LOBBY', 'JOIN_LOBBY', 'JOIN', ...GAME_EVENTS, 'HEARTBEAT'])
  })

  it('documents every message in docs/PROTOCOL.md', () => {
    const doc = readFileSync(new URL('../../../docs/PROTOCOL.md', import.meta.url), 'utf8')
    const undocumented = [...CLIENT_EVENTS, ...SERVER_EVENTS].filter((event) => !doc.includes(event))
    expect(undocumented).toEqual([])
  })
})
