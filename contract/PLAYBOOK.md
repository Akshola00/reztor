# Reztor Contract — Claude Code Playbook

## How to run this

1. Create the repo and drop in: `CLAUDE.md` (root), `docs/contract-spec.md`, and your game spec as `docs/reztor-mvp-spec.md`.
2. Paste **one phase prompt at a time** into Claude Code.
3. When Claude Code stops and writes its phase report, paste the report (and any errors) back to me in chat. I'll review it and either give you a correction prompt or clear you for the next phase.
4. Don't skip the gates. Phases 3 and 4 move money; a bug caught at the gate costs minutes, a bug caught in integration costs a day.

| Phase | What | Roughly |
| :---- | :---- | :---- |
| 0 | Toolchain check, SKR mint recon, scaffold | Short |
| 1 | State, errors, config instructions | Short |
| 2 | `create_match`, `join_match` | Medium |
| 3 | `settle_match` | Medium, most important |
| 4 | `void_match` | Medium |
| 5 | Self-audit pass | Short |
| 6 | TS client, scripts, integration doc | Medium |
| 7 | Devnet deploy + full smoke test | Short |

---

## Phase 0 — Recon and scaffold

```
Read CLAUDE.md, docs/contract-spec.md, and docs/reztor-mvp-spec.md fully before doing anything.

Phase 0 tasks:
1. Report the installed versions of: rustc, cargo, solana CLI (agave), anchor CLI, avm, node, yarn/npm. If anchor is missing, install the latest stable via avm. Make sure the anchor-lang and anchor-spl crate versions match the CLI version.
2. SKR mint recon. The real SKR token is on mainnet. Using a mainnet RPC (read-only, `solana` CLI or a small node script), find and report: the SKR mint address, its decimals, and which token program owns it (SPL Token or Token-2022). If Token-2022, list its extensions. If it has a transfer-fee or transfer-hook extension, STOP and tell me, because it breaks the escrow math. If you can't determine the mint address confidently, say so and ask me for it rather than guessing.
3. Scaffold an Anchor workspace named `reztor` with a single program `reztor`. Add anchor-spl with the token_interface feature needs. Set up Anchor.toml for localnet and devnet clusters.
4. Create empty module structure only: `state.rs`, `errors.rs`, `events.rs`, `instructions/` (one file per instruction from the spec, empty stubs), `utils.rs` for the shared remaining_accounts validator. No logic yet.
5. Make sure `anchor build` passes and the default test runs.
6. Initialise git and commit.

Then STOP and write the phase report. Include the versions table and the SKR mint findings. Do not start phase 1.
```

**Gate:** Paste me the versions and SKR findings. The token program answer decides the mock mint setup for every later test.

---

## Phase 1 — State, errors, config

```
Phase 1. Implement exactly per docs/contract-spec.md sections 1, 2, 5, 6 and the two config instructions in section 3.

1. `state.rs`: Config and Match accounts with the exact fields listed. Use InitSpace for sizing. MatchStatus enum Open/Active.
2. `errors.rs`: the ReztorError enum from section 6.
3. `events.rs`: all events from section 5 (define them all now, emit only ConfigUpdated this phase).
4. `initialize_config`: the signer must be the program's upgrade authority, validated via the program account and its program_data account. Validate all config invariants.
5. `update_config`: admin only. Optional fields for authority, mint, treasury, buy_in_amount, credits_per_buy_in, rake_bps, void_timeout_secs, paused, plus an explicit optional new_admin. Re-validate all invariants after applying. Emit ConfigUpdated.

Tests (tests/config.ts):
- initialize_config succeeds with valid params from the upgrade authority
- initialize_config fails from a non-upgrade-authority signer
- initialize_config can't be called twice
- each invariant rejects bad values: buy_in not divisible by credits, rake_bps > 1000, zero credits, zero buy_in, void_timeout <= 0
- update_config works for admin, fails for anyone else
- admin transfer works and old admin loses access

Test setup: create a mock mint matching the Phase 0 SKR findings (decimals + token program). Put mint/wallet/funding setup in a reusable `tests/helpers.ts` since every later phase needs it. Use buy_in = 12 tokens in base units, credits_per_buy_in = 1200.

`anchor build` and `anchor test` must pass. Commit. STOP and write the phase report.
```

**Gate:** Paste me the report. I'll check the upgrade-authority validation specifically, since that's the one easy-to-get-wrong piece here.

---

## Phase 2 — create_match and join_match

```
Phase 2. Implement `create_match` and `join_match` exactly per docs/contract-spec.md section 3.

create_match:
- authority-only (constraint against config.authority), rejects when paused
- validates 4 non-default, distinct players
- inits Match PDA and the vault token account PDA (authority = match PDA), authority pays rent
- snapshots mint, buy_in_amount, credits_per_buy_in, rake_bps, void_timeout_secs from config
- emits MatchCreated

join_match:
- rejects when paused or status != Open
- signer must be in players, seat not already joined
- player token account constrained to mint == match.mint and owner == signer
- transfer_checked buy_in_amount from player to vault
- sets seat bit, emits PlayerJoined; on 4th join sets Active + started_at and emits MatchStarted
- mint account and token program constrained to match config/match.mint

Tests (tests/lifecycle.ts), extend helpers.ts with: create 4 funded players, create match, join all:
- create succeeds, vault exists with 0 balance, fields snapshotted correctly
- create fails: non-authority signer, paused, duplicate player, default pubkey
- join: vault balance increases by exactly buy_in per join, player balance decreases by the same
- 4th join flips status to Active
- join fails: non-seated wallet, same player joining twice, joining an Active match, paused, wrong mint token account, token account owned by someone else
- changing config after create doesn't change the match's snapshotted values

`anchor build` and `anchor test` must pass (all phases' tests). Commit. STOP and write the phase report.
```

**Gate:** Paste me the report.

---

## Phase 3 — settle_match

```
Phase 3. Implement `settle_match` exactly per docs/contract-spec.md sections 3 and 4. This moves real money; follow the math block literally.

1. Implement the shared remaining_accounts validator in utils.rs per section 4. It takes the match, the token program key, the expected seats (a list of seat indices), and the remaining accounts, and returns validated accounts in order. Void will reuse it.
2. settle_match:
   - authority-only, status must be Active
   - validate winners_mask <= 0b1111 and popcount in {1, 3}
   - validate each unspent_credits[i] <= credits_per_buy_in
   - validate treasury token account: owner == config.treasury, mint == match.mint
   - compute every value in the math block with checked arithmetic and u128 for multiplications
   - require vault.amount >= escrowed; assert sum(payouts) + treasury_amt == vault.amount before any transfer
   - transfer_checked each non-zero payout signed by the match PDA, then treasury_amt if non-zero
   - close the vault via token_interface close_account (rent to authority), close Match with `close = authority`
   - emit MatchSettled
3. Put the pure payout math in a separate function that takes plain numbers and returns payouts + treasury amount, with Rust unit tests (`cargo test`) covering the cases below. The instruction calls this function.

Rust unit tests for the math function:
- crew win full spend, rake 0: 3 winners each get 16 tokens, loser 0, treasury 0
- crew win full spend, rake 500 bps: matches the game spec worked example (45.6 distributed, 15.2 each, 2.4 rake) in base units
- impostor win full spend, rake 500: impostor gets 45.6, treasury 2.4
- nobody spent anything: everyone refunded 12, pot 0, treasury 0
- mixed partial spend with dust: sum of everything equals escrowed exactly, dust goes to treasury
- excess vault tokens go to treasury

TS integration tests (tests/settle.ts):
- full lifecycle crew win: exact balance deltas for all 4 players and treasury, vault and match accounts closed, authority got rent back
- impostor win with partial spends
- fails: non-authority, match still Open, winners_mask 0, mask with 2 winners, mask > 0b1111, unspent > 1200, wrong number of remaining accounts, remaining accounts out of seat order, a token account belonging to the wrong player, wrong treasury token account
- someone transfers extra tokens directly into the vault before settle: settle still succeeds and the extra goes to treasury
- settling twice fails (account closed)

`anchor build`, `cargo test`, and `anchor test` must all pass. Commit. STOP and write the phase report. In the report, paste the exact test output for the TS balance-delta tests.
```

**Gate:** This is the big one. Paste me the full report and the math function. I'll check the arithmetic against the game spec examples before you move on.

---

## Phase 4 — void_match

```
Phase 4. Implement `void_match` exactly per docs/contract-spec.md section 3.

- allowed from Open or Active
- two paths: signer == config.authority (any time), or signer is a seated player whose seat is joined and now >= created_at + void_timeout_secs
- authority account passed as writable, constrained to config.authority, and receives all rent regardless of caller. It is only required to sign on the authority path
- remaining_accounts: one token account per joined seat, in seat order, validated with the phase 3 helper
- treasury token account validated as in settle; any vault excess above (joined_count * buy_in) goes to treasury
- refund buy_in_amount to each joined seat, close vault and Match, emit MatchVoided

Tests (tests/void.ts):
- authority voids an Open match with 2 of 4 joined: those 2 get exactly buy_in back, the others untouched, accounts closed, rent to authority
- authority voids an Open match with 0 joined (lobby never filled): succeeds, accounts closed
- authority voids an Active match: all 4 refunded in full
- player voids after timeout (use void_timeout_secs = 2 in config for this test, sleep ~3s): succeeds, rent still goes to authority, not the player
- player voids before timeout: fails with VoidTimeoutNotReached
- non-seated wallet voids after timeout: fails
- seated-but-not-joined player voids after timeout: fails
- wrong remaining accounts count, wrong order, wrong owner: fail
- vault with excess tokens: excess to treasury
- void after settle fails, settle after void fails

All builds and tests must pass. Commit. STOP and write the phase report.
```

**Gate:** Paste me the report.

---

## Phase 5 — Self-audit

```
Phase 5. Do not add features. Audit the program against this checklist and fix only real problems. For each item write PASS or FIXED (with what you changed) or FLAG (with why you didn't change it).

1. Every instruction's signer requirements match docs/contract-spec.md
2. Every account has owner/seed/has_one/address constraints; no unchecked AccountInfo without a `/// CHECK:` comment explaining why it's safe
3. Every token account is constrained on mint AND owner
4. The mint and token program passed in are constrained to the match/config values
5. PDA bumps are stored and reused, not recalculated with find_program_address in instructions
6. All arithmetic is checked; no `as` casts that can truncate
7. No unwrap/expect/panic paths in program code
8. Status transitions can't be skipped (no settle on Open, no join on Active)
9. Paused blocks only create and join
10. There is no path where tokens can leave the vault except to a seated player's token account or the treasury token account
11. There is no state where the vault holds funds and neither settle nor void can succeed (think: closed token accounts, paused config, changed config.authority, changed config.mint after create, changed treasury)
12. Account sizes are correct and rent is always returned to the authority

For item 11, specifically reason about: what happens if config.authority is rotated while matches are live? What happens if a player closes their token account before settle? Report the answer; fix only if the fix is small and within spec, otherwise FLAG it.

Run all tests again. Commit. STOP and write the checklist as the phase report.
```

**Gate:** Paste me the checklist. Item 11 will likely surface one or two FLAGs; I'll tell you which to accept for closed testing and which to fix.

---

## Phase 6 — Integration kit

```
Phase 6. Build what the Node server and Expo app need to talk to the program. No program changes in this phase.

1. Copy the generated IDL and types into `clients/ts/` as a small standalone TypeScript package (package.json, tsconfig, src/). Dependencies: @coral-xyz/anchor, @solana/web3.js, @solana/spl-token, matching the versions used by the tests.
2. `clients/ts/src/` exports:
   - PDA helpers: getConfigPda, getMatchPda(matchId), getVaultPda(matchPda)
   - conversion helpers: creditsToBaseUnits(credits, config), baseUnitsToUiAmount
   - `fetchConfig`, `fetchMatch` (returns null if closed)
   - server-side (take an authority Keypair): `createMatch(matchId, players[4])`, `settleMatch(matchId, unspentCredits[4], winnersMask)`, `voidMatch(matchId)`. Each builds remaining_accounts correctly (derives player ATAs in seat order, joined seats only for void) and returns the signature.
   - `buildJoinMatchTx(connection, playerPubkey, matchId)`: returns an UNSIGNED legacy Transaction with feePayer = player and a recent blockhash, serialized to base64. The server exposes this via an endpoint; the Expo app deserializes it and signs/sends with Mobile Wallet Adapter. This keeps Anchor out of the React Native bundle.
   - `winnersMaskFromSeats(seats: number[])` helper
   - an `onProgramEvent(connection, handler)` helper that decodes program events from logs
3. Refactor tests to import from clients/ts where sensible so the client code is tested.
4. `scripts/` (ts-node or tsx):
   - `create-mock-mint.ts` — devnet mock SKR with the phase 0 decimals/token program, mints to a list of test wallets
   - `init-config.ts` — reads params from env, calls initialize_config
   - `update-config.ts` — CLI flags for each config field (this is how buy-in and rake get changed without redeploying)
   - `smoke.ts` — full flow against a cluster: create match with 4 local test keypairs, all join, settle crew win; then create a second match, 2 join, void. Prints balance deltas.
5. `docs/INTEGRATION.md`: for the server dev and the app dev. Cover: env vars, the seat-order = lane-order rule, the exact call sequence for a normal match / unfilled lobby / crashed match, how the join tx flows through the server to MWA, how to derive winnersMask and unspentCredits from match state, what events to listen for, and the error codes the server should handle.

Build the client package with tsc and run all tests. Commit. STOP and write the phase report.
```

**Gate:** Paste me the report and INTEGRATION.md. I'll check it lines up with your server's `MATCH_END` flow.

---

## Phase 7 — Devnet

```
Phase 7. Deploy to devnet and prove the full flow.

1. Confirm the deployer keypair has enough devnet SOL (airdrop or tell me the address to fund).
2. `anchor build` then `anchor deploy --provider.cluster devnet`. Report the program ID and make sure declare_id!, Anchor.toml, and the client package all use it.
3. Run create-mock-mint.ts, then init-config.ts with rake_bps=0, buy_in=12 tokens, credits_per_buy_in=1200, void_timeout_secs=1800, and a treasury wallet.
4. Run smoke.ts against devnet. Paste the output.
5. Write `docs/DEVNET.md` with program ID, mock mint, config PDA, authority pubkey, treasury pubkey, and explorer links.

Do not put any private keys in the repo. Commit. STOP and write the final report.
```

---

## Utility prompts (use when needed)

**Build/version hell:**
```
Stop changing code. Report: the exact error output, anchor CLI version, anchor-lang and anchor-spl crate versions, solana CLI version, rustc version, and what you've already tried. Don't attempt another fix until I reply.
```

**Scope creep:**
```
You've added things not in docs/contract-spec.md: <list>. Remove them. The spec is intentionally minimal for MVP. If you think something is genuinely needed, put it in "Open questions" in the report instead of implementing it.
```

**Failing test it wants to "fix" by editing the test:**
```
Don't change that test's expected values. Explain whether the test or the program is wrong, citing the relevant line of docs/contract-spec.md, then stop.
```