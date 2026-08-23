import { useEffect, useState } from 'react'
import { LayerPanel } from './components/LayerPanel.js'
import { PreviewStage } from './components/PreviewStage.js'
import { Timeline } from './components/Timeline.js'
import { ExportPanel } from './components/ExportPanel.js'
import { useStore } from './state/store.js'
import { PackPanel } from './components/PackPanel.js'
import { ProjectPanel } from './components/ProjectPanel.js'
import { SettingsDialog } from './components/SettingsDialog.js'
import type { PublicSettings } from '../preload/api.js'
export function App(): React.JSX.Element {
  const open = useStore((s) => s.open)
  const set = useStore((s) => s.set)
  const notice = useStore((s) => s.notice)
  const mode = useStore((s) => s.mode)
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
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
        else if (command === 'settings') setSettingsOpen(true)
        else {
          set({ format: command === 'export-apng' ? 'apng' : 'gif' })
          requestAnimationFrame(() =>
            document.querySelector<HTMLButtonElement>('.export-button')?.click(),
          )
        }
      }),
    [],
  )
  useEffect(() => void window.api.getSettings().then(setSettings), [])
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
    <main className={`app mode-${mode}`}>
      <nav className="mode-switch">
        <button
          className={mode === 'animation' ? 'active' : ''}
          onClick={() => set({ mode: 'animation' })}
        >
          單張動畫
        </button>
        <button className={mode === 'pack' ? 'active' : ''} onClick={() => set({ mode: 'pack' })}>
          貼圖組
        </button>
      </nav>
      <button className="settings-button" title="設定" onClick={() => setSettingsOpen(true)}>
        ⚙
      </button>
      {mode === 'animation' ? (
        <>
          <div className="left-column">
            <ProjectPanel />
            <LayerPanel />
          </div>
          <div className="workspace">
            <PreviewStage />
            <Timeline />
          </div>
          <ExportPanel settings={settings} openSettings={() => setSettingsOpen(true)} />
        </>
      ) : (
        <PackPanel />
      )}
      {error && <div className="toast">{error}</div>}
      {!error && notice && <div className="toast">{notice}</div>}
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={setSettings}
      />
    </main>
  )
}
