import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.js'
import { composeFrame, ensureBitmap } from './compose.js'
import { exportTo } from './export.js'
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
      const state = useStore.getState()
      state.slots.forEach((_, index) => {
        const id = state.resolveSlot(index)
        if (id !== null) ids.add(id)
      })
      await Promise.all([...ids].map(ensureBitmap))
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
    },
    exportTo,
    composeFrame,
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
