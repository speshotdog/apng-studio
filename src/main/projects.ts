import { app } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectSnapshot } from '../project/types.js'

const path = (): string => join(app.getPath('userData'), 'projects.json')

export async function listProjects(): Promise<ProjectSnapshot[]> {
  try {
    const value: unknown = JSON.parse(await readFile(path(), 'utf8'))
    if (!Array.isArray(value)) throw new Error('根節點不是陣列')
    return value as ProjectSnapshot[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn(`無法讀取進度快照，將使用空清單：${String(error)}`)
    return []
  }
}

async function store(projects: ProjectSnapshot[]): Promise<ProjectSnapshot[]> {
  const target = path()
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(projects, null, 2), 'utf8')
  await rename(temporary, target)
  return projects
}

export async function saveProject(snapshot: ProjectSnapshot): Promise<ProjectSnapshot[]> {
  const projects = await listProjects()
  const index = projects.findIndex(({ id }) => id === snapshot.id)
  if (index < 0) projects.unshift(snapshot)
  else projects[index] = snapshot
  return store(projects)
}

export async function deleteProject(id: string): Promise<ProjectSnapshot[]> {
  return store((await listProjects()).filter((snapshot) => snapshot.id !== id))
}

export async function renameProject(id: string, name: string): Promise<ProjectSnapshot[]> {
  const projects = await listProjects()
  const snapshot = projects.find((item) => item.id === id)
  if (snapshot) {
    snapshot.name = name.trim() || snapshot.name
    snapshot.updatedAt = new Date().toISOString()
  }
  return store(projects)
}
