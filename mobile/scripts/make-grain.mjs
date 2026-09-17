// Generates assets/grain.png: a 128x128 8-bit greyscale per-pixel noise tile.
//
// Standard library only, and no dependency is added to package.json for this. The PNG is
// committed, so this script only needs to run again if the grain itself should change.
// The PRNG is seeded, so re-running it reproduces the committed file byte for byte.
//
//   node scripts/make-grain.mjs

import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'

const SIZE = 128
const SEED = 0x5265_7a74 // "Rezt"

// mulberry32 — small, seeded, and good enough for visual noise.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

const random = mulberry32(SEED)

// One filter byte (0 = none) per scanline, then one grey byte per pixel.
const raw = Buffer.alloc((SIZE + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE + 1)
  raw[rowStart] = 0
  for (let x = 0; x < SIZE; x++) {
    raw[rowStart + 1 + x] = Math.floor(random() * 256)
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 0 // colour type: greyscale
ihdr[10] = 0 // deflate
ihdr[11] = 0 // adaptive filtering
ihdr[12] = 0 // no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

writeFileSync(new URL('../assets/grain.png', import.meta.url), png)
console.log(`assets/grain.png  ${SIZE}x${SIZE}  ${png.length} bytes`)
