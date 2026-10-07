import type { TextStyle } from 'react-native'

// Every named value from reztor-design.md §3, and nothing that is not named there.
//
// The design doc defines no spacing scale, so this module has none. Spacing is an open
// decision — do not invent one here, and do not put a magic margin in a component.

// §3.1, with the home rebuild's "lift" folded in (chosen by the owner, provisional until checked on
// the S10). Against the doc's original values: void unchanged, and every step of ground above it
// lightened by a growing factor (char x1.25, stone x1.3, stoneEdge x1.6, stoneLit x1.4 HSL lightness)
// so panels read as raised; flameDeep x1.3 saturation and x1.1 lightness; gold x1.15 lightness at its
// own hue; toll and tollSmoke rotated -14 degrees toward crimson, x1.2 saturation, x1.05 lightness.
// Every text pairing still clears 4.5:1 — bone on stoneLit is the tightest, at 4.51:1.
//
// Blue fire is reserved: `flame*` appears only on the conduit fill, the crossed Threshold
// marks, and the board percentage during the crossing moment. Player identity is a mantle colour
// plus a sigil, never fire.
const palette = {
  // Ground — the temple
  void: '#0B0D12',
  char: '#1A1E27',
  stone: '#272C39',
  stoneEdge: '#465066',
  stoneLit: '#556177',

  // Fire — consecrated matter. PROGRESS ONLY.
  flameDeep: '#0865C3',
  flame: '#3E9BE0',
  flameCold: '#7FE3FF',
  flameWhite: '#E4F8FF',

  // The toll — loss, drain, damage
  toll: '#9F2734',
  tollSmoke: '#51242A',
  // §7.3 — toll for text. `toll` is below the 4.5:1 text floor on `void`, and the credit counter
  // carries information. This is toll mixed 34% toward `bone`, the smallest step that clears the
  // floor: 4.58:1 on void. Text only — embers, drains and every other toll mark keep `toll`.
  tollText: '#B2646F',
  // §7.3 — the other half of the counter's slow pulse below 20 credits. Toll mixed 56% toward
  // `bone`: 6.85:1 on void and 4.92:1 on stone, where the action sheet sets the Hollow's toll line.
  // The pulse crossfades the two, so every frame of it clears 4.5:1.
  tollTextBright: '#BF8C95',

  // Settlement
  gold: '#D9B33B',

  // Type
  bone: '#D8DBE2',
  boneDim: '#8A93A5',
  boneFaint: '#545C6C',
  // §10.4 keeps boneFaint (2.89:1 on void) for decoration only. This is boneFaint mixed 24% toward
  // bone, the smallest step that clears the 4.5:1 floor: 4.52:1 on void. For information that has to
  // read as dark and dead — §7.9's broken-state percentage. Chosen in item 6.
  boneFaintText: '#747A88',

  // The four mantles, muted so they cannot be read as fill
  seat1: '#4E7C6B',
  seat2: '#A8813F',
  seat3: '#7A3B3B',
  seat4: '#6C7A99',
  // §3.1 — the mantles for a mask drawn small on bare ground: chat rows, the Reckoning's tables and
  // vote history, the Reveal's marks. A 16dp mask is a 1dp stroke, thinner than any glyph, and
  // seat3 was 2.33:1 on void. Each is its mantle mixed toward `bone`, the way tollText was, by the
  // smallest step that clears 4.5:1 on `stone` — so it clears void with room, and all four land
  // within 0.1 of each other in contrast, so no seat's mask reads louder than another's. The
  // conduit tokens, vote tokens and the Marking sit on a stone disc at 18dp and up, and keep the
  // mantle itself.
  seat1Text: '#7A9A91', // 32%: 6.35:1 on void, 4.56:1 on stone
  seat2Text: '#AF8E56', // 14%: 6.32:1 on void, 4.53:1 on stone
  seat3Text: '#A98B8F', // 50%: 6.27:1 on void, 4.50:1 on stone
  seat4Text: '#8893AC', // 26%: 6.31:1 on void, 4.53:1 on stone

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
  // The same bevel inverted, for a face that reads as pressed into the stone. The preview's
  // chips use it, and item 2 uses it for the tap band's pressed state.
  insetStoneFace: {
    backgroundColor: palette.void,
    borderTopWidth: 1,
    borderTopColor: palette.bevelShadow,
    borderBottomWidth: 1,
    borderBottomColor: palette.stoneLit,
  },
  // §7.3's tap band face, chosen on the phone in item 1c over a raised stone slab: a face cut
  // into the dark rather than a slab lifted out of it. The face is `char`, which is far darker
  // than `stoneLit`, so item 2's pressed state still reads as the band brightening under the
  // thumb. The rim carries §3.3's bevel — lit above, shadow below — with stone sides, so the
  // band is carved and never brighter than the fire.
  carvedBandFace: {
    backgroundColor: palette.char,
    borderWidth: 2,
    borderColor: palette.stoneEdge,
    borderTopColor: palette.stoneLit,
    borderBottomColor: palette.bevelShadow,
  },
} as const

// §3.3. Radius encodes hierarchy. The conduits are apertures, not objects. The tap band is the
// one exception the doc allows — see §7.3 — and takes its radius from its own height.
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
// One display weight only. Item 1 judged Grenze Gotisch 400 against 700 on device and 700
// ships; the 400 face was dropped rather than left loaded and unused.
//
// Since the type-role remap, Grenze Gotisch is the interface: every short string — buttons, labels,
// names, numbers, headings. The sans (`uiRegular`, `uiMedium`) carries running text only: chat
// bodies, the rules sheet's paragraphs, and sentence-length notices and errors.
const fontFamily = {
  display: 'GrenzeGotisch_700Bold',
  // The owner's choice in the home rebuild, replacing IBM Plex Sans, which read as an office face.
  // Loaded at 600 only — the weight judged on the device — so both text roles share it.
  uiRegular: 'BarlowSemiCondensed_600SemiBold',
  uiMedium: 'BarlowSemiCondensed_600SemiBold',
  // §7.8: the Reckoning's role seed is set monospace, the one place §4's ban on monospace does not
  // reach — it is a string to be checked character by character, not a label. Android's system
  // monospace face, so nothing new is bundled for one line. Chosen in item 6.
  mono: 'monospace',
} as const

// §3.2. `lineHeight` is the doc's ratio multiplied out and left unrounded, because React
// Native wants an absolute value. Family per §3.2's roles as remapped by the owner: Grenze Gotisch
// sets every short string, with its floor lowered from 20 to 14; the sans sets running text.
//
// Every number in Grenze takes `tabularFigures`. Its default digits are old-style (3, 4, 5, 7 and 9
// descend about 0.1em); its `tnum` feature substitutes tabular *lining* figures, all 0.500em wide
// and 0.58em tall, which are what makes a 14px number readable.
//
// `heart` keeps its name from when the percentage sat under a drawn vessel. It is now §3.2's
// board-percentage step and nothing else; renaming it would churn every call site for nothing.
const type = {
  heart: { fontSize: 56, lineHeight: 56, fontFamily: fontFamily.display },
  display: { fontSize: 32, lineHeight: 35.2, fontFamily: fontFamily.display },
  stage: { fontSize: 20, lineHeight: 24, fontFamily: fontFamily.display },
  body: { fontSize: 15, lineHeight: 22.5, fontFamily: fontFamily.uiRegular },
  // Credits, counts, timers, the round — numbers and the shortest readouts. Grenze at the floor.
  data: { fontSize: 14, lineHeight: 16.8, fontFamily: fontFamily.display },
  // Small running text only — a one-line note such as the Reckoning's "In SKR." Sans, because
  // Grenze does not go below 14.
  fine: { fontSize: 12, lineHeight: 15.6, fontFamily: fontFamily.uiRegular },
  // Labels above fields and rows, and names in rows: what `fine` used to carry for short strings,
  // raised to Grenze's floor of 14.
  label: { fontSize: 14, lineHeight: 16.8, fontFamily: fontFamily.display },
  // Button and control labels, and names set at reading size. The body step, in Grenze.
  control: { fontSize: 15, lineHeight: 22.5, fontFamily: fontFamily.display },
  // §7.1: the lobby's invite code, "large enough to read aloud across a room". The t-heart step.
  // §3.2's named exception to the remap: the sans, because a code is read aloud and Grenze's X, T,
  // A and N–U capitals had to be decoded in a live lobby. A code nobody can say is a gathering
  // nobody can join.
  code: { fontSize: 56, lineHeight: 56, fontFamily: fontFamily.uiMedium },
  // The home rebuild's steps. The wordmark is the t-heart step in the display face; a code cell
  // holds one character of a gathering code at the t-display step, in the sans like the code.
  wordmark: { fontSize: 56, lineHeight: 56, fontFamily: fontFamily.display },
  codeCell: { fontSize: 32, lineHeight: 35.2, fontFamily: fontFamily.uiMedium },
} as const

// §3.2 / §10.1. React Native does not expose font-variant-numeric; this is the closest the
// platform gives. Spread it onto anything that counts, so the number does not jitter. Barlow Semi
// Condensed's digits are proportional by default (0.313-0.522em); its `tnum` feature, which this
// switches on, sets all ten to 0.507em.
//
// Annotated rather than `as const`: RN types `fontVariant` as a mutable array, so a readonly
// tuple will not assign to a TextStyle.
const tabularFigures: TextStyle = { fontVariant: ['tabular-nums'] }

// §6.1's vertical budget on an 844pt viewport, plus the §10.4 touch floor. The conduits take
// the slack, so they are always the largest thing on screen — they are the hero image now.
const layout = {
  header: 48,
  conduits: 280,
  controls: 84,
  tapBandGap: 24,
  tapBand: 240,
  minTouchTarget: 44,

  // Item 3's screens outside the match: home and lobby. The design doc names no spacing, so these
  // are chosen, and kept to three. The gutter matches §6.1's conduit margin so every screen
  // shares one edge.
  screenGutter: 16,
  stackGap: 12,
  sectionGap: 32,

  // §7.5: in Council and Judgement the board keeps "about 40%" of the screen — header and
  // conduits together — and the lower region takes the rest.
  councilBoardShare: 0.4,
} as const

// §3.3. A tiled PNG above the background and below content. It does not animate.
const grainOpacity = 0.03

// ---------------------------------------------------------------------------------------------
// Art values chosen in build items 1 and 1b
// ---------------------------------------------------------------------------------------------
//
// reztor-design.md fixes the palette, the type scale, the vertical budget, the 2px frontier and
// its 6px glow. It does not name the outer margin, the gap between conduits, the arc height, the
// token disc, the vertical grain inside unfilled char, sigil stroke weight, or glow falloff.
// Everything in this group was chosen here so that no literal sits in a component file.
const art = {
  // §6.1: conduit width is derived, never fixed —
  //   (screen width - 2 x conduitOuterMargin - 3 x conduitGap) / 4
  // At the 360pt floor that gives a 74pt column against a ~450pt conduit area, about 1:6, so a
  // filled column still reads as a channel rather than a slab. The gap is background, not a
  // drawn divider: 10pt is 35px at this phone's 3.5x density, which is unmistakably a gap, and
  // hard rule 1 requires the conduits never touch.
  conduitOuterMargin: 16,
  conduitGap: 10,

  // §6.2 names both of these.
  frontierThickness: 2,
  frontierGlowHeight: 6,
  // Peak alpha of that glow where it meets the frontier. Bright enough to be the brightest
  // thing on screen per §6.2, without blooming.
  frontierGlowOpacity: 0.75,
  // The frontier now follows a curve, so the glow can no longer be a gradient rect: it is
  // stroked copies of the arc, widening and fading away from the line. Two layers read as a
  // tight glow and cost two paths. No <Filter> and no blur anywhere — Android re-rasterises
  // filters and the Offering stage holds 60fps.
  frontierGlowLayers: [
    { widthScale: 2, opacityScale: 0.22 },
    { widthScale: 1, opacityScale: 0.5 },
  ],

  // §6.2's convex surface. The rise at the centre of the arc. 8 against a ~74-87pt column is a
  // gentle curve — enough to stop reading as a bar's flat top, not enough to read as a dome.
  surfaceArcHeight: 8,
  // How far the cap shape extends below the arc's ends, so it never seams against the fill rect
  // underneath it.
  surfaceCapOverlap: 2,

  // §6.2 asks for "a faint vertical grain" in the unfilled char, so the conduit reads as stone
  // rather than a hole. Pitch, width and alpha chosen at ~3.5x density.
  conduitGrainPitch: 6,
  conduitGrainWidth: 1,
  conduitGrainOpacity: 0.22,

  // The aperture's own carved edge, per §3.3. An aperture is cut *inward* into the field, so
  // the bevel inverts: the dark edge sits at the top and the light edge at the foot.
  apertureEdge: 1,

  // §6.2's two-stop fill runs flameDeep at the base to flame near the frontier. Spread evenly
  // it read as a progress bar, so flameDeep holds most of the column and flame appears only
  // approaching the frontier. This is an objectBoundingBox offset on the scaled rect, so a
  // short fill is still mostly deep with a bright top.
  //
  // Raised from 0.72 to 0.88 in item 1b. Item 1's columns were 44pt wide; the owner's layout
  // makes them fill the screen, which roughly doubled the area of blue and let the fill mass
  // compete with the frontier for attention — exactly §4's bar-chart read. §6.2 gives the
  // frontier the brightest value in the product, so the ramp is now confined to the top eighth
  // of the fill and the body of the column stays deep.
  //
  // Item 1c put this against two alternatives on the phone and kept it: a darker base
  // (flameDeep mixed 55% toward char, ramping through flameDeep across the top third), and a
  // translucent body at 50% letting char's vertical grain read through the fire. Both were
  // rejected — see reztor-design.md §6.2. Do not reintroduce either without judging it on the
  // phone again.
  fillDeepHoldOffset: 0.88,

  // A guard, not a design value. react-native-svg treats `scaleY={0}` as falsy and falls back
  // to 1, so an empty conduit rendered completely full on item 1's first pass. The fill scale is
  // floored to this, and the fill is also gated to opacity 0 when a lane has no units. Item 2
  // must keep that floor when it drives scaleY from a shared value, or a lane at rest will flash
  // to full height.
  fillScaleFloor: 0.0001,

  // §6.2's "desaturate to 45%" for a dormant lane. See `cold` below for the interpretation.
  coldSaturation: 0.45,
  // Desaturation alone left a dormant lane at about the same luminance as live fire, so it read
  // milky and sat forward instead of receding. Its fill is also darkened by this factor.
  // Applied to the fill only: darkening `char` as well would turn the whole aperture into a
  // black hole and lose the fill level, which must stay readable.
  coldLightness: 0.55,
  // §6.2 / §7.7: a cold conduit's token drops to this opacity and its sigil goes boneFaint.
  coldTokenOpacity: 0.4,
  // §5.3: a disconnected player's token face drops to this — dimmed, but the mask still names who is
  // gone — and a thin boneFaint outline around it marks the absence. At 0.25 the face all but
  // vanished on a lit conduit, and who is missing is information the others need.
  disconnectedTokenOpacity: 0.6,
  disconnectedOutline: 1.5,
  // The outline stands this far off the disc, so it reads as a ring of its own and not as the
  // disc's carved edge.
  disconnectedOutlineGap: 2,

  // §7.2's Marking: the player's own token "larger than it will ever appear again", inside a mark
  // drawn stroke by stroke. Chosen in item 3. The mark is a square set on its point, four strokes
  // drawn in one continuous path, so each stroke is a quarter of `motion.duration.markStroke`.
  markingDisc: 120,
  markingSigil: 64,
  markingRing: 3,
  markingMarkSize: 200,
  markingMarkStroke: 3,
  // The ring's opacity before the turn, and where each role takes it: the Faithful's ring
  // steadies to full, the Hollow's dims. §7.2 names neither value.
  markingRingStart: 0.6,
  markingRingSteady: 1,
  markingRingDim: 0.25,

  // §7.5's Council timer: "a thin line that shortens across the top of the chat". Chosen in
  // item 4. Never a number, and never fire.
  councilTimerHeight: 2,
  // §7.5 asks only that the input show remaining characters "as the limit approaches". Chosen:
  // the count appears with this many characters left.
  chatCountdownFrom: 40,

  // §7.6's Judgement row. The vote token is a mid-size disc between the board's token (32) and
  // the Marking's (120); the mark is the player's own, a small square on its point like the
  // Marking's, in bone. In the Reveal each mark is the voter's own sigil at `sigilSmall`.
  voteDisc: 56,
  voteSigil: 30,
  voteMark: 10,

  // §7.4's sheet, chosen in item 5. The void behind it dims to this, so the board stays readable
  // above the sheet while it is open — the Hollow is pretending to watch it.
  sheetBackdropOpacity: 0.6,
  // The Draw's "current conduit height as a small bar", beside each seat token. Drawn in boneDim,
  // not fire: §3.1 lists every place flame may appear, and a sheet is not one of them.
  drawBarWidth: 6,
  drawBarHeight: 32,
  // §7.4's "brief --toll pulse on the sheet edge" after each Draw.
  drawPulseHeight: 2,

  // §6.1's Threshold is a short carved mark across each conduit — a light edge with a dark edge
  // under it, per §3.3's bevel logic. It stops at the conduit walls and never spans the gaps.
  thresholdThickness: 1,

  // §6.2's riding token: the seat sigil on a small stone disc that rides the surface. 32 leaves
  // the sigil 18pt inside a 74pt column, above §5.2's 16pt legibility floor, with stone visible
  // around it. Your own token is larger and ringed in boneDim — never fire, never a seat colour
  // — and that ring is the only difference between your conduit and anyone else's.
  tokenDisc: 32,
  tokenDiscOwn: 40,
  tokenSigil: 18,
  tokenSigilOwn: 22,
  tokenRing: 2,

  // Sigils are drawn in a square viewBox and scaled, so one stroke weight holds at every size
  // (§5.2 requires the same weight for all four).
  sigilBox: 24,
  sigilStroke: 1.5,
  // Seat 4 is a square with a small gap at one corner. All four sides are drawn: dropping two
  // sides made it read as a chevron at 16px rather than as a square.
  sigilCornerGap: 4,
  // The two sizes §5.2 and the preview strip care about: legible-at-thumb and inspectable.
  sigilSmall: 16,
  sigilLarge: 48,

  // NamePlate is off the board since item 1b, but §7.5 and §7.6 still want sigil + name for
  // chat rows and vote tokens, so its two values stay.
  namePlateSigil: 16,
  namePlateGap: 4,

  // The percentage's digit slot. Set when Grenze Gotisch's default (old-style, proportional) digits
  // were in use: they run 20.78px ("1") to 28.22px ("0") at the 56px t-heart step, so a centred
  // percentage shifted sideways whenever a digit changed. Each digit gets a fixed slot of fontSize
  // x this ratio and is centred inside it. The percentage now takes tabularFigures — lining
  // figures, all 28px at 56 — so the slot is belt and braces, and the notes below on narrow
  // digits describe the old figures.
  //
  // 0.52 gives 29.12px at 56 and 16.64px at 32, just clearing the widest digit ("0" at 28.22px)
  // at either candidate step. It covers digits only, on purpose: "%" measures 50.23px at 56 —
  // nearly twice a digit — so forcing it into the same slot would clip it. "%" never changes, so
  // it takes its natural width and needs no slot.
  //
  // The cost is real and visible: a narrow digit ("1" at 20.78px) keeps ~8px of air inside its
  // slot, so the number carries slight tracking, which §3.2 otherwise warns against. Fixed slots
  // and a proportional face cannot both be had — and the number holding still while the player
  // taps is worth more than the tracking costs.
  percentDigitSlotRatio: 0.52,

  // §7.3 writes SKR as "⟡" (U+27E1). That codepoint is *not* in the sans (Barlow Semi
  // Condensed; IBM Plex Sans before it): the shipped TTF's cmap returns glyph 0 for it, so as text
  // Android would silently substitute some other face in a product that otherwise controls both of
  // its faces. It is drawn as SVG instead. Barlow has no "→" (U+2192) either, so the tier face's
  // arrow is drawn too — see ArrowMark.
  //
  // U+27E1 is a concave-sided diamond: four points whose sides bow toward the centre by this
  // fraction of the distance in from the straight chord.
  skrConcavity: 0.45,
  skrMarkSize: 12,
  // Between a number and the SKR mark that qualifies it.
  skrGap: 4,
  // The drawn arrow's head: each stroke reaches back and out by this fraction of the box. Chosen in
  // the font fold-in, to match the weight of the SKR mark beside it.
  arrowHeadRatio: 0.3,

  // §7.3's tap band. The face is an oval — the one deliberate exception to §3.3's radius
  // hierarchy — so its radius comes from its own height rather than from `radii`.
  tapBandInset: 28,
  tapBandFaceHeight: 168,

  // §7.3's spark at the touch point. Small: it marks where the thumb landed, it is not an
  // effect. flameCold, because a spark is an offering entering the conduit — see §3.1.
  sparkSize: 10,

  // §7.9's countdown beside the player's own token while their socket is gone. It rides with the
  // token, this far above it — or below it, when the token sits too high for the count to fit
  // inside the aperture. Chosen in item 6.
  graceCountGap: 4,

  // §7.8's final board in the Reckoning, and §7.9's dark board on the broken screen: the four
  // conduits standing still at their last level. Short enough that the verdict and the Hollow stay
  // above the fold on an 832pt screen. Chosen in item 6.
  stillBoardHeight: 160,
  // §7.8's Hollow "marked in toll": the Marking's mark — a square on its point — drawn in toll
  // around the Hollow's token, at this size. The token itself is the vote row's (voteDisc).
  // Chosen in item 6.
  hollowMarkSize: 88,

  // The stage timer's heartbeat, chosen in the home rebuild's refinements: at each beat the clock
  // swells to this scale and its opacity falls to this, then settles. Bone at 0.6 over void still
  // measures above 4.5:1, so no frame of the beat drops the number under the text floor.
  timerBeatScale: 1.12,
  timerBeatOpacity: 0.6,
  // Seconds left at which the heartbeat quickens: above the first it is calm; at or under each it
  // takes the next, faster period in motion.timerBeat.
  timerBeatThresholds: [20, 10, 5],

  // §7.3's credit thresholds. Below the first the counter shifts to toll; below the second it
  // also pulses. The doc names both numbers.
  creditsLow: 100,
  creditsCritical: 20,
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

/** `a` mixed `t` of the way toward `b`, per sRGB channel — how tollText and its kin were derived. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
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

// ---------------------------------------------------------------------------------------------
// The home screen's carved faces
// ---------------------------------------------------------------------------------------------
//
// §3.3's bevel, applied so the home's controls sit clearly above the void: every face is at least
// `stone` with `stoneEdge` sides, raised faces lit above and shadowed below, fields cut in (the
// same edges inverted). Two primary candidates, awaiting the owner's choice:
// - litStone: the brightest stone face, a rim lighter than any stone above it, bone label.
// - flame: §3.1's proposed fifth use of fire, the single primary action on the entry screen and
//   nowhere else. flameDeep face, flame rim, flameWhite label — bone measures only 4.14:1 on
//   flameDeep, flameWhite 5.24:1.
// - coldEdge: a stone face whose lit top edge is flameCold, with a flameWhite label (12.73:1 on
//   stone). Fire only as a line and a label, so the button does not share the idle board's blue
//   fill as a face.
function makeHomeFaces(p: typeof palette) {
  const raised = {
    backgroundColor: p.stone,
    borderWidth: 1,
    borderColor: p.stoneEdge,
    borderTopColor: p.stoneLit,
    borderBottomColor: p.bevelShadow,
  }
  return {
    panel: { ...raised, borderRadius: radii.panel },
    secondary: { ...raised, borderRadius: radii.chip },
    field: {
      backgroundColor: p.stone,
      borderWidth: 1,
      borderColor: p.stoneEdge,
      borderTopColor: p.bevelShadow,
      borderBottomColor: p.stoneLit,
      borderRadius: radii.chip,
    },
    // The cell or field being typed into. boneDim, never fire: §3.1 bans flame on focus rings.
    fieldFocused: { borderColor: p.boneDim, borderTopColor: p.boneDim, borderBottomColor: p.boneDim },
    // A control that cannot be pressed yet: an empty slot cut into the stone, darker than any face
    // and lit only on its lower lip, so it can never be mistaken for a raised button.
    disabled: {
      backgroundColor: p.char,
      borderWidth: 1,
      borderColor: p.stoneEdge,
      borderTopColor: p.bevelShadow,
      borderBottomColor: p.stone,
    },
    // The code cells. Awaiting: the cell the next character lands in, its rim at full bone. Filled:
    // a lit face (bone on stoneLit is 4.51:1). Complete: all four filled, every rim bone — the row
    // reads as sealed.
    cellAwaiting: { borderColor: p.bone, borderTopColor: p.bone, borderBottomColor: p.bone },
    cellFilled: {
      backgroundColor: p.stoneLit,
      borderColor: p.stoneEdge,
      borderTopColor: mix(p.stoneLit, p.bone, 0.35),
      borderBottomColor: p.bevelShadow,
    },
    cellComplete: { borderColor: p.bone, borderTopColor: p.bone, borderBottomColor: p.bone },
    primary: {
      litStone: {
        backgroundColor: p.stoneLit,
        borderWidth: 1,
        borderColor: p.stoneEdge,
        borderTopColor: mix(p.stoneLit, p.bone, 0.35),
        borderBottomColor: p.bevelShadow,
        borderRadius: radii.chip,
      },
      flame: {
        backgroundColor: p.flameDeep,
        borderWidth: 1,
        borderColor: p.flameDeep,
        borderTopColor: p.flame,
        borderBottomColor: p.bevelShadow,
        borderRadius: radii.chip,
      },
      coldEdge: {
        backgroundColor: p.stone,
        borderWidth: 1,
        borderColor: p.stoneEdge,
        borderTopWidth: home.primaryEdge,
        borderTopColor: p.flameCold,
        borderBottomColor: p.bevelShadow,
        borderRadius: radii.chip,
      },
    },
    primaryLabel: { litStone: p.bone, flame: p.flameWhite, coldEdge: p.flameWhite },
  } as const
}

export type PrimaryStyle = 'litStone' | 'flame' | 'coldEdge'

// Values the home rebuild chose. The design doc names none of them.
const home = {
  // The primary action outranks every other control by height as well as by face.
  primaryHeight: 56,
  // The coldEdge primary's lit top edge: thick enough to read as a line of fire, not a hairline.
  primaryEdge: 2,
  // One character of the code per cell, square.
  codeCell: 56,
  // The idle board: four conduits at fixed, staggered low levels, decorative and never state. Four
  // different values over a narrow range, so the board reads as a rite not yet begun rather than as
  // a chart — no two equal, none near the Threshold.
  idleBoardFills: [0.22, 0.13, 0.3, 0.17],
  // Below this the board is dropped rather than squashed into a strip.
  idleBoardMin: 120,
  // Peak opacity of the idle board's one pulse: a glow on each frontier, swelling and settling.
  idlePulsePeak: 0.8,
  // The pulse's glow is the frontier glow stroked this much wider, so it reads beyond the glow
  // the Conduit already draws.
  idlePulseWidthScale: 2,
  // §6.1: the carved Threshold crosses each conduit at 60% of its height.
  idleThreshold: 0.6,
  // The About control's drawn mark: a square set on its point, the Marking's shape. The match
  // header's rules control draws the same mark.
  aboutMark: 8,
  // The faucet's coin: a struck stone disc, gold-rimmed, the SKR mark on its face. Two, overlapping,
  // because one at button-label size read as a ring rather than as money.
  coinSize: 22,
  coinStack: 2,
  coinOffset: 9,
  // The struck inner ring, as a fraction of the coin's radius, and the SKR mark's share of the face.
  coinInnerRing: 0.74,
  coinMarkShare: 0.62,
  // Max share of the window the About sheet may take, so there is always void above it to tap.
  sheetMaxShare: 0.8,
} as const

const homeFaces = makeHomeFaces(palette)

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
  homeFaces,
  home,
} as const
