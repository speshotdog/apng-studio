import type { ExportTarget } from '../codec/line.js'

export interface ProjectSnapshot {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  clipPath: string
  clipName: string
  thumbnail: string
  state: {
    slots: { layerId: number | null }[]
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
    zoom: number
    offsetX: number
    offsetY: number
    staticFrame?: number
    gifColors?: number
  }
  pack?: {
    target: ExportTarget
    count: number
    cells: Array<{
      index: number | 'main' | 'tab'
      sourcePath?: string
      pngBase64?: string
    }>
  }
}

export interface PackImportCell {
  index: number | 'main' | 'tab'
  sourcePath: string
  pngBase64: string
  width: number
  height: number
  byteLength: number
  frameCount: number
}

export interface PackImportResult {
  cells: PackImportCell[]
  skipped: string[]
}
