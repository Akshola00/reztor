import { BarlowSemiCondensed_600SemiBold } from '@expo-google-fonts/barlow-semi-condensed'
import { Cinzel_700Bold } from '@expo-google-fonts/cinzel'
import { GrenzeGotisch_700Bold } from '@expo-google-fonts/grenze-gotisch'
import { Oswald_600SemiBold } from '@expo-google-fonts/oswald'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { tokens } from '../design/tokens'
import { session } from '../net/session'
import { WalletProvider } from '../solana/wallet'

// Module scope, not inside the component: the splash has to be held before the first render.
SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  // One display weight: item 1 judged Grenze Gotisch 400 against 700 at t-heart on device and
  // 700 ships, so the 400 face is no longer loaded. The running-text face is Barlow Semi Condensed at
  // the one weight the owner judged, 600.
  //
  // Cinzel and Oswald are candidates for the board percentage only, under review on a dev chip in
  // the owner's UI pass. Whichever is not chosen comes out with its package.
  const [fontsLoaded, fontError] = useFonts({
    GrenzeGotisch_700Bold,
    BarlowSemiCondensed_600SemiBold,
    Cinzel_700Bold,
    Oswald_600SemiBold,
  })

  // A ticket that survived a restart rejoins before anything renders, so a player the OS or a
  // force-stop took out of a match lands back on its board rather than on home. Bounded by the
  // JOIN ack's own timeout, so the splash cannot hang on an unreachable server.
  const [booted, setBooted] = useState(false)
  useEffect(() => {
    void session.boot().then(() => setBooted(true))
  }, [])

  useEffect(() => {
    if (fontError) {
      console.warn('Font loading failed; rendering with platform fallback faces.', fontError)
    }
    // Never hang on the splash. An error hides it and renders anyway.
    if ((fontsLoaded || fontError) && booted) {
      SplashScreen.hideAsync()
    }
  }, [fontsLoaded, fontError, booted])

  // The board percentage must not reflow, so render nothing until the faces resolve.
  if ((!fontsLoaded && !fontError) || !booted) {
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
      <WalletProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: styles.screen }} />
      </WalletProvider>
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
