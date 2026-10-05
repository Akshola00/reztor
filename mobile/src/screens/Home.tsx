import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { LobbyAck, Side } from '../../protocol/generated'
import { IdleBoard } from '../art/IdleBoard'
import { Marking } from '../art/Marking'
import { SkrMark } from '../art/SkrMark'
import { tokens, type PrimaryStyle } from '../design/tokens'
import { CODE_ALPHABET, CODE_LENGTH, DEV_TOOLS, NAME_MAX, session, type BootTarget } from '../net/session'
import { BUY_IN_SKR, shortAddress } from '../solana/chain'
import { requestFaucet, type FaucetResult } from '../solana/faucet'
import { looks, useLook, type Look } from './look'
import { usePolled } from './Offering'
import { RulesSheet } from './RulesSheet'

// / — §7.1's Home. Two states. Without a wallet: the wordmark, the idle board, one action (connect
// a wallet) and the About control. With one: the wallet strip, then a name, open a gathering, join
// one by its code, and the About control. The rules live in the rules sheet behind that control —
// the owner moved them out from under the actions.
//
// The contract has landed (BUILD-PLAN.md §4), so wallet connect stands in front of the entry:
// nothing can be opened or joined without a wallet to stake from.

type LobbyError = Extract<LobbyAck, { ok: false }>['error']

// §1.2: errors do not apologise and are never vague.
const ERRORS: Record<LobbyError, string> = {
  UNKNOWN_CODE: 'No gathering answers to that code.',
  LOBBY_FULL: 'That gathering is full. Four already kneel.',
  INVALID_PAYLOAD: 'The name or the code was refused. A name is 1 to 32 characters; a code is four.',
  ESCROW_FAILED: 'The stakes could not be held. Nothing was taken.',
  WALLET_UNFUNDED: `Your wallet cannot cover the stake. It needs ${BUY_IN_SKR} SKR, and a little SOL for fees.`,
  WALLET_TAKEN: 'That wallet already kneels in this gathering. Each seat needs its own wallet.',
}

const WALLET_REFUSED = 'The wallet did not connect. Open a Solana wallet set to devnet, and try again.'

// CHAIN-PROTOCOL-CHANGES.md §5's table. FAUCET_DISABLED hides the button instead.
const FAUCET: Record<Exclude<FaucetResult, { ok: true }>['error'], string> = {
  FAUCET_DISABLED: 'This server has no faucet.',
  INVALID_WALLET: 'The faucet refused this wallet address.',
  ALREADY_FUNDED: 'You already have enough test SKR.',
  RATE_LIMITED: 'This wallet has had its test SKR today. Try again tomorrow.',
  FAUCET_EMPTY: 'The faucet is empty. Tell the developers.',
  CHAIN_ERROR: 'The faucet could not reach the chain. Nothing was counted. Try again.',
  UNREACHABLE: 'The faucet did not answer. Try again.',
}

const NOTICES: Record<string, string> = {
  // PROTOCOL.md §2: nothing locks until all four seats are filled, so a dissolve takes nothing.
  dissolvedTimeout: 'The gathering dissolved. Four did not kneel in time. Nothing was taken.',
  dissolvedEscrow: 'The gathering dissolved. The rite could not be paid for. Anyone who paid has been refunded.',
  dissolvedStake: 'Not everyone staked — anyone who paid has been refunded.',
  seatLost: 'Your seat in the gathering is gone. Nothing was taken.',
  lost: 'The server no longer knows your seat.',
  // A launch or retry that found the rite already resolved. Its MATCH_END was sent once, to the
  // room, while this phone was away, so there is no Reckoning to show.
  ended: 'The rite you knelt in has ended.',
}

/** Upper-cases, and keeps only the server's alphabet: no I, O, 0 or 1. */
function cleanCode(text: string): string {
  return [...text.toUpperCase()].filter((c) => CODE_ALPHABET.includes(c)).join('')
}

type Styles = ReturnType<typeof makeStyles>

type HomeParams = {
  notice?: string
  // Dev only, so captures can be driven by deep link: a candidate look, and a refusal to show.
  primary?: string
  sigils?: string
  refusal?: string
}

export function Home({ initialNotice }: { initialNotice?: string }) {
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  const params = useLocalSearchParams<HomeParams>()
  const notice = params.notice ?? initialNotice
  // §7.9: home says plainly when the server cannot be reached, rather than waiting for a press.
  const status = usePolled(session.status)
  useEffect(() => session.connect(), [])
  const online = status === 'online'
  useEffect(() => {
    if (__DEV__) console.log('[ui] home status', status)
  }, [status])
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Side | null>(null)
  const [unfunded, setUnfunded] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [boardHeight, setBoardHeight] = useState(0)
  const { account, connect, disconnect } = useMobileWallet()
  const wallet = account?.address ?? null

  const look = useLook()
  const { palette } = tokens
  const styles = useMemo(() => makeStyles(look.primary), [look.primary])

  // Dev only: apply a candidate look from the deep link that opened home.
  useEffect(() => {
    if (!DEV_TOOLS) return
    const next: Partial<Look> = {}
    if (params.primary === 'litStone' || params.primary === 'flame') next.primary = params.primary
    if (params.sigils !== undefined) next.sigils = params.sigils !== '0'
    looks.set(next)
  }, [params.primary, params.sigils])
  // Dev only: a refusal named by the deep link, shown through the same lines a real one uses.
  const refusal = DEV_TOOLS ? params.refusal : undefined
  const devRefusal =
    refusal === undefined
      ? null
      : refusal in ERRORS
        ? ERRORS[refusal as LobbyError]
        : refusal === 'WALLET_REFUSED'
          ? WALLET_REFUSED
          : null

  const trimmed = name.trim()
  const nameOk = trimmed.length >= 1 && trimmed.length <= NAME_MAX
  const codeOk = code.length === CODE_LENGTH

  const run = async (action: () => Promise<LobbyAck>) => {
    setBusy(true)
    setError(null)
    try {
      const ack = await action()
      setUnfunded(!ack.ok && ack.error === 'WALLET_UNFUNDED')
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

  const connectWallet = async () => {
    setBusy(true)
    setError(null)
    try {
      await connect()
    } catch {
      setError(WALLET_REFUSED)
    } finally {
      setBusy(false)
    }
  }

  const disconnectWallet = async () => {
    setUnfunded(false)
    setError(null)
    await disconnect().catch(() => undefined)
  }

  const retry = async () => {
    setBusy(true)
    setError(null)
    let target: BootTarget
    try {
      target = await session.retry()
    } finally {
      setBusy(false)
    }
    // A ticket kept from a launch the server missed may still hold a seat.
    if (target.route === 'match') router.replace('/match')
    else if (target.route === 'lobby') router.replace({ pathname: '/lobby/[code]', params: { code: target.code } })
  }

  const rehearse = (role: Side) => {
    if (session.startRehearsal(role)) router.replace('/match')
    else setError('A rehearsal cannot run while connected to the server.')
  }

  const shownNotice = error ?? devRefusal ?? (notice === undefined ? null : (NOTICES[notice] ?? null))
  const showUnfunded = unfunded || (error === null && refusal === 'WALLET_UNFUNDED')

  return (
    <View style={styles.root}>
      <ScrollView keyboardShouldPersistTaps="handled">
        {/* One screen tall, so the idle board takes whatever the controls leave. Dev tools sit
            below it, out of every capture. */}
        <View
          style={[
            styles.screen,
            {
              minHeight: window.height,
              paddingTop: insets.top + tokens.layout.stackGap,
              paddingBottom: insets.bottom + tokens.layout.sectionGap,
            },
          ]}
        >
          <Text style={styles.wordmark} accessibilityRole="header">
            Reztor
          </Text>

          {wallet === null ? null : (
            <WalletStrip
              wallet={wallet}
              busy={busy}
              onDisconnect={disconnectWallet}
              onFunded={() => setError(null)}
              styles={styles}
            />
          )}

          <View style={styles.boardSlot} onLayout={(e) => setBoardHeight(Math.floor(e.nativeEvent.layout.height))}>
            {boardHeight < tokens.home.idleBoardMin ? null : (
              <View style={styles.board}>
                <IdleBoard
                  width={window.width - tokens.layout.screenGutter * 2}
                  height={boardHeight}
                  sigils={look.sigils}
                />
              </View>
            )}
          </View>

          {status === 'offline' ? (
            <View style={styles.offline}>
              <Text style={styles.notice} accessibilityLiveRegion="polite">
                {`The server cannot be reached. It is expected at ${session.serverUrl}.`}
              </Text>
              <Button label="Try again" disabled={busy} onPress={retry} styles={styles} />
            </View>
          ) : null}

          {wallet === null ? (
            <View style={styles.group}>
              <Primary label="Connect wallet" disabled={busy} onPress={connectWallet} styles={styles} />
              <Text style={styles.para}>
                {`Your stake of ${BUY_IN_SKR} SKR is paid from a Solana wallet on this phone. Connect one set to devnet.`}
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.group}>
                <Text style={styles.label}>Your name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  maxLength={NAME_MAX}
                  autoCorrect={false}
                  placeholder="The name the others will see"
                  placeholderTextColor={palette.boneDim}
                  cursorColor={palette.bone}
                  selectionColor={palette.stoneLit}
                  style={styles.input}
                  accessibilityLabel="Your name"
                />
              </View>

              <Primary
                label="Open a gathering"
                disabled={!nameOk || busy || !online}
                onPress={() => run(() => session.createLobby(trimmed, wallet))}
                styles={styles}
              />

              <View style={styles.group}>
                <Text style={styles.label}>Or join one by its code</Text>
                <View style={styles.codeRow}>
                  <CodeCells code={code} onChange={setCode} styles={styles} />
                  <Button
                    label="Join"
                    disabled={!nameOk || !codeOk || busy || !online}
                    onPress={() => run(() => session.joinLobby(code, trimmed, wallet))}
                    styles={styles}
                  />
                </View>
              </View>
            </>
          )}

          {shownNotice === null ? null : (
            <Text style={styles.notice} accessibilityLiveRegion="polite">
              {shownNotice}
            </Text>
          )}

          {/* WALLET_UNFUNDED: the cure sits directly under the refusal. */}
          {showUnfunded && wallet !== null ? (
            <Faucet wallet={wallet} onFunded={() => setError(null)} styles={styles} />
          ) : null}

          <Pressable
            onPress={() => setRulesOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="How the rite works"
            style={styles.about}
          >
            <View style={styles.aboutMark} />
            <Text style={styles.aboutLabel}>How the rite works</Text>
          </Pressable>
        </View>

        {DEV_TOOLS ? (
          <DevTools
            look={look}
            styles={styles}
            onRehearse={rehearse}
            onPreview={setPreview}
            bottom={insets.bottom + tokens.layout.sectionGap}
          />
        ) : null}
      </ScrollView>

      {rulesOpen ? <RulesSheet onClose={() => setRulesOpen(false)} /> : null}

      {/* Dev only: the Marking for a chosen role, so both variants can be captured and compared. */}
      {preview === null ? null : <Marking role={preview} seat={1} onDone={() => setPreview(null)} />}
    </View>
  )
}

/**
 * The connected wallet, shown off rather than tucked away: the address, the faucet in gold, and a
 * way out. Its SKR balance is not shown — nothing on the client reads it yet.
 */
function WalletStrip({
  wallet,
  busy,
  onDisconnect,
  onFunded,
  styles,
}: {
  wallet: string
  busy: boolean
  onDisconnect: () => void
  onFunded: () => void
  styles: Styles
}) {
  return (
    <View style={styles.strip}>
      <View style={styles.stripRow}>
        <View>
          <Text style={styles.label}>Your wallet, on devnet</Text>
          <Text style={styles.address} accessibilityLabel={`Wallet ${wallet}`}>
            {shortAddress(wallet)}
          </Text>
        </View>
        <Button label="Disconnect" disabled={busy} onPress={onDisconnect} styles={styles} />
      </View>
      <Faucet wallet={wallet} onFunded={onFunded} styles={styles} />
    </View>
  )
}

/**
 * CHAIN-PROTOCOL-CHANGES.md §5: tops up the wallet with test SKR and SOL. Hidden for good once the
 * server says it has no faucet. Gold, because it fetches SKR (§3.1).
 */
function Faucet({
  wallet,
  onFunded,
  styles,
}: {
  wallet: string
  /** A grant answers the refusal it was fetched for, so that refusal is cleared. */
  onFunded: () => void
  styles: Styles
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<FaucetResult | null>(null)
  if (result !== null && !result.ok && result.error === 'FAUCET_DISABLED') return null

  const press = async () => {
    setBusy(true)
    setResult(null)
    const next = await requestFaucet(session.serverUrl, wallet)
    setResult(next)
    if (next.ok) onFunded()
    setBusy(false)
  }

  const label = busy ? 'Sending test SKR' : 'Get test SKR'
  return (
    <View style={styles.group}>
      <Pressable
        onPress={press}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy }}
        style={[styles.button, styles.faucet]}
      >
        <SkrMark colour={busy ? styles.disabledLabel.color : styles.gold.color} />
        <Text style={[styles.buttonLabel, busy ? styles.disabledLabel : styles.gold]}>{label}</Text>
      </Pressable>
      {result === null ? null : (
        <Text style={styles.notice} accessibilityLiveRegion="polite">
          {result.ok ? '240 test SKR and 0.05 SOL are in your wallet. You can kneel now.' : FAUCET[result.error]}
        </Text>
      )}
    </View>
  )
}

/**
 * The gathering code as four cells. One transparent input lies over all four and holds the whole
 * code, so typing fills the cells in order at any speed and backspace steps back — per-cell inputs
 * dropped characters typed faster than focus could move between them. A whole code pasted over a
 * part one replaces it. Lower case is raised and anything outside the server's alphabet is
 * dropped, so the cells only ever hold a code the server could issue.
 */
function CodeCells({ code, onChange, styles }: { code: string; onChange: (code: string) => void; styles: Styles }) {
  const [focused, setFocused] = useState(false)

  const change = (text: string) => {
    const typed = cleanCode(text)
    if (typed.length <= CODE_LENGTH) onChange(typed)
    // Past four characters: a paste replaces the code, a fifth keystroke is ignored.
    else if (typed.length - code.length >= CODE_LENGTH) onChange(typed.slice(-CODE_LENGTH))
  }

  // The cell the next character lands in, or the last one once the code is whole.
  const active = Math.min(code.length, CODE_LENGTH - 1)
  return (
    <View style={styles.cells}>
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <View key={i} style={[styles.cell, focused && i === active ? styles.cellFocused : null]}>
          <Text style={styles.cellText}>{code[i] ?? ''}</Text>
        </View>
      ))}
      <TextInput
        value={code}
        onChangeText={change}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        caretHidden
        // Android's suggestion-free keyboard, with the digit row up: a code is not a word.
        keyboardType="visible-password"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        style={styles.cellInput}
        accessibilityLabel={`Gathering code, ${CODE_LENGTH} characters`}
      />
    </View>
  )
}

function Primary({
  label,
  disabled,
  onPress,
  styles,
}: {
  label: string
  disabled?: boolean
  onPress: () => void
  styles: Styles
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      style={disabled ? styles.primaryDisabled : styles.primary}
    >
      <Text style={disabled ? [styles.primaryLabel, styles.disabledLabel] : styles.primaryLabel}>{label}</Text>
    </Pressable>
  )
}

function Button({
  label,
  disabled,
  onPress,
  selected = false,
  styles,
}: {
  label: string
  disabled?: boolean
  onPress: () => void
  /** Dev chips only: the candidate in use. */
  selected?: boolean
  styles: Styles
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true, selected }}
      style={[styles.button, selected ? styles.chipSelected : null]}
    >
      <Text style={[styles.buttonLabel, disabled ? styles.disabledLabel : null]}>{label}</Text>
    </Pressable>
  )
}

/** Dev builds only: the candidate chips, the rehearsals and the Marking previews. */
function DevTools({
  look,
  styles,
  onRehearse,
  onPreview,
  bottom,
}: {
  look: Look
  styles: Styles
  onRehearse: (role: Side) => void
  onPreview: (role: Side) => void
  bottom: number
}) {
  const chips = <K extends keyof Look>(key: K, options: [Look[K], string][]) => (
    <View style={styles.row}>
      {options.map(([value, label]) => (
        <Button
          key={label}
          label={label}
          selected={look[key] === value}
          onPress={() => looks.set({ [key]: value } as Partial<Look>)}
          styles={styles}
        />
      ))}
    </View>
  )
  return (
    <View style={[styles.dev, { paddingBottom: bottom }]}>
      <Text style={styles.label}>Dev: primary button</Text>
      {chips('primary', [
        ['litStone', 'A lit stone'],
        ['flame', 'B flame'],
      ])}
      <Text style={styles.label}>Dev: idle board</Text>
      {chips('sigils', [
        [true, 'Sigils'],
        [false, 'Bare'],
      ])}
      <Text style={styles.label}>Dev</Text>
      <View style={styles.row}>
        <Button label="Rehearse alone" onPress={() => onRehearse('crew')} styles={styles} />
        <Button label="Rehearse as Hollow" onPress={() => onRehearse('impostor')} styles={styles} />
        <Button label="Faithful" onPress={() => onPreview('crew')} styles={styles} />
        <Button label="Hollow" onPress={() => onPreview('impostor')} styles={styles} />
      </View>
    </View>
  )
}

function makeStyles(primary: PrimaryStyle) {
  const { layout, home, palette, type, homeFaces: faces } = tokens
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    screen: {
      paddingHorizontal: layout.screenGutter,
      gap: layout.sectionGap,
    },
    wordmark: {
      ...type.wordmark,
      color: palette.bone,
      textAlign: 'center',
    },
    // The board is laid over its slot rather than sized by it, so the slot can shrink when a
    // notice takes room and the board follows it down.
    boardSlot: {
      flexGrow: 1,
      minHeight: 0,
    },
    board: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
    },
    group: {
      gap: layout.stackGap,
    },
    offline: {
      gap: layout.stackGap,
      alignItems: 'flex-start',
    },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: layout.stackGap,
    },
    label: {
      ...type.fine,
      color: palette.boneDim,
    },
    para: {
      ...type.body,
      color: palette.boneDim,
    },
    notice: {
      ...type.body,
      color: palette.bone,
    },
    input: {
      ...type.body,
      ...faces.field,
      color: palette.bone,
      minHeight: layout.minTouchTarget,
      paddingHorizontal: layout.screenGutter,
    },
    codeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: layout.stackGap,
    },
    cells: {
      flexDirection: 'row',
      gap: layout.stackGap / 2,
    },
    cell: {
      ...faces.field,
      width: home.codeCell,
      height: home.codeCell,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellText: {
      ...type.codeCell,
      color: palette.bone,
    },
    // Laid over all four cells and invisible: it takes the touches, the keystrokes and the paste
    // menu, and the cells draw what it holds. Opacity, not a transparent text colour — Android
    // draws a TextInput's transparent text black.
    cellInput: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      opacity: 0,
    },
    cellFocused: faces.fieldFocused,
    primary: {
      ...faces.primary[primary],
      minHeight: home.primaryHeight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryDisabled: {
      ...faces.secondary,
      minHeight: home.primaryHeight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryLabel: {
      ...type.stage,
      color: faces.primaryLabel[primary],
    },
    button: {
      ...faces.secondary,
      flexDirection: 'row',
      minHeight: layout.minTouchTarget,
      paddingHorizontal: layout.screenGutter,
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens.art.skrGap,
    },
    buttonLabel: {
      ...type.bodyMedium,
      color: palette.bone,
    },
    disabledLabel: {
      color: palette.boneFaint,
    },
    chipSelected: { ...faces.field, ...faces.fieldFocused },
    // §3.1: gold is for SKR only, and this button fetches SKR.
    gold: {
      color: palette.gold,
    },
    faucet: {
      alignSelf: 'stretch',
    },
    strip: {
      ...faces.panel,
      padding: layout.stackGap,
      gap: layout.stackGap,
    },
    stripRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: layout.stackGap,
    },
    address: {
      ...type.stage,
      fontFamily: type.bodyMedium.fontFamily,
      ...tokens.tabularFigures,
      color: palette.bone,
    },
    // The About control: as tall as the primary, so a new player finds it unprompted, but a stone
    // face, so it never competes with the action.
    about: {
      ...faces.secondary,
      flexDirection: 'row',
      minHeight: home.primaryHeight,
      alignItems: 'center',
      justifyContent: 'center',
      gap: layout.stackGap,
    },
    aboutMark: {
      width: home.aboutMark,
      height: home.aboutMark,
      borderWidth: tokens.art.sigilStroke,
      borderColor: palette.boneDim,
      transform: [{ rotate: '45deg' }],
    },
    aboutLabel: {
      ...type.stage,
      color: palette.bone,
    },
    dev: {
      paddingHorizontal: layout.screenGutter,
      gap: layout.stackGap,
    },
  })
}
