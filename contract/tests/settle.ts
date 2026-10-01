import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ACCOUNT_SIZE, TOKEN_PROGRAM_ID, mintTo } from "@solana/spl-token";
import { expect } from "chai";
import { Reztor } from "../target/types/reztor";
import {
  BUY_IN,
  CREDITS_PER_BUY_IN,
  Player,
  createFundedAta,
  createMatch,
  createMockMint,
  createPlayers,
  createTreasury,
  ensureConfig,
  eventsOf,
  expectAnchorError,
  getProgram,
  joinAll,
  loadSettlementVectors,
  maskOf,
  matchPda,
  newFundedWallet,
  programAs,
  settleMatch,
  tokenBalance,
  updateConfig,
  vaultPda,
} from "./helpers";

const RATE = BigInt(BUY_IN / CREDITS_PER_BUY_IN); // 10_000 base units per credit
const CREW = maskOf([0, 2, 3]);
const IMPOSTOR = maskOf([1]);

describe("settle_match", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = getProgram();
  const connection = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  let authority: Keypair;
  let asAuthority: Program<Reztor>; // authority pays its own fees, as the server will
  let mint: PublicKey;
  let players: Player[];
  let treasury: { owner: PublicKey; ata: PublicKey };
  let nextId = 1_000;
  const keys = () => players.map((p) => p.kp.publicKey);
  const seatAtas = () => players.map((p) => p.ata);

  before(async () => {
    authority = await newFundedWallet(connection);
    asAuthority = programAs(program, authority);
    mint = await createMockMint(connection, admin);
    players = await createPlayers(connection, admin, mint, BUY_IN * 50);
    treasury = await createTreasury(connection, admin, mint);
    await ensureConfig(program, admin, {
      authority: authority.publicKey,
      mint,
      treasury: treasury.owner,
    });
  });

  /** Creates a match, joins all 4 and returns its id. Uses the config's current rake. */
  async function activeMatch(): Promise<number> {
    const id = nextId++;
    await createMatch(program, authority, id, keys(), mint);
    await joinAll(program, id, players, mint);
    return id;
  }

  async function balances(): Promise<bigint[]> {
    return Promise.all(
      [...seatAtas(), treasury.ata].map((a) => tokenBalance(connection, a))
    );
  }

  /**
   * Runs a full create → join → settle and returns exact token deltas
   * (4 seats then treasury) measured from before the joins.
   */
  async function runMatch(unspent: number[], mask: number, rakeBps = 0) {
    await updateConfig(program, admin, { rakeBps });
    try {
      const before = await balances();
      const id = await activeMatch();
      const sig = await settleMatch(
        asAuthority,
        authority,
        id,
        unspent,
        mask,
        mint,
        seatAtas(),
        treasury.ata
      );
      const after = await balances();
      return { id, sig, deltas: after.map((b, i) => b - before[i]) };
    } finally {
      await updateConfig(program, admin, { rakeBps: 0 });
    }
  }

  /** Expected deltas from credit amounts: seats are refund+payout minus the buy-in they paid. */
  function expectedDeltas(
    seatCredits: number[],
    treasuryCredits: number
  ): bigint[] {
    return [
      ...seatCredits.map((c) => BigInt(c) * RATE - BigInt(BUY_IN)),
      BigInt(treasuryCredits) * RATE,
    ];
  }

  describe("balance deltas", () => {
    it("crew win, full spend, rake 0: exact deltas, accounts closed, rent to authority", async () => {
      await updateConfig(program, admin, { rakeBps: 0 });
      const before = await balances();
      const id = await activeMatch();
      const matchAccount = matchPda(program.programId, id);
      const vault = vaultPda(program.programId, matchAccount);

      const matchInfo = await connection.getAccountInfo(
        matchAccount,
        "confirmed"
      );
      const vaultInfo = await connection.getAccountInfo(vault, "confirmed");
      const expectedRent =
        (await connection.getMinimumBalanceForRentExemption(
          matchInfo!.data.length
        )) + (await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE));
      expect(matchInfo!.lamports + vaultInfo!.lamports).to.equal(expectedRent);

      const authBefore = await connection.getBalance(
        authority.publicKey,
        "confirmed"
      );
      const sig = await settleMatch(
        asAuthority,
        authority,
        id,
        [0, 0, 0, 0],
        CREW,
        mint,
        seatAtas(),
        treasury.ata
      );
      const authAfter = await connection.getBalance(
        authority.publicKey,
        "confirmed"
      );
      const tx = await connection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      const fee = tx!.meta!.fee;

      const after = await balances();
      const deltas = after.map((b, i) => b - before[i]);
      console.log(
        "      crew win rake 0 deltas:",
        deltas.map(String).join(", ")
      );
      expect(deltas).to.deep.equal([
        4_000_000n,
        -12_000_000n,
        4_000_000n,
        4_000_000n,
        0n,
      ]);

      expect(
        await connection.getAccountInfo(matchAccount, "confirmed")
      ).to.equal(null);
      expect(await connection.getAccountInfo(vault, "confirmed")).to.equal(
        null
      );
      console.log(
        `      authority lamports: +${
          authAfter - authBefore
        } (rent ${expectedRent}, fee ${fee})`
      );
      expect(authAfter - authBefore).to.equal(expectedRent - fee);

      const events = await eventsOf(program, sig);
      expect(events.map((e) => e.name)).to.deep.equal(["matchSettled"]);
      expect(events[0].data.matchId.toNumber()).to.equal(id);
      expect(events[0].data.payouts.map(String)).to.deep.equal([
        "16000000",
        "0",
        "16000000",
        "16000000",
      ]);
      expect(events[0].data.treasuryAmount.toString()).to.equal("0");
      expect(events[0].data.winnersMask).to.equal(CREW);
    });

    it("impostor win, partial spends, rake 500", async () => {
      // spent [400, 1000, 0, 1200] = pot 2600; rake 130; dist 2470 -> impostor (seat 1).
      const unspent = [800, 200, 1200, 0];
      const { deltas } = await runMatch(unspent, IMPOSTOR, 500);
      console.log(
        "      impostor partial rake 500 deltas:",
        deltas.map(String).join(", ")
      );
      expect(deltas).to.deep.equal(
        expectedDeltas([800, 200 + 2470, 1200, 0], 130)
      );
    });

    for (const name of [
      "golden: crew-board-win",
      "golden: impostor-timeout-win",
    ]) {
      it(`server vector end to end: ${name}`, async () => {
        const v = loadSettlementVectors().find((x) => x.name === name)!;
        expect(v, name).to.not.equal(undefined);
        expect(v.buyIn * 1_000_000).to.equal(BUY_IN);
        expect(v.creditsPerBuyIn).to.equal(CREDITS_PER_BUY_IN);
        const { deltas } = await runMatch(
          v.unspentCredits,
          maskOf(v.winners),
          v.rakeBps
        );
        console.log(`      ${name} deltas:`, deltas.map(String).join(", "));
        expect(deltas).to.deep.equal(
          expectedDeltas(
            v.expected.refunds.map((r, i) => r + v.expected.payouts[i]),
            v.expected.rake + v.expected.dust
          )
        );
      });
    }

    it("sends tokens sent straight to the vault to the treasury", async () => {
      const extra = 777_777n;
      const id = await activeMatch();
      const vault = vaultPda(
        program.programId,
        matchPda(program.programId, id)
      );
      await mintTo(
        connection,
        admin,
        mint,
        vault,
        admin,
        extra,
        [],
        { commitment: "confirmed" },
        TOKEN_PROGRAM_ID
      );

      const before = await balances();
      await settleMatch(
        asAuthority,
        authority,
        id,
        [0, 0, 0, 0],
        CREW,
        mint,
        seatAtas(),
        treasury.ata
      );
      const after = await balances();
      const deltas = after.map((b, i) => b - before[i]);
      console.log(
        "      vault excess deltas (from settle only):",
        deltas.map(String).join(", ")
      );
      expect(deltas).to.deep.equal([
        16_000_000n,
        0n,
        16_000_000n,
        16_000_000n,
        extra,
      ]);
    });

    it("can't settle twice", async () => {
      const id = await activeMatch();
      await settleMatch(
        asAuthority,
        authority,
        id,
        [0, 0, 0, 0],
        CREW,
        mint,
        seatAtas(),
        treasury.ata
      );
      await expectAnchorError(
        settleMatch(
          asAuthority,
          authority,
          id,
          [0, 0, 0, 0],
          CREW,
          mint,
          seatAtas(),
          treasury.ata
        ),
        "AccountNotInitialized"
      );
    });
  });

  describe("rejections", () => {
    // Failed settles change nothing, so one Active match serves every case.
    let id: number;
    before(async () => {
      id = await activeMatch();
    });

    const settle = (o: {
      signer?: Keypair;
      matchId?: number;
      unspent?: number[];
      mask?: number;
      seats?: PublicKey[];
      treasuryAta?: PublicKey;
    }) =>
      settleMatch(
        program,
        o.signer ?? authority,
        o.matchId ?? id,
        o.unspent ?? [0, 0, 0, 0],
        o.mask ?? CREW,
        mint,
        o.seats ?? seatAtas(),
        o.treasuryAta ?? treasury.ata
      );

    it("a non-authority signer", async () => {
      const stranger = await newFundedWallet(connection);
      await expectAnchorError(settle({ signer: stranger }), "Unauthorized");
    });

    it("a match still Open", async () => {
      const openId = nextId++;
      await createMatch(program, authority, openId, keys(), mint);
      await expectAnchorError(settle({ matchId: openId }), "MatchNotActive");
    });

    for (const [label, mask] of [
      ["winners_mask 0", 0],
      ["a 2-winner mask", 0b0011],
      ["winners_mask 0b10000", 0b10000],
    ] as const) {
      it(label, async () => {
        await expectAnchorError(settle({ mask }), "InvalidWinners");
      });
    }

    it("unspent 1201", async () => {
      await expectAnchorError(
        settle({ unspent: [0, 1201, 0, 0] }),
        "UnspentExceedsBuyIn"
      );
    });

    it("3 remaining accounts", async () => {
      await expectAnchorError(
        settle({ seats: seatAtas().slice(0, 3) }),
        "WrongRemainingAccountsCount"
      );
    });

    it("5 remaining accounts", async () => {
      await expectAnchorError(
        settle({ seats: [...seatAtas(), seatAtas()[0]] }),
        "WrongRemainingAccountsCount"
      );
    });

    it("remaining accounts out of seat order", async () => {
      const [a, b, c, d] = seatAtas();
      await expectAnchorError(
        settle({ seats: [b, a, c, d] }),
        "InvalidTokenAccount"
      );
    });

    it("a remaining account belonging to the wrong player", async () => {
      const outsider = Keypair.generate().publicKey;
      const outsiderAta = await createFundedAta(
        connection,
        admin,
        mint,
        outsider,
        0
      );
      const s = seatAtas();
      s[2] = outsiderAta;
      await expectAnchorError(settle({ seats: s }), "InvalidTokenAccount");
    });

    it("a remaining account with the wrong mint", async () => {
      const otherMint = await createMockMint(connection, admin);
      const wrong = await createFundedAta(
        connection,
        admin,
        otherMint,
        players[0].kp.publicKey,
        0
      );
      const s = seatAtas();
      s[0] = wrong;
      await expectAnchorError(settle({ seats: s }), "InvalidTokenAccount");
    });

    it("the vault passed as a seat account", async () => {
      const s = seatAtas();
      s[3] = vaultPda(program.programId, matchPda(program.programId, id));
      await expectAnchorError(settle({ seats: s }), "InvalidTokenAccount");
    });

    it("the treasury passed as a seat account", async () => {
      const s = seatAtas();
      s[1] = treasury.ata;
      await expectAnchorError(settle({ seats: s }), "InvalidTokenAccount");
    });

    it("a wrong treasury token account (right mint, wrong owner)", async () => {
      const notTreasury = Keypair.generate().publicKey;
      const ata = await createFundedAta(
        connection,
        admin,
        mint,
        notTreasury,
        0
      );
      await expectAnchorError(
        settle({ treasuryAta: ata }),
        "ConstraintTokenOwner"
      );
    });

    after(async () => {
      // The shared match is still settleable after every rejection.
      await settleMatch(
        asAuthority,
        authority,
        id,
        [0, 0, 0, 0],
        CREW,
        mint,
        seatAtas(),
        treasury.ata
      );
    });
  });
});
