import * as Clipboard from 'expo-clipboard'
import { Redirect, router } from 'expo-router'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'

import type { MatchEndView, PlayerId, Settlement, Side, VoteTarget, WinReason } from '../../protocol/generated'
import { SeatToken } from '../art/SeatToken'
import { SEAT_TEXT_COLOURS, Sigil, type SeatNumber } from '../art/Sigil'
import { StillBoard } from '../art/StillBoard'
import { motion } from '../design/motion'
import { tokens } from '../design/tokens'
import { match, session } from '../net/session'
import { explorerTx } from '../solana/chain'
import { useLook } from './look'

// /reckoning — the results screen, rebuilt in part 3 of the owner's UI pass: "this is not a school
// PDF, it's supposed to be a game". It is the last thing a judge sees, and the screen where the
// chain shows a number, so it leads with the player's own outcome and puts the money fourth, not
// last:
//
//   1. the outcome — did you win or lose, and your payout in gold (a loss in toll), legible at arm's
//      length;
//   2. the verdict and the Hollow, in its toll diamond;
//   3. the final board;
//   4. the money — what each player was returned and won, and the on-chain transaction;
//   5. the per-player taps, as a table with a gold bar under each tapped figure;
//   6. Drain and Inspect, as stat blocks;
//   7. the vote history, behind a disclosure;
//   8. the seed, one line with a copy control.
//
// Rendered from MATCH_END alone. A section that cannot apply to how the rite ended is left out —
// no vote history before the first vote, no Inspect before the second round.
//
// Payouts and refunds are shown in SKR, the stake's own unit: settlement counts credits, and
// `creditsPerSkr` converts. Energy spent stays in energy, the unit the readout showed all match.
//
// Gold is value here and nowhere else: the payout, the Won column, the winners' names, the bars,
// and the outcome on a win. Headings stay bone, so gold keeps meaning something.

/** PROTOCOL.md §7: one tick is 250ms. */
const TICKS_PER_SEC = 4

// The headline keeps the fiction (§1.1); the line under it says it plainly.
const VERDICT: Record<WinReason, [string, string]> = {
  BOARD_TARGET: ['The Heart wakes.', 'The Faithful reached the target.'],
  IMPOSTOR_EJECTED: ['The Hollow is voted out.', 'The Faithful found the Hollow.'],
  IMPOSTOR_TIMED_OUT: ['The Hollow is gone.', 'It left the match and did not come back.'],
  CREW_EJECTED: ['The Heart stays dead.', 'Two of the Faithful were voted out.'],
  ROUNDS_EXHAUSTED: ['The Heart stays dead.', 'The night ended short of the target.'],
}

// The outcome, for this player: four cases, by side and by result.
const OUTCOME: Record<Side, { won: string; lost: string }> = {
  crew: {
    won: 'You were Faithful, and the Faithful prevailed.',
    lost: 'You were Faithful. The Hollow got away with it.',
  },
  impostor: {
    won: 'You were the Hollow, and they never caught you.',
    lost: 'You were the Hollow, and the Faithful prevailed.',
  },
}

// §1.1's exact Inspect wording.
const READING = {
  natural: 'Filled by their own taps',
  received: 'Received from another lane',
  drained: 'Drained by someone',
} as const

type Reckoned = {
  reveal: MatchEndView
  settlement: Settlement
  seats: Map<PlayerId, SeatNumber>
  youId: PlayerId
  buyInSkr: number
  perSkr: number
  capacity: number | undefined
}

/** Taken once, on mount: Play again clears the store, and nothing here may change underneath. */
function readRecord(): Reckoned | null {
  const s = match.snapshot()
  if (s === null || s.end === null || 'error' in s.end) return null
  const { reveal, settlement } = s.end
  // Seats from the board's own lane order, so every mask here is the one the match showed.
  const order = s.lanes.length > 0 ? s.lanes.map((l) => l.owner) : reveal.players.map((p) => p.id)
  const seats = new Map(order.map((id, i) => [id, (i + 1) as SeatNumber]))
  return {
    reveal,
    settlement,
    seats,
    youId: s.you.id,
    buyInSkr: s.config.buyInSkr,
    perSkr: s.config.creditsPerSkr,
    capacity: s.config.laneCapacity,
  }
}

/**
 * Play again and Leave: home, with the finished seat and its ticket cleared. Leave does not close
 * the app — closing it after a screen about someone's money reads as a crash. Shared with the
 * broken screen.
 */
export function goHome() {
  // The seat is finished and its ticket already cleared at MATCH_END; leave() clears the rest.
  session.leave()
  router.replace('/')
}

export function Reckoning() {
  const insets = useSafeAreaInsets()
  const [record] = useState(readRecord)
  // SETTLEMENT_CONFIRMED lands a few seconds after MATCH_END, usually while this screen is open.
  const settled = useSyncExternalStore(session.onSettled, session.settled)
  const [votesOpen, setVotesOpen] = useState(false)

  // Hardware back returns home, as Play again does. There is nothing behind this screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goHome()
      return true
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (__DEV__ && record !== null && record.reveal.resolution.kind === 'won') {
      console.log('[ui] reckoning', record.reveal.resolution.reason)
    }
  }, [record])

  if (record === null) return <Redirect href="/" />
  const { reveal, settlement, seats, youId, buyInSkr, perSkr, capacity } = record
  const names = new Map(reveal.players.map((p) => [p.id, p.name]))
  const ejected = new Set(reveal.players.filter((p) => p.status === 'ejected').map((p) => p.id))
  const winners = new Set(settlement.winners)
  const seatOf = (id: PlayerId): SeatNumber => seats.get(id) ?? 1
  const nameOf = (id: PlayerId) => names.get(id) ?? ''
  const who = (id: PlayerId, gold = false) => (
    <Who seat={seatOf(id)} name={nameOf(id)} cold={ejected.has(id)} own={id === youId} gold={gold} />
  )

  const { resolution } = reveal
  // Voided rites go to the broken screen, so a resolution here has a winner.
  const [title, line] = resolution.kind === 'won' ? VERDICT[resolution.reason] : ['The rite is broken.', '']
  const hollow = reveal.impostorId
  const { impostor } = reveal
  const side: Side = youId === hollow ? 'impostor' : 'crew'
  const won = resolution.kind === 'won' && resolution.winner === side
  const mine = settlement.lines.find((l) => l.playerId === youId)
  const received = mine === undefined ? 0 : mine.refund + mine.payout

  // Inspect opens in round 2 (NO_PREVIOUS_ROUND), so a rite that resolved inside round 1 never
  // offered it. The resolution tick is the tick the last stage closed on, hence the step back.
  const config = match.snapshot()?.config
  const roundTicks = config === undefined ? 0 : sumStages(config.stageDurations) * TICKS_PER_SEC
  const endRound = roundTicks === 0 ? 1 : Math.floor(Math.max(0, resolution.tick - 1) / roundTicks) + 1
  const inspectApplies = reveal.traces.length > 0 || endRound >= 2
  const votesApply = reveal.voteHistory.length > 0
  const mostTapped = Math.max(1, ...reveal.players.map((p) => p.unitsContributed))

  return (
    // The inset sits outside the scroll, so nothing scrolls up under the status bar.
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: tokens.space.xl, paddingBottom: insets.bottom + tokens.space.xl },
        ]}
      >
        {/* 1. The outcome. */}
        <Enter beat={0}>
          <Outcome
            won={won}
            sentence={OUTCOME[side][won ? 'won' : 'lost']}
            received={skr(received, perSkr)}
            net={skr(Math.abs(received - buyInSkr * perSkr), perSkr)}
            stake={String(buyInSkr)}
            refund={skr(mine?.refund ?? 0, perSkr)}
          />
        </Enter>

        {/* 2. The verdict and the Hollow. */}
        <Enter beat={1}>
          <View style={styles.group}>
            <View style={styles.tight}>
              <Text style={styles.verdict} accessibilityRole="header">
                {title}
              </Text>
              {line === '' ? null : <Text style={styles.body}>{line}</Text>}
            </View>
            <View style={styles.hollow}>
              <HollowMark seat={seatOf(hollow)} cold={ejected.has(hollow)} />
              <Text style={styles.hollowName}>
                {hollow === youId ? 'You were the Hollow.' : `${nameOf(hollow)} was the Hollow.`}
              </Text>
            </View>
          </View>
        </Enter>

        {/* 3. The final board. */}
        <Enter beat={2}>
          <StillBoard
            lanes={reveal.players.map((p) => ({ owner: p.id, units: p.finalLane, dormant: p.status === 'ejected' }))}
            seatOf={seatOf}
            youId={youId}
            capacity={capacity ?? reveal.board.capacity / Math.max(1, reveal.players.length)}
            winTarget={reveal.board.winTarget}
          />
        </Enter>

        <Enter beat={3}>
          <View style={styles.sections}>
            {/* 4. The money. */}
            <Section title="Paid out" note="In SKR.">
              <Table
                headings={['Returned', 'Won']}
                rows={settlement.lines.map((l) => ({
                  key: l.playerId,
                  who: who(l.playerId, winners.has(l.playerId)),
                  cells: [
                    { text: skr(l.refund, perSkr), tone: l.refund === 0 ? 'dim' : 'bone' },
                    { text: skr(l.payout, perSkr), tone: l.payout === 0 ? 'dim' : 'gold' },
                  ],
                }))}
              />
              {settlement.rakeCredits === 0 ? null : (
                <Text
                  style={styles.fine}
                >{`${skr(settlement.rakeCredits, perSkr)} SKR is kept as the house fee.`}</Text>
              )}
              {settlement.dustCredits === 0 ? null : (
                <Text style={styles.fine}>
                  {`${skr(settlement.dustCredits, perSkr)} SKR left over after the split is kept.`}
                </Text>
              )}
              {settled === null || settled.matchId !== reveal.matchId ? null : (
                <View style={styles.paid}>
                  <Text style={styles.paidMark}>Paid on-chain.</Text>
                  <Pressable
                    onPress={() => void Linking.openURL(explorerTx(settled.signature))}
                    accessibilityRole="link"
                    accessibilityLabel="View the payout transaction in Solana Explorer"
                    hitSlop={tokens.space.md}
                  >
                    <Text style={styles.link}>View the transaction</Text>
                  </Pressable>
                </View>
              )}
            </Section>

            {/* 5. The taps. */}
            <Section title="Taps">
              <Table
                headings={['Spent', 'Tapped', 'Final lane']}
                barColumn={1}
                rows={reveal.players.map((p) => ({
                  key: p.id,
                  who: who(p.id),
                  bar: p.unitsContributed / mostTapped,
                  cells: [
                    { text: String(p.creditsSpent), tone: 'bone' },
                    { text: String(p.unitsContributed), tone: 'bone' },
                    { text: String(p.finalLane), tone: 'bone' },
                  ],
                }))}
              />
            </Section>

            {/* 6. Drain and Inspect. */}
            <Section title="Drain">
              {impostor.siphons === 0 ? (
                <Text style={styles.body}>{`${nameOf(hollow)} never drained. Nothing was destroyed.`}</Text>
              ) : (
                <View style={styles.stats}>
                  <Stat figure={String(impostor.siphons)} label={impostor.siphons === 1 ? 'drain' : 'drains'} />
                  <Stat figure={String(impostor.unitsDestroyed)} label="progress destroyed" toll />
                  <Stat figure={String(impostor.selfSinks)} label="into their own lane" />
                </View>
              )}
            </Section>

            {inspectApplies ? (
              <Section title="Inspect">
                {reveal.traces.length === 0 ? (
                  <Text style={styles.body}>No one inspected a lane.</Text>
                ) : (
                  reveal.traces.map((t) => (
                    <View key={`${t.purchaser}-${t.tick}`} style={styles.inspect}>
                      <View style={styles.line}>
                        {who(t.purchaser)}
                        <Text style={styles.dim}>inspected</Text>
                        {who(t.target)}
                      </View>
                      <Text style={styles.reading}>{`${READING[t.result]}, round ${t.round - 1}`}</Text>
                    </View>
                  ))
                )}
              </Section>
            ) : null}

            {/* 7. The vote history, behind a disclosure. */}
            {votesApply ? (
              <View style={styles.group}>
                <Disclosure
                  open={votesOpen}
                  label={votesOpen ? 'Hide vote history' : 'See full vote history'}
                  onPress={() => setVotesOpen(!votesOpen)}
                />
                {votesOpen
                  ? reveal.voteHistory.map((r) => (
                      <View key={r.round} style={styles.group}>
                        <Text style={styles.round}>{`Round ${r.round}`}</Text>
                        {/* The server records every player still in the rite, in seat order. */}
                        {orderBySeat(Object.keys(r.votes), seatOf).map((voter) => (
                          <Vote key={voter} voter={who(voter)} target={r.votes[voter] ?? 'skip'} whoOf={who} />
                        ))}
                        <Text style={styles.body}>
                          {r.ejected === null ? 'No one is voted out.' : `${nameOf(r.ejected)} is voted out.`}
                        </Text>
                      </View>
                    ))
                  : null}
              </View>
            ) : null}

            {/* 8. The seed. */}
            <Seed seed={reveal.roleSeed} />

            <View style={styles.actions}>
              <Action label="Play again" onPress={goHome} primary />
              <Action label="Leave" onPress={goHome} />
            </View>
          </View>
        </Enter>
      </ScrollView>
    </View>
  )
}

// -------------------------------------------------------------------------------------------------

/**
 * One beat of the entrance: rises and fades in, `resultsStagger` after the beat before it. Plays
 * once, on mount — never on scroll. Transform and opacity only. Shared with the broken screen.
 */
export function Enter({ beat, children }: { beat: number; children: ReactNode }) {
  const shown = useSharedValue(0)
  useEffect(() => {
    shown.set(withDelay(beat * motion.duration.resultsStagger, withTiming(1, motion.transition.resultsEnter)))
  }, [beat, shown])
  const style = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: (1 - shown.get()) * tokens.space.lg }],
  }))
  return <Animated.View style={style}>{children}</Animated.View>
}

/**
 * This player's outcome, first and largest. A win: what was paid to their wallet, in gold. A loss:
 * what the match cost them, in toll, and what came back.
 */
function Outcome({
  won,
  sentence,
  received,
  net,
  stake,
  refund,
}: {
  won: boolean
  sentence: string
  received: string
  net: string
  stake: string
  refund: string
}) {
  const colour = won ? tokens.palette.gold : tokens.palette.tollText
  return (
    <View style={styles.outcome} accessibilityRole="header">
      <Text style={[styles.outcomeTitle, { color: colour }]}>{won ? 'You won' : 'You lost'}</Text>
      <Text style={styles.outcomeLine}>{sentence}</Text>
      <View
        style={styles.amountRow}
        accessible
        accessibilityLabel={won ? `${received} SKR paid to you` : `${net} SKR lost`}
      >
        {/* A loss that cost nothing — every unspent unit came back — carries no minus sign. */}
        <Text style={[styles.amount, { color: colour }]}>
          {won || Number(net) === 0 ? (won ? received : net) : `−${net}`}
        </Text>
        <Text style={[styles.amountUnit, { color: colour }]}>SKR</Text>
      </View>
      <Text style={styles.fine}>
        {won ? `Paid to your wallet, on a ${stake} SKR stake.` : `${refund} of your ${stake} SKR stake came back.`}
      </Text>
    </View>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <View style={styles.headingRow}>
        <Text style={styles.heading} accessibilityRole="header">
          {title}
        </Text>
        {note === undefined ? null : <Text style={styles.fine}>{note}</Text>}
      </View>
      {children}
    </View>
  )
}

/** A figure, large, over its label, small. */
function Stat({ figure, label, toll = false }: { figure: string; label: string; toll?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statFigure, toll ? styles.toll : null]}>{figure}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

/**
 * A seat's mask and name. Cold for a player voted out, as their token was on the board; ringed for
 * this player's own row, the way the board rings their own token; the name in gold for a winner.
 */
function Who({
  seat,
  name,
  cold,
  own,
  gold,
}: {
  seat: SeatNumber
  name: string
  cold: boolean
  own: boolean
  gold: boolean
}) {
  return (
    <View style={styles.who}>
      <View style={[styles.whoMask, own ? styles.whoOwn : null]}>
        <Sigil seat={seat} colour={cold ? tokens.palette.boneFaint : SEAT_TEXT_COLOURS[seat]} />
      </View>
      <Text style={[styles.name, gold ? styles.goldText : null]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  )
}

function Vote({ voter, target, whoOf }: { voter: ReactNode; target: VoteTarget; whoOf: (id: PlayerId) => ReactNode }) {
  return (
    <View style={styles.line}>
      {voter}
      {target === 'skip' ? (
        <Text style={styles.dim}>skipped</Text>
      ) : (
        <>
          <Text style={styles.dim}>voted for</Text>
          {whoOf(target)}
        </>
      )}
    </View>
  )
}

type Cell = { text: string; tone: 'bone' | 'gold' | 'dim' }

/**
 * Real tabular data: one flex grid for every row, so the columns align, with tabular figures and
 * right-aligned numbers. Not cards. `barColumn` draws a thin gold bar under that column's figure,
 * its width the row's `bar` share of the largest, so the column reads as a chart at a glance.
 */
function Table({
  headings,
  rows,
  barColumn,
}: {
  headings: string[]
  rows: { key: string; who: ReactNode; cells: Cell[]; bar?: number }[]
  barColumn?: number
}) {
  return (
    <View>
      <View style={[styles.row, styles.headRow]}>
        <View style={styles.whoCell} />
        {headings.map((h) => (
          <Text key={h} style={[styles.cell, styles.headCell]}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((r) => (
        <View key={r.key} style={styles.row}>
          <View style={styles.whoCell}>{r.who}</View>
          {r.cells.map((c, i) => (
            <View key={headings[i]} style={styles.cellBox}>
              <Text style={[styles.cell, TONE[c.tone]]}>{c.text}</Text>
              {i === barColumn && r.bar !== undefined ? (
                <View style={styles.barTrack}>
                  <View style={[styles.bar, { width: `${Math.round(r.bar * 100)}%` }]} />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

/** A control that opens a block in place. Its label is the whole instruction — no arrow. */
function Disclosure({ open, label, onPress }: { open: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      style={styles.disclosure}
    >
      <Text style={styles.disclosureLabel}>{label}</Text>
    </Pressable>
  )
}

/**
 * The role seed: one line, cut in the middle, that opens to the full value in place; a copy
 * control beside it; and one line of why it matters. It is what makes the assignment checkable.
 */
function Seed({ seed }: { seed: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const n = tokens.art.seedPreviewChars
  const preview = seed.length > n * 2 + 1 ? `${seed.slice(0, n)}…${seed.slice(-n)}` : seed
  return (
    <View style={styles.group}>
      <Text style={styles.heading} accessibilityRole="header">
        The seed
      </Text>
      <View style={styles.seedRow}>
        <Pressable
          onPress={() => setOpen(!open)}
          accessibilityRole="button"
          accessibilityLabel={open ? 'Hide the full seed' : 'Show the full seed'}
          accessibilityState={{ expanded: open }}
          style={styles.seedValue}
        >
          <Text style={styles.seed} selectable={open}>
            {open ? seed : preview}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void Clipboard.setStringAsync(seed).then(() => setCopied(true))
          }}
          accessibilityRole="button"
          accessibilityLabel="Copy the seed"
          style={styles.copy}
        >
          <Text style={styles.copyLabel}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      </View>
      <Text style={styles.fine}>This seed picked the Hollow at random. Anyone can verify it.</Text>
    </View>
  )
}

function sumStages(d: { tap: number; chat: number; vote: number }) {
  return d.tap + d.chat + d.vote
}

function orderBySeat(ids: PlayerId[], seatOf: (id: PlayerId) => SeatNumber) {
  return [...ids].sort((a, b) => seatOf(a) - seatOf(b))
}

/** Credits as SKR, at the precision `creditsPerSkr` allows, so a column of them aligns. */
export function skr(credits: number, perSkr: number): string {
  const decimals = Math.max(0, Math.round(Math.log10(perSkr)))
  return (credits / perSkr).toFixed(decimals)
}

/** §7.8: the Hollow's token, marked in toll — the Marking's mark, a square on its point. */
function HollowMark({ seat, cold }: { seat: SeatNumber; cold: boolean }) {
  const size = tokens.art.hollowMarkSize
  const inset = tokens.art.markingMarkStroke
  const mid = size / 2
  const d = `M ${mid} ${inset} L ${size - inset} ${mid} L ${mid} ${size - inset} L ${inset} ${mid} Z`
  return (
    <View style={{ width: size, height: size }} accessibilityLabel="The Hollow's mask, marked">
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Path d={d} fill="none" stroke={tokens.palette.toll} strokeWidth={tokens.art.markingMarkStroke} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.centre]}>
        <SeatToken seat={seat} disc={tokens.art.voteDisc} sigil={tokens.art.voteSigil} cold={cold} />
      </View>
    </View>
  )
}

/**
 * The screen's two actions. Play again is the primary — the home screen's primary face, the one
 * the owner chose — and Leave is a plain stone secondary. Shared with the broken screen.
 */
export function Action({ label, onPress, primary = false }: { label: string; onPress: () => void; primary?: boolean }) {
  const { primary: face } = useLook()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.action, primary ? tokens.homeFaces.primary[face] : tokens.homeFaces.secondary]}
    >
      <Text style={[styles.actionLabel, primary ? { color: tokens.homeFaces.primaryLabel[face] } : null]}>{label}</Text>
    </Pressable>
  )
}

const TONE = {
  bone: { color: tokens.palette.bone },
  gold: { color: tokens.palette.gold },
  dim: { color: tokens.palette.boneDim },
} as const

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  // Every block on the screen is `xxl` from the next; inside a block, `md`; inside a pair that
  // reads as one line of thought (a title and its line), `xs`.
  content: {
    paddingHorizontal: tokens.space.lg,
    gap: tokens.space.xxl,
  },
  sections: {
    gap: tokens.space.xxl,
  },
  group: {
    gap: tokens.space.md,
  },
  tight: {
    gap: tokens.space.xs,
  },
  centre: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  outcome: {
    alignItems: 'center',
    gap: tokens.space.xs,
  },
  // Stretched: shrink-wrapped Grenze Gotisch measures short on Android and clips (item 4) — "You
  // won" drew as "You" on the emulator.
  outcomeTitle: {
    alignSelf: 'stretch',
    ...tokens.type.display,
    textAlign: 'center',
  },
  outcomeLine: {
    alignSelf: 'stretch',
    ...tokens.type.body,
    color: tokens.palette.bone,
    textAlign: 'center',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: tokens.space.sm,
    marginTop: tokens.space.sm,
  },
  // The payout at the board percentage's step and face: the other number that must read at a
  // glance.
  amount: {
    ...tokens.type.heart,
  },
  amountUnit: {
    ...tokens.type.stage,
  },
  verdict: {
    ...tokens.type.stage,
    color: tokens.palette.bone,
  },
  hollow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.md,
  },
  // Stretched: shrink-wrapped Grenze Gotisch measures short on Android and clips (item 4).
  hollowName: {
    flex: 1,
    ...tokens.type.stage,
    color: tokens.palette.bone,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  heading: {
    ...tokens.type.stage,
    color: tokens.palette.bone,
  },
  round: {
    ...tokens.type.label,
    ...tokens.tabularFigures,
    color: tokens.palette.boneDim,
  },
  body: {
    ...tokens.type.body,
    color: tokens.palette.bone,
  },
  fine: {
    ...tokens.type.fine,
    color: tokens.palette.boneDim,
  },
  // The connecting words in a line ("voted for", "inspected") are the line's running text, so they
  // are in the sans. Set in Grenze Gotisch, Android measured "voted for" short and dropped "for".
  dim: {
    ...tokens.type.body,
    color: tokens.palette.boneDim,
  },
  // Toll as text: §7.3's `tollText`, which clears 4.5:1 where `toll` does not.
  toll: {
    color: tokens.palette.tollText,
  },
  goldText: {
    color: tokens.palette.gold,
  },
  stats: {
    flexDirection: 'row',
    gap: tokens.space.md,
  },
  stat: {
    flex: 1,
    gap: tokens.space.xs,
  },
  statFigure: {
    ...tokens.type.display,
    ...tokens.tabularFigures,
    color: tokens.palette.bone,
  },
  statLabel: {
    ...tokens.type.label,
    color: tokens.palette.boneDim,
  },
  inspect: {
    gap: tokens.space.xs,
  },
  reading: {
    ...tokens.type.body,
    color: tokens.palette.bone,
  },
  paid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: tokens.space.md,
  },
  paidMark: {
    ...tokens.type.label,
    color: tokens.palette.gold,
  },
  link: {
    ...tokens.type.control,
    color: tokens.palette.bone,
    textDecorationLine: 'underline',
  },
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.space.sm,
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    flexShrink: 1,
  },
  // The mask's slot is the same with or without the own ring, so names in a column align.
  whoMask: {
    width: tokens.art.sigilSmall + (tokens.space.xs + tokens.art.tokenRing) * 2,
    height: tokens.art.sigilSmall + (tokens.space.xs + tokens.art.tokenRing) * 2,
    borderRadius: tokens.art.sigilSmall,
    borderWidth: tokens.art.tokenRing,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // §6.1's own-lane mark, carried into the table: boneDim, never fire, never a seat colour.
  whoOwn: {
    borderColor: tokens.palette.boneDim,
  },
  name: {
    ...tokens.type.control,
    color: tokens.palette.bone,
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: tokens.layout.minTouchTarget,
    borderBottomWidth: 1,
    borderBottomColor: tokens.palette.stoneEdge,
  },
  // The heading row sits on its rule with the same breathing room a figure has in its row.
  headRow: {
    minHeight: 0,
    paddingBottom: tokens.space.sm,
  },
  whoCell: {
    flex: 2,
  },
  cellBox: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  cell: {
    ...tokens.type.data,
    ...tokens.tabularFigures,
    textAlign: 'right',
  },
  headCell: {
    flex: 1,
    ...tokens.type.label,
    color: tokens.palette.boneDim,
  },
  // Pinned under the figure, right-aligned like it, so the bar grows out from the number and the
  // figure stays centred in its row like every other.
  barTrack: {
    position: 'absolute',
    left: tokens.space.sm,
    right: 0,
    bottom: tokens.space.sm,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  bar: {
    height: tokens.art.resultsBarHeight,
    backgroundColor: tokens.palette.gold,
  },
  disclosure: {
    ...tokens.homeFaces.secondary,
    minHeight: tokens.layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disclosureLabel: {
    ...tokens.type.control,
    color: tokens.palette.bone,
  },
  seedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.md,
  },
  seedValue: {
    flex: 1,
  },
  seed: {
    ...tokens.type.data,
    fontFamily: tokens.fontFamily.mono,
    color: tokens.palette.bone,
  },
  copy: {
    ...tokens.homeFaces.secondary,
    minHeight: tokens.layout.minTouchTarget,
    paddingHorizontal: tokens.space.lg,
    justifyContent: 'center',
  },
  copyLabel: {
    ...tokens.type.control,
    color: tokens.palette.bone,
  },
  actions: {
    flexDirection: 'row',
    gap: tokens.space.md,
  },
  action: {
    flex: 1,
    minHeight: tokens.layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    ...tokens.type.control,
    color: tokens.palette.bone,
  },
})
