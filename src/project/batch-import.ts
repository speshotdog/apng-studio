import type { BatchFolderScanResult, BatchScanFile, BatchScanSkippedFile } from './types.js'

export interface BatchFolderEntry {
  name: string
  path: string
}

const SUPPORTED_EXTENSION = /\.(?:clip|procreate|psd|psb)$/i

function windowsPathKey(filePath: string): string {
  return filePath.replaceAll('/', '\\').toLocaleLowerCase('en-US')
}

/**
 * 把支援的來源檔依檔名開頭格號分類。不支援的副檔名直接忽略；
 * 同一個 Windows 路徑的大小寫變體只算一份檔案。
 */
export function classifyBatchFolder(
  folder: string,
  entries: BatchFolderEntry[],
  packCount: number,
): BatchFolderScanResult {
  if (!Number.isInteger(packCount) || packCount < 1) throw new Error('貼圖張數必須是正整數')
  const seenPaths = new Set<string>()
  const skipped: BatchScanSkippedFile[] = []
  const valid: BatchScanFile[] = []
  const ordered = entries
    .filter((entry) => SUPPORTED_EXTENSION.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-TW', { numeric: true }))
  for (const entry of ordered) {
    const pathKey = windowsPathKey(entry.path)
    if (seenPaths.has(pathKey)) continue
    seenPaths.add(pathKey)
    const baseName = entry.name.replace(/\.[^.]+$/, '')
    const match = /^(\d+)/.exec(baseName)
    if (!match) {
      skipped.push({ fileName: entry.name, filePath: entry.path, reason: '無數字' })
      continue
    }
    const index = Number(match[1])
    if (index === 0) {
      skipped.push({ fileName: entry.name, filePath: entry.path, reason: '格號 0' })
      continue
    }
    if (!Number.isSafeInteger(index) || index > packCount) {
      skipped.push({ fileName: entry.name, filePath: entry.path, reason: '超出張數' })
      continue
    }
    valid.push({ index, fileName: entry.name, filePath: entry.path })
  }

  const byIndex = new Map<number, BatchScanFile[]>()
  for (const file of valid) byIndex.set(file.index, [...(byIndex.get(file.index) ?? []), file])
  const matched: BatchScanFile[] = []
  const duplicates: BatchFolderScanResult['duplicates'] = []
  for (const [index, files] of [...byIndex].sort(([left], [right]) => left - right)) {
    if (files.length === 1) matched.push(files[0]!)
    else duplicates.push({ index, files })
  }
  return { folder, matched, skipped, duplicates }
}

export type BatchConflictPolicy = 'overwrite' | 'keep'

export interface ParsedBatchItem<T> {
  file: BatchScanFile
  value?: T
  error?: string
}

/** 在所有檔案解析完後一次規劃要提交的項目，壞檔不會影響其他成功項。 */
export function planBatchCommit<T>(
  parsed: ParsedBatchItem<T>[],
  occupiedIndexes: ReadonlySet<number>,
  policy: BatchConflictPolicy,
): {
  accepted: Array<{ file: BatchScanFile; value: T }>
  failed: Array<{ file: BatchScanFile; error: string }>
  keptConflicts: BatchScanFile[]
  overwritten: number[]
} {
  const accepted: Array<{ file: BatchScanFile; value: T }> = []
  const failed: Array<{ file: BatchScanFile; error: string }> = []
  const keptConflicts: BatchScanFile[] = []
  const overwritten: number[] = []
  for (const item of parsed) {
    if (occupiedIndexes.has(item.file.index) && policy === 'keep') {
      keptConflicts.push(item.file)
      continue
    }
    if (item.value === undefined) {
      failed.push({ file: item.file, error: item.error ?? '無法解析' })
      continue
    }
    accepted.push({ file: item.file, value: item.value })
    if (occupiedIndexes.has(item.file.index)) overwritten.push(item.file.index)
  }
  return { accepted, failed, keptConflicts, overwritten }
}

/** 不受任務失敗影響的固定並行上限 map。 */
export async function mapWithConcurrency<Input, Output>(
  values: Input[],
  concurrency: number,
  worker: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('並行數必須大於 0')
  const output = new Array<Output>(values.length)
  let cursor = 0
  const run = async (): Promise<void> => {
    while (cursor < values.length) {
      const index = cursor++
      output[index] = await worker(values[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run))
  return output
}
