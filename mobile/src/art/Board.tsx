import { useState, type ReactNode } from 'react'
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { LaneSnapshot, MatchConfig, PlayerId, PlayerSnapshot } from '../../protocol/generated'
import { tokens } from '../design/tokens'
import { Conduit } from './Conduit'
import { Heart, type VesselVariant } from './Heart'
import { NamePlate } from './NamePlate'
import type { Seat4Variant, SeatNumber } from './Sigil'

// §6.1's composition: the Heart above four conduits, the Threshold crossing all four as one
// carved line, name plates at their feet, then the plinth.
//
// Capacity and win target arrive in `config` and are never hardcoded. The Threshold sits at
// winTarget / laneCount / laneCapacity of each conduit's height — 2400/4/1000 = 0.60, which is
// exactly §6.1's 60%.

type BoardProps = {
  lanes: LaneSnapshot[]
  players: PlayerSnapshot[]
  boardTotal: number
  config: MatchConfig
  youId: PlayerId
  header?: ReactNode
  heartWeight?: 400 | 700
  seat4Variant?: Seat4Variant
  vessel?: VesselVariant
}

export function Board({
  lanes,
  players,
  boardTotal,
  config,
  youId,
  header,
  heartWeight = 400,
  seat4Variant = 'A',
  vessel = 'B',
}: BoardProps) {
  const insets = useSafeAreaInsets()
  // The conduits flex, so their pixel height is only known after layout. SVG needs it in
  // pixels to place the frontier, and item 2 needs pixels to animate translateY.
  const [conduitHeight, setConduitHeight] = useState(0)

  const { art, layout, palette } = tokens

  const laneCount = lanes.length || 1
  const thresholdFraction = config.winTarget / laneCount / config.laneCapacity
  // §6.4: the Heart stops escalating above the Threshold.
  const boardFraction = Math.max(0, Math.min(1, boardTotal / config.winTarget))
  // The spec names no formula for the Heart's percentage; this is the only reading that gives
  // §6.1's own 58% for its example board. Capped at 100 so a crossed board never reads 104%.
  //
  // Integer-first, and deliberately so: (1392 / 2400) * 100 is 57.99999999999999 in binary
  // floating point, so the obvious spelling floored to 57 on item 1's first screenshot.
  // Multiply before dividing.
  const percent = Math.min(100, Math.floor((boardTotal * 100) / config.winTarget))
  const crossed = boardTotal >= config.winTarget

  const nameFor = (owner: PlayerId) => players.find((p) => p.id === owner)?.name ?? ''

  const onConduitLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height)
    if (h !== conduitHeight) {
      setConduitHeight(h)
    }
  }

  const columnWidth = art.conduitWidth

  return (
    <View style={styles.root}>
      {/* Header slot — starts below the safe area. */}
      <View style={[styles.header, { marginTop: insets.top }]}>{header}</View>

      {/* Heart block. */}
      <View style={styles.heartBlock}>
        <Heart fraction={boardFraction} vessel={vessel} />
        <Text
          style={[
            styles.percent,
            {
              fontFamily: heartWeight === 700 ? tokens.fontFamily.displayBold : tokens.fontFamily.displayRegular,
            },
          ]}
        >
          {`${percent}%`}
        </Text>
      </View>

      {/* Conduits. They flex to fill whatever height is left. */}
      <View style={styles.conduitArea} onLayout={onConduitLayout}>
        {/* The Threshold, drawn before the columns so it sits *behind* the apertures. A line
            carved across stone is interrupted by an opening cut through it; drawn on top it
            struck a dark rule across a filled lane and read as a rendering glitch. */}
        {conduitHeight > 0 ? (
          <View pointerEvents="none" style={[styles.threshold, { top: conduitHeight * (1 - thresholdFraction) }]}>
            <View
              style={{
                height: art.thresholdThickness,
                backgroundColor: crossed ? palette.flame : palette.stoneLit,
              }}
            />
            <View
              style={{
                height: art.thresholdThickness,
                backgroundColor: crossed ? palette.flameDeep : palette.bevelShadow,
              }}
            />
          </View>
        ) : null}

        <View style={[styles.columns, { gap: art.conduitGap }]}>
          {lanes.map((lane) => {
            const own = lane.owner === youId
            return (
              <View key={lane.owner} style={{ width: columnWidth }}>
                {conduitHeight > 0 ? (
                  <Conduit
                    units={lane.units}
                    capacity={config.laneCapacity}
                    dormant={lane.dormant}
                    height={conduitHeight}
                    width={columnWidth}
                  />
                ) : null}
                {/* Top half of your own bracket. No colour difference anywhere. */}
                {own ? <View style={[styles.bracket, styles.bracketTop]} /> : null}
                {own ? <View style={[styles.bracket, styles.bracketTopRight]} /> : null}
              </View>
            )
          })}
        </View>
      </View>

      {/* Name plates, in the slot §6.1 gives the Faithful. */}
      <View style={styles.plateArea}>
        <View style={[styles.columns, { gap: art.conduitGap }]}>
          {lanes.map((lane, i) => {
            const own = lane.owner === youId
            const seat = (i + 1) as SeatNumber
            return (
              <View key={lane.owner} style={{ width: columnWidth }}>
                <NamePlate
                  seat={seat}
                  name={nameFor(lane.owner)}
                  width={columnWidth}
                  dormant={lane.dormant}
                  seat4Variant={seat4Variant}
                />
                {/* Bottom half of the same bracket. */}
                {own ? <View style={[styles.bracket, styles.bracketBottom]} /> : null}
                {own ? <View style={[styles.bracket, styles.bracketBottomRight]} /> : null}
              </View>
            )
          })}
        </View>
      </View>

      {/* Controls slot — empty until item 2. */}
      <View style={styles.controls} />

      {/* The plinth, running to the bottom edge so the gesture bar sits over dead space. */}
      <View style={[styles.plinth, { height: layout.plinth + insets.bottom }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    height: tokens.layout.header,
    justifyContent: 'center',
  },
  heartBlock: {
    height: tokens.layout.heart,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percent: {
    ...tokens.type.heart,
    ...tokens.tabularFigures,
    color: tokens.palette.bone,
  },
  conduitArea: {
    flex: 1,
    minHeight: tokens.layout.conduits,
    justifyContent: 'flex-end',
  },
  columns: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  threshold: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  plateArea: {
    height: tokens.layout.namePlates,
    justifyContent: 'flex-start',
    paddingTop: (tokens.layout.namePlates - tokens.art.namePlateHeight) / 2,
  },
  controls: {
    height: tokens.layout.controls,
  },
  plinth: {
    ...tokens.material.raisedStoneFace,
    borderRadius: tokens.radii.plinth,
  },
  // Two short carved marks at the top of your conduit and two at the bottom of your plate, so
  // one bracket encloses both. Identity is never carried by colour.
  bracket: {
    position: 'absolute',
    height: tokens.art.bracketThickness,
    width: tokens.art.bracketLength,
    backgroundColor: tokens.palette.stoneLit,
  },
  bracketTop: {
    top: 0,
    left: 0,
  },
  bracketTopRight: {
    top: 0,
    right: 0,
  },
  bracketBottom: {
    bottom: 0,
    left: 0,
  },
  bracketBottomRight: {
    bottom: 0,
    right: 0,
  },
})
