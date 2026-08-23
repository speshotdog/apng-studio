import { useEffect } from 'react'
import {
  AUTOSAVE_INTERVAL_MS,
  captureBlob,
  guardUnsaved,
  saveAsNewProject,
  saveCurrentProject,
} from '../project.js'
import { askText } from '../prompt.js'
import { useStore } from '../state/store.js'

export function timestampName(now = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
}

/**
 * 編輯器頂端的專案列。永遠看得到「現在動的是哪一份」與「存了沒」，
 * 存檔一律存回目前這個專案，不會再問要存去哪。
 */
export function ProjectPanel(): React.JSX.Element {
  const project = useStore((state) => state.project)
  const dirty = useStore((state) => state.dirty)
  const set = useStore((state) => state.set)
  const toast = useStore((state) => state.toast)

  // 有未存檔的變更時定期寫一份自動存檔；它不會蓋掉正式存檔，
  // 下次開這個專案時才會問要不要復原。
  useEffect(() => {
    const timer = setInterval(() => {
      const state = useStore.getState()
      if (!state.dirty || !state.project) return
      void window.api
        .autosaveProject(state.project.id, captureBlob())
        .catch((error: unknown) => console.warn(`自動存檔失敗：${String(error)}`))
    }, AUTOSAVE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  // Ctrl+S 存回目前專案，Ctrl+Shift+S 另存新專案。
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (event.shiftKey) void saveAsNewProject()
      else void saveCurrentProject()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const rename = async (): Promise<void> => {
    if (!project) return
    const name = await askText('專案名稱', project.name)
    if (!name) return
    await window.api.renameProject(project.id, name)
    set({ project: { ...project, name } })
    toast('success', `已改名為「${name}」`)
  }

  return (
    <section className="project-bar">
      <div className="project-identity">
        <span className="eyebrow">專案</span>
        <button className="project-name" title="改名" onClick={() => void rename()}>
          {project?.name ?? '未命名'}
          {dirty && <i className="dirty-dot" title="有未儲存的變更" />}
        </button>
        <small>{dirty ? '有未儲存的變更' : '已儲存'}</small>
      </div>
      <div className="project-buttons">
        <button
          className="save-button"
          disabled={!project}
          onClick={() => void saveCurrentProject()}
        >
          儲存
        </button>
        <button disabled={!project} onClick={() => void saveAsNewProject()}>
          另存新專案
        </button>
        <button
          onClick={() =>
            void guardUnsaved('回到專案列表').then((ok) => {
              // 放掉目前專案，免得在列表裡把它刪掉之後狀態對不上。
              if (ok) set({ screen: 'start', project: null })
            })
          }
        >
          ← 專案列表
        </button>
      </div>
    </section>
  )
}
