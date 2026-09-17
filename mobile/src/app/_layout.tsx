import { GrenzeGotisch_700Bold } from '@expo-google-fonts/grenze-gotisch'
import { IBMPlexSans_400Regular, IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { tokens } from '../design/tokens'

// Module scope, not inside the component: the splash has to be held before the first render.
SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  // One display weight: item 1 judged Grenze Gotisch 400 against 700 at t-heart on device and
  // 700 ships, so the 400 face is no longer loaded. IBM Plex keeps both — 500 is for chat names.
  const [fontsLoaded, fontError] = useFonts({
    GrenzeGotisch_700Bold,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
  })

  useEffect(() => {
    if (fontError) {
      console.warn('Font loading failed; rendering with platform fallback faces.', fontError)
    }
    // Never hang on the splash. An error hides it and renders anyway.
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync()
    }
  }, [fontsLoaded, fontError])

  // The Heart percentage must not reflow, so render nothing until the faces resolve.
  if (!fontsLoaded && !fontError) {
    return null
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      {/* Above the void background, below content, and never animated. The wrapper carries
          pointerEvents because Image does not accept it as a prop. */}
      <View pointerEvents="none" style={styles.grain}>
        <Image source={require('../../assets/grain.png')} resizeMode="repeat" style={styles.grainTile} />
      </View>
      <Stack screenOptions={{ headerShown: false, contentStyle: styles.screen }} />
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.palette.void,
  },
  grain: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: tokens.grainOpacity,
  },
  grainTile: {
    width: '100%',
    height: '100%',
  },
  // Not a palette value — the screens have to let the root void and its grain through.
  screen: {
    backgroundColor: 'transparent',
  },
})
