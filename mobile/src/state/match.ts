import type {
  BoardView,
  ChatMessage,
  LaneSnapshot,
  MatchConfig,
  PlayerId,
  PlayerSnapshot,
  PrivateView,
  Resolution,
  Side,
  Stage,
  Tier,
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
  resolution: Resolution | null
  /** Set by MATCH_END. */
  ended: boolean
}

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
  appendChat: (message: ChatMessage) => void
  applyEnd: () => void
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
        resolution: view.resolution,
        ended: view.resolution !== null,
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
      update({ chat: [...snapshot.chat, message] })
    },

    applyEnd() {
      update({ ended: true })
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
