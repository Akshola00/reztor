import * as Haptics from 'expo-haptics'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import type { MatchConfig, PlayerId, TraceResult } from '../../protocol/generated'
import { SeatToken } from '../art/SeatToken'
import type { SeatNumber } from '../art/Sigil'

import { EnergyMark } from '../art/ControlMarks'
import { motion } from '../design/motion'
import { tokens } from '../design/tokens'
import { fit } from '../design/fit'
import { match, session } from '../net/session'
import type { OptimisticStore } from '../state/optimistic'
import { usePolled } from './Offering'
import { Sheet } from './Sheet'

// §7.4's sheet, as the owner's UI pass amends it: one bottom sheet, opened from either of the
// controls row's two icon buttons. Inspect opens Augury, the same for every role. Drain opens the
// Draw for the Hollow, and for the Faithful a short panel saying the rite gives them no such hand.
// The closed board is identical for every role (hard rule 4) — both buttons are always there, alike
// — so role shows only once a sheet is open, on the screen of the player who opened it.
//
// Every rule the server would refuse is checked here first, so neither TRACE nor SIPHON is ever
// sent to be rejected: the round-1 Augury, a second Augury, short credits, a source below the
// pull, a sink without room for the delivery, a frozen (disconnected) lane, the same lane at both
// ends, and the Draw's rate.
//
// **Hard rule 1 holds here too.** The Draw's two rows are chosen by the Hollow, but nothing drawn
// connects them — no line, no arrow, no paired flash. After a Draw the sheet shows one thing: the
// running toll, a single number. SIPHON_RESULT's source and sink are never kept (net/session.ts).

// §1.1's exact Inspect wording.
const READING: Record<TraceResult, string> = {
  natural: 'Filled by their own taps',
  received: 'Received from another lane',
  drained: 'Drained by someone',
}

type ActionSheetProps = {
  config: MatchConfig
  youId: PlayerId
  seats: Record<PlayerId, SeatNumber>
  laneUnits: Record<PlayerId, SharedValue<number>>
  prediction: OptimisticStore
  /** Which button opened it. */
  kind: SheetKind
  onClose: () => void
}

export type SheetKind = 'inspect' | 'drain'

// The lanes, owners' statuses and this player's readings, as one string, so the sheet re-renders
// only when one of them changes — never per tap, at most every readout interval.
const readShape = () => {
  const s = match.snapshot()
  if (s === null) return ''
  const lanes = s.lanes.map((l) => `${l.owner}:${l.units}`).join(',')
  const away = s.players.map((p) => `${p.id}:${p.status}`).join(',')
  return `${s.round}|${lanes}|${away}|${s.traces.length}|${s.traceUsed ? 1 : 0}|${s.tollTaken}`
}

export function ActionSheet({ config, youId, seats, laneUnits, prediction, kind, onClose }: ActionSheetProps) {
  usePolled(readShape)
  const readCredits = useCallback(() => prediction.snapshot().credits, [prediction])
  const credits = usePolled(readCredits)
  const snapshot = match.snapshot()

  if (snapshot === null) return null
  const hollow = snapshot.you.role === 'impostor'
  const owners = snapshot.lanes.map((l) => l.owner).filter((id) => seats[id] !== undefined)
  const names = new Map(snapshot.players.map((p) => [p.id, p.name]))

  return (
    <Sheet onClose={onClose}>
      {kind === 'inspect' ? (
        <Augury config={config} owners={owners} seats={seats} names={names} credits={credits} />
      ) : hollow ? (
        <Draw
          config={config}
          youId={youId}
          owners={owners}
          seats={seats}
          names={names}
          laneUnits={laneUnits}
          credits={credits}
        />
      ) : (
        <Section title="Drain">
          <Text style={styles.note}>Only the Hollow can drain. The rite gives you no such hand.</Text>
        </Section>
      )}
    </Sheet>
  )
}

// -------------------------------------------------------------------------------------------------
// Augury
// -------------------------------------------------------------------------------------------------

function Augury({
  config,
  owners,
  seats,
  names,
  credits,
}: {
  config: MatchConfig
  owners: PlayerId[]
  seats: Record<PlayerId, SeatNumber>
  names: Map<PlayerId, string>
  credits: number
}) {
  const s = match.snapshot()
  const [sent, setSent] = useState(false)
  if (s === null) return null
  const cost = config.trace.cost
  const reading = s.traces[s.traces.length - 1]

  // One Augury per match (config.trace.perPlayer is 1): once read, the result card is all there is,
  // for the rest of the match.
  if (reading !== undefined) {
    const seat = seats[reading.target]
    return (
      <Section title="Inspect">
        <View
          style={styles.card}
          accessible
          accessibilityLabel={`Inspected ${names.get(reading.target) ?? ''}: ${READING[reading.result]}`}
        >
          {seat === undefined ? null : (
            <SeatToken seat={seat} disc={tokens.art.tokenDisc} sigil={tokens.art.tokenSigil} />
          )}
          <View style={styles.cardText}>
            <Text style={styles.cardName}>{names.get(reading.target) ?? ''}</Text>
            <Text style={styles.cardReading}>{READING[reading.result]}</Text>
          </View>
        </View>
      </Section>
    )
  }

  // §1.2: a disabled Augury says why, plainly.
  let reason: string | null = null
  if (s.traceUsed || sent) reason = 'The lane is being inspected.'
  else if (s.round === 1) reason = 'Inspect opens in round 2.'
  else if (credits < cost) reason = `Inspect costs ${cost} energy. You have ${credits}.`

  return (
    <Section title="Inspect" cost={cost}>
      <Text style={styles.note}>
        {reason ?? 'Choose a lane to see how it filled last round. You can inspect once per match.'}
      </Text>
      <View style={styles.row}>
        {owners.map((id) => (
          <Pressable
            key={id}
            disabled={reason !== null}
            onPress={() => {
              session.trace(id)
              setSent(true)
            }}
            accessibilityRole="button"
            accessibilityLabel={`Inspect ${names.get(id) ?? ''}'s lane`}
            accessibilityState={{ disabled: reason !== null }}
            style={[styles.choice, reason !== null ? styles.disabled : null]}
          >
            <SeatToken seat={seats[id]} disc={tokens.art.tokenDisc} sigil={tokens.art.tokenSigil} />
            <Text style={styles.name} numberOfLines={1}>
              {fit(names.get(id) ?? '')}
            </Text>
          </Pressable>
        ))}
      </View>
    </Section>
  )
}

// -------------------------------------------------------------------------------------------------
// The Draw — Hollow only
// -------------------------------------------------------------------------------------------------

function Draw({
  config,
  youId,
  owners,
  seats,
  names,
  laneUnits,
  credits,
}: {
  config: MatchConfig
  youId: PlayerId
  owners: PlayerId[]
  seats: Record<PlayerId, SeatNumber>
  names: Map<PlayerId, string>
  laneUnits: Record<PlayerId, SharedValue<number>>
  credits: number
}) {
  const s = match.snapshot()
  const [source, setSource] = useState<PlayerId | null>(null)
  // The Draw's own bucket, mirrored: siphon.ratePerSec whole Draws, refilled continuously.
  const bucket = useRef<DrawBucket>({ tokens: config.siphon.ratePerSec, at: null })
  const pulse = useSharedValue(0)
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }))
  if (s === null) return null

  const units = new Map(s.lanes.map((l) => [l.owner, l.units]))
  const frozen = new Set(s.players.filter((p) => p.status === 'disconnected').map((p) => p.id))
  const { pull, deliver, costOther, costSelf } = config.siphon
  const costFor = (sink: PlayerId) => (sink === youId ? costSelf : costOther)

  const canTake = (id: PlayerId) => (units.get(id) ?? 0) >= pull && !frozen.has(id)
  const canGive = (id: PlayerId) =>
    source !== null &&
    id !== source &&
    !frozen.has(id) &&
    config.laneCapacity - (units.get(id) ?? 0) >= deliver &&
    credits >= costFor(id)

  // A selected source that has since fallen below the pull is no longer a source.
  const takeFrom = source !== null && canTake(source) ? source : null

  const draw = (sink: PlayerId) => {
    if (takeFrom === null) return
    if (!takeDrawToken(bucket.current, config.siphon.ratePerSec)) return
    session.siphon(takeFrom, sink)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    pulse.set(
      withSequence(withTiming(1, { duration: motion.duration.ownTap }), withTiming(0, motion.transition.tollEmbers)),
    )
  }

  return (
    <Section title="Drain">
      <Animated.View style={[styles.pulse, pulseStyle]} />

      <Text style={styles.rowLabel}>Take from</Text>
      <View style={styles.row}>
        {owners.map((id) => {
          const ok = canTake(id)
          return (
            <Pressable
              key={id}
              disabled={!ok}
              onPress={() => setSource(id)}
              accessibilityRole="button"
              accessibilityLabel={`Take from ${names.get(id) ?? ''}`}
              accessibilityState={{ disabled: !ok, selected: takeFrom === id }}
              style={[styles.choice, ok ? null : styles.carved]}
            >
              <DrawToken seat={seats[id]} units={laneUnits[id]} capacity={config.laneCapacity} />
              <View style={[styles.selectSlot, takeFrom === id ? styles.selected : null]} />
            </Pressable>
          )
        })}
      </View>

      <Text style={styles.rowLabel}>Give to</Text>
      <View style={styles.row}>
        {owners.map((id) => {
          const ok = canGive(id)
          return (
            <Pressable
              key={id}
              disabled={!ok}
              onPress={() => draw(id)}
              accessibilityRole="button"
              accessibilityLabel={`Give to ${names.get(id) ?? ''}, ${costFor(id)} energy`}
              accessibilityState={{ disabled: !ok }}
              style={[styles.choice, ok ? null : styles.carved]}
            >
              <DrawToken seat={seats[id]} units={laneUnits[id]} capacity={config.laneCapacity} />
              <View style={styles.cost}>
                <Text style={[styles.costText, id === youId ? styles.costSelf : null]}>{String(costFor(id))}</Text>
                <EnergyMark colour={tokens.palette.gold} size={tokens.art.energyMarkSmall} />
              </View>
            </Pressable>
          )
        })}
      </View>

      <Text style={styles.toll}>{`You've destroyed ${s.tollTaken} progress.`}</Text>
    </Section>
  )
}

type DrawBucket = { tokens: number; at: number | null }

/**
 * The server's siphon bucket, mirrored as whole Draws refilled continuously, so a fast hand is held
 * here rather than refused as RATE_LIMITED. Starts full, as the server's does.
 */
function takeDrawToken(bucket: DrawBucket, ratePerSec: number): boolean {
  const now = Date.now()
  if (bucket.at !== null) {
    bucket.tokens = Math.min(ratePerSec, bucket.tokens + ((now - bucket.at) / 1000) * ratePerSec)
  }
  bucket.at = now
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

/** A seat token with its conduit's height beside it, as a bar that scales on the UI thread. */
function DrawToken({ seat, units, capacity }: { seat: SeatNumber; units: SharedValue<number>; capacity: number }) {
  const bar = useAnimatedStyle(() => ({
    transform: [{ scaleY: Math.max(0, Math.min(1, units.get() / capacity)) }],
  }))
  return (
    <View style={styles.drawToken}>
      <SeatToken seat={seat} disc={tokens.art.tokenDisc} sigil={tokens.art.tokenSigil} />
      <View style={styles.barTrack}>
        <Animated.View style={[styles.bar, bar]} />
      </View>
    </View>
  )
}

function Section({ title, cost, children }: { title: string; cost?: number; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{fit(title)}</Text>
        {cost === undefined ? null : (
          <View style={styles.cost}>
            <Text style={styles.costText}>{String(cost)}</Text>
            <EnergyMark colour={tokens.palette.gold} size={tokens.art.energyMarkSmall} />
          </View>
        )}
      </View>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: tokens.art.namePlateGap * 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...tokens.type.stage,
    color: tokens.palette.bone,
  },
  note: {
    ...tokens.type.body,
    color: tokens.palette.boneDim,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  rowLabel: {
    ...tokens.type.label,
    color: tokens.palette.boneDim,
  },
  choice: {
    flex: 1,
    alignItems: 'center',
    gap: tokens.art.namePlateGap,
    minHeight: tokens.layout.minTouchTarget,
  },
  disabled: {
    opacity: tokens.art.coldTokenOpacity,
  },
  // §7.4: a source that cannot be drawn from is "visibly carved-out" — receded, like a cold token.
  carved: {
    opacity: tokens.art.coldTokenOpacity,
  },
  name: {
    ...tokens.type.label,
    color: tokens.palette.bone,
    maxWidth: '90%',
  },
  drawToken: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: tokens.art.namePlateGap,
  },
  barTrack: {
    width: tokens.art.drawBarWidth,
    height: tokens.art.drawBarHeight,
    backgroundColor: tokens.palette.char,
    overflow: 'hidden',
  },
  bar: {
    width: tokens.art.drawBarWidth,
    height: tokens.art.drawBarHeight,
    backgroundColor: tokens.palette.boneDim,
    transformOrigin: 'bottom',
  },
  selectSlot: {
    width: tokens.art.voteMark,
    height: tokens.art.voteMark,
  },
  selected: {
    backgroundColor: tokens.palette.bone,
    transform: [{ rotate: '45deg' }],
  },
  cost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.art.skrGap,
  },
  costText: {
    ...tokens.type.label,
    ...tokens.tabularFigures,
    color: tokens.palette.boneDim,
  },
  // Self-sink costs double; §7.4 wants that shown plainly, so it stands out in bone.
  costSelf: {
    color: tokens.palette.bone,
  },
  // The Hollow's private sin, in toll. The sheet is `stone`, not void, and tollText measures only
  // 3.28:1 there; tollTextBright measures 4.92:1, so it is the toll that carries text on stone.
  toll: {
    ...tokens.type.body,
    color: tokens.palette.tollTextBright,
  },
  pulse: {
    position: 'absolute',
    top: -tokens.layout.stackGap,
    left: -tokens.layout.screenGutter,
    right: -tokens.layout.screenGutter,
    height: tokens.art.drawPulseHeight,
    backgroundColor: tokens.palette.toll,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.layout.stackGap,
  },
  cardText: {
    flex: 1,
  },
  cardName: {
    ...tokens.type.label,
    color: tokens.palette.boneDim,
  },
  cardReading: {
    ...tokens.type.stage,
    color: tokens.palette.bone,
  },
})
