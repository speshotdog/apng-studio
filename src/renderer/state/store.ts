import { create } from 'zustand'
import type { ClipSummary, LayerNode } from '../../preload/api.js'
export type ScaleMode = 'smooth' | 'pixel'
export interface Slot {
  layerId: number | null
}
interface State {
  doc: ClipSummary | null
  bitmaps: Map<string, ImageBitmap>
  visibility: Map<number, boolean>
  slots: Slot[]
  selectedSlot: number
  fps: number
  playCount: number
  previewLoop: boolean
  format: 'apng' | 'gif'
  exportWidth: number
  exportHeight: number
  lockAspect: boolean
  scaleMode: ScaleMode
  mergeIdentical: boolean
  linePreset: boolean
  playing: boolean
  playhead: number
  gifColors: number
  gifDither: boolean
  notice: string
  set: (values: Partial<State>) => void
  open: (doc: ClipSummary) => void
  setBitmap: (key: string, bitmap: ImageBitmap) => void
  setSlot: (index: number, layerId: number | null) => void
  resolveSlot: (index: number) => number | null
  importCspTimeline: (timelineIndex: number) => void
}
function collect(node: LayerNode, map: Map<number, boolean>): void {
  map.set(node.id, node.visible)
  node.children.forEach((child) => collect(child, map))
}
export const useStore = create<State>((set, get) => ({
  doc: null,
  bitmaps: new Map(),
  visibility: new Map(),
  slots: Array.from({ length: 8 }, () => ({ layerId: null })),
  selectedSlot: 0,
  fps: 12,
  playCount: 1,
  previewLoop: true,
  format: 'apng',
  exportWidth: 270,
  exportHeight: 270,
  lockAspect: true,
  scaleMode: 'smooth',
  mergeIdentical: true,
  linePreset: true,
  playing: false,
  playhead: 0,
  gifColors: 256,
  gifDither: false,
  notice: '',
  set,
  open: (doc) => {
    const visibility = new Map<number, boolean>()
    collect(doc.tree, visibility)
    set({
      doc,
      visibility,
      bitmaps: new Map(),
      slots: Array.from({ length: 8 }, () => ({ layerId: null })),
      selectedSlot: 0,
      playhead: 0,
      playing: false,
      fps: doc.timeline?.frameRate ?? 12,
      exportWidth: doc.canvas.width,
      exportHeight: doc.canvas.height,
    })
  },
  setBitmap: (id, bitmap) => set((state) => ({ bitmaps: new Map(state.bitmaps).set(id, bitmap) })),
  setSlot: (index, layerId) =>
    set((state) => ({ slots: state.slots.map((slot, i) => (i === index ? { layerId } : slot)) })),
  resolveSlot: (index) => {
    const slots = get().slots
    for (let i = Math.min(index, slots.length - 1); i >= 0; i--) {
      const slot = slots[i]
      if (slot && slot.layerId !== null) return slot.layerId
    }
    return null
  },
  importCspTimeline: (timelineIndex) => {
    const state = get()
    const timeline = state.doc?.cspTimelines[timelineIndex]
    if (!timeline || !state.doc) return
    const folder = (() => {
      const visit = (node: LayerNode): LayerNode | undefined =>
        node.id === timeline.animationFolderId
          ? node
          : node.children.map(visit).find((child) => child !== undefined)
      return visit(state.doc.tree)
    })()
    const byName = new Map(folder?.children.map((child) => [child.name, child.id]) ?? [])
    const slots = Array.from({ length: timeline.frameCount }, () => ({
      layerId: null as number | null,
    }))
    const missing = new Set<string>()
    for (const key of timeline.keys) {
      const layerId = byName.get(key.celName)
      if (key.frame < 0 || key.frame >= slots.length) continue
      if (layerId === undefined) missing.add(key.celName)
      else slots[key.frame] = { layerId }
    }
    const warnings = [...timeline.warnings]
    if (missing.size) warnings.push(`找不到 cel：${[...missing].join('、')}`)
    set({
      slots,
      fps: timeline.frameRate,
      selectedSlot: 0,
      playhead: 0,
      playing: false,
      notice: `已帶入 CSP 時間軸：${timeline.frameCount} 格 @ ${timeline.frameRate} FPS，${timeline.keys.length} 個關鍵影格${warnings.length ? `；${warnings.join('；')}` : ''}`,
    })
  },
}))
