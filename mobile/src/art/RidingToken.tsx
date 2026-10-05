import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'

import { tokens, type Palette } from '../design/tokens'
import { conduitGeometry } from './Conduit'
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
// The wrapper's translateY is the single moving prop. It is derived on the UI thread from the
// lane's `units` shared value through `conduitGeometry` — the same call that places the surface,
// so the token and the frontier cannot drift apart.

type RidingTokenProps = {
  seat: SeatNumber
  own: boolean
  dormant: boolean
  /** §5.3: the owner's socket is gone and their grace clock is running. */
  disconnected: boolean
  /** The lane's displayed units — the same shared value its Conduit reads. */
  units: SharedValue<number>
  capacity: number
  /** The conduit's height in pixels. */
  height: number
  /**
   * §7.9: the grace countdown, beside the player's own token while their socket is gone. It rides
   * with the token. Only this player's own client ever passes one — §5.3 puts no countdown on
   * anyone else's token.
   */
  badge?: ReactNode
  /** The home screen's palette candidates. The match never passes one. */
  palette?: Palette
}

export function RidingToken({
  seat,
  own,
  dormant,
  disconnected,
  units,
  capacity,
  height,
  badge,
  palette = tokens.palette,
}: RidingTokenProps) {
  const { art } = tokens

  const disc = own ? art.tokenDiscOwn : art.tokenDisc
  const sigil = own ? art.tokenSigilOwn : art.tokenSigil
  // The ring sits outside the disc, so an own token occupies this much in total.
  const outer = own ? disc + art.tokenRing * 2 : disc

  const rideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: conduitGeometry(units.get(), capacity, height, outer).tokenCentreY - outer / 2 }],
  }))

  // §6.2 / §7.7: a cold conduit's token recedes rather than disappearing — the seat still owns
  // the conduit, and its contribution still stands.
  const sigilColour = dormant ? palette.boneFaint : SEAT_COLOURS[seat]

  const face = (
    <View
      style={[
        styles.disc,
        { width: disc, height: disc, borderRadius: disc / 2 },
        palette === tokens.palette
          ? null
          : {
              backgroundColor: palette.stone,
              borderTopColor: palette.stoneLit,
              borderBottomColor: palette.bevelShadow,
            },
      ]}
    >
      <Sigil seat={seat} colour={sigilColour} size={sigil} />
    </View>
  )

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, rideStyle, dormant ? styles.dormant : null, disconnected ? styles.disconnected : null]}
    >
      {own ? <View style={[styles.ring, { width: outer, height: outer, borderRadius: outer / 2 }]}>{face}</View> : face}
      {badge === undefined ? null : (
        <Badge units={units} capacity={capacity} height={height} outer={outer}>
          {badge}
        </Badge>
      )}
    </Animated.View>
  )
}

/**
 * Above the token, or below it when the token rides too high for the badge to fit inside the
 * aperture. Its own component, so a token without a badge runs no second worklet per frame.
 */
function Badge({
  units,
  capacity,
  height,
  outer,
  children,
}: {
  units: SharedValue<number>
  capacity: number
  height: number
  outer: number
  children: ReactNode
}) {
  const space = tokens.type.data.lineHeight + tokens.art.graceCountGap
  const below = outer + tokens.art.graceCountGap
  const style = useAnimatedStyle(() => {
    const top = conduitGeometry(units.get(), capacity, height, outer).tokenCentreY - outer / 2
    return { transform: [{ translateY: top < space ? below : -space }] }
  })
  return <Animated.View style={[styles.badge, style]}>{children}</Animated.View>
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
  badge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  dormant: {
    opacity: tokens.art.coldTokenOpacity,
  },
  // §5.3: nothing else marks the absence — no outline, no badge, no countdown on the board.
  disconnected: {
    opacity: tokens.art.disconnectedTokenOpacity,
  },
})
