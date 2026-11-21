// Draws the app icon (open book on a teal square) as PNGs without dependencies.
import { deflateSync, crc32 } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const BG = [0x2f, 0x6f, 0x5e]
const PAGE = [0xf7, 0xf5, 0xf0]
const LINE = [0xc9, 0xc3, 0xb5]

function shade(x, y, maskable) {
  // coordinates in 0..1; returns [r,g,b,a]
  const pad = maskable ? 0 : 0.04
  const r = maskable ? 0 : 0.2
  const inSquare = (() => {
    const lo = pad, hi = 1 - pad
    if (x < lo || x > hi || y < lo || y > hi) return false
    const cx = Math.min(Math.max(x, lo + r), hi - r)
    const cy = Math.min(Math.max(y, lo + r), hi - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1e-9
  })()
  if (!inSquare) return [0, 0, 0, 0]
  const s = maskable ? 0.62 : 0.72 // book size
  const bx = (x - 0.5) / s
  const by = (y - 0.52) / s
  // two pages: left and right, slightly tilted top edges
  const halfW = 0.46, halfH = 0.3
  const inBook = Math.abs(bx) <= halfW && by <= halfH && by >= -halfH + Math.abs(bx) * 0.18
  if (inBook) {
    if (Math.abs(bx) < 0.012) return [...BG, 255] // spine
    const lineY = (by + halfH) / (2 * halfH)
    const tx = Math.abs(bx)
    for (let k = 1; k <= 4; k++) {
      const ly = -halfH + Math.abs(bx) * 0.18 + k * 0.11
      if (Math.abs(by - ly) < 0.012 && tx > 0.08 && tx < 0.38 && lineY < 0.95) return [...LINE, 255]
    }
    return [...PAGE, 255]
  }
  return [...BG, 255]
}

function png(size, maskable) {
  const SS = 4
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0]
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, maskable)
          acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3]
        }
      const o = py * (size * 4 + 1) + 1 + px * 4
      const a = acc[3] / (SS * SS)
      raw[o] = a ? acc[0] / acc[3] : 0
      raw[o + 1] = a ? acc[1] / acc[3] : 0
      raw[o + 2] = a ? acc[2] / acc[3] : 0
      raw[o + 3] = a
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

writeFileSync('public/icon-192.png', png(192, false))
writeFileSync('public/icon-512.png', png(512, false))
writeFileSync('public/icon-maskable-512.png', png(512, true))
console.log('Icons geschrieben')
