import type { EditorDocument, SourceAsset } from '../project/types.js'
import type { RenderedLayer } from '../preload/api.js'
import { useStore, type ResolvedSlot, type ScaleMode, type Track } from './state/store.js'

export interface DocumentComposeSnapshot {
  document: EditorDocument
  sources: SourceAsset[]
  bitmaps: Map<string, ImageBitmap>
}

export interface BitmapLoader {
  renderLayer(
    filePath: string,
    layerId: number,
    overrides: Array<[number, boolean]>,
  ): Promise<RenderedLayer>
  createBitmap(value: RenderedLayer): Promise<ImageBitmap>
}

export function bitmapToImageData(rgba: Uint8Array, width: number, height: number): ImageData {
  return new ImageData(new Uint8ClampedArray(rgba), width, height)
}

export function visibilitySignature(sourceId: string, visibility: Map<string, boolean>): string {
  return [...visibility]
    .filter(([key]) => key.startsWith(`${sourceId}:`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, shown]) => `${id}:${shown ? 1 : 0}`)
    .join(',')
}

export function bitmapKey(
  sourceId: string,
  layerId: number,
  visibility: Map<string, boolean>,
): string {
  return `${sourceId}:${layerId}|${visibilitySignature(sourceId, visibility)}`
}

function sourceOverrides(
  sourceId: string,
  visibility: Map<string, boolean>,
): Array<[number, boolean]> {
  return [...visibility].flatMap(([key, visible]) => {
    if (!key.startsWith(`${sourceId}:`)) return []
    const id = Number(key.slice(sourceId.length + 1))
    return Number.isFinite(id) ? ([[id, visible]] as Array<[number, boolean]>) : []
  })
}

export async function ensureBitmap(sourceId: string, layerId: number): Promise<ImageBitmap> {
  const state = useStore.getState()
  const key = bitmapKey(sourceId, layerId, state.visibility)
  const cached = state.bitmaps.get(key)
  if (cached) return cached
  const source = state.sourceOf(sourceId)
  if (!source) throw new Error(`找不到來源素材：${sourceId}`)
  const value = await window.api.renderLayer(
    source.path,
    layerId,
    sourceOverrides(sourceId, state.visibility),
  )
  const bitmap = await createImageBitmap(bitmapToImageData(value.rgba, value.width, value.height))
  // 解碼是非同步的，這段時間內使用者可能已經把這個素材移除或重新連結到別的檔案。
  // 沒有這道檢查的話，慢一步回來的舊圖會被寫回快取，預覽就會顯示上一個檔案的內容。
  const after = useStore.getState()
  const stillSame = after.sourceOf(sourceId)?.path === source.path
  if (!stillSame || bitmapKey(sourceId, layerId, after.visibility) !== key) return bitmap
  after.setBitmap(key, bitmap)
  return bitmap
}

export async function ensureDocumentBitmap(
  snapshot: DocumentComposeSnapshot,
  sourceId: string,
  layerId: number,
  loader: BitmapLoader,
): Promise<ImageBitmap> {
  const visibility = new Map(snapshot.document.visibility)
  const key = bitmapKey(sourceId, layerId, visibility)
  const cached = snapshot.bitmaps.get(key)
  if (cached) return cached
  const source = snapshot.sources.find((item) => item.id === sourceId)
  if (!source) throw new Error(`找不到來源素材：${sourceId}`)
  const value = await loader.renderLayer(
    source.path,
    layerId,
    sourceOverrides(sourceId, visibility),
  )
  const bitmap = await loader.createBitmap(value)
  snapshot.bitmaps.set(key, bitmap)
  return bitmap
}

export function resolveDocumentSlot(
  document: EditorDocument,
  index: number,
  trackIndex: number,
): ResolvedSlot | null {
  const slots = document.tracks[trackIndex]?.slots ?? []
  for (let slotIndex = Math.min(index, slots.length - 1); slotIndex >= 0; slotIndex -= 1) {
    const slot = slots[slotIndex]
    const sourceId = slot?.sourceId ?? document.activeSourceId
    if (slot && sourceId && slot.layerId !== null) return { sourceId, layerId: slot.layerId }
  }
  return null
}

export function allDocumentLayerIds(document: EditorDocument): ResolvedSlot[] {
  const ids = new Map<string, ResolvedSlot>()
  document.tracks.forEach((track, trackIndex) =>
    track.slots.forEach((_, index) => {
      const slot = resolveDocumentSlot(document, index, trackIndex)
      if (slot) ids.set(`${slot.sourceId}:${slot.layerId}`, slot)
    }),
  )
  return [...ids.values()]
}

export function frameLayerIds(index: number): ResolvedSlot[] {
  const state = useStore.getState()
  return state.tracks.flatMap((_, trackIndex) => {
    const slot = state.resolveSlot(index, trackIndex)
    return slot ? [slot] : []
  })
}

export function allLayerIds(): ResolvedSlot[] {
  const state = useStore.getState()
  const ids = new Map<string, ResolvedSlot>()
  state.tracks.forEach((track, trackIndex) =>
    track.slots.forEach((_, index) => {
      const slot = state.resolveSlot(index, trackIndex)
      if (slot) ids.set(`${slot.sourceId}:${slot.layerId}`, slot)
    }),
  )
  return [...ids.values()]
}

function drawTrack(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  track: Pick<Track, 'opacity' | 'zoom' | 'offsetX' | 'offsetY'>,
  bitmap: ImageBitmap,
  width: number,
  height: number,
): void {
  const scale = Math.min(width / bitmap.width, height / bitmap.height) * track.zoom
  const w = bitmap.width * scale
  const h = bitmap.height * scale
  ctx.globalAlpha = track.opacity
  ctx.drawImage(bitmap, (width - w) / 2 + track.offsetX, (height - h) / 2 + track.offsetY, w, h)
  ctx.globalAlpha = 1
}

export function drawFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  index: number,
  width: number,
  height: number,
  mode: ScaleMode,
): void {
  const state = useStore.getState()
  ctx.clearRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = mode === 'smooth'
  if (mode === 'smooth') ctx.imageSmoothingQuality = 'high'
  for (let trackIndex = state.tracks.length - 1; trackIndex >= 0; trackIndex -= 1) {
    const track = state.tracks[trackIndex]!
    if (!track.visible) continue
    const slot = state.resolveSlot(index, trackIndex)
    const bitmap = slot
      ? state.bitmaps.get(bitmapKey(slot.sourceId, slot.layerId, state.visibility))
      : undefined
    if (bitmap) drawTrack(ctx, track, bitmap, width, height)
  }
}

export function drawDocumentFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  snapshot: DocumentComposeSnapshot,
  index: number,
  width: number,
  height: number,
  mode: ScaleMode,
): void {
  const { document, bitmaps } = snapshot
  const visibility = new Map(document.visibility)
  ctx.clearRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = mode === 'smooth'
  if (mode === 'smooth') ctx.imageSmoothingQuality = 'high'
  for (let trackIndex = document.tracks.length - 1; trackIndex >= 0; trackIndex -= 1) {
    const track = document.tracks[trackIndex]!
    if (!track.visible) continue
    const slot = resolveDocumentSlot(document, index, trackIndex)
    const bitmap = slot
      ? bitmaps.get(bitmapKey(slot.sourceId, slot.layerId, visibility))
      : undefined
    if (bitmap) drawTrack(ctx, track, bitmap, width, height)
  }
}

export function composeDocumentFrame(
  snapshot: DocumentComposeSnapshot,
  slotIndex: number,
  width: number,
  height: number,
  mode: ScaleMode,
): Uint8Array {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Cannot create canvas context')
  drawDocumentFrame(ctx, snapshot, slotIndex, width, height, mode)
  return new Uint8Array(ctx.getImageData(0, 0, width, height).data)
}

export function composeFrame(
  slotIndex: number,
  width: number,
  height: number,
  mode: ScaleMode,
): Uint8Array {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Cannot create canvas context')
  drawFrame(ctx, slotIndex, width, height, mode)
  return new Uint8Array(ctx.getImageData(0, 0, width, height).data)
}
