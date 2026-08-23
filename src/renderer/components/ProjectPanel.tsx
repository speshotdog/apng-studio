import { useEffect, useState } from 'react'
import type { ProjectSnapshot } from '../../project/types.js'
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
    state: {
      slots: state.slots,
      visibility: [...state.visibility],
      fps: state.fps,
      playCount: state.playCount,
      format: state.format,
      lineTarget: state.lineTarget,
      exportWidth: state.exportWidth,
      exportHeight: state.exportHeight,
      lockAspect: state.lockAspect,
      scaleMode: state.scaleMode,
      mergeIdentical: state.mergeIdentical,
      zoom: state.zoom,
      offsetX: state.offsetX,
      offsetY: state.offsetY,
    },
    pack: {
      target: state.packTarget,
      count: state.packCount,
      cells: state.packCells.map(({ index, sourcePath, pngBase64 }) => ({
        index,
        sourcePath,
        pngBase64,
      })),
    },
  }
}

export async function saveCurrentSnapshot(name: string): Promise<ProjectSnapshot[]> {
  return window.api.saveProject(stateSnapshot(name))
}

export function ProjectPanel(): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectSnapshot[]>([])
  const [expanded, setExpanded] = useState(false)
  const set = useStore((state) => state.set)
  useEffect(() => {
    void window.api.listProjects().then(setProjects)
    void window.api.getSettings().then((settings) => setExpanded(settings.progressExpanded))
  }, [])
  const save = async (): Promise<void> => {
    const name = prompt('進度名稱', timestampName())?.trim()
    if (name) setProjects(await saveCurrentSnapshot(name))
  }
  const load = async (snapshot: ProjectSnapshot): Promise<void> => {
    const current = useStore.getState()
    if (current.doc && !confirm(`要載入「${snapshot.name}」嗎？尚未儲存的調整會遺失。`)) return
    let doc = snapshot.clipPath
      ? await window.api.openClip(snapshot.clipPath).catch(() => null)
      : null
    if (!doc) {
      alert('找不到原始 .clip，請重新選擇檔案。')
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
    const missing = snapshot.state.slots.flatMap(({ layerId }) =>
      layerId !== null && !valid.has(layerId) ? [layerId] : [],
    )
    if (missing.length) alert(`部分圖層 ID 在新檔案中不存在：${[...new Set(missing)].join('、')}`)
    const packCells = snapshot.pack ? await window.api.hydratePackCells(snapshot.pack.cells) : []
    set({
      ...snapshot.state,
      visibility: new Map(snapshot.state.visibility),
      packTarget: snapshot.pack?.target ?? 'staticSticker',
      packCount: snapshot.pack?.count ?? 32,
      packCells,
      notice: `已載入進度：${snapshot.name}`,
    })
  }
  return (
    <section className="project-panel">
      <div className="project-heading">
        <button onClick={save}>儲存目前進度</button>
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
                      .then(setProjects)
                  }}
                >
                  覆寫
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    const name = prompt('新名稱', project.name)
                    if (name) void window.api.renameProject(project.id, name).then(setProjects)
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
