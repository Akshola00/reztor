import * as anchor from "@anchor-lang/core";
import { BN } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import {
  BUY_IN,
  ConfigChanges,
  Player,
  configPda,
  createFundedAta,
  createMatch,
  createMockMint,
  createPlayers,
  ensureConfig,
  eventsOf,
  expectAnchorError,
  expectFailure,
  getProgram,
  joinAll,
  joinMatch,
  matchPda,
  newFundedWallet,
  tokenBalance,
  updateConfig,
  vaultPda,
} from "./helpers";

describe("lifecycle: create_match / join_match", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = getProgram();
  const connection = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const config = configPda(program.programId);

  let authority: Keypair;
  let mint: PublicKey;
  let players: Player[];
  let nextId = 1;
  const newMatchId = () => nextId++;
  const keys = () => players.map((p) => p.kp.publicKey);

  const update = (changes: ConfigChanges) =>
    updateConfig(program, admin, changes);

  /** Runs `fn` with the config paused, always unpausing afterwards. */
  async function whilePaused(fn: () => Promise<void>) {
    await update({ paused: true });
    try {
      await fn();
    } finally {
      await update({ paused: false });
    }
  }

  before(async () => {
    authority = await newFundedWallet(connection);
    mint = await createMockMint(connection, admin);
    players = await createPlayers(connection, admin, mint);

    await ensureConfig(program, admin, {
      authority: authority.publicKey,
      mint,
      treasury: Keypair.generate().publicKey,
    });
  });

  describe("create_match", () => {
    it("creates the match and an empty vault owned by the match PDA, snapshotting config", async () => {
      const id = newMatchId();
      const sig = await createMatch(program, authority, id, keys(), mint);

      const matchAccount = matchPda(program.programId, id);
      const vault = vaultPda(program.programId, matchAccount);
      const vaultAcc = await getAccount(
        connection,
        vault,
        "confirmed",
        TOKEN_PROGRAM_ID
      );
      expect(vaultAcc.amount).to.equal(0n);
      expect(vaultAcc.owner.toBase58()).to.equal(matchAccount.toBase58());
      expect(vaultAcc.mint.toBase58()).to.equal(mint.toBase58());

      const c = await program.account.config.fetch(config);
      const m = await program.account.match.fetch(matchAccount);
      expect(m.matchId.toNumber()).to.equal(id);
      expect(m.mint.toBase58()).to.equal(c.mint.toBase58());
      expect(m.buyInAmount.toString()).to.equal(c.buyInAmount.toString());
      expect(m.creditsPerBuyIn).to.equal(c.creditsPerBuyIn);
      expect(m.rakeBps).to.equal(c.rakeBps);
      expect(m.voidTimeoutSecs.toString()).to.equal(
        c.voidTimeoutSecs.toString()
      );
      expect(m.players.map((p) => p.toBase58())).to.deep.equal(
        keys().map((p) => p.toBase58())
      );
      expect(m.joinedMask).to.equal(0);
      expect(m.status).to.deep.equal({ open: {} });
      expect(m.createdAt.toNumber()).to.be.greaterThan(0);
      expect(m.startedAt.toNumber()).to.equal(0);
      const [, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("match"), new BN(id).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [, vaultBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), matchAccount.toBuffer()],
        program.programId
      );
      expect(m.bump).to.equal(bump);
      expect(m.vaultBump).to.equal(vaultBump);

      const events = await eventsOf(program, sig);
      expect(events.map((e) => e.name)).to.deep.equal(["matchCreated"]);
      expect(events[0].data.matchId.toNumber()).to.equal(id);
      expect(
        events[0].data.players.map((p: PublicKey) => p.toBase58())
      ).to.deep.equal(keys().map((p) => p.toBase58()));
    });

    it("fails for a non-authority signer", async () => {
      const stranger = await newFundedWallet(connection);
      await expectAnchorError(
        createMatch(program, stranger, newMatchId(), keys(), mint),
        "Unauthorized"
      );
    });

    it("fails when paused", async () => {
      await whilePaused(() =>
        expectAnchorError(
          createMatch(program, authority, newMatchId(), keys(), mint),
          "Paused"
        )
      );
    });

    it("fails for a duplicate player", async () => {
      const k = keys();
      await expectAnchorError(
        createMatch(
          program,
          authority,
          newMatchId(),
          [k[0], k[1], k[2], k[1]],
          mint
        ),
        "DuplicatePlayer"
      );
    });

    it("fails for a default pubkey", async () => {
      const k = keys();
      await expectAnchorError(
        createMatch(
          program,
          authority,
          newMatchId(),
          [k[0], PublicKey.default, k[2], k[3]],
          mint
        ),
        "InvalidPlayer"
      );
    });

    it("fails for an existing match_id", async () => {
      const id = newMatchId();
      await createMatch(program, authority, id, keys(), mint);
      await expectFailure(
        createMatch(program, authority, id, keys(), mint),
        "already in use"
      );
    });

    it("fails for a mint different from config.mint", async () => {
      const otherMint = await createMockMint(connection, admin);
      await expectAnchorError(
        createMatch(program, authority, newMatchId(), keys(), otherMint),
        "InvalidMint"
      );
    });
  });

  describe("join_match", () => {
    it("moves exactly buy_in per join, flips to Active on the 4th, and emits events", async () => {
      const id = newMatchId();
      await createMatch(program, authority, id, keys(), mint);
      const matchAccount = matchPda(program.programId, id);
      const vault = vaultPda(program.programId, matchAccount);

      for (let seat = 0; seat < 4; seat++) {
        const p = players[seat];
        const vaultBefore = await tokenBalance(connection, vault);
        const playerBefore = await tokenBalance(connection, p.ata);

        const sig = await joinMatch(program, id, p.kp, p.ata, mint);

        expect(await tokenBalance(connection, vault)).to.equal(
          vaultBefore + BigInt(BUY_IN)
        );
        expect(await tokenBalance(connection, p.ata)).to.equal(
          playerBefore - BigInt(BUY_IN)
        );

        const m = await program.account.match.fetch(matchAccount);
        expect(m.joinedMask).to.equal((1 << (seat + 1)) - 1);

        const events = await eventsOf(program, sig);
        expect(events[0].name).to.equal("playerJoined");
        expect(events[0].data.matchId.toNumber()).to.equal(id);
        expect(events[0].data.seat).to.equal(seat);
        expect(events[0].data.player.toBase58()).to.equal(
          p.kp.publicKey.toBase58()
        );

        if (seat < 3) {
          expect(m.status).to.deep.equal({ open: {} });
          expect(m.startedAt.toNumber()).to.equal(0);
          expect(events.map((e) => e.name)).to.deep.equal(["playerJoined"]);
        } else {
          expect(m.status).to.deep.equal({ active: {} });
          expect(m.startedAt.toNumber()).to.be.greaterThan(0);
          expect(events.map((e) => e.name)).to.deep.equal([
            "playerJoined",
            "matchStarted",
          ]);
          expect(events[1].data.matchId.toNumber()).to.equal(id);
        }
      }
      expect(await tokenBalance(connection, vault)).to.equal(
        BigInt(BUY_IN) * 4n
      );
    });

    it("fails for a non-seated wallet", async () => {
      const id = newMatchId();
      await createMatch(program, authority, id, keys(), mint);
      const outsider = await newFundedWallet(connection, 2);
      const ata = await createFundedAta(
        connection,
        admin,
        mint,
        outsider.publicKey,
        BUY_IN
      );
      await expectAnchorError(
        joinMatch(program, id, outsider, ata, mint),
        "NotSeated"
      );
    });

    it("fails for the same player twice", async () => {
      const id = newMatchId();
      await createMatch(program, authority, id, keys(), mint);
      const p = players[0];
      await joinMatch(program, id, p.kp, p.ata, mint);
      await expectAnchorError(
        joinMatch(program, id, p.kp, p.ata, mint),
        "AlreadyJoined"
      );
    });

    it("fails for an Active match", async () => {
      const id = newMatchId();
      await createMatch(program, authority, id, keys(), mint);
      await joinAll(program, id, players, mint);
      const p = players[0];
      await expectAnchorError(
        joinMatch(program, id, p.kp, p.ata, mint),
        "MatchNotOpen"
      );
    });

    it("fails when paused", async () => {
      const id = newMatchId();
      await createMatch(program, authority, id, keys(), mint);
      const p = players[0];
      await whilePaused(() =>
        expectAnchorError(joinMatch(program, id, p.kp, p.ata, mint), "Paused")
      );
    });

    it("fails for a token account with the wrong mint", async () => {
      const id = newMatchId();
      await createMatch(program, authority, id, keys(), mint);
      const p = players[0];
      const otherMint = await createMockMint(connection, admin);
      const wrongAta = await createFundedAta(
        connection,
        admin,
        otherMint,
        p.kp.publicKey,
        BUY_IN
      );
      await expectAnchorError(
        joinMatch(program, id, p.kp, wrongAta, mint),
        "ConstraintTokenMint"
      );
    });

    it("fails for a token account owned by someone else", async () => {
      const id = newMatchId();
      await createMatch(program, authority, id, keys(), mint);
      await expectAnchorError(
        joinMatch(program, id, players[0].kp, players[1].ata, mint),
        "ConstraintTokenOwner"
      );
    });

    it("fails for a vault that isn't this match's vault", async () => {
      const id = newMatchId();
      const otherId = newMatchId();
      await createMatch(program, authority, id, keys(), mint);
      await createMatch(program, authority, otherId, keys(), mint);
      const otherVault = vaultPda(
        program.programId,
        matchPda(program.programId, otherId)
      );
      const p = players[0];
      await expectAnchorError(
        joinMatch(program, id, p.kp, p.ata, mint, { vault: otherVault }),
        "ConstraintSeeds"
      );
    });

    it("charges the snapshotted buy_in after config changes", async () => {
      const id = newMatchId();
      await createMatch(program, authority, id, keys(), mint);
      const doubled = BUY_IN * 2;
      await update({ buyInAmount: new BN(doubled) });
      try {
        const c = await program.account.config.fetch(config);
        expect(c.buyInAmount.toNumber()).to.equal(doubled);

        const p = players[0];
        const vault = vaultPda(
          program.programId,
          matchPda(program.programId, id)
        );
        const before = await tokenBalance(connection, p.ata);
        await joinMatch(program, id, p.kp, p.ata, mint);
        expect(await tokenBalance(connection, p.ata)).to.equal(
          before - BigInt(BUY_IN)
        );
        expect(await tokenBalance(connection, vault)).to.equal(BigInt(BUY_IN));
      } finally {
        await update({ buyInAmount: new BN(BUY_IN) });
      }
    });
  });
});
