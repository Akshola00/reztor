import { useId } from 'react'
import Svg, { Circle, Line, Path } from 'react-native-svg'

import { tokens } from '../design/tokens'

// §5.2. Four marks, distinguishable by shape alone at 16px, all at one stroke weight so none
// reads as more important. Everything is drawn in a square viewBox and scaled, so the stroke
// stays proportional at 16 and at 48.
//
// Seat 4 has two candidates. §5.2 calls for a square rotated 45° with one corner open, but
// §6.1's own diagram draws it upright, and rotated it risks reading as seat 3's diamond at
// 16px. Variant A follows §5.2, variant B follows the diagram.

export type SeatNumber = 1 | 2 | 3 | 4
export type Seat4Variant = 'A' | 'B'

type SigilProps = {
  seat: SeatNumber
  colour: string
  size?: number
  seat4Variant?: Seat4Variant
}

const BOX = tokens.art.sigilBox
const MID = BOX / 2
// Inset so the stroke never clips the viewBox edge.
const INSET = tokens.art.sigilStroke * 2
const NEAR = INSET
const FAR = BOX - INSET

export function Sigil({ seat, colour, size = tokens.art.sigilSmall, seat4Variant = 'A' }: SigilProps) {
  // Unique per instance: duplicate ids across Svg elements render wrong on Android.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')

  const stroke = {
    stroke: colour,
    strokeWidth: tokens.art.sigilStroke,
    fill: 'none' as const,
    // Carved, not drawn: square ends and corners.
    strokeLinecap: 'square' as const,
    strokeLinejoin: 'miter' as const,
  }

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`} testID={`sigil-${seat}-${uid}`}>
      {seat === 1 ? (
        <>
          <Circle cx={MID} cy={MID} r={MID - INSET} {...stroke} />
          <Line x1={NEAR} y1={MID} x2={FAR} y2={MID} {...stroke} />
        </>
      ) : null}

      {seat === 2 ? (
        // An upward triangle with its apex cut flat.
        <Path
          d={`M ${NEAR} ${FAR} L ${FAR} ${FAR} L ${FAR - BOX / 4} ${NEAR + BOX / 12} L ${NEAR + BOX / 4} ${NEAR + BOX / 12} Z`}
          {...stroke}
        />
      ) : null}

      {seat === 3 ? (
        <>
          <Path d={`M ${MID} ${NEAR} L ${FAR} ${MID} L ${MID} ${FAR} L ${NEAR} ${MID} Z`} {...stroke} />
          <Line x1={MID} y1={NEAR + BOX / 8} x2={MID} y2={FAR - BOX / 8} {...stroke} />
        </>
      ) : null}

      {seat === 4 && seat4Variant === 'A' ? (
        // §5.2: rotated 45°, one corner open. Open between the top and right vertices.
        <Path d={`M ${FAR} ${MID} L ${MID} ${FAR} L ${NEAR} ${MID} L ${MID} ${NEAR}`} {...stroke} />
      ) : null}

      {seat === 4 && seat4Variant === 'B' ? (
        // §6.1's diagram: upright, one corner open. Open at the top right.
        <Path d={`M ${MID} ${NEAR} L ${NEAR} ${NEAR} L ${NEAR} ${FAR} L ${FAR} ${FAR} L ${FAR} ${MID}`} {...stroke} />
      ) : null}
    </Svg>
  )
}

export const SEAT_COLOURS: Record<SeatNumber, string> = {
  1: tokens.palette.seat1,
  2: tokens.palette.seat2,
  3: tokens.palette.seat3,
  4: tokens.palette.seat4,
}
