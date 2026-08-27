import type { ApngInfo } from '../codec/apng.js'
import type { GifMatte } from '../codec/gif.js'
import type {
  BatchFolderScanResult,
  PackImportResult,
  ProjectBlob,
  ProjectListItem,
  ProjectMeta,
  ProjectPackCell,
} from '../project/types.js'
export interface LayerNode {
  id: number
  name: string
  type: number
  isFolder: boolean
  isAnimationFolder: boolean
  visible: boolean
  opacity: number
  children: LayerNode[]
}
export interface ClipSummary {
  filePath: string
  canvas: { width: number; height: number; resolution: number }
  timeline: { frameRate: number; startFrame: number; endFrame: number; name: string } | null
  tree: LayerNode
  cspTimelines: Array<{
    animationFolderId: number
    animationFolderName: string
    frameRate: number
    frameCount: number
    keys: Array<{ frame: number; celName: string }>
    warnings: string[]
  }>
  cspTimelineGroups: Array<{
    name: string
    frameRate: number
    startFrame: number
    endFrame: number
    tracks: ClipSummary['cspTimelines']
  }>
}
export interface ExportPayload {
  format: 'apng' | 'gif' | 'png'
  width: number
  height: number
  frames: { rgba: Uint8Array; delayMs: number }[]
  numPlays: number
  mergeIdentical: boolean
  gif?: { maxColors: number; matte: GifMatte | null }
}
export interface ExportResult {
  ok: boolean
  filePath?: string
  info?: ApngInfo
  warnings: string[]
  error?: string
  byteLength?: number
  files?: Array<{ filePath: string; byteLength: number; warnings: string[] }>
}
export interface PublicSettings {
  hasGiphyKey: boolean
  giphyUsername: string
  giphyRecentTags: string[]
  encryptionAvailable: boolean
  progressExpanded: boolean
  draftFolder: string
}
export type MenuCommand =
  'open' | 'new' | 'drafts' | 'save' | 'projects' | 'export-apng' | 'export-gif' | 'settings'
export type FrameContextAction = 'clear-and-continue' | 'freeze' | 'insert' | 'delete'
/** 草稿資料夾裡的一個可開啟檔案。 */
export interface DraftEntry {
  filePath: string
  name: string
  kind: string
  byteLength: number
  modifiedAt: string
}
export interface DraftListing {
  folder: string
  entries: DraftEntry[]
}
/** 存進貼圖組時，主程序回傳的編碼結果。 */
export interface PackEncoded {
  pngBase64: string
  mime?: string
  width: number
  height: number
  byteLength: number
  frameCount: number
}
export interface GiphyUploadResult {
  ok: boolean
  id?: string
  pageUrl?: string
  gifUrl?: string
  error?: string
}
export interface RenderedLayer {
  width: number
  height: number
  rgba: Uint8Array
}
export interface Api {
  openClip(filePath?: string): Promise<ClipSummary | null>
  openClipBuffer(bytes: Uint8Array): Promise<ClipSummary>
  getPathForFile(file: File): string
  renderLayer(
    filePath: string,
    layerId: number,
    overrides: Array<[number, boolean]>,
  ): Promise<RenderedLayer>
  saveExport(payload: ExportPayload): Promise<ExportResult>
  exportTo(filePath: string, payload: ExportPayload): Promise<ExportResult>
  saveMultiExport(
    payloads: Array<{ suffix: string; payload: ExportPayload }>,
  ): Promise<ExportResult>
  exportMultiTo(
    folderPath: string,
    payloads: Array<{ suffix: string; payload: ExportPayload }>,
  ): Promise<ExportResult>
  saveMultiZip(payloads: Array<{ suffix: string; payload: ExportPayload }>): Promise<ExportResult>
  listProjects(): Promise<ProjectListItem[]>
  readProject(id: string): Promise<ProjectBlob | null>
  createProject(input: {
    name: string
    sourcePath: string
    sourceName: string
    state: ProjectBlob
    thumbnailDataUrl?: string
  }): Promise<ProjectMeta>
  saveProject(id: string, state: ProjectBlob, thumbnailDataUrl?: string): Promise<ProjectMeta>
  autosaveProject(id: string, state: ProjectBlob): Promise<void>
  readProjectAutosave(id: string): Promise<{ state: ProjectBlob; savedAt: string } | null>
  discardProjectAutosave(id: string): Promise<void>
  deleteProject(id: string): Promise<ProjectMeta[]>
  renameProject(id: string, name: string): Promise<ProjectMeta[]>
  duplicateProject(id: string, name: string): Promise<ProjectMeta>
  importPackFolder(path?: string): Promise<PackImportResult | null>
  scanBatchSourceFolder(
    path: string | undefined,
    packCount: number,
  ): Promise<BatchFolderScanResult | null>
  hydratePackCells(cells: ProjectPackCell[]): Promise<PackImportResult['cells']>
  exportPack(
    filePath: string | undefined,
    cells: PackImportResult['cells'],
    target?: import('../codec/line.js').ExportTarget,
  ): Promise<ExportResult>
  listDrafts(folder?: string): Promise<DraftListing | null>
  pickDraftFolder(): Promise<string | null>
  encodeForPack(payload: ExportPayload): Promise<PackEncoded>
  readPackImage(source: { filePath?: string; bytes?: Uint8Array }): Promise<PackEncoded>
  getSettings(): Promise<PublicSettings>
  setGiphy(key: string, username: string): Promise<{ ok: boolean; error?: string }>
  clearGiphy(): Promise<void>
  testGiphy(): Promise<{ ok: boolean; message: string }>
  addRecentTags(tags: string[]): Promise<void>
  setProgressExpanded(expanded: boolean): Promise<void>
  uploadGiphy(payload: { gifBytes: Uint8Array; tags: string }): Promise<GiphyUploadResult>
  openExternal(url: string): Promise<void>
  openPath(filePath: string): Promise<string>
  showFrameContextMenu(targetCount: number): Promise<FrameContextAction | null>
  setDirty(dirty: boolean): void
  onMenuCommand(callback: (command: MenuCommand) => void): () => void
}
