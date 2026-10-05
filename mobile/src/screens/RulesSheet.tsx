import { useMemo, type ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native'

import { tokens, typeFor, type Palette } from '../design/tokens'
import { useLook } from './look'
import { Sheet } from './Sheet'

// §7.1's rules sheet: the one source for how the rite works, opened from home's About control and,
// once the match mounts it, from the match. It is item 5's Sheet, so it opens, closes and dims the
// same way the action sheet does. It scrolls, and closes on a tap outside or on hardware back.
//
// §1's fiction in §1.2's voice: second person, present tense, no exclamation marks. Interface
// vocabulary only (§1.1). No rule numbers — those arrive with the match's config and are never
// hardcoded.

export function RulesSheet({ onClose }: { onClose: () => void }) {
  const { height } = useWindowDimensions()
  const look = useLook()
  const palette = tokens.palettes[look.palette]
  const styles = useMemo(() => makeStyles(typeFor(tokens.fontCandidates[look.font]), palette), [look.font, palette])

  return (
    <Sheet onClose={onClose} closeOnBack style={styles.sheet}>
      <ScrollView
        style={{ maxHeight: height * tokens.home.sheetMaxShare }}
        contentContainerStyle={styles.content}
        accessibilityLabel="How the rite works"
      >
        <Heading styles={styles}>The Rite</Heading>
        <Para styles={styles}>
          Reztor is a dead god. You are one of four celebrants kneeling at four conduits beneath what is left of it, and
          the rite must bring it back before the night ends.
        </Para>
        <Para styles={styles}>
          Each offering you make is consecrated and rises through your conduit into the Heart. When the four conduits
          together reach the Threshold, the Heart breathes on its own and the rite is complete.
        </Para>
        <Para styles={styles}>
          Offerings cost you something real. A lesser offering is cheap and gives a little. A greater offering costs
          more and gives more, at a worse rate.
        </Para>

        <Heading styles={styles}>The Hollow</Heading>
        <Para styles={styles}>
          One of the four is Hollow. It wears a celebrant&apos;s robe and cannot refuse the rite where the others would
          see. So it draws consecrated matter out of one conduit and forces it into another. Four parts in every ten are
          the toll, taken in transit. They are gone.
        </Para>
        <Para styles={styles}>
          A conduit that falls while another rises tells you something true and not enough. The two celebrants it
          touched are both Faithful.
        </Para>

        <Heading styles={styles}>A round</Heading>
        <Para styles={styles}>Each round has three stages, and the rite lasts three rounds.</Para>
        <Para styles={styles}>
          In the Offering, you make offerings. In the Council, you speak. In Judgement, you may cast one out.
        </Para>
        <Para styles={styles}>
          Augury reads one conduit&apos;s last round and gives one answer: fed by its own hand, filled from elsewhere,
          or something was taken. You may read once.
        </Para>
        <Para styles={styles}>
          A celebrant who is cast out stays to watch, and their conduit goes cold. The Faithful win when the Heart
          wakes, or when the Hollow is cast out. The Hollow wins if the third round ends with the Heart still dead, or
          when two of the Faithful have been cast out and it can no longer be outvoted.
        </Para>
      </ScrollView>
    </Sheet>
  )
}

type Styles = ReturnType<typeof makeStyles>

function Heading({ styles, children }: { styles: Styles; children: ReactNode }) {
  return (
    <Text style={styles.heading} accessibilityRole="header">
      {children}
    </Text>
  )
}

function Para({ styles, children }: { styles: Styles; children: ReactNode }) {
  return <Text style={styles.para}>{children}</Text>
}

function makeStyles(type: ReturnType<typeof typeFor>, palette: Palette) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: palette.stone,
      borderTopColor: palette.stoneLit,
    },
    content: {
      gap: tokens.layout.stackGap,
    },
    heading: {
      ...type.stage,
      color: palette.bone,
      marginTop: tokens.layout.stackGap,
    },
    para: {
      ...type.body,
      color: palette.boneDim,
    },
  })
}
