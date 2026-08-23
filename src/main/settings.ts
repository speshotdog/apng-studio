import { app, safeStorage } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface StoredSettings {
  giphyKeyEncrypted?: string
  /** safeStorage 不可用時的退路：純文字存在使用者自己的設定檔裡（會在 UI 標示）。 */
  giphyKeyPlain?: string
  giphyUsername?: string
  progressExpanded?: boolean
  draftFolder?: string
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
  if (settings.giphyKeyEncrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(settings.giphyKeyEncrypted, 'base64'))
    } catch {
      // 換過機器或使用者帳號時解不開，往下退回明文欄位。
    }
  }
  return settings.giphyKeyPlain ?? ''
}

export async function getPublicSettings(): Promise<{
  hasGiphyKey: boolean
  giphyUsername: string
  encryptionAvailable: boolean
  progressExpanded: boolean
  draftFolder: string
}> {
  const settings = await read()
  return {
    hasGiphyKey: Boolean(await getGiphyKey()),
    giphyUsername: settings.giphyUsername ?? '',
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    progressExpanded: settings.progressExpanded ?? false,
    draftFolder: settings.draftFolder ?? '',
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
    delete settings.giphyKeyPlain
    memoryKey = ''
    await write(settings)
  } else {
    // 沒有系統金鑰庫時仍然要存下來，否則關掉程式金鑰就不見了，
    // 使用者只會看到「上傳失敗」而不知道是金鑰掉了。
    memoryKey = cleanKey
    settings.giphyKeyPlain = cleanKey
    delete settings.giphyKeyEncrypted
    await write(settings)
  }
  return { ok: true }
}

export async function clearGiphy(): Promise<void> {
  memoryKey = ''
  const settings = await read()
  delete settings.giphyKeyEncrypted
  delete settings.giphyKeyPlain
  settings.giphyUsername = ''
  await write(settings)
}

export async function getDraftFolder(): Promise<string> {
  return (await read()).draftFolder ?? ''
}

export async function setDraftFolder(folder: string): Promise<void> {
  const settings = await read()
  settings.draftFolder = folder
  await write(settings)
}

export async function setProgressExpanded(expanded: boolean): Promise<void> {
  const settings = await read()
  settings.progressExpanded = expanded
  await write(settings)
}
