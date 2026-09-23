import * as Haptics from 'expo-haptics'
import { useKeepAwake } from 'expo-keep-awake'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native'
import Animated, {
  cancelAnimation,
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { LaneSnapshot, MatchConfig, PlayerId, Tier } from '../../protocol/generated'
import { Board } from '../art/Board'
import { BoardHeader } from '../art/BoardHeader'
import { SkrMark } from '../art/SkrMark'
import { createSparkPool, emitSpark, sparkPoolSize, TapBand } from '../art/TapBand'
import { motion } from '../design/motion'
import { tokens } from '../design/tokens'
import { createLoopback } from '../net/loopback'
import { BATCH_INTERVAL_MS, createOutbox } from '../net/outbox'
import { createMatchStore } from '../state/match'
import { createOptimisticStore, type OptimisticStore } from '../state/optimistic'

// §7.3, the Offering stage. Local only until item 3: the config, the other lanes and the starting
// credits are fixtures below, and a dev loopback stands in for the server.
//
// **This screen does not re-render per tap.** The tap handler touches only the prediction store,
// shared values and the pending count. Readouts that follow the taps — the credit counter, the
// board percentage — are leaves that poll the stores at `motion.readoutInterval`.
//
// Two stores, kept apart per CLAUDE.md: state/match.ts is what the server (here, the loopback)
// last said; state/optimistic.ts is this player's prediction. Reconciliation is the only place
// the two meet.

// ---------------------------------------------------------------------------------------------
// Fixtures — mirror ../server/src/engine/config.ts MVP_CONFIG
// ---------------------------------------------------------------------------------------------

const YOU: PlayerId = 'p-you'

const CONFIG: MatchConfig = {
  laneCapacity: 1000,
  winTarget: 2400,
  tapTiers: { 1: { cost: 1, units: 1 }, 2: { cost: 4, units: 3 } },
  tapRatePerSec: 6,
  siphon: { pull: 10, deliver: 6, costOther: 6, costSelf: 12, ratePerSec: 4 },
  trace: { cost: 200, perPlayer: 1 },
  dormantEfficiencyPct: 50,
  rounds: 3,
  stageDurations: { tap: 60, chat: 45, vote: 15 },
  buyInSkr: 12,
  creditsPerSkr: 100,
  rakeBps: 0,
  disconnectGraceSec: 30,
  lobbyFillTimeoutSec: 60,
}

// The server's startingCredits(): buyInSkr x creditsPerSkr.
const STARTING_CREDITS = CONFIG.buyInSkr * CONFIG.creditsPerSkr

// Static for item 2. Chosen so the own lane cannot carry the board across the Threshold alone
// (1092 + 1000 < 2400): the crossing is item 4's beat, not this one's.
const LANES: LaneSnapshot[] = [
  { owner: YOU, units: 0, dormant: false },
  { owner: 'p-2', units: 220, dormant: false },
  { owner: 'p-3', units: 700, dormant: false },
  { owner: 'p-4', units: 172, dormant: false },
]

// Dev tools render in dev builds, and in a release build made with EXPO_PUBLIC_DEV_TOOLS=1 so
// the feel test can run at release speed. A production build carries neither.
const DEV_TOOLS = __DEV__ || process.env.EXPO_PUBLIC_DEV_TOOLS === '1'

// ---------------------------------------------------------------------------------------------

export function Offering() {
  // Dev "reset" remounts the stage, so every store and shared value starts from the fixtures.
  const [epoch, setEpoch] = useState(0)
  return <OfferingStage key={epoch} onReset={() => setEpoch((e) => e + 1)} />
}

function OfferingStage({ onReset }: { onReset: () => void }) {
  useKeepAwake()

  const [stores] = useState(() => {
    const match = createMatchStore({
      round: 1,
      stage: 'tap',
      secondsLeft: CONFIG.stageDurations.tap,
      lanes: LANES,
      boardTotal: LANES.reduce((sum, lane) => sum + lane.units, 0),
      credits: STARTING_CREDITS,
      tier: 1,
    })
    const prediction = createOptimisticStore(CONFIG, STARTING_CREDITS)
    const outbox = createOutbox()
    const loopback = createLoopback(outbox, match, CONFIG, YOU)
    return { match, prediction, outbox, loopback }
  })
  const { match, prediction, outbox, loopback } = stores

  // One shared value per lane: what its conduit displays. Written by the tap handler (own lane,
  // instantly) and by reconciliation (every lane, as a lerp), and nothing else.
  const [laneUnits] = useState(() => {
    const values: Record<PlayerId, SharedValue<number>> = {}
    for (const lane of LANES) values[lane.owner] = makeMutable(lane.units)
    return values
  })
  // The value each lane was last sent toward, so reconciliation picks rise or fall without
  // reading a shared value back from the UI thread.
  const lastTarget = useRef<Record<PlayerId, number>>(Object.fromEntries(LANES.map((l) => [l.owner, l.units])))

  const press = useSharedValue(0)
  const [sparks] = useState(() => createSparkPool(sparkPoolSize(CONFIG.tapRatePerSec)))

  const [tier, setTier] = useState<Tier>(1)

  // -- Batching ----------------------------------------------------------------------------------

  const flush = useCallback(() => {
    const count = prediction.takePending()
    if (count > 0) outbox.pushTaps(prediction.tier(), count)
  }, [prediction, outbox])

  useEffect(() => {
    const id = setInterval(flush, BATCH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [flush])

  // -- The loopback and reconciliation, per hard rule 2 -------------------------------------------

  useEffect(() => {
    const reconcile = () => {
      const snapshot = match.snapshot()
      // Rebase first: the authoritative values plus whatever has not been sent yet. The own lane
      // is then lerped to that, so unsent taps never visibly fall back and then return.
      prediction.rebase({ credits: snapshot.credits, ownUnits: match.laneUnits(YOU) })
      const predictedOwn = prediction.snapshot().ownUnits
      for (const lane of snapshot.lanes) {
        const target = lane.owner === YOU ? predictedOwn : lane.units
        const last = lastTarget.current[lane.owner]
        if (target === last) continue
        lastTarget.current[lane.owner] = target
        // Rising 250ms linear, falling 400ms ease-out. Nothing snaps.
        laneUnits[lane.owner].set(
          withTiming(target, target > last ? motion.transition.frontierRise : motion.transition.frontierFall),
        )
      }
    }
    const unsubscribe = match.subscribe(reconcile)
    const id = setInterval(loopback.tick, BATCH_INTERVAL_MS)
    return () => {
      clearInterval(id)
      unsubscribe()
    }
  }, [match, prediction, loopback, laneUnits])

  // -- Touch -------------------------------------------------------------------------------------

  // Synchronous and on the JS thread — see CLAUDE.md hard rule 3. No await, no setState.
  const onTouchStart = (e: GestureResponderEvent) => {
    const now = performance.now()
    const touches = e.nativeEvent.changedTouches
    for (let i = 0; i < touches.length; i++) {
      // Bucket, then credits, then headroom, in the server's order. Any clamp is silent (§7.3).
      if (!prediction.tap(now).applied) continue

      const own = prediction.snapshot().ownUnits
      lastTarget.current[YOU] = own
      laneUnits[YOU].set(own)
      emitSpark(sparks, touches[i].locationX, touches[i].locationY)
      press.set(1)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }
  }

  const onTouchEnd = (e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length === 0) press.set(withTiming(0, motion.transition.plinthRelease))
  }

  // -- Tier ----------------------------------------------------------------------------------------

  const onTierPress = () => {
    // Taps made at the old tier leave as their own batch before the change takes effect.
    flush()
    const next: Tier = tier === 1 ? 2 : 1
    prediction.setTier(next)
    outbox.pushSetTier(next)
    setTier(next)
  }

  // -- Readouts ------------------------------------------------------------------------------------

  const readTotal = useCallback(() => {
    const others = match.snapshot().lanes.reduce((sum, lane) => (lane.owner === YOU ? sum : sum + lane.units), 0)
    return others + prediction.snapshot().ownUnits
  }, [match, prediction])
  const readCrossed = useCallback(() => readTotal() >= CONFIG.winTarget, [readTotal])
  const crossed = usePolled(readCrossed)

  const { cost, units } = CONFIG.tapTiers[tier]
  const snapshot = match.snapshot()

  return (
    <View style={styles.root}>
      <Board
        lanes={LANES}
        laneUnits={laneUnits}
        config={CONFIG}
        youId={YOU}
        crossed={crossed}
        header={<LiveHeader round={snapshot.round} secondsLeft={snapshot.secondsLeft} readTotal={readTotal} />}
      >
        {/* §7.3's controls row. */}
        <View style={styles.controls}>
          <ControlButton accessibilityLabel={`Offering tier: ${cost} SKR for ${units}`} onPress={onTierPress}>
            <Text style={styles.buttonLabel}>{String(cost)}</Text>
            <SkrMark colour={tokens.palette.bone} />
            <Text style={styles.buttonLabel}>{`→ ${units}`}</Text>
          </ControlButton>

          <CreditCounter prediction={prediction} />

          {/* Identical for every role, in the same place, at the same size. Hard rule 4. Opens
              nothing until item 5. */}
          <ControlButton accessibilityLabel="Augury">
            <Text style={styles.buttonLabel}>Augury</Text>
          </ControlButton>
        </View>

        <TapBand press={press} sparks={sparks} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} />
      </Board>

      {DEV_TOOLS ? (
        <DevStrip
          onDrop={loopback.setDrop}
          onReset={onReset}
          onDump={() => console.log('[outbox]', JSON.stringify(outbox.entries()))}
        />
      ) : null}
    </View>
  )
}

// -------------------------------------------------------------------------------------------------
// Readouts
// -------------------------------------------------------------------------------------------------

/**
 * Polls `read` every `motion.readoutInterval` and re-renders only when the value changed. `read`
 * must be stable. This is the only way a per-tap value reaches React.
 */
function usePolled<T>(read: () => T): T {
  const [value, setValue] = useState(read)
  const last = useRef(value)
  useEffect(() => {
    const id = setInterval(() => {
      const next = read()
      if (!Object.is(next, last.current)) {
        last.current = next
        setValue(next)
      }
    }, motion.readoutInterval)
    return () => clearInterval(id)
  }, [read])
  return value
}

function LiveHeader({
  round,
  secondsLeft,
  readTotal,
}: {
  round: number
  secondsLeft: number
  readTotal: () => number
}) {
  // The spec names no formula for the percentage; this is the only reading that gives §6.1's own
  // 58% for its example board. Capped at 100 so a crossed board never reads 104%.
  //
  // Integer-first, and deliberately so: (1392 / 2400) * 100 is 57.99999999999999 in binary
  // floating point, so the obvious spelling floored to 57 on item 1's first screenshot.
  const readPercent = useCallback(() => Math.min(100, Math.floor((readTotal() * 100) / CONFIG.winTarget)), [readTotal])
  const percent = usePolled(readPercent)
  // floor(total x 100 / winTarget) reaches 100 exactly when total reaches winTarget.
  return <BoardHeader round={round} percent={percent} secondsLeft={secondsLeft} crossed={percent >= 100} />
}

// §7.3: ticks down with tabular figures, shifts to toll below `creditsLow`, and pulses slowly
// below `creditsCritical`. No modal — the player is mid-tap. The toll here is `tollText`, the
// variant that meets 4.5:1 on void; see tokens.ts.
function CreditCounter({ prediction }: { prediction: OptimisticStore }) {
  const read = useCallback(() => prediction.snapshot().credits, [prediction])
  const credits = usePolled(read)
  const low = credits < tokens.art.creditsLow
  const critical = credits < tokens.art.creditsCritical
  const colour = low ? tokens.palette.tollText : tokens.palette.bone

  const pulse = useSharedValue(1)
  useEffect(() => {
    if (critical) {
      pulse.set(withRepeat(withTiming(motion.creditPulseOpacity, motion.transition.creditPulse), -1, true))
    } else {
      cancelAnimation(pulse)
      pulse.set(1)
    }
  }, [critical, pulse])
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }))

  return (
    <Animated.View style={[styles.credits, pulseStyle]} accessible accessibilityLabel={`${credits} SKR`}>
      <Text style={[styles.creditsValue, { color: colour }]}>{String(credits)}</Text>
      <SkrMark colour={colour} />
    </Animated.View>
  )
}

function ControlButton({
  children,
  accessibilityLabel,
  onPress,
}: {
  children: ReactNode
  accessibilityLabel: string
  onPress?: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.button}
    >
      {children}
    </Pressable>
  )
}

// -------------------------------------------------------------------------------------------------
// Dev tools
// -------------------------------------------------------------------------------------------------

function DevStrip({
  onDrop,
  onReset,
  onDump,
}: {
  onDrop: (on: boolean) => void
  onReset: () => void
  onDump: () => void
}) {
  const insets = useSafeAreaInsets()
  // Local, so toggling it re-renders the chip and not the stage.
  const [drop, setDrop] = useState(false)
  return (
    <View style={[styles.devStrip, { top: insets.top + tokens.layout.header }]}>
      <DevChip
        label="drop 30%"
        selected={drop}
        onPress={() => {
          onDrop(!drop)
          setDrop(!drop)
        }}
      />
      <DevChip label="reset" selected={false} onPress={onReset} />
      <DevChip label="dump" selected={false} onPress={onDump} />
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
  controls: {
    height: tokens.layout.controls,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.art.conduitOuterMargin,
  },
  button: {
    ...tokens.material.raisedStoneFace,
    borderRadius: tokens.radii.chip,
    minHeight: tokens.layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.art.skrGap,
    paddingHorizontal: tokens.art.conduitOuterMargin,
  },
  buttonLabel: {
    ...tokens.type.data,
    color: tokens.palette.bone,
  },
  credits: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.art.skrGap,
  },
  creditsValue: {
    ...tokens.type.data,
    ...tokens.tabularFigures,
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
    ...tokens.type.fine,
    color: tokens.palette.boneDim,
  },
})
