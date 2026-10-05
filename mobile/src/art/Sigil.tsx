import Svg, { Circle, Line, Path } from 'react-native-svg'

import { tokens } from '../design/tokens'
import { useLook } from '../screens/look'

// §5.2. Each seat's identity mark, in its seat colour, everywhere a player is shown.
//
// **Masks**, the owner's call over the geometric sigils: four carved stone faces, one of which is
// worn by the Hollow. Flat strokes, one weight for all four, no gradients. They are told apart by
// **outer silhouette alone**, because the riding token draws them at 18dp:
//   1. Horned  — two points flaring out from the top corners.
//   2. Beaked  — one long wedge descending below the face.
//   3. Crested — three points along the top edge, the middle one tallest.
//   4. Veiled  — a plain dome on straight sides to a flat hem, defined by having no projection.
// Every mask has the same two eye voids, a short slit, and only their angle varies — level,
// downturned, upturned, set wide — since an angle survives small sizes and an eye's shape does not.
//
// **Geometric** is the previous set, kept behind home's dev chip so the two can be compared on a
// phone, and so the masks are one commit to revert. Seat 4 is upright with a gap at one corner:
// item 1 found the old §5.2's rotated square read as a bare chevron at 16px.
//
// Everything is drawn in one square viewBox and scaled, so the stroke stays proportional at 16 and
// at 120.

export type SeatNumber = 1 | 2 | 3 | 4

type SigilProps = {
  seat: SeatNumber
  colour: string
  size?: number
}

const BOX = tokens.art.sigilBox
const MID = BOX / 2

// -------------------------------------------------------------------------------------------------
// Masks
// -------------------------------------------------------------------------------------------------

/** Each mask's outline, closed, in a `sigilBox` square. Exported for the silhouette test. */
export const MASK_OUTLINES: Record<SeatNumber, string> = {
  // Horned: a face with a rounded chin, and two horns rising out and away from its top corners.
  1: 'M 3 2 L 8 8 L 16 8 L 21 2 L 18 11 L 18 15 Q 18 21 12 21 Q 6 21 6 15 L 6 11 Z',
  // Beaked: a round face whose chin narrows to one long wedge, well below it. The wedge is narrow on
  // purpose — a full-width taper read as a map pin.
  2: 'M 12 2.5 Q 18.5 2.5 18.5 9 L 18.5 12 Q 18.5 15.5 14.5 16 L 12 23 L 9.5 16 Q 5.5 15.5 5.5 12 L 5.5 9 Q 5.5 2.5 12 2.5 Z',
  // Crested: a row of three equal points along the top edge, over a rounded chin. Equal and low on
  // purpose — a tall middle point read as a flame.
  3: 'M 6 9 L 8 5 L 10 8.5 L 12 5 L 14 8.5 L 16 5 L 18 9 L 18 15 Q 18 21 12 21 Q 6 21 6 15 Z',
  // Veiled: a plain dome on straight sides, falling to a flat hem. Nothing projects.
  4: 'M 5.5 21 L 5.5 11 Q 5.5 3.5 12 3.5 Q 18.5 3.5 18.5 11 L 18.5 21 Z',
}

// The eye voids: [x1, y1, x2, y2] for each eye, same slit length in every mask, only the angle and
// the spacing changing. Downturned: the outer end lower. Upturned: the outer end higher.
const MASK_EYES: Record<SeatNumber, [number, number, number, number][]> = {
  1: [
    [8.5, 13, 10.5, 13],
    [13.5, 13, 15.5, 13],
  ],
  2: [
    [10.5, 8.5, 8.6, 9.9],
    [13.5, 8.5, 15.4, 9.9],
  ],
  3: [
    [10.5, 14, 8.6, 12.6],
    [13.5, 14, 15.4, 12.6],
  ],
  // Set wide, but clear of the sides: touching them, the slits read as notches in the outline.
  4: [
    [7.8, 12, 9.8, 12],
    [14.2, 12, 16.2, 12],
  ],
}

function Mask({ seat, colour }: { seat: SeatNumber; colour: string }) {
  const stroke = {
    stroke: colour,
    strokeWidth: tokens.art.sigilStroke,
    // Carved, not drawn: mitred corners, square ends.
    strokeLinejoin: 'miter' as const,
    strokeLinecap: 'square' as const,
  }
  return (
    <>
      <Path d={MASK_OUTLINES[seat]} fill="none" {...stroke} />
      {MASK_EYES[seat].map(([x1, y1, x2, y2]) => (
        <Line key={`${x1}`} x1={x1} y1={y1} x2={x2} y2={y2} {...stroke} />
      ))}
    </>
  )
}

// -------------------------------------------------------------------------------------------------
// Geometric — the previous sigils, behind the dev chip
// -------------------------------------------------------------------------------------------------

// Inset so the stroke never clips the viewBox edge.
const INSET = tokens.art.sigilStroke * 2
const NEAR = INSET
const FAR = BOX - INSET
const GAP = tokens.art.sigilCornerGap

function Geometric({ seat, colour }: { seat: SeatNumber; colour: string }) {
  const stroke = {
    stroke: colour,
    strokeWidth: tokens.art.sigilStroke,
    fill: 'none' as const,
    strokeLinecap: 'square' as const,
    strokeLinejoin: 'miter' as const,
  }
  return (
    <>
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
    </>
  )
}

export function Sigil({ seat, colour, size = tokens.art.sigilSmall }: SigilProps) {
  const { marks } = useLook()
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
      {marks === 'geometric' ? <Geometric seat={seat} colour={colour} /> : <Mask seat={seat} colour={colour} />}
    </Svg>
  )
}

export const SEAT_COLOURS: Record<SeatNumber, string> = {
  1: tokens.palette.seat1,
  2: tokens.palette.seat2,
  3: tokens.palette.seat3,
  4: tokens.palette.seat4,
}
