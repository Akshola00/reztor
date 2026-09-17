import type { TextStyle } from 'react-native'

// Every named value from reztor-design.md §3, and nothing that is not named there.
//
// The design doc defines no spacing scale, so this module has none. Spacing is an open
// decision — do not invent one here, and do not put a magic margin in a component.

// §3.1. Blue fire is reserved: `flame*` appears only on the conduit fill, the Heart, and the
// crossed Threshold marker. Player identity is a mantle colour plus a sigil, never fire.
const palette = {
  // Ground — the temple
  void: '#0B0D12',
  char: '#15181F',
  stone: '#1E222C',
  stoneEdge: '#2C3240',
  stoneLit: '#3D4555',

  // Fire — consecrated matter. PROGRESS ONLY.
  flameDeep: '#1B5C9E',
  flame: '#3E9BE0',
  flameCold: '#7FE3FF',
  flameWhite: '#E4F8FF',

  // The toll — loss, drain, damage
  toll: '#8E3B2F',
  tollSmoke: '#4A2A26',

  // Settlement
  gold: '#C9A227',

  // Type
  bone: '#D8DBE2',
  boneDim: '#8A93A5',
  boneFaint: '#545C6C',

  // The four mantles, muted so they cannot be read as fill
  seat1: '#4E7C6B',
  seat2: '#A8813F',
  seat3: '#7A3B3B',
  seat4: '#6C7A99',

  // §3.3 writes this inline as the lower bevel edge. Named here so no component carries it.
  bevelShadow: '#0A0C10',
} as const

// §3.3. Everything is carved, not stacked: a light edge above, a dark edge below.
// No `elevation` and no `shadowColor` anywhere in this codebase.
const material = {
  raisedStoneFace: {
    backgroundColor: palette.stone,
    borderTopWidth: 1,
    borderTopColor: palette.stoneLit,
    borderBottomWidth: 1,
    borderBottomColor: palette.bevelShadow,
  },
} as const

// §3.3. Radius encodes hierarchy. The Heart and conduits are apertures, not objects.
const radii = {
  panel: 2,
  plinth: 2,
  chip: 4,
  aperture: 0,
} as const

// Android will not select a weight from a custom family via `fontWeight`, so each weight is
// its own family name. These are the expo-google-fonts export names. No CSS fallback stacks —
// they do nothing in React Native.
const fontFamily = {
  displayRegular: 'GrenzeGotisch_400Regular',
  displayBold: 'GrenzeGotisch_700Bold',
  uiRegular: 'IBMPlexSans_400Regular',
  uiMedium: 'IBMPlexSans_500Medium',
} as const

// §3.2. `lineHeight` is the doc's ratio multiplied out and left unrounded, because React
// Native wants an absolute value. Family per §3.2's usage lists: Grenze Gotisch carries the
// Heart, stage names, role reveal and the Reckoning headline, and is never set below 20.
const type = {
  heart: { fontSize: 56, lineHeight: 56, fontFamily: fontFamily.displayRegular },
  display: { fontSize: 32, lineHeight: 35.2, fontFamily: fontFamily.displayRegular },
  stage: { fontSize: 20, lineHeight: 24, fontFamily: fontFamily.displayRegular },
  body: { fontSize: 15, lineHeight: 22.5, fontFamily: fontFamily.uiRegular },
  data: { fontSize: 14, lineHeight: 16.8, fontFamily: fontFamily.uiRegular },
  fine: { fontSize: 12, lineHeight: 15.6, fontFamily: fontFamily.uiRegular },
} as const

// §3.2 / §10.1. React Native does not expose font-variant-numeric; this is the closest the
// platform gives. Spread it onto anything that counts, so the number does not jitter.
//
// Annotated rather than `as const`: RN types `fontVariant` as a mutable array, so a readonly
// tuple will not assign to a TextStyle.
const tabularFigures: TextStyle = { fontVariant: ['tabular-nums'] }

// §6.1's vertical budget on an 844px viewport, plus the §10.4 touch floor. `namePlates` holds
// the slot §6.1 gives the Faithful — BUILD-PLAN.md §2 cuts the figures and puts carved name
// plates there instead.
const layout = {
  header: 48,
  heart: 180,
  conduits: 280,
  namePlates: 72,
  plinth: 180,
  controls: 84,
  minTouchTarget: 44,
} as const

// §3.3. A tiled PNG above the background and below content. It does not animate.
const grainOpacity = 0.03

export const tokens = {
  palette,
  material,
  radii,
  fontFamily,
  type,
  tabularFigures,
  layout,
  grainOpacity,
} as const
