# Demo day

Three bots fill the seats around one phone, against the hosted server. Run these in order.

## Once, before the day

```bash
cd ~/Documents/projects/reztor/server
pnpm install
```

The bots stake from the contract's test wallets in `contract/scripts/keys/player-0.json` to
`player-2.json`. Each match costs each of them 12 test SKR plus a little SOL, so they need to hold
devnet SOL and test SKR. If a run fails with `WALLET_UNFUNDED`, top them up from the faucet.

## On the day

1. **Wake the server.** The hosted server sleeps when idle and takes about a minute to wake.

   ```bash
   curl -m 120 https://reztor.onrender.com/socket.io/?EIO=4\&transport=polling
   ```

   Done when it prints something starting `0{"sid"`.

2. **On the phone:** open Reztor, type a name, tap **Create a match**. The lobby shows a
   four-letter code. The lobby closes after 60 seconds, so do step 3 straight away.

3. **Seat the bots**, with the phone's code:

   ```bash
   cd ~/Documents/projects/reztor/server
   pnpm demo:bots --code ABCD
   ```

   It prints `all three seated` and each bot's stake as it lands.

4. **On the phone:** tap **Stake 12 SKR**, approve it in the wallet. The match starts when all four
   have staked.

5. **Play.** The bots tap, chat twice per Discuss stage, and vote four seconds into each vote.
   When the match ends they print the result and the payout transaction, then stop on their own.
   **Ctrl-C** stops them at any time.

## If you need a particular ending

- **The Faithful win (vote the Hollow out):** after the role reveal, find out who the Hollow is,
  then in a second terminal write the plan and the bots read it at each vote:

  ```bash
  printf '2=Ash\n3=Ash\n' > /tmp/plan.txt   # round=name, or round=skip
  ```

  and start the bots with `--vote-plan /tmp/plan.txt` in step 3.
- **Everyone skips (the Hollow can win on time):** `pnpm demo:bots --code ABCD --vote-for skip`.
- **Vote you out in round 1:** `--vote-for "Your Name" --vote-from-round 1`.

For bots against a local server, start it from `server/` in a second terminal with
`PORT=3001 pnpm serve`, then pass `--url http://localhost:3001` to `pnpm demo:bots`.

Other options: `--names A,B,C`, `--rate 5` (taps per second), `--chat 3`, and `--vote-delay 6000`.
All of them are listed at the top of `scripts/demo-bots.ts`.
