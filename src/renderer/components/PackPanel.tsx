import React from 'react'
import { EXPORT_TARGETS, type ExportTarget } from '../../codec/line.js'
import type { PackImportCell } from '../../project/types.js'
import { createEntityId } from '../../project/id.js'
import { packImportMessage } from '../packMessage.js'
import { refreshAllStaleDocumentCells, refreshLeavingActiveDocumentCell } from '../packDocument.js'
import { askConfirm } from '../prompt.js'
import {
  captureDocumentState,
  newTrack,
  runtimeDocument,
  useStore,
  type State,
} from '../state/store.js'

function newPackDocument(state: State) {
  const spec = EXPORT_TARGETS[state.packTarget]
  const width = spec.fixedSize?.width ?? spec.maxWidth
  const height = spec.fixedSize?.height ?? spec.maxHeight
  const format = state.packTarget === 'plurkEmoticon' ? 'gif' : spec.animated ? 'apng' : 'png'
  return runtimeDocument({
    tracks: [newTrack('圖層 1', 8)],
    visibility: [...state.visibility],
    fps: state.fps,
    playCount: state.playCount,
    format,
    lineTarget: state.packTarget,
    exportWidth: width,
    exportHeight: height,
    lockAspect: state.lockAspect,
    scaleMode: state.scaleMode,
    mergeIdentical: state.mergeIdentical,
    staticFrame: 0,
    gifColors: state.gifColors,
    activeSourceId: state.activeSourceId ?? undefined,
    contentRevision: 0,
  })
}

function errorFor(
  cell: PackImportCell | undefined,
  index: number | 'main' | 'tab',
  target: ExportTarget,
): string {
  if (!cell) return '尚未匯入'
  const expected = index === 'main' ? [240, 240] : index === 'tab' ? [96, 74] : null
  if (expected && (cell.width !== expected[0] || cell.height !== expected[1]))
    return `尺寸需為 ${expected[0]}×${expected[1]}`
  if (typeof index === 'number') {
    const spec = EXPORT_TARGETS[target]
    if (cell.width > spec.maxWidth || cell.height > spec.maxHeight)
      return `超過 ${spec.maxWidth}×${spec.maxHeight}`
    if (target === 'staticSticker' && (cell.width % 2 || cell.height % 2)) return '寬高需為偶數'
    if (target === 'staticSticker' && cell.frameCount > 1) return '一般貼圖必須是靜態 PNG'
    if (target === 'plurkEmoticon' && cell.frameCount > 1) return '噗浪不支援 APNG，請改用 GIF'
  }
  if (target === 'plurkEmoticon' && cell.byteLength >= 256 * 1024)
    return `檔案 ${(cell.byteLength / 1024).toFixed(1)} KB，必須小於 256 KB`
  return cell.byteLength > 1024 * 1024 ? '超過 1 MB' : ''
}

export function PackPanel(): React.JSX.Element {
  const state = useStore()
  const [thumbSize, setThumbSize] = React.useState(140)
  const targets: ExportTarget[] = ['staticSticker', 'sticker', 'emoji', 'plurkEmoticon']
  const cells = new Map(state.packCells.map((cell) => [cell.index, cell]))
  const indexes: Array<number | 'main' | 'tab'> = [
    ...Array.from({ length: state.packCount }, (_, index) => index + 1),
    ...(state.packTarget === 'plurkEmoticon' ? [] : (['main', 'tab'] as const)),
  ]
  const errors = indexes.flatMap((index) => {
    const error = errorFor(cells.get(index), index, state.packTarget)
    return error && error !== '尚未匯入' ? [`${index}：${error}`] : []
  })
  const completed = indexes.filter((index) => typeof index === 'number' && cells.has(index)).length

  const importFolder = async (): Promise<void> => {
    const result = await window.api.importPackFolder()
    if (!result) return
    state.set({ packCells: result.cells })
    state.toast(result.skipped.length ? 'info' : 'success', packImportMessage(result))
  }

  /**
   * 把拖進來的外部 PNG 放進指定格子。main／tab 也吃這條，
   * 所以商品圖片可以直接從檔案總管拖上去。
   */
  const dropImage = async (
    index: number | 'main' | 'tab',
    files: FileList | null,
  ): Promise<boolean> => {
    const file = files?.[0]
    if (!file) return false
    if (!/\.(png|apng)$/i.test(file.name)) {
      state.toast('error', `${file.name} 不是 PNG，貼圖組只吃 PNG／APNG`)
      return true
    }
    const previous = useStore.getState().packCells.find((cell) => cell.index === index)
    if (
      previous?.documentId &&
      !(await askConfirm(
        '覆蓋文件格',
        `第 ${String(index).padStart(2, '0')} 格的可編輯文件與復原記錄會被丟棄，確定改成外部 PNG 嗎？`,
        '覆蓋',
      ))
    )
      return true
    try {
      const filePath = window.api.getPathForFile(file)
      const encoded = await window.api.readPackImage(
        filePath ? { filePath } : { bytes: new Uint8Array(await file.arrayBuffer()) },
      )
      const current = useStore.getState()
      const documentId = current.packCells.find((cell) => cell.index === index)?.documentId
      if (documentId && current.activeDocumentId === documentId)
        current.switchDocument(current.standaloneDocumentId)
      const afterSwitch = useStore.getState()
      const documents = { ...afterSwitch.documents }
      if (documentId) delete documents[documentId]
      afterSwitch.set({
        documents,
        packCells: [
          ...afterSwitch.packCells.filter((cell) => cell.index !== index),
          { index, sourcePath: filePath ?? '', ...encoded },
        ],
      })
      state.toast(
        'success',
        `已放入 ${typeof index === 'number' ? String(index).padStart(2, '0') : index}：${file.name}`,
      )
    } catch (error) {
      state.toast(
        'error',
        `${file.name} 讀取失敗：${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return true
  }

  /** 把編號格重新排序：把 from 抽出來插到 to，其餘往後遞補，然後重新編號。 */
  const reorder = (from: number, to: number): void => {
    if (from === to) return
    const numbered = Array.from({ length: state.packCount }, (_, i) => cells.get(i + 1))
    const [moved] = numbered.splice(from - 1, 1)
    numbered.splice(to - 1, 0, moved)
    const renumbered = numbered.flatMap((cell, i) => (cell ? [{ ...cell, index: i + 1 }] : []))
    const accessories = state.packCells.filter((cell) => typeof cell.index !== 'number')
    state.set({ packCells: [...renumbered, ...accessories] })
  }

  /** 文件格直接開啟；空格建立空文件。外部圖片格維持不可編輯。 */
  const openCell = (index: number, cell?: PackImportCell): void => {
    if (cell && !cell.documentId) return
    const current = useStore.getState()
    if (cell?.documentId && current.documents[cell.documentId]) {
      if (current.activeDocumentId !== cell.documentId) void refreshLeavingActiveDocumentCell()
      current.switchDocument(cell.documentId)
      current.set({ mode: 'animation' })
      return
    }
    void refreshLeavingActiveDocumentCell()
    const documentId = createEntityId()
    const document = newPackDocument(current)
    current.set({
      documents: {
        ...current.documents,
        [current.activeDocumentId]: captureDocumentState(current),
        [documentId]: document,
      },
      packCells: [
        ...current.packCells.filter((item) => item.index !== index),
        {
          index,
          sourcePath: '',
          pngBase64: '',
          width: document.exportWidth,
          height: document.exportHeight,
          byteLength: 0,
          frameCount: 0,
          documentId,
          renderedRevision: -1,
          mime: document.format === 'gif' ? 'image/gif' : 'image/png',
        },
      ],
    })
    const latest = useStore.getState()
    latest.switchDocument(documentId)
    latest.set({ mode: 'animation' })
  }

  const pack = async (): Promise<void> => {
    const refreshed = await refreshAllStaleDocumentCells()
    if (refreshed.staleIndexes.length) {
      state.toast(
        'error',
        `這些格子的縮圖仍待更新，已停止打包：${refreshed.staleIndexes
          .map((index) => (typeof index === 'number' ? String(index).padStart(2, '0') : index))
          .join('、')}`,
      )
      return
    }
    const current = useStore.getState()
    const currentCells = new Map(current.packCells.map((cell) => [cell.index, cell]))
    const missing = indexes.filter((index) => !currentCells.has(index))
    const currentErrors = indexes.flatMap((index) => {
      const error = errorFor(currentCells.get(index), index, current.packTarget)
      return error && error !== '尚未匯入' ? [`${index}：${error}`] : []
    })
    if (
      (missing.length || currentErrors.length) &&
      !(await askConfirm(
        '貼圖組還沒完成',
        `尚有空格：${missing.map((index) => (typeof index === 'number' ? String(index).padStart(2, '0') : index)).join('、') || '無'}；${currentErrors.length} 項錯誤，仍要打包嗎？`,
        '仍要打包',
      ))
    )
      return
    const result = await window.api.exportPack(
      undefined,
      current.packCells.filter((cell) => indexes.includes(cell.index)),
      current.packTarget,
    )
    state.toast(
      result.ok ? 'success' : 'error',
      result.ok
        ? `已輸出：${result.filePath}（${((result.byteLength ?? 0) / 1024).toFixed(1)} KB）`
        : (result.error ?? '打包失敗'),
    )
  }

  const cellCard = (index: number): React.JSX.Element => {
    const cell = cells.get(index)
    const error = errorFor(cell, index, state.packTarget)
    return (
      <article
        className={`pack-cell ${cell ? 'filled' : 'empty'} ${error && error !== '尚未匯入' ? 'invalid' : ''} ${!cell || cell.documentId ? 'clickable' : ''}`}
        key={index}
        draggable={Boolean(cell)}
        onDragStart={(event) =>
          event.dataTransfer.setData('application/x-pack-index', String(index))
        }
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          // 一定要先看有沒有我們自己的搬移標記再看 files。
          // 縮圖是 <img src="data:...">，瀏覽器原生的圖片拖曳會在 dataTransfer 裡
          // 塞一個叫 download.png 的檔案；先檢查 files 的話，排序就會被誤判成
          // 「從外部拖了一張 PNG 進來」而變成複製。
          const from = Number(event.dataTransfer.getData('application/x-pack-index'))
          if (Number.isFinite(from) && from > 0) {
            reorder(from, index)
            return
          }
          if (event.dataTransfer.files.length) void dropImage(index, event.dataTransfer.files)
        }}
        onClick={() => openCell(index, cell)}
        title={!cell || cell.documentId ? '點一下進入這一格的編輯畫面' : undefined}
      >
        {cell?.pngBase64 && (
          <img
            draggable={false}
            src={`data:${cell.mime ?? 'image/png'};base64,${cell.pngBase64}`}
          />
        )}
        <b>{String(index).padStart(2, '0')}</b>
        <small>
          {cell
            ? cell.documentId && !cell.pngBase64
              ? '縮圖待更新'
              : `${cell.width}×${cell.height}`
            : '空'}
        </small>
        {cell && cell.frameCount > 1 && <em>▶ {cell.frameCount} 幀</em>}
        {error && error !== '尚未匯入' && <span>{error}</span>}
      </article>
    )
  }

  return (
    <section className="pack-workspace">
      <header>
        <div>
          <b>貼圖組</b>
          <span>把整套素材整理成 LINE 可直接上傳的結構</span>
        </div>
        <label>
          類型{' '}
          <select
            value={state.packTarget}
            onChange={(event) => {
              const target = event.target.value as ExportTarget
              state.set({
                packTarget: target,
                packCount: EXPORT_TARGETS[target].packCounts[0] ?? state.packCount,
              })
            }}
          >
            {targets.map((target) => (
              <option key={target} value={target}>
                {EXPORT_TARGETS[target].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          張數{' '}
          <select
            value={state.packCount}
            onChange={(event) => state.set({ packCount: Number(event.target.value) })}
          >
            {(EXPORT_TARGETS[state.packTarget].packCounts.length
              ? EXPORT_TARGETS[state.packTarget].packCounts
              : [state.packCount]
            ).map((count) => (
              <option key={count}>{count}</option>
            ))}
          </select>
        </label>
        <button onClick={() => void importFolder()}>匯入資料夾</button>
        <label className="thumb-size">
          縮圖大小　小{' '}
          <input
            aria-label="縮圖大小"
            type="range"
            min="120"
            max="200"
            step="20"
            value={thumbSize}
            onChange={(event) => setThumbSize(Number(event.target.value))}
          />{' '}
          大
        </label>
      </header>
      <div
        className="pack-grid"
        style={{ '--pack-cell-size': `${thumbSize}px` } as React.CSSProperties}
      >
        {indexes.filter((index): index is number => typeof index === 'number').map(cellCard)}
      </div>
      {state.packTarget !== 'plurkEmoticon' && (
        <section className="pack-accessories">
          <h3>商品圖片</h3>
          <p className="pack-note">main 與 tab 可以直接從檔案總管把 PNG 拖進來。</p>
          <div
            className="pack-grid"
            style={{ '--pack-cell-size': `${thumbSize}px` } as React.CSSProperties}
          >
            {(['main', 'tab'] as const).map((index) => {
              const cell = cells.get(index)
              const error = errorFor(cell, index, state.packTarget)
              return (
                <article
                  className={`pack-cell droppable ${cell ? 'filled' : 'empty'} ${error && error !== '尚未匯入' ? 'invalid' : ''}`}
                  key={index}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    // 編號格搬到 main/tab 沒有意義，只接受真的從外面拖進來的檔案。
                    if (event.dataTransfer.getData('application/x-pack-index')) return
                    void dropImage(index, event.dataTransfer.files)
                  }}
                >
                  {cell && (
                    <img
                      draggable={false}
                      src={`data:${cell.mime ?? 'image/png'};base64,${cell.pngBase64}`}
                    />
                  )}
                  <b>{index}</b>
                  <small>
                    {cell
                      ? `${cell.width}×${cell.height}`
                      : index === 'main'
                        ? '240×240（主要圖片）'
                        : '96×74（聊天縮圖）'}
                  </small>
                  {!cell && <i className="drop-hint">把 PNG 拖進來</i>}
                  {error && error !== '尚未匯入' && <span>{error}</span>}
                </article>
              )
            })}
          </div>
        </section>
      )}
      <footer>
        <b>
          已完成 {completed} / {state.packCount}
        </b>
        {state.packTarget !== 'plurkEmoticon' && (
          <span>
            main {cells.has('main') ? '✓' : '—'}　tab {cells.has('tab') ? '✓' : '—'}
          </span>
        )}
        <span>
          總計{' '}
          {(state.packCells.reduce((sum, cell) => sum + cell.byteLength, 0) / 1024 / 1024).toFixed(
            1,
          )}{' '}
          MB
        </span>
        <button onClick={() => void pack()}>
          {state.packTarget === 'plurkEmoticon' ? '輸出資料夾' : '打包成 ZIP'}
        </button>
      </footer>
    </section>
  )
}
