import { StyleSheet, useWindowDimensions, View, type GestureResponderEvent } from 'react-native'
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

// §7.3's tap band: the band runs from below the controls row to the bottom edge and all of it is
// the touch target; the oval face is centred inside it, clear of the gesture bar.
//
// The touch surface is a bare `View` with `onTouchStart` — the only candidate that matched the
// kernel's finger-down count in item 2 phase 1. See CLAUDE.md hard rule 3 and BUILD-PLAN.md §6.
// Do not swap it for Pressable or RNGH without re-measuring against `getevent`.
//
// Everything that moves is driven by shared values the stage writes from its touch handler:
//
//   - `press`, 0..1. The face sinks by `plinthPressDepth` and a `stoneLit` layer inside it fades
//     in. §7.3 asks the face to brighten to stoneLit; only transform and opacity may animate in a
//     match, so the brightening is an opacity on a lit layer rather than a colour change.
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

// Captured by the worklets below as a plain number rather than the whole motion module.
const pressDepth = motion.plinthPressDepth

type TapBandProps = {
  /** 1 while pressed, animated back to 0 on release. */
  press: SharedValue<number>
  sparks: SparkPool
  onTouchStart: (e: GestureResponderEvent) => void
  onTouchEnd: (e: GestureResponderEvent) => void
}

export function TapBand({ press, sparks, onTouchStart, onTouchEnd }: TapBandProps) {
  const insets = useSafeAreaInsets()
  const { width: screenWidth } = useWindowDimensions()
  const { art, layout, material } = tokens

  const faceHeight = art.tapBandFaceHeight
  // The lit layer sits inside the face's rim, so its radius is the face's less the rim.
  const litRadius = faceHeight / 2 - material.carvedBandFace.borderWidth

  const faceStyle = useAnimatedStyle(() => ({ transform: [{ translateY: press.get() * pressDepth }] }))
  const litStyle = useAnimatedStyle(() => ({ opacity: press.get() }))

  return (
    <View
      style={[styles.band, { height: layout.tapBand + insets.bottom }]}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Make an offering"
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.face,
          {
            width: screenWidth - art.tapBandInset * 2,
            height: faceHeight,
            borderRadius: faceHeight / 2,
            marginBottom: insets.bottom,
          },
          faceStyle,
        ]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.lit, { borderRadius: litRadius }, litStyle]} />
      </Animated.View>

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
    marginTop: tokens.layout.tapBandGap,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // §3.3's one permitted exception to the radius hierarchy — see §7.3. A face cut into the dark
  // rather than a slab raised out of it, chosen on the phone in item 1c: the band must never be
  // brighter than the fire, and `char` leaves the `stoneLit` pressed state room to read as
  // brightening.
  face: {
    ...tokens.material.carvedBandFace,
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
