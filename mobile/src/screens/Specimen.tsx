import { useEffect } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'

import { motion } from '../design/motion'
import { tokens } from '../design/tokens'

// Temporary. Deleted at the start of build item 1.
//
// It exists to judge the tokens on a real device: the palette at thumb size on a dim screen,
// both display weights side by side, the scale in its assigned families, whether tabular
// figures actually land, and whether Reanimated is driving the UI thread at all.
//
// No copy here other than token names and digits.

const paletteEntries = Object.entries(tokens.palette)
const scaleSteps = ['display', 'stage', 'body', 'data', 'fine'] as const
const figureRows = ['1111', '8888', '0847'] as const

export function Specimen() {
  const pulse = useSharedValue(1)

  useEffect(() => {
    pulse.value = withRepeat(withTiming(0, motion.transition.stageChange), -1, true)
  }, [pulse])

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }))

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.swatchGrid}>
        {paletteEntries.map(([name, value]) => (
          <View key={name} style={styles.swatchCell}>
            <View style={[styles.swatch, { backgroundColor: value }]} />
            <Text style={styles.label}>{name}</Text>
          </View>
        ))}
      </View>

      <View style={styles.heartRow}>
        <View style={styles.heartCell}>
          <Text style={[styles.heart, styles.heartRegular]}>58%</Text>
          <Text style={styles.label}>displayRegular</Text>
        </View>
        <View style={styles.heartCell}>
          <Text style={[styles.heart, styles.heartBold]}>58%</Text>
          <Text style={styles.label}>displayBold</Text>
        </View>
      </View>

      {scaleSteps.map((step) => (
        <Text key={step} style={[tokens.type[step], styles.specimenText]}>
          {step}
        </Text>
      ))}

      <View style={styles.figureRow}>
        <View style={styles.figureColumn}>
          {figureRows.map((digits) => (
            <Text key={digits} style={[styles.figure, styles.tabular]}>
              {digits}
            </Text>
          ))}
          <Text style={styles.label}>tabular-nums</Text>
        </View>
        <View style={styles.figureColumn}>
          {figureRows.map((digits) => (
            <Text key={digits} style={styles.figure}>
              {digits}
            </Text>
          ))}
          <Text style={styles.label}>proportional</Text>
        </View>
      </View>

      <View style={styles.swatchCell}>
        <Animated.View style={[styles.swatch, styles.pulseSwatch, pulseStyle]} />
        <Text style={styles.label}>stageChange</Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: {
    paddingVertical: tokens.layout.header,
    paddingHorizontal: tokens.radii.chip * 4,
  },
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  swatchCell: {
    width: tokens.layout.plinth / 2,
    marginBottom: tokens.layout.minTouchTarget / 2,
  },
  swatch: {
    height: tokens.layout.minTouchTarget,
    borderRadius: tokens.radii.chip,
    ...tokens.material.raisedStoneFace,
  },
  pulseSwatch: {
    backgroundColor: tokens.palette.flameCold,
  },
  label: {
    ...tokens.type.fine,
    color: tokens.palette.boneDim,
  },
  heartRow: {
    flexDirection: 'row',
  },
  heartCell: {
    marginRight: tokens.layout.minTouchTarget,
  },
  heart: {
    ...tokens.type.heart,
    color: tokens.palette.bone,
  },
  heartRegular: {
    fontFamily: tokens.fontFamily.displayRegular,
  },
  heartBold: {
    fontFamily: tokens.fontFamily.displayBold,
  },
  specimenText: {
    color: tokens.palette.bone,
    marginBottom: tokens.layout.minTouchTarget / 4,
  },
  figureRow: {
    flexDirection: 'row',
    marginTop: tokens.layout.minTouchTarget / 2,
    marginBottom: tokens.layout.minTouchTarget / 2,
  },
  figureColumn: {
    width: tokens.layout.plinth / 2,
    marginRight: tokens.layout.minTouchTarget,
  },
  figure: {
    ...tokens.type.data,
    color: tokens.palette.bone,
    textAlign: 'right',
  },
  tabular: {
    ...tokens.tabularFigures,
  },
})
