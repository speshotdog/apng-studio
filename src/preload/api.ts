import type { ApngInfo } from '../codec/apng.js'
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
  format: 'apng' | 'gif'
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
  onMenuCommand(callback: (command: 'open' | 'export-apng' | 'export-gif') => void): () => void
}
