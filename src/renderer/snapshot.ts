import type { EditorDocument } from '../project/types.js'
import {
  captureDocumentState,
  runtimeDocument,
  useStore,
  type DocumentState,
} from './state/store.js'

function persisted(document: DocumentState): EditorDocument {
  return {
    tracks: document.tracks.map((track) => ({
      ...track,
      slots: track.slots.map((slot) => ({ ...slot })),
    })),
    visibility: document.visibility.map(([key, visible]) => [key, visible]),
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
    activeSourceId: document.activeSourceId,
    contentRevision: document.contentRevision,
  }
}

/** 取得作用中文件；不再把專案 sources 複製進每份文件。 */
export function captureEditorState(): EditorDocument {
  return persisted(captureDocumentState(useStore.getState()))
}

/** 存檔前先把根層工作副本寫回作用中文件。 */
export function captureEditorDocuments(): Record<string, EditorDocument> {
  const state = useStore.getState()
  const documents = {
    ...state.documents,
    [state.activeDocumentId]: captureDocumentState(state),
  }
  return Object.fromEntries(
    Object.entries(documents).map(([id, document]) => [id, persisted(document)]),
  )
}

/**
 * 以快照覆蓋作用中文件。一般呼叫是語意變更，不會再暗中把 dirty 清掉；
 * 專案剛載入請由 applyBlob 的初始化路徑一次設定完整 store。
 */
export function applyEditorState(stored: EditorDocument): void {
  const state = useStore.getState()
  const next = runtimeDocument({ ...stored, contentRevision: stored.contentRevision + 1 })
  const projectRevision = state.projectRevision + 1
  useStore.setState({
    documents: {
      ...state.documents,
      [state.activeDocumentId]: next,
    },
    tracks: next.tracks,
    visibility: new Map(next.visibility),
    fps: next.fps,
    playCount: next.playCount,
    format: next.format,
    lineTarget: next.lineTarget,
    exportWidth: next.exportWidth,
    exportHeight: next.exportHeight,
    lockAspect: next.lockAspect,
    scaleMode: next.scaleMode,
    mergeIdentical: next.mergeIdentical,
    staticFrame: next.staticFrame,
    gifColors: next.gifColors,
    activeSourceId: next.activeSourceId ?? null,
    doc: next.activeSourceId ? (state.docs[next.activeSourceId] ?? null) : null,
    contentRevision: next.contentRevision,
    activeTrack: 0,
    trimmed: {},
    past: [],
    future: [],
    selection: [],
    selectedSlot: 0,
    playhead: 0,
    playing: false,
    projectRevision,
    dirty: projectRevision !== state.savedRevision,
  })
}
