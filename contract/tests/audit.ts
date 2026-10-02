import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  AuthorityType,
  TOKEN_PROGRAM_ID,
  closeAccount,
  createAccount,
  createAssociatedTokenAccountIdempotent,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  setAuthority,
} from "@solana/spl-token";
import { expect } from "chai";
import { Reztor } from "../target/types/reztor";
import {
  BUY_IN,
  Player,
  configPda,
  createMatch,
  createMockMint,
  createPlayers,
  createTreasury,
  ensureConfig,
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

const CREW = maskOf([0, 2, 3]);
const FULL_SPEND = [0, 0, 0, 0];

describe("audit", () => {
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
  let nextId = 5_000;
  const ids = () => nextId++;
  const keysOf = (ps: Player[]) => ps.map((p) => p.kp.publicKey);
  const atasOf = (ps: Player[]) => ps.map((p) => p.ata);

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

  async function activeMatch(
    ps: Player[] = players,
    m: PublicKey = mint
  ): Promise<number> {
    const id = ids();
    await createMatch(program, authority, id, keysOf(ps), m);
    await joinAll(program, id, ps, m);
    return id;
  }

  const settle = (
    id: number,
    ps: Player[] = players,
    seats = atasOf(ps),
    t = treasury.ata
  ) =>
    settleMatch(asAuthority, authority, id, FULL_SPEND, CREW, mint, seats, t);

  describe("11a. config.authority rotated while matches are live", () => {
    let newAuthority: Keypair;
    let settleId: number;
    let voidId: number;

    before(async () => {
      settleId = await activeMatch();
      voidId = await activeMatch();
      newAuthority = await newFundedWallet(connection);
      await updateConfig(program, admin, { authority: newAuthority.publicKey });
    });
    after(async () => {
      await updateConfig(program, admin, { authority: authority.publicKey });
    });

    it("the old authority can no longer settle", async () => {
      await expectAnchorError(settle(settleId), "Unauthorized");
    });

    it("the old authority can no longer void (rent to itself, or as the new authority's caller)", async () => {
      await expectAnchorError(
        voidMatch(
          asAuthority,
          authority,
          voidId,
          mint,
          atasOf(players),
          treasury.ata,
          authority.publicKey
        ),
        "Unauthorized"
      );
      await expectAnchorError(
        voidMatch(
          asAuthority,
          authority,
          voidId,
          mint,
          atasOf(players),
          treasury.ata,
          newAuthority.publicKey
        ),
        "NotSeated"
      );
    });

    it("the new authority can settle it, and receives the rent", async () => {
      const rent = await matchRent(connection, program.programId, settleId);
      const before = await connection.getBalance(
        newAuthority.publicKey,
        "confirmed"
      );
      const sig = await settleMatch(
        programAs(program, newAuthority),
        newAuthority,
        settleId,
        FULL_SPEND,
        CREW,
        mint,
        atasOf(players),
        treasury.ata
      );
      const after = await connection.getBalance(
        newAuthority.publicKey,
        "confirmed"
      );
      expect(after - before).to.equal(rent - (await feeOf(connection, sig)));
    });

    it("void rent goes to the new authority", async () => {
      const rent = await matchRent(connection, program.programId, voidId);
      const before = await connection.getBalance(
        newAuthority.publicKey,
        "confirmed"
      );
      const sig = await voidMatch(
        programAs(program, newAuthority),
        newAuthority,
        voidId,
        mint,
        atasOf(players),
        treasury.ata,
        newAuthority.publicKey
      );
      const after = await connection.getBalance(
        newAuthority.publicKey,
        "confirmed"
      );
      expect(after - before).to.equal(rent - (await feeOf(connection, sig)));
    });
  });

  describe("11b. config.mint changed after create", () => {
    it("join, settle and void of existing matches still work on the original mint", async () => {
      const settleId = ids();
      const voidId = ids();
      await createMatch(program, authority, settleId, keysOf(players), mint);
      await createMatch(program, authority, voidId, keysOf(players), mint);
      for (const p of players.slice(0, 3))
        await joinMatch(program, settleId, p.kp, p.ata, mint);
      await joinMatch(program, voidId, players[0].kp, players[0].ata, mint);

      const otherMint = await createMockMint(connection, admin);
      await updateConfig(program, admin, { mint: otherMint });
      try {
        const before = await Promise.all(
          atasOf(players).map((a) => tokenBalance(connection, a))
        );
        await joinMatch(program, settleId, players[3].kp, players[3].ata, mint);
        const m = await program.account.match.fetch(
          matchPda(program.programId, settleId)
        );
        expect(m.status).to.deep.equal({ active: {} });
        await settle(settleId);
        await voidMatch(
          asAuthority,
          authority,
          voidId,
          mint,
          [players[0].ata],
          treasury.ata,
          authority.publicKey
        );
        const after = await Promise.all(
          atasOf(players).map((a) => tokenBalance(connection, a))
        );
        // seat 3 paid in here; crew win full spend pays 16 to seats 0, 2, 3; void refunds seat 0's 12.
        expect(after.map((b, i) => b - before[i])).to.deep.equal([
          16_000_000n + 12_000_000n,
          0n,
          16_000_000n,
          16_000_000n - 12_000_000n,
        ]);
      } finally {
        await updateConfig(program, admin, { mint });
      }
    });
  });

  describe("11c. config.treasury changed mid-match", () => {
    it("settle pays the new treasury, and needs its token account to exist", async () => {
      await updateConfig(program, admin, { rakeBps: 500 });
      let id: number;
      try {
        id = await activeMatch();
      } finally {
        await updateConfig(program, admin, { rakeBps: 0 });
      }
      const newTreasury = Keypair.generate().publicKey;
      const newTreasuryAta = getAssociatedTokenAddressSync(mint, newTreasury);
      await updateConfig(program, admin, { treasury: newTreasury });
      try {
        await expectAnchorError(
          settle(id, players, atasOf(players), newTreasuryAta),
          "AccountNotInitialized"
        );

        // Anyone can create it; here a stranger pays.
        const stranger = await newFundedWallet(connection, 1);
        await createAssociatedTokenAccountIdempotent(
          connection,
          stranger,
          mint,
          newTreasury
        );
        const oldBefore = await tokenBalance(connection, treasury.ata);
        await settle(id, players, atasOf(players), newTreasuryAta);
        expect(await tokenBalance(connection, newTreasuryAta)).to.equal(
          2_400_000n
        );
        expect(await tokenBalance(connection, treasury.ata)).to.equal(
          oldBefore
        );
      } finally {
        await updateConfig(program, admin, { treasury: treasury.owner });
      }
    });
  });

  describe("11d. a joined player closes their ATA before settle", () => {
    it("settle fails; recreating the ATA (authority pays) then settling succeeds", async () => {
      const ps = await createPlayers(connection, admin, mint, BUY_IN); // exactly one buy-in each
      const id = await activeMatch(ps);
      const p0 = ps[0];
      await closeAccount(connection, p0.kp, p0.ata, p0.kp.publicKey, p0.kp);
      expect(await connection.getAccountInfo(p0.ata)).to.equal(null);

      await expectAnchorError(settle(id, ps), "InvalidTokenAccount");

      await createAssociatedTokenAccountIdempotent(
        connection,
        authority,
        mint,
        p0.kp.publicKey
      );
      await settle(id, ps);
      expect(await tokenBalance(connection, p0.ata)).to.equal(16_000_000n);
    });

    it("with the ATA left closed, a fresh non-ATA token account owned by the player works", async () => {
      const ps = await createPlayers(connection, admin, mint, BUY_IN);
      const id = await activeMatch(ps);
      const p0 = ps[0];
      await closeAccount(connection, p0.kp, p0.ata, p0.kp.publicKey, p0.kp);

      const fresh = await createAccount(
        connection,
        authority,
        mint,
        p0.kp.publicKey,
        Keypair.generate(),
        { commitment: "confirmed" }
      );
      expect(fresh.equals(p0.ata)).to.equal(false);
      const seats = atasOf(ps);
      seats[0] = fresh;
      await settle(id, ps, seats);
      expect(await tokenBalance(connection, fresh)).to.equal(16_000_000n);
      expect(await connection.getAccountInfo(p0.ata)).to.equal(null);
    });
  });

  describe("11e. a joined player reassigns their ATA's owner before void", () => {
    it("void with that account fails; a fresh token account owned by the player works", async () => {
      const ps = await createPlayers(connection, admin, mint, BUY_IN);
      const id = ids();
      await createMatch(program, authority, id, keysOf(ps), mint);
      await joinMatch(program, id, ps[0].kp, ps[0].ata, mint);
      await joinMatch(program, id, ps[1].kp, ps[1].ata, mint);

      const elsewhere = Keypair.generate().publicKey;
      await setAuthority(
        connection,
        ps[0].kp,
        ps[0].ata,
        ps[0].kp,
        AuthorityType.AccountOwner,
        elsewhere
      );

      await expectAnchorError(
        voidMatch(
          asAuthority,
          authority,
          id,
          mint,
          [ps[0].ata, ps[1].ata],
          treasury.ata,
          authority.publicKey
        ),
        "InvalidTokenAccount"
      );

      const fresh = await createAccount(
        connection,
        authority,
        mint,
        ps[0].kp.publicKey,
        Keypair.generate(),
        { commitment: "confirmed" }
      );
      await voidMatch(
        asAuthority,
        authority,
        id,
        mint,
        [fresh, ps[1].ata],
        treasury.ata,
        authority.publicKey
      );
      expect(await tokenBalance(connection, fresh)).to.equal(BigInt(BUY_IN));
      expect(await tokenBalance(connection, ps[1].ata)).to.equal(
        BigInt(BUY_IN)
      );
    });
  });

  describe("11f. config paused", () => {
    it("settle still succeeds", async () => {
      const id = await activeMatch();
      await updateConfig(program, admin, { paused: true });
      try {
        await settle(id);
      } finally {
        await updateConfig(program, admin, { paused: false });
      }
      expect(
        await connection.getAccountInfo(matchPda(program.programId, id))
      ).to.equal(null);
    });
  });

  describe("12. account sizes", () => {
    it("Config and Match data lengths match their fields", async () => {
      const PK = 32;
      const configLen = 8 + 4 * PK + 8 + 4 + 2 + 8 + 1 + 1;
      const matchLen =
        8 + 8 + 1 + 1 + PK + 8 + 4 + 2 + 8 + 4 * PK + 1 + 1 + 8 + 8;
      const c = await connection.getAccountInfo(configPda(program.programId));
      const id = ids();
      await createMatch(program, authority, id, keysOf(players), mint);
      const m = await connection.getAccountInfo(
        matchPda(program.programId, id)
      );
      console.log(
        `      Config ${c!.data.length} bytes (expected ${configLen}); Match ${
          m!.data.length
        } bytes (expected ${matchLen})`
      );
      expect(c!.data.length).to.equal(configLen);
      expect(m!.data.length).to.equal(matchLen);
      await voidMatch(
        asAuthority,
        authority,
        id,
        mint,
        [],
        treasury.ata,
        authority.publicKey
      );
    });
  });

  describe("13. mock mint", () => {
    it("has no freeze authority, like real SKR", async () => {
      const m = await getMint(connection, mint);
      expect(m.freezeAuthority).to.equal(null);
      expect(m.decimals).to.equal(6);
    });
  });

  describe("14. measurements", () => {
    async function cuOf(sig: string): Promise<number> {
      const tx = await connection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      return tx!.meta!.computeUnitsConsumed!;
    }

    it("14a. compute units for settle (4 payouts + treasury + close) and void (4 joined)", async () => {
      await updateConfig(program, admin, { rakeBps: 500 });
      let settleId: number;
      try {
        settleId = await activeMatch();
      } finally {
        await updateConfig(program, admin, { rakeBps: 0 });
      }
      const before = await Promise.all(
        [...atasOf(players), treasury.ata].map((a) =>
          tokenBalance(connection, a)
        )
      );
      // Every seat keeps some credits, so all 4 payouts and the treasury are non-zero.
      const settleSig = await settleMatch(
        asAuthority,
        authority,
        settleId,
        [600, 600, 600, 600],
        CREW,
        mint,
        atasOf(players),
        treasury.ata
      );
      const after = await Promise.all(
        [...atasOf(players), treasury.ata].map((a) =>
          tokenBalance(connection, a)
        )
      );
      expect(after.every((b, i) => b > before[i])).to.equal(true);

      const voidId = await activeMatch();
      const voidSig = await voidMatch(
        asAuthority,
        authority,
        voidId,
        mint,
        atasOf(players),
        treasury.ata,
        authority.publicKey
      );

      const s = await cuOf(settleSig);
      const v = await cuOf(voidSig);
      console.log(
        `      settle_match: ${s} CU; void_match (4 joined): ${v} CU; default limit 200000`
      );
      expect(s).to.be.lessThan(200_000);
      expect(v).to.be.lessThan(200_000);
    });

    it("14b. legacy tx size: settle + 5 createAssociatedTokenAccountIdempotent", async () => {
      const id = await activeMatch();
      const matchAccount = matchPda(program.programId, id);
      const settleIx = await program.methods
        .settleMatch(new BN(id), FULL_SPEND, CREW)
        .accountsPartial({
          authority: authority.publicKey,
          config: configPda(program.programId),
          matchAccount,
          mint,
          vault: vaultPda(program.programId, matchAccount),
          treasuryTokenAccount: treasury.ata,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(
          atasOf(players).map((pubkey) => ({
            pubkey,
            isWritable: true,
            isSigner: false,
          }))
        )
        .instruction();
      const ataIxs = [...keysOf(players), treasury.owner].map((owner) =>
        createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          getAssociatedTokenAddressSync(mint, owner),
          owner,
          mint
        )
      );
      const { blockhash } = await connection.getLatestBlockhash();

      const sizeWith = (n: number) => {
        const tx = new Transaction({
          feePayer: authority.publicKey,
          recentBlockhash: blockhash,
        });
        tx.add(...ataIxs.slice(0, n), settleIx);
        const message = tx.compileMessage();
        // shortvec signature count (1 byte here) + 64 bytes per required signature + message.
        return (
          1 +
          64 * message.header.numRequiredSignatures +
          message.serialize().length
        );
      };
      const sizes = [0, 1, 2, 3, 4, 5].map((n) => ({
        ataCreates: n,
        bytes: sizeWith(n),
      }));
      console.log(
        "      " +
          sizes
            .map((s) => `${s.ataCreates} ATA creates: ${s.bytes} B`)
            .join("; ") +
          " (limit 1232)"
      );

      // Prove the full 5-create version actually lands.
      expect(sizes[5].bytes).to.be.at.most(1232);
      const tx = new Transaction({
        feePayer: authority.publicKey,
        recentBlockhash: blockhash,
      }).add(...ataIxs, settleIx);
      tx.sign(authority);
      const raw = tx.serialize();
      expect(raw.length).to.equal(sizes[5].bytes);
      const sig = await connection.sendRawTransaction(raw);
      await connection.confirmTransaction(
        { signature: sig, ...(await connection.getLatestBlockhash()) },
        "confirmed"
      );
      expect(
        await connection.getAccountInfo(matchAccount, "confirmed")
      ).to.equal(null);
      console.log(
        `      sent settle + 5 ATA creates as one ${
          raw.length
        }-byte tx; ${await cuOf(sig)} CU`
      );
    });
  });
});
