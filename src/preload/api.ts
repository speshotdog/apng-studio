import type { ApngInfo } from '../codec/apng.js'
import type { PackImportResult, ProjectSnapshot } from '../project/types.js'
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
}
export interface ExportPayload {
  format: 'apng' | 'gif' | 'png'
  width: number
  height: number
  frames: { rgba: Uint8Array; delayMs: number }[]
  numPlays: number
  mergeIdentical: boolean
  gif?: { maxColors: number }
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
  encryptionAvailable: boolean
  progressExpanded: boolean
  draftFolder: string
}
export type MenuCommand = 'open' | 'new' | 'drafts' | 'export-apng' | 'export-gif' | 'settings'
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
  renderLayer(layerId: number, overrides: Array<[number, boolean]>): Promise<RenderedLayer>
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
  listProjects(): Promise<ProjectSnapshot[]>
  saveProject(snapshot: ProjectSnapshot): Promise<ProjectSnapshot[]>
  deleteProject(id: string): Promise<ProjectSnapshot[]>
  renameProject(id: string, name: string): Promise<ProjectSnapshot[]>
  importPackFolder(path?: string): Promise<PackImportResult | null>
  hydratePackCells(
    cells: NonNullable<ProjectSnapshot['pack']>['cells'],
  ): Promise<PackImportResult['cells']>
  exportPack(
    filePath: string | undefined,
    cells: PackImportResult['cells'],
    target?: import('../codec/line.js').ExportTarget,
  ): Promise<ExportResult>
  listDrafts(folder?: string): Promise<DraftListing | null>
  pickDraftFolder(): Promise<string | null>
  encodeForPack(payload: ExportPayload): Promise<PackEncoded>
  getSettings(): Promise<PublicSettings>
  setGiphy(key: string, username: string): Promise<{ ok: boolean; error?: string }>
  clearGiphy(): Promise<void>
  testGiphy(): Promise<{ ok: boolean; message: string }>
  setProgressExpanded(expanded: boolean): Promise<void>
  uploadGiphy(payload: { gifBytes: Uint8Array; tags: string }): Promise<GiphyUploadResult>
  openExternal(url: string): Promise<void>
  onMenuCommand(callback: (command: MenuCommand) => void): () => void
}
