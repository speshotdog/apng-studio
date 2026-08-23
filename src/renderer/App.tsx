import { useEffect, useState } from 'react'
import { LayerPanel } from './components/LayerPanel.js'
import { PreviewStage } from './components/PreviewStage.js'
import { Timeline } from './components/Timeline.js'
import { ExportPanel } from './components/ExportPanel.js'
import { useStore } from './state/store.js'
export function App(): React.JSX.Element {
  const open = useStore((s) => s.open)
  const set = useStore((s) => s.set)
  const notice = useStore((s) => s.notice)
  const [error, setError] = useState('')
  const openClip = async (path?: string): Promise<void> => {
    try {
      setError('')
      const doc = await window.api.openClip(path)
      if (doc) open(doc)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const openDroppedClip = async (file: File): Promise<void> => {
    try {
      setError('')
      const path = window.api.getPathForFile(file)
      const doc = path
        ? await window.api.openClip(path)
        : await window.api.openClipBuffer(new Uint8Array(await file.arrayBuffer()))
      if (doc) open(doc)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  useEffect(
    () =>
      window.api.onMenuCommand((command) => {
        if (command === 'open') void openClip()
        else {
          set({ format: command === 'export-apng' ? 'apng' : 'gif' })
          requestAnimationFrame(() =>
            document.querySelector<HTMLButtonElement>('.export-button')?.click(),
          )
        }
      }),
    [],
  )
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer?.files[0]
      if (file?.name.toLowerCase().endsWith('.clip')) void openDroppedClip(file)
      else if (file) setError('請拖入 .clip 檔案')
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return (
    <main className="app">
      <LayerPanel />
      <div className="workspace">
        <PreviewStage />
        <Timeline />
      </div>
      <ExportPanel />
      {error && <div className="toast">{error}</div>}
      {!error && notice && <div className="toast">{notice}</div>}
    </main>
  )
}
