# Chain protocol changes

What changes on the wire when the server runs with on-chain escrow (`ESCROW_MODE=chain`, Solana
devnet). Everything else in [PROTOCOL.md](PROTOCOL.md) is unchanged. Types are in
`mobile/protocol/generated.ts`.

With the default `ESCROW_MODE=fake`, none of the new messages are sent and nothing below applies,
except that sending a `wallet` is still accepted. **Write the app for chain mode**: always send the
wallet, and handle `STAKE_REQUEST` when it arrives.

---

## 1. Sitting down: `CREATE_LOBBY` / `JOIN_LOBBY`

```ts
CREATE_LOBBY { name, wallet }        // wallet now REQUIRED
JOIN_LOBBY   { code, name, wallet }  // wallet now REQUIRED
```

`wallet` is the connected wallet's address in base58. It must be a key that can sign: a PDA or the
all-zeros key is refused.

New and changed `ok: false` errors on the ack:

| `error` | When |
| :---- | :---- |
| `INVALID_PAYLOAD` | `wallet` is missing, `null`, or not a valid signing address. |
| `WALLET_UNFUNDED` | **New.** The wallet holds less than the buy-in of the game token in its associated token account (12 mock SKR on devnet), or less than 0.01 SOL. Nobody is seated. Tell the player to top up. |
| `WALLET_TAKEN` | **New.** `JOIN_LOBBY` only: that wallet already holds a seat in this lobby. The chain needs four different wallets. |
| `ESCROW_FAILED` | Also returned when the server could not read the wallet's balance (RPC trouble). Safe to retry. |

The balance is checked once, before seating. It is checked again on chain when the player signs.

## 2. The fourth seat

The fourth `JOIN_LOBBY` ack now takes a second or two, because the server creates the match on
chain first. It comes back:

- `{ ok: true, ticket }` with **`ticket.started: false`**. In fake mode it is `true`. Send `JOIN` as
  usual; the funding stage below has begun.
- `{ ok: false, error: 'ESCROW_FAILED' }` if the match could not be created on chain. The other
  three get `LOBBY_DISSOLVED { reason: 'ESCROW_FAILED' }`.

From now on no seat is freed, and `LOBBY_UPDATE.expiresAt` (the fill deadline) no longer applies.
The deadline that counts is `STAKE_REQUEST.expiresAt`.

## 3. Funding stage

### `STAKE_REQUEST`: new, private, server → one player

```ts
{ matchId, serverTick: null, tx: string, expiresAt: number, serverNow: number }
```

**This is when the app must prompt the wallet to sign.**

- `tx`: base64 of an **unsigned legacy transaction**. Fee payer is the player's wallet, and the one
  instruction is `join_match`, which moves the buy-in from the wallet into the match vault.
  Decode it (`Transaction.from(base64 bytes)`), then have the wallet **sign and send** it
  (MWA `signAndSendTransactions`). Do not modify it.
- `expiresAt` / `serverNow`: server epoch ms. Time left is `expiresAt - serverNow`, counted from
  arrival. Never compare it with the device clock. The window is **90 seconds**.
- **Don't report anything back to the server.** It watches the chain and sees the payment within
  about 2 seconds of confirmation.

When it is sent:

- To every seated player whose socket is connected, the moment the lobby fills.
- **In reply to `JOIN`** while the lobby is funding, if that player has not paid yet. The fourth
  player always gets theirs this way, since they `JOIN` after their ack. **Every `JOIN` gets a newly
  built transaction**.

**Expired blockhash.** A transaction's blockhash is only good for roughly 60–90 seconds. If the
wallet reports an expired or unknown blockhash, or the player cancelled and wants to try again,
send `JOIN { matchId, sessionToken }` again. You'll get a fresh `STAKE_REQUEST`. Once a player has
paid, `JOIN` sends them no `STAKE_REQUEST`, and a second signature would fail on chain (`AlreadyJoined`).

### `STAKE_UPDATE`: new, server → room

```ts
{ matchId, serverTick: null, staked: number[] }
```

`staked` lists the seat numbers that have paid, ascending. These are `LOBBY_UPDATE.players[].seated`,
1–4. It is sent:

- to the room every time a payment lands on chain,
- to a socket, together with its `STAKE_REQUEST`, whenever its `JOIN` finds the lobby funding.

Seat numbers are public, and having paid reveals no role.

### How funding ends

- **All four paid** → `MATCH_STARTED` exactly as today, to each connected player. Anyone not
  connected gets it on their next `JOIN`.
- **Deadline passed, or the chain failed** → the server voids the match on chain, refunding every
  player who paid, and only *then* sends
  `LOBBY_DISSOLVED { matchId, serverTick: null, code, reason: 'STAKE_TIMEOUT' }`.
  **Reason `STAKE_TIMEOUT` is new.** The void can take several seconds, so this may arrive a little
  after `expiresAt`. As with every dissolve, the sessions are gone afterwards: go back to the
  entry screen.

`LOBBY_DISSOLVED { reason: 'ESCROW_FAILED' }` can also now arrive after the fourth seat when the
server could not build the join transactions. As with `STAKE_TIMEOUT`, the match is voided first.

## 4. After the match

`MATCH_END` is unchanged and goes out at the same moment, with the server's settlement. The chain
pays exactly those numbers. Then:

### `SETTLEMENT_CONFIRMED`: new, server → room

```ts
{ matchId, serverTick: number, signature: string, payouts: string[] }
```

- Sent once the settle transaction has confirmed on chain, usually a few seconds after
  `MATCH_END`.
- `signature`: the settle transaction. Link it as
  `https://explorer.solana.com/tx/<signature>?cluster=devnet`.
- `payouts[i]`: what seat `i + 1` received, **refund included**. The order matches
  `MATCH_END.settlement.lines`. Each value is a decimal string of the token's **base units**:
  mock SKR has 6 decimals, so `"13000000"` is 13 SKR. They are strings because a u64 does not fit a
  JSON number. Each equals `(line.refund + line.payout) × 10_000` on devnet's config.

If it never arrives, settlement failed after 5 attempts. In that case the server voids instead,
which refunds every player's full buy-in. There is no message for this case yet.

---

## Summary

| Message / code | Direction | Status |
| :---- | :---- | :---- |
| `CREATE_LOBBY.wallet`, `JOIN_LOBBY.wallet` | client → server | now required |
| `WALLET_UNFUNDED` | lobby ack error | new |
| `WALLET_TAKEN` | lobby ack error | new |
| `ticket.started: false` on the fourth seat | lobby ack | changed |
| `STAKE_REQUEST` | server → one player | new: **sign and send `tx`** |
| `STAKE_UPDATE` | server → room / joining socket | new |
| `LOBBY_DISSOLVED.reason: 'STAKE_TIMEOUT'` | server → room | new |
| `SETTLEMENT_CONFIRMED` | server → room | new |
