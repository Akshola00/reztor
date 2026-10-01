# Reztor — On-Chain Program Spec (MVP)

This is the source of truth for the Solana program. The game spec (`docs/reztor-mvp-spec.md`) describes the game; this document describes the contract. Where they differ, **this document wins** (divergences are listed at the bottom with reasons).

## 0. Scope

The program does exactly four things: hold the buy-ins in escrow, pay out the settlement the server reports, refund everyone if a match is voided, and let a human change economic config without redeploying. **No game logic lives on-chain.** The program does not know about roles, lanes, taps, votes, or rounds. The server is trusted to report results honestly (as stated in the game spec §13).

Minimum security bar for MVP: every account is validated, every signer is checked, all math is checked, funds can never be permanently locked, and funds can never go to anyone except a seated player or the treasury.

## 1. Program layout

- Framework: Anchor. Program name: `reztor`.
- Token handling: `anchor_spl::token_interface` (works for both SPL Token and Token-2022). All transfers use `transfer_checked`.
- Never hardcode token decimals. Read them from the mint.

### PDAs

| Account | Seeds |
| :---- | :---- |
| Config | `["config"]` |
| Match | `["match", match_id.to_le_bytes()]` |
| Vault (token account) | `["vault", match_pda.key()]`, token authority = Match PDA |

## 2. Accounts

### Config (singleton)

| Field | Type | Notes |
| :---- | :---- | :---- |
| admin | Pubkey | Can call `update_config` |
| authority | Pubkey | Server signer. Creates, settles, voids matches |
| mint | Pubkey | SKR mint (mock mint on localnet/devnet) |
| treasury | Pubkey | Wallet that owns the rake token account |
| buy_in_amount | u64 | Base units. Must be divisible by `credits_per_buy_in` |
| credits_per_buy_in | u32 | 1200 |
| rake_bps | u16 | 0 for testing. Hard max 1000 (10%) |
| void_timeout_secs | i64 | Seconds after `created_at` when a seated player may void. Must be > 0 |
| paused | bool | Blocks `create_match` and `join_match` only. Never blocks settle or void |
| bump | u8 | |

### Match

| Field | Type | Notes |
| :---- | :---- | :---- |
| match_id | u64 | Chosen by server, unique |
| bump, vault_bump | u8 | |
| mint | Pubkey | Snapshot from config |
| buy_in_amount | u64 | Snapshot |
| credits_per_buy_in | u32 | Snapshot |
| rake_bps | u16 | Snapshot |
| void_timeout_secs | i64 | Snapshot |
| players | [Pubkey; 4] | Seat order = lane order the server uses |
| joined_mask | u8 | Bit i set when seat i has paid |
| status | enum `Open` / `Active` | Account is closed on settle/void, so no terminal states needed |
| created_at | i64 | Unix timestamp |
| started_at | i64 | 0 until 4th join |

Snapshotting config into the match means changing config never affects a live match.

## 3. Instructions

### `initialize_config(authority, mint, treasury, buy_in_amount, credits_per_buy_in, rake_bps, void_timeout_secs)`
- Signer becomes `admin`.
- Signer **must be the program's upgrade authority** (validate via the program and program_data accounts). This prevents someone front-running initialization after deploy.
- Validate all config invariants (below).

### `update_config(...)` — admin only
- Any field optional except admin transfer is its own explicit param.
- Re-validate all invariants.

**Config invariants:** `credits_per_buy_in > 0`, `buy_in_amount > 0`, `buy_in_amount % credits_per_buy_in == 0`, `rake_bps <= 1000`, `void_timeout_secs > 0`.

### `create_match(match_id: u64, players: [Pubkey; 4])` — authority only
- Requires `!config.paused`.
- All 4 players non-default and distinct.
- Inits Match PDA and Vault token account. Authority pays rent.
- Status `Open`, `created_at = now`.

### `join_match(match_id)` — signed by a player
- Requires `!config.paused` and status `Open`.
- Signer must be one of `players`; that seat must not already be joined.
- Player's token account: mint == match.mint, owner == signer.
- `transfer_checked` of `buy_in_amount` from player to vault.
- Set seat bit. If all 4 joined: status `Active`, `started_at = now`.

### `settle_match(match_id, unspent_credits: [u32; 4], winners_mask: u8)` — authority only
- Requires status `Active`.
- `winners_mask <= 0b1111` and popcount ∈ {1, 3} (impostor win or crew win).
- Each `unspent_credits[i] <= credits_per_buy_in`.
- `remaining_accounts`: exactly 4 token accounts in seat order (see §4).
- Also takes the treasury token account (owner == config.treasury, mint == match.mint).

Math (all checked, use u128 intermediates for multiplication):
```
rate          = buy_in_amount / credits_per_buy_in
refund[i]     = unspent_credits[i] * rate
escrowed      = buy_in_amount * 4
pot           = escrowed - sum(refund)
rake          = pot * rake_bps / 10_000
distributable = pot - rake
n             = popcount(winners_mask)
share         = distributable / n
dust          = distributable - share * n
excess        = vault.amount - escrowed          // tokens someone sent to the vault directly
payout[i]     = refund[i] + (seat i is winner ? share : 0)
treasury_amt  = rake + dust + excess
```
- Require `vault.amount >= escrowed`.
- Assert `sum(payout) + treasury_amt == vault.amount` before transferring.
- Transfer each non-zero amount. Then close the vault (rent → authority) and close the Match account (rent → authority).
- Emit `MatchSettled { match_id, payouts: [u64; 4], treasury_amount, winners_mask }`.

### `void_match(match_id)` — authority, or a seated+joined player after timeout
- Allowed from status `Open` or `Active`.
- If signer == config.authority: allowed any time.
- Else signer must be a seated player whose seat is joined, and `now >= created_at + void_timeout_secs`.
- `remaining_accounts`: one token account per **joined** seat, in seat order (see §4).
- Refund `buy_in_amount` to each joined seat. Any vault excess → treasury token account.
- Close vault and Match account. Rent → **config.authority** regardless of who called (the authority paid it). Pass the authority account as a writable non-signer when a player voids, constrained to `config.authority`.
- Emit `MatchVoided { match_id, refunded_seats_mask, by_authority: bool }`.

## 4. remaining_accounts validation (shared helper)

For each expected seat, in order:
- Account is writable.
- Account owner program == the token program passed to the instruction.
- Deserializes as a token account.
- `token_account.mint == match.mint`.
- `token_account.owner == match.players[seat]`.
- Count of accounts equals the expected count exactly.

Because `create_match` guarantees distinct players and each account must be owned by its seat's player, the same account cannot be passed twice.

## 5. Events

`ConfigUpdated`, `MatchCreated { match_id, players }`, `PlayerJoined { match_id, seat, player }`, `MatchStarted { match_id }`, `MatchSettled`, `MatchVoided`. The server may listen to these instead of polling.

## 6. Errors

One `ReztorError` enum with specific variants (e.g. `Paused`, `InvalidConfig`, `DuplicatePlayer`, `NotSeated`, `AlreadyJoined`, `MatchNotOpen`, `MatchNotActive`, `InvalidWinners`, `UnspentExceedsBuyIn`, `InvalidTokenAccount`, `WrongRemainingAccountsCount`, `VoidTimeoutNotReached`, `Unauthorized`, `MathOverflow`, `VaultUnderfunded`, `PayoutMismatch`). Never use generic errors or `unwrap()` in program code.

## 7. Out of scope for the program (MVP)

Proportional payouts, VRF, on-chain result signatures beyond the authority signer, player-leave-before-start, >4 players, price oracle, multisig admin, upgrade freeze.

## 8. Divergences from the game spec (intentional)

1. **Seats are allowlisted at creation.** Game spec says players are matched then stake. So the server passes the 4 matched wallets to `create_match`, and only they can join. Without this, any wallet could snipe a seat.
2. **Unfilled lobby = void, not "no escrow taken".** `join_match` escrows immediately, so a lobby that doesn't fill in 60s is dissolved by the server calling `void_match`, which refunds whoever paid. Players lose only the tx fee.
3. **"Signed final result" = the authority signs the settle transaction.** No separate off-chain signature scheme.
4. **Rounding dust and stray vault tokens go to the treasury.** Keeps the vault closable so funds can never get stuck.
5. **Winner count is checked to be 1 or 3.** A cheap sanity check against a server bug. Remove if lobby size ever changes.