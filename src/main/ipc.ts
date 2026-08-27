import { dialog, ipcMain, Menu, shell, type BrowserWindow } from 'electron'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import JSZip from 'jszip'
import UPNG from 'upng-js'
import {
  isSupported,
  parseSource,
  SUPPORTED,
  type SourceDocument,
  type SourceLayer,
} from '../formats/index.js'
import { encodeApng, verifyApng } from '../codec/apng.js'
import { encodeGif } from '../codec/gif.js'
import { encodePng } from '../codec/png.js'
import type {
  ClipSummary,
  DraftListing,
  ExportPayload,
  ExportResult,
  FrameContextAction,
  LayerNode,
  PackEncoded,
} from '../preload/api.js'
import type {
  BatchFolderScanResult,
  PackImportCell,
  PackImportResult,
  ProjectBlob,
  ProjectPackCell,
} from '../project/types.js'
import { classifyBatchFolder } from '../project/batch-import.js'
import type { ExportTarget } from '../codec/line.js'
import {
  autosaveProject,
  createProject,
  deleteProject,
  discardProjectAutosave,
  duplicateProject,
  listProjects,
  readProject,
  readProjectAutosave,
  renameProject,
  saveProject,
} from './projects.js'
import { testGiphyKey, uploadToGiphy } from './giphy.js'
import {
  addRecentTags,
  clearGiphy,
  getDraftFolder,
  getGiphyKey,
  getPublicSettings,
  setDraftFolder,
  setGiphy,
  setProgressExpanded,
} from './settings.js'
let currentPath = ''
const documents = new Map<string, SourceDocument>()
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

async function scanBatchSourceFolder(
  requested: string | undefined,
  packCount: number,
): Promise<BatchFolderScanResult | null> {
  let folder = requested
  if (!folder) {
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (picked.canceled || !picked.filePaths[0]) return null
    folder = picked.filePaths[0]
  }
  const entries = (await readdir(folder, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, path: join(folder, entry.name) }))
  return classifyBatchFolder(folder, entries, packCount)
}

async function hydratePackCells(cells: ProjectPackCell[]): Promise<PackImportCell[]> {
  const hydrated: PackImportCell[] = []
  for (const cell of cells) {
    if (cell.kind === 'document') {
      hydrated.push({
        index: cell.index,
        sourcePath: '',
        pngBase64: cell.encoded?.base64 ?? '',
        width: cell.encoded?.width ?? 0,
        height: cell.encoded?.height ?? 0,
        byteLength: cell.encoded?.byteLength ?? 0,
        frameCount: cell.encoded?.frameCount ?? 0,
        documentId: cell.documentId,
        renderedRevision: cell.encoded?.renderedRevision ?? -1,
        mime: cell.encoded?.mime ?? 'image/png',
      })
      continue
    }
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
        index: cell.index,
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
async function documentFor(filePath: string): Promise<SourceDocument> {
  const cached = documents.get(filePath)
  if (cached) return cached
  const doc = await parseSource(filePath, await readFile(filePath))
  documents.set(filePath, doc)
  return doc
}

function visibilityKey(
  filePath: string,
  layerId: number,
  overrides: Array<[number, boolean]>,
): string {
  return `${filePath}|${layerId}|${overrides
    .slice()
    .sort(([a], [b]) => a - b)
    .map(([id, visible]) => `${id}:${visible ? 1 : 0}`)
    .join(',')}`
}
function node(layer: SourceLayer): LayerNode {
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
    const encoded = encodeExport(payload)
    await writeFile(filePath, encoded.bytes)
    return { ok: true, filePath, ...encoded }
  } catch (error) {
    return {
      ok: false,
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function encodeExport(payload: ExportPayload): {
  bytes: Uint8Array
  warnings: string[]
  byteLength: number
  info?: ReturnType<typeof verifyApng>
} {
  if (payload.format === 'png') {
    const frame = payload.frames[0]
    if (!frame) throw new Error('靜態 PNG 沒有可輸出的影格')
    const bytes = encodePng(frame.rgba, payload.width, payload.height)
    return { bytes, warnings: [], byteLength: bytes.length }
  }
  if (payload.format === 'apng') {
    const bytes = encodeApng(payload.frames, payload.width, payload.height, {
      numPlays: payload.numPlays,
      mergeIdentical: payload.mergeIdentical,
    })
    const info = verifyApng(bytes)
    return { bytes, info, warnings: [], byteLength: bytes.length }
  }
  const result = encodeGif(payload.frames, payload.width, payload.height, {
    numPlays: payload.numPlays,
    maxColors: payload.gif?.maxColors ?? 256,
    matte: payload.gif?.matte ?? null,
  })
  return { bytes: result.bytes, warnings: result.warnings, byteLength: result.bytes.length }
}

function encodeTwitchFile(payload: ExportPayload): ReturnType<typeof encodeExport> {
  const limit = payload.format === 'gif' ? 1024 * 1024 : 25 * 1024
  let encoded = encodeExport(payload)
  if (encoded.byteLength < limit || (payload.format === 'gif' && encoded.byteLength === limit))
    return encoded
  for (const colors of [128, 64, 32]) {
    if (payload.format === 'gif') {
      encoded = encodeExport({
        ...payload,
        gif: { maxColors: colors, matte: payload.gif?.matte ?? null },
      })
    } else {
      const frame = payload.frames[0]
      if (!frame) break
      const rgba = frame.rgba.buffer.slice(
        frame.rgba.byteOffset,
        frame.rgba.byteOffset + frame.rgba.byteLength,
      ) as ArrayBuffer
      const bytes = new Uint8Array(UPNG.encode([rgba], payload.width, payload.height, colors))
      encoded = { bytes, byteLength: bytes.length, warnings: [] }
    }
    encoded.warnings = [...encoded.warnings, `已自動減色至 ${colors} 色以嘗試符合大小限制`]
    if (encoded.byteLength < limit || (payload.format === 'gif' && encoded.byteLength === limit))
      return encoded
  }
  return encoded
}

async function saveMultiZip(
  getWindow: () => BrowserWindow | null,
  payloads: Array<{ suffix: string; payload: ExportPayload }>,
): Promise<ExportResult> {
  try {
    const picked = await dialog.showSaveDialog(getWindow() ?? (undefined as never), {
      defaultPath: `${timestampName()}_twitch.zip`,
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    })
    if (picked.canceled || !picked.filePath) return { ok: false, warnings: [], error: '已取消打包' }
    const zip = new JSZip()
    const base = timestampName()
    for (const item of payloads) {
      const encoded = encodeTwitchFile(item.payload)
      zip.file(
        `${base}_${item.suffix}.${item.payload.format === 'gif' ? 'gif' : 'png'}`,
        encoded.bytes,
      )
    }
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    await writeFile(picked.filePath, bytes)
    return { ok: true, filePath: picked.filePath, warnings: [], byteLength: bytes.length }
  } catch (error) {
    return {
      ok: false,
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function writeMultiExport(
  getWindow: () => BrowserWindow | null,
  requested: string | undefined,
  payloads: Array<{ suffix: string; payload: ExportPayload }>,
): Promise<ExportResult> {
  try {
    let folder = requested
    if (!folder) {
      const picked = await dialog.showOpenDialog(getWindow() ?? (undefined as never), {
        properties: ['openDirectory', 'createDirectory'],
      })
      if (picked.canceled || !picked.filePaths[0])
        return { ok: false, warnings: [], error: '已取消匯出' }
      folder = picked.filePaths[0]
    }
    const base = timestampName()
    const files: NonNullable<ExportResult['files']> = []
    for (const item of payloads) {
      const extension = item.payload.format === 'gif' ? 'gif' : 'png'
      const filePath = join(folder, `${base}_${item.suffix}.${extension}`)
      const encoded = encodeTwitchFile(item.payload)
      await writeFile(filePath, encoded.bytes)
      files.push({ filePath, byteLength: encoded.byteLength, warnings: encoded.warnings })
    }
    return {
      ok: true,
      filePath: folder,
      files,
      warnings: files.flatMap((file) => file.warnings),
      byteLength: files.reduce((sum, file) => sum + file.byteLength, 0),
    }
  } catch (error) {
    return {
      ok: false,
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
export function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(
    'timeline:frameContextMenu',
    (_event, targetCount: number): Promise<FrameContextAction | null> => {
      if (!Number.isInteger(targetCount) || targetCount < 1)
        throw new Error('影格右鍵選單的目標格數無效')
      const window = getWindow()
      if (!window) throw new Error('找不到可顯示影格右鍵選單的視窗')
      const label = targetCount > 1 ? `這 ${targetCount} 格` : '這格'
      return new Promise((resolve) => {
        let resolved = false
        const finish = (action: FrameContextAction | null): void => {
          if (resolved) return
          resolved = true
          resolve(action)
        }
        Menu.buildFromTemplate([
          { label: `清除${label}並延續前格`, click: () => finish('clear-and-continue') },
          { label: '固定目前延續影格', click: () => finish('freeze') },
          { label: '在後面插入一格（所有圖層）', click: () => finish('insert') },
          { label: `刪除${label}（所有圖層）`, click: () => finish('delete') },
        ]).popup({ window, callback: () => finish(null) })
      })
    },
  )
  ipcMain.handle('settings:get', () => getPublicSettings())
  ipcMain.handle('settings:setGiphy', (_event, key: string, username: string) =>
    setGiphy(key, username),
  )
  ipcMain.handle('settings:clearGiphy', () => clearGiphy())
  ipcMain.handle('settings:addRecentTags', (_event, tags: string[]) => addRecentTags(tags))
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
  ipcMain.handle('shell:openPath', async (_event, filePath: string): Promise<string> => {
    try {
      if (!(await stat(filePath)).isFile()) return '找不到原檔，請先用「連結」重新指向'
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      if (code === 'ENOENT' || code === 'ENOTDIR') return '找不到原檔，請先用「連結」重新指向'
      return `無法檢查原檔：${error instanceof Error ? error.message : String(error)}`
    }
    return shell.openPath(filePath)
  })
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:read', (_event, id: string) => readProject(id))
  ipcMain.handle('project:create', (_event, input: Parameters<typeof createProject>[0]) =>
    createProject(input),
  )
  ipcMain.handle(
    'project:save',
    (_event, id: string, state: ProjectBlob, thumbnailDataUrl?: string) =>
      saveProject(id, state, thumbnailDataUrl),
  )
  ipcMain.handle('project:autosave', (_event, id: string, state: ProjectBlob) =>
    autosaveProject(id, state),
  )
  ipcMain.handle('project:readAutosave', (_event, id: string) => readProjectAutosave(id))
  ipcMain.handle('project:discardAutosave', (_event, id: string) => discardProjectAutosave(id))
  ipcMain.handle('project:delete', (_event, id: string) => deleteProject(id))
  ipcMain.handle('project:rename', (_event, id: string, name: string) => renameProject(id, name))
  ipcMain.handle('project:duplicate', (_event, id: string, name: string) =>
    duplicateProject(id, name),
  )
  ipcMain.handle('project:importFolder', (_event, requested?: string) =>
    importPackFolder(requested),
  )
  ipcMain.handle(
    'project:scanBatchSourceFolder',
    (_event, requested: string | undefined, packCount: number) =>
      scanBatchSourceFolder(requested, packCount),
  )
  ipcMain.handle('project:hydratePackCells', (_event, cells: ProjectPackCell[]) =>
    hydratePackCells(cells),
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
        filters: [
          { name: '所有支援的格式', extensions: ['clip', 'procreate', 'psd', 'psb'] },
          { name: 'Clip Studio Paint', extensions: ['clip'] },
          { name: 'Procreate', extensions: ['procreate'] },
          { name: 'Photoshop', extensions: ['psd', 'psb'] },
        ],
      })
      if (picked.canceled || !picked.filePaths[0]) return null
      filePath = picked.filePaths[0]
    }
    const doc = await parseSource(filePath, await readFile(filePath))
    documents.set(filePath, doc)
    currentPath = filePath
    return {
      filePath,
      canvas: doc.canvas,
      timeline: doc.timeline,
      tree: node(doc.root),
      cspTimelines: doc.cspTimelines,
      cspTimelineGroups: doc.cspTimelineGroups,
    }
  })
  ipcMain.handle('clip:openBuffer', async (_event, bytes: Uint8Array): Promise<ClipSummary> => {
    const filePath = `dropped-${Date.now()}.clip`
    const doc = await parseSource('dropped.clip', Buffer.from(bytes))
    documents.set(filePath, doc)
    currentPath = ''
    return {
      filePath,
      canvas: doc.canvas,
      timeline: doc.timeline,
      tree: node(doc.root),
      cspTimelines: doc.cspTimelines,
      cspTimelineGroups: doc.cspTimelineGroups,
    }
  })
  ipcMain.handle(
    'clip:render',
    async (_event, filePath: string, layerId: number, overrides: Array<[number, boolean]>) => {
      const current = await documentFor(filePath)
      const key = visibilityKey(filePath, layerId, overrides)
      const cached = rendered.get(key)
      if (cached) return cached
      const bitmap = current.renderNode(layerId, new Map(overrides))
      const value = {
        width: bitmap.width,
        height: bitmap.height,
        rgba: new Uint8Array(bitmap.data),
      }
      rendered.set(key, value)
      return value
    },
  )
  ipcMain.handle('export:save', async (_event, payload: ExportPayload): Promise<ExportResult> => {
    try {
      const extension = payload.format === 'gif' ? 'gif' : 'png'
      const picked = await dialog.showSaveDialog(getWindow() ?? (undefined as never), {
        defaultPath: currentPath
          ? join(dirname(currentPath), `${timestampName()}.${extension}`)
          : `${timestampName()}.${extension}`,
        filters: [
          {
            name:
              payload.format === 'gif' ? 'GIF' : payload.format === 'png' ? 'PNG' : 'Animated PNG',
            extensions: [extension],
          },
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
  ipcMain.handle('export:saveMulti', (_event, payloads) =>
    writeMultiExport(getWindow, undefined, payloads),
  )
  ipcMain.handle('export:multiTo', (_event, folder: string, payloads) =>
    writeMultiExport(getWindow, folder, payloads),
  )
  ipcMain.handle('export:saveMultiZip', (_event, payloads) => saveMultiZip(getWindow, payloads))
  ipcMain.handle(
    'pack:readImage',
    async (_event, source: { filePath?: string; bytes?: Uint8Array }): Promise<PackEncoded> => {
      const bytes = source.filePath
        ? new Uint8Array(await readFile(source.filePath))
        : new Uint8Array(source.bytes ?? [])
      // pngInfo 會擋掉非 PNG，錯誤訊息直接回給使用者。
      const info = pngInfo(bytes)
      return {
        pngBase64: Buffer.from(bytes).toString('base64'),
        mime: 'image/png',
        byteLength: bytes.length,
        ...info,
      }
    },
  )
  ipcMain.handle('pack:encode', (_event, payload: ExportPayload): PackEncoded => {
    const encoded = encodeExport(payload)
    return {
      pngBase64: Buffer.from(encoded.bytes).toString('base64'),
      mime: payload.format === 'gif' ? 'image/gif' : 'image/png',
      width: payload.width,
      height: payload.height,
      byteLength: encoded.byteLength,
      frameCount: encoded.info?.numFrames ?? 1,
    }
  })
  ipcMain.handle('drafts:pick', async (): Promise<string | null> => {
    const picked = await dialog.showOpenDialog(getWindow() ?? (undefined as never), {
      properties: ['openDirectory'],
      defaultPath: (await getDraftFolder()) || undefined,
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    await setDraftFolder(picked.filePaths[0])
    return picked.filePaths[0]
  })
  ipcMain.handle('drafts:list', async (_event, folder?: string): Promise<DraftListing | null> => {
    const target = folder ?? (await getDraftFolder())
    if (!target) return { folder: '', entries: [] }
    if (folder) await setDraftFolder(folder)
    const entries = []
    for (const entry of await readdir(target, { withFileTypes: true })) {
      if (!entry.isFile() || !isSupported(entry.name)) continue
      const filePath = join(target, entry.name)
      const info = await stat(filePath)
      entries.push({
        filePath,
        name: entry.name,
        kind: SUPPORTED[extname(entry.name).toLowerCase()] ?? '',
        byteLength: info.size,
        modifiedAt: info.mtime.toISOString(),
      })
    }
    entries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    return { folder: target, entries }
  })
}
