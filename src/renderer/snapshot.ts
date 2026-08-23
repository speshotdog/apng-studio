import type { EditorState, SourceAsset, StoredTrack } from '../project/types.js'
import { newTrack, useStore, type Slot, type Track } from './state/store.js'

export function captureEditorState(): EditorState {
  const state = useStore.getState()
  return {
    sources: state.sources,
    activeSourceId: state.activeSourceId ?? undefined,
    tracks: state.tracks,
    visibility: [...state.visibility],
    fps: state.fps,
    playCount: state.playCount,
    format: state.format,
    lineTarget: state.lineTarget,
    exportWidth: state.exportWidth,
    exportHeight: state.exportHeight,
    lockAspect: state.lockAspect,
    scaleMode: state.scaleMode,
    mergeIdentical: state.mergeIdentical,
    staticFrame: state.staticFrame,
    gifColors: state.gifColors,
  }
}

function fallbackSource(stored: EditorState): SourceAsset | undefined {
  const current = useStore.getState()
  const storedSource = stored.sources?.[0]
  if (storedSource) return storedSource
  const loadedSource = current.sources[0]
  if (loadedSource) return loadedSource
  if (!current.doc) return undefined
  return {
    id: crypto.randomUUID(),
    path: current.doc.filePath,
    name: current.doc.filePath.split(/[\\/]/).at(-1) ?? current.doc.filePath,
  }
}

function normalizeSlot(
  slot: { sourceId?: string | null; layerId: number | null },
  sourceId: string | null,
): Slot {
  return {
    sourceId: slot.layerId === null ? null : (slot.sourceId ?? sourceId),
    layerId: slot.layerId,
  }
}

function tracksFrom(stored: EditorState, sourceId: string | null): Track[] {
  if (stored.tracks?.length)
    return stored.tracks.map((track: StoredTrack) => ({
      ...track,
      slots: track.slots.map((slot) => normalizeSlot(slot, sourceId)),
    }))
  const track = newTrack('圖層 1', stored.slots?.length ?? 8)
  return [
    {
      ...track,
      slots: stored.slots?.map((slot) => normalizeSlot(slot, sourceId)) ?? track.slots,
      zoom: stored.zoom ?? 1,
      offsetX: stored.offsetX ?? 0,
      offsetY: stored.offsetY ?? 0,
    },
  ]
}

function visibilityFrom(stored: EditorState, sourceId: string | null): Map<string, boolean> {
  const entries = stored.visibility as Array<[string | number, boolean]>
  return new Map(
    entries.flatMap(([key, visible]) => {
      if (typeof key === 'string') return [[key, visible] as [string, boolean]]
      return sourceId ? [[`${sourceId}:${key}`, visible] as [string, boolean]] : []
    }),
  )
}

export function applyEditorState(stored: EditorState): void {
  const state = useStore.getState()
  const fallback = fallbackSource(stored)
  const sources = stored.sources?.length ? stored.sources : fallback ? [fallback] : state.sources
  const docs =
    fallback && state.doc && !state.docs[fallback.id]
      ? { ...state.docs, [fallback.id]: state.doc }
      : state.docs
  // active 一定要挑「真的載得起來」的那一個。只檢查 sources 的話，
  // 上次用的素材剛好不見時整個編輯器會停在 doc=null，連匯出都會說「請先開啟檔案」，
  // 即使其他素材都好好的。
  const loadable = (id: string | null | undefined): boolean => Boolean(id && docs[id])
  const activeSourceId = loadable(stored.activeSourceId)
    ? stored.activeSourceId!
    : loadable(fallback?.id)
      ? fallback!.id
      : (sources.find((source) => docs[source.id])?.id ?? sources[0]?.id ?? null)

  useStore.getState().set({
    sources,
    activeSourceId,
    docs,
    doc: activeSourceId ? (docs[activeSourceId] ?? null) : null,
    tracks: tracksFrom(stored, activeSourceId),
    activeTrack: 0,
    selection: [],
    visibility: visibilityFrom(stored, activeSourceId),
    fps: stored.fps,
    playCount: stored.playCount,
    format: stored.format,
    lineTarget: stored.lineTarget,
    exportWidth: stored.exportWidth,
    exportHeight: stored.exportHeight,
    lockAspect: stored.lockAspect,
    scaleMode: stored.scaleMode,
    mergeIdentical: stored.mergeIdentical,
    staticFrame: stored.staticFrame ?? 0,
    gifColors: stored.gifColors ?? 256,
    playhead: 0,
    selectedSlot: 0,
    playing: false,
    past: [],
    future: [],
    dirty: false,
  })
}
