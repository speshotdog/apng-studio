import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import JSZip from 'jszip'
import { parseClip, type ClipDocument, type ClipLayer } from '../clip/index.js'
import { encodeApng, verifyApng } from '../codec/apng.js'
import { encodeGif } from '../codec/gif.js'
import type { ClipSummary, ExportPayload, ExportResult, LayerNode } from '../preload/api.js'
import type { PackImportCell, PackImportResult, ProjectSnapshot } from '../project/types.js'
import type { ExportTarget } from '../codec/line.js'
import { deleteProject, listProjects, renameProject, saveProject } from './projects.js'
import { testGiphyKey, uploadToGiphy } from './giphy.js'
import {
  clearGiphy,
  getGiphyKey,
  getPublicSettings,
  setGiphy,
  setProgressExpanded,
} from './settings.js'
let current: ClipDocument | null = null
let currentPath = ''
const rendered = new Map<string, { width: number; height: number; rgba: Uint8Array }>()
/** 匯出預設檔名：月日_時分，例如 8/23 03:19 → 0823_0319 */
export function timestampName(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
}
function pngInfo(bytes: Uint8Array): { width: number; height: number; frameCount: number } {
  if (bytes.length < 24 || new TextDecoder().decode(bytes.subarray(1, 4)) !== 'PNG')
    throw new Error('不是有效的 PNG/APNG 檔案')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let frameCount = 1
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset)
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))
    if (type === 'acTL') frameCount = view.getUint32(offset + 8)
    offset += 12 + length
  }
  return { width: view.getUint32(16), height: view.getUint32(20), frameCount }
}

async function importPackFolder(requested?: string): Promise<PackImportResult | null> {
  let folder = requested
  if (!folder) {
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (picked.canceled || !picked.filePaths[0]) return null
    folder = picked.filePaths[0]
  }
  const cells: PackImportCell[] = []
  const skipped: string[] = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const match = /^(?:(\d{1,2})|(main)|(tab))\.png$/i.exec(entry.name)
    const numeric = match?.[1] ? Number(match[1]) : null
    if (!match || (numeric !== null && (numeric < 1 || numeric > 40))) {
      skipped.push(entry.name)
      continue
    }
    const sourcePath = join(folder, entry.name)
    const bytes = new Uint8Array(await readFile(sourcePath))
    try {
      const info = pngInfo(bytes)
      cells.push({
        index: numeric ?? (match[2] ? 'main' : 'tab'),
        sourcePath,
        pngBase64: Buffer.from(bytes).toString('base64'),
        byteLength: bytes.length,
        ...info,
      })
    } catch {
      skipped.push(entry.name)
    }
  }
  return { cells, skipped }
}

async function hydratePackCells(
  cells: NonNullable<ProjectSnapshot['pack']>['cells'],
): Promise<PackImportCell[]> {
  const hydrated: PackImportCell[] = []
  for (const cell of cells) {
    let bytes: Uint8Array
    try {
      bytes = cell.sourcePath
        ? new Uint8Array(await readFile(cell.sourcePath))
        : Buffer.from(cell.pngBase64 ?? '', 'base64')
    } catch {
      if (!cell.pngBase64) continue
      bytes = Buffer.from(cell.pngBase64, 'base64')
    }
    try {
      hydrated.push({
        ...cell,
        pngBase64: Buffer.from(bytes).toString('base64'),
        byteLength: bytes.length,
        ...pngInfo(bytes),
        sourcePath: cell.sourcePath ?? '',
      })
    } catch {
      // 無效 fallback 留成空格，讓使用者重新匯入。
    }
  }
  return hydrated
}

async function exportPack(
  getWindow: () => BrowserWindow | null,
  requested: string | undefined,
  cells: PackImportCell[],
  target?: ExportTarget,
): Promise<ExportResult> {
  try {
    if (target === 'plurkEmoticon') {
      let folder = requested
      if (!folder) {
        const picked = await dialog.showOpenDialog(getWindow() ?? (undefined as never), {
          properties: ['openDirectory', 'createDirectory'],
        })
        if (picked.canceled || !picked.filePaths[0])
          return { ok: false, warnings: [], error: '已取消輸出' }
        folder = picked.filePaths[0]
      }
      let total = 0
      for (const cell of cells.filter((item) => typeof item.index === 'number')) {
        const bytes = cell.pngBase64
          ? Buffer.from(cell.pngBase64, 'base64')
          : await readFile(cell.sourcePath)
        await writeFile(join(folder, `${String(cell.index).padStart(2, '0')}.png`), bytes)
        total += bytes.length
      }
      return { ok: true, filePath: folder, warnings: [], byteLength: total }
    }
    let filePath = requested
    if (!filePath) {
      const picked = await dialog.showSaveDialog(getWindow() ?? (undefined as never), {
        defaultPath: `${timestampName()}_stickers.zip`,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      })
      if (picked.canceled || !picked.filePath)
        return { ok: false, warnings: [], error: '已取消打包' }
      filePath = picked.filePath
    }
    const zip = new JSZip()
    for (const cell of cells) {
      const name =
        typeof cell.index === 'number'
          ? `${String(cell.index).padStart(2, '0')}.png`
          : `${cell.index}.png`
      const bytes = cell.pngBase64
        ? Buffer.from(cell.pngBase64, 'base64')
        : await readFile(cell.sourcePath)
      zip.file(name, bytes)
    }
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    await writeFile(filePath, bytes)
    return { ok: true, filePath, warnings: [], byteLength: bytes.length }
  } catch (error) {
    return {
      ok: false,
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
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
  ipcMain.handle('settings:get', () => getPublicSettings())
  ipcMain.handle('settings:setGiphy', (_event, key: string, username: string) =>
    setGiphy(key, username),
  )
  ipcMain.handle('settings:clearGiphy', () => clearGiphy())
  ipcMain.handle('settings:setProgressExpanded', (_event, expanded: boolean) =>
    setProgressExpanded(expanded),
  )
  ipcMain.handle('settings:testGiphy', async () => testGiphyKey(await getGiphyKey()))
  ipcMain.handle(
    'giphy:upload',
    async (_event, payload: { gifBytes: Uint8Array; tags: string }) => {
      const settings = await getPublicSettings()
      return uploadToGiphy(
        payload.gifBytes,
        payload.tags,
        await getGiphyKey(),
        settings.giphyUsername,
      )
    },
  )
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !['giphy.com', 'media.giphy.com'].includes(parsed.hostname))
      throw new Error('只允許開啟 GIPHY 網址')
    return shell.openExternal(parsed.toString())
  })
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:save', (_event, snapshot: ProjectSnapshot) => saveProject(snapshot))
  ipcMain.handle('project:delete', (_event, id: string) => deleteProject(id))
  ipcMain.handle('project:rename', (_event, id: string, name: string) => renameProject(id, name))
  ipcMain.handle('project:importFolder', (_event, requested?: string) =>
    importPackFolder(requested),
  )
  ipcMain.handle(
    'project:hydratePackCells',
    (_event, cells: NonNullable<ProjectSnapshot['pack']>['cells']) => hydratePackCells(cells),
  )
  ipcMain.handle(
    'project:exportPack',
    (_event, requested: string | undefined, cells: PackImportCell[], target?: ExportTarget) =>
      exportPack(getWindow, requested, cells, target),
  )
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
