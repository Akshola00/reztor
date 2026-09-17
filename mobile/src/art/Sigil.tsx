import Svg, { Circle, Line, Path } from 'react-native-svg'

import { tokens } from '../design/tokens'

// §5.2. Four marks, distinguishable by shape alone at 16px, all at one stroke weight so none
// reads as more important. Everything is drawn in a square viewBox and scaled, so the stroke
// stays proportional at 16 and at 48.
//
// Seat 4 is upright, per §6.1's diagram, and draws all four sides with a small gap at one
// corner. Item 1 first tried §5.2's literal reading — a rotated square with a corner left open,
// which drops two whole sides — and it read as a bare chevron at 16px. Upright with a gap keeps
// it a square, and avoids colliding with seat 3's diamond at thumb size.

export type SeatNumber = 1 | 2 | 3 | 4

type SigilProps = {
  seat: SeatNumber
  colour: string
  size?: number
}

const BOX = tokens.art.sigilBox
const MID = BOX / 2
// Inset so the stroke never clips the viewBox edge.
const INSET = tokens.art.sigilStroke * 2
const NEAR = INSET
const FAR = BOX - INSET
const GAP = tokens.art.sigilCornerGap

export function Sigil({ seat, colour, size = tokens.art.sigilSmall }: SigilProps) {
  const stroke = {
    stroke: colour,
    strokeWidth: tokens.art.sigilStroke,
    fill: 'none' as const,
    // Carved, not drawn: square ends and corners.
    strokeLinecap: 'square' as const,
    strokeLinejoin: 'miter' as const,
  }

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
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

      {seat === 4 ? (
        // All four sides, upright, with a small gap at the top-right corner.
        <Path
          d={`M ${FAR - GAP} ${NEAR} L ${NEAR} ${NEAR} L ${NEAR} ${FAR} L ${FAR} ${FAR} L ${FAR} ${NEAR + GAP}`}
          {...stroke}
        />
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
