import { useEffect, useState } from 'react'
import type { DraftEntry } from '../../preload/api.js'
import { useStore } from '../state/store.js'

/** 草稿資料夾瀏覽器：指定一個資料夾，直接列出裡面所有能開的檔案。 */
export function DraftBrowser(props: {
  open: boolean
  onClose: () => void
  onPick: (filePath: string) => void
}): React.JSX.Element | null {
  const toast = useStore((state) => state.toast)
  const [folder, setFolder] = useState('')
  const [entries, setEntries] = useState<DraftEntry[]>([])
  const [loading, setLoading] = useState(false)
  const load = async (path?: string): Promise<void> => {
    setLoading(true)
    try {
      const result = await window.api.listDrafts(path)
      if (!result) return
      setFolder(result.folder)
      setEntries(result.entries)
      if (!result.entries.length) toast('info', '這個資料夾裡沒有可開啟的檔案')
    } catch (error) {
      toast(
        'error',
        `讀取草稿資料夾失敗：${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (props.open) void load()
  }, [props.open])
  if (!props.open) return null
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section
        className="modal draft-browser"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>草稿資料夾</h2>
        <p className="draft-path">{folder || '尚未設定'}</p>
        <div className="draft-actions">
          <button
            onClick={() =>
              void window.api.pickDraftFolder().then((picked) => picked && void load(picked))
            }
          >
            變更資料夾
          </button>
          <button onClick={() => void load(folder)} disabled={!folder || loading}>
            重新整理
          </button>
        </div>
        <div className="draft-list">
          {loading && <p className="empty-note">讀取中…</p>}
          {!loading && !entries.length && (
            <p className="empty-note">沒有 .clip／.procreate／.psd</p>
          )}
          {entries.map((entry) => (
            <button
              key={entry.filePath}
              className="draft-row"
              onClick={() => {
                props.onPick(entry.filePath)
                props.onClose()
              }}
            >
              <b>{entry.name}</b>
              <small>
                {entry.kind}　{(entry.byteLength / 1024 / 1024).toFixed(1)} MB
                {new Date(entry.modifiedAt).toLocaleString('zh-TW')}
              </small>
            </button>
          ))}
        </div>
        <footer>
          <button onClick={props.onClose}>關閉</button>
        </footer>
      </section>
    </div>
  )
}
