import type { ApngPlan } from './apng.js'

export type ExportTarget = 'sticker' | 'emoji' | 'main' | 'staticSticker' | 'plurkEmoticon'
export interface ExportTargetSpec {
  label: string
  fixedSize: { width: number; height: number } | null
  maxWidth: number
  maxHeight: number
  minLongSide: number | null
  maxFileBytes: number
  minFrames: number
  maxFrames: number
  allowedDurationsSec: number[] | null
  maxTotalDurationSec: number
  allowedPlayCounts: number[]
  note: string
  packCounts: number[]
  animated: boolean
}
const common = {
  minFrames: 5,
  maxFrames: 20,
  maxTotalDurationSec: 4,
  allowedPlayCounts: [1, 2, 3, 4],
}
export const EXPORT_TARGETS: Record<ExportTarget, ExportTargetSpec> = {
  sticker: {
    ...common,
    label: '動態貼圖',
    fixedSize: null,
    maxWidth: 320,
    maxHeight: 270,
    minLongSide: 270,
    maxFileBytes: 1024 * 1024,
    allowedDurationsSec: [1, 2, 3, 4],
    note: '每組可上傳 8、16 或 24 張。',
    packCounts: [8, 16, 24],
    animated: true,
  },
  emoji: {
    ...common,
    label: '動態表情貼',
    fixedSize: { width: 180, height: 180 },
    maxWidth: 180,
    maxHeight: 180,
    minLongSide: null,
    maxFileBytes: 300 * 1024,
    allowedDurationsSec: null,
    note: '每組可上傳 8–40 張。',
    packCounts: [8, 16, 24, 32, 40],
    animated: true,
  },
  main: {
    ...common,
    label: '主要圖片',
    fixedSize: { width: 240, height: 240 },
    maxWidth: 240,
    maxHeight: 240,
    minLongSide: null,
    maxFileBytes: 1024 * 1024,
    allowedDurationsSec: [1, 2, 3, 4],
    note: '貼圖商品頁使用的主要圖片。',
    packCounts: [],
    animated: true,
  },
  staticSticker: {
    ...common,
    label: '一般貼圖',
    fixedSize: null,
    maxWidth: 370,
    maxHeight: 320,
    minLongSide: null,
    maxFileBytes: 1024 * 1024,
    allowedDurationsSec: null,
    note: '每組可上傳 8、16、24、32 或 40 張靜態 PNG。',
    packCounts: [8, 16, 24, 32, 40],
    animated: false,
  },
  plurkEmoticon: {
    minFrames: 1,
    maxFrames: Number.POSITIVE_INFINITY,
    maxTotalDurationSec: Number.POSITIVE_INFINITY,
    allowedPlayCounts: [0, 1, 2, 3, 4],
    label: '噗浪表情',
    fixedSize: null,
    maxWidth: 48,
    maxHeight: 48,
    minLongSide: null,
    maxFileBytes: 256 * 1024,
    allowedDurationsSec: null,
    note: '最大 48×48；動態請使用 GIF，貼圖組張數不限並輸出資料夾。',
    packCounts: [],
    animated: true,
  },
}
export const LINE_TARGETS = EXPORT_TARGETS
export const LINE_CHAT_THUMB = { width: 96, height: 74 } as const
export const LINE_SPEC = EXPORT_TARGETS.sticker
export type IssueLevel = 'error' | 'warning' | 'info'
export interface LineIssue {
  level: IssueLevel
  message: string
}
const number = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)

export function validateForLine(input: {
  target: ExportTarget
  width: number
  height: number
  plan: ApngPlan
  numPlays: number
  format: 'apng' | 'gif'
  byteLength?: number
  packCount?: number
}): LineIssue[] {
  const { target, width, height, plan, numPlays, format, byteLength, packCount } = input
  const spec = EXPORT_TARGETS[target]
  if (target === 'plurkEmoticon') {
    const issues: LineIssue[] = []
    if (width > 48 || height > 48)
      issues.push({ level: 'error', message: `尺寸 ${width}×${height} 超過噗浪表情上限 48×48` })
    if (format === 'apng') issues.push({ level: 'error', message: '噗浪不支援 APNG，請改用 GIF' })
    if (byteLength !== undefined && byteLength >= spec.maxFileBytes)
      issues.push({
        level: 'error',
        message: `檔案 ${number(byteLength / 1024)} KB，噗浪表情必須小於 256 KB`,
      })
    return issues
  }
  if (format === 'gif')
    return [{ level: 'info', message: 'LINE 只接受 APNG，GIF 不適用 LINE 規格檢查' }]
  const issues: LineIssue[] = []
  const add = (level: IssueLevel, message: string): void => {
    issues.push({ level, message })
  }
  if (spec.fixedSize) {
    if (width !== spec.fixedSize.width || height !== spec.fixedSize.height)
      add(
        'error',
        `${spec.label}必須是 ${spec.fixedSize.width}×${spec.fixedSize.height}，目前 ${width}×${height}`,
      )
  } else {
    if (width > spec.maxWidth || height > spec.maxHeight)
      add(
        'error',
        `尺寸 ${width}×${height} 超過${spec.label}上限 ${spec.maxWidth}×${spec.maxHeight}`,
      )
    if (spec.minLongSide !== null && width < spec.minLongSide && height < spec.minLongSide)
      add('error', `寬高至少要有一邊達到 ${spec.minLongSide}px（目前 ${width}×${height}）`)
  }
  if (target === 'staticSticker') {
    if (width % 2 || height % 2) add('warning', `一般貼圖尺寸需為偶數（目前 ${width}×${height}）`)
    if (packCount !== undefined && !spec.packCounts.includes(packCount))
      add('error', `一般貼圖張數只接受 ${spec.packCounts.join('、')} 張（目前 ${packCount} 張）`)
    return issues
  }
  if (plan.actualFrameCount < spec.minFrames)
    add(
      'error',
      `實際 APNG 幀數只有 ${plan.actualFrameCount}（時間軸 ${plan.timelineFrameCount} 格，其中相同影格已合併）；LINE 要求 ${spec.minFrames}–${spec.maxFrames} 幀`,
    )
  else if (plan.actualFrameCount > spec.maxFrames)
    add('error', `實際 APNG 幀數 ${plan.actualFrameCount}，超過 LINE 上限 ${spec.maxFrames} 幀`)
  if (plan.allIdentical) add('error', '所有影格內容完全相同，LINE 會拒絕上傳')
  const durationSec = plan.totalDurationMs / 1000
  if (spec.allowedDurationsSec && !spec.allowedDurationsSec.includes(durationSec))
    add('warning', `單次播放 ${number(durationSec)} 秒，LINE 只接受 1、2、3、4 秒`)
  if (!spec.allowedPlayCounts.includes(numPlays))
    add('error', `播放次數 ${numPlays} 不符合 LINE 要求的 1、2、3、4 次`)
  if (durationSec * numPlays > spec.maxTotalDurationSec)
    add(
      'error',
      `總播放 ${number(durationSec)} 秒 × ${numPlays} 次 = ${number(durationSec * numPlays)} 秒，超過 LINE 上限 4 秒`,
    )
  if (byteLength !== undefined && byteLength > spec.maxFileBytes)
    add(
      'error',
      `檔案 ${number(byteLength / 1024)} KB 超過${spec.label}上限 ${number(spec.maxFileBytes / 1024)} KB`,
    )
  const rgba = plan.firstFrameRgba
  if (rgba && rgba.length === width * height * 4) {
    const corners = [3, (width - 1) * 4 + 3, (height - 1) * width * 4 + 3, width * height * 4 - 1]
    if (corners.every((index) => rgba[index] === 255))
      add('warning', '背景看起來不是透明的，LINE 要求透明背景')
  }
  return issues
}
