# Reztor contract — rules for this directory

- Source of truth: docs/contract-spec.md. Game spec: ../docs/reztor-spec.md. If they conflict, the contract spec wins.
- This directory overrides the global Rust learning-mode rule. Write the code directly. In every phase report, add a short "Rust/Anchor notes" section that explains the non-obvious constructs you used and why.
- Work one phase at a time. When a phase is done, write the phase report and STOP.
- Implement only what the spec lists. Put ideas under "Open questions" in the report, not in code.
- Never change a spec-derived test's expected values to make it pass. If a test and the program disagree, explain which is wrong, cite the spec line, and stop.
- Program code: no unwrap/expect/panic, checked arithmetic only, no truncating `as` casts, specific ReztorError variants only.
- If a build or toolchain problem resists two attempts, stop and report the exact error and versions. Don't thrash.
- Toolchain versions below are frozen. Do not upgrade anchor, crates or the Rust toolchain.
- The Solana CLI global config points at mainnet. Always pass --url devnet or --provider.cluster devnet explicitly. Never send a mainnet transaction.
- Never commit private keys or keypair JSON files.
- Do not touch ../server, ../mobile or ../docs.

## Pinned versions

Frozen for the week once Phase 0 built. Do not bump without asking.

| Tool | Version |
| :---- | :---- |
| anchor CLI (via avm) | 1.1.2 |
| avm | 1.1.2 |
| anchor-lang crate | =1.1.2 |
| anchor-spl crate | =1.1.2 (features: token, token_2022, token_2022_extensions) |
| @anchor-lang/core (TS) | 1.1.2 exact (borsh, errors pinned via pnpm.overrides) |
| @solana/spl-token (TS, tests) | 0.4.15 |
| solana CLI (Agave) | 3.1.10 |
| rustc / cargo (host) | 1.98.1 |
| Rust toolchain (rust-toolchain.toml) | 1.89.0 |
| node | 24.10.0 |
| package manager | pnpm 10.12.1 |
