import assert from 'node:assert/strict'
import type { EditorDocument, ProjectMeta } from '../src/project/types.js'
import {
  createPackDocumentRefreshService,
  isDocumentCellStale,
} from '../src/renderer/packDocument.js'
import { newTrack, runtimeDocument, useStore } from '../src/renderer/state/store.js'

const editorDocument = (name: string, fps: number): EditorDocument => ({
  tracks: [{ ...newTrack(name, 2), id: name }],
  visibility: [],
  fps,
  playCount: 1,
  format: 'apng',
  lineTarget: 'sticker',
  exportWidth: 320,
  exportHeight: 270,
  lockAspect: true,
  scaleMode: 'smooth',
  mergeIdentical: true,
  staticFrame: 0,
  gifColors: 256,
  contentRevision: 0,
})

const project: ProjectMeta = {
  id: 'project-a',
  name: 'pack verification',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  sourcePath: '',
  sourceName: '',
  hasAutosave: false,
  autosaveAt: null,
}
const documentA = runtimeDocument(editorDocument('document-a', 12))
const documentB = runtimeDocument(editorDocument('document-b', 24))

useStore.setState({
  project,
  documents: { a: documentA, b: documentB },
  activeDocumentId: 'a',
  standaloneDocumentId: 'b',
  sources: [],
  activeSourceId: null,
  docs: {},
  doc: null,
  bitmaps: new Map(),
  tracks: documentA.tracks,
  visibility: new Map(),
  fps: documentA.fps,
  playCount: documentA.playCount,
  format: documentA.format,
  lineTarget: documentA.lineTarget,
  exportWidth: documentA.exportWidth,
  exportHeight: documentA.exportHeight,
  contentRevision: 0,
  projectRevision: 0,
  savedRevision: 0,
  dirty: false,
  packCells: [
    {
      index: 1,
      sourcePath: '',
      pngBase64: 'old-a',
      mime: 'image/png',
      width: 320,
      height: 270,
      byteLength: 5,
      frameCount: 1,
      documentId: 'a',
      renderedRevision: 0,
    },
    {
      index: 2,
      sourcePath: '',
      pngBase64: 'old-b',
      mime: 'image/png',
      width: 320,
      height: 270,
      byteLength: 5,
      frameCount: 1,
      documentId: 'b',
      renderedRevision: 0,
    },
  ],
})

// 編輯 A 後，文件 revision 前進但舊 encoded cache 保留，因此必須判定 stale。
useStore.getState().set({ fps: 13 })
let cellA = useStore.getState().packCells.find((cell) => cell.documentId === 'a')!
assert.equal(useStore.getState().contentRevision, 1)
assert.equal(cellA.renderedRevision, 0)
assert.equal(isDocumentCellStale(cellA), true)

const service = createPackDocumentRefreshService({
  async render(snapshot) {
    return {
      base64: `rendered-${snapshot.document.contentRevision}`,
      mime: 'image/png',
      width: snapshot.document.exportWidth,
      height: snapshot.document.exportHeight,
      byteLength: 10,
      frameCount: snapshot.document.tracks[0]?.slots.length ?? 1,
    }
  },
})
const refreshed = await service.refresh('a')
assert.equal(refreshed.status, 'updated')
cellA = useStore.getState().packCells.find((cell) => cell.documentId === 'a')!
assert.equal(cellA.renderedRevision, useStore.getState().contentRevision)
assert.equal(isDocumentCellStale(cellA), false)

// 渲染途中又編輯：舊 token 回來時不得蓋掉 revision 1 的 cache。
let release!: () => void
const blocked = createPackDocumentRefreshService({
  async render(snapshot) {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return {
      base64: `obsolete-${snapshot.document.contentRevision}`,
      mime: 'image/png',
      width: 320,
      height: 270,
      byteLength: 99,
      frameCount: 2,
    }
  },
})
const obsolete = blocked.refresh('a')
await Promise.resolve()
useStore.getState().set({ fps: 14 })
release()
assert.equal((await obsolete).status, 'discarded')
cellA = useStore.getState().packCells.find((cell) => cell.documentId === 'a')!
assert.equal(cellA.pngBase64, 'rendered-1')
assert.equal(cellA.renderedRevision, 1)
assert.equal(isDocumentCellStale(cellA), true)

// 編碼失敗只回報錯誤；舊 cache 與文件都必須留在原位。
const beforeFailure = { ...cellA }
const failed = createPackDocumentRefreshService({
  async render() {
    throw new Error('fake encoder failure')
  },
})
const originalWarn = console.warn
console.warn = () => undefined
const failureResult = await failed.refresh('a')
console.warn = originalWarn
assert.equal(failureResult.status, 'failed')
assert.deepEqual(
  useStore.getState().packCells.find((cell) => cell.documentId === 'a'),
  beforeFailure,
)
assert(useStore.getState().documents.a)

// 即使同時要求三次，實際 renderer 的峰值也只能是 2。
let active = 0
let maxActive = 0
const limited = createPackDocumentRefreshService({
  async render(snapshot) {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 10))
    active -= 1
    return {
      base64: `limited-${snapshot.document.contentRevision}`,
      mime: 'image/png',
      width: 320,
      height: 270,
      byteLength: 10,
      frameCount: 2,
    }
  },
})
await Promise.all([limited.refresh('a'), limited.refresh('b'), limited.refresh('a')])
assert.equal(maxActive, 2)

console.log('Pack document verification passed')
