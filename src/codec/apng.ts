import { deflateSync } from 'node:zlib'
import { chunk, filterScanlines } from './png.js'

export interface ApngFrame {
  rgba: Uint8Array
  delayMs: number
}
export interface ApngOptions {
  numPlays: number
  mergeIdentical: boolean
}
export interface ApngPlan {
  frames: { sourceIndices: number[]; delayMs: number }[]
  timelineFrameCount: number
  actualFrameCount: number
  totalDurationMs: number
  allIdentical: boolean
  /** LINE 背景透明度檢查所需；不參與編碼計畫。 */
  firstFrameRgba?: Uint8Array
}
export interface ApngInfo {
  width: number
  height: number
  numFrames: number
  numPlays: number
  delaysMs: number[]
  byteLength: number
}

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

function equalRgba(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 64) if (a[i] !== b[i]) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function validateFrame(frame: ApngFrame, index: number): void {
  if (
    !Number.isFinite(frame.delayMs) ||
    !Number.isInteger(frame.delayMs) ||
    frame.delayMs < 0 ||
    frame.delayMs > 0xffff
  ) {
    throw new Error(`第 ${index + 1} 幀延遲必須是 0–65535 的整數毫秒`)
  }
}

export function planApng(frames: ApngFrame[], opts: ApngOptions): ApngPlan {
  if (frames.length === 0) throw new Error('APNG 至少需要一幀')
  frames.forEach(validateFrame)
  const planned: ApngPlan['frames'] = []

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!
    const previous = i > 0 ? frames[i - 1]! : undefined
    if (opts.mergeIdentical && previous && equalRgba(previous.rgba, frame.rgba)) {
      const target = planned[planned.length - 1]!
      target.sourceIndices.push(i)
      target.delayMs += frame.delayMs
      if (target.delayMs > 0xffff) throw new Error('合併後的單幀延遲超過 APNG 可表示的 65535 毫秒')
    } else {
      planned.push({ sourceIndices: [i], delayMs: frame.delayMs })
    }
  }

  const allIdentical = frames.every((frame) => equalRgba(frames[0]!.rgba, frame.rgba))
  return {
    frames: planned,
    timelineFrameCount: frames.length,
    actualFrameCount: planned.length,
    totalDurationMs: frames.reduce((sum, frame) => sum + frame.delayMs, 0),
    allIdentical,
    firstFrameRgba: frames[0]!.rgba,
  }
}

function u32(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setUint32(index * 4, value))
  return bytes
}

function frameControl(
  sequence: number,
  width: number,
  height: number,
  delayMs: number,
): Uint8Array {
  const data = new Uint8Array(26)
  const view = new DataView(data.buffer)
  view.setUint32(0, sequence)
  view.setUint32(4, width)
  view.setUint32(8, height)
  view.setUint32(12, 0)
  view.setUint32(16, 0)
  view.setUint16(20, delayMs)
  view.setUint16(22, 1000)
  data[24] = 0
  data[25] = 0
  return data
}

function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

export function encodeApng(
  frames: ApngFrame[],
  width: number,
  height: number,
  opts: ApngOptions,
): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error('APNG 尺寸必須是正整數')
  if (!Number.isInteger(opts.numPlays) || opts.numPlays < 0 || opts.numPlays > 0xffffffff)
    throw new Error('播放次數必須是非負整數')
  const expectedLength = width * height * 4
  frames.forEach((frame, index) => {
    if (frame.rgba.length !== expectedLength)
      throw new Error(`第 ${index + 1} 幀 RGBA 長度與尺寸不符`)
  })
  const plan = planApng(frames, opts)
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const parts = [
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('acTL', u32(plan.actualFrameCount, opts.numPlays)),
  ]
  let sequence = 0

  plan.frames.forEach((planned, index) => {
    parts.push(chunk('fcTL', frameControl(sequence++, width, height, planned.delayMs)))
    const rgba = frames[planned.sourceIndices[0]!]!.rgba
    const compressed = new Uint8Array(
      deflateSync(filterScanlines(rgba, width, height), { level: 9 }),
    )
    parts.push(
      index === 0
        ? chunk('IDAT', compressed)
        : chunk('fdAT', concat([u32(sequence++), compressed])),
    )
  })
  parts.push(chunk('IEND', new Uint8Array()))
  const bytes = concat(parts)
  const info = verifyApng(bytes)
  if (
    info.numFrames !== plan.actualFrameCount ||
    info.numPlays !== opts.numPlays ||
    info.delaysMs.length !== plan.frames.length ||
    info.delaysMs.some((delay, i) => delay !== plan.frames[i]!.delayMs)
  ) {
    throw new Error('APNG 自我驗證失敗：幀數、播放次數或延遲與編碼計畫不符')
  }
  return bytes
}

export function verifyApng(bytes: Uint8Array): ApngInfo {
  if (bytes.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((byte, i) => bytes[i] === byte))
    throw new Error('不是有效的 PNG 檔案')
  let offset = 8
  let width: number | undefined
  let height: number | undefined
  let numFrames: number | undefined
  let numPlays: number | undefined
  const delaysMs: number[] = []
  let ended = false

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('PNG chunk 標頭不完整')
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset)
    const length = view.getUint32(0)
    if (offset + 12 + length > bytes.length) throw new Error('PNG chunk 資料不完整')
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const dataOffset = offset + 8
    const data = new DataView(bytes.buffer, bytes.byteOffset + dataOffset, length)
    if (type === 'IHDR') {
      if (length !== 13) throw new Error('IHDR 長度錯誤')
      width = data.getUint32(0)
      height = data.getUint32(4)
    } else if (type === 'acTL') {
      if (length !== 8) throw new Error('acTL 長度錯誤')
      numFrames = data.getUint32(0)
      numPlays = data.getUint32(4)
    } else if (type === 'fcTL') {
      if (length !== 26) throw new Error('fcTL 長度錯誤')
      const numerator = data.getUint16(20)
      const denominator = data.getUint16(22) || 100
      delaysMs.push((numerator * 1000) / denominator)
    } else if (type === 'IEND') {
      ended = true
      offset += 12 + length
      break
    }
    offset += 12 + length
  }
  if (!ended || offset !== bytes.length) throw new Error('PNG 缺少有效的 IEND')
  if (
    width === undefined ||
    height === undefined ||
    numFrames === undefined ||
    numPlays === undefined
  )
    throw new Error('缺少 APNG 必要 chunk')
  if (delaysMs.length !== numFrames)
    throw new Error(`acTL 宣告 ${numFrames} 幀，但找到 ${delaysMs.length} 個 fcTL`)
  return { width, height, numFrames, numPlays, delaysMs, byteLength: bytes.length }
}
