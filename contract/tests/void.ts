import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ACCOUNT_SIZE, TOKEN_PROGRAM_ID, mintTo } from "@solana/spl-token";
import { expect } from "chai";
import { Reztor } from "../target/types/reztor";
import {
  BUY_IN,
  Player,
  createFundedAta,
  createMatch,
  createMockMint,
  createPlayers,
  createTreasury,
  ensureConfig,
  eventsOf,
  expectAnchorError,
  feeOf,
  getProgram,
  joinAll,
  joinMatch,
  maskOf,
  matchPda,
  matchRent,
  newFundedWallet,
  programAs,
  settleMatch,
  tokenBalance,
  updateConfig,
  vaultPda,
  voidMatch,
} from "./helpers";

const SHORT_TIMEOUT = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("void_match", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = getProgram();
  const connection = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  let authority: Keypair;
  let asAuthority: Program<Reztor>;
  let mint: PublicKey;
  let players: Player[];
  let treasury: { owner: PublicKey; ata: PublicKey };
  let nextId = 2_000;
  const keys = () => players.map((p) => p.kp.publicKey);
  const atas = () => players.map((p) => p.ata);

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

  /** Creates a match and joins the given seats. Uses the config's current timeout. */
  async function matchWith(joinedSeats: number[]): Promise<number> {
    const id = nextId++;
    await createMatch(program, authority, id, keys(), mint);
    for (const s of joinedSeats) {
      await joinMatch(program, id, players[s].kp, players[s].ata, mint);
    }
    return id;
  }

  /** A match created under void_timeout_secs = 2, with the timeout already passed. */
  async function timedOutMatch(joinedSeats: number[]): Promise<number> {
    await updateConfig(program, admin, {
      voidTimeoutSecs: new BN(SHORT_TIMEOUT),
    });
    let id: number;
    try {
      id = await matchWith(joinedSeats);
    } finally {
      await updateConfig(program, admin, { voidTimeoutSecs: new BN(1800) });
    }
    await sleep((SHORT_TIMEOUT + 1) * 1000);
    return id;
  }

  const byAuthority = (id: number, seats: PublicKey[]) =>
    voidMatch(
      asAuthority,
      authority,
      id,
      mint,
      seats,
      treasury.ata,
      authority.publicKey
    );

  async function balances(): Promise<bigint[]> {
    return Promise.all(
      [...atas(), treasury.ata].map((a) => tokenBalance(connection, a))
    );
  }
  const diff = (after: bigint[], before: bigint[]) =>
    after.map((b, i) => b - before[i]);
  const show = (d: bigint[]) => d.map(String).join(", ");

  async function expectClosed(id: number) {
    const m = matchPda(program.programId, id);
    expect(await connection.getAccountInfo(m, "confirmed")).to.equal(null);
    expect(
      await connection.getAccountInfo(
        vaultPda(program.programId, m),
        "confirmed"
      )
    ).to.equal(null);
  }

  describe("balance deltas", () => {
    it("authority voids an Open match with 2 of 4 joined", async () => {
      const before = await balances();
      const id = await matchWith([0, 2]);
      const rent = await matchRent(connection, program.programId, id);
      const authBefore = await connection.getBalance(
        authority.publicKey,
        "confirmed"
      );

      const sig = await byAuthority(id, [atas()[0], atas()[2]]);

      const d = diff(await balances(), before);
      console.log("      2 of 4 joined, authority void deltas:", show(d));
      expect(d).to.deep.equal([0n, 0n, 0n, 0n, 0n]);
      await expectClosed(id);
      const authDelta =
        (await connection.getBalance(authority.publicKey, "confirmed")) -
        authBefore;
      const fee = await feeOf(connection, sig);
      console.log(
        `      authority lamports: +${authDelta} (rent ${rent}, fee ${fee})`
      );
      expect(authDelta).to.equal(rent - fee);

      const events = await eventsOf(program, sig);
      expect(events.map((e) => e.name)).to.deep.equal(["matchVoided"]);
      expect(events[0].data.matchId.toNumber()).to.equal(id);
      expect(events[0].data.refundedSeatsMask).to.equal(maskOf([0, 2]));
      expect(events[0].data.byAuthority).to.equal(true);
    });

    it("authority voids an Open match with 0 joined", async () => {
      const id = await matchWith([]);
      const rent = await matchRent(connection, program.programId, id);
      expect(rent).to.equal(
        (await connection.getMinimumBalanceForRentExemption(
          (await connection.getAccountInfo(matchPda(program.programId, id)))!
            .data.length
        )) + (await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE))
      );
      const authBefore = await connection.getBalance(
        authority.publicKey,
        "confirmed"
      );
      const sig = await byAuthority(id, []);
      await expectClosed(id);
      const authDelta =
        (await connection.getBalance(authority.publicKey, "confirmed")) -
        authBefore;
      expect(authDelta).to.equal(rent - (await feeOf(connection, sig)));
      const events = await eventsOf(program, sig);
      expect(events[0].data.refundedSeatsMask).to.equal(0);
    });

    it("authority voids an Active match: all 4 refunded in full", async () => {
      const before = await balances();
      const id = await matchWith([0, 1, 2, 3]);
      const mid = await balances();
      expect(diff(mid, before).slice(0, 4)).to.deep.equal(
        Array(4).fill(-BigInt(BUY_IN))
      );
      await byAuthority(id, atas());
      const d = diff(await balances(), mid);
      console.log(
        "      active match, authority void deltas (from void only):",
        show(d)
      );
      expect(d).to.deep.equal([...Array(4).fill(BigInt(BUY_IN)), 0n]);
      await expectClosed(id);
    });

    it("a joined player voids after the timeout; rent still goes to authority", async () => {
      const before = await balances();
      const id = await timedOutMatch([1, 3]);
      const rent = await matchRent(connection, program.programId, id);
      const player = players[3].kp;
      const authBefore = await connection.getBalance(
        authority.publicKey,
        "confirmed"
      );
      const playerBefore = await connection.getBalance(
        player.publicKey,
        "confirmed"
      );

      const sig = await voidMatch(
        programAs(program, player),
        player,
        id,
        mint,
        [atas()[1], atas()[3]],
        treasury.ata,
        authority.publicKey
      );

      const d = diff(await balances(), before);
      console.log("      player void after timeout deltas:", show(d));
      expect(d).to.deep.equal([0n, 0n, 0n, 0n, 0n]);
      await expectClosed(id);
      const fee = await feeOf(connection, sig);
      const authDelta =
        (await connection.getBalance(authority.publicKey, "confirmed")) -
        authBefore;
      const playerDelta =
        (await connection.getBalance(player.publicKey, "confirmed")) -
        playerBefore;
      console.log(
        `      authority lamports: +${authDelta} (rent ${rent}); player lamports: ${playerDelta} (fee ${fee})`
      );
      expect(authDelta).to.equal(rent);
      expect(playerDelta).to.equal(-fee);

      const events = await eventsOf(program, sig);
      expect(events[0].data.refundedSeatsMask).to.equal(maskOf([1, 3]));
      expect(events[0].data.byAuthority).to.equal(false);
    });

    it("succeeds while config is paused", async () => {
      const id = await matchWith([0]);
      await updateConfig(program, admin, { paused: true });
      try {
        const before = await balances();
        await byAuthority(id, [atas()[0]]);
        expect(diff(await balances(), before)).to.deep.equal([
          BigInt(BUY_IN),
          0n,
          0n,
          0n,
          0n,
        ]);
      } finally {
        await updateConfig(program, admin, { paused: false });
      }
      await expectClosed(id);
    });

    it("sends vault excess to the treasury", async () => {
      const extra = 424_242n;
      const id = await matchWith([0, 1, 2]);
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
      await byAuthority(id, atas().slice(0, 3));
      const d = diff(await balances(), before);
      console.log("      vault excess, void deltas (from void only):", show(d));
      expect(d).to.deep.equal([
        BigInt(BUY_IN),
        BigInt(BUY_IN),
        BigInt(BUY_IN),
        0n,
        extra,
      ]);
    });
  });

  describe("rejections", () => {
    it("a player voiding before the timeout", async () => {
      const id = await matchWith([0]);
      const p = players[0].kp;
      await expectAnchorError(
        voidMatch(
          program,
          p,
          id,
          mint,
          [atas()[0]],
          treasury.ata,
          authority.publicKey
        ),
        "VoidTimeoutNotReached"
      );
    });

    describe("after the timeout", () => {
      // Seats 0 and 2 joined; failed voids change nothing, so one match serves every case.
      let id: number;
      before(async () => {
        id = await timedOutMatch([0, 2]);
      });
      const joinedAtas = () => [atas()[0], atas()[2]];

      it("a non-seated wallet", async () => {
        const outsider = await newFundedWallet(connection, 1);
        await expectAnchorError(
          voidMatch(
            program,
            outsider,
            id,
            mint,
            joinedAtas(),
            treasury.ata,
            authority.publicKey
          ),
          "NotSeated"
        );
      });

      it("a seated but not-joined player", async () => {
        await expectAnchorError(
          voidMatch(
            program,
            players[1].kp,
            id,
            mint,
            joinedAtas(),
            treasury.ata,
            authority.publicKey
          ),
          "NotJoined"
        );
      });

      it("a player passing their own wallet as authority to take the rent", async () => {
        const p = players[0].kp;
        await expectAnchorError(
          voidMatch(
            program,
            p,
            id,
            mint,
            joinedAtas(),
            treasury.ata,
            p.publicKey
          ),
          "Unauthorized"
        );
      });

      after(async () => {
        // Still voidable by a joined player after every rejection.
        await voidMatch(
          program,
          players[2].kp,
          id,
          mint,
          joinedAtas(),
          treasury.ata,
          authority.publicKey
        );
        await expectClosed(id);
      });
    });

    describe("account validation", () => {
      // Seats 0 and 2 joined.
      let id: number;
      before(async () => {
        id = await matchWith([0, 2]);
      });

      it("too few remaining accounts", async () => {
        await expectAnchorError(
          byAuthority(id, [atas()[0]]),
          "WrongRemainingAccountsCount"
        );
      });

      it("accounts for non-joined seats included", async () => {
        await expectAnchorError(
          byAuthority(id, atas()),
          "WrongRemainingAccountsCount"
        );
      });

      it("wrong order", async () => {
        await expectAnchorError(
          byAuthority(id, [atas()[2], atas()[0]]),
          "InvalidTokenAccount"
        );
      });

      it("wrong owner", async () => {
        // Seat 1's account in seat 2's slot.
        await expectAnchorError(
          byAuthority(id, [atas()[0], atas()[1]]),
          "InvalidTokenAccount"
        );
      });

      it("a wrong treasury token account", async () => {
        const notTreasury = await createFundedAta(
          connection,
          admin,
          mint,
          Keypair.generate().publicKey,
          0
        );
        await expectAnchorError(
          voidMatch(
            asAuthority,
            authority,
            id,
            mint,
            [atas()[0], atas()[2]],
            notTreasury,
            authority.publicKey
          ),
          "ConstraintTokenOwner"
        );
      });

      after(async () => {
        await byAuthority(id, [atas()[0], atas()[2]]);
      });
    });
  });

  describe("lifecycle", () => {
    it("void after settle fails", async () => {
      const id = await matchWith([0, 1, 2, 3]);
      await settleMatch(
        asAuthority,
        authority,
        id,
        [0, 0, 0, 0],
        maskOf([0, 2, 3]),
        mint,
        atas(),
        treasury.ata
      );
      await expectAnchorError(byAuthority(id, atas()), "AccountNotInitialized");
    });

    it("settle after void fails", async () => {
      const id = await matchWith([0, 1, 2, 3]);
      await byAuthority(id, atas());
      await expectAnchorError(
        settleMatch(
          asAuthority,
          authority,
          id,
          [0, 0, 0, 0],
          maskOf([0, 2, 3]),
          mint,
          atas(),
          treasury.ata
        ),
        "AccountNotInitialized"
      );
    });

    it("joining a voided match fails", async () => {
      const id = await matchWith([0]);
      await byAuthority(id, [atas()[0]]);
      await expectAnchorError(
        joinMatch(program, id, players[1].kp, players[1].ata, mint),
        "AccountNotInitialized"
      );
    });
  });
});
