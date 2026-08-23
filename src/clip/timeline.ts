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

function numberValue(row: Record<string, unknown>, key: string): number {
  return typeof row[key] === 'number' ? row[key] : 0
}
function textValue(value: unknown): string {
  if (typeof value === 'string') return value
  return value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : ''
}
function find(node: BincNode, name: string): BincNode | undefined {
  if (node.name === name) return node
  for (const child of node.children) {
    const result = find(child, name)
    if (result) return result
  }
  return undefined
}
function findCurve(node: BincNode): BincNode | undefined {
  if (node.name === 'FCurve' && node.attrs.Type === 'ImageCelName') return node
  for (const child of node.children) {
    const result = findCurve(child)
    if (result) return result
  }
  return undefined
}

export function readCspTimelines(db: Database, chunks: Map<string, Buffer>): CspTimeline[] {
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
  const results: CspTimeline[] = []
  for (const timeline of queryRows(
    db,
    'SELECT FrameRate, StartFrame, EndFrame, FirstTrack FROM TimeLine',
  )) {
    const frameRate = numberValue(timeline, 'FrameRate')
    const frameCount = numberValue(timeline, 'EndFrame') - numberValue(timeline, 'StartFrame')
    let trackId = numberValue(timeline, 'FirstTrack')
    const visited = new Set<number>()
    while (trackId !== 0) {
      if (visited.has(trackId)) throw new Error(`Track 鏈結形成循環：${trackId}`)
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
      const externalId = textValue(track.TrackActionMixer)
      const packed = chunks.get(externalId)
      if (!packed) throw new Error(`找不到時間軸外部資料 ${externalId}`)
      const compressedLength = packed.readUInt32LE(0)
      if (compressedLength !== packed.length - 4)
        throw new Error(`時間軸壓縮長度不符：${compressedLength}/${packed.length - 4}`)
      const root = parseBinc(inflateSync(packed.subarray(4)))
      const warnings: string[] = []
      const rateNode = find(root, 'TimeInfo')?.children.find((child) => child.name === 'Rate')
      let curveRate = typeof rateNode?.value === 'number' ? rateNode.value : 0
      if (curveRate === 0) {
        curveRate = frameRate
        warnings.push('找不到有效的 TimeInfo/Rate，已使用文件 FPS')
      }
      const curve = findCurve(root)
      if (!curve) continue
      const frames = curve.children.find((child) => child.name === 'Frame')?.value
      const tags = curve.children.find((child) => child.name === 'Tag')?.value
      if (!Array.isArray(frames) || !Array.isArray(tags) || frames.length !== tags.length)
        throw new Error('ImageCelName FCurve 的 Frame 與 Tag 陣列不完整或長度不符')
      results.push({
        animationFolderId: layer.id,
        animationFolderName: layer.name,
        frameRate,
        frameCount,
        keys: frames.map((frame, index) => ({
          frame: Math.round((Number(frame) * frameRate) / curveRate),
          celName: String(tags[index]),
        })),
        warnings,
      })
    }
  }
  return results
}
