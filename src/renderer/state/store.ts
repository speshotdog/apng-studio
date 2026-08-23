import { create } from 'zustand'
import type { ClipSummary, LayerNode } from '../../preload/api.js'
import type { ExportTarget } from '../../codec/line.js'
import type { PackImportCell, ProjectMeta, SourceAsset } from '../../project/types.js'

export type ScaleMode = 'smooth' | 'pixel'

export interface Slot {
  sourceId: string | null
  layerId: number | null
}

export interface ResolvedSlot {
  sourceId: string
  layerId: number
}

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
  zoom: number
  offsetX: number
  offsetY: number
}

export interface EditSnapshot {
  tracks: Track[]
  activeTrack: number
  fps: number
  playCount: number
  format: 'apng' | 'gif' | 'png'
  exportWidth: number
  exportHeight: number
  visibility: Array<[string, boolean]>
  trimmed: Record<string, Slot[]>
}

export interface State {
  screen: 'start' | 'editor'
  project: ProjectMeta | null
  sources: SourceAsset[]
  activeSourceId: string | null
  docs: Record<string, ClipSummary>
  doc: ClipSummary | null
  bitmaps: Map<string, ImageBitmap>
  visibility: Map<string, boolean>
  tracks: Track[]
  activeTrack: number
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
  trimmed: Record<string, Slot[]>
  past: EditSnapshot[]
  future: EditSnapshot[]
  dirty: boolean
  set: (values: Partial<State>) => void
  toast: (level: ToastLevel, text: string) => void
  dismissToast: (id: number) => void
  open: (doc: ClipSummary) => void
  loadSources: (
    sources: SourceAsset[],
    docs: Record<string, ClipSummary>,
    activeSourceId: string | null,
  ) => void
  addSource: (asset: SourceAsset, summary: ClipSummary) => void
  setActiveSource: (sourceId: string) => void
  removeSource: (sourceId: string) => void
  sourceOf: (sourceId: string | null) => SourceAsset | undefined
  /** 來源檔被搬走時換一個路徑，但保留 id，所有影格的引用都不用動。 */
  relinkSource: (sourceId: string, path: string, name: string, summary: ClipSummary) => void
  reset: () => void
  setBitmap: (key: string, bitmap: ImageBitmap) => void
  setSlot: (index: number, layerId: number | null) => void
  resolveSlot: (index: number, trackIndex?: number) => ResolvedSlot | null
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

function visibilityId(sourceId: string, layerId: number): string {
  return `${sourceId}:${layerId}`
}

function collect(sourceId: string, node: LayerNode, map: Map<string, boolean>): void {
  map.set(visibilityId(sourceId, node.id), node.visible)
  node.children.forEach((child) => collect(sourceId, child, map))
}

function assetFromSummary(doc: ClipSummary): SourceAsset {
  return {
    id: crypto.randomUUID(),
    path: doc.filePath,
    name: doc.filePath.split(/[\\/]/).at(-1) ?? doc.filePath,
  }
}

function emptySlot(): Slot {
  return { sourceId: null, layerId: null }
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
    slots: Array.from({ length: frames }, emptySlot),
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
    trimmed: Object.fromEntries(
      Object.entries(state.trimmed).map(([id, slots]) => [id, slots.map((slot) => ({ ...slot }))]),
    ),
  }
}

const HISTORY_LIMIT = 60
let toastId = 0

const DIRTY_KEYS: ReadonlyArray<keyof State> = [
  'tracks',
  'sources',
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
  'packTarget',
  'packCount',
  'lockAspect',
  'visibility',
  'sources',
  'activeSourceId',
]

const makeInitial = () => ({
  sources: [] as SourceAsset[],
  activeSourceId: null as string | null,
  docs: {} as Record<string, ClipSummary>,
  doc: null as ClipSummary | null,
  bitmaps: new Map<string, ImageBitmap>(),
  visibility: new Map<string, boolean>(),
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
    const asset = assetFromSummary(doc)
    const visibility = new Map<string, boolean>()
    collect(asset.id, doc.tree, visibility)
    set({
      ...makeInitial(),
      toasts: get().toasts,
      screen: get().screen,
      project: get().project,
      sources: [asset],
      activeSourceId: asset.id,
      docs: { [asset.id]: doc },
      doc,
      visibility,
      tracks: [newTrack('圖層 1', 8)],
      fps: doc.timeline?.frameRate ?? 12,
      exportWidth: doc.canvas.width,
      exportHeight: doc.canvas.height,
    })
  },
  loadSources: (sources, docs, activeSourceId) => {
    const visibility = new Map<string, boolean>()
    sources.forEach((source) => {
      const summary = docs[source.id]
      if (summary) collect(source.id, summary.tree, visibility)
    })
    const active =
      activeSourceId && docs[activeSourceId] ? activeSourceId : (sources[0]?.id ?? null)
    const doc = active ? (docs[active] ?? null) : null
    set({
      ...makeInitial(),
      toasts: get().toasts,
      screen: get().screen,
      project: get().project,
      sources,
      activeSourceId: active,
      docs,
      doc,
      visibility,
      fps: doc?.timeline?.frameRate ?? 12,
      exportWidth: doc?.canvas.width ?? 270,
      exportHeight: doc?.canvas.height ?? 270,
    })
  },
  addSource: (asset, summary) => {
    const state = get()
    const visibility = new Map(state.visibility)
    collect(asset.id, summary.tree, visibility)
    set({
      sources: [...state.sources.filter((source) => source.id !== asset.id), asset],
      activeSourceId: asset.id,
      docs: { ...state.docs, [asset.id]: summary },
      doc: summary,
      visibility,
      exportWidth: state.doc ? state.exportWidth : summary.canvas.width,
      exportHeight: state.doc ? state.exportHeight : summary.canvas.height,
      dirty: true,
    })
  },
  setActiveSource: (sourceId) => {
    const doc = get().docs[sourceId]
    if (!doc) return
    set({ activeSourceId: sourceId, doc })
  },
  removeSource: (sourceId) => {
    const state = get()
    if (!state.sources.some((source) => source.id === sourceId)) return
    const sources = state.sources.filter((source) => source.id !== sourceId)
    const docs = Object.fromEntries(
      Object.entries(state.docs).filter(([id]) => id !== sourceId),
    ) as Record<string, ClipSummary>
    const activeSourceId =
      state.activeSourceId === sourceId ? (sources[0]?.id ?? null) : state.activeSourceId
    const visibility = new Map(
      [...state.visibility].filter(([key]) => !key.startsWith(`${sourceId}:`)),
    )
    const bitmaps = new Map([...state.bitmaps].filter(([key]) => !key.startsWith(`${sourceId}:`)))
    const clearSlot = (slot: Slot): Slot => (slot.sourceId === sourceId ? emptySlot() : { ...slot })
    set({
      sources,
      activeSourceId,
      docs,
      doc: activeSourceId ? (docs[activeSourceId] ?? null) : null,
      visibility,
      bitmaps,
      tracks: state.tracks.map((track) => ({
        ...track,
        slots: track.slots.map(clearSlot),
      })),
      trimmed: Object.fromEntries(
        Object.entries(state.trimmed).map(([id, slots]) => [id, slots.map(clearSlot)]),
      ),
      // 貼圖組已經產生的 PNG 留著，但「點回去編輯」的連結要拿掉 ——
      // 素材都沒了，點下去只會找不到來源。
      packCells: state.packCells.map((cell) =>
        cell.editor?.sourceId === sourceId ? { ...cell, editor: undefined } : cell,
      ),
      // undo 快照不含素材庫，留著會讓人復原到「影格指向已刪素材」的壞狀態。
      past: [],
      future: [],
      selection: [],
      playing: false,
      dirty: true,
    })
  },
  sourceOf: (sourceId) => get().sources.find((source) => source.id === sourceId),
  relinkSource: (sourceId, path, name, summary) => {
    const state = get()
    if (!state.sources.some((source) => source.id === sourceId)) return
    const visibility = new Map(
      [...state.visibility].filter(([key]) => !key.startsWith(`${sourceId}:`)),
    )
    collect(sourceId, summary.tree, visibility)
    set({
      sources: state.sources.map((source) =>
        source.id === sourceId ? { ...source, path, name } : source,
      ),
      docs: { ...state.docs, [sourceId]: summary },
      doc: state.activeSourceId === sourceId ? summary : state.doc,
      visibility,
      // 換了檔案，舊的圖層縮圖不能再用。
      bitmaps: new Map([...state.bitmaps].filter(([key]) => !key.startsWith(`${sourceId}:`))),
      dirty: true,
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
    const state = get()
    state.commit()
    const sourceId = layerId === null ? null : state.activeSourceId
    set((current) => ({
      tracks: current.tracks.map((track, i) =>
        i === current.activeTrack
          ? {
              ...track,
              slots: track.slots.map((slot, j) => (j === index ? { sourceId, layerId } : slot)),
            }
          : track,
      ),
    }))
  },
  resolveSlot: (index, trackIndex) => {
    const state = get()
    const slots = state.tracks[trackIndex ?? state.activeTrack]?.slots ?? []
    for (let i = Math.min(index, slots.length - 1); i >= 0; i -= 1) {
      const slot = slots[i]
      const sourceId = slot?.sourceId ?? state.activeSourceId
      if (slot && sourceId && slot.layerId !== null) return { sourceId, layerId: slot.layerId }
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
        trimmed[track.id] = [
          ...track.slots.slice(next).map((slot) => ({ ...slot })),
          ...(trimmed[track.id] ?? []),
        ]
        return { ...track, slots: track.slots.slice(0, next) }
      }
      const cache = trimmed[track.id] ?? []
      const restored = cache.slice(0, next - track.slots.length)
      trimmed[track.id] = cache.slice(restored.length)
      return {
        ...track,
        slots: [
          ...track.slots,
          ...restored.map((slot) => ({ ...slot })),
          ...Array.from({ length: next - track.slots.length - restored.length }, emptySlot),
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
    const sourceId = state.activeSourceId
    const doc = sourceId ? state.docs[sourceId] : null
    const timeline = doc?.cspTimelines[timelineIndex]
    if (!timeline || !doc || !sourceId) return
    const folder = (() => {
      const visit = (node: LayerNode): LayerNode | undefined =>
        node.id === timeline.animationFolderId
          ? node
          : node.children.map(visit).find((child) => child !== undefined)
      return visit(doc.tree)
    })()
    // cel 只能靠名稱對應（CSP 沒有給我們穩定的 cel id），所以同名一定要講出來，
    // 不然使用者會拿到「看起來有帶入、但對到錯的圖層」這種最難查的結果。
    const byName = new Map<string, number>()
    const duplicated = new Set<string>()
    for (const child of folder?.children ?? []) {
      if (byName.has(child.name)) duplicated.add(child.name)
      else byName.set(child.name, child.id)
    }
    const slots = Array.from({ length: timeline.frameCount }, emptySlot)
    const missing = new Set<string>()
    let outOfRange = 0
    for (const key of timeline.keys) {
      const layerId = byName.get(key.celName)
      if (key.frame < 0 || key.frame >= slots.length) {
        outOfRange += 1
        continue
      }
      if (layerId === undefined) missing.add(key.celName)
      else slots[key.frame] = { sourceId, layerId }
    }
    const warnings = [...timeline.warnings]
    if (missing.size) warnings.push(`找不到這些 cel：${[...missing].join('、')}`)
    if (duplicated.size)
      warnings.push(`有同名的 cel（${[...duplicated].join('、')}），只會用到第一個，請在 CSP 改名`)
    if (outOfRange) warnings.push(`有 ${outOfRange} 個關鍵影格超出這條時間軸的長度，已忽略`)
    state.commit()
    set({
      tracks: state.tracks.map((track, index) =>
        index === state.activeTrack
          ? { ...track, slots }
          : {
              ...track,
              slots: Array.from(
                { length: timeline.frameCount },
                (_, i) => track.slots[i] ?? emptySlot(),
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
      `已帶入 CSP 時間軸：${timeline.frameCount} 格 @ ${timeline.frameRate} FPS，` +
        `${timeline.keys.length} 個關鍵影格${warnings.length ? `；${warnings.join('；')}` : ''}`,
    )
  },
}))

export function activeTrack(state: State): Track {
  return state.tracks[state.activeTrack] ?? state.tracks[0]!
}
