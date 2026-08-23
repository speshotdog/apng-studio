import { create } from 'zustand'
import type { ClipSummary, LayerNode } from '../../preload/api.js'
import type { ExportTarget } from '../../codec/line.js'
import type { PackImportCell, ProjectMeta } from '../../project/types.js'
export type ScaleMode = 'smooth' | 'pixel'
export interface Slot {
  layerId: number | null
}
/**
 * 一條軌道 = 一個圖層。陣列順序照 Photoshop 的習慣：tracks[0] 在最上面（最後畫），
 * 合成時從最後一條往前畫。每條軌道有自己的影格內容與畫面調整。
 */
export interface Track {
  id: string
  name: string
  visible: boolean
  opacity: number
  zoom: number
  offsetX: number
  offsetY: number
  slots: Slot[]
}
export type ToastLevel = 'success' | 'error' | 'info'
export interface Toast {
  id: number
  level: ToastLevel
  text: string
}
export type TargetSettings = Pick<
  State,
  'format' | 'exportWidth' | 'exportHeight' | 'lockAspect' | 'fps' | 'playCount' | 'scaleMode'
> & {
  staticFrame: number
  gifColors: number
  /** 切換輸出目標時記住的畫面調整，套用在當時作用中的軌道上。 */
  zoom: number
  offsetX: number
  offsetY: number
}

/** 會被 undo／重做與「未存檔」判斷追蹤的編輯內容。 */
export interface EditSnapshot {
  tracks: Track[]
  activeTrack: number
  fps: number
  playCount: number
  format: 'apng' | 'gif' | 'png'
  exportWidth: number
  exportHeight: number
  visibility: Array<[number, boolean]>
  trimmed: Record<string, Slot[]>
}

export interface State {
  /** 啟動先停在專案選擇畫面，選定或建立專案後才進編輯器。 */
  screen: 'start' | 'editor'
  /** 目前開著的專案；編輯器裡任何存檔都是存回這一份，不會再問要存到哪。 */
  project: ProjectMeta | null
  doc: ClipSummary | null
  bitmaps: Map<string, ImageBitmap>
  visibility: Map<number, boolean>
  tracks: Track[]
  activeTrack: number
  /** 在目前軌道上被選取的影格索引，用於批次拖曳。 */
  selection: number[]
  selectedSlot: number
  fps: number
  playCount: number
  previewLoop: boolean
  format: 'apng' | 'gif' | 'png'
  staticFrame: number
  exportWidth: number
  exportHeight: number
  lockAspect: boolean
  scaleMode: ScaleMode
  mergeIdentical: boolean
  linePreset: boolean
  lineTarget: ExportTarget
  playing: boolean
  playhead: number
  gifColors: number
  targetSettings: Partial<Record<ExportTarget, TargetSettings>>
  mode: 'animation' | 'pack'
  packTarget: ExportTarget
  packCount: number
  packCells: PackImportCell[]
  toasts: Toast[]
  /** 減少格數時暫存被切掉的尾巴，重新加回來時不用重拉。 */
  trimmed: Record<string, Slot[]>
  past: EditSnapshot[]
  future: EditSnapshot[]
  dirty: boolean
  set: (values: Partial<State>) => void
  toast: (level: ToastLevel, text: string) => void
  dismissToast: (id: number) => void
  open: (doc: ClipSummary) => void
  reset: () => void
  setBitmap: (key: string, bitmap: ImageBitmap) => void
  setSlot: (index: number, layerId: number | null) => void
  resolveSlot: (index: number, trackIndex?: number) => number | null
  frameCount: () => number
  resizeFrames: (count: number) => void
  setTrack: (index: number, patch: Partial<Track>) => void
  clearCanvas: () => void
  addTrack: () => void
  removeTrack: (index: number) => void
  moveTrack: (from: number, to: number) => void
  commit: () => void
  undo: () => void
  redo: () => void
  importCspTimeline: (timelineIndex: number) => void
}

function collect(node: LayerNode, map: Map<number, boolean>): void {
  map.set(node.id, node.visible)
  node.children.forEach((child) => collect(child, map))
}

export function newTrack(name: string, frames: number): Track {
  return {
    id: crypto.randomUUID(),
    name,
    visible: true,
    opacity: 1,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    slots: Array.from({ length: frames }, () => ({ layerId: null })),
  }
}

function snapshot(state: State): EditSnapshot {
  return {
    tracks: state.tracks.map((track) => ({ ...track, slots: track.slots.map((s) => ({ ...s })) })),
    activeTrack: state.activeTrack,
    fps: state.fps,
    playCount: state.playCount,
    format: state.format,
    exportWidth: state.exportWidth,
    exportHeight: state.exportHeight,
    visibility: [...state.visibility],
    trimmed: state.trimmed,
  }
}

const HISTORY_LIMIT = 60
let toastId = 0

/** 改到這些欄位就算「有未存檔的變更」，換檔／開新專案前要先提醒。 */
const DIRTY_KEYS: ReadonlyArray<keyof State> = [
  'tracks',
  'fps',
  'playCount',
  'format',
  'exportWidth',
  'exportHeight',
  'lineTarget',
  'scaleMode',
  'mergeIdentical',
  'gifColors',
  'staticFrame',
  'packCells',
  'visibility',
]

const makeInitial = () => ({
  doc: null as ClipSummary | null,
  bitmaps: new Map<string, ImageBitmap>(),
  visibility: new Map<number, boolean>(),
  tracks: [newTrack('圖層 1', 8)],
  activeTrack: 0,
  selection: [] as number[],
  selectedSlot: 0,
  fps: 12,
  playCount: 1,
  previewLoop: true,
  format: 'apng' as const,
  staticFrame: 0,
  exportWidth: 270,
  exportHeight: 270,
  lockAspect: true,
  scaleMode: 'smooth' as ScaleMode,
  mergeIdentical: true,
  linePreset: true,
  lineTarget: 'sticker' as ExportTarget,
  playing: false,
  playhead: 0,
  gifColors: 256,
  targetSettings: {},
  mode: 'animation' as const,
  packTarget: 'staticSticker' as ExportTarget,
  packCount: 32,
  packCells: [] as PackImportCell[],
  trimmed: {} as Record<string, Slot[]>,
  past: [] as EditSnapshot[],
  future: [] as EditSnapshot[],
  dirty: false,
})

export const useStore = create<State>((set, get) => ({
  ...makeInitial(),
  screen: 'start' as const,
  project: null as ProjectMeta | null,
  toasts: [],
  set: (values) =>
    set(
      'dirty' in values ||
        !Object.keys(values).some((key) => DIRTY_KEYS.includes(key as keyof State))
        ? values
        : { ...values, dirty: true },
    ),
  toast: (level, text) =>
    set((state) => ({ toasts: [...state.toasts, { id: ++toastId, level, text }] })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  open: (doc) => {
    const visibility = new Map<number, boolean>()
    collect(doc.tree, visibility)
    set({
      ...makeInitial(),
      toasts: get().toasts,
      screen: get().screen,
      project: get().project,
      doc,
      visibility,
      tracks: [newTrack('圖層 1', 8)],
      fps: doc.timeline?.frameRate ?? 12,
      exportWidth: doc.canvas.width,
      exportHeight: doc.canvas.height,
    })
  },
  reset: () =>
    set({
      ...makeInitial(),
      toasts: get().toasts,
      screen: get().screen,
      project: get().project,
    }),
  setBitmap: (id, bitmap) => set((state) => ({ bitmaps: new Map(state.bitmaps).set(id, bitmap) })),
  setSlot: (index, layerId) => {
    get().commit()
    set((state) => ({
      tracks: state.tracks.map((track, i) =>
        i === state.activeTrack
          ? { ...track, slots: track.slots.map((s, j) => (j === index ? { layerId } : s)) }
          : track,
      ),
    }))
  },
  resolveSlot: (index, trackIndex) => {
    const state = get()
    const slots = state.tracks[trackIndex ?? state.activeTrack]?.slots ?? []
    for (let i = Math.min(index, slots.length - 1); i >= 0; i--) {
      const slot = slots[i]
      if (slot && slot.layerId !== null) return slot.layerId
    }
    return null
  },
  frameCount: () => Math.max(1, ...get().tracks.map((track) => track.slots.length)),
  resizeFrames: (count) => {
    const state = get()
    const next = Math.max(1, Math.min(240, Math.round(count) || 1))
    const current = state.frameCount()
    if (next === current) return
    state.commit()
    const trimmed = { ...state.trimmed }
    const tracks = state.tracks.map((track) => {
      if (next < track.slots.length) {
        // 先把切掉的尾巴收起來，等使用者加回格數時原封不動放回去。
        trimmed[track.id] = [...track.slots.slice(next), ...(trimmed[track.id] ?? [])]
        return { ...track, slots: track.slots.slice(0, next) }
      }
      const cache = trimmed[track.id] ?? []
      const restored = cache.slice(0, next - track.slots.length)
      trimmed[track.id] = cache.slice(restored.length)
      return {
        ...track,
        slots: [
          ...track.slots,
          ...restored,
          ...Array.from({ length: next - track.slots.length - restored.length }, () => ({
            layerId: null,
          })),
        ],
      }
    })
    set({
      tracks,
      trimmed,
      selectedSlot: Math.min(state.selectedSlot, next - 1),
      playhead: Math.min(state.playhead, next - 1),
      staticFrame: Math.min(state.staticFrame, next - 1),
      selection: state.selection.filter((index) => index < next),
    })
  },
  clearCanvas: () => {
    const state = get()
    state.commit()
    set({
      tracks: [newTrack('圖層 1', state.frameCount())],
      activeTrack: 0,
      selection: [],
      selectedSlot: 0,
      playhead: 0,
      staticFrame: 0,
      playing: false,
      trimmed: {},
    })
  },
  setTrack: (index, patch) =>
    set((state) => ({
      tracks: state.tracks.map((track, i) => (i === index ? { ...track, ...patch } : track)),
      dirty: true,
    })),
  addTrack: () => {
    const state = get()
    state.commit()
    const track = newTrack(`圖層 ${state.tracks.length + 1}`, state.frameCount())
    set({ tracks: [track, ...state.tracks], activeTrack: 0 })
  },
  removeTrack: (index) => {
    const state = get()
    if (state.tracks.length <= 1) return
    state.commit()
    set({
      tracks: state.tracks.filter((_, i) => i !== index),
      activeTrack: Math.max(0, Math.min(state.activeTrack, state.tracks.length - 2)),
      selection: [],
    })
  },
  moveTrack: (from, to) => {
    const state = get()
    if (from === to || to < 0 || to >= state.tracks.length) return
    state.commit()
    const tracks = state.tracks.slice()
    const [moved] = tracks.splice(from, 1)
    tracks.splice(to, 0, moved!)
    set({ tracks, activeTrack: to })
  },
  commit: () =>
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    })),
  undo: () => {
    const state = get()
    const previous = state.past.at(-1)
    if (!previous) return
    set({
      ...previous,
      visibility: new Map(previous.visibility),
      past: state.past.slice(0, -1),
      future: [...state.future, snapshot(state)].slice(-HISTORY_LIMIT),
      selection: [],
      playing: false,
      selectedSlot: Math.min(state.selectedSlot, previous.tracks[0]!.slots.length - 1),
      playhead: 0,
    })
  },
  redo: () => {
    const state = get()
    const next = state.future.at(-1)
    if (!next) return
    set({
      ...next,
      visibility: new Map(next.visibility),
      future: state.future.slice(0, -1),
      past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      selection: [],
      playing: false,
    })
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
    state.commit()
    set({
      tracks: state.tracks.map((track, index) =>
        index === state.activeTrack
          ? { ...track, slots }
          : {
              ...track,
              slots: Array.from(
                { length: timeline.frameCount },
                (_, i) => track.slots[i] ?? { layerId: null },
              ),
            },
      ),
      fps: timeline.frameRate,
      selectedSlot: 0,
      playhead: 0,
      playing: false,
      selection: [],
    })
    state.toast(
      warnings.length ? 'info' : 'success',
      `已帶入 CSP 時間軸：${timeline.frameCount} 格 @ ${timeline.frameRate} FPS，${timeline.keys.length} 個關鍵影格${warnings.length ? `；${warnings.join('；')}` : ''}`,
    )
  },
}))

/** 目前作用中的軌道；元件裡最常用到，集中在這裡避免每個地方各寫一次防呆。 */
export function activeTrack(state: State): Track {
  return state.tracks[state.activeTrack] ?? state.tracks[0]!
}
