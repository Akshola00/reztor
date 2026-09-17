# CLAUDE.md — Reztor mobile client

## What this repository is

The Android client for Reztor, a four-player social deduction game on Solana. React Native + Expo, Android only.

**the backend exists and is finished; the on-chain program does not exist yet — see BUILD-PLAN.md §4** This repository is the client. Do not write server logic, do not write Anchor programs, do not reimplement game rules locally. The server is authoritative for every rule in the mechanics spec — role assignment, unit accounting, the siphon toll, vote resolution, payouts. The client renders state and sends intent.

If a change appears to require a server change, stop and say so rather than working around it on the client.

## Expo APIs change between SDKs

Check the versioned docs at <https://docs.expo.dev/versions/v57.0.0/> for any Expo API before writing code against it. Do not rely on memory, and do not trust an example written for an older SDK: signatures, config keys, and which options belong to a config plugin rather than the app config all move between releases.

## Documents

| File                     | Authority                                                                          |
| :----------------------- | :--------------------------------------------------------------------------------- |
| `../docs/PROTOCOL.md`    | The wire contract. Authoritative for behaviour and sequencing.                     |
| `protocol/generated.ts`  | The wire types. Emitted from the server, never hand-edited.                        |
| `../docs/reztor-spec.md` | Mechanics, economy, timings.                                                       |
| `reztor-design.md`       | Fiction, vocabulary, palette, screens, motion. Authoritative for anything visible. |
| `BUILD-PLAN.md`          | Authoritative for scope. Overrides the design doc wherever the two disagree.       |
| `CLAUDE.md` (this file)  | Stack, structure, conventions, hard rules. Authoritative for how code is written.  |

Before starting work on a screen, read `BUILD-PLAN.md` for its scope, `../docs/PROTOCOL.md` for the messages it exchanges, and the relevant section of `reztor-design.md` for everything visible. Where the design doc names a colour, a duration, or a piece of copy, use exactly that value — do not substitute something that looks close.

## Stack

- **Expo SDK 57** (React Native 0.86, React 19.2). New Architecture only; the legacy architecture was dropped in SDK 55.
- **TypeScript**, strict mode.
- **Expo Router** for navigation between the top-level areas (entry, lobby, match, reckoning).
- **react-native-svg** for all game art — the Heart, conduits, figures, sigils.
- **react-native-reanimated** for all animation, running on the UI thread.
- **react-native-gesture-handler** for the plinth tap surface — see BUILD-PLAN.md §6.
- **expo-haptics**, **expo-font**, **expo-splash-screen**, **expo-keep-awake**. No **expo-audio**: all audio is cut for the MVP (BUILD-PLAN.md §2).
- **Wallet UI** (`@wallet-ui/react-native-kit`) over **`@solana/kit`** for Mobile Wallet Adapter.
- **Plain `StyleSheet` plus a typed token module.** No NativeWind, no styled-components, no Uniwind. Most of this app is custom SVG, and a utility CSS layer adds build surface for very little benefit here.
- **No bottom-sheet library.** BUILD-PLAN.md §2 replaces design doc §7.4's full-screen Draw overlay with a bottom sheet. Build it from primitives and Reanimated rather than adding a dependency.

Install everything with `npx expo install <pkg>` so versions match the SDK. Never pin a React Native or Expo package version by hand.

Expo publishes skills for AI agents. If `expo-upgrade` or related Expo skills are available in the environment, prefer them over guessing at SDK migration steps.

## Type and fonts — checked on a device in item 0

- **IBM Plex Sans already renders tabular digits on Android.** In the item 0 specimen the `tabular-nums` column and the plain column aligned identically, so the fixed-width digit slots that design doc §10.1 offers as a fallback are not needed. Keep `tokens.tabularFigures` on anything that counts anyway: it is the correct declaration, it costs nothing, and it protects the credit counter and timer if the face ever changes.
- **Both Grenze Gotisch weights (400 and 700) stay loaded until item 1.** Which one ships is decided against the real Heart percentage, not a specimen. Do not drop either weight before that call is made.

## Commands

```bash
pnpm install         # pnpm only — pnpm-lock.yaml is the only lockfile here
pnpm run android     # expo run:android — builds and launches the dev build
pnpm run dev         # metro only, against an installed dev build
pnpm run doctor      # run after any dependency change
pnpm run typecheck   # tsc --noEmit
pnpm run lint
```

**Expo Go does not work on this project and never will.** Mobile Wallet Adapter uses Kotlin native modules, so a custom development build is required. If a command or instruction assumes Expo Go, it is wrong.

## Structure

```
index.js                 polyfill import must come first — see below
polyfill.js              react-native-quick-crypto install()
protocol/
  generated.ts           wire types, emitted from the server. Never hand-edited.
assets/
  grain.png              128x128 greyscale noise, tiled at tokens.grainOpacity
  splash.png             1x1 transparent, keeping the splash a flat --void field. Do not delete:
                         expo-splash-screen's Android plugin references @drawable/splashscreen_logo
                         unconditionally but only generates it when an image is configured, so
                         omitting it fails resource linking. Regenerate: scripts/make-splash.mjs
src/
  app/                   Expo Router routes (thin; screens live in src/screens)
  design/
    tokens.ts            palette, type scale, material, layout budget
    motion.ts            every duration and easing curve, single source
  art/
    Heart.tsx
    Conduit.tsx
    NamePlate.tsx        carved sigil + name. Replaces the cut Figure — BUILD-PLAN.md §2
    Sigil.tsx
  screens/               one file per route in BUILD-PLAN.md §3
  net/
    socket.ts            socket.io client
    messages.ts          re-exports the unions from protocol/generated.ts
  state/
    match.ts             authoritative server state
    optimistic.ts        local prediction layer
  solana/                day 6 — see BUILD-PLAN.md §4
    wallet.tsx           MobileWalletProvider setup
    buyIn.ts
```

## Hard rules

These are the ones that break the product if violated. They are not style preferences.

### 1. Never connect a falling conduit to a rising one

Design doc §6.3 explains this in full. No arc, no particle stream, no line, no synchronised flash, no staggered timing that implies causation. The board broadcast carries lane positions only, so no other client has any legitimate knowledge of a pairing. Inventing one lets any player deduce the impostor in round one and the game stops working.

The server _does_ send `SIPHON_RESULT` — privately, to the impostor alone. See PROTOCOL.md §3. So the impostor's own client is the one place where a pairing could be drawn from real knowledge, and it must not draw one either: a filmed screen or a glance over a shoulder leaks it. The no-pairing rule is unconditional, on every client including theirs.

A conduit that fell renders a descending frontier and rising `toll` embers. That is the entire vocabulary for a drain.

### 2. Tapping is optimistic and never waits for the network

The board broadcast is every 250ms. If the player's own frontier waits for it, the core verb of the game feels broken.

On `onPressIn`: decrement local credits, advance the local frontier shared value, fire the haptic, spark the plinth — all synchronously in the same frame, before any network work. Batch the taps on the spec's 250ms timer.

On `BOARD_UPDATE`: **every** conduit lerps toward the server value and none of them snap — other players' lanes included. Rising takes 250ms linear, falling 400ms ease-out, per design doc §8 as amended by BUILD-PLAN.md §1. A snap at 4Hz is visibly steppy on a phone. The only instant movement in the product is the player's own optimistic tap.

Never `await` anything in a touch handler.

### 3. Animation runs on the UI thread

All conduit, Heart, and figure animation uses Reanimated shared values and worklets. Nothing that animates during the Offering stage may pass through the JS thread, and `setState` must never be called per tap or per frame.

- Conduit fill is `scaleY` on a transform, anchored at the bottom, inside an `Animated` SVG group. Never animate SVG `height` or `y`.
- Only `transform` and `opacity` animate during a match.
- The credit counter updates at most 10×/sec, not per tap.

### 4. The client never learns a role it should not know

Role arrives once, privately, in the match-start message for that player. There is no client-side flag, log line, dev overlay, or console output that reveals another player's role before `MATCH_END`.

Specifically: ejection does not reveal role, and the impostor has no distinct visual state on any client including their own. If a code path would make a role inferable from timing, bundle contents, or network shape, treat it as a bug.

### 5. All values come from the token modules

No colour literal, duration, or easing curve appears in a component file. If something needs a value that isn't in `tokens.ts` or `motion.ts`, that is a design decision — add it there, or ask.

## Solana integration — installed, not wired

**Day 6 at the earliest.** These packages are installed and the existing native build already contains them, so nothing here needs a rebuild. Their providers were removed from the root layout in item 0; restore them on day 6 by wrapping the layout as this section describes. Everything below is correct for day 6 — see BUILD-PLAN.md §4.

Use Wallet UI. Do not use `@solana-mobile/mobile-wallet-adapter-protocol-web3js` — that is the older setup and most model training data still points at it.

```
@wallet-ui/react-native-kit
@solana/kit
react-native-quick-crypto
react-native-nitro-modules
expo-dev-client
```

**The polyfill must load before anything that touches a Solana library.** `polyfill.js` at the project root calls `install()` from `react-native-quick-crypto`, `index.js` imports `./polyfill` and then `expo-router/entry`, and `package.json` sets `"main": "./index.js"`. If Solana calls fail with missing crypto, check this ordering first.

Wallet interactions background the app — MWA hands off to the wallet app and returns. Two consequences:

- The websocket must survive backgrounding and reconnect cleanly. The mechanics spec allows a 30s grace period; honour it rather than dropping the player.
- Never trigger a wallet interaction during an active match stage. Buy-in happens before the rite begins. If a signature is somehow needed mid-match, that is a spec question, not something to design around.

Wallet connection state is not game state. Keep `src/solana` and `src/state` separate; the match reducer should not know a wallet exists.

## Networking and state

Two layers, kept apart:

- **`state/match.ts`** — the last authoritative snapshot from the server. Written only by socket messages.
- **`state/optimistic.ts`** — local prediction for this player's taps and credits. Written only by input, reconciled against the authoritative layer.

Never merge them into one store. Every bug in this class of game comes from optimistic values leaking into what the player believes is the truth.

Reconciliation is a lerp for every lane. All conduits animate toward the server value and none snap — rising 250ms linear, falling 400ms ease-out. See hard rule 2.

Message types come from `protocol/generated.ts`, emitted from the server and never hand-edited. `net/messages.ts` re-exports those unions and never redefines a type of its own. `../docs/PROTOCOL.md` is authoritative for behaviour and sequencing. An unknown message type logs and is ignored — it never throws.

Reconnection resumes silently. No modal, no celebration, no "you're back" toast.

## Screens and stages

The match is **one screen** whose content is driven by the server's stage field, not four routes. Offering, Council, Judgement, and Reveal share the board and must not remount it — a remount loses the conduit animation state and reads as a flicker.

Expo Router handles the boundaries between entry, lobby, match, and reckoning. Everything inside a match is stage-driven.

Cast-out players stay in the match screen as spectators. Remove their inputs entirely rather than rendering disabled controls with an explanation.

## Android specifics

- Portrait locked. Landscape is not supported.
- `expo-keep-awake` active for the whole match — six minutes of tapping must not hit the screen timeout.
- Hardware back during a match does not exit. First press shows a leave confirmation that states the stake is forfeit; second press leaves.
- `android:windowSoftInputMode` must not resize the board when the Council keyboard opens. The chat area scrolls; the board stays put.
- Test on a mid-range device, not just an emulator. The performance floor is 60fps while tapping on a phone most players actually own.

## Accessibility

- Every interactive element has an `accessibilityLabel` and `accessibilityRole`.
- Respect `AccessibilityInfo.isReduceMotionEnabled()` — it removes breathing, the Heart pulse, embers, and the Threshold flood, per design doc §8. Frontier movement stays, because it is information.
- Player identity is never carried by colour alone; the sigil is always present.
- Text contrast meets 4.5:1 against its background.

## Before calling anything done

1. `pnpm run typecheck` passes.
2. `pnpm run lint` passes.
3. `pnpm run doctor` reports no issues after any dependency change.
4. The screen has been checked against the relevant section of `reztor-design.md` — colours, copy, and durations match the named values.
5. Empty, loading, and error states exist.
6. For anything in the Offering stage: tapping still feels instant, and the JS thread is idle during a tap burst.
7. Verify a build with `npx expo run:android --no-bundler`, whose exit code is the build's own. Start Metro separately (`pnpm run dev`). A build passes when that command exits 0, the app installs, and a screenshot shows it rendering — `adb exec-out screencap -p`, then actually look at it. Do not verify with `pnpm run android`: it never exits on success because it holds Metro open in the foreground, so a green wrapper script around it proves nothing.

## Do not

- Add emoji anywhere, including placeholder text.
- Add analytics, crash reporting, or third-party SDKs without being asked.
- Reveal roles, votes in progress, or vote counts before their reveal moment.
- Replace named design values with approximations.
- Assume Expo Go, the legacy architecture, or web3.js v1.
