export interface GiphyUploadResult {
  ok: boolean
  id?: string
  pageUrl?: string
  gifUrl?: string
  error?: string
}

type FetchLike = typeof fetch
const UPLOAD_URL = 'https://upload.giphy.com/v1/gifs'
const API_ROOT = 'https://api.giphy.com/v1/gifs'

function failure(status: number, message: string): GiphyUploadResult {
  if (status === 429 || /rate\s*limit/i.test(message))
    return { ok: false, error: '已達上傳額度；beta key 每天上限 10 次' }
  return { ok: false, error: message || `GIPHY 回傳錯誤（HTTP ${status}）` }
}
const redact = (message: string, key: string): string =>
  key ? message.split(key).join('[已隱藏]') : message

async function json(response: Response): Promise<any> {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

export async function uploadToGiphy(
  gifBytes: Uint8Array,
  tags: string,
  key: string,
  username: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 60_000,
): Promise<GiphyUploadResult> {
  if (!key) return { ok: false, error: '請先到設定填入 GIPHY API Key' }
  if (gifBytes.byteLength > 100 * 1024 * 1024)
    return { ok: false, error: 'GIPHY 上傳檔案不可超過 100 MB' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const form = new FormData()
    form.set('api_key', key)
    form.set(
      'file',
      new Blob([Uint8Array.from(gifBytes).buffer], { type: 'image/gif' }),
      'animation.gif',
    )
    if (tags.trim()) form.set('tags', tags.trim())
    if (username.trim()) form.set('username', username.trim())
    const uploaded = await fetchImpl(UPLOAD_URL, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })
    const uploadBody = await json(uploaded)
    if (!uploaded.ok) return failure(uploaded.status, uploadBody.meta?.msg ?? '')
    const id = uploadBody.data?.id
    if (typeof id !== 'string' || !id) return { ok: false, error: 'GIPHY 回應缺少圖片 ID' }
    const details = await fetchImpl(
      `${API_ROOT}/${encodeURIComponent(id)}?api_key=${encodeURIComponent(key)}`,
      {
        signal: controller.signal,
      },
    )
    const detailBody = await json(details)
    if (!details.ok) return failure(details.status, detailBody.meta?.msg ?? '')
    return {
      ok: true,
      id,
      pageUrl: detailBody.data?.url ?? `https://giphy.com/gifs/${id}`,
      gifUrl: detailBody.data?.images?.original?.url,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError')
      return { ok: false, error: 'GIPHY 上傳逾時（60 秒）' }
    return { ok: false, error: redact(error instanceof Error ? error.message : String(error), key) }
  } finally {
    clearTimeout(timeout)
  }
}

export async function testGiphyKey(
  key: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; message: string }> {
  if (!key) return { ok: false, message: '尚未設定' }
  try {
    const response = await fetchImpl(
      `${API_ROOT}/trending?api_key=${encodeURIComponent(key)}&limit=1`,
    )
    if (response.ok) return { ok: true, message: '金鑰有效' }
    if (response.status === 401 || response.status === 403)
      return { ok: false, message: '金鑰無效' }
    const body = await json(response)
    return { ok: false, message: body.meta?.msg ?? `連線失敗（HTTP ${response.status}）` }
  } catch (error) {
    return {
      ok: false,
      message: redact(error instanceof Error ? error.message : String(error), key),
    }
  }
}
