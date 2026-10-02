# Reztor wire protocol

The contract between the Reztor server and any client. Derived from the server implementation
(`server/src/net/`, `server/src/engine/selectors.ts`), not from prose — where this document and the
code disagree, the code is right and this document is a bug.

Types for this contract are generated into `mobile/protocol/generated.ts`. Import them; do not
retype them by hand. Regenerate with `cd server && pnpm protocol:emit`.

Transport is **Socket.IO**. One room per match. The reference client is
`server/dev/client.html` — a working implementation of everything below in about 200 lines, served
at `/dev` by `pnpm serve`.

---

## 1. Shape of every message

Client → server messages are Socket.IO events carrying one object. All are validated with strict
schemas: **an unknown field is a rejection, not a warning.**

Server → client messages carry an envelope:

```ts
{ matchId: string, serverTick: number, ...payload }
```

Two exceptions:

- `ACTION_REJECTED`: both envelope fields may be `null`, because a socket can be refused before it
  belongs to any match.
- `LOBBY_UPDATE` and `LOBBY_DISSOLVED`: `matchId` is the real match id — a lobby has one from the
  moment it is created, the same one in your ticket — and `serverTick` is **always `null`**. There
  is no match clock until the lobby fills; the first real tick is `MATCH_STARTED`'s `0`.

Three client messages use Socket.IO acknowledgements (`emitWithAck`) and get a direct response:
`CREATE_LOBBY`, `JOIN_LOBBY`, `JOIN`. Every other client message is fire-and-forget; the only reply
you will ever get is a state change or an `ACTION_REJECTED`.

---

## 2. Joining a match

```
CREATE_LOBBY { name, wallet? }        -> ack { ok, ticket }
JOIN_LOBBY   { code, name, wallet? }  -> ack { ok, ticket }
JOIN         { matchId, sessionToken } -> ack { ok, playerId, reconnected, waiting? }
```

The ticket is:

```ts
{ code, matchId, playerId, sessionToken, seated /* 1..4 */, started }
```

`code` is four characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no I, O, 0 or 1, because it gets
read aloud and typed by hand. It is case-insensitive on the way in.

**Send `JOIN` as soon as you have a ticket.** Do not wait for the lobby to fill. A player seated in
a lobby that is not yet full binds their socket and waits in the room; the ack comes back with
`waiting: true` and `MATCH_STARTED` arrives later, unprompted, when the fourth player joins. There is
no "lobby full" message to poll for and no reason to press anything twice.

`ok: false` carries `UNKNOWN_CODE`, `LOBBY_FULL`, `ESCROW_FAILED` or `INVALID_PAYLOAD` for the lobby
messages; `INVALID_PAYLOAD`, `UNKNOWN_SESSION` or `WRONG_MATCH` for `JOIN`. With on-chain escrow the
lobby messages require `wallet` and can also return `WALLET_UNFUNDED` or `WALLET_TAKEN` — see
[CHAIN-PROTOCOL-CHANGES.md](CHAIN-PROTOCOL-CHANGES.md).

### `LOBBY_UPDATE` — while seated, to the lobby room

```ts
{ matchId, serverTick: null, code, seated, capacity,
  players: { seated, id, name }[], expiresAt, serverNow }
```

Sent to the room every time a seat is taken or vacated, including the fourth seat, which arrives
just before `MATCH_STARTED`. A socket also gets one, to itself, as soon as its `JOIN` comes back
`waiting: true` — that is how a joiner renders the lobby immediately. **The lobby acks do not carry
the roster**: a client that sends `JOIN` as soon as it has a ticket (as it must) has the roster one
message later, and there is only one shape to render from.

`players` is in seat order and `seated` on each is that player's seat number now. **Seat numbers
move down** when an earlier player leaves, so the ticket's `seated` is only true at the moment it was
issued; `LOBBY_UPDATE` supersedes it. Find your own row by `id` — the `playerId` from your ticket.
Player ids are public (every `BOARD_UPDATE` carries them) and cannot be used to act as anyone:
identity is the `sessionToken`, which never appears here. No wallets, no tokens.

**The deadline.** `expiresAt` is when the lobby dissolves if it has not filled, in server epoch
milliseconds. It is fixed at creation and never moves, not even when a seat is vacated. `serverNow`
is the server's clock when the message was sent. Compute time left as `expiresAt - serverNow` and
count down from when the message arrived. **Never compare `expiresAt` with the device clock** — an
absolute time is exactly as wrong as the skew between the two clocks, and phone clocks are wrong by
seconds. Ticks were not an option: a lobby has no tick counter until its match starts.

### `LOBBY_DISSOLVED` — once, to the lobby room

```ts
{ matchId, serverTick: null, code, reason: 'TIMEOUT' | 'ESCROW_FAILED' | 'STAKE_TIMEOUT' }
```

Sent before the lobby is discarded. After it, the code is unknown and every session in the lobby is
gone: `JOIN` with those tokens returns `UNKNOWN_SESSION`. Go back to the entry screen.

- `TIMEOUT` — the lobby did not fill within `lobbyFillTimeoutSec` (60s) of creation.
- `ESCROW_FAILED` — the fourth player sat down and escrow could not be opened. That player's
  `JOIN_LOBBY` ack says `ESCROW_FAILED`; the other three learn it here.
- `STAKE_TIMEOUT` — on-chain escrow only: not every player paid their stake within the funding
  stage's 90 seconds.

Nothing is staked until all four seats are filled, so `TIMEOUT` has nothing to refund. When a lobby
dissolves after the fourth seat, the server voids the match on chain first, refunding anyone who
paid, and only then sends this.

### `STAKE_REQUEST` and `STAKE_UPDATE` — on-chain escrow only, between the fourth seat and `MATCH_STARTED`

`STAKE_REQUEST` goes privately to each seat that has yet to pay and carries a transaction for the
player's wallet to sign and send. `STAKE_UPDATE` tells the room which seats have paid. Neither is
ever sent with the fake escrow. Full contract, including when the app must prompt the wallet:
[CHAIN-PROTOCOL-CHANGES.md](CHAIN-PROTOCOL-CHANGES.md) §3.

### Leaving a lobby

There is no leave message. **Close the socket.** A seat whose socket has gone is freed on the same
rule as a match disconnect (§5) — from the later of the socket closing and the heartbeat lapsing —
plus a lobby grace of 15 seconds: about 21 seconds after the last sign of life. The room gets a
`LOBBY_UPDATE` without that player, and their `sessionToken` stops working.

The grace is there so that backgrounding the app — to paste the invite code into a chat, say — does
not cost a seat. Come back inside it, reconnect, and `JOIN` with the same token as usual; the seat
is still yours and a `LOBBY_UPDATE` arrives. Keep sending `HEARTBEAT` while seated.

A seat whose ticket was issued but never followed by `JOIN` is freed the same way, counted from when
it was issued, as is one whose socket has since sent `JOIN` for a different lobby. Once the fourth
seat is taken no seat is freed: the lobby is committed to escrow.

### Identity

`playerId` is bound to the socket by `JOIN` and is **never read from a message payload**. Nothing a
client sends can claim to be another player. Keep the `sessionToken`: it is the only thing that can
reconnect you, and it survives the socket.

---

## 3. Match messages

### `MATCH_STARTED` — once, privately, per player

```ts
{ ...envelope, view: PrivateView }
```

**The only message that carries `config`, and the only message that tells you your role.** Store
both. `config` is frozen for the life of the match and is never sent again — every rule number the
client needs (lane capacity, win target, tier costs, stage durations, grace period) lives here.

### `BOARD_UPDATE` — every tick, to the room

```ts
{ ...envelope, board: { round, stage, secondsLeft, lanes, boardTotal, players } }
```

Four times a second. It carries **only what changes per tick**: no config, no chat history, no
per-player credits. 499 bytes.

`secondsLeft` is whole seconds remaining in the current stage, computed server-side, so a client
renders a countdown without knowing what a tick is. `lanes` is `{ owner, units, dormant }` per lane,
and `players` is `{ id, name, status }`.

**Lanes and players are in seat order** — the order of the last `LOBBY_UPDATE`'s `players`, so lane
index + 1 is the seat number, and the sigil a player was shown while seated is the one they keep.
The same order holds in `MATCH_STARTED`, `RESUME_STATE`, the reveal and the settlement's `lines`.
Nothing about a lane's rules depends on its position; every action names lanes by `playerId`.

### `CHAT_MESSAGE` — when a message is posted, to the room

```ts
{ ...envelope, from, text, tick }
```

Pushed once. **Clients accumulate their own history**; it is not resent. Only a reconnecting player
needs a backlog, and `RESUME_STATE` carries it.

### `STAGE_CHANGE` — on every stage boundary, to the room

```ts
{ ...envelope, round, stage, endsAtTick }
```

Stages cycle `tap → chat → vote` per round, for `config.rounds` rounds. `BOARD_UPDATE` also carries
the current stage every tick, so this message is the edge, not the state.

### `CREDITS` — after any action that costs, privately

```ts
{ ...envelope, credits, spent, tier }
```

Authoritative. Reconcile optimistic local spending against it rather than tracking cost yourself.

### `SIPHON_RESULT` — impostor only

```ts
{ ...envelope, source, sink, pulled, delivered, destroyed }
```

### `TRACE_RESULT` — purchaser only

```ts
{ ...envelope, target, result: 'natural' | 'received' | 'drained' }
```

Never names a counterparty. The result is the largest single component of the target lane's change
during the **previous** round.

### `VOTE_RESULT` — at vote-stage close, to the room

```ts
{ ...envelope, round, votes: Record<PlayerId, VoteTarget>, ejected: PlayerId | null }
```

`votes` is what each player **cast**, revealed simultaneously. A player who voted for someone already
ejected still shows that vote here, even though the tally counted it as a skip — the reveal must never
show someone abstaining when they did not.

Nothing about a vote is sent before this message. There is no partial tally, no count, no
"3 of 4 have voted" signal, and a client must not synthesise one.

### `MATCH_END` — once, to the room

```ts
{ ...envelope, reveal: MatchEndView, settlement: Settlement }
// or, if the match could not be settled:
{ ...envelope, error: MatchEndError }
```

`reveal` hides nothing: roles, the role seed, every trace, the full vote history, per-player
contributions. `settlement` reconciles exactly — escrow equals refunds + payouts + rake + dust.

### `SETTLEMENT_CONFIRMED` — on-chain escrow only, to the room, after `MATCH_END`

```ts
{ ...envelope, signature: string, payouts: string[] }
```

Sent once the chain has paid out `MATCH_END`'s settlement: the transaction signature and each seat's
payout in base units. See [CHAIN-PROTOCOL-CHANGES.md](CHAIN-PROTOCOL-CHANGES.md) §4.

### `ACTION_REJECTED`

```ts
{ matchId: string | null, serverTick: number | null, action, code, reason }
```

Two kinds of `code`:

- A **`RejectionCode`** means a rule refused the action: `WRONG_STAGE`, `INSUFFICIENT_CREDITS`,
  `LANE_FULL`, `NOT_IMPOSTOR`, `SOURCE_TOO_LOW`, `SINK_FULL`, `RATE_LIMITED`, `TRACE_USED`,
  `NO_PREVIOUS_ROUND`, `CHAT_RATE_LIMITED`, and the rest.
- A **`TransportCode`** means it never reached the engine: `NOT_JOINED`, `NO_MATCH`,
  `INVALID_PAYLOAD`, `TOO_MANY_MESSAGES`. These carry `matchId: null` when the socket has no match.

**The one thing that is dropped silently is a rate-clamped tap** (see §4). Everything else that does
not happen says so. A well-behaved client should see zero rejections in a normal match; treat a
non-zero count as a client bug.

---

## 4. Actions

```
TAP_BATCH { tier, count, lane?, clientTs }
SET_TIER  { tier }
SIPHON    { source, sink }
TRACE     { target }
CHAT      { text }
VOTE      { target | 'skip' }
HEARTBEAT {}
```

**Tapping.** Tap stage only. `count` is 1–60. `lane` defaults to the sender's own and any other lane
must be dormant. `tier` in the payload is **advisory only** — the server applies the tier it stored
for you, so change tiers with `SET_TIER`. `clientTs` is accepted and ignored; client time is never
trusted.

Taps are clamped by a token bucket at `config.tapRatePerSec` (6/sec, burst 6). **Excess taps in a
batch are dropped silently** and are the only silent drop in the protocol. Taps are then clamped by
credits and by lane headroom; a batch that applies zero taps for either reason is rejected with
`INSUFFICIENT_CREDITS` or `LANE_FULL` and changes nothing.

**Siphon.** Impostor only, tap stage only. Pulls 10 from the source, delivers 6 to the sink, destroys
4. Costs 6 credits into another lane, 12 into your own. Rejected if source and sink are the same
lane, if the source holds fewer than 10 units, or if the sink has less than 6 units of headroom —
there are no partial pulls and no partial deliveries. Its own token bucket allows 4/sec.

**Trace.** 200 credits, one per player per match, tap stage only, reads the **previous** round —
so it is never available in round 1 (`NO_PREVIOUS_ROUND`).

**Chat.** Chat stage only, 240 characters, one message per 2 seconds per player.

**Vote.** Vote stage only. Change it as often as you like until the stage closes; last write wins.
Not voting is a skip. Self-votes are allowed.

**Heartbeat.** Every 2 seconds. See §5.

---

## 5. Disconnect and reconnect

A closed socket is **not** on its own treated as leaving — mobile clients background aggressively.
The grace clock starts at the later of the socket closing and the heartbeat lapsing (3 missed
heartbeats, 6 seconds). A client that backgrounds and returns inside that window is never marked
disconnected at all.

Once grace starts, the player has `config.disconnectGraceSec` (30s) to return. Their lane freezes:
no taps in or out, and it cannot be siphoned in either direction. They keep their credits, cannot
vote, and still count toward the voting majority. If grace expires they are ejected and their lane
becomes dormant.

**To reconnect:** open a socket and send `JOIN` again with the same `sessionToken`. The ack returns
`reconnected: true` and the server sends `RESUME_STATE`:

```ts
{ ...envelope, view: PrivateView }
```

The full private view — role, credits, board, stage, **the entire chat backlog**, vote history.
There is no replay of missed deltas and no way to request one; a full snapshot is simpler and always
correct. Resume silently.

Each socket also has a plain message allowance of 40 burst, 20/sec, separate from the game's token
buckets. Exceeding it yields `TOO_MANY_MESSAGES`.

---

## 6. What a client must never infer

These are protocol guarantees the client is required not to undermine.

**The board never reveals a siphon.** `BOARD_UPDATE` carries lane totals and nothing else. There is
no event, ordering, or field that pairs a falling lane with a rising one — `SIPHON_RESULT` goes to
the impostor alone. A client that draws a connection between a drop in one lane and a rise in
another manufactures knowledge the protocol deliberately withholds, and the game stops working.

**Roles are private until `MATCH_END`.** Role reaches a player once, in their own `MATCH_STARTED`.
No other message contains another player's role. Ejection does not reveal one.

**Votes are secret until `VOTE_RESULT`.** No partial tallies exist on the wire; do not invent a
"has voted" indicator.

---

## 7. Ordering and timing

- The server is authoritative for every rule. Clients send intent; the server decides what happened.
- Inbound messages are queued and applied on the next tick, not on arrival, so ordering is
  deterministic. Expect up to 250ms before an action is reflected in a `BOARD_UPDATE`.
- One tick is 250ms. A full match is 1440 ticks — 3 rounds of 60s tap, 45s chat, 15s vote.
- Ticks never overlap, and a delayed tick advances the match clock by the intervals that actually
  elapsed, so the game clock does not run slow. Measured drift over a full match is under 25ms.
- Because a tap is only reflected on the next tick, **the client must render its own tapping
  optimistically** and reconcile against `CREDITS` and `BOARD_UPDATE`.
