import { useState, type ReactNode } from 'react'
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { LaneSnapshot, MatchConfig, PlayerId, PlayerSnapshot } from '../../protocol/generated'
import { tokens } from '../design/tokens'
import { Conduit } from './Conduit'
import { Heart } from './Heart'
import { NamePlate } from './NamePlate'
import type { SeatNumber } from './Sigil'

// §6.1's composition, built as architecture rather than as elements on a background.
//
// A full-bleed field of stone runs edge to edge from the safe area down to the plinth. It is not
// a panel: it has no margins and no corners. The Heart's vessel and the four conduits are
// recesses cut into that field, each with §3.3's bevel inverted for a recess — dark edge at the
// head, lit edge at the foot. The names are inscribed straight onto the field, so nothing here
// is a card (§4). The plinth stays a separate raised slab with a carved seam above it.
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
}

export function Board({ lanes, players, boardTotal, config, youId, header }: BoardProps) {
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
  // The Threshold spans the conduit row plus a small overhang, never the full screen: it is a
  // line carved across the apertures, not a divider rule across the interface.
  const rowWidth = laneCount * columnWidth + (laneCount - 1) * art.conduitGap
  const thresholdSpan = rowWidth + art.thresholdOverhang * 2

  return (
    <View style={styles.root}>
      {/* The stone field. Full bleed, no margins, no corners. */}
      <View style={styles.field}>
        {/* Header slot — starts below the safe area. */}
        <View style={[styles.header, { marginTop: insets.top }]}>{header}</View>

        {/* Heart block. */}
        <View style={styles.heartBlock}>
          <Heart fraction={boardFraction} />
          <Text style={styles.percent}>{`${percent}%`}</Text>
        </View>

        {/* Conduits. They flex to fill whatever height is left. */}
        <View style={styles.conduitArea} onLayout={onConduitLayout}>
          {/* The Threshold across the gaps and the overhang. Each Conduit draws the same carved
              pair over its own char, under its fill, so the line reads as one continuous cut. */}
          {conduitHeight > 0 ? (
            <View
              pointerEvents="none"
              style={[styles.threshold, { width: thresholdSpan, top: conduitHeight * (1 - thresholdFraction) }]}
            >
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
                      thresholdFraction={thresholdFraction}
                      crossed={crossed}
                      width={columnWidth}
                    />
                  ) : null}
                  {/* §6.1's first carved mark, at the head of your own channel. */}
                  {own ? (
                    <View pointerEvents="none" style={[styles.bracketRail, styles.bracketTopRail]}>
                      <View style={styles.bracket} />
                    </View>
                  ) : null}
                </View>
              )
            })}
          </View>
        </View>

        {/* Names, inscribed on the field in the slot §6.1 gives the Faithful. */}
        <View style={styles.plateArea}>
          <View style={[styles.columns, { gap: art.conduitGap }]}>
            {lanes.map((lane, i) => {
              const own = lane.owner === youId
              const seat = (i + 1) as SeatNumber
              return (
                <View key={lane.owner} style={{ width: columnWidth }}>
                  <NamePlate seat={seat} name={nameFor(lane.owner)} width={columnWidth} dormant={lane.dormant} />
                  {/* The second mark, at the foot of your inscription, so one bracket encloses
                      the channel and the name together. Never fire, never a seat colour. */}
                  {own ? (
                    <View pointerEvents="none" style={[styles.bracketRail, styles.bracketBottomRail]}>
                      <View style={styles.bracket} />
                    </View>
                  ) : null}
                </View>
              )
            })}
          </View>
        </View>

        {/* Controls slot — empty until item 2. */}
        <View style={styles.controls} />
      </View>

      {/* The carved seam, then the raised slab. The plinth runs to the bottom edge so the
          gesture bar sits over dead space rather than over the tap target (§10.4). */}
      <View style={styles.seam} />
      <View style={[styles.plinth, { height: layout.plinth + insets.bottom }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  field: {
    flex: 1,
    backgroundColor: tokens.palette.stone,
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
    alignItems: 'center',
  },
  columns: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  threshold: {
    position: 'absolute',
    alignSelf: 'center',
  },
  plateArea: {
    height: tokens.layout.namePlates,
    justifyContent: 'center',
  },
  controls: {
    height: tokens.layout.controls,
  },
  // A carved seam: the dark cut, then the lit top edge that raisedStoneFace puts on the slab.
  seam: {
    height: tokens.art.seamThickness,
    backgroundColor: tokens.palette.bevelShadow,
  },
  plinth: {
    ...tokens.material.raisedStoneFace,
    borderRadius: tokens.radii.plinth,
  },
  // §6.1: two short carved marks at the top and bottom edges of your own column. Identity is
  // never carried by colour, so these are boneDim and every column is otherwise identical.
  bracketRail: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bracketTopRail: {
    top: 0,
  },
  bracketBottomRail: {
    bottom: 0,
  },
  bracket: {
    height: tokens.art.bracketThickness,
    width: tokens.art.bracketLength,
    backgroundColor: tokens.palette.boneDim,
  },
})
