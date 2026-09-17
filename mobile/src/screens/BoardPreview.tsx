import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

import type { LaneSnapshot, MatchConfig, PlayerSnapshot } from '../../protocol/generated'
import { Board } from '../art/Board'
import type { VesselVariant } from '../art/Heart'
import { SEAT_COLOURS, Sigil, type Seat4Variant, type SeatNumber } from '../art/Sigil'
import { tokens } from '../design/tokens'

// Temporary. Deleted at the start of build item 2.
//
// A full-screen board at real size, so the composition can be judged on a device. All lane data
// is hardcoded here and nowhere else. Switching a chip re-renders with new props; no transitions.

const YOU = 'p-you'

const players: PlayerSnapshot[] = [
  { id: YOU, name: 'Vex', status: 'alive' },
  { id: 'p-2', name: 'Marrow', status: 'alive' },
  { id: 'p-3', name: 'Quillon Ashgrove', status: 'alive' },
  { id: 'p-4', name: 'Tor', status: 'alive' },
]

const config: MatchConfig = {
  laneCapacity: 1000,
  winTarget: 2400,
  tapTiers: { 1: { cost: 1, units: 1 }, 2: { cost: 4, units: 3 } },
  tapRatePerSec: 6,
  siphon: { pull: 10, deliver: 6, costOther: 6, costSelf: 12, ratePerSec: 1 },
  trace: { cost: 200, perPlayer: 1 },
  dormantEfficiencyPct: 50,
  rounds: 3,
  stageDurations: { tap: 60, chat: 45, vote: 15 },
  buyInSkr: 1,
  creditsPerSkr: 1000,
  rakeBps: 500,
  disconnectGraceSec: 30,
  lobbyFillTimeoutSec: 60,
}

const lane = (owner: string, units: number, dormant = false): LaneSnapshot => ({ owner, units, dormant })

// Own lane first. The wire orders lanes by playerId; Board reads ownership from `youId` and
// never reorders, so this order is only the preview's own arrangement.
const STATES = [
  { key: 'start', label: 'start', lanes: [lane(YOU, 0), lane('p-2', 0), lane('p-3', 0), lane('p-4', 0)] },
  { key: 'mid', label: 'mid', lanes: [lane(YOU, 300), lane('p-2', 220), lane('p-3', 700), lane('p-4', 172)] },
  {
    key: 'late',
    label: 'late',
    lanes: [lane(YOU, 1000), lane('p-2', 150, true), lane('p-3', 640), lane('p-4', 590)],
  },
  {
    key: 'crossed',
    label: 'crossed',
    lanes: [lane(YOU, 1000), lane('p-2', 180, true), lane('p-3', 700), lane('p-4', 620)],
  },
] as const

const SEATS: SeatNumber[] = [1, 2, 3, 4]

// Temporary item-1 capture override. When non-null it pins the board to one state with fixed
// display options, so a screenshot set is a controlled comparison. `adb shell input tap` proved
// unreliable for this: taps were swallowed during scroll momentum and landed on neighbouring
// chips, which produced two mislabelled frames and silently changed the vessel and weight
// between captures. These are module constants rather than state because Fast Refresh preserves
// component state across edits and would ignore a changed initial value.
//
// Leave as null: that restores the interactive chips.
const CAPTURE_STATE: string | null = null
const CAPTURE_WEIGHT: 400 | 700 = 400
const CAPTURE_SEAT4: Seat4Variant = 'A'
const CAPTURE_VESSEL: VesselVariant = 'B'

export function BoardPreview() {
  const { height } = useWindowDimensions()
  const [stateKey, setStateKey] = useState<string>('mid')
  const [weight, setWeight] = useState<400 | 700>(400)
  const [seat4Variant, setSeat4Variant] = useState<Seat4Variant>('A')
  const [vessel, setVessel] = useState<VesselVariant>('B')

  const activeKey = CAPTURE_STATE ?? stateKey
  const activeWeight = CAPTURE_STATE ? CAPTURE_WEIGHT : weight
  const activeSeat4 = CAPTURE_STATE ? CAPTURE_SEAT4 : seat4Variant
  const activeVessel = CAPTURE_STATE ? CAPTURE_VESSEL : vessel

  const active = STATES.find((s) => s.key === activeKey) ?? STATES[1]
  const boardTotal = active.lanes.reduce((sum, l) => sum + l.units, 0)

  const header = (
    <View style={styles.chipRow}>
      {STATES.map((s) => (
        <Chip key={s.key} label={s.label} selected={s.key === stateKey} onPress={() => setStateKey(s.key)} />
      ))}
      <Chip label={String(weight)} selected={false} onPress={() => setWeight(weight === 400 ? 700 : 400)} />
      <Chip label={seat4Variant} selected={false} onPress={() => setSeat4Variant(seat4Variant === 'A' ? 'B' : 'A')} />
      <Chip label={vessel} selected={false} onPress={() => setVessel(vessel === 'A' ? 'B' : 'A')} />
    </View>
  )

  return (
    <ScrollView>
      {/* The board at real size, so a screenshot is the real composition. */}
      <View style={{ height }}>
        <Board
          lanes={[...active.lanes]}
          players={players}
          boardTotal={boardTotal}
          config={config}
          youId={YOU}
          header={header}
          heartWeight={activeWeight}
          seat4Variant={activeSeat4}
          vessel={activeVessel}
        />
      </View>

      {/* Below the plinth: every sigil at both sizes, and both seat-4 candidates. */}
      <View style={styles.strip}>
        <View style={styles.stripRow}>
          {SEATS.map((seat) => (
            <View key={`s${seat}`} style={styles.stripCell}>
              <Sigil seat={seat} colour={SEAT_COLOURS[seat]} size={tokens.art.sigilSmall} />
              <Text style={styles.stripLabel}>{String(seat)}</Text>
            </View>
          ))}
          <View style={styles.stripCell}>
            <Sigil seat={4} colour={SEAT_COLOURS[4]} size={tokens.art.sigilSmall} seat4Variant="A" />
            <Text style={styles.stripLabel}>4A</Text>
          </View>
          <View style={styles.stripCell}>
            <Sigil seat={4} colour={SEAT_COLOURS[4]} size={tokens.art.sigilSmall} seat4Variant="B" />
            <Text style={styles.stripLabel}>4B</Text>
          </View>
        </View>

        <View style={styles.stripRow}>
          {SEATS.map((seat) => (
            <View key={`l${seat}`} style={styles.stripCell}>
              <Sigil seat={seat} colour={SEAT_COLOURS[seat]} size={tokens.art.sigilLarge} />
              <Text style={styles.stripLabel}>{String(seat)}</Text>
            </View>
          ))}
          <View style={styles.stripCell}>
            <Sigil seat={4} colour={SEAT_COLOURS[4]} size={tokens.art.sigilLarge} seat4Variant="A" />
            <Text style={styles.stripLabel}>4A</Text>
          </View>
          <View style={styles.stripCell}>
            <Sigil seat={4} colour={SEAT_COLOURS[4]} size={tokens.art.sigilLarge} seat4Variant="B" />
            <Text style={styles.stripLabel}>4B</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected ? styles.chipSelected : null]}>
      <Text style={styles.chipLabel}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: tokens.art.bracketLength / 2,
  },
  // Stone tones only. Never fire.
  chip: {
    paddingHorizontal: tokens.art.conduitGap / 2,
    height: tokens.art.namePlateSigil * 2,
    justifyContent: 'center',
    borderRadius: tokens.radii.chip,
    ...tokens.material.raisedStoneFace,
  },
  chipSelected: {
    ...tokens.material.insetStoneFace,
  },
  chipLabel: {
    ...tokens.type.fine,
    color: tokens.palette.boneDim,
  },
  strip: {
    paddingVertical: tokens.layout.header / 2,
    gap: tokens.layout.header / 2,
  },
  stripRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: tokens.art.conduitGap,
  },
  stripCell: {
    alignItems: 'center',
  },
  stripLabel: {
    ...tokens.type.fine,
    color: tokens.palette.boneFaint,
  },
})
