// Generates assets/splash.png: a 1x1 fully transparent PNG.
//
// Standard library only, and no dependency is added to package.json for this.
//
// Why this file exists: expo-splash-screen's Android config plugin writes
// `windowSplashScreenAnimatedIcon = @drawable/splashscreen_logo` into styles.xml
// unconditionally, but only creates that drawable when an `image` is configured. Supplying
// `backgroundColor` alone therefore fails resource linking with
// "resource drawable/splashscreen_logo not found". A transparent image satisfies the linker
// while keeping the splash a flat --void field with no artwork on it.
//
//   node scripts/make-splash.mjs
//
// See: expo-splash-screen/plugin/build/withAndroidSplashStyles.js (addSplashScreenStyle).

import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'

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

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(1, 0) // width
ihdr.writeUInt32BE(1, 4) // height
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // colour type: RGBA
ihdr[10] = 0 // deflate
ihdr[11] = 0 // adaptive filtering
ihdr[12] = 0 // no interlace

// One filter byte (0 = none), then RGBA all zeros: transparent black.
const raw = Buffer.from([0, 0, 0, 0, 0])

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

writeFileSync(new URL('../assets/splash.png', import.meta.url), png)
console.log(`assets/splash.png  1x1 transparent  ${png.length} bytes`)
