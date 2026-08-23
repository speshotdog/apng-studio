import { extname } from 'node:path'
import { parseClip } from '../clip/index.js'
import { parsePsd } from './psd.js'
import { parseProcreate } from './procreate.js'
import type { SourceDocument } from './types.js'

export type { SourceDocument, SourceLayer } from './types.js'

/** 副檔名 → 人看得懂的名稱；草稿瀏覽器與錯誤訊息共用。 */
export const SUPPORTED: Record<string, string> = {
  '.clip': 'Clip Studio Paint',
  '.procreate': 'Procreate',
  '.psd': 'Photoshop',
  '.psb': 'Photoshop（大檔）',
}

export function isSupported(filePath: string): boolean {
  return extname(filePath).toLowerCase() in SUPPORTED
}

export async function parseSource(filePath: string, data: Buffer): Promise<SourceDocument> {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.clip') return parseClip(data)
  if (extension === '.procreate') return parseProcreate(data)
  if (extension === '.psd' || extension === '.psb') return parsePsd(data)
  throw new Error(`不支援的檔案格式：${extension || filePath}`)
}
