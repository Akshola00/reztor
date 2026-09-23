import { Redirect, router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { tokens } from '../design/tokens'
import { LOBBY_FILL_TIMEOUT_SEC, match, session } from '../net/session'

// /lobby/[code] — the Gathering. The code large enough to read aloud across a room, the seat this
// player took, the dissolve timer, and a way out.
//
// The ticket's JOIN was already sent the moment it arrived (PROTOCOL.md §2), so there is nothing to
// press here. MATCH_STARTED arrives unprompted when the fourth player joins, and this screen moves
// to /match on it.
//
// Two things the wire does not say, and how this screen copes — both in the item 3 report:
//   - How long the lobby has left. Its timeout is in `config`, which only comes with
//     MATCH_STARTED, and a joiner cannot know when the lobby was opened. The timer counts from this
//     player's own arrival and says "within", which is exact for the player who opened it and an
//     upper bound for anyone who joined later.
//   - That it dissolved. That happens silently; the only sign is that JOIN starts failing with
//     UNKNOWN_SESSION. The seat is checked when the timer runs out, and every few seconds after.

/** How often to re-check a seat once the local timer has run out. */
const RECHECK_MS = 5000

function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function Lobby() {
  const ticket = session.ticket()
  if (ticket === null) return <Redirect href="/" />
  return <Gathering code={ticket.code} seated={ticket.seated} />
}

function Gathering({ code, seated }: { code: string; seated: number }) {
  const insets = useSafeAreaInsets()
  const [deadline] = useState(() => Date.now() + LOBBY_FILL_TIMEOUT_SEC * 1000)
  const [now, setNow] = useState(() => Date.now())

  // Outside a match a once-a-second render is fine.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const toMatch = () => router.replace('/match')
    // It may have started before this screen mounted — the fourth player's own JOIN starts it.
    if (match.snapshot() !== null) toMatch()
    const offStarted = session.onStarted(toMatch)
    const offLost = session.onLost(() => {
      session.leave()
      router.replace({ pathname: '/', params: { notice: 'dissolved' } })
    })
    return () => {
      offStarted()
      offLost()
    }
  }, [])

  const remaining = (deadline - now) / 1000
  const expired = remaining <= 0

  useEffect(() => {
    if (!expired) return
    const check = () => {
      void session.checkSeat().then((ack) => {
        if (ack !== null && !ack.ok) {
          session.leave()
          router.replace({ pathname: '/', params: { notice: 'dissolved' } })
        }
      })
    }
    check()
    const id = setInterval(check, RECHECK_MS)
    return () => clearInterval(id)
  }, [expired])

  const leave = () => {
    session.leave()
    router.replace('/')
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + tokens.layout.sectionGap, paddingBottom: insets.bottom }]}>
      <View style={styles.centre}>
        <Text style={styles.label}>The gathering</Text>
        <Text style={styles.code} accessibilityLabel={`Gathering code ${code.split('').join(' ')}`}>
          {code}
        </Text>
        <Text style={styles.line}>Read the code aloud. The rite begins when four kneel.</Text>
        <Text style={styles.line}>{`You took seat ${seated} of 4.`}</Text>
        <Text style={[styles.line, styles.timer]}>
          {expired ? 'The time to gather has run out.' : `The gathering dissolves within ${clock(remaining)}.`}
        </Text>
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
