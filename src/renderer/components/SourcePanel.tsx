import { askConfirm } from '../prompt.js'
import { useStore } from '../state/store.js'

function basename(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}

/**
 * 專案的素材庫。一組 LINE 貼圖有 8–40 張，每張通常是一個獨立的來源檔，
 * 所以一個專案要能同時掛很多個 .clip／.procreate／.psd。
 *
 * 移除素材只從專案移除，**永遠不會動到磁碟上的原始檔**。
 */
export function SourcePanel({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  const sources = useStore((state) => state.sources)
  const activeSourceId = useStore((state) => state.activeSourceId)
  const docs = useStore((state) => state.docs)
  const state = useStore()

  /** 這個來源被哪些影格與貼圖格用到 —— 移除前一定要讓使用者看到。 */
  const usage = (
    sourceId: string,
  ): { frames: number; packCells: Array<number | 'main' | 'tab'> } => {
    const activeFrames = state.tracks.reduce(
      (count, track) => count + track.slots.filter((slot) => slot.sourceId === sourceId).length,
      0,
    )
    const frames = Object.entries(state.documents).reduce(
      (count, [documentId, document]) =>
        documentId === state.activeDocumentId
          ? count
          : count +
            document.tracks.reduce(
              (sum, track) => sum + track.slots.filter((slot) => slot.sourceId === sourceId).length,
              0,
            ),
      activeFrames,
    )
    const packCells = state.packCells
      .filter((cell) => {
        if (!cell.documentId) return false
        const document =
          cell.documentId === state.activeDocumentId
            ? { tracks: state.tracks, activeSourceId: state.activeSourceId ?? undefined }
            : state.documents[cell.documentId]
        return (
          document?.activeSourceId === sourceId ||
          document?.tracks.some((track) => track.slots.some((slot) => slot.sourceId === sourceId))
        )
      })
      .map((cell) => cell.index)
    return { frames, packCells }
  }

  const remove = async (sourceId: string): Promise<void> => {
    const source = sources.find((item) => item.id === sourceId)
    if (!source) return
    const { frames, packCells } = usage(sourceId)
    const parts = [
      frames ? `${frames} 個影格` : '',
      packCells.length
        ? `貼圖組第 ${packCells
            .map((index) => (typeof index === 'number' ? String(index).padStart(2, '0') : index))
            .join('、')} 格`
        : '',
    ].filter(Boolean)
    const message = parts.length
      ? `「${source.name}」正在被 ${parts.join('、')}使用。\n\n` +
        '移除後那些影格會變成空白（貼圖組已經產生的圖片不受影響）。\n' +
        '這只會從專案移除，不會刪掉磁碟上的原始檔。'
      : `「${source.name}」目前沒有被任何影格使用。\n\n只會從專案移除，不會刪掉磁碟上的檔案。`
    if (!(await askConfirm('從專案移除素材', message, parts.length ? '仍要移除' : '移除'))) return
    state.removeSource(sourceId)
    state.toast('info', `已從專案移除素材：${source.name}`)
  }

  /** 檔案被搬走或改名時換一個路徑，id 不變，影格引用全部保留。 */
  const relink = async (sourceId: string): Promise<void> => {
    const source = sources.find((item) => item.id === sourceId)
    if (!source) return
    try {
      const doc = await window.api.openClip()
      if (!doc) return
      state.relinkSource(sourceId, doc.filePath, basename(doc.filePath), doc)
      state.toast('success', `已重新連結：${basename(doc.filePath)}`)
    } catch (error) {
      state.toast(
        'error',
        `重新連結失敗：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const openSource = async (sourceId: string): Promise<void> => {
    const source = sources.find((item) => item.id === sourceId)
    if (!source) return
    try {
      const error = await window.api.openPath(source.path)
      if (error) state.toast('error', error)
    } catch (error) {
      state.toast(
        'error',
        `開啟原檔失敗：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return (
    <section className="panel sources">
      <header>
        <span className="eyebrow">SOURCES</span>
        <h1>素材</h1>
        <p>這個專案用到的來源檔，點一下切換</p>
      </header>
      <div className="source-list">
        {!sources.length && <p className="empty-note">還沒有素材，按下面的按鈕加入。</p>}
        {sources.map((source) => {
          const doc = docs[source.id]
          const active = source.id === activeSourceId
          return (
            <div
              className={`source-item ${active ? 'current' : ''} ${doc ? '' : 'missing'}`}
              key={source.id}
            >
              <button
                className="source-pick"
                onClick={() => doc && state.setActiveSource(source.id)}
                title={source.path}
                disabled={!doc}
              >
                <b>{source.name || basename(source.path)}</b>
                <small>
                  {doc ? `${doc.canvas.width} × ${doc.canvas.height} px` : '找不到檔案'}
                </small>
              </button>
              <span className="source-actions">
                <button title="用原本的繪圖軟體開啟原檔" onClick={() => void openSource(source.id)}>
                  開啟原檔
                </button>
                <button title="重新連結到另一個檔案" onClick={() => void relink(source.id)}>
                  連結
                </button>
                <button title="從專案移除（不會刪檔案）" onClick={() => void remove(source.id)}>
                  移除
                </button>
              </span>
            </div>
          )
        })}
      </div>
      <button className="source-add" onClick={onAdd}>
        ＋ 加入素材
      </button>
    </section>
  )
}
