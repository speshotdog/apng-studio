import * as gifencModule from 'gifenc'
import type { ApngFrame } from './apng.js'

/**
 * gifenc 沒有 `exports` map，兩種 build 的形狀不一樣，而且會依環境挑不同的檔：
 * - Vite（renderer）走 `module` → ESM build：有具名匯出，**default 是 GIFEncoder 本身**
 * - Node ESM（tsx 驗證腳本）走 `main` → CJS build：拿不到具名匯出，
 *   只有 default，裡面才是 `{ GIFEncoder, ... }`
 *
 * 原本寫 `import gifenc from 'gifenc'` 再解構，在主程序剛好能動，
 * 但 renderer 拿到的 default 是函式，`gifenc.GIFEncoder` 是 undefined，
 * 「上傳到 GIPHY」就會炸 `GIFEncoder is not a function`。這裡兩種都接。
 */
const gifenc = ('GIFEncoder' in gifencModule
  ? gifencModule
  : (gifencModule as unknown as { default: typeof gifencModule })
      .default) as unknown as typeof gifencModule
const { GIFEncoder, quantize } = gifenc

export interface GifOptions {
  numPlays: number
  maxColors: number
  matte?: GifMatte | null
}
export interface GifMatte {
  r: number
  g: number
  b: number
}
export interface GifResult {
  bytes: Uint8Array
  actualDelaysMs: number[]
  warnings: string[]
}

interface PreparedFrame {
  rgba: Uint8Array
  hasTransparency: boolean
}

/**
 * 不要用 gifenc 的 `applyPalette`：它查最近色的快取鍵是**降到 4-bit 的顏色**
 * （`r>>4 | g&240 | (b&240)<<4 | (a&240)<<8`），但真正算距離時用的是完整 8-bit 值。
 * 於是 [240..255]³ 之間的所有近白色共用同一個快取格 —— 該幀先掃到哪個近白色，
 * 整桶就全部套它的索引。同一個來源色在不同幀會對到不同的調色盤項，
 * 實測 254,254,254 有的幀變成 231,231,231，整片亮度跳 22 階，看起來就是「GIF 在閃」。
 *
 * 這裡自己做精確最近色映射，快取鍵用完整 32-bit RGBA，同色必定同索引。
 */
function applyPaletteExact(rgba: Uint8Array, palette: number[][]): Uint8Array {
  const packed = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length / 4)
  const out = new Uint8Array(packed.length)
  const cache = new Map<number, number>()
  for (let i = 0; i < packed.length; i += 1) {
    const key = packed[i]!
    let index = cache.get(key)
    if (index === undefined) {
      const r = rgba[i * 4]!
      const g = rgba[i * 4 + 1]!
      const b = rgba[i * 4 + 2]!
      const a = rgba[i * 4 + 3]!
      let best = 0
      let bestDistance = Infinity
      for (let p = 0; p < palette.length; p += 1) {
        const color = palette[p]!
        const da = (color[3] ?? 255) - a
        let distance = da * da
        if (distance >= bestDistance) continue
        const dr = color[0]! - r
        distance += dr * dr
        if (distance >= bestDistance) continue
        const dg = color[1]! - g
        distance += dg * dg
        if (distance >= bestDistance) continue
        const db = color[2]! - b
        distance += db * db
        if (distance >= bestDistance) continue
        bestDistance = distance
        best = p
      }
      index = best
      cache.set(key, index)
    }
    out[i] = index
  }
  return out
}

/** 把一幀的 alpha 壓成 0/255（有 matte 就先跟底色混色），順便回報這幀有沒有透明。 */
function prepareFrame(
  frame: ApngFrame,
  frameIndex: number,
  pixelLength: number,
  matte: GifMatte | null,
): PreparedFrame {
  if (frame.rgba.length !== pixelLength)
    throw new Error(`第 ${frameIndex + 1} 幀 RGBA 長度與尺寸不符`)
  const rgba = new Uint8Array(frame.rgba)
  let hasTransparency = false
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3]!
    if (alpha < (matte ? 26 : 128)) {
      rgba[i] = 0
      rgba[i + 1] = 0
      rgba[i + 2] = 0
      rgba[i + 3] = 0
      hasTransparency = true
    } else {
      if (matte) {
        const sourceWeight = alpha / 255
        const matteWeight = 1 - sourceWeight
        rgba[i] = Math.round(rgba[i]! * sourceWeight + matte.r * matteWeight)
        rgba[i + 1] = Math.round(rgba[i + 1]! * sourceWeight + matte.g * matteWeight)
        rgba[i + 2] = Math.round(rgba[i + 2]! * sourceWeight + matte.b * matteWeight)
      }
      rgba[i + 3] = 255
    }
  }
  return { rgba, hasTransparency }
}

export function encodeGif(
  frames: ApngFrame[],
  width: number,
  height: number,
  opts: GifOptions,
): GifResult {
  if (frames.length === 0) throw new Error('GIF 至少需要一幀')
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error('GIF 尺寸必須是正整數')
  if (!Number.isInteger(opts.maxColors) || opts.maxColors < 2 || opts.maxColors > 256)
    throw new Error('GIF 色彩數必須介於 2–256')
  if (!Number.isInteger(opts.numPlays) || opts.numPlays < 0)
    throw new Error('播放次數必須是非負整數')
  const matte = opts.matte ?? null
  if (
    matte &&
    ![matte.r, matte.g, matte.b].every(
      (channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255,
    )
  )
    throw new Error('GIF 邊緣底色必須是 0–255 的 RGB 整數')
  const pixelLength = width * height * 4
  const gif = GIFEncoder()
  const actualDelaysMs = frames.map((frame) => Math.round(frame.delayMs / 10) * 10)
  const warnings: string[] = []
  if (frames.some((frame, i) => frame.delayMs !== actualDelaysMs[i])) {
    warnings.push('GIF 延遲精度為 10 毫秒，部分影格時間已四捨五入')
  }

  // 調色盤只算一次、全片共用。每幀各自量化的話，就算映射是精確的，
  // 調色盤本身仍會因為幀內容不同而漂移（同一個白色在不同幀被歸到不同群心）。
  const prepared = frames.map((frame, frameIndex) =>
    prepareFrame(frame, frameIndex, pixelLength, matte),
  )
  const allRgba = new Uint8Array(pixelLength * prepared.length)
  prepared.forEach((frame, frameIndex) => allRgba.set(frame.rgba, frameIndex * pixelLength))
  const palette = quantize(allRgba, opts.maxColors, { format: 'rgba4444', oneBitAlpha: 127 })
  const transparentIndex = palette.findIndex((color) => color[3] === 0)

  // gifenc 的 repeat：-1 = 只播一次、0 = 無限循環、n = 額外重播 n 次。
  // APNG 的 numPlays 是「總播放次數」，0 才是無限，所以 1 要對到 -1 而不是 0，
  // 否則使用者選「播放 1 次」會得到一個永遠在跑的 GIF。
  const repeat = opts.numPlays === 0 ? 0 : opts.numPlays === 1 ? -1 : opts.numPlays - 1

  prepared.forEach((frame, frameIndex) => {
    const indexed = applyPaletteExact(frame.rgba, palette)
    const useTransparency = frame.hasTransparency && transparentIndex >= 0
    // 只有第一幀帶 palette，之後的幀沿用全域調色盤（gifenc 收到 palette 就會寫一份
    // 一模一樣的 Local Color Table，白白撐大檔案）。
    gif.writeFrame(indexed, width, height, {
      ...(frameIndex === 0 ? { palette } : {}),
      delay: actualDelaysMs[frameIndex],
      repeat,
      transparent: useTransparency,
      transparentIndex: useTransparency ? transparentIndex : 0,
    })
  })
  gif.finish()
  return { bytes: gif.bytes(), actualDelaysMs, warnings }
}
