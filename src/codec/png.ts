const CRC_TABLE = new Uint32Array(256)

for (let n = 0; n < 256; n++) {
  let value = n
  for (let bit = 0; bit < 8; bit++) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC_TABLE[n] = value >>> 0
}

export function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value)
}

export function chunk(type: string, data: Uint8Array): Uint8Array {
  if (!/^[\x20-\x7e]{4}$/.test(type))
    throw new Error(`PNG chunk 類型必須是 4 個 ASCII 字元：${type}`)
  const output = new Uint8Array(12 + data.length)
  writeU32(output, 0, data.length)
  for (let i = 0; i < 4; i++) output[4 + i] = type.charCodeAt(i)
  output.set(data, 8)
  writeU32(output, 8 + data.length, crc32(output.subarray(4, 8 + data.length)))
  return output
}

export function filterScanlines(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const rowBytes = w * 4
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w <= 0 ||
    h <= 0 ||
    rgba.length !== rowBytes * h
  ) {
    throw new Error(`RGBA 資料長度 ${rgba.length} 與尺寸 ${w}×${h} 不符`)
  }

  const output = new Uint8Array((rowBytes + 1) * h)
  for (let y = 0; y < h; y++) {
    const inputOffset = y * rowBytes
    const outputOffset = y * (rowBytes + 1)
    output[outputOffset] = 1
    for (let x = 0; x < rowBytes; x++) {
      const left = x >= 4 ? rgba[inputOffset + x - 4]! : 0
      output[outputOffset + x + 1] = (rgba[inputOffset + x]! - left) & 0xff
    }
  }
  return output
}

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  writeU32(ihdr, 0, width)
  writeU32(ihdr, 4, height)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const parts = [
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filterScanlines(rgba, width, height), { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ]
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}
import { deflateSync } from 'node:zlib'
