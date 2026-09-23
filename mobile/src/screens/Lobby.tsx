import { Redirect, router } from 'expo-router'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { DissolveReason, LobbyUpdateMessage } from '../../protocol/generated'
import { SeatToken } from '../art/SeatToken'
import type { SeatNumber } from '../art/Sigil'
import { tokens } from '../design/tokens'
import { match, session, type LobbyState } from '../net/session'

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

/** How often the countdown re-renders. Outside a match this is cheap, and it keeps the second exact. */
const COUNTDOWN_REFRESH_MS = 250

/** The sigils run out at four; so does the lobby. */
const SEATS: SeatNumber[] = [1, 2, 3, 4]

/** Your own disc's ring sits outside it, as on the board's riding token. */
const RING = tokens.art.voteDisc + tokens.art.tokenRing * 2

const DISSOLVED_NOTICE: Record<DissolveReason, string> = {
  TIMEOUT: 'dissolvedTimeout',
  ESCROW_FAILED: 'dissolvedEscrow',
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

/** PROTOCOL.md §2: `expiresAt - serverNow`, less what has passed on this phone since arrival. */
function secondsLeft(state: LobbyState, nowMs: number): number {
  const { expiresAt, serverNow } = state.update
  return (expiresAt - serverNow - (nowMs - state.receivedAtMs)) / 1000
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

  const players = lobby?.update.players ?? []
  const remaining = lobby === null ? null : secondsLeft(lobby, now)

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
            <SeatRow key={seat} seat={seat} player={players[seat - 1]} you={you} />
          ))}
        </View>

        <Text style={styles.line} accessibilityLiveRegion="polite">
          {lobby === null ? KNEELING[0] : KNEELING[Math.min(players.length, SEATS.length)]}
        </Text>
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

type RosterEntry = LobbyUpdateMessage['players'][number]

function SeatRow({ seat, player, you }: { seat: SeatNumber; player: RosterEntry | undefined; you: string }) {
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
  return (
    <View style={styles.row} accessibilityLabel={`Seat ${seat}, ${player.name}${own ? ', you' : ''}`}>
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
