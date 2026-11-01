# Play a match with bots

This demo runs three bot clients alongside one human using the Reztor phone app. The phone creates
the lobby; the bots join it by code, then play through the match over the same Socket.IO connection
used by regular clients. You can point them at the hosted devnet server or a local server.

## Get the code ready

You need Git, Node.js 20 or newer, and pnpm 10.12.1. Clone the repository and install the server
package's dependencies (the repository packages install independently):

```bash
git clone https://github.com/Akshola00/reztor.git
cd reztor/server
pnpm install
```

Keep this terminal in `server/` for the bot commands below. The default bot wallets are the devnet
test keypairs in `contract/scripts/keys/player-0.json` through `player-2.json`. They are for this
demo only; do not substitute a wallet that holds real assets. If those files are absent, the bots
run without wallets, which is supported only by a local fake-escrow server.

## Choose where to run the match

### Hosted server: devnet transactions

This uses `https://reztor.onrender.com` by default. The three bots stake from their devnet test
wallets, and the human stakes from the phone wallet. Each player needs 12 test SKR and a little
devnet SOL for transaction fees. These are devnet assets, not mainnet SKR. If a bot reports
`WALLET_UNFUNDED`, fund that test wallet with devnet SOL and test SKR before retrying.

Wake the hosted server first; it may take about a minute if it has been idle:

```bash
curl -m 120 'https://reztor.onrender.com/socket.io/?EIO=4&transport=polling'
```

The response should start with `0{"sid"`. Continue with **Start the match** below.

### Local server: fake escrow, no chain transactions

In a second terminal, start the server from `server/`:

```bash
PORT=3001 pnpm serve
```

With no environment configuration, the server uses in-memory fake escrow. It does not submit
transactions or pay real tokens, and the bots do not need wallet key files. The phone app must also
be connected to this local server; use the machine's LAN address instead of `localhost` when the
phone is a separate device. Then start the bots with:

```bash
pnpm demo:bots --url http://localhost:3001 --code ABCD
```

Use the lobby code from the phone in place of `ABCD`. If you want a local server to make real
devnet transactions instead, it needs the chain configuration documented in `src/main.ts` and
funded devnet wallets; do not enable chain mode just to try the bot flow.

## Start the match

1. On the phone, open Reztor, enter a player name, and tap **Create a match**. The lobby displays a
   four-letter code. It expires after 60 seconds, so join the bots promptly.
2. In the `server/` terminal, start the three bots with that code. For the hosted server:

   ```bash
   pnpm demo:bots --code ABCD
   ```

   For a local server, include `--url http://localhost:3001` as shown above. The bot names and
   strategies appear in the terminal; `all three seated` means they joined, not that the match has
   started yet.
3. On the phone, stake 12 SKR and approve the transaction when prompted on the hosted devnet server.
   In local fake-escrow mode, no on-chain stake is made. The match starts after the four seats are
   filled and escrow is complete.
4. Leave the bot process running until the match ends. It prints the result, each bot's activity,
   and (in chain mode) a link to the confirmed payout transaction. Press **Ctrl-C** to stop the bots
   early.

## What the bots do

The defaults are named Ash, Wren, and Sable. They use three different play styles so their tap
patterns are not identical: one taps aggressively, one changes tap tier, and one builds an early
lead then conserves credits. The server assigns roles; whichever bot is the Hollow uses its siphon
action instead of its regular strategy. Each bot sends two chat lines per Discuss stage and votes
four seconds into each vote stage. Without vote options, their votes are chosen randomly.

## Direct the votes

All three bots can vote for the same player or skip. For example, to make them skip every round:

```bash
pnpm demo:bots --code ABCD --vote-for skip
```

To target the human from round 1 onward:

```bash
pnpm demo:bots --code ABCD --vote-for "Your Name" --vote-from-round 1
```

To change votes during a match, create a plan file before starting the bots:

```text
2=Ash
3=skip
```

Start with `--vote-plan /tmp/plan.txt`. The bots check the file when they vote, so you can edit it
after the role reveal; each line is `round=name` or `round=skip`. A plan entry takes precedence over
`--vote-for`. For example, voting for the Hollow in rounds 2 and 3 could help the Faithful win;
whether it works depends on which bot the server assigned as the Hollow.

## Options and troubleshooting

All options are optional except `--code`:

| Option | Default | Purpose |
|---|---|---|
| `--url URL` | hosted server, or `REZTOR_URL` | Server address |
| `--names A,B,C` | `Ash,Wren,Sable` | Bot display names |
| `--rate N` | `4` | Target taps per second per bot |
| `--chat N` | `2` | Chat lines per bot per Discuss stage |
| `--vote-delay MS` | `4000` | Delay before voting |
| `--vote-for NAME` | random votes | Make every bot vote for a name or `skip` |
| `--vote-from-round N` | `1` | Start using `--vote-for` in this round |
| `--vote-plan FILE` | none | Read per-round votes from a file at vote time |
| `--keys a.json,b.json,c.json` | contract test wallets | Wallet key files, one per bot; `BOT_KEYS` also works |
| `--rpc URL` | devnet RPC, or `RPC_URL` | RPC used for bot staking |

- `UNKNOWN_CODE` or a lobby dissolution: create a fresh lobby and start the bots within 60 seconds.
- `WALLET_UNFUNDED`: in hosted/chain mode, one of the bot wallets lacks devnet SOL or test SKR.
- `no key files`: expected for local fake escrow; hosted chain mode requires funded wallets.
- The phone cannot find a local lobby: make sure the phone and bots are connected to the same local
  server. A physical phone cannot use the computer's `localhost` address.
- `no settlement confirmation within 120s`: the game ended, but the bot did not observe a confirmed
  devnet payout in time; check the server logs and transaction status before retrying.

For the complete argument list and implementation details, see `scripts/demo-bots.ts`.
