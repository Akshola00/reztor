import { StyleSheet, View } from 'react-native'

import { tokens } from '../design/tokens'
import { SEAT_COLOURS, Sigil, type SeatNumber } from './Sigil'

// §6.2. The conduit owner's sigil on a small stone disc, riding the arced surface. It replaces
// the name plate as the board's identity carrier: the sigil is the primary identity carrier
// everywhere per §5.2, and here it also tells you whose conduit is at what level in one glance.
//
// The disc is a raised face per §3.3 — light edge above, dark edge below — so it reads as sitting
// on the surface rather than floating over it. Nothing here carries fire.
//
// Your own token is larger and ringed in boneDim, and that is the *only* difference between your
// conduit and anyone else's (§6.1). Never a seat colour for the ring, never flame.
//
// Item 2 animates `centreY` and nothing else: the wrapper's translateY is the single moving prop.

type RidingTokenProps = {
  seat: SeatNumber
  own: boolean
  dormant: boolean
  /** Centre of the disc in conduit pixels, from `conduitGeometry`. */
  centreY: number
}

export function RidingToken({ seat, own, dormant, centreY }: RidingTokenProps) {
  const { art, palette } = tokens

  const disc = own ? art.tokenDiscOwn : art.tokenDisc
  const sigil = own ? art.tokenSigilOwn : art.tokenSigil
  // The ring sits outside the disc, so an own token occupies this much in total.
  const outer = own ? disc + art.tokenRing * 2 : disc

  // §6.2 / §7.7: a cold conduit's token recedes rather than disappearing — the seat still owns
  // the conduit, and its contribution still stands.
  const sigilColour = dormant ? palette.boneFaint : SEAT_COLOURS[seat]

  const face = (
    <View style={[styles.disc, { width: disc, height: disc, borderRadius: disc / 2 }]}>
      <Sigil seat={seat} colour={sigilColour} size={sigil} />
    </View>
  )

  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { transform: [{ translateY: centreY - outer / 2 }] }, dormant ? styles.dormant : null]}
    >
      {own ? <View style={[styles.ring, { width: outer, height: outer, borderRadius: outer / 2 }]}>{face}</View> : face}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  disc: {
    ...tokens.material.raisedStoneFace,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // §6.1's own-conduit mark. boneDim, never fire and never a seat colour.
  ring: {
    borderWidth: tokens.art.tokenRing,
    borderColor: tokens.palette.boneDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dormant: {
    opacity: tokens.art.coldTokenOpacity,
  },
})
