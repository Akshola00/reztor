import Svg, { Path } from 'react-native-svg'

import { tokens } from '../design/tokens'

// §7.3 sets SKR as "⟡" (U+27E1) on the tier face and beside the credit counter. IBM Plex Sans
// does not contain that codepoint — its cmap returns glyph 0 — so setting it as text hands the
// glyph to whatever face Android substitutes, which is not a decision this product should leave
// to the platform. It is drawn here instead, in the same square box and at the same stroke
// weight as the sigils, so the two read as one family of carved marks.
//
// U+27E1 is a white concave-sided diamond: four points with sides that bow inward.

type SkrMarkProps = {
  colour: string
  size?: number
}

const BOX = tokens.art.sigilBox
const MID = BOX / 2

const POINTS: [number, number][] = [
  [MID, 0],
  [BOX, MID],
  [MID, BOX],
  [0, MID],
]

// One quadratic per side. Each control point is the straight chord's midpoint pulled toward the
// centre, which is what bows the side inward instead of leaving it flat.
const PATH = `${POINTS.map((point, i) => {
  const next = POINTS[(i + 1) % POINTS.length]
  const chordX = (point[0] + next[0]) / 2
  const chordY = (point[1] + next[1]) / 2
  const cx = chordX + (MID - chordX) * tokens.art.skrConcavity
  const cy = chordY + (MID - chordY) * tokens.art.skrConcavity
  const open = i === 0 ? `M ${point[0]} ${point[1]} ` : ''
  return `${open}Q ${cx} ${cy} ${next[0]} ${next[1]}`
}).join(' ')} Z`

export function SkrMark({ colour, size = tokens.art.skrMarkSize }: SkrMarkProps) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
      <Path d={PATH} fill="none" stroke={colour} strokeWidth={tokens.art.sigilStroke} strokeLinejoin="miter" />
    </Svg>
  )
}
