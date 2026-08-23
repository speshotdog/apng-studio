import { useEffect, useState } from 'react'
import type { PublicSettings } from '../../preload/api.js'

export function SettingsDialog(props: {
  open: boolean
  onClose: () => void
  onChanged: (settings: PublicSettings) => void
}): React.JSX.Element | null {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [key, setKey] = useState('')
  const [username, setUsername] = useState('')
  const [show, setShow] = useState(false)
  const [status, setStatus] = useState('尚未設定')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!props.open) return
    void window.api.getSettings().then((value) => {
      setSettings(value)
      setUsername(value.giphyUsername)
      setKey('')
      setShow(false)
      setStatus(value.hasGiphyKey ? '已安全儲存' : '尚未設定')
    })
  }, [props.open])
  if (!props.open) return null
  const save = async (): Promise<void> => {
    setBusy(true)
    const result = await window.api.setGiphy(key, username)
    if (!result.ok) setStatus(result.error ?? '儲存失敗')
    else {
      const next = await window.api.getSettings()
      props.onChanged(next)
      props.onClose()
    }
    setBusy(false)
  }
  const test = async (): Promise<void> => {
    if (key) {
      const saved = await window.api.setGiphy(key, username)
      if (!saved.ok) return setStatus(saved.error ?? '儲存失敗')
      setKey('')
    }
    setBusy(true)
    const result = await window.api.testGiphy()
    setStatus(result.message)
    setBusy(false)
  }
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal settings-dialog" role="dialog" aria-modal="true" aria-label="設定">
        <h2>設定</h2>
        <h3>GIPHY</h3>
        <label className="settings-field">
          API Key
          <span>
            <input
              aria-label="GIPHY API Key"
              type={show ? 'text' : 'password'}
              value={key}
              placeholder={settings?.hasGiphyKey ? '••••••••••••••' : ''}
              onChange={(event) => setKey(event.target.value)}
            />
            <button onClick={() => setShow(!show)}>{show ? '隱藏' : '顯示'}</button>
          </span>
        </label>
        <div className="settings-test">
          <button disabled={busy} onClick={() => void test()}>
            測試連線
          </button>
          <span className={status.includes('有效') ? 'success-text' : ''}>狀態：{status}</span>
        </div>
        {!settings?.encryptionAvailable && (
          <p className="warning">
            此環境沒有系統金鑰庫，金鑰會以純文字存在設定檔（
            {'%APPDATA%'}\APNG Studio\settings.json）。共用電腦請改用「清除金鑰」。
          </p>
        )}
        <p className="settings-help">
          ⓘ 到 developers.giphy.com 申請。免費的 beta key 每天只能上傳 10 個，且無法指定 GIPHY
          頻道。要解除限制需向 GIPHY 申請 production key。
        </p>
        <label className="settings-field">
          使用者名稱（選填）
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <small>ⓘ 只有 production key 才能指定。</small>
        <h3>草稿資料夾</h3>
        <div className="settings-test">
          <button
            onClick={() =>
              void window.api.pickDraftFolder().then(async (picked) => {
                if (picked) setSettings(await window.api.getSettings())
              })
            }
          >
            選擇資料夾
          </button>
          <span>{settings?.draftFolder || '尚未設定'}</span>
        </div>
        <small>ⓘ 設定後可用「檔案 → 草稿資料夾」（Ctrl+D）直接列出裡面的檔案開啟。</small>
        <footer>
          {settings?.hasGiphyKey && (
            <button onClick={() => void window.api.clearGiphy().then(props.onClose)}>
              清除金鑰
            </button>
          )}
          <span />
          <button onClick={props.onClose}>取消</button>
          <button disabled={busy || (!key && !settings?.hasGiphyKey)} onClick={() => void save()}>
            儲存
          </button>
        </footer>
      </section>
    </div>
  )
}
