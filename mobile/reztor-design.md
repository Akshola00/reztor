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

Every player-facing string uses the left column. Code, logs, and message types keep the right column.

| Interface                      | Spec / code             |
| :----------------------------- | :---------------------- |
| the Rite                       | the match               |
| the Heart / the vessel         | the board               |
| conduit                        | lane                    |
| the Threshold                  | win target (2400)       |
| offering                       | tap                     |
| lesser / greater offering      | tier 1 / tier 2         |
| the Faithful                   | crew                    |
| the Hollow                     | impostor                |
| the Draw                       | siphon                  |
| the toll                       | units destroyed         |
| Augury                         | trace                   |
| Offering / Council / Judgement | tap / chat / vote stage |
| cast out                       | ejected                 |
| cold (a conduit)               | dormant                 |
| the Reckoning                  | match end screen        |
| the Rite is broken             | match voided            |

Augury results: `natural` → **"fed by its own hand"**, `received` → **"filled from elsewhere"**, `drained` → **"something was taken"**.

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

```css
/* Ground — the temple */
--void: #0b0d12; /* page background, deepest */
--char: #15181f; /* unconsecrated conduit fill */
--stone: #1e222c; /* architecture, panels, plinth */
--stone-edge: #2c3240; /* carved edges, dividers, borders */
--stone-lit: #3d4555; /* raised faces, pressed states */

/* Fire — consecrated matter. PROGRESS ONLY. */
--flame-deep: #1b5c9e; /* base of the fill */
--flame: #3e9be0; /* body of the fill */
--flame-cold: #7fe3ff; /* the frontier line */
--flame-white: #e4f8ff; /* frontier peak, threshold crossing */

/* The toll — loss, drain, damage */
--toll: #8e3b2f; /* dried blood; embers of what was taken */
--toll-smoke: #4a2a26; /* residue at a falling frontier */

/* Settlement */
--gold: #c9a227; /* SKR, payouts, refunds only */

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

Each seat also carries a distinct geometric sigil (§5.2). Identity is never carried by colour alone — this covers colourblind players and also solves a real problem, which is that four muted colours at thumb-size on a dim phone screen are genuinely hard to tell apart.

### 3.2 Typography

Two families, both from Google Fonts, both self-hosted and preloaded.

**Display — Grenze Gotisch.** Gothic-inflected without being blackletter, so it carries the rite without becoming illegible. Used for: the board percentage, stage names, role reveal, the Reckoning headline, player names in Judgement. Never below 20px. Its digits are not tabular, so anywhere it sets a changing number the digit slots are fixed by hand.

**Interface — IBM Plex Sans.** Slightly technical, excellent tabular figures, not the default humanist sans every generated interface reaches for. Used for everything else. Always `font-variant-numeric: tabular-nums` on anything that counts, so the credit balance doesn't jitter while it drains.

```css
--type-display: 'Grenze Gotisch', Georgia, serif;
--type-ui: 'IBM Plex Sans', system-ui, sans-serif;
```

Scale, mobile-first:

| Token         | Size / line-height | Use                            |
| :------------ | :----------------- | :----------------------------- |
| `--t-heart`   | 56 / 1.0           | Board percentage               |
| `--t-display` | 32 / 1.1           | Role reveal, Reckoning verdict |
| `--t-stage`   | 20 / 1.2           | Stage name, player names       |
| `--t-body`    | 15 / 1.5           | Chat, explanations             |
| `--t-data`    | 14 / 1.2           | Credits, counts, timers        |
| `--t-fine`    | 12 / 1.3           | Timestamps, secondary labels   |

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

Corner radius encodes hierarchy rather than being applied uniformly: major panels are `2` (cut stone), interactive chips and buttons are `4`, and the conduits have no radius at all because they are apertures, not objects. The single exception is the tap band, which is an oval — §7.3 explains what earns it. Nothing else in the interface is a rounded card with a soft grey shadow.

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

### 5.2 Sigils

Four marks, distinguishable by shape alone at 16px, each drawn with the same stroke weight so none reads as more important:

1. **Seat 1** — a circle crossed by a single horizontal bar
2. **Seat 2** — an upward triangle with its apex cut flat
3. **Seat 3** — a diamond containing a vertical stroke
4. **Seat 4** — a square rotated 45° with one corner open

Sigils appear on the plinth, beside names in chat, on vote tokens, and in the Reckoning table. They are the primary identity carrier everywhere.

### 5.3 States

The five figure states are cut with the figures. Two survive, carried by the token:

| State           | Treatment                                                                                           |
| :-------------- | :-------------------------------------------------------------------------------------------------- |
| Cold (cast out) | Disc at 40% opacity, sigil in `--bone-faint`. It stays that way for the rest of the match.          |
| Disconnected    | Token at 25% opacity. Nothing else marks the absence — no outline, no badge, no countdown on-board. |

**Starved is cut.** A conduit that lost ground already says so: the frontier descends, carrying its surface and its token down with it, and `--toll` embers rise from the new frontier (§6.3). That is the information, and a second channel for it would only risk implying a direction, which §6.3 forbids.

Idle breathing and the channelling lean are cut with the figures and are not reassigned to the token. The token moves when the conduit moves and at no other time.

There is no "Hollow" token state. The Hollow's conduit and token look exactly like everyone else's on every client, including their own.

---

## 6. The board

### 6.1 Composition

Four conduits fill the width of the screen between small outer margins, separated by narrow gaps of background. They fill upward from their bases. Each one's surface is a gentle convex arc rather than a flat line, and the owner's sigil token rides that surface. A short carved Threshold mark crosses each conduit at 60% of its height. A thin header sits above them; a controls row and the tap band sit below.

This is the hero image of the product: four columns of cold fire in the dark, and the darkness between them is the background itself. Spend the boldness here and keep everything else quiet.

```
┌──────────────────────────────────┐
│ Round 2           58%       0:41 │  ← round · percentage · timer
│                                  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐     │
│  │    │ │    │ │    │ │    │     │
│  │    │ │    │ │╭──╮│ │    │     │  ← surface: a convex arc
│  │    │ │    │ ││ ◈││ │    │     │  ← sigil token rides the surface
│  ├────┤ ├────┤ │▓▓▓▓│ ├────┤     │  ← Threshold, carved per conduit
│  │    │ │    │ │▓▓▓▓│ │    │     │
│  │╭──╮│ │    │ │▓▓▓▓│ │╭──╮│     │
│  ││ ◇││ │╭──╮│ │▓▓▓▓│ ││ ◻││     │
│  │▓▓▓▓│ ││ △││ │▓▓▓▓│ │▓▓▓▓│     │
│  │▓▓▓▓│ │▓▓▓▓│ │▓▓▓▓│ │▓▓▓▓│     │
│  └────┘ └────┘ └────┘ └────┘     │
│                                  │
│ [1 ⟡ → 1]      847 ⟡   [ Augury ]│  ← tier · credits · action
│                                  │
│      ╭────────────────────╮      │
│     │                      │     │
│     │      the tap band    │     │  ← whole band is the tap target
│     │                      │     │
└─────┴──────────────────────┴─────┘
```

Conduit width is derived, never fixed: `(screen width − 2 × outer margin − 3 × gap) / 4`. The gap is background, not a drawn divider, and must stay clearly visible at 360pt.

Vertical budget on an 844pt viewport: header 48pt, conduits flexing to fill (280pt minimum), controls row 84pt, a clear 24pt gap, then the tap band at 240pt running to the bottom edge. The conduits take the slack, so they are always the largest thing on screen.

**Your own conduit is marked by a larger sigil token with a `--bone-dim` ring**, not coloured differently. That is the only difference; everyone's conduit renders identically otherwise.

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
2. **Home** — name, create, and join by code. An About/rules scroll sits below the actions rather than behind a link. **No wallet UI of any kind is shown until the contract lands on day 6**; when it does, wallet connect appears here and nothing else changes.
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

**The controls row** sits directly under the conduits: the tier button on the left, the credit counter centred, the action button on the right. Both buttons carry a raised stone face, chip radius `4`, and are at least 44pt. They are the same size and style as each other, so neither reads as the more important one.

**The tier button** shows the current tier's cost and yield on its face (`1 ⟡ → 1`, or `4 ⟡ → 3` at greater). Pressing it cycles the tier; the face is the state, so there is no second chip to compare against and no selected/unselected pair. This control is private and must never render for other players.

**The action button** is labelled "Augury" and is identical for every role — see §7.4. It never changes size, position, or label based on role.

**The credit counter** sits between the two buttons. It ticks down continuously with tabular figures. Below 100 credits it shifts to toll — as `--toll-text` (`#a46b65`), not `--toll`. `--toll` measures 2.61:1 on `--void`, below the 4.5:1 floor for text that carries information; `--toll-text` is `--toll` mixed 30% toward `--bone`, the smallest step that clears it, at 4.51:1. It is for text only: embers, drains and every other toll mark keep `--toll`. Below 20 it pulses slowly. There is no modal warning — the player is mid-tap and a modal would be hostile.

**The tap band** is the tap target — a large oval, centred, with the band running from below the controls row to the bottom edge. A clear gap separates it from the controls row so a thumb reaching for the band cannot catch a button. It depresses 2px on touch, releases over 80ms, and emits a small `--flame-cold` spark at the touch point. The band must never trigger text selection, double-tap zoom, or pull-to-refresh.

**Its resting face is `--char` with a stone bevel rim** — lit edge above, shadow below, stone sides — so the band reads as carved into the dark and can never be brighter than the fire. Item 1c judged this on the phone against a raised `--stone` slab, which on an empty board was the brightest object on screen and pulled the eye off the conduits. The pressed state brightens to `--stone-lit`, which only reads as brightening because the resting face is this dark.

The oval is the one deliberate exception to §3.3's radius hierarchy: it is the only thing on screen shaped to a thumb rather than cut from stone, and that is what makes it read as the thing to hit. Nothing else in the product takes a radius above `4`.

**Rate clamp feedback**: taps beyond 6/sec are dropped silently by the server, and the client must be silent too. No error, no shake, no toast. The band simply stops sparking beyond the clamp. Anything louder teaches players to tap slower, which is not the intent.

### 7.4 The action button and its sheet

**The Draw is not its own control.** Every player has the same action button in the same place, at the same size, with the same label. What it opens differs:

- **Faithful**: Augury.
- **Hollow**: a sheet carrying Augury and the Draw.

The closed screen is identical for every role. This is a secrecy requirement, not a layout convenience — a Draw button that exists only for the impostor identifies them to anyone who glances at the screen, and it identifies the other three by its absence.

Inside the sheet, the Draw is two rows: **Take from** and **Give to**, each showing four seat tokens (sigil + mantle + current conduit height as a small bar). Sources at 0 units are disabled and visibly carved-out. Selecting self as sink shows the doubled cost plainly: `12 ⟡`.

A persistent, private running total of the toll — _"You have taken 214 from the Heart"_ — in `--toll`. This is the impostor's only score and it should feel like a private sin.

Confirmation is a single tap on the Give-to token; no separate confirm button. Each Draw fires immediately with a brief `--toll` pulse on the sheet edge, and the sheet stays open so the impostor can repeat or retarget.

**The sheet must dismiss cleanly if the stage changes underneath it**, and it must be fast to open and close, because the impostor is doing this while pretending to tap.

### 7.5 Council

Board freezes at the top, compressed to about 40% height, still showing final positions — arguments are about the board and it must stay visible. Chat fills the rest.

Messages are plain rows: sigil, name in `--type-ui` medium, message in `--bone`. No bubbles, no avatars repeated per message, no read receipts. Cast-out players' inputs are removed entirely rather than disabled with an explanation.

The 45s timer runs as a thin line that shortens across the top of the chat, not as a number. Numbers make people rush; a line makes them aware.

### 7.6 Judgement and The Reveal

Four (or three) vote tokens in a row: the player's sigil token and their name. Tap to place your mark. A Withhold option sits apart from the others, visually lower, because abstaining is a real choice and not a fifth player.

Once cast, your own mark shows on your chosen token. **No other player's vote is visible in any form** — not a count, not "2 have voted", nothing. Simultaneous reveal is a hard requirement and any progress indicator leaks it.

At close, all marks flip in at once over 400ms, then resolve. If a majority is reached, the target's sigil token is marked for Cast Out. If not: _"No one is cast out."_ and the round advances.

### 7.7 Cast Out

Roughly three seconds, and the second-biggest beat after the Threshold.

Their conduit's fill desaturates to cold but does not empty — their contribution stands. Its sigil token drops to 40% opacity and the sigil goes `--bone-faint`, where it stays for the rest of the match. A line states the consequence plainly: _"[Name] is cast out. Their conduit is cold. Offerings into it are halved."_

**No role reveal on ejection.** This is the single most tempting thing to add and it would end the match. The spec is explicit that the impostor's identity stays hidden until `MATCH_END`, and an ejection that revealed the role would make rounds 2 and 3 pointless.

### 7.8 The Reckoning

Everything, immediately, with no progressive disclosure. The mechanics spec is right that the post-mortem argument is half the entertainment, and hiding anything behind a tab or an accordion kills it.

Order: verdict in Grenze Gotisch → the Hollow revealed, their sigil token marked in `--toll` → final board and percentage → a per-player table (credits spent, units contributed, final conduit) → the Hollow's line (total toll, Draw count, self-sinks) → Augury purchases and results → full vote history by round → payouts and refunds in `--gold` → the role seed, monospace, selectable, with a one-line note that it can be checked against the assignment.

The table is real tabular data with tabular figures and aligned columns, not four rounded cards.

Two actions at the bottom: **Kneel again** and **Leave**.

### 7.9 Broken states

The mechanics spec's void-and-refund path needs first-class design, because it is the moment a player worries about their money.

A voided rite gets its own screen, not a toast: the percentage and the conduits go dark, and the copy says exactly what happened and what it cost. _"The rite is broken. Nothing was spent. 12 SKR returned to your wallet."_ Refund amount in `--gold`, transaction link available. No apology, no filler.

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
