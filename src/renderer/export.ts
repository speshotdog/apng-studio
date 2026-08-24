import type { ExportPayload, ExportResult } from '../preload/api.js'
import {
  allDocumentLayerIds,
  bitmapToImageData,
  composeDocumentFrame,
  ensureDocumentBitmap,
  type BitmapLoader,
  type DocumentComposeSnapshot,
} from './compose.js'
import { useStore } from './state/store.js'
import { EXPORT_TARGETS } from '../codec/line.js'
import { frameDelays } from '../codec/timing.js'
import { captureEditorDocument } from './snapshot.js'

export type ExportDocumentSnapshot = DocumentComposeSnapshot

export function captureExportSnapshot(
  documentId = useStore.getState().activeDocumentId,
): ExportDocumentSnapshot {
  const state = useStore.getState()
  const document = captureEditorDocument(documentId)
  if (!document) throw new Error('找不到要匯出的編輯文件')
  return {
    document,
    sources: state.sources.map((source) => ({ ...source })),
    bitmaps: new Map(state.bitmaps),
  }
}

const browserBitmapLoader: BitmapLoader = {
  renderLayer: (filePath, layerId, overrides) =>
    window.api.renderLayer(filePath, layerId, overrides),
  createBitmap: (value) =>
    createImageBitmap(bitmapToImageData(value.rgba, value.width, value.height)),
}

export async function createExportPayloadFromSnapshot(
  snapshot: ExportDocumentSnapshot,
  size?: { width: number; height: number },
  loader: BitmapLoader = browserBitmapLoader,
): Promise<ExportPayload> {
  const { document } = snapshot
  await Promise.all(
    allDocumentLayerIds(document).map((slot) =>
      ensureDocumentBitmap(snapshot, slot.sourceId, slot.layerId, loader),
    ),
  )
  const spec = EXPORT_TARGETS[document.lineTarget]
  const frameCount = Math.max(1, ...document.tracks.map((track) => track.slots.length))
  const indexes = spec.staticOnly
    ? [Math.min(document.staticFrame, frameCount - 1)]
    : Array.from({ length: frameCount }, (_, index) => index)
  const delays = frameDelays(indexes.length, document.fps)
  const width = size?.width ?? document.exportWidth
  const height = size?.height ?? document.exportHeight
  let frames = indexes.map((index, position) => ({
    rgba: composeDocumentFrame(snapshot, index, width, height, document.scaleMode),
    delayMs: delays[position]!,
  }))
  if (document.format === 'gif' && document.mergeIdentical) {
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
    format: document.format,
    width,
    height,
    frames,
    numPlays: document.playCount,
    mergeIdentical: document.mergeIdentical,
    gif: { maxColors: document.gifColors },
  }
}

export async function createExportPayload(size?: {
  width: number
  height: number
}): Promise<ExportPayload> {
  return createExportPayloadFromSnapshot(captureExportSnapshot(), size)
}

export async function exportTo(filePath?: string): Promise<ExportResult> {
  const snapshot = captureExportSnapshot()
  const spec = EXPORT_TARGETS[snapshot.document.lineTarget]
  if (spec.multiSize) {
    const payloads = await Promise.all(
      spec.multiSize.map(async (size) => ({
        suffix: size.suffix,
        payload: await createExportPayloadFromSnapshot(snapshot, size),
      })),
    )
    return filePath
      ? window.api.exportMultiTo(filePath, payloads)
      : window.api.saveMultiExport(payloads)
  }
  const payload = await createExportPayloadFromSnapshot(snapshot)
  return filePath ? window.api.exportTo(filePath, payload) : window.api.saveExport(payload)
}
