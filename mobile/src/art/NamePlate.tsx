import { StyleSheet, Text, View } from 'react-native'

import { tokens } from '../design/tokens'
import { SEAT_COLOURS, Sigil, type SeatNumber } from './Sigil'

// BUILD-PLAN.md §2 cuts the Faithful figures and puts the player's identity in their slot: the
// sigil in the seat colour, and the name.
//
// Inscribed directly onto the stone field — no face, no border, no radius. As a boxed plate it
// put four identical rounded cards in a row across the board, which §4 rules out. Nothing here
// carries fire, and the own-lane bracket is drawn by Board so that one bracket encloses the
// conduit and the inscription together.

type NamePlateProps = {
  seat: SeatNumber
  name: string
  width: number
  dormant?: boolean
}

export function NamePlate({ seat, name, width, dormant = false }: NamePlateProps) {
  return (
    <View style={[styles.inscription, { width }]}>
      <Sigil seat={seat} colour={SEAT_COLOURS[seat]} size={tokens.art.namePlateSigil} />
      <Text style={[styles.name, dormant && styles.nameDormant]} numberOfLines={1} ellipsizeMode="tail">
        {name}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  inscription: {
    alignItems: 'center',
    gap: tokens.art.namePlateGap,
  },
  name: {
    ...tokens.type.label,
    color: tokens.palette.bone,
    maxWidth: '100%',
    textAlign: 'center',
  },
  // An ejected player is public information (spec §6), so the inscription may say so quietly.
  nameDormant: {
    color: tokens.palette.boneFaint,
  },
})
