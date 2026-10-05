import { useKeepAwake } from 'expo-keep-awake'
import { Redirect, router } from 'expo-router'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BackHandler, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { PlayerId, Tier } from '../../protocol/generated'
import { Board } from '../art/Board'
import { Marking } from '../art/Marking'
import type { SeatNumber } from '../art/Sigil'
import { motion } from '../design/motion'
import { tokens } from '../design/tokens'
import { BATCH_INTERVAL_MS } from '../net/outbox'
import { DEV_TOOLS, match, session } from '../net/session'
import type { MatchSnapshot } from '../state/match'
import { createOptimisticStore } from '../state/optimistic'
import { Council } from './Council'
import { Judgement } from './Judgement'
import { LiveHeader, Offering, usePolled } from './Offering'
import { ActionSheet } from './ActionSheet'
import { RulesSheet } from './RulesSheet'
import { Reveal } from './Reveal'

// /match — one screen for the whole rite, driven by the server's stage. The board is mounted once
// per match and never remounts: Offering, Council and Judgement change only the lower region, and
// the Marking plays over the board rather than in front of a navigation.
//
// Two stores, kept apart per CLAUDE.md: state/match.ts is what the server last said, written by
// net/session.ts; state/optimistic.ts is this player's prediction, written by the tap handler.
// Reconciliation, below, is the only place the two meet.

/**
 * Taps stop this many ticks before the stage's end tick. A batch is applied on the tick after it
 * arrives, and the server drains queued taps before it closes the stage, so a batch that reaches it
 * before the closing tick still lands (../server/src/engine/step.ts:43-57). The margin is the
 * network's allowance: the last BOARD_UPDATE is already half a round trip old, and a batch then
 * waits up to one batch interval and travels another half. Against the hosted server (~350ms round
 * trip) one tick let the final batch arrive after the boundary and come back WRONG_STAGE, which a
 * well-behaved client never sees; three ticks covers it. One tick was enough on localhost only.
 */
const STAGE_CLOSE_MARGIN_TICKS = 3

const readMatchId = () => match.snapshot()?.matchId ?? null

export function MatchScreen() {
  // A new match — or a restarted rehearsal — gets a fresh screen. Within a match, nothing remounts.
  const matchId = usePolled(readMatchId)
  const snapshot = match.snapshot()
  if (matchId === null || snapshot === null) return <Redirect href="/" />
  return <MatchLive key={matchId} initial={snapshot} />
}

function MatchLive({ initial }: { initial: MatchSnapshot }) {
  useKeepAwake()
  const insets = useSafeAreaInsets()
  const youId = initial.you.id
  const { config } = initial

  const [prediction] = useState(() => {
    const store = createOptimisticStore(config, initial.credits)
    store.setTier(initial.tier)
    store.rebase({ credits: initial.credits, ownUnits: match.laneUnits(youId) })
    return store
  })

  // One shared value per lane: what its conduit displays. Written by the tap handler (own lane,
  // instantly) and by reconciliation (every lane, as a lerp), and nothing else.
  const [laneUnits] = useState(() => {
    const values: Record<PlayerId, SharedValue<number>> = {}
    for (const lane of initial.lanes) values[lane.owner] = makeMutable(lane.units)
    return values
  })
  // The value each lane was last sent toward, so reconciliation picks rise or fall without
  // reading a shared value back from the UI thread.
  const lastTarget = useRef<Record<PlayerId, number>>(Object.fromEntries(initial.lanes.map((l) => [l.owner, l.units])))

  // Seat numbers follow the lane order the wire gives (by playerId), the same on every client.
  const [seats] = useState(
    () =>
      Object.fromEntries(initial.lanes.map((lane, i) => [lane.owner, (i + 1) as SeatNumber])) as Record<
        PlayerId,
        SeatNumber
      >,
  )

  const [marking, setMarking] = useState(() => session.takeMarking())

  // -- Reconciliation, per hard rule 2 ------------------------------------------------------------

  useEffect(() => {
    let resumed = false
    const offResume = session.onResume(() => {
      // RESUME_STATE replaces everything. Taps made before the socket dropped are forgotten
      // rather than sent late into a view that may no longer be the tap stage.
      prediction.takePending()
      resumed = true
    })

    const reconcile = () => {
      const snapshot = match.snapshot()
      if (snapshot === null || snapshot.matchId !== initial.matchId) return
      if (resumed) {
        prediction.setTier(snapshot.tier)
        resumed = false
      }
      // CREDITS and the own lane are authoritative. Rebase on them plus whatever has not been sent.
      prediction.rebase({ credits: snapshot.credits, ownUnits: match.laneUnits(youId) })
      const predictedOwn = prediction.snapshot().ownUnits
      for (const lane of snapshot.lanes) {
        const value = laneUnits[lane.owner]
        if (value === undefined) continue
        const target = lane.owner === youId ? predictedOwn : lane.units
        const last = lastTarget.current[lane.owner]
        if (target === last) continue
        lastTarget.current[lane.owner] = target
        // Every lane lerps, none snap. Rising 250ms linear, falling 400ms ease-out.
        value.set(withTiming(target, target > last ? motion.transition.frontierRise : motion.transition.frontierFall))
      }
    }

    const offMatch = match.subscribe(reconcile)
    return () => {
      offMatch()
      offResume()
    }
  }, [prediction, laneUnits, youId, initial.matchId])

  // -- Batching ----------------------------------------------------------------------------------

  const flush = useCallback(() => {
    const count = prediction.takePending()
    if (count === 0) return
    const snapshot = match.snapshot()
    // Past the boundary the taps are dropped here, and the next rebase settles them back.
    if (snapshot === null || snapshot.stage !== 'tap' || snapshot.serverTick >= snapshot.stageEndsAtTick - 1) return
    session.sendTaps(prediction.tier(), count)
  }, [prediction])

  useEffect(() => {
    const id = setInterval(flush, BATCH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [flush])

  // -- Input -------------------------------------------------------------------------------------

  const canTap = useCallback(() => {
    const s = match.snapshot()
    if (s === null || s.ended || s.stage !== 'tap') return false
    // §7.9: with the socket gone the board is frozen, and so is this player's lane on the server.
    if (!session.isRehearsal() && session.status() !== 'online') return false
    if (s.serverTick >= s.stageEndsAtTick - STAGE_CLOSE_MARGIN_TICKS) return false
    return s.players.find((p) => p.id === youId)?.status === 'alive'
  }, [youId])

  const onPredicted = useCallback(
    (units: number) => {
      lastTarget.current[youId] = units
    },
    [youId],
  )

  const onTierPress = useCallback(() => {
    // Taps made at the old tier leave as their own batch before the change takes effect.
    flush()
    const next: Tier = prediction.tier() === 1 ? 2 : 1
    prediction.setTier(next)
    session.setTier(next)
  }, [flush, prediction])

  // -- What React needs to see: rare edges only, never per tick ------------------------------------

  const readStage = useCallback(() => match.snapshot()?.stage ?? 'tap', [])
  const readEnded = useCallback(() => match.snapshot()?.ended ?? false, [])
  const readOwnStatus = useCallback(
    () => match.snapshot()?.players.find((p) => p.id === youId)?.status ?? 'alive',
    [youId],
  )
  // Dormancy and disconnection, as one string, so the board re-renders only when either changes.
  const readShape = useCallback(() => {
    const s = match.snapshot()
    if (s === null) return ''
    const dormant = s.lanes.map((l) => (l.dormant ? '1' : '0')).join('')
    const away = s.players.map((p) => (p.status === 'disconnected' ? '1' : '0')).join('')
    return `${dormant}|${away}`
  }, [])
  const readRound = useCallback(() => match.snapshot()?.round ?? initial.round, [initial.round])
  const readSecondsLeft = useCallback(() => match.snapshot()?.secondsLeft ?? 0, [])
  const readTotal = useCallback(() => {
    const s = match.snapshot()
    if (s === null) return 0
    const others = s.lanes.reduce((sum, lane) => (lane.owner === youId ? sum : sum + lane.units), 0)
    return others + prediction.snapshot().ownUnits
  }, [youId, prediction])
  const readCrossed = useCallback(() => readTotal() >= config.winTarget, [readTotal, config.winTarget])

  const readVoteCount = useCallback(() => match.snapshot()?.voteHistory.length ?? 0, [])
  const readOnline = useCallback(() => session.isRehearsal() || session.status() === 'online', [])

  const stage = usePolled(readStage)
  const ended = usePolled(readEnded)
  const ownStatus = usePolled(readOwnStatus)
  usePolled(readShape)
  const crossed = usePolled(readCrossed)
  const voteCount = usePolled(readVoteCount)
  const online = usePolled(readOnline)

  // -- The Reveal ----------------------------------------------------------------------------------
  //
  // Results already in hand when this screen mounted, or that arrived while the socket was away,
  // are history: they are not replayed. Only a VOTE_RESULT received live plays the Reveal.
  const [revealed, setRevealed] = useState(initial.voteHistory.length)
  const [resolved, setResolved] = useState(false)
  const resumedAt = useRef(false)
  useEffect(() => session.onResume(() => (resumedAt.current = true)), [])
  useEffect(() => {
    if (resumedAt.current) {
      resumedAt.current = false
      setRevealed(voteCount)
    }
  }, [voteCount])

  const current = match.snapshot() ?? initial
  const reveal = voteCount > revealed ? (current.voteHistory[revealed] ?? null) : null

  // -- The end ------------------------------------------------------------------------------------
  //
  // MATCH_END can land mid-Reveal — a Hollow cast out ends the rite on the same tick — so the
  // Reveal and its Cast Out play out first. Then the final board holds for `endHold` and the screen
  // gives way: the Reckoning, or §7.9's broken state for a rite that was voided or could not be
  // settled. A resume into a rite that resolved while this phone was away has no MATCH_END to show,
  // so it goes home and says only that the rite is over.
  const revealing = reveal !== null
  useEffect(() => {
    if (!ended || revealing) return
    const id = setTimeout(() => {
      const end = match.snapshot()?.end ?? null
      if (__DEV__)
        console.log('[ui] end', end === null ? 'none' : 'error' in end ? 'error' : end.reveal.resolution.kind)
      if (end === null) {
        session.leave()
        router.replace({ pathname: '/', params: { notice: 'ended' } })
      } else if ('error' in end || end.reveal.resolution.kind === 'voided') {
        router.replace('/broken')
      } else {
        router.replace('/reckoning')
      }
    }, motion.duration.endHold)
    return () => clearTimeout(id)
  }, [ended, revealing])

  // The server no longer knows this seat — the match is gone, most likely with a server restart.
  useEffect(
    () =>
      session.onLost(() => {
        session.leave()
        router.replace({ pathname: '/', params: { notice: 'lost' } })
      }),
    [],
  )

  // Leaving Council takes the keyboard with it.
  useEffect(() => {
    if (stage !== 'chat') Keyboard.dismiss()
  }, [stage])

  // -- The action sheet and hardware back --------------------------------------------------------

  // §7.4: the sheet belongs to the Offering it was opened in. It remembers which one, so any stage
  // change underneath it dismisses it cleanly — and reopening needs a new press.
  const stageKey = `${current.round}:${stage}`
  const [sheetFor, setSheetFor] = useState<string | null>(null)
  const sheetOpen = sheetFor === stageKey
  const setSheetOpen = useCallback((open: boolean) => setSheetFor(open ? stageKey : null), [stageKey])

  // CLAUDE.md, Android: back during a match does not exit. The first press asks, stating that the
  // stake is forfeit; a second press, or Leave, leaves. With the sheet open, back closes the sheet
  // first — it is the thing on top.
  const [confirmLeave, setConfirmLeave] = useState(false)
  // §7.1: the rules sheet can be opened at any time, from the header's rules control.
  const [rulesOpen, setRulesOpen] = useState(false)
  const openRules = useCallback(() => setRulesOpen(true), [])
  const leaveMatch = useCallback(() => {
    // There is no leave message: closing the socket is the leave, and the server's grace clock
    // does the rest. The seat is forfeit either way.
    session.leave()
    router.replace('/')
  }, [])
  // Dev only: a live board never idles, so tests read these edges from the log instead of the
  // view hierarchy.
  useEffect(() => {
    if (__DEV__) console.log('[ui] leave confirmation', confirmLeave ? 'shown' : 'hidden')
  }, [confirmLeave])
  useEffect(() => {
    if (__DEV__) console.log('[ui] sheet', sheetOpen ? 'open' : 'closed')
  }, [sheetOpen])
  useEffect(() => {
    if (__DEV__) console.log('[ui] rules', rulesOpen ? 'open' : 'closed')
  }, [rulesOpen])

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (rulesOpen) setRulesOpen(false)
      else if (sheetOpen) setSheetOpen(false)
      else if (confirmLeave) leaveMatch()
      else setConfirmLeave(true)
      return true
    })
    return () => sub.remove()
  }, [rulesOpen, sheetOpen, setSheetOpen, confirmLeave, leaveMatch])

  // Until the vote resolves on screen, the board must not announce it: BOARD_UPDATE marks the
  // ejected lane dormant on the same tick as VOTE_RESULT, so its conduit is held warm until the
  // Cast Out beat begins.
  const holdWarm = reveal !== null && !resolved ? reveal.ejected : null
  const lanes =
    holdWarm === null ? current.lanes : current.lanes.map((l) => (l.owner === holdWarm ? { ...l, dormant: false } : l))

  const disconnected = new Set(current.players.filter((p) => p.status === 'disconnected').map((p) => p.id))
  const seat = seats[youId]
  const rehearsal = session.isRehearsal()
  const alive = ownStatus === 'alive' || ownStatus === 'disconnected'
  // The sheet is the Offering's: never over a Reveal, a later stage, a cast-out player or an ended rite.
  const sheetShown = sheetOpen && stage === 'tap' && !ended && alive && reveal === null
  const compact = reveal !== null || stage !== 'tap'

  // In the Offering the lower region keeps a fixed height, so the board never reflows while tapping.
  const lowerHeight = tokens.layout.controls + tokens.layout.tapBandGap + tokens.layout.tapBand + insets.bottom

  let lower
  let lowerKey: string
  if (reveal !== null) {
    lowerKey = `reveal-${reveal.round}`
    lower = (
      <Reveal
        result={reveal}
        seats={seats}
        names={new Map(current.players.map((p) => [p.id, p.name]))}
        youId={youId}
        alreadyCold={
          new Set(current.players.filter((p) => p.status === 'ejected' && p.id !== reveal.ejected).map((p) => p.id))
        }
        config={config}
        onResolve={() => setResolved(true)}
        onDone={() => {
          setResolved(false)
          setRevealed((n) => n + 1)
        }}
      />
    )
  } else if (ended) {
    lowerKey = 'ended'
    lower = <Placeholder height={compact ? undefined : lowerHeight} title="The rite has ended." />
  } else if (!online) {
    lowerKey = 'offline'
    // §7.9: the board freezes — no update reaches it — and this says why, in the lower region
    // rather than over the board. No modal and no spinner; Socket.IO is already retrying.
    lower = (
      <Placeholder
        height={compact ? undefined : lowerHeight}
        title="The connection is lost."
        line={
          ownStatus === 'ejected'
            ? 'Trying again.'
            : 'Trying again. Return before the count beside your conduit ends, or you are cast out.'
        }
      />
    )
  } else if (stage === 'chat') {
    lowerKey = 'chat'
    // A cast-out player reads the Council but has no input at all.
    lower = <Council config={config} seats={seats} canSpeak={alive} />
  } else if (stage === 'vote') {
    lowerKey = `vote-${current.round}`
    lower = <Judgement seats={seats} round={current.round} canVote={alive} />
  } else if (!alive) {
    lowerKey = 'cast-out'
    // Cast-out players stay as spectators, with their inputs removed rather than disabled.
    lower = (
      <Placeholder height={lowerHeight} title="You are cast out." line="Your conduit is cold. The rite goes on." />
    )
  } else {
    lowerKey = 'tap'
    lower = (
      <Offering
        config={config}
        prediction={prediction}
        ownUnits={laneUnits[youId]}
        onPredicted={onPredicted}
        canTap={canTap}
        onTierPress={onTierPress}
        onAction={() => setSheetOpen(true)}
      />
    )
  }

  return (
    <View style={styles.root}>
      <Board
        lanes={lanes}
        laneUnits={laneUnits}
        config={config}
        youId={youId}
        disconnected={disconnected}
        crossed={crossed}
        compact={compact}
        ownBadge={
          !online && !ended && ownStatus !== 'ejected' ? <GraceCount graceSec={config.disconnectGraceSec} /> : undefined
        }
        header={
          <LiveHeader
            winTarget={config.winTarget}
            readRound={readRound}
            readSecondsLeft={readSecondsLeft}
            readTotal={readTotal}
            onRules={openRules}
          />
        }
      >
        <StagePanel key={lowerKey} fill={compact} bottomInset={compact ? insets.bottom : 0}>
          {lower}
        </StagePanel>
      </Board>

      {DEV_TOOLS && rehearsal ? <RehearsalStrip /> : null}

      {sheetShown ? (
        <ActionSheet
          config={config}
          youId={youId}
          seats={seats}
          laneUnits={laneUnits}
          prediction={prediction}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}

      {/* The match's own back handler closes it, so the sheet does not register a second one. */}
      {rulesOpen ? <RulesSheet onClose={() => setRulesOpen(false)} closeOnBack={false} /> : null}

      {marking ? <Marking role={initial.you.role} seat={seat} onDone={() => setMarking(false)} /> : null}

      {confirmLeave ? <LeaveConfirm onStay={() => setConfirmLeave(false)} onLeave={leaveMatch} /> : null}
    </View>
  )
}

/**
 * The lower region's entrance on every stage change: a short rise and fade over §8's stage-change
 * timing. Transform and opacity only (hard rule 3). The board above it is never part of this —
 * only its conduit area's height changes, once, at the edge.
 */
function StagePanel({ fill, bottomInset, children }: { fill: boolean; bottomInset: number; children: ReactNode }) {
  const enter = useSharedValue(0)
  useEffect(() => {
    enter.set(withTiming(1, motion.transition.stageChange))
  }, [enter])
  const style = useAnimatedStyle(() => ({
    opacity: enter.get(),
    transform: [{ translateY: (1 - enter.get()) * tokens.layout.stackGap * 2 }],
  }))
  // The Offering's band already runs under the gesture bar; the compact stages keep clear of it.
  return (
    <Animated.View style={[fill ? styles.fill : null, { paddingBottom: bottomInset }, style]}>{children}</Animated.View>
  )
}

/**
 * CLAUDE.md, Android: back during a match asks first, and says what leaving costs. §8's overlay
 * timing; the board stays visible behind it.
 */
function LeaveConfirm({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const open = useSharedValue(0)
  useEffect(() => {
    open.set(withTiming(1, motion.transition.overlay))
  }, [open])
  const backdrop = useAnimatedStyle(() => ({ opacity: open.get() * tokens.art.sheetBackdropOpacity }))
  const panel = useAnimatedStyle(() => ({
    opacity: open.get(),
    transform: [{ scale: motion.overlayScaleFrom + (1 - motion.overlayScaleFrom) * open.get() }],
  }))
  return (
    <View style={[StyleSheet.absoluteFill, styles.confirmRoot]} accessibilityViewIsModal>
      <Animated.View style={[StyleSheet.absoluteFill, styles.confirmBackdrop, backdrop]} />
      <Animated.View style={[styles.confirmPanel, panel]}>
        <Text style={styles.confirmTitle}>Leave the rite?</Text>
        <Text style={styles.confirmLine}>Your stake is forfeit. The rite goes on without you.</Text>
        <View style={styles.confirmRow}>
          <Pressable onPress={onStay} accessibilityRole="button" accessibilityLabel="Stay" style={styles.confirmButton}>
            <Text style={styles.confirmLabel}>Stay</Text>
          </Pressable>
          <Pressable
            onPress={onLeave}
            accessibilityRole="button"
            accessibilityLabel="Leave and forfeit the stake"
            style={styles.confirmButton}
          >
            <Text style={styles.confirmLabel}>Leave</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  )
}

/**
 * §7.9's countdown beside the player's own token: how long the seat has to come back before its
 * grace runs out. Polled, so only this leaf re-renders, and only while the socket is gone.
 */
function GraceCount({ graceSec }: { graceSec: number }) {
  const read = useCallback(() => session.graceLeftSec(graceSec) ?? graceSec, [graceSec])
  const left = usePolled(read)
  return (
    <Text style={styles.graceCount} accessibilityLabel={`${left} seconds to return`}>
      {`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
    </Text>
  )
}

function Placeholder({ height, title, line }: { height?: number; title: string; line?: string }) {
  return (
    <View style={[styles.placeholder, height === undefined ? styles.fill : { height }]}>
      <Text style={styles.placeholderTitle}>{title}</Text>
      {line === undefined ? null : <Text style={styles.placeholderLine}>{line}</Text>}
    </View>
  )
}

// -------------------------------------------------------------------------------------------------
// Dev rehearsal tools — only while the loopback is standing in for the server
// -------------------------------------------------------------------------------------------------

function RehearsalStrip() {
  const insets = useSafeAreaInsets()
  // Local, so toggling it re-renders the chip and not the screen.
  const [drop, setDrop] = useState(false)
  return (
    <View style={[styles.devStrip, { top: insets.top + tokens.layout.header }]}>
      <DevChip
        label="drop 30%"
        selected={drop}
        onPress={() => {
          session.setRehearsalDrop(!drop)
          setDrop(!drop)
        }}
      />
      <DevChip label="reset" selected={false} onPress={() => session.startRehearsal()} />
      <DevChip label="dump" selected={false} onPress={() => session.dumpRehearsalOutbox()} />
      <DevChip label="end: error" selected={false} onPress={() => session.endRehearsalWithError()} />
    </View>
  )
}

function DevChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.devChip, selected ? styles.devChipSelected : null]}
    >
      <Text style={styles.devLabel}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  confirmRoot: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.layout.screenGutter,
  },
  confirmBackdrop: {
    backgroundColor: tokens.palette.void,
  },
  confirmPanel: {
    ...tokens.material.raisedStoneFace,
    borderRadius: tokens.radii.panel,
    alignSelf: 'stretch',
    padding: tokens.layout.screenGutter,
    gap: tokens.layout.stackGap,
  },
  confirmTitle: {
    ...tokens.type.stage,
    color: tokens.palette.bone,
  },
  confirmLine: {
    ...tokens.type.body,
    color: tokens.palette.boneDim,
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: tokens.layout.stackGap,
  },
  confirmButton: {
    ...tokens.material.insetStoneFace,
    borderRadius: tokens.radii.chip,
    minHeight: tokens.layout.minTouchTarget,
    paddingHorizontal: tokens.layout.screenGutter,
    justifyContent: 'center',
  },
  confirmLabel: {
    ...tokens.type.control,
    color: tokens.palette.bone,
  },
  graceCount: {
    ...tokens.type.data,
    ...tokens.tabularFigures,
    color: tokens.palette.bone,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.layout.stackGap,
    paddingHorizontal: tokens.layout.screenGutter,
  },
  // Stretched to the full width: shrink-wrapped inside the centred column, Android measured the
  // Grenze Gotisch title short and clipped its last word ("You are cast" on the phone, item 4).
  placeholderTitle: {
    alignSelf: 'stretch',
    ...tokens.type.stage,
    color: tokens.palette.bone,
    textAlign: 'center',
  },
  placeholderLine: {
    alignSelf: 'stretch',
    ...tokens.type.body,
    color: tokens.palette.boneDim,
    textAlign: 'center',
  },
  // Stone tones only, never fire.
  devStrip: {
    position: 'absolute',
    left: tokens.art.conduitOuterMargin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.art.conduitGap,
  },
  devChip: {
    paddingHorizontal: tokens.art.conduitGap,
    height: tokens.layout.minTouchTarget,
    justifyContent: 'center',
    borderRadius: tokens.radii.chip,
    ...tokens.material.raisedStoneFace,
  },
  devChipSelected: {
    ...tokens.material.insetStoneFace,
  },
  devLabel: {
    ...tokens.type.label,
    color: tokens.palette.boneDim,
  },
})
