import { useCallback, useEffect, type ReactNode } from 'react'
import { BackHandler, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { motion } from '../design/motion'
import { tokens } from '../design/tokens'

// Item 5's bottom sheet, taken out of ActionSheet so the rules sheet is the same sheet: the void
// dims behind it, it opens and closes on §8's overlay row (180ms ease-out, scale from 0.98, no
// blur), and a tap outside it closes it. No library — CLAUDE.md builds it from primitives.

type SheetProps = {
  onClose: () => void
  /**
   * Hardware back closes the sheet. The match leaves this off: its own back handler already
   * closes the action sheet before it offers to leave, and two handlers would race.
   */
  closeOnBack?: boolean
  style?: StyleProp<ViewStyle>
  /** Content, or a function given the sheet's own animated close, for a close control inside it. */
  children: ReactNode | ((close: () => void) => ReactNode)
}

export function Sheet({ onClose, closeOnBack = false, style, children }: SheetProps) {
  const insets = useSafeAreaInsets()
  const open = useSharedValue(0)
  useEffect(() => {
    open.set(withTiming(1, motion.transition.overlay))
  }, [open])
  const close = useCallback(() => {
    open.set(withTiming(0, motion.transition.overlay))
    setTimeout(onClose, motion.duration.overlay)
  }, [open, onClose])

  useEffect(() => {
    if (!closeOnBack) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close()
      return true
    })
    return () => sub.remove()
  }, [closeOnBack, close])

  const backdropStyle = useAnimatedStyle(() => ({ opacity: open.get() * tokens.art.sheetBackdropOpacity }))
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: open.get(),
    transform: [{ scale: motion.overlayScaleFrom + (1 - motion.overlayScaleFrom) * open.get() }],
  }))

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close">
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      </Pressable>

      <Animated.View
        style={[styles.sheet, { paddingBottom: tokens.layout.sectionGap + insets.bottom }, style, sheetStyle]}
      >
        {typeof children === 'function' ? children(close) : children}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: tokens.palette.void,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    ...tokens.material.raisedStoneFace,
    borderTopLeftRadius: tokens.radii.panel,
    borderTopRightRadius: tokens.radii.panel,
    paddingHorizontal: tokens.layout.screenGutter,
    paddingTop: tokens.layout.stackGap,
    paddingBottom: tokens.layout.sectionGap,
    gap: tokens.layout.stackGap,
  },
})
