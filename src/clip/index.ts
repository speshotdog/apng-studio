import { Buffer } from 'node:buffer'
import type { Database } from 'sql.js'
import { readChunks } from './chunks.js'
import { openClipDatabase, queryRows } from './db.js'
import { decodeBitmap, parseAttribute, parseBlockChunk, type Bitmap } from './offscreen.js'
import { buildTree, type ClipLayer } from './tree.js'
import { readCspTimelines, type CspTimeline } from './timeline.js'

export type { Bitmap } from './offscreen.js'
export type { ClipLayer } from './tree.js'
export type { CspTimeline } from './timeline.js'

export interface ClipCanvas {
  width: number
  height: number
  resolution: number
}
export interface ClipTimeline {
  frameRate: number
  startFrame: number
  endFrame: number
  name: string
}
export interface ClipDocument {
  canvas: ClipCanvas
  root: ClipLayer
  flat: Map<number, ClipLayer>
  timeline: ClipTimeline | null
  cspTimelines: CspTimeline[]
  renderRawBitmap(layerId: number): Bitmap
  renderNode(layerId: number, overrides?: Map<number, boolean>): Bitmap
}

function numeric(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  if (typeof value !== 'number') throw new Error(`資料庫欄位 ${key} 不是數字`)
  return value
}

function compositeOver(
  target: Uint8ClampedArray,
  source: Uint8ClampedArray,
  opacity: number,
): void {
  for (let index = 0; index < target.length; index += 4) {
    const sourceAlpha = (source[index + 3] / 255) * opacity
    if (sourceAlpha === 0) continue
    const targetAlpha = target[index + 3] / 255
    const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha)
    for (let channel = 0; channel < 3; channel += 1) {
      target[index + channel] = Math.round(
        (source[index + channel] * sourceAlpha +
          target[index + channel] * targetAlpha * (1 - sourceAlpha)) /
          outputAlpha,
      )
    }
    target[index + 3] = Math.round(outputAlpha * 255)
  }
}

function blank(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

function databaseMaps(db: Database): {
  mipmaps: Map<number, number>
  mipmapInfo: Map<number, number>
  offscreens: Map<number, { blockData: string; attribute: Buffer }>
} {
  const mipmaps = new Map<number, number>()
  for (const row of queryRows(db, 'SELECT MainId, BaseMipmapInfo FROM Mipmap'))
    mipmaps.set(numeric(row, 'MainId'), numeric(row, 'BaseMipmapInfo'))
  const mipmapInfo = new Map<number, number>()
  for (const row of queryRows(db, 'SELECT MainId, Offscreen FROM MipmapInfo'))
    mipmapInfo.set(numeric(row, 'MainId'), numeric(row, 'Offscreen'))
  const offscreens = new Map<number, { blockData: string; attribute: Buffer }>()
  for (const row of queryRows(db, 'SELECT MainId, BlockData, Attribute FROM Offscreen')) {
    const blockData =
      typeof row.BlockData === 'string'
        ? row.BlockData
        : row.BlockData instanceof Uint8Array
          ? Buffer.from(row.BlockData).toString('utf8')
          : null
    if (blockData === null || !(row.Attribute instanceof Uint8Array)) continue
    offscreens.set(numeric(row, 'MainId'), { blockData, attribute: Buffer.from(row.Attribute) })
  }
  return { mipmaps, mipmapInfo, offscreens }
}

export async function parseClip(data: Buffer): Promise<ClipDocument> {
  const chunks = readChunks(data)
  const db = await openClipDatabase(chunks.sqlite)
  try {
    const canvasRow = queryRows(
      db,
      'SELECT CanvasWidth, CanvasHeight, CanvasResolution FROM Canvas',
    )[0]
    if (!canvasRow) throw new Error('Canvas 資料表沒有畫布資料')
    const canvas = {
      width: numeric(canvasRow, 'CanvasWidth'),
      height: numeric(canvasRow, 'CanvasHeight'),
      resolution: numeric(canvasRow, 'CanvasResolution'),
    }
    const { root, flat } = buildTree(db)
    const timelineRow = queryRows(
      db,
      'SELECT FrameRate, StartFrame, EndFrame, TimeLineName FROM TimeLine',
    )[0]
    const timeline = timelineRow
      ? {
          frameRate: numeric(timelineRow, 'FrameRate'),
          startFrame: numeric(timelineRow, 'StartFrame'),
          endFrame: numeric(timelineRow, 'EndFrame'),
          name: typeof timelineRow.TimeLineName === 'string' ? timelineRow.TimeLineName : '',
        }
      : null
    const maps = databaseMaps(db)
    const cspTimelines = readCspTimelines(db, chunks.external)
    const cache = new Map<number, Bitmap>()
    const rawCache = new Map<number, Bitmap>()
    const warned = new Set<number>()

    const renderRawBitmap = (layerId: number): Bitmap => {
      const cached = rawCache.get(layerId)
      if (cached) return cached
      const layer = flat.get(layerId)
      if (!layer) throw new Error(`找不到圖層 ${layerId}`)
      if (layer.isFolder || layer.renderMipmapId === 0) {
        throw new Error(`圖層「${layer.name}」沒有可解碼的原始 bitmap`)
      }
      const mipmapInfoId = maps.mipmaps.get(layer.renderMipmapId)
      const offscreenId = mipmapInfoId === undefined ? undefined : maps.mipmapInfo.get(mipmapInfoId)
      const offscreen = offscreenId === undefined ? undefined : maps.offscreens.get(offscreenId)
      if (!offscreen) throw new Error(`圖層「${layer.name}」的 Mipmap 鏈結不完整`)
      const external = chunks.external.get(offscreen.blockData)
      if (!external) throw new Error(`找不到圖層「${layer.name}」的外部資料 ${offscreen.blockData}`)
      const bitmap = decodeBitmap(parseAttribute(offscreen.attribute), parseBlockChunk(external))
      rawCache.set(layerId, bitmap)
      return bitmap
    }

    const renderNode = (layerId: number, overrides?: Map<number, boolean>): Bitmap => {
      const cached = overrides ? undefined : cache.get(layerId)
      if (cached) return cached
      const layer = flat.get(layerId)
      if (!layer) throw new Error(`找不到圖層 ${layerId}`)
      if (overrides?.get(layerId) === false) return blank(canvas.width, canvas.height)
      if (layer.blendMode !== 0 && !warned.has(layer.id)) {
        console.warn(
          `圖層「${layer.name}」使用尚未支援的混合模式 ${layer.blendMode}，暫以 normal 處理`,
        )
        warned.add(layer.id)
      }
      const result = blank(canvas.width, canvas.height)
      if (layer.isFolder) {
        for (const child of layer.children) {
          if (overrides?.get(child.id) ?? child.visible)
            compositeOver(result.data, renderNode(child.id, overrides).data, child.opacity)
        }
      } else if (layer.renderMipmapId !== 0) {
        const bitmap = renderRawBitmap(layerId)
        const offsetX = layer.offsetX + layer.renderOffsetX
        const offsetY = layer.offsetY + layer.renderOffsetY
        for (let y = 0; y < bitmap.height; y += 1) {
          const targetY = y + offsetY
          if (targetY < 0 || targetY >= canvas.height) continue
          for (let x = 0; x < bitmap.width; x += 1) {
            const targetX = x + offsetX
            if (targetX < 0 || targetX >= canvas.width) continue
            const source = (y * bitmap.width + x) * 4
            const target = (targetY * canvas.width + targetX) * 4
            result.data[target] = bitmap.data[source]
            result.data[target + 1] = bitmap.data[source + 1]
            result.data[target + 2] = bitmap.data[source + 2]
            result.data[target + 3] = bitmap.data[source + 3]
          }
        }
      }
      if (!overrides) cache.set(layerId, result)
      return result
    }
    return { canvas, root, flat, timeline, cspTimelines, renderRawBitmap, renderNode }
  } finally {
    db.close()
  }
}
