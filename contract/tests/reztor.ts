import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { expect } from "chai";
import { Reztor } from "../target/types/reztor";

describe("reztor", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.reztor as Program<Reztor>;

  it("is deployed and exposes the spec's instructions", async () => {
    const info = await program.provider.connection.getAccountInfo(
      program.programId
    );
    expect(info?.executable).to.equal(true);

    const names = program.idl.instructions.map((ix) => ix.name).sort();
    expect(names).to.deep.equal([
      "createMatch",
      "initializeConfig",
      "joinMatch",
      "settleMatch",
      "updateConfig",
      "voidMatch",
    ]);
  });
});
