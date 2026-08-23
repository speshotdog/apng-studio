import { Buffer } from 'node:buffer'

export interface ClipChunks {
  sqlite: Buffer
  external: Map<string, Buffer>
}

function safeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} 超出可處理範圍`)
  return Number(value)
}

export function readChunks(data: Buffer): ClipChunks {
  if (data.length < 24 || data.subarray(0, 8).toString('ascii') !== 'CSFCHUNK') {
    throw new Error('不是有效的 CLIP 檔案：缺少 CSFCHUNK 檔頭')
  }
  let offset = 24
  let sqlite: Buffer | undefined
  const external = new Map<string, Buffer>()
  while (offset < data.length) {
    if (
      offset + 16 > data.length ||
      data.subarray(offset, offset + 4).toString('ascii') !== 'CHNK'
    ) {
      throw new Error(`CLIP chunk 格式錯誤，位移 ${offset}`)
    }
    const name = data.subarray(offset + 4, offset + 8).toString('ascii')
    const size = safeNumber(data.readBigUInt64BE(offset + 8), `${name} chunk 長度`)
    const start = offset + 16
    const end = start + size
    if (end > data.length) throw new Error(`${name} chunk 超出檔案範圍`)
    const payload = data.subarray(start, end)
    if (name === 'SQLi') sqlite = payload
    if (name === 'Exta') {
      if (payload.length < 16) throw new Error('Exta chunk 過短')
      const idLength = safeNumber(payload.readBigUInt64BE(0), 'Exta id 長度')
      if (8 + idLength + 8 > payload.length) throw new Error('Exta chunk id 超出範圍')
      const id = payload.subarray(8, 8 + idLength).toString('ascii')
      const bodyLength = safeNumber(payload.readBigUInt64BE(8 + idLength), 'Exta 資料長度')
      const bodyStart = 16 + idLength
      if (bodyStart + bodyLength > payload.length) throw new Error(`Exta ${id} 資料超出範圍`)
      external.set(id, payload.subarray(bodyStart, bodyStart + bodyLength))
    }
    offset = end
  }
  if (!sqlite) throw new Error('CLIP 檔案缺少 SQLi chunk')
  return { sqlite, external }
}
