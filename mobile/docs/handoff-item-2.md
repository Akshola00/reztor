# Item 2 handoff — the Offering stage

State of build item 2 (`BUILD-PLAN.md` §5) at the end of the session that measured the tap
surface. Phase 1 is complete and decided. Phase 2 is partially built. Phase 3 has not started.

Read this with `CLAUDE.md` (hard rules 2, 3 and 5), `reztor-design.md` §6.2, §7.3 and §8,
`BUILD-PLAN.md` §6, and `../docs/PROTOCOL.md` §4.

---

## 1. Phase 1 — the tap surface, as measured

Three candidates on the physical phone (Samsung SM-G973F, Android 12, 411×869dp), each given
three 10s bursts: one thumb, two thumbs alternating, two thumbs overlapping. Ground truth was
`adb shell getevent -lt` recorded on-device to `/sdcard/phase1.raw` and pulled afterwards,
counting finger-down events — `ABS_MT_TRACKING_ID` with a non-`ffffffff` value.

| Candidate                                 | Thread | Kernel downs | Counted | Result        |
| ----------------------------------------- | ------ | -----------: | ------: | ------------- |
| A — bare `View` with `onTouchStart`       | JS     |           66 |      66 | exact         |
| B — `Pressable` with `onPressIn`          | JS     |          112 |      84 | lost 28 (25%) |
| C — RNGH `Gesture.Manual`/`onTouchesDown` | UI     |           98 |       0 | never fires   |

### Verdict

**A ships.** It is the only candidate that matched the kernel exactly.

- **B is disqualified.** Its 25% loss appeared in a two-thumb burst at 11.3 taps/sec, which is
  the rate the Offering stage is built around.
- **C never fired.** `Gesture.Manual` with `onTouchesDown`, and `Gesture.Tap` with `onBegin`,
  both counted zero for real and for synthetic input. The same gesture with `.runOnJS(true)`
  counted every tap. `runOnUI` and `withTiming` were both verified working on the device, so
  worklets themselves are healthy; this is specific to RNGH's Reanimated dispatch path in this
  app.

Recorded in `BUILD-PLAN.md` §6 and in `CLAUDE.md` hard rule 3 as a measured deviation.

### What choosing A costs, and what it does not

The tap handler is on the JS thread. Hard rule 3's animation requirement is unaffected:

- The bucket, credit and headroom clamps are synchronous JS on refs inside `onTouchStart`. No
  `await`, no `setState`, same frame.
- The frontier stays a Reanimated shared value, written with `.set()` from JS and animated on
  the UI thread. A dropped JS frame delays the write; it does not drop the tap.
- Haptics no longer needs `runOnJS`, because the handler is already on JS.

**Do not reintroduce RNGH for the tap band without re-measuring against `getevent` first.**

---

## 2. The server's clamp order and the partial-apply rule

Read read-only from `../server/src/engine/rules.ts`. The clamp block is lines 102–111:

```ts
// 102  CLAUDE.md §5.1 order: clamp by tokens → credits → lane headroom, then apply and charge.
// 103  const byTokens  = Math.min(intent.count, Math.floor(available / TOKEN_SCALE))
// 104  const byCredits = Math.min(byTokens, Math.floor(player.credits / tier.cost))
// 105  // a tap whose units do not fully fit is dropped uncharged, never clipped
// 108  const byHeadroom = own ? Math.floor(headroom / tier.units) : ...
// 111  const applied = Math.max(0, Math.min(byCredits, byHeadroom))
```

**Order: tokens → credits → headroom** (`rules.ts:102`). Predicting a different order
mispredicts which clamp bites first, and the frontier then settles backwards.

**No partial apply** (`rules.ts:105`, implemented at `rules.ts:108-109`). For an own lane
`byHeadroom` is `Math.floor(headroom / tier.units)`, so with 2 units of headroom and a tier-2
tap worth 3 units, `floor(2/3)` is 0: the tap does not apply and costs nothing. Never partially
fill a lane.

Two more facts that the prediction depends on:

- **Rate-clamped taps are the only silent drop** (`PROTOCOL.md` §4, `rules.ts:113-114`). An
  empty bucket means do nothing at all — no spark, no haptic, no credit change.
- **A batch that could be sent but applies nothing is rejected and changes nothing**, tokens
  included (`rules.ts:115-119`): `INSUFFICIENT_CREDITS` when credits were the binding clamp,
  otherwise `LANE_FULL`.

Other server values confirmed by reading: `TOKEN_SCALE = 4`, `TICKS_PER_SEC = 4`, bucket
capacity `tapRatePerSec × 4` refilling `tapRatePerSec` per tick, and
`startingCredits = buyInSkr × creditsPerSkr` = 12 × 100 = **1200**.

`TAP_BATCH` is `{ tier, count, lane?, clientTs }` with `count` in **1–60**. `tier` is advisory
and `clientTs` is ignored by the server.

---

## 3. What exists in `src/state/`

Two modules, deliberately separate per `CLAUDE.md`. Neither imports React; the tap handler runs
synchronously inside `onTouchStart` and cannot afford a hook, a context read or a `setState`.

### `optimistic.ts`

`createOptimisticStore(config, startingCredits)` returns
`{ tap, takePending, pendingCount, setTier, tier, rebase, snapshot, subscribe }`.

`tap(nowMs)` mirrors the server's clamps in the server's order and returns a `TapOutcome`:

```ts
if (tokens < 1) return { applied: false, reason: 'rate' }
const { cost, units } = config.tapTiers[tier]
if (credits < cost) return { applied: false, reason: 'credits' }
const headroom = config.laneCapacity - ownUnits
if (Math.floor(headroom / units) < 1) return { applied: false, reason: 'laneFull' }
```

The local bucket is whole taps refilled continuously, starting full. The server's bucket is
integer quarter-tokens; whole taps at a continuous refill is the same bucket seen from the
client, and avoids pretending the client knows the server's tick boundaries.

### `match.ts`

`createMatchStore(initial)` holds the authoritative snapshot only — no prediction, no rules —
with `applyBoard` for `BOARD_UPDATE` and `applyCredits` for `CREDITS`. It exists now rather
than at item 3 so the dev loopback writes through the same door the socket will: item 3
replaces the writer and nothing downstream changes.

---

## 4. The over-count bug and its fix

`takePending()` zeroed the `pending` count but left the `pendingUnits` and `pendingCost`
accumulators set. Sequence: tap ×3 → batch timer fires → tap ×2. `pending` correctly became 2,
but the accumulators still read 5 units and 5 taps' cost, so the next `rebase()` re-applied the
3 taps the server had already accounted for — inflating the lane by 3 units on every batch
cycle and under-reporting credits by their cost.

**Fix:** `takePending()` now zeroes `pendingUnits` and `pendingCost` alongside `pending`, so
the accumulators only ever describe taps that have not been sent.

`rebase()` is now:

```ts
credits = authoritativeCredits - pendingCost
ownUnits = Math.min(config.laneCapacity, authoritativeUnits + pendingUnits)
```

**The consequence is deliberate and should not be "fixed" by re-adding the accumulators.** A
batch that has been sent but not yet acknowledged is _not_ re-applied on top of an authoritative
value. Without sequence numbers on the wire there is no way to tell an unacknowledged batch from
one already included in the server's number. Those taps settle by lerping up when the server's
value arrives, which is what hard rule 2's reconciliation exists for.

---

## 5. Tokens and motion added for item 2

All in `src/design/`, per hard rule 5 — no component carries a literal.

`tokens.art`:

| Token             | Value | Why                                                                     |
| ----------------- | ----: | ----------------------------------------------------------------------- |
| `sparkSize`       |    10 | §7.3's spark marks where the thumb landed; it is not an effect.         |
| `sparkPoolSize`   |     8 | At 6 taps/sec with a 400ms fade at most three are alive; 8 is headroom. |
| `creditsLow`      |   100 | §7.3 — below this the counter shifts to `toll`.                         |
| `creditsCritical` |    20 | §7.3 — below this it also pulses.                                       |

`motion`:

| Value               | Value | Why                                                                    |
| ------------------- | ----: | ---------------------------------------------------------------------- |
| `duration.spark`    |   400 | §8 names none; matches `tollEmbers`, the other single-shot board mark. |
| `transition.spark`  |     — | `duration.spark` with `easing.easeOut` — a spark fades out, never in.  |
| `creditPulsePeriod` |  2000 | §7.3 says "pulses slowly" and names no period. Unease, not an alarm.   |

Deleted in item 1b/1c and not to be reintroduced: every Heart token, `heartPulsePeriod`,
`transition.heartPulse`, and the `mix()` helper (added for a rejected fill candidate).

---

## 6. Not built yet

### Phase 2 — remaining

- `src/screens/Offering.tsx` on the item-1b board: tap band as a bare `View` with
  `onTouchStart`, the spark pool, the tier button that flushes pending taps before the change
  takes effect, the 250ms batch timer pushing `TAP_BATCH` to a local outbox array, the dev
  loopback with its "drop 30%" chip, reconciliation per hard rule 2, `expo-keep-awake`, and the
  accessibility labels.
- An animated fill path for `Conduit`. **Open question, not answered.** `react-native-svg`
  15.15.4 marks `scaleY`/`originY` deprecated in favour of `transform`, and ships nothing
  Reanimated-aware. A probe written to settle this was inconclusive and has been deleted; the
  question is open. The fallback, if `animatedProps` cannot drive the SVG rect, is
  `useAnimatedStyle` on a wrapping RN `View`, or a `View`-based fill overlay — both are
  transform-and-opacity only and satisfy hard rule 3.
- **The credit counter must use the 10Hz throttled state update**, isolated in a leaf
  `CreditCounter` so `Offering` never re-renders per tap. There is **no supported UI-thread
  animated-text API in Reanimated 4.5.1**: `addWhitelistedNativeProps` is a documented no-op,
  there is no `propsAllowlists` module, and there is no `Animated.TextInput`.
- `BoardPreview.tsx` is still the rendered route and is to be deleted when `Offering` lands.
  `src/app/index.tsx` currently points at it.

### Phase 3 — not started

Release-variant build to the phone, the dev-only render-count check during a 10s burst,
`dumpsys gfxinfo` frame statistics, and the owner's feel test on both tiers with "drop 30%" off
and on. If signing fails, report it — do not create keystores or change the signing config
without asking.

---

## 7. Repository state

`58444e8` (`mobile: item 1c`) was the last commit before this session's work. Nothing has been
pushed. No dependency was added and no new native module is needed.
