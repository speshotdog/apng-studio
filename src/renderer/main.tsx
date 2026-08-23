import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.js'
import { allLayerIds, composeFrame, ensureBitmap } from './compose.js'
import { exportTo } from './export.js'
import { packImportMessage } from './packMessage.js'
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
    openClip: async (path: string) => {
      const doc = await window.api.openClip(path)
      if (!doc) throw new Error('無法開啟測試檔案')
      useStore.getState().open(doc)
      return doc
    },
    getAnimationCels: animationCels,
    waitIdle: async () => {
      const ids = new Set(animationCels().map(({ id }) => id))
      document.querySelectorAll<HTMLCanvasElement>('.thumb[data-layer-id]').forEach((thumb) => {
        if (thumb.dataset.thumbLoaded === 'false') ids.add(Number(thumb.dataset.layerId))
      })
      allLayerIds().forEach((id) => ids.add(id))
      await Promise.all([...ids].map(ensureBitmap))
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
    },
    exportTo,
    composeFrame,
    // 影格與畫面調整改成掛在軌道上；煙霧測試沿用單軌語意，靠這幾個小工具轉接。
    getSlots: () => useStore.getState().tracks[useStore.getState().activeTrack]!.slots,
    setSlots: (slots: { layerId: number | null }[]) => {
      const state = useStore.getState()
      state.set({
        tracks: state.tracks.map((track, index) =>
          index === state.activeTrack ? { ...track, slots } : track,
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
        .set({ ...snapshot, visibility: new Map(snapshot.visibility as Array<[number, boolean]>) })
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
