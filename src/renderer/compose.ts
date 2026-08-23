import { useStore, type ScaleMode, type Track } from './state/store.js'
export function bitmapToImageData(rgba: Uint8Array, width: number, height: number): ImageData {
  return new ImageData(new Uint8ClampedArray(rgba), width, height)
}
export function visibilitySignature(visibility: Map<number, boolean>): string {
  return [...visibility]
    .sort(([a], [b]) => a - b)
    .map(([id, shown]) => `${id}:${shown ? 1 : 0}`)
    .join(',')
}
export function bitmapKey(id: number, visibility: Map<number, boolean>): string {
  return `${id}|${visibilitySignature(visibility)}`
}
export async function ensureBitmap(id: number): Promise<ImageBitmap> {
  const state = useStore.getState()
  const key = bitmapKey(id, state.visibility)
  const cached = state.bitmaps.get(key)
  if (cached) return cached
  const value = await window.api.renderLayer(id, [...state.visibility])
  const bitmap = await createImageBitmap(bitmapToImageData(value.rgba, value.width, value.height))
  useStore.getState().setBitmap(key, bitmap)
  return bitmap
}

/** 某一格會用到的所有圖層 id（跨全部軌道），拿來預先解碼 bitmap。 */
export function frameLayerIds(index: number): number[] {
  const state = useStore.getState()
  return state.tracks.flatMap((_, trackIndex) => {
    const id = state.resolveSlot(index, trackIndex)
    return id === null ? [] : [id]
  })
}

/** 整份專案會用到的所有圖層 id。 */
export function allLayerIds(): number[] {
  const state = useStore.getState()
  const ids = new Set<number>()
  state.tracks.forEach((track, trackIndex) =>
    track.slots.forEach((_, index) => {
      const id = state.resolveSlot(index, trackIndex)
      if (id !== null) ids.add(id)
    }),
  )
  return [...ids]
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

/**
 * 把某一格的所有軌道疊出來。tracks[0] 在最上面，所以從陣列尾端往前畫。
 * 呼叫前必須先 ensureBitmap 過會用到的圖層，這裡只讀快取。
 */
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
  for (let trackIndex = state.tracks.length - 1; trackIndex >= 0; trackIndex--) {
    const track = state.tracks[trackIndex]!
    if (!track.visible) continue
    const id = state.resolveSlot(index, trackIndex)
    const bitmap = id === null ? undefined : state.bitmaps.get(bitmapKey(id, state.visibility))
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
  if (!ctx) throw new Error('無法建立影格畫布')
  drawFrame(ctx, slotIndex, width, height, mode)
  return new Uint8Array(ctx.getImageData(0, 0, width, height).data)
}
