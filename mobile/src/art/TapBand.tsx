import { useId } from 'react'
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native'
import Animated, {
  makeMutable,
  useAnimatedStyle,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { motion } from '../design/motion'
import { tokens } from '../design/tokens'
import { fit } from '../design/fit'

// §7.3's tap band, redrawn in the owner's UI pass. It is the primary verb of the game, so it is
// the most pressable thing on screen: a filled stone face, not an outline, running edge to edge and
// down to the bottom edge, with no margins around it. The whole band is the touch target.
//
// The plate, the owner's choice of two treatments: stone, never fire (§3.1), its top corners rounded,
// a gold rim along its top edge — gold is emphasis now — light washing down its face, and a carved
// ring where the thumb goes.
//
// The touch surface is a bare `View` with `onTouchStart` — the only candidate that matched the
// kernel's finger-down count in item 2 phase 1. See CLAUDE.md hard rule 3 and BUILD-PLAN.md §6.
// Do not swap it for Pressable or RNGH without re-measuring against `getevent`.
//
// Everything that moves is driven by shared values the stage writes from its touch handler:
//
//   - `press`, 0..1. The face darkens by `tapBandPressDarken`, its light falls away, and its
//     contents sink by `bandPressDepth` — unmistakable at six taps a second, since each press is set
//     instantly and released over `plinthRelease`. Transform and opacity only.
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

// Captured by the worklets below as plain numbers rather than whole modules.
const pressDepth = motion.bandPressDepth
const { tapBandPressDarken: pressDarken, tapBandRingPressed: ringPressed } = tokens.art

type TapBandProps = {
  /** 1 while pressed, animated back to 0 on release. */
  press: SharedValue<number>
  sparks: SparkPool
  onTouchStart: (e: GestureResponderEvent) => void
  onTouchEnd: (e: GestureResponderEvent) => void
}

export function TapBand({ press, sparks, onTouchStart, onTouchEnd }: TapBandProps) {
  const insets = useSafeAreaInsets()
  const { layout } = tokens
  const height = layout.tapBand + insets.bottom

  const shadeStyle = useAnimatedStyle(() => ({ opacity: press.get() * pressDarken }))
  const lightStyle = useAnimatedStyle(() => ({ opacity: 1 - press.get() }))
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: press.get() * pressDepth }, { scale: 1 - press.get() * (1 - ringPressed) }],
  }))

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
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.face]}>
        {/* The light down the face: what makes it read as raised. It falls away while pressed. */}
        <Animated.View style={[StyleSheet.absoluteFill, lightStyle]}>
          <FaceLight height={height} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, styles.shade, shadeStyle]} />
      </View>

      <View pointerEvents="none" style={[styles.content, { paddingBottom: insets.bottom }]}>
        <Animated.View style={[styles.ring, ringStyle]}>
          <Text style={styles.word}>{fit('Tap')}</Text>
        </Animated.View>
      </View>

      {sparks.slots.map((slot, i) => (
        <Spark key={i} slot={slot} />
      ))}
    </View>
  )
}

/** A static wash of stoneLit, strongest at the top edge and gone by `faceLightReach`. */
function FaceLight({ height }: { height: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <Svg width="100%" height={height}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={tokens.palette.stoneLit} stopOpacity={tokens.art.tapBandLight} />
          <Stop offset={String(tokens.art.tapBandLightReach)} stopColor={tokens.palette.stoneLit} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width="100%" height={height} fill={`url(#${id})`} />
    </Svg>
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
  face: {
    backgroundColor: tokens.palette.stone,
    overflow: 'hidden',
    borderTopWidth: tokens.art.tapBandEdge,
    borderTopColor: tokens.palette.gold,
    borderTopLeftRadius: tokens.art.tapBandPlateRadius,
    borderTopRightRadius: tokens.art.tapBandPlateRadius,
  },
  shade: {
    backgroundColor: tokens.palette.bevelShadow,
  },
  content: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A ring cut into the plate: dark above, lit below, per §3.3's inward bevel.
  ring: {
    width: tokens.art.tapBandRing,
    height: tokens.art.tapBandRing,
    borderRadius: tokens.art.tapBandRing / 2,
    borderWidth: tokens.art.tapBandRingStroke,
    borderTopColor: tokens.palette.bevelShadow,
    borderLeftColor: tokens.palette.bevelShadow,
    borderBottomColor: tokens.palette.stoneLit,
    borderRightColor: tokens.palette.stoneLit,
    backgroundColor: tokens.palette.char,
    alignItems: 'center',
    justifyContent: 'center',
  },
  word: {
    ...tokens.type.display,
    color: tokens.palette.bone,
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
