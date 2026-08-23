import type { ExportTarget } from '../codec/line.js'

/** 一條圖層軌道的存檔格式；跟 renderer 的 Track 對齊。 */
export interface StoredTrack {
  id: string
  name: string
  visible: boolean
  opacity: number
  zoom: number
  offsetX: number
  offsetY: number
  slots: { layerId: number | null }[]
}

export interface EditorState {
  /** v0.2 起用軌道；舊檔沒有這欄，讀取時由 slots + zoom/offset 轉出來。 */
  tracks?: StoredTrack[]
  /** v0.1 舊檔的單軌影格。 */
  slots?: { layerId: number | null }[]
  zoom?: number
  offsetX?: number
  offsetY?: number
  visibility: Array<[number, boolean]>
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

/** 專案清單用的輕量資訊，不含狀態本體。 */
export interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  sourcePath: string
  sourceName: string
  /** 有沒有比正式存檔更新的自動存檔 */
  hasAutosave: boolean
  autosaveAt: string | null
}

/** 專案清單項目（附縮圖 data URL）。 */
export interface ProjectListItem extends ProjectMeta {
  thumbnail: string | null
}

/** 一個專案完整存下來的東西。 */
export interface ProjectBlob {
  state: EditorState
  pack?: {
    target: ExportTarget
    count: number
    cells: Array<{
      index: number | 'main' | 'tab'
      sourcePath?: string
      pngBase64?: string
      editor?: PackCellEditor
    }>
  }
}

/** v0.1／v0.2 的舊存檔格式，只在匯入時用得到。 */
export interface ProjectSnapshot {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  clipPath: string
  clipName: string
  thumbnail: string
  state: EditorState
  pack?: {
    target: ExportTarget
    count: number
    cells: Array<{
      index: number | 'main' | 'tab'
      sourcePath?: string
      pngBase64?: string
      editor?: PackCellEditor
    }>
  }
}

/** 從「單張動畫」存進貼圖組時一併帶著的編輯狀態，讓使用者能點回去繼續改。 */
export interface PackCellEditor {
  clipPath: string
  clipName: string
  state: EditorState
}

export interface PackImportCell {
  index: number | 'main' | 'tab'
  sourcePath: string
  pngBase64: string
  width: number
  height: number
  byteLength: number
  frameCount: number
  editor?: PackCellEditor
}

export interface PackImportResult {
  cells: PackImportCell[]
  skipped: string[]
}
