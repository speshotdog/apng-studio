/**
 * 真的把一支 GIF 上傳到 GIPHY，用來分辨「我們的程式有問題」還是「金鑰沒有上傳權限」。
 *
 * 金鑰**不會**經過任何人手上：這支腳本跑在 Electron 裡，直接用 app 自己的
 * safeStorage 讀出已存的金鑰，全程只印出長度與前後兩碼。
 *
 * 用法（二選一，金鑰都不會離開這台機器）：
 *   A. 先在程式的「設定」填好 API Key 並儲存，然後
 *        npm run try:giphy -- <來源檔路徑>
 *   B. 不想存進程式的話，直接用環境變數跑：
 *        GIPHY_API_KEY=xxxx npm run try:giphy -- <來源檔路徑>
 * 沒給路徑就用 assets/samples/11.clip。
 *
 * 注意：開發版（npm run dev）與打包版的設定檔是分開的
 * （%APPDATA%\Electron 與 %APPDATA%\APNG Studio），金鑰不會互通。
 *
 * 它會依序試兩種送法，因為 GIPHY 文件寫的是 api_key 放在 multipart form，
 * 但也有閘道只認 query string：
 *   1. 只放 form（GIPHY 官方 curl 範例的做法）
 *   2. form + query 都放
 * 哪一種成功就會講清楚，兩種都 401 幾乎可以斷定是金鑰權限問題。
 */
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { app } from 'electron'
import { parseSource } from '../src/formats/index.js'
import { encodeGif } from '../src/codec/gif.js'
import { getGiphyKey, getPublicSettings } from '../src/main/settings.js'
import type { Bitmap } from '../src/formats/types.js'

const UPLOAD_URL = 'https://upload.giphy.com/v1/gifs'
const API_ROOT = 'https://api.giphy.com/v1/gifs'

function mask(key: string): string {
  if (!key) return '(空)'
  return `${key.slice(0, 2)}…${key.slice(-2)}（長度 ${key.length}）`
}

/** 把來源檔的動畫資料夾前幾張畫成一支真的 GIF。 */
async function buildRealGif(sourcePath: string): Promise<Uint8Array> {
  const doc = await parseSource(sourcePath, await readFile(sourcePath))
  const folder = (() => {
    const pending = [doc.root]
    while (pending.length) {
      const node = pending.shift()!
      if (node.isAnimationFolder && node.children.length) return node
      pending.push(...node.children)
    }
    return null
  })()
  const cels = (folder?.children ?? doc.root.children.filter((child) => !child.isFolder)).slice(
    0,
    6,
  )
  if (!cels.length) throw new Error(`${sourcePath} 裡找不到可以畫成 GIF 的圖層`)

  const size = 270
  const frames = cels.map((cel) => {
    const bitmap: Bitmap = doc.renderNode(cel.id)
    // 等比縮到 270×270 的最近鄰縮放，夠用來驗上傳，不需要動到 renderer 的合成器。
    const rgba = new Uint8Array(size * size * 4)
    const scale = Math.min(size / bitmap.width, size / bitmap.height)
    const drawWidth = Math.max(1, Math.round(bitmap.width * scale))
    const drawHeight = Math.max(1, Math.round(bitmap.height * scale))
    const offsetX = Math.floor((size - drawWidth) / 2)
    const offsetY = Math.floor((size - drawHeight) / 2)
    for (let y = 0; y < drawHeight; y += 1) {
      const sourceY = Math.min(bitmap.height - 1, Math.floor(y / scale))
      for (let x = 0; x < drawWidth; x += 1) {
        const sourceX = Math.min(bitmap.width - 1, Math.floor(x / scale))
        const from = (sourceY * bitmap.width + sourceX) * 4
        const to = ((y + offsetY) * size + (x + offsetX)) * 4
        rgba[to] = bitmap.data[from]!
        rgba[to + 1] = bitmap.data[from + 1]!
        rgba[to + 2] = bitmap.data[from + 2]!
        rgba[to + 3] = bitmap.data[from + 3]!
      }
    }
    return { rgba, delayMs: 200 }
  })
  return encodeGif(frames, size, size, { numPlays: 0, maxColors: 256 }).bytes
}

async function attempt(
  label: string,
  gifBytes: Uint8Array,
  key: string,
  username: string,
  keyInQuery: boolean,
): Promise<string | null> {
  const form = new FormData()
  form.set('api_key', key)
  form.set('file', new Blob([Uint8Array.from(gifBytes).buffer], { type: 'image/gif' }), 'test.gif')
  form.set('tags', 'apng studio test')
  if (username.trim()) form.set('username', username.trim())
  const url = keyInQuery ? `${UPLOAD_URL}?api_key=${encodeURIComponent(key)}` : UPLOAD_URL
  const response = await fetch(url, { method: 'POST', body: form })
  const text = await response.text()
  const redacted = text.split(key).join('[金鑰]')
  console.log(`\n[${label}] HTTP ${response.status}`)
  console.log(`  回應：${redacted.slice(0, 300)}`)
  if (!response.ok) return null
  const id: unknown = JSON.parse(text)?.data?.id
  return typeof id === 'string' && id ? id : null
}

async function run(): Promise<void> {
  const argument = process.argv.slice(2).find((value) => !value.startsWith('-'))
  const sourcePath = argument
    ? resolve(argument)
    : resolve(import.meta.dirname, '..', 'assets', 'samples', '11.clip')

  const key = await getGiphyKey()
  const settings = await getPublicSettings()
  console.log(`設定檔位置：${app.getPath('userData')}`)
  console.log(`金鑰：${mask(key)}　使用者名稱：${settings.giphyUsername || '(未設定)'}`)
  if (!key) {
    console.log('\n沒有找到已儲存的 GIPHY 金鑰。請先在程式的「設定」填入 API Key 並按儲存。')
    app.exit(2)
    return
  }

  // 先確認這把金鑰在「讀取類」端點能不能用，藉此分辨金鑰本身無效 vs 沒有上傳權限。
  const trending = await fetch(`${API_ROOT}/trending?api_key=${encodeURIComponent(key)}&limit=1`)
  console.log(`\n[讀取端點 trending] HTTP ${trending.status}（金鑰本身是否有效）`)

  const gifBytes = await buildRealGif(sourcePath)
  console.log(`\n用 ${sourcePath} 產生了一支真的 GIF：${(gifBytes.length / 1024).toFixed(1)} KB`)

  let id = await attempt(
    '送法 1：api_key 只放 form（官方文件寫法）',
    gifBytes,
    key,
    settings.giphyUsername,
    false,
  )
  let usedQuery = false
  if (!id) {
    id = await attempt(
      '送法 2：api_key 同時放 form 與 query',
      gifBytes,
      key,
      settings.giphyUsername,
      true,
    )
    usedQuery = Boolean(id)
  }

  if (!id) {
    console.log('\n結論：兩種送法都失敗。')
    console.log(
      trending.ok
        ? '讀取端點是通的 → 金鑰有效，但這把金鑰沒有「上傳」權限。\n' +
            '  GIPHY 的一般 API key 預設只能讀，要上傳必須到 developers.giphy.com\n' +
            '  幫這個 app 申請 upload 權限（或改用有上傳權限的 production key）。'
        : '讀取端點也不通 → 金鑰本身就是無效的，請重新複製一次。',
    )
    app.exit(1)
    return
  }

  const details = await fetch(
    `${API_ROOT}/${encodeURIComponent(id)}?api_key=${encodeURIComponent(key)}`,
  )
  const body: unknown = await details.json()
  const pageUrl = (body as { data?: { url?: string } })?.data?.url ?? `https://giphy.com/gifs/${id}`
  console.log('\n上傳成功！')
  console.log(`  id：${id}`)
  console.log(`  頁面：${pageUrl}`)
  console.log(`  可用送法：${usedQuery ? 'api_key 需要同時放 query' : 'api_key 只放 form 即可'}`)
  app.exit(0)
}

void app.whenReady().then(() =>
  run().catch((error: unknown) => {
    console.error(`失敗：${error instanceof Error ? error.stack : String(error)}`)
    app.exit(1)
  }),
)
