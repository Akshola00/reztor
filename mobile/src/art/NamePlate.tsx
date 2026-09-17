import { StyleSheet, Text, View } from 'react-native'

import { tokens } from '../design/tokens'
import { SEAT_COLOURS, Sigil, type Seat4Variant, type SeatNumber } from './Sigil'

// BUILD-PLAN.md §2 cuts the Faithful figures and puts a carved name plate in their slot: the
// sigil in the seat colour, and the name. Nothing here carries fire, and the own-lane bracket
// is drawn by Board so that one bracket encloses the conduit and the plate together.

type NamePlateProps = {
  seat: SeatNumber
  name: string
  width: number
  dormant?: boolean
  seat4Variant?: Seat4Variant
}

export function NamePlate({ seat, name, width, dormant = false, seat4Variant = 'A' }: NamePlateProps) {
  const colour = SEAT_COLOURS[seat]
  return (
    <View style={[styles.plate, { width }]}>
      <Sigil seat={seat} colour={colour} size={tokens.art.namePlateSigil} seat4Variant={seat4Variant} />
      <Text style={[styles.name, dormant && styles.nameDormant]} numberOfLines={1} ellipsizeMode="tail">
        {name}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  plate: {
    height: tokens.art.namePlateHeight,
    borderRadius: tokens.radii.panel,
    alignItems: 'center',
    justifyContent: 'center',
    ...tokens.material.raisedStoneFace,
  },
  name: {
    ...tokens.type.fine,
    color: tokens.palette.bone,
    maxWidth: '100%',
    textAlign: 'center',
  },
  // An ejected player is public information (spec §6), so the plate may say so quietly.
  nameDormant: {
    color: tokens.palette.boneFaint,
  },
})
