import assert from 'node:assert/strict'
import type { EditorDocument, ProjectMeta } from '../src/project/types.js'
import {
  createPackDocumentRefreshService,
  isDocumentCellStale,
} from '../src/renderer/packDocument.js'
import { newTrack, runtimeDocument, useStore } from '../src/renderer/state/store.js'
import { SaveCoordinator } from '../src/renderer/saveCoordinator.js'
import { classifyBatchFolder, planBatchCommit } from '../src/project/batch-import.js'
import type { BatchScanFile } from '../src/project/types.js'

const scanned = classifyBatchFolder(
  'C:\\batch',
  [
    { name: '01.clip', path: 'C:\\batch\\01.clip' },
    { name: '0007角色.PSD', path: 'C:\\batch\\0007角色.PSD' },
    { name: '角色01.clip', path: 'C:\\batch\\角色01.clip' },
    { name: '0.clip', path: 'C:\\batch\\0.clip' },
    { name: '99.clip', path: 'C:\\batch\\99.clip' },
    { name: '1.psd', path: 'C:\\batch\\1.psd' },
    { name: '說明.txt', path: 'C:\\batch\\說明.txt' },
  ],
  40,
)
assert.deepEqual(
  scanned.matched.map((file) => [file.index, file.fileName]),
  [[7, '0007角色.PSD']],
)
assert.deepEqual(
  scanned.skipped.map((file) => [file.fileName, file.reason]),
  [
    ['0.clip', '格號 0'],
    ['99.clip', '超出張數'],
    ['角色01.clip', '無數字'],
  ],
)
assert.deepEqual(
  scanned.duplicates.map((item) => item.index),
  [1],
)
assert.deepEqual(
  scanned.duplicates[0]!.files.map((file) => file.fileName),
  ['01.clip', '1.psd'],
)

const batchFile = (index: number, fileName: string): BatchScanFile => ({
  index,
  fileName,
  filePath: `C:\\batch\\${fileName}`,
})
const plannedBatch = planBatchCommit(
  [
    { file: batchFile(2, '2.clip'), value: 'good-2' },
    { file: batchFile(3, '3-bad.clip'), error: '模擬壞檔' },
    { file: batchFile(4, '4.clip'), value: 'good-4' },
  ],
  new Set([2]),
  'overwrite',
)
assert.deepEqual(
  plannedBatch.accepted.map((item) => item.file.index),
  [2, 4],
  '一個壞檔不得影響其他成功項',
)
assert.deepEqual(
  plannedBatch.failed.map((item) => item.file.index),
  [3],
)
assert.deepEqual(plannedBatch.overwritten, [2], '覆蓋清單必須只列出已有內容的成功項')
const keptBatch = planBatchCommit(
  [
    { file: batchFile(2, '2.clip'), value: 'good-2' },
    { file: batchFile(4, '4.clip'), value: 'good-4' },
  ],
  new Set([2]),
  'keep',
)
assert.deepEqual(
  keptBatch.accepted.map((item) => item.file.index),
  [4],
)
assert.deepEqual(
  keptBatch.keptConflicts.map((item) => item.index),
  [2],
)
assert.deepEqual(keptBatch.overwritten, [])

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
  gifMatte: null,
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

// PNG 覆蓋文件格後，舊 document 與它的 undo/redo 歷史都要一起消失。
useStore.getState().commit()
assert.equal(useStore.getState().past.length, 1)
useStore.getState().replacePackCell(1, {
  index: 1,
  sourcePath: 'replacement.png',
  pngBase64: 'replacement',
  mime: 'image/png',
  width: 320,
  height: 270,
  byteLength: 11,
  frameCount: 1,
})
const replaced = useStore.getState()
assert.equal(replaced.activeDocumentId, 'b')
assert.equal(replaced.documents.a, undefined, '被覆蓋的 documentId 不得留在 editorDocuments')
assert.equal(replaced.past.length, 0, '切離被覆蓋文件後不得保留它的 undo 歷史')
assert.equal(replaced.future.length, 0, '切離被覆蓋文件後不得保留它的 redo 歷史')
assert.equal(replaced.packCells.find((cell) => cell.index === 1)?.documentId, undefined)
const ownedDocumentIds = new Set([
  replaced.standaloneDocumentId,
  ...replaced.packCells.flatMap((cell) => (cell.documentId ? [cell.documentId] : [])),
])
assert(
  Object.keys(replaced.documents).every((documentId) => ownedDocumentIds.has(documentId)),
  '覆蓋後不得留下沒有格子或 standalone 歸屬的孤兒文件',
)

// SaveCoordinator：存檔途中繼續編輯，完成後只能推進到請求時的 revision。
const coordinatorState = {
  projectId: 'save-project' as string | null,
  contentRevision: 0,
  projectRevision: 1,
  savedRevision: 0,
}
const committedRevisions: number[] = []
const coordinator = new SaveCoordinator<string>({
  state: () => ({ ...coordinatorState }),
  commit(token) {
    coordinatorState.savedRevision = Math.max(coordinatorState.savedRevision, token.projectRevision)
    committedRevisions.push(coordinatorState.savedRevision)
  },
})
let releaseSave!: () => void
let saveStarted!: () => void
const didStartSave = new Promise<void>((resolve) => {
  saveStarted = resolve
})
const saving = coordinator.save(async () => {
  saveStarted()
  await new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  return 'revision-1'
})
await didStartSave
coordinatorState.contentRevision += 1
coordinatorState.projectRevision = 2
releaseSave()
assert.equal((await saving).status, 'completed')
assert.equal(coordinatorState.savedRevision, 1)
assert.equal(coordinatorState.contentRevision, 1)
assert.notEqual(
  coordinatorState.projectRevision,
  coordinatorState.savedRevision,
  '存檔期間再編輯後必須維持 dirty',
)

// 正式存檔排在舊 autosave 前面時，autosave 執行前重查 dirty 並直接略過。
coordinatorState.projectRevision = 3
let releaseThirdSave!: () => void
let thirdSaveStarted!: () => void
const didStartThirdSave = new Promise<void>((resolve) => {
  thirdSaveStarted = resolve
})
const thirdSave = coordinator.save(async () => {
  thirdSaveStarted()
  await new Promise<void>((resolve) => {
    releaseThirdSave = resolve
  })
  return 'revision-3'
})
await didStartThirdSave
let staleAutosaveRan = false
const staleAutosave = coordinator.autosave(async () => {
  staleAutosaveRan = true
})
releaseThirdSave()
await Promise.all([thirdSave, staleAutosave])
assert.equal(staleAutosaveRan, false, '較舊 autosave 不得在正式存檔後重建')
assert.equal(coordinatorState.savedRevision, 3)

// autosave 與正式 save 同時要求時仍只允許一個 operation 執行，revision 單調前進。
coordinatorState.projectRevision = 4
let activeSaves = 0
let peakSaves = 0
const order: string[] = []
let releaseAutosave!: () => void
let autosaveStarted!: () => void
const didStartAutosave = new Promise<void>((resolve) => {
  autosaveStarted = resolve
})
const autosaving = coordinator.autosave(async () => {
  activeSaves += 1
  peakSaves = Math.max(peakSaves, activeSaves)
  order.push('autosave:start')
  autosaveStarted()
  await new Promise<void>((resolve) => {
    releaseAutosave = resolve
  })
  order.push('autosave:end')
  activeSaves -= 1
})
await didStartAutosave
const fourthSave = coordinator.save(async () => {
  activeSaves += 1
  peakSaves = Math.max(peakSaves, activeSaves)
  order.push('save:start')
  activeSaves -= 1
  return 'revision-4'
})
releaseAutosave()
await Promise.all([autosaving, fourthSave])
assert.equal(peakSaves, 1)
assert.deepEqual(order, ['autosave:start', 'autosave:end', 'save:start'])
assert.deepEqual(committedRevisions, [1, 3, 4])
assert.equal(
  committedRevisions.every(
    (revision, index) => index === 0 || revision >= committedRevisions[index - 1]!,
  ),
  true,
  'savedRevision 不得回退',
)

// 批次匯入的多格文件必須只做一次 store 語意提交。
const replacedByBatch = runtimeDocument(editorDocument('replaced-by-batch', 12))
useStore.setState((state) => ({
  documents: { ...state.documents, oldBatch: replacedByBatch },
  packCells: [
    ...state.packCells,
    {
      index: 3,
      sourcePath: '',
      pngBase64: 'old-batch',
      width: 320,
      height: 270,
      byteLength: 9,
      frameCount: 1,
      documentId: 'oldBatch',
      renderedRevision: 0,
    },
  ],
}))
const beforeBatchRevision = useStore.getState().projectRevision
const documentC = runtimeDocument(editorDocument('document-c', 12))
const documentD = runtimeDocument(editorDocument('document-d', 12))
assert.equal(
  useStore.getState().commitPackBatch({
    expectedProjectId: 'project-a',
    assets: [],
    summaries: {},
    documents: { c: documentC, d: documentD },
    cells: [
      {
        index: 3,
        sourcePath: '',
        pngBase64: '',
        width: 320,
        height: 270,
        byteLength: 0,
        frameCount: 0,
        documentId: 'c',
        renderedRevision: -1,
      },
      {
        index: 4,
        sourcePath: '',
        pngBase64: '',
        width: 320,
        height: 270,
        byteLength: 0,
        frameCount: 0,
        documentId: 'd',
        renderedRevision: -1,
      },
    ],
  }),
  true,
)
assert.equal(useStore.getState().projectRevision, beforeBatchRevision + 1)
assert.equal(useStore.getState().documents.oldBatch, undefined)
assert.deepEqual(
  useStore
    .getState()
    .packCells.filter((cell) => cell.index === 3 || cell.index === 4)
    .map((cell) => cell.index)
    .sort(),
  [3, 4],
)
const afterBatch = useStore.getState()
const batchOwnedDocumentIds = new Set([
  afterBatch.standaloneDocumentId,
  ...afterBatch.packCells.flatMap((cell) => (cell.documentId ? [cell.documentId] : [])),
])
assert(
  Object.keys(afterBatch.documents).every((documentId) => batchOwnedDocumentIds.has(documentId)),
  '批次覆蓋後不得留下孤兒文件',
)

console.log('Pack document verification passed')
