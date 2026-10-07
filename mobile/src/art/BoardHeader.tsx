import { useEffect } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'

import { motion } from '../design/motion'
import { tokens } from '../design/tokens'

// §6.1's header band: the rules control and the round on the left, the board percentage centred,
// the stage timer on the right. No vessel and no settings control.
//
// The rules control is the About mark — a square on its point — and opens §7.1's rules sheet. It is
// the same for every role and every stage, and sits up here, out of thumb reach during Offering.
//
// The round's number is set at the t-stage step in bone, beside a quiet "Round", so it carries its
// weight against the percentage — the owner's UI pass found it too faint at t-data in boneDim.
//
// The timer is Grenze Gotisch at the t-stage step with tabular lining figures, in bone, on a small
// stone chip. While the stage runs the chip breathes: it swells and a stoneLit face fades up inside
// it, quickening at each of art.timerBeatThresholds. The number itself never dims, so the beat reads
// as deliberate rather than as a glitch. Transform and opacity only, on the UI thread (hard rule
// 3). Under reduce motion it holds still and only the number changes.
//
// The percentage is set in Oswald 600, the owner's choice in the UI pass: condensed, tall and plain,
// with lining digits, so the biggest number on screen reads at a glance mid-tap. Oswald has no
// tabular figures, so each digit sits centred in a fixed slot (art.percentDigitSlot) and the number
// never walks sideways while the player taps.
//
// Only the digits are slotted. "%" is nearly twice a digit's width, so forcing it into a digit slot
// would clip it — and it never changes, so it does not need one.
// The row itself is three equal-flex cells, so the centre cell holds the screen's centre line
// whatever the round and timer say.
//
// §3.1: the percentage sits in bone for the whole match and takes flameWhite only during the
// Threshold crossing. That is the one time fire touches it — and the Reckoning's final board, which
// reuses `Percent`, never passes it fire.

type BoardHeaderProps = {
  round: number
  /** Whole percent of the win target, already floored and capped by the caller. */
  percent: number
  secondsLeft: number
  crossed: boolean
  onRules: () => void
}

// The step for the percentage, judged on the phone in item 1b by capturing both candidates.
// t-heart ships: at t-display (32) the number carries the same weight as the round and the timer,
// and with no drawn Heart the percentage is the only readout of board state on screen, so it has
// to outrank them.
const percentType = tokens.type.heart

function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function BoardHeader({ round, percent, secondsLeft, crossed, onRules }: BoardHeaderProps) {
  return (
    <View style={styles.row}>
      <View style={[styles.side, styles.left]}>
        <Pressable
          onPress={onRules}
          accessibilityRole="button"
          accessibilityLabel="How to play"
          hitSlop={(tokens.layout.minTouchTarget - tokens.home.aboutMark) / 2}
          style={styles.rules}
        >
          <View style={styles.rulesMark} />
        </Pressable>
        <Text style={styles.meta} accessibilityLabel={`Round ${round}`}>
          {'Round '}
          <Text style={styles.round}>{String(round)}</Text>
        </Text>
      </View>

      <Percent percent={percent} colour={crossed ? tokens.palette.flameWhite : tokens.palette.bone} />

      <View style={styles.side}>
        <Timer secondsLeft={secondsLeft} />
      </View>
    </View>
  )
}

/** The band of art.timerBeatThresholds the clock is in: 0 is calm, each step quicker. */
function beatBand(secondsLeft: number): number {
  return tokens.art.timerBeatThresholds.filter((threshold) => secondsLeft <= threshold).length
}

function Timer({ secondsLeft }: { secondsLeft: number }) {
  const reduceMotion = useReducedMotion()
  const running = secondsLeft > 0
  const band = beatBand(secondsLeft)
  const beat = useSharedValue(0)

  // Restarted only when the band changes or the stage stops, never per second.
  useEffect(() => {
    if (reduceMotion || !running) {
      cancelAnimation(beat)
      beat.set(0)
      return
    }
    const half = { duration: motion.timerBeat[band] / 2, easing: motion.easing.easeInOut }
    beat.set(withRepeat(withSequence(withTiming(1, half), withTiming(0, half)), -1))
  }, [beat, band, running, reduceMotion])

  const { timerBeatScale } = tokens.art
  const chipStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + beat.get() * (timerBeatScale - 1) }] }))
  const litStyle = useAnimatedStyle(() => ({ opacity: beat.get() }))

  return (
    <Animated.View style={[styles.timerChip, chipStyle]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.timerLit, litStyle]} />
      <Text style={styles.timer} accessibilityLabel={`${Math.max(0, Math.floor(secondsLeft))} seconds left`}>
        {clock(secondsLeft)}
      </Text>
    </Animated.View>
  )
}

/**
 * The percentage in its fixed digit slots. Shared with the Reckoning's final board and the broken
 * state's dark one, which set it in other colours but must not set it differently.
 */
export function Percent({ percent, colour }: { percent: number; colour: string }) {
  const slot = Math.round(percentType.fontSize * tokens.art.percentDigitSlot)
  const digits = String(percent).split('')
  const glyphStyle = [styles.percentGlyph, { color: colour }]
  // `accessible` collapses the digit slots into one announcement. Without it Android walks the
  // slots individually and a screen reader reads the percentage as "5", "8", "%" — the fixed-slot
  // layout is a typographic device and must not leak into the a11y tree.
  return (
    <View
      style={styles.percent}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`The board is ${percent} percent full`}
    >
      {digits.map((digit, i) => (
        // Index keys: these are glyph slots at fixed positions, not a reorderable list.
        <View key={i} style={{ width: slot }}>
          <Text style={glyphStyle}>{digit}</Text>
        </View>
      ))}
      <Text style={glyphStyle}>%</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    height: tokens.layout.header,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.space.lg,
  },
  // Equal flex on both sides keeps the percentage on the screen's centre line.
  side: {
    flex: 1,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.md,
  },
  rules: {
    width: tokens.home.aboutMark,
    height: tokens.home.aboutMark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rulesMark: {
    width: tokens.home.aboutMark,
    height: tokens.home.aboutMark,
    borderWidth: tokens.art.sigilStroke,
    borderColor: tokens.palette.boneDim,
    transform: [{ rotate: '45deg' }],
  },
  meta: {
    ...tokens.type.data,
    color: tokens.palette.boneDim,
  },
  round: {
    ...tokens.type.stage,
    ...tokens.tabularFigures,
    color: tokens.palette.bone,
  },
  // A small raised stone chip. Scales about its own right edge, so the beat never pushes it off
  // the screen's edge.
  timerChip: {
    ...tokens.material.raisedStoneFace,
    alignSelf: 'flex-end',
    transformOrigin: 'right',
    borderRadius: tokens.radii.chip,
    paddingHorizontal: tokens.art.timerChipPadH,
    paddingVertical: tokens.art.timerChipPadV,
    overflow: 'hidden',
  },
  timerLit: {
    backgroundColor: tokens.palette.stoneLit,
  },
  timer: {
    ...tokens.type.stage,
    ...tokens.tabularFigures,
    color: tokens.palette.bone,
  },
  percent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  percentGlyph: {
    ...percentType,
    textAlign: 'center',
  },
})
