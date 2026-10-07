import { useEffect } from 'react'
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import type { Side } from '../../protocol/generated'
import { motion } from '../design/motion'
import { tokens } from '../design/tokens'
import { SEAT_COLOURS, Sigil, type SeatNumber } from './Sigil'

// §7.2, the Marking. A full-screen overlay inside the match screen, over a board that is already
// mounted and correct. It lifts off to reveal it. No skip.
//
// **Both roles run one schedule.** Every beat starts at the same moment and lasts the same time
// for the Faithful and the Hollow; the role decides only which colour a beat resolves to and
// which line is set. A filmed screen or a glance at a neighbour's phone cannot read role from
// timing.
//
//   stroke   0     – 1200  four strokes, drawn in carved stone, one continuous path
//   resolve  1200  – 1600  the mark fills with flameCold — "completes in flame-cold"
//   turn     1600  – 2000  Faithful: the ring steadies. Hollow: the mark inverts to toll, the
//                          ring dims. Both are one opacity fade of the same length.
//   line     2000  – 2400  the line fades in
//   hold     2400  – 3500
//   lift     3500  – 4000  the overlay rises off the board
//
// Only transform and opacity animate: each colour is its own layer, crossfaded.

const { duration, transition } = motion
const strokeEach = duration.markStroke / 4
const resolveAt = duration.markStroke
const turnAt = resolveAt + duration.markResolve
const lineAt = turnAt + duration.markTurn
const liftAt = duration.markingTotal - duration.markLift
const strokeTiming = { duration: strokeEach, easing: transition.markStroke.easing }

type MarkingProps = {
  role: Side
  seat: SeatNumber
  onDone: () => void
}

export function Marking({ role, seat, onDone }: MarkingProps) {
  const { height } = useWindowDimensions()
  const { art, palette } = tokens
  const hollow = role === 'impostor'

  const edges = [useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0)]
  const cold = useSharedValue(0)
  const toll = useSharedValue(0)
  const ring = useSharedValue<number>(art.markingRingStart)
  const line = useSharedValue(0)
  const lift = useSharedValue(0)

  useEffect(() => {
    edges.forEach((edge, i) => edge.set(withDelay(strokeEach * i, withTiming(1, strokeTiming))))
    cold.set(withDelay(resolveAt, withTiming(1, transition.markResolve)))
    // The turn. The Faithful's toll layer is animated too — to 0, where it already is — so both
    // roles schedule the same animations at the same moments.
    toll.set(withDelay(turnAt, withTiming(hollow ? 1 : 0, transition.markTurn)))
    ring.set(withDelay(turnAt, withTiming(hollow ? art.markingRingDim : art.markingRingSteady, transition.markTurn)))
    line.set(withDelay(lineAt, withTiming(1, transition.markLine)))
    lift.set(withDelay(liftAt, withTiming(1, transition.markLift)))

    const started = Date.now()
    const done = setTimeout(() => {
      if (__DEV__) console.log('[marking] finished after', Date.now() - started, 'ms')
      onDone()
    }, duration.markingTotal)
    return () => clearTimeout(done)
    // Runs once per mount: the Marking plays exactly once and is then unmounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: 1 - lift.get(),
    transform: [{ translateY: -lift.get() * height }],
  }))
  const coldStyle = useAnimatedStyle(() => ({ opacity: cold.get() }))
  const tollStyle = useAnimatedStyle(() => ({ opacity: toll.get() }))
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.get() }))
  const lineStyle = useAnimatedStyle(() => ({ opacity: line.get() }))

  const outer = art.markingDisc + art.markingRing * 2

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]} pointerEvents="auto">
      <View style={styles.centre}>
        {/* The mark: one square on its point, in three stacked colours. */}
        <View style={styles.markBox}>
          <Mark edges={edges} colour={palette.stoneLit} />
          <Animated.View style={[StyleSheet.absoluteFill, coldStyle]}>
            <Mark edges={edges} colour={palette.flameCold} />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, tollStyle]}>
            <Mark edges={edges} colour={palette.toll} />
          </Animated.View>
        </View>

        {/* The token: the player's own sigil on stone, ringed in boneDim, never fire. */}
        <Animated.View style={[styles.ring, { width: outer, height: outer, borderRadius: outer / 2 }, ringStyle]} />
        <View
          style={[styles.disc, { width: art.markingDisc, height: art.markingDisc, borderRadius: art.markingDisc / 2 }]}
        >
          <Sigil seat={seat} colour={SEAT_COLOURS[seat]} size={art.markingSigil} />
        </View>
      </View>

      <Animated.View style={[styles.lines, lineStyle]}>
        <Text style={styles.line}>
          {hollow ? 'You are Hollow. The Heart must not wake.' : 'You are Faithful. Feed the Heart.'}
        </Text>
        {/* §1.1: the role reveal keeps the fiction, and glosses Hollow and Faithful once. */}
        <Text style={styles.quiet}>
          {hollow
            ? 'The impostor. Drain one lane into another to keep the board short of the target. Four parts in ten are destroyed.'
            : 'One of the three honest players. Fill the board to the target, and vote out the Hollow.'}
        </Text>
      </Animated.View>
    </Animated.View>
  )
}

/** A square's four edges, drawn in order round the perimeter, each scaled in from its start. */
function Mark({ edges, colour }: { edges: SharedValue<number>[]; colour: string }) {
  const top = useAnimatedStyle(() => ({ transform: [{ scaleX: edges[0].get() }] }))
  const right = useAnimatedStyle(() => ({ transform: [{ scaleY: edges[1].get() }] }))
  const bottom = useAnimatedStyle(() => ({ transform: [{ scaleX: edges[2].get() }] }))
  const left = useAnimatedStyle(() => ({ transform: [{ scaleY: edges[3].get() }] }))
  const fill = { backgroundColor: colour }
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.edgeTop, fill, top]} />
      <Animated.View style={[styles.edgeRight, fill, right]} />
      <Animated.View style={[styles.edgeBottom, fill, bottom]} />
      <Animated.View style={[styles.edgeLeft, fill, left]} />
    </View>
  )
}

const size = tokens.art.markingMarkSize
const stroke = tokens.art.markingMarkStroke

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: tokens.palette.void,
  },
  // The token and mark sit at the screen's centre whatever the lines below them say, so the
  // Hollow's extra line cannot move them.
  centre: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markBox: {
    position: 'absolute',
    width: size,
    height: size,
    transform: [{ rotate: '45deg' }],
  },
  edgeTop: { position: 'absolute', top: 0, left: 0, width: size, height: stroke, transformOrigin: 'left' },
  edgeRight: { position: 'absolute', top: 0, right: 0, width: stroke, height: size, transformOrigin: 'top' },
  edgeBottom: { position: 'absolute', bottom: 0, right: 0, width: size, height: stroke, transformOrigin: 'right' },
  edgeLeft: { position: 'absolute', bottom: 0, left: 0, width: stroke, height: size, transformOrigin: 'bottom' },
  ring: {
    position: 'absolute',
    borderWidth: tokens.art.markingRing,
    borderColor: tokens.palette.boneDim,
  },
  disc: {
    ...tokens.material.raisedStoneFace,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lines: {
    position: 'absolute',
    left: tokens.layout.screenGutter,
    right: tokens.layout.screenGutter,
    // Below the mark's lower point: half the screen, plus the diagonal of the mark's half-width.
    top: '50%',
    marginTop: (tokens.art.markingMarkSize * Math.SQRT2) / 2 + tokens.layout.sectionGap,
    alignItems: 'center',
    gap: tokens.layout.stackGap,
  },
  line: {
    ...tokens.type.display,
    color: tokens.palette.bone,
    textAlign: 'center',
  },
  quiet: {
    ...tokens.type.body,
    color: tokens.palette.boneDim,
    textAlign: 'center',
  },
})
