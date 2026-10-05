import { useSyncExternalStore } from 'react'

import type { PrimaryStyle } from '../design/tokens'

// The home rebuild's open candidates: which primary button home draws, and whether the idle board
// carries its sigil tokens. Dev builds switch them from the chip rows on home (or a deep link, for
// captures); a release build only ever sees the default. Fonts and palette are decided and live in
// `tokens`.

export type Look = {
  primary: PrimaryStyle
  /** The idle board with or without its riding sigil tokens. */
  sigils: boolean
}

let look: Look = { primary: 'flame', sigils: true }
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
