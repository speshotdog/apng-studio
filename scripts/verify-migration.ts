import assert from 'node:assert/strict'
import { normalizeProjectBlob } from '../src/project/migration.js'
import type { EditorState, ProjectBlob, StoredTrack } from '../src/project/types.js'

let nextId = 0
const createId = (): string => `generated-${++nextId}`

const track = (id: string, sourceId: string, layerId: number): StoredTrack => ({
  id,
  name: id,
  visible: true,
  opacity: 1,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  slots: [{ sourceId, layerId }],
})

const state = (
  sources: EditorState['sources'],
  activeSourceId: string,
  tracks: StoredTrack[],
  fps: number,
): EditorState => ({
  sources,
  activeSourceId,
  tracks,
  visibility: [[`${activeSourceId}:1`, true]],
  fps,
  playCount: 2,
  format: 'apng',
  lineTarget: 'sticker',
  exportWidth: 320,
  exportHeight: 270,
  lockAspect: true,
  scaleMode: 'smooth',
  mergeIdentical: true,
  staticFrame: 0,
  gifColors: 128,
})

const topA = { id: 'top-a', path: 'D:\\art\\A.clip', name: 'A.clip' }
const topB = { id: 'top-b', path: 'D:\\art\\B.clip', name: 'B.clip' }
const editorC = { id: 'editor-c', path: 'D:\\art\\C.clip', name: 'C.clip' }
const duplicateA = { id: 'duplicate-a', path: 'd:/art/A.clip', name: 'renamed-a.clip' }
const editorPng = Buffer.from([1, 2, 3, 4, 5]).toString('base64')
const externalPng = Buffer.from([9, 8, 7, 6, 5, 4]).toString('base64')

const v1 = {
  state: state([topA, topB], topA.id, [track('standalone', topA.id, 1)], 12),
  pack: {
    target: 'sticker',
    count: 8,
    cells: [
      {
        index: 1,
        pngBase64: editorPng,
        width: 320,
        height: 270,
        byteLength: 5,
        frameCount: 6,
        editor: {
          sourceId: editorC.id,
          state: state([editorC], editorC.id, [track('editor-c-track', editorC.id, 3)], 20),
        },
      },
      { index: 2, sourcePath: '', pngBase64: externalPng },
      {
        index: 3,
        pngBase64: editorPng,
        width: 320,
        height: 270,
        byteLength: 5,
        frameCount: 5,
        editor: {
          sourceId: duplicateA.id,
          state: state(
            [duplicateA],
            duplicateA.id,
            [track('duplicate-track', duplicateA.id, 8)],
            8,
          ),
        },
      },
    ],
  },
}

const migrated = normalizeProjectBlob(v1, createId)
assert.equal(migrated.version, 2)
assert.equal(migrated.sources.length, 3, '相同路徑的素材應合併')
assert.deepEqual(
  migrated.sources.map((source) => source.path),
  [topA.path, topB.path, editorC.path],
)
assert(migrated.editorDocuments[migrated.standaloneDocumentId], 'standalone document 必須存在')

const documentCells = migrated.pack!.cells.filter((cell) => cell.kind === 'document')
assert.equal(documentCells.length, 2)
const firstDocument = documentCells[0]!
const duplicateDocument = documentCells[1]!
assert.equal(
  migrated.editorDocuments[firstDocument.documentId]!.tracks[0]!.slots[0]!.sourceId,
  editorC.id,
)
assert.equal(
  migrated.editorDocuments[duplicateDocument.documentId]!.tracks[0]!.slots[0]!.sourceId,
  topA.id,
  'editor 內的重複素材 id 應正規化成專案層 id',
)

const external = migrated.pack!.cells.find((cell) => cell.index === 2)
assert(external?.kind === 'external')
assert.equal(external.pngBase64, externalPng)
assert.deepEqual(Buffer.from(external.pngBase64!, 'base64'), Buffer.from(externalPng, 'base64'))

// 模擬 project.json 的 save → load；v2 再讀不得重建 documentId 或改內容。
const saved = JSON.stringify(migrated)
const loaded = normalizeProjectBlob(JSON.parse(saved) as unknown, createId)
assert.deepEqual(loaded, JSON.parse(saved) as ProjectBlob)
assert.equal(loaded.standaloneDocumentId, migrated.standaloneDocumentId)
assert.deepEqual(
  Object.keys(loaded.editorDocuments),
  Object.keys(migrated.editorDocuments),
  'v2 round-trip 的 documentId 必須穩定',
)

// v0.1 可能只有頂層 slots，素材路徑仍放在 ProjectMeta；也必須能升級。
const v01 = normalizeProjectBlob(
  {
    slots: [{ layerId: 9 }],
    visibility: [[9, true]],
    fps: 10,
    playCount: 1,
    format: 'apng',
    lineTarget: 'sticker',
    exportWidth: 270,
    exportHeight: 270,
    lockAspect: true,
    scaleMode: 'smooth',
    mergeIdentical: true,
  },
  createId,
  { path: 'D:\\art\\legacy.clip', name: 'legacy.clip' },
)
const v01Document = v01.editorDocuments[v01.standaloneDocumentId]!
assert.equal(v01.sources.length, 1)
assert.equal(v01Document.tracks[0]!.slots[0]!.sourceId, v01.sources[0]!.id)
assert.equal(v01Document.visibility[0]![0], `${v01.sources[0]!.id}:9`)

console.log('Migration verification passed')
