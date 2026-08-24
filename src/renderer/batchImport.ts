import { EXPORT_TARGETS } from '../codec/line.js'
import { createEntityId } from '../project/id.js'
import type { BatchScanFile, PackImportCell, SourceAsset } from '../project/types.js'
import type { ClipSummary } from '../preload/api.js'
import {
  buildCspTracks,
  newTrack,
  runtimeDocument,
  sourceVisibilityEntries,
  type PackBatchCommitInput,
  type State,
} from './state/store.js'

export interface AcceptedBatchSource {
  file: BatchScanFile
  summary: ClipSummary
}

export interface BatchDocumentBuild {
  input: PackBatchCommitInput
  documentIds: string[]
  omittedAnimationFiles: string[]
  noCspTimelineFiles: string[]
  extraTimelineFiles: Array<{ fileName: string; ignoredCount: number }>
  timelineWarnings: Array<{ fileName: string; warnings: string[] }>
}

function pathKey(filePath: string): string {
  return filePath.replaceAll('/', '\\').toLocaleLowerCase('en-US')
}

function extension(fileName: string): string {
  const match = /\.[^.]+$/.exec(fileName)
  return match?.[0].toLowerCase() ?? ''
}

/** 把全部解析成功的來源建成一個可由 store 單次提交的 patch。 */
export function buildBatchDocuments(
  state: State,
  projectId: string,
  accepted: AcceptedBatchSource[],
): BatchDocumentBuild {
  const assets = [...state.sources]
  const addedAssets: SourceAsset[] = []
  const summaries: Record<string, ClipSummary> = {}
  const documents: PackBatchCommitInput['documents'] = {}
  const cells: PackImportCell[] = []
  const documentIds: string[] = []
  const omittedAnimationFiles: string[] = []
  const noCspTimelineFiles: string[] = []
  const extraTimelineFiles: Array<{ fileName: string; ignoredCount: number }> = []
  const timelineWarnings: Array<{ fileName: string; warnings: string[] }> = []
  const spec = EXPORT_TARGETS[state.packTarget]
  const exportWidth = spec.fixedSize?.width ?? spec.maxWidth
  const exportHeight = spec.fixedSize?.height ?? spec.maxHeight
  const format = state.packTarget === 'plurkEmoticon' ? 'gif' : spec.animated ? 'apng' : 'png'

  for (const { file, summary } of accepted) {
    let asset = assets.find((candidate) => pathKey(candidate.path) === pathKey(file.filePath))
    if (!asset) {
      asset = { id: createEntityId(), path: file.filePath, name: file.fileName }
      assets.push(asset)
      addedAssets.push(asset)
    }
    summaries[asset.id] = summary
    const firstGroup = summary.cspTimelineGroups[0]
    const built = firstGroup?.tracks.length
      ? buildCspTracks(summary, asset.id, firstGroup.tracks)
      : null
    if (extension(file.fileName) !== '.clip') omittedAnimationFiles.push(file.fileName)
    else if (!built) noCspTimelineFiles.push(file.fileName)
    if (summary.cspTimelineGroups.length > 1)
      extraTimelineFiles.push({
        fileName: file.fileName,
        ignoredCount: summary.cspTimelineGroups.length - 1,
      })
    if (built?.warnings.length)
      timelineWarnings.push({ fileName: file.fileName, warnings: built.warnings })

    const documentId = createEntityId()
    const document = runtimeDocument({
      tracks: built?.tracks ?? [newTrack('圖層 1', 8)],
      visibility: sourceVisibilityEntries(asset.id, summary.tree),
      fps: built?.frameRate ?? summary.timeline?.frameRate ?? 12,
      playCount: state.playCount,
      format,
      lineTarget: state.packTarget,
      exportWidth,
      exportHeight,
      lockAspect: state.lockAspect,
      scaleMode: state.scaleMode,
      mergeIdentical: state.mergeIdentical,
      staticFrame: 0,
      gifColors: state.gifColors,
      gifMatte: state.gifMatte,
      activeSourceId: asset.id,
      contentRevision: 0,
    })
    documents[documentId] = document
    documentIds.push(documentId)
    cells.push({
      index: file.index,
      sourcePath: '',
      pngBase64: '',
      width: exportWidth,
      height: exportHeight,
      byteLength: 0,
      frameCount: 0,
      documentId,
      renderedRevision: -1,
      mime: format === 'gif' ? 'image/gif' : 'image/png',
    })
  }
  return {
    input: {
      expectedProjectId: projectId,
      assets: addedAssets,
      summaries,
      documents,
      cells,
    },
    documentIds,
    omittedAnimationFiles,
    noCspTimelineFiles,
    extraTimelineFiles,
    timelineWarnings,
  }
}
