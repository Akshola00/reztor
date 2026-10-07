import { tokens } from '../design/tokens'

// SKR is "⟡" (U+27E1). The interface face (Barlow Semi Condensed) does not contain that codepoint —
// its cmap returns glyph 0 — so setting it as text hands the glyph to whatever face Android
// substitutes. Its outline is drawn instead, in the sigils' square box, and struck onto the faucet's
// coin. Since the owner's UI pass the match counts energy, not SKR, so the coin is its only use.
//
// U+27E1 is a white concave-sided diamond: four points with sides that bow inward.

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
/** The mark's outline in a `sigilBox` square, shared with the faucet's coin. */
export const SKR_PATH = `${POINTS.map((point, i) => {
  const next = POINTS[(i + 1) % POINTS.length]
  const chordX = (point[0] + next[0]) / 2
  const chordY = (point[1] + next[1]) / 2
  const cx = chordX + (MID - chordX) * tokens.art.skrConcavity
  const cy = chordY + (MID - chordY) * tokens.art.skrConcavity
  const open = i === 0 ? `M ${point[0]} ${point[1]} ` : ''
  return `${open}Q ${cx} ${cy} ${next[0]} ${next[1]}`
}).join(' ')} Z`
