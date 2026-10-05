import { Easing } from 'react-native-reanimated'

// Every row of reztor-design.md §8, as amended by BUILD-PLAN.md §1 and §2.
//
// Motion answers actions. Two moments per match are unprompted spectacle — the Threshold
// crossing and Cast Out — and everything else stays restrained so those two land.

// The exact CSS equivalents, kept as tuples so the curve itself is inspectable and so the
// Reanimated easings below are built from one definition.
//
// `Easing.out(Easing.ease)` is a different curve. Do not substitute it for easeOut.
const curveBezier = {
  linear: [0, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
} as const

const easing = {
  linear: Easing.linear,
  easeOut: Easing.bezier(...curveBezier.easeOut),
  easeInOut: Easing.bezier(...curveBezier.easeInOut),
} as const

const duration = {
  // §8 / §10.2 — the player's own tap is optimistic and instant. The only instant movement
  // in the product.
  ownTap: 0,

  // §8, amended by BUILD-PLAN.md §1: every lane lerps, none snap. Falling is slower on
  // purpose, so a drain reads as a drain rather than a rendering glitch.
  frontierRise: 250,
  frontierFall: 400,

  tollEmbers: 400,
  stageChange: 500,
  voteReveal: 400,

  // BUILD-PLAN.md §2 cuts §8's 1400ms orchestration down to a flame-white flood.
  thresholdCrossing: 600,
  castOut: 3000,
  // §7.6: after the marks flip in, they hold this long before the vote resolves. Chosen in item 4:
  // long enough to read four marks, short enough not to eat the next Offering.
  revealHold: 1000,
  // §7.7, inside castOut: the token drops to cold over this.
  castOutCold: 1000,

  // Between MATCH_END — or the end of the Reveal and Cast Out it arrived with — and the Reckoning.
  // The final board holds still this long, so the crossing flood (600) lands and the last
  // positions register before the screen changes. Chosen in item 6.
  endHold: 2000,

  // §8's overlay timing, which BUILD-PLAN.md §2 applies to the Draw bottom sheet.
  overlay: 180,

  // §7.3 — the plinth depresses on touch and releases over this.
  plinthRelease: 80,

  // §7.2 — both role variants run for exactly this long, with the same number of beats, so
  // role cannot be inferred from timing. No skip.
  markingTotal: 4000,
  markStroke: 1200,
  // §7.2's later beats, chosen in item 3. Identical for both roles; only the colour each beat
  // resolves to differs. Whatever of markingTotal these leave over is the hold before the lift.
  markResolve: 400,
  markTurn: 400,
  markLine: 400,
  markLift: 500,

  // §7.3's spark at the touch point. §8 names no duration for it; 400 matches the toll embers,
  // which is the other single-shot mark on the board, so the two read as one vocabulary.
  spark: 400,
} as const

// §7.3 — below `art.creditsCritical` the counter "pulses slowly". §7.3 names no period, so this
// is chosen: slow enough to read as unease rather than as an alarm.
const creditPulsePeriod = 2000

// The home screen's idle board: its one motion, a glow that swells on each frontier and settles.
// Chosen in the home rebuild. Slow enough to read as the dead god breathing, not as a loader.
const idlePulsePeriod = 4800

// The stage timer's heartbeat, one period per band of tokens.art.timerBeatThresholds: calm above
// 20s, then quickening at 20, 10 and 5 seconds left. Chosen in the home rebuild's refinements.
const timerBeat = [2400, 1400, 800, 500] as const

// §7.3 — px the tap band sinks while touched.
const plinthPressDepth = 2

// CLAUDE.md hard rule 3 — the credit counter updates at most 10x/sec, never per tap. The board
// percentage and the crossing flag, which also follow the player's own taps, poll on the same
// interval, so no readout re-renders the Offering screen per tap.
const readoutInterval = 100

// §8's overlay row: "Scale from 0.98, no blur". Applies to the action sheet and the leave
// confirmation.
const overlayScaleFrom = 0.98

// The §8 rows that name a curve, prepared to spread straight into `withTiming`.
//
// Deliberately absent: thresholdCrossing. §8 calls it "orchestrated", so picking a curve here
// would be inventing a design value. Choose it when the beat is built, then add it.
const transition = {
  frontierRise: { duration: duration.frontierRise, easing: easing.linear },
  frontierFall: { duration: duration.frontierFall, easing: easing.easeOut },
  tollEmbers: { duration: duration.tollEmbers, easing: easing.easeOut },
  stageChange: { duration: duration.stageChange, easing: easing.easeInOut },
  voteReveal: { duration: duration.voteReveal, easing: easing.easeOut },
  overlay: { duration: duration.overlay, easing: easing.easeOut },
  // A spark fades out and never back in, so ease-out is the only sensible curve.
  spark: { duration: duration.spark, easing: easing.easeOut },
  // §7.3 names 80ms and no curve; chosen in item 2. Ease-out, so the band leaves the thumb fast
  // and settles into place — stone returning, not a fade.
  plinthRelease: { duration: duration.plinthRelease, easing: easing.easeOut },
  // §7.3's slow pulse. Half a period each way, ease-in-out, so it breathes rather than blinks.
  creditPulse: { duration: creditPulsePeriod / 2, easing: easing.easeInOut },
  // §7.2. Strokes are drawn at an even hand; the colour beats ease both ways; the lift decelerates
  // off the board.
  markStroke: { duration: duration.markStroke, easing: easing.linear },
  markResolve: { duration: duration.markResolve, easing: easing.easeInOut },
  markTurn: { duration: duration.markTurn, easing: easing.easeInOut },
  markLine: { duration: duration.markLine, easing: easing.easeOut },
  markLift: { duration: duration.markLift, easing: easing.easeOut },
  // Half a period each way, ease-in-out, like the credit pulse: it breathes rather than blinks.
  idlePulse: { duration: idlePulsePeriod / 2, easing: easing.easeInOut },
  // §7.7, chosen in item 4: the ejected token settles into cold rather than blinking out.
  castOutCold: { duration: duration.castOutCold, easing: easing.easeInOut },
} as const

export const motion = {
  curveBezier,
  easing,
  duration,
  transition,
  plinthPressDepth,
  creditPulsePeriod,
  idlePulsePeriod,
  timerBeat,
  readoutInterval,
  overlayScaleFrom,
} as const
