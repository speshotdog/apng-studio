import type { ApngPlan } from './apng.js'

export const LINE_SPEC = {
  maxWidth: 320,
  maxHeight: 270,
  minLongSide: 270,
  mainImage: { width: 240, height: 240 },
  chatThumb: { width: 96, height: 74 },
  minFrames: 5,
  maxFrames: 20,
  allowedDurationsSec: [1, 2, 3, 4],
  allowedPlayCounts: [1, 2, 3, 4],
  maxTotalDurationSec: 4,
  maxFileBytes: 1024 * 1024,
} as const

export type IssueLevel = 'error' | 'warning'
export interface LineIssue {
  level: IssueLevel
  message: string
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

export function validateForLine(input: {
  width: number
  height: number
  plan: ApngPlan
  numPlays: number
  byteLength?: number
}): LineIssue[] {
  const issues: LineIssue[] = []
  const add = (level: IssueLevel, message: string): void => {
    issues.push({ level, message })
  }
  const { width, height, plan, numPlays, byteLength } = input

  if (width > LINE_SPEC.maxWidth || height > LINE_SPEC.maxHeight)
    add('error', `尺寸 ${width}×${height} 超過 LINE 上限 320×270`)
  if (width < LINE_SPEC.minLongSide && height < LINE_SPEC.minLongSide)
    add('error', `寬高至少要有一邊達到 270px（目前 ${width}×${height}）`)
  if (plan.actualFrameCount < LINE_SPEC.minFrames) {
    add(
      'error',
      `實際 APNG 幀數只有 ${plan.actualFrameCount}（時間軸 ${plan.timelineFrameCount} 格，其中相同影格已合併）；LINE 要求 5–20 幀`,
    )
  } else if (plan.actualFrameCount > LINE_SPEC.maxFrames) {
    add('error', `實際 APNG 幀數 ${plan.actualFrameCount}，超過 LINE 上限 20 幀`)
  }
  if (plan.allIdentical) add('error', '所有影格內容完全相同，LINE 會拒絕上傳')
  const durationSec = plan.totalDurationMs / 1000
  if (!(LINE_SPEC.allowedDurationsSec as readonly number[]).includes(durationSec)) {
    add('warning', `單次播放 ${formatNumber(durationSec)} 秒，LINE 只接受 1、2、3、4 秒`)
  }
  if (!(LINE_SPEC.allowedPlayCounts as readonly number[]).includes(numPlays)) {
    add('error', `播放次數 ${numPlays} 不符合 LINE 要求的 1、2、3、4 次`)
  }
  if (durationSec * numPlays > LINE_SPEC.maxTotalDurationSec) {
    add(
      'error',
      `總播放 ${formatNumber(durationSec)} 秒 × ${numPlays} 次 = ${formatNumber(durationSec * numPlays)} 秒，超過 LINE 上限 4 秒`,
    )
  }
  if (byteLength !== undefined && byteLength > LINE_SPEC.maxFileBytes) {
    add('error', `檔案 ${formatNumber(byteLength / 1024 / 1024)} MB 超過 LINE 上限 1 MB`)
  }
  const rgba = plan.firstFrameRgba
  if (rgba && rgba.length === width * height * 4) {
    const cornerAlphas = [
      3,
      (width - 1) * 4 + 3,
      (height - 1) * width * 4 + 3,
      (width * height - 1) * 4 + 3,
    ]
    if (cornerAlphas.every((index) => rgba[index] === 255))
      add('warning', '背景看起來不是透明的，LINE 要求透明背景')
  }
  return issues
}
