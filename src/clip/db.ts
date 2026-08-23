import { Buffer } from 'node:buffer'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs, { type Database } from 'sql.js'

export async function openClipDatabase(sqlite: Buffer): Promise<Database> {
  const candidates = [
    join(import.meta.dirname, 'sql-wasm.wasm'),
    join(import.meta.dirname, '../out/main/sql-wasm.wasm'),
    join(import.meta.dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm'),
  ]
  const wasmPath = candidates.find(existsSync)
  if (!wasmPath) throw new Error('找不到 sql.js 的 sql-wasm.wasm')
  const SQL = await initSqlJs({ wasmBinary: readFileSync(wasmPath) })
  return new SQL.Database(sqlite)
}

export function queryRows(db: Database, sql: string): Record<string, unknown>[] {
  const result = db.exec(sql)[0]
  if (!result) return []
  return result.values.map((values) =>
    Object.fromEntries(result.columns.map((column, index) => [column, values[index]])),
  )
}
