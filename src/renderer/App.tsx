import { useEffect, useState } from 'react'
import { LayerPanel } from './components/LayerPanel.js'
import { PreviewStage } from './components/PreviewStage.js'
import { Timeline } from './components/Timeline.js'
import { ExportPanel } from './components/ExportPanel.js'
import { useStore } from './state/store.js'
import { PackPanel } from './components/PackPanel.js'
import { ProjectPanel, saveCurrentSnapshot, timestampName } from './components/ProjectPanel.js'
import { SettingsDialog } from './components/SettingsDialog.js'
import { Toasts } from './components/Toasts.js'
import { DraftBrowser } from './components/DraftBrowser.js'
import { TextPrompt } from './components/TextPrompt.js'
import { askConfirm, askText } from './prompt.js'
import type { MenuCommand, PublicSettings } from '../preload/api.js'

const OPENABLE = /\.(clip|procreate|psd|psb)$/i

export function App(): React.JSX.Element {
  const store = useStore()
  const { open, set, mode, toast } = store
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [settings, setSettings] = useState<PublicSettings | null>(null)

  /**
   * 有未存檔的編輯就先問要不要存。回傳 false 代表使用者按了取消，呼叫端要中止。
   * 「開新檔案把舊進度吃掉」是這次最容易踩到的坑，所有換檔路徑都要先過這一關。
   */
  const guardUnsaved = async (action: string): Promise<boolean> => {
    if (!useStore.getState().dirty) return true
    const answer = await askConfirm(
      '還沒儲存進度',
      `目前的動畫還沒儲存。按「先儲存」會存成一份進度再${action}。`,
      '先儲存',
    )
    if (!answer) return false
    const name = await askText('進度名稱', timestampName())
    if (!name) return false
    try {
      await saveCurrentSnapshot(name)
      toast('success', `已儲存進度「${name}」`)
      return true
    } catch (error) {
      toast('error', `儲存失敗：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const openFile = async (path?: string): Promise<void> => {
    if (!(await guardUnsaved('開啟新檔案'))) return
    try {
      const doc = await window.api.openClip(path)
      if (!doc) return
      open(doc)
      toast('success', `已開啟 ${doc.filePath.split(/[\\/]/).at(-1)}`)
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error))
    }
  }

  const newProject = async (): Promise<void> => {
    if (!(await guardUnsaved('開新專案'))) return
    store.reset()
    toast('info', '已建立新的空白專案')
  }

  const openDropped = async (file: File): Promise<void> => {
    if (!(await guardUnsaved('開啟新檔案'))) return
    try {
      const path = window.api.getPathForFile(file)
      const doc = path
        ? await window.api.openClip(path)
        : await window.api.openClipBuffer(new Uint8Array(await file.arrayBuffer()))
      if (doc) open(doc)
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    if (!new URLSearchParams(location.search).has('smoke')) return
    const smoke = (window as unknown as { __smoke?: Record<string, unknown> }).__smoke
    if (smoke) smoke.openClipUi = openFile
  }, [])

  useEffect(
    () =>
      window.api.onMenuCommand((command: MenuCommand) => {
        if (command === 'open') void openFile()
        else if (command === 'new') void newProject()
        else if (command === 'drafts') setDraftsOpen(true)
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
    const prevent = (e: DragEvent): void => e.preventDefault()
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      const file = e.dataTransfer?.files[0]
      if (file && OPENABLE.test(file.name)) void openDropped(file)
      else if (file) toast('error', '請拖入 .clip、.procreate 或 .psd 檔案')
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', drop)
    }
  }, [])
  // 直接關視窗也不要無聲丟掉進度。
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (useStore.getState().dirty) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
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
      <div className="top-actions">
        <button onClick={() => void newProject()} title="清空成一張新的工作畫布">
          新專案
        </button>
        <button onClick={() => void openFile()} title="開啟 .clip / .procreate / .psd">
          開啟
        </button>
        <button onClick={() => setDraftsOpen(true)} title="從草稿資料夾快速開啟">
          草稿
        </button>
        <button className="settings-button" title="設定" onClick={() => setSettingsOpen(true)}>
          ⚙
        </button>
      </div>
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
      <TextPrompt />
      <Toasts />
      <DraftBrowser
        open={draftsOpen}
        onClose={() => setDraftsOpen(false)}
        onPick={(filePath) => void openFile(filePath)}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={setSettings}
      />
    </main>
  )
}
