import { useSyncExternalStore } from 'react'

import { tokens, type PrimaryStyle } from '../design/tokens'

// The home rebuild's candidates, awaiting the owner's choice: which font pairing, palette and
// primary button the home screen and the rules sheet draw with. Dev builds switch them from the
// chip rows on home (or a deep link, for captures); a release build only ever sees the default.
//
// The default is a placeholder until the owner chooses — today's fonts and palette, and the lit
// stone primary because it is the one that stays inside §3.1. Only home and the rules sheet read
// this; the match and every other screen draw with `tokens` directly until a choice is made.

export type Look = {
  font: keyof typeof tokens.fontCandidates
  palette: keyof typeof tokens.palettes
  primary: PrimaryStyle
  /** The idle board with or without its riding sigil tokens. */
  sigils: boolean
}

let look: Look = { font: 'current', palette: 'current', primary: 'litStone', sigils: true }
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
