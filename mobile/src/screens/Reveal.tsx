import * as Haptics from 'expo-haptics'
import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'

import type { MatchConfig, PlayerId, RevealedVoteRound, VoteTarget } from '../../protocol/generated'
import { SeatToken } from '../art/SeatToken'
import { SEAT_TEXT_COLOURS, Sigil, type SeatNumber } from '../art/Sigil'
import { motion } from '../design/motion'
import { tokens } from '../design/tokens'

// §7.6 and §7.7: the Reveal, then Cast Out. It fills the lower region while the board stays in
// view above it.
//
//   0     – 400   every mark flips in at once
//   400   – 1400  the marks hold
//   1400          resolve. Nobody: "No one is cast out.", held, done.
//                 Someone: Cast Out, castOut long — their token settles into cold, the line
//                 states the consequence, the warning haptic fires once.
//
// **Each mark is exactly what that player cast** (PROTOCOL.md §3), including a vote for a player
// ejected before the stage closed, which the server tallied as a skip but reveals as cast.
//
// **Nothing here reveals a role.** Ejection names a player and a consequence, and that is all —
// hard rule 4.

type RevealProps = {
  result: RevealedVoteRound
  seats: Record<PlayerId, SeatNumber>
  names: Map<PlayerId, string>
  youId: PlayerId
  /** Players already cold when the vote closed — ejected by grace since they were marked. */
  alreadyCold: ReadonlySet<PlayerId>
  config: MatchConfig
  /** Called when the vote resolves, so the board can show the cast-out conduit going cold. */
  onResolve: () => void
  onDone: () => void
}

const resolveAt = motion.duration.voteReveal + motion.duration.revealHold

function consequence(config: MatchConfig): string {
  return config.dormantEfficiencyPct === 50
    ? 'Offerings into it are halved.'
    : `Offerings into it count for ${config.dormantEfficiencyPct} parts in a hundred.`
}

export function Reveal({ result, seats, names, youId, alreadyCold, config, onResolve, onDone }: RevealProps) {
  const { ejected } = result
  const marks = useSharedValue(0)
  const warm = useSharedValue(1)
  const line = useSharedValue(0)

  useEffect(() => {
    marks.set(withTiming(1, motion.transition.voteReveal))
    line.set(withDelay(resolveAt, withTiming(1, motion.transition.voteReveal)))
    if (ejected !== null) warm.set(withDelay(resolveAt, withTiming(0, motion.transition.castOutCold)))

    const resolved = setTimeout(() => {
      onResolve()
      // §8: NotificationFeedbackType.Warning on Cast Out, and on nothing else.
      if (ejected !== null) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    }, resolveAt)
    const total = resolveAt + (ejected !== null ? motion.duration.castOut : motion.duration.revealHold * 2)
    const done = setTimeout(onDone, total)
    return () => {
      clearTimeout(resolved)
      clearTimeout(done)
    }
    // Plays once per result; the parent keys this component by round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const marksStyle = useAnimatedStyle(() => ({ opacity: marks.get() }))
  const warmStyle = useAnimatedStyle(() => ({ opacity: warm.get() }))
  const coldStyle = useAnimatedStyle(() => ({ opacity: 1 - warm.get() }))
  const lineStyle = useAnimatedStyle(() => ({ opacity: line.get() }))

  // Every player who could be judged, plus anyone who drew a mark — which covers a vote for a
  // player ejected before the close. Ordered by seat, like the board.
  const castFor = new Map<VoteTarget, PlayerId[]>()
  for (const [voter, target] of Object.entries(result.votes)) {
    castFor.set(target, [...(castFor.get(target) ?? []), voter])
  }
  const targets = Object.keys(seats)
    .filter((id) => castFor.has(id) || id in result.votes || id === ejected)
    .sort((a, b) => seats[a] - seats[b])
  const withheld = castFor.get('skip') ?? []

  const ejectedName = ejected === null ? '' : (names.get(ejected) ?? '')
  const text =
    ejected === null
      ? 'No one is cast out.'
      : ejected === youId
        ? `You are cast out. Your conduit is cold. ${consequence(config)}`
        : `${ejectedName} is cast out. Their conduit is cold. ${consequence(config)}`

  return (
    <View style={styles.root} accessibilityLiveRegion="polite">
      <View style={styles.row}>
        {targets.map((id) => (
          <View key={id} style={styles.column}>
            <View>
              {id === ejected ? (
                <>
                  <Animated.View style={warmStyle}>
                    <SeatToken seat={seats[id]} disc={tokens.art.voteDisc} sigil={tokens.art.voteSigil} />
                  </Animated.View>
                  <Animated.View style={[StyleSheet.absoluteFill, coldStyle]}>
                    <SeatToken seat={seats[id]} disc={tokens.art.voteDisc} sigil={tokens.art.voteSigil} cold />
                  </Animated.View>
                </>
              ) : (
                <SeatToken
                  seat={seats[id]}
                  disc={tokens.art.voteDisc}
                  sigil={tokens.art.voteSigil}
                  cold={alreadyCold.has(id)}
                />
              )}
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {names.get(id) ?? ''}
            </Text>
            <Marks voters={castFor.get(id) ?? []} seats={seats} style={marksStyle} />
          </View>
        ))}
      </View>

      <View style={styles.withhold}>
        <Text style={styles.withholdLabel}>Withheld</Text>
        <Marks voters={withheld} seats={seats} style={marksStyle} />
      </View>

      <Animated.Text style={[styles.line, lineStyle]}>{text}</Animated.Text>
    </View>
  )
}

/** The voters' own sigils under what they cast for. All of them share one opacity: one flip. */
function Marks({
  voters,
  seats,
  style,
}: {
  voters: PlayerId[]
  seats: Record<PlayerId, SeatNumber>
  style: ReturnType<typeof useAnimatedStyle>
}) {
  return (
    <Animated.View style={[styles.marks, style]}>
      {voters.map((voter) =>
        seats[voter] === undefined ? null : (
          <Sigil
            key={voter}
            seat={seats[voter]}
            colour={SEAT_TEXT_COLOURS[seats[voter]]}
            size={tokens.art.sigilSmall}
          />
        ),
      )}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: tokens.layout.screenGutter,
    paddingTop: tokens.layout.sectionGap,
    gap: tokens.layout.stackGap,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  column: {
    flex: 1,
    alignItems: 'center',
    gap: tokens.art.namePlateGap,
  },
  name: {
    ...tokens.type.label,
    color: tokens.palette.bone,
    maxWidth: '90%',
  },
  marks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: tokens.art.namePlateGap,
    minHeight: tokens.art.sigilSmall,
  },
  withhold: {
    alignItems: 'center',
    gap: tokens.art.namePlateGap,
    marginTop: tokens.layout.stackGap,
  },
  withholdLabel: {
    ...tokens.type.label,
    color: tokens.palette.boneDim,
  },
  line: {
    ...tokens.type.stage,
    color: tokens.palette.bone,
    textAlign: 'center',
    marginTop: tokens.layout.sectionGap,
  },
})
