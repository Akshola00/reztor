import { Redirect, router } from 'expo-router'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'

import type { MatchEndView, PlayerId, Settlement, VoteTarget, WinReason } from '../../protocol/generated'
import { SeatToken } from '../art/SeatToken'
import { SEAT_COLOURS, Sigil, type SeatNumber } from '../art/Sigil'
import { StillBoard } from '../art/StillBoard'
import { tokens } from '../design/tokens'
import { match, session } from '../net/session'
import { explorerTx } from '../solana/chain'

// /reckoning — §7.8's post-mortem. Everything at once: no tabs, no accordions, nothing to open.
// The argument afterwards is half the entertainment, and it needs the whole record in front of it.
//
// Rendered from MATCH_END alone, in §7.8's order: the verdict, the Hollow, the final board, the
// table, the Hollow's line, Augury, the vote history, what is returned, the seed. A section that
// cannot apply to how the rite ended is left out rather than shown empty — no Judgement before the
// first vote, no Augury before the second round — and one that applies but saw nothing says so in
// a sentence.
//
// Payouts and refunds are shown in SKR, the stake's own unit: settlement counts credits, and
// `creditsPerSkr` converts. Credits spent stay in credits, the unit the counter showed all match.

/** PROTOCOL.md §7: one tick is 250ms. */
const TICKS_PER_SEC = 4

// §1.2's voice: conditions, stated. The first line is the verdict in Grenze Gotisch.
const VERDICT: Record<WinReason, [string, string]> = {
  BOARD_TARGET: ['The Heart wakes.', 'The Faithful reached the Threshold. The Faithful prevail.'],
  IMPOSTOR_EJECTED: ['The Hollow is cast out.', 'The Faithful prevail.'],
  IMPOSTOR_TIMED_OUT: ['The Hollow is gone.', 'It left the rite and did not return. The Faithful prevail.'],
  CREW_EJECTED: ['The Heart stays dead.', 'Two of the Faithful are cast out. The Hollow prevails.'],
  ROUNDS_EXHAUSTED: ['The Heart stays dead.', 'The night ends short of the Threshold. The Hollow prevails.'],
}

// §1.1's exact Augury wording.
const READING = {
  natural: 'fed by its own hand',
  received: 'filled from elsewhere',
  drained: 'something was taken',
} as const

type Reckoned = { reveal: MatchEndView; settlement: Settlement; seats: Map<PlayerId, SeatNumber>; youId: PlayerId }

/** Taken once, on mount: Kneel again clears the store, and nothing here may change underneath. */
function readRecord(): Reckoned | null {
  const s = match.snapshot()
  if (s === null || s.end === null || 'error' in s.end) return null
  const { reveal, settlement } = s.end
  // Seats from the board's own lane order, so every sigil here is the one the match showed.
  const order = s.lanes.length > 0 ? s.lanes.map((l) => l.owner) : reveal.players.map((p) => p.id)
  const seats = new Map(order.map((id, i) => [id, (i + 1) as SeatNumber]))
  return { reveal, settlement, seats, youId: s.you.id }
}

/**
 * Kneel again and Leave: home, with the finished seat and its ticket cleared. Leave does not close
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

  // Hardware back returns home, as Kneel again does. There is nothing behind this screen.
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
  const { reveal, settlement, seats, youId } = record
  const names = new Map(reveal.players.map((p) => [p.id, p.name]))
  const ejected = new Set(reveal.players.filter((p) => p.status === 'ejected').map((p) => p.id))
  const seatOf = (id: PlayerId): SeatNumber => seats.get(id) ?? 1
  const nameOf = (id: PlayerId) => names.get(id) ?? ''
  const who = (id: PlayerId) => <Who seat={seatOf(id)} name={nameOf(id)} cold={ejected.has(id)} />

  const { resolution } = reveal
  const [title, line] = resolution.kind === 'won' ? VERDICT[resolution.reason] : ['The rite is broken.', '']
  const hollow = reveal.impostorId
  const { impostor } = reveal
  const config = match.snapshot()?.config
  const perSkr = config?.creditsPerSkr ?? 1

  // Augury opens in round 2 (NO_PREVIOUS_ROUND), so a rite that resolved inside round 1 never
  // offered it. The resolution tick is the tick the last stage closed on, hence the step back.
  const roundTicks = config === undefined ? 0 : sumStages(config.stageDurations) * TICKS_PER_SEC
  const endRound = roundTicks === 0 ? 1 : Math.floor(Math.max(0, resolution.tick - 1) / roundTicks) + 1
  const auguryApplies = reveal.traces.length > 0 || endRound >= 2
  const judgementApplies = reveal.voteHistory.length > 0

  return (
    // The inset sits outside the scroll, so nothing scrolls up under the status bar.
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: tokens.layout.sectionGap, paddingBottom: insets.bottom + tokens.layout.sectionGap },
        ]}
      >
        {/* The verdict and the Hollow sit above the fold. */}
        <View style={styles.group}>
          <Text style={styles.verdict} accessibilityRole="header">
            {title}
          </Text>
          {line === '' ? null : <Text style={styles.body}>{line}</Text>}
        </View>

        <View style={styles.hollow}>
          <HollowMark seat={seatOf(hollow)} cold={ejected.has(hollow)} />
          <Text style={styles.hollowName}>
            {hollow === youId ? 'You were Hollow.' : `${nameOf(hollow)} was Hollow.`}
          </Text>
        </View>

        <StillBoard
          lanes={reveal.players.map((p) => ({ owner: p.id, units: p.finalLane, dormant: p.status === 'ejected' }))}
          seatOf={seatOf}
          youId={youId}
          capacity={config?.laneCapacity ?? reveal.board.capacity / Math.max(1, reveal.players.length)}
          winTarget={reveal.board.winTarget}
        />

        <Section title="Offerings">
          <Table
            headings={['Spent', 'Offered', 'Conduit']}
            rows={reveal.players.map((p) => ({
              key: p.id,
              who: who(p.id),
              cells: [String(p.creditsSpent), String(p.unitsContributed), String(p.finalLane)],
            }))}
          />
        </Section>

        <Section title="The Draw">
          <Text style={styles.body}>
            {impostor.siphons === 0 ? (
              `${nameOf(hollow)} never drew. Nothing was taken from the Heart.`
            ) : (
              <>
                {`${nameOf(hollow)} drew ${impostor.siphons} ${impostor.siphons === 1 ? 'time' : 'times'} and took `}
                <Text style={styles.toll}>{impostor.unitsDestroyed}</Text>
                {' from the Heart. '}
                {impostor.selfSinks === 0
                  ? 'None of those Draws fed their own conduit.'
                  : `Of those, ${impostor.selfSinks} fed their own conduit.`}
              </>
            )}
          </Text>
        </Section>

        {auguryApplies ? (
          <Section title="Augury">
            {reveal.traces.length === 0 ? (
              <Text style={styles.body}>No one sought an Augury.</Text>
            ) : (
              reveal.traces.map((t) => (
                <View key={`${t.purchaser}-${t.tick}`} style={styles.line}>
                  {who(t.purchaser)}
                  <Text style={styles.body}>
                    {`read ${nameOf(t.target)}'s round ${t.round - 1} in round ${t.round}: ${READING[t.result]}.`}
                  </Text>
                </View>
              ))
            )}
          </Section>
        ) : null}

        {judgementApplies ? (
          <Section title="Judgement">
            {reveal.voteHistory.map((r) => (
              <View key={r.round} style={styles.group}>
                <Text style={styles.round}>{`Round ${r.round}`}</Text>
                {/* The server records every player still in the rite, in seat order. */}
                {orderBySeat(Object.keys(r.votes), seatOf).map((voter) => (
                  <Vote key={voter} voter={who(voter)} target={r.votes[voter] ?? 'skip'} whoOf={who} />
                ))}
                <Text style={styles.body}>
                  {r.ejected === null ? 'No one is cast out.' : `${nameOf(r.ejected)} is cast out.`}
                </Text>
              </View>
            ))}
          </Section>
        ) : null}

        <Section title="Returned">
          <Text style={styles.fine}>In SKR.</Text>
          <Table
            headings={['Returned', 'Won']}
            gold
            rows={settlement.lines.map((l) => ({
              key: l.playerId,
              who: who(l.playerId),
              cells: [skr(l.refund, perSkr), skr(l.payout, perSkr)],
            }))}
          />
          {settlement.rakeCredits === 0 ? null : (
            <Text style={styles.body}>
              <Text style={styles.gold}>{skr(settlement.rakeCredits, perSkr)}</Text>
              {' SKR is kept as rake.'}
            </Text>
          )}
          {settlement.dustCredits === 0 ? null : (
            <Text style={styles.body}>
              <Text style={styles.gold}>{skr(settlement.dustCredits, perSkr)}</Text>
              {' SKR could not be divided between the victors and is kept.'}
            </Text>
          )}
          {settled === null || settled.matchId !== reveal.matchId ? null : (
            <View style={styles.paid}>
              <Text style={styles.paidMark}>Paid on-chain.</Text>
              <Pressable
                onPress={() => void Linking.openURL(explorerTx(settled.signature))}
                accessibilityRole="link"
                accessibilityLabel="View the payout transaction in Solana Explorer"
                hitSlop={tokens.layout.stackGap}
              >
                <Text style={styles.link}>View the transaction</Text>
              </Pressable>
            </View>
          )}
        </Section>

        <Section title="The seed">
          <Text style={styles.seed} selectable>
            {reveal.roleSeed}
          </Text>
          <Text style={styles.fine}>The seed chose the Hollow. It can be checked against the assignment.</Text>
        </Section>

        <View style={styles.actions}>
          <Action label="Kneel again" onPress={goHome} />
          <Action label="Leave" onPress={goHome} />
        </View>
      </ScrollView>
    </View>
  )
}

// -------------------------------------------------------------------------------------------------

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.heading} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  )
}

/** A seat's sigil and name. Cold for a player cast out, as their token was on the board. */
function Who({ seat, name, cold }: { seat: SeatNumber; name: string; cold: boolean }) {
  return (
    <View style={styles.who}>
      <Sigil seat={seat} colour={cold ? tokens.palette.boneFaint : SEAT_COLOURS[seat]} />
      <Text style={styles.name} numberOfLines={1}>
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
        <Text style={styles.dim}>withheld</Text>
      ) : (
        <>
          <Text style={styles.dim}>marked</Text>
          {whoOf(target)}
        </>
      )}
    </View>
  )
}

/**
 * Real tabular data: one flex grid for every row, so the columns align, with tabular figures and
 * right-aligned numbers. Not cards.
 */
function Table({
  headings,
  rows,
  gold = false,
}: {
  headings: string[]
  rows: { key: string; who: ReactNode; cells: string[] }[]
  gold?: boolean
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
            <Text
              key={headings[i]}
              style={[styles.cell, gold ? (Number(c) === 0 ? styles.dimColour : styles.gold) : styles.bone]}
            >
              {c}
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
}

/** §7.8: the Hollow's token, marked in toll — the Marking's mark, a square on its point. */
function HollowMark({ seat, cold }: { seat: SeatNumber; cold: boolean }) {
  const size = tokens.art.hollowMarkSize
  const inset = tokens.art.markingMarkStroke
  const mid = size / 2
  const d = `M ${mid} ${inset} L ${size - inset} ${mid} L ${mid} ${size - inset} L ${inset} ${mid} Z`
  return (
    <View style={{ width: size, height: size }} accessibilityLabel="The Hollow's sigil, marked">
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Path d={d} fill="none" stroke={tokens.palette.toll} strokeWidth={tokens.art.markingMarkStroke} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.centre]}>
        <SeatToken seat={seat} disc={tokens.art.voteDisc} sigil={tokens.art.voteSigil} cold={cold} />
      </View>
    </View>
  )
}

export function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.action}>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: tokens.layout.screenGutter,
    gap: tokens.layout.sectionGap,
  },
  group: {
    gap: tokens.layout.stackGap,
  },
  centre: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  verdict: {
    ...tokens.type.display,
    color: tokens.palette.bone,
  },
  hollow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.layout.stackGap,
  },
  // Stretched: shrink-wrapped Grenze Gotisch measures short on Android and clips (item 4).
  hollowName: {
    flex: 1,
    ...tokens.type.stage,
    color: tokens.palette.bone,
  },
  heading: {
    ...tokens.type.stage,
    color: tokens.palette.bone,
  },
  round: {
    ...tokens.type.data,
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
  dim: {
    ...tokens.type.control,
    color: tokens.palette.boneDim,
  },
  // Toll as text: §7.3's `tollText`, which clears 4.5:1 where `toll` does not.
  toll: {
    color: tokens.palette.tollText,
  },
  // Colour only: inside a sentence it takes the sentence's face, inside a table cell the cell's.
  gold: {
    ...tokens.tabularFigures,
    color: tokens.palette.gold,
  },
  dimColour: {
    color: tokens.palette.boneDim,
  },
  bone: {
    color: tokens.palette.bone,
  },
  paid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: tokens.layout.stackGap,
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
    gap: tokens.art.namePlateGap,
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.art.namePlateGap,
    flexShrink: 1,
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
  headRow: {
    minHeight: 0,
    paddingBottom: tokens.art.namePlateGap,
  },
  whoCell: {
    flex: 2,
  },
  cell: {
    flex: 1,
    ...tokens.type.data,
    ...tokens.tabularFigures,
    textAlign: 'right',
  },
  headCell: {
    ...tokens.type.label,
    color: tokens.palette.boneDim,
  },
  seed: {
    ...tokens.type.data,
    fontFamily: tokens.fontFamily.mono,
    color: tokens.palette.bone,
  },
  actions: {
    flexDirection: 'row',
    gap: tokens.layout.stackGap,
  },
  action: {
    flex: 1,
    ...tokens.material.raisedStoneFace,
    borderRadius: tokens.radii.chip,
    minHeight: tokens.layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    ...tokens.type.control,
    color: tokens.palette.bone,
  },
})
