# Reztor — Design Specification

**Companion to:** `reztor-mvp-spec.md` (mechanics, economy, netcode) and `CLAUDE.md` (stack, conventions)
**Target:** React Native + Expo, Android
**Scope:** fiction, visual identity, screens, components, motion, audio
**Status:** authoritative for all presentation decisions

---

## 0. How to use this document

`reztor-mvp-spec.md` defines what the game _does_. This document defines what it _is_. Where the two conflict on naming, this document wins for anything a player sees; the mechanics spec wins for anything the server computes.

Three rules that override convenience:

1. **Never draw a connection between two conduits.** See §6.3. This is a gameplay requirement disguised as an art note, and breaking it breaks the game.
2. **Blue fire means progress and nothing else.** It is never used for player identity, buttons, links, or decoration. See §3.1.
3. **Read §4 before writing any styles.** It lists the specific visual defaults that would make this look generated, and they must be actively avoided rather than passively not-chosen.

---

## 1. Fiction

Reztor is a dead god. Not a metaphor in the interface — the thing on screen is a god, and it is dead, and the players are trying to bring it back before the night ends.

Four celebrants kneel at four conduits beneath the vessel that holds what is left of it. Each offering they make is consecrated and rises through their conduit into the heart above. When the heart has taken enough — the Threshold — it breathes on its own and the rite completes.

Offerings cost the celebrant something real. That is why the rite works, and it is why tapping costs tokens. The fiction and the economy are the same fact.

One of the four is **Hollow**. It wears a celebrant's robe and it cannot refuse the rite outright — the other three would see. So it does the only thing it can do: it **draws** consecrated matter out of one conduit and forces it into another. Four parts in every ten are the **toll**, taken in transit by the thing that made it Hollow. Gone.

This is why sabotage looks like generosity. One conduit falls, another surges, and the two celebrants involved are both provably faithful. Everyone watching learns something true and insufficient.

### 1.1 Vocabulary

**The owner's call, for the demo: clarity beats flavour in anything shown during a live match.** Every in-match string — the board, the controls, the sheets, the stage panels, the Reckoning's tables — leads with the plain word. The flavour word survives in three places only: the About sheet ("How the rite works"), the Reckoning's headline, and the role reveal. Even there, the About sheet names each mechanic by its plain word so it maps the story onto the controls. Code, logs and message types keep the right column.

| In match (plain)       | Flavour (About, headline, role reveal) | Spec / code             |
| :--------------------- | :------------------------------------- | :---------------------- |
| the match / the rite   | the Rite                               | the match               |
| the board              | the Heart / the vessel                 | the board               |
| lane                   | conduit                                | lane                    |
| the target             | the Threshold                          | win target (2400)       |
| tap                    | offering                               | tap                     |
| ×1 / ×3, with the cost | lesser / greater offering              | tier 1 / tier 2         |
| Energy                 | —                                      | credits                 |
| the Faithful           | the Faithful                           | crew                    |
| the Hollow             | the Hollow                             | impostor                |
| Drain                  | the Draw                               | siphon                  |
| progress destroyed     | the toll                               | units destroyed         |
| Inspect                | Augury                                 | trace                   |
| Tap / Discuss / Vote   | Offering / Council / Judgement         | tap / chat / vote stage |
| voted out              | cast out                               | ejected                 |
| cold (a lane)          | cold                                   | dormant                 |
| Results                | the Reckoning                          | match end screen        |
| the Rite is broken     | the Rite is broken                     | match voided            |

**Hollow and Faithful are kept**, and glossed once, in the role reveal: the Hollow is "the impostor", the Faithful "one of the three honest players".

Inspect results: `natural` → **"Filled by their own taps"**, `received` → **"Received from another lane"**, `drained` → **"Drained by someone"**. The Drain sheet's running count reads **"You've destroyed 200 progress."**

**Energy and progress are kept apart, at the owner's call.** _Energy_ is strictly the spendable resource — what a tap, an Inspect or a Drain costs (spec: credits). _Progress_ is what a lane holds and the board adds up (spec: units); a drain destroys progress, never energy. No string uses one word for the other.

### 1.2 Voice

Second person, present tense, no exclamation marks anywhere in the product. The interface is a liturgy, not a narrator — it states conditions, it does not comment on them.

- Good: "Your conduit is falling." / "Two remain. The rite ends here."
- Bad: "Oh no! Someone's draining you!" / "Time to vote — who's sus?"

Errors do not apologise and are never vague. "The offering was not accepted — you have 3 credits." Empty and waiting states are instructions, not mood: "Three kneel. One seat is empty."

---

## 2. Audience and constraints

Mobile portrait, 360–430px wide, played one-handed with a thumb, frequently inside Phantom's in-app browser on a mid-range Android phone. Sessions are six minutes and the player is mashing the screen for three of them.

This forces the following, and no visual idea survives contact with them:

- **First paint under 2s on 4G.** No WebGL, no heavy runtime, no font flash that reflows the board.
- **Sustained 60fps while tapping 6×/sec.** Only `transform` and `opacity` animate. Nothing animates `height`, `width`, `top`, or `filter` during the Offering stage.
- **Legible at a glance.** During tapping the player's eyes are on their own conduit and the board percentage. Everything else must be readable in peripheral vision or it does not need to be on screen.
- **Thumb reach.** Every control used during the Offering stage sits in the bottom 40% of the viewport.

---

## 3. Visual identity

Cold, carved, and lit from within. The world is stone and char; the only warm thing is blue and it is not warm.

### 3.1 Palette

These live in `src/design/tokens.ts` as a typed object. The CSS-variable form below is notation for readability only — there is no stylesheet.

**The home rebuild lifted this palette, at the owner's choice, provisional until he checks it on the S10.** The ground was compressed and panels barely separated from the background, so every step above `--void` was lightened by a growing factor; `--flame-deep` gained saturation and lightness, `--gold` luminance at its own hue, and `--toll` turned from brown toward crimson. The values below are the lifted ones. `--void`, `--flame`, `--flame-cold`, `--flame-white`, the bones and the mantles are unchanged; the frontier is still the brightest element and every text pairing still clears 4.5:1, the tightest being `--bone` on `--stone-lit` at 4.51:1.

```css
/* Ground — the temple */
--void: #0b0d12; /* page background, deepest */
--char: #1a1e27; /* unconsecrated conduit fill */
--stone: #272c39; /* architecture, panels, plinth */
--stone-edge: #465066; /* carved edges, dividers, borders */
--stone-lit: #556177; /* raised faces, pressed states */

/* Fire — consecrated matter. PROGRESS ONLY. */
--flame-deep: #0865c3; /* base of the fill */
--flame: #3e9be0; /* body of the fill */
--flame-cold: #7fe3ff; /* the frontier line */
--flame-white: #e4f8ff; /* frontier peak, threshold crossing */

/* The toll — loss, drain, damage */
--toll: #9f2734; /* dried blood; embers of what was taken */
--toll-smoke: #51242a; /* residue at a falling frontier */

/* Settlement */
--gold: #d9b33b; /* value and emphasis; payouts and refunds */

/* Type */
--bone: #d8dbe2; /* primary text */
--bone-dim: #8a93a5; /* secondary text */
--bone-faint: #545c6c; /* disabled, timestamps */
```

**Blue fire is reserved.** `--flame*` appears in exactly four places:

1. the conduit fill;
2. the Threshold marks, when crossed;
3. the board percentage, during the crossing moment only — it sits in `--bone` for the rest of the match and takes fire once;
4. the Faithful's mark in the Marking (§7.2), in `--flame-cold`. This one is private, fires once per match, and is never seen by another player, so it cannot teach anything that contradicts the other three.
5. the offering spark at the touch point (§7.3), in `--flame-cold`. A spark is an offering entering the conduit, so it is progress by the same rule as the fill — it is the player's own tap becoming units, and it is the only fire that appears outside a conduit during the Offering stage.

Not on buttons, not on focus rings, not on the active tab, and not on the tap band's face — the spark sits on the band, the band itself is never fire. A player must be able to learn "blue = progress" in round one and never have that contradicted.

**Player identity is a mantle colour plus a sigil**, never fire. The four mantles are muted so they cannot be confused with the fill:

```css
--seat-1: #4e7c6b; /* verdigris */
--seat-2: #a8813f; /* ochre */
--seat-3: #7a3b3b; /* oxblood */
--seat-4: #6c7a99; /* slate */
```

**A mask drawn small on bare ground takes a lightened mantle.** In Discuss's masks and names and the Reckoning's tables and vote history, a 16dp mask is a stroke about 1dp wide, thinner than any glyph, and `--seat-3` is 2.33:1 on `--void`. Each text variant is its mantle mixed toward `--bone`, the way `tollText` was derived, by the smallest step that clears 4.5:1 on `--stone`. All four land within 0.1 of each other, so no seat's mask reads louder than another's. Tokens on a stone disc (the riding token, vote tokens, the lobby roster, the Hollow mark, the Marking) are 18dp and up and keep the mantle itself.

```css
--seat-1-text: #7a9a91; /* 32% toward bone: 6.35:1 on void, 4.56:1 on stone */
--seat-2-text: #af8e56; /* 14%: 6.32 / 4.53 */
--seat-3-text: #a98b8f; /* 50%: 6.27 / 4.50 */
--seat-4-text: #8893ac; /* 26%: 6.31 / 4.53 */
```

Each seat also carries a distinct carved mask (§5.2).

**Gold is no longer SKR-only.** Since the owner's UI pass it is the accent for value and emphasis across the app: the energy mark, the chosen tap size, the tap band's gold rim, Send in Discuss, your vote — a gold ring round the mask you chose, or a gold edge round Skip — and the Reveal's marks. Payouts and refunds stay gold. Blue stays progress-only, unchanged — gold never marks progress. Identity is never carried by colour alone — this covers colourblind players and also solves a real problem, which is that four muted colours at thumb-size on a dim phone screen are genuinely hard to tell apart.

### 3.2 Typography

Two families, both from Google Fonts, both self-hosted and preloaded. **Since the owner's type-role remap, the display face is the interface**: Grenze Gotisch sets every short string on screen, and the sans is left with running text.

**Display — Grenze Gotisch 700. Every short string.** Buttons and controls, labels, player names everywhere, headings and section titles, and every number — the stage timer, the energy readout, the tap-size toggle, the Reckoning table — except the board percentage, which is Oswald (below). **Floor: 14px**, overriding the old 20px floor. Each step was checked on the emulator: labels at 14, controls and names at 15 and the timer at 20 all read cleanly. Two short strings are named exceptions and stay in the sans, below.

**Grenze's figures.** Its default digits are old-style — 3, 4, 5, 7 and 9 descend about 0.1em — which muddies a 14px number. Its `tnum` feature substitutes tabular _lining_ figures, all 0.500em wide and 0.58em tall, so `tokens.tabularFigures` goes on every Grenze number: that one declaration makes it both fixed-width and lining, confirmed on the device. The board percentage takes them too, at the owner's call — old-style digits rising and falling four times a second read as jitter on the number people watch most — and keeps its fixed digit slots.

**Running text — Barlow Semi Condensed 600.** Chat message bodies, the rules sheet's paragraphs, and sentence-length notices and errors — anything that reads as a sentence. Also the `--t-fine` step, which sits below Grenze's floor and is kept for one-line notes.

**Named exceptions — short strings in the sans:**

1. **The gathering code**: the lobby's code at `--t-heart` and home's code cells at `--t-display`, at the owner's call. A code is read aloud across a room, and in a live lobby Grenze's X, T, A and the N–U minim pair were blackletter forms that had to be decoded ("BYXM"). A code nobody can say is a gathering nobody can join.
2. **The wallet address.** Base58 mixes cases, and Grenze's blackletter capitals (T, K) became pen forms that had to be decoded at 20px. It is checked character by character, like the role seed.

Neither face carries U+27E1 (SKR) or U+2192 (the tier face's arrow): both are drawn as SVG marks, never set as text.

**The board percentage is Oswald 600**, the owner's choice in the UI pass over Grenze Gotisch, Barlow Semi Condensed and Cinzel: it is the biggest number on screen and the one that must read at a glance mid-tap, and Oswald is condensed, tall and plain, with lining digits. It is the third face in the product and sets nothing else. Oswald carries no `tnum` — its digits run 0.384em to 0.543em — so each digit sits centred in a fixed slot of 0.56em and the number never walks sideways; the `%` takes its own width. The line is 64 against a 56 size, because Oswald's ascent runs past 1em.

```css
--type-display: 'Grenze Gotisch', Georgia, serif; /* every short string */
--type-text: 'Barlow Semi Condensed', system-ui, sans-serif; /* running text */
```

Scale, mobile-first:

| Token         | Size / line-height | Face    | Use                                                                     |
| :------------ | :----------------- | :------ | :---------------------------------------------------------------------- |
| `--t-heart`   | 56 / 1.0           | display | Wordmark; the board percentage (Oswald, 56 / 64); the lobby code (text) |
| `--t-display` | 32 / 1.1           | display | Role reveal, Reckoning verdict (code cells: text)                       |
| `--t-stage`   | 20 / 1.2           | display | Stage names, headings, the primary action, the stage timer              |
| `--t-control` | 15 / 1.5           | display | Buttons and controls, names at reading size                             |
| `--t-body`    | 15 / 1.5           | text    | Chat bodies, paragraphs, notices                                        |
| `--t-data`    | 14 / 1.2           | display | Credits, counts, the round                                              |
| `--t-label`   | 14 / 1.2           | display | Labels, names in rows, table headings                                   |
| `--t-fine`    | 12 / 1.3           | text    | One-line notes                                                          |

Body copy never exceeds 65 characters per line. No text is set in all caps — stage names use Grenze Gotisch in sentence case and get their weight from the typeface, not from letter-spacing.

### 3.3 Material

Everything is carved, not stacked. Depth comes from a light edge on top and a dark edge below — a bevel cut into stone — rather than from drop shadows.

```ts
// A raised stone face
{
  backgroundColor: tokens.stone,
  borderTopWidth: 1,
  borderTopColor: tokens.stoneLit,
  borderBottomWidth: 1,
  borderBottomColor: '#0A0C10',
}
```

No `elevation` and no `shadowColor` anywhere. Android's elevation shadow is the single fastest way to make this look like a stock Material app.

Corner radius encodes hierarchy rather than being applied uniformly: major panels are `2` (cut stone), interactive chips and buttons are `4`, and the conduits have no radius at all because they are apertures, not objects. There are two named exceptions. The tap band's top corners round at 28pt (§7.3). And Discuss is a modern messenger, at the owner's call: its bubbles round at 16 with the speaker's side cut to 4 where they stack, its input field is a pill (22) and its Send button is round (§7.5). Nothing else in the interface is a rounded card with a soft grey shadow.

A single grain texture sits above the background and below content — a small tiled PNG in an absolutely positioned `Image` with `resizeMode="repeat"` at 3% opacity and `pointerEvents="none"`. It does not animate.

---

## 4. What this must not look like

These are the specific failure modes. Treat each as a lint rule.

- **No glassmorphism.** No `backdrop-filter: blur()`, no translucent panels with a 1px white-at-10% border. The world is opaque stone.
- **No purple-to-blue gradient background.** The background is flat `--void` with grain. Gradients appear only inside the conduit fill.
- **No neon glow on everything.** Fire glows. Two or three things per screen glow. Buttons, borders, and text do not.
- **No emoji, anywhere,** including in chat placeholder text and empty states. Sigils and drawn icons only.
- **No Inter, no Space Grotesk, no monospace for small labels.**
- **No tracked-out all-caps eyebrow labels** above headings ("YOUR ROLE", "CURRENT STAGE"). If a label is necessary the heading was not clear enough.
- **No 01 / 02 / 03 numbered markers.** Rounds are numbered because rounds are a sequence; nothing else is.
- **No `→` appended to button text.** §7.3's tier face (`1 ⟡ → 1`) is permitted and is not an exception to the spirit of this rule: there the arrow is notation for "this cost yields this much", sitting between two numbers. What is banned is the arrow as a call-to-action, tacked onto a label to point at the next screen.
- **No identical rounded cards** carrying every piece of content.
- **No fade-and-slide-up on every element that mounts.** Motion is budgeted; see §8.
- **No `#0B0B0B` or `#111`** standing in for the background — use `--void`, which is cold on purpose.

If a screen is finished and it would be equally at home in a DeFi dashboard, it is wrong regardless of how clean it looks.

---

## 5. The Faithful

### 5.1 Form

**The hooded figures are cut** (BUILD-PLAN.md §2). There is no body, no hood, no face and no mantle drape anywhere in the product.

A player's form is their **sigil token**: the seat sigil on a small stone disc, riding the surface of their own conduit, per §6.2. That is the whole of it.

The token carries identity by shape first (§5.2), by position second — where it sits on the conduit is that player's standing in the rite, readable at a glance across all four — and by colour only as reinforcement. It must stay distinguishable by shape alone at its on-board size.

### 5.2 Masks

**The owner's call: each seat wears a carved stone mask, replacing the four geometric sigils.** The sigils were icons, not identities — a circle crossed by a bar read as a no-entry sign, the square with a gap as a bracket. The fiction is four celebrants at a rite, one of them wearing a face that is not theirs, and masks say that. The code still calls the component `Sigil`.

Four masks, drawn as flat strokes in the seat colour, no gradients, one stroke weight across all four so none reads as more important. **They are told apart by outer silhouette alone**, because the riding token draws them at 18dp:

1. **Seat 1 — Horned.** Two points flaring out from the top corners. Eyes level.
2. **Seat 2 — Beaked.** A round face with a crow's beak off one side, its ridge running on from the brow and hooking down at the tip — the only mask that is not symmetrical. Eyes downturned. A single point below the chin read first as a map pin and then as a speech bubble's tail, beside the chat rows; a straight point off the side still read as a bubble. The curve and the hook are what make it a beak.
3. **Seat 3 — Crested.** A row of three equal points along the top edge. Eyes upturned. The points are equal and low: a tall middle point read as a flame.
4. **Seat 4 — Veiled.** A plain dome on straight sides to a flat hem, defined by having no projection. Eyes level and set wide, clear of the sides.

Every mask has the same two eye voids, a short slit; only their angle and spacing vary, because an angle survives small sizes and an eye's shape does not. Seat colour is the stroke, so identity is always shape plus colour, never colour alone.

**Checked on the emulator before wiring**: all four at 16, 18, 22, 30 and 48dp, and again at 18dp as solid filled silhouettes with no eyes. Each could be named from its outline alone at 18dp. The beak was re-checked the same way when it was reshaped, against the other three and beside a live chat row.

Masks appear on the riding token, beside names in chat, on vote tokens, in the lobby roster, in the Reckoning's tables, vote history and Hollow mark, and in the Marking. They are the primary identity carrier everywhere. The geometric sigils remain behind a dev chip on home for comparison.

### 5.3 States

The five figure states are cut with the figures. Two survive, carried by the token:

| State           | Treatment                                                                                                                       |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| Cold (cast out) | Disc at 40% opacity, sigil in `--bone-faint`. It stays that way for the rest of the match.                                      |
| Disconnected    | Token face at 60%, mask still readable, ringed by a thin `--bone-faint` outline. No badge, no countdown on anyone else's token. |

**Disconnected was 25% opacity with nothing else marking it**, and on a lit conduit the token all but vanished. Who is missing is information the others need, so the mask stays readable and the outline carries the absence. The outline stands a little off the disc so it reads as a ring of its own, not as the disc's carved edge.

**Starved is cut.** A conduit that lost ground already says so: the frontier descends, carrying its surface and its token down with it, and `--toll` embers rise from the new frontier (§6.3). That is the information, and a second channel for it would only risk implying a direction, which §6.3 forbids.

Idle breathing and the channelling lean are cut with the figures and are not reassigned to the token. The token moves when the conduit moves and at no other time.

There is no "Hollow" token state. The Hollow's conduit and token look exactly like everyone else's on every client, including their own.

---

## 6. The board

### 6.1 Composition

**The owner's UI pass (part 1) rebuilt this screen for a judge's first impression: clarity beats flavour in anything shown during a live match.** Four lanes run edge to edge across the screen with no outer margins, divided by a **2pt carved seam in `--bevel-shadow`** rather than gaps of background, so the board reads as one stone surface with cut divisions rather than four panels. They fill upward from their bases. Each one's surface is a gentle convex arc rather than a flat line, and the owner's mask token rides that surface. A short carved target mark crosses each lane at 60% of its height. A header sits above them — the rules control and the round, the percentage, the stage timer — and the controls row and the tap band sit below.

**Hard rule 1 still stands: the lanes never touch.** A falling surface beside a rising one must not read as flow, or the Hollow is identified in round one. The seam is the row's own background showing between the lanes, so whatever the layout engine does when it rounds a fractional lane width, the remainder shows as seam and never as two surfaces meeting; each aperture keeps its own walls and clips its own surface and glow. Measured on the emulator, the seam renders as a solid dark run of 10px at 360dp and 8px at device width (448dp) — 4 to 6px on a real 360dp phone at 2–3× density.

**The header.** The rules control is the About mark (a square on its point); it opens the rules sheet in every stage and sits out of thumb reach. The round reads _Round_ in `--bone-dim` at `--t-data` beside its number in `--bone` at `--t-stage`, so it carries weight against the percentage. The stage timer is `--t-stage` Grenze Gotisch with tabular lining figures, in `--bone`, on a small raised stone chip; while the stage runs the chip breathes — it swells and a `--stone-lit` face fades up inside it, quickening at 20, 10 and 5 seconds left — and the number itself never dims, so the pulse reads as deliberate rather than as a glitch. Under reduce motion it holds still. The percentage is Oswald 600 (§3.2).

```
┌──────────────────────────────────┐
│ ◇ Round 2         58%     [0:41] │  ← round · percentage · timer chip
│┌───────┬───────┬───────┬────────┐│
││       │       │       │        ││  ← lanes edge to edge, carved seams
││       │       │ ╭───╮ │        ││  ← surface: a convex arc
││       │       │ │ ◈ │ │        ││  ← mask token rides the surface
│├───────┼───────┤▓▓▓▓▓▓▓├────────┤│  ← target, carved per lane
││ ╭───╮ │       │▓▓▓▓▓▓▓│ ╭───╮  ││
││ │ ◇ │ │ ╭───╮ │▓▓▓▓▓▓▓│ │ ◻ │  ││
││▓▓▓▓▓▓▓│▓▓▓▓▓▓▓│▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓││
│└───────┴───────┴───────┴────────┘│
│ [•×1|•••×3]  ⚡847   [Inspect][Drain]│  ← tap size · energy · two icon buttons
│▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔│
│               Tap                │  ← the tap band, full-bleed, to the bottom
│                                  │
└──────────────────────────────────┘
```

Lane width is derived, never fixed: `(screen width − 3 × seam) / 4`.

**One spacing scale** (`tokens.space`: 2, 4, 8, 12, 16, 24, 32), applied to every inset, margin and gap on this screen: `16` is the edge of every text row, `8` the gap between controls and inside them, `4` between a mark and the number it qualifies. The audit found five unrelated values (10, 12, 16, 24, 28) on the old screen.

Vertical budget on an 844pt viewport: header 64pt, lanes flexing to fill (280pt minimum), controls row 72pt (a 56pt control with 8pt above and below), then the tap band at 240pt running to the bottom edge with no gap. The lanes take the slack, so they are always the largest thing on screen. The header grew from 48pt because, with the lanes now starting right under it, a 56pt percentage in a 48pt band had its feet cut off.

**Your own lane is marked by a larger mask token with a `--bone-dim` ring**, not coloured differently. That is the only difference; everyone's lane renders identically otherwise.

### 6.2 Conduit rendering

Each conduit is a fixed-height SVG aperture. The fill is a `<rect>` inside a clip path, animated with `transform: scaleY()` anchored at the bottom. Never animate height.

- **Unfilled** is `--char` with a faint vertical grain, not pure black — the conduit is stone, not a hole.
- **Fill** is a two-stop vertical gradient, `--flame-deep` at the base to `--flame` near the frontier. `--flame-deep` holds the lower seven-eighths and the ramp to `--flame` is confined to the top eighth, so the surface crowns and the frontier keeps the brightest value. Item 1c judged this on the phone against a darker base (`--flame-deep` mixed toward `--char`, ramping across the top third) and against a translucent body that let the char grain read through the fire; both were rejected and this distribution ships. The fill is opaque — the carved Threshold mark passes behind it and is not visible through it.
- **The frontier** is a 2px `--flame-cold` line at the top of the fill with a tight 6px glow. This is the element the eye tracks, and with no vessel on screen it carries the brightest value in the product.
- **Cold conduits** (cast out) desaturate to 45% and the frontier line goes flat `--bone-faint`. The fill stays — the progress is still counted.
- **Cap behaviour**: at 1000 units the frontier meets the top and the glow doubles briefly, once, then settles. Additional offerings produce no visual change, which is the honest representation of the hard cap. The surface and its token stay fully inside the aperture at capacity — neither is ever clipped by the lip.
- **The surface is a convex arc**, not a flat line, spanning the full conduit width and rising by a fixed arc height at its centre. The frontier line and its glow follow that arc. Built as a cap shape that translates with the frontier while the fill below it keeps `scaleY`, so a change in units still moves nothing but `transform` and `opacity`.
- **The sigil token rides the surface.** The conduit owner's sigil sits on a small stone disc with §3.3's raised bevel, stroked in the seat colour, and carries the same vertical translation as the surface. It rests at the conduit base at 0 units. On a cold conduit the disc drops to 40% opacity and the sigil goes `--bone-faint`.

### 6.3 The Draw — the critical constraint

**Do not draw an arc, line, particle stream, or any other visual connecting a falling conduit to a rising one.** Do not stagger the two animations so that one appears to cause the other. Do not flash both simultaneously.

The reason is structural. The server broadcasts only lane positions, never siphon events, so the client has no legitimate knowledge of a pairing. If the interface invents one, then in a four-player match a spectator who sees A drain into B knows that neither A nor B is Hollow, and since they know they are not Hollow themselves, they have identified the fourth player with certainty in round one. The entire deduction layer collapses.

What the client renders instead, purely from position deltas:

- **A conduit that fell this tick**: the frontier descends, carrying its surface and token down with it, and `--toll` embers rise from the new frontier line and fade within 400ms. That is all.
- **A conduit that rose faster than one player could plausibly tap**: nothing special. It just rose. The ambiguity between a fast tapper, a greater offering, and a Draw sink is the game, and the interface must not resolve it.

The descent of a drained frontier is deliberately slowed to ~400ms so it reads as a drain rather than a rendering glitch, but it carries no directional information.

### 6.4 The Threshold crossing

The Heart is not drawn. It remains the name of the board in the fiction and in §1.1's vocabulary — the players are feeding it and the percentage is how full it is — but there is no vessel on screen. The board's state is carried by the four conduits and the percentage in the header.

The crossing is the one orchestrated moment:

- **At the Threshold**: the Threshold marks ignite across all four conduits, and the board percentage takes a `--flame-white` flood. This is the only time fire touches the percentage (§3.1). It fires once per match and is the only unprompted spectacle in the product. Everything else must stay quiet so that this lands.
- Above the Threshold the marks stay lit and the percentage returns to `--bone`. Nothing escalates further — the percentage caps at 100%.

---

## 7. Screens

### 7.1 The flow

Six places, not twelve screens. Everything inside a match is one screen driven by the server's stage — see BUILD-PLAN.md §3 for the routes.

1. **Splash** — native, held until the fonts resolve. No content of its own.
2. **Home** — two states, both over an idle board: four conduits at fixed, staggered low levels, decoration and never state, whose only motion is one slow pulse of glow on the frontiers.
   - **No wallet**: the wordmark, the idle board, one primary action (connect a wallet), and the About control.
   - **A wallet**: a wallet strip shown off rather than tucked away (the shortened address, the faucet in `--gold` behind two struck stone coins bearing the SKR mark, a way out), then a name (label and text centred), the primary action (open a gathering), join by code in four character cells with Join on its own full-width line beneath them, and the About control.
   - **The primary action is unmistakable when it can be pressed, and visibly not when it cannot**: enabled it takes its full face; disabled it becomes an empty slot cut into the stone, darker than any face, with a faint label. Every disabled control on home takes that slot.
   - **The code cells have four states**: empty; awaiting the next character (a full-bone rim, only while typing); filled (a lit stone face); and complete, when all four take the bone rim and the row reads as sealed.
   - **About is behind a control, not inline.** It is labelled _"How the rite works"_, sits as tall as the primary action so a new player finds it unprompted, and opens the rules sheet — one source for home and the match, where the header's rules control opens it. It scrolls, and closes on its Close control, on a tap outside, or on hardware back.
3. **Lobby** — the invite code set large enough to read aloud across a room, seats filling as players arrive, and a leave control.
4. **Match — one screen.** It never remounts; a remount loses the conduit animation state and reads as a flicker.
   - **The Marking** plays as a full-screen overlay at match start and lifts to reveal the board beneath it. It is not a route.
   - **Offering, Council and Judgement** change the lower region automatically on the server's stage. They are phases of one screen, not dismissible modals — there is nothing to close and no way to be in the wrong one.
   - **The rules sheet** can be opened at any time. **The action sheet** holds Augury, plus the Draw for the Hollow (§7.4).
   - **The vote reveal and Cast Out** are brief overlays over the board.
   - **The leave confirmation** states plainly that the stake is forfeit.
5. **The Reckoning** — the full post-mortem.
6. **Broken states** — void, refund, disconnect past the grace period.

### 7.2 The Marking (role reveal)

This is the most important four seconds in the product and it happens before the player has done anything. It sets whether the rest of the match feels tense or trivial.

**It is an overlay inside the match screen, not a route.** It covers the board at match start and lifts to reveal it, so the board is already mounted and already correct underneath — no navigation, no remount, nothing to skip.

Full bleed `--void`. The player's own sigil token alone, centred, larger than it will ever appear again. A mark is drawn onto the stone around it, stroke by stroke, over about 1.2s.

- **Faithful**: the mark completes in `--flame-cold` and the token's ring steadies. Line: _"You are Faithful. Feed the Heart."_
- **Hollow**: the mark completes and then **inverts to `--toll`**, and the token's ring dims rather than brightens. Line: _"You are Hollow. The Heart must not wake."_ Below it, quieter: _"You may take from one conduit and give to another. Four parts in ten are the toll."_

Both variants run for exactly the same duration with the same number of animation beats, so that a player filming their screen or glancing at a neighbour's phone cannot infer role from timing. No skip button.

### 7.3 Offering

Per §6. Additional behaviour:

**The controls row**, redrawn in the owner's UI pass because nobody could tell what its controls did — the owner included. It sits directly under the lanes: the tap size on the left, energy in the middle, and two icon buttons on the right. Every control is 56pt tall, chip radius `4`. All marks are drawn as SVG — no emoji, no icon library.

**The tap size** is a two-way toggle, both sizes always in view: each segment shows a drawn mark of the offering's size (one stone, or three), its label **×1** / **×3**, and its cost in energy. The chosen size is raised out of a track cut into the stone, its stones and energy mark in `--gold`; the other recedes in `--bone-dim`. Pressing the other size switches to it. This control is private and must never render for other players.

**Energy** (the spec's credits) is a drawn bolt in `--gold`, the number at `--t-stage` with tabular figures, and the label _Energy_ under it, so it reads as a resource being spent. Each change ticks the number — a short drop and settle, transform and opacity only, at most ten times a second. Below 100 it shifts to toll — as `--toll-text` (`#b2646f`), not `--toll`. `--toll` measures 2.60:1 on `--void`, below the 4.5:1 floor for text that carries information; `--toll-text` is `--toll` mixed 34% toward `--bone`, the smallest step that clears it, at 4.58:1. It is for text only: embers, drains and every other toll mark keep `--toll`. Below 20 it pulses slowly — a crossfade between `--toll-text` and `--toll-text-bright` (`#bf8c95`, toll mixed 56% toward bone, 6.85:1), never a dimming, so every frame of the pulse stays above 4.5:1. There is no modal warning — the player is mid-tap and a modal would be hostile.

**Inspect and Drain** are two icon buttons with their names under them: Inspect is a lens held over a lane, Drain two lanes with a line arcing out of one and into the other. **Both appear for every player, identical at rest** — see §7.4.

**The tap band** is the primary verb of the game, so it is the most pressable thing on screen: a filled stone face, not an outline, running edge to edge and down to the bottom edge with no margins around it. The whole band is the touch target. It emits a small `--flame-cold` spark at the touch point, and must never trigger text selection, double-tap zoom, or pull-to-refresh. Pressed, the face darkens by half, its light falls away and the ring sinks 4px and gives under the thumb — unmistakable at six taps a second, since each press lands instantly and releases over 80ms. The band is stone, never fire.

**The plate**, the owner's choice over a square slab: `--stone`, its top corners rounded at 28pt — §3.3's one radius exception — a 2pt `--gold` rim along its top edge, `--stone-lit` washing down the top 60% of the face, and a carved ring where the thumb goes with _Tap_ inside it.

**Rate clamp feedback**: taps beyond 6/sec are dropped silently by the server, and the client must be silent too. No error, no shake, no toast. The band simply stops sparking beyond the clamp. Anything louder teaches players to tap slower, which is not the intent.

### 7.4 Inspect, Drain and the sheet

**The owner's UI pass replaced the single action button with two icon buttons, Inspect and Drain, and both appear for every player, identical at rest** — same place, same size, same marks, same labels. What each opens:

- **Inspect**: the Inspect sheet (spec: trace), the same for every role.
- **Drain**: for the Hollow, the Drain sheet (spec: siphon). For the Faithful, a short panel: _"Only the Hollow can drain. The rite gives you no such hand."_

The closed screen is identical for every role. This is a secrecy requirement, not a layout convenience — a Drain button that exists only for the impostor identifies them to anyone who glances at the screen, and identifies the other three by its absence. Role shows only once a sheet is open, on the screen of the player who opened it. **Proven by byte comparison**: with animation off so the timer chip holds still, a Faithful rehearsal and a Hollow rehearsal captured the closed screen below the status bar with the same SHA-256. Captures of the same role differed by a few pixels from run to run (at most 5 levels in 255, on glyph edges), so that noise is not role.

Inside the sheet, the Draw is two rows: **Take from** and **Give to**, each showing four seat tokens (sigil + mantle + current conduit height as a small bar). Sources at 0 units are disabled and visibly carved-out. Selecting self as sink shows the doubled cost plainly: `12` with the energy mark.

A persistent, private running total — _"You've destroyed 214 progress."_ — in toll. This is the impostor's only score and it should feel like a private sin.

Confirmation is a single tap on the Give-to token; no separate confirm button. Each Draw fires immediately with a brief `--toll` pulse on the sheet edge, and the sheet stays open so the impostor can repeat or retarget.

**The sheet must dismiss cleanly if the stage changes underneath it**, and it must be fast to open and close, because the impostor is doing this while pretending to tap.

### 7.5 Discuss (Council)

Board freezes at the top, compressed to about 40% height, still showing final positions — arguments are about the board and it must stay visible. Chat fills the rest.

**A messenger, since part 2 of the owner's UI pass** ("this looks like a messaging session before CSS was invented"). **Every bubble is stone, and nothing about a bubble differs by role**; seat colour stays on the mask and the name. Your own messages sit on the right on the lighter stone step `--stone-edge` (bone on it 5.83:1). Everyone else's sit on the left in a `--stone` bubble, with their mask and name — in their seat's text colour (§3.1) — once at the head of each run of consecutive messages, and that run's bubbles stacked under it. Bubbles round at 16; the speaker's side is cut to 4 where bubbles stack, and only the run's last bubble rounds off at the bottom on that side — the owner's call over §3.3's chip radius, so the conversation reads as one. Newest at the bottom; the list follows a new message only when the reader is already at the bottom. No timestamps, no read receipts. Voted-out players' inputs are removed entirely rather than disabled with an explanation.

**The input is at the bottom**, a pill-shaped field with Send as a round icon button beside it — a rising arrow, `--gold` while there is something to send. Item 4 had moved it to the top because the window was set to pan, and an input at the bottom slid the whole window — board and all — off the screen. The window now resizes with edge-to-edge on, which leaves the window where it is and reports the keyboard's height; the Discuss region pads its own bottom by that height on the UI thread, so only the message list shrinks. **Verified on the emulator: with the keyboard open, the lanes are byte-identical to the closed screen and their foot sits on the same pixel row.** Home, whose name field and code cells the pan used to slide into view, now shrinks its scroll view by the keyboard instead.

The 45s timer runs as a thin line that shortens across the top of the chat, not as a number. Numbers make people rush; a line makes them aware.

### 7.6 Vote (Judgement) and The Reveal

**Since part 2 of the owner's UI pass the vote block sits in the vertical middle of the lower region**, so it balances the board above rather than hugging it: the stage name and one line of instruction, then four (or three) masks in a row with their names. Tap to place your mark. **Skip** stands apart below an _or_ divider as a wide control of its own — an outline cut into the dark, never a raised disc — because abstaining is a real choice and not a fifth player.

**Your mark is a gold ring round the chosen mask** (§3.1: gold is emphasis), standing off the disc with the ring's space held either way, so nothing moves when the mark does; the chosen name turns gold with it. A chosen Skip takes the same gold edge all the way round.

Once cast, your own mark shows on your chosen mask. **No other player's vote is visible in any form** — not a count, not "2 have voted", nothing. Simultaneous reveal is a hard requirement and any progress indicator leaks it.

At close, all marks flip in at once over 400ms — each is the voter's own mask, in gold — then resolve. The Reveal is laid out like the vote block it replaces, each mask in a slot the size of the vote ring, so the masks stay where they were and only the marks arrive. If a majority is reached, the target's mask is marked for Cast Out. If not: _"No one is voted out."_ and the round advances.

**Checked on the emulator (part 2): nothing about another player's vote reaches the screen before the reveal.** Bots held their votes six seconds into the stage; frames captured before and after those votes landed are byte-identical below the header — only the timer chip, which is the clock, changed — and the Reveal that followed showed all three votes.

### 7.7 Cast Out

Roughly three seconds, and the second-biggest beat after the Threshold.

Their conduit's fill desaturates to cold but does not empty — their contribution stands. Its sigil token drops to 40% opacity and the sigil goes `--bone-faint`, where it stays for the rest of the match. A line states the consequence plainly: _"[Name] is cast out. Their conduit is cold. Offerings into it are halved."_

**No role reveal on ejection.** This is the single most tempting thing to add and it would end the match. The spec is explicit that the impostor's identity stays hidden until `MATCH_END`, and an ejection that revealed the role would make rounds 2 and 3 pointless.

### 7.8 Results (the Reckoning)

**Rebuilt in part 3 of the owner's UI pass**: "this is not a school PDF, it's supposed to be a game". It is the last thing a judge sees and the screen where the chain shows a number, so it leads with the player's own outcome and puts the money fourth:

1. **The outcome.** Did _this_ player win or lose, stated plainly — _You won_ in `--gold` or _You lost_ in toll, at `--t-display` — with one line under it, and their own amount at `--t-heart` in Oswald, legible at arm's length. A win shows what was paid to their wallet, in gold; a loss shows what the match cost them, in toll, and what came back. The four lines:
   - Faithful, won: _"You were Faithful, and the Faithful prevailed."_
   - Faithful, lost: _"You were Faithful. The Hollow got away with it."_
   - Hollow, won: _"You were the Hollow, and they never caught you."_
   - Hollow, lost: _"You were the Hollow, and the Faithful prevailed."_
2. **The verdict and the Hollow**: the fiction's headline at `--t-stage` with a plain line under it, and the Hollow's token in its `--toll` diamond.
3. **The final board** and its percentage, with the match board's carved seam.
4. **The money**: what each player was returned and won, in SKR — winners' names and the Won column in gold — the house fee and leftover dust, and the on-chain transaction. Here rather than last, because a judge watching a chain demo wants to see real numbers paid out.
5. **The taps**: a real table with tabular figures and aligned columns, not cards — spent, tapped, final lane — with a thin gold bar under each tapped figure, scaled to the largest, so it reads as a chart at a glance. The player's own row carries the board's own-lane mark, a `--bone-dim` ring round their mask.
6. **Drain and Inspect** as compact stat blocks: figures large, labels small.
7. **The vote history**, behind _See full vote history_, collapsed by default and opening in place — the longest and least-read block.
8. **The seed**: one line cut in the middle, opening to the full value in place, a Copy control, and one line of why it matters.

Gold marks value and nothing else here: the payout, the Won column, the winners, the bars, the outcome on a win. Headings stay bone.

**An entrance, once on arrival and never on scroll**: outcome, verdict, board, then the sections, each rising and fading in over 400ms, 150ms apart — 850ms in all. Transform and opacity only.

Two actions at the bottom: **Play again**, the primary (home's primary face), and **Leave**, a stone secondary.

### 7.9 Broken states

The mechanics spec's void-and-refund path needs first-class design, because it is the moment a player worries about their money.

A voided rite gets its own screen, not a toast, sharing the results screen's layout, entrance and buttons: what happened to the player's money first, then the dark board, then the way out. The percentage and the conduits go dark, and the copy says exactly what happened and what it cost. _"The rite is broken. Nothing was spent. 12 SKR returned to your wallet."_ Refund amount in `--gold`, transaction link available. No apology, no filler.

Disconnection during the 30s grace shows a countdown beside the player's own sigil token. Reconnecting resumes without ceremony.

---

## 8. Motion

Motion answers actions. Two moments per match are unprompted spectacle — the Threshold crossing and Cast Out — and everything else is restrained so those two land.

| Event                  | Duration | Curve        | Notes                               |
| :--------------------- | :------- | :----------- | :---------------------------------- |
| Offering (own tap)     | 0ms      | —            | Optimistic and instant. See §10.2.  |
| Frontier rise (server) | 250ms    | linear       | Lerp toward broadcast position      |
| Frontier fall (drain)  | 400ms    | ease-out     | Slower on purpose, so it reads      |
| Toll embers            | 400ms    | ease-out     | `--toll`, rising, fading            |
| Threshold crossing     | 1400ms   | orchestrated | Once per match                      |
| Stage change           | 500ms    | ease-in-out  | Board reflow, no fade-through-black |
| Vote reveal            | 400ms    | ease-out     | All marks simultaneously            |
| Cast Out               | 3000ms   | orchestrated |                                     |
| Overlay open/close     | 180ms    | ease-out     | Scale from 0.98, no blur            |

When `AccessibilityInfo.isReduceMotionEnabled()` is true, drop the embers and the Threshold flood, replacing the last with a single cross-fade. Frontier movement stays — it is information, not decoration — and so does the surface and token that ride it.

**Haptics** via `expo-haptics`: `ImpactFeedbackStyle.Light` on each offering, `Medium` on a Draw, `NotificationFeedbackType.Warning` on Cast Out, nothing else. Haptics on every state change becomes noise within one round.

---

## 9. Audio

A six-minute paranoia game without sound is a different, worse game. Keep it small.

- **Drone**: one low sustained tone whose pitch and presence rise with board total. It is how a player feels the score without looking. Drops out entirely during Council — the silence is what makes people talk.
- **Offering**: a short struck-stone sound, pitched up slightly as the conduit fills, randomised ±3% so rapid tapping doesn't machine-gun.
- **Drain**: a low reversed swell on any conduit that falls, audible to everyone. It carries no direction.
- **Threshold**: the drone resolves to a chord. The only satisfying sound in the product.
- **Cast Out**: everything cuts to silence for 400ms first.

`expo-audio`, configured to duck rather than interrupt other audio, and to respect the device silent switch. Mute control persists across matches in local storage.

React Native has no Web Audio equivalent, so the drone cannot be synthesised at runtime. Ship it as a short seamless loop and drive presence with volume and a low-pass-approximating crossfade between two or three pre-rendered loop variants at different intensities. Total audio payload under 400KB. Preload every clip during the Marking so nothing hitches mid-match.

---

## 10. Implementation

### 10.1 Rendering

Stack and package choices live in `CLAUDE.md`. What matters for the visuals:

- **`react-native-svg`** draws the conduits, their arced surfaces, and the sigils. No canvas, no Skia, no sprite sheets. Everything in §6 is flat vector shapes and two-stop gradients, which `react-native-svg` handles natively.
- **`react-native-reanimated`** drives every animation as shared values on the UI thread. Wrap SVG primitives with `Animated.createAnimatedComponent` and animate the `transform` prop. The JS thread must be idle during a tap burst.
- **Fonts** are bundled TTFs loaded through `expo-font`'s `useFonts`, with the splash held until they resolve so the board percentage never reflows. `@expo-google-fonts/grenze-gotisch` and `@expo-google-fonts/ibm-plex-sans` are the convenient path if they resolve cleanly; otherwise drop the TTFs in `assets/fonts` directly.
- **Tabular figures**: React Native does not expose `font-variant-numeric`, so either use `fontVariant: ['tabular-nums']` where the platform honours it, or fix the width of each digit slot in the credit counter and timer. Verify on device — a jittering credit balance during tapping is very visible.

### 10.2 Optimistic tapping

The single most important implementation note in this document.

The board broadcast arrives every 250ms. If the player's own frontier waits for it, every tap feels a quarter second late and the core verb of the game feels broken.

On `onPressIn` — not `onPress`, which waits for release: decrement local credits, advance a local frontier shared value, spark the tap band, fire the haptic — all synchronously, before any network call. Batch the taps on the spec's 250ms timer. When `BOARD_UPDATE` arrives, reconcile: other conduits snap to the server value, the player's own conduit animates toward it over 250ms rather than snapping, so an over-optimistic local prediction settles rather than jerking.

If the server value is _below_ the local prediction — the clamp dropped taps, or the player was drained — reconcile at the slower 400ms drain rate so it reads correctly.

### 10.3 Structure

See `CLAUDE.md` for the full tree. The design-relevant part:

```
src/design/tokens.ts       palette, type scale, spacing, material
src/design/motion.ts       durations and curves, single source
src/art/Conduit.tsx        aperture, arced surface, frontier
src/art/RidingToken.tsx    sigil on a stone disc, rides the surface
src/art/BoardHeader.tsx    round, percentage, timer
src/art/Sigil.tsx
src/art/SkrMark.tsx        the SKR glyph, drawn (U+27E1 is not in IBM Plex Sans)
```

Every colour comes from `tokens.ts`. No hex literal appears anywhere else in the codebase — if a component needs a colour that isn't a token, that is a design decision and it belongs here, not in a component file.

### 10.4 Quality floor

- Portrait locked, 360–430pt. Above 600pt, letterbox rather than stretch. Landscape is unsupported and says so.
- Every interactive element has an `accessibilityLabel` and `accessibilityRole`. Touch targets are at least 44pt.
- Contrast: all text meets 4.5:1 against its background. `--bone-faint` on `--void` is for decoration only, never for information.
- Screen reader: the board announces at stage changes only, never per tick. Conduit positions are available as text.
- The board is laid out against the safe area, but the tap band extends to the bottom edge — the gesture bar sits over dead space, not over the tap target.
- Every state has an empty, loading, and error variant before the screen is considered done.

---

## 11. Build order

**See `BUILD-PLAN.md` §5.** That is the single build order for this project. This document describes what the screens are; it does not describe the sequence they are built in, and a second ordering here would only drift out of step with the first.
