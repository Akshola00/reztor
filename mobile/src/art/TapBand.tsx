import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native'
import Animated, {
  makeMutable,
  useAnimatedStyle,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { motion } from '../design/motion'
import { tokens } from '../design/tokens'
import { DownArrow } from './ControlMarks'
import { fit } from '../design/fit'

// §7.3's tap band is the surface: the bottom of the phone, not an object on the screen. No border,
// no rim, no radius, full width to the bottom edge, its face only slightly lighter than the
// background. Above the face a quiet hint — "Tap" over a short drawn arrow pointing down — says
// what the surface is for. The whole band, hint included, is the touch target.
//
// The touch surface is a bare `View` with `onTouchStart` — the only candidate that matched the
// kernel's finger-down count in item 2 phase 1. See CLAUDE.md hard rule 3 and BUILD-PLAN.md §6.
// Do not swap it for Pressable or RNGH without re-measuring against `getevent`.
//
// Everything that moves is driven by shared values the stage writes from its touch handler:
//
//   - `press`, 0..1. Nothing marks the band at rest, so the press carries all the feedback: a
//     stoneLit layer flashes over the face, set instantly on the touch and released over
//     `plinthRelease` — a full flash per tap even at six a second. Opacity only.
//   - a pool of sparks, pre-mounted and recycled round-robin, so nothing mounts per tap.
//
// Every child is `pointerEvents="none"`, so the band itself is always the touch target and a
// touch's `locationX`/`locationY` are band coordinates — which is where the spark goes.

export type SparkSlot = { x: SharedValue<number>; y: SharedValue<number>; opacity: SharedValue<number> }
export type SparkPool = { slots: SparkSlot[]; next: number }

/**
 * Sized from the rate limit, so a live spark is never recycled. A full bucket lets `tapRatePerSec`
 * taps land at once, and the bucket refills `tapRatePerSec x fade` more before the first of them
 * has faded — at 6/sec with a 400ms fade that is 6 + 3 = 9.
 */
export function sparkPoolSize(tapRatePerSec: number): number {
  return tapRatePerSec + Math.ceil((tapRatePerSec * motion.duration.spark) / 1000)
}

export function createSparkPool(size: number): SparkPool {
  const slots: SparkSlot[] = []
  for (let i = 0; i < size; i++) {
    slots.push({ x: makeMutable(0), y: makeMutable(0), opacity: makeMutable(0) })
  }
  return { slots, next: 0 }
}

const sparkHalf = tokens.art.sparkSize / 2

/** Synchronous. Places the next spark at a band-space point and starts its fade. */
export function emitSpark(pool: SparkPool, x: number, y: number) {
  const slot = pool.slots[pool.next]
  pool.next = (pool.next + 1) % pool.slots.length
  slot.x.set(x - sparkHalf)
  slot.y.set(y - sparkHalf)
  slot.opacity.set(
    withSequence(withTiming(1, { duration: motion.duration.ownTap }), withTiming(0, motion.transition.spark)),
  )
}

// Captured by the worklet below as a plain number rather than the whole module.
const pressLight = tokens.art.tapBandPressLight

type TapBandProps = {
  /** 1 while pressed, animated back to 0 on release. */
  press: SharedValue<number>
  sparks: SparkPool
  onTouchStart: (e: GestureResponderEvent) => void
  onTouchEnd: (e: GestureResponderEvent) => void
}

export function TapBand({ press, sparks, onTouchStart, onTouchEnd }: TapBandProps) {
  const insets = useSafeAreaInsets()
  const height = tokens.layout.tapBand + insets.bottom
  const litStyle = useAnimatedStyle(() => ({ opacity: press.get() * pressLight }))

  return (
    <View
      style={[styles.band, { height }]}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Tap to fill your lane"
    >
      <View pointerEvents="none" style={styles.hint}>
        <Text style={styles.hintLabel}>{fit('Tap')}</Text>
        <DownArrow colour={tokens.palette.boneDim} />
      </View>
      <View pointerEvents="none" style={styles.face}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.lit, litStyle]} />
      </View>

      {sparks.slots.map((slot, i) => (
        <Spark key={i} slot={slot} />
      ))}
    </View>
  )
}

function Spark({ slot }: { slot: SparkSlot }) {
  const style = useAnimatedStyle(() => ({
    opacity: slot.opacity.get(),
    transform: [{ translateX: slot.x.get() }, { translateY: slot.y.get() }],
  }))
  return <Animated.View pointerEvents="none" style={[styles.spark, style]} />
}

const styles = StyleSheet.create({
  band: {
    alignSelf: 'stretch',
  },
  hint: {
    height: tokens.art.tapHintHeight,
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.space.xs,
  },
  hintLabel: {
    ...tokens.type.label,
    color: tokens.palette.boneDim,
  },
  face: {
    flex: 1,
    backgroundColor: tokens.palette.bandFace,
  },
  lit: {
    backgroundColor: tokens.palette.stoneLit,
  },
  // §3.1 item 5: the offering spark is the one fire outside a conduit during the Offering, and it
  // sits on the band, never in its face.
  spark: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: tokens.art.sparkSize,
    height: tokens.art.sparkSize,
    borderRadius: tokens.art.sparkSize / 2,
    backgroundColor: tokens.palette.flameCold,
    opacity: 0,
  },
})
