// The Grenze clipping fix. Android measures a Text, Yoga rounds its box to the pixel grid, and the
// text is then laid out again to draw — and for some strings in Grenze Gotisch the drawing needs a
// fraction of a pixel more than the box it was given. The last word then wraps onto a second line
// the box has no room for, and vanishes: "You won" drew as "You", "voted for" as "voted". It is
// deterministic for a given string, size and position, which is why it struck only some strings.
//
// A trailing hair space is the slack. It is measured with the string, so the box grows by about a
// pixel; and trailing whitespace hangs past the end of a line rather than forcing a break, so when
// the drawing needs that pixel the words still fit. It is invisible and screen readers ignore it.
// Found and checked on the emulator in the clipping sweep: "You lost" clipped in three cold starts
// out of three at every Grenze step without it, and never with it.
//
// Use it on any Grenze string whose box is sized to its own content — names, control labels,
// headings in a row. A string in a box stretched wider than it needs is already safe.
//
// The lasting fix is React Native's `enablePreparedTextLayout` feature flag, which draws with the
// layout it measured; it is off by default in 0.86 and needs a native config change.

const HAIR_SPACE = ' '

export function fit(text: string): string {
  return text + HAIR_SPACE
}
