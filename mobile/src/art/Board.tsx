import { useState, type ReactNode } from 'react'
import { LayoutChangeEvent, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { LaneSnapshot, MatchConfig, PlayerId, Side, Tier } from '../../protocol/generated'
import { tokens } from '../design/tokens'
import { BoardHeader } from './BoardHeader'
import { Conduit, conduitGeometry } from './Conduit'
import { RidingToken } from './RidingToken'
import type { SeatNumber } from './Sigil'
import { SkrMark } from './SkrMark'

// §6.1's composition. Four conduits fill the width between small outer margins, separated by
// gaps of background — the background itself is the divider, and hard rule 1 requires the
// conduits never touch. Nothing is drawn above them but a thin header; below them sit the
// controls row and the tap band.
//
// There is no stone field and no vessel. The board is void plus grain, and the conduits are the
// hero image.
//
// Capacity and win target arrive in `config` and are never hardcoded. The Threshold sits at
// winTarget / laneCount / laneCapacity of each conduit's height — 2400/4/1000 = 0.60, which is
// exactly §6.1's 60%.

/** Which sheet the shared action button opens. See §7.4 and hard rule 4. */
export type SheetKind = 'augury' | 'auguryAndDraw'

type BoardProps = {
  lanes: LaneSnapshot[]
  boardTotal: number
  config: MatchConfig
  youId: PlayerId
  round: number
  secondsLeft: number
  credits: number
  tier: Tier
  /**
   * Hard rule 4. This decides *only* which sheet the action button opens, and must never reach a
   * rendered value — not a label, not a size, not an accessibility string. The closed board is
   * byte-identical for every role, and BoardPreview asserts exactly that.
   */
  role: Side
  onAction?: (sheet: SheetKind) => void
}

export function Board({
  lanes,
  boardTotal,
  config,
  youId,
  round,
  secondsLeft,
  credits,
  tier,
  role,
  onAction,
}: BoardProps) {
  const insets = useSafeAreaInsets()
  const { width: screenWidth } = useWindowDimensions()
  // The conduits flex, so their pixel height is only known after layout. SVG needs it in
  // pixels to place the frontier, and item 2 needs pixels to animate translateY.
  const [conduitHeight, setConduitHeight] = useState(0)

  const { art, layout, palette } = tokens

  const laneCount = lanes.length || 1
  const thresholdFraction = config.winTarget / laneCount / config.laneCapacity
  // The spec names no formula for the percentage; this is the only reading that gives §6.1's own
  // 58% for its example board. Capped at 100 so a crossed board never reads 104%.
  //
  // Integer-first, and deliberately so: (1392 / 2400) * 100 is 57.99999999999999 in binary
  // floating point, so the obvious spelling floored to 57 on item 1's first screenshot.
  const percent = Math.min(100, Math.floor((boardTotal * 100) / config.winTarget))
  const crossed = boardTotal >= config.winTarget

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

  // Constructed, not called: the controls are static until item 2. Building the closure here is
  // what keeps `role` off the render path while still routing it to the one place it belongs.
  const openSheet = () => onAction?.(role === 'impostor' ? 'auguryAndDraw' : 'augury')

  // §7.3's tier face: cost, the SKR mark, then yield — "1 ⟡ → 1". The mark is drawn rather than
  // set as text because U+27E1 is not in IBM Plex Sans; see SkrMark. The accessibility label
  // says "SKR" in words, because a screen reader cannot read a drawn glyph.
  const { cost, units } = config.tapTiers[tier]

  return (
    <View style={styles.root}>
      <View style={{ marginTop: insets.top }}>
        <BoardHeader round={round} percent={percent} secondsLeft={secondsLeft} crossed={crossed} />
      </View>

      {/* Conduits. They flex to fill whatever height is left, so they are always the largest
          thing on screen. */}
      <View style={styles.conduitArea} onLayout={onConduitLayout}>
        <View style={[styles.columns, { gap: art.conduitGap }]}>
          {lanes.map((lane, i) => {
            const own = lane.owner === youId
            const seat = (i + 1) as SeatNumber
            const geometry = conduitGeometry(
              lane.units,
              config.laneCapacity,
              conduitHeight,
              own ? art.tokenDiscOwn + art.tokenRing * 2 : art.tokenDisc,
            )
            return (
              <View key={lane.owner} style={{ width: columnWidth, height: '100%' }}>
                {conduitHeight > 0 ? (
                  <>
                    <Conduit
                      units={lane.units}
                      capacity={config.laneCapacity}
                      dormant={lane.dormant}
                      width={columnWidth}
                      height={conduitHeight}
                      thresholdFraction={thresholdFraction}
                      crossed={crossed}
                    />
                    <RidingToken seat={seat} own={own} dormant={lane.dormant} centreY={geometry.tokenCentreY} />
                  </>
                ) : null}
              </View>
            )
          })}
        </View>
      </View>

      {/* §7.3's controls row. Static until item 2. */}
      <View style={styles.controls}>
        <ControlButton accessibilityLabel={`Offering tier: ${cost} SKR for ${units}`}>
          <Text style={styles.buttonLabel}>{String(cost)}</Text>
          <SkrMark colour={palette.bone} />
          <Text style={styles.buttonLabel}>{`→ ${units}`}</Text>
        </ControlButton>

        <View style={styles.credits}>
          <Text style={styles.creditsValue}>{String(credits)}</Text>
          <SkrMark colour={palette.bone} />
        </View>

        {/* Identical for every role, in the same place, at the same size. Hard rule 4. */}
        <ControlButton accessibilityLabel="Augury" onPress={openSheet}>
          <Text style={styles.buttonLabel}>Augury</Text>
        </ControlButton>
      </View>

      {/* §7.3's tap band. The band runs to the bottom edge and becomes the touch target in
          item 2; the oval face is centred inside it, clear of the gesture bar. */}
      <View style={[styles.band, { height: layout.tapBand + insets.bottom }]}>
        <View
          style={[
            styles.bandFace,
            {
              width: screenWidth - art.tapBandInset * 2,
              height: art.tapBandFaceHeight,
              borderRadius: art.tapBandFaceHeight / 2,
              marginBottom: insets.bottom,
            },
          ]}
        />
      </View>
    </View>
  )
}

function ControlButton({
  children,
  accessibilityLabel,
  onPress,
}: {
  children: ReactNode
  accessibilityLabel: string
  onPress?: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.button}
    >
      {children}
    </Pressable>
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
  controls: {
    height: tokens.layout.controls,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.art.conduitOuterMargin,
  },
  button: {
    ...tokens.material.raisedStoneFace,
    borderRadius: tokens.radii.chip,
    minHeight: tokens.layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.art.skrGap,
    paddingHorizontal: tokens.art.conduitOuterMargin,
  },
  buttonLabel: {
    ...tokens.type.data,
    color: tokens.palette.bone,
  },
  credits: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.art.skrGap,
  },
  creditsValue: {
    ...tokens.type.data,
    ...tokens.tabularFigures,
    color: tokens.palette.bone,
  },
  band: {
    marginTop: tokens.layout.tapBandGap,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // §3.3's one permitted exception to the radius hierarchy — see §7.3. Still carved stone: the
  // bevel is the same raised face as every button.
  bandFace: {
    ...tokens.material.raisedStoneFace,
  },
})
