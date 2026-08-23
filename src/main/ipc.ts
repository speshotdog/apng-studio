import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseClip, type ClipDocument, type ClipLayer } from '../clip/index.js'
import { encodeApng, verifyApng } from '../codec/apng.js'
import { encodeGif } from '../codec/gif.js'
import type { ClipSummary, ExportPayload, ExportResult, LayerNode } from '../preload/api.js'
let current: ClipDocument | null = null
let currentPath = ''
const rendered = new Map<string, { width: number; height: number; rgba: Uint8Array }>()
/** 匯出預設檔名：月日_時分，例如 8/23 03:19 → 0823_0319 */
export function timestampName(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
}
function visibilityKey(layerId: number, overrides: Array<[number, boolean]>): string {
  return `${layerId}|${overrides
    .slice()
    .sort(([a], [b]) => a - b)
    .map(([id, visible]) => `${id}:${visible ? 1 : 0}`)
    .join(',')}`
}
function node(layer: ClipLayer): LayerNode {
  return {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    isFolder: layer.isFolder,
    isAnimationFolder: layer.isAnimationFolder,
    visible: layer.visible,
    opacity: layer.opacity,
    children: layer.children.map(node),
  }
}
async function writeExport(filePath: string, payload: ExportPayload): Promise<ExportResult> {
  try {
    if (payload.format === 'apng') {
      const bytes = encodeApng(payload.frames, payload.width, payload.height, {
        numPlays: payload.numPlays,
        mergeIdentical: payload.mergeIdentical,
      })
      const info = verifyApng(bytes)
      await writeFile(filePath, bytes)
      return { ok: true, filePath, info, warnings: [], byteLength: bytes.length }
    }
    const result = encodeGif(payload.frames, payload.width, payload.height, {
      numPlays: payload.numPlays,
      maxColors: payload.gif?.maxColors ?? 256,
    })
    await writeFile(filePath, result.bytes)
    return { ok: true, filePath, warnings: result.warnings, byteLength: result.bytes.length }
  } catch (error) {
    return {
      ok: false,
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
export function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('clip:open', async (_event, requested?: string): Promise<ClipSummary | null> => {
    let filePath = requested
    if (!filePath) {
      const picked = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Clip Studio Paint', extensions: ['clip'] }],
      })
      if (picked.canceled || !picked.filePaths[0]) return null
      filePath = picked.filePaths[0]
    }
    const doc = await parseClip(await readFile(filePath))
    current = doc
    currentPath = filePath
    rendered.clear()
    return {
      filePath,
      canvas: doc.canvas,
      timeline: doc.timeline,
      tree: node(doc.root),
      cspTimelines: doc.cspTimelines,
    }
  })
  ipcMain.handle('clip:openBuffer', async (_event, bytes: Uint8Array): Promise<ClipSummary> => {
    const doc = await parseClip(Buffer.from(bytes))
    current = doc
    currentPath = ''
    rendered.clear()
    return {
      filePath: '拖放的 .clip',
      canvas: doc.canvas,
      timeline: doc.timeline,
      tree: node(doc.root),
      cspTimelines: doc.cspTimelines,
    }
  })
  ipcMain.handle('clip:render', (_event, layerId: number, overrides: Array<[number, boolean]>) => {
    if (!current) throw new Error('請先開啟 .clip 檔案')
    const key = visibilityKey(layerId, overrides)
    const cached = rendered.get(key)
    if (cached) return cached
    const bitmap = current.renderNode(layerId, new Map(overrides))
    const value = { width: bitmap.width, height: bitmap.height, rgba: new Uint8Array(bitmap.data) }
    rendered.set(key, value)
    return value
  })
  ipcMain.handle('export:save', async (_event, payload: ExportPayload): Promise<ExportResult> => {
    try {
      const extension = payload.format === 'apng' ? 'png' : 'gif'
      const picked = await dialog.showSaveDialog(getWindow() ?? (undefined as never), {
        defaultPath: currentPath
          ? join(dirname(currentPath), `${timestampName()}.${extension}`)
          : `${timestampName()}.${extension}`,
        filters: [
          { name: payload.format === 'apng' ? 'Animated PNG' : 'GIF', extensions: [extension] },
        ],
      })
      if (picked.canceled || !picked.filePath)
        return { ok: false, warnings: [], error: '已取消匯出' }
      return writeExport(picked.filePath, payload)
    } catch (error) {
      return {
        ok: false,
        warnings: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })
  ipcMain.handle('export:to', (_event, filePath: string, payload: ExportPayload) =>
    writeExport(filePath, payload),
  )
}
