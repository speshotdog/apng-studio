import type { Bitmap } from '../clip/offscreen.js'
import type { CspTimeline, CspTimelineGroup } from '../clip/timeline.js'

export type { Bitmap }

/** 各種來源檔（.clip／.procreate／.psd）共用的圖層節點。 */
export interface SourceLayer {
  id: number
  name: string
  /** 沿用 CSP 的編碼：1584 = 資料夾。UI 靠這個決定要不要抓縮圖。 */
  type: number
  isFolder: boolean
  isAnimationFolder: boolean
  visible: boolean
  opacity: number
  children: SourceLayer[]
}

export interface SourceDocument {
  canvas: { width: number; height: number; resolution: number }
  root: SourceLayer
  flat: Map<number, SourceLayer>
  timeline: { frameRate: number; startFrame: number; endFrame: number; name: string } | null
  cspTimelines: CspTimeline[]
  cspTimelineGroups: CspTimelineGroup[]
  renderNode(layerId: number, overrides?: Map<number, boolean>): Bitmap
}

export const FOLDER_TYPE = 1584

export function blank(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

/** 一般 alpha-over 合成；source 疊在 target 上。 */
export function compositeOver(
  target: Uint8ClampedArray,
  source: Uint8ClampedArray,
  opacity: number,
): void {
  for (let index = 0; index < target.length; index += 4) {
    const sourceAlpha = (source[index + 3]! / 255) * opacity
    if (sourceAlpha === 0) continue
    const targetAlpha = target[index + 3]! / 255
    const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha)
    for (let channel = 0; channel < 3; channel += 1) {
      target[index + channel] = Math.round(
        (source[index + channel]! * sourceAlpha +
          target[index + channel]! * targetAlpha * (1 - sourceAlpha)) /
          outputAlpha,
      )
    }
    target[index + 3] = Math.round(outputAlpha * 255)
  }
}
