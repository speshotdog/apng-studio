import { useEffect, useState } from 'react'
import type { ProjectSnapshot } from '../../project/types.js'
import { askText } from '../prompt.js'
import { applyEditorState, captureEditorState } from '../snapshot.js'
import { useStore } from '../state/store.js'

export function timestampName(now = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
}

function stateSnapshot(name: string, existing?: ProjectSnapshot): ProjectSnapshot {
  const state = useStore.getState()
  const now = new Date().toISOString()
  const canvas = document.querySelector<HTMLCanvasElement>('.stage canvas')
  const thumbnail = canvas?.toDataURL('image/png') ?? ''
  return {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    clipPath: state.doc?.filePath ?? '',
    clipName: state.doc?.filePath.split(/[\\/]/).at(-1) ?? '',
    thumbnail,
    state: captureEditorState(),
    pack: {
      target: state.packTarget,
      count: state.packCount,
      cells: state.packCells.map(({ index, sourcePath, pngBase64, editor }) => ({
        index,
        sourcePath,
        pngBase64,
        editor,
      })),
    },
  }
}

export async function saveCurrentSnapshot(name: string): Promise<ProjectSnapshot[]> {
  const projects = await window.api.saveProject(stateSnapshot(name))
  useStore.getState().set({ dirty: false })
  return projects
}

export function ProjectPanel(): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectSnapshot[]>([])
  const [expanded, setExpanded] = useState(false)
  const store = useStore()
  useEffect(() => {
    void window.api.listProjects().then(setProjects)
    void window.api.getSettings().then((settings) => setExpanded(settings.progressExpanded))
  }, [])
  const save = async (): Promise<void> => {
    const name = await askText('進度名稱', timestampName())
    if (!name) return
    try {
      setProjects(await saveCurrentSnapshot(name))
      store.toast('success', `已儲存進度「${name}」`)
    } catch (error) {
      store.toast('error', `儲存失敗：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const load = async (snapshot: ProjectSnapshot): Promise<void> => {
    const current = useStore.getState()
    if (current.dirty && !confirm(`要載入「${snapshot.name}」嗎？尚未儲存的調整會遺失。`)) return
    let doc = snapshot.clipPath
      ? await window.api.openClip(snapshot.clipPath).catch(() => null)
      : null
    if (!doc) {
      store.toast('error', '找不到原始檔案，請重新選擇。')
      doc = await window.api.openClip()
    }
    if (!doc) return
    current.open(doc)
    const valid = new Set<number>()
    const visit = (node: typeof doc.tree): void => {
      valid.add(node.id)
      node.children.forEach(visit)
    }
    visit(doc.tree)
    applyEditorState(snapshot.state)
    const missing = useStore
      .getState()
      .tracks.flatMap((track) =>
        track.slots.flatMap(({ layerId }) =>
          layerId !== null && !valid.has(layerId) ? [layerId] : [],
        ),
      )
    const packCells = snapshot.pack ? await window.api.hydratePackCells(snapshot.pack.cells) : []
    store.set({
      packTarget: snapshot.pack?.target ?? 'staticSticker',
      packCount: snapshot.pack?.count ?? 32,
      packCells,
    })
    store.toast(
      missing.length ? 'info' : 'success',
      missing.length
        ? `已載入「${snapshot.name}」，但有圖層在新檔案中不存在：${[...new Set(missing)].join('、')}`
        : `已載入進度：${snapshot.name}`,
    )
  }
  return (
    <section className="project-panel">
      <div className="project-heading">
        <button onClick={save}>儲存目前進度{store.dirty ? ' •' : ''}</button>
        <button
          className="project-toggle"
          aria-expanded={expanded}
          onClick={() => {
            const next = !expanded
            setExpanded(next)
            void window.api.setProgressExpanded(next)
          }}
        >
          進度 ({projects.length}) {expanded ? '▾' : '▸'}
        </button>
      </div>
      {expanded && (
        <div className="project-list">
          {!projects.length && (
            <p className="empty-note">尚未儲存進度，可建立快照來比較不同設定。</p>
          )}
          {projects.map((project) => (
            <div className="project-row" key={project.id} onClick={() => void load(project)}>
              {project.thumbnail ? (
                <img src={project.thumbnail} />
              ) : (
                <span className="project-placeholder" />
              )}
              <span>
                <b>{project.name}</b>
                <small>
                  {project.clipName} · {new Date(project.updatedAt).toLocaleString('zh-TW')}
                </small>
              </span>
              <span className="project-actions">
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    void window.api
                      .saveProject(stateSnapshot(project.name, project))
                      .then((next) => {
                        setProjects(next)
                        store.set({ dirty: false })
                        store.toast('success', `已覆寫「${project.name}」`)
                      })
                  }}
                >
                  覆寫
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    void askText('新名稱', project.name).then((name) => {
                      if (name) void window.api.renameProject(project.id, name).then(setProjects)
                    })
                  }}
                >
                  改名
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    if (confirm(`刪除「${project.name}」？`))
                      void window.api.deleteProject(project.id).then(setProjects)
                  }}
                >
                  刪除
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
