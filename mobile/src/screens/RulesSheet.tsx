import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

import { tokens } from '../design/tokens'
import { Sheet } from './Sheet'

// §7.1's rules sheet: the one source for how the rite works, opened from home's About control and,
// once the match mounts it, from the match. It is item 5's Sheet, so it opens, closes and dims the
// same way the action sheet does. It scrolls, and closes on its Close control, on a tap outside, or
// on hardware back — which the match routes through its own back handler instead.
//
// §1's fiction in §1.2's voice: second person, present tense, no exclamation marks. This is one of
// the three places §1.1's flavour survives, but every mechanic is named by its in-match word —
// lane, tap, energy, target, Inspect, Drain — so the sheet maps the story onto the controls. No
// rule numbers — those arrive with the match's config and are never hardcoded.

export function RulesSheet({ onClose, closeOnBack = true }: { onClose: () => void; closeOnBack?: boolean }) {
  const { height } = useWindowDimensions()

  return (
    <Sheet onClose={onClose} closeOnBack={closeOnBack}>
      {(close) => (
        <>
          <View style={styles.top}>
            <Text style={styles.title} accessibilityRole="header">
              How the rite works
            </Text>
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
              <Text style={styles.closeLabel}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            style={{ maxHeight: height * tokens.home.sheetMaxShare }}
            contentContainerStyle={styles.content}
            accessibilityLabel="How the rite works"
          >
            <Heading>The Rite</Heading>
            <Para>
              Reztor is a dead god. You are one of four celebrants, each kneeling at your own lane beneath what is left
              of it, and the rite must bring it back before the night ends.
            </Para>
            <Para>
              Each tap spends energy and rises through your lane into the Heart, which the match calls the board. When
              the four lanes together reach the target, the Heart breathes on its own and the rite is complete.
            </Para>
            <Para>
              Energy is bought with your stake, so every tap costs something real. A ×1 tap is cheap and gives a little.
              A ×3 tap costs more and gives more, at a worse rate.
            </Para>

            <Heading>The Hollow</Heading>
            <Para>
              One of the four is Hollow, the impostor. It wears a celebrant&apos;s robe and cannot refuse the rite where
              the others would see. So it drains one lane into another. Four parts in every ten are destroyed on the
              way. They are gone.
            </Para>
            <Para>
              A lane that falls while another rises tells you something true and not enough. The two celebrants it
              touched are both Faithful.
            </Para>

            <Heading>A round</Heading>
            <Para>Each round has three stages, and the rite lasts three rounds.</Para>
            <Para>In Tap, you fill your lane. In Discuss, you talk. In Vote, you may vote one player out.</Para>
            <Para>
              Inspect reads one lane&apos;s last round and gives one answer: filled by their own taps, received from
              another lane, or drained by someone. You may inspect once.
            </Para>
            <Para>
              A celebrant who is voted out stays to watch, and their lane goes cold. The Faithful win when the board
              reaches the target, or when the Hollow is voted out. The Hollow wins if the third round ends short of the
              target, or when two of the Faithful have been voted out and it can no longer be outvoted.
            </Para>
          </ScrollView>
        </>
      )}
    </Sheet>
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
