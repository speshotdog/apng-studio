import type { ExportTarget } from '../codec/line.js'

export interface SourceAsset {
  id: string
  path: string
  name: string
}

/** 一條圖層軌道的存檔格式；跟 renderer 的 Track 對齊。 */
export interface StoredTrack {
  id: string
  name: string
  visible: boolean
  opacity: number
  zoom: number
  offsetX: number
  offsetY: number
  slots: { sourceId?: string | null; layerId: number | null }[]
}

/** v0.1～v1 的編輯器快照。只供舊檔升級，v2 不再於文件內複製 sources。 */
export interface EditorState {
  sources?: SourceAsset[]
  activeSourceId?: string
  tracks?: StoredTrack[]
  slots?: { sourceId?: string | null; layerId: number | null }[]
  zoom?: number
  offsetX?: number
  offsetY?: number
  visibility: Array<[string | number, boolean]>
  fps: number
  playCount: number
  format: 'apng' | 'gif' | 'png'
  lineTarget: ExportTarget
  exportWidth: number
  exportHeight: number
  lockAspect: boolean
  scaleMode: 'smooth' | 'pixel'
  mergeIdentical: boolean
  staticFrame?: number
  gifColors?: number
}

/** v2 的可編輯文件；素材只以 sourceId 引用專案層 sources。 */
export interface EditorDocument {
  tracks: StoredTrack[]
  visibility: Array<[string, boolean]>
  fps: number
  playCount: number
  format: 'apng' | 'gif' | 'png'
  lineTarget: ExportTarget
  exportWidth: number
  exportHeight: number
  lockAspect: boolean
  scaleMode: 'smooth' | 'pixel'
  mergeIdentical: boolean
  staticFrame: number
  gifColors: number
  activeSourceId?: string
  contentRevision: number
}

export interface EncodedDocumentCache {
  base64: string
  mime: string
  width: number
  height: number
  byteLength: number
  frameCount: number
  renderedRevision: number
}

export type PackCellIndex = number | 'main' | 'tab'

export interface ExternalImagePackCell {
  kind: 'external'
  index: PackCellIndex
  sourcePath?: string
  pngBase64?: string
  width?: number
  height?: number
  byteLength?: number
  frameCount?: number
}

export interface DocumentPackCell {
  kind: 'document'
  index: PackCellIndex
  documentId: string
  encoded?: EncodedDocumentCache
}

export type ProjectPackCell = ExternalImagePackCell | DocumentPackCell

/** 專案清單用的輕量資訊，不含狀態本體。 */
export interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  sourcePath: string
  sourceName: string
  hasAutosave: boolean
  autosaveAt: string | null
}

export interface ProjectListItem extends ProjectMeta {
  thumbnail: string | null
}

/** v2 專案檔。所有新存檔只允許寫這個格式。 */
export interface ProjectBlob {
  version: 2
  sources: SourceAsset[]
  editorDocuments: Record<string, EditorDocument>
  standaloneDocumentId: string
  pack?: {
    target: ExportTarget
    count: number
    cells: ProjectPackCell[]
  }
}

/** v0.1／v0.2 的舊存檔格式，只在匯入與正規化時用得到。 */
export interface ProjectSnapshot {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  clipPath: string
  clipName: string
  thumbnail: string
  state: EditorState
  pack?: LegacyPack
}

export interface PackCellEditor {
  sourceId?: string
  clipPath?: string
  clipName?: string
  state: EditorState
}

export interface LegacyPackCell {
  index: PackCellIndex
  sourcePath?: string
  pngBase64?: string
  width?: number
  height?: number
  byteLength?: number
  frameCount?: number
  editor?: PackCellEditor
}

export interface LegacyPack {
  target: ExportTarget
  count: number
  cells: LegacyPackCell[]
}

/** renderer 中已解碼、可直接顯示或匯出的格子。 */
export interface PackImportCell {
  index: PackCellIndex
  sourcePath: string
  pngBase64: string
  width: number
  height: number
  byteLength: number
  frameCount: number
  documentId?: string
  renderedRevision?: number
  mime?: string
}

export interface PackImportResult {
  cells: PackImportCell[]
  skipped: string[]
}
