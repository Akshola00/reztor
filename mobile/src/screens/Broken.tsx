import { Redirect } from 'expo-router'
import { useEffect, useState } from 'react'
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { PlayerId } from '../../protocol/generated'
import type { SeatNumber } from '../art/Sigil'
import { StillBoard } from '../art/StillBoard'
import { tokens } from '../design/tokens'
import { match } from '../net/session'
import { Action, Enter, goHome, skr } from './Reckoning'

// /broken — §7.9's void. The moment a player worries about their money, so it is its own screen
// and never a toast: the percentage and the conduits go dark, and the copy says what happened and
// what it cost. No apology, no filler. Transaction links are cut for the MVP (BUILD-PLAN.md §2).
//
// Two ways here, both from MATCH_END:
//   - a voided rite (two celebrants left past their grace), which carries a settlement whose
//     refund lines are the amounts;
//   - MATCH_END's error variant, when the server could not settle at all. It carries no amounts.
//     The server voids the escrow in full when it cannot settle (../server/src/net/server.ts,
//     `settle`), so the refund is the whole stake, `config.buyInSkr`.

type BrokenState = {
  cause: string
  /** The refund, in SKR, already formatted. */
  refund: string
  lanes: { owner: PlayerId; units: number; dormant: boolean }[]
  seats: Map<PlayerId, SeatNumber>
  youId: PlayerId
  capacity: number
  winTarget: number
}

/** Taken once, on mount, like the Reckoning's: leaving clears the store underneath. */
function readBroken(): BrokenState | null {
  const s = match.snapshot()
  if (s === null || s.end === null) return null
  const { config } = s
  let cause: string
  let refundCredits: number
  if ('error' in s.end) {
    cause = "The payout couldn't be completed."
    refundCredits = config.buyInSkr * config.creditsPerSkr
  } else if (s.end.reveal.resolution.kind === 'voided') {
    cause = "Two players left and didn't come back."
    refundCredits = s.end.settlement.lines.find((l) => l.playerId === s.you.id)?.refund ?? 0
  } else {
    return null
  }
  return {
    cause,
    refund: skr(refundCredits, config.creditsPerSkr).replace(/\.0+$/, ''),
    lanes: s.lanes,
    seats: new Map(s.lanes.map((l, i) => [l.owner, (i + 1) as SeatNumber])),
    youId: s.you.id,
    capacity: config.laneCapacity,
    winTarget: config.winTarget,
  }
}

export function Broken() {
  const insets = useSafeAreaInsets()
  const [state] = useState(readBroken)

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goHome()
      return true
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (__DEV__ && state !== null) console.log('[ui] broken', state.cause)
  }, [state])

  if (state === null) return <Redirect href="/" />

  return (
    // The inset sits outside the scroll, so nothing scrolls up under the status bar.
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: tokens.space.xl, paddingBottom: insets.bottom + tokens.space.xl },
        ]}
      >
        {/* The results screen's layout and entrance (part 3 of the owner's UI pass): what happened to
            this player's money first, then the dark board, then the way out. */}
        <Enter beat={0}>
          <View style={styles.group} accessibilityLiveRegion="polite">
            <Text style={styles.title} accessibilityRole="header">
              The rite is broken.
            </Text>
            <Text style={styles.body}>{state.cause}</Text>
            {/* §7.9's line, with the refund in gold. */}
            <Text style={styles.body}>
              {'Nothing was spent. '}
              <Text style={styles.gold}>{`${state.refund} SKR`}</Text>
              {' returned to your wallet.'}
            </Text>
          </View>
        </Enter>

        <Enter beat={1}>
          <StillBoard
            lanes={state.lanes}
            seatOf={(id) => state.seats.get(id) ?? 1}
            youId={state.youId}
            capacity={state.capacity}
            winTarget={state.winTarget}
            dark
          />
        </Enter>

        <Enter beat={2}>
          <View style={styles.actions}>
            <Action label="Play again" onPress={goHome} primary />
            <Action label="Leave" onPress={goHome} />
          </View>
        </Enter>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: tokens.space.lg,
    gap: tokens.space.xxl,
  },
  group: {
    gap: tokens.space.md,
  },
  title: {
    ...tokens.type.display,
    color: tokens.palette.bone,
  },
  body: {
    ...tokens.type.body,
    color: tokens.palette.bone,
  },
  gold: {
    ...tokens.tabularFigures,
    color: tokens.palette.gold,
  },
  actions: {
    flexDirection: 'row',
    gap: tokens.space.md,
  },
})
