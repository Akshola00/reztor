import Svg, { Path } from 'react-native-svg'

import { tokens } from '../design/tokens'

// §7.3's tier face reads `1 ⟡ → 1`: cost, then yield. The arrow is notation between two numbers, not
// a call to action (§4). Barlow Semi Condensed has no U+2192 — its cmap returns glyph 0 — so, like
// the SKR mark, it is drawn rather than handed to whatever face Android substitutes. Same square
// box, same stroke weight, so the two marks on the tier face read as one family.

const BOX = tokens.art.sigilBox
const MID = BOX / 2
const HEAD = BOX * tokens.art.arrowHeadRatio

// A shaft across the box and a two-stroke head at its right end.
const PATH = `M 0 ${MID} L ${BOX} ${MID} M ${BOX - HEAD} ${MID - HEAD} L ${BOX} ${MID} L ${BOX - HEAD} ${MID + HEAD}`

export function ArrowMark({ colour, size = tokens.art.skrMarkSize }: { colour: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
      <Path d={PATH} fill="none" stroke={colour} strokeWidth={tokens.art.sigilStroke} strokeLinejoin="miter" />
    </Svg>
  )
}
