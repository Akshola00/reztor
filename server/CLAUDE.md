# Reztor Server — CLAUDE.md

Authoritative game server for Reztor, a 4-player social-deduction tapping game with
Solana settlement. Read `../docs/reztor-spec.md` for game design intent. **This file
wins on any conflict with the spec** — it resolves ambiguities the spec left open.

---

## 0. Non-negotiables

Violating any of these is a bug, not a style preference.

1. **The server is the only authority.** Clients send intent. The server decides what
   happened. Never trust a client-supplied unit count, credit balance, lane value,
   timestamp, or player identity.
2. **The engine is pure.** `reduce(state, event) -> state` with no I/O, no `Date.now()`,
   no randomness. Time and entropy enter as event fields. This is what makes matches
   replayable and testable.
3. **The database is never in the tap path.** In-memory state is authoritative during a
   match. Postgres is crash insurance only.
4. **One global tick.** A single 250ms loop iterates active matches. Never
   `setInterval` per match.
5. **All money math is integer credits.** Never float. SKR conversion happens only at
   escrow and settlement boundaries.
6. **All lane units are integers.** Fractional efficiency is handled by remainder
   accumulators (§5.4), never by rounding a running total.
7. **Every accepted action is appended to the match event log before state changes.**
   The log is the source of truth for settlement, replay, and dispute.

---

## 1. Stack

| Concern | Choice |
|---|---|
| Runtime | Node 20+ (not Bun — Anchor's TS client and its deps are better tested on Node) |
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess: true` |
| Transport | Socket.IO (chosen for reconnect + buffering, see §8) |
| DB | Postgres via Drizzle |
| Chain | `@coral-xyz/anchor` + `@solana/web3.js` |
| Test | Vitest |
| Validation | Zod on every inbound socket payload, no exceptions |

No Redis. Single instance. Add Redis only when sharding across processes is real.

---

## 2. Repo layout

```
src/
  engine/            # PURE. No imports from net/, db/, chain/. Ever.
    state.ts         # MatchState types
    events.ts        # Event union + Zod schemas
    reduce.ts        # reduce(state, event) -> state
    rules.ts         # tap/siphon/trace/vote resolution
    step.ts          # commit(state, event): reduce, then check resolution
    result.ts        # Result<T, E>
    config.ts        # MatchConfig type + MVP defaults
    selectors.ts     # publicView(state), privateView(state, playerId)
  net/
    server.ts        # Socket.IO wiring
    handlers.ts      # inbound message -> validate -> intent -> engine
    broadcast.ts     # state -> outbound messages
    auth.ts          # wallet-signature handshake
  match/
    registry.ts      # Map<matchId, RuntimeMatch>
    tick.ts          # the single 250ms loop
    lobby.ts         # matchmaking + fill timeout
  db/
    schema.ts
    snapshot.ts
  chain/
    client.ts        # Anchor program wrapper
    settle.ts        # settlement queue, idempotent
  sim/
    replay.ts        # replay an event log, assert final state
test/
```

`engine/` has zero runtime dependencies beyond Zod. If you find yourself importing a
socket, a clock, or a DB handle into `engine/`, the design is wrong.

---

## 3. Match lifecycle

```
LOBBY -> ESCROWED -> IN_PROGRESS -> SETTLING -> SETTLED
                          \-> VOIDING -> VOIDED
```

- **LOBBY** — players join a lobby. 60s fill timeout. No escrow taken. On timeout,
  dissolve silently.
- **ESCROWED** — server has confirmed four `join_match` transactions at `confirmed`
  commitment. Only now are roles assigned and `MATCH_START` sent.
- **IN_PROGRESS** — 3 rounds × (60s tap / 45s chat / 15s vote).
- **SETTLING** — terminal state computed, `settle_match` queued.
- **VOIDING** — any void trigger from §11.

A match that has not reached ESCROWED can be abandoned with zero on-chain effect. This
is the only safe abort point; design accordingly.

---

## 4. State shape

```ts
type MatchState = {
  matchId: string
  config: MatchConfig          // frozen at match start, stored with the match
  phase: MatchPhase
  round: number                // 1..config.rounds
  stage: 'tap' | 'chat' | 'vote'
  stageEndsAtTick: number      // tick number, NOT wall clock
  tick: number                 // tick of the last event

  players: Record<PlayerId, PlayerState>
  lanes: Record<PlayerId, LaneState>   // lane is keyed by owner
  roleSeed: string             // 64-char lowercase hex, revealed at MATCH_END
  impostorId: PlayerId

  chat: ChatMessage[]
  votes: Record<PlayerId, PlayerId | 'skip'>  // cleared at each vote stage start
  voteHistory: VoteRound[]
  eventLog: MatchEvent[]

  resolution: Resolution | null
}

type PlayerState = {
  id: PlayerId
  name: string
  wallet: string | null        // nullable in the MVP; never used for ordering
  credits: number              // remaining, integer
  spent: number                // integer, monotonic
  tier: 1 | 2
  status: 'alive' | 'disconnected' | 'ejected'
  disconnectedAtTick: number | null
  traceUsed: boolean           // config.trace.perPlayer is pinned to 1
  tapsAccepted: number
  tapsDropped: number          // rate-clamp drops only
  unitsTapped: number          // units this player personally generated, anywhere
  tapBucket: TokenBucket       // §5.1, §6
  siphonBucket: TokenBucket    // §5.2, §6
  lastChatTick: number | null  // §7 chat rate
}

type TokenBucket = { tokens: number; updatedAtTick: number }  // quarter-tokens

type LaneState = {
  owner: PlayerId
  units: number                // 0..1000, integer
  dormant: boolean
  roundStartUnits: number      // snapshot at round start
  roundDelta: RoundDelta       // reset each round
  prevRoundDelta: RoundDelta | null  // the round a trace reads; null in round 1
  dormantRemainder: Record<PlayerId, number>  // hundredths of a unit, see §5.4
}

type RoundDelta = {
  natural: number              // owner's own taps
  foreign: number              // taps by others into a dormant lane
  received: number             // siphon deliveries that landed
  drained: number              // siphon pulls out (positive magnitude)
}
```

`stageEndsAtTick` rather than a timestamp: the tick counter is the clock. Everything is
deterministic against it and replays identically.

---

## 5. Rules — resolved

These resolve gaps in the spec. Where the spec is silent I have chosen a default and
marked it **[D]**. Defaults marked **[D!]** are the ones most worth a human deciding —
see §15.

### 5.1 Tap

- Tier 1: 1 credit → 1 unit. Tier 2: 4 credits → 3 units.
- Tier is private, changeable at any time during a tap stage, applies to subsequent
  batches only.
- `TAP_BATCH { tier, count, lane?, clientTs }`. **`tier` in the payload is advisory
  only** — the server applies its own stored tier for that player. **[D]** This prevents
  a client claiming tier 2 units at tier 1 pricing.
- **Rate clamp is a token bucket, not a per-batch cap. [D]** Capacity 6, refill 6 per
  second, refilled per tick (1.5 tokens per 250ms tick). Excess taps in a batch are
  dropped silently and counted in `tapsDropped`. A per-batch cap of 1.5 would punish
  bursty-but-legitimate tapping; a bucket allows a real thumb through and still caps
  sustained rate at 6/sec.
- **Partial affordability: apply what the player can afford, drop the rest. [D]** Do not
  reject the whole batch. A batch of 10 tier-2 taps with 25 credits applies 6 taps
  (24 credits) and drops 4.
- **Lane cap: apply taps until the lane hits 1000, then drop the remainder and do not
  charge for them. [D]** Credits are never burned into a full lane.
- **A tap whose units do not fully fit is dropped uncharged, never clipped. [D]** A
  tier-2 tap at 998 is dropped; the player finishes the lane on tier 1. Clipping would
  charge 4 credits for 2 units.
- Order of operations per batch: clamp by tokens → clamp by credits → clamp by lane
  headroom → apply → charge.
- **`tapsDropped` counts rate-clamp drops only. [D]** It is clamp telemetry; credit and
  cap drops are a different signal.
- **In an accepted batch, every tap that clears the rate clamp spends a token, whatever
  happens to it downstream. [D]** The bucket measures input rate, not outcomes.
- **A batch that applies zero taps for credits or lane cap is rejected** with
  `INSUFFICIENT_CREDITS` or `LANE_FULL`, and a rejected batch changes nothing, tokens
  included. **[D]** Only rate-clamp drops are silent (§7). A batch dropped entirely by
  the rate clamp is accepted and logged with `applied: 0`.

### 5.2 Siphon (impostor only)

- Pull 10 from source, deliver 6 to sink, destroy 4. Cost 6 credits if sink is another
  player, 12 if sink is self. No cooldown. Free retargeting per siphon.
- **Reject if source lane has fewer than 10 units. [D]** No partial pulls. The spec says
  "cannot pull from an empty lane" and sets a floor at 0; partial pulls would require
  fractional delivery and make the 10-for-6 ratio illegible. Integer-clean and matches
  the spec's intent.
- **Reject if `source === sink`. [D]** It would be a pure 4-unit burn for 12 credits,
  which is strictly worse than framing and adds nothing but confusion.
- **The impostor's own lane may be a source. [D]** Draining yourself into a crew lane is
  a legitimate (if expensive) cover play. Allow it.
- **Reject if the sink lane has less than `deliver` units of headroom → `SINK_FULL`. [D]**
  A lane at 998 cannot take a delivery of 6, so the siphon does not execute. Clipping
  instead would make framing into a nearly full lane 1.67 net units destroyed per credit
  against 0.67 — a 2.5x gain arriving exactly when crew lanes are near cap in round 3 —
  and it would erase the beneficiary surge, which is half the crew's evidence (spec §1).
  The 10-for-6 ratio holds on every executed siphon.
- **`received` is always `deliver`, because partial deliveries are rejected. [D]** This
  keeps `units == roundStartUnits + natural + foreign + received − drained` exact.
- **Siphon rate limit: separate token bucket, capacity 4, refill 4 per second. [D!]**
  The spec gives siphon no cooldown, and credits alone permit 200 siphons in a burst —
  1200 units of destruction in under a second, which is unreadable on the board and
  indistinguishable from an exploit. The bucket keeps sabotage visible as motion.
- **Dormant (ejected) lanes can be siphoned as a source and as a sink. [D!]** Otherwise
  an ejected lane full of ~800 units becomes a safe vault, and the impostor's round 3
  options collapse.
- **Disconnected players' lanes are frozen — reject siphons in either direction.**
  (Spec §12, explicit.)
- **Rejection precedence [D]:** match over → wrong stage → unknown/not-alive sender →
  `NOT_IMPOSTOR` → unknown lane → `SAME_LANE` → `LANE_FROZEN` → `SOURCE_TOO_LOW` →
  `SINK_FULL` → `RATE_LIMITED` → `INSUFFICIENT_CREDITS`. A fixed order gives one reason
  per failure.
  A rejected siphon spends no token.

### 5.3 Trace

- 200 credits, one per player per match, one target lane, previous round only.
- **Purchasable during a tap stage only. [D]** Round 1 has no previous round, so traces
  are only ever available in rounds 2 and 3. Reject with a clear error in round 1 rather
  than letting the client show a dead button.
- Result = largest single component of the target lane's change during the previous
  round, computed from `prevRoundDelta`: compare `natural + foreign`, `received`,
  `drained`.
- **Tie-break order: `drained` > `received` > `natural`. [D]** Deterministic and
  documented; ties must never be random or insertion-ordered.
- **A lane with all components zero returns `natural`. [D]** The tie-break would return
  `drained` and turn the trace into a slander machine against a lane that visibly did
  not move.
- Tracing your own lane is allowed. Tracing a dormant lane is allowed. **Tracing a
  disconnected player's frozen lane is allowed [D]** — a trace reads history, not the
  lane.
- The result never names a counterparty. `TRACE_RESULT` goes to the purchaser only.

### 5.4 Dormant lanes

- Ejected player's lane is dormant. Owner cannot tap. Any living player may tap into it
  at `dormantEfficiencyPct` (50%).
- **Half-unit handling: per-player-per-lane remainder accumulator. [D]** Remainders are
  stored in hundredths of a unit so any efficiency percentage stays integer-exact:

  ```
  scaled         = applied × tierUnits × pct + remainder
  units          = floor(scaled / 100)
  remainderAfter = scaled % 100
  ```

  Without this, tier-1 taps into a dormant lane yield `floor(0.5) = 0` and the action is
  silently worthless — a guaranteed player-reported bug.
- **Headroom clamp for a dormant lane counts the pending remainder. [D]**

  ```
  maxTaps = floor((100 × headroom − remainder) / (tierUnits × pct))
  ```

  clamped at 0. Worked edge case: headroom 1, remainder 50, tier 1 at 50% →
  `floor((100 − 50) / 50) = 1` tap, which lands exactly 1 unit and leaves remainder 0.
  Do **not** add `+99` to the numerator: that admits a tier-1 tap into a full lane, charges
  a credit, and parks a half-unit that can never land.
- **Remainders persist across rounds and are never reset. [D]** A half-unit a player paid
  for stays theirs.
- Units tapped into a dormant lane credit `roundDelta.foreign`, not `natural`.

### 5.5 Voting

- Majority is strictly more than half of **living** players. `alive` and
  `disconnected`-within-grace both count as living for the threshold. **[D!]**
  Disconnected players cannot cast a vote, so a 4-living/1-disconnected vote requires all
  three remaining players to agree. This is harsh but preserves the rule as written;
  the alternative (excluding them from the denominator) lets a disconnect hand the
  remaining players a cheaper ejection.
- **Vote may be changed freely until the stage closes; last write wins. [D]**
- **No vote submitted = skip.**
- **Self-votes are allowed. [D]** The spec does not forbid them, and a self-vote is a
  legible bluff.
- **A vote cast before the voter disconnects still counts. [D]** It was a valid vote when
  cast; the voter just cannot change it.
- **Threshold and target validity are evaluated at stage close. [D]** Living players are
  counted at close, so a grace expiry inside the vote window lowers the threshold.
- **Each vote is recorded as `cast` and `counted`. [D]** The tally uses `counted`; the reveal
  shows `cast`. A vote for a player ejected before the stage closed keeps its target in
  `cast` and becomes skip in `counted`. The reveal is the social core of the match and must
  never show someone abstaining when they did not.
- All votes hidden until the stage timer expires, then revealed simultaneously in
  `VOTE_RESULT`. Never leak a partial tally — not in a count, not in a "3 of 4 have
  voted" indicator. **[D]**
- Tie or majority-skip: nobody ejected.

### 5.6 Resolution order

Checked in exactly this order after every reduce, by `checkResolution`:

1. Already resolved → nothing.
2. **Board ≥ `winTarget` → crew win, `BOARD_TARGET`, and it latches. [D!]** The instant
   the total crosses, the match ends. Spec §9 says "reaches", which reads as a latch, and
   the alternative makes the target meaningless in round 3.
3. **Impostor ejected → crew win**, `IMPOSTOR_EJECTED` if voted out, `IMPOSTOR_TIMED_OUT`
   if their grace expired. Above the void so a losing impostor cannot rage-quit into a
   free refund.
4. **Two or more grace expiries → `MATCH_VOIDED`, `ABANDONED`.** Two players walking out
   leaves no game to resolve, so nobody is paid. Above the crew-ejection win, which would
   otherwise always fire first and make the void unreachable.
5. **Two crew ejected → impostor win, `CREW_EJECTED`.** Grace-expired crew count as
   ejected here, so one vote-out plus one expiry is an impostor win.
6. **`voteHistory.length === config.rounds` → impostor win, `ROUNDS_EXHAUSTED`.**

The match resolves after round 3's *vote*, never after round 3's tapping.

---

## 6. The tick loop

One `setInterval(tick, 250)` for the whole process.

```
tick():
  now = monotonic()
  for each match in registry where phase == IN_PROGRESS:
    match.tick++
    drain that match's inbound intent queue -> validate -> append events -> reduce
    check disconnect grace expiries
    check win conditions
    if match.tick >= stageEndsAtTick: advance stage (emit STAGE_CHANGE)
    broadcast BOARD_UPDATE to the room
    per-player private deltas (CREDITS, SIPHON_RESULT, TRACE_RESULT) to individual sockets
  every 40 ticks (10s): queue snapshot write (async, never awaited in the loop)
```

Inbound messages are **queued, not applied on arrival**. Handlers push an intent onto
`match.pendingIntents`; the tick drains it. This keeps ordering deterministic and makes
the whole match reproducible from the log.

**Grace expiries due in the same tick are applied in `playerId` order. [D]** Any fixed
order is deterministic; `playerId` is the one every replay has.

**Token buckets refill lazily, and `TICK` is never an event.** Store `tokens` and
`updatedAtTick` per bucket; on any action, refill to
`min(capacity, tokens + (tick − updatedAtTick) × refillPerTick)` before spending.
A logged TICK event every 250ms would add ~1440 entries per match to a log that
otherwise holds a few hundred real actions, for information already derivable from the
tick field every event already carries. `state.tick` is the tick of the last event.

Tokens are stored as integer quarter-tokens: tap bucket capacity 24, refill 6 per tick;
siphon bucket capacity 16, refill 4 per tick. No fractional token state anywhere.
**Buckets start full at match start [D]** so the opening burst is not clamped.

If a tick overruns 250ms, log it loudly. Never let ticks overlap — guard with a running
flag and, if a tick is skipped, advance `match.tick` by the number of elapsed intervals
so the game clock does not drift slow.

---

## 7. Protocol

Spec §13.2 is the baseline. Additions required for a working server:

**Client → server (all Zod-validated, all reject on unknown fields):**

```
JOIN        { matchId, sessionToken }
TAP_BATCH   { tier, count, lane?, clientTs }   // lane defaults to sender's own; any
                                               // other lane must be dormant
SET_TIER    { tier }
SIPHON      { source, sink }
TRACE       { target }
CHAT        { text }          // max 240 chars, 1 per 2s per player, chat stage only
VOTE        { target | "skip" }
HEARTBEAT   {}
```

- **`TAP_BATCH.count` is an integer 1–60. [D]** The bucket never admits more than 6, so
  anything larger is noise, not tapping.
- **`clientTs` is accepted and ignored — never logged, never read. [D]** Client time is
  untrusted (§0.1).
- **Chat is open during the chat stage only. [D]** Spec §7 opens chat for that stage; the
  vote stage is for voting. The 2s rate is 8 ticks since the sender's last accepted chat.

**Server → client, added:**

```
RESUME_STATE { fullPrivateView }   // sent on successful reconnect, see §8
ACTION_REJECTED { action, reason, code }
SNAPSHOT_LAG { }                   // optional, dev only
```

`ACTION_REJECTED` is mandatory. A silently dropped action is indistinguishable from a
bug on the client and will cost days of debugging. The one exception is clamp-dropped
taps, which are dropped silently by design (spec §5.1).

Every outbound message carries `matchId` and `serverTick`.

---

## 8. Connection, identity, reconnection

**Identity (MVP).** No cryptographic verification. When a player joins a lobby the
server generates a `sessionToken` and returns it with their `playerId`. The client
sends `JOIN { matchId, sessionToken }` on connect and reconnect; the server looks it up
and binds the socket to that player. Until JOIN succeeds the socket is in no room and
all game messages are rejected.

`playerId` is never taken from a message payload — always from the socket's bound
session. This is a trust-based build; keeping identity at the connection layer means
adding real verification later is one function in `net/auth.ts`, not a pass over every
handler.

**Disconnect.** Grace starts on the *later* of socket close or heartbeat timeout
(3 missed heartbeats at 2s). Mobile clients background aggressively; a socket close is
not reliable evidence of a player leaving. **[D]**

On disconnect: lane frozen (no taps in or out, cannot be siphoned as source or sink),
player keeps credits, cannot vote, counts as living for the majority threshold.

**Reconnect.** Socket.IO reconnects, client re-AUTHs, server sends `RESUME_STATE` with
the full private view: role, credits, tier, trace used, board, stage and remaining
time, chat backlog, vote history. Do not attempt to replay missed deltas. A full
snapshot is simpler and always correct.

**Grace expiry** → treated as ejected, lane becomes dormant. If that player is the
impostor, crew win immediately.

---

## 9. Persistence

Postgres tables: `matches`, `match_events`, `match_snapshots`, `settlements`.

- Snapshot every 10s and at every round boundary. Async, fire-and-forget with error
  logging — never block a tick on the DB.
- Append the event log in batches on the same cadence.
- Recovery: load latest snapshot, replay events after its tick. If replay fails or the
  snapshot is older than 30s, void the match.
- `settlements` rows are the idempotency ledger — see §10.

---

## 10. Chain integration

- `create_match`, `join_match`, `settle_match`, `void_match`.
- Server verifies all four `join_match` txs at `confirmed` before ESCROWED. If the
  lobby's 60s fill timeout expires with partial joins, `void_match` refunds those who
  did join.
- **Settlement must be idempotent.** Write a `settlements` row keyed by `matchId` with
  status `pending` *before* sending the tx. Retry with backoff on failure. Never
  construct a second settlement payload for a matchId that already has a row — a retry
  sends the same transaction, not a recomputed one.
- Settlement payload: per-player unspent credits (refund), winner list, rake bps.
  Compute it from the event log, not from live memory, so it is reproducible. A pure
  `computeSettlement(log, config)` lives in `engine/`, not `chain/`, so the golden
  replays can assert it.
- **Ejected players are winners if their side won.** A crew member voted out in round 2
  still takes an equal share of a crew win (spec §8). Build the winner list from roles,
  not from who is still alive.
- **Dust rule.** Pot minus rake rarely divides evenly among winners. The remainder goes
  to the rake, reported as a separate `dustCredits` field rather than folded in
  silently. Escrow == refunds + payouts + rake + dust, exactly, always.
- Authority keypair from env for MVP. Flagged for KMS before real money.
- Rake is a config value; 0 in testing.

---

## 11. Void triggers

The in-match void rule is a single condition, positioned in the §5.6 resolution order:
**void when two or more players have had a grace period expire.** Do not also carry a
"fewer than 3 live players" rule; two overlapping rules that can disagree is how this
gets subtly wrong.

- A voted-out player never counts toward the void rule. Ejection by vote is a legitimate
  game outcome and must never void a match.
- An impostor whose grace expires is a crew win, checked before the void.
- Disconnected players still within grace count toward nothing. Wait for expiry.

Also void, unconditionally:

- Snapshot recovery failure
- Settlement payload fails validation (refunds + payouts + rake + dust ≠ escrow)

That last check runs before every settlement. If the numbers do not balance exactly,
void rather than settle. **Never send a settlement you cannot reconcile.**

---

## 12. Config

All of spec §16's dials live in one `MatchConfig` object, frozen into the match at
start and persisted with it, so historical matches replay under the config they ran
under. Never read live config inside the engine.

```ts
const MVP_CONFIG: MatchConfig = {
  laneCapacity: 1000, winTarget: 2400,
  tapTiers: { 1: { cost: 1, units: 1 }, 2: { cost: 4, units: 3 } },
  tapRatePerSec: 6,
  siphon: { pull: 10, deliver: 6, costOther: 6, costSelf: 12, ratePerSec: 4 },
  trace: { cost: 200, perPlayer: 1 },
  dormantEfficiencyPct: 50,
  rounds: 3, stageDurations: { tap: 60, chat: 45, vote: 15 },
  buyInSkr: 12, creditsPerSkr: 100, rakeBps: 0,
  disconnectGraceSec: 30, lobbyFillTimeoutSec: 60,
}
```

### 12.1 Balance rationale — replaces spec §11's 850/2550 figures

Spec §11 mixes two meanings of "85%": 85% of the 1000-unit lane cap (850) and 85% of a
tap rate. They are not the same number, and tier-1-only play reaches neither.

**The crew baseline is the mixed-tier optimum, not tier 1 alone.** At the assumed 4 taps
per second and 85% efficiency a player gets 612 taps in a match and holds 1200 credits:

```
maximise  t1 + 3·t2   subject to   t1 + t2 ≤ 612 (taps)
                                   t1 + 4·t2 ≤ 1200 (credits)
→ t1 = 416, t2 = 196 → 1004 units, exactly 1200 credits spent
```

That hits the lane cap. Three crew playing well put ~3000 on the board against a 2400
target, so the impostor must destroy 600 net units: roughly 900 credits of framing,
leaving ~300 for cover. That is spec §11's conclusion, reached by correct arithmetic.

**Tier 2 is load-bearing, not a luxury.** It converts credits into units at 3 per tap, so
the binding constraint is the fixed 1200 credits rather than the thumb. Tier-1-only play
leaves 588 credits unspent and finishes around 1836 — a losing line, not a baseline.

**The win target is insensitive to the tap rate.** The optimum is 1004 units per lane at
4 taps/sec, 953 at 3, and 926 at 2.5. **Do not lower the win target from 2400** on the
strength of a tap-rate measurement; dial #1 in spec §16 matters far less than it claims.

`test/probes/balance.probe.test.ts` prints both lines every run and asserts nothing.

---

## 13. Testing — required, not optional

The engine is pure, so there is no excuse for thin tests.

1. **Golden replays.** A committed event log per scenario; replay asserts exact final
   state. Scenarios: crew board win, crew ejection win, impostor timeout win (round 3
   vote closes below target — `ROUNDS_EXHAUSTED`, not `IMPOSTOR_TIMED_OUT`), impostor
   double-ejection win, void by abandonment (two grace expiries), reconnect mid-round.
2. **Invariant property tests**, asserted after every reduce:
   - every lane holds an integer in `[0, laneCapacity]`
   - every player's `credits + spent == 1200`, `credits >= 0`, `spent` never decreases
   - per lane: `units == roundStartUnits + natural + foreign + received - drained`
   - **unit conservation**, folded from the event log: `Σ lane units == Σ units tapped
     − Σ units destroyed`, where destroyed includes delivery clipped at the lane cap
   - **credit conservation**, folded from the event log: per player,
     `spent == Σ tap costs + siphon costs + trace costs`
   - vote tallies never leak before stage close
   - **secrets never leak**: `publicView` contains no occurrence of `impostorId`,
     `roleSeed`, or any player's `credits`, `spent`, `tier`, or `traceUsed`; and
     `privateView(s, p)` reveals siphon activity only when `p` is the impostor

   Do not attempt a single combined units-and-credits identity. Credits do not convert
   to units at a fixed rate — tier 2 yields 0.75 units per credit, dormant lanes half
   that, and traces buy no units at all. Two separate identities, both folded from the
   log independently of live state.
3. **Edge cases with named tests:** siphon from a lane with exactly 10 units; siphon
   into a lane at 998; tier-1 tap into a dormant lane (must eventually yield units);
   batch that exceeds credits, clamp, and lane cap simultaneously; vote change in the
   final tick; disconnect during the vote stage.
4. **Settlement reconciliation test** — for every golden replay, escrow in equals
   refunds + payouts + rake out, to the credit.

---

## 14. Style

- No `any`. No non-null assertions in `engine/`.
- Discriminated unions for events and messages; exhaustive `switch` with a `never`
  default.
- Errors are returned values inside the engine (`Result<T>`), thrown only at the
  boundary.
- No comments restating code. Comment the *why* on every rule marked [D] or [D!] above,
  with a pointer back to this file.
- Structured logging with `matchId`, `tick`, `playerId` on every line.

---

## 15. Open decisions

Everything above marked **[D]** is a default I chose so the build can proceed. Items
marked **[D!]** change how the game plays and should be confirmed by a human before
building:

1. Board win latches immediately on crossing 2400 (§5.6)
2. Siphon rate bucket at 4/sec (§5.2)
3. Dormant lanes remain siphonable (§5.2)
4. Disconnected players count toward the vote majority denominator (§5.5)

---

## 16. Out of scope

Per spec §17: strikes, blackout, proportional payout, >4 lobbies, VRF, rollups, voice,
anti-bot beyond the rate clamp, price oracle, spectators, persistent stats. Do not
build these. Do not leave scaffolding for them.

Also out of scope for MVP: wallet-signature auth, rate limiting beyond the game's own
token buckets, KMS for the authority keypair. Trust-based build.
