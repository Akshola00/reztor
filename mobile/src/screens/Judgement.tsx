import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { PlayerId, VoteTarget } from '../../protocol/generated'
import { SeatToken } from '../art/SeatToken'
import type { SeatNumber } from '../art/Sigil'
import { tokens } from '../design/tokens'
import { match, session } from '../net/session'
import { usePolled } from './Offering'

// §7.6, the Judgement stage's lower region. The living players' tokens in a row; Withhold apart
// and lower, because abstaining is a choice and not a fifth player. Tap to place your mark; tap
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
      <Text style={styles.title}>Vote</Text>
      <Text style={styles.line}>Vote for who you think is the Hollow. You can change it until the vote closes.</Text>

      <View style={styles.row}>
        {shown.map((p) => {
          const ejected = p.status === 'ejected'
          return (
            <Pressable
              key={p.id}
              onPress={ejected ? undefined : () => cast(p.id)}
              disabled={ejected}
              accessibilityRole="button"
              accessibilityLabel={`Vote for ${p.name}`}
              accessibilityState={{ selected: vote === p.id }}
              style={styles.choice}
            >
              <SeatToken seat={seats[p.id]} disc={tokens.art.voteDisc} sigil={tokens.art.voteSigil} cold={ejected} />
              <Text style={styles.name} numberOfLines={1}>
                {p.name}
              </Text>
              <MarkSlot marked={vote === p.id} />
            </Pressable>
          )
        })}
      </View>

      <Pressable
        onPress={() => cast('skip')}
        accessibilityRole="button"
        accessibilityLabel="Skip your vote"
        accessibilityState={{ selected: vote === 'skip' }}
        style={styles.withhold}
      >
        <View style={styles.withholdFace}>
          <Text style={styles.withholdLabel}>Skip</Text>
        </View>
        <MarkSlot marked={vote === 'skip'} />
      </Pressable>
    </View>
  )
}

/** Your mark: a small square on its point, the Marking's shape, in bone. Space is held either way. */
function MarkSlot({ marked }: { marked: boolean }) {
  return <View style={styles.markSlot}>{marked ? <View style={styles.mark} /> : null}</View>
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: tokens.layout.screenGutter,
    paddingTop: tokens.layout.stackGap,
    gap: tokens.layout.stackGap,
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
    marginTop: tokens.layout.stackGap,
  },
  choice: {
    flex: 1,
    alignItems: 'center',
    gap: tokens.art.namePlateGap,
    minHeight: tokens.layout.minTouchTarget,
  },
  name: {
    ...tokens.type.label,
    color: tokens.palette.bone,
    maxWidth: '90%',
  },
  // Apart from the row and lower than it: §7.6.
  withhold: {
    alignSelf: 'center',
    alignItems: 'center',
    gap: tokens.art.namePlateGap,
    marginTop: tokens.layout.sectionGap,
  },
  withholdFace: {
    ...tokens.material.raisedStoneFace,
    borderRadius: tokens.radii.chip,
    minHeight: tokens.layout.minTouchTarget,
    paddingHorizontal: tokens.layout.sectionGap,
    justifyContent: 'center',
  },
  withholdLabel: {
    ...tokens.type.control,
    color: tokens.palette.bone,
  },
  markSlot: {
    height: tokens.art.voteMark * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: tokens.art.voteMark,
    height: tokens.art.voteMark,
    backgroundColor: tokens.palette.bone,
    transform: [{ rotate: '45deg' }],
  },
})
