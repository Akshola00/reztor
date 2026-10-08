import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

import { tokens } from '../design/tokens'
import { fit } from '../design/fit'
import { Sheet } from './Sheet'

// §7.1's rules sheet: the one source for how the rite works, opened from home's About control and,
// once the match mounts it, from the match. It is item 5's Sheet, so it opens, closes and dims the
// same way the action sheet does. It scrolls, and closes on its Close control, on a tap outside, or
// on hardware back — which the match routes through its own back handler instead.
//
// Cut down at the owner's call so a player with ten seconds learns the game: six beats, each one
// large line with its key words in gold, over one small line of detail. Skimming only the gold
// teaches the game. Every mechanic is named by its in-match word (lane, tap, energy, Inspect,
// Drain), plain voice, no exclamation marks. No rule numbers but the ones the screen itself shows.

export function RulesSheet({ onClose, closeOnBack = true }: { onClose: () => void; closeOnBack?: boolean }) {
  const { height } = useWindowDimensions()

  return (
    <Sheet onClose={onClose} closeOnBack={closeOnBack}>
      {(close) => (
        <>
          <View style={styles.top}>
            <Text style={styles.title} accessibilityRole="header">
              {fit('How to play')}
            </Text>
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
              <Text style={styles.closeLabel}>{fit('Close')}</Text>
            </Pressable>
          </View>
          <ScrollView
            style={{ maxHeight: height * tokens.home.sheetMaxShare }}
            contentContainerStyle={styles.content}
            accessibilityLabel="How to play"
          >
            <Beat
              lead={
                <>
                  <Gold>Tap</Gold> to fill your lane.
                </>
              }
              note="Every tap spends Energy. The four lanes together make the board."
            />
            <Beat
              lead={
                <>
                  Fill the board to <Gold>100%</Gold> to win.
                </>
              }
              note="Three rounds, each one Tap, then Discuss, then Vote."
            />
            <Beat
              lead={
                <>
                  One of you is the <Gold>Hollow</Gold>.
                </>
              }
              note="The impostor secretly drains other lanes to keep the board short."
            />
            <Beat
              lead={
                <>
                  Talk it out, then <Gold>vote the Hollow out</Gold>.
                </>
              }
              note="Catch the Hollow and the Faithful win. Vote out two Faithful and the Hollow wins."
            />
            <Beat
              lead={
                <>
                  <Gold>Inspect</Gold> one lane, once.
                </>
              }
              note="It shows whether that lane filled itself, received from another, or was drained."
            />
            <Beat
              lead={
                <>
                  Winners split the <Gold>pot</Gold>.
                </>
              }
              note="Your unspent stake comes back to you either way."
            />
          </ScrollView>
        </>
      )}
    </Sheet>
  )
}

/** One beat of the rules: a large line, its key words in gold, over one small line of detail. */
function Beat({ lead, note }: { lead: ReactNode; note: string }) {
  return (
    <View style={styles.beat}>
      <Text style={styles.lead}>{lead}</Text>
      <Text style={styles.note}>{note}</Text>
    </View>
  )
}

/** The words a skimming player must not miss. Gold is emphasis (§3.1). */
function Gold({ children }: { children: ReactNode }) {
  return <Text style={styles.gold}>{children}</Text>
}

const styles = StyleSheet.create({
  // The title and the Close control, held above the scrolling rules so Close is always in reach.
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.layout.stackGap,
  },
  title: {
    ...tokens.type.stage,
    color: tokens.palette.bone,
    flexShrink: 1,
  },
  close: {
    ...tokens.homeFaces.secondary,
    minHeight: tokens.layout.minTouchTarget,
    paddingHorizontal: tokens.layout.screenGutter,
    justifyContent: 'center',
  },
  closeLabel: {
    ...tokens.type.control,
    color: tokens.palette.bone,
  },
  content: {
    gap: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.lg,
  },
  beat: {
    gap: tokens.space.xs,
  },
  lead: {
    ...tokens.type.rulesLead,
    color: tokens.palette.bone,
  },
  gold: {
    color: tokens.palette.gold,
  },
  note: {
    ...tokens.type.rulesNote,
    color: tokens.palette.boneDim,
  },
})
