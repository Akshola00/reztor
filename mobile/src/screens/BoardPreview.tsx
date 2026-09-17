import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

import type { LaneSnapshot, MatchConfig, Side } from '../../protocol/generated'
import { Board } from '../art/Board'
import { SEAT_COLOURS, Sigil, type SeatNumber } from '../art/Sigil'
import { tokens } from '../design/tokens'

// Temporary. Deleted at the start of build item 2.
//
// A full-screen board at real size, so the composition can be judged on a device. All lane data
// is hardcoded here and nowhere else. Switching a chip re-renders with new props; no transitions.
//
// The chips sit *below* the board rather than in it. The board has no header slot any more — its
// header is the round, percentage and timer — and keeping the scaffolding off the first screen
// means a screenshot is the real composition, and means the role comparison below is comparing
// the board itself rather than which chip is lit.

const YOU = 'p-you'

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
  {
    key: 'start',
    label: 'start',
    round: 1,
    secondsLeft: 58,
    credits: 1000,
    lanes: [lane(YOU, 0), lane('p-2', 0), lane('p-3', 0), lane('p-4', 0)],
  },
  {
    key: 'mid',
    label: 'mid',
    round: 2,
    secondsLeft: 41,
    credits: 847,
    lanes: [lane(YOU, 300), lane('p-2', 220), lane('p-3', 700), lane('p-4', 172)],
  },
  {
    key: 'late',
    label: 'late',
    round: 3,
    secondsLeft: 12,
    credits: 96,
    lanes: [lane(YOU, 1000), lane('p-2', 150, true), lane('p-3', 640), lane('p-4', 590)],
  },
  {
    key: 'crossed',
    label: 'crossed',
    round: 3,
    secondsLeft: 7,
    credits: 84,
    lanes: [lane(YOU, 1000), lane('p-2', 180, true), lane('p-3', 700), lane('p-4', 620)],
  },
] as const

const ROLES: { key: Side; label: string }[] = [
  // §1.1's vocabulary: the interface says Faithful and Hollow, the wire says crew and impostor.
  { key: 'crew', label: 'Faithful' },
  { key: 'impostor', label: 'Hollow' },
]

const SEATS: SeatNumber[] = [1, 2, 3, 4]

// Temporary capture overrides. When non-null they pin the board, so a screenshot set is a
// controlled comparison. `adb shell input tap` proved unreliable for this: taps were swallowed
// during scroll momentum and landed on neighbouring chips, which produced two mislabelled frames
// in item 1. These are module constants rather than state because Fast Refresh preserves
// component state across edits and would ignore a changed initial value.
//
// Leave both as null: that restores the interactive chips.
const CAPTURE_STATE: string | null = null
const CAPTURE_ROLE: Side | null = null

export function BoardPreview() {
  const { height } = useWindowDimensions()
  const [stateKey, setStateKey] = useState<string>('mid')
  const [role, setRole] = useState<Side>('crew')

  const activeKey = CAPTURE_STATE ?? stateKey
  const activeRole = CAPTURE_ROLE ?? role
  const active = STATES.find((s) => s.key === activeKey) ?? STATES[1]
  const boardTotal = active.lanes.reduce((sum, l) => sum + l.units, 0)

  return (
    <ScrollView>
      {/* The board at real size, so a screenshot is the real composition. */}
      <View style={{ height }}>
        <Board
          lanes={[...active.lanes]}
          boardTotal={boardTotal}
          config={config}
          youId={YOU}
          round={active.round}
          secondsLeft={active.secondsLeft}
          credits={active.credits}
          tier={1}
          role={activeRole}
        />
      </View>

      {/* Scaffolding, below the fold. */}
      <View style={styles.strip}>
        <View style={styles.chipRow}>
          {STATES.map((s) => (
            <Chip key={s.key} label={s.label} selected={s.key === activeKey} onPress={() => setStateKey(s.key)} />
          ))}
        </View>

        {/* Changes only the `role` prop passed into the board. The board must render
            identically for both — see hard rule 4. */}
        <View style={styles.chipRow}>
          {ROLES.map((r) => (
            <Chip key={r.key} label={r.label} selected={r.key === activeRole} onPress={() => setRole(r.key)} />
          ))}
        </View>

        {/* Every sigil at both sizes §5.2 cares about, plus the two token sizes. */}
        <View style={styles.stripRow}>
          {SEATS.map((seat) => (
            <View key={`s${seat}`} style={styles.stripCell}>
              <Sigil seat={seat} colour={SEAT_COLOURS[seat]} size={tokens.art.tokenSigil} />
              <Text style={styles.stripLabel}>{String(seat)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.stripRow}>
          {SEATS.map((seat) => (
            <View key={`l${seat}`} style={styles.stripCell}>
              <Sigil seat={seat} colour={SEAT_COLOURS[seat]} size={tokens.art.sigilLarge} />
              <Text style={styles.stripLabel}>{String(seat)}</Text>
            </View>
          ))}
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
    gap: tokens.art.conduitGap,
  },
  // Stone tones only. Never fire.
  chip: {
    paddingHorizontal: tokens.art.conduitGap,
    height: tokens.layout.minTouchTarget,
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
