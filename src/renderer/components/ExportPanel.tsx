import { useMemo, useState } from 'react'
import { EXPORT_TARGETS, validateForLine, type ExportTarget } from '../../codec/line.js'
import { encodeGif } from '../../codec/gif.js'
import type { ExportResult, GiphyUploadResult, PublicSettings } from '../../preload/api.js'
import { createExportPayload, exportTo } from '../export.js'
import { planFromSlots } from '../plan.js'
import { mergeAdjacentIdenticalFrames } from '../../codec/timing.js'
import { useStore, type TargetSettings } from '../state/store.js'
import { autoFixForLine } from '../../codec/autofix.js'
import { askConfirm } from '../prompt.js'
import { saveCurrentProject } from '../project.js'
import { TagEditor } from './TagEditor.js'

const clampFps = (value: number): number =>
  Math.max(1, Math.min(60, Number.isFinite(value) ? Math.round(value) : 1))

type GifMatteChoice = 'none' | 'dark' | 'white' | 'custom'

const gifMatteChoice = (value: string | null): GifMatteChoice => {
  if (value === null) return 'none'
  if (value.toLowerCase() === '#1e1e1e') return 'dark'
  if (value.toLowerCase() === '#ffffff') return 'white'
  return 'custom'
}

export function ExportPanel(props: {
  settings: PublicSettings | null
  openSettings: () => void
  onSettingsChanged(settings: PublicSettings): void
}): React.JSX.Element {
  const state = useStore()
  const {
    doc,
    tracks,
    activeTrack,
    fps,
    exportWidth: width,
    exportHeight: height,
    format,
    playCount,
    mergeIdentical,
    scaleMode,
    lineTarget,
    set,
    toast,
  } = state
  const track = tracks[activeTrack] ?? tracks[0]!
  const frames = state.frameCount()
  const [result, setResult] = useState<ExportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [upload, setUpload] = useState<{ bytes: Uint8Array; tags: string[] } | null>(null)
  const [giphyResult, setGiphyResult] = useState<GiphyUploadResult | null>(null)
  const targetSpec = EXPORT_TARGETS[lineTarget]
  /**
   * 規格檢查看的是「合成後的整張畫面」，不是單一軌道。多軌時只要有任何一軌換圖，
   * 該格就是新的一幀，所以拿全部軌道串起來當比對鍵。
   */
  const compositeKeys = useMemo(
    () =>
      Array.from({ length: frames }, (_, i) =>
        tracks
          .map((_, trackIndex) => {
            const slot = state.resolveSlot(i, trackIndex)
            return slot ? `${slot.sourceId}:${slot.layerId}` : 'x'
          })
          .join('/'),
      ),
    [tracks, frames],
  )
  const plan = useMemo(
    () => planFromSlots(compositeKeys, fps, mergeIdentical),
    [compositeKeys, fps, mergeIdentical],
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
  const dimensions = (w: number, h: number, unlock = false): void =>
    set({ exportWidth: w, exportHeight: h, ...(unlock ? { lockAspect: false } : {}) })
  const adjust = (patch: Partial<{ zoom: number; offsetX: number; offsetY: number }>): void =>
    state.setTrack(activeTrack, patch)
  const selectTarget = (target: ExportTarget): void => {
    const next = EXPORT_TARGETS[target]
    const currentSettings: TargetSettings = {
      format,
      exportWidth: width,
      exportHeight: height,
      lockAspect: state.lockAspect,
      fps,
      playCount,
      scaleMode,
      staticFrame: state.staticFrame,
      gifColors: state.gifColors,
      gifMatte: state.gifMatte,
      zoom: track.zoom,
      offsetX: track.offsetX,
      offsetY: track.offsetY,
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
      scaleMode: 'smooth',
      staticFrame: next.staticOnly ? state.playhead : 0,
      gifColors: 256,
      gifMatte: null,
      // 噗浪只有 48×48，整張縮進去會看不清楚，預設先放大到「填滿」的程度讓人裁。
      zoom:
        target === 'plurkEmoticon' && doc
          ? Math.max(48 / doc.canvas.width, 48 / doc.canvas.height) /
            Math.min(48 / doc.canvas.width, 48 / doc.canvas.height)
          : 1,
      offsetX: 0,
      offsetY: 0,
    }
    const { zoom, offsetX, offsetY, ...rest } = remembered ?? defaults
    set({
      ...rest,
      lineTarget: target,
      playing: false,
      targetSettings: { ...state.targetSettings, [lineTarget]: currentSettings },
    })
    state.setTrack(activeTrack, { zoom, offsetX, offsetY })
  }
  const fill = (): void => {
    if (!doc) return
    const base = Math.min(width / doc.canvas.width, height / doc.canvas.height)
    adjust({
      zoom: Math.max(width / doc.canvas.width, height / doc.canvas.height) / base,
      offsetX: 0,
      offsetY: 0,
    })
  }
  const exportNow = async (): Promise<void> => {
    if (!doc) return
    if (
      errors.length &&
      !(await askConfirm(
        `${targetSpec.platform} 規格檢查沒過`,
        `有 ${errors.length} 項錯誤，仍要匯出嗎？`,
        '仍要匯出',
      ))
    )
      return
    setBusy(true)
    setResult(null)
    try {
      const done = await exportTo()
      setResult(done)
      if (done.ok) toast('success', `匯出完成：${done.filePath?.split(/[\\/]/).at(-1) ?? ''}`)
      else if (done.error !== '已取消匯出') toast('error', `匯出失敗：${done.error ?? '未知錯誤'}`)
    } catch (error) {
      toast('error', `匯出失敗：${error instanceof Error ? error.message : String(error)}`)
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
      const done = await window.api.saveMultiZip(payloads)
      setResult(done)
      toast(done.ok ? 'success' : 'error', done.ok ? 'ZIP 打包完成' : (done.error ?? '打包失敗'))
    } finally {
      setBusy(false)
    }
  }
  const durationTicks =
    EXPORT_TARGETS[lineTarget].allowedDurationsSec
      ?.map((seconds) => Math.round(frames / seconds))
      .filter((value) => value >= 1 && value <= 60) ?? []
  const autofix = doc
    ? autoFixForLine({
        target: lineTarget,
        canvasWidth: doc.canvas.width,
        canvasHeight: doc.canvas.height,
        frameKeys: compositeKeys,
        fps,
        playCount,
        exportWidth: width,
        exportHeight: height,
        format,
      })
    : null
  const applyAutofix = async (): Promise<void> => {
    if (!autofix) return
    const lines = autofix.changes.map((change) => `${change.label}　${change.from} → ${change.to}`)
    const unresolved = autofix.unresolved.map((message) => `仍需處理：${message}`)
    if (
      !(await askConfirm(
        '一鍵符合規範',
        `將套用以下調整：\n${[...lines, ...unresolved].join('\n')}`,
        '套用',
      ))
    )
      return
    // 補幀會大改影格，先把現況存回專案，按錯還有 Ctrl+Z 與已存檔可退。
    await saveCurrentProject()
    state.commit()
    // 補幀後的順序要同時套到每一條軌道，多軌的動作才不會被拆散。
    set({
      tracks: tracks.map((item, trackIndex) => ({
        ...item,
        slots: autofix.order.map(
          (frame) => state.resolveSlot(frame, trackIndex) ?? { sourceId: null, layerId: null },
        ),
      })),
      fps: autofix.fps,
      playCount: autofix.playCount,
      exportWidth: autofix.exportWidth,
      exportHeight: autofix.exportHeight,
      format: autofix.format,
      mergeIdentical: autofix.mergeIdentical,
      playhead: 0,
      selectedSlot: 0,
      selection: [],
      playing: false,
    })
    toast(
      autofix.unresolved.length ? 'info' : 'success',
      autofix.unresolved.length
        ? `已套用 ${autofix.changes.length} 項調整，但${autofix.unresolved[0]}`
        : `已套用 ${autofix.changes.length} 項 ${targetSpec.platform} 規範調整`,
    )
  }
  const prepareGiphy = async (): Promise<void> => {
    if (!props.settings?.hasGiphyKey) return props.openSettings()
    setBusy(true)
    setGiphyResult(null)
    try {
      const payload = await createExportPayload()
      const frames = payload.mergeIdentical
        ? mergeAdjacentIdenticalFrames(payload.frames)
        : payload.frames
      const encoded = encodeGif(frames, payload.width, payload.height, {
        numPlays: payload.numPlays,
        maxColors: payload.gif?.maxColors ?? 256,
        matte: payload.gif?.matte ?? null,
      })
      setUpload({ bytes: encoded.bytes, tags: [] })
    } catch (error) {
      toast('error', `GIF 轉檔失敗：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }
  const confirmGiphy = async (): Promise<void> => {
    if (!upload) return
    setBusy(true)
    try {
      const tags = upload.tags
      const done = await window.api.uploadGiphy({
        gifBytes: upload.bytes,
        tags: tags.join(','),
      })
      if (done.ok && tags.length > 0) {
        await window.api.addRecentTags(tags)
        props.onSettingsChanged(await window.api.getSettings())
      }
      setGiphyResult(done)
      setUpload(null)
      toast(
        done.ok ? 'success' : 'error',
        done.ok ? 'GIPHY 上傳成功' : `GIPHY 上傳失敗：${done.error ?? '未知錯誤'}`,
      )
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
              {Array.from({ length: frames }, (_, index) => (
                <option value={index} key={index}>
                  第 {index + 1} 格
                </option>
              ))}
            </select>
            <button onClick={() => set({ staticFrame: state.playhead })}>用目前這格</button>
          </div>
        )}
        <div className="section adjustment">
          <label className="label">畫面調整 — {track.name}</label>
          <label>
            縮放 <span>{Math.round(track.zoom * 100)}%</span>
            <input
              aria-label="縮放滑桿"
              type="range"
              min="20"
              max="400"
              value={Math.round(track.zoom * 100)}
              onInput={(e) => adjust({ zoom: Number(e.currentTarget.value) / 100 })}
            />
            <input
              aria-label="縮放百分比"
              type="number"
              min="20"
              max="400"
              value={Math.round(track.zoom * 100)}
              onChange={(e) =>
                adjust({ zoom: Math.max(0.2, Math.min(4, Number(e.target.value) / 100)) })
              }
            />
          </label>
          <label>
            位移 X <span>{track.offsetX} px</span>
            <input
              aria-label="位移 X 滑桿"
              type="range"
              min={-width}
              max={width}
              value={track.offsetX}
              onInput={(e) => adjust({ offsetX: Number(e.currentTarget.value) })}
            />
            <input
              aria-label="位移 X"
              type="number"
              value={track.offsetX}
              onChange={(e) => adjust({ offsetX: Number(e.target.value) })}
            />
          </label>
          <label>
            位移 Y <span>{track.offsetY} px</span>
            <input
              aria-label="位移 Y 滑桿"
              type="range"
              min={-height}
              max={height}
              value={track.offsetY}
              onInput={(e) => adjust({ offsetY: Number(e.currentTarget.value) })}
            />
            <input
              aria-label="位移 Y"
              type="number"
              value={track.offsetY}
              onChange={(e) => adjust({ offsetY: Number(e.target.value) })}
            />
          </label>
          <label>
            不透明度 <span>{Math.round(track.opacity * 100)}%</span>
            <input
              aria-label="不透明度滑桿"
              type="range"
              min="0"
              max="100"
              value={Math.round(track.opacity * 100)}
              onInput={(e) =>
                state.setTrack(activeTrack, { opacity: Number(e.currentTarget.value) / 100 })
              }
            />
          </label>
          <div className="quick">
            <button onClick={() => adjust({ zoom: 1, offsetX: 0, offsetY: 0 })}>符合</button>
            <button onClick={fill}>填滿</button>
            <button onClick={() => adjust({ zoom: 1, offsetX: 0, offsetY: 0 })}>重設</button>
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
          <div className="section gif-settings">
            <div className="gif-setting-grid">
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
              <label>
                邊緣底色
                <span className="gif-matte-control">
                  <select
                    aria-label="GIF 邊緣底色"
                    value={gifMatteChoice(state.gifMatte)}
                    onChange={(event) => {
                      const choice = event.target.value as GifMatteChoice
                      set({
                        gifMatte:
                          choice === 'none'
                            ? null
                            : choice === 'dark'
                              ? '#1e1e1e'
                              : choice === 'white'
                                ? '#ffffff'
                                : '#808080',
                      })
                    }}
                  >
                    <option value="none">無</option>
                    <option value="dark">深色</option>
                    <option value="white">白色</option>
                    <option value="custom">自訂</option>
                  </select>
                  {gifMatteChoice(state.gifMatte) === 'custom' && (
                    <input
                      aria-label="自訂 GIF 邊緣底色"
                      type="color"
                      value={state.gifMatte ?? '#808080'}
                      onChange={(event) => set({ gifMatte: event.target.value.toLowerCase() })}
                    />
                  )}
                </span>
              </label>
            </div>
            <small>GIF 使用固定調色盤量化</small>
            <small>
              半透明邊緣會預先混入這個顏色，避免在深淺背景上出現亮邊／暗邊（GIPHY 版面是深色）
            </small>
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
            <div>
              <span>時間軸格數</span>
              <b>{plan.timelineFrameCount}</b>
            </div>
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
            <p className="giphy-tag-hint">標籤讓別人搜得到這張 GIF，可留空。</p>
            <div className="giphy-tag-field">
              <span>標籤</span>
              <TagEditor
                tags={upload.tags}
                onChange={(tags) => setUpload({ ...upload, tags })}
                suggestions={props.settings?.giphyRecentTags ?? []}
              />
            </div>
            <footer>
              <button onClick={() => setUpload(null)}>取消</button>
              <button disabled={busy} onClick={() => void confirmGiphy()}>
                {busy ? '上傳中…' : '確認上傳'}
              </button>
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
