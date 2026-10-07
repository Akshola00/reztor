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
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import type { ChatMessage, MatchConfig, PlayerId } from '../../protocol/generated'
import { SEAT_TEXT_COLOURS, Sigil, type SeatNumber } from '../art/Sigil'
import { motion } from '../design/motion'
import { tokens } from '../design/tokens'
import { CHAT_MAX, match, session } from '../net/session'
import { usePolled } from './Offering'

// §7.5, the Council stage's lower region. Plain rows — sigil, name, message — with no bubbles, no
// read receipts and no timestamps. The stage's time runs as a thin line shortening across the
// top, never as a number.
//
// The history is the match store's: CHAT_MESSAGE appends, RESUME_STATE replaces it with the
// server's backlog, and the store drops a message it already holds, so a reconnect never
// duplicates a row.
//
// **The input sits at the top of the region, under the timer line, and the newest message sits
// directly below it.** The app pans its window for the keyboard (app.config.js,
// softwareKeyboardLayoutMode 'pan'), and an input at the bottom made Android pan the board off the
// top of the screen. An input above the keyboard gives it nothing to pan, so the board stays put.
// Chosen by the owner in item 4 over switching the window to 'resize'.
//
// Both of the server's chat limits are enforced here, so CHAT_RATE_LIMITED never fires: 240
// characters by the input's maxLength, and one message per 2 seconds (plus a tick of margin) by
// holding the send control until the interval has passed.

/** How close to the top, in dp, still counts as "reading the newest message". */
const AT_NEWEST_SLOP = 24

/** PROTOCOL.md §7: one tick is 250ms. */
const TICK_MS = 250

type CouncilProps = {
  config: MatchConfig
  seats: Record<PlayerId, SeatNumber>
  /** False for a cast-out player: the input is removed, not disabled. */
  canSpeak: boolean
}

const readChatLength = () => match.snapshot()?.chat.length ?? 0

export function Council({ config, seats, canSpeak }: CouncilProps) {
  usePolled(readChatLength)
  const snapshot = match.snapshot()
  // Newest first, so the newest message sits under the input.
  const chat = [...(snapshot?.chat ?? [])].reverse()
  const names = new Map((snapshot?.players ?? []).map((p) => [p.id, p.name]))

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

  // -- Follow new messages only when the reader is already at the newest ------------------------
  //
  // maintainVisibleContentPosition holds a reader's place when a message arrives above them; the
  // explicit scroll brings the newest into view only if they were already there.
  const list = useRef<FlatList<ChatMessage>>(null)
  const atNewest = useRef(true)
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    atNewest.current = e.nativeEvent.contentOffset.y <= AT_NEWEST_SLOP
  }
  const onContentSizeChange = () => {
    if (atNewest.current) list.current?.scrollToOffset({ offset: 0, animated: true })
  }

  return (
    <View style={styles.root}>
      <View style={styles.track}>
        <Animated.View style={[styles.line, lineStyle]} />
      </View>

      {canSpeak ? <ChatInput /> : null}

      <FlatList
        ref={list}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={chat}
        keyExtractor={(m) => `${m.from}:${m.tick}`}
        onScroll={onScroll}
        scrollEventThrottle={motion.readoutInterval}
        onContentSizeChange={onContentSizeChange}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty}>The Council is silent.</Text>}
        renderItem={({ item }) => {
          const seat = seats[item.from]
          return (
            <View style={styles.row}>
              {seat === undefined ? null : (
                <Sigil seat={seat} colour={SEAT_TEXT_COLOURS[seat]} size={tokens.art.sigilSmall} />
              )}
              <Text style={styles.message}>
                <Text style={styles.name}>{names.get(item.from) ?? ''}</Text>
                {`  ${item.text}`}
              </Text>
            </View>
          )
        }}
      />
    </View>
  )
}

function ChatInput() {
  const [text, setText] = useState('')
  const [waiting, setWaiting] = useState(() => session.chatWaitMs() > 0)

  // Re-open the send control when the interval has passed. Outside the Offering, a timer-driven
  // render is fine.
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
      <TextInput
        value={text}
        onChangeText={setText}
        maxLength={CHAT_MAX}
        placeholder="Speak to the Council"
        placeholderTextColor={tokens.palette.boneDim}
        cursorColor={tokens.palette.bone}
        selectionColor={tokens.palette.stoneLit}
        returnKeyType="send"
        submitBehavior="submit"
        onSubmitEditing={send}
        style={styles.input}
        accessibilityLabel="Message to the Council"
      />
      {left <= tokens.art.chatCountdownFrom ? (
        <Text style={styles.left} accessibilityLabel={`${left} characters left`}>
          {String(left)}
        </Text>
      ) : null}
      <Pressable
        onPress={send}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Speak"
        accessibilityState={{ disabled: !canSend }}
        style={styles.send}
      >
        <Text style={[styles.sendLabel, canSend ? null : styles.sendLabelDisabled]}>Speak</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: tokens.layout.screenGutter,
    paddingBottom: tokens.layout.stackGap,
  },
  // The line shortens from its right end towards the left, over whatever of the 45s remains.
  track: {
    height: tokens.art.councilTimerHeight,
    marginTop: tokens.layout.stackGap,
  },
  line: {
    height: tokens.art.councilTimerHeight,
    backgroundColor: tokens.palette.boneDim,
    transformOrigin: 'left',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: tokens.layout.stackGap,
    gap: tokens.layout.stackGap,
  },
  empty: {
    ...tokens.type.body,
    color: tokens.palette.boneDim,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: tokens.art.namePlateGap * 2,
  },
  message: {
    ...tokens.type.body,
    color: tokens.palette.bone,
    flex: 1,
  },
  // A player's name, in the display face like every name; the message beside it stays in the sans.
  name: {
    fontFamily: tokens.fontFamily.display,
  },
  inputRow: {
    marginTop: tokens.layout.stackGap,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.layout.stackGap,
  },
  input: {
    ...tokens.type.body,
    ...tokens.material.insetStoneFace,
    flex: 1,
    color: tokens.palette.bone,
    borderRadius: tokens.radii.chip,
    minHeight: tokens.layout.minTouchTarget,
    paddingHorizontal: tokens.layout.screenGutter,
  },
  left: {
    ...tokens.type.label,
    ...tokens.tabularFigures,
    color: tokens.palette.boneDim,
  },
  send: {
    ...tokens.material.raisedStoneFace,
    borderRadius: tokens.radii.chip,
    minHeight: tokens.layout.minTouchTarget,
    paddingHorizontal: tokens.layout.screenGutter,
    justifyContent: 'center',
  },
  sendLabel: {
    ...tokens.type.control,
    color: tokens.palette.bone,
  },
  sendLabelDisabled: {
    color: tokens.palette.boneFaint,
  },
})
