import type { ExportTarget } from './line.js'

export interface AutoFixInput {
  target: ExportTarget
  canvasWidth: number
  canvasHeight: number
  slots: { layerId: number | null }[]
  fps: number
  playCount: number
  exportWidth: number
  exportHeight: number
  format: 'apng' | 'gif' | 'png'
  identicalToPrev: boolean[]
}
export interface AutoFixChange {
  label: string
  from: string
  to: string
}
export interface AutoFixResult {
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

const text = (slots: { layerId: number | null }[]): string => `${slots.length} 格`

export function autoFixForLine(input: AutoFixInput): AutoFixResult {
  const changes: AutoFixChange[] = []
  const unresolved: string[] = []
  const twitch = input.target === 'twitchEmoteAnimated'
  let slots = input.slots.slice(0, twitch ? 60 : 20).map((slot) => ({ ...slot }))
  if (twitch) {
    if (input.slots.length > 60)
      changes.push({ label: '影格', from: text(input.slots), to: '60 格（裁切超出上限）' })
    const fps = Math.min(30, input.fps)
    if (fps !== input.fps) changes.push({ label: 'FPS', from: String(input.fps), to: '30' })
    return { ...input, slots, fps, format: 'gif', mergeIdentical: true, changes, unresolved }
  }
  if (input.slots.length > 20)
    changes.push({ label: '影格', from: text(input.slots), to: '20 格（裁切超出上限）' })

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

  const identities = input.identicalToPrev
  const uniqueCount = slots.reduce(
    (count, _slot, index) => count + (index === 0 || !identities[index] ? 1 : 0),
    0,
  )
  if (uniqueCount <= 1) {
    unresolved.push('來源只有一種畫面，LINE 要求至少 5 個不同影格，請先在 CSP 多畫幾張')
  } else if (uniqueCount < 5) {
    const original = slots.map((slot) => ({ ...slot }))
    const interior =
      original.length > 2 ? original.slice(1, -1).reverse() : original.slice().reverse()
    let cursor = 0
    while (slots.length < 5 && slots.length < 20) {
      const candidate = interior[cursor++ % interior.length]!
      if (candidate.layerId !== slots.at(-1)?.layerId) slots.push({ ...candidate })
    }
    // Four frames need the full visual return, as specified: A B C D C B.
    if (original.length > 2)
      while (slots.length < Math.min(20, original.length + interior.length)) {
        const candidate = interior[cursor++ % interior.length]!
        if (candidate.layerId !== slots.at(-1)?.layerId) slots.push({ ...candidate })
      }
    changes.push({ label: '影格', from: text(original), to: `${slots.length} 格（來回播放）` })
  }

  const candidates = [1, 2, 3, 4]
    .map((duration) => ({ duration, fps: slots.length / duration }))
    .filter(({ fps }) => Number.isInteger(fps) && fps >= 1 && fps <= 60)
  let choice = candidates.sort(
    (a, b) => Math.abs(a.fps - input.fps) - Math.abs(b.fps - input.fps),
  )[0]
  if (!choice) {
    choice = [1, 2, 3, 4]
      .map((duration) => ({
        duration,
        fps: Math.max(1, Math.min(60, Math.round(slots.length / duration))),
      }))
      .sort(
        (a, b) =>
          Math.abs(slots.length / a.fps - a.duration) - Math.abs(slots.length / b.fps - b.duration),
      )[0]!
  }
  const fps = choice.fps
  const duration = slots.length / fps
  if (fps !== input.fps)
    changes.push({
      label: 'FPS',
      from: String(input.fps),
      to: `${fps}（${duration.toFixed(2)} 秒）`,
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
