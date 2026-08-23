import type { ExportPayload, ExportResult } from '../preload/api.js'
import { allLayerIds, composeFrame, ensureBitmap } from './compose.js'
import { useStore } from './state/store.js'
import { EXPORT_TARGETS } from '../codec/line.js'
import { frameDelays } from '../codec/timing.js'

export async function createExportPayload(size?: {
  width: number
  height: number
}): Promise<ExportPayload> {
  const state = useStore.getState()
  if (!state.doc) throw new Error('請先開啟 .clip 檔案')
  await Promise.all(allLayerIds().map((slot) => ensureBitmap(slot.sourceId, slot.layerId)))
  const current = useStore.getState()
  const spec = EXPORT_TARGETS[current.lineTarget]
  const frameCount = current.frameCount()
  const indexes = spec.staticOnly
    ? [Math.min(current.staticFrame, frameCount - 1)]
    : Array.from({ length: frameCount }, (_, index) => index)
  const delays = frameDelays(indexes.length, current.fps)
  const width = size?.width ?? current.exportWidth
  const height = size?.height ?? current.exportHeight
  let frames = indexes.map((index, position) => ({
    rgba: composeFrame(index, width, height, current.scaleMode),
    delayMs: delays[position]!,
  }))
  if (current.format === 'gif' && current.mergeIdentical) {
    frames = frames.reduce<typeof frames>((merged, frame) => {
      const previous = merged[merged.length - 1]
      const identical =
        previous?.rgba.length === frame.rgba.length &&
        previous.rgba.every((value, index) => value === frame.rgba[index])
      if (previous && identical) previous.delayMs += frame.delayMs
      else merged.push(frame)
      return merged
    }, [])
  }
  return {
    format: current.format,
    width,
    height,
    frames,
    numPlays: current.playCount,
    mergeIdentical: current.mergeIdentical,
    gif: { maxColors: current.gifColors },
  }
}

export async function exportTo(filePath?: string): Promise<ExportResult> {
  const spec = EXPORT_TARGETS[useStore.getState().lineTarget]
  if (spec.multiSize) {
    const payloads = await Promise.all(
      spec.multiSize.map(async (size) => ({
        suffix: size.suffix,
        payload: await createExportPayload(size),
      })),
    )
    return filePath
      ? window.api.exportMultiTo(filePath, payloads)
      : window.api.saveMultiExport(payloads)
  }
  const payload = await createExportPayload()
  return filePath ? window.api.exportTo(filePath, payload) : window.api.saveExport(payload)
}
