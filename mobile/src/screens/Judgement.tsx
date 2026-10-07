import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { PlayerId, VoteTarget } from '../../protocol/generated'
import { SeatToken } from '../art/SeatToken'
import type { SeatNumber } from '../art/Sigil'
import { tokens } from '../design/tokens'
import { fit } from '../design/fit'
import { match, session } from '../net/session'
import { usePolled } from './Offering'

// §7.6, the Vote stage's lower region, centred in the space below the board. The living players'
// masks in a row; Skip apart, below a divider, as a control of its own, because abstaining is a
// choice and not a fifth player. Tap to place your mark — a gold ring round the mask — and tap
// again elsewhere to move it. The server keeps the last one.
//
// **This screen knows one vote: yours.** Nothing about anyone else's vote exists on the wire before
// VOTE_RESULT (PROTOCOL.md §6), and nothing here stands in for it — no count, no "has voted", no
// progress of any kind. Your mark is drawn from what you sent, not from anything the server said.
//
// An ejected player is not a target — the server refuses a vote for one — and a cast-out
// player has no row to vote from at all.

type JudgementProps = {
  seats: Record<PlayerId, SeatNumber>
  round: number
  /** False for a cast-out player: the row is removed, not disabled. */
  canVote: boolean
}

// Who can still be judged, as a string, so the row re-renders only when that set changes.
const readEjected = () =>
  (match.snapshot()?.players ?? [])
    .filter((p) => p.status === 'ejected')
    .map((p) => p.id)
    .join(',')

export function Judgement({ seats, round, canVote }: JudgementProps) {
  usePolled(readEjected)
  const [vote, setVote] = useState<VoteTarget | null>(() => session.myVote(round))

  const cast = useCallback(
    (target: VoteTarget) => {
      session.vote(round, target)
      setVote(target)
    },
    [round],
  )

  if (!canVote) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Vote</Text>
        <Text style={styles.line}>You are voted out. The others vote.</Text>
      </View>
    )
  }

  const players = (match.snapshot()?.players ?? [])
    .filter((p) => seats[p.id] !== undefined)
    .sort((a, b) => seats[a.id] - seats[b.id])
  // Living players are targets. A player ejected mid-stage stays in the row only if your mark is
  // already on them — your vote stands as cast, and the Reveal will show it as cast.
  const shown = players.filter((p) => p.status !== 'ejected' || vote === p.id)

  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <Text style={styles.title}>Vote</Text>
        <Text style={styles.line}>Vote for who you think is the Hollow. You can change it until the vote closes.</Text>
      </View>

      <View style={styles.row}>
        {shown.map((p) => {
          const ejected = p.status === 'ejected'
          const marked = vote === p.id
          return (
            <Pressable
              key={p.id}
              onPress={ejected ? undefined : () => cast(p.id)}
              disabled={ejected}
              accessibilityRole="button"
              accessibilityLabel={`Vote for ${p.name}`}
              accessibilityState={{ selected: marked }}
              style={styles.choice}
            >
              {/* Your mark: a gold ring round the mask you chose. Space is held either way, so
                  nothing moves when the mark does. */}
              <View style={[styles.ring, marked ? styles.ringMarked : null]}>
                <SeatToken seat={seats[p.id]} disc={tokens.art.voteDisc} sigil={tokens.art.voteSigil} cold={ejected} />
              </View>
              <Text style={[styles.name, marked ? styles.nameMarked : null]} numberOfLines={1}>
                {fit(p.name)}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {/* Skip stands apart from the four, behind a divider: a choice not to choose, never a fifth
          player. Marked the same way a mask is — a gold edge. */}
      <View style={styles.divider}>
        <View style={styles.rule} />
        <Text style={styles.or}>{fit('or')}</Text>
        <View style={styles.rule} />
      </View>
      <Pressable
        onPress={() => cast('skip')}
        accessibilityRole="button"
        accessibilityLabel="Skip your vote"
        accessibilityState={{ selected: vote === 'skip' }}
        style={[styles.skip, vote === 'skip' ? styles.skipMarked : null]}
      >
        <Text style={[styles.skipLabel, vote === 'skip' ? styles.nameMarked : null]}>{fit('Skip this vote')}</Text>
      </Pressable>
    </View>
  )
}

// The vote ring: the token, then a gap of void, then the ring — so the ring reads as drawn round
// the mask, not as the disc's edge.
const ringOuter = tokens.art.voteDisc + (tokens.art.voteRingGap + tokens.art.voteRing) * 2

const styles = StyleSheet.create({
  // Centred in the lower region, so the block balances the board above rather than hugging it.
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.lg,
    gap: tokens.space.lg,
  },
  heading: {
    gap: tokens.space.xs,
  },
  title: {
    ...tokens.type.stage,
    color: tokens.palette.bone,
    textAlign: 'center',
  },
  line: {
    ...tokens.type.body,
    color: tokens.palette.boneDim,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  choice: {
    flex: 1,
    alignItems: 'center',
    gap: tokens.space.xs,
    minHeight: tokens.layout.minTouchTarget,
  },
  ring: {
    width: ringOuter,
    height: ringOuter,
    borderRadius: ringOuter / 2,
    borderWidth: tokens.art.voteRing,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // §3.1: gold is emphasis, and your mark is the one choice on this screen that is yours.
  ringMarked: {
    borderColor: tokens.palette.gold,
  },
  name: {
    ...tokens.type.label,
    color: tokens.palette.bone,
    maxWidth: '90%',
  },
  nameMarked: {
    color: tokens.palette.gold,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.xl,
  },
  rule: {
    flex: 1,
    height: tokens.art.thresholdThickness,
    backgroundColor: tokens.palette.stoneEdge,
  },
  or: {
    ...tokens.type.label,
    color: tokens.palette.boneDim,
  },
  // A real choice: a wide control of its own, an outline cut into the dark rather than a raised
  // disc, so it can never be mistaken for a fifth player. One border colour on every side, so the
  // gold of a chosen Skip runs all the way round.
  skip: {
    backgroundColor: tokens.palette.void,
    alignSelf: 'stretch',
    marginHorizontal: tokens.space.xl,
    minHeight: tokens.layout.minTouchTarget,
    borderRadius: tokens.radii.chip,
    borderWidth: tokens.art.voteRing,
    borderColor: tokens.palette.stoneEdge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipMarked: {
    borderColor: tokens.palette.gold,
  },
  skipLabel: {
    ...tokens.type.control,
    color: tokens.palette.bone,
  },
})
