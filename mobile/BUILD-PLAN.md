# Reztor Mobile — MVP Build Plan

Four days to a hackathon demo. This document overrides `reztor-design.md` on **scope
only** — where something below is cut, it is cut, and where something is kept, the
design doc's named values are authoritative for how it looks.

Read with: `CLAUDE.md` (conventions), `reztor-design.md` (everything visible),
`../docs/PROTOCOL.md` (the server contract).

---

## 0. Corrections to CLAUDE.md

Item 0 corrected `CLAUDE.md` against the repository as it actually is. What was true at
the start of item 0, and is now settled:

- **The on-chain program does not exist.** `../contract/` has a spec and a playbook,
  no program. Wallet connect and buy-in are stubbed for this build — see §4.
- **The template was the Expo Kit Anchor example**, not the Expo tabs template. None of
  the tabs-template cruft this section used to list ever existed here — no `explore.tsx`,
  no `app-tabs*`, no `themed-text.tsx`, no `src/constants/theme.ts`, no `assets/`.
  What was deleted instead: `src/features/*` (counter, account, network),
  `src/components/app-address-link.tsx`, `src/utils/*`, and `og-image.png`.
- **The Solana stack is installed but unwired.** `@wallet-ui/react-native-kit`,
  `@solana/kit`, `react-native-quick-crypto`, `polyfill.js` and `index.js` are all
  present and stay present, so the one native build made in item 0 already contains
  them. Their providers were removed from the root layout; day 6 re-wraps the layout
  and changes nothing else.
- **Uniwind and Tailwind were removed** — `src/global.css`, `src/uniwind-types.d.ts`,
  the `withUniwindConfig` wrapper in `metro.config.js`, and both dependencies. They
  contradicted `CLAUDE.md`'s stack rule and put a Tailwind build in front of Metro.
- **`mobile/anchor/` was removed**, along with the `anchor:*` and `codama:*` scripts and
  the `@project/anchor` path. It was the template's `hello_world` counter program.
  Reztor's program lives in `../contract/` and its client is generated from there.
- **The package manager is pnpm.** `pnpm-lock.yaml` is the only lockfile. Never `npm`.
- **`protocol/generated.ts` does not exist yet.** It is emitted from the server and is
  never hand-edited. Nothing before item 3 needs it.

## 1. Two contradictions to resolve

**Frontier reconciliation.** §8 says frontier rise is a 250ms linear lerp; §10.2 says
other conduits _snap_ to the server value. Lerp, don't snap — a snap at 4Hz is visibly
steppy on a phone. Own lane: lerp up over 250ms, ease down over 400ms. Other lanes:
same. The only instant movement in the product is the player's own optimistic tap.

**The Draw constraint is right, the reason is slightly off.** §6.3 says the server never
broadcasts siphon events. It does — `SIPHON_RESULT`, privately, to the impostor only.
The constraint stands exactly as written for every other client, and the impostor's own
client must never render a pairing either, because a filmed screen or a glance over a
shoulder leaks it.

---

## 2. Scope — what ships

### Keep

Palette and type tokens in full. Both fonts. The carved material, no elevation, no
shadows. Grain overlay. The conduits with their arced surfaces and riding sigil tokens,
the Threshold marks, the sigils — all SVG. The tap band as tap target. The tier button,
the credit counter, the shared action button. The Marking. Chat rows. Vote tokens and
simultaneous reveal. Cast Out. The Reckoning table. The void screen.

### Cut for MVP

- **The Faithful figures (§5.1, §5.3).** The hooded silhouette with eye-points and five
  animated states is a day of art on its own. Identity moves onto the conduit itself as
  the riding sigil token (§6.2), which carries the seat by shape and that player's
  standing by position. Of the five states only cold and disconnected survive; a drained
  conduit already shows a falling frontier and toll embers, which is the information.
  This is the largest cut and the one that buys the schedule.
- **All audio (§9).** The drone, the struck-stone offering, the crossfaded loops. Half a
  day minimum and it does not survive a demo video's own soundtrack. The Threshold
  still gets its visual moment.
- **Reduce-motion variants, screen-reader announcements, the contrast audit (§10.4).**
  Keep `accessibilityLabel` and `accessibilityRole` as you go — they cost nothing while
  writing a component and a fortune to retrofit. The rest is post-hackathon.
- **The drawn Heart (§6.4).** The board has no vessel on it. The Heart stays the name of
  the board in the fiction and in §1.1's vocabulary, and the percentage in the header is
  how full it is. The conduits are the hero image instead.
- **Augury and the Draw as separate controls (§7.1 #6, §7.4).** One action button on the
  board, identical for every role in size, position and label, opening one bottom sheet:
  Augury for the Faithful, Augury and the Draw for the Hollow. No confirmation step and
  no impostor-only control. Same content, a quarter of the layout work, and faster to
  dismiss — which §7.4 says is the point.
- **The Threshold crossing orchestration (§6.4).** 1400ms of choreography becomes a
  600ms `--flame-white` flood: the Threshold marks ignite across all four conduits and
  the percentage takes the flood. Same beat, less rigging.
- **Landscape letterboxing, the 600pt case, the mute control, transaction links.**

### Deferred, not cut

Wallet connect, buy-in, real settlement. See §4.

---

## 3. Screens — five routes, not twelve

| Route           | Covers                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------- |
| `/`             | Home: name, create or join by code, rules scroll below the actions. No wallet until day 6.    |
| `/lobby/[code]` | The Gathering — invite code, seats filling, dissolve timer, leave                             |
| `/match`        | **One screen, stage-driven.** Offering, Council, Judgement, Reveal, Cast Out. Never remounts. |
| `/reckoning`    | The Reckoning, full post-mortem                                                               |
| `/broken`       | Void, refund, disconnect-past-grace                                                           |

**There is no `/marking` route.** The Marking is a full-screen overlay inside `/match`: it
covers the board at match start and lifts to reveal it, so the board is already mounted and
already correct underneath, and nothing remounts.

Everything that is not a server stage lives inside `/match` as a component rather than a
route:

- **The Marking overlay** — role reveal, 4s, no skip.
- **The action sheet** — Augury for everyone, plus the Draw for the Hollow. One sheet, opened
  from the board's single action button, so the closed board is identical for every role.
- **The rules sheet** — openable at any time.
- **The vote reveal and Cast Out** — brief overlays over the board.
- **The leave confirmation** — states that the stake is forfeit.

---

## 4. The money, until day 6

No wallet, no signing, no chain. The server already has an `EscrowProvider` interface
with an in-memory fake behind it, so a match is fully playable without any of it.

The entry screen takes a name and joins. The Reckoning shows payouts and refunds in
`--gold` from `matchEndPayload`, which is real settlement arithmetic against fake
escrow — correct numbers, no transaction.

If the Anchor program lands and integrates cleanly on day 6, wallet connect goes in
front of the entry screen and nothing else changes. If it does not, the demo runs on the
fake and you say so plainly rather than implying more than exists.

---

## 5. Build order

Each numbered item is one session. Do not start the next until the current one runs on a
real Android phone.

0. **Dev build on a real phone.** A blank screen is fine. EAS builds queue and fail for
   trivial reasons; find that out now. Also: delete the template cruft, install
   `react-native-svg`, create `src/design/tokens.ts` and `src/design/motion.ts` from the
   design doc's named values, load both fonts, add the grain.
1. **The board art as static SVG at fixed values**, per `reztor-design.md` §6.1: the
   header, four derived-width conduits with arced surfaces and riding sigil tokens, the
   Threshold marks, the controls row and the tap band. Judge the hero image cold. If four
   columns of cold fire in the dark is not striking without motion, motion will not save
   it. Iterate here — it is cheap now and expensive later.
2. **The Offering screen, local only, no network.** Tap band, tier button, credit counter,
   optimistic tapping at a real 6/sec. Tune the feel. This is the core verb and nothing
   downstream matters if it is wrong.
3. **Socket, entry, lobby, the Marking overlay.** Connection, invite code, seated waiting,
   `MATCH_STARTED`, then the Marking playing as an overlay inside `/match` — not a route —
   lifting into the live board with reconciliation.
4. **Council, Judgement, Reveal, Cast Out.** The stage machine inside `/match`.
5. **The shared action sheet.** One sheet holding Augury for everyone and the Draw for the
   Hollow, opened from the board's single action button, plus the trace result card. The
   closed board must stay identical for every role.
6. **The Reckoning and the broken states.**
7. **Playtest, four phones, four people.** Book this before you start item 0.

Items 1 and 2 are where this either has an identity or doesn't. Everything after is
assembly.

---

## 6. The two things most likely to go wrong

**The tap band at six taps per second.** `Pressable`'s `onPressIn` will not reliably fire
sixty times in ten seconds. Use a bare `View` with `onTouchStart`, or a Gesture Handler
`Tap` with a short `maxDuration`, and verify with a counter on device before building
anything on top of it. If the tap surface drops inputs, every balance number you
measured on the server is meaningless.

**Backgrounding.** Android kills the socket. An `AppState` listener that reconnects,
re-`JOIN`s and applies `RESUME_STATE` wholesale is required from item 3 onward, not
bolted on at the end. Test it by pulling down the notification shade mid-round.

---

## 7. Definition of done for the demo

Four people on four Android phones play a full six-minute match to a resolution, with
one person deliberately backgrounding the app mid-round and rejoining. That match is
screen-recorded. Anything beyond that is upside.
