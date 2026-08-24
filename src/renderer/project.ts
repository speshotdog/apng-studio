import type { ClipSummary } from '../preload/api.js'
import type { ProjectBlob, ProjectMeta, ProjectPackCell, SourceAsset } from '../project/types.js'
import { askConfirm, askText } from './prompt.js'
import { captureEditorDocuments } from './snapshot.js'
import { runtimeDocument, useStore } from './state/store.js'
import { refreshActiveDocumentCellIfStale } from './packDocument.js'
import { SaveCoordinator } from './saveCoordinator.js'

/** 自動存檔間隔。夠短到當機不會痛，又不會一直在寫磁碟。 */
export const AUTOSAVE_INTERVAL_MS = 30_000

const saveCoordinator = new SaveCoordinator<ProjectMeta>({
  state() {
    const state = useStore.getState()
    return {
      projectId: state.project?.id ?? null,
      projectRevision: state.projectRevision,
      savedRevision: state.savedRevision,
    }
  },
  commit(token, meta) {
    const state = useStore.getState()
    if (state.project?.id !== token.projectId || state.savedRevision >= token.projectRevision)
      return
    const savedRevision = token.projectRevision
    useStore.setState({
      project: meta,
      savedRevision,
      dirty: state.projectRevision !== savedRevision,
    })
  },
})

const autosaveFailures = new Map<string, number>()

export function captureBlob(): ProjectBlob {
  const state = useStore.getState()
  const cells: ProjectPackCell[] = state.packCells.map((cell) =>
    cell.documentId
      ? {
          kind: 'document',
          index: cell.index,
          documentId: cell.documentId,
          encoded: cell.pngBase64
            ? {
                base64: cell.pngBase64,
                mime: cell.mime ?? 'image/png',
                width: cell.width,
                height: cell.height,
                byteLength: cell.byteLength,
                frameCount: cell.frameCount,
                renderedRevision: cell.renderedRevision ?? -1,
              }
            : undefined,
        }
      : {
          kind: 'external',
          index: cell.index,
          sourcePath: cell.sourcePath,
          pngBase64: cell.pngBase64,
          width: cell.width,
          height: cell.height,
          byteLength: cell.byteLength,
          frameCount: cell.frameCount,
        },
  )
  return {
    version: 2,
    sources: state.sources,
    editorDocuments: captureEditorDocuments(),
    standaloneDocumentId: state.standaloneDocumentId,
    pack: {
      target: state.packTarget,
      count: state.packCount,
      cells,
    },
  }
}

function sourceName(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath
}

function legacySource(meta: ProjectMeta): SourceAsset {
  return {
    id: crypto.randomUUID(),
    path: meta.sourcePath,
    name: meta.sourceName || sourceName(meta.sourcePath),
  }
}

async function loadSourcesForState(
  requestedSources: SourceAsset[],
  meta: ProjectMeta,
): Promise<{
  sources: SourceAsset[]
  docs: Record<string, ClipSummary>
  changed: boolean
  missing: string[]
}> {
  const requested = requestedSources.length ? requestedSources : [legacySource(meta)]
  const docs: Record<string, ClipSummary> = {}
  const sources: SourceAsset[] = []
  const missing: string[] = []
  const changed = !requestedSources.length
  for (const source of requested) {
    const doc = await window.api.openClip(source.path).catch(() => null)
    sources.push(source)
    // 讀不到就先當成「缺失」（docs 裡沒有這一筆），素材面板會標紅字讓使用者重新連結。
    // 一份素材不見不該讓整個專案打不開 —— 其他張貼圖還是要能繼續做。
    if (doc) docs[source.id] = doc
    else missing.push(source.name || sourceName(source.path))
  }
  return { sources, docs, changed, missing }
}

function thumbnail(): string | undefined {
  const canvas = document.querySelector<HTMLCanvasElement>('.stage canvas')
  return canvas?.toDataURL('image/png')
}

/** 套用一份專案內容到編輯器（呼叫端要先把來源檔開好）。 */
export async function applyBlob(blob: ProjectBlob): Promise<void> {
  const packCells = blob.pack ? await window.api.hydratePackCells(blob.pack.cells) : []
  const current = useStore.getState()
  const sources = blob.sources.length ? blob.sources : current.sources
  const documents = Object.fromEntries(
    Object.entries(blob.editorDocuments).map(([id, document]) => [id, runtimeDocument(document)]),
  )
  const activeDocumentId = documents[blob.standaloneDocumentId]
    ? blob.standaloneDocumentId
    : (Object.keys(documents)[0] ?? '')
  const document = documents[activeDocumentId]
  if (!document) throw new Error('專案沒有可用的編輯文件')
  const activeSourceId =
    document.activeSourceId && current.docs[document.activeSourceId]
      ? document.activeSourceId
      : (sources.find((source) => current.docs[source.id])?.id ?? document.activeSourceId ?? null)
  useStore.setState({
    sources,
    documents,
    activeDocumentId,
    standaloneDocumentId: activeDocumentId,
    tracks: document.tracks,
    visibility: new Map(document.visibility),
    fps: document.fps,
    playCount: document.playCount,
    format: document.format,
    lineTarget: document.lineTarget,
    exportWidth: document.exportWidth,
    exportHeight: document.exportHeight,
    lockAspect: document.lockAspect,
    scaleMode: document.scaleMode,
    mergeIdentical: document.mergeIdentical,
    staticFrame: document.staticFrame,
    gifColors: document.gifColors,
    activeSourceId,
    doc: activeSourceId ? (current.docs[activeSourceId] ?? null) : null,
    contentRevision: document.contentRevision,
    activeTrack: document.activeTrack,
    trimmed: document.trimmed,
    past: document.past,
    future: document.future,
    selection: [],
    selectedSlot: 0,
    playhead: 0,
    playing: false,
    packTarget: blob.pack?.target ?? 'staticSticker',
    packCount: blob.pack?.count ?? 32,
    packCells,
    projectRevision: 0,
    savedRevision: 0,
    dirty: false,
  })
}

/** 存回目前開著的專案。沒有開專案就什麼都不做。 */
export async function saveCurrentProject(): Promise<boolean> {
  const state = useStore.getState()
  if (!state.project) return false
  try {
    const result = await saveCoordinator.save(async (token) => {
      await refreshActiveDocumentCellIfStale()
      if (useStore.getState().project?.id !== token.projectId) throw new Error('存檔期間已切換專案')
      return window.api.saveProject(token.projectId, captureBlob(), thumbnail())
    })
    if (result.status === 'skipped') return false
    if (useStore.getState().project?.id === result.value.id)
      state.toast('success', `已儲存「${result.value.name}」`)
    return true
  } catch (error) {
    state.toast('error', `儲存失敗：${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/** 自動存檔也走正式存檔的同一條專案佇列，但不推進 savedRevision。 */
export async function autosaveCurrentProject(): Promise<void> {
  const requested = useStore.getState()
  const projectId = requested.project?.id
  if (!projectId || !requested.dirty) return
  try {
    const result = await saveCoordinator.autosave(async (token) => {
      await refreshActiveDocumentCellIfStale()
      if (useStore.getState().project?.id !== token.projectId) return
      await window.api.autosaveProject(token.projectId, captureBlob())
    })
    if (result.status === 'completed') autosaveFailures.delete(projectId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`自動存檔失敗：${message}`)
    const failures = (autosaveFailures.get(projectId) ?? 0) + 1
    autosaveFailures.set(projectId, failures)
    if (failures === 3 && useStore.getState().project?.id === projectId)
      useStore.getState().toast('error', `自動存檔已連續失敗 3 次：${message}`)
  }
}

/** 另存成一個新專案，並切換到它。 */
export async function saveAsNewProject(): Promise<ProjectMeta | null> {
  const state = useStore.getState()
  if (!state.doc) return null
  const firstSource = state.sources[0]
  const name = await askText('另存新專案', `${state.project?.name ?? '未命名'} 拷貝`)
  if (!name) return null
  try {
    await refreshActiveDocumentCellIfStale()
    const meta = await window.api.createProject({
      name,
      sourcePath: firstSource?.path ?? state.doc.filePath,
      sourceName: firstSource?.name ?? sourceName(state.doc.filePath),
      state: captureBlob(),
      thumbnailDataUrl: thumbnail(),
    })
    const current = useStore.getState()
    useStore.setState({ project: meta, savedRevision: current.projectRevision, dirty: false })
    state.toast('success', `已另存為「${meta.name}」`)
    return meta
  } catch (error) {
    state.toast('error', `另存失敗：${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * 離開編輯器前的把關。有未存檔的變更就問要不要存回目前專案。
 * 回傳 false 代表使用者取消，呼叫端要中止。
 */
export async function guardUnsaved(action: string): Promise<boolean> {
  const state = useStore.getState()
  if (!state.dirty || !state.project) return true
  const answer = await askConfirm(
    '還沒儲存',
    `「${state.project.name}」有未儲存的變更。按「儲存」會存回這個專案再${action}。`,
    '儲存',
  )
  if (!answer) return false
  return saveCurrentProject()
}

/** 開啟一個既有專案：載入來源檔 → 套用狀態 →（必要時）詢問是否復原自動存檔。 */
export async function openProject(meta: ProjectMeta): Promise<boolean> {
  const store = useStore.getState()
  const blob = await window.api.readProject(meta.id)
  if (!blob) {
    store.toast('error', `專案「${meta.name}」讀不到內容`)
    return false
  }
  let restored = false
  let stateBlob = blob
  if (meta.hasAutosave) {
    const autosave = await window.api.readProjectAutosave(meta.id)
    if (autosave) {
      const when = new Date(autosave.savedAt).toLocaleString('zh-TW')
      restored = await askConfirm(
        '有未儲存的自動存檔',
        `「${meta.name}」在 ${when} 有一份自動存檔，比你上次手動儲存的還新。\n要用它繼續嗎？（選「用已儲存的」會丟掉這份自動存檔）`,
        '復原自動存檔',
      )
      if (restored) stateBlob = autosave.state
      else await window.api.discardProjectAutosave(meta.id)
    }
  }
  const loaded = await loadSourcesForState(stateBlob.sources, meta)
  if (!loaded) return false
  store.loadSources(
    loaded.sources,
    loaded.docs,
    stateBlob.editorDocuments[stateBlob.standaloneDocumentId]?.activeSourceId ??
      loaded.sources[0]?.id ??
      null,
  )
  await applyBlob(stateBlob)
  const firstSource = loaded.sources[0]
  useStore.setState({
    project: {
      ...meta,
      sourcePath: firstSource?.path ?? meta.sourcePath,
      sourceName: firstSource?.name ?? meta.sourceName,
      hasAutosave: false,
      autosaveAt: null,
    },
    screen: 'editor',
    projectRevision: restored || loaded.changed ? 1 : 0,
    savedRevision: 0,
    dirty: restored || loaded.changed,
  })
  if (loaded.changed) {
    await saveCurrentProject()
  }
  if (loaded.missing.length)
    store.toast(
      'error',
      `有 ${loaded.missing.length} 個素材找不到檔案（${loaded.missing.join('、')}），` +
        '請到左邊「素材」面板按「重新連結」。',
    )
  else
    store.toast(
      restored ? 'info' : 'success',
      restored ? `已復原「${meta.name}」的自動存檔，記得再存一次` : `已開啟「${meta.name}」`,
    )
  return true
}

/** 從一個來源檔建立新專案。 */
export async function createProjectFrom(sourcePath?: string): Promise<boolean> {
  const store = useStore.getState()
  const doc = await window.api.openClip(sourcePath).catch((error: unknown) => {
    store.toast('error', error instanceof Error ? error.message : String(error))
    return null
  })
  if (!doc) return false
  const sourceName = doc.filePath.split(/[\\/]/).at(-1) ?? ''
  const name = await askText('專案名稱', sourceName.replace(/\.[^.]+$/, ''))
  if (!name) return false
  store.open(doc)
  try {
    const meta = await window.api.createProject({
      name,
      sourcePath: doc.filePath,
      sourceName,
      state: captureBlob(),
    })
    const current = useStore.getState()
    useStore.setState({
      project: meta,
      screen: 'editor',
      savedRevision: current.projectRevision,
      dirty: false,
    })
    store.toast('success', `已建立專案「${meta.name}」`)
    return true
  } catch (error) {
    store.toast('error', `建立失敗：${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
