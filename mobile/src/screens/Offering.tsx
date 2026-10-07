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
import { DrainIcon, EnergyMark, InspectIcon, TierMark } from '../art/ControlMarks'
import { createSparkPool, emitSpark, sparkPoolSize, TapBand } from '../art/TapBand'
import { motion } from '../design/motion'
import { tokens } from '../design/tokens'
import { fit } from '../design/fit'
import type { OptimisticStore } from '../state/optimistic'

// §7.3, the Offering stage's lower region: the controls row and the tap band. The match screen
// owns the stores, the lane shared values, the batch timer and reconciliation; this owns input.
//
// The controls row, redrawn in the owner's UI pass because no one could tell what its three
// controls did: the tap size as a two-way toggle with both sizes and their costs in view, the
// energy readout with its mark and label, and Inspect and Drain as two icon buttons with their
// names under them.
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
  /** Open §7.4's sheet on Inspect or on Drain. Both buttons are the same for every role (hard rule 4). */
  onInspect: () => void
  onDrain: () => void
}

export function Offering({
  config,
  prediction,
  ownUnits,
  onPredicted,
  canTap,
  onTierPress,
  onInspect,
  onDrain,
}: OfferingProps) {
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

  return (
    <>
      {/* §7.3's controls row. */}
      <View style={styles.controls}>
        <TierToggle config={config} tier={tier} onToggle={onTierPress} />

        <EnergyReadout prediction={prediction} />

        {/* Identical for every role, in the same place, at the same size, with the same marks,
            labels and handlers. Hard rule 4: role reaches only the sheet each opens, never these
            buttons. A Faithful pressing Drain is told, inside the sheet, that it is not theirs. */}
        <IconButton label="Inspect" onPress={onInspect}>
          <InspectIcon colour={tokens.palette.bone} fill={tokens.palette.boneDim} />
        </IconButton>
        <IconButton label="Drain" onPress={onDrain}>
          <DrainIcon colour={tokens.palette.bone} fill={tokens.palette.boneDim} />
        </IconButton>
      </View>

      <TapBand press={press} sparks={sparks} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} />
    </>
  )
}

// -------------------------------------------------------------------------------------------------
// Controls
// -------------------------------------------------------------------------------------------------

/**
 * The tap size, as a two-way toggle: both sizes are always in view, each with its pips, its "×"
 * label and its cost in energy, and the chosen one is raised out of the track. Pressing the other
 * size switches to it; pressing the chosen one does nothing.
 */
function TierToggle({ config, tier, onToggle }: { config: MatchConfig; tier: Tier; onToggle: () => void }) {
  const tiers: Tier[] = [1, 2]
  return (
    <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel="Tap size">
      {tiers.map((t) => {
        const { cost, units } = config.tapTiers[t]
        const chosen = t === tier
        return (
          <Pressable
            key={t}
            onPress={chosen ? undefined : onToggle}
            accessibilityRole="radio"
            accessibilityLabel={`Tap size ×${units}, ${cost} energy a tap`}
            accessibilityState={{ selected: chosen }}
            style={[styles.segment, chosen ? styles.segmentChosen : null]}
          >
            <TierMark count={units} colour={chosen ? tokens.palette.gold : tokens.palette.boneFaint} />
            <Text style={[styles.segmentLabel, chosen ? null : styles.dim]}>{fit(`×${units}`)}</Text>
            <View style={styles.cost}>
              <Text style={[styles.costText, chosen ? null : styles.dim]}>{String(cost)}</Text>
              <EnergyMark
                colour={chosen ? tokens.palette.gold : tokens.palette.boneFaint}
                size={tokens.art.energyMarkSmall}
              />
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.iconButton}>
      {children}
      <Text style={styles.iconLabel}>{fit(label)}</Text>
    </Pressable>
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
// Since the owner's UI pass it reads as a resource being spent: a gold bolt, the number, and
// "Energy" under it. Each change ticks the number — a short drop and settle — so the spend is felt,
// transform and opacity only. It polls at `readoutInterval`, so it ticks at most ten times a second.
//
// Both toll colours are the text variants, which meet 4.5:1 on void. The pulse is a crossfade
// between them — a second copy of the number in `tollTextBright` fading in and out over the
// first — so it stays transform-and-opacity only and every frame of it clears the floor.
function EnergyReadout({ prediction }: { prediction: OptimisticStore }) {
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

  const tick = useSharedValue(0)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    tick.set(1)
    tick.set(withTiming(0, motion.transition.energyTick))
  }, [credits, tick])
  const tickStyle = useAnimatedStyle(() => ({
    opacity: 1 - tick.get() * tickDim,
    transform: [{ translateY: tick.get() * tickDrop }],
  }))

  const label = String(credits)
  return (
    <View style={styles.energy} accessible accessibilityLabel={`${credits} energy`}>
      <View style={styles.energyRow}>
        <EnergyMark colour={tokens.palette.gold} />
        <Animated.View style={tickStyle}>
          <Text style={[styles.energyValue, { color: colour }]}>{label}</Text>
          {critical ? (
            <Animated.View style={[StyleSheet.absoluteFill, pulseStyle]}>
              <Text style={[styles.energyValue, { color: tokens.palette.tollTextBright }]}>{label}</Text>
            </Animated.View>
          ) : null}
        </Animated.View>
      </View>
      <Text style={styles.energyLabel}>{fit('Energy')}</Text>
    </View>
  )
}

// Captured by the tick's worklet as plain numbers.
const tickDrop = tokens.art.energyTick
const tickDim = 1 - tokens.art.energyTickOpacity

const styles = StyleSheet.create({
  controls: {
    height: tokens.layout.controls,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm,
  },
  // The toggle's track is cut into the stone; the chosen size is raised out of it.
  track: {
    ...tokens.material.insetStoneFace,
    flexDirection: 'row',
    borderRadius: tokens.radii.chip,
    height: tokens.art.controlHeight,
    padding: tokens.space.hairline,
    gap: tokens.space.hairline,
  },
  segment: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.space.hairline,
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radii.chip,
  },
  segmentChosen: {
    ...tokens.material.raisedStoneFace,
  },
  segmentLabel: {
    ...tokens.type.label,
    ...tokens.tabularFigures,
    color: tokens.palette.bone,
  },
  dim: {
    color: tokens.palette.boneDim,
  },
  cost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.xs,
  },
  costText: {
    ...tokens.type.data,
    ...tokens.tabularFigures,
    color: tokens.palette.bone,
  },
  energy: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  energyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.xs,
  },
  energyValue: {
    ...tokens.type.stage,
    ...tokens.tabularFigures,
  },
  energyLabel: {
    ...tokens.type.label,
    color: tokens.palette.boneDim,
  },
  iconButton: {
    ...tokens.material.raisedStoneFace,
    width: tokens.art.iconButtonWidth,
    height: tokens.art.controlHeight,
    borderRadius: tokens.radii.chip,
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.space.xs,
  },
  iconLabel: {
    ...tokens.type.label,
    color: tokens.palette.bone,
  },
})
