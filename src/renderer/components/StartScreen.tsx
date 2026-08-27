import { useEffect, useState } from 'react'
import type { ProjectListItem } from '../../project/types.js'
import { createProjectFrom, openProject } from '../project.js'
import { askConfirm, askText } from '../prompt.js'
import { useStore } from '../state/store.js'
import { DraftBrowser } from './DraftBrowser.js'
import mascotUrl from '../../../assets/home-mascot.gif'

function when(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * 開場的專案選擇畫面。編輯器只有在「已經選定一個專案」的前提下才會出現，
 * 這樣每一次存檔都有明確的去處，不會再搞不清楚現在動到的是哪一份進度。
 */
export function StartScreen(props: { openSettings: () => void }): React.JSX.Element {
  const toast = useStore((state) => state.toast)
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    setLoading(true)
    try {
      setProjects(await window.api.listProjects())
    } catch (error) {
      toast('error', `讀取專案清單失敗：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => void refresh(), [])

  const guard = async (run: () => Promise<unknown>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await run()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="start-screen">
      <header>
        <div className="start-brand">
          <div className="start-mascot">
            <img src={mascotUrl} alt="" />
          </div>
          <div>
            <h1>APNG Studio</h1>
            <p>選一個專案繼續，或從來源檔開一個新的</p>
          </div>
        </div>
        <div className="start-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void guard(() => createProjectFrom())}
          >
            ＋ 新專案
          </button>
          <button disabled={busy} onClick={() => setDraftsOpen(true)}>
            從草稿資料夾
          </button>
          <button className="settings-button" title="設定" onClick={props.openSettings}>
            ⚙
          </button>
        </div>
      </header>

      <section className="start-list">
        {loading && <p className="empty-note">讀取中…</p>}
        {!loading && !projects.length && (
          <p className="empty-note">
            還沒有任何專案。按「新專案」選一個 .clip／.procreate／.psd 開始。
          </p>
        )}
        {projects.map((project) => (
          <article
            className="start-card"
            key={project.id}
            onClick={() => void guard(() => openProject(project))}
          >
            <div className="start-thumb">
              {project.thumbnail ? <img src={project.thumbnail} alt="" /> : <span />}
            </div>
            <div className="start-meta">
              <b>{project.name}</b>
              <small>{project.sourceName || '（沒有來源檔）'}</small>
              <small>最後儲存 {when(project.updatedAt)}</small>
              {project.hasAutosave && project.autosaveAt && (
                <em className="start-autosave">有較新的自動存檔（{when(project.autosaveAt)}）</em>
              )}
            </div>
            <div className="start-card-actions">
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  void askText('新名稱', project.name).then(async (name) => {
                    if (!name) return
                    await window.api.renameProject(project.id, name)
                    await refresh()
                  })
                }}
              >
                改名
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  void askText('複本名稱', `${project.name} 拷貝`).then(async (name) => {
                    if (!name) return
                    await window.api.duplicateProject(project.id, name)
                    await refresh()
                    toast('success', `已複製為「${name}」`)
                  })
                }}
              >
                複製
              </button>
              <button
                className="danger"
                onClick={(event) => {
                  event.stopPropagation()
                  void askConfirm(
                    '刪除專案',
                    `「${project.name}」會整個刪掉，包含自動存檔與縮圖。這個動作無法復原。`,
                    '刪除',
                  ).then(async (yes) => {
                    if (!yes) return
                    await window.api.deleteProject(project.id)
                    await refresh()
                    toast('info', `已刪除「${project.name}」`)
                  })
                }}
              >
                刪除
              </button>
            </div>
          </article>
        ))}
      </section>

      <DraftBrowser
        open={draftsOpen}
        onClose={() => setDraftsOpen(false)}
        onPick={(filePath) => void guard(() => createProjectFrom(filePath))}
      />
    </main>
  )
}
