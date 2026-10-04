import { Redirect, router } from 'expo-router'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { DissolveReason, LobbyUpdateMessage } from '../../protocol/generated'
import { SeatToken } from '../art/SeatToken'
import type { SeatNumber } from '../art/Sigil'
import { tokens } from '../design/tokens'
import { match, session, type FundingState } from '../net/session'
import { classifyStakeError, signAndSendStake, type StakeFailure } from '../solana/buyIn'
import { BUY_IN_SKR } from '../solana/chain'

// /lobby/[code] — the Gathering. The code large enough to read aloud across a room, the four
// seats as LOBBY_UPDATE reports them, the dissolve timer, and a way out.
//
// The ticket's JOIN was already sent the moment it arrived (PROTOCOL.md §2), and the server
// answers it with the roster, so there is nothing to press here. MATCH_STARTED arrives unprompted
// when the fourth player joins, and this screen moves to /match on it.
//
// The roster can shrink as well as grow: a seat is freed about 21s after its player's last sign of
// life, and everyone after it moves up a seat. Rows are keyed by seat, never by player, so a
// shrink changes what four rows say rather than remounting them.
//
// With chain escrow, a full lobby does not start: it funds (CHAIN-PROTOCOL-CHANGES.md §3). Each seat
// gets a STAKE_REQUEST to sign in its wallet, the rows mark who has paid, and the fill timer gives
// way to the stake deadline. MATCH_STARTED still moves this screen to /match.

/** How often the countdown re-renders. Outside a match this is cheap, and it keeps the second exact. */
const COUNTDOWN_REFRESH_MS = 250

/** The sigils run out at four; so does the lobby. */
const SEATS: SeatNumber[] = [1, 2, 3, 4]

/** Your own disc's ring sits outside it, as on the board's riding token. */
const RING = tokens.art.voteDisc + tokens.art.tokenRing * 2

const DISSOLVED_NOTICE: Record<DissolveReason, string> = {
  TIMEOUT: 'dissolvedTimeout',
  ESCROW_FAILED: 'dissolvedEscrow',
  STAKE_TIMEOUT: 'dissolvedStake',
}

/**
 * After the wallet sends, the server sees the payment within about 2s of confirmation. Past this,
 * the stake has probably not landed and the player may sign the newest transaction instead. A
 * second signature for a seat that did pay fails on chain (AlreadyJoined) and costs nothing.
 */
const STAKE_LANDING_MS = 20_000

// Solflare reports an expired blockhash to the app as a cancel, so `declined` cannot promise the
// player declined; it says only what is certain.
const STAKE_FAILED: Record<StakeFailure | 'unavailable', string> = {
  declined: 'Your wallet did not send the stake. Nothing was taken. Stake again, and approve it promptly.',
  stale:
    'The stake expired in your wallet before it was sent. Nothing was taken. Stake again, and approve it promptly.',
  other: 'Your wallet could not send the stake. Nothing was taken. Stake again.',
  unavailable: 'The server did not prepare your stake. Stake again.',
}

// §1.2: waiting states are instructions, not mood.
const KNEELING = [
  'Taking your seat.',
  'One kneels. Three seats are empty.',
  'Two kneel. Two seats are empty.',
  'Three kneel. One seat is empty.',
  'Four kneel. The rite begins.',
]

function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * PROTOCOL.md §2: `expiresAt - serverNow`, less what has passed on this phone since arrival. The
 * device clock is only ever compared with itself.
 */
function secondsLeft(deadline: { expiresAt: number; serverNow: number }, receivedAtMs: number, nowMs: number): number {
  return (deadline.expiresAt - deadline.serverNow - (nowMs - receivedAtMs)) / 1000
}

export function Lobby() {
  const ticket = session.ticket()
  if (ticket === null) return <Redirect href="/" />
  return <Gathering code={ticket.code} you={ticket.playerId} />
}

function Gathering({ code, you }: { code: string; you: string }) {
  const insets = useSafeAreaInsets()
  // The roster may have arrived before mount: the JOIN is sent before the route changes.
  const lobby = useSyncExternalStore(session.onLobby, session.lobby)
  const funding = useSyncExternalStore(session.onFunding, session.funding)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), COUNTDOWN_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const home = (notice: string) => {
      session.leave()
      router.replace({ pathname: '/', params: { notice } })
    }
    const toMatch = () => router.replace('/match')
    // It may have started before this screen mounted — the fourth player's own JOIN starts it.
    if (match.snapshot() !== null) toMatch()
    const offStarted = session.onStarted(toMatch)
    const offDissolved = session.onDissolved((reason) => home(DISSOLVED_NOTICE[reason]))
    // A JOIN refused on return: the lobby dissolved or freed this seat while the phone was away.
    const offLost = session.onLost(() => home('seatLost'))
    return () => {
      offStarted()
      offDissolved()
      offLost()
    }
  }, [])

  const leave = () => {
    session.leave()
    router.replace('/')
  }

  // Hardware back on the lobby is the Leave control: nothing is at stake before the rite begins.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      session.leave()
      router.replace('/')
      return true
    })
    return () => sub.remove()
  }, [])

  const players = lobby?.update.players ?? []
  const remaining = lobby === null || funding !== null ? null : secondsLeft(lobby.update, lobby.receivedAtMs, now)
  const ownSeat = players.find((p) => p.id === you)?.seated ?? null

  return (
    <View style={[styles.root, { paddingTop: insets.top + tokens.layout.sectionGap, paddingBottom: insets.bottom }]}>
      <View style={styles.centre}>
        <Text style={styles.label}>The gathering</Text>
        <Text style={styles.code} accessibilityLabel={`Gathering code ${code.split('').join(' ')}`}>
          {code}
        </Text>
        <Text style={styles.line}>Read the code aloud. The rite begins when four kneel.</Text>

        <View style={styles.seats}>
          {SEATS.map((seat) => (
            <SeatRow
              key={seat}
              seat={seat}
              player={players[seat - 1]}
              you={you}
              staked={funding === null ? null : funding.staked.includes(seat)}
            />
          ))}
        </View>

        {funding === null ? (
          <Text style={styles.line} accessibilityLiveRegion="polite">
            {lobby === null ? KNEELING[0] : KNEELING[Math.min(players.length, SEATS.length)]}
          </Text>
        ) : (
          <Funding funding={funding} ownSeat={ownSeat} now={now} />
        )}
        {remaining === null ? null : (
          <Text style={[styles.line, styles.timer]}>
            {remaining > 0 ? `The gathering dissolves in ${clock(remaining)}.` : 'The time to gather has run out.'}
          </Text>
        )}
      </View>

      <Pressable
        onPress={leave}
        accessibilityRole="button"
        accessibilityLabel="Leave the gathering"
        style={styles.leave}
      >
        <Text style={styles.leaveLabel}>Leave</Text>
      </Pressable>
    </View>
  )
}

/**
 * The funding stage: the deadline, and this seat's stake. The wallet hands off to another app and
 * back, so the socket may drop and rejoin meanwhile — and every JOIN brings a fresh STAKE_REQUEST.
 * The phase, not the newest request, decides what is shown.
 */
function Funding({ funding, ownSeat, now }: { funding: FundingState; ownSeat: number | null; now: number }) {
  type Phase =
    | { kind: 'ready' }
    | { kind: 'signing' }
    | { kind: 'sent'; atMs: number }
    | { kind: 'failed'; why: StakeFailure | 'unavailable' }
  const [phase, setPhase] = useState<Phase>({ kind: 'ready' })
  const busy = useRef(false)

  const { request, staked } = funding
  const paid = ownSeat !== null && staked.includes(ownSeat)
  const everyone = staked.length === SEATS.length
  const remaining = request === null ? null : secondsLeft(request.stake, request.receivedAtMs, now)

  const stake = async () => {
    if (request === null || busy.current) return
    busy.current = true
    setPhase({ kind: 'signing' })
    try {
      // Every attempt, first or retry, JOINs for a transaction built now, so the blockhash only has
      // to outlive the time spent in the wallet.
      const fresh = await session.freshStake()
      if (fresh === null) {
        setPhase({ kind: 'failed', why: 'unavailable' })
        return
      }
      await signAndSendStake(fresh.tx)
      setPhase({ kind: 'sent', atMs: Date.now() })
    } catch (error) {
      const why = classifyStakeError(error)
      if (__DEV__) console.log('[stake] failed', why)
      setPhase({ kind: 'failed', why })
    } finally {
      busy.current = false
    }
  }

  let line: string
  let action: { label: string; enabled: boolean } | null = null
  if (paid) {
    line = everyone ? 'Every stake is held. The rite begins.' : 'Your stake is held. Waiting for the others.'
  } else if (phase.kind === 'signing') {
    line = 'Approve the stake in your wallet. It expires in about half a minute.'
  } else if (phase.kind === 'sent') {
    const late = now - phase.atMs > STAKE_LANDING_MS
    line = late
      ? 'Your stake has not landed. If your wallet showed an error, stake again.'
      : 'Your stake is sent. Waiting for the chain.'
    if (late) action = { label: `Stake ${BUY_IN_SKR} SKR again`, enabled: request !== null }
  } else if (phase.kind === 'failed') {
    line = STAKE_FAILED[phase.why]
    action = { label: `Stake ${BUY_IN_SKR} SKR`, enabled: true }
  } else {
    line = request === null ? 'Preparing your stake.' : `Four kneel. Stake ${BUY_IN_SKR} SKR to begin the rite.`
    action = { label: `Stake ${BUY_IN_SKR} SKR`, enabled: request !== null }
  }

  return (
    <View style={styles.funding}>
      <Text style={styles.line} accessibilityLiveRegion="polite">
        {line}
      </Text>
      {action === null ? null : (
        <Pressable
          onPress={stake}
          disabled={!action.enabled}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled: !action.enabled }}
          style={styles.stake}
        >
          <Text style={[styles.stakeLabel, action.enabled ? null : styles.stakeLabelDisabled]}>{action.label}</Text>
        </Pressable>
      )}
      {remaining === null || everyone ? null : (
        <Text style={[styles.line, styles.timer]}>
          {remaining > 0 ? `The stakes close in ${clock(remaining)}.` : 'The time to stake has run out.'}
        </Text>
      )}
    </View>
  )
}

type RosterEntry = LobbyUpdateMessage['players'][number]

function SeatRow({
  seat,
  player,
  you,
  staked,
}: {
  seat: SeatNumber
  player: RosterEntry | undefined
  you: string
  /** Null outside the funding stage. Said in words beside the name, never by colour alone. */
  staked: boolean | null
}) {
  if (player === undefined) {
    return (
      <View style={styles.row} accessibilityLabel={`Seat ${seat}, empty`}>
        <View style={styles.ringSpace}>
          <View style={styles.emptyDisc} />
        </View>
        <Text style={[styles.name, styles.empty]}>Empty</Text>
      </View>
    )
  }
  // Your own row by id, never by name or seat: names repeat and seats move.
  const own = player.id === you
  const token = <SeatToken seat={seat} disc={tokens.art.voteDisc} sigil={tokens.art.voteSigil} />
  const stakeNote = staked === null ? '' : staked ? ', staked' : ', not yet staked'
  return (
    <View style={styles.row} accessibilityLabel={`Seat ${seat}, ${player.name}${own ? ', you' : ''}${stakeNote}`}>
      <View style={styles.ringSpace}>
        {own ? (
          <View style={[styles.ownRing, { width: RING, height: RING, borderRadius: RING / 2 }]}>{token}</View>
        ) : (
          token
        )}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {player.name}
      </Text>
      {staked === null ? null : (
        <Text style={[styles.stakeMark, staked ? styles.staked : null]}>{staked ? 'Staked' : 'Not yet'}</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: tokens.layout.screenGutter,
  },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.layout.stackGap,
  },
  label: {
    ...tokens.type.fine,
    color: tokens.palette.boneDim,
  },
  code: {
    ...tokens.type.code,
    ...tokens.tabularFigures,
    color: tokens.palette.bone,
    letterSpacing: tokens.layout.stackGap,
  },
  line: {
    ...tokens.type.body,
    color: tokens.palette.boneDim,
    textAlign: 'center',
  },
  timer: {
    ...tokens.tabularFigures,
  },
  seats: {
    alignSelf: 'stretch',
    gap: tokens.layout.stackGap,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.layout.stackGap,
  },
  // Every disc sits in the same ring-sized box, so marking your own row moves nothing.
  ringSpace: {
    width: RING,
    height: RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // §6.2: your own token is ringed in boneDim, and that ring is the only difference.
  ownRing: {
    borderWidth: tokens.art.tokenRing,
    borderColor: tokens.palette.boneDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // An empty seat is a socket pressed into the stone, with nothing in it.
  emptyDisc: {
    ...tokens.material.insetStoneFace,
    width: tokens.art.voteDisc,
    height: tokens.art.voteDisc,
    borderRadius: tokens.art.voteDisc / 2,
  },
  name: {
    ...tokens.type.body,
    color: tokens.palette.bone,
    flexShrink: 1,
    flexGrow: 1,
  },
  stakeMark: {
    ...tokens.type.fine,
    color: tokens.palette.boneFaintText,
  },
  // §3.1: --gold is for SKR, and a held stake is SKR.
  staked: {
    color: tokens.palette.gold,
  },
  funding: {
    alignSelf: 'stretch',
    gap: tokens.layout.stackGap,
  },
  stake: {
    ...tokens.material.raisedStoneFace,
    borderRadius: tokens.radii.chip,
    minHeight: tokens.layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stakeLabel: {
    ...tokens.type.body,
    color: tokens.palette.gold,
  },
  stakeLabelDisabled: {
    color: tokens.palette.boneFaint,
  },
  empty: {
    color: tokens.palette.boneFaint,
  },
  leave: {
    ...tokens.material.raisedStoneFace,
    borderRadius: tokens.radii.chip,
    minHeight: tokens.layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: tokens.layout.sectionGap,
  },
  leaveLabel: {
    ...tokens.type.body,
    color: tokens.palette.bone,
  },
})
