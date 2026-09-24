import { router, useLocalSearchParams } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { LobbyAck, Side } from '../../protocol/generated'
import { Marking } from '../art/Marking'
import { tokens } from '../design/tokens'
import { CODE_ALPHABET, CODE_LENGTH, DEV_TOOLS, NAME_MAX, session } from '../net/session'

// / — §7.1's Home: a name, create, and join by code, with the rules below the actions rather than
// behind a link. No wallet UI of any kind until the contract lands (BUILD-PLAN.md §4).

type LobbyError = Extract<LobbyAck, { ok: false }>['error']

// §1.2: errors do not apologise and are never vague.
const ERRORS: Record<LobbyError, string> = {
  UNKNOWN_CODE: 'No gathering answers to that code.',
  LOBBY_FULL: 'That gathering is full. Four already kneel.',
  INVALID_PAYLOAD: 'The name or the code was refused. A name is 1 to 32 characters; a code is four.',
  ESCROW_FAILED: 'The stakes could not be held. Nothing was taken.',
}

const NOTICES: Record<string, string> = {
  // PROTOCOL.md §2: nothing locks until all four seats are filled, so a dissolve takes nothing.
  dissolvedTimeout: 'The gathering dissolved. Four did not kneel in time. Nothing was taken.',
  dissolvedEscrow: 'The gathering dissolved. The rite could not be paid for. Nothing was taken.',
  seatLost: 'Your seat in the gathering is gone. Nothing was taken.',
  lost: 'The server no longer knows your seat.',
}

/** Upper-cases, and keeps only the server's alphabet: no I, O, 0 or 1. */
function cleanCode(text: string): string {
  return [...text.toUpperCase()]
    .filter((c) => CODE_ALPHABET.includes(c))
    .join('')
    .slice(0, CODE_LENGTH)
}

export function Home() {
  const insets = useSafeAreaInsets()
  const { notice } = useLocalSearchParams<{ notice?: string }>()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Side | null>(null)

  const trimmed = name.trim()
  const nameOk = trimmed.length >= 1 && trimmed.length <= NAME_MAX
  const codeOk = code.length === CODE_LENGTH

  const run = async (action: () => Promise<LobbyAck>) => {
    setBusy(true)
    setError(null)
    try {
      const ack = await action()
      if (!ack.ok) {
        setError(ERRORS[ack.error])
        return
      }
      router.replace({ pathname: '/lobby/[code]', params: { code: ack.ticket.code } })
    } catch {
      setError(`The server did not answer. It is expected at ${session.serverUrl}.`)
    } finally {
      setBusy(false)
    }
  }

  const rehearse = (role: Side) => {
    if (session.startRehearsal(role)) router.replace('/match')
    else setError('A rehearsal cannot run while connected to the server.')
  }

  const shownNotice = error ?? (notice === undefined ? null : (NOTICES[notice] ?? null))

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + tokens.layout.sectionGap }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title} accessibilityRole="header">
          Reztor
        </Text>

        <View style={styles.group}>
          <Text style={styles.label}>Your name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX}
            autoCorrect={false}
            placeholder="The name the others will see"
            placeholderTextColor={tokens.palette.boneDim}
            cursorColor={tokens.palette.bone}
            selectionColor={tokens.palette.stoneLit}
            style={styles.input}
            accessibilityLabel="Your name"
          />
        </View>

        <Button
          label="Open a gathering"
          disabled={!nameOk || busy}
          onPress={() => run(() => session.createLobby(trimmed))}
        />

        <View style={styles.group}>
          <Text style={styles.label}>Or join one by its code</Text>
          <View style={styles.row}>
            <TextInput
              value={code}
              onChangeText={(text) => setCode(cleanCode(text))}
              maxLength={CODE_LENGTH}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="CODE"
              placeholderTextColor={tokens.palette.boneDim}
              cursorColor={tokens.palette.bone}
              selectionColor={tokens.palette.stoneLit}
              style={[styles.input, styles.codeInput]}
              accessibilityLabel="Gathering code"
            />
            <Button
              label="Join"
              disabled={!nameOk || !codeOk || busy}
              onPress={() => run(() => session.joinLobby(code, trimmed))}
            />
          </View>
        </View>

        {shownNotice === null ? null : (
          <Text style={styles.notice} accessibilityLiveRegion="polite">
            {shownNotice}
          </Text>
        )}

        {DEV_TOOLS ? (
          <View style={styles.group}>
            <Text style={styles.label}>Dev</Text>
            <View style={styles.row}>
              <Button label="Rehearse alone" onPress={() => rehearse('crew')} />
              <Button label="Rehearse as Hollow" onPress={() => rehearse('impostor')} />
              <Button label="Faithful" onPress={() => setPreview('crew')} />
              <Button label="Hollow" onPress={() => setPreview('impostor')} />
            </View>
          </View>
        ) : null}

        <About />
      </ScrollView>

      {/* Dev only: the Marking for a chosen role, so both variants can be captured and compared. */}
      {preview === null ? null : <Marking role={preview} seat={1} onDone={() => setPreview(null)} />}
    </View>
  )
}

function Button({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      style={styles.button}
    >
      <Text style={[styles.buttonLabel, disabled ? styles.buttonLabelDisabled : null]}>{label}</Text>
    </Pressable>
  )
}

// §1's fiction in §1.2's voice: second person, present tense, no exclamation marks. Interface
// vocabulary only (§1.1). No rule numbers — those arrive with the match's config and are never
// hardcoded.
function About() {
  return (
    <View style={styles.about}>
      <Heading>The Rite</Heading>
      <Para>
        Reztor is a dead god. You are one of four celebrants kneeling at four conduits beneath what is left of it, and
        the rite must bring it back before the night ends.
      </Para>
      <Para>
        Each offering you make is consecrated and rises through your conduit into the Heart. When the four conduits
        together reach the Threshold, the Heart breathes on its own and the rite is complete.
      </Para>
      <Para>
        Offerings cost you something real. A lesser offering is cheap and gives a little. A greater offering costs more
        and gives more, at a worse rate.
      </Para>

      <Heading>The Hollow</Heading>
      <Para>
        One of the four is Hollow. It wears a celebrant&apos;s robe and cannot refuse the rite where the others would
        see. So it draws consecrated matter out of one conduit and forces it into another. Four parts in every ten are
        the toll, taken in transit. They are gone.
      </Para>
      <Para>
        A conduit that falls while another rises tells you something true and not enough. The two celebrants it touched
        are both Faithful.
      </Para>

      <Heading>A round</Heading>
      <Para>Each round has three stages, and the rite lasts three rounds.</Para>
      <Para>In the Offering, you make offerings. In the Council, you speak. In Judgement, you may cast one out.</Para>
      <Para>
        Augury reads one conduit&apos;s last round and gives one answer: fed by its own hand, filled from elsewhere, or
        something was taken. You may read once.
      </Para>
      <Para>
        A celebrant who is cast out stays to watch, and their conduit goes cold. The Faithful win when the Heart wakes,
        or when the Hollow is cast out. The Hollow wins if the third round ends with the Heart still dead, or when two
        of the Faithful have been cast out and it can no longer be outvoted.
      </Para>
    </View>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.heading} accessibilityRole="header">
      {children}
    </Text>
  )
}

function Para({ children }: { children: ReactNode }) {
  return <Text style={styles.para}>{children}</Text>
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: tokens.layout.screenGutter,
    paddingBottom: tokens.layout.sectionGap,
    gap: tokens.layout.sectionGap,
  },
  title: {
    ...tokens.type.display,
    color: tokens.palette.bone,
  },
  group: {
    gap: tokens.layout.stackGap,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.layout.stackGap,
  },
  label: {
    ...tokens.type.fine,
    color: tokens.palette.boneDim,
  },
  input: {
    ...tokens.type.body,
    ...tokens.material.insetStoneFace,
    color: tokens.palette.bone,
    borderRadius: tokens.radii.chip,
    minHeight: tokens.layout.minTouchTarget,
    paddingHorizontal: tokens.layout.screenGutter,
  },
  codeInput: {
    flex: 1,
    letterSpacing: tokens.layout.stackGap / 2,
  },
  button: {
    ...tokens.material.raisedStoneFace,
    borderRadius: tokens.radii.chip,
    minHeight: tokens.layout.minTouchTarget,
    paddingHorizontal: tokens.layout.screenGutter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    ...tokens.type.body,
    color: tokens.palette.bone,
  },
  buttonLabelDisabled: {
    color: tokens.palette.boneFaint,
  },
  notice: {
    ...tokens.type.body,
    color: tokens.palette.bone,
  },
  about: {
    gap: tokens.layout.stackGap,
  },
  heading: {
    ...tokens.type.stage,
    color: tokens.palette.bone,
    marginTop: tokens.layout.stackGap,
  },
  para: {
    ...tokens.type.body,
    color: tokens.palette.boneDim,
  },
})
