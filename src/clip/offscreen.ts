import { Buffer } from 'node:buffer'
import { inflateSync } from 'node:zlib'

export interface OffscreenAttribute {
  bitmapWidth: number
  bitmapHeight: number
  blockGridWidth: number
  blockGridHeight: number
  defaultFillBlackWhite: number
  packing: [number, number]
  initColor: [number, number, number, number]
}

export interface Bitmap {
  width: number
  height: number
  data: Uint8ClampedArray
}

class Reader {
  private offset = 0
  constructor(private readonly data: Buffer) {}
  u32(): number {
    if (this.offset + 4 > this.data.length) throw new Error('Offscreen Attribute 資料不完整')
    const value = this.data.readUInt32BE(this.offset)
    this.offset += 4
    return value
  }
  string(): string {
    const length = this.u32()
    const bytes = length * 2
    if (this.offset + bytes > this.data.length) throw new Error('Offscreen Attribute 字串不完整')
    const chars: number[] = []
    for (let index = 0; index < length; index += 1)
      chars.push(this.data.readUInt16BE(this.offset + index * 2))
    this.offset += bytes
    return String.fromCharCode(...chars)
  }
}

export function parseAttribute(buf: Buffer): OffscreenAttribute {
  const reader = new Reader(buf)
  const headerSize = reader.u32()
  const infoSize = reader.u32()
  const extraSize = reader.u32()
  reader.u32()
  if (headerSize !== 16 || infoSize !== 102 || (extraSize !== 42 && extraSize !== 58)) {
    throw new Error(`不支援的 Offscreen Attribute 格式：${headerSize}/${infoSize}/${extraSize}`)
  }
  if (reader.string() !== 'Parameter') throw new Error('Offscreen Attribute 缺少 Parameter')
  const bitmapWidth = reader.u32()
  const bitmapHeight = reader.u32()
  const blockGridWidth = reader.u32()
  const blockGridHeight = reader.u32()
  const attributes = Array.from({ length: 16 }, () => reader.u32())
  if (reader.string() !== 'InitColor') throw new Error('Offscreen Attribute 缺少 InitColor')
  reader.u32()
  const defaultFillBlackWhite = reader.u32()
  reader.u32()
  reader.u32()
  reader.u32()
  const initColor: [number, number, number, number] = [0, 0, 0, 0]
  if (extraSize === 58) {
    for (let channel = 0; channel < 4; channel += 1) initColor[channel] = reader.u32() >>> 24
  }
  return {
    bitmapWidth,
    bitmapHeight,
    blockGridWidth,
    blockGridHeight,
    defaultFillBlackWhite,
    packing: [attributes[1], attributes[2]],
    initColor,
  }
}

const blockStatus = Buffer.from('BlockStatus', 'utf16le').swap16()
const blockCheckSum = Buffer.from('BlockCheckSum', 'utf16le').swap16()
const blockBegin = Buffer.from('BlockDataBeginChunk', 'utf16le').swap16()
const blockEnd = Buffer.from('BlockDataEndChunk', 'utf16le').swap16()

export function parseBlockChunk(buf: Buffer): (Buffer | null)[] {
  const blocks: (Buffer | null)[] = []
  let offset = 0
  while (offset < buf.length) {
    let size: number
    if (
      buf.subarray(offset, offset + 4).equals(Buffer.from([0, 0, 0, 11])) &&
      buf.subarray(offset + 4, offset + 4 + blockStatus.length).equals(blockStatus)
    ) {
      if (offset + 34 > buf.length) throw new Error(`BlockStatus 不完整，位移 ${offset}`)
      const count = buf.readUInt32BE(offset + 30)
      size = count * 4 + 12 + 4 + blockStatus.length
    } else if (
      buf.subarray(offset, offset + 4).equals(Buffer.from([0, 0, 0, 13])) &&
      buf.subarray(offset + 4, offset + 4 + blockCheckSum.length).equals(blockCheckSum)
    ) {
      size = 4 + blockCheckSum.length + 12 + blocks.length * 4
    } else if (buf.subarray(offset + 8, offset + 8 + blockBegin.length).equals(blockBegin)) {
      if (offset + 4 > buf.length) throw new Error(`BlockData 長度不完整，位移 ${offset}`)
      size = buf.readUInt32BE(offset)
      if (size <= 0 || offset + size > buf.length)
        throw new Error(`BlockData 長度無效，位移 ${offset}`)
      const endMarker = Buffer.concat([Buffer.from([0, 0, 0, 17]), blockEnd])
      if (!buf.subarray(offset + size - endMarker.length, offset + size).equals(endMarker)) {
        throw new Error(`BlockData 結尾標記錯誤，位移 ${offset}`)
      }
      const bodyStart = offset + 8 + blockBegin.length
      const bodyEnd = offset + size - endMarker.length
      const body = buf.subarray(bodyStart, bodyEnd)
      if (body.length < 20) throw new Error(`BlockData 本體過短，位移 ${offset}`)
      const hasData = body.readUInt32BE(16)
      if (hasData === 0) blocks.push(null)
      else if (hasData === 1) {
        if (body.length < 28) throw new Error(`BlockData 壓縮標頭過短，位移 ${offset}`)
        const subblockLength = body.readUInt32BE(20)
        if (body.length !== subblockLength + 24)
          throw new Error(`BlockData 壓縮長度不符，位移 ${offset}`)
        blocks.push(body.subarray(28))
      } else throw new Error(`BlockData has_data 無效：${hasData}`)
    } else {
      throw new Error(
        `無法辨識 BlockData 子區塊，位移 ${offset}，資料 ${buf.subarray(offset, offset + 24).toString('hex')}`,
      )
    }
    if (offset + size > buf.length) throw new Error(`BlockData 子區塊超出範圍，位移 ${offset}`)
    offset += size
  }
  return blocks
}

export function decodeBitmap(attr: OffscreenAttribute, blocks: (Buffer | null)[]): Bitmap {
  const expectedBlocks = attr.blockGridWidth * attr.blockGridHeight
  if (blocks.length !== expectedBlocks)
    throw new Error(`磚塊數量不符：預期 ${expectedBlocks}，實際 ${blocks.length}`)
  const rgba = new Uint8ClampedArray(attr.bitmapWidth * attr.bitmapHeight * 4)
  if (attr.defaultFillBlackWhite) rgba.fill(255)
  const pixelsPerBlock = 256 * 256
  const color = attr.packing[0] === 1 && attr.packing[1] === 4
  const grayscale = attr.packing[0] + attr.packing[1] === 1
  if (!color && !grayscale) throw new Error(`不支援的像素 packing：${attr.packing.join(',')}`)
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const compressed = blocks[blockIndex]
    if (!compressed) continue
    let source: Buffer
    try {
      source = inflateSync(compressed)
    } catch (error) {
      console.warn(`無法解壓第 ${blockIndex} 個磚塊，已跳過`, error)
      continue
    }
    const expectedLength = color ? pixelsPerBlock * 5 : pixelsPerBlock
    if (source.length !== expectedLength) {
      console.warn(
        `第 ${blockIndex} 個磚塊長度不符：預期 ${expectedLength}，實際 ${source.length}，已跳過`,
      )
      continue
    }
    const blockX = (blockIndex % attr.blockGridWidth) * 256
    const blockY = Math.floor(blockIndex / attr.blockGridWidth) * 256
    const copyWidth = Math.min(256, attr.bitmapWidth - blockX)
    const copyHeight = Math.min(256, attr.bitmapHeight - blockY)
    for (let y = 0; y < copyHeight; y += 1) {
      for (let x = 0; x < copyWidth; x += 1) {
        const sourcePixel = y * 256 + x
        const destination = ((blockY + y) * attr.bitmapWidth + blockX + x) * 4
        if (color) {
          const bgrx = pixelsPerBlock + sourcePixel * 4
          rgba[destination] = source[bgrx + 2]
          rgba[destination + 1] = source[bgrx + 1]
          rgba[destination + 2] = source[bgrx]
          rgba[destination + 3] = source[sourcePixel]
        } else {
          const value = source[sourcePixel]
          rgba[destination] = value
          rgba[destination + 1] = value
          rgba[destination + 2] = value
          rgba[destination + 3] = 255
        }
      }
    }
  }
  return { width: attr.bitmapWidth, height: attr.bitmapHeight, data: rgba }
}
