import type { ProjectMeta } from '../project/types.js'

/**
 * 專案儲存層：一個專案一個資料夾。
 *
 * ```
 * <root>/index.json          ← 清單快取，壞掉會從各專案資料夾重建
 * <root>/<id>/project.json   ← 正式存檔（唯一的真相來源）
 * <root>/<id>/autosave.json  ← 自動存檔，只有比 project.json 新才算數
 * <root>/<id>/thumb.png      ← 縮圖
 * ```
 *
 * 舊版把所有專案（含 base64 縮圖與整組貼圖 PNG）塞在單一 projects.json，
 * 一個貼圖組專案就能到好幾 MB，每次存檔都要重寫整份，寫壞一次全部陪葬。
 * 這裡所有寫入都是「先寫 .tmp 再 rename」，寫到一半被砍掉舊檔仍然完好。
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { access, copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Project metadata used by list views and cache index entries. */

/** Full project record. Keep state opaque for the editor. */
export type { ProjectMeta }

export interface ProjectRecord {
  meta: ProjectMeta
  state: unknown
}

type AutosaveRecord = {
  state: unknown
  savedAt: string
}

type ProjectIndex = {
  version: 1
  projects: ProjectMeta[]
}

type CreateProjectInput = {
  name: string
  sourcePath: string
  sourceName: string
  state: unknown
  thumbnailDataUrl?: string
}

type LegacySnapshot = {
  id?: unknown
  name?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  clipPath?: unknown
  clipName?: unknown
  sourcePath?: unknown
  sourceName?: unknown
  thumbnail?: unknown
  state?: unknown
  pack?: unknown
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,'

export class ProjectStore {
  private readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  /**
   * 以各專案資料夾裡的 project.json 為準重新掃描，順便把 index.json 修好。
   * index.json 只是快取，壞掉不該讓整個清單掛掉。
   */
  async list(): Promise<ProjectMeta[]> {
    await this.ensureRoot()
    await this.warnIfIndexCorrupt()

    const metas: ProjectMeta[] = []
    const entries = await readdir(this.root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) {
        continue
      }

      const projectFile = path.join(this.root, entry.name, 'project.json')
      let record: ProjectRecord | null
      try {
        record = parseProjectRecord(await readJson(projectFile))
      } catch (error) {
        if (isMissingFileError(error)) {
          continue
        }
        console.warn(`專案 ${entry.name} 讀不動，略過：${formatError(error)}`)
        continue
      }

      if (record === null) {
        console.warn(`專案 ${entry.name} 的 project.json 格式不對，略過`)
        continue
      }
      if (record.meta.id !== entry.name || !ID_PATTERN.test(record.meta.id)) {
        console.warn(`專案 ${entry.name} 的 id 與資料夾名稱不符，略過`)
        continue
      }

      const autosave = await this.readFreshAutosave(record.meta.id, record.meta.updatedAt)
      metas.push({
        ...record.meta,
        hasAutosave: autosave !== null,
        autosaveAt: autosave?.savedAt ?? null,
      })
    }

    metas.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    await this.writeIndex(metas)
    return metas
  }

  async read(id: string): Promise<ProjectRecord | null> {
    const projectDir = this.projectDir(id)
    const projectFile = path.join(projectDir, 'project.json')
    let record: ProjectRecord | null
    try {
      record = parseProjectRecord(await readJson(projectFile))
    } catch (error) {
      if (isMissingFileError(error)) {
        return null
      }
      throw error
    }

    if (record === null) {
      throw new Error(`Invalid project file for id ${id}`)
    }

    const autosave = await this.readFreshAutosave(id, record.meta.updatedAt)
    return {
      ...record,
      meta: {
        ...record.meta,
        hasAutosave: autosave !== null,
        autosaveAt: autosave?.savedAt ?? null,
      },
    }
  }

  async readThumbnail(id: string): Promise<string | null> {
    const thumbFile = path.join(this.projectDir(id), 'thumb.png')
    try {
      const buffer = await readFile(thumbFile)
      return `${PNG_DATA_URL_PREFIX}${buffer.toString('base64')}`
    } catch (error) {
      if (isMissingFileError(error)) {
        return null
      }
      throw error
    }
  }

  async create(input: CreateProjectInput): Promise<ProjectMeta> {
    await this.ensureRoot()
    const now = new Date().toISOString()
    const id = await this.createUniqueId()
    const meta: ProjectMeta = {
      id,
      name: input.name,
      createdAt: now,
      updatedAt: now,
      sourcePath: input.sourcePath,
      sourceName: input.sourceName,
      hasAutosave: false,
      autosaveAt: null,
    }

    const projectDir = this.projectDir(id)
    await mkdir(projectDir, { recursive: true })
    await writeJsonAtomic(path.join(projectDir, 'project.json'), { meta, state: input.state })
    if (input.thumbnailDataUrl !== undefined) {
      await writePngDataUrl(path.join(projectDir, 'thumb.png'), input.thumbnailDataUrl)
    }
    await this.list()
    return meta
  }

  async save(id: string, state: unknown, thumbnailDataUrl?: string): Promise<ProjectMeta> {
    const record = await this.requireProject(id)
    const meta: ProjectMeta = {
      ...record.meta,
      updatedAt: new Date().toISOString(),
      hasAutosave: false,
      autosaveAt: null,
    }
    const projectDir = this.projectDir(id)
    await writeJsonAtomic(path.join(projectDir, 'project.json'), { meta, state })
    if (thumbnailDataUrl !== undefined) {
      await writePngDataUrl(path.join(projectDir, 'thumb.png'), thumbnailDataUrl)
    }
    await this.discardAutosave(id)
    await this.list()
    return meta
  }

  async autosave(id: string, state: unknown): Promise<void> {
    await this.requireProject(id)
    const autosave: AutosaveRecord = {
      state,
      savedAt: new Date().toISOString(),
    }
    await writeJsonAtomic(path.join(this.projectDir(id), 'autosave.json'), autosave)
  }

  async readAutosave(id: string): Promise<{ state: unknown; savedAt: string } | null> {
    const record = await this.read(id)
    if (record === null) {
      return null
    }
    return this.readFreshAutosave(id, record.meta.updatedAt)
  }

  async discardAutosave(id: string): Promise<void> {
    await rm(path.join(this.projectDir(id), 'autosave.json'), { force: true })
  }

  async rename(id: string, name: string): Promise<ProjectMeta[]> {
    const record = await this.requireProject(id)
    const meta: ProjectMeta = {
      ...record.meta,
      name,
      updatedAt: new Date().toISOString(),
      hasAutosave: record.meta.hasAutosave,
      autosaveAt: record.meta.autosaveAt,
    }
    await writeJsonAtomic(path.join(this.projectDir(id), 'project.json'), {
      meta,
      state: record.state,
    })
    return this.list()
  }

  async remove(id: string): Promise<ProjectMeta[]> {
    await rm(this.projectDir(id), { recursive: true, force: true })
    return this.list()
  }

  async duplicate(id: string, name: string): Promise<ProjectMeta> {
    const record = await this.requireProject(id)
    const now = new Date().toISOString()
    const newId = await this.createUniqueId()
    const meta: ProjectMeta = {
      ...record.meta,
      id: newId,
      name,
      createdAt: now,
      updatedAt: now,
      hasAutosave: false,
      autosaveAt: null,
    }

    const sourceThumb = path.join(this.projectDir(id), 'thumb.png')
    const targetDir = this.projectDir(newId)
    await mkdir(targetDir, { recursive: true })
    await writeJsonAtomic(path.join(targetDir, 'project.json'), {
      meta,
      state: record.state,
    })
    try {
      await copyFile(sourceThumb, path.join(targetDir, 'thumb.png'))
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error
      }
    }
    await this.list()
    return meta
  }

  async migrateLegacy(legacyFilePath: string): Promise<number> {
    await this.ensureRoot()
    let parsed: unknown
    try {
      parsed = await readJson(legacyFilePath)
    } catch (error) {
      if (isMissingFileError(error)) {
        return 0
      }
      throw error
    }

    const snapshots = parseLegacySnapshots(parsed)
    if (snapshots.length === 0) {
      await this.renameLegacyFile(legacyFilePath)
      return 0
    }

    let imported = 0
    for (const snapshot of snapshots) {
      const now = new Date().toISOString()
      const createdAt = stringOr(snapshot.createdAt, now)
      const updatedAt = stringOr(snapshot.updatedAt, createdAt)
      const id = await this.createUniqueId(stringOrNull(snapshot.id))
      const meta: ProjectMeta = {
        id,
        name: stringOr(snapshot.name, 'Untitled Project'),
        createdAt,
        updatedAt,
        sourcePath: stringOr(snapshot.clipPath, stringOr(snapshot.sourcePath, '')),
        sourceName: stringOr(snapshot.clipName, stringOr(snapshot.sourceName, '')),
        hasAutosave: false,
        autosaveAt: null,
      }

      const projectDir = this.projectDir(id)
      await mkdir(projectDir, { recursive: true })
      await writeJsonAtomic(path.join(projectDir, 'project.json'), {
        meta,
        state: legacyState(snapshot),
      })

      if (
        typeof snapshot.thumbnail === 'string' &&
        snapshot.thumbnail.startsWith(PNG_DATA_URL_PREFIX)
      ) {
        await writePngDataUrl(path.join(projectDir, 'thumb.png'), snapshot.thumbnail)
      }
      imported += 1
    }

    await this.renameLegacyFile(legacyFilePath)
    await this.list()
    return imported
  }

  private async requireProject(id: string): Promise<ProjectRecord> {
    const record = await this.read(id)
    if (record === null) {
      throw new Error(`Project not found: ${id}`)
    }
    return record
  }

  private projectDir(id: string): string {
    if (!ID_PATTERN.test(id)) {
      throw new Error(`Invalid project id: ${id}`)
    }
    return path.join(this.root, id)
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true })
  }

  private async createUniqueId(preferredId?: string | null): Promise<string> {
    if (preferredId !== undefined && preferredId !== null && ID_PATTERN.test(preferredId)) {
      if (!(await exists(path.join(this.root, preferredId)))) {
        return preferredId
      }
    }

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = randomUUID()
      if (!(await exists(path.join(this.root, id)))) {
        return id
      }
    }
    throw new Error('Unable to generate a unique project id')
  }

  private async warnIfIndexCorrupt(): Promise<void> {
    const indexFile = path.join(this.root, 'index.json')
    try {
      await readJson(indexFile)
    } catch (error) {
      if (!isMissingFileError(error)) {
        console.warn(`index.json 壞掉，改用各專案資料夾重建：${formatError(error)}`)
      }
    }
  }

  private async writeIndex(projects: ProjectMeta[]): Promise<void> {
    const index: ProjectIndex = {
      version: 1,
      projects,
    }
    await writeJsonAtomic(path.join(this.root, 'index.json'), index)
  }

  private async readFreshAutosave(
    id: string,
    projectUpdatedAt: string,
  ): Promise<AutosaveRecord | null> {
    const autosaveFile = path.join(this.projectDir(id), 'autosave.json')
    let autosave: AutosaveRecord | null
    try {
      autosave = parseAutosaveRecord(await readJson(autosaveFile))
    } catch (error) {
      if (isMissingFileError(error)) {
        return null
      }
      console.warn(`Ignoring corrupt autosave for ${id}: ${formatError(error)}`)
      return null
    }

    if (autosave === null) {
      console.warn(`Ignoring invalid autosave for ${id}: autosave.json shape is invalid`)
      return null
    }
    if (Date.parse(autosave.savedAt) <= Date.parse(projectUpdatedAt)) {
      return null
    }
    return autosave
  }

  private async renameLegacyFile(legacyFilePath: string): Promise<void> {
    const parsed = path.parse(legacyFilePath)
    const target = await nextAvailableLegacyPath(parsed.dir, parsed.name, parsed.ext)
    try {
      await rename(legacyFilePath, target)
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error
      }
    }
  }
}

async function readJson(filePath: string): Promise<unknown> {
  const text = await readFile(filePath, 'utf8')
  return JSON.parse(text) as unknown
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function writePngDataUrl(filePath: string, dataUrl: string): Promise<void> {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new Error('縮圖必須是 PNG 的 data URL')
  }
  const base64 = dataUrl.slice(PNG_DATA_URL_PREFIX.length)
  await atomicWriteFile(filePath, Buffer.from(base64, 'base64'))
}

async function atomicWriteFile(filePath: string, data: string | Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempFile = path.join(
    path.dirname(filePath),
    `${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`,
  )
  try {
    await writeFile(tempFile, data)
    await rename(tempFile, filePath)
  } catch (error) {
    await rm(tempFile, { force: true }).catch(() => undefined)
    throw error
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (isMissingFileError(error)) {
      return false
    }
    throw error
  }
}

async function nextAvailableLegacyPath(dir: string, name: string, ext: string): Promise<string> {
  const first = path.join(dir, `${name}.legacy${ext}`)
  if (!(await exists(first))) {
    return first
  }

  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(dir, `${name}.legacy.${index}${ext}`)
    if (!(await exists(candidate))) {
      return candidate
    }
  }
  throw new Error('Unable to choose a non-overwriting legacy backup path')
}

function parseProjectRecord(value: unknown): ProjectRecord | null {
  const object = asRecord(value)
  if (object === null) {
    return null
  }
  const meta = parseProjectMeta(object.meta)
  if (meta === null) {
    return null
  }
  return {
    meta,
    state: object.state,
  }
}

function parseProjectMeta(value: unknown): ProjectMeta | null {
  const object = asRecord(value)
  if (object === null) {
    return null
  }

  const id = stringOrNull(object.id)
  const name = stringOrNull(object.name)
  const createdAt = stringOrNull(object.createdAt)
  const updatedAt = stringOrNull(object.updatedAt)
  const sourcePath = stringOrNull(object.sourcePath)
  const sourceName = stringOrNull(object.sourceName)
  if (
    id === null ||
    name === null ||
    createdAt === null ||
    updatedAt === null ||
    sourcePath === null ||
    sourceName === null
  ) {
    return null
  }

  return {
    id,
    name,
    createdAt,
    updatedAt,
    sourcePath,
    sourceName,
    hasAutosave: typeof object.hasAutosave === 'boolean' ? object.hasAutosave : false,
    autosaveAt: typeof object.autosaveAt === 'string' ? object.autosaveAt : null,
  }
}

function parseAutosaveRecord(value: unknown): AutosaveRecord | null {
  const object = asRecord(value)
  if (object === null || typeof object.savedAt !== 'string') {
    return null
  }
  return {
    state: object.state,
    savedAt: object.savedAt,
  }
}

function parseLegacySnapshots(value: unknown): LegacySnapshot[] {
  if (Array.isArray(value)) {
    return value.map(asRecord).filter((item): item is LegacySnapshot => item !== null)
  }
  const object = asRecord(value)
  if (object !== null && Array.isArray(object.projects)) {
    return object.projects.map(asRecord).filter((item): item is LegacySnapshot => item !== null)
  }
  return []
}

function legacyState(snapshot: LegacySnapshot): unknown {
  const hasState = Object.prototype.hasOwnProperty.call(snapshot, 'state')
  const hasPack = Object.prototype.hasOwnProperty.call(snapshot, 'pack')
  if (hasState && hasPack) {
    return {
      state: snapshot.state,
      pack: snapshot.pack,
    }
  }
  if (hasState) {
    return snapshot.state
  }
  if (hasPack) {
    return {
      pack: snapshot.pack,
    }
  }
  return {}
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  return value as Record<string, unknown>
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
