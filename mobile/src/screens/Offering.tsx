import * as Haptics from 'expo-haptics'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import type { MatchConfig, Tier } from '../../protocol/generated'
import { BoardHeader } from '../art/BoardHeader'
import { ArrowMark } from '../art/ArrowMark'
import { SkrMark } from '../art/SkrMark'
import { createSparkPool, emitSpark, sparkPoolSize, TapBand } from '../art/TapBand'
import { motion } from '../design/motion'
import { tokens } from '../design/tokens'
import type { OptimisticStore } from '../state/optimistic'

// §7.3, the Offering stage's lower region: the controls row and the tap band. The match screen
// owns the stores, the lane shared values, the batch timer and reconciliation; this owns input.
//
// **Nothing here re-renders per tap.** The tap handler touches only the prediction store, shared
// values and the pending count. Readouts that follow the taps — the credit counter and the board
// percentage — are leaves that poll the stores at `motion.readoutInterval`.

type OfferingProps = {
  config: MatchConfig
  prediction: OptimisticStore
  /** The own lane's displayed units. */
  ownUnits: SharedValue<number>
  /** Called with the new predicted units after every applied tap, before anything else runs. */
  onPredicted: (units: number) => void
  /** False once the stage is about to close, or when this player cannot tap. Checked per touch. */
  canTap: () => boolean
  onTierPress: () => void
  /** Opens §7.4's sheet. The button is the same for every role; the sheet decides what it holds. */
  onAction: () => void
}

export function Offering({ config, prediction, ownUnits, onPredicted, canTap, onTierPress, onAction }: OfferingProps) {
  const press = useSharedValue(0)
  const [sparks] = useState(() => createSparkPool(sparkPoolSize(config.tapRatePerSec)))
  // Re-renders only when the tier changes: getSnapshot runs per tap, but returns the same value.
  const tier: Tier = useSyncExternalStore(prediction.subscribe, prediction.tier)

  // Synchronous and on the JS thread — see CLAUDE.md hard rule 3. No await, no setState.
  const onTouchStart = (e: GestureResponderEvent) => {
    if (!canTap()) return
    const now = performance.now()
    const touches = e.nativeEvent.changedTouches
    for (let i = 0; i < touches.length; i++) {
      // Bucket, then credits, then headroom, in the server's order. Any clamp is silent (§7.3).
      if (!prediction.tap(now).applied) continue

      const units = prediction.snapshot().ownUnits
      onPredicted(units)
      ownUnits.set(units)
      emitSpark(sparks, touches[i].locationX, touches[i].locationY)
      press.set(1)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }
  }

  const onTouchEnd = (e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length === 0) press.set(withTiming(0, motion.transition.plinthRelease))
  }

  const { cost, units } = config.tapTiers[tier]

  return (
    <>
      {/* §7.3's controls row. */}
      <View style={styles.controls}>
        <ControlButton accessibilityLabel={`Offering tier: ${cost} SKR for ${units}`} onPress={onTierPress}>
          <Text style={styles.buttonLabel}>{String(cost)}</Text>
          <SkrMark colour={tokens.palette.bone} />
          <ArrowMark colour={tokens.palette.bone} />
          <Text style={styles.buttonLabel}>{String(units)}</Text>
        </ControlButton>

        <CreditCounter prediction={prediction} />

        {/* Identical for every role, in the same place, at the same size, with the same label and
            handler. Hard rule 4: role reaches only the sheet it opens, never this button. */}
        <ControlButton accessibilityLabel="Augury" onPress={onAction}>
          <Text style={styles.buttonLabel}>Augury</Text>
        </ControlButton>
      </View>

      <TapBand press={press} sparks={sparks} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} />
    </>
  )
}

// -------------------------------------------------------------------------------------------------
// Readouts
// -------------------------------------------------------------------------------------------------

/**
 * Polls `read` every `motion.readoutInterval` and re-renders only when the value changed. `read`
 * must be stable. This is the only way a per-tap value reaches React.
 */
export function usePolled<T>(read: () => T): T {
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

export function LiveHeader({
  winTarget,
  readRound,
  readSecondsLeft,
  readTotal,
  onRules,
}: {
  winTarget: number
  readRound: () => number
  readSecondsLeft: () => number
  readTotal: () => number
  onRules: () => void
}) {
  // The spec names no formula for the percentage; this is the only reading that gives §6.1's own
  // 58% for its example board. Capped at 100 so a crossed board never reads 104%.
  //
  // Integer-first, and deliberately so: (1392 / 2400) * 100 is 57.99999999999999 in binary
  // floating point, so the obvious spelling floored to 57 on item 1's first screenshot.
  const readPercent = useCallback(
    () => Math.min(100, Math.floor((readTotal() * 100) / winTarget)),
    [readTotal, winTarget],
  )
  const percent = usePolled(readPercent)
  const round = usePolled(readRound)
  const secondsLeft = usePolled(readSecondsLeft)
  // floor(total x 100 / winTarget) reaches 100 exactly when total reaches winTarget.
  return (
    <BoardHeader round={round} percent={percent} secondsLeft={secondsLeft} crossed={percent >= 100} onRules={onRules} />
  )
}

// §7.3: ticks down with tabular figures, shifts to toll below `creditsLow`, and pulses slowly
// below `creditsCritical`. No modal — the player is mid-tap.
//
// Both toll colours are the text variants, which meet 4.5:1 on void. The pulse is a crossfade
// between them — a second copy of the number in `tollTextBright` fading in and out over the
// first — so it stays transform-and-opacity only and every frame of it clears the floor.
function CreditCounter({ prediction }: { prediction: OptimisticStore }) {
  const read = useCallback(() => prediction.snapshot().credits, [prediction])
  const credits = usePolled(read)
  const low = credits < tokens.art.creditsLow
  const critical = credits < tokens.art.creditsCritical
  const colour = low ? tokens.palette.tollText : tokens.palette.bone

  const pulse = useSharedValue(0)
  useEffect(() => {
    if (critical) {
      pulse.set(withRepeat(withTiming(1, motion.transition.creditPulse), -1, true))
    } else {
      cancelAnimation(pulse)
      pulse.set(0)
    }
  }, [critical, pulse])
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }))

  const label = String(credits)
  return (
    <View style={styles.credits} accessible accessibilityLabel={`${credits} SKR`}>
      <View>
        <Text style={[styles.creditsValue, { color: colour }]}>{label}</Text>
        {critical ? (
          <Animated.View style={[StyleSheet.absoluteFill, pulseStyle]}>
            <Text style={[styles.creditsValue, { color: tokens.palette.tollTextBright }]}>{label}</Text>
          </Animated.View>
        ) : null}
      </View>
      <SkrMark colour={colour} />
    </View>
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

const styles = StyleSheet.create({
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
})
