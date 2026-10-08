import { View } from 'react-native'
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg'

import { tokens } from '../design/tokens'

// The owner's UI pass: the drawn marks of the Offering's controls row. No emoji and no icon
// library — each is a few strokes in the sigils' square box, so they read as one family of carved
// marks. None of them is fire: a lane drawn in an icon is bone and boneDim, never blue (§3.1).

const BOX = tokens.art.sigilBox

/** Energy: a bolt, filled. Gold in the controls row — gold is the accent for value (§3.1). */
export function EnergyMark({ colour, size = tokens.art.energyMark }: { colour: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
      <Path d="M 14 1.5 L 4.5 13.5 L 11 13.5 L 9.5 22.5 L 19.5 9.5 L 13 9.5 Z" fill={colour} />
    </Svg>
  )
}

/** The tap size: one stone for ×1, three for ×3, in a row. */
export function TierMark({ count, colour }: { count: number; colour: string }) {
  const { tierPip, tierPipGap } = tokens.art
  return (
    <View style={{ flexDirection: 'row', gap: tierPipGap }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: tierPip, height: tierPip, borderRadius: tierPip / 2, backgroundColor: colour }} />
      ))}
    </View>
  )
}

const stroke = (colour: string) => ({
  stroke: colour,
  strokeWidth: tokens.art.iconStroke,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
})

/** Inspect: a lens held over a lane, the lane's fill showing through it. */
export function InspectIcon({ colour, fill }: { colour: string; fill: string }) {
  const size = tokens.art.icon
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
      <Rect x={8.75} y={10.5} width={3.5} height={4.5} fill={fill} />
      <Rect x={8.75} y={6} width={3.5} height={9} {...stroke(colour)} />
      <Circle cx={10.5} cy={10.5} r={7.5} {...stroke(colour)} />
      <Line x1={16} y1={16} x2={21.5} y2={21.5} {...stroke(colour)} />
    </Svg>
  )
}

/** Drain: two lanes, one lower, and a line arcing out of one and down into the other. */
export function DrainIcon({ colour, fill }: { colour: string; fill: string }) {
  const size = tokens.art.icon
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
      <Rect x={3} y={17} width={5} height={4.5} fill={fill} />
      <Rect x={16} y={12} width={5} height={9.5} fill={fill} />
      <Rect x={3} y={10.5} width={5} height={11} {...stroke(colour)} />
      <Rect x={16} y={8.5} width={5} height={13} {...stroke(colour)} />
      <Path d="M 5.5 8 C 7.5 1.5 15.5 1.5 17.5 5.5" {...stroke(colour)} />
      <Path d="M 14.9 4.1 L 17.5 5.5 L 17.9 2.6" {...stroke(colour)} />
    </Svg>
  )
}

/** Send: an arrow rising. Gold while there is something to send (gold is emphasis, §3.1). */
export function SendIcon({ colour }: { colour: string }) {
  const size = tokens.art.icon
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
      <Path d="M 12 19.5 L 12 5" {...stroke(colour)} />
      <Path d="M 6 11 L 12 5 L 18 11" {...stroke(colour)} />
    </Svg>
  )
}

/** The tap hint's arrow: a short stem and head pointing down into the band. */
export function DownArrow({ colour, size = tokens.art.tapHintArrow }: { colour: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
      <Path d="M 12 3 L 12 20" {...stroke(colour)} strokeWidth={tokens.art.tapHintArrowStroke} />
      <Path d="M 5 13 L 12 20 L 19 13" {...stroke(colour)} strokeWidth={tokens.art.tapHintArrowStroke} />
    </Svg>
  )
}
