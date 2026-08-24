// 臨時診斷：dump 09.clip 每條 Track 的 binc 節點結構（TimeInfo 與所有 FCurve）
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import initSqlJs from 'sql.js'
import { readChunks } from '../src/clip/chunks.js'
import { parseBinc, type BincNode } from '../src/clip/binc.js'

const buffer = readFileSync(new URL('../assets/samples/09.clip', import.meta.url))
const chunks = readChunks(buffer)
const SQL = await initSqlJs()
const db = new SQL.Database(chunks.sqlite)

const q = (sql: string) => {
  const res = db.exec(sql)
  if (!res.length) return []
  const { columns, values } = res[0]!
  return values.map((row) => Object.fromEntries(row.map((v, i) => [columns[i]!, v])))
}

const text = (v: unknown) =>
  typeof v === 'string' ? v : v instanceof Uint8Array ? Buffer.from(v).toString('utf8') : ''

console.log('TimeLine rows:', JSON.stringify(q('SELECT * FROM TimeLine')))
for (const track of q('SELECT MainId, TrackKind, TrackActionMixer, LayerUuidWithTrack FROM Track')) {
  console.log(`\n=== Track ${track.MainId} kind=${track.TrackKind} ===`)
  if (track.TrackKind !== 2000) continue
  const packed = chunks.external.get(text(track.TrackActionMixer))
  if (!packed) { console.log('no mixer chunk'); continue }
  const root = parseBinc(inflateSync(packed.subarray(4)))
  const dump = (n: BincNode, d: number) => {
    let v = ''
    if (Array.isArray(n.value)) v = ` = [${n.value.length}] ${JSON.stringify(n.value.slice(0, 30))}`
    else if (n.value !== undefined && n.value !== null) v = ` = ${JSON.stringify(n.value)}`
    const attrs = Object.keys(n.attrs).length ? ` attrs=${JSON.stringify(n.attrs)}` : ''
    console.log('  '.repeat(d) + n.name + v + attrs)
    for (const c of n.children) dump(c, d + 1)
  }
  dump(root, 0)
}
