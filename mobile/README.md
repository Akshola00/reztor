# reztor

The Android client for Reztor, a four-player social deduction game. Expo + React Native.

See `CLAUDE.md` for the stack and conventions, `BUILD-PLAN.md` for scope and build order,
`reztor-design.md` for anything visible, and `../docs/PROTOCOL.md` for the server contract.

## Technologies

- [Expo](https://expo.dev)
- [react-native-svg](https://github.com/software-mansion/react-native-svg) — all game art
- [react-native-reanimated](https://docs.swmansion.com/react-native-reanimated/) — all animation
- [@solana/kit](https://www.solanakit.com/) and
  [@wallet-ui/react-native-kit](https://wallet-ui.dev/) — wallet connect (Mobile Wallet
  Adapter) and stake signing against the Reztor Anchor program on Solana devnet
  (`4hAFR3JFKmE5GkJFDSVUHB1LwcsZkQBszCq9kwFu5MHZ`). Code in `src/solana/`; wire changes in
  `../docs/CHAIN-PROTOCOL-CHANGES.md`

This package uses **pnpm**. Do not install from the repository root.

## Get started

1. Install dependencies

   ```bash
   pnpm install
   ```

2. Build and launch the development build

   ```bash
   pnpm run android
   ```

   **Expo Go does not work on this project.** Mobile Wallet Adapter uses Kotlin native
   modules, so a custom development build is required. Once one is installed, `pnpm run dev`
   starts Metro against it.

## Checks

```bash
pnpm run typecheck    # tsc --noEmit
pnpm run lint
pnpm run doctor       # after any dependency change
```

## Learn more

- [Expo documentation](https://docs.expo.dev/)
- [Expo Router](https://docs.expo.dev/router/introduction) — routes live in `src/app`
