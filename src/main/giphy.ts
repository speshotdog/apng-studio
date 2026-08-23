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
  // 光印「Unauthorized」對使用者毫無幫助 —— GIPHY 的一般 API key 預設只能讀，
  // 上傳要另外申請權限，這是這個 401 最常見的原因。
  if (status === 401 || status === 403)
    return {
      ok: false,
      error:
        '金鑰被 GIPHY 拒絕（Unauthorized）。GIPHY 的一般 API key 預設只能「讀取」，' +
        '要上傳必須到 developers.giphy.com 幫這個 app 申請上傳權限，' +
        '或改用有上傳權限的 production key。（也請確認金鑰沒有複製到多餘空白）',
    }
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
    // GIPHY 官方文件是把 api_key 放在 multipart form，先照文件送；
    // 但有些閘道只認 query string，所以 401/403 時再用帶 query 的方式重試一次。
    const post = (url: string): Promise<Response> =>
      fetchImpl(url, { method: 'POST', body: form, signal: controller.signal })
    let uploaded = await post(UPLOAD_URL)
    if (uploaded.status === 401 || uploaded.status === 403)
      uploaded = await post(`${UPLOAD_URL}?api_key=${encodeURIComponent(key)}`)
    const uploadBody = await json(uploaded)
    if (!uploaded.ok) return failure(uploaded.status, uploadBody.meta?.msg ?? '')
    // HTTP 200 但 meta.status 是 4xx 的情況也要當失敗，否則會卡在「缺少圖片 ID」。
    if (typeof uploadBody.meta?.status === 'number' && uploadBody.meta.status >= 400)
      return failure(uploadBody.meta.status, uploadBody.meta.msg ?? '')
    const id = uploadBody.data?.id
    if (typeof id !== 'string' || !id)
      return {
        ok: false,
        error: `GIPHY 回應缺少圖片 ID（HTTP ${uploaded.status}）：${redact(
          JSON.stringify(uploadBody).slice(0, 200),
          key,
        )}`,
      }
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
