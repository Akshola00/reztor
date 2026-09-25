import { useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { makeMutable } from 'react-native-reanimated'

import type { PlayerId } from '../../protocol/generated'
import { tokens } from '../design/tokens'
import { Percent } from './BoardHeader'
import { Conduit } from './Conduit'
import { RidingToken } from './RidingToken'
import type { SeatNumber } from './Sigil'

// The board after the rite: §7.8's final board in the Reckoning, and §7.9's dark board on the
// broken screen. The same Conduit and RidingToken the match draws, held at their last level —
// nothing here moves, so each lane's shared value is made once and never written again.
//
// `dark` is §7.9's "the percentage and the conduits go dark": every conduit cold and the
// percentage in boneFaintText, the darkest grey that still clears 4.5:1, because it is information.
// Cold is the product's one word for fire that has gone out.
//
// The percentage never takes fire here. §3.1 gives it flame only during the crossing moment, and
// that moment belonged to the match; the lit Threshold marks are what record a crossing.

type StillLane = { owner: PlayerId; units: number; dormant: boolean }

type StillBoardProps = {
  /** In seat order. */
  lanes: StillLane[]
  seatOf: (id: PlayerId) => SeatNumber
  /** Whose token carries the own-conduit ring, if this phone held a seat. */
  youId: PlayerId | null
  capacity: number
  winTarget: number
  dark?: boolean
}

export function StillBoard({ lanes, seatOf, youId, capacity, winTarget, dark = false }: StillBoardProps) {
  const { width: screenWidth } = useWindowDimensions()
  const [units] = useState(() => Object.fromEntries(lanes.map((lane) => [lane.owner, makeMutable(lane.units)])))

  const { art } = tokens
  const laneCount = lanes.length || 1
  const total = lanes.reduce((sum, lane) => sum + lane.units, 0)
  // The live header's reading, so the number here is the number the match ended on.
  const percent = Math.min(100, Math.floor((total * 100) / winTarget))
  const crossed = !dark && total >= winTarget
  const thresholdFraction = winTarget / laneCount / capacity
  // §6.1's derivation, inside the screen gutter that holds the rest of the page.
  const columnWidth = Math.floor(
    (screenWidth - tokens.layout.screenGutter * 2 - art.conduitGap * (laneCount - 1)) / laneCount,
  )
  const height = art.stillBoardHeight

  return (
    <View style={styles.root}>
      <Percent percent={percent} colour={dark ? tokens.palette.boneFaintText : tokens.palette.bone} />
      <View style={[styles.columns, { gap: art.conduitGap, height }]}>
        {lanes.map((lane) => {
          const value = units[lane.owner]
          if (value === undefined) return null
          const cold = dark || lane.dormant
          return (
            <View key={lane.owner} style={{ width: columnWidth, height }}>
              <Conduit
                units={value}
                capacity={capacity}
                dormant={cold}
                width={columnWidth}
                height={height}
                thresholdFraction={thresholdFraction}
                crossed={crossed}
              />
              <RidingToken
                seat={seatOf(lane.owner)}
                own={lane.owner === youId}
                dormant={cold}
                disconnected={false}
                units={value}
                capacity={capacity}
                height={height}
              />
            </View>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    gap: tokens.layout.stackGap,
  },
  columns: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
})
