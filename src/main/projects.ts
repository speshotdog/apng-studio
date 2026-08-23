import { app } from 'electron'
import { join } from 'node:path'
import type { ProjectBlob, ProjectListItem, ProjectMeta } from '../project/types.js'
import { ProjectStore } from './project-store.js'

let store: ProjectStore | null = null

function projects(): ProjectStore {
  store ??= new ProjectStore(join(app.getPath('userData'), 'projects'))
  return store
}

/** 第一次啟動時把 v0.1／v0.2 的單一 projects.json 搬進新結構。 */
export async function migrateLegacyProjects(): Promise<number> {
  try {
    return await projects().migrateLegacy(join(app.getPath('userData'), 'projects.json'))
  } catch (error) {
    console.warn(`舊存檔匯入失敗，略過：${String(error)}`)
    return 0
  }
}

export async function listProjects(): Promise<ProjectListItem[]> {
  const metas = await projects().list()
  return Promise.all(
    metas.map(async (meta) => ({
      ...meta,
      thumbnail: await projects().readThumbnail(meta.id),
    })),
  )
}

export async function readProject(id: string): Promise<ProjectBlob | null> {
  const record = await projects().read(id)
  return record ? (record.state as ProjectBlob) : null
}

export async function createProject(input: {
  name: string
  sourcePath: string
  sourceName: string
  state: ProjectBlob
  thumbnailDataUrl?: string
}): Promise<ProjectMeta> {
  return projects().create(input)
}

export async function saveProject(
  id: string,
  state: ProjectBlob,
  thumbnailDataUrl?: string,
): Promise<ProjectMeta> {
  return projects().save(id, state, thumbnailDataUrl)
}

export async function autosaveProject(id: string, state: ProjectBlob): Promise<void> {
  return projects().autosave(id, state)
}

export async function readProjectAutosave(
  id: string,
): Promise<{ state: ProjectBlob; savedAt: string } | null> {
  const found = await projects().readAutosave(id)
  return found ? { state: found.state as ProjectBlob, savedAt: found.savedAt } : null
}

export async function discardProjectAutosave(id: string): Promise<void> {
  return projects().discardAutosave(id)
}

export async function renameProject(id: string, name: string): Promise<ProjectMeta[]> {
  return projects().rename(id, name)
}

export async function deleteProject(id: string): Promise<ProjectMeta[]> {
  return projects().remove(id)
}

export async function duplicateProject(id: string, name: string): Promise<ProjectMeta> {
  return projects().duplicate(id, name)
}
