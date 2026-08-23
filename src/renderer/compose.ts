import { useStore, type ScaleMode } from './state/store.js'
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
export function composeFrame(
  slotIndex: number,
  width: number,
  height: number,
  mode: ScaleMode,
): Uint8Array {
  const state = useStore.getState()
  const id = state.resolveSlot(slotIndex)
  const bitmap = id === null ? undefined : state.bitmaps.get(bitmapKey(id, state.visibility))
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('無法建立影格畫布')
  ctx.clearRect(0, 0, width, height)
  if (bitmap) {
    ctx.imageSmoothingEnabled = mode === 'smooth'
    if (mode === 'smooth') ctx.imageSmoothingQuality = 'high'
    const scale = Math.min(width / bitmap.width, height / bitmap.height)
    const w = bitmap.width * scale,
      h = bitmap.height * scale
    ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h)
  }
  return new Uint8Array(ctx.getImageData(0, 0, width, height).data)
}
