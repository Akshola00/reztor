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

  // §8's overlay timing, which BUILD-PLAN.md §2 applies to the Draw bottom sheet.
  overlay: 180,

  // §7.3 — the plinth depresses on touch and releases over this.
  plinthRelease: 80,

  // §7.2 — both role variants run for exactly this long, with the same number of beats, so
  // role cannot be inferred from timing. No skip.
  markingTotal: 4000,
  markStroke: 1200,
} as const

// §8 — the Heart's pulse period tracks the board total between these bounds. It is a period,
// not a transition duration, so it is not in `duration`.
const heartPulsePeriod = { min: 1500, max: 5000 } as const

// §7.3 — px the plinth sinks while touched.
const plinthPressDepth = 2

// The §8 rows that name a curve, prepared to spread straight into `withTiming`.
//
// Deliberately absent: thresholdCrossing, castOut, markingTotal/markStroke and plinthRelease.
// §8 calls the first two "orchestrated" and §7.2/§7.3 name no curve at all, so picking one
// here would be inventing a design value. Choose it when the beat is built, then add it here.
const transition = {
  frontierRise: { duration: duration.frontierRise, easing: easing.linear },
  frontierFall: { duration: duration.frontierFall, easing: easing.easeOut },
  tollEmbers: { duration: duration.tollEmbers, easing: easing.easeOut },
  stageChange: { duration: duration.stageChange, easing: easing.easeInOut },
  voteReveal: { duration: duration.voteReveal, easing: easing.easeOut },
  overlay: { duration: duration.overlay, easing: easing.easeOut },
  // Period comes from `heartPulsePeriod`.
  heartPulse: { easing: easing.easeInOut },
} as const

export const motion = {
  curveBezier,
  easing,
  duration,
  transition,
  heartPulsePeriod,
  plinthPressDepth,
} as const
