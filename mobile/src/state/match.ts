import type {
  BoardView,
  ChatMessage,
  LaneSnapshot,
  MatchConfig,
  MatchEndError,
  MatchEndView,
  PlayerId,
  PlayerSnapshot,
  PrivateView,
  Resolution,
  RevealedVoteRound,
  Settlement,
  Side,
  Stage,
  Tier,
  TraceResult,
  VoteTarget,
} from '../../protocol/generated'

// CLAUDE.md: the last authoritative snapshot from the server, written only by socket messages —
// or, in a dev rehearsal, by the loopback, which writes through the same doors. It must never be
// merged with state/optimistic.ts.
//
// This module holds no prediction and applies no rules. It is a record of what the server last
// said, nothing more.
//
// `you.role` is here because MATCH_STARTED delivers it and the Marking needs it. Nothing in this
// module logs, and nothing that reads the snapshot may log it either — hard rule 4.

export type MatchSnapshot = {
  matchId: string
  /** The envelope tick of the last message applied. */
  serverTick: number
  /** From MATCH_STARTED only; never sent again. */
  config: MatchConfig
  you: { id: PlayerId; role: Side }
  round: number
  stage: Stage
  secondsLeft: number
  stageEndsAtTick: number
  lanes: LaneSnapshot[]
  boardTotal: number
  players: PlayerSnapshot[]
  /** This player's authoritative credits, spend and stored tier, from CREDITS. */
  credits: number
  spent: number
  tier: Tier
  /** Accumulated locally from CHAT_MESSAGE; RESUME_STATE replaces it with the backlog. */
  chat: ChatMessage[]
  /** Every resolved vote, oldest first: RESUME_STATE's history, plus each VOTE_RESULT since. */
  voteHistory: RevealedVoteRound[]
  /** This player's vote in the current vote stage, as the server last reported it (views only). */
  currentVote: VoteTarget | null
  /** This player's Augury readings: the view's on a resume, plus each TRACE_RESULT since. */
  traces: { target: PlayerId; result: TraceResult }[]
  /** Whether this player has spent their Augury, from the view; a TRACE_RESULT also sets it. */
  traceUsed: boolean
  /**
   * The Hollow's private running toll: SIPHON_RESULT's `destroyed`, summed. Only a total — hard
   * rule 1 forbids keeping or showing which conduit fed which.
   */
  tollTaken: number
  resolution: Resolution | null
  /** Set by MATCH_END. */
  ended: boolean
  /**
   * MATCH_END's payload: the reveal and settlement, or the error when the match could not be
   * settled. Null until it arrives — and on a resume into a match that has already resolved, where
   * the view carries the resolution but MATCH_END, sent once to the room, was missed.
   */
  end: MatchEnd | null
}

/** MATCH_END without its envelope. */
export type MatchEnd = { reveal: MatchEndView; settlement: Settlement } | { error: MatchEndError }

export type MatchStore = {
  snapshot: () => MatchSnapshot | null
  /** MATCH_STARTED and RESUME_STATE: the whole private view, applied wholesale. */
  applyView: (view: PrivateView, serverTick: number) => void
  /** BOARD_UPDATE. */
  applyBoard: (board: BoardView, serverTick: number) => void
  /** CREDITS. */
  applyCredits: (credits: { credits: number; spent: number; tier: Tier }, serverTick: number) => void
  /** STAGE_CHANGE — the edge. BOARD_UPDATE carries the stage every tick as well. */
  applyStageChange: (change: { round: number; stage: Stage; endsAtTick: number }, serverTick: number) => void
  /** Appends unless the same message is already held — a backlog and a live push can overlap. */
  appendChat: (message: ChatMessage) => void
  /** VOTE_RESULT. */
  applyVoteResult: (result: RevealedVoteRound, serverTick: number) => void
  /** TRACE_RESULT, sent to the purchaser alone. */
  applyTraceResult: (trace: { target: PlayerId; result: TraceResult }) => void
  /** SIPHON_RESULT, sent to the Hollow alone. Only `destroyed` is kept. */
  applySiphonDestroyed: (destroyed: number) => void
  /** MATCH_END. */
  applyEnd: (end: MatchEnd) => void
  clear: () => void
  laneUnits: (owner: PlayerId) => number
  subscribe: (listener: () => void) => () => void
}

/** Ticks per second, per PROTOCOL.md §7: one tick is 250ms. */
const TICKS_PER_SEC = 4

export function createMatchStore(): MatchStore {
  let snapshot: MatchSnapshot | null = null
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }

  // Everything below requires a view first. A board or credit message with no match in hand is a
  // stale delivery from a match this client has left, and is dropped.
  const update = (patch: Partial<MatchSnapshot>) => {
    if (snapshot === null) return
    snapshot = { ...snapshot, ...patch }
    notify()
  }

  return {
    snapshot() {
      return snapshot
    },

    applyView(view, serverTick) {
      snapshot = {
        matchId: view.matchId,
        serverTick,
        config: view.config,
        you: { id: view.you.id, role: view.you.role },
        round: view.round,
        stage: view.stage,
        // The view carries the end tick, not a countdown. BOARD_UPDATE replaces this within 250ms.
        secondsLeft: Math.max(0, Math.ceil((view.stageEndsAtTick - serverTick) / TICKS_PER_SEC)),
        stageEndsAtTick: view.stageEndsAtTick,
        lanes: view.lanes,
        boardTotal: view.boardTotal,
        players: view.players,
        credits: view.you.credits,
        spent: view.you.spent,
        tier: view.you.tier,
        chat: view.chat,
        voteHistory: view.voteHistory,
        currentVote: view.currentVote,
        traces: view.traces.map(({ target, result }) => ({ target, result })),
        traceUsed: view.you.traceUsed,
        tollTaken: view.siphonActivity?.destroyed ?? 0,
        resolution: view.resolution,
        ended: view.resolution !== null,
        end: null,
      }
      notify()
    },

    applyBoard(board, serverTick) {
      update({
        serverTick,
        round: board.round,
        stage: board.stage,
        secondsLeft: board.secondsLeft,
        lanes: board.lanes,
        boardTotal: board.boardTotal,
        players: board.players,
      })
    },

    applyCredits({ credits, spent, tier }, serverTick) {
      update({ serverTick, credits, spent, tier })
    },

    applyStageChange({ round, stage, endsAtTick }, serverTick) {
      update({ serverTick, round, stage, stageEndsAtTick: endsAtTick })
    },

    appendChat(message) {
      if (snapshot === null) return
      // One message per player per 2s, so sender and tick identify a message exactly.
      const held = snapshot.chat.some(
        (m) => m.from === message.from && m.tick === message.tick && m.text === message.text,
      )
      if (held) return
      update({ chat: [...snapshot.chat, message] })
    },

    applyVoteResult(result, serverTick) {
      if (snapshot === null) return
      if (snapshot.voteHistory.some((r) => r.round === result.round)) return
      update({ serverTick, voteHistory: [...snapshot.voteHistory, result], currentVote: null })
    },

    applyTraceResult(trace) {
      if (snapshot === null) return
      update({ traces: [...snapshot.traces, trace], traceUsed: true })
    },

    applySiphonDestroyed(destroyed) {
      if (snapshot === null) return
      update({ tollTaken: snapshot.tollTaken + destroyed })
    },

    applyEnd(end) {
      update({ ended: true, end })
    },

    clear() {
      snapshot = null
      notify()
    },

    laneUnits(owner) {
      return snapshot?.lanes.find((lane) => lane.owner === owner)?.units ?? 0
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
