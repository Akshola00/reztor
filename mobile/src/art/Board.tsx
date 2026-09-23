import { useState, type ReactNode } from 'react'
import { LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { LaneSnapshot, MatchConfig, PlayerId } from '../../protocol/generated'
import { tokens } from '../design/tokens'
import { Conduit } from './Conduit'
import { RidingToken } from './RidingToken'
import type { SeatNumber } from './Sigil'

// §6.1's composition. Four conduits fill the width between small outer margins, separated by
// gaps of background — the background itself is the divider, and hard rule 1 requires the
// conduits never touch. Nothing is drawn above them but a thin header; below them the stage puts
// whatever it needs — during the Offering, the controls row and the tap band.
//
// There is no stone field and no vessel. The board is void plus grain, and the conduits are the
// hero image.
//
// Capacity and win target arrive in `config` and are never hardcoded. The Threshold sits at
// winTarget / laneCount / laneCapacity of each conduit's height — 2400/4/1000 = 0.60, which is
// exactly §6.1's 60%.
//
// The board never re-renders for a change in units. Each lane's level is a shared value owned by
// the stage, and the conduit, its surface and its token read it on the UI thread.

type BoardProps = {
  /** Owners and dormancy. `units` here is ignored — the level comes from `laneUnits`. */
  lanes: LaneSnapshot[]
  laneUnits: Record<PlayerId, SharedValue<number>>
  config: MatchConfig
  youId: PlayerId
  crossed: boolean
  /** §6.1's header band. Supplied by the stage, so its readouts refresh without re-rendering the board. */
  header: ReactNode
  children?: ReactNode
}

export function Board({ lanes, laneUnits, config, youId, crossed, header, children }: BoardProps) {
  const insets = useSafeAreaInsets()
  const { width: screenWidth } = useWindowDimensions()
  // The conduits flex, so their pixel height is only known after layout, and the geometry that
  // places the frontier and the token needs it in pixels.
  const [conduitHeight, setConduitHeight] = useState(0)

  const { art } = tokens

  const laneCount = lanes.length || 1
  const thresholdFraction = config.winTarget / laneCount / config.laneCapacity

  // §6.1: derived, never fixed.
  const columnWidth = Math.floor(
    (screenWidth - art.conduitOuterMargin * 2 - art.conduitGap * (laneCount - 1)) / laneCount,
  )

  const onConduitLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height)
    if (h !== conduitHeight) {
      setConduitHeight(h)
    }
  }

  return (
    <View style={styles.root}>
      <View style={{ marginTop: insets.top }}>{header}</View>

      {/* Conduits. They flex to fill whatever height is left, so they are always the largest
          thing on screen. */}
      <View style={styles.conduitArea} onLayout={onConduitLayout}>
        <View style={[styles.columns, { gap: art.conduitGap }]}>
          {lanes.map((lane, i) => {
            const own = lane.owner === youId
            const seat = (i + 1) as SeatNumber
            const units = laneUnits[lane.owner]
            return (
              <View key={lane.owner} style={{ width: columnWidth, height: '100%' }}>
                {conduitHeight > 0 ? (
                  <>
                    <Conduit
                      units={units}
                      capacity={config.laneCapacity}
                      dormant={lane.dormant}
                      width={columnWidth}
                      height={conduitHeight}
                      thresholdFraction={thresholdFraction}
                      crossed={crossed}
                    />
                    <RidingToken
                      seat={seat}
                      own={own}
                      dormant={lane.dormant}
                      units={units}
                      capacity={config.laneCapacity}
                      height={conduitHeight}
                    />
                  </>
                ) : null}
              </View>
            )
          })}
        </View>
      </View>

      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  // No background: the root layout's void and its grain show through, and the gaps between the
  // conduits read as darkness rather than as drawn dividers.
  root: {
    flex: 1,
  },
  conduitArea: {
    flex: 1,
    minHeight: tokens.layout.conduits,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: tokens.art.conduitOuterMargin,
  },
  columns: {
    flexDirection: 'row',
    justifyContent: 'center',
    height: '100%',
  },
})
