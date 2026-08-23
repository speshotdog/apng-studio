import { useMemo, useState } from 'react'
import { validateForLine } from '../../codec/line.js'
import type { ExportResult } from '../../preload/api.js'
import { exportTo } from '../export.js'
import { planFromSlots } from '../plan.js'
import { useStore } from '../state/store.js'

export function ExportPanel(): React.JSX.Element {
  const state = useStore()
  const {
    doc,
    slots,
    fps,
    exportWidth: width,
    exportHeight: height,
    format,
    playCount,
    mergeIdentical,
    scaleMode,
    set,
  } = state
  const [result, setResult] = useState<ExportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const resolvedIds = useMemo(() => slots.map((_, i) => state.resolveSlot(i)), [slots])
  const plan = useMemo(
    () => planFromSlots(resolvedIds, fps, mergeIdentical),
    [resolvedIds, fps, mergeIdentical],
  )
  const issues =
    format === 'apng' ? validateForLine({ width, height, plan, numPlays: playCount }) : []
  const errors = issues.filter((issue) => issue.level === 'error')
  const orderedIssues = [...errors, ...issues.filter((issue) => issue.level === 'warning')]
  const dimensions = (w: number, h: number) => set({ exportWidth: w, exportHeight: h })
  const changeWidth = (w: number) =>
    set({
      exportWidth: w,
      exportHeight:
        state.lockAspect && doc ? Math.round((w * doc.canvas.height) / doc.canvas.width) : height,
    })
  const changeHeight = (h: number) =>
    set({
      exportHeight: h,
      exportWidth:
        state.lockAspect && doc ? Math.round((h * doc.canvas.width) / doc.canvas.height) : width,
    })
  const exportNow = async (): Promise<void> => {
    if (!doc) return
    if (errors.length && !confirm(`LINE 檢查有 ${errors.length} 項錯誤，仍要匯出嗎？`)) return
    setBusy(true)
    setResult(null)
    try {
      setResult(await exportTo())
    } finally {
      setBusy(false)
    }
  }
  return (
    <aside className="panel export">
      <header>
        <span className="eyebrow">OUTPUT</span>
        <h1>匯出</h1>
      </header>
      <div className="export-content">
        <div className="section">
          <label className="label">格式</label>
          <div className="segmented">
            <button
              className={format === 'apng' ? 'active' : ''}
              onClick={() => set({ format: 'apng' })}
            >
              APNG
            </button>
            <button
              className={format === 'gif' ? 'active' : ''}
              onClick={() => set({ format: 'gif' })}
            >
              GIF
            </button>
          </div>
        </div>
        <div className="section">
          <label className="label">輸出尺寸</label>
          <div className="dimensions">
            <input
              type="number"
              value={width}
              onChange={(e) => changeWidth(Number(e.target.value))}
            />
            <span>×</span>
            <input
              type="number"
              value={height}
              onChange={(e) => changeHeight(Number(e.target.value))}
            />
          </div>
          <label>
            <input
              type="checkbox"
              checked={state.lockAspect}
              onChange={(e) => set({ lockAspect: e.target.checked })}
            />{' '}
            鎖定比例
          </label>
          <div className="quick">
            <button onClick={() => doc && dimensions(doc.canvas.width, doc.canvas.height)}>
              原始尺寸
            </button>
            <button
              onClick={() => {
                if (!doc) return
                const ratio = Math.min(320 / doc.canvas.width, 270 / doc.canvas.height)
                dimensions(
                  Math.round(doc.canvas.width * ratio),
                  Math.round(doc.canvas.height * ratio),
                )
              }}
            >
              LINE 貼圖
            </button>
            <button onClick={() => dimensions(240, 240)}>主圖 240</button>
          </div>
        </div>
        <div className="section grid">
          <label>
            縮放
            <select
              value={scaleMode}
              onChange={(e) => set({ scaleMode: e.target.value as 'smooth' | 'pixel' })}
            >
              <option value="smooth">平滑</option>
              <option value="pixel">銳利</option>
            </select>
          </label>
          <label>
            FPS
            <input
              type="number"
              min="1"
              max="60"
              value={fps}
              onChange={(e) => set({ fps: Math.max(1, Math.min(60, Number(e.target.value))) })}
            />
          </label>
        </div>
        <div className="section">
          <label className="label">播放次數</label>
          <div className="plays">
            {[1, 2, 3, 4, 0].map((n) => (
              <button
                className={playCount === n ? 'active' : ''}
                key={n}
                onClick={() => set({ playCount: n })}
              >
                {n || '∞'}
              </button>
            ))}
          </div>
          <label title="APNG 規格與 LINE 驗證器都會合併連續相同的影格；關掉可能導致上傳失敗">
            <input
              type="checkbox"
              checked={mergeIdentical}
              onChange={(e) => set({ mergeIdentical: e.target.checked })}
            />{' '}
            合併重複影格 ⓘ
          </label>
        </div>
        {format === 'gif' && (
          <div className="section grid">
            <label>
              最大色數
              <input
                type="number"
                min="2"
                max="256"
                value={state.gifColors}
                onChange={(e) => set({ gifColors: Number(e.target.value) })}
              />
            </label>
            <label>GIF 使用固定調色盤量化</label>
          </div>
        )}
        <div className="stats">
          <div>
            <span>時間軸格數</span>
            <b>{plan.timelineFrameCount}</b>
          </div>
          <div className={plan.actualFrameCount !== plan.timelineFrameCount ? 'warn' : ''}>
            <span>{format === 'apng' ? '實際 APNG 幀數' : '實際 GIF 幀數'}</span>
            <b>{plan.actualFrameCount}</b>
          </div>
          <div>
            <span>單次總長</span>
            <b>{(plan.totalDurationMs / 1000).toFixed(2)} 秒</b>
          </div>
          <div>
            <span>總播放時間</span>
            <b>
              {playCount === 0
                ? '無限'
                : `${((plan.totalDurationMs * playCount) / 1000).toFixed(2)} 秒`}
            </b>
          </div>
        </div>
        <label className="line-toggle">
          <input
            type="checkbox"
            checked={state.linePreset}
            onChange={(e) => set({ linePreset: e.target.checked })}
          />{' '}
          LINE 規格檢查
        </label>
        {result && (
          <div className={`result ${result.ok ? 'success' : 'failure'}`}>
            {result.ok ? (
              <>
                <b>匯出完成</b>
                <p>{result.filePath}</p>
                {result.info && (
                  <p>
                    {result.info.numFrames} 幀 · 播放 {result.info.numPlays || '無限'} 次
                  </p>
                )}
                <p>{((result.byteLength ?? 0) / 1024).toFixed(1)} KB</p>
                {result.warnings.map((w) => (
                  <p key={w}>⚠ {w}</p>
                ))}
              </>
            ) : (
              <p>{result.error}</p>
            )}
          </div>
        )}
      </div>
      <div className="export-footer">
        {state.linePreset && (
          <div className="issues">
            {format === 'gif' && (
              <p className="warning">▲ LINE 動態貼圖只接受 APNG，GIF 不適用 LINE 規格檢查</p>
            )}
            {format === 'gif' ? null : orderedIssues.length ? (
              orderedIssues.map((issue, i) => (
                <p className={issue.level} key={i}>
                  {issue.level === 'error' ? '●' : '▲'} {issue.message}
                </p>
              ))
            ) : (
              <p className="pass">✓ 符合 LINE 動態貼圖規格</p>
            )}
          </div>
        )}
        <button className="export-button" disabled={!doc || busy} onClick={() => void exportNow()}>
          {busy ? '正在匯出…' : `匯出 ${format.toUpperCase()}`}
        </button>
      </div>
    </aside>
  )
}
