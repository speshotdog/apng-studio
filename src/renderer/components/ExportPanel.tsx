import { useMemo, useState } from 'react'
import { EXPORT_TARGETS, validateForLine, type ExportTarget } from '../../codec/line.js'
import { encodeGif } from '../../codec/gif.js'
import type { ExportResult, GiphyUploadResult, PublicSettings } from '../../preload/api.js'
import { createExportPayload, exportTo } from '../export.js'
import { planFromSlots } from '../plan.js'
import { useStore, type TargetSettings } from '../state/store.js'
import { autoFixForLine } from '../../codec/autofix.js'
import { saveCurrentSnapshot, timestampName } from './ProjectPanel.js'

const clampFps = (value: number): number =>
  Math.max(1, Math.min(60, Number.isFinite(value) ? Math.round(value) : 1))

export function ExportPanel(props: {
  settings: PublicSettings | null
  openSettings: () => void
}): React.JSX.Element {
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
    lineTarget,
    zoom,
    offsetX,
    offsetY,
    set,
  } = state
  const [result, setResult] = useState<ExportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [upload, setUpload] = useState<{ bytes: Uint8Array; tags: string } | null>(null)
  const [giphyResult, setGiphyResult] = useState<GiphyUploadResult | null>(null)
  const targetSpec = EXPORT_TARGETS[lineTarget]
  const resolvedIds = useMemo(() => slots.map((_, i) => state.resolveSlot(i)), [slots])
  const plan = useMemo(
    () => planFromSlots(resolvedIds, fps, mergeIdentical),
    [resolvedIds, fps, mergeIdentical],
  )
  const issues = validateForLine({
    target: lineTarget,
    width,
    height,
    plan,
    numPlays: playCount,
    format,
    byteLength: result?.ok && !result.files ? result.byteLength : undefined,
  })
  const errors = issues.filter((issue) => issue.level === 'error')
  const orderedIssues = [...errors, ...issues.filter((issue) => issue.level !== 'error')]
  const dimensions = (w: number, h: number, unlock = false) =>
    set({ exportWidth: w, exportHeight: h, ...(unlock ? { lockAspect: false } : {}) })
  const selectTarget = (target: ExportTarget): void => {
    const next = EXPORT_TARGETS[target]
    const currentSettings: TargetSettings = {
      format,
      exportWidth: width,
      exportHeight: height,
      lockAspect: state.lockAspect,
      fps,
      playCount,
      zoom,
      offsetX,
      offsetY,
      scaleMode,
      staticFrame: state.staticFrame,
      gifColors: state.gifColors,
    }
    const remembered = state.targetSettings[target]
    const documentFps = doc?.timeline?.frameRate ?? 12
    const sizeRatio = doc
      ? Math.min(next.maxWidth / doc.canvas.width, next.maxHeight / doc.canvas.height)
      : 1
    const defaultWidth =
      next.fixedSize?.width ?? Math.round((doc?.canvas.width ?? next.maxWidth) * sizeRatio)
    const defaultHeight =
      next.fixedSize?.height ?? Math.round((doc?.canvas.height ?? next.maxHeight) * sizeRatio)
    const base = doc ? Math.min(48 / doc.canvas.width, 48 / doc.canvas.height) : 1
    const defaults: TargetSettings = {
      format: (target === 'twitchEmoteAnimated' || target === 'plurkEmoticon'
        ? 'gif'
        : next.staticOnly
          ? 'png'
          : 'apng') as 'apng' | 'gif' | 'png',
      exportWidth: target === 'youtubeEmoji' ? 48 : next.multiSize ? 112 : defaultWidth,
      exportHeight: target === 'youtubeEmoji' ? 48 : next.multiSize ? 112 : defaultHeight,
      lockAspect:
        target === 'emoji' || target === 'main' ? doc?.canvas.width === doc?.canvas.height : true,
      fps: target === 'twitchEmoteAnimated' ? Math.min(30, documentFps) : documentFps,
      playCount:
        target === 'plurkEmoticon' || target === 'twitchEmoteAnimated'
          ? 0
          : next.staticOnly || target === 'staticSticker'
            ? 1
            : 4,
      zoom:
        target === 'plurkEmoticon' && doc
          ? Math.max(48 / doc.canvas.width, 48 / doc.canvas.height) / base
          : 1,
      offsetX: 0,
      offsetY: 0,
      scaleMode: 'smooth',
      staticFrame: next.staticOnly ? state.playhead : 0,
      gifColors: 256,
    }
    set({
      ...(remembered ?? defaults),
      lineTarget: target,
      playing: false,
      targetSettings: { ...state.targetSettings, [lineTarget]: currentSettings },
    })
  }
  const fill = (): void => {
    if (!doc) return
    const base = Math.min(width / doc.canvas.width, height / doc.canvas.height)
    set({
      zoom: Math.max(width / doc.canvas.width, height / doc.canvas.height) / base,
      offsetX: 0,
      offsetY: 0,
    })
  }
  const exportNow = async (): Promise<void> => {
    if (
      !doc ||
      (errors.length &&
        !confirm(`${targetSpec.platform} 規格檢查有 ${errors.length} 項錯誤，仍要匯出嗎？`))
    )
      return
    setBusy(true)
    setResult(null)
    try {
      setResult(await exportTo())
    } finally {
      setBusy(false)
    }
  }
  const exportZip = async (): Promise<void> => {
    if (!targetSpec.multiSize) return
    setBusy(true)
    try {
      const payloads = await Promise.all(
        targetSpec.multiSize.map(async (size) => ({
          suffix: size.suffix,
          payload: await createExportPayload(size),
        })),
      )
      setResult(await window.api.saveMultiZip(payloads))
    } finally {
      setBusy(false)
    }
  }
  const durationTicks =
    EXPORT_TARGETS[lineTarget].allowedDurationsSec
      ?.map((seconds) => Math.round(slots.length / seconds))
      .filter((value) => value >= 1 && value <= 60) ?? []
  const autofix = doc
    ? autoFixForLine({
        target: lineTarget,
        canvasWidth: doc.canvas.width,
        canvasHeight: doc.canvas.height,
        slots,
        fps,
        playCount,
        exportWidth: width,
        exportHeight: height,
        format,
        identicalToPrev: resolvedIds.map((id, index) => index > 0 && id === resolvedIds[index - 1]),
      })
    : null
  const applyAutofix = async (): Promise<void> => {
    if (!autofix) return
    const lines = autofix.changes.map((change) => `${change.label}　${change.from} → ${change.to}`)
    const unresolved = autofix.unresolved.map((message) => `仍需處理：${message}`)
    if (!confirm(`將套用以下調整：\n\n${[...lines, ...unresolved].join('\n')}`)) return
    await saveCurrentSnapshot(`一鍵符合規範前_${timestampName()}`)
    set({ ...autofix, notice: `已套用 ${autofix.changes.length} 項 LINE 規範調整` })
  }
  const prepareGiphy = async (): Promise<void> => {
    if (!props.settings?.hasGiphyKey) return props.openSettings()
    setBusy(true)
    setGiphyResult(null)
    try {
      const payload = await createExportPayload()
      const encoded = encodeGif(payload.frames, payload.width, payload.height, {
        numPlays: payload.numPlays,
        maxColors: payload.gif?.maxColors ?? 256,
      })
      setUpload({ bytes: encoded.bytes, tags: '' })
    } finally {
      setBusy(false)
    }
  }
  const confirmGiphy = async (): Promise<void> => {
    if (!upload) return
    setBusy(true)
    const result = await window.api.uploadGiphy({ gifBytes: upload.bytes, tags: upload.tags })
    setGiphyResult(result)
    setUpload(null)
    setBusy(false)
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
          {targetSpec.staticOnly ? (
            <button disabled>PNG</button>
          ) : targetSpec.multiSize ? (
            <button disabled>{lineTarget === 'twitchEmoteAnimated' ? 'GIF' : 'PNG'}</button>
          ) : (
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
          )}
        </div>
        <div className="section">
          <label className="label">輸出目標</label>
          <select
            className="line-targets"
            aria-label="輸出目標"
            value={lineTarget}
            onChange={(event) => selectTarget(event.target.value as ExportTarget)}
          >
            <optgroup label="LINE">
              <option value="sticker">動態貼圖</option>
              <option value="emoji">動態表情貼</option>
              <option value="staticSticker">一般貼圖</option>
              <option value="main">主要圖片</option>
            </optgroup>
            <optgroup label="噗浪">
              <option value="plurkEmoticon">表情</option>
            </optgroup>
            <optgroup label="Twitch">
              <option value="twitchEmoteAnimated">動態表情</option>
              <option value="twitchEmoteStatic">靜態表情</option>
            </optgroup>
            <optgroup label="YouTube">
              <option value="youtubeEmoji">會員表情</option>
            </optgroup>
          </select>
          <small className="target-summary">{targetSpec.summary}</small>
          <small className="target-note">{EXPORT_TARGETS[lineTarget].note}</small>
        </div>
        <div className="section">
          <label className="label">輸出尺寸</label>
          <div className="dimensions">
            <input
              type="number"
              value={width}
              onChange={(e) => {
                const w = Number(e.target.value)
                dimensions(
                  w,
                  state.lockAspect && doc
                    ? Math.round((w * doc.canvas.height) / doc.canvas.width)
                    : height,
                )
              }}
            />
            <span>×</span>
            <input
              type="number"
              value={height}
              onChange={(e) => {
                const h = Number(e.target.value)
                dimensions(
                  state.lockAspect && doc
                    ? Math.round((h * doc.canvas.width) / doc.canvas.height)
                    : width,
                  h,
                )
              }}
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
            {lineTarget === 'youtubeEmoji' && (
              <>
                <button onClick={() => dimensions(48, 48)}>48 × 48（建議）</button>
                <button onClick={() => dimensions(480, 480)}>480 × 480（最大）</button>
              </>
            )}
          </div>
        </div>
        {targetSpec.staticOnly && (
          <div className="section static-frame-control">
            <label className="label">要輸出哪一格</label>
            <select
              value={state.staticFrame}
              onChange={(event) => {
                const index = Number(event.target.value)
                set({ staticFrame: index, playhead: index, selectedSlot: index })
              }}
            >
              {slots.map((slot, index) => (
                <option value={index} key={index}>
                  第 {index + 1} 格{slot.layerId === null ? '（延續前格）' : ''}
                </option>
              ))}
            </select>
            <button onClick={() => set({ staticFrame: state.playhead })}>用目前這格</button>
          </div>
        )}
        <div className="section adjustment">
          <label className="label">畫面調整</label>
          <label>
            縮放 <span>{Math.round(zoom * 100)}%</span>
            <input
              aria-label="縮放滑桿"
              type="range"
              min="20"
              max="400"
              value={Math.round(zoom * 100)}
              onInput={(e) => set({ zoom: Number(e.currentTarget.value) / 100 })}
            />
            <input
              aria-label="縮放百分比"
              type="number"
              min="20"
              max="400"
              value={Math.round(zoom * 100)}
              onChange={(e) =>
                set({ zoom: Math.max(0.2, Math.min(4, Number(e.target.value) / 100)) })
              }
            />
          </label>
          <div className="offsets">
            <label>
              位移 X{' '}
              <input
                type="number"
                value={offsetX}
                onChange={(e) => set({ offsetX: Number(e.target.value) })}
              />
            </label>
            <label>
              位移 Y{' '}
              <input
                type="number"
                value={offsetY}
                onChange={(e) => set({ offsetY: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="quick">
            <button onClick={() => set({ zoom: 1, offsetX: 0, offsetY: 0 })}>符合</button>
            <button onClick={fill}>填滿</button>
            <button onClick={() => set({ zoom: 1, offsetX: 0, offsetY: 0 })}>重設</button>
          </div>
          {lineTarget === 'plurkEmoticon' && (
            <small className="plurk-hint">
              48×48 很小，建議用縮放與位移把主體（例如臉）裁出來，整張縮進去會看不清楚
            </small>
          )}
        </div>
        <div className="section grid">
          <label>
            縮放品質
            <select
              value={scaleMode}
              onChange={(e) => set({ scaleMode: e.target.value as 'smooth' | 'pixel' })}
            >
              <option value="smooth">平滑</option>
              <option value="pixel">銳利</option>
            </select>
          </label>
        </div>
        {!targetSpec.staticOnly && (
          <div className="section fps-control">
            <label className="label">FPS</label>
            <div className="fps-inputs">
              <input
                aria-label="FPS 滑桿"
                type="range"
                min="1"
                max="60"
                step="1"
                value={fps}
                onInput={(e) => set({ fps: clampFps(Number(e.currentTarget.value)) })}
              />
              <input
                aria-label="FPS 數字"
                type="number"
                min="1"
                max="60"
                value={fps}
                onChange={(e) => set({ fps: clampFps(Number(e.target.value)) })}
              />
            </div>
            <div className="fps-ticks">
              {[8, 12, 15, 20, 24, 30].map((value) => (
                <button
                  className={durationTicks.includes(value) ? 'valid' : ''}
                  key={value}
                  onClick={() => set({ fps: value })}
                >
                  {value}
                </button>
              ))}
            </div>
            <small>
              {fps} FPS　每格 {Math.round(1000 / fps)} ms
            </small>
          </div>
        )}
        {!targetSpec.staticOnly && (
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
            <label title="LINE 端可能仍會合併相同影格">
              <input
                type="checkbox"
                checked={mergeIdentical}
                onChange={(e) => set({ mergeIdentical: e.target.checked })}
              />{' '}
              合併重複影格 ⓘ
            </label>
          </div>
        )}
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
          {targetSpec.staticOnly ? (
            <>
              <div>
                <span>輸出第幾格</span>
                <b>第 {state.staticFrame + 1} 格</b>
              </div>
              <div>
                <span>尺寸</span>
                <b>
                  {width}×{height}
                </b>
              </div>
              <div>
                <span>預估大小</span>
                <b>匯出後顯示</b>
              </div>
            </>
          ) : (
            <>
              <div>
                <span>時間軸格數</span>
                <b>{plan.timelineFrameCount}</b>
              </div>
            </>
          )}
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
        {lineTarget !== 'plurkEmoticon' && (
          <label className="line-toggle">
            <input
              type="checkbox"
              checked={state.linePreset}
              onChange={(e) => set({ linePreset: e.target.checked })}
            />{' '}
            LINE 規格檢查
          </label>
        )}
        {result && (
          <div className={`result ${result.ok ? 'success' : 'failure'}`}>
            {result.ok ? (
              <>
                <b>匯出完成</b>
                <p>{result.filePath}</p>
                <p>{((result.byteLength ?? 0) / 1024).toFixed(1)} KB</p>
                {result.files?.map((file) => {
                  const limit = targetSpec.maxFileBytes
                  const pass =
                    lineTarget === 'twitchEmoteStatic'
                      ? file.byteLength < limit
                      : file.byteLength <= limit
                  return (
                    <p key={file.filePath}>
                      {pass ? '✓' : '✗'} {file.filePath.split(/[\\/]/).at(-1)}　
                      {(file.byteLength / 1024).toFixed(1)} KB
                      {pass ? '' : `　超過 ${limit / 1024 >= 1024 ? '1 MB' : '25 KB'}`}
                    </p>
                  )
                })}
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
        {(state.linePreset || lineTarget !== 'sticker') && (
          <div className="issues">
            {orderedIssues.length ? (
              orderedIssues.map((issue, i) => (
                <p className={issue.level} key={i}>
                  {issue.level === 'error' ? '●' : issue.level === 'warning' ? '▲' : 'ℹ'}{' '}
                  {issue.message}
                </p>
              ))
            ) : (
              <p className="pass">
                ✓ 符合 {targetSpec.platform} {targetSpec.label}規格
              </p>
            )}
            {errors.length > 0 &&
              (lineTarget === 'sticker' ||
                lineTarget === 'emoji' ||
                lineTarget === 'main' ||
                lineTarget === 'twitchEmoteAnimated') && (
                <button className="autofix-button" onClick={() => void applyAutofix()}>
                  一鍵符合規範
                </button>
              )}
          </div>
        )}
        <button className="export-button" disabled={!doc || busy} onClick={() => void exportNow()}>
          {busy
            ? '正在匯出…'
            : targetSpec.multiSize
              ? `匯出 Twitch 表情（3 個尺寸）`
              : `匯出 ${format.toUpperCase()}`}
        </button>
        {targetSpec.multiSize && (
          <button disabled={!doc || busy} onClick={() => void exportZip()}>
            打包成 ZIP
          </button>
        )}
        <button
          className={props.settings?.hasGiphyKey ? 'giphy-button' : 'giphy-button secondary'}
          disabled={!doc || busy}
          title={
            props.settings?.hasGiphyKey ? '將目前動畫上傳到 GIPHY' : '開啟設定以填入 GIPHY API Key'
          }
          onClick={() => void prepareGiphy()}
        >
          {props.settings?.hasGiphyKey ? '上傳到 GIPHY' : '設定 GIPHY 金鑰'}
        </button>
      </div>
      {upload && (
        <div className="modal-backdrop">
          <section className="modal giphy-confirm" role="dialog" aria-modal="true">
            <h2>即將上傳到 GIPHY</h2>
            <p className="warning">
              ⚠ 上傳到 GIPHY 的內容是公開的，任何人都能搜尋到。
              <br />
              如果這是還沒發表的作品或客戶的委託，請先確認可以公開。
            </p>
            <dl>
              <dt>格式</dt>
              <dd>GIF（GIPHY 不接受 APNG，將自動轉檔）</dd>
              <dt>尺寸</dt>
              <dd>
                {width} × {height}
              </dd>
              <dt>幀數</dt>
              <dd>{plan.actualFrameCount}</dd>
              <dt>大小</dt>
              <dd>約 {(upload.bytes.length / 1024).toFixed(0)} KB</dd>
            </dl>
            <label>
              標籤
              <input
                value={upload.tags}
                placeholder="可輸入，逗號分隔"
                onChange={(event) => setUpload({ ...upload, tags: event.target.value })}
              />
            </label>
            <footer>
              <button onClick={() => setUpload(null)}>取消</button>
              <button onClick={() => void confirmGiphy()}>確認上傳</button>
            </footer>
          </section>
        </div>
      )}
      {giphyResult && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true">
            <h2>{giphyResult.ok ? '上傳完成' : '上傳失敗'}</h2>
            {giphyResult.ok ? (
              <div className="giphy-links">
                {[
                  ['GIPHY 頁面', giphyResult.pageUrl],
                  ['直接 GIF 網址', giphyResult.gifUrl],
                ].map(
                  ([label, url]) =>
                    url && (
                      <p key={label}>
                        <b>{label}</b>
                        <input readOnly value={url} />
                        <button onClick={() => void navigator.clipboard.writeText(url)}>
                          複製
                        </button>
                      </p>
                    ),
                )}
                <button
                  onClick={() =>
                    giphyResult.pageUrl && void window.api.openExternal(giphyResult.pageUrl)
                  }
                >
                  在瀏覽器開啟
                </button>
              </div>
            ) : (
              <p className="error">{giphyResult.error}</p>
            )}
            <footer>
              <button onClick={() => setGiphyResult(null)}>關閉</button>
            </footer>
          </section>
        </div>
      )}
    </aside>
  )
}
