import * as anchor from "@anchor-lang/core";
import { BN } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import {
  BUY_IN,
  CREDITS_PER_BUY_IN,
  configPda,
  createMockMint,
  eventsOf,
  expectAnchorError,
  expectFailure,
  getProgram,
  newFundedWallet,
  programDataAddress,
} from "./helpers";

describe("config", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = getProgram();
  const connection = provider.connection;
  const upgradeAuthority = (provider.wallet as anchor.Wallet).payer;

  const config = configPda(program.programId);
  const programData = programDataAddress(program.programId);

  const serverAuthority = Keypair.generate().publicKey;
  const treasury = Keypair.generate().publicKey;
  let mint: PublicKey;

  type InitParams = {
    authority: PublicKey;
    mint: PublicKey;
    treasury: PublicKey;
    buyIn: number;
    credits: number;
    rakeBps: number;
    voidTimeout: number;
  };
  const valid: Omit<InitParams, "authority" | "mint" | "treasury"> = {
    buyIn: BUY_IN,
    credits: CREDITS_PER_BUY_IN,
    rakeBps: 0,
    voidTimeout: 1800,
  };

  function init(
    p: Partial<InitParams> = {},
    signer: Keypair = upgradeAuthority
  ) {
    const q = { authority: serverAuthority, mint, treasury, ...valid, ...p };
    return program.methods
      .initializeConfig(
        q.authority,
        q.mint,
        q.treasury,
        new BN(q.buyIn),
        q.credits,
        q.rakeBps,
        new BN(q.voidTimeout)
      )
      .accountsPartial({ admin: signer.publicKey, config, programData })
      .signers([signer])
      .rpc({ commitment: "confirmed" });
  }

  const noChanges = {
    authority: null,
    mint: null,
    treasury: null,
    buyInAmount: null,
    creditsPerBuyIn: null,
    rakeBps: null,
    voidTimeoutSecs: null,
    paused: null,
  };

  function update(
    signer: Keypair,
    changes: Partial<typeof noChanges> = {},
    newAdmin: PublicKey | null = null
  ) {
    return program.methods
      .updateConfig({ ...noChanges, ...changes }, newAdmin)
      .accountsPartial({ admin: signer.publicKey, config })
      .signers([signer])
      .rpc({ commitment: "confirmed" });
  }

  before(async () => {
    mint = await createMockMint(connection, upgradeAuthority);
  });

  // Config is a singleton shared with later test files: hand admin back to the
  // upgrade authority and unpause once this file is done.
  let currentAdmin: Keypair = upgradeAuthority;
  after(async () => {
    if (!currentAdmin.publicKey.equals(upgradeAuthority.publicKey)) {
      await update(currentAdmin, { paused: false }, upgradeAuthority.publicKey);
    }
  });

  describe("initialize_config", () => {
    it("fails from a signer that is not the upgrade authority", async () => {
      const impostor = await newFundedWallet(connection);
      await expectAnchorError(init({}, impostor), "Unauthorized");
    });

    it("rejects buy_in not divisible by credits", async () => {
      await expectAnchorError(init({ buyIn: BUY_IN + 1 }), "InvalidConfig");
    });

    it("rejects rake_bps of 1001", async () => {
      await expectAnchorError(init({ rakeBps: 1001 }), "InvalidConfig");
    });

    it("rejects zero credits", async () => {
      await expectAnchorError(init({ credits: 0 }), "InvalidConfig");
    });

    it("rejects zero buy_in", async () => {
      await expectAnchorError(init({ buyIn: 0 }), "InvalidConfig");
    });

    it("rejects void_timeout of 0", async () => {
      await expectAnchorError(init({ voidTimeout: 0 }), "InvalidConfig");
    });

    it("rejects void_timeout of -1", async () => {
      await expectAnchorError(init({ voidTimeout: -1 }), "InvalidConfig");
    });

    it("rejects a default authority", async () => {
      await expectAnchorError(
        init({ authority: PublicKey.default }),
        "InvalidConfig"
      );
    });

    it("rejects a default mint", async () => {
      await expectAnchorError(
        init({ mint: PublicKey.default }),
        "InvalidConfig"
      );
    });

    it("rejects a default treasury", async () => {
      await expectAnchorError(
        init({ treasury: PublicKey.default }),
        "InvalidConfig"
      );
    });

    it("succeeds from the upgrade authority with valid params", async () => {
      const sig = await init();
      const events = await eventsOf(program, sig);
      expect(events.map((e) => e.name)).to.deep.equal(["configUpdated"]);
      expect(events[0].data.admin.toBase58()).to.equal(
        upgradeAuthority.publicKey.toBase58()
      );
      expect(events[0].data.buyInAmount.toNumber()).to.equal(BUY_IN);

      const c = await program.account.config.fetch(config);
      expect(c.admin.toBase58()).to.equal(
        upgradeAuthority.publicKey.toBase58()
      );
      expect(c.authority.toBase58()).to.equal(serverAuthority.toBase58());
      expect(c.mint.toBase58()).to.equal(mint.toBase58());
      expect(c.treasury.toBase58()).to.equal(treasury.toBase58());
      expect(c.buyInAmount.toNumber()).to.equal(BUY_IN);
      expect(c.creditsPerBuyIn).to.equal(CREDITS_PER_BUY_IN);
      expect(c.rakeBps).to.equal(0);
      expect(c.voidTimeoutSecs.toNumber()).to.equal(1800);
      expect(c.paused).to.equal(false);
    });

    it("can't be called twice", async () => {
      await expectFailure(init(), "already in use");
    });
  });

  describe("update_config", () => {
    it("works for the admin and emits ConfigUpdated", async () => {
      const sig = await update(upgradeAuthority, {
        rakeBps: 1000,
        paused: true,
      });
      const c = await program.account.config.fetch(config);
      expect(c.rakeBps).to.equal(1000); // 1000 is the inclusive max
      expect(c.paused).to.equal(true);

      const events = await eventsOf(program, sig);
      expect(events.map((e) => e.name)).to.deep.equal(["configUpdated"]);
      expect(events[0].data.rakeBps).to.equal(1000);
      expect(events[0].data.paused).to.equal(true);

      await update(upgradeAuthority, { rakeBps: 0, paused: false });
    });

    it("fails for anyone else", async () => {
      const stranger = await newFundedWallet(connection);
      await expectAnchorError(
        update(stranger, { paused: true }),
        "Unauthorized"
      );
    });

    const cases: [string, Partial<typeof noChanges>][] = [
      ["buy_in not divisible by credits", { buyInAmount: new BN(BUY_IN + 1) }],
      ["rake_bps of 1001", { rakeBps: 1001 }],
      ["zero credits", { creditsPerBuyIn: 0 }],
      ["zero buy_in", { buyInAmount: new BN(0) }],
      ["void_timeout of 0", { voidTimeoutSecs: new BN(0) }],
      ["void_timeout of -1", { voidTimeoutSecs: new BN(-1) }],
    ];
    for (const [name, changes] of cases) {
      it(`rejects invariant-breaking update (${name}) and leaves config unchanged`, async () => {
        const before = await connection.getAccountInfo(config, "confirmed");
        // Pair the bad field with a valid one so a partial write would show.
        await expectAnchorError(
          update(upgradeAuthority, { ...changes, paused: true }),
          "InvalidConfig"
        );
        const after = await connection.getAccountInfo(config, "confirmed");
        expect(after!.data.equals(before!.data)).to.equal(true);
      });
    }

    it("transfers admin, and the old admin loses access", async () => {
      const newAdmin = await newFundedWallet(connection);
      await update(upgradeAuthority, {}, newAdmin.publicKey);

      let c = await program.account.config.fetch(config);
      expect(c.admin.toBase58()).to.equal(newAdmin.publicKey.toBase58());

      await expectAnchorError(
        update(upgradeAuthority, { paused: true }),
        "Unauthorized"
      );

      currentAdmin = newAdmin;
      await update(newAdmin, { paused: true });
      c = await program.account.config.fetch(config);
      expect(c.paused).to.equal(true);
    });
  });
});
