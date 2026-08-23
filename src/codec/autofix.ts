import type { ExportTarget } from './line.js'
import { totalDurationMs } from './timing.js'

export interface AutoFixInput {
  target: ExportTarget
  canvasWidth: number
  canvasHeight: number
  /** 每一格實際解析後的圖層 id（null = 空白格），「延續前格」已經展開。 */
  resolvedIds: Array<number | null>
  fps: number
  playCount: number
  exportWidth: number
  exportHeight: number
  format: 'apng' | 'gif' | 'png'
}
export interface AutoFixChange {
  label: string
  from: string
  to: string
}
export interface AutoFixResult {
  /** 補幀後的影格軌；每一格都寫死圖層 id，不再依賴「延續前格」。 */
  slots: { layerId: number | null }[]
  fps: number
  playCount: number
  exportWidth: number
  exportHeight: number
  format: 'apng' | 'gif' | 'png'
  mergeIdentical: true
  changes: AutoFixChange[]
  unresolved: string[]
}

const text = (count: number): string => `${count} 格`

/**
 * 來回播放（ping-pong）補幀。
 * A B C → A B C B ｜ A B C B ｜ …，週期是 2n-2，任何相鄰兩格都不同，
 * 所以補出來的每一格都會是 APNG 的實幀，不會被「相同影格合併」吃掉。
 */
function pingPong(source: { layerId: number | null }[], length: number): typeof source {
  const period = source.length > 1 ? source.length * 2 - 2 : 1
  return Array.from({ length }, (_, index) => {
    const phase = index % period
    return { ...source[phase < source.length ? phase : period - phase]! }
  })
}

/**
 * 選一個補幀後的總格數：週期的整數倍（讓循環接得順），且落在 LINE 的 5–20 幀之間。
 * 週期本身超過 20 幀就退回截斷。
 */
function pingPongLength(sourceLength: number, minFrames: number, maxFrames: number): number | null {
  const period = sourceLength > 1 ? sourceLength * 2 - 2 : 1
  for (let length = period; length <= maxFrames; length += period)
    if (length >= minFrames) return length
  return null
}

/** LINE 只收 1/2/3/4 秒，且每格延遲必須整除得乾淨；挑最接近目前 FPS 的組合。 */
function chooseTiming(frameCount: number, currentFps: number): { fps: number; duration: number } {
  const candidates = [1, 2, 3, 4]
    .map((duration) => ({ duration, fps: frameCount / duration }))
    .filter(
      ({ duration, fps }) =>
        Number.isInteger(fps) &&
        fps >= 1 &&
        fps <= 60 &&
        totalDurationMs(frameCount, fps) === duration * 1000,
    )
  const best = candidates.sort(
    (a, b) => Math.abs(a.fps - currentFps) - Math.abs(b.fps - currentFps),
  )[0]
  // frameCount ≤ 60 時 duration=1（fps=frameCount）一定成立，所以這裡幾乎不會走到。
  return best ?? { fps: Math.max(1, Math.min(60, frameCount)), duration: 1 }
}

export function autoFixForLine(input: AutoFixInput): AutoFixResult {
  const changes: AutoFixChange[] = []
  const unresolved: string[] = []
  const source = input.resolvedIds.map((layerId) => ({ layerId }))
  if (input.target === 'twitchEmoteAnimated') {
    const slots = source.slice(0, 60)
    if (source.length > 60)
      changes.push({ label: '影格', from: text(source.length), to: '60 格（裁切超出上限）' })
    const fps = Math.min(30, input.fps)
    if (fps !== input.fps) changes.push({ label: 'FPS', from: String(input.fps), to: '30' })
    if (input.format !== 'gif') changes.push({ label: '格式', from: '非 GIF', to: 'GIF' })
    return {
      slots,
      fps,
      playCount: input.playCount,
      exportWidth: input.exportWidth,
      exportHeight: input.exportHeight,
      format: 'gif',
      mergeIdentical: true,
      changes,
      unresolved,
    }
  }

  let slots = source.slice(0, 20)
  if (source.length > 20)
    changes.push({ label: '影格', from: text(source.length), to: '20 格（裁切超出上限）' })

  const format = 'apng' as const
  if (input.format !== format) changes.push({ label: '格式', from: 'GIF', to: 'APNG' })

  let exportWidth: number
  let exportHeight: number
  if (input.target === 'emoji') [exportWidth, exportHeight] = [180, 180]
  else if (input.target === 'main') [exportWidth, exportHeight] = [240, 240]
  else {
    const max = input.target === 'staticSticker' ? [370, 320] : [320, 270]
    const ratio = Math.min(max[0]! / input.canvasWidth, max[1]! / input.canvasHeight)
    exportWidth = Math.round(input.canvasWidth * ratio)
    exportHeight = Math.round(input.canvasHeight * ratio)
  }
  if (exportWidth !== input.exportWidth || exportHeight !== input.exportHeight)
    changes.push({
      label: '尺寸',
      from: `${input.exportWidth}×${input.exportHeight}`,
      to: `${exportWidth}×${exportHeight}`,
    })

  // 相鄰重複的格子在 APNG 裡會被合併成一幀，LINE 數的是合併後的幀數，
  // 所以先壓成「真正不同的畫面」序列，那才是我們能拿來湊 5–20 幀的素材。
  const distinct = slots.filter(
    (slot, index) => index === 0 || slot.layerId !== slots[index - 1]!.layerId,
  )
  if (distinct.length <= 1) {
    unresolved.push('來源只有一種畫面，LINE 要求至少 5 個不同影格，請先在 CSP 多畫幾張')
  } else if (distinct.length >= 5) {
    // 已經夠了就不要多事，維持原本的動作順序。
    if (distinct.length !== slots.length)
      changes.push({
        label: '影格',
        from: text(source.length),
        to: `${distinct.length} 格（移除會被合併的重複格）`,
      })
    slots = distinct
  } else {
    const length = pingPongLength(distinct.length, 5, 20)!
    changes.push({
      label: '影格',
      from: text(source.length),
      to: `${length} 格（${distinct.length} 張來回播放補到 LINE 的 5 幀下限）`,
    })
    slots = pingPong(distinct, length)
  }

  const { fps, duration } = chooseTiming(slots.length, input.fps)
  if (fps !== input.fps)
    changes.push({
      label: 'FPS',
      from: String(input.fps),
      to: `${fps}（${duration} 秒）`,
    })
  const playCount = Math.max(1, Math.min(4, Math.floor(4 / duration)))
  if (playCount !== input.playCount)
    changes.push({ label: '播放次數', from: String(input.playCount), to: String(playCount) })
  return {
    slots,
    fps,
    playCount,
    exportWidth,
    exportHeight,
    format,
    mergeIdentical: true,
    changes,
    unresolved,
  }
}
