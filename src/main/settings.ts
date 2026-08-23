import { app, safeStorage } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface StoredSettings {
  giphyKeyEncrypted?: string
  giphyUsername?: string
  progressExpanded?: boolean
}

let memoryKey = ''
let cached: StoredSettings | null = null
const path = (): string => join(app.getPath('userData'), 'settings.json')

async function read(): Promise<StoredSettings> {
  if (cached) return cached
  try {
    cached = JSON.parse(await readFile(path(), 'utf8')) as StoredSettings
  } catch {
    cached = {}
  }
  return cached
}

async function write(settings: StoredSettings): Promise<void> {
  cached = settings
  await writeFile(path(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

export async function getGiphyKey(): Promise<string> {
  if (memoryKey) return memoryKey
  const settings = await read()
  if (!settings.giphyKeyEncrypted || !safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(settings.giphyKeyEncrypted, 'base64'))
  } catch {
    return ''
  }
}

export async function getPublicSettings(): Promise<{
  hasGiphyKey: boolean
  giphyUsername: string
  encryptionAvailable: boolean
  progressExpanded: boolean
}> {
  const settings = await read()
  return {
    hasGiphyKey: Boolean(await getGiphyKey()),
    giphyUsername: settings.giphyUsername ?? '',
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    progressExpanded: settings.progressExpanded ?? false,
  }
}

export async function setGiphy(
  key: string,
  username: string,
): Promise<{ ok: boolean; error?: string }> {
  const cleanKey = key.trim()
  const settings = await read()
  if (!cleanKey && !(await getGiphyKey())) return { ok: false, error: 'API Key 不可空白' }
  settings.giphyUsername = username.trim()
  if (!cleanKey) {
    await write(settings)
  } else if (safeStorage.isEncryptionAvailable()) {
    settings.giphyKeyEncrypted = safeStorage.encryptString(cleanKey).toString('base64')
    memoryKey = ''
    await write(settings)
  } else {
    memoryKey = cleanKey
    delete settings.giphyKeyEncrypted
    await write(settings)
  }
  return { ok: true }
}

export async function clearGiphy(): Promise<void> {
  memoryKey = ''
  const settings = await read()
  delete settings.giphyKeyEncrypted
  settings.giphyUsername = ''
  await write(settings)
}

export async function setProgressExpanded(expanded: boolean): Promise<void> {
  const settings = await read()
  settings.progressExpanded = expanded
  await write(settings)
}
