import type { ExportPayload, ExportResult } from '../preload/api.js'
import { composeFrame, ensureBitmap } from './compose.js'
import { useStore } from './state/store.js'

export async function createExportPayload(): Promise<ExportPayload> {
  const state = useStore.getState()
  if (!state.doc) throw new Error('請先開啟 .clip 檔案')
  const ids = [
    ...new Set(
      state.slots
        .map((_, index) => state.resolveSlot(index))
        .filter((id): id is number => id !== null),
    ),
  ]
  await Promise.all(ids.map(ensureBitmap))
  const current = useStore.getState()
  let frames = current.slots.map((_, index) => ({
    rgba: composeFrame(
      index,
      current.exportWidth,
      current.exportHeight,
      current.scaleMode,
      current,
    ),
    delayMs:
      Math.round(((index + 1) * 1000) / current.fps) - Math.round((index * 1000) / current.fps),
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
    width: current.exportWidth,
    height: current.exportHeight,
    frames,
    numPlays: current.playCount,
    mergeIdentical: current.mergeIdentical,
    gif: { maxColors: current.gifColors },
  }
}

export async function exportTo(filePath?: string): Promise<ExportResult> {
  const payload = await createExportPayload()
  return filePath ? window.api.exportTo(filePath, payload) : window.api.saveExport(payload)
}
