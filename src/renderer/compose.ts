import { useStore, type ResolvedSlot, type ScaleMode, type Track } from './state/store.js'

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
  if (!source) throw new Error(`Source not found: ${sourceId}`)
  const value = await window.api.renderLayer(
    source.path,
    layerId,
    sourceOverrides(sourceId, state.visibility),
  )
  const bitmap = await createImageBitmap(bitmapToImageData(value.rgba, value.width, value.height))
  useStore.getState().setBitmap(key, bitmap)
  return bitmap
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
  track: Track,
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
