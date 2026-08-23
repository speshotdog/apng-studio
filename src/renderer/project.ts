import type { ProjectBlob, ProjectMeta } from '../project/types.js'
import { askConfirm, askText } from './prompt.js'
import { applyEditorState, captureEditorState } from './snapshot.js'
import { useStore } from './state/store.js'

/** 自動存檔間隔。夠短到當機不會痛，又不會一直在寫磁碟。 */
export const AUTOSAVE_INTERVAL_MS = 30_000

export function captureBlob(): ProjectBlob {
  const state = useStore.getState()
  return {
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

function thumbnail(): string | undefined {
  const canvas = document.querySelector<HTMLCanvasElement>('.stage canvas')
  return canvas?.toDataURL('image/png')
}

/** 套用一份專案內容到編輯器（呼叫端要先把來源檔開好）。 */
export async function applyBlob(blob: ProjectBlob): Promise<void> {
  applyEditorState(blob.state)
  const packCells = blob.pack ? await window.api.hydratePackCells(blob.pack.cells) : []
  useStore.getState().set({
    packTarget: blob.pack?.target ?? 'staticSticker',
    packCount: blob.pack?.count ?? 32,
    packCells,
    dirty: false,
  })
}

/** 存回目前開著的專案。沒有開專案就什麼都不做。 */
export async function saveCurrentProject(): Promise<boolean> {
  const state = useStore.getState()
  if (!state.project) return false
  try {
    const meta = await window.api.saveProject(state.project.id, captureBlob(), thumbnail())
    useStore.getState().set({ project: meta, dirty: false })
    state.toast('success', `已儲存「${meta.name}」`)
    return true
  } catch (error) {
    state.toast('error', `儲存失敗：${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/** 另存成一個新專案，並切換到它。 */
export async function saveAsNewProject(): Promise<ProjectMeta | null> {
  const state = useStore.getState()
  if (!state.doc) return null
  const name = await askText('另存新專案', `${state.project?.name ?? '未命名'} 拷貝`)
  if (!name) return null
  try {
    const meta = await window.api.createProject({
      name,
      sourcePath: state.doc.filePath,
      sourceName: state.doc.filePath.split(/[\\/]/).at(-1) ?? '',
      state: captureBlob(),
      thumbnailDataUrl: thumbnail(),
    })
    useStore.getState().set({ project: meta, dirty: false })
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
  let doc = await window.api.openClip(meta.sourcePath).catch(() => null)
  let sourceChanged = false
  if (!doc) {
    // 來源檔被搬走或改名時，如果不給補救的機會，這個專案就永遠打不開了。
    const retry = await askConfirm(
      '找不到來源檔',
      `${meta.sourceName}\n${meta.sourcePath}\n\n檔案可能被搬走或改名了。要重新指定嗎？`,
      '重新指定',
    )
    if (!retry) return false
    doc = await window.api.openClip().catch(() => null)
    if (!doc) return false
    sourceChanged = true
  }
  const blob = await window.api.readProject(meta.id)
  if (!blob) {
    store.toast('error', `專案「${meta.name}」讀不到內容`)
    return false
  }
  store.open(doc)
  let restored = false
  if (meta.hasAutosave) {
    const autosave = await window.api.readProjectAutosave(meta.id)
    if (autosave) {
      const when = new Date(autosave.savedAt).toLocaleString('zh-TW')
      restored = await askConfirm(
        '有未儲存的自動存檔',
        `「${meta.name}」在 ${when} 有一份自動存檔，比你上次手動儲存的還新。\n要用它繼續嗎？（選「用已儲存的」會丟掉這份自動存檔）`,
        '復原自動存檔',
      )
      if (restored) await applyBlob(autosave.state)
      else await window.api.discardProjectAutosave(meta.id)
    }
  }
  if (!restored) await applyBlob(blob)
  const sourceName = doc.filePath.split(/[\\/]/).at(-1) ?? meta.sourceName
  useStore.getState().set({
    project: {
      ...meta,
      sourcePath: doc.filePath,
      sourceName,
      hasAutosave: false,
      autosaveAt: null,
    },
    screen: 'editor',
    dirty: restored || sourceChanged,
  })
  if (sourceChanged) {
    // 立刻把新的來源路徑寫回去，不然下次開還是找不到。
    await saveCurrentProject()
    store.toast('info', `來源檔已改指向 ${sourceName}`)
  } else {
    store.toast(
      restored ? 'info' : 'success',
      restored ? `已復原「${meta.name}」的自動存檔，記得再存一次` : `已開啟「${meta.name}」`,
    )
  }
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
    useStore.getState().set({ project: meta, screen: 'editor', dirty: false })
    store.toast('success', `已建立專案「${meta.name}」`)
    return true
  } catch (error) {
    store.toast('error', `建立失敗：${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
