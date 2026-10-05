import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import Svg, { G, Path } from 'react-native-svg'

import { motion } from '../design/motion'
import { tokens } from '../design/tokens'
import { Conduit, conduitGeometry, surfaceArc } from './Conduit'
import { RidingToken } from './RidingToken'
import type { SeatNumber } from './Sigil'

// The home screen's art: four conduits at fixed, staggered low levels, the board before any rite.
// It is decoration, never state — each lane holds its value from `home.idleBoardFills` and nothing
// writes to it.
//
// One motion only: a glow that swells on all four frontiers together and settles, laid over the
// Conduit's own surface along the same arc. The four rise and fall as one, so nothing implies a
// flow between conduits (hard rule 1). Reduce motion holds it still.

const SEATS: SeatNumber[] = [1, 2, 3, 4]
// Any capacity works: the board's level is a fraction. This keeps the geometry in whole units.
const CAPACITY = 1000

type IdleBoardProps = {
  width: number
  height: number
  /** With or without the riding sigil tokens — the owner judges both. */
  sigils: boolean
}

export function IdleBoard({ width, height, sigils }: IdleBoardProps) {
  const { art, home, palette } = tokens
  const [units] = useState(() => home.idleBoardFills.map((fill) => makeMutable(CAPACITY * fill)))
  const columnWidth = Math.floor((width - art.conduitGap * (SEATS.length - 1)) / SEATS.length)

  const reduceMotion = useReducedMotion()
  const pulse = useSharedValue(0)
  useEffect(() => {
    if (reduceMotion) return
    pulse.set(withRepeat(withTiming(1, motion.transition.idlePulse), -1, true))
  }, [pulse, reduceMotion])
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() * home.idlePulsePeak }))

  // The glow sits exactly where the Conduit's surface layer does.
  const { arc, surfaceHeight, surfacePad } = surfaceArc(columnWidth)
  const surfaceTop = (fill: number) =>
    conduitGeometry(CAPACITY * fill, CAPACITY, height, art.tokenDisc).surfaceTranslateY - surfacePad
  // The pulse strokes wider than the surface layer's own padding allows, so its box grows by the
  // extra half-width each way.
  const spill = art.frontierGlowHeight * home.idlePulseWidthScale

  return (
    <View
      style={[styles.row, { gap: art.conduitGap, height }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {SEATS.map((seat, i) => (
        <View key={seat} style={{ width: columnWidth, height }}>
          <Conduit
            units={units[i]}
            capacity={CAPACITY}
            dormant={false}
            width={columnWidth}
            height={height}
            thresholdFraction={home.idleThreshold}
            crossed={false}
          />
          <Animated.View style={[styles.glow, { top: surfaceTop(home.idleBoardFills[i]) - spill }, pulseStyle]}>
            <Svg width={columnWidth} height={surfaceHeight + spill * 2}>
              <G y={spill}>
                {art.frontierGlowLayers.map((layer) => (
                  <Path
                    key={layer.widthScale}
                    d={arc}
                    fill="none"
                    stroke={palette.flameCold}
                    strokeWidth={art.frontierGlowHeight * layer.widthScale * home.idlePulseWidthScale}
                    strokeOpacity={art.frontierGlowOpacity * layer.opacityScale}
                    strokeLinecap="butt"
                  />
                ))}
              </G>
            </Svg>
          </Animated.View>
          {sigils ? (
            <RidingToken
              seat={seat}
              own={false}
              dormant={false}
              disconnected={false}
              units={units[i]}
              capacity={CAPACITY}
              height={height}
            />
          ) : null}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    left: 0,
  },
})
