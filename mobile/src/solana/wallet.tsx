import { MobileWalletProvider } from '@wallet-ui/react-native-kit'
import type { ReactNode } from 'react'

import { CLUSTER, IDENTITY } from './chain'

// Mobile Wallet Adapter through Wallet UI. The authorization is cached in AsyncStorage by the
// provider, so a connected wallet stays connected across launches. Wallet state is not game state:
// nothing in src/state or the match store knows a wallet exists.

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <MobileWalletProvider cluster={CLUSTER} identity={IDENTITY}>
      {children}
    </MobileWalletProvider>
  )
}
