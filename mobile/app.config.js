// `VOID` is --void from reztor-design.md §3.1. It must stay equal to `palette.void`
// in src/design/tokens.ts. This file is the only place that literal may appear outside
// tokens.ts, because the native splash and the root view background are painted before
// any JavaScript runs and so cannot read a token.
const VOID = '#0B0D12'

module.exports = {
  expo: {
    name: 'Reztor',
    slug: 'reztor',
    scheme: 'reztor',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    backgroundColor: VOID,
    android: {
      package: 'com.reztor.game',
      userInterfaceStyle: 'dark',
      // The Council keyboard must never move or resize the board. 'resize' with edge-to-edge on
      // (android/gradle.properties) leaves the window where it is and hands the app the
      // keyboard's height, so the Council shrinks only its message list and keeps its input above
      // the keyboard. 'pan' slid the whole window up and pushed the board off the top of the screen
      // once the input moved to the bottom (part 2 of the owner's UI pass).
      softwareKeyboardLayoutMode: 'resize',
      backgroundColor: VOID,
    },
    web: {
      output: 'static',
    },
    plugins: [
      [
        'expo-dev-client',
        {
          showMenuAtLaunch: false,
          skipOnboarding: true,
        },
      ],
      'expo-router',
      'expo-system-ui',
      'expo-font',
      [
        // The splash is a flat --void field with no artwork, per BUILD-PLAN item 0.
        //
        // `image` is a 1x1 transparent PNG rather than omitted: the plugin's styles.xml always
        // references @drawable/splashscreen_logo but only creates that drawable when an image is
        // configured, so omitting it fails Android resource linking. See scripts/make-splash.mjs.
        'expo-splash-screen',
        {
          backgroundColor: VOID,
          image: './assets/splash.png',
        },
      ],
    ],
  },
}
