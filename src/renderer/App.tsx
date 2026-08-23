import { useEffect, useState } from 'react'
import { LayerPanel } from './components/LayerPanel.js'
import { PreviewStage } from './components/PreviewStage.js'
import { Timeline } from './components/Timeline.js'
import { ExportPanel } from './components/ExportPanel.js'
import { useStore } from './state/store.js'
import { PackPanel } from './components/PackPanel.js'
import { ProjectPanel } from './components/ProjectPanel.js'
import { SettingsDialog } from './components/SettingsDialog.js'
import { StartScreen } from './components/StartScreen.js'
import { SourcePanel } from './components/SourcePanel.js'
import { Toasts } from './components/Toasts.js'
import { TextPrompt } from './components/TextPrompt.js'
import { DraftBrowser } from './components/DraftBrowser.js'
import { createProjectFrom, guardUnsaved, saveCurrentProject } from './project.js'
import type { MenuCommand, PublicSettings } from '../preload/api.js'

const OPENABLE = /\.(clip|procreate|psd|psb)$/i

export function App(): React.JSX.Element {
  const store = useStore()
  const { set, mode, screen, toast } = store
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [settings, setSettings] = useState<PublicSettings | null>(null)

  /** Add another source document without touching existing timeline slots. */
  const addSourceFrom = async (path?: string): Promise<void> => {
    try {
      const doc = await window.api.openClip(path)
      if (!doc) return
      const name = doc.filePath.split(/[\\/]/).at(-1) ?? doc.filePath
      store.addSource({ id: crypto.randomUUID(), path: doc.filePath, name }, doc)
      toast('info', `已加入來源：${name}`)
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error))
    }
  }

  const newProject = async (): Promise<void> => {
    if (!(await guardUnsaved('開新專案'))) return
    await createProjectFrom()
  }

  useEffect(() => {
    if (!new URLSearchParams(location.search).has('smoke')) return
    const smoke = (window as unknown as { __smoke?: Record<string, unknown> }).__smoke
    if (smoke) smoke.openClipUi = addSourceFrom
  }, [])

  useEffect(
    () =>
      window.api.onMenuCommand((command: MenuCommand) => {
        if (command === 'open' || command === 'new') void newProject()
        else if (command === 'drafts') setDraftsOpen(true)
        else if (command === 'save') void saveCurrentProject()
        else if (command === 'projects')
          void guardUnsaved('回到專案列表').then(
            (ok) => ok && set({ screen: 'start', project: null }),
          )
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
  // 設定可能在專案列表那邊被改過，進編輯器時重新讀一次才不會拿到舊的。
  useEffect(() => void window.api.getSettings().then(setSettings), [screen])
  useEffect(() => {
    const prevent = (e: DragEvent): void => e.preventDefault()
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      const file = e.dataTransfer?.files[0]
      if (!file) return
      const state = useStore.getState()
      if (OPENABLE.test(file.name)) {
        const path = window.api.getPathForFile(file)
        if (!path) return toast('error', '請從檔案總管拖曳檔案')
        // 在專案列表上丟來源檔就是開新專案；在編輯器裡丟則是換掉來源檔。
        if (state.screen === 'start') void createProjectFrom(path)
        else void addSourceFrom(path)
      }
      // 貼圖組頁面的格子自己會處理 PNG（drop 有 stopPropagation），
      // 掉到格子外面才會走到這裡，給個明確提示而不是「請拖入 .clip」。
      else if (state.mode === 'pack' && /\.(png|apng)$/i.test(file.name))
        toast('info', '請把 PNG 直接拖到要放的那一格上（含 main／tab）')
      else toast('error', '請拖入 .clip、.procreate 或 .psd 檔案')
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', drop)
    }
  }, [])
  // 主程序要知道有沒有未存檔的變更，關視窗時才問得出「儲存／不儲存／取消」。
  useEffect(() => {
    const push = (value: boolean): void => window.api.setDirty(value)
    push(useStore.getState().dirty)
    return useStore.subscribe((state, previous) => {
      if (state.dirty !== previous.dirty) push(state.dirty)
    })
  }, [])
  // 主程序按下「儲存後關閉」時會回頭呼叫這裡。
  useEffect(() => {
    ;(window as unknown as { __saveBeforeClose?: () => Promise<boolean> }).__saveBeforeClose = () =>
      saveCurrentProject()
  }, [])

  if (screen === 'start')
    return (
      <>
        <StartScreen openSettings={() => setSettingsOpen(true)} />
        <TextPrompt />
        <Toasts />
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onChanged={setSettings}
        />
      </>
    )

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
        <button onClick={() => void newProject()} title="從另一個來源檔建立新專案">
          新專案
        </button>
        <button onClick={() => void addSourceFrom()} title="加入另一個來源檔">
          加入來源
        </button>
        <button onClick={() => setDraftsOpen(true)} title="從草稿資料夾建立新專案">
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
            <SourcePanel onAdd={() => void addSourceFrom()} />
            <LayerPanel />
          </div>
          <div className="workspace">
            <PreviewStage />
            <Timeline />
          </div>
          <ExportPanel
            settings={settings}
            openSettings={() => setSettingsOpen(true)}
            onSettingsChanged={setSettings}
          />
        </>
      ) : (
        <>
          <ProjectPanel />
          <PackPanel />
        </>
      )}
      <TextPrompt />
      <Toasts />
      <DraftBrowser
        open={draftsOpen}
        onClose={() => setDraftsOpen(false)}
        onPick={(filePath) =>
          void guardUnsaved('開新專案').then((ok) => ok && createProjectFrom(filePath))
        }
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={setSettings}
      />
    </main>
  )
}
