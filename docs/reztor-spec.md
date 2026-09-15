# Reztor — MVP Design & Technical Specification

**Version:** 0.1 (MVP) **Status:** Ready to build **Platform:** Mobile web / mobile app, Solana settlement **Token:** SKR

---

## 1\. Premise

Four players stake SKR and attack a shared board split into four vertical lanes, one per player. Tapping pushes your own lane from red to green. Tapping costs tokens.

Three players are crew, trying to fill the board. One is a secretly assigned impostor, trying to make sure they fail.

The impostor cannot tap the board backwards directly. Instead they **siphon**: they pull converted progress out of one player's lane and deliver a smaller amount into another's. The difference is destroyed. The victim's frontier visibly retreats. The beneficiary's lane surges.

Neither of those two players is the impostor. That is the entire game.

---

## 2\. Core loop

1. Four players are matched and stake in.  
2. Roles are assigned secretly. One impostor, three crew.  
3. Three rounds run. Each round is 60s of tapping, 45s of chat, 15s of voting.  
4. Players argue about what the board showed and vote to eject someone.  
5. The match resolves after the third vote.  
6. The pot is split among the winners. Unspent tokens are refunded.

---

## 3\. Board

| Property | Value |
| :---- | :---- |
| Lanes | 4 (one per player) |
| Lane capacity | 1000 units |
| Board total | 4000 units |
| Win target | 2400 units (60% of board) |

Lane capacity is a hard cap. A lane cannot exceed 1000 units regardless of spending. This is the anti-whale mechanism: beyond a point, money buys nothing.

A reference line is drawn across the board at the 60% mark as a visual landmark. **The win check is total green across all four lanes, never per lane.** A single drained lane must never be able to lock the crew out of a win.

---

## 4\. Roles

### Crew (3 players)

Tap to fill their own lane. May purchase one trace per match. Win by reaching the target or ejecting the impostor.

### Impostor (1 player)

Taps their own lane like anyone else, and additionally has the siphon. Wins by running the clock out below target, or by surviving until two crew have been ejected.

The impostor's lane is a normal lane. It counts toward the board total. Every unit the impostor adds for cover helps the crew win.

---

## 5\. Actions

### 5.1 Tap

Two tiers. Tier selection is private and can be changed at any time.

| Tier | Cost | Units | Units per credit |
| :---- | :---- | :---- | :---- |
| 1 | 1 credit | 1 | 1.00 |
| 2 | 4 credits | 3 | 0.75 |

Tier 2 is deliberately less efficient per credit. It buys *speed*, not value — a way to move faster than a thumb allows, at a worsening rate.

**Tap rate clamp:** the server accepts a maximum of 6 taps per second per player. Excess taps in a batch are dropped silently, not rejected.

### 5.2 Siphon (impostor only)

| Property | Value |
| :---- | :---- |
| Pulled from source | 10 units |
| Delivered to sink | 6 units |
| Destroyed | 4 units |
| Cost, sink is another player | 6 credits |
| Cost, sink is self | 12 credits |
| Cooldown | None |
| Targeting | Chosen freely per siphon, mid-round |
| Floor | Source lane cannot go below 0 units |

The impostor picks a source and a sink for each individual siphon and may retarget freely at any point during the tap stage. Self-sinking costs double.

**Why self-sinking costs double.** At equal cost it dominates: it destroys board progress and builds perfect cover with one button. The 2x price makes it a real trade-off.

| Sink choice | Cost | Siphons from 1200 credits | Net board damage | Impostor lane at end |
| :---- | :---- | :---- | :---- | :---- |
| Another player | 6 | 200 | −800 units | 0 units |
| Self | 12 | 100 | −400 units | 600 units |

Framing is twice as destructive but leaves the impostor's lane at zero — the most incriminating thing on the board. Self-sinking is half as destructive but leaves the lane at roughly 600 against crew lanes near 850, which is behind but deniable.

Neither line is correct on its own. The optimal play is a mix, chosen fresh each round.

**Siphon cannot pull from an empty lane.** Round 1 has almost nothing to steal, so the impostor's natural arc is cover early, sabotage late.

### 5.3 Trace (any player)

| Property | Value |
| :---- | :---- |
| Cost | 200 credits |
| Limit | One per player per match |
| Target | One lane |
| Scope | Previous round only |
| Results | `natural`, `received`, `drained` |

The trace returns the **single largest component** of that lane's change during the previous round.

- `natural` — most of the change came from that player's own taps  
- `received` — most came in from a siphon sink delivery  
- `drained` — most was pulled out by a siphon

The trace never names who sent or who took. It does not identify the impostor.

Because the result reports only the dominant component, the trace can mislead when two effects are close in size. This is intentional. An investigative tool that is occasionally wrong produces better arguments than one that is always right.

The impostor may also purchase a trace, and should, since refusing to spend 200 credits when everyone else does is itself a signal.

---

## 6\. Information model

This is the most important section in the document. Get this wrong and the game stops working.

### Public — visible to all players, live

- Every lane's current frontier position  
- Total board percentage  
- Who is alive, who has been ejected  
- Who voted for whom, revealed simultaneously after the vote closes  
- All chat messages

### Private — visible only to the owner

- Credit balance remaining  
- Current tap tier  
- Total credits spent  
- Trace results (the purchaser may share or lie about them freely)  
- Impostor: siphon targeting, units destroyed so far

### Hidden from everyone until match end

- Who the impostor is  
- Per-player spend and contribution breakdown  
- The role assignment seed

**The core ambiguity.** A lane that is moving fast could be: a player tapping quickly, a player on tier 2, or a siphon sink receiving stolen units. A lane that is barely moving could be: a player conserving credits, a player being drained, or the impostor spending everything on sabotage. Three explanations for every observation, and no way to distinguish them from the board alone.

**The honest-player trap.** Because unspent credits are refunded, a crewmate who believes the match is lost has a rational reason to stop spending. A lane that stops moving looks exactly like a saboteur's lane. An innocent, rational player will behave indistinguishably from a traitor and will have to defend themselves while being completely honest and completely unconvincing.

---

## 7\. Round structure

A match is **3 rounds**. Each round is three stages.

| Stage | Duration | What happens |
| :---- | :---- | :---- |
| Tap | 60s | Board live. Tap, siphon, trace. |
| Chat | 45s | Board frozen. Text chat open. |
| Vote | 15s | Vote buttons. Simultaneous reveal at close. |

Round total: 120s. Match total: 6 minutes.

**The match resolves after round 3's vote, not after round 3's tapping.** Even if the crew missed the target on the board, the final vote is still live and ejecting the impostor wins it. The last vote is the most dramatic moment in the match.

---

## 8\. Voting

| Rule | Value |
| :---- | :---- |
| Majority | Strictly more than half of living players |
| 4 players alive | 3 votes required to eject |
| 3 players alive | 2 votes required to eject |
| Tie | Nobody ejected |
| All skip | Nobody ejected |
| Ejected players | Cannot vote, cannot chat |
| Reveal | All votes hidden until the timer closes, then revealed at once |

The 3-of-4 threshold makes a round 1 ejection nearly impossible. That is correct — nobody has evidence yet.

Simultaneous reveal is required. If votes appear one at a time, players wait for the first mover and follow.

### Ejection consequences

An ejected player's lane becomes **dormant**. They can no longer tap. Any living player may tap into a dormant lane at **50% efficiency** — a tier 2 tap that normally yields 3 units yields 1.5 (round down to 1).

Ejected players remain in the match as spectators. They see the board but cannot chat or vote. Their stake stays in the pot and they still receive a winning share if their side wins.

---

## 9\. Win conditions

### Crew win if

- Total green across all lanes reaches 2400 units, **or**  
- The impostor is ejected at any vote (immediate win, regardless of board state)

### Impostor wins if

- The match ends after round 3 with the board below 2400 units, **or**  
- Two crew members have been ejected (only 2 players remain; the impostor can no longer be outvoted — immediate win)

---

## 10\. Economy

### 10.1 Conversion

|  |  |
| :---- | :---- |
| SKR reference price | $0.0177 |
| Conversion | 1 SKR \= 100 credits |
| 1 credit | 0.01 SKR ≈ $0.00018 |

All in-game math runs on integer credits. Credits are converted to SKR only at escrow and settlement.

### 10.2 Action costs

| Action | Credits | SKR | USD |
| :---- | :---- | :---- | :---- |
| Tier 1 tap | 1 | 0.01 | $0.00018 |
| Tier 2 tap | 4 | 0.04 | $0.00071 |
| Siphon (frame) | 6 | 0.06 | $0.00106 |
| Siphon (self-sink) | 12 | 0.12 | $0.00212 |
| Trace | 200 | 2.00 | $0.0354 |

### 10.3 Match economics

|  |  |
| :---- | :---- |
| Buy-in | 12 SKR \= 1200 credits ≈ $0.212 |
| Escrowed per match | 48 SKR (4 × 12\) |
| Unspent credits | Refunded to the owner, win or lose |
| Pot | Total credits *spent* by all players, converted to SKR |
| Rake | 5% of pot (**set to 0% for internal testing**) |
| Split | Equal among all winners |

**Worked example — full spend, crew win:** Pot \= 48 SKR. Rake \= 2.4 SKR. Distributed \= 45.6 SKR across 3 crew \= 15.2 SKR each. Net per crewmate: \+3.2 SKR (+$0.057).

**Worked example — full spend, impostor win:** Impostor takes 45.6 SKR. Net: \+33.6 SKR (+$0.595).

**Player cost:** $1 buys about 56.5 SKR, roughly 4.7 matches at full spend, about 30 minutes of play. Unspent credits are refunded, so a conservative player stretches this considerably.

### 10.4 Price drift

The buy-in is a fixed 12 SKR. If SKR doubles, entry doubles to \~$0.42 and players will notice.

For MVP, leave it fixed and store it as a config value that a human can change without redeploying. A price oracle is the correct long-term answer and an unnecessary dependency now.

---

## 11\. Balance rationale

Everything below rests on one assumption: **sustained tapping at 4 taps per second.** That is 240 taps per round, 720 per match. **Measure this in the first playtest and rescale everything if it is wrong.**

### Crew baseline, no impostor

Three crew tapping at \~85% of theoretical produce roughly 850 units each → 2550 total against a 2400 target. Clears with about 150 units of slack. Comfortable but not lazy.

### Impostor requirement

The impostor has 1200 credits to split between siphoning and covering their own lane.

- Each credit spent siphoning (framing) destroys 0.67 net units  
- Each credit spent on cover *adds* 1 unit to the board — helping the crew

Cover therefore costs the impostor twice. Solving for the point where the impostor pushes the board below target: they must spend roughly **810 credits on siphoning, about 68% of their ammunition**, leaving \~390 credits for cover.

**That puts the impostor's lane at roughly 390 units against crew lanes near 850\.**

That single number is the whole game. To win on the board, the impostor must run their lane at under half of everyone else's — visible to a crew that is paying attention, deniable to one that isn't.

### Emergent arc

Siphoning is weak in round 1 because lanes are nearly empty and there is nothing to steal. Framing needs headroom in the victim's lane and becomes hard late as lanes fill toward cap. Round 1 is calm, round 2 is peak framing, round 3 is destruction and self-sinking. This arc is not scripted — it falls out of the numbers.

### Note on mid-round retargeting

Free retargeting (as specified) lets the impostor always drain whichever lane is fullest, avoiding the zero floor and maximising efficiency. This is slightly stronger than round-start commitment, and it muddies trace results because several lanes may be drained within one round.

Both effects are acceptable and arguably good. Flagged here because if the impostor proves too strong in playtesting, **restricting retargeting to once per round is the first lever to pull** before touching costs.

---

## 12\. Disconnect and failure handling

| Situation | Behaviour |
| :---- | :---- |
| Player disconnects | 30s grace period. Lane frozen — no taps in or out, cannot be siphoned. |
| Player rejoins within grace | Resumes normally. Credits and lane intact. |
| Player fails to rejoin | Treated as ejected. Lane becomes dormant at 50%. |
| Impostor fails to rejoin | Crew win immediately. |
| Two players disconnect past grace | **Match voided.** Full refund of escrow to all four players, minus network fees. |
| Fewer than 3 live players at any point | Match voided, full refund. |
| Server crash mid-match | Recover from last snapshot (≤10s of state loss). If recovery fails, void and refund. |
| Lobby does not fill within 60s | Lobby dissolved, no escrow taken. |

Void-and-refund is the safety net. A broken match must cost nobody anything.

---

## 13\. Architecture

**Server-authoritative with on-chain settlement.** The server holds live match state and runs the clock. The chain handles escrow at match start and payout at match end.

This is the right MVP choice: fast, cheap, shippable by one developer. The trade-off is that players trust the server not to misreport outcomes. **State this honestly in player-facing materials rather than implying more decentralisation than exists.** A rollup (e.g. MagicBlock) is the eventual answer, not the first build.

### 13.1 Data flow

Client  \--(websocket, 250ms batches)--\>  Server (in-memory match state)

Client  \<--(websocket, board broadcast)--  Server

Server  \--(snapshot every 10s \+ round boundaries)--\>  Database

Server  \--(escrow at start, settle at end)--\>  Solana program

**Client → server:** batch taps on a **250ms timer**, not a tap count. Four batches per second regardless of tap speed. A count-based trigger leaves a slow tapper's input unsent indefinitely and their lane visibly lags for no reason.

**Server → database:** the database is never in the tap path. In-memory state is authoritative during a match. Write a snapshot every 10 seconds as crash insurance, and a full write at every round boundary. Losing up to 10 seconds of state to a crash is an acceptable MVP failure.

**Server → client:** broadcast all four lane positions and board total every 250ms. Every client sees the same board at the same time.

### 13.2 Message shapes

Client → server:

TAP\_BATCH      { tier: 1|2, count: int, clientTs: int }

SET\_TIER       { tier: 1|2 }

SIPHON         { source: playerId, sink: playerId }

TRACE          { target: playerId }

CHAT           { text: string }

VOTE           { target: playerId | "skip" }

HEARTBEAT      { }

Server → client:

MATCH\_START    { players\[\], yourRole, yourCredits, config }

BOARD\_UPDATE   { lanes: \[units×4\], boardTotal, secondsLeft }

STAGE\_CHANGE   { stage: "tap"|"chat"|"vote", duration }

CREDITS        { remaining }          // private, to owner only

SIPHON\_RESULT  { pulled, delivered, destroyed, totalDestroyed }  // impostor only

TRACE\_RESULT   { target, result }     // purchaser only

CHAT\_MESSAGE   { from, text, ts }

VOTE\_RESULT    { votes: {voter: target}, ejected: playerId|null }

PLAYER\_STATE   { playerId, status: "alive"|"disconnected"|"ejected" }

MATCH\_END      { winner, impostorId, board, breakdown\[\], payouts\[\], seed }

### 13.3 Server-side validation

- Clamp tap batches to 6 taps/second per player  
- Reject actions the sender cannot afford  
- Reject siphons from non-impostors  
- Reject a second trace from a player who already used one  
- Reject siphons where source lane is at 0 units  
- Reject actions arriving outside their valid stage  
- Reject votes from ejected or disconnected players

### 13.4 Role assignment

The server assigns the impostor randomly at match start using a stored seed. **The seed is revealed to all players in `MATCH_END`**, so anyone can verify the assignment matched the seed after the fact.

This does not prevent a malicious server. It makes cheating detectable retroactively, which is the appropriate level of assurance for an MVP. VRF (ORAO or Switchboard) is the correct long-term solution.

---

## 14\. On-chain flow

Three program instructions.

**`create_match`** — creates a match account, sets the buy-in, opens the lobby.

**`join_match`** — transfers 12 SKR from the player into the match vault. Called by each of the four players. Fails if the match is full or already started.

**`settle_match`** — called once by the server authority with the signed final result. Takes per-player unspent credits, the winner list, and the rake. Refunds unspent credits to each player, deducts rake, distributes the remaining pot equally among winners, closes the match account.

**`void_match`** — refunds full escrow to all participants. Callable by the server authority, and by any participant after a timeout (protects players if the server goes down permanently).

The `void_match` timeout escape hatch is not optional. Without it, a server failure permanently locks player funds.

---

## 15\. Match end

The reveal screen shows everything. No information is withheld after the result.

- Winner and win condition  
- The impostor's identity  
- Final board total and percentage  
- Per-player: credits spent, units contributed, final lane position  
- Impostor: total units destroyed, siphon count, self-sink count  
- Trace purchases and their results  
- Full vote history by round  
- Payouts and refunds  
- The role assignment seed

The post-mortem argument is half the entertainment. Hide nothing once the match is over.

---

## 16\. Tuning dials

Change these in this order. Each entry lists the MVP value and the direction of effect.

| Dial | MVP value | Effect |
| :---- | :---- | :---- |
| **1\. Measured tap rate** | assumed 4/sec | Empirical. Everything scales off it. If real rate is 3/sec, drop target to \~1800. |
| **2\. Win target** | 2400 units | Cleanest crew-vs-impostor balance knob. Lower favours crew. |
| **3\. Siphon retarget freedom** | free, mid-round | Restricting to once per round is the first nerf if the impostor is too strong. |
| **4\. Siphon cost (frame)** | 6 credits | Lower \= impostor needs less commitment \= harder to spot. Higher \= more exposed. |
| **5\. Self-sink multiplier** | 2x (12 credits) | Too cheap and self-sinking dominates. Too expensive and it is never used. |
| **6\. Trace cost** | 200 credits | Higher \= investigation hurts more \= more tension. |
| **7\. Dormant lane efficiency** | 50% | How much a wrongful ejection hurts. |
| **8\. Round count / durations** | 3 × (60/45/15) | Match length and number of ejection opportunities. |

**Do not change the 10-for-6 siphon ratio.** It is legible, it displays cleanly, and altering it changes the feel of the whole game rather than its difficulty.

---

## 17\. Explicitly out of scope for MVP

Deferred, with the reasoning for each.

- **Strikes / player-initiated kills** — doubles the balance surface; ends 4-player matches too fast  
- **Blackout ability** — a second system that teaches nothing the siphon doesn't already teach  
- **Proportional payout** — needed before public launch (equal split invites freeloading), tolerable among testers  
- **Lobbies above 4 players** — 5-player matches likely balance better, but 4 is the minimum viable shape  
- **VRF role assignment** — seed-reveal is sufficient for testing  
- **Ephemeral rollups / on-chain real-time state** — the server version must work first  
- **Voice chat** — text gives a debuggable transcript  
- **Anti-bot tap validation** — 6/sec clamp only; this is a trust-based test build  
- **Price oracle for buy-in** — fixed config value instead  
- **Spectator mode for non-participants**  
- **Persistent stats, ranking, or progression**

---

## Appendix — quick reference

BOARD           4 lanes × 1000 units \= 4000 total

TARGET          2400 units (60%)

BUY-IN          12 SKR \= 1200 credits ≈ $0.21

TAP T1          1 credit  →  1 unit

TAP T2          4 credits →  3 units

TAP CLAMP       6 per second

SIPHON          pull 10, deliver 6, destroy 4

  → other       6 credits

  → self        12 credits

  floor         source cannot go below 0

  targeting     free, mid-round

TRACE           200 credits, 1 per player per match

                returns natural | received | drained (largest component)

ROUND           60s tap → 45s chat → 15s vote

MATCH           3 rounds \= 6 minutes

MAJORITY        strictly \>half of living players (3 of 4, 2 of 3\)

EJECTED LANE    dormant, 50% efficiency, anyone may tap

CREW WIN        board ≥ 2400, or impostor ejected

IMPOSTOR WIN    timer ends below 2400, or 2 crew ejected

RAKE            5% (0% in testing)

SPLIT           equal among winners

REFUND          unspent credits returned to owner  
