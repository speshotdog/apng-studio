import type {
  DocumentPackCell,
  EditorDocument,
  EditorState,
  EncodedDocumentCache,
  ExternalImagePackCell,
  LegacyPack,
  LegacyPackCell,
  ProjectBlob,
  ProjectPackCell,
  SourceAsset,
  StoredTrack,
} from './types.js'
import { createEntityId } from './id.js'

type IdFactory = () => string

const DEFAULTS = {
  fps: 12,
  playCount: 1,
  format: 'apng' as const,
  lineTarget: 'sticker' as const,
  exportWidth: 270,
  exportHeight: 270,
  lockAspect: true,
  scaleMode: 'smooth' as const,
  mergeIdentical: true,
  staticFrame: 0,
  gifColors: 256,
  gifMatte: null,
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function normalizedPath(filePath: string): string {
  return filePath.replace(/\//g, '\\').toLocaleLowerCase('en-US')
}

function sourceName(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath
}

function sourceArray(value: unknown): SourceAsset[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const source = record(item)
    return source && typeof source.id === 'string' && typeof source.path === 'string'
      ? [{ id: source.id, path: source.path, name: String(source.name ?? sourceName(source.path)) }]
      : []
  })
}

function gifMatte(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : DEFAULTS.gifMatte
}

function cloneTrack(track: StoredTrack): StoredTrack {
  return { ...track, slots: track.slots.map((slot) => ({ ...slot })) }
}

function defaultTrack(createId: IdFactory, slots = 8): StoredTrack {
  return {
    id: createId(),
    name: '圖層 1',
    visible: true,
    opacity: 1,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    slots: Array.from({ length: slots }, () => ({ sourceId: null, layerId: null })),
  }
}

function editorState(value: unknown): EditorState {
  const state = record(value) ?? {}
  return {
    sources: sourceArray(state.sources),
    activeSourceId: typeof state.activeSourceId === 'string' ? state.activeSourceId : undefined,
    tracks: Array.isArray(state.tracks) ? (state.tracks as StoredTrack[]) : undefined,
    slots: Array.isArray(state.slots)
      ? (state.slots as Array<{ sourceId?: string | null; layerId: number | null }>)
      : undefined,
    zoom: typeof state.zoom === 'number' ? state.zoom : undefined,
    offsetX: typeof state.offsetX === 'number' ? state.offsetX : undefined,
    offsetY: typeof state.offsetY === 'number' ? state.offsetY : undefined,
    visibility: Array.isArray(state.visibility)
      ? (state.visibility as Array<[string | number, boolean]>)
      : [],
    fps: typeof state.fps === 'number' ? state.fps : DEFAULTS.fps,
    playCount: typeof state.playCount === 'number' ? state.playCount : DEFAULTS.playCount,
    format:
      state.format === 'gif' || state.format === 'png' || state.format === 'apng'
        ? state.format
        : DEFAULTS.format,
    lineTarget: (state.lineTarget as EditorState['lineTarget']) ?? DEFAULTS.lineTarget,
    exportWidth: typeof state.exportWidth === 'number' ? state.exportWidth : DEFAULTS.exportWidth,
    exportHeight:
      typeof state.exportHeight === 'number' ? state.exportHeight : DEFAULTS.exportHeight,
    lockAspect: typeof state.lockAspect === 'boolean' ? state.lockAspect : DEFAULTS.lockAspect,
    scaleMode: state.scaleMode === 'pixel' ? 'pixel' : DEFAULTS.scaleMode,
    mergeIdentical:
      typeof state.mergeIdentical === 'boolean' ? state.mergeIdentical : DEFAULTS.mergeIdentical,
    staticFrame: typeof state.staticFrame === 'number' ? state.staticFrame : DEFAULTS.staticFrame,
    gifColors: typeof state.gifColors === 'number' ? state.gifColors : DEFAULTS.gifColors,
    gifMatte: gifMatte(state.gifMatte),
  }
}

class SourcePool {
  readonly sources: SourceAsset[] = []
  private readonly byPath = new Map<string, SourceAsset>()
  private readonly byId = new Map<string, SourceAsset>()

  add(source: SourceAsset): SourceAsset {
    const key = normalizedPath(source.path)
    const found = this.byPath.get(key)
    if (found) {
      this.byId.set(source.id, found)
      return found
    }
    this.sources.push({ ...source })
    const stored = this.sources.at(-1)!
    this.byPath.set(key, stored)
    this.byId.set(source.id, stored)
    return stored
  }

  resolve(id: string | null | undefined): SourceAsset | undefined {
    return id ? this.byId.get(id) : undefined
  }
}

function mergeStateSources(
  stored: EditorState,
  pool: SourcePool,
  createId: IdFactory,
  legacy?: { sourceId?: string; clipPath?: string; clipName?: string },
): Map<string, string> {
  const ids = new Map<string, string>()
  for (const source of stored.sources ?? []) {
    const merged = pool.add(source)
    ids.set(source.id, merged.id)
  }
  if (legacy?.sourceId) {
    const existing = pool.resolve(legacy.sourceId)
    if (existing) ids.set(legacy.sourceId, existing.id)
    else if (legacy.clipPath) {
      const merged = pool.add({
        id: legacy.sourceId || createId(),
        path: legacy.clipPath,
        name: legacy.clipName || sourceName(legacy.clipPath),
      })
      ids.set(legacy.sourceId, merged.id)
    }
  }
  return ids
}

function remapVisibility(
  entries: Array<[string | number, boolean]>,
  ids: Map<string, string>,
  fallbackSourceId?: string,
): Array<[string, boolean]> {
  return entries.map(([key, visible]) => {
    if (typeof key === 'number') return [`${fallbackSourceId ?? ''}:${key}`, visible]
    const separator = key.indexOf(':')
    if (separator < 0) return [key, visible]
    const sourceId = key.slice(0, separator)
    return [`${ids.get(sourceId) ?? sourceId}${key.slice(separator)}`, visible]
  })
}

function toEditorDocument(
  stored: EditorState,
  pool: SourcePool,
  ids: Map<string, string>,
  createId: IdFactory,
): EditorDocument {
  const fallbackSourceId =
    ids.get(stored.activeSourceId ?? '') ??
    pool.resolve(stored.activeSourceId)?.id ??
    (stored.sources?.[0] ? ids.get(stored.sources[0].id) : undefined) ??
    pool.sources[0]?.id
  const remapSlot = (slot: {
    sourceId?: string | null
    layerId: number | null
  }): { sourceId: string | null; layerId: number | null } => ({
    sourceId:
      slot.layerId === null
        ? null
        : (ids.get(slot.sourceId ?? '') ??
          pool.resolve(slot.sourceId)?.id ??
          fallbackSourceId ??
          null),
    layerId: slot.layerId,
  })
  const tracks = stored.tracks?.length
    ? stored.tracks.map((track) => ({ ...cloneTrack(track), slots: track.slots.map(remapSlot) }))
    : (() => {
        const track = defaultTrack(createId, stored.slots?.length ?? 8)
        return [
          {
            ...track,
            slots: stored.slots?.map(remapSlot) ?? track.slots,
            zoom: stored.zoom ?? 1,
            offsetX: stored.offsetX ?? 0,
            offsetY: stored.offsetY ?? 0,
          },
        ]
      })()
  return {
    tracks,
    visibility: remapVisibility(stored.visibility, ids, fallbackSourceId),
    fps: stored.fps,
    playCount: stored.playCount,
    format: stored.format,
    lineTarget: stored.lineTarget,
    exportWidth: stored.exportWidth,
    exportHeight: stored.exportHeight,
    lockAspect: stored.lockAspect,
    scaleMode: stored.scaleMode,
    mergeIdentical: stored.mergeIdentical,
    staticFrame: stored.staticFrame ?? DEFAULTS.staticFrame,
    gifColors: stored.gifColors ?? DEFAULTS.gifColors,
    gifMatte: stored.gifMatte ?? DEFAULTS.gifMatte,
    activeSourceId: fallbackSourceId,
    contentRevision: 0,
  }
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)
}

function encodedCache(
  cell: LegacyPackCell,
  renderedRevision: number,
): EncodedDocumentCache | undefined {
  if (!cell.pngBase64) return undefined
  const bytes = decodeBase64(cell.pngBase64)
  let width = cell.width ?? 0
  let height = cell.height ?? 0
  let frameCount = cell.frameCount ?? 1
  if (bytes.length >= 24) {
    width ||= readU32(bytes, 16)
    height ||= readU32(bytes, 20)
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = readU32(bytes, offset)
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
      if (type === 'acTL' && offset + 12 <= bytes.length) frameCount = readU32(bytes, offset + 8)
      offset += 12 + length
    }
  }
  return {
    base64: cell.pngBase64,
    mime: 'image/png',
    width,
    height,
    byteLength: cell.byteLength ?? bytes.length,
    frameCount,
    renderedRevision,
  }
}

function legacyPack(value: unknown): LegacyPack | undefined {
  const pack = record(value)
  if (!pack || !Array.isArray(pack.cells)) return undefined
  return {
    target: (pack.target as LegacyPack['target']) ?? 'staticSticker',
    count: typeof pack.count === 'number' ? pack.count : 32,
    cells: pack.cells as LegacyPackCell[],
  }
}

function normalizeLegacy(input: Record<string, unknown>, createId: IdFactory): ProjectBlob {
  const wrappedState = record(input.state)
  const looksLikeBlob = wrappedState !== null && ('fps' in wrappedState || 'tracks' in wrappedState)
  const topState = editorState(looksLikeBlob ? wrappedState : input)
  const pack = legacyPack(looksLikeBlob ? input.pack : undefined)
  const pool = new SourcePool()
  for (const source of topState.sources ?? []) pool.add(source)
  const standaloneMap = mergeStateSources(topState, pool, createId)
  const standaloneDocumentId = createId()
  const editorDocuments: Record<string, EditorDocument> = {
    [standaloneDocumentId]: toEditorDocument(topState, pool, standaloneMap, createId),
  }
  const cells: ProjectPackCell[] = []
  for (const cell of pack?.cells ?? []) {
    if (!cell.editor) {
      const external: ExternalImagePackCell = {
        kind: 'external',
        index: cell.index,
        sourcePath: cell.sourcePath,
        pngBase64: cell.pngBase64,
        width: cell.width,
        height: cell.height,
        byteLength: cell.byteLength,
        frameCount: cell.frameCount,
      }
      cells.push(external)
      continue
    }
    const stored = editorState(cell.editor.state)
    const ids = mergeStateSources(stored, pool, createId, cell.editor)
    const documentId = createId()
    const document = toEditorDocument(stored, pool, ids, createId)
    editorDocuments[documentId] = document
    const documentCell: DocumentPackCell = {
      kind: 'document',
      index: cell.index,
      documentId,
      encoded: encodedCache(cell, document.contentRevision),
    }
    cells.push(documentCell)
  }
  return {
    version: 2,
    sources: pool.sources,
    editorDocuments,
    standaloneDocumentId,
    pack: pack ? { target: pack.target, count: pack.count, cells } : undefined,
  }
}

/** 將 v0.1、v0.2、v1 或 v2 的資料正規化成唯一的 v2 寫入格式。 */
export function normalizeProjectBlob(
  input: unknown,
  createId: IdFactory = createEntityId,
  fallbackSource?: { path: string; name: string },
): ProjectBlob {
  const object = record(input)
  if (!object) throw new Error('專案內容格式不正確')
  if (object.version !== 2 || !record(object.editorDocuments)) {
    const migrated = normalizeLegacy(object, createId)
    if (!migrated.sources.length && fallbackSource?.path) {
      const source: SourceAsset = {
        id: createId(),
        path: fallbackSource.path,
        name: fallbackSource.name || sourceName(fallbackSource.path),
      }
      migrated.sources.push(source)
      migrated.editorDocuments = Object.fromEntries(
        Object.entries(migrated.editorDocuments).map(([id, document]) => [
          id,
          {
            ...document,
            activeSourceId: document.activeSourceId ?? source.id,
            visibility: document.visibility.map(([key, visible]) => [
              key.startsWith(':') ? `${source.id}${key}` : key,
              visible,
            ]),
            tracks: document.tracks.map((track) => ({
              ...track,
              slots: track.slots.map((slot) => ({
                ...slot,
                sourceId: slot.layerId === null ? null : (slot.sourceId ?? source.id),
              })),
            })),
          },
        ]),
      )
    }
    return migrated
  }

  const pool = new SourcePool()
  const ids = new Map<string, string>()
  for (const source of sourceArray(object.sources)) {
    const canonical = pool.add(source)
    ids.set(source.id, canonical.id)
  }
  const documents = Object.fromEntries(
    Object.entries(object.editorDocuments as Record<string, EditorDocument>).map(
      ([id, document]) => [
        id,
        {
          ...document,
          tracks: document.tracks.map((track) => ({
            ...cloneTrack(track),
            slots: track.slots.map((slot) => ({
              ...slot,
              sourceId:
                slot.layerId === null
                  ? null
                  : (ids.get(slot.sourceId ?? '') ?? slot.sourceId ?? null),
            })),
          })),
          visibility: remapVisibility(document.visibility, ids),
          activeSourceId: ids.get(document.activeSourceId ?? '') ?? document.activeSourceId,
          contentRevision: document.contentRevision ?? 0,
          gifMatte: gifMatte(document.gifMatte),
        },
      ],
    ),
  )
  const packObject = record(object.pack)
  return {
    version: 2,
    sources: pool.sources,
    editorDocuments: documents,
    standaloneDocumentId: String(object.standaloneDocumentId),
    pack:
      packObject && Array.isArray(packObject.cells)
        ? {
            target: packObject.target as LegacyPack['target'],
            count: Number(packObject.count),
            cells: packObject.cells as ProjectPackCell[],
          }
        : undefined,
  }
}
