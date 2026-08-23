import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.js'
import { allLayerIds, composeFrame, ensureBitmap } from './compose.js'
import { createExportPayload, exportTo } from './export.js'
import { encodeGif } from '../codec/gif.js'
import { packImportMessage } from './packMessage.js'
import { applyBlob, captureBlob } from './project.js'
import { useStore } from './state/store.js'
import './styles.css'
import './panels.css'

function animationCels(): { id: number; name: string }[] {
  const root = useStore.getState().doc?.tree
  if (!root) return []
  const pending = [root]
  while (pending.length) {
    const item = pending.shift()!
    if (item.isAnimationFolder) return item.children.map(({ id, name }) => ({ id, name }))
    pending.push(...item.children)
  }
  return []
}

if (import.meta.env.DEV || new URLSearchParams(location.search).has('smoke')) {
  ;(window as unknown as { __smoke: unknown }).__smoke = {
    packImportMessage,
    store: useStore,
    // 編輯器只在「有專案」時存在，所以測試入口也要先建一個專案再進去。
    openClip: async (path: string) => {
      const doc = await window.api.openClip(path)
      if (!doc) throw new Error('無法開啟測試檔案')
      useStore.getState().open(doc)
      const meta = await window.api.createProject({
        name: `smoke-${Date.now()}`,
        sourcePath: doc.filePath,
        sourceName: doc.filePath.split(/[\/]/).at(-1) ?? '',
        state: captureBlob(),
      })
      useStore.getState().set({ project: meta, screen: 'editor', dirty: false })
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      return doc
    },
    getAnimationCels: animationCels,
    waitIdle: async () => {
      const sourceId = useStore.getState().activeSourceId
      const ids = new Map<string, { sourceId: string; layerId: number }>()
      if (sourceId) {
        animationCels().forEach(({ id }) => ids.set(`${sourceId}:${id}`, { sourceId, layerId: id }))
      }
      document.querySelectorAll<HTMLCanvasElement>('.thumb[data-layer-id]').forEach((thumb) => {
        if (!sourceId || thumb.dataset.thumbLoaded !== 'false') return
        const layerId = Number(thumb.dataset.layerId)
        if (Number.isFinite(layerId)) ids.set(`${sourceId}:${layerId}`, { sourceId, layerId })
      })
      allLayerIds().forEach((slot) => ids.set(`${slot.sourceId}:${slot.layerId}`, slot))
      await Promise.all([...ids.values()].map((slot) => ensureBitmap(slot.sourceId, slot.layerId)))
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
    },
    exportTo,
    composeFrame,
    captureBlob,
    applyBlob,
    // renderer 端的 GIF 編碼（GIPHY 上傳走這條），跟主程序是不同的 gifenc build。
    encodeGifHere: async () => {
      const payload = await createExportPayload()
      return encodeGif(payload.frames, payload.width, payload.height, {
        numPlays: payload.numPlays,
        maxColors: 256,
      }).bytes.length
    },
    // 影格與畫面調整改成掛在軌道上；煙霧測試沿用單軌語意，靠這幾個小工具轉接。
    getSlots: () => useStore.getState().tracks[useStore.getState().activeTrack]!.slots,
    setSlots: (slots: { sourceId?: string | null; layerId: number | null }[]) => {
      const state = useStore.getState()
      const sourceId = state.activeSourceId
      state.set({
        tracks: state.tracks.map((track, index) =>
          index === state.activeTrack
            ? {
                ...track,
                slots: slots.map((slot) => ({
                  sourceId: slot.layerId === null ? null : (slot.sourceId ?? sourceId),
                  layerId: slot.layerId,
                })),
              }
            : track,
        ),
      })
    },
    getAdjust: () => {
      const state = useStore.getState()
      const { zoom, offsetX, offsetY } = state.tracks[state.activeTrack]!
      return { zoom, offsetX, offsetY }
    },
    setAdjust: (patch: { zoom?: number; offsetX?: number; offsetY?: number }) => {
      const state = useStore.getState()
      state.setTrack(state.activeTrack, patch)
    },
    snapshotStore: () => {
      const {
        doc: _doc,
        bitmaps: _bitmaps,
        set: _set,
        open: _open,
        setBitmap: _setBitmap,
        setSlot: _setSlot,
        resolveSlot: _resolveSlot,
        importCspTimeline: _import,
        toast: _toast,
        dismissToast: _dismissToast,
        reset: _reset,
        frameCount: _frameCount,
        resizeFrames: _resizeFrames,
        setTrack: _setTrack,
        addTrack: _addTrack,
        removeTrack: _removeTrack,
        moveTrack: _moveTrack,
        commit: _commit,
        undo: _undo,
        redo: _redo,
        visibility,
        ...serializable
      } = useStore.getState()
      return { ...serializable, visibility: [...visibility] }
    },
    restoreStore: async (snapshot: Record<string, unknown>) => {
      useStore
        .getState()
        .set({ ...snapshot, visibility: new Map(snapshot.visibility as Array<[string, boolean]>) })
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
    },
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
