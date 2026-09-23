import { StyleSheet, View } from 'react-native'

import { tokens } from '../design/tokens'
import { SEAT_COLOURS, Sigil, type SeatNumber } from './Sigil'

// A seat's sigil on a stone disc, standing still: the vote row in Judgement and the Reveal. The
// riding token on the board is the same face in motion (RidingToken).
//
// `cold` is §7.7's cast-out state — the disc at 40% and the sigil in boneFaint — and is public:
// ejection is announced to the room. Nothing here varies by role.

type SeatTokenProps = {
  seat: SeatNumber
  disc: number
  sigil: number
  cold?: boolean
}

export function SeatToken({ seat, disc, sigil, cold = false }: SeatTokenProps) {
  return (
    <View
      style={[
        styles.disc,
        { width: disc, height: disc, borderRadius: disc / 2 },
        cold ? { opacity: tokens.art.coldTokenOpacity } : null,
      ]}
    >
      <Sigil seat={seat} colour={cold ? tokens.palette.boneFaint : SEAT_COLOURS[seat]} size={sigil} />
    </View>
  )
}

const styles = StyleSheet.create({
  disc: {
    ...tokens.material.raisedStoneFace,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
