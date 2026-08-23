import type { EditorState, StoredTrack } from '../project/types.js'
import { newTrack, useStore, type Track } from './state/store.js'

/** 把目前編輯狀態抓成可存檔的形狀。 */
export function captureEditorState(): EditorState {
  const state = useStore.getState()
  return {
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

/** v0.1 的存檔只有單軌 slots 加上全域 zoom/offset，讀進來轉成一條軌道。 */
function tracksFrom(stored: EditorState): Track[] {
  if (stored.tracks?.length)
    return stored.tracks.map((track: StoredTrack) => ({ ...track, slots: track.slots.slice() }))
  const track = newTrack('圖層 1', stored.slots?.length ?? 8)
  return [
    {
      ...track,
      slots: stored.slots?.map((slot) => ({ ...slot })) ?? track.slots,
      zoom: stored.zoom ?? 1,
      offsetX: stored.offsetX ?? 0,
      offsetY: stored.offsetY ?? 0,
    },
  ]
}

/** 套用存檔的編輯狀態；不會動到 doc 本身。 */
export function applyEditorState(stored: EditorState): void {
  useStore.getState().set({
    tracks: tracksFrom(stored),
    activeTrack: 0,
    selection: [],
    visibility: new Map(stored.visibility),
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
