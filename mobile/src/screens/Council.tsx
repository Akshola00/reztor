import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import Animated, { useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { ChatMessage, MatchConfig, PlayerId } from '../../protocol/generated'
import { SendIcon } from '../art/ControlMarks'
import { SEAT_TEXT_COLOURS, Sigil, type SeatNumber } from '../art/Sigil'
import { motion } from '../design/motion'
import { tokens } from '../design/tokens'
import { CHAT_MAX, match, session } from '../net/session'
import { usePolled } from './Offering'

// §7.5, the Discuss stage's lower region, rebuilt as a messenger in part 2 of the owner's UI pass.
// Every bubble is stone, and nothing about a bubble differs by role: your own messages sit right
// on a lighter stone step, everyone else's sit left on stone, with their mask and name — the only
// seat colour here — once at the head of each run of consecutive messages and the run's bubbles
// stacked under it. Newest at the bottom, the input under it. No timestamps and no read receipts. The
// stage's time runs as a thin line shortening across the top, never as a number.
//
// The history is the match store's: CHAT_MESSAGE appends, RESUME_STATE replaces it with the
// server's backlog, and the store drops a message it already holds, so a reconnect never
// duplicates a row.
//
// **The keyboard never moves the board.** The input sat at the top from item 4 until this rebuild,
// because the window was set to 'pan' and an input at the bottom made Android slide the whole
// window — board and all — up off the screen. The window is now 'resize' with edge-to-edge on
// (app.config.js), which leaves the window where it is and reports the keyboard's height instead.
// This region pads its own bottom by that height, on the UI thread, so the message list shrinks
// and the input rides above the keyboard while the board above stays exactly where it was.
//
// Both of the server's chat limits are enforced here, so CHAT_RATE_LIMITED never fires: 240
// characters by the input's maxLength, and one message per 2 seconds (plus a tick of margin) by
// holding Send until the interval has passed.

/** How close to the bottom, in dp, still counts as "reading the newest message". */
const AT_NEWEST_SLOP = 24

/** PROTOCOL.md §7: one tick is 250ms. */
const TICK_MS = 250

type CouncilProps = {
  config: MatchConfig
  seats: Record<PlayerId, SeatNumber>
  youId: PlayerId
  /** False for a voted-out player: the input is removed, not disabled. */
  canSpeak: boolean
}

/** A message with what its row needs to know about its neighbours. */
type Row = { message: ChatMessage; own: boolean; first: boolean; last: boolean }

const readChatLength = () => match.snapshot()?.chat.length ?? 0

export function Council({ config, seats, youId, canSpeak }: CouncilProps) {
  usePolled(readChatLength)
  const snapshot = match.snapshot()
  const names = new Map((snapshot?.players ?? []).map((p) => [p.id, p.name]))

  // Runs of consecutive messages from one player group together: `first` heads a run (mask and
  // name), `last` closes it. Worked out in time order, then reversed, because the list is inverted
  // so that its resting position — offset 0 — is the newest message, at the bottom.
  const chat = snapshot?.chat ?? []
  const rows: Row[] = chat
    .map((message, i) => ({
      message,
      own: message.from === youId,
      first: chat[i - 1]?.from !== message.from,
      last: chat[i + 1]?.from !== message.from,
    }))
    .reverse()

  // -- The timer line --------------------------------------------------------------------------
  const line = useSharedValue(1)
  useEffect(() => {
    const s = match.snapshot()
    if (s === null) return
    const total = config.stageDurations.chat * 1000
    const remaining = Math.max(0, (s.stageEndsAtTick - s.serverTick) * TICK_MS)
    line.set(Math.min(1, remaining / total))
    line.set(withTiming(0, { duration: remaining, easing: motion.easing.linear }))
  }, [config, line])
  const lineStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: line.get() }] }))

  // -- The keyboard ----------------------------------------------------------------------------
  //
  // Both bars translucent, so Reanimated leaves the window edge-to-edge and reports the keyboard's
  // full height from the bottom of the screen. The stage panel already keeps clear of the gesture
  // bar, so only what the keyboard covers beyond that is added here.
  const insets = useSafeAreaInsets()
  const keyboard = useAnimatedKeyboard({ isStatusBarTranslucentAndroid: true, isNavigationBarTranslucentAndroid: true })
  const bottomInset = insets.bottom
  const liftStyle = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, keyboard.height.get() - bottomInset) }))

  // -- Follow new messages only when the reader is already at the newest ------------------------
  //
  // maintainVisibleContentPosition holds a reader's place when a message arrives below them; the
  // explicit scroll brings the newest into view only if they were already there.
  const list = useRef<FlatList<Row>>(null)
  const atNewest = useRef(true)
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    atNewest.current = e.nativeEvent.contentOffset.y <= AT_NEWEST_SLOP
  }
  const onContentSizeChange = () => {
    if (atNewest.current) list.current?.scrollToOffset({ offset: 0, animated: true })
  }

  return (
    <Animated.View style={[styles.root, liftStyle]}>
      <View style={styles.track}>
        <Animated.View style={[styles.line, lineStyle]} />
      </View>

      {rows.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.empty}>No one has spoken yet.</Text>
        </View>
      ) : (
        <FlatList
          ref={list}
          inverted
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={rows}
          keyExtractor={(r) => `${r.message.from}:${r.message.tick}`}
          onScroll={onScroll}
          scrollEventThrottle={motion.readoutInterval}
          onContentSizeChange={onContentSizeChange}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Message row={item} seat={seats[item.message.from]} name={names.get(item.message.from) ?? ''} />
          )}
        />
      )}

      {canSpeak ? <ChatInput /> : null}
    </Animated.View>
  )
}

function Message({ row, seat, name }: { row: Row; seat: SeatNumber | undefined; name: string }) {
  const { own, first, last, message } = row
  const { chatBubbleRadius: round, chatBubbleJoint: joint } = tokens.art
  // The speaker's side is cut tight where bubbles stack; only the run's last bubble rounds off
  // at the bottom on that side.
  const corners = own
    ? { borderTopRightRadius: joint, borderBottomRightRadius: last ? round : joint }
    : { borderTopLeftRadius: joint, borderBottomLeftRadius: last ? round : joint }

  const bubble = (
    <View style={[styles.bubble, own ? styles.bubbleOwn : styles.bubbleOther, corners]}>
      <Text style={styles.text}>{message.text}</Text>
    </View>
  )

  if (own) {
    return <View style={[styles.row, styles.rowOwn, first ? styles.runStart : null]}>{bubble}</View>
  }

  const colour = seat === undefined ? tokens.palette.boneDim : SEAT_TEXT_COLOURS[seat]
  return (
    <View style={[styles.row, first ? styles.runStart : null]}>
      <View style={styles.maskSlot}>
        {first && seat !== undefined ? <Sigil seat={seat} colour={colour} size={tokens.art.chatMask} /> : null}
      </View>
      <View style={styles.column}>
        {first ? <Text style={[styles.name, { color: colour }]}>{name}</Text> : null}
        {bubble}
      </View>
    </View>
  )
}

function ChatInput() {
  const [text, setText] = useState('')
  const [waiting, setWaiting] = useState(() => session.chatWaitMs() > 0)

  // Re-open Send when the interval has passed. Outside the Offering, a timer-driven render is fine.
  useEffect(() => {
    if (!waiting) return
    const id = setTimeout(() => setWaiting(false), session.chatWaitMs())
    return () => clearTimeout(id)
  }, [waiting])

  const trimmed = text.trim()
  const left = CHAT_MAX - text.length
  const canSend = trimmed.length > 0 && !waiting

  const send = useCallback(() => {
    if (!canSend) return
    if (session.sendChat(trimmed)) {
      setText('')
      setWaiting(true)
    }
  }, [canSend, trimmed])

  return (
    <View style={styles.inputRow}>
      <View style={styles.field}>
        <TextInput
          value={text}
          onChangeText={setText}
          maxLength={CHAT_MAX}
          placeholder="Message the others"
          placeholderTextColor={tokens.palette.boneDim}
          cursorColor={tokens.palette.bone}
          selectionColor={tokens.palette.stoneLit}
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={send}
          style={styles.input}
          accessibilityLabel="Message to the others"
        />
        {left <= tokens.art.chatCountdownFrom ? (
          <Text style={styles.left} accessibilityLabel={`${left} characters left`}>
            {String(left)}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={send}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send"
        accessibilityState={{ disabled: !canSend }}
        style={styles.send}
      >
        <SendIcon colour={canSend ? tokens.palette.gold : tokens.palette.boneFaint} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.sm,
  },
  // The line shortens from its right end towards the left, over whatever of the 45s remains.
  track: {
    height: tokens.art.councilTimerHeight,
    marginTop: tokens.space.md,
  },
  line: {
    height: tokens.art.councilTimerHeight,
    backgroundColor: tokens.palette.boneDim,
    transformOrigin: 'left',
  },
  // Clipped, and set off from the timer line, so a row scrolling out of view never touches it.
  list: {
    flex: 1,
    marginTop: tokens.space.xs,
    overflow: 'hidden',
  },
  listContent: {
    paddingVertical: tokens.space.md,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    ...tokens.type.body,
    color: tokens.palette.boneDim,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: tokens.space.sm,
    marginTop: tokens.space.xs,
  },
  rowOwn: {
    justifyContent: 'flex-end',
  },
  // A new run of messages stands apart from the one before it.
  runStart: {
    marginTop: tokens.space.md,
  },
  maskSlot: {
    width: tokens.art.chatMask,
    paddingTop: tokens.space.xs,
  },
  column: {
    flexShrink: 1,
    maxWidth: `${tokens.art.chatBubbleMaxShare * 100}%`,
    alignItems: 'flex-start',
    gap: tokens.space.xs,
  },
  // A player's name, in the display face like every name, in their seat's text colour.
  name: {
    ...tokens.type.label,
  },
  bubble: {
    borderRadius: tokens.art.chatBubbleRadius,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    maxWidth: `${tokens.art.chatBubbleMaxShare * 100}%`,
  },
  bubbleOther: {
    backgroundColor: tokens.palette.stone,
    maxWidth: '100%',
  },
  // A lighter stone step for your own voice: bone on stoneEdge measures 5.83:1.
  bubbleOwn: {
    backgroundColor: tokens.palette.stoneEdge,
  },
  text: {
    ...tokens.type.body,
    color: tokens.palette.bone,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
  },
  field: {
    ...tokens.material.insetStoneFace,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: tokens.art.chatFieldRadius,
    minHeight: tokens.layout.minTouchTarget,
    paddingHorizontal: tokens.space.lg,
    gap: tokens.space.sm,
  },
  input: {
    ...tokens.type.body,
    flex: 1,
    color: tokens.palette.bone,
    paddingVertical: tokens.space.sm,
  },
  left: {
    ...tokens.type.label,
    ...tokens.tabularFigures,
    color: tokens.palette.boneDim,
  },
  send: {
    ...tokens.material.raisedStoneFace,
    width: tokens.layout.minTouchTarget,
    height: tokens.layout.minTouchTarget,
    borderRadius: tokens.layout.minTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
