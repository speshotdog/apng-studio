import type { EncodedDocumentCache, PackCellIndex, PackImportCell } from '../project/types.js'
import type { PackEncoded } from '../preload/api.js'
import {
  captureExportSnapshot,
  createExportPayloadFromSnapshot,
  type ExportDocumentSnapshot,
} from './export.js'
import { captureDocumentState, useStore, type State } from './state/store.js'

export interface DocumentRenderToken {
  projectId: string
  documentId: string
  contentRevision: number
}

export type RefreshStatus = 'updated' | 'discarded' | 'failed' | 'missing'

export interface RefreshResult {
  token?: DocumentRenderToken
  status: RefreshStatus
  error?: unknown
}

interface CapturedRefresh<Snapshot> {
  token: DocumentRenderToken
  snapshot: Snapshot
}

export interface DocumentRefreshRuntime<Snapshot, Encoded> {
  capture(documentId: string): CapturedRefresh<Snapshot> | null
  render(snapshot: Snapshot): Promise<Encoded>
  commit(token: DocumentRenderToken, encoded: Encoded): boolean
  onError?(token: DocumentRenderToken, error: unknown): void
}

interface QueueItem<Snapshot, Encoded> {
  captured: CapturedRefresh<Snapshot>
  resolve(result: RefreshResult): void
}

/** 可注入依賴的純佇列；renderer 與無 Electron 驗證共用這個 token 行為。 */
export class DocumentRefreshQueue<Snapshot, Encoded> {
  private readonly pending: Array<QueueItem<Snapshot, Encoded>> = []
  private active = 0

  constructor(
    private readonly runtime: DocumentRefreshRuntime<Snapshot, Encoded>,
    private readonly concurrency = 2,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('渲染併行數必須大於 0')
  }

  refresh(documentId: string): Promise<RefreshResult> {
    const captured = this.runtime.capture(documentId)
    if (!captured) return Promise.resolve({ status: 'missing' })
    return new Promise((resolve) => {
      this.pending.push({ captured, resolve })
      this.pump()
    })
  }

  private pump(): void {
    while (this.active < this.concurrency) {
      const item = this.pending.shift()
      if (!item) return
      this.active += 1
      void this.run(item).finally(() => {
        this.active -= 1
        this.pump()
      })
    }
  }

  private async run(item: QueueItem<Snapshot, Encoded>): Promise<void> {
    const { token, snapshot } = item.captured
    try {
      const encoded = await this.runtime.render(snapshot)
      item.resolve({ token, status: this.runtime.commit(token, encoded) ? 'updated' : 'discarded' })
    } catch (error) {
      this.runtime.onError?.(token, error)
      item.resolve({ token, status: 'failed', error })
    }
  }
}

type EncodedCacheBody = Omit<EncodedDocumentCache, 'renderedRevision'>

export interface PackDocumentRenderer {
  render(snapshot: ExportDocumentSnapshot): Promise<EncodedCacheBody>
}

function activeDocumentRevision(state: State, documentId: string): number | null {
  const document =
    documentId === state.activeDocumentId
      ? captureDocumentState(state)
      : state.documents[documentId]
  return document?.contentRevision ?? null
}

function documentCell(state: State, documentId: string): PackImportCell | undefined {
  return state.packCells.find((cell) => cell.documentId === documentId)
}

const ipcRenderer: PackDocumentRenderer = {
  async render(snapshot) {
    const payload = await createExportPayloadFromSnapshot(snapshot)
    const encoded: PackEncoded = await window.api.encodeForPack(payload)
    return {
      base64: encoded.pngBase64,
      mime: encoded.mime ?? (payload.format === 'gif' ? 'image/gif' : 'image/png'),
      width: encoded.width,
      height: encoded.height,
      byteLength: encoded.byteLength,
      frameCount: encoded.frameCount,
    }
  },
}

export function createPackDocumentRefreshService(
  renderer: PackDocumentRenderer = ipcRenderer,
): DocumentRefreshQueue<ExportDocumentSnapshot, EncodedCacheBody> {
  return new DocumentRefreshQueue<ExportDocumentSnapshot, EncodedCacheBody>(
    {
      capture(documentId) {
        const state = useStore.getState()
        if (!state.project || !state.documents[documentId] || !documentCell(state, documentId))
          return null
        const snapshot = captureExportSnapshot(documentId)
        return {
          token: {
            projectId: state.project.id,
            documentId,
            contentRevision: snapshot.document.contentRevision,
          },
          snapshot,
        }
      },
      render: (snapshot) => renderer.render(snapshot),
      commit(token, encoded) {
        const state = useStore.getState()
        if (state.project?.id !== token.projectId) return false
        if (activeDocumentRevision(state, token.documentId) !== token.contentRevision) return false
        if (!documentCell(state, token.documentId)) return false
        useStore.setState((current) => ({
          packCells: current.packCells.map((cell) =>
            cell.documentId === token.documentId
              ? {
                  ...cell,
                  pngBase64: encoded.base64,
                  mime: encoded.mime,
                  width: encoded.width,
                  height: encoded.height,
                  byteLength: encoded.byteLength,
                  frameCount: encoded.frameCount,
                  renderedRevision: token.contentRevision,
                }
              : cell,
          ),
        }))
        return true
      },
      onError(token, error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`文件格 ${token.documentId} 縮圖編碼失敗：${message}`)
        useStore.getState().toast('error', `縮圖待更新：${message}`)
      },
    },
    2,
  )
}

const sharedRefreshService = createPackDocumentRefreshService()

/** 從指定 EditorDocument 的單次快照重算 encoded cache。 */
export function refreshCellCache(documentId: string): Promise<RefreshResult> {
  return sharedRefreshService.refresh(documentId)
}

export function isDocumentCellStale(cell: PackImportCell, state = useStore.getState()): boolean {
  if (!cell.documentId) return false
  const revision = activeDocumentRevision(state, cell.documentId)
  return (
    revision === null ||
    !cell.pngBase64 ||
    cell.renderedRevision === undefined ||
    cell.renderedRevision !== revision
  )
}

/** 離開文件格時先保留舊圖、只把 revision 標成落後。 */
export function markDocumentCellStale(documentId: string): void {
  const state = useStore.getState()
  const revision = activeDocumentRevision(state, documentId)
  if (revision === null || !documentCell(state, documentId)) return
  useStore.setState({
    packCells: state.packCells.map((cell) =>
      cell.documentId === documentId
        ? { ...cell, renderedRevision: Math.min(cell.renderedRevision ?? -1, revision - 1) }
        : cell,
    ),
  })
}

/** 切格／回貼圖組／切 standalone 共用的離開生命週期。 */
export function refreshLeavingActiveDocumentCell(): Promise<RefreshResult> | null {
  const state = useStore.getState()
  if (!documentCell(state, state.activeDocumentId)) return null
  markDocumentCellStale(state.activeDocumentId)
  return refreshCellCache(state.activeDocumentId)
}

/** 存檔前只刷新作用中且確實 stale 的文件格。 */
export function refreshActiveDocumentCellIfStale(): Promise<RefreshResult> | null {
  const state = useStore.getState()
  const cell = documentCell(state, state.activeDocumentId)
  if (!cell || !isDocumentCellStale(cell, state)) return null
  return refreshCellCache(state.activeDocumentId)
}

export interface RefreshAllResult {
  results: RefreshResult[]
  staleIndexes: PackCellIndex[]
}

/** ZIP 前刷新所有 stale 文件格；底層佇列會把同時編碼數限制在 2。 */
export async function refreshAllStaleDocumentCells(): Promise<RefreshAllResult> {
  const before = useStore.getState()
  const documentIds = [
    ...new Set(
      before.packCells
        .filter((cell) => cell.documentId && isDocumentCellStale(cell, before))
        .map((cell) => cell.documentId!),
    ),
  ]
  const results = await Promise.all(documentIds.map((documentId) => refreshCellCache(documentId)))
  const after = useStore.getState()
  return {
    results,
    staleIndexes: after.packCells
      .filter((cell) => cell.documentId && isDocumentCellStale(cell, after))
      .map((cell) => cell.index),
  }
}
