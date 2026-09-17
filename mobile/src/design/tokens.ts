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
  // The same bevel inverted, for a face that reads as pressed into the stone. §7.3 wants the
  // selected tier chip inset rather than highlighted; the preview's chips use it too.
  insetStoneFace: {
    backgroundColor: palette.void,
    borderTopWidth: 1,
    borderTopColor: palette.bevelShadow,
    borderBottomWidth: 1,
    borderBottomColor: palette.stoneLit,
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
//
// One display weight only. Item 1 judged Grenze Gotisch 400 against 700 on device at t-heart
// and 700 ships; the 400 face was dropped rather than left loaded and unused.
const fontFamily = {
  display: 'GrenzeGotisch_700Bold',
  uiRegular: 'IBMPlexSans_400Regular',
  uiMedium: 'IBMPlexSans_500Medium',
} as const

// §3.2. `lineHeight` is the doc's ratio multiplied out and left unrounded, because React
// Native wants an absolute value. Family per §3.2's usage lists: Grenze Gotisch carries the
// Heart, stage names, role reveal and the Reckoning headline, and is never set below 20.
const type = {
  heart: { fontSize: 56, lineHeight: 56, fontFamily: fontFamily.display },
  display: { fontSize: 32, lineHeight: 35.2, fontFamily: fontFamily.display },
  stage: { fontSize: 20, lineHeight: 24, fontFamily: fontFamily.display },
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

// ---------------------------------------------------------------------------------------------
// Art values chosen in build item 1
// ---------------------------------------------------------------------------------------------
//
// reztor-design.md fixes the palette, the type scale, the vertical budget, the 2px frontier and
// its 6px glow. It does not name conduit width, the gap between conduits, the vertical grain
// inside unfilled char, sigil stroke weight, the vessel outline, or glow falloff. Everything in
// this group was chosen in item 1 so that no literal sits in a component file. Change art here.
const art = {
  // Conduit aperture. 44 reads as a column rather than a bar at 360dp, and a 14 gap keeps four
  // of them plus the board margin inside the 360pt floor of §10.4's 360–430pt range.
  conduitWidth: 44,
  conduitGap: 14,

  // §6.2 names both of these.
  frontierThickness: 2,
  frontierGlowHeight: 6,
  // Peak alpha of that glow where it meets the frontier. Chosen: bright enough to be the
  // second-brightest thing on screen after the Heart, per §6.2, without blooming. Raised from
  // 0.55 after item 1's first screenshot, where the glow did not register at all.
  frontierGlowOpacity: 0.75,

  // §6.2 asks for "a faint vertical grain" in the unfilled char, so the conduit reads as stone
  // rather than a hole. Pitch, width and alpha chosen. Raised from 0.5/0.1 after item 1's first
  // screenshot: at ~3.5x density the grain was invisible and the aperture read as a flat hole.
  conduitGrainPitch: 6,
  conduitGrainWidth: 1,
  conduitGrainOpacity: 0.22,

  // The aperture's own carved edge, per §3.3. An aperture is cut *inward* into the stone field,
  // so the bevel inverts: the dark edge sits at the top and the light edge at the foot.
  apertureEdge: 1,

  // §6.2's two-stop fill runs flameDeep at the base to flame near the frontier. Spread evenly
  // it read as a progress bar, so flameDeep now holds most of the column and flame appears only
  // approaching the frontier. This is an objectBoundingBox offset on the scaled rect, so a short
  // fill is still mostly deep with a bright top. Chosen in item 1.
  fillDeepHoldOffset: 0.72,

  // A guard, not a design value. react-native-svg treats `scaleY={0}` as falsy and falls back
  // to 1, so an empty conduit rendered completely full on item 1's first pass. The fill scale is
  // floored to this, and the fill is also gated to opacity 0 when a lane has no units. Item 2
  // must keep that floor when it drives scaleY from a shared value, or a lane at rest will flash
  // to full height.
  fillScaleFloor: 0.0001,

  // §6.2's "desaturate to 45%" for a dormant lane. See `cold` below for the interpretation.
  coldSaturation: 0.45,
  // Desaturation alone left a dormant lane at about the same luminance as live fire, so it read
  // milky and sat forward instead of receding. Its fill is also darkened by this factor. Chosen
  // in item 1. Applied to the fill only: darkening `char` as well would turn the whole aperture
  // into a black hole and lose the fill level, which must stay readable.
  coldLightness: 0.55,

  // The Threshold is one carved line across the conduit row: a light edge with a dark edge under
  // it, per §3.3's bevel logic. It spans the row plus a small overhang, never the full screen.
  thresholdThickness: 1,
  thresholdOverhang: 8,

  // The carved seam between the stone field and the raised plinth.
  seamThickness: 1,

  // §6.1 brackets your own conduit with "two short carved marks"; BUILD-PLAN moves a bracket
  // onto the name plate. One bracket encloses both: marks at the conduit head and at the foot of
  // the inscription. Lengthened and thickened in item 1 after the first pass, where at 12x1 they
  // were invisible in peripheral vision. Drawn in boneDim — never fire, never a seat colour.
  bracketLength: 20,
  bracketThickness: 2,

  // Sigils are drawn in a square viewBox and scaled, so one stroke weight holds at every size
  // (§5.2 requires the same weight for all four). Box and stroke chosen.
  sigilBox: 24,
  sigilStroke: 1.5,
  // Seat 4 is a square with a small gap at one corner. All four sides are drawn: dropping two
  // sides made it read as a chevron at 16px rather than as a square.
  sigilCornerGap: 4,
  // The two sizes §5.2 and the preview strip care about: legible-at-thumb and inspectable.
  sigilSmall: 16,
  sigilLarge: 48,

  // The sigil size inscribed above each name, and the gap between the two.
  namePlateSigil: 16,
  namePlateGap: 4,

  // The Heart. §6.4 says "a carved vessel shape, roughly 120×96". The outline is not described.
  // A cut hexagon: straight facets only, the carved read, chosen over an urn in item 1.
  //
  // The vessel is a recess in the stone field. `heartCavityPath` is its inner cavity, and the
  // light is clipped to that rather than to the silhouette — clipped to the outline the glow
  // read as a round lamp floating on top of the vessel instead of a light held inside it.
  heartBox: { width: 120, height: 96 },
  heartVesselPath: 'M 6 27 L 60 4 L 114 27 L 103 65 L 60 92 L 17 65 Z',
  heartCavityPath: 'M 20 32 L 60 15 L 100 32 L 92 61 L 60 81 L 28 61 Z',
  // Where the light sits inside the cavity, and the radii of the fixed light layers. The stops
  // never change; only opacity and scale derive from the board fraction.
  heartLightCentre: { x: 60, y: 48 },
  heartCoreRadius: 11,
  heartGlowRadius: 30,
  heartHaloRadius: 44,
  // Light response to the board fraction. §6.4: nearly dead at 0%, clearly alive by 55%, and
  // it stops escalating above the Threshold (the fraction is clamped to 1 before it gets here).
  // Coefficients chosen: opacity = base + gain × fraction.
  heartLight: {
    coreBase: 0.14,
    coreGain: 0.86,
    glowBase: 0.08,
    glowGain: 0.62,
    haloBase: 0.0,
    haloGain: 0.38,
    scaleBase: 0.78,
    scaleGain: 0.32,
  },
} as const

// ---------------------------------------------------------------------------------------------
// Dormant (cold) colours, precomputed
// ---------------------------------------------------------------------------------------------
//
// §6.2: a cold conduit "desaturates to 45%". It does not say whether that means to 45% of the
// original saturation or reduced by 45%. Read here as **to 45% of the original** — HSL
// saturation multiplied by 0.45 — which is the plainer reading of "to 45%". Item 1 adds a
// lightness cut on top, because saturation alone did not make a dead lane recede.
//
// Precomputed at module load rather than applied as an SVG filter: Android re-rasterises
// filters, and nothing in the Offering stage may cost a re-raster.

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${((clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)).toString(16).padStart(6, '0').toUpperCase()}`
}

/** Scales a colour's HSL saturation and lightness, leaving hue untouched. */
export function cool(hex: string, saturation: number, lightness: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l0 = (max + min) / 2
  const l = l0 * lightness
  if (max === min) {
    return rgbToHex(l * 255, l * 255, l * 255)
  }
  const d = max - min
  const s = (l0 > 0.5 ? d / (2 - max - min) : d / (max + min)) * saturation
  let h = 0
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6
  } else {
    h = ((r - g) / d + 4) / 6
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return rgbToHex(channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255)
}

const cold = {
  // The aperture floor keeps its lightness: it is already near-black, and darkening it would
  // erase the contrast the fill level needs.
  char: cool(palette.char, art.coldSaturation, 1),
  flameDeep: cool(palette.flameDeep, art.coldSaturation, art.coldLightness),
  flame: cool(palette.flame, art.coldSaturation, art.coldLightness),
} as const

export const tokens = {
  palette,
  material,
  radii,
  fontFamily,
  type,
  tabularFigures,
  layout,
  grainOpacity,
  art,
  cold,
} as const
