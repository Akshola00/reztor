import { useSyncExternalStore } from 'react'

import type { PrimaryStyle } from '../design/tokens'

// The home rebuild's open candidates: which primary button home draws, and whether the idle board
// carries its sigil tokens, and whether seats wear masks or the old geometric sigils. Dev builds switch them from the chip rows on home (or a deep link, for
// captures); a release build only ever sees the default. Fonts and palette are decided and live in
// `tokens`.

export type Look = {
  primary: PrimaryStyle
  /** The idle board with or without its riding sigil tokens. */
  sigils: boolean
  /** Every seat's identity mark: the carved masks, or the geometric sigils they replaced. */
  marks: 'masks' | 'geometric'
}

let look: Look = { primary: 'flame', sigils: true, marks: 'masks' }
const listeners = new Set<() => void>()

export const looks = {
  get: () => look,
  set(next: Partial<Look>) {
    look = { ...look, ...next }
    listeners.forEach((listener) => listener())
  },
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useLook(): Look {
  return useSyncExternalStore(subscribe, looks.get)
}
