import gifenc from 'gifenc'
import type { ApngFrame } from './apng.js'

const { GIFEncoder, applyPalette, quantize } = gifenc

export interface GifOptions {
  numPlays: number
  maxColors: number
}
export interface GifResult {
  bytes: Uint8Array
  actualDelaysMs: number[]
  warnings: string[]
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
  const pixelLength = width * height * 4
  const gif = GIFEncoder()
  const actualDelaysMs = frames.map((frame) => Math.round(frame.delayMs / 10) * 10)
  const warnings: string[] = []
  if (frames.some((frame, i) => frame.delayMs !== actualDelaysMs[i])) {
    warnings.push('GIF 延遲精度為 10 毫秒，部分影格時間已四捨五入')
  }

  frames.forEach((frame, frameIndex) => {
    if (frame.rgba.length !== pixelLength)
      throw new Error(`第 ${frameIndex + 1} 幀 RGBA 長度與尺寸不符`)
    const rgba = new Uint8Array(frame.rgba)
    let hasTransparency = false
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3]! < 128) {
        rgba[i] = 0
        rgba[i + 1] = 0
        rgba[i + 2] = 0
        rgba[i + 3] = 0
        hasTransparency = true
      } else {
        rgba[i + 3] = 255
      }
    }
    const palette = quantize(rgba, opts.maxColors, { format: 'rgba4444', oneBitAlpha: 127 })
    const indexed = applyPalette(rgba, palette, 'rgba4444')
    const transparentIndex = hasTransparency ? palette.findIndex((color) => color[3] === 0) : -1
    // gifenc 的 repeat：-1 = 只播一次、0 = 無限循環、n = 額外重播 n 次。
    // APNG 的 numPlays 是「總播放次數」，0 才是無限，所以 1 要對到 -1 而不是 0，
    // 否則使用者選「播放 1 次」會得到一個永遠在跑的 GIF。
    const repeat = opts.numPlays === 0 ? 0 : opts.numPlays === 1 ? -1 : opts.numPlays - 1
    gif.writeFrame(indexed, width, height, {
      palette,
      delay: actualDelaysMs[frameIndex],
      repeat,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
    })
  })
  gif.finish()
  return { bytes: gif.bytes(), actualDelaysMs, warnings }
}
