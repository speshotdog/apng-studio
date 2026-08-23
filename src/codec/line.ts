import type { ApngPlan } from './apng.js'

export type ExportTarget =
  | 'sticker'
  | 'emoji'
  | 'main'
  | 'staticSticker'
  | 'plurkEmoticon'
  | 'twitchEmoteAnimated'
  | 'twitchEmoteStatic'
  | 'youtubeEmoji'
export interface ExportTargetSpec {
  label: string
  platform: 'LINE' | '噗浪' | 'Twitch' | 'YouTube'
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
  multiSize?: { width: number; height: number; suffix: string }[]
  staticOnly?: boolean
  summary: string
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
    platform: 'LINE',
    fixedSize: null,
    maxWidth: 320,
    maxHeight: 270,
    minLongSide: 270,
    maxFileBytes: 1024 * 1024,
    allowedDurationsSec: [1, 2, 3, 4],
    note: '每組可上傳 8、16 或 24 張。',
    packCounts: [8, 16, 24],
    animated: true,
    summary: '320×270（長邊 270）',
  },
  emoji: {
    ...common,
    label: '動態表情貼',
    platform: 'LINE',
    fixedSize: { width: 180, height: 180 },
    maxWidth: 180,
    maxHeight: 180,
    minLongSide: null,
    maxFileBytes: 300 * 1024,
    allowedDurationsSec: null,
    note: '每組可上傳 8–40 張。',
    packCounts: [8, 16, 24, 32, 40],
    animated: true,
    summary: '180×180',
  },
  main: {
    ...common,
    label: '主要圖片',
    platform: 'LINE',
    fixedSize: { width: 240, height: 240 },
    maxWidth: 240,
    maxHeight: 240,
    minLongSide: null,
    maxFileBytes: 1024 * 1024,
    allowedDurationsSec: [1, 2, 3, 4],
    note: '貼圖商品頁使用的主要圖片。',
    packCounts: [],
    animated: true,
    summary: '240×240',
  },
  staticSticker: {
    ...common,
    label: '一般貼圖',
    platform: 'LINE',
    fixedSize: null,
    maxWidth: 370,
    maxHeight: 320,
    minLongSide: null,
    maxFileBytes: 1024 * 1024,
    allowedDurationsSec: null,
    note: '每組可上傳 8、16、24、32 或 40 張靜態 PNG。',
    packCounts: [8, 16, 24, 32, 40],
    animated: false,
    summary: '370×320（靜態）',
  },
  plurkEmoticon: {
    minFrames: 1,
    maxFrames: Number.POSITIVE_INFINITY,
    maxTotalDurationSec: Number.POSITIVE_INFINITY,
    allowedPlayCounts: [0, 1, 2, 3, 4],
    label: '噗浪表情',
    platform: '噗浪',
    fixedSize: null,
    maxWidth: 48,
    maxHeight: 48,
    minLongSide: null,
    maxFileBytes: 256 * 1024,
    allowedDurationsSec: null,
    note: '最大 48×48；動態請使用 GIF，貼圖組張數不限並輸出資料夾。',
    packCounts: [],
    animated: true,
    summary: '48×48',
  },
  twitchEmoteAnimated: {
    minFrames: 1,
    maxFrames: 60,
    maxTotalDurationSec: Number.POSITIVE_INFINITY,
    allowedPlayCounts: [0],
    label: '動態表情',
    platform: 'Twitch',
    fixedSize: { width: 112, height: 112 },
    maxWidth: 112,
    maxHeight: 112,
    minLongSide: null,
    maxFileBytes: 1024 * 1024,
    allowedDurationsSec: null,
    note: '最多 60 幀、30 FPS、每檔 1 MB；僅 Affiliate / Partner 可上傳動態表情。',
    packCounts: [],
    animated: true,
    multiSize: [
      { width: 28, height: 28, suffix: '28' },
      { width: 56, height: 56, suffix: '56' },
      { width: 112, height: 112, suffix: '112' },
    ],
    summary: '28/56/112 三尺寸 GIF',
  },
  twitchEmoteStatic: {
    minFrames: 1,
    maxFrames: 1,
    maxTotalDurationSec: Number.POSITIVE_INFINITY,
    allowedPlayCounts: [1],
    label: '靜態表情',
    platform: 'Twitch',
    fixedSize: { width: 112, height: 112 },
    maxWidth: 112,
    maxHeight: 112,
    minLongSide: null,
    maxFileBytes: 25 * 1024,
    allowedDurationsSec: null,
    note: '三種尺寸皆需提供，每張必須小於 25 KB。',
    packCounts: [],
    animated: false,
    staticOnly: true,
    multiSize: [
      { width: 28, height: 28, suffix: '28' },
      { width: 56, height: 56, suffix: '56' },
      { width: 112, height: 112, suffix: '112' },
    ],
    summary: '28/56/112 三尺寸 PNG',
  },
  youtubeEmoji: {
    minFrames: 1,
    maxFrames: 1,
    maxTotalDurationSec: Number.POSITIVE_INFINITY,
    allowedPlayCounts: [1],
    label: '會員表情',
    platform: 'YouTube',
    fixedSize: null,
    maxWidth: 480,
    maxHeight: 480,
    minLongSide: null,
    maxFileBytes: 1024 * 1024,
    allowedDurationsSec: null,
    note: '靜態 PNG；建議 48×48，尺寸須介於 48×48 與 480×480。',
    packCounts: [],
    animated: false,
    staticOnly: true,
    summary: '48×48 靜態 PNG',
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
  format: 'apng' | 'gif' | 'png'
  byteLength?: number
  packCount?: number
}): LineIssue[] {
  const { target, width, height, plan, numPlays, format, byteLength, packCount } = input
  const spec = EXPORT_TARGETS[target]
  if (target === 'twitchEmoteAnimated') {
    const issues: LineIssue[] = []
    if (format !== 'gif') issues.push({ level: 'error', message: 'Twitch 動態表情必須使用 GIF' })
    if (plan.timelineFrameCount > 60)
      issues.push({
        level: 'error',
        message: `Twitch 動態表情最多 60 幀，目前 ${plan.timelineFrameCount} 幀`,
      })
    const fps = plan.timelineFrameCount / (plan.totalDurationMs / 1000)
    if (fps > 30)
      issues.push({ level: 'error', message: `Twitch 要求 30 FPS 以下，目前 ${number(fps)} FPS` })
    if (byteLength !== undefined && byteLength > spec.maxFileBytes)
      issues.push({ level: 'error', message: `檔案超過 Twitch 動態表情上限 1 MB` })
    return issues
  }
  if (target === 'twitchEmoteStatic') {
    const issues: LineIssue[] = []
    if (format !== 'png') issues.push({ level: 'error', message: 'Twitch 靜態表情必須使用 PNG' })
    if (byteLength !== undefined && byteLength >= spec.maxFileBytes)
      issues.push({
        level: 'error',
        message: `檔案必須小於 25 KB，目前 ${number(byteLength / 1024)} KB`,
      })
    return issues
  }
  if (target === 'youtubeEmoji') {
    const issues: LineIssue[] = []
    if (format !== 'png') issues.push({ level: 'error', message: 'YouTube 會員表情只支援靜態 PNG' })
    if (width < 48 || height < 48 || width > 480 || height > 480)
      issues.push({
        level: 'error',
        message: `YouTube 會員表情尺寸須介於 48×48 與 480×480，目前 ${width}×${height}`,
      })
    if (byteLength !== undefined && byteLength >= spec.maxFileBytes)
      issues.push({ level: 'error', message: 'YouTube 會員表情必須小於 1 MB' })
    return issues
  }
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
