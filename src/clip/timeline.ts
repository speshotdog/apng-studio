import { inflateSync } from 'node:zlib'
import type { Database } from 'sql.js'
import { parseBinc, type BincNode } from './binc.js'
import { queryRows } from './db.js'

export interface CelKey {
  frame: number
  celName: string
}
export interface CspTimeline {
  animationFolderId: number
  animationFolderName: string
  frameRate: number
  frameCount: number
  keys: CelKey[]
  warnings: string[]
}
export interface CspTimelineGroup {
  name: string
  frameRate: number
  startFrame: number
  endFrame: number
  tracks: CspTimeline[]
}

function numberValue(row: Record<string, unknown>, key: string): number {
  return typeof row[key] === 'number' ? row[key] : 0
}
function textValue(value: unknown): string {
  if (typeof value === 'string') return value
  return value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : ''
}
function findAll(node: BincNode, name: string): BincNode[] {
  const results = node.name === name ? [node] : []
  for (const child of node.children) {
    results.push(...findAll(child, name))
  }
  return results
}
function findCurve(node: BincNode): BincNode | undefined {
  if (node.name === 'FCurve' && node.attrs.Type === 'ImageCelName') return node
  for (const child of node.children) {
    const result = findCurve(child)
    if (result) return result
  }
  return undefined
}
function childNumber(node: BincNode, name: string): number | undefined {
  const value = node.children.find((child) => child.name === name)?.value
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 影格數的上限。CSP 允許很長的時間軸，但我們的影格軌撐不住也沒意義。 */
const MAX_FRAMES = 240

/**
 * 讀取 .clip 內建的動畫時間軸。
 *
 * **這裡任何一條時間軸壞掉都不可以讓整個檔案開不起來** —— 使用者只是想開圖層來排幀，
 * 不該因為某條時間軸格式沒見過就完全打不開。所以每條 track 各自 try/catch，
 * 失敗就跳過並留下警告。
 */
export function readCspTimelineGroups(
  db: Database,
  chunks: Map<string, Buffer>,
): CspTimelineGroup[] {
  const layers = new Map<string, { id: number; name: string }>()
  for (const row of queryRows(
    db,
    'SELECT MainId, LayerName, LayerUuid FROM Layer WHERE AnimationFolder = 1',
  )) {
    layers.set(textValue(row.LayerUuid).replaceAll('-', '').toLowerCase(), {
      id: numberValue(row, 'MainId'),
      name: textValue(row.LayerName),
    })
  }
  const results: CspTimelineGroup[] = []
  for (const timeline of queryRows(
    db,
    'SELECT TimeLineName, FrameRate, StartFrame, EndFrame, FirstTrack FROM TimeLine',
  )) {
    const frameRate = numberValue(timeline, 'FrameRate') || 12
    // EndFrame 是「不含」的結尾（實測 StartFrame=0、EndFrame=20 就是 20 格），
    // 但 StartFrame 不一定是 0，關鍵影格的 frame 是絕對值，之後要扣掉起點。
    const startFrame = numberValue(timeline, 'StartFrame')
    const rawCount = numberValue(timeline, 'EndFrame') - startFrame
    const frameCount = Math.max(0, Math.min(MAX_FRAMES, rawCount))
    const tracks: CspTimeline[] = []
    let trackId = numberValue(timeline, 'FirstTrack')
    const visited = new Set<number>()
    while (trackId !== 0) {
      if (visited.has(trackId)) break // 鏈結成環就停下來，已經讀到的照樣可用
      visited.add(trackId)
      const track = queryRows(
        db,
        `SELECT MainId, TrackKind, TrackActionMixer, TrackNextIndex, LayerUuidWithTrack FROM Track WHERE MainId = ${trackId}`,
      )[0]
      if (!track) throw new Error(`找不到 Track ${trackId}`)
      trackId = numberValue(track, 'TrackNextIndex')
      if (numberValue(track, 'TrackKind') !== 2000) continue
      const uuid =
        track.LayerUuidWithTrack instanceof Uint8Array
          ? Buffer.from(track.LayerUuidWithTrack).toString('hex')
          : ''
      const layer = layers.get(uuid)
      if (!layer) continue
      try {
        const externalId = textValue(track.TrackActionMixer)
        const packed = chunks.get(externalId)
        if (!packed) throw new Error(`找不到時間軸外部資料 ${externalId}`)
        const compressedLength = packed.readUInt32LE(0)
        if (compressedLength !== packed.length - 4)
          throw new Error(`時間軸壓縮長度不符：${compressedLength}/${packed.length - 4}`)
        const root = parseBinc(inflateSync(packed.subarray(4)))
        const warnings: string[] = []
        if (rawCount > MAX_FRAMES)
          warnings.push(`原始時間軸有 ${rawCount} 格，已截到 ${MAX_FRAMES} 格`)
        if (frameCount === 0) {
          warnings.push('這條時間軸的長度是 0，略過')
          continue
        }
        const actionClips = findAll(root, 'ActionNodeClip')
        const keysByFrame = new Map<number, CelKey>()
        let hasCurve = false
        actionClips.forEach((actionClip, clipIndex) => {
          const curve = findCurve(actionClip)
          if (!curve) return
          hasCurve = true
          const timeClip = actionClip.children.find((child) => child.name === 'TimeClip')
          const motionClip = actionClip.children.find((child) => child.name === 'MotionClip')
          const timeStart = timeClip ? childNumber(timeClip, 'Start') : undefined
          const timeEnd = timeClip ? childNumber(timeClip, 'End') : undefined
          const timeRate = timeClip ? childNumber(timeClip, 'Rate') : undefined
          const motionStart = motionClip ? childNumber(motionClip, 'Start') : undefined
          const motionEnd = motionClip ? childNumber(motionClip, 'End') : undefined
          if (
            timeStart === undefined ||
            timeEnd === undefined ||
            timeRate === undefined ||
            timeRate === 0 ||
            motionStart === undefined ||
            motionEnd === undefined
          ) {
            warnings.push(`第 ${clipIndex + 1} 個 ActionNodeClip 的時間資料無效，已略過`)
            return
          }
          const frames = curve.children.find((child) => child.name === 'Frame')?.value
          const tags = curve.children.find((child) => child.name === 'Tag')?.value
          if (!Array.isArray(frames) || !Array.isArray(tags) || frames.length !== tags.length)
            throw new Error('ImageCelName FCurve 的 Frame 與 Tag 陣列不完整或長度不符')
          const zeroMotionRange = motionEnd === motionStart
          if (zeroMotionRange)
            warnings.push(
              `第 ${clipIndex + 1} 個 ActionNodeClip 的 MotionClip 長度是 0，已對映到起始位置`,
            )
          frames.forEach((frameValue, index) => {
            const curveFrame = Number(frameValue)
            if (!Number.isFinite(curveFrame))
              throw new Error('ImageCelName FCurve 含有非數字 Frame')
            const time = zeroMotionRange
              ? timeStart
              : timeStart +
                ((curveFrame - motionStart) * (timeEnd - timeStart)) / (motionEnd - motionStart)
            // TimeClip 的結尾不含在 clip 內；被修剪掉的 key 不屬於超出文件時間軸。
            if (time < timeStart || time >= timeEnd) return
            const frame = Math.round((time * frameRate) / timeRate) - startFrame
            // 依 ActionNodeClip 順序寫入 Map，讓後面的 clip 在撞格時覆蓋前面的 key。
            keysByFrame.set(frame, { frame, celName: String(tags[index]) })
          })
        })
        if (!hasCurve) continue
        const keys = [...keysByFrame.values()].sort((a, b) => a.frame - b.frame)
        const outOfRange = keys.filter((key) => key.frame < 0 || key.frame >= frameCount).length
        if (outOfRange)
          warnings.push(`有 ${outOfRange} 個關鍵影格落在 1–${frameCount} 格之外，已忽略`)
        tracks.push({
          animationFolderId: layer.id,
          animationFolderName: layer.name,
          frameRate,
          frameCount,
          keys,
          warnings,
        })
      } catch (error) {
        // 單一條時間軸讀不動不該讓整個 .clip 開不起來。
        console.warn(`略過讀不動的 CSP 時間軸（圖層「${layer.name}」）：${String(error)}`)
      }
    }
    results.push({
      name: textValue(timeline.TimeLineName),
      frameRate,
      startFrame,
      endFrame: numberValue(timeline, 'EndFrame'),
      tracks,
    })
  }
  return results
}
